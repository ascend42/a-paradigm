/**
 * Nomination Engine — processes events into agent nominations and debates
 *
 * The core loop: events flow in → scored against agent attention patterns →
 * agents above threshold generate nominations → overlapping nominations
 * form debates → nominations surface to the human.
 *
 * Storage:
 *   .paradigm/events/nominations.jsonl  (bounded at 500)
 *   .paradigm/events/debates.jsonl      (bounded at 200)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  StreamEvent,
  Nomination,
  NominationType,
  NominationUrgencyLevel,
  AttentionScore,
  Debate,
} from '../types/ambient.js';
import type { AgentProfile, AgentAttention } from '../types/agents.js';
import { emitEvent, scoreEventForAgent } from './event-stream.js';
import { loadDataPolicy, canObservePath } from './data-policy-loader.js';
import { loadAllAgentProfiles, loadAgentProfile, saveAgentProfile, isAgentActive } from './agent-loader.js';
import { loadJournalEntries } from './journal-loader.js';
import { addNotebookEntry, normalizeConcept, notebookPrior } from './notebook-loader.js';
import { appendClassroomCertification } from './field-failures.js';
import { log } from './mcp-logger.js';

const EVENTS_DIR = '.paradigm/events';
const NOMINATIONS_FILE = 'nominations.jsonl';
const PROMOTION_DECISIONS_FILE = 'promotion-decisions.jsonl';
const DEBATES_FILE = 'debates.jsonl';
const MAX_NOMINATIONS = 500;
const MAX_DEBATES = 200;
const DEFAULT_NOMINATION_TTL_DAYS = 7;
const DEFAULT_DEBATE_TTL_DAYS = 14;
const PRUNE_ENTRY_THRESHOLD = 100;

// ── ID Generation ──

function generateNominationId(): string {
  const now = Date.now();
  const rand = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
  return `nom-${now}-${rand}`;
}

function generateDebateId(): string {
  const now = Date.now();
  const rand = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
  return `dbt-${now}-${rand}`;
}

// ── Event Processing ──

/**
 * Score an event against ALL agent attention patterns.
 * For agents above threshold, generate Nomination objects.
 */
export function processEvent(
  rootDir: string,
  event: StreamEvent
): { nominations: Nomination[]; debates: Debate[] } {
  const profiles = loadAllAgentProfiles(rootDir);
  const policy = loadDataPolicy(rootDir);
  const scores: Array<{ profile: AgentProfile; score: AttentionScore }> = [];

  for (const profile of profiles) {
    if (!profile.attention) continue;
    if (!isAgentActive(profile.id, rootDir)) continue; // Skip agents not on roster

    // Data policy check: skip agents denied observation of this path
    if (event.path && !canObservePath(policy, event.path, profile.id)) {
      continue;
    }

    const score = scoreEventForAgent(event, profile.id, profile.attention);
    if (score.shouldNominate) {
      scores.push({ profile, score });
    }
  }

  if (scores.length === 0) {
    return { nominations: [], debates: [] };
  }

  // Dedup: check if same agent already nominated for same path/symbols in last 30 seconds
  const recentNominations = loadNominations(rootDir, { since: new Date(Date.now() - 30_000).toISOString() });
  const deduped = scores.filter(({ profile }) => {
    const recent = recentNominations.find(n =>
      n.agent === profile.id &&
      n.brief === generateBrief(profile, event, { ...scores.find(s => s.profile.id === profile.id)!.score })
    );
    return !recent;
  });

  if (deduped.length === 0) {
    return { nominations: [], debates: [] };
  }

  // Generate nominations
  const nominations: Nomination[] = deduped.map(({ profile, score }) => {
    const urgency = deriveUrgency(event, score);
    const type = deriveNominationType(profile, event);

    return {
      id: generateNominationId(),
      agent: profile.id,
      relevance: score.score,
      urgency,
      type,
      brief: generateBrief(profile, event, score),
      triggered_by: [event.id],
      timestamp: new Date().toISOString(),
      surfaced: false,
    };
  });

  // Persist nominations
  persistNominations(rootDir, nominations);

  // Detect debates
  const debates = detectDebates(rootDir, nominations);
  if (debates.length > 0) {
    persistDebates(rootDir, debates);
  }

  return { nominations, debates };
}

/**
 * Derive urgency from event type and severity.
 */
function deriveUrgency(event: StreamEvent, score: AttentionScore): NominationUrgencyLevel {
  if (event.severity === 'critical') return 'critical';
  if (event.severity === 'error') return 'high';
  if (event.type === 'compliance-violation') return 'high';
  if (event.type === 'error-encountered') return 'high';
  if (event.type === 'gate-added' || event.type === 'route-created') return 'medium';
  if (score.score >= 0.9) return 'medium';
  return 'low';
}

/**
 * Derive nomination type from agent collaboration stance and event.
 */
