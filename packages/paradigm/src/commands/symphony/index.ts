/**
 * Symphony CLI Commands — Terminal interface for The Score agent messaging
 *
 * Commands: join, leave, whoami, list, send, read, inbox, threads,
 *          thread, resolve, status, serve, request, requests, approve, deny, watch
 */

import chalk from 'chalk';
import * as path from 'path';
import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import type {
  SymphonySendOptions,
  SymphonyListOptions,
  SymphonyThreadsOptions,
  SymphonyStatusOptions,
  SymphonyResolveOptions,
  SymphonyServeOptions,
  SymphonyRequestOptions,
  SymphonyApproveOptions,
  SymphonyDenyOptions,
  SymphonyJoinOptions,
  SymphonyWatchOptions,
} from './types.js';
import {
  registerAgent,
  unregisterAgent,
  getMyIdentity,
  resolveAgentIdentity,
  listAgents,
  cleanStaleAgents,
  discoverClaudeCodeSessions,
  readInbox,
  acknowledgeMessages,
  garbageCollect,
  buildMessage,
  routeMessage,
  createThread,
  listThreads,
  loadThread,
  getThreadMessages,
  resolveThread,
  isAgentAsleep,
  markAgentPollTime,
  createFileRequest,
  listFileRequests,
  approveFileRequest,
  denyFileRequest,
  isPathDenied,
  loadTrustConfig,
  ensureScoreDirs,
  type SymphonyMessage,
  type Participant,
  type AgentIdentity,
} from '../../../../paradigm-mcp/src/utils/symphony-loader.js';

// ────────────────────────────────────────────────────────
// symphony join (formerly mail link)
// ────────────────────────────────────────────────────────

export async function symphonyJoinCommand(options: SymphonyJoinOptions): Promise<void> {
  const rootDir = process.cwd();

  if (options.remote) {
    console.log(chalk.yellow(`Remote linking to ${options.remote} — not yet implemented in Phase 0.`));
    console.log(chalk.gray('Remote linking will be available in a future Symphony phase.'));
    return;
  }

  // Register this session
  const identity = registerAgent(rootDir);
  console.log(chalk.green(`\u2713 Joined as ${chalk.bold(identity.id)}`));

  // Discover other sessions
  const sessions = discoverClaudeCodeSessions();
  const others = sessions.filter(s => s.id !== identity.id);

  if (others.length > 0) {
    console.log(chalk.cyan(`\n  Found ${others.length} other session${others.length !== 1 ? 's' : ''}:`));
    for (const s of others) {
      const status = isAgentAsleep(s) ? chalk.yellow('asleep') : chalk.green('awake');
      console.log(`    ${chalk.white(s.id)} \u2014 ${s.name} [${status}]`);
    }
  } else {
    console.log(chalk.gray('\n  No other sessions found. Open another terminal and run "paradigm symphony join".'));
  }

  console.log(chalk.gray(`\n  Tip: Set up polling with: /loop 10s paradigm_symphony_poll`));
}

// ────────────────────────────────────────────────────────
// symphony leave (formerly mail unlink)
// ────────────────────────────────────────────────────────

export async function symphonyLeaveCommand(): Promise<void> {
  const rootDir = process.cwd();
  const agentId = resolveAgentIdentity(rootDir);
  const success = unregisterAgent(agentId);

  if (success) {
    console.log(chalk.green(`\u2713 Left the score: ${agentId}`));
  } else {
    console.log(chalk.yellow(`No active part found for this project.`));
  }
}

// ────────────────────────────────────────────────────────
// symphony whoami
// ────────────────────────────────────────────────────────

