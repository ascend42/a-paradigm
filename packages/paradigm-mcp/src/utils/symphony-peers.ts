/**
 * Symphony Peers — Peer trust records for cross-machine networking
 *
 * Manages ~/.paradigm/score/peers.json for trusted remote peers.
 * Handles CRUD, pairing code generation/verification, and HMAC authentication.
 *
 * Storage:
 *   ~/.paradigm/score/peers.json   — Array of PeerRecord (mode 0o600)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

// ────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────

const SCORE_DIR = path.join(os.homedir(), '.paradigm', 'score');

/** Path to the peers trust store */
export const PEERS_FILE = path.join(SCORE_DIR, 'peers.json');

/** Pairing codes expire after 5 minutes */
export const PAIRING_TTL_MS = 5 * 60 * 1000;

// ────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────

export interface AgentSummary {
  id: string;              // e.g., "a-paradigm/core"
  project: string;
  role: string;
  status: 'awake' | 'asleep';
}

export interface PeerRecord {
  id: string;              // Human-chosen display name or auto-generated
  displayName: string;     // Friendly name shown in status
  address: string;         // ip:port
  sharedSecret: string;    // hex-encoded 32-byte secret
  connectedAt: string;     // ISO date of first connection
  lastSeen: string;        // ISO date of last successful message
  revoked: boolean;        // If true, reject connections from this peer
  agents: AgentSummary[];  // Last known agent list from this peer
}

export interface PairingState {
  code: string;            // 6-digit numeric code
  codeHash: string;        // SHA-256 hash of the code
  sharedSecret: string;    // hex-encoded 32-byte random secret
  createdAt: number;       // Date.now() for expiry check
}

// ────────────────────────────────────────────────────────
// Peers CRUD
// ────────────────────────────────────────────────────────

/**
 * Read all peer records from ~/.paradigm/score/peers.json.
 * Returns an empty array if the file is missing or corrupt.
 */
export function loadPeers(): PeerRecord[] {
  try {
    if (!fs.existsSync(PEERS_FILE)) return [];
    const content = fs.readFileSync(PEERS_FILE, 'utf-8');
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return [];
    return parsed as PeerRecord[];
  } catch {
    return [];
  }
}

/**
 * Write the full peers array to disk with restrictive permissions (0o600).
 * Creates the score directory if it does not exist.
 */
export function savePeers(peers: PeerRecord[]): void {
  if (!fs.existsSync(SCORE_DIR)) {
    fs.mkdirSync(SCORE_DIR, { recursive: true });
  }
  fs.writeFileSync(PEERS_FILE, JSON.stringify(peers, null, 2), { mode: 0o600 });
}

/**
 * Find a peer by id. Returns null if not found.
 */
export function findPeer(id: string): PeerRecord | null {
  const peers = loadPeers();
  return peers.find(p => p.id === id) ?? null;
}

/**
 * Add a new peer or update an existing one (merge by id), then save.
 */
export function addPeer(peer: PeerRecord): void {
  const peers = loadPeers();
  const idx = peers.findIndex(p => p.id === peer.id);
  if (idx >= 0) {
    peers[idx] = peer;
  } else {
    peers.push(peer);
  }
  savePeers(peers);
}

/**
 * Revoke a peer by setting revoked=true.
 * Returns true if the peer was found and revoked, false otherwise.
 */
export function revokePeer(id: string): boolean {
  const peers = loadPeers();
  const peer = peers.find(p => p.id === id);
  if (!peer) return false;

  peer.revoked = true;
  savePeers(peers);
  return true;
}

/**
 * Delete peers.json entirely. Returns the number of records that were deleted.
 */
export function forgetAllPeers(): number {
  const peers = loadPeers();
  const count = peers.length;

  if (fs.existsSync(PEERS_FILE)) {
    fs.unlinkSync(PEERS_FILE);
  }

  return count;
}

/**
 * Update lastSeen timestamp for a peer to the current time.
 */
export function updatePeerLastSeen(id: string): void {
  const peers = loadPeers();
  const peer = peers.find(p => p.id === id);
  if (!peer) return;

  peer.lastSeen = new Date().toISOString();
  savePeers(peers);
}

/**
 * Update the agents list for a peer (replaces the existing list).
 */
export function updatePeerAgents(id: string, agents: AgentSummary[]): void {
  const peers = loadPeers();
  const peer = peers.find(p => p.id === id);
  if (!peer) return;

  peer.agents = agents;
  savePeers(peers);
}

// ────────────────────────────────────────────────────────
// Pairing
// ────────────────────────────────────────────────────────

/**
 * Generate a new pairing state: 32-byte shared secret, 6-digit numeric code
 * derived from the first 3 random bytes, and a SHA-256 hash of the code.
 */
export function generatePairing(): PairingState {
  const sharedSecret = crypto.randomBytes(32).toString('hex');
  const code = (parseInt(crypto.randomBytes(3).toString('hex'), 16) % 1000000)
    .toString()
    .padStart(6, '0');
  const codeHash = crypto.createHash('sha256').update(code).digest('hex');

  return {
    code,
    codeHash,
    sharedSecret,
    createdAt: Date.now(),
  };
}

/**
 * Verify a pairing code against the original state.
 * Checks both correctness and expiry (5-minute TTL).
 */
export function verifyPairingCode(state: PairingState, code: string): boolean {
  // Check expiry first
  if (Date.now() - state.createdAt > PAIRING_TTL_MS) {
    return false;
  }

  const hash = crypto.createHash('sha256').update(code).digest('hex');
  return hash === state.codeHash;
}

// ────────────────────────────────────────────────────────
// HMAC Authentication
// ────────────────────────────────────────────────────────

/**
 * Compute an HMAC-SHA256 proof: HMAC(challenge, codeHash) as a hex string.
 * Used during the pairing handshake to prove knowledge of the code.
 */
export function computeHmacProof(challenge: string, codeHash: string): string {
  return crypto.createHmac('sha256', codeHash).update(challenge).digest('hex');
}

/**
 * Verify an HMAC proof by recomputing and comparing.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyHmacProof(challenge: string, codeHash: string, proof: string): boolean {
  const expected = computeHmacProof(challenge, codeHash);

  // Use timing-safe comparison to prevent timing side-channels
  if (expected.length !== proof.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(proof, 'hex'),
    );
  } catch {
    return false;
  }
}
