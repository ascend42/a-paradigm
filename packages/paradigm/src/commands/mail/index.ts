/**
 * Mail CLI Commands — Terminal interface for A-Mail agent messaging
 *
 * Commands: link, unlink, whoami, list, send, read, inbox, threads,
 *          thread, resolve, status, serve, request, requests, approve, deny
 */

import chalk from 'chalk';
import * as path from 'path';
import * as net from 'net';
import type {
  MailSendOptions,
  MailListOptions,
  MailThreadsOptions,
  MailStatusOptions,
  MailResolveOptions,
  MailServeOptions,
  MailRequestOptions,
  MailApproveOptions,
  MailDenyOptions,
  MailLinkOptions,
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
  ensureMailDirs,
  type SymphonyMessage,
  type Participant,
  type AgentIdentity,
} from '../../../../paradigm-mcp/src/utils/symphony-loader.js';

// ────────────────────────────────────────────────────────
// mail link
// ────────────────────────────────────────────────────────

export async function mailLinkCommand(options: MailLinkOptions): Promise<void> {
  const rootDir = process.cwd();

  if (options.remote) {
    console.log(chalk.yellow(`Remote linking to ${options.remote} — not yet implemented in Phase 0.`));
    console.log(chalk.gray('Remote linking will be available in a future Symphony phase.'));
    return;
  }

  // Register this session
  const identity = registerAgent(rootDir);
  console.log(chalk.green(`✓ Linked as ${chalk.bold(identity.id)}`));

  // Discover other sessions
  const sessions = discoverClaudeCodeSessions();
  const others = sessions.filter(s => s.id !== identity.id);

  if (others.length > 0) {
    console.log(chalk.cyan(`\n  Found ${others.length} other session${others.length !== 1 ? 's' : ''}:`));
    for (const s of others) {
      const status = isAgentAsleep(s) ? chalk.yellow('asleep') : chalk.green('awake');
      console.log(`    ${chalk.white(s.id)} — ${s.name} [${status}]`);
    }
  } else {
    console.log(chalk.gray('\n  No other sessions found. Open another terminal and run "paradigm mail link".'));
  }

  console.log(chalk.gray(`\n  Tip: Set up polling with: /loop 10s paradigm_symphony_poll`));
}

// ────────────────────────────────────────────────────────
// mail unlink
// ────────────────────────────────────────────────────────

export async function mailUnlinkCommand(): Promise<void> {
  const rootDir = process.cwd();
  const agentId = resolveAgentIdentity(rootDir);
  const success = unregisterAgent(agentId);

  if (success) {
    console.log(chalk.green(`✓ Unlinked ${agentId}`));
  } else {
    console.log(chalk.yellow(`No active link found for this project.`));
  }
}

// ────────────────────────────────────────────────────────
// mail whoami
// ────────────────────────────────────────────────────────

