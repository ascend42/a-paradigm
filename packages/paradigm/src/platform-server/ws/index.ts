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
export function attachWebSocket(httpServer: HttpServer): PlatformWsContext {
  const wsClients = new Set<WebSocket>();
  const agentPresence = new AgentPresenceManager();
  const userState = new UserStateTracker();

  function broadcast(message: Record<string, unknown>): void {
    const data = JSON.stringify(message);
    for (const client of wsClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    wsClients.add(ws);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'user:navigate') {
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
