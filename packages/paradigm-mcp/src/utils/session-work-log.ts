/**
 * Session Work Log — captures agent contributions and user verdicts during a session.
 *
 * The session work log is a JSONL file that accumulates entries during a session.
 * Unlike breadcrumbs (recovery-focused, max 50), this captures rich context for
 * Maestro's postflight learning pass: what each agent contributed, what the user
 * accepted/dismissed/revised, and why.
 *
 * Storage: .paradigm/events/session-log.jsonl
 * Bounded: 200 entries per session (cleared on session start)
 */

import * as fs from 'fs';
import * as path from 'path';

const SESSION_LOG_FILE = '.paradigm/events/session-log.jsonl';
const SESSION_METRICS_FILE = '.paradigm/events/session-metrics.jsonl';
const VERDICTS_LOG_FILE = '.paradigm/events/verdicts.jsonl';
const ITERATION_REVISIONS_FILE = '.paradigm/events/iteration-revisions.jsonl';
const POSTFLIGHT_LIVENESS_FILE = '.paradigm/events/postflight-liveness.jsonl';
const MAX_ENTRIES = 200;

// ── Types ────────────────────────────────────────────────────────────

export interface SessionWorkEntry {
  timestamp: string;
  type: 'agent-contribution' | 'user-verdict' | 'decision';

  // Agent contributions (from orchestration execute mode)
  agent?: string;
  contribution?: string;
  attribution?: string;
  symbols?: string[];

  // User verdicts (from ambient engage)
  nominationId?: string;
  verdict?: 'accepted' | 'dismissed' | 'revised' | 'deferred';
  reason?: string;
  /**
   * The Classroom (TD-2026-06-19-007): the orchestration this verdict pertains to.
   * The fail-side reducer joins `dismissed`/`revised` verdicts back to the notebook
   * application receipts (notebook-refs.jsonl) BY this key to learn which entries
   * to revise down. Optional/additive — pre-Classroom verdicts simply don't join.
   */
  orchestrationId?: string;
  revisionDelta?: string;
  /**
   * v7 §2.0: REAL post-task confidence (0–1) emitted by the agent/reviewer.
   * When present, `runPostflightLearning` prefers this over the branch-literal
   * fallback. `confidence_before` stays fabricated (not gated on — see v7.x).
   */
  confidence?: number;

  // Decisions
  decisionTitle?: string;
  decisionRationale?: string;
}

/**
 * Iteration-revision record — an agent belief-revision emitted during an
 * iteration loop (TD-2026-06-09-522). SEPARATE from user verdicts: this is
 * AGENT self-revision provenance, fed to the `self_reflection` journal trigger,
 * and must never touch the human-verdict channel or expertise scoring.
 *
 * Written by the orchestrator (packages/paradigm `iteration-revision-log.ts`);
 * the JSONL shape there is the source of truth — keep this in sync.
 * Storage: .paradigm/events/iteration-revisions.jsonl (durable, consumed by postflight).
 */
export interface IterationRevisionEntry {
  id: string;
  timestamp: string;
  type: 'iteration-revision';
  agent: string;
  corrections: string[];
  symbols: string[];
  round: number;
  consumed?: boolean;
  /** v7 §2.0: REAL post-revision confidence (0–1); preferred over the 0.75 literal. */
  confidence?: number;
}

/**
 * Notebook reference entry — records which notebook entries were loaded into
 * agent prompts during orchestration. Pure data collection, no scoring.
 * Storage: .paradigm/events/notebook-refs.jsonl
 */
export interface NotebookReferenceEntry {
  timestamp: string;
  type: 'notebook-reference';
  agentId: string;
  notebookEntryIds: string[];
  orchestrationId?: string;
}

const NOTEBOOK_REFS_FILE = '.paradigm/events/notebook-refs.jsonl';

/**
 * Activity metric snapshot — proxy metrics for understanding session scope.
 * No dollar figures, no token counts — these measure behavioral proxies only.
 */
