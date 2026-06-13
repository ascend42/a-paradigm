/**
 * CLI Orchestrator Task-Bridge (#task-bridge)
 *
 * Closes the v7 learning loop for the standalone CLI orchestrator path. The MCP
 * orchestrator already emits a claimant-owned task DAG (epic + stage children)
 * via `emitTaskDag`; settlement fires automatically inside
 * `task-loader.updateTask` when a child reaches a terminal status AND has a
 * `parentTaskId`. The CLI orchestrator (Orchestrator / BackgroundOrchestrator)
 * completes purely in-memory and emits NO tasks, so its runs never settle and
 * the learning chain never fires.
 *
 * This thin adapter mirrors the MCP path for the CLI:
 *   - `bridgeRunStart`     — create the epic + one child task per stage
 *   - `bridgeStageProgress`— flip a stage child to in-progress
 *   - `bridgeStageComplete`— flip a stage child to done/shelved (TERMINAL →
 *                            triggers settlement on the last child)
 *
 * It deliberately reuses the LOW-LEVEL task-loader primitives (createTask /
 * updateTask / completeTask) rather than the MCP `emitTaskDag`, which is coupled
 * to the MCP planner's plan shape.
 *
 * Import precedent: the CLI bundles paradigm-mcp source via tsup
 * `noExternal: [/^@a-company\//]`, and core/habits/evaluator.ts already imports
 * from `paradigm-mcp/src/utils/...` over relative paths. We follow the same
 * precedent here (this file sits one level shallower — src/core/ — so the prefix
 * is `../../../` rather than the evaluator's `../../../../`).
 *
 * ── Best-effort isolation ──
 * Every exported function is fully wrapped so a task-write failure NEVER
 * propagates into the actual CLI orchestration run. `bridgeRunStart` degrades to
 * `{ epicTaskId: undefined, stageTaskIds: [] }`; the progress/complete helpers
 * resolve to `false`. The CLI run behaves identically whether the bridge
 * succeeds or throws.
 */

// Relative-path imports into bundled paradigm-mcp source (see file header).
import {
  createTask,
  updateTask,
  completeTask,
} from '../../../paradigm-mcp/src/utils/task-loader.js';
import { log } from '../../../paradigm-mcp/src/utils/mcp-logger.js';

/**
 * A stage in the CLI orchestrator's plan, reduced to what the bridge needs to
 * emit a task: the agent that owns it, its stage index, and the upstream agent
 * names it depends on (handoff edges). Mirrors the fields the CLI orchestrator's
 * `planAgentSequence`/`groupByStage` already produce.
 */
export interface BridgeStage {
  /** Archetype/agent name (e.g. 'architect', 'builder'). Owns the task. */
  agent: string;
  /** Stage index in the topo-sorted plan. */
  stage: number;
  /** The concrete subtask text for this stage-agent. */
  subtask: string;
  /** Upstream AGENT NAMES this stage depends on (resolved → task-ids here). */
  dependsOn: string[];
}

/**
 * Handle returned by `bridgeRunStart`. `epicTaskId` is the orchestration root;
 * `stageTaskIds` maps an agent name → its emitted child task-id so call sites
 * can progress/complete the right stage. Empty when emission degraded.
 */
export interface BridgeHandle {
  epicTaskId?: string;
  /** agent name → stage child task-id. */
  stageTaskIds: Map<string, string>;
}

/**
 * Create the orchestration task DAG: one epic (in-progress, no parent) plus one
 * child per stage (parentTaskId=epic, stage, archetype claimant, dependsOn
 * resolved to upstream task-ids). Mirrors `emitTaskDag`'s field choices for
 * cross-path consistency.
 *
 * Best-effort: never throws. On any failure returns an empty handle and the CLI
 * orchestration proceeds unaffected.
 */
