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
import { loadAllAgentProfiles } from './agent-loader.js';

const EVENTS_DIR = '.paradigm/events';
const NOMINATIONS_FILE = 'nominations.jsonl';
const DEBATES_FILE = 'debates.jsonl';
const MAX_NOMINATIONS = 500;
const MAX_DEBATES = 200;

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

  // Generate nominations
  const nominations: Nomination[] = scores.map(({ profile, score }) => {
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
 * Generate a brief 1-line summary for a nomination.
 */
function generateBrief(profile: AgentProfile, event: StreamEvent, score: AttentionScore): string {
  const dimension = score.breakdown.symbolMatch >= score.breakdown.pathMatch
    ? (score.breakdown.symbolMatch >= score.breakdown.conceptMatch ? 'symbol' : 'concept')
    : (score.breakdown.pathMatch >= score.breakdown.conceptMatch ? 'path' : 'concept');

  const matchDetail = dimension === 'symbol'
    ? `symbol match on ${event.symbols?.join(', ') || 'unknown'}`
    : dimension === 'path'
    ? `path match on ${event.path || 'unknown'}`
    : `concept match`;

  return `[${profile.id}] ${event.type} — ${matchDetail} (relevance: ${score.score.toFixed(2)})`;
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
  } catch {
    // Non-fatal
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
  response: 'accepted' | 'dismissed' | 'deferred'
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
  return { event: emitted, nominations, debates };
}