export interface ActivityMetric {
  timestamp: string;
  type: 'activity';
  /** Number of tool calls made */
  toolCallCount?: number;
  /** Approximate payload size in bytes (for relative comparison, not billing) */
  responsePayloadBytes?: number;
  /** Session duration in milliseconds */
  sessionDurationMs?: number;
  /** Agent ID this metric belongs to (optional — for per-agent breakdown) */
  agentId?: string;
}

/**
 * Aggregated summary of session activity across all agents.
 */
export interface SessionActivitySummary {
  /** Total number of tool calls this session */
  toolCallCount: number;
  /** Total approximate payload bytes (proxy metric — not billing data) */
  responsePayloadBytes: number;
  /** Total session duration in milliseconds */
  sessionDurationMs: number;
  /** Per-agent breakdown */
  agentBreakdown: Record<string, { toolCalls: number; payloadBytes: number }>;
}

// ── Append ───────────────────────────────────────────────────────────

/**
 * Append an entry to the session work log.
 * Non-fatal — failure is silently ignored.
 */
export function appendSessionWorkEntry(rootDir: string, entry: SessionWorkEntry): void {
  try {
    const filePath = path.join(rootDir, SESSION_LOG_FILE);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Check entry count for bounding
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const lineCount = content.trim().split('\n').filter(l => l.trim()).length;
      if (lineCount >= MAX_ENTRIES) return; // Bounded
    }

    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(filePath, line, 'utf8');

    // Auto-adjust expertise based on verdicts (fire-and-forget)
    if (entry.type === 'user-verdict' && entry.agent && entry.symbols?.length) {
      import('./agent-loader.js').then(({ loadAgentProfile, saveAgentProfile }) => {
        try {
          const profile = loadAgentProfile(rootDir, entry.agent!);
          if (profile?.expertise) {
            const delta = entry.verdict === 'accepted' ? 0.03
              : entry.verdict === 'dismissed' ? -0.02
              : entry.verdict === 'revised' ? -0.01
              : 0;

            if (delta !== 0) {
              for (const symbol of entry.symbols!) {
                const exp = profile.expertise!.find(e => e.symbol === symbol);
                if (exp) {
                  exp.confidence = Math.max(0, Math.min(1, exp.confidence + delta));
                  exp.sessions = (exp.sessions || 0) + 1;
                  exp.lastTouch = new Date().toISOString();
                }
              }
              saveAgentProfile(entry.agent!, profile, 'global');
            }
          }
        } catch { /* non-fatal */ }
      }).catch(() => { /* non-fatal */ });
    }
  } catch {
    // Non-fatal — work log is advisory
  }
}

// ── Read ─────────────────────────────────────────────────────────────

/**
 * Read all entries from the current session log.
 */
export function readSessionWorkLog(rootDir: string): SessionWorkEntry[] {
  try {
    const filePath = path.join(rootDir, SESSION_LOG_FILE);
    if (!fs.existsSync(filePath)) return [];

    return fs.readFileSync(filePath, 'utf8')
      .trim()
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try { return JSON.parse(line) as SessionWorkEntry; }
        catch { return null; }
      })
      .filter((e): e is SessionWorkEntry => e !== null);
  } catch {
    return [];
  }
}

// ── Clear ────────────────────────────────────────────────────────────

/**
 * Clear the session work log. Called at session start.
 */
export function clearSessionWorkLog(rootDir: string): void {
  try {
    const filePath = path.join(rootDir, SESSION_LOG_FILE);
    if (fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '', 'utf8');
    }
  } catch {
    // Non-fatal
  }
}

// ── Postflight Liveness ───────────────────────────────────────────────
// The falsifiable liveness invariant for the learning loop (T-2026-06-13-004).
//
// Before this, the postflight pass returned a byte-identical result whether it
// wrote journals (healthy) or silently early-returned 0 (broken) — nothing on
// disk distinguished the two. Now EVERY non-dry-run postflight pass leaves one
// durable row here: a `postflight-live` row when it journaled, or a
// `postflight-noop` row carrying WHY it produced nothing. `paradigm doctor`
// reads these to compute journals-per-completion over a real denominator and
// flag a flatline (0 journals over N passes) — so "self-improving" is
// observable, not asserted.