export async function symphonyWhoamiCommand(): Promise<void> {
  const rootDir = process.cwd();
  const identity = getMyIdentity(rootDir);

  if (!identity) {
    console.log(chalk.yellow('Not joined. Run "paradigm symphony join" first.'));
    return;
  }

  const agents = listAgents();
  const others = agents.filter(a => a.id !== identity.id);
  const threads = listThreads('active');
  const unread = readInbox(identity.id);

  console.log(chalk.cyan(`\n  ${chalk.bold(identity.id)}`));
  console.log(chalk.gray(`  Project: ${identity.project}`));
  console.log(chalk.gray(`  Role: ${identity.role}`));
  console.log(chalk.gray(`  PID: ${identity.pid}`));
  console.log(chalk.gray(`  Started: ${identity.startedAt}`));
  if (identity.statusBlurb) {
    console.log(chalk.white(`  Status: ${identity.statusBlurb}`));
  }
  console.log(`\n  ${chalk.white(`${others.length} linked peer${others.length !== 1 ? 's' : ''}`)} \u2014 ${chalk.white(`${threads.length} active thread${threads.length !== 1 ? 's' : ''}`)} \u2014 ${chalk.white(`${unread.length} unread`)}`);
}

// ────────────────────────────────────────────────────────
// symphony list
// ────────────────────────────────────────────────────────

export async function symphonyListCommand(options: SymphonyListOptions): Promise<void> {
  cleanStaleAgents();
  const agents = listAgents();

  if (options.json) {
    console.log(JSON.stringify(agents, null, 2));
    return;
  }

  if (agents.length === 0) {
    console.log(chalk.yellow('No agents joined. Run "paradigm symphony join" in each terminal.'));
    return;
  }

  console.log(chalk.cyan(`\n  Symphony Agents (${agents.length})\n`));
  console.log(chalk.gray(`  ${'AGENT ID'.padEnd(30)} ${'PROJECT'.padEnd(15)} ${'ROLE'.padEnd(10)} STATUS`));
  console.log(chalk.gray(`  ${'\u2500'.repeat(30)} ${'\u2500'.repeat(15)} ${'\u2500'.repeat(10)} ${'\u2500'.repeat(8)}`));

  for (const agent of agents) {
    const status = isAgentAsleep(agent) ? chalk.yellow('asleep') : chalk.green('awake');
    console.log(`  ${chalk.white(agent.id.padEnd(30))} ${agent.project.padEnd(15)} ${agent.role.padEnd(10)} ${status}`);
    if (agent.statusBlurb) {
      console.log(`  ${chalk.gray(`  \u2514 ${agent.statusBlurb}`)}`);
    }
  }
  console.log();
}

// ────────────────────────────────────────────────────────
// symphony send
// ────────────────────────────────────────────────────────

export async function symphonySendCommand(messageText: string, options: SymphonySendOptions): Promise<void> {
  const rootDir = process.cwd();
  let identity = getMyIdentity(rootDir);

  if (!identity) {
    identity = registerAgent(rootDir);
    console.log(chalk.gray(`Auto-joined as ${identity.id}`));
  }

  const sender: Participant = {
    id: identity.id,
    name: identity.name,
    type: 'human', // CLI notes come from the human
    project: identity.project,
    role: identity.role,
  };

  // Resolve recipient
  let recipients: Participant[] | undefined;
  if (options.to) {
    recipients = [{ id: options.to, name: options.to, type: 'agent' }];
  }

  // Resolve or create thread
  let threadRoot = options.thread;
  if (!threadRoot) {
    const topic = messageText.length > 60 ? messageText.slice(0, 60) + '...' : messageText;
    const thread = createThread(topic, sender);
    threadRoot = thread.id;
  }

  const message = buildMessage({
    sender,
    recipients,
    intent: 'context',
    text: messageText,
    threadRoot,
  });

  const deliveryCount = routeMessage(message);

  console.log(chalk.green(`\u2713 Sent to ${deliveryCount} agent${deliveryCount !== 1 ? 's' : ''}`));
  console.log(chalk.gray(`  Thread: ${threadRoot}`));
  console.log(chalk.gray(`  Note: ${message.id}`));
}

// ────────────────────────────────────────────────────────
// symphony read / inbox
// ────────────────────────────────────────────────────────