function deriveNominationType(profile: AgentProfile, event: StreamEvent): NominationType {
  const stance = profile.collaboration?.stance;
  if (event.type === 'compliance-violation' || event.type === 'error-encountered') return 'warning';
  if (event.type === 'gate-added' || event.type === 'route-created') return 'observation';
  if (stance === 'advisory') return 'suggestion';
  if (stance === 'lead') return 'suggestion';
  if (stance === 'observer') return 'observation';
  return 'observation';
}

/**
 * Generate a substantive 1-line brief for a nomination.
 * Uses agent role and event context to produce actionable summaries.
 */
function generateBrief(profile: AgentProfile, event: StreamEvent, score: AttentionScore): string {
  const role = profile.role || profile.id;

  // Build a contextual brief based on event type and agent expertise
  switch (event.type) {
    case 'gate-checked':
      return `${role}: Gate check on ${event.symbols?.join(', ') || 'route'} — verify gate coverage is complete`;
    case 'file-modified':
      return `${role}: ${event.path || 'File'} modified — review for ${profile.id === 'security' ? 'security implications' : profile.id === 'tester' ? 'test coverage' : profile.id === 'reviewer' ? 'code quality' : 'consistency'}`;
    case 'compliance-violation':
      return `${role}: Compliance violation detected — ${event.context || 'check .purpose and portal.yaml coverage'}`;
    case 'route-created':
      return `${role}: New route ${event.symbols?.join(', ') || ''} — ${profile.id === 'security' ? 'needs gate assignment in portal.yaml' : 'review route structure'}`;
    case 'gate-added':
      return `${role}: Gate ${event.symbols?.join(', ') || ''} added — ${profile.id === 'security' ? 'verify enforcement points' : 'check downstream impact'}`;
    case 'decision-made':
      return `${role}: Decision recorded — ${event.context?.slice(0, 80) || 'review for alignment with project patterns'}`;
    case 'work-completed':
      return `${role}: Work completed on ${event.symbols?.join(', ') || event.context?.slice(0, 40) || 'task'} — review outcome`;
    case 'error-encountered':
      return `${role}: Error detected — ${event.context?.slice(0, 80) || 'investigate root cause'}`;
    default: {
      const matchDetail = score.breakdown.symbolMatch > 0
        ? `symbol match on ${event.symbols?.join(', ') || 'unknown'}`
        : score.breakdown.pathMatch > 0
        ? `path ${event.path || 'unknown'}`
        : event.context?.slice(0, 60) || event.type;
      return `${role}: ${matchDetail}`;
    }
  }
}

// ── Debate Detection ──

/**
 * Group overlapping nominations (same triggered event or shared symbols).
 * Mark as conflicting vs complementary.
 */
export function detectDebates(rootDir: string, newNominations: Nomination[]): Debate[] {
  if (newNominations.length < 2) return [];

  const debates: Debate[] = [];

  // Group by triggered event
  const byEvent = new Map<string, Nomination[]>();
  for (const nom of newNominations) {
    for (const eventId of nom.triggered_by) {
      const group = byEvent.get(eventId) || [];
      group.push(nom);
      byEvent.set(eventId, group);
    }
  }

  for (const [eventId, group] of byEvent) {
    if (group.length < 2) continue;

    // Check if nominations are from different agents
    const agents = new Set(group.map(n => n.agent));
    if (agents.size < 2) continue;

    // Determine if conflicting or complementary based on nomination types
    const types = new Set(group.map(n => n.type));
    const isConflicting = types.size > 1 && types.has('warning') && types.has('suggestion');

    debates.push({
      id: generateDebateId(),
      topic: `Multiple agents responded to event ${eventId}`,
      nominations: group.map(n => n.id),
      type: isConflicting ? 'conflicting' : 'complementary',
      overlap_events: [eventId],
    });
  }

  return debates;
}

// ── Persistence ──

function getNominationsPath(rootDir: string): string {
  return path.join(rootDir, EVENTS_DIR, NOMINATIONS_FILE);
}

function getDebatesPath(rootDir: string): string {
  return path.join(rootDir, EVENTS_DIR, DEBATES_FILE);
}