export type PostflightLivenessReason =
  | 'no-verdicts'        // no pending durable verdicts/revisions to learn from
  | 'no-journals'        // verdicts present but none produced a journal entry
  | 'consumed';          // verdicts already consumed by an earlier pass this window

export interface PostflightLivenessRecord {
  type: 'postflight-live' | 'postflight-noop';
  ts: string;
  /** Journals written by this pass (the health signal; 0 on a noop). */
  journalsWritten: number;
  /** Notebook promotions this pass. */
  promoted: number;
  /** Present only on a noop — the traceable reason it wrote nothing. */
  reason?: PostflightLivenessReason;
  /** Best-effort session identity so a flatline can be attributed to a run. */
  sessionId: string;
  /** Claimant/agent the pass ran for, when known. */
  claimant?: string;
}

/**
 * A best-effort, durable-enough session id. Prefers an explicit env id (set by
 * the harness / hooks), else a stable per-process fallback. Never throws.
 */
export function resolveSessionId(): string {
  const env = process.env.PARADIGM_SESSION_ID || process.env.CLAUDE_SESSION_ID;
  if (env && env.trim()) return env.trim();
  return `sp-${process.pid}`;
}

/**
 * Append one postflight-liveness row. Non-fatal — a probe-write failure must
 * never break the postflight pass it observes.
 */
export function recordPostflightLiveness(
  rootDir: string,
  record: Omit<PostflightLivenessRecord, 'ts' | 'sessionId'> & { sessionId?: string },
): void {
  try {
    const filePath = path.join(rootDir, POSTFLIGHT_LIVENESS_FILE);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const full: PostflightLivenessRecord = {
      ts: new Date().toISOString(),
      sessionId: record.sessionId ?? resolveSessionId(),
      ...record,
    };
    fs.appendFileSync(filePath, JSON.stringify(full) + '\n', 'utf8');
  } catch {
    // Non-fatal — the probe is advisory.
  }
}

/**
 * Read postflight-liveness rows (oldest→newest as written). Used by the doctor
 * learning-liveness metric. Never throws.
 */
export function readPostflightLiveness(rootDir: string): PostflightLivenessRecord[] {
  try {
    const filePath = path.join(rootDir, POSTFLIGHT_LIVENESS_FILE);
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8')
      .trim()
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try { return JSON.parse(line) as PostflightLivenessRecord; }
        catch { return null; }
      })
      .filter((e): e is PostflightLivenessRecord => e !== null && typeof e.journalsWritten === 'number');
  } catch {
    return [];
  }
}

// ── Durable Verdicts ──────────────────────────────────────────────────
// Unlike session-log.jsonl (cleared on session start), verdicts.jsonl
// persists across sessions so postflight can run in any session after engagement.

/**
 * Append a user verdict to the durable verdicts log.
 * This file is NOT cleared on session start — verdicts survive until postflight consumes them.
 */
export function appendVerdictEntry(rootDir: string, entry: SessionWorkEntry): void {
  try {
    const filePath = path.join(rootDir, VERDICTS_LOG_FILE);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // Non-fatal
  }
}

/**
 * Read all unconsumed verdicts from the durable verdicts log.
 */
export function readPendingVerdicts(rootDir: string): SessionWorkEntry[] {
  try {
    const filePath = path.join(rootDir, VERDICTS_LOG_FILE);
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8')
      .trim()
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try { return JSON.parse(line) as SessionWorkEntry & { consumed?: boolean }; }
        catch { return null; }
      })
      .filter((e): e is SessionWorkEntry => e !== null && !(e as Record<string, unknown>).consumed);
  } catch {
    return [];
  }
}

/**
 * Mark verdicts as consumed after postflight processes them.
 * Rewrites the file with a `consumed: true` flag on each processed entry.
 */
export function markVerdictsConsumed(rootDir: string, nominationIds: string[]): void {
  try {
    const filePath = path.join(rootDir, VERDICTS_LOG_FILE);
    if (!fs.existsSync(filePath)) return;
    const consumed = new Set(nominationIds);
    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(l => l.trim());
    const updated = lines.map(line => {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (entry.nominationId && consumed.has(entry.nominationId as string)) {
          return JSON.stringify({ ...entry, consumed: true });
        }
        return line;
      } catch { return line; }
    });
    fs.writeFileSync(filePath, updated.join('\n') + '\n', 'utf8');
  } catch {
    // Non-fatal
  }
}