export async function mailWhoamiCommand(): Promise<void> {
  const rootDir = process.cwd();
  const identity = getMyIdentity(rootDir);

  if (!identity) {
    console.log(chalk.yellow('Not linked. Run "paradigm mail link" first.'));
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
  console.log(`\n  ${chalk.white(`${others.length} linked peer${others.length !== 1 ? 's' : ''}`)} — ${chalk.white(`${threads.length} active thread${threads.length !== 1 ? 's' : ''}`)} — ${chalk.white(`${unread.length} unread`)}`);
}

// ────────────────────────────────────────────────────────
// mail list
// ────────────────────────────────────────────────────────

export async function mailListCommand(options: MailListOptions): Promise<void> {
  cleanStaleAgents();
  const agents = listAgents();

  if (options.json) {
    console.log(JSON.stringify(agents, null, 2));
    return;
  }

  if (agents.length === 0) {
    console.log(chalk.yellow('No agents linked. Run "paradigm mail link" in each terminal.'));
    return;
  }

  console.log(chalk.cyan(`\n  A-Mail Agents (${agents.length})\n`));
  console.log(chalk.gray(`  ${'AGENT ID'.padEnd(30)} ${'PROJECT'.padEnd(15)} ${'ROLE'.padEnd(10)} STATUS`));
  console.log(chalk.gray(`  ${'─'.repeat(30)} ${'─'.repeat(15)} ${'─'.repeat(10)} ${'─'.repeat(8)}`));

  for (const agent of agents) {
    const status = isAgentAsleep(agent) ? chalk.yellow('asleep') : chalk.green('awake');
    console.log(`  ${chalk.white(agent.id.padEnd(30))} ${agent.project.padEnd(15)} ${agent.role.padEnd(10)} ${status}`);
  }
  console.log();
}

// ────────────────────────────────────────────────────────
// mail send
// ────────────────────────────────────────────────────────

export async function mailSendCommand(messageText: string, options: MailSendOptions): Promise<void> {
  const rootDir = process.cwd();
  let identity = getMyIdentity(rootDir);

  if (!identity) {
    identity = registerAgent(rootDir);
    console.log(chalk.gray(`Auto-linked as ${identity.id}`));
  }

  const sender: Participant = {
    id: identity.id,
    name: identity.name,
    type: 'human', // CLI messages come from the human
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

  console.log(chalk.green(`✓ Sent to ${deliveryCount} agent${deliveryCount !== 1 ? 's' : ''}`));
  console.log(chalk.gray(`  Thread: ${threadRoot}`));
  console.log(chalk.gray(`  Message: ${message.id}`));
}

// ────────────────────────────────────────────────────────
// mail read / inbox
// ────────────────────────────────────────────────────────

export async function mailReadCommand(): Promise<void> {
  const rootDir = process.cwd();
  const identity = getMyIdentity(rootDir);

  if (!identity) {
    console.log(chalk.yellow('Not linked. Run "paradigm mail link" first.'));
    return;
  }

  markAgentPollTime(identity.id);
  const messages = readInbox(identity.id);

  if (messages.length === 0) {
    console.log(chalk.gray('\n  No unread messages.\n'));
    return;
  }

  // Group by thread
  const byThread = new Map<string, SymphonyMessage[]>();
  for (const msg of messages) {
    const tid = msg.threadRoot || 'direct';
    if (!byThread.has(tid)) byThread.set(tid, []);
    byThread.get(tid)!.push(msg);
  }

  console.log(chalk.cyan(`\n  ${messages.length} unread message${messages.length !== 1 ? 's' : ''}\n`));

  for (const [threadId, msgs] of byThread) {
    let threadLabel = threadId;
    if (threadId !== 'direct') {
      const thread = loadThread(threadId);
      if (thread) threadLabel = `${thread.topic} (${threadId})`;
    }

    console.log(chalk.white(`  ┌─ ${threadLabel}`));

    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i];
      const isLast = i === msgs.length - 1;
      const prefix = isLast ? '  └─' : '  ├─';
      const time = new Date(msg.timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

      console.log(`${prefix} ${chalk.cyan(msg.sender.name)} ${chalk.gray(`[${msg.intent}]`)} ${chalk.gray(time)}`);

      const textLines = msg.content.text.split('\n');
      const indent = isLast ? '     ' : '  │  ';
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
// mail threads
// ────────────────────────────────────────────────────────

export async function mailThreadsCommand(options: MailThreadsOptions): Promise<void> {
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
  console.log(chalk.gray(`  ${'─'.repeat(14)} ${'─'.repeat(35)} ${'─'.repeat(6)} ${'─'.repeat(10)} ${'─'.repeat(20)}`));

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
// mail thread <id>
// ────────────────────────────────────────────────────────

export async function mailThreadCommand(threadId: string): Promise<void> {
  const thread = loadThread(threadId);

  if (!thread) {
    console.log(chalk.red(`Thread not found: ${threadId}`));
    return;
  }

  const messages = getThreadMessages(threadId);

  console.log(chalk.cyan(`\n  Thread: ${thread.topic}`));
  console.log(chalk.gray(`  ID: ${thread.id} | Status: ${thread.status} | Messages: ${thread.messageCount}`));
  console.log(chalk.gray(`  Participants: ${thread.participants.map(p => p.name).join(', ')}`));

  if (thread.decision) {
    console.log(chalk.green(`  Decision: ${thread.decision}`));
  }

  console.log(chalk.gray(`\n  ${'─'.repeat(60)}\n`));

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
// mail resolve <id>
// ────────────────────────────────────────────────────────

export async function mailResolveCommand(threadId: string, options: MailResolveOptions): Promise<void> {
  const thread = loadThread(threadId);

  if (!thread) {
    console.log(chalk.red(`Thread not found: ${threadId}`));
    return;
  }

  const success = resolveThread(threadId, options.decision);

  if (success) {
    console.log(chalk.green(`✓ Thread resolved: ${thread.topic}`));
    if (options.decision) {
      console.log(chalk.gray(`  Decision: ${options.decision}`));
    }
    console.log(chalk.gray(`  Tip: Record this as lore with "paradigm lore record --title 'Thread: ${thread.topic}'"`));
  } else {
    console.log(chalk.red('Failed to resolve thread.'));
  }
}

// ────────────────────────────────────────────────────────
// mail status
// ────────────────────────────────────────────────────────

export async function mailStatusCommand(options: MailStatusOptions): Promise<void> {
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
      agents: agents.map(a => ({ id: a.id, status: isAgentAsleep(a) ? 'asleep' : 'awake' })),
      activeThreads: threads.length,
      unreadMessages: unread.length,
      pendingFileRequests: pendingRequests.length,
    }, null, 2));
    return;
  }

  console.log(chalk.cyan('\n  A-Mail Status\n'));

  if (identity) {
    console.log(`  ${chalk.white('Identity:')} ${identity.id}`);
  } else {
    console.log(`  ${chalk.yellow('Not linked.')} Run "paradigm mail link" to join.`);
  }

  const awake = agents.filter(a => !isAgentAsleep(a)).length;
  console.log(`  ${chalk.white('Agents:')} ${agents.length} linked (${awake} awake)`);
  console.log(`  ${chalk.white('Threads:')} ${threads.length} active`);
  console.log(`  ${chalk.white('Unread:')} ${unread.length} message${unread.length !== 1 ? 's' : ''}`);
  console.log(`  ${chalk.white('File Requests:')} ${pendingRequests.length} pending`);
  console.log();
}

// ────────────────────────────────────────────────────────
// mail serve
// ────────────────────────────────────────────────────────

export async function mailServeCommand(options: MailServeOptions): Promise<void> {
  const port = parseInt(options.port || '3939', 10);

  console.log(chalk.cyan(`\n  Starting A-Mail TCP server on port ${port}...`));
  console.log(chalk.gray('  Phase 0 stub — remote linking protocol not yet implemented.\n'));

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
    console.log(chalk.green(`  ✓ Mail server listening on 0.0.0.0:${port}`));
    console.log(chalk.gray(`  Connect from another machine: paradigm mail link --remote <this-ip>:${port}`));
  });

  server.on('error', (err) => {
    console.log(chalk.red(`  Failed to start server: ${(err as Error).message}`));
  });

  // Keep alive
  await new Promise(() => {});
}