export async function symphonyReadCommand(): Promise<void> {
  const rootDir = process.cwd();
  const identity = getMyIdentity(rootDir);

  if (!identity) {
    console.log(chalk.yellow('Not joined. Run "paradigm symphony join" first.'));
    return;
  }

  markAgentPollTime(identity.id);
  const messages = readInbox(identity.id);

  if (messages.length === 0) {
    console.log(chalk.gray('\n  No unread notes.\n'));
    return;
  }

  // Group by thread
  const byThread = new Map<string, SymphonyMessage[]>();
  for (const msg of messages) {
    const tid = msg.threadRoot || 'direct';
    if (!byThread.has(tid)) byThread.set(tid, []);
    byThread.get(tid)!.push(msg);
  }

  console.log(chalk.cyan(`\n  ${messages.length} unread note${messages.length !== 1 ? 's' : ''}\n`));

  for (const [threadId, msgs] of byThread) {
    let threadLabel = threadId;
    if (threadId !== 'direct') {
      const thread = loadThread(threadId);
      if (thread) threadLabel = `${thread.topic} (${threadId})`;
    }

    console.log(chalk.white(`  \u250c\u2500 ${threadLabel}`));

    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i];
      const isLast = i === msgs.length - 1;
      const prefix = isLast ? '  \u2514\u2500' : '  \u251c\u2500';
      const time = new Date(msg.timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

      console.log(`${prefix} ${chalk.cyan(msg.sender.name)} ${chalk.gray(`[${msg.intent}]`)} ${chalk.gray(time)}`);

      const textLines = msg.content.text.split('\n');
      const indent = isLast ? '     ' : '  \u2502  ';
      for (const line of textLines) {
        console.log(`${indent}${line}`);
      }

      if (msg.symbols.length > 0) {
        console.log(`${indent}${chalk.gray(`Symbols: ${msg.symbols.join(', ')}`)}`);
      }
    }
    console.log();
  }

  // Acknowledge
  const lastId = messages[messages.length - 1].id;
  acknowledgeMessages(identity.id, lastId);
  garbageCollect(identity.id);
}

// ────────────────────────────────────────────────────────
// symphony threads
// ────────────────────────────────────────────────────────

export async function symphonyThreadsCommand(options: SymphonyThreadsOptions): Promise<void> {
  const threads = listThreads();

  if (options.json) {
    console.log(JSON.stringify(threads, null, 2));
    return;
  }

  if (threads.length === 0) {
    console.log(chalk.gray('\n  No threads.\n'));
    return;
  }

  console.log(chalk.cyan(`\n  Threads (${threads.length})\n`));
  console.log(chalk.gray(`  ${'ID'.padEnd(14)} ${'TOPIC'.padEnd(35)} ${'MSGS'.padEnd(6)} ${'STATUS'.padEnd(10)} LAST ACTIVITY`));
  console.log(chalk.gray(`  ${'\u2500'.repeat(14)} ${'\u2500'.repeat(35)} ${'\u2500'.repeat(6)} ${'\u2500'.repeat(10)} ${'\u2500'.repeat(20)}`));

  for (const thread of threads) {
    const topic = thread.topic.length > 33 ? thread.topic.slice(0, 33) + '..' : thread.topic;
    const status = thread.status === 'active' ? chalk.green('active') : chalk.gray('resolved');
    const lastAct = new Date(thread.lastActivity).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });

    console.log(`  ${chalk.white(thread.id.padEnd(14))} ${topic.padEnd(35)} ${String(thread.messageCount).padEnd(6)} ${status.padEnd(10)} ${chalk.gray(lastAct)}`);
  }
  console.log();
}

// ────────────────────────────────────────────────────────
// symphony thread <id>
// ────────────────────────────────────────────────────────