// ── Durable Iteration Revisions ───────────────────────────────────────
// Agent belief-revisions from iteration loops. Separate durable channel from
// verdicts.jsonl (human provenance). Written by the orchestrator, consumed by
// the postflight learning pass into `self_reflection` journal entries.

/**
 * Read all unconsumed iteration-revision records.
 */
export function readPendingIterationRevisions(rootDir: string): IterationRevisionEntry[] {
  try {
    const filePath = path.join(rootDir, ITERATION_REVISIONS_FILE);
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8')
      .trim()
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try { return JSON.parse(line) as IterationRevisionEntry; }
        catch { return null; }
      })
      .filter((e): e is IterationRevisionEntry =>
        e !== null && e.type === 'iteration-revision' && !e.consumed);
  } catch {
    return [];
  }
}

/**
 * Mark iteration-revision records consumed after postflight processes them.
 */
export function markIterationRevisionsConsumed(rootDir: string, ids: string[]): void {
  try {
    const filePath = path.join(rootDir, ITERATION_REVISIONS_FILE);
    if (!fs.existsSync(filePath)) return;
    const consumed = new Set(ids);
    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(l => l.trim());
    const updated = lines.map(line => {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (entry.id && consumed.has(entry.id as string)) {
          return JSON.stringify({ ...entry, consumed: true });
        }
        return line;
      } catch { return line; }
    });
    fs.writeFileSync(filePath, updated.join('\n') + '\n', 'utf8');
  } catch {
    // Non-fatal
  }
}

// ── Queries ──────────────────────────────────────────────────────────

/**
 * Get unique agent IDs that contributed this session.
 */
export function getContributingAgents(rootDir: string): string[] {
  const entries = readSessionWorkLog(rootDir);
  const agents = new Set<string>();
  for (const entry of entries) {
    if (entry.agent) agents.add(entry.agent);
  }
  return Array.from(agents);
}

/**
 * Get all entries for a specific agent (contributions + verdicts).
 */
export function getAgentEntries(rootDir: string, agentId: string): SessionWorkEntry[] {
  return readSessionWorkLog(rootDir).filter(e => e.agent === agentId);
}

/**
 * Get contribution-verdict pairs for an agent.
 * Matches contributions to subsequent verdicts by agent name.
 */
export function getAgentVerdicts(rootDir: string, agentId: string): Array<{
  contribution?: SessionWorkEntry;
  verdict?: SessionWorkEntry;
}> {
  const entries = getAgentEntries(rootDir, agentId);
  const contributions = entries.filter(e => e.type === 'agent-contribution');
  const verdicts = entries.filter(e => e.type === 'user-verdict');

  // Pair contributions with verdicts (simple sequential matching)
  const pairs: Array<{ contribution?: SessionWorkEntry; verdict?: SessionWorkEntry }> = [];

  for (const contrib of contributions) {
    pairs.push({ contribution: contrib });
  }
  for (const verdict of verdicts) {
    // Try to match to an unpaired contribution
    const unpaired = pairs.find(p => !p.verdict && p.contribution);
    if (unpaired) {
      unpaired.verdict = verdict;
    } else {
      pairs.push({ verdict });
    }
  }

  return pairs;
}

// ── Activity Metrics ─────────────────────────────────────────────────

/**
 * Record an activity metric for the current session.
 * Stored in a separate metrics file alongside the session log.
 * Non-fatal — failure is silently ignored.
 *
 * NOTE: No dollar figures, no token counts. These are proxy metrics
 * for understanding session scope (how much work was done), not billing.
 */
export function recordActivityMetric(rootDir: string, metric: Omit<ActivityMetric, 'timestamp' | 'type'>): void {
  try {
    const filePath = path.join(rootDir, SESSION_METRICS_FILE);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const entry: ActivityMetric = {
      timestamp: new Date().toISOString(),
      type: 'activity',
      ...metric,
    };

    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(filePath, line, 'utf8');
  } catch {
    // Non-fatal — metrics are advisory
  }
}