export function persistNominations(rootDir: string, nominations: Nomination[]): void {
  try {
    const dir = path.join(rootDir, EVENTS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = getNominationsPath(rootDir);
    const lines = nominations.map(n => JSON.stringify(n)).join('\n') + '\n';
    fs.appendFileSync(filePath, lines, 'utf8');
    pruneFile(filePath, MAX_NOMINATIONS);

    // TTL-based pruning: remove stale entries when file grows large
    const { nominationTtlDays } = loadAmbientConfig(rootDir);
    pruneStaleEntries(filePath, nominationTtlDays * 24 * 60 * 60 * 1000);
  } catch {
    // Non-fatal
  }
}

function persistDebates(rootDir: string, debates: Debate[]): void {
  try {
    const dir = path.join(rootDir, EVENTS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = getDebatesPath(rootDir);
    const lines = debates.map(d => JSON.stringify(d)).join('\n') + '\n';
    fs.appendFileSync(filePath, lines, 'utf8');
    pruneFile(filePath, MAX_DEBATES);

    // TTL-based pruning: remove stale entries when file grows large
    const { debateTtlDays } = loadAmbientConfig(rootDir);
    pruneStaleEntries(filePath, debateTtlDays * 24 * 60 * 60 * 1000);
  } catch {
    // Non-fatal
  }
}

/**
 * One recorded promotion decision — the instrument output (v7.1 r4).
 *
 * Captures what a hypothetical belief-delta gate WOULD have seen at the moment
 * a promotion decision was made, alongside the actual (unchanged) absolute gate
 * verdict. Stored append-only at .paradigm/events/promotion-decisions.jsonl so
 * the delta bands can be calibrated from a real histogram later. This is an
 * INSTRUMENT only — nothing reads it back to decide promotions.
 */
interface PromotionDecision {
  ts: string;
  agent: string;
  concepts: string[];
  before: number;
  after: number;
  delta: number;
  promoted: boolean;
  priorFound: boolean;
  gate: string;
}

/**
 * Best-effort append of a single promotion-decision row. A logging failure here
 * must NEVER break promotion, so all I/O is wrapped and swallowed.
 */
function appendPromotionDecision(rootDir: string, row: PromotionDecision): void {
  try {
    const dir = path.join(rootDir, EVENTS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, PROMOTION_DECISIONS_FILE);
    fs.appendFileSync(filePath, JSON.stringify(row) + '\n', 'utf8');
    pruneFile(filePath, MAX_NOMINATIONS);
  } catch (err) {
    log.component('#promotion-decisions').warn('failed to record promotion decision', {
      agent: row.agent,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function pruneFile(filePath: string, maxLines: number): void {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n').filter(l => l.trim());
    if (lines.length > maxLines) {
      const kept = lines.slice(-maxLines);
      fs.writeFileSync(filePath, kept.join('\n') + '\n', 'utf8');
    }
  } catch {
    // Non-fatal
  }
}

// ── Ambient Config ──

interface AmbientConfig {
  nominationTtlDays: number;
  debateTtlDays: number;
}

/**
 * Load ambient config from .paradigm/config.yaml → ambient section.
 * Falls back to defaults if the section doesn't exist.
 */
function loadAmbientConfig(rootDir: string): AmbientConfig {
  const defaults: AmbientConfig = {
    nominationTtlDays: DEFAULT_NOMINATION_TTL_DAYS,
    debateTtlDays: DEFAULT_DEBATE_TTL_DAYS,
  };

  try {
    const configPath = path.join(rootDir, '.paradigm', 'config.yaml');
    if (!fs.existsSync(configPath)) return defaults;

    const yaml = require('js-yaml');
    const content = fs.readFileSync(configPath, 'utf8');
    const parsed = yaml.load(content) as Record<string, unknown>;
    const ambient = parsed?.ambient as Record<string, unknown> | undefined;
    if (!ambient) return defaults;

    return {
      nominationTtlDays: typeof ambient['nomination-ttl-days'] === 'number'
        ? ambient['nomination-ttl-days']
        : defaults.nominationTtlDays,
      debateTtlDays: typeof ambient['debate-ttl-days'] === 'number'
        ? ambient['debate-ttl-days']
        : defaults.debateTtlDays,
    };
  } catch {
    return defaults;
  }
}

// ── TTL-Based Pruning ──

/**
 * Remove entries older than the given TTL from a JSONL file.
 * Only runs if the file has more than PRUNE_ENTRY_THRESHOLD entries
 * to avoid unnecessary I/O on small files.
 *
 * Each line must be a JSON object with a "timestamp" field (ISO string).
 */
function pruneStaleEntries(filePath: string, ttlMs: number): void {
  try {
    if (!fs.existsSync(filePath)) return;

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n').filter(l => l.trim());

    if (lines.length <= PRUNE_ENTRY_THRESHOLD) return;

    const cutoff = Date.now() - ttlMs;
    const kept = lines.filter(line => {
      try {
        const entry = JSON.parse(line);
        const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now();
        return ts >= cutoff;
      } catch {
        return true; // Keep unparseable lines
      }
    });

    if (kept.length < lines.length) {
      fs.writeFileSync(filePath, kept.join('\n') + '\n', 'utf8');
    }
  } catch {
    // Non-fatal
  }
}

// ── Loading ──

export function loadNominations(
  rootDir: string,
  filter?: {
    agent?: string;
    urgency?: NominationUrgencyLevel;
    surfaced?: boolean;
    pending_only?: boolean;
    since?: string;
    limit?: number;
  }
): Nomination[] {
  const filePath = getNominationsPath(rootDir);
  if (!fs.existsSync(filePath)) return [];

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    let nominations = content.trim().split('\n')
      .filter(line => line.trim())
      .map(line => {
        try { return JSON.parse(line) as Nomination; }
        catch { return null; }
      })
      .filter((n): n is Nomination => n !== null);

    if (filter?.agent) nominations = nominations.filter(n => n.agent === filter.agent);
    if (filter?.urgency) nominations = nominations.filter(n => n.urgency === filter.urgency);
    if (filter?.surfaced !== undefined) nominations = nominations.filter(n => n.surfaced === filter.surfaced);
    if (filter?.pending_only) nominations = nominations.filter(n => !n.engaged);
    if (filter?.since) nominations = nominations.filter(n => n.timestamp >= filter.since!);

    nominations.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    if (filter?.limit) nominations = nominations.slice(0, filter.limit);

    return nominations;
  } catch {
    return [];
  }
}

export function loadDebates(rootDir: string): Debate[] {
  const filePath = getDebatesPath(rootDir);
  if (!fs.existsSync(filePath)) return [];

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.trim().split('\n')
      .filter(line => line.trim())
      .map(line => {
        try { return JSON.parse(line) as Debate; }
        catch { return null; }
      })
      .filter((d): d is Debate => d !== null);
  } catch {
    return [];
  }
}

// ── Engagement ──

/**
 * Mark a nomination as engaged with a response.
 */
export function engageNomination(
  rootDir: string,
  nominationId: string,
  response: 'accepted' | 'dismissed' | 'deferred',
  reason?: string
): boolean {
  const filePath = getNominationsPath(rootDir);
  if (!fs.existsSync(filePath)) return false;

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n');
    let found = false;

    const updated = lines.map(line => {
      try {
        const nom = JSON.parse(line) as Nomination;
        if (nom.id === nominationId) {
          nom.engaged = true;
          nom.response = response;
          if (reason) nom.reason = reason;
          found = true;
          return JSON.stringify(nom);
        }
        return line;
      } catch {
        return line;
      }
    });

    if (found) {
      fs.writeFileSync(filePath, updated.join('\n') + '\n', 'utf8');

      // Emit learning feedback if agent has it configured
      if (response === 'accepted' || response === 'dismissed') {
        const nom = JSON.parse(lines.find(l => {
          try { return JSON.parse(l).id === nominationId; } catch { return false; }
        })!) as Nomination;

        const profile = loadAllAgentProfiles(rootDir).find(p => p.id === nom.agent);
        if (profile?.learning?.intrinsic?.feedback?.after_recommendation) {
          emitEvent(rootDir, {
            type: 'work-completed',
            source: 'agent-action',
            agent: nom.agent,
            context: `Nomination ${nominationId} ${response} — feedback for learning`,
            data: { nomination_id: nominationId, response },
          });
        }
      }
    }

    return found;
  } catch {
    return false;
  }
}

/**
 * Resolve a debate by choosing one nomination.
 */
export function resolveDebate(
  rootDir: string,
  debateId: string,
  chosenNominationId: string,
  reason?: string
): boolean {
  const filePath = getDebatesPath(rootDir);
  if (!fs.existsSync(filePath)) return false;

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n');
    let found = false;

    const updated = lines.map(line => {
      try {
        const debate = JSON.parse(line) as Debate;
        if (debate.id === debateId) {
          debate.resolution = {
            chosen: chosenNominationId,
            reason,
            resolved_by: 'human',
            resolved_at: new Date().toISOString(),
          };
          found = true;

          // Emit debate-loss signal for non-chosen agents
          const nonChosen = debate.nominations.filter(id => id !== chosenNominationId);
          for (const loserId of nonChosen) {
            const loserNom = loadNominations(rootDir).find(n => n.id === loserId);
            if (loserNom) {
              emitEvent(rootDir, {
                type: 'work-completed',
                source: 'agent-action',
                agent: loserNom.agent,
                context: `Debate ${debateId} resolved — nomination ${loserId} not chosen`,
                data: { debate_id: debateId, chosen: chosenNominationId, reason },
              });
            }
          }

          return JSON.stringify(debate);
        }
        return line;
      } catch {
        return line;
      }
    });

    if (found) {
      fs.writeFileSync(filePath, updated.join('\n') + '\n', 'utf8');
    }

    return found;
  } catch {
    return false;
  }
}

// ── Catch-Up Processing ──

/**
 * Process un-scored events from the stream (e.g., from hook emissions).
 * Tracks the last-processed event ID in .paradigm/events/.last-processed.
 * Called lazily when nominations are queried.
 */
export function processPendingEvents(rootDir: string): { processed: number; nominations: Nomination[] } {
  const lastProcessedPath = path.join(rootDir, EVENTS_DIR, '.last-processed');
  let lastProcessedId = '';
  try {
    if (fs.existsSync(lastProcessedPath)) {
      lastProcessedId = fs.readFileSync(lastProcessedPath, 'utf8').trim();
    }
  } catch { /* start from beginning */ }

  // Load all events from stream
  const streamPath = path.join(rootDir, EVENTS_DIR, 'stream.jsonl');
  if (!fs.existsSync(streamPath)) return { processed: 0, nominations: [] };

  let events: StreamEvent[] = [];
  try {
    const content = fs.readFileSync(streamPath, 'utf8');
    events = content.trim().split('\n')
      .filter(line => line.trim())
      .map(line => { try { return JSON.parse(line) as StreamEvent; } catch { return null; } })
      .filter((e): e is StreamEvent => e !== null);
  } catch {
    return { processed: 0, nominations: [] };
  }

  // Find events after the last processed ID
  let startIdx = 0;
  if (lastProcessedId) {
    const idx = events.findIndex(e => e.id === lastProcessedId);
    if (idx >= 0) startIdx = idx + 1;
  }

  const pending = events.slice(startIdx);
  if (pending.length === 0) return { processed: 0, nominations: [] };

  // Process each pending event (limit to 50 to avoid blocking)
  const allNominations: Nomination[] = [];
  const toProcess = pending.slice(0, 50);

  for (const event of toProcess) {
    const { nominations } = processEvent(rootDir, event);
    allNominations.push(...nominations);
  }

  // Update last-processed marker
  const lastEvent = toProcess[toProcess.length - 1];
  try {
    fs.mkdirSync(path.join(rootDir, EVENTS_DIR), { recursive: true });
    fs.writeFileSync(lastProcessedPath, lastEvent.id, 'utf8');
  } catch { /* non-fatal */ }

  return { processed: toProcess.length, nominations: allNominations };
}

// ── Unified Emit ──

/**
 * Wrapper: data policy check → emitEvent → processEvent.
 * Replaces bare emitEvent calls throughout the codebase.
 */
export function emitAndProcess(
  rootDir: string,
  event: Omit<StreamEvent, 'id' | 'timestamp'>,
  opts?: { skipNominations?: boolean }
): { event: StreamEvent; nominations: Nomination[]; debates: Debate[] } {
  const policy = loadDataPolicy(rootDir);

  // Data policy check at event-emission boundary
  if (event.path && !canObservePath(policy, event.path)) {
    // Event path is denied by policy — emit but skip nomination processing
    const emitted = emitEvent(rootDir, event);
    return { event: emitted, nominations: [], debates: [] };
  }

  const emitted = emitEvent(rootDir, event);

  if (opts?.skipNominations) {
    return { event: emitted, nominations: [], debates: [] };
  }

  const { nominations, debates } = processEvent(rootDir, emitted);

  // Forward to Symphony relay if configured
  if (nominations.length > 0) {
    forwardNominationsToRelay(rootDir, nominations);
  }

  return { event: emitted, nominations, debates };
}

// ── Learning Feedback Loop ──

/**
 * Analyze an agent's nomination history and adjust its attention threshold.
 *
 * Logic:
 * - If >60% of nominations are dismissed → raise threshold (agent is too noisy)
 * - If >80% of nominations are accepted → lower threshold (agent could contribute more)
 * - If insufficient data (<5 engaged nominations) → no adjustment
 *
 * Also records a journal entry about the adjustment if the agent has
 * learning.intrinsic.reflection configured.
 */
export function adjustAttentionFromFeedback(
  rootDir: string,
  agentId: string
): { adjusted: boolean; oldThreshold: number; newThreshold: number; reason: string } {
  const profile = loadAgentProfile(rootDir, agentId);
  if (!profile?.attention) {
    return { adjusted: false, oldThreshold: 0.6, newThreshold: 0.6, reason: 'No attention config' };
  }

  const oldThreshold = profile.attention.threshold ?? 0.6;

  // Load engagement history for this agent (exclude stale pending nominations)
  const { nominationTtlDays } = loadAmbientConfig(rootDir);
  const staleThresholdMs = nominationTtlDays * 24 * 60 * 60 * 1000;
  const allNominations = loadNominations(rootDir, { agent: agentId });
  const active = allNominations.filter(n =>
    n.engaged || (Date.now() - new Date(n.timestamp).getTime() < staleThresholdMs)
  );
  const engaged = active.filter(n => n.engaged);

  if (engaged.length < 5) {
    return { adjusted: false, oldThreshold, newThreshold: oldThreshold, reason: `Insufficient data (${engaged.length}/5 engaged nominations)` };
  }

  const accepted = engaged.filter(n => n.response === 'accepted').length;
  const dismissed = engaged.filter(n => n.response === 'dismissed').length;
  const acceptRate = accepted / engaged.length;
  const dismissRate = dismissed / engaged.length;

  let newThreshold = oldThreshold;
  let reason = 'No adjustment needed';

  if (dismissRate > 0.6) {
    // Too noisy — raise threshold by 0.05 (max 0.95)
    newThreshold = Math.min(0.95, oldThreshold + 0.05);
    reason = `High dismiss rate (${(dismissRate * 100).toFixed(0)}%) — raising threshold to reduce noise`;
  } else if (acceptRate > 0.8) {
    // Highly useful — lower threshold by 0.05 (min 0.2)
    newThreshold = Math.max(0.2, oldThreshold - 0.05);
    reason = `High accept rate (${(acceptRate * 100).toFixed(0)}%) — lowering threshold to contribute more`;
  }

  if (newThreshold === oldThreshold) {
    return { adjusted: false, oldThreshold, newThreshold, reason };
  }

  // Apply the adjustment
  profile.attention.threshold = newThreshold;

  // Save to whichever scope has the profile
  const projectPath = path.join(rootDir, '.paradigm/agents', `${agentId}.agent`);
  const scope = fs.existsSync(projectPath) ? 'project' as const : 'global' as const;
  saveAgentProfile(agentId, profile, scope, rootDir);

  // Emit a learning event
  emitEvent(rootDir, {
    type: 'work-completed',
    source: 'agent-action',
    agent: agentId,
    context: `Attention threshold adjusted: ${oldThreshold.toFixed(2)} → ${newThreshold.toFixed(2)} (${reason})`,
    data: { old_threshold: oldThreshold, new_threshold: newThreshold, accept_rate: acceptRate, dismiss_rate: dismissRate },
  });

  return { adjusted: true, oldThreshold, newThreshold, reason };
}

/**
 * Get nomination engagement stats for an agent.
 */
export function getNominationStats(
  rootDir: string,
  agentId: string
): { total: number; accepted: number; dismissed: number; deferred: number; pending: number; acceptRate: number } {
  const { nominationTtlDays } = loadAmbientConfig(rootDir);
  const staleThresholdMs = nominationTtlDays * 24 * 60 * 60 * 1000;
  const allNominations = loadNominations(rootDir, { agent: agentId });
  // Filter out stale pending nominations (older than TTL, not engaged) to prevent diluting stats
  const nominations = allNominations.filter(n =>
    n.engaged || (Date.now() - new Date(n.timestamp).getTime() < staleThresholdMs)
  );
  const accepted = nominations.filter(n => n.response === 'accepted').length;
  const dismissed = nominations.filter(n => n.response === 'dismissed').length;
  const deferred = nominations.filter(n => n.response === 'deferred').length;
  const pending = nominations.filter(n => !n.engaged).length;
  const engaged = accepted + dismissed + deferred;

  return {
    total: nominations.length,
    accepted,
    dismissed,
    deferred,
    pending,
    acceptRate: engaged > 0 ? accepted / engaged : 0,
  };
}

/**
 * Neverland Validation Metrics — aggregate learning metrics across all agents.
 * Tracks the measurable success criteria from the Maestro spec:
 * - Agent routing accuracy (>80% by session 10)
 * - Acceptance rate per agent (>70% from ~50% cold start)
 * - Threshold drift (self-tuning direction)
 * - Notebook growth (journal → notebook promotions)
 * - Cross-project transfer (transferable patterns applied)
 */
export function getNeverlandMetrics(
  rootDir: string
): {
  agents: Array<{
    id: string;
    acceptRate: number;
    threshold: number;
    expertiseCount: number;
    notebookCount: number;
    transferableCount: number;
    totalNominations: number;
  }>;
  aggregate: {
    avgAcceptRate: number;
    avgThreshold: number;
    totalExpertise: number;
    totalNotebooks: number;
    totalTransferable: number;
  };
  healthStatus: 'cold-start' | 'accumulating' | 'calibrating' | 'mature';
} {
  const profiles = loadAllAgentProfiles(rootDir);
  const agentMetrics = profiles
    .filter(p => isAgentActive(p.id, rootDir))
    .map(p => {
      const stats = getNominationStats(rootDir, p.id);

      // Count notebook entries (check file existence)
      let notebookCount = 0;
      try {
        const nbDir = path.join(os.homedir(), '.paradigm', 'notebooks', p.id);
        if (fs.existsSync(nbDir)) {
          notebookCount = fs.readdirSync(nbDir).filter(f => f.endsWith('.yaml')).length;
        }
      } catch { /* skip */ }

      return {
        id: p.id,
        acceptRate: stats.acceptRate,
        threshold: p.attention?.threshold ?? 0.5,
        expertiseCount: (p.expertise || []).length,
        notebookCount,
        transferableCount: (p.transferable || []).length,
        totalNominations: stats.total,
      };
    });

  const count = agentMetrics.length || 1;
  const avgAcceptRate = agentMetrics.reduce((s, a) => s + a.acceptRate, 0) / count;
  const avgThreshold = agentMetrics.reduce((s, a) => s + a.threshold, 0) / count;
  const totalExpertise = agentMetrics.reduce((s, a) => s + a.expertiseCount, 0);
  const totalNotebooks = agentMetrics.reduce((s, a) => s + a.notebookCount, 0);
  const totalTransferable = agentMetrics.reduce((s, a) => s + a.transferableCount, 0);
  const totalNominations = agentMetrics.reduce((s, a) => s + a.totalNominations, 0);

  // Determine health status based on Neverland test criteria
  let healthStatus: 'cold-start' | 'accumulating' | 'calibrating' | 'mature';
  if (totalNominations < 10) {
    healthStatus = 'cold-start';
  } else if (avgAcceptRate < 0.5) {
    healthStatus = 'accumulating';
  } else if (avgAcceptRate < 0.7) {
    healthStatus = 'calibrating';
  } else {
    healthStatus = 'mature';
  }

  return {
    agents: agentMetrics,
    aggregate: {
      avgAcceptRate,
      avgThreshold,
      totalExpertise,
      totalNotebooks,
      totalTransferable,
    },
    healthStatus,
  };
}

/**
 * Forward nominations to Symphony relay for cross-machine delivery.
 * Only forwards if Symphony is configured and relay is running.
 * Fire-and-forget — relay failure does not block local processing.
 */
export function forwardNominationsToRelay(
  rootDir: string,
  nominations: Nomination[]
): void {
  if (nominations.length === 0) return;

  // Check if Symphony outbox exists (indicates relay is configured)
  const outboxDir = path.join(os.homedir(), '.paradigm', 'score', 'outbox');
  if (!fs.existsSync(outboxDir)) return;

  try {
    // Write nominations as a Symphony outbox message for relay pickup
    const outboxFile = path.join(outboxDir, `nom-${Date.now()}.json`);
    const message = {
      type: 'nomination_forward',
      nominations: nominations.map(n => ({ ...n })),
      origin: detectLocalProject(rootDir),
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(outboxFile, JSON.stringify(message), 'utf8');
  } catch {
    // Non-fatal
  }
}

function detectLocalProject(rootDir: string): string {
  try {
    const configPath = path.join(rootDir, '.paradigm', 'config.yaml');
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      const match = content.match(/project:\s*(.+)/);
      if (match) return match[1].trim();
    }
  } catch { /* fall through */ }
  return path.basename(rootDir);
}

// ── Journal-to-Notebook Auto-Promotion ──

/**
 * Scan an agent's journal for high-confidence pattern discoveries and
 * confirmed human feedback, then auto-promote them to notebook entries.
 *
 * Promotable triggers:
 *   - 'pattern_discovered' — agent identified a reusable pattern
 *   - 'human_feedback' — user confirmed an agent's approach worked well
 *
 * Non-promotable triggers (kept as journal-only):
 *   - 'correction_received' — about what NOT to do; less useful as notebook snippets
 *   - 'confidence_miss' — for confidence adjustment, not reusable knowledge
 *
 * Criteria: confidence_after >= 0.8 AND not already promoted (promoted_to_notebook is unset).
 *
 * Returns the number of entries promoted.
 */
export function autoPromoteJournalEntries(
  rootDir: string,
  agentId: string
): { promoted: number; entries: Array<{ journalId: string; notebookId: string }> } {
  // Load both pattern_discovered and human_feedback entries for promotion
  const patternEntries = loadJournalEntries(agentId, { trigger: 'pattern_discovered', limit: 100 });
  const feedbackEntries = loadJournalEntries(agentId, { trigger: 'human_feedback', limit: 100 });
  const journal = ([...patternEntries, ...feedbackEntries]) as Array<{
    id: string;
    insight: string;
    confidence_after?: number;
    promoted_to_notebook?: string;
    pattern?: { id: string; applies_when: string; correct_approach: string };
    tags?: string[];
    project: string;
  }>;

  const promoted: Array<{ journalId: string; notebookId: string }> = [];

  for (const entry of journal) {
    // Skip already-promoted entries — no instrument row, no decision to record.
    if (entry.promoted_to_notebook) continue;

    // Derive concepts exactly the way the promotion writer does, so the prior
    // we measure is keyed on the same axis the entry would be stored under.
    const concepts = (entry.tags || [entry.pattern?.id || 'learned-pattern'])
      .map(normalizeConcept)
      .filter(Boolean);

    // ── INSTRUMENT (v7.1 r4): measure the belief delta, do NOT gate on it ──
    // We record what a future delta-gate WOULD have seen, alongside the
    // UNCHANGED absolute gate below. This collects real {before, after, delta,
    // promoted} data so the bands can be set from a histogram later. The
    // promote/skip decision is still the byte-identical absolute rule.
    const after = entry.confidence_after ?? 0;
    const wouldPromote = after >= 0.8; // mirrors the gate below; recorded, not enforced (NOT the `promoted` accumulator at :969)
    let before = 0.5;
    let priorFound = false;
    try {
      const prior = notebookPrior(agentId, concepts, rootDir);
      before = prior.value;
      priorFound = prior.found;
    } catch {
      // Prior lookup is best-effort instrumentation; default to 0.5 on failure.
    }
    appendPromotionDecision(rootDir, {
      ts: new Date().toISOString(),
      agent: agentId,
      concepts,
      before,
      after,
      delta: after - before,
      promoted: wouldPromote,
      priorFound,
      gate: 'absolute-0.8',
    });

    // ── GATE (UNCHANGED): absolute confidence_after < 0.8 → skip ──
    // Do NOT replace with the delta — this is the deferred, unfalsifiable gate.
    if ((entry.confidence_after ?? 0) < 0.8) continue;

    try {
      const { entry: nbEntry } = addNotebookEntry(
        agentId,
        {
          context: entry.pattern?.applies_when || entry.insight.slice(0, 80),
          snippet: entry.pattern?.correct_approach || entry.insight,
          // Persist the real, verdict-derived confidence onto the notebook entry.
          // Before this fix the open loop never set confidence → any future prior
          // read would be garbage. No ratchet: a re-promote overwrites with the
          // newest confidence_after (latest measurement wins).
          confidence: entry.confidence_after ?? 0.5,
          // Normalize promoted concepts so postflight tags (e.g. `symbol:payment-form`)
          // are retrievable by the bare query slug (`payment-form`). See T-001.
          // (addNotebookEntry also normalizes, but normalize here for an explicit,
          // testable contract on the writer side.)
          concepts,
          // Carry the journal entry's tags through. addNotebookEntry's
          // classifyNotebookScope spreads `tags`, so an undefined here would
          // throw — pass an explicit array (the journal tags, else empty).
          tags: entry.tags ?? [],
          provenance: {
            source: 'lore',
            loreEntryId: entry.id,
            createdBy: agentId,
          },
        },
        'global',
        rootDir
      );

      promoted.push({ journalId: entry.id, notebookId: nbEntry.id });

      // The Classroom (TD-2026-06-19-007): a gated promotion writes a `pending`
      // certification. The fail-side reducer LATER-BINDS this row to `overturned`
      // when an attributed break lands on nbEntry.id. The `outcome` column is the
      // falsifier — a cert is meaningless until the field tests it.
      try {
        appendClassroomCertification(rootDir, {
          ts: new Date().toISOString(),
          agent: agentId,
          entryId: nbEntry.id,
          concepts,
          confidenceAtCert: entry.confidence_after ?? 0.5,
          certifiedBy: 'gate',
          outcome: 'pending',
        });
      } catch { /* non-fatal — certification is an instrument, never blocks promotion */ }

      // Mark the journal entry as promoted (update in-place via YAML rewrite)
      try {
        const journalDir = path.join(os.homedir(), '.paradigm', 'agents', agentId, 'journal');
        if (fs.existsSync(journalDir)) {
          const files = fs.readdirSync(journalDir).filter(f => f.endsWith('.yaml'));
          for (const file of files) {
            const filePath = path.join(journalDir, file);
            const content = fs.readFileSync(filePath, 'utf8');
            if (content.includes(entry.id)) {
              const updated = content.replace(
                /promoted_to_notebook:.*$/m,
                `promoted_to_notebook: "${nbEntry.id}"`
              );
              if (updated === content) {
                // Field didn't exist — append it
                const lines = content.trimEnd().split('\n');
                lines.push(`promoted_to_notebook: "${nbEntry.id}"`);
                fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
              } else {
                fs.writeFileSync(filePath, updated, 'utf8');
              }
              break;
            }
          }
        }
      } catch {
        // Marking promoted is non-fatal
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('PROMOTE_THREW', (e as Error).message);
      // Skip individual promotion failures
    }
  }

  return { promoted: promoted.length, entries: promoted };
}

// ── Surfacing Config ──

import type { SurfacingConfig, NominationUrgencyLevel as UrgencyLevel } from '../types/ambient.js';

const SURFACING_FILE = '.paradigm/surfacing.yaml';

/**
 * Load surfacing configuration from .paradigm/surfacing.yaml.
 * Returns defaults if the file doesn't exist.
 */
export function loadSurfacingConfig(rootDir: string): SurfacingConfig {
  const filePath = path.join(rootDir, SURFACING_FILE);

  const defaults: SurfacingConfig = {
    default_min_urgency: 'low',
    enable_debates: true,
  };

  if (!fs.existsSync(filePath)) return defaults;

  try {
    const yaml = require('js-yaml');
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = yaml.load(content) as Partial<SurfacingConfig>;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

/**
 * Apply surfacing rules to a set of nominations.
 * Filters out nominations below the configured urgency threshold
 * and respects per-agent muting.
 */
export function applySurfacingRules(
  nominations: Nomination[],
  config: SurfacingConfig
): Nomination[] {
  const urgencyOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const minUrgency = urgencyOrder[config.default_min_urgency || 'low'] ?? 3;

  return nominations.filter(n => {
    const nomUrgency = urgencyOrder[n.urgency] ?? 3;

    // Check per-agent preferences
    if (config.preferences) {
      const agentPref = config.preferences.find(p => p.agent === n.agent);
      if (agentPref) {
        if (agentPref.always_show) return true;
        if (agentPref.mute_unless?.length) {
          // Muted unless specific conditions — check urgency types
          const matchesMute = agentPref.mute_unless.some(condition =>
            n.urgency === condition || n.type === condition
          );
          if (!matchesMute) return false;
        }
        if (agentPref.min_urgency) {
          const agentMin = urgencyOrder[agentPref.min_urgency] ?? 3;
          return nomUrgency <= agentMin;
        }
      }
    }

    return nomUrgency <= minUrgency;
  });
}