export async function symphonyThreadCommand(threadId: string): Promise<void> {
  const thread = loadThread(threadId);

  if (!thread) {
    console.log(chalk.red(`Thread not found: ${threadId}`));
    return;
  }

  const messages = getThreadMessages(threadId);

  console.log(chalk.cyan(`\n  Thread: ${thread.topic}`));
  console.log(chalk.gray(`  ID: ${thread.id} | Status: ${thread.status} | Notes: ${thread.messageCount}`));
  console.log(chalk.gray(`  Participants: ${thread.participants.map(p => p.name).join(', ')}`));

  if (thread.decision) {
    console.log(chalk.green(`  Decision: ${thread.decision}`));
  }

  console.log(chalk.gray(`\n  ${'\u2500'.repeat(60)}\n`));

  for (const msg of messages) {
    const time = new Date(msg.timestamp).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });

    console.log(`  ${chalk.cyan(msg.sender.name)} ${chalk.gray(`[${msg.intent}]`)} ${chalk.gray(time)}`);

    const textLines = msg.content.text.split('\n');
    for (const line of textLines) {
      console.log(`    ${line}`);
    }

    if (msg.symbols.length > 0) {
      console.log(`    ${chalk.gray(`Symbols: ${msg.symbols.join(', ')}`)}`);
    }
    if (msg.content.decision) {
      console.log(`    ${chalk.green(`Decision: ${msg.content.decision}`)}`);
    }
    console.log();
  }
}

// ────────────────────────────────────────────────────────
// symphony resolve <id>
// ────────────────────────────────────────────────────────

export async function symphonyResolveCommand(threadId: string, options: SymphonyResolveOptions): Promise<void> {
  const thread = loadThread(threadId);

  if (!thread) {
    console.log(chalk.red(`Thread not found: ${threadId}`));
    return;
  }

  const success = resolveThread(threadId, options.decision);

  if (success) {
    console.log(chalk.green(`\u2713 Thread resolved: ${thread.topic}`));
    if (options.decision) {
      console.log(chalk.gray(`  Decision: ${options.decision}`));
    }
    console.log(chalk.gray(`  Tip: Record this as lore with "paradigm lore record --title 'Thread: ${thread.topic}'"`));
  } else {
    console.log(chalk.red('Failed to resolve thread.'));
  }
}

// ────────────────────────────────────────────────────────
// symphony status
// ────────────────────────────────────────────────────────

export async function symphonyStatusCommand(options: SymphonyStatusOptions): Promise<void> {
  cleanStaleAgents();

  const rootDir = process.cwd();
  const identity = getMyIdentity(rootDir);
  const agents = listAgents();
  const threads = listThreads('active');
  const pendingRequests = listFileRequests('pending');
  const unread = identity ? readInbox(identity.id) : [];

  if (options.json) {
    console.log(JSON.stringify({
      identity: identity ? { id: identity.id, project: identity.project, role: identity.role } : null,
      agents: agents.map(a => ({ id: a.id, status: isAgentAsleep(a) ? 'asleep' : 'awake', statusBlurb: a.statusBlurb })),
      activeThreads: threads.length,
      unreadMessages: unread.length,
      pendingFileRequests: pendingRequests.length,
    }, null, 2));
    return;
  }

  console.log(chalk.cyan('\n  Symphony Status\n'));

  if (identity) {
    console.log(`  ${chalk.white('Identity:')} ${identity.id}`);
  } else {
    console.log(`  ${chalk.yellow('Not joined.')} Run "paradigm symphony join" to join.`);
  }

  const awake = agents.filter(a => !isAgentAsleep(a)).length;
  console.log(`  ${chalk.white('Agents:')} ${agents.length} joined (${awake} awake)`);

  // Show agent blurbs if any
  for (const a of agents) {
    const st = isAgentAsleep(a) ? chalk.yellow('asleep') : chalk.green('awake');
    const blurb = a.statusBlurb ? chalk.gray(` \u2014 ${a.statusBlurb}`) : '';
    console.log(`    ${chalk.white(a.id)} [${st}]${blurb}`);
  }

  console.log(`  ${chalk.white('Threads:')} ${threads.length} active`);
  console.log(`  ${chalk.white('Unread:')} ${unread.length} note${unread.length !== 1 ? 's' : ''}`);
  console.log(`  ${chalk.white('File Requests:')} ${pendingRequests.length} pending`);
  console.log();
}

