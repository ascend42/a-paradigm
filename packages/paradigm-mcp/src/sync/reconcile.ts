/**
 * Reconcile (#task-sync, Phase 2b) — the PURE brain of inbound two-way sync.
 *
 * `reconcile(local, remote)` compares a local task against a provider-agnostic
 * RemoteState and returns a PLAN naming the intended local change. It NEVER
 * writes, never touches fs/network, and is fully deterministic — so it can be
 * unit-tested in isolation and the applier (sync-layer) is the only thing that
 * mutates, exclusively through the enforced `updateTask` state machine.
 *
 * Policy (TD: two-way sync): the local store is CANONICAL. A remote change only
 * applies when the implied local transition is LEGAL per `assertTransition`;
 * an illegal implication is surfaced as a CONFLICT (local wins), never forced.
 * SYMMETRIC REOPEN (Matt's call): a remote-open issue while local is terminal
 * drives a reopen — legal now that `done → open` is a transition.
 *
 * Only STRUCTURED remote fields are read (state/labels/assignees) — never the
 * free-text body — so a pull can't inject content into an enforced task field.
 */

import type { Task, TaskStatus } from '../utils/task-loader.js';
import { assertTransition } from '../utils/task-loader.js';
import type { RemoteState } from './provider.js';

/** Marker reason for a blocked_on that originated from a GitHub label (so we own clearing it). */
export const BLOCKED_FROM_REMOTE = '(blocked on GitHub)';

export interface ReconcilePlan {
  taskId: string;
  /** agree = nothing to do; apply = a legal change to write; conflict = remote disagrees, local wins. */
  kind: 'agree' | 'apply' | 'conflict';
  /** Target local status to write through the enforced path, if the state changed. */
  targetStatus?: TaskStatus;
  /** blocked_on change (set a remote-origin reason, or clear a remote-origin one). */
  blocked?: { set?: string; clear?: true };
  /** Advisory notes the user sees — assignee differences, conflicts. Never auto-applied. */
  drift: string[];
}

/**
 * Compute the reconcile plan. Pure. The applier executes `targetStatus` via the
 * matching enforced writer (completeTask / shelveTask / updateTask-reopen) and
 * `blocked` via updateTask.
 */
export function reconcile(local: Task, remote: RemoteState): ReconcilePlan {
  const plan: ReconcilePlan = { taskId: local.id, kind: 'agree', drift: [] };
  const labels = remote.labels.map(l => l.toLowerCase());

  // ── State ──
  let targetStatus: TaskStatus | undefined;
  if (remote.status === 'closed') {
    targetStatus = remote.closedReason === 'not-planned' ? 'shelved' : 'done';
  } else if (local.status === 'done' || local.status === 'shelved') {
    // Remote is open but local is terminal → symmetric REOPEN.
    targetStatus = 'open';
  }

  if (targetStatus && targetStatus !== local.status) {
    if (assertTransition(local.status, targetStatus)) {
      plan.kind = 'apply';
      plan.targetStatus = targetStatus;
    } else {
      plan.kind = 'conflict';
      plan.drift.push(
        `GitHub implies "${targetStatus}" but the task is "${local.status}" — illegal transition, local wins. ` +
        (targetStatus === 'done' ? 'Reopen the task first, or close the issue once the work is really done.' : 'Resolve manually.'),
      );
    }
  }

  // ── blocked label ↔ blocked_on (only the remote-origin marker round-trips) ──
  const remoteBlocked = labels.includes('blocked');
  if (remoteBlocked && !local.blocked_on) {
    plan.blocked = { set: BLOCKED_FROM_REMOTE };
    if (plan.kind === 'agree') plan.kind = 'apply';
  } else if (!remoteBlocked && local.blocked_on === BLOCKED_FROM_REMOTE) {
    plan.blocked = { clear: true };
    if (plan.kind === 'agree') plan.kind = 'apply';
  }
  // A locally-authored blocked_on (not the remote marker) is never clobbered by a pull.

  // ── Assignee (advisory-only inbound — a bare login can't reconstruct claimant.kind) ──
  if (remote.assignees.length > 0 && !local.claimant) {
    plan.drift.push(`GitHub assignee ${remote.assignees.join(', ')} — not reflected locally (assignee→claimant is advisory; claim it locally to own it).`);
  } else if (remote.assignees.length === 0 && local.claimant?.kind === 'human') {
    plan.drift.push(`Local claimant ${local.claimant.ref} has no GitHub assignee.`);
  }

  return plan;
}