/**
 * Read all activity metrics from the current session.
 */
function readActivityMetrics(rootDir: string): ActivityMetric[] {
  try {
    const filePath = path.join(rootDir, SESSION_METRICS_FILE);
    if (!fs.existsSync(filePath)) return [];

    return fs.readFileSync(filePath, 'utf8')
      .trim()
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try { return JSON.parse(line) as ActivityMetric; }
        catch { return null; }
      })
      .filter((e): e is ActivityMetric => e !== null && e.type === 'activity');
  } catch {
    return [];
  }
}

/**
 * Aggregate all activity metrics into a session summary.
 * Returns proxy metrics — not billing data.
 */
export function getSessionActivitySummary(rootDir: string): SessionActivitySummary {
  const metrics = readActivityMetrics(rootDir);

  const summary: SessionActivitySummary = {
    toolCallCount: 0,
    responsePayloadBytes: 0,
    sessionDurationMs: 0,
    agentBreakdown: {},
  };

  for (const metric of metrics) {
    if (metric.toolCallCount != null) {
      summary.toolCallCount += metric.toolCallCount;
    }
    if (metric.responsePayloadBytes != null) {
      summary.responsePayloadBytes += metric.responsePayloadBytes;
    }
    if (metric.sessionDurationMs != null) {
      // Take the max duration rather than summing (each metric may report elapsed time)
      summary.sessionDurationMs = Math.max(summary.sessionDurationMs, metric.sessionDurationMs);
    }

    // Per-agent breakdown
    if (metric.agentId) {
      if (!summary.agentBreakdown[metric.agentId]) {
        summary.agentBreakdown[metric.agentId] = { toolCalls: 0, payloadBytes: 0 };
      }
      const agentEntry = summary.agentBreakdown[metric.agentId];
      if (metric.toolCallCount != null) agentEntry.toolCalls += metric.toolCallCount;
      if (metric.responsePayloadBytes != null) agentEntry.payloadBytes += metric.responsePayloadBytes;
    }
  }

  return summary;
}

/**
 * Clear activity metrics. Called at session start alongside clearSessionWorkLog.
 */
export function clearActivityMetrics(rootDir: string): void {
  try {
    const filePath = path.join(rootDir, SESSION_METRICS_FILE);
    if (fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '', 'utf8');
    }
  } catch {
    // Non-fatal
  }
}

// ── Notebook Reference Tracking ──────────────────────────────────────────────

/**
 * Record which notebook entries were injected into an agent's prompt
 * during orchestration. Pure data collection — no scoring.
 * Non-fatal — failure is silently ignored.
 */
export function recordNotebookReference(
  rootDir: string,
  agentId: string,
  entryIds: string[],
  orchestrationId?: string
): void {
  try {
    if (entryIds.length === 0) return;

    const filePath = path.join(rootDir, NOTEBOOK_REFS_FILE);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const entry: NotebookReferenceEntry = {
      timestamp: new Date().toISOString(),
      type: 'notebook-reference',
      agentId,
      notebookEntryIds: entryIds,
      ...(orchestrationId ? { orchestrationId } : {}),
    };

    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(filePath, line, 'utf8');
  } catch {
    // Non-fatal — reference tracking is advisory
  }
}

/**
 * Read all notebook reference entries from the current session.
 * Used for analysis and surfacing in paradigm_status.
 */
export function getNotebookReferences(rootDir: string): NotebookReferenceEntry[] {
  try {
    const filePath = path.join(rootDir, NOTEBOOK_REFS_FILE);
    if (!fs.existsSync(filePath)) return [];

    return fs.readFileSync(filePath, 'utf8')
      .trim()
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try { return JSON.parse(line) as NotebookReferenceEntry; }
        catch { return null; }
      })
      .filter((e): e is NotebookReferenceEntry => e !== null && e.type === 'notebook-reference');
  } catch {
    return [];
  }
}

/**
 * Count total notebook references in the current session.
 * Convenience function for status output.
 */
export function countNotebookReferences(rootDir: string): number {
  return getNotebookReferences(rootDir).length;
}