// ────────────────────────────────────────────────────────
// symphony serve
// ────────────────────────────────────────────────────────

export async function symphonyServeCommand(options: SymphonyServeOptions): Promise<void> {
  const port = parseInt(options.port || '3939', 10);

  console.log(chalk.cyan(`\n  Starting Symphony TCP server on port ${port}...`));
  console.log(chalk.gray('  Phase 0 stub \u2014 remote linking protocol not yet implemented.\n'));

  const server = net.createServer((socket) => {
    socket.write(JSON.stringify({ type: 'hello', version: '0.1.0' }) + '\n');
    socket.on('data', (data) => {
      try {
        const msg = JSON.parse(data.toString().trim());
        socket.write(JSON.stringify({ type: 'ack', received: msg.type }) + '\n');
      } catch {
        socket.write(JSON.stringify({ type: 'error', message: 'Invalid JSON' }) + '\n');
      }
    });
    socket.on('error', () => {});
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(chalk.green(`  \u2713 Symphony server listening on 0.0.0.0:${port}`));
    console.log(chalk.gray(`  Connect from another machine: paradigm symphony join --remote <this-ip>:${port}`));
  });

  server.on('error', (err) => {
    console.log(chalk.red(`  Failed to start server: ${(err as Error).message}`));
  });

  // Keep alive
  await new Promise(() => {});
}

// ────────────────────────────────────────────────────────
// symphony request
// ────────────────────────────────────────────────────────

export async function symphonyRequestCommand(file: string, options: SymphonyRequestOptions): Promise<void> {
  const rootDir = process.cwd();
  let identity = getMyIdentity(rootDir);

  if (!identity) {
    identity = registerAgent(rootDir);
  }

  const from = options.from;
  const reason = options.reason || 'Needed for current task';

  if (!from) {
    console.log(chalk.red('--from is required. Specify which agent to request from.'));
    const agents = listAgents().filter(a => a.id !== identity!.id);
    if (agents.length > 0) {
      console.log(chalk.gray('\nAvailable agents:'));
      for (const a of agents) {
        console.log(chalk.gray(`  ${a.id}`));
      }
    }
    return;
  }

  // Check hard-deny
  const trust = loadTrustConfig();
  if (isPathDenied(file, trust)) {
    console.log(chalk.red(`\u2717 "${file}" is on the hard-deny list and cannot be requested.`));
    return;
  }

  const record = createFileRequest({
    filePath: file,
    requester: {
      id: identity.id,
      name: identity.name,
      type: 'agent',
      project: identity.project,
      role: identity.role,
    },
    reason,
  });

  // Send notification to target agent
  const msg = buildMessage({
    sender: {
      id: identity.id,
      name: identity.name,
      type: 'agent',
      project: identity.project,
      role: identity.role,
    },
    recipients: [{ id: from, name: from, type: 'agent' }],
    intent: 'fileRequest',
    text: `File request: ${file}\nReason: ${reason}`,
    symbols: [],
  });
  routeMessage(msg);

  console.log(chalk.green(`\u2713 File request created: ${record.request.requestId}`));
  console.log(chalk.gray(`  File: ${file}`));
  console.log(chalk.gray(`  From: ${from}`));
  console.log(chalk.gray(`  Reason: ${reason}`));
  console.log(chalk.gray(`\n  The owning agent's human must approve with:`));
  console.log(chalk.white(`    paradigm symphony approve ${record.request.requestId}`));
}

// ────────────────────────────────────────────────────────
// symphony requests
// ────────────────────────────────────────────────────────