export async function bridgeRunStart(
  rootDir: string,
  orchestrationId: string,
  task: string,
  stages: BridgeStage[],
): Promise<BridgeHandle> {
  const stageTaskIds = new Map<string, string>();
  let epicTaskId: string | undefined;

  try {
    // 1. Epic task — the orchestration root. No parentTaskId; in-progress.
    epicTaskId = await createTask(rootDir, {
      blurb: task,
      priority: 'medium',
      tags: ['orchestration', 'epic'],
      claimant: { kind: 'archetype', ref: 'orchestrator' },
      external_ref: { kind: 'orchestration', ref: orchestrationId },
    });
    // createTask always lands at 'open'; promote the epic to in-progress
    // (open→in-progress is a legal transition; failure is non-fatal).
    try {
      await updateTask(rootDir, epicTaskId, { status: 'in-progress' });
    } catch (err) {
      log.flow('$cli-task-bridge').warn('Epic promote to in-progress failed', {
        orchestrationId,
        epicTaskId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 2. Child task per stage, in topo (stage) order so upstream agents are
    //    emitted before the stages that depend on them — lets dependsOn agent
    //    names resolve to already-emitted task-ids.
    const ordered = [...stages].sort((a, b) => a.stage - b.stage);
    for (const s of ordered) {
      try {
        const dependsOn = (s.dependsOn || [])
          .map((name) => stageTaskIds.get(name))
          .filter((id): id is string => typeof id === 'string');

        const childId = await createTask(rootDir, {
          blurb: s.subtask,
          priority: 'medium',
          tags: ['orchestration'],
          claimant: { kind: 'archetype', ref: s.agent },
          parentTaskId: epicTaskId,
          stage: s.stage,
          ...(dependsOn.length > 0 ? { dependsOn } : {}),
          external_ref: { kind: 'orchestration', ref: orchestrationId },
        });
        // status stays 'open' (not-yet-started); progressed/completed later.
        stageTaskIds.set(s.agent, childId);
      } catch (err) {
        // A single child write failure must not abort the rest of the DAG.
        log.flow('$cli-task-bridge').warn('Stage task emission failed', {
          orchestrationId,
          agent: s.agent,
          stage: s.stage,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    log.flow('$cli-task-bridge').info('Emitted CLI orchestration task DAG', {
      orchestrationId,
      epicTaskId,
      stageTasks: stageTaskIds.size,
    });
  } catch (err) {
    // Whole-emission failure (e.g. epic write threw) — degrade gracefully.
    log.flow('$cli-task-bridge').warn('CLI task DAG emission failed; orchestration continues', {
      orchestrationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { epicTaskId, stageTaskIds };
}

/**
 * Mark a stage child as in-progress (open→in-progress). Best-effort: a no-op
 * (resolves false) when `taskId` is undefined or the write fails. Never throws.
 */
export async function bridgeStageProgress(
  rootDir: string,
  taskId: string | undefined,
): Promise<boolean> {
  if (!taskId) return false;
  try {
    return await updateTask(rootDir, taskId, { status: 'in-progress' });
  } catch (err) {
    log.flow('$cli-task-bridge').warn('Stage progress update failed (non-fatal)', {
      taskId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Mark a stage child TERMINAL — `done` on success, `shelved` on failure. This is
 * the write that triggers settlement: when the LAST stage child of an epic goes
 * terminal, `task-loader.updateTask`'s settlement hook fires
 * `settleParentIfComplete` on the epic, which stamps `settledAt` and runs the
 * learning chain (recordWorkLog → postflight → journal promotion) with a
 * settlement-liveness record.
 *
 * Best-effort: a no-op (resolves false) when `taskId` is undefined or the write
 * fails. Never throws.
 */
export async function bridgeStageComplete(
  rootDir: string,
  taskId: string | undefined,
  outcome: 'success' | 'failure',
): Promise<boolean> {
  if (!taskId) return false;
  try {
    if (outcome === 'success') {
      return await completeTask(rootDir, taskId);
    }
    // failure → terminal 'shelved' (still terminal, so settlement can complete).
    return await updateTask(rootDir, taskId, {
      status: 'shelved',
      shelved: new Date().toISOString(),
    });
  } catch (err) {
    log.flow('$cli-task-bridge').warn('Stage complete update failed (non-fatal)', {
      taskId,
      outcome,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
