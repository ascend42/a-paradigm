/**
 * Symphony Router — REST endpoints for the Platform Symphony section
 *
 * Exposes agent management, thread browsing, messaging, and file request
 * approval from the browser UI. All data comes from the Score file-based
 * mailbox at ~/.paradigm/score/.
 */

import { Router, type Request, type Response } from 'express';
import {
  listAgents,
  isAgentAsleep,
  cleanStaleAgents,
  discoverClaudeCodeSessions,
  getMyIdentity,
  listThreads,
  loadThread,
  getThreadMessages,
  resolveThread as resolveThreadLoader,
  buildMessage,
  routeMessage,
  createThread,
  readInbox,
  listFileRequests,
  expireOldRequests,
  approveFileRequest,
  denyFileRequest,
  resolveAgentIdentity,
  type MessageIntent,
  type Participant,
} from '../../../../paradigm-mcp/src/utils/symphony-loader.js';

export function createSymphonyRouter(
  projectDir: string,
  broadcast?: (message: Record<string, unknown>) => void,
): Router {
  const router = Router();

  // ── Agents ──────────────────────────────────────────────

  router.get('/agents', (_req: Request, res: Response) => {
    try {
      cleanStaleAgents();
      const agents = listAgents();
      const discovered = discoverClaudeCodeSessions();

      // Merge discovered sessions not already in agents
      const agentIds = new Set(agents.map(a => a.id));
      for (const d of discovered) {
        if (!agentIds.has(d.id)) agents.push(d);
      }

      const result = agents.map(a => ({
        id: a.id,
        name: a.name,
        project: a.project,
        role: a.role,
        status: isAgentAsleep(a) ? 'asleep' : 'awake',
        lastPoll: a.lastPoll,
        startedAt: a.startedAt,
        statusBlurb: a.statusBlurb,
      }));

      res.json({ agents: result });
    } catch (err) {
      res.status(500).json({ error: 'Failed to list agents', detail: String(err) });
    }
  });

  router.get('/agents/me', (_req: Request, res: Response) => {
    try {
      const identity = getMyIdentity(projectDir);
      res.json({ identity: identity || null });
    } catch (err) {
      res.status(500).json({ error: 'Failed to get identity', detail: String(err) });
    }
  });

  // ── Threads ─────────────────────────────────────────────

  router.get('/threads', (req: Request, res: Response) => {
    try {
      const statusParam = req.query.status as string | undefined;
      let status: 'active' | 'resolved' | undefined;
      if (statusParam === 'active' || statusParam === 'resolved') {
        status = statusParam;
      }

      const threads = listThreads(status);
      const result = threads.map(t => ({
        id: t.id,
        topic: t.topic,
        status: t.status,
        participants: t.participants.map(p => ({ id: p.id, name: p.name, type: p.type })),
        messageCount: t.messageCount,
        lastActivity: t.lastActivity,
        decision: t.decision,
      }));

      res.json({ threads: result });
    } catch (err) {
      res.status(500).json({ error: 'Failed to list threads', detail: String(err) });
    }
  });

  router.get('/threads/:threadId', (req: Request, res: Response) => {
    try {
      const { threadId } = req.params;
      const thread = loadThread(threadId);
      if (!thread) {
        res.status(404).json({ error: `Thread not found: ${threadId}` });
        return;
      }

      const messages = getThreadMessages(threadId);
      const symbolsDiscussed = new Set<string>();
      for (const msg of messages) {
        for (const sym of msg.symbols) symbolsDiscussed.add(sym);
      }

      res.json({
        thread: {
          id: thread.id,
          topic: thread.topic,
          status: thread.status,
          participants: thread.participants.map(p => ({ id: p.id, name: p.name, type: p.type })),
          messageCount: thread.messageCount,
          lastActivity: thread.lastActivity,
          decision: thread.decision,
        },
        messages: messages.map(m => ({
          id: m.id,
          sender: { id: m.sender.id, name: m.sender.name, type: m.sender.type },
          intent: m.intent,
          text: m.content.text,
          timestamp: m.timestamp,
          symbols: m.symbols,
          diff: m.content.diff,
          decision: m.content.decision,
          recipients: m.recipients?.map(r => ({ id: r.id, name: r.name })),
        })),
        symbolsDiscussed: [...symbolsDiscussed],
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to load thread', detail: String(err) });
    }
  });

  router.post('/threads/:threadId/resolve', (req: Request, res: Response) => {
    try {
      const { threadId } = req.params;
      const { decision } = req.body as { decision?: string };

      const success = resolveThreadLoader(threadId, decision);
      if (!success) {
        res.status(404).json({ error: `Thread not found: ${threadId}` });
        return;
      }

      if (broadcast) {
        broadcast({ type: 'symphony:thread_resolved', threadId, decision });
      }

      res.json({ resolved: true, threadId, decision });
    } catch (err) {
      res.status(500).json({ error: 'Failed to resolve thread', detail: String(err) });
    }
  });

  // ── Messages ────────────────────────────────────────────

  router.post('/messages', (req: Request, res: Response) => {
    try {
      const { intent, text, threadRoot, recipients, symbols, diff, decision } = req.body as {
        intent: MessageIntent;
        text: string;
        threadRoot?: string;
        recipients?: string[];
        symbols?: string[];
        diff?: string;
        decision?: string;
      };

      if (!intent || !text) {
        res.status(400).json({ error: 'intent and text are required' });
        return;
      }

      // Construct sender as human participant from project config
      const agentId = resolveAgentIdentity(projectDir);
      const sender: Participant = {
        id: `human/${agentId}`,
        name: 'Human (Platform UI)',
        type: 'human',
      };

      // Auto-create thread if needed
      let effectiveThreadRoot = threadRoot;
      let threadCreated = false;
      if (!threadRoot) {
        const topic = text.length > 60 ? text.slice(0, 60) + '...' : text;
        const thread = createThread(topic, sender);
        effectiveThreadRoot = thread.id;
        threadCreated = true;
      }

      // Resolve recipients
      let resolvedRecipients: Participant[] | undefined;
      if (recipients && recipients.length > 0) {
        const allAgents = listAgents();
        resolvedRecipients = recipients.map(id => {
          const agent = allAgents.find(a => a.id === id);
          if (agent) return { id: agent.id, name: agent.name, type: 'agent' as const };
          return { id, name: id, type: 'agent' as const };
        });
      }

      const message = buildMessage({
        sender,
        recipients: resolvedRecipients,
        intent,
        text,
        threadRoot: effectiveThreadRoot,
        symbols,
        diff,
        decision,
      });

      const deliveryCount = routeMessage(message);

      if (broadcast) {
        broadcast({
          type: 'symphony:message',
          message: {
            id: message.id,
            sender: { id: sender.id, name: sender.name, type: sender.type },
            intent: message.intent,
            text: message.content.text,
            timestamp: message.timestamp,
            symbols: message.symbols,
            diff: message.content.diff,
            decision: message.content.decision,
          },
          threadId: effectiveThreadRoot,
        });
      }

      res.json({
        sent: true,
        messageId: message.id,
        threadId: effectiveThreadRoot,
        threadCreated,
        deliveredTo: deliveryCount,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to send message', detail: String(err) });
    }
  });

  router.get('/inbox', (_req: Request, res: Response) => {
    try {
      const agentId = resolveAgentIdentity(projectDir);
      const messages = readInbox(agentId);
      res.json({
        agentId,
        messages: messages.map(m => ({
          id: m.id,
          sender: { id: m.sender.id, name: m.sender.name, type: m.sender.type },
          intent: m.intent,
          text: m.content.text,
          timestamp: m.timestamp,
          threadRoot: m.threadRoot,
          symbols: m.symbols,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to read inbox', detail: String(err) });
    }
  });

  // ── File Requests ───────────────────────────────────────

  router.get('/file-requests', (req: Request, res: Response) => {
    try {
      expireOldRequests();
      const statusParam = req.query.status as string | undefined;
      let status: 'pending' | 'approved' | 'denied' | 'expired' | undefined;
      if (statusParam === 'pending' || statusParam === 'approved' || statusParam === 'denied' || statusParam === 'expired') {
        status = statusParam;
      }

      const requests = listFileRequests(status);
      const result = requests.map(r => ({
        requestId: r.request.requestId,
        filePath: r.request.filePath,
        reason: r.request.reason,
        requester: { id: r.request.requester.id, name: r.request.requester.name },
        urgency: r.request.urgency,
        snippet: r.request.snippet,
        status: r.status,
        createdAt: r.createdAt,
        resolvedAt: r.resolvedAt,
        denyReason: r.denyReason,
      }));

      res.json({ fileRequests: result });
    } catch (err) {
      res.status(500).json({ error: 'Failed to list file requests', detail: String(err) });
    }
  });

  router.post('/file-requests/:requestId/action', (req: Request, res: Response) => {
    try {
      const { requestId } = req.params;
      const { action, reason } = req.body as { action: 'approve' | 'deny' | 'approve-redacted'; reason?: string };

      if (!action) {
        res.status(400).json({ error: 'action is required' });
        return;
      }

      if (action === 'deny') {
        const success = denyFileRequest(requestId, reason);
        res.json({ success, requestId, action: 'denied', reason });
        return;
      }

      const redact = action === 'approve-redacted';
      const result = approveFileRequest(requestId, projectDir, redact);

      if (!result.success) {
        res.status(400).json({ success: false, requestId, error: result.error });
        return;
      }

      res.json({
        success: true,
        requestId,
        action: redact ? 'approved-redacted' : 'approved',
        filePath: result.delivery?.filePath,
        size: result.delivery?.size,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to handle file request', detail: String(err) });
    }
  });

  // ── Status ──────────────────────────────────────────────

  router.get('/status', (_req: Request, res: Response) => {
    try {
      cleanStaleAgents();
      const agents = listAgents();
      const awake = agents.filter(a => !isAgentAsleep(a)).length;
      const threads = listThreads('active');
      const agentId = resolveAgentIdentity(projectDir);
      const unread = readInbox(agentId);
      const pendingRequests = listFileRequests('pending');

      res.json({
        agentCount: agents.length,
        awakeCount: awake,
        asleepCount: agents.length - awake,
        activeThreadCount: threads.length,
        unreadCount: unread.length,
        pendingFileRequests: pendingRequests.length,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to get status', detail: String(err) });
    }
  });

  return router;
}
