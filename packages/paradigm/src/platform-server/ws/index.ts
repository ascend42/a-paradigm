/**
 * Platform WebSocket Server
 *
 * Handles WS upgrade on the platform HTTP server, broadcasts agent commands
 * to connected browser clients, and receives user activity reports.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import { AgentPresenceManager, UserStateTracker } from './agent.js';

export interface PlatformWsContext {
  broadcast: (message: Record<string, unknown>) => void;
  agentPresence: AgentPresenceManager;
  userState: UserStateTracker;
  clientCount: () => number;
}

/**
 * Attach WebSocket server to an existing HTTP server.
 * Returns the shared context for agent command route to use.
 */
/** The channel of a message = the segment before the first ':' in its `type`. */
function channelOf(message: Record<string, unknown>): string {
  const type = typeof message.type === 'string' ? message.type : '';
  const colon = type.indexOf(':');
  return colon > 0 ? type.slice(0, colon) : type;
}

export function attachWebSocket(httpServer: HttpServer): PlatformWsContext {
  // Per-client channel subscriptions. A value of `null` = subscribed to ALL
  // channels (the default, so a client that never sends `subscribe` keeps the
  // old firehose behavior — backward compatible). A Set = only those channels
  // (e.g. a native Conductor consumer that only wants `tasks` + `agent`).
  const wsClients = new Map<WebSocket, Set<string> | null>();
  const agentPresence = new AgentPresenceManager();
  const userState = new UserStateTracker();

  // Channel-routed broadcast: a message only reaches clients subscribed to its
  // channel. `null` subscribers (default) receive everything.
  function broadcast(message: Record<string, unknown>): void {
    const data = JSON.stringify(message);
    const channel = channelOf(message);
    for (const [client, channels] of wsClients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      if (channels === null || channels.has(channel)) {
        client.send(data);
      }
    }
  }

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    wsClients.set(ws, null); // default: all channels (firehose, backward compat)

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'subscribe') {
          // { type:'subscribe', channels: ['tasks','agent',...] } — narrow this
          // client to the named channels. `channels: null`/absent re-opens the
          // firehose. An empty array = receive nothing but presence pings.
          wsClients.set(ws, Array.isArray(msg.channels) ? new Set(msg.channels.map(String)) : null);
          ws.send(JSON.stringify({ type: 'subscribed', channels: msg.channels ?? null }));
        } else if (msg.type === 'user:navigate') {
          userState.updateSection(msg.section);
        } else if (msg.type === 'user:select') {
          userState.updateSelectedSymbol(msg.symbol ?? null);
        } else if (msg.type === 'user:theme') {
          userState.updateTheme(msg.theme);
        } else if (msg.type === 'user:mute') {
          userState.setMuted(msg.muted);
          // Broadcast mute state so agents can see it
          broadcast({ type: 'agent:mute_changed', muted: msg.muted });
        } else if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on('close', () => {
      wsClients.delete(ws);
    });

    ws.on('error', () => {
      wsClients.delete(ws);
    });
  });

  // Prune stale agents every 30 seconds
  setInterval(() => {
    const pruned = agentPresence.pruneStale();
    for (const agentId of pruned) {
      broadcast({ type: 'agent:leave', agentId });
    }
  }, 30_000);

  return {
    broadcast,
    agentPresence,
    userState,
    clientCount: () => wsClients.size,
  };
}
