import React, { useMemo, useState } from 'react';
import { useTasksStore, type Task } from '../store/tasksStore';
import { nodeToTask, unclaimedToTask } from '../utils/board';

// GitHubSyncStrip — persistent Board-tab footer.
//
// Aggregates external_ref state across the visible board tasks:
//   synced       = provider==='github' && url present
//   push-pending = provider==='github' && no url
//
// The PRIMARY action is now a REAL two-way Sync button: it POSTs
// /api/tasks/sync, which pulls each linked GitHub issue server-side and
// reconciles it back through the enforced state machine (a teammate-closed
// issue → task moves to done; a reopened issue → task reopens). The client
// sends no task/remote state. After a sync the store refreshes the board so
// applied changes show immediately.
//
// States rendered from the response summary:
//   success   → "✓ Synced N · M unchanged" (quiet "Up to date" on 0 changes)
//   conflict  → amber summary + clickable conflicted task ids (a human should
//               look; local won — never a failure)
//   offline   → calm "GitHub not available — `gh auth login`" hint, NOT red
//
// "via CLI" remains as a small secondary fallback (copyable `paradigm task
// sync`) for users without the server.

const SYNC_CMD = 'paradigm task sync';

interface SyncCounts {
  synced: number;
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
  return { synced, pushPending };
}

export function GitHubSyncStrip() {
  const board = useTasksStore((s) => s.board);
  const syncing = useTasksStore((s) => s.syncing);
  const lastSyncSummary = useTasksStore((s) => s.lastSyncSummary);
  const syncGitHub = useTasksStore((s) => s.syncGitHub);
  const clearSyncSummary = useTasksStore((s) => s.clearSyncSummary);
  const openDetail = useTasksStore((s) => s.openDetail);

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

  const runSync = async () => {
    clearSyncSummary();
    // No body → server syncs all linked tasks. Client never sends task/remote
    // state; the server pulls + reconciles entirely on its side.
    await syncGitHub();
  };

  return (
    <div className="sync-strip">
      <div className="sync-strip__counts">
        <span className="sync-strip__provider">⬢ GitHub</span>
        <span className="sync-strip__stat sync-strip__stat--synced">
          {counts.synced} synced
        </span>
        <span className="sync-strip__sep">·</span>
        <span className="sync-strip__stat sync-strip__stat--pending">
          {counts.pushPending} push-pending
        </span>

        {lastSyncSummary && <SyncResultInline onOpen={openDetail} />}
      </div>

      <div className="sync-strip__action">
        <button
          className="sync-strip__sync"
          onClick={runSync}
          disabled={syncing}
          aria-busy={syncing}
        >
          {syncing ? (
            <>
              <span className="sync-strip__spinner" aria-hidden="true" />
              Syncing…
            </>
          ) : (
            'Sync'
          )}
        </button>

        <button
          className="sync-strip__cli-toggle"
          onClick={() => setOpen((v) => !v)}
          title="Sync via CLI"
        >
          via CLI
        </button>

        {open && (
          <>
            <div className="sync-strip__backdrop" onClick={() => setOpen(false)} />
            <div className="sync-strip__popover" role="dialog" aria-label="GitHub sync via CLI">
              <div className="sync-strip__popover-title">Sync via CLI</div>
              <p className="sync-strip__popover-note">
                No server running? Run this in your project to pull and push task
                state from the command line.
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

// SyncResultInline — transient inline summary of the last sync, read off the
// store. Three tones: offline (calm hint), conflict (amber + clickable ids),
// success (quiet; "Up to date" on a 0-change result).
function SyncResultInline({ onOpen }: { onOpen: (id: string) => void }) {
  const result = useTasksStore((s) => s.lastSyncSummary);
  if (!result) return null;

  if (result.offline) {
    return (
      <span className="sync-strip__result sync-strip__result--offline">
        GitHub not available — <code>gh auth login</code> to enable sync
      </span>
    );
  }

  const { synced, conflict, agree } = result.summary;
  const unchanged = agree;
  const hasConflict = conflict > 0;
  const noChange = synced === 0 && conflict === 0;

  if (noChange) {
    return (
      <span className="sync-strip__result sync-strip__result--quiet">Up to date</span>
    );
  }

  const parts: string[] = [];
  if (synced > 0) parts.push(`Synced ${synced}`);
  if (conflict > 0) parts.push(`${conflict} conflict`);
  if (unchanged > 0) parts.push(`${unchanged} unchanged`);

  return (
    <span
      className={`sync-strip__result ${
        hasConflict ? 'sync-strip__result--conflict' : 'sync-strip__result--ok'
      }`}
    >
      {!hasConflict && <span aria-hidden="true">✓ </span>}
      {parts.join(' · ')}
      {hasConflict && (
        <span className="sync-strip__conflict-ids">
          {result.conflictIds.map((id, i) => (
            <React.Fragment key={id}>
              {i > 0 && ', '}
              <button
                className="sync-strip__conflict-id"
                onClick={() => onOpen(id)}
                title="A human should reconcile this — local won"
              >
                {id}
              </button>
            </React.Fragment>
          ))}
        </span>
      )}
    </span>
  );
}
