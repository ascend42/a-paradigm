/**
 * Symphony MCP Tools — Agent-to-agent messaging via A-Mail
 *
 * Tools:
 * - paradigm_symphony_poll: Read inbox messages (heartbeat)
 * - paradigm_symphony_send: Send a message to agents
 * - paradigm_symphony_status: List agents and active threads
 * - paradigm_symphony_thread: Get full thread context
 * - paradigm_symphony_request_file: Request a file from another project
 * - paradigm_symphony_approve_file: Approve or deny a file request
 */

import type { ProjectContext } from '../utils/index-loader.js';
import {
  readInbox,
  acknowledgeMessages,
  markAgentPollTime,
  getMyIdentity,
  registerAgent,
  resolveAgentIdentity,
  listAgents,
  listThreads,
  loadThread,
  getThreadMessages,
  buildMessage,
  routeMessage,
  createThread,
  createFileRequest,
  approveFileRequest,
  denyFileRequest,
  isPathDenied,
  loadTrustConfig,
  listFileRequests,
  expireOldRequests,
  isAgentAsleep,
  cleanStaleAgents,
  garbageCollect,
  type SymphonyMessage,
  type Participant,
  type MessageIntent,
} from '../utils/symphony-loader.js';

/**
 * Get list of symphony tools with safety annotations
 */
export function getSymphonyToolsList() {
  return [
    {
      name: 'paradigm_symphony_poll',
      description:
        'Poll mailbox for new messages. Call via /loop for continuous agent messaging. Returns unread messages formatted as markdown with thread context and suggested actions. Updates heartbeat. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      annotations: {
        readOnlyHint: false, // Updates ack + poll time
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_symphony_send',
      description:
        'Send a message to other agents or broadcast. Auto-creates thread if no threadRoot provided. Supports intents: question, context, proposal, decision, action, etc. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          intent: {
            type: 'string',
            enum: [
              'question', 'context', 'clarification', 'proposal',
              'verification', 'action', 'decision', 'alert',
              'approval', 'rejection', 'reference', 'handoff',
            ],
            description: 'Message intent (what kind of message this is)',
          },
          text: {
            type: 'string',
            description: 'Message text content',
          },
          parentId: {
            type: 'string',
            description: 'ID of message being replied to',
          },
          threadRoot: {
            type: 'string',
            description: 'Thread ID to post in (auto-created if omitted)',
          },
          recipients: {
            type: 'array',
            items: { type: 'string' },
            description: 'Agent IDs to send to (omit for broadcast)',
          },
          symbols: {
            type: 'array',
            items: { type: 'string' },
            description: 'Paradigm symbols referenced (e.g., ["#auth-service", "$login-flow"])',
          },
          diff: {
            type: 'string',
            description: 'Code diff to include with the message',
          },
          decision: {
            type: 'string',
            description: 'Decision text to record (for intent=decision)',
          },
        },
        required: ['intent', 'text'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_symphony_status',
      description:
        'Show A-Mail network status: linked agents (with awake/asleep detection), active threads, unread count, pending file requests. ~150 tokens.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_symphony_thread',
      description:
        'Get full thread context: all messages in order, participants, extracted decisions, and referenced symbols. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          threadId: {
            type: 'string',
            description: 'Thread ID (thr-XXXXXXXX format)',
          },
          depth: {
            type: 'number',
            description: 'Maximum messages to return (default: 50)',
          },
        },
        required: ['threadId'],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_symphony_request_file',
      description:
        'Request a file from another agent\'s project. Human approval required (unless auto-approved in trust config). Files matching hard-deny patterns (.env, *.key, etc.) are always blocked. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Relative file path to request (e.g., "src/auth/middleware.ts")',
          },
          from: {
            type: 'string',
            description: 'Agent ID to request file from (e.g., "backend/core")',
          },
          reason: {
            type: 'string',
            description: 'Why this file is needed',
          },
          snippet: {
            type: 'string',
            description: 'Specific function or line range needed (e.g., "validateToken function" or "lines 50-100")',
          },
        },
        required: ['filePath', 'from', 'reason'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_symphony_approve_file',
      description:
        'Approve or deny a pending file request. Use action "approve" to send file, "deny" to reject, or "approve-redacted" to send with secrets stripped. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          requestId: {
            type: 'string',
            description: 'File request ID (freq-XXXXXXXX format)',
          },
          action: {
            type: 'string',
            enum: ['approve', 'deny', 'approve-redacted'],
            description: 'Approve, deny, or approve with redaction',
          },
          reason: {
            type: 'string',
            description: 'Reason for denial (required for deny action)',
          },
        },
        required: ['requestId', 'action'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
  ];
}

