/**
 * Task Settlement — #task-settlement (v7 §2-rev2, the learning-loop closure).
 *
 * When every sibling under a parent task reaches a terminal state, the parent
 * *settles*: it runs the wired learning chain exactly once and stamps
 * `settledAt`. This is the joint the audit found open — today `task_done` feeds
 * nothing. Settlement makes the framework's "self-improving" claim falsifiable
 * via a per-stage liveness probe (`.paradigm/events/settlement-liveness.jsonl`).
 *
 * Ownership boundary (Cid ↔ Loid): settlement writes ONLY `settledAt` + the
 * crash/orphan markers on the parent and the learning stores. It NEVER writes
 * live `status`. The dependency arrow is one-way: status → settlement → learning.
 *
 * Scope (v7.0): MCP-world only. The CLI orchestrator's in-memory `markComplete`
 * is fast-follow (a thin `core/task-bridge.ts` adapter — see §2.1).
 *
 * Circular-import note: this module imports `task-loader` and `task-loader`'s
 * `updateTask` calls back into here. The hook side uses a lazy/dynamic import
 * (see task-loader.ts) to break the cycle at module-eval time; this module may
 * import task-loader statically because task-loader does NOT import this one
 * statically.
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from './mcp-logger.js';
import { loadTask, loadTasks, type Task, type TaskStatus } from './task-loader.js';
import { recordOrchestrationCompletion } from './orchestration-marker.js';

const LIVENESS_FILE = '.paradigm/events/settlement-liveness.jsonl';

/** Default staleness window for the reaper, in minutes. Env-overridable. */
const DEFAULT_STALE_MINUTES = 30;

// ── Terminal predicate (forward-compatible) ───────────────

/**
 * Terminal status set, written as a predicate so adding `blocked-permanent`
 * later is a one-line edit. v7.0 statuses are `open|in-progress|done|shelved`;
 * `crashed` is an internal settle-state the reaper records as `crashed_at` on a
 * `shelved`-status node (see task-loader Task.crashed_at). Listing it here keeps
 * intent legible and is harmless if `crashed` ever becomes a real status.
 */
const TERMINAL_STATUSES = new Set<string>(['done', 'shelved', 'crashed']);

/** A status (not a task) is terminal. Used to gate the loader hook. */
export function isTerminal(status: TaskStatus | string): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** A whole task is terminal: terminal status OR a reaper crash marker. */
function isTaskTerminal(task: Task): boolean {
  return isTerminal(task.status) || !!task.crashed_at;
}

// ── Liveness probe record ─────────────────────────────────

type StageOutcome = 'ok' | 'threw' | 'skipped';
type SettledAs = 'done' | 'shelved' | 'crashed' | 'orphan';

interface LivenessRecord {
  ts: string;
  parentTaskId: string;
  settledAs: SettledAs;
  stages: {
    recordWorkLog: StageOutcome;
    runPostflightLearning: StageOutcome;
    autoPromoteJournalEntries: StageOutcome;
  };
  journalsWritten: number;
  promoted: number;
  /** Every non-skipped stage === 'ok'. The falsifiable health signal. */
  chainLive: boolean;
}

