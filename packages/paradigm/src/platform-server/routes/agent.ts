/**
 * Agent Command Route
 *
 * POST /api/platform/agent-command
 *
 * Receives commands from MCP tools, broadcasts to browser via WebSocket.
 * For 'observe' commands, returns cached user state instead of broadcasting.
 */

import { Router, type Request, type Response } from 'express';
import type { PlatformWsContext } from '../ws/index.js';

export interface AgentCommand {
  command: 'navigate' | 'highlight' | 'annotate' | 'observe' | 'clear';
  agentId: string;
  payload: Record<string, unknown>;
}

export function createAgentRouter(wsContext: PlatformWsContext): Router {
  const router = Router();

  router.post('/', (req: Request, res: Response) => {
    const { command, agentId, payload } = req.body as AgentCommand;

    if (!command || !agentId) {
      res.status(400).json({ error: 'Missing command or agentId' });
      return;
    }

    // Ensure agent is registered
    const agents = wsContext.agentPresence.getAll();
    if (!agents.find(a => a.agentId === agentId)) {
      wsContext.agentPresence.join(agentId);
      wsContext.broadcast({ type: 'agent:join', agent: wsContext.agentPresence.getAll().find(a => a.agentId === agentId) });
    }
    wsContext.agentPresence.touch(agentId);

    switch (command) {
      case 'navigate': {
        const { section, symbol, loreId } = payload;
        const userActive = wsContext.userState.isUserActive();
        const muted = wsContext.userState.isMuted();

        if (muted) {
          res.json({ navigated: false, reason: 'Agent actions are muted by user' });
          return;
        }

        wsContext.broadcast({
          type: 'agent:navigate',
          agentId,
          section,
          symbol,
          loreId,
          userActive,
        });

        if (section) wsContext.userState.updateSection(section as string);
        if (symbol) wsContext.userState.updateSelectedSymbol(symbol as string);

        res.json({ navigated: true, section, symbol, userActive });
        return;
      }

      case 'highlight': {
        const { symbols, color, duration, pulse, label } = payload;
        const muted = wsContext.userState.isMuted();

        if (muted) {
          res.json({ highlighted: false, reason: 'Agent actions are muted by user' });
          return;
        }

        const symbolList = (symbols as string[]) || [];
        wsContext.userState.addHighlight({
          symbols: symbolList,
          color: (color as string) || wsContext.agentPresence.getAll().find(a => a.agentId === agentId)?.color || '#58a6ff',
          duration: (duration as number) || 5000,
          pulse: (pulse as boolean) ?? true,
          label: label as string | undefined,
          createdAt: Date.now(),
        });

        wsContext.broadcast({
          type: 'agent:highlight',
          agentId,
          symbols: symbolList,
          color: (color as string) || '#58a6ff',
          duration: (duration as number) || 5000,
          pulse: (pulse as boolean) ?? true,
          label,
        });

        res.json({ highlighted: true, count: symbolList.length });
        return;
      }

      case 'annotate': {
        const { type, message, symbol, severity, duration } = payload;
        const muted = wsContext.userState.isMuted();

        if (muted) {
          res.json({ annotated: false, reason: 'Agent actions are muted by user' });
          return;
        }

        const annotation = wsContext.userState.addAnnotation({
          type: (type as 'toast' | 'callout' | 'badge') || 'toast',
          message: (message as string) || '',
          symbol: symbol as string | undefined,
          severity: (severity as string) || 'info',
          duration: (duration as number) || 6000,
        });

        wsContext.broadcast({
          type: 'agent:annotate',
          agentId,
          annotation,
        });

        res.json({ annotated: true, id: annotation.id });
        return;
      }

      case 'observe': {
        const state = wsContext.userState.getState();
        const agentsList = wsContext.agentPresence.getAll();
        const connected = wsContext.clientCount() > 0;

        res.json({
          connected,
          users: wsContext.clientCount(),
          agents: agentsList,
          state: {
            section: state.section,
            selectedSymbol: state.selectedSymbol,
            theme: state.theme,
            muted: state.muted,
          },
          highlights: wsContext.userState.getHighlights(),
          annotations: wsContext.userState.getAnnotations(),
        });
        return;
      }

      case 'clear': {
        const { target } = payload;
        const clearTarget = (target as string) || 'all';

        if (clearTarget === 'highlights' || clearTarget === 'all') {
          wsContext.userState.clearHighlights();
        }
        if (clearTarget === 'annotations' || clearTarget === 'all') {
          wsContext.userState.clearAnnotations();
        }

        wsContext.broadcast({
          type: 'agent:clear',
          agentId,
          target: clearTarget,
        });

        res.json({ cleared: true, target: clearTarget });
        return;
      }

      default:
        res.status(400).json({ error: `Unknown command: ${command}` });
        return;
    }
  });

  return router;
}
