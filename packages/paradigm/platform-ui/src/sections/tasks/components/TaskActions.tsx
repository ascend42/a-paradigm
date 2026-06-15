import React, { useState } from 'react';
import { useTasksStore, type Task } from '../store/tasksStore';

// TaskActions — the shared, status-aware write-verb row rendered by both the
// InboxView hero and the TaskDetailPanel header. It is the ONLY place in the
// Tasks UI that triggers mutations, and it respects the v7 task state machine
// so it never offers a verb that would 409:
//
//   open        → [Start] [Claim to me]* [Done] [Block]
//   in-progress → [Done] [Block]
//   done/shelved→ (terminal — no verbs)
//   blocked_on  → reason banner + [Unblock]  (orthogonal to status)
//
//   * "Claim to me" shows only when the task is unclaimed or already held by the
//     viewed claimant; it passes the human ref from /whoami (kind:'human').
//     A claim that would displace a human/peer is rejected by the backend (409)
//     and surfaces via store.actionError.

function sameClaimant(
  a: { kind: string; ref: string } | null | undefined,
  b: { kind: string; ref: string } | null | undefined
): boolean {
  return !!a && !!b && a.kind === b.kind && a.ref === b.ref;
}

export function TaskActions({ task }: { task: Task }) {
  const claimTask = useTasksStore((s) => s.claimTask);
  const startTask = useTasksStore((s) => s.startTask);
  const doneTask = useTasksStore((s) => s.doneTask);
  const blockTask = useTasksStore((s) => s.blockTask);
  const unblockTask = useTasksStore((s) => s.unblockTask);
  const whoami = useTasksStore((s) => s.whoami);
  const fetchWhoami = useTasksStore((s) => s.fetchWhoami);
  const actionError = useTasksStore((s) => s.actionError);
  const clearActionError = useTasksStore((s) => s.clearActionError);

  const [busy, setBusy] = useState(false);

  const isBlocked = !!(task.blocked_on && task.blocked_on.length > 0);
  const terminal = task.status === 'done' || task.status === 'shelved';
  const claimedByMe = sameClaimant(task.claimant, whoami);
  const claimable = !task.claimant || claimedByMe;

  // open → start/claim available; open|in-progress → done/block available.
  const canStart = task.status === 'open';
  const canClaim = task.status === 'open' && claimable;
  const canDoneOrBlock = task.status === 'open' || task.status === 'in-progress';

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const onClaim = async () => {
    const me = whoami ?? (await fetchWhoami());
    if (!me || !me.ref) {
      useTasksStore.setState({ actionError: 'Could not resolve your identity (whoami).' });
      return;
    }
    await run(() => claimTask(task.id, me.ref, 'human'));
  };

  const onBlock = async () => {
    const reason = window.prompt('Block reason:');
    if (reason == null || reason.trim() === '') return;
    await run(() => blockTask(task.id, reason.trim()));
  };

  const hasVerbs = !terminal && (canStart || canClaim || canDoneOrBlock);

  // Nothing to render: terminal status, not blocked, no error.
  if (!hasVerbs && !isBlocked && !actionError) return null;

  return (
    <div className="task-actions">
      {isBlocked && (
        <div className="task-actions__blocked">
          <span className="task-actions__blocked-glyph">⛔</span>
          <span className="task-actions__blocked-reason">
            {task.blocked_on}
          </span>
          <button
            className="task-action task-action--unblock"
            disabled={busy}
            onClick={() => run(() => unblockTask(task.id))}
          >
            Unblock
          </button>
        </div>
      )}

      {hasVerbs && (
        <div className="task-actions__row">
          {canStart && (
            <button
              className="task-action task-action--start"
              disabled={busy}
              onClick={() => run(() => startTask(task.id))}
            >
              Start
            </button>
          )}
          {canClaim && (
            <button
              className="task-action task-action--claim"
              disabled={busy}
              onClick={onClaim}
            >
              Claim to me
            </button>
          )}
          {canDoneOrBlock && (
            <>
              <button
                className="task-action task-action--done"
                disabled={busy}
                onClick={() => run(() => doneTask(task.id))}
              >
                Done
              </button>
              {!isBlocked && (
                <button
                  className="task-action task-action--block"
                  disabled={busy}
                  onClick={onBlock}
                >
                  Block
                </button>
              )}
            </>
          )}
        </div>
      )}

      {actionError && (
        <div className="task-actions__error" role="alert">
          <span className="task-actions__error-msg">{actionError}</span>
          <button
            className="task-actions__error-dismiss"
            onClick={clearActionError}
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
