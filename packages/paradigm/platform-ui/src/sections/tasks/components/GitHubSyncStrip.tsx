import React, { useMemo, useState } from 'react';
import { useTasksStore, type Task } from '../store/tasksStore';
import { nodeToTask, unclaimedToTask } from '../utils/board';

// GitHubSyncStrip — persistent Board-tab footer.
//
// Aggregates external_ref state across the visible board tasks:
//   synced       = provider==='github' && url present
//   push-pending = provider==='github' && no url
//   drifted      = future state; 0 for now (placeholder so the shape is honest)
//
// "Pull from GitHub" is AFFORDANCE-ONLY — the read router has no mutating
// endpoint. It opens a popover that shows + copies the `paradigm task sync` CLI
// command. Two-way sync runs via the CLI today.

const SYNC_CMD = 'paradigm task sync';

interface SyncCounts {
  synced: number;
  drifted: number;
  pushPending: number;
}

function countSync(tasks: Task[]): SyncCounts {
  let synced = 0;
  let pushPending = 0;
  for (const t of tasks) {
    if (t.external_ref?.provider === 'github') {
      if (t.external_ref.url) synced += 1;
      else pushPending += 1;
    }
  }
  return { synced, drifted: 0, pushPending };
}

export function GitHubSyncStrip() {
  const board = useTasksStore((s) => s.board);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const counts = useMemo(() => {
    const all: Task[] = [];
    if (board) {
      for (const run of board.runs) for (const n of run.nodes) all.push(nodeToTask(n));
      for (const u of board.unclaimed) all.push(unclaimedToTask(u));
    }
    return countSync(all);
  }, [board]);

  const copyCmd = async () => {
    try {
      await navigator.clipboard.writeText(SYNC_CMD);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="sync-strip">
      <div className="sync-strip__counts">
        <span className="sync-strip__provider">⬢ GitHub</span>
        <span className="sync-strip__stat sync-strip__stat--synced">
          {counts.synced} synced
        </span>
        <span className="sync-strip__sep">·</span>
        <span className="sync-strip__stat sync-strip__stat--drifted">
          {counts.drifted} drifted
        </span>
        <span className="sync-strip__sep">·</span>
        <span className="sync-strip__stat sync-strip__stat--pending">
          {counts.pushPending} push-pending
        </span>
      </div>

      <div className="sync-strip__action">
        <button className="sync-strip__pull" onClick={() => setOpen((v) => !v)}>
          Pull from GitHub
        </button>

        {open && (
          <>
            <div className="sync-strip__backdrop" onClick={() => setOpen(false)} />
            <div className="sync-strip__popover" role="dialog" aria-label="GitHub sync">
              <div className="sync-strip__popover-title">Sync via CLI</div>
              <p className="sync-strip__popover-note">
                Two-way GitHub sync runs through the CLI today. Run this command in your
                project to pull and push task state.
              </p>
              <div className="sync-strip__cmd">
                <code>{SYNC_CMD}</code>
                <button className="sync-strip__copy" onClick={copyCmd}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