// ────────────────────────────────────────────────────────
// mail request
// ────────────────────────────────────────────────────────

export async function mailRequestCommand(file: string, options: MailRequestOptions): Promise<void> {
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
    console.log(chalk.red(`✗ "${file}" is on the hard-deny list and cannot be requested.`));
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

  console.log(chalk.green(`✓ File request created: ${record.request.requestId}`));
  console.log(chalk.gray(`  File: ${file}`));
  console.log(chalk.gray(`  From: ${from}`));
  console.log(chalk.gray(`  Reason: ${reason}`));
  console.log(chalk.gray(`\n  The owning agent's human must approve with:`));
  console.log(chalk.white(`    paradigm mail approve ${record.request.requestId}`));
}

// ────────────────────────────────────────────────────────
// mail requests
// ────────────────────────────────────────────────────────

export async function mailRequestsCommand(): Promise<void> {
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
    console.log(chalk.gray(`    → paradigm mail approve ${req.request.requestId}`));
    console.log(chalk.gray(`    → paradigm mail deny ${req.request.requestId}`));
    console.log();
  }
}

// ────────────────────────────────────────────────────────
// mail approve
// ────────────────────────────────────────────────────────

export async function mailApproveCommand(requestId: string, options: MailApproveOptions): Promise<void> {
  const rootDir = process.cwd();
  const result = approveFileRequest(requestId, rootDir, options.redact);

  if (!result.success) {
    console.log(chalk.red(`✗ ${result.error}`));
    return;
  }

  const label = options.redact ? 'approved (redacted)' : 'approved';
  console.log(chalk.green(`✓ File request ${label}`));
  console.log(chalk.gray(`  File: ${result.delivery?.filePath}`));
  console.log(chalk.gray(`  Size: ${result.delivery?.size} bytes`));
  console.log(chalk.gray(`  SHA-256: ${result.delivery?.hash?.slice(0, 16)}...`));
}

// ────────────────────────────────────────────────────────
// mail deny
// ────────────────────────────────────────────────────────

export async function mailDenyCommand(requestId: string, options: MailDenyOptions): Promise<void> {
  const success = denyFileRequest(requestId, options.reason);

  if (success) {
    console.log(chalk.green(`✓ File request denied: ${requestId}`));
    if (options.reason) {
      console.log(chalk.gray(`  Reason: ${options.reason}`));
    }
  } else {
    console.log(chalk.red(`✗ File request not found or already resolved: ${requestId}`));
  }
}
