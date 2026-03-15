/**
 * Symphony Loader — The Score: file-based agent messaging
 *
 * Manages ~/.paradigm/score/ directory for inter-agent communication.
 * No server dependency — uses JSONL files polled by /loop.
 *
 * Storage layout:
 *   ~/.paradigm/score/
 *     agents/{agentId}/
 *       inbox.jsonl      — Notes waiting for this agent
 *       outbox.jsonl     — Notes sent by this agent
 *       ack.json         — Last acknowledged note ID
 *       identity.json    — Agent identity (project, role, PID)
 *     threads/{threadId}.json  — Thread metadata
 *     file-requests/{requestId}.json — Pending file transfer requests
 *     trust.yaml        — File transfer trust configuration
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

// ────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────

export type ParticipantType = 'agent' | 'human';

export interface Participant {
  id: string;
  name: string;
  type: ParticipantType;
  project?: string;
  role?: string;
}

export type MessageIntent =
  | 'question'
  | 'context'
  | 'clarification'
  | 'proposal'
  | 'verification'
  | 'action'
  | 'decision'
  | 'alert'
  | 'approval'
  | 'rejection'
  | 'reference'
  | 'handoff'
  | 'fileRequest'
  | 'fileApproved'
  | 'fileDenied'
  | 'fileDelivery';

export interface MessageContent {
  text: string;
  diff?: string;
  decision?: string;
}

export interface Attachment {
  name: string;
  type: string;
  content: string;
  encoding?: 'utf8' | 'base64';
}

export interface MessageMetadata {
  toolCall?: string;
  symbols?: string[];
  confidence?: number;
}

export interface SymphonyMessage {
  id: string;
  parentId?: string;
  threadRoot?: string;
  timestamp: string;
  sender: Participant;
  recipients?: Participant[];
  intent: MessageIntent;
  content: MessageContent;
  symbols: string[];
  attachments?: Attachment[];
  metadata?: MessageMetadata;
}

export type FileUrgency = 'normal' | 'urgent';
export type FileEncoding = 'utf8' | 'base64';

export interface FileRequest {
  requestId: string;
  filePath: string;
  reason: string;
  requester: Participant;
  urgency: FileUrgency;
  snippet?: string;
  threadRoot?: string;
}

export interface FileDelivery {
  requestId: string;
  filePath: string;
  content: string;
  encoding: FileEncoding;
  size: number;
  hash: string;
}

export interface FileRequestRecord {
  request: FileRequest;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  denyReason?: string;
  delivery?: FileDelivery;
}

export interface AgentIdentity {
  id: string;
  name: string;
  type: ParticipantType;
  project: string;
  role: string;
  pid: number;
  startedAt: string;
  lastPoll?: string;
  label?: string;
  statusBlurb?: string;
}

export interface ThreadMeta {
  id: string;
  topic: string;
  initiator: Participant;
  participants: Participant[];
  status: 'active' | 'resolved';
  createdAt: string;
  lastActivity: string;
  messageCount: number;
  decision?: string;
  resolvedAt?: string;
}

export interface TrustEntry {
  level: 'teammate' | 'restricted' | 'blocked';
  autoApprove: string[];
  neverApprove: string[];
}

export interface TrustConfig {
  users: Record<string, TrustEntry>;
  defaults: TrustEntry;
}

// ────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────

const SCORE_DIR = path.join(os.homedir(), '.paradigm', 'score');
const LEGACY_MAIL_DIR = path.join(os.homedir(), '.paradigm', 'mail');
const AGENTS_DIR = path.join(SCORE_DIR, 'agents');
const THREADS_DIR = path.join(SCORE_DIR, 'threads');
const FILE_REQUESTS_DIR = path.join(SCORE_DIR, 'file-requests');
const TRUST_CONFIG_PATH = path.join(SCORE_DIR, 'trust.yaml');

const FILE_REQUEST_TTL_MS = 60 * 60 * 1000; // 1 hour

const DEFAULT_TRUST: TrustConfig = {
  users: {},
  defaults: {
    level: 'restricted',
    autoApprove: [],
    neverApprove: [
      '.env*',
      '**/*.key',
      '**/*.pem',
      '**/credentials*',
      '**/secrets/**',
    ],
  },
};