/**
 * Handle symphony tool calls
 */
export async function handleSymphonyTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext
): Promise<{ text: string; handled: boolean }> {
  // Ensure agent is registered for any symphony tool call
  let identity = getMyIdentity(ctx.rootDir);
  if (!identity) {
    identity = registerAgent(ctx.rootDir);
  }

  switch (name) {
    case 'paradigm_symphony_poll': {
      // Clean up stale agents and expired file requests
      cleanStaleAgents();
      expireOldRequests();

      // Mark poll time for heartbeat
      markAgentPollTime(identity.id);

      // Read unread messages
      const messages = readInbox(identity.id);

      // Acknowledge if we got messages
      if (messages.length > 0) {
        const lastId = messages[messages.length - 1].id;
        acknowledgeMessages(identity.id, lastId);
      }

      // Garbage collect old messages
      garbageCollect(identity.id);

      // Check for pending file requests directed at us
      const pendingRequests = listFileRequests('pending');

      if (messages.length === 0 && pendingRequests.length === 0) {
        return {
          handled: true,
          text: JSON.stringify({
            messages: 0,
            note: 'No new messages. Mailbox is quiet.',
            identity: identity.id,
          }),
        };
      }

      // Format messages as markdown
      const formatted = formatPollOutput(messages, pendingRequests);

      return {
        handled: true,
        text: formatted,
      };
    }

    case 'paradigm_symphony_send': {
      const intent = args.intent as MessageIntent;
      const text = args.text as string;
      const parentId = args.parentId as string | undefined;
      let threadRoot = args.threadRoot as string | undefined;
      const recipientIds = args.recipients as string[] | undefined;
      const symbols = args.symbols as string[] | undefined;
      const diff = args.diff as string | undefined;
      const decision = args.decision as string | undefined;

      // Auto-create thread if no threadRoot specified
      let threadCreated = false;
      if (!threadRoot && !parentId) {
        const topic = text.length > 60 ? text.slice(0, 60) + '...' : text;
        const thread = createThread(topic, identityToParticipant(identity));
        threadRoot = thread.id;
        threadCreated = true;
      }

      // Resolve recipients
      let recipients: Participant[] | undefined;
      if (recipientIds && recipientIds.length > 0) {
        const allAgents = listAgents();
        recipients = recipientIds
          .map(id => {
            const agent = allAgents.find(a => a.id === id);
            if (agent) return identityToParticipant(agent);
            return { id, name: id, type: 'agent' as const };
          });
      }

      const message = buildMessage({
        sender: identityToParticipant(identity),
        recipients,
        intent,
        text,
        parentId,
        threadRoot,
        symbols,
        diff,
        decision,
      });

      const deliveryCount = routeMessage(message);

      return {
        handled: true,
        text: JSON.stringify({
          sent: true,
          messageId: message.id,
          threadId: threadRoot,
          threadCreated,
          deliveredTo: deliveryCount,
          intent,
        }),
      };
    }

    case 'paradigm_symphony_status': {
      cleanStaleAgents();

      const agents = listAgents();
      const threads = listThreads('active');
      const unread = readInbox(identity.id);
      const pendingRequests = listFileRequests('pending');

      return {
        handled: true,
        text: JSON.stringify({
          identity: {
            id: identity.id,
            project: identity.project,
            role: identity.role,
          },
          agents: agents.map(a => ({
            id: a.id,
            name: a.name,
            project: a.project,
            role: a.role,
            status: isAgentAsleep(a) ? 'asleep' : 'awake',
            lastPoll: a.lastPoll,
          })),
          activeThreads: threads.map(t => ({
            id: t.id,
            topic: t.topic,
            participants: t.participants.length,
            messageCount: t.messageCount,
            lastActivity: t.lastActivity,
          })),
          unreadCount: unread.length,
          pendingFileRequests: pendingRequests.length,
        }, null, 2),
      };
    }

    case 'paradigm_symphony_thread': {
      const threadId = args.threadId as string;
      const depth = (args.depth as number) || 50;

      const thread = loadThread(threadId);
      if (!thread) {
        return {
          handled: true,
          text: JSON.stringify({ error: `Thread not found: ${threadId}` }),
        };
      }

      const messages = getThreadMessages(threadId).slice(0, depth);

      // Extract decisions and symbols from messages
      const decisions: string[] = [];
      const symbolsDiscussed = new Set<string>();
      const filesReferenced = new Set<string>();

      for (const msg of messages) {
        if (msg.content.decision) decisions.push(msg.content.decision);
        if (msg.intent === 'decision' && msg.content.text) decisions.push(msg.content.text);
        for (const sym of msg.symbols) symbolsDiscussed.add(sym);
        if (msg.attachments) {
          for (const att of msg.attachments) {
            if (att.type === 'file') filesReferenced.add(att.name);
          }
        }
      }

      return {
        handled: true,
        text: JSON.stringify({
          thread: {
            id: thread.id,
            topic: thread.topic,
            status: thread.status,
            createdAt: thread.createdAt,
            decision: thread.decision,
          },
          participants: thread.participants,
          messages: messages.map(m => ({
            id: m.id,
            sender: m.sender.name,
            intent: m.intent,
            text: m.content.text,
            timestamp: m.timestamp,
            symbols: m.symbols,
            hasDiff: !!m.content.diff,
            hasDecision: !!m.content.decision,
          })),
          decisions,
          symbolsDiscussed: [...symbolsDiscussed],
          filesReferenced: [...filesReferenced],
        }, null, 2),
      };
    }

    case 'paradigm_symphony_request_file': {
      const filePath = args.filePath as string;
      const from = args.from as string;
      const reason = args.reason as string;
      const snippet = args.snippet as string | undefined;

      // Check hard-deny list
      const trustConfig = loadTrustConfig();
      if (isPathDenied(filePath, trustConfig)) {
        return {
          handled: true,
          text: JSON.stringify({
            error: `File path "${filePath}" is on the hard-deny list and cannot be requested.`,
            deniedPatterns: trustConfig.defaults.neverApprove,
          }),
        };
      }

      const record = createFileRequest({
        filePath,
        requester: identityToParticipant(identity),
        reason,
        snippet,
        threadRoot: undefined,
      });

      // Send file request message to target agent
      const requestMessage = buildMessage({
        sender: identityToParticipant(identity),
        recipients: [{ id: from, name: from, type: 'agent' }],
        intent: 'fileRequest',
        text: `Requesting file: ${filePath}\nReason: ${reason}${snippet ? `\nSnippet: ${snippet}` : ''}`,
        symbols: [],
      });
      routeMessage(requestMessage);

      return {
        handled: true,
        text: JSON.stringify({
          requestId: record.request.requestId,
          status: 'pending',
          filePath,
          from,
          message: `File request created. The owning agent's human must approve via "paradigm mail approve ${record.request.requestId}" or "paradigm_symphony_approve_file".`,
        }),
      };
    }

    case 'paradigm_symphony_approve_file': {
      const requestId = args.requestId as string;
      const action = args.action as 'approve' | 'deny' | 'approve-redacted';
      const reason = args.reason as string | undefined;

      if (action === 'deny') {
        const success = denyFileRequest(requestId, reason);
        return {
          handled: true,
          text: JSON.stringify({
            success,
            requestId,
            action: 'denied',
            reason: reason || 'No reason provided',
          }),
        };
      }

      const redact = action === 'approve-redacted';
      const result = approveFileRequest(requestId, ctx.rootDir, redact);

      if (!result.success) {
        return {
          handled: true,
          text: JSON.stringify({
            success: false,
            requestId,
            error: result.error,
          }),
        };
      }

      return {
        handled: true,
        text: JSON.stringify({
          success: true,
          requestId,
          action: redact ? 'approved-redacted' : 'approved',
          filePath: result.delivery?.filePath,
          size: result.delivery?.size,
          hash: result.delivery?.hash,
        }),
      };
    }

    default:
      return { handled: false, text: '' };
  }
}

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────

