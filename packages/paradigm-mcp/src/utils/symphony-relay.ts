/**
 * Symphony Relay — WebSocket relay engine for cross-machine networking
 *
 * Operates in two modes:
 *   - **Server (hub)**: Listens on a port, authenticates peers via pairing
 *     codes and HMAC challenge-response, relays messages between connected
 *     machines.
 *   - **Client (spoke)**: Connects to a remote hub, authenticates, then
 *     forwards local outbox changes and delivers incoming messages to
 *     local agent inboxes.
 *
 * Wire protocol uses JSON-encoded {@link RelayFrame} objects over WebSocket
 * text frames.  Keepalive pings every 30 s, exponential-backoff reconnect
 * on the client side, and a bounded dedup set prevent duplicates and stale
 * connections.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';

import {
  listAgents,
  readOutbox,
  appendToInbox,
  isAgentAsleep,
  type SymphonyMessage,
} from './symphony-loader.js';

import {
  type AgentSummary,
  type PairingState,
  generatePairing,
  verifyPairingCode,
  computeHmacProof,
  verifyHmacProof,
  addPeer,
  loadPeers,
  updatePeerLastSeen,
  updatePeerAgents,
} from './symphony-peers.js';

// ────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────

/** Base directory for score data (kept for reference by callers). */
export const SCORE_DIR = path.join(os.homedir(), '.paradigm', 'score');

/** How often to scan outboxes for new messages (ms). */
const OUTBOX_POLL_INTERVAL_MS = 2000;

/** How often to send keepalive pings (ms). */
const KEEPALIVE_INTERVAL_MS = 30_000;

/** Maximum time to wait for a pong before declaring a connection dead (ms). */
const PONG_TIMEOUT_MS = 10_000;

/** Maximum number of failed auth attempts before cooldown. */
const MAX_AUTH_ATTEMPTS = 3;

/** Cooldown duration after too many failed auth attempts (ms). */
const AUTH_COOLDOWN_MS = 60_000;

/** Client reconnect delay bounds (ms). */
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

// ────────────────────────────────────────────────────────
// Frame Types
// ────────────────────────────────────────────────────────

export type RelayFrame =
  | { type: 'hello'; version: string; peerId: string; challenge: string }
  | { type: 'auth'; peerId: string; code: string; proof: string }
  | { type: 'auth_ok'; peerId: string; displayName: string; agents: AgentSummary[] }
  | { type: 'auth_fail'; reason: string }
  | { type: 'agents_sync'; agents: AgentSummary[] }
  | { type: 'message'; message: SymphonyMessage; origin: string }
  | { type: 'message_ack'; messageId: string }
  | { type: 'agent_joined'; agent: AgentSummary; peerId: string }
  | { type: 'agent_left'; agentId: string; peerId: string }
  | { type: 'nomination_forward'; nomination: Record<string, unknown>; origin: string }
  | { type: 'nomination_ack'; nominationId: string }
  | { type: 'peer_leaving' }
  | { type: 'ping' }
  | { type: 'pong' };

// ────────────────────────────────────────────────────────
// Events
// ────────────────────────────────────────────────────────

export interface RelayEvents {
  onPeerConnected?: (peerId: string, displayName: string) => void;
  onPeerDisconnected?: (peerId: string) => void;
  onPeerAuthFailed?: (address: string, reason: string) => void;
  onMessageRelayed?: (messageId: string, from: string, to: string) => void;
  onError?: (error: Error) => void;
}

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────

/** Send a JSON-encoded frame over a WebSocket connection. */
function sendFrame(ws: WebSocket, frame: RelayFrame): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(frame));
  }
}