export async function symphonyRequestsCommand(): Promise<void> {
  const requests = listFileRequests('pending');

  if (requests.length === 0) {
    console.log(chalk.gray('\n  No pending file requests.\n'));
    return;
  }

  console.log(chalk.cyan(`\n  Pending File Requests (${requests.length})\n`));

  for (const req of requests) {
    const age = Date.now() - new Date(req.createdAt).getTime();
    const ageMin = Math.round(age / 60000);

    console.log(`  ${chalk.white(req.request.requestId)}`);
    console.log(`    File: ${req.request.filePath}`);
    console.log(`    From: ${req.request.requester.name} (${req.request.requester.id})`);
    console.log(`    Reason: ${req.request.reason}`);
    console.log(chalk.gray(`    ${ageMin}m ago`));
    console.log(chalk.gray(`    \u2192 paradigm symphony approve ${req.request.requestId}`));
    console.log(chalk.gray(`    \u2192 paradigm symphony deny ${req.request.requestId}`));
    console.log();
  }
}

// ────────────────────────────────────────────────────────
// symphony approve
// ────────────────────────────────────────────────────────

export async function symphonyApproveCommand(requestId: string, options: SymphonyApproveOptions): Promise<void> {
  const rootDir = process.cwd();
  const result = approveFileRequest(requestId, rootDir, options.redact);

  if (!result.success) {
    console.log(chalk.red(`\u2717 ${result.error}`));
    return;
  }

  const label = options.redact ? 'approved (redacted)' : 'approved';
  console.log(chalk.green(`\u2713 File request ${label}`));
  console.log(chalk.gray(`  File: ${result.delivery?.filePath}`));
  console.log(chalk.gray(`  Size: ${result.delivery?.size} bytes`));
  console.log(chalk.gray(`  SHA-256: ${result.delivery?.hash?.slice(0, 16)}...`));
}

// ────────────────────────────────────────────────────────
// symphony deny
// ────────────────────────────────────────────────────────

export async function symphonyDenyCommand(requestId: string, options: SymphonyDenyOptions): Promise<void> {
  const success = denyFileRequest(requestId, options.reason);

  if (success) {
    console.log(chalk.green(`\u2713 File request denied: ${requestId}`));
    if (options.reason) {
      console.log(chalk.gray(`  Reason: ${options.reason}`));
    }
  } else {
    console.log(chalk.red(`\u2717 File request not found or already resolved: ${requestId}`));
  }
}

// ────────────────────────────────────────────────────────
// symphony watch — Zero-token real-time inbox monitor
// ────────────────────────────────────────────────────────

const INTENT_COLORS: Record<string, (s: string) => string> = {
  question: chalk.blue,
  context: chalk.gray,
  clarification: chalk.blue,
  proposal: chalk.cyan,
  verification: chalk.blue,
  action: chalk.cyan,
  decision: chalk.yellow,
  alert: chalk.red,
  approval: chalk.green,
  rejection: chalk.red,
  reference: chalk.gray,
  handoff: chalk.magenta,
  fileRequest: chalk.green,
  fileApproved: chalk.green,
  fileDenied: chalk.red,
  fileDelivery: chalk.green,
};

function formatWatchMessage(msg: SymphonyMessage): string {
  const time = new Date(msg.timestamp).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });

  const colorFn = INTENT_COLORS[msg.intent] || chalk.white;
  const intentLabel = colorFn(`[${msg.intent}]`);
  const sender = chalk.cyan(msg.sender.name);
  const threadLabel = msg.threadRoot ? chalk.gray(` (${msg.threadRoot})`) : '';

  const lines: string[] = [];
  lines.push(`  ${chalk.gray(time)} ${sender} ${intentLabel}${threadLabel}`);

  const textLines = msg.content.text.split('\n');
  for (const line of textLines) {
    lines.push(`    ${line}`);
  }

  if (msg.symbols.length > 0) {
    lines.push(`    ${chalk.gray(`Symbols: ${msg.symbols.join(', ')}`)}`);
  }
  if (msg.content.decision) {
    lines.push(`    ${chalk.yellow(`Decision: ${msg.content.decision}`)}`);
  }
  if (msg.content.diff) {
    lines.push(`    ${chalk.gray('[diff attached]')}`);
  }

  return lines.join('\n');
}

