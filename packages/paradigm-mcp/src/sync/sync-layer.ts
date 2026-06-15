/**
 * Sync layer (#task-sync, Phase 2b two-way) — the executor that sits ONE layer
 * ABOVE the task-loader. The loader stays pure (never imports a provider); the
 * callers that already own an enforced write (CLI verbs, the web write router)
 * invoke this layer right after the write commits.
 *
 *  - projectTransition(): OUTBOUND. Best-effort push of a just-applied task
 *    transition onto the linked external item. Never throws, never rolls back —
 *    a gh failure leaves the local write intact and the item push-pending.
 *  - syncTask() / syncAllLinked(): INBOUND. pull → reconcile → apply, where the
 *    apply mutates ONLY through updateTask/completeTask/shelveTask, so
 *    assertTransition + settlement fire identically to any other write. A pull
 *    can NEVER bypass the state machine.
 *
 * Only the providers a CLI/server opts into are loaded (github here); the core
 * never reaches this module.
 */

import { loadTask, loadTasks, updateTask, completeTask, shelveTask, type Task } from '../utils/task-loader.js';
import { log } from './../utils/mcp-logger.js';
import { getProvider } from './registry.js';
import { projectClaimant } from './claimant-projection.js';
import { reconcile, type ReconcilePlan } from './reconcile.js';
import type { SyncProvider } from './provider.js';

/** A task transition that should project to the linked external item. */
export type SyncEvent = 'claim' | 'start' | 'done' | 'shelved' | 'reopen' | 'block' | 'unblock';

const IN_PROGRESS_LABEL = 'in progress';
const BLOCKED_LABEL = 'blocked';

/** Load + return a registered provider, importing github for its self-registration. */
async function syncProvider(providerId: string): Promise<SyncProvider | undefined> {
  if (providerId === 'github') {
    try { await import('./providers/github.js'); } catch { /* not bundled */ }
  }
  return getProvider(providerId);
}

/** Run a single best-effort provider action; a failure is logged, never thrown. */
async function best(label: string, taskId: string, fn: () => Promise<void> | undefined): Promise<void> {
  try { await fn(); } catch (err) {
    log.component('#task-sync').warn(`sync action failed: ${label}`, {
      taskId, error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * OUTBOUND: project a just-applied task transition onto its linked external item.
 * No external_ref / no provider / offline ⇒ zero-cost no-op. Best-effort: the
 * canonical local write already committed; a gh failure never undoes it.
 */
export async function projectTransition(
  rootDir: string,
  taskId: string,
  event: SyncEvent,
  opts: { reason?: string } = {},
): Promise<void> {
  try {
    const task = await loadTask(rootDir, taskId);
    const ref = task?.external_ref;
    if (!task || !ref?.provider) return;

    const provider = await syncProvider(ref.provider);
    if (!provider || !provider.capabilities().push) return;
    if (!(await provider.isAvailable())) return;

    switch (event) {
      case 'claim': {
        const proj = projectClaimant(task.claimant);
        if (proj.assignee) await best('assignee', taskId, () => provider.edit?.(ref, { addAssignee: '@me' }));
        else if (task.claimant) await best('agent-label', taskId, () => provider.edit?.(ref, { addLabels: [`paradigm:${task.claimant!.kind}/${task.claimant!.ref}`] }));
        break;
      }
      case 'start':
        await best('label:in-progress', taskId, () => provider.edit?.(ref, { addLabels: [IN_PROGRESS_LABEL] }));
        break;
      case 'done':
        await best('label:rm-in-progress', taskId, () => provider.edit?.(ref, { removeLabels: [IN_PROGRESS_LABEL] }));
        await best('close:completed', taskId, () => provider.close?.(ref));
        break;
      case 'shelved':
        await best('close:not-planned', taskId, () => provider.close?.(ref, 'not-planned'));
        break;
      case 'reopen':
        await best('reopen', taskId, () => provider.reopen?.(ref));
        await best('label:rm-in-progress', taskId, () => provider.edit?.(ref, { removeLabels: [IN_PROGRESS_LABEL] }));
        break;
      case 'block':
        await best('label:blocked', taskId, () => provider.edit?.(ref, { addLabels: [BLOCKED_LABEL] }));
        if (opts.reason) await best('comment:blocked', taskId, () => provider.comment?.(ref, `Blocked: ${opts.reason}`));
        break;
      case 'unblock':
        await best('label:rm-blocked', taskId, () => provider.edit?.(ref, { removeLabels: [BLOCKED_LABEL] }));
        break;
    }
  } catch (err) {
    log.component('#task-sync').warn('projectTransition failed (non-fatal)', {
      taskId, error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** The outcome of syncing one task inbound. */
export interface SyncVerdict {
  taskId: string;
  status: 'synced' | 'agree' | 'conflict' | 'offline' | 'remote-error' | 'unlinked' | 'no-pull';
  targetStatus?: string;
  drift: string[];
}

/** Apply a reconcile plan through the ENFORCED writers only. Never a raw write. */
async function applyPlan(rootDir: string, task: Task, plan: ReconcilePlan): Promise<boolean> {
  let applied = false;
  if (plan.targetStatus && plan.targetStatus !== task.status) {
    if (plan.targetStatus === 'done') applied = await completeTask(rootDir, task.id);
    else if (plan.targetStatus === 'shelved') applied = await shelveTask(rootDir, task.id);
    else applied = await updateTask(rootDir, task.id, { status: plan.targetStatus }); // 'open' = reopen
  }
  if (plan.blocked) {
    const ok = await updateTask(rootDir, task.id, { blocked_on: plan.blocked.clear ? undefined : plan.blocked.set });
    applied = applied || ok;
  }
  return applied;
}

/**
 * INBOUND: pull one linked task's remote state, reconcile, and apply the legal
 * plan through the enforced path. A conflict is surfaced, never forced.
 */
export async function syncTask(rootDir: string, taskId: string): Promise<SyncVerdict> {
  const task = await loadTask(rootDir, taskId);
  const ref = task?.external_ref;
  if (!task || !ref?.provider) return { taskId, status: 'unlinked', drift: [] };

  const provider = await syncProvider(ref.provider);
  if (!provider?.capabilities().pull || !provider.pull) return { taskId, status: 'no-pull', drift: [] };
  if (!(await provider.isAvailable())) return { taskId, status: 'offline', drift: [] };

  let remote;
  try {
    remote = await provider.pull(ref);
  } catch (err) {
    log.component('#task-sync').warn('pull failed', { taskId, error: err instanceof Error ? err.message : String(err) });
    return { taskId, status: 'remote-error', drift: [] };
  }

  const plan = reconcile(task, remote);
  if (plan.kind === 'conflict') return { taskId, status: 'conflict', drift: plan.drift };
  if (plan.kind === 'agree') return { taskId, status: 'agree', drift: plan.drift };

  const applied = await applyPlan(rootDir, task, plan);
  return { taskId, status: applied ? 'synced' : 'agree', targetStatus: plan.targetStatus, drift: plan.drift };
}

/** Sweep every linked task inbound. Per-task isolation — one failure never aborts the batch. */
export async function syncAllLinked(rootDir: string): Promise<SyncVerdict[]> {
  const tasks = await loadTasks(rootDir, { status: 'all', limit: 9999 });
  const linked = tasks.filter(t => t.external_ref?.provider === 'github');
  const verdicts: SyncVerdict[] = [];
  for (const t of linked) {
    try {
      verdicts.push(await syncTask(rootDir, t.id));
    } catch (err) {
      verdicts.push({ taskId: t.id, status: 'remote-error', drift: [String(err)] });
    }
  }
  return verdicts;
}