function appendLiveness(rootDir: string, record: LivenessRecord): void {
  try {
    const filePath = path.join(rootDir, LIVENESS_FILE);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf8');
  } catch (err) {
    // The probe is best-effort; a probe-write failure must never break settlement.
    log.component('#task-settlement').warn('Failed to append liveness record', {
      parentTaskId: record.parentTaskId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function chainLive(stages: LivenessRecord['stages']): boolean {
  return Object.values(stages).every(s => s === 'skipped' || s === 'ok');
}

// ── Reaper — stale in-progress → terminal crashed ─────────

function staleWindowMs(): number {
  const env = process.env.PARADIGM_REAPER_STALE_MINUTES;
  const minutes = env && !Number.isNaN(Number(env)) ? Number(env) : DEFAULT_STALE_MINUTES;
  return minutes * 60 * 1000;
}

/**
 * Reap abandoned `in-progress` tasks whose run died (v7.0 liveness = time-window
 * only; PID/heartbeat is fast-follow). Any `in-progress` task whose `started_at`
 * is older than the staleness window is transitioned to a terminal crash state:
 * `status:'shelved'` (a real terminal status, legal from in-progress) PLUS
 * `crashed_at` + `crash_reason` markers so the subtree settles AND the liveness
 * probe still fires for the crashed node.
 *
 * Invoked at the start of each settlement pass; exported so a future session-open
 * hook can sweep on open.
 *
 * @returns the ids of tasks that were reaped this pass.
 */
export async function reapStaleInProgress(rootDir: string): Promise<string[]> {
  const now = Date.now();
  const cutoff = staleWindowMs();
  const reaped: string[] = [];

  let tasks: Task[];
  try {
    tasks = await loadTasks(rootDir, { status: 'in-progress', limit: 9999 });
  } catch {
    return reaped;
  }

  // Lazy import to mirror the hook side and keep the cycle one-directional.
  const { updateTask } = await import('./task-loader.js');

  for (const task of tasks) {
    if (task.status !== 'in-progress') continue;
    if (task.crashed_at) continue; // already reaped
    const started = task.started_at ? new Date(task.started_at).getTime() : NaN;
    // No started_at → can't age it out (defensive); leave for a human/Cid.
    if (Number.isNaN(started)) continue;
    if (now - started < cutoff) continue;

    const crashedAt = new Date().toISOString();
    const ok = await updateTask(rootDir, task.id, {
      status: 'shelved',
      crashed_at: crashedAt,
      crash_reason: 'reaper:stale-in-progress',
      shelved: crashedAt,
    });
    if (ok) {
      reaped.push(task.id);
      log.component('#task-settlement').warn('Reaped stale in-progress task', {
        taskId: task.id, startedAt: task.started_at, reason: 'reaper:stale-in-progress',
      });
    }
  }

  return reaped;
}

// ── Settlement ────────────────────────────────────────────

/**
 * Settle a parent if every sibling under it is terminal. Idempotent: early-return
 * when `parent.settledAt` is already stamped.
 *
 * Orphan policy: if `parentTaskId` is set but the parent fails to load, the
 * referenced *child* self-settles (runs its own chain as a leaf), stamps
 * `settledAt`, and logs `orphan:missing-parent`.
 *
 * @param parentTaskId the task whose children should be checked. (From the hook
 *   this is `updated.parentTaskId` — i.e. the PARENT of the task that just went
 *   terminal.)
 * @param orphanChildId optional id of the child that triggered this pass (the
 *   hook passes `updated.id`). Used only for the orphan path: when `parentTaskId`
 *   doesn't load, THIS child self-settles as a leaf.
 */
export async function settleParentIfComplete(
  rootDir: string,
  parentTaskId: string,
  orphanChildId?: string,
): Promise<void> {
  if (!parentTaskId) return;

  // Reaper runs first so a dead in-progress sibling can't wedge the subtree.
  try {
    await reapStaleInProgress(rootDir);
  } catch (err) {
    log.component('#task-settlement').warn('Reaper pass failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const parent = await loadTask(rootDir, parentTaskId);

  // ── Orphan: the parent reference dangles. Self-settle the child as a leaf. ──
  if (!parent) {
    log.component('#task-settlement').warn('Orphan task: parent failed to load', {
      parentTaskId, orphanChildId, reason: 'orphan:missing-parent',
    });
    // The orphan IS the child that referenced the missing parent. It self-settles:
    // runs its own chain as a leaf, stamps settledAt + orphaned marker on ITSELF.
    const orphan = orphanChildId ? await loadTask(rootDir, orphanChildId) : null;
    if (orphan && orphan.settledAt) return; // idempotent on the orphan too
    await runSettlementChain(rootDir, parentTaskId, 'orphan', orphan ?? undefined, true);
    return;
  }

  // ── Idempotency ──
  if (parent.settledAt) return;

  // ── All-siblings-terminal trigger ──
  const siblings = (await loadTasks(rootDir, { status: 'all', limit: 9999 }))
    .filter(t => t.parentTaskId === parent.id);

  // No children at all → nothing to settle on this parent (it's a leaf itself).
  if (siblings.length === 0) return;
  if (!siblings.every(isTaskTerminal)) return;

  // Decide how the parent settled, for the probe + markers.
  const anyCrashed = siblings.some(s => s.crashed_at);
  const anyShelved = siblings.some(s => s.status === 'shelved' && !s.crashed_at);
  const settledAs: SettledAs = anyCrashed ? 'crashed' : anyShelved ? 'shelved' : 'done';

  await runSettlementChain(rootDir, parent.id, settledAs, parent);
}

/**
 * Run the wired learning chain for a settling parent, with each stage wrapped in
 * its own try/catch, record the per-stage liveness in a `finally` (so a mid-chain
 * throw still records WHICH stage died), then stamp `settledAt` (+ crash/orphan
 * markers) on the parent.
 *
 * Chain (this round — no debrief; that's Cid/Round 4b):
 *   recordWorkLog → runPostflightLearning → autoPromoteJournalEntries
 */
async function runSettlementChain(
  rootDir: string,
  parentTaskId: string,
  settledAs: SettledAs,
  parent: Task | undefined,
  isOrphan = false,
): Promise<void> {
  const stages: LivenessRecord['stages'] = {
    recordWorkLog: 'skipped',
    runPostflightLearning: 'skipped',
    autoPromoteJournalEntries: 'skipped',
  };
  let journalsWritten = 0;
  let promoted = 0;

  // T-013 (Loid past-tense, TD-2026-06-14-467): claimant-accuracy guard. The
  // learning this settlement promotes must attribute to the agent that actually
  // did the work. An epic is typically claimed by a generic 'orchestrator' (or
  // unclaimed), so settling under it would credit the wrong notebook. When the
  // parent's claimant is absent or the generic orchestrator, re-attribute to the
  // DOMINANT child archetype (the one that owns the most child tasks).
  let claimantRef = parent?.claimant?.ref;
  if (!claimantRef || claimantRef === 'orchestrator') {
    try {
      const { loadTasks } = await import('./task-loader.js');
      const children = (await loadTasks(rootDir, { status: 'all', limit: 9999 }))
        .filter(t => t.parentTaskId === parentTaskId && t.claimant?.kind === 'archetype');
      const counts = new Map<string, number>();
      for (const c of children) counts.set(c.claimant!.ref, (counts.get(c.claimant!.ref) ?? 0) + 1);
      const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (dominant) claimantRef = dominant[0];
    } catch {
      /* fall through to the orchestrator default */
    }
  }
  claimantRef = claimantRef ?? 'orchestrator';

  try {
    // ── Stage 1: recordWorkLog (work-log-loader) ──
    try {
      const { recordWorkLog } = await import('./work-log-loader.js');
      recordWorkLog(rootDir, {
        agent: claimantRef,
        task_ref: parentTaskId,
        summary: `Settlement of task DAG ${parentTaskId} (${settledAs})`,
        outcome: settledAs === 'done' ? 'pass' : settledAs === 'orphan' ? 'partial' : 'partial',
        symbols_touched: [],
      });
      stages.recordWorkLog = 'ok';
    } catch (err) {
      stages.recordWorkLog = 'threw';
      log.component('#task-settlement').warn('Settlement stage threw: recordWorkLog', {
        parentTaskId, error: err instanceof Error ? err.message : String(err),
      });
    }

    // ── Stage 2: runPostflightLearning (ambient) ──
    try {
      const { runPostflightLearning } = await import('../tools/ambient.js');
      const result = await runPostflightLearning(rootDir, { claimant: claimantRef });
      journalsWritten = result.journalsWritten ?? 0;
      promoted = result.promoted ?? 0;
      stages.runPostflightLearning = 'ok';
    } catch (err) {
      stages.runPostflightLearning = 'threw';
      log.component('#task-settlement').warn('Settlement stage threw: runPostflightLearning', {
        parentTaskId, error: err instanceof Error ? err.message : String(err),
      });
    }

    // ── Stage 3: autoPromoteJournalEntries (nomination-engine) ──
    // runPostflightLearning already promotes per-agent; this is the explicit
    // belt-and-suspenders promotion for the parent's claimant, and the stage the
    // probe asserts is live (a reviewer can sever it and watch the probe scream).
    try {
      const { autoPromoteJournalEntries } = await import('./nomination-engine.js');
      const res = autoPromoteJournalEntries(rootDir, claimantRef);
      promoted += res.promoted ?? 0;
      stages.autoPromoteJournalEntries = 'ok';
    } catch (err) {
      stages.autoPromoteJournalEntries = 'threw';
      log.component('#task-settlement').warn('Settlement stage threw: autoPromoteJournalEntries', {
        parentTaskId, error: err instanceof Error ? err.message : String(err),
      });
    }

    // ── Adjacent: aggregate-on-settle (#calibration, governance T-011) ──
    // Fold the actuals captured during this run into the learned token table so
    // story-points stay current WITHOUT a manual `paradigm calibrate`. This
    // closes the calibration half of the loop the same moment the learning half
    // settles. Best-effort, idempotent, never breaks settlement. Not a tracked
    // liveness stage — the probe asserts the learning chain; this is adjacent.
    try {
      const { rebuildLearnedTable } = await import('./calibration-aggregate.js');
      const res = rebuildLearnedTable(rootDir);
      if (res) {
        log.component('#calibration').info('Calibration refreshed on settle', {
          parentTaskId,
          samplesRead: res.samplesRead,
          learnedCells: res.groups.filter(g => g.learned).length,
        });
      }
    } catch (err) {
      log.component('#calibration').warn('Aggregate-on-settle failed (non-fatal)', {
        parentTaskId, error: err instanceof Error ? err.message : String(err),
      });
    }
  } finally {
    const live = chainLive(stages);
    const record: LivenessRecord = {
      ts: new Date().toISOString(),
      parentTaskId,
      settledAs,
      stages,
      journalsWritten,
      promoted,
      chainLive: live,
    };
    appendLiveness(rootDir, record);

    // Enforcement marker (T-005): a settlement whose learning chain ran
    // end-to-end (chainLive) is the PRIMARY v7-native "real work completed"
    // signal. Only then do we satisfy the Stop-hook orchestration gate. A
    // mid-chain throw (chainLive===false) deliberately writes no marker — no
    // real cross-check occurred. `verdicts` = count of non-skipped 'ok' stages.
    if (live) {
      const verdicts = Object.values(stages).filter(s => s === 'ok').length;
      recordOrchestrationCompletion(rootDir, { verdicts, source: 'settlement' });
    }

    // Calibration capture (Part F) — write-only, gated on cheapness. See note in
    // the build report: deferred wholesale in v7.0 (no cheap actuals projection).

    // Stamp settledAt (+ markers) on the settling node. In the normal path this is
    // the parent; in the orphan path `parent` is the orphan CHILD that self-settled
    // (we couldn't load its missing parent). A pure-orphan beat with no loadable
    // child has nothing to stamp — only the liveness record is written.
    if (parent) {
      try {
        const { updateTask } = await import('./task-loader.js');
        const markers: Partial<Task> = { settledAt: new Date().toISOString() };
        if (settledAs === 'crashed') markers.crash_reason = parent.crash_reason ?? 'reaper:stale-in-progress';
        if (isOrphan) markers.orphaned = true;
        await updateTask(rootDir, parent.id, markers);
      } catch (err) {
        log.component('#task-settlement').warn('Failed to stamp settledAt', {
          parentTaskId, error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