// ────────────────────────────────────────────────────────
// Directory Management
// ────────────────────────────────────────────────────────

/**
 * Auto-migrate from legacy ~/.paradigm/mail/ to ~/.paradigm/score/
 */
function migrateFromLegacyMail(): void {
  if (fs.existsSync(LEGACY_MAIL_DIR) && !fs.existsSync(SCORE_DIR)) {
    try {
      fs.renameSync(LEGACY_MAIL_DIR, SCORE_DIR);
    } catch {
      // If rename fails (cross-device), just create fresh
    }
  }
}

export function ensureScoreDirs(): void {
  migrateFromLegacyMail();
  for (const dir of [AGENTS_DIR, THREADS_DIR, FILE_REQUESTS_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

/** @deprecated Use ensureScoreDirs() */
export const ensureMailDirs = ensureScoreDirs;

export function getAgentDir(agentId: string): string {
  return path.join(AGENTS_DIR, agentId);
}

function ensureAgentDir(agentId: string): string {
  const dir = getAgentDir(agentId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// ────────────────────────────────────────────────────────
// JSONL Helpers
// ────────────────────────────────────────────────────────

export function readJsonlFile<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim().length > 0);
  const items: T[] = [];

  for (const line of lines) {
    try {
      items.push(JSON.parse(line) as T);
    } catch {
      // Skip malformed lines
    }
  }

  return items;
}

export function appendJsonlLine<T>(filePath: string, item: T): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.appendFileSync(filePath, JSON.stringify(item) + '\n', 'utf-8');
}

// ────────────────────────────────────────────────────────
// Agent Identity
// ────────────────────────────────────────────────────────

function sanitizeId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'unknown';
}

function resolveProjectName(projectDir: string): string {
  // Try config.yaml first
  try {
    const configPath = path.join(projectDir, '.paradigm', 'config.yaml');
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      const match = content.match(/^project:\s*(.+)$/m);
      if (match) return sanitizeId(match[1].trim().replace(/["']/g, ''));
    }
  } catch {}

  // Fall back to directory name
  return sanitizeId(path.basename(projectDir));
}

export function resolveAgentIdentity(projectDir: string, role?: string): string {
  const project = resolveProjectName(projectDir);
  const agentRole = role || 'core';
  return `${project}/${agentRole}`;
}

export function registerAgent(
  projectDir: string,
  role?: string,
  label?: string
): AgentIdentity {
  ensureScoreDirs();

  const agentId = resolveAgentIdentity(projectDir, role);
  const agentDir = ensureAgentDir(agentId);
  const project = resolveProjectName(projectDir);

  const identity: AgentIdentity = {
    id: agentId,
    name: label || `${project} (${role || 'core'})`,
    type: 'agent',
    project,
    role: role || 'core',
    pid: process.pid,
    startedAt: new Date().toISOString(),
    label,
  };

  fs.writeFileSync(
    path.join(agentDir, 'identity.json'),
    JSON.stringify(identity, null, 2),
    'utf-8'
  );

  return identity;
}

export function unregisterAgent(agentId: string): boolean {
  const agentDir = getAgentDir(agentId);
  if (!fs.existsSync(agentDir)) return false;

  try {
    fs.rmSync(agentDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

export function listAgents(): AgentIdentity[] {
  ensureScoreDirs();

  if (!fs.existsSync(AGENTS_DIR)) return [];

  const agents: AgentIdentity[] = [];

  // Agents use {project}/{role} as ID, so we need to scan nested dirs
  const projectDirs = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory());

  for (const projectDir of projectDirs) {
    const projectPath = path.join(AGENTS_DIR, projectDir.name);
    const roleDirs = fs.readdirSync(projectPath, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const roleDir of roleDirs) {
      const identityPath = path.join(projectPath, roleDir.name, 'identity.json');
      if (!fs.existsSync(identityPath)) continue;

      try {
        const content = fs.readFileSync(identityPath, 'utf-8');
        const identity = JSON.parse(content) as AgentIdentity;
        agents.push(identity);
      } catch {
        // Skip corrupted
      }
    }
  }

  return agents;
}

export function cleanStaleAgents(): number {
  const agents = listAgents();
  let cleaned = 0;

  for (const agent of agents) {
    if (!isProcessAlive(agent.pid)) {
      unregisterAgent(agent.id);
      cleaned++;
    }
  }

  return cleaned;
}

export function getMyIdentity(projectDir: string): AgentIdentity | null {
  const agentId = resolveAgentIdentity(projectDir);
  const identityPath = path.join(getAgentDir(agentId), 'identity.json');

  if (!fs.existsSync(identityPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(identityPath, 'utf-8')) as AgentIdentity;
  } catch {
    return null;
  }
}

export function markAgentPollTime(agentId: string, statusBlurb?: string): void {
  const identityPath = path.join(getAgentDir(agentId), 'identity.json');
  if (!fs.existsSync(identityPath)) return;

  try {
    const identity = JSON.parse(fs.readFileSync(identityPath, 'utf-8')) as AgentIdentity;
    identity.lastPoll = new Date().toISOString();
    if (statusBlurb !== undefined) {
      identity.statusBlurb = statusBlurb || undefined;
    }
    fs.writeFileSync(identityPath, JSON.stringify(identity, null, 2), 'utf-8');
  } catch {
    // Best-effort
  }
}

export function updateAgentStatus(agentId: string, statusBlurb: string): void {
  const identityPath = path.join(getAgentDir(agentId), 'identity.json');
  if (!fs.existsSync(identityPath)) return;

  try {
    const identity = JSON.parse(fs.readFileSync(identityPath, 'utf-8')) as AgentIdentity;
    identity.statusBlurb = statusBlurb || undefined;
    fs.writeFileSync(identityPath, JSON.stringify(identity, null, 2), 'utf-8');
  } catch {
    // Best-effort
  }
}

export function isAgentAsleep(identity: AgentIdentity, thresholdMs: number = 60000): boolean {
  if (!identity.lastPoll) return true;

  const lastPoll = new Date(identity.lastPoll).getTime();
  return Date.now() - lastPoll > thresholdMs;
}

export function discoverClaudeCodeSessions(): AgentIdentity[] {
  const agents = listAgents();
  const alive = agents.filter(a => isProcessAlive(a.pid));

  // Also check Conductor sessions
  try {
    const conductorSessionsDir = path.join(os.homedir(), '.conductor', 'sessions');
    if (fs.existsSync(conductorSessionsDir)) {
      const files = fs.readdirSync(conductorSessionsDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(conductorSessionsDir, file), 'utf-8');
          const session = JSON.parse(content);
          const pid = parseInt(path.basename(file, '.json'), 10);

          // Check if this session is already registered as a score agent
          if (!alive.some(a => a.pid === pid) && isProcessAlive(pid)) {
            alive.push({
              id: `conductor/${pid}`,
              name: session.label || `Session ${pid}`,
              type: 'agent',
              project: session.projectDir ? path.basename(session.projectDir) : 'unknown',
              role: 'conductor',
              pid,
              startedAt: session.registeredAt || new Date().toISOString(),
            });
          }
        } catch {
          // Skip corrupted
        }
      }
    }
  } catch {
    // Conductor not installed — fine
  }

  return alive;
}

// ────────────────────────────────────────────────────────
// Part I/O (each agent's part of the score)
// ────────────────────────────────────────────────────────

function inboxPath(agentId: string): string {
  return path.join(getAgentDir(agentId), 'inbox.jsonl');
}

function outboxPath(agentId: string): string {
  return path.join(getAgentDir(agentId), 'outbox.jsonl');
}

function ackPath(agentId: string): string {
  return path.join(getAgentDir(agentId), 'ack.json');
}

/**
 * Ultra-cheap inbox check — fs.stat only, no parsing.
 * Compares current inbox size to last-ack'd position.
 * Returns { hasNew, inboxSize } without reading any message content.
 */
export function peekInbox(agentId: string): { hasNew: boolean; inboxSize: number } {
  const filePath = inboxPath(agentId);
  if (!fs.existsSync(filePath)) return { hasNew: false, inboxSize: 0 };

  const stat = fs.statSync(filePath);
  const inboxSize = stat.size;

  // Compare to ack — if ack exists and inbox has content after it, there's new stuff
  const ack = readAck(agentId);
  if (!ack) {
    // No ack means everything is unread
    return { hasNew: inboxSize > 0, inboxSize };
  }

  // Quick check: read just enough to find the ack position
  // If inbox size hasn't changed since last full poll, nothing new
  const ackSizePath = path.join(getAgentDir(agentId), 'ack-size.json');
  if (fs.existsSync(ackSizePath)) {
    try {
      const ackSize = JSON.parse(fs.readFileSync(ackSizePath, 'utf-8'));
      return { hasNew: inboxSize > (ackSize.size || 0), inboxSize };
    } catch {
      // Fall through
    }
  }

  // No ack-size tracking yet — do a line count comparison (still cheap)
  return { hasNew: inboxSize > 0, inboxSize };
}

/**
 * Record the inbox size at time of acknowledgement.
 * Called alongside acknowledgeMessages for peek tracking.
 */
export function recordAckSize(agentId: string): void {
  const filePath = inboxPath(agentId);
  const ackSizePath = path.join(getAgentDir(agentId), 'ack-size.json');
  try {
    const size = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
    ensureAgentDir(agentId);
    fs.writeFileSync(ackSizePath, JSON.stringify({ size }), 'utf-8');
  } catch {
    // Best-effort
  }
}

export function appendToInbox(agentId: string, message: SymphonyMessage): void {
  ensureAgentDir(agentId);
  appendJsonlLine(inboxPath(agentId), message);
}

export function readInbox(agentId: string, afterAck?: string): SymphonyMessage[] {
  const messages = readJsonlFile<SymphonyMessage>(inboxPath(agentId));

  if (!afterAck) {
    // Check ack file
    const ack = readAck(agentId);
    if (ack) {
      const ackIndex = messages.findIndex(m => m.id === ack);
      if (ackIndex >= 0) return messages.slice(ackIndex + 1);
    }
    return messages;
  }

  const ackIndex = messages.findIndex(m => m.id === afterAck);
  if (ackIndex >= 0) return messages.slice(ackIndex + 1);
  return messages;
}

export function appendToOutbox(agentId: string, message: SymphonyMessage): void {
  ensureAgentDir(agentId);
  appendJsonlLine(outboxPath(agentId), message);
}

export function readOutbox(agentId: string): SymphonyMessage[] {
  return readJsonlFile<SymphonyMessage>(outboxPath(agentId));
}

export function acknowledgeMessages(agentId: string, lastMessageId: string): void {
  const filePath = ackPath(agentId);
  ensureAgentDir(agentId);
  fs.writeFileSync(filePath, JSON.stringify({ lastAck: lastMessageId }), 'utf-8');
}

export function readAck(agentId: string): string | null {
  const filePath = ackPath(agentId);
  if (!fs.existsSync(filePath)) return null;

  try {
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return content.lastAck || null;
  } catch {
    return null;
  }
}

export function garbageCollect(agentId: string): number {
  const ack = readAck(agentId);
  if (!ack) return 0;

  const filePath = inboxPath(agentId);
  const messages = readJsonlFile<SymphonyMessage>(filePath);
  const ackIndex = messages.findIndex(m => m.id === ack);

  if (ackIndex < 0) return 0;

  // Keep only unacknowledged messages
  const kept = messages.slice(ackIndex + 1);
  const removed = messages.length - kept.length;

  // Rewrite file
  if (kept.length === 0) {
    if (fs.existsSync(filePath)) fs.writeFileSync(filePath, '', 'utf-8');
  } else {
    fs.writeFileSync(filePath, kept.map(m => JSON.stringify(m)).join('\n') + '\n', 'utf-8');
  }

  return removed;
}

// ────────────────────────────────────────────────────────
// Thread Management
// ────────────────────────────────────────────────────────

function threadPath(threadId: string): string {
  return path.join(THREADS_DIR, `${threadId}.json`);
}

export function createThread(topic: string, initiator: Participant): ThreadMeta {
  ensureScoreDirs();

  const id = 'thr-' + crypto.randomBytes(4).toString('hex');
  const now = new Date().toISOString();

  const thread: ThreadMeta = {
    id,
    topic,
    initiator,
    participants: [initiator],
    status: 'active',
    createdAt: now,
    lastActivity: now,
    messageCount: 0,
  };

  fs.writeFileSync(threadPath(id), JSON.stringify(thread, null, 2), 'utf-8');
  return thread;
}

export function loadThread(threadId: string): ThreadMeta | null {
  const filePath = threadPath(threadId);
  if (!fs.existsSync(filePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ThreadMeta;
  } catch {
    return null;
  }
}

export function listThreads(status?: 'active' | 'resolved'): ThreadMeta[] {
  ensureScoreDirs();

  if (!fs.existsSync(THREADS_DIR)) return [];

  const files = fs.readdirSync(THREADS_DIR).filter(f => f.endsWith('.json'));
  const threads: ThreadMeta[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(THREADS_DIR, file), 'utf-8');
      const thread = JSON.parse(content) as ThreadMeta;
      if (!status || thread.status === status) {
        threads.push(thread);
      }
    } catch {
      // Skip corrupted
    }
  }

  return threads.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}

export function updateThread(threadId: string, partial: Partial<ThreadMeta>): boolean {
  const thread = loadThread(threadId);
  if (!thread) return false;

  const updated = { ...thread, ...partial };
  fs.writeFileSync(threadPath(threadId), JSON.stringify(updated, null, 2), 'utf-8');
  return true;
}

export function resolveThread(threadId: string, decision?: string): boolean {
  return updateThread(threadId, {
    status: 'resolved',
    resolvedAt: new Date().toISOString(),
    decision,
  });
}

export function getThreadMessages(threadId: string): SymphonyMessage[] {
  const agents = listAgents();
  const messages: SymphonyMessage[] = [];

  for (const agent of agents) {
    // Check both inbox and outbox
    const inbox = readJsonlFile<SymphonyMessage>(inboxPath(agent.id));
    const outbox = readJsonlFile<SymphonyMessage>(outboxPath(agent.id));

    for (const msg of [...inbox, ...outbox]) {
      if (msg.threadRoot === threadId || msg.id === threadId) {
        // Deduplicate by message ID
        if (!messages.some(m => m.id === msg.id)) {
          messages.push(msg);
        }
      }
    }
  }

  return messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

// ────────────────────────────────────────────────────────
// Message Construction + Routing
// ────────────────────────────────────────────────────────

export interface BuildMessageParams {
  sender: Participant;
  recipients?: Participant[];
  intent: MessageIntent;
  text: string;
  parentId?: string;
  threadRoot?: string;
  symbols?: string[];
  diff?: string;
  decision?: string;
  attachments?: Attachment[];
  metadata?: MessageMetadata;
}

export function buildMessage(params: BuildMessageParams): SymphonyMessage {
  return {
    id: crypto.randomUUID(),
    parentId: params.parentId,
    threadRoot: params.threadRoot,
    timestamp: new Date().toISOString(),
    sender: params.sender,
    recipients: params.recipients,
    intent: params.intent,
    content: {
      text: params.text,
      diff: params.diff,
      decision: params.decision,
    },
    symbols: params.symbols || [],
    attachments: params.attachments,
    metadata: params.metadata,
  };
}

export function routeMessage(message: SymphonyMessage): number {
  ensureScoreDirs();

  // Append to sender's outbox
  appendToOutbox(message.sender.id, message);

  let deliveryCount = 0;

  if (message.recipients && message.recipients.length > 0) {
    // Direct message — deliver to specified recipients
    for (const recipient of message.recipients) {
      appendToInbox(recipient.id, message);
      deliveryCount++;
    }
  } else {
    // Broadcast — deliver to all agents except sender
    const agents = listAgents();
    for (const agent of agents) {
      if (agent.id !== message.sender.id) {
        appendToInbox(agent.id, message);
        deliveryCount++;
      }
    }
  }

  // Update thread if applicable
  if (message.threadRoot) {
    const thread = loadThread(message.threadRoot);
    if (thread) {
      // Add sender to participants if not already there
      const isParticipant = thread.participants.some(p => p.id === message.sender.id);
      const updatedParticipants = isParticipant
        ? thread.participants
        : [...thread.participants, message.sender];

      updateThread(message.threadRoot, {
        participants: updatedParticipants,
        lastActivity: message.timestamp,
        messageCount: thread.messageCount + 1,
      });
    }
  }

  return deliveryCount;
}

// ────────────────────────────────────────────────────────
// File Pipeline
// ────────────────────────────────────────────────────────

function fileRequestPath(requestId: string): string {
  return path.join(FILE_REQUESTS_DIR, `${requestId}.json`);
}

export function loadTrustConfig(): TrustConfig {
  if (!fs.existsSync(TRUST_CONFIG_PATH)) return DEFAULT_TRUST;

  try {
    // Simple YAML parsing for trust config (avoid dependency on js-yaml)
    const content = fs.readFileSync(TRUST_CONFIG_PATH, 'utf-8');

    // Try to parse as JSON first (simpler)
    try {
      return JSON.parse(content) as TrustConfig;
    } catch {
      // Fall back to basic YAML extraction
      // For production, we'd use js-yaml — but keep deps minimal
      return DEFAULT_TRUST;
    }
  } catch {
    return DEFAULT_TRUST;
  }
}

export function createFileRequest(params: {
  filePath: string;
  requester: Participant;
  reason: string;
  urgency?: FileUrgency;
  snippet?: string;
  threadRoot?: string;
}): FileRequestRecord {
  ensureScoreDirs();

  const requestId = 'freq-' + crypto.randomBytes(4).toString('hex');

  const record: FileRequestRecord = {
    request: {
      requestId,
      filePath: params.filePath,
      reason: params.reason,
      requester: params.requester,
      urgency: params.urgency || 'normal',
      snippet: params.snippet,
      threadRoot: params.threadRoot,
    },
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(fileRequestPath(requestId), JSON.stringify(record, null, 2), 'utf-8');
  return record;
}

export function loadFileRequest(requestId: string): FileRequestRecord | null {
  const filePath = fileRequestPath(requestId);
  if (!fs.existsSync(filePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as FileRequestRecord;
  } catch {
    return null;
  }
}

export function listFileRequests(status?: FileRequestRecord['status']): FileRequestRecord[] {
  ensureScoreDirs();

  if (!fs.existsSync(FILE_REQUESTS_DIR)) return [];

  const files = fs.readdirSync(FILE_REQUESTS_DIR).filter(f => f.endsWith('.json'));
  const requests: FileRequestRecord[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(FILE_REQUESTS_DIR, file), 'utf-8');
      const record = JSON.parse(content) as FileRequestRecord;
      if (!status || record.status === status) {
        requests.push(record);
      }
    } catch {
      // Skip corrupted
    }
  }

  return requests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function approveFileRequest(
  requestId: string,
  projectDir: string,
  redact?: boolean
): { success: boolean; delivery?: FileDelivery; error?: string } {
  const record = loadFileRequest(requestId);
  if (!record) return { success: false, error: `File request not found: ${requestId}` };
  if (record.status !== 'pending') return { success: false, error: `Request already ${record.status}` };

  const absolutePath = path.resolve(projectDir, record.request.filePath);

  // Security: ensure file is within project directory
  if (!absolutePath.startsWith(path.resolve(projectDir))) {
    return { success: false, error: 'File path escapes project directory' };
  }

  if (!fs.existsSync(absolutePath)) {
    return { success: false, error: `File not found: ${record.request.filePath}` };
  }

  try {
    let content = fs.readFileSync(absolutePath, 'utf-8');
    let encoding: FileEncoding = 'utf8';

    if (redact) {
      // Redact lines containing potential secrets
      const secretPatterns = [
        /(?:api[_-]?key|secret|token|password|credential|auth)\s*[:=]/i,
        /(?:^|\s)(?:export\s+)?[A-Z_]+(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)\s*=/,
        /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
      ];

      content = content.split('\n').map(line => {
        for (const pattern of secretPatterns) {
          if (pattern.test(line)) return '[REDACTED]';
        }
        return line;
      }).join('\n');
    }

    const hash = crypto.createHash('sha256').update(content).digest('hex');

    const delivery: FileDelivery = {
      requestId,
      filePath: record.request.filePath,
      content,
      encoding,
      size: Buffer.byteLength(content),
      hash,
    };

    // Update request record
    record.status = 'approved';
    record.resolvedAt = new Date().toISOString();
    record.delivery = delivery;
    fs.writeFileSync(fileRequestPath(requestId), JSON.stringify(record, null, 2), 'utf-8');

    // Send delivery message to requester
    const deliveryMessage = buildMessage({
      sender: { id: 'system', name: 'File Transfer', type: 'human' },
      recipients: [record.request.requester],
      intent: 'fileDelivery',
      text: `File delivered: ${record.request.filePath} (${delivery.size} bytes, SHA-256: ${hash.slice(0, 12)}...)`,
      threadRoot: record.request.threadRoot,
      symbols: [],
    });
    deliveryMessage.attachments = [{
      name: path.basename(record.request.filePath),
      type: 'file',
      content: delivery.content,
      encoding: delivery.encoding,
    }];
    routeMessage(deliveryMessage);

    return { success: true, delivery };
  } catch (err) {
    return { success: false, error: `Failed to read file: ${(err as Error).message}` };
  }
}

export function denyFileRequest(requestId: string, reason?: string): boolean {
  const record = loadFileRequest(requestId);
  if (!record || record.status !== 'pending') return false;

  record.status = 'denied';
  record.resolvedAt = new Date().toISOString();
  record.denyReason = reason;
  fs.writeFileSync(fileRequestPath(requestId), JSON.stringify(record, null, 2), 'utf-8');

  // Send denial message to requester
  const denialMessage = buildMessage({
    sender: { id: 'system', name: 'File Transfer', type: 'human' },
    recipients: [record.request.requester],
    intent: 'fileDenied',
    text: `File request denied: ${record.request.filePath}${reason ? ` — ${reason}` : ''}`,
    threadRoot: record.request.threadRoot,
    symbols: [],
  });
  routeMessage(denialMessage);

  return true;
}

/**
 * Check if a file path matches glob-like patterns.
 * Supports: *, **, and ? wildcards.
 */
function matchesGlob(filePath: string, pattern: string): boolean {
  // Convert glob to regex
  let regex = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');

  return new RegExp(`^${regex}$`).test(filePath);
}

export function isPathDenied(filePath: string, config?: TrustConfig, user?: string): boolean {
  const trust = config || loadTrustConfig();

  // Check user-specific rules first
  if (user && trust.users[user]) {
    for (const pattern of trust.users[user].neverApprove) {
      if (matchesGlob(filePath, pattern)) return true;
    }
  }

  // Check defaults
  for (const pattern of trust.defaults.neverApprove) {
    if (matchesGlob(filePath, pattern)) return true;
  }

  return false;
}

export function isPathAutoApproved(filePath: string, config?: TrustConfig, user?: string): boolean {
  const trust = config || loadTrustConfig();

  // Hard deny always wins
  if (isPathDenied(filePath, trust, user)) return false;

  // Check user-specific auto-approve
  if (user && trust.users[user]) {
    for (const pattern of trust.users[user].autoApprove) {
      if (matchesGlob(filePath, pattern)) return true;
    }
  }

  // Check defaults
  for (const pattern of trust.defaults.autoApprove) {
    if (matchesGlob(filePath, pattern)) return true;
  }

  return false;
}

export function expireOldRequests(): number {
  const requests = listFileRequests('pending');
  let expired = 0;

  for (const record of requests) {
    const age = Date.now() - new Date(record.createdAt).getTime();
    if (age > FILE_REQUEST_TTL_MS) {
      record.status = 'expired';
      record.resolvedAt = new Date().toISOString();
      fs.writeFileSync(
        fileRequestPath(record.request.requestId),
        JSON.stringify(record, null, 2),
        'utf-8'
      );
      expired++;
    }
  }

  return expired;
}

// ────────────────────────────────────────────────────────
// Process Helpers
// ────────────────────────────────────────────────────────

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