function identityToParticipant(identity: { id: string; name: string; type: string; project?: string; role?: string }): Participant {
  return {
    id: identity.id,
    name: identity.name,
    type: (identity.type as 'agent' | 'human') || 'agent',
    project: identity.project,
    role: identity.role,
  };
}

function formatPollOutput(
  messages: SymphonyMessage[],
  pendingRequests: { request: { requestId: string; filePath: string; reason: string; requester: Participant } }[]
): string {
  const parts: string[] = [];

  // Group messages by thread
  const byThread = new Map<string, SymphonyMessage[]>();
  for (const msg of messages) {
    const threadId = msg.threadRoot || 'direct';
    if (!byThread.has(threadId)) byThread.set(threadId, []);
    byThread.get(threadId)!.push(msg);
  }

  for (const [threadId, threadMsgs] of byThread) {
    let threadTopic = threadId;
    if (threadId !== 'direct') {
      const thread = loadThread(threadId);
      if (thread) threadTopic = thread.topic;
    }

    parts.push(`## Symphony: ${threadMsgs.length} new message${threadMsgs.length !== 1 ? 's' : ''} in "${threadTopic}"\n`);

    for (let i = 0; i < threadMsgs.length; i++) {
      const msg = threadMsgs[i];
      const time = new Date(msg.timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      const senderLabel = `${msg.sender.name}${msg.sender.project ? ` (${msg.sender.project})` : ''}`;

      parts.push(`### ${i + 1}. ${senderLabel} — ${capitalize(msg.intent)} (${time})`);
      parts.push(`> ${msg.content.text.split('\n').join('\n> ')}`);

      if (msg.symbols.length > 0) {
        parts.push(`> Symbols: ${msg.symbols.join(', ')}`);
      }
      if (msg.content.diff) {
        parts.push(`\n\`\`\`diff\n${msg.content.diff}\n\`\`\``);
      }
      if (msg.content.decision) {
        parts.push(`\n**Decision:** ${msg.content.decision}`);
      }

      // Suggest action based on intent
      const action = suggestAction(msg);
      if (action) parts.push(`\n**Suggested action:** ${action}`);

      parts.push('');
    }
  }

  // Show pending file requests
  if (pendingRequests.length > 0) {
    parts.push(`## Pending File Requests (${pendingRequests.length})\n`);
    for (const req of pendingRequests) {
      parts.push(`- **${req.request.filePath}** from ${req.request.requester.name}: ${req.request.reason}`);
      parts.push(`  Approve: \`paradigm_symphony_approve_file({ requestId: "${req.request.requestId}", action: "approve" })\``);
    }
    parts.push('');
  }

  return parts.join('\n');
}

function suggestAction(msg: SymphonyMessage): string | null {
  switch (msg.intent) {
    case 'question':
      return 'Reply with paradigm_symphony_send using intent "context" or "clarification"';
    case 'proposal':
      return 'Reply with intent "approval" or "rejection"';
    case 'fileRequest':
      return 'Use paradigm_symphony_approve_file to approve or deny';
    case 'handoff':
      return 'Review handoff context and continue the work';
    case 'alert':
      return 'Investigate the alert and reply with intent "action"';
    case 'verification':
      return 'Confirm with intent "approval" or clarify with "clarification"';
    default:
      return null;
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