export async function symphonyWatchCommand(options: SymphonyWatchOptions): Promise<void> {
  const rootDir = process.cwd();
  let identity = getMyIdentity(rootDir);

  if (!identity) {
    identity = registerAgent(rootDir);
    console.log(chalk.gray(`Auto-joined as ${identity.id}`));
  }

  const intervalMs = parseInt(options.interval || '2000', 10);
  const threadFilter = options.thread;
  const quiet = options.quiet;

  const scoreDir = path.join(os.homedir(), '.paradigm', 'score');
  const inboxPath = path.join(scoreDir, 'agents', ...identity.id.split('/'), 'inbox.jsonl');

  // Track what we've already seen
  let lastLineCount = 0;
  let lastSize = 0;

  // Initialize: count existing lines so we only show NEW messages
  if (fs.existsSync(inboxPath)) {
    const content = fs.readFileSync(inboxPath, 'utf-8');
    lastLineCount = content.split('\n').filter(l => l.trim().length > 0).length;
    lastSize = fs.statSync(inboxPath).size;
  }

  if (!quiet) {
    console.log(chalk.cyan('\n  Symphony Watch'));
    console.log(chalk.gray(`  Agent: ${identity.id}`));
    console.log(chalk.gray(`  Inbox: ${inboxPath}`));
    console.log(chalk.gray(`  Poll: ${intervalMs}ms`));
    if (threadFilter) {
      console.log(chalk.gray(`  Filter: thread ${threadFilter}`));
    }
    console.log(chalk.gray(`  Press Ctrl+C to stop\n`));
    console.log(chalk.gray(`  ${'─'.repeat(60)}\n`));
  }

  // Also watch threads for new activity
  const threadsDir = path.join(scoreDir, 'threads');
  let knownThreads = new Set<string>();
  if (fs.existsSync(threadsDir)) {
    for (const f of fs.readdirSync(threadsDir)) {
      knownThreads.add(f);
    }
  }

  // Poll loop
  const poll = () => {
    try {
      // Check inbox for new messages
      if (fs.existsSync(inboxPath)) {
        const stat = fs.statSync(inboxPath);

        if (stat.size > lastSize) {
          const content = fs.readFileSync(inboxPath, 'utf-8');
          const lines = content.split('\n').filter(l => l.trim().length > 0);

          if (lines.length > lastLineCount) {
            const newLines = lines.slice(lastLineCount);

            for (const line of newLines) {
              try {
                const msg = JSON.parse(line) as SymphonyMessage;

                // Apply thread filter
                if (threadFilter && msg.threadRoot !== threadFilter) continue;

                console.log(formatWatchMessage(msg));
                console.log();
              } catch {
                // Skip malformed
              }
            }

            lastLineCount = lines.length;
          }

          lastSize = stat.size;
        }
      }

      // Check for new threads
      if (fs.existsSync(threadsDir)) {
        const currentFiles = fs.readdirSync(threadsDir);
        for (const f of currentFiles) {
          if (!knownThreads.has(f)) {
            knownThreads.add(f);
            try {
              const threadData = JSON.parse(
                fs.readFileSync(path.join(threadsDir, f), 'utf-8')
              );
              if (!quiet) {
                console.log(`  ${chalk.green('+')} ${chalk.white('New thread:')} ${threadData.topic || threadData.id}`);
                console.log(`    ${chalk.gray(`by ${threadData.initiator?.name || 'unknown'} — ${threadData.id}`)}`);
                console.log();
              }
            } catch {
              // Skip
            }
          }
        }
      }

      // Update heartbeat so we show as awake
      markAgentPollTime(identity!.id);
    } catch {
      // Best-effort — don't crash the watcher
    }
  };

  // Initial poll
  poll();

  // Set up interval
  const timer = setInterval(poll, intervalMs);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    clearInterval(timer);
    if (!quiet) {
      console.log(chalk.gray('\n  Watch stopped.\n'));
    }
    process.exit(0);
  });

  // Keep alive
  await new Promise(() => {});
}