/** Parse a raw WebSocket message into a RelayFrame. Returns null on failure. */
function parseFrame(data: unknown): RelayFrame | null {
  try {
    const text = typeof data === 'string' ? data : String(data);
    return JSON.parse(text) as RelayFrame;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────
// SymphonyRelay
// ────────────────────────────────────────────────────────

export class SymphonyRelay {
  private wss: WebSocketServer | null = null;
  private wsClient: WebSocket | null = null;
  private mode: 'server' | 'client';
  private pairingState: PairingState | null = null;

  /** peerId → WebSocket for authenticated connections. */
  private connectedPeers: Map<string, WebSocket> = new Map();

  /** Bounded dedup set of message IDs already processed. */
  private seenMessageIds: Set<string> = new Set();

  private outboxWatchInterval: ReturnType<typeof setInterval> | null = null;
  private keepaliveInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay: number = RECONNECT_MIN_MS;

  /** agentId → count of outbox lines already forwarded. */
  private outboxPositions: Map<string, number> = new Map();

  private events: RelayEvents;
  private myPeerId: string;
  private port: number;
  private stopped: boolean = false;

  /** IP/address → { count, cooldownUntil } for rate limiting. */
  private failedAuthAttempts: Map<string, { count: number; cooldownUntil: number }> = new Map();

  /** Per-connection pong tracking: peerId → pending timeout handle. */
  private pongTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /** Server-side address stored for client reconnect. */
  private serverAddress: string | null = null;

  /** Pairing code stored for client reconnect. */
  private serverCode: string | null = null;

  /** Maximum number of message IDs to keep for dedup. */
  private static MAX_SEEN_IDS = 10_000;

  constructor(options: {
    mode: 'server' | 'client';
    peerId: string;
    port?: number;
    events?: RelayEvents;
  }) {
    this.mode = options.mode;
    this.myPeerId = options.peerId;
    this.port = options.port ?? 3939;
    this.events = options.events ?? {};
  }

  // ────────────────────────────────────────────────────────
  // Server Mode
  // ────────────────────────────────────────────────────────

  /**
   * Start a WebSocket relay server (hub mode).
   *
   * Generates a fresh pairing state, binds to `this.port`, and begins
   * accepting peer connections.  Returns the pairing state so the caller
   * can display the code to the user.
   */
  async startServer(): Promise<PairingState> {
    if (this.mode !== 'server') {
      throw new Error('startServer() requires mode "server"');
    }

    this.pairingState = generatePairing();

    this.wss = new WebSocketServer({ port: this.port });

    this.wss.on('connection', (ws, req) => {
      const remoteAddress = req.socket.remoteAddress ?? 'unknown';

      // ── Rate-limit check ──
      if (this.isRateLimited(remoteAddress)) {
        sendFrame(ws, { type: 'auth_fail', reason: 'Too many failed attempts — try again later' });
        ws.close();
        return;
      }

      // ── Challenge ──
      const challenge = crypto.randomBytes(32).toString('hex');
      sendFrame(ws, {
        type: 'hello',
        version: '1.0',
        peerId: this.myPeerId,
        challenge,
      });

      let authenticated = false;

      ws.on('message', (raw) => {
        const frame = parseFrame(raw);
        if (!frame) return;

        if (!authenticated) {
          this.handleServerAuth(ws, frame, challenge, remoteAddress).then((peerId) => {
            if (peerId) {
              authenticated = true;
              this.registerPeerConnection(peerId, ws);
            }
          }).catch((err) => {
            this.events.onError?.(err instanceof Error ? err : new Error(String(err)));
          });
          return;
        }

        // ── Authenticated traffic ──
        this.handleAuthenticatedFrame(ws, frame);
      });

      ws.on('close', () => {
        if (authenticated) {
          this.handlePeerDisconnect(ws);
        }
      });

      ws.on('error', (err) => {
        this.events.onError?.(err);
      });
    });

    this.wss.on('error', (err) => {
      this.events.onError?.(err);
    });

    // Wait for the server to be listening
    await new Promise<void>((resolve, reject) => {
      this.wss!.on('listening', resolve);
      this.wss!.on('error', reject);
    });

    this.startOutboxWatcher();
    this.startKeepalive();

    return this.pairingState;
  }

  /**
   * Process an auth frame from an incoming client connection.
   * Returns the authenticated peerId on success, null on failure.
   */
  private async handleServerAuth(
    ws: WebSocket,
    frame: RelayFrame,
    challenge: string,
    remoteAddress: string,
  ): Promise<string | null> {
    if (frame.type !== 'auth') {
      sendFrame(ws, { type: 'auth_fail', reason: 'Expected auth frame' });
      ws.close();
      return null;
    }

    // Verify pairing code
    if (!this.pairingState || !verifyPairingCode(this.pairingState, frame.code)) {
      this.recordFailedAuth(remoteAddress);
      const reason = 'Invalid or expired pairing code';
      sendFrame(ws, { type: 'auth_fail', reason });
      this.events.onPeerAuthFailed?.(remoteAddress, reason);
      ws.close();
      return null;
    }

    // Verify HMAC proof (challenge + codeHash → proof)
    const codeHash = this.pairingState.codeHash;
    if (!verifyHmacProof(challenge, codeHash, frame.proof)) {
      this.recordFailedAuth(remoteAddress);
      const reason = 'HMAC proof verification failed';
      sendFrame(ws, { type: 'auth_fail', reason });
      this.events.onPeerAuthFailed?.(remoteAddress, reason);
      ws.close();
      return null;
    }

    // ── Auth success ──
    const localAgents = this.getLocalAgentSummaries();
    const displayName = this.myPeerId;

    sendFrame(ws, {
      type: 'auth_ok',
      peerId: this.myPeerId,
      displayName,
      agents: localAgents,
    });

    // Persist peer record
    addPeer({
      id: frame.peerId,
      displayName: frame.peerId,
      address: remoteAddress,
      sharedSecret: this.pairingState.sharedSecret,
      connectedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      revoked: false,
      agents: [],
    });

    return frame.peerId;
  }

  // ────────────────────────────────────────────────────────
  // Client Mode
  // ────────────────────────────────────────────────────────

  /**
   * Connect to a remote relay server as a spoke.
   *
   * Resolves once authentication completes successfully.
   * Rejects if the connection fails or auth is denied.
   */
  async connectToServer(address: string, code: string): Promise<void> {
    if (this.mode !== 'client') {
      throw new Error('connectToServer() requires mode "client"');
    }

    this.serverAddress = address;
    this.serverCode = code;

    await this.attemptConnection(address, code);
  }

  /**
   * Inner connection attempt — used for both initial connect and reconnects.
   */
  private attemptConnection(address: string, code: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.stopped) {
        reject(new Error('Relay has been stopped'));
        return;
      }

      const wsUrl = address.includes('://') ? address : `ws://${address}`;
      const ws = new WebSocket(wsUrl);
      let settled = false;

      ws.on('open', () => {
        this.wsClient = ws;
      });

      ws.on('message', (raw) => {
        const frame = parseFrame(raw);
        if (!frame) return;

        switch (frame.type) {
          case 'hello': {
            // Hash the code, then compute HMAC proof: HMAC(challenge, codeHash)
            const codeHash = crypto.createHash('sha256').update(code).digest('hex');
            const proof = computeHmacProof(frame.challenge, codeHash);
            sendFrame(ws, {
              type: 'auth',
              peerId: this.myPeerId,
              code,
              proof,
            });
            break;
          }

          case 'auth_ok': {
            // Save peer
            addPeer({
              id: frame.peerId,
              displayName: frame.displayName,
              address,
              sharedSecret: code,  // Store code for reconnect
              connectedAt: new Date().toISOString(),
              lastSeen: new Date().toISOString(),
              revoked: false,
              agents: frame.agents,
            });

            // Send our agents
            sendFrame(ws, {
              type: 'agents_sync',
              agents: this.getLocalAgentSummaries(),
            });

            this.registerPeerConnection(frame.peerId, ws);
            this.startOutboxWatcher();
            this.startKeepalive();

            // Reset reconnect delay on success
            this.reconnectDelay = RECONNECT_MIN_MS;

            if (!settled) {
              settled = true;
              resolve();
            }
            break;
          }

          case 'auth_fail': {
            if (!settled) {
              settled = true;
              reject(new Error(`Auth failed: ${frame.reason}`));
            }
            ws.close();
            break;
          }

          default:
            // Post-auth traffic
            this.handleAuthenticatedFrame(ws, frame);
            break;
        }
      });

      ws.on('close', () => {
        this.handlePeerDisconnect(ws);

        if (!settled) {
          settled = true;
          reject(new Error('Connection closed before auth completed'));
        } else if (!this.stopped) {
          this.scheduleReconnect();
        }
      });

      ws.on('error', (err) => {
        this.events.onError?.(err);

        if (!settled) {
          settled = true;
          reject(err);
        }
      });
    });
  }

  // ────────────────────────────────────────────────────────
  // Authenticated Frame Handler
  // ────────────────────────────────────────────────────────

  /**
   * Dispatch a frame received on an authenticated connection.
   */
  private handleAuthenticatedFrame(ws: WebSocket, frame: RelayFrame): void {
    switch (frame.type) {
      case 'message':
        this.handleIncomingMessage(ws, frame.message, frame.origin);
        break;

      case 'message_ack':
        // Acks are informational — no action needed beyond dedup
        break;

      case 'nomination_forward':
        this.handleNominationForward(ws, frame.nomination, frame.origin);
        break;

      case 'agents_sync':
        this.handleAgentsSync(ws, frame.agents);
        break;

      case 'agent_joined': {
        const peerId = this.peerIdForSocket(ws);
        if (peerId) {
          const peers = loadPeers();
          const peer = peers.find(p => p.id === peerId);
          if (peer) {
            const agents = [...(peer.agents || []), frame.agent];
            updatePeerAgents(peerId, agents);
          }
        }
        break;
      }

      case 'agent_left': {
        const peerId = this.peerIdForSocket(ws);
        if (peerId) {
          const peers = loadPeers();
          const peer = peers.find(p => p.id === peerId);
          if (peer) {
            const agents = (peer.agents || []).filter(a => a.id !== frame.agentId);
            updatePeerAgents(peerId, agents);
          }
        }
        break;
      }

      case 'peer_leaving':
        this.handlePeerDisconnect(ws);
        ws.close();
        break;

      case 'ping':
        sendFrame(ws, { type: 'pong' });
        break;

      case 'pong':
        this.handlePong(ws);
        break;

      default:
        // Unknown frame type — ignore
        break;
    }
  }

  // ────────────────────────────────────────────────────────
  // Message Handling
  // ────────────────────────────────────────────────────────

  /**
   * Process an incoming relayed message.
   *
   * 1. Dedup check — skip if already seen
   * 2. Deliver to matching local agents
   * 3. In server mode, relay to other connected peers (not the sender)
   * 4. Send ack back to the sender
   */
  private handleIncomingMessage(
    senderWs: WebSocket,
    message: SymphonyMessage,
    origin: string,
  ): void {
    // ── Dedup ──
    if (this.seenMessageIds.has(message.id)) {
      sendFrame(senderWs, { type: 'message_ack', messageId: message.id });
      return;
    }
    this.addToSeenIds(message.id);

    // ── Local delivery ──
    const localAgents = listAgents();

    if (message.recipients && message.recipients.length > 0) {
      // Targeted delivery — only deliver to matching local agents
      for (const recipient of message.recipients) {
        const localMatch = localAgents.find(a => a.id === recipient.id);
        if (localMatch) {
          appendToInbox(localMatch.id, message);
          this.events.onMessageRelayed?.(message.id, origin, localMatch.id);
        }
      }
    } else {
      // Broadcast — deliver to all local agents
      for (const agent of localAgents) {
        appendToInbox(agent.id, message);
        this.events.onMessageRelayed?.(message.id, origin, agent.id);
      }
    }

    // ── Server relay — forward to other connected peers ──
    if (this.mode === 'server') {
      const senderPeerId = this.peerIdForSocket(senderWs);
      for (const [peerId, peerWs] of this.connectedPeers) {
        if (peerId !== senderPeerId && peerId !== origin) {
          sendFrame(peerWs, { type: 'message', message, origin });
        }
      }
    }

    // ── Ack ──
    sendFrame(senderWs, { type: 'message_ack', messageId: message.id });
  }

  /**
   * Forward a nomination from a remote agent to local nomination storage.
   * Remote nominations are stored in the same nominations.jsonl but tagged with origin.
   */
  private handleNominationForward(
    senderWs: WebSocket,
    nomination: Record<string, unknown>,
    origin: string,
  ): void {
    if (!nomination?.id) return;

    // Tag with remote origin
    const tagged = { ...nomination, remote_origin: origin, forwarded_at: new Date().toISOString() };

    // Append to local nominations file
    try {
      const eventsDir = path.join(os.homedir(), '.paradigm', 'events');
      fs.mkdirSync(eventsDir, { recursive: true });
      const nomPath = path.join(eventsDir, 'nominations.jsonl');
      fs.appendFileSync(nomPath, JSON.stringify(tagged) + '\n', 'utf8');
    } catch {
      // Non-fatal — remote nomination storage failure
    }

    // In server mode, relay to other connected peers
    if (this.mode === 'server') {
      for (const [peerId, peerWs] of this.connectedPeers) {
        if (peerWs !== senderWs && peerWs.readyState === WebSocket.OPEN) {
          sendFrame(peerWs, { type: 'nomination_forward', nomination: tagged, origin });
        }
      }
    }

    // Ack
    sendFrame(senderWs, { type: 'nomination_ack', nominationId: nomination.id as string });
  }

  /**
   * Update stored agent list for a peer after receiving agents_sync.
   */
  private handleAgentsSync(ws: WebSocket, agents: AgentSummary[]): void {
    const peerId = this.peerIdForSocket(ws);
    if (peerId) {
      updatePeerAgents(peerId, agents);
      updatePeerLastSeen(peerId);
    }
  }

  // ────────────────────────────────────────────────────────
  // Outbox Watcher
  // ────────────────────────────────────────────────────────

  /**
   * Start polling local agent outboxes for new messages to relay.
   *
   * Reads each outbox as an array, compares length against the stored
   * position, and forwards any new entries to all connected peers.
   */
  private startOutboxWatcher(): void {
    if (this.outboxWatchInterval) return;

    this.outboxWatchInterval = setInterval(() => {
      if (this.connectedPeers.size === 0) return;

      try {
        const agents = listAgents();

        for (const agent of agents) {
          const messages = readOutbox(agent.id);
          const lastPosition = this.outboxPositions.get(agent.id) ?? 0;

          if (messages.length <= lastPosition) continue;

          // Forward new messages
          const newMessages = messages.slice(lastPosition);
          for (const msg of newMessages) {
            // Skip if already seen (prevents echo)
            if (this.seenMessageIds.has(msg.id)) continue;
            this.addToSeenIds(msg.id);

            const frame: RelayFrame = {
              type: 'message',
              message: msg,
              origin: this.myPeerId,
            };

            for (const [_peerId, peerWs] of this.connectedPeers) {
              sendFrame(peerWs, frame);
            }
          }

          this.outboxPositions.set(agent.id, messages.length);
        }
      } catch (err) {
        this.events.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }, OUTBOX_POLL_INTERVAL_MS);
  }

  /**
   * Stop the outbox watcher.
   */
  private stopOutboxWatcher(): void {
    if (this.outboxWatchInterval) {
      clearInterval(this.outboxWatchInterval);
      this.outboxWatchInterval = null;
    }
  }

  // ────────────────────────────────────────────────────────
  // Keepalive
  // ────────────────────────────────────────────────────────

  /**
   * Start periodic ping/pong keepalive for all connected peers.
   */
  private startKeepalive(): void {
    if (this.keepaliveInterval) return;

    this.keepaliveInterval = setInterval(() => {
      for (const [peerId, ws] of this.connectedPeers) {
        sendFrame(ws, { type: 'ping' });

        // Set a pong timeout
        const timer = setTimeout(() => {
          // No pong received — consider connection dead
          this.handlePeerDisconnect(ws);
          ws.terminate();
        }, PONG_TIMEOUT_MS);

        this.pongTimers.set(peerId, timer);
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  /**
   * Stop keepalive pings.
   */
  private stopKeepalive(): void {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }

    // Clear all pending pong timers
    for (const timer of this.pongTimers.values()) {
      clearTimeout(timer);
    }
    this.pongTimers.clear();
  }

  /**
   * Handle a pong response — clear the dead-connection timer.
   */
  private handlePong(ws: WebSocket): void {
    const peerId = this.peerIdForSocket(ws);
    if (peerId) {
      const timer = this.pongTimers.get(peerId);
      if (timer) {
        clearTimeout(timer);
        this.pongTimers.delete(peerId);
      }
      updatePeerLastSeen(peerId);
    }
  }

  // ────────────────────────────────────────────────────────
  // Peer Lifecycle
  // ────────────────────────────────────────────────────────

  /**
   * Register an authenticated peer connection.
   */
  private registerPeerConnection(peerId: string, ws: WebSocket): void {
    // Close any existing connection from the same peer
    const existing = this.connectedPeers.get(peerId);
    if (existing && existing !== ws) {
      existing.close();
    }

    this.connectedPeers.set(peerId, ws);
    updatePeerLastSeen(peerId);
    this.events.onPeerConnected?.(peerId, peerId);
  }

  /**
   * Clean up after a peer disconnects (or is terminated).
   */
  private handlePeerDisconnect(ws: WebSocket): void {
    const peerId = this.peerIdForSocket(ws);
    if (!peerId) return;

    this.connectedPeers.delete(peerId);

    // Clear pong timer
    const timer = this.pongTimers.get(peerId);
    if (timer) {
      clearTimeout(timer);
      this.pongTimers.delete(peerId);
    }

    this.events.onPeerDisconnected?.(peerId);
  }

  /**
   * Find the peerId associated with a WebSocket connection.
   */
  private peerIdForSocket(ws: WebSocket): string | null {
    for (const [peerId, peerWs] of this.connectedPeers) {
      if (peerWs === ws) return peerId;
    }
    return null;
  }

  // ────────────────────────────────────────────────────────
  // Reconnect (Client Mode)
  // ────────────────────────────────────────────────────────

  /**
   * Schedule an automatic reconnect with exponential backoff.
   */
  private scheduleReconnect(): void {
    if (this.stopped || this.mode !== 'client') return;
    if (!this.serverAddress || !this.serverCode) return;

    // Clean up current client state
    this.stopOutboxWatcher();
    this.stopKeepalive();
    this.wsClient = null;

    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);

    this.reconnectTimer = setTimeout(() => {
      if (this.stopped) return;

      this.attemptConnection(this.serverAddress!, this.serverCode!).catch((err) => {
        this.events.onError?.(err instanceof Error ? err : new Error(String(err)));
        // attemptConnection rejection will trigger another close → scheduleReconnect
      });
    }, delay);
  }

  // ────────────────────────────────────────────────────────
  // Rate Limiting
  // ────────────────────────────────────────────────────────

  /**
   * Check whether an address is currently rate-limited.
   */
  private isRateLimited(address: string): boolean {
    const entry = this.failedAuthAttempts.get(address);
    if (!entry) return false;
    if (Date.now() < entry.cooldownUntil) return true;
    if (entry.count >= MAX_AUTH_ATTEMPTS) {
      entry.cooldownUntil = Date.now() + AUTH_COOLDOWN_MS;
      return true;
    }
    return false;
  }

  /**
   * Record a failed auth attempt from a given address.
   */
  private recordFailedAuth(address: string): void {
    const entry = this.failedAuthAttempts.get(address);
    if (entry) {
      entry.count++;
    } else {
      this.failedAuthAttempts.set(address, { count: 1, cooldownUntil: 0 });
    }
  }

  // ────────────────────────────────────────────────────────
  // Dedup
  // ────────────────────────────────────────────────────────

  /**
   * Add a message ID to the dedup set, evicting the oldest half when
   * the set exceeds {@link MAX_SEEN_IDS}.
   */
  private addToSeenIds(messageId: string): void {
    this.seenMessageIds.add(messageId);

    if (this.seenMessageIds.size > SymphonyRelay.MAX_SEEN_IDS) {
      // Evict the oldest half
      const entries = Array.from(this.seenMessageIds);
      const keepFrom = Math.floor(entries.length / 2);
      this.seenMessageIds = new Set(entries.slice(keepFrom));
    }
  }

  // ────────────────────────────────────────────────────────
  // Local Agent Helpers
  // ────────────────────────────────────────────────────────

  /**
   * Build a summary list of all locally registered agents.
   */
  private getLocalAgentSummaries(): AgentSummary[] {
    return listAgents().map(a => ({
      id: a.id,
      project: a.project,
      role: a.role,
      status: (isAgentAsleep(a) ? 'asleep' : 'awake') as 'awake' | 'asleep',
    }));
  }

  // ────────────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────────────

  /**
   * Gracefully shut down the relay.
   *
   * Sends `peer_leaving` to all connected peers, closes every WebSocket,
   * clears all timers, and shuts down the server (if running).
   */
  stop(): void {
    this.stopped = true;

    // Notify peers
    for (const [_peerId, ws] of this.connectedPeers) {
      sendFrame(ws, { type: 'peer_leaving' });
      ws.close();
    }
    this.connectedPeers.clear();

    // Close client socket
    if (this.wsClient) {
      this.wsClient.close();
      this.wsClient = null;
    }

    // Clear timers
    this.stopOutboxWatcher();
    this.stopKeepalive();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Shut down server
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }

  /**
   * Return the list of currently connected peer IDs.
   */
  getConnectedPeers(): string[] {
    return Array.from(this.connectedPeers.keys());
  }

  /**
   * Return the aggregated agent summaries from all connected peers.
   */
  getRemoteAgents(): Array<AgentSummary & { peerId: string }> {
    const result: Array<AgentSummary & { peerId: string }> = [];
    const peers = loadPeers();

    for (const peerId of this.connectedPeers.keys()) {
      const peer = peers.find(p => p.id === peerId);
      if (peer?.agents) {
        for (const agent of peer.agents) {
          result.push({ ...agent, peerId });
        }
      }
    }

    return result;
  }

  /**
   * Generate a new pairing code, invalidating the previous one.
   *
   * Only meaningful in server mode — clients don't generate pairing codes.
   */
  rotatePairingCode(): PairingState {
    if (this.mode !== 'server') {
      throw new Error('rotatePairingCode() requires mode "server"');
    }

    this.pairingState = generatePairing();
    return this.pairingState;
  }
}
