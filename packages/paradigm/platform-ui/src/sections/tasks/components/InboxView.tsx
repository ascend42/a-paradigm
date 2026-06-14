import React, { useEffect, useMemo } from 'react';
import { useTasksStore, type Task, type TaskClaimant } from '../store/tasksStore';
import { TaskCard } from './TaskCard';
import { TaskActions } from './TaskActions';
import { AGENT_COLORS, claimantColor, nodeToTask, unclaimedToTask } from '../utils/board';

// InboxView — the AGENT FACE.
//
// A claimant pill-row (Me + one pill per distinct board claimant) selects whose
// inbox to focus. The focused column shows: a rolled-up calibration header, a
// NEXT-ACTIONABLE hero card, a DependsChain ribbon under the hero, then the rest
// as a queued list. Empty claimants show "inbox zero".

const PRIORITY_RANK: Record<Task['priority'], number> = { high: 0, medium: 1, low: 2 };

function claimantGlyph(kind: string): string {
  if (kind === 'human') return '👤';
  if (kind === 'peer') return '⚡';
  return '🤖';
}

function sameClaimant(a: TaskClaimant | null, b: TaskClaimant | null): boolean {
  return !!a && !!b && a.kind === b.kind && a.ref === b.ref;
}

// Distinct claimants present on the board (excludes the human, who gets the Me
// pill). Built from run nodes + proposed unclaimed claimants.
function useBoardClaimants(): TaskClaimant[] {
  const board = useTasksStore((s) => s.board);
  return useMemo(() => {
    const seen = new Map<string, TaskClaimant>();
    if (board) {
      for (const run of board.runs) {
        for (const node of run.nodes) {
          if (node.claimant && node.claimant.kind !== 'human') {
            seen.set(`${node.claimant.kind}:${node.claimant.ref}`, node.claimant);
          }
        }
      }
      for (const u of board.unclaimed) {
        if (u.proposedClaimant && u.proposedClaimant.kind !== 'human') {
          seen.set(`${u.proposedClaimant.kind}:${u.proposedClaimant.ref}`, u.proposedClaimant);
        }
      }
    }
    return [...seen.values()].sort((a, b) => a.ref.localeCompare(b.ref));
  }, [board]);
}

// Rolled-up calibration: share of a claimant's estimates that are 'learned'.
function rollupCalibration(tasks: Task[]): { pct: number; total: number } {
  const total = tasks.length;
  if (total === 0) return { pct: 0, total: 0 };
  const learned = tasks.filter((t) => t.estimate?.source === 'learned').length;
  return { pct: Math.round((learned / total) * 100), total };
}

// NEXT-ACTIONABLE: highest-priority in-progress-or-open task that is not blocked.
function pickHero(tasks: Task[]): Task | null {
  const candidates = tasks
    .filter((t) => (t.status === 'in-progress' || t.status === 'open') && !(t.blocked_on && t.blocked_on.length > 0))
    .sort((a, b) => {
      const aProg = a.status === 'in-progress' ? 0 : 1;
      const bProg = b.status === 'in-progress' ? 0 : 1;
      if (aProg !== bProg) return aProg - bProg;
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    });
  return candidates[0] ?? null;
}

// DependsChain — best-effort: resolve each dependsOn id to a state if it appears
// among the loaded inbox/board tasks; otherwise just show its id. The hero sits
// in the middle: deps → ●this → next.
function DependsChain({ hero, pool }: { hero: Task; pool: Map<string, Task> }) {
  const deps = hero.dependsOn ?? [];
  if (deps.length === 0) return null;

  const dot = (state: Task['status'] | 'unknown', filled: boolean) =>
    `depends-chain__dot depends-chain__dot--${state} ${filled ? 'is-filled' : ''}`;

  return (
    <div className="depends-chain" title="dependency chain">
      {deps.map((id, i) => {
        const dep = pool.get(id);
        const done = dep?.status === 'done';
        return (
          <React.Fragment key={id}>
            {i > 0 && <span className="depends-chain__arrow">→</span>}
            <span className={dot(dep?.status ?? 'unknown', done)} />
            <span className="depends-chain__id">{shortId(id)}</span>
            <span className="depends-chain__arrow">→</span>
          </React.Fragment>
        );
      })}
      <span className="depends-chain__dot depends-chain__dot--this is-filled" />
      <span className="depends-chain__id depends-chain__id--this">this</span>
    </div>
  );
}

function shortId(id: string): string {
  // Task ids look like T-2026-06-14-...-001; show the trailing chunk.
  const parts = id.split('-');
  return parts.length > 2 ? parts.slice(-2).join('-') : id;
}

export function InboxView() {
  const whoami = useTasksStore((s) => s.whoami);
  const fetchWhoami = useTasksStore((s) => s.fetchWhoami);
  const fetchInbox = useTasksStore((s) => s.fetchInbox);
  const inboxClaimant = useTasksStore((s) => s.inboxClaimant);
  const inboxTasks = useTasksStore((s) => s.inboxTasks);
  const inboxLoading = useTasksStore((s) => s.inboxLoading);
  const inboxError = useTasksStore((s) => s.inboxError);
  const board = useTasksStore((s) => s.board);

  const agents = useBoardClaimants();

  // Cold-start default landing: the human's ("Me") inbox. Once whoami resolves
  // and nothing is selected yet, focus it.
  useEffect(() => {
    fetchWhoami().then((me) => {
      if (me && me.ref && !useTasksStore.getState().inboxClaimant) {
        fetchInbox(me.kind, me.ref);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectClaimant = (c: TaskClaimant) => {
    if (c.ref) fetchInbox(c.kind, c.ref);
  };

  // Pool of known tasks for dependency-state resolution: inbox tasks + every
  // board node (so deps owned by other claimants still resolve to a state).
  const pool = useMemo(() => {
    const m = new Map<string, Task>();
    for (const t of inboxTasks) m.set(t.id, t);
    if (board) {
      for (const run of board.runs) for (const n of run.nodes) m.set(n.taskId, nodeToTask(n));
      for (const u of board.unclaimed) m.set(u.taskId, unclaimedToTask(u));
    }
    return m;
  }, [inboxTasks, board]);

  const activeTasks = useMemo(
    () => inboxTasks.filter((t) => t.status !== 'done' && t.status !== 'shelved'),
    [inboxTasks]
  );
  const hero = useMemo(() => pickHero(activeTasks), [activeTasks]);
  const queued = useMemo(
    () => activeTasks.filter((t) => t.id !== hero?.id),
    [activeTasks, hero]
  );
  const { pct, total } = rollupCalibration(inboxTasks);

  return (
    <div className="inbox">
      <div className="inbox__pill-row">
        {whoami && (
          <button
            className={`inbox-pill inbox-pill--me ${sameClaimant(inboxClaimant, whoami) ? 'active' : ''}`}
            style={{ ['--pill-color' as string]: 'var(--p-accent-blue)' }}
            onClick={() => selectClaimant(whoami)}
            title={whoami.ref}
          >
            <span className="inbox-pill__glyph">👤</span> Me
          </button>
        )}
        {agents.map((a) => {
          const color = AGENT_COLORS[a.ref.toLowerCase()] || claimantColor(a.ref);
          return (
            <button
              key={`${a.kind}:${a.ref}`}
              className={`inbox-pill ${sameClaimant(inboxClaimant, a) ? 'active' : ''}`}
              style={{ ['--pill-color' as string]: color }}
              onClick={() => selectClaimant(a)}
              title={`${a.kind} · ${a.ref}`}
            >
              <span className="inbox-pill__glyph">{claimantGlyph(a.kind)}</span> {a.ref}
            </button>
          );
        })}
      </div>

      {!inboxClaimant && <p className="tasks__empty">Pick a claimant to focus their inbox.</p>}

      {inboxClaimant && (
        <div className="inbox__column">
          <div className="inbox__calib-header">
            <span className="inbox__calib-who">
              {claimantGlyph(inboxClaimant.kind)} {inboxClaimant.ref}
            </span>
            <span className="inbox__calib-stat">
              {/* Learned bands are keyed by ARCHETYPE — a human claimant has no
                  learned cell, so a calibration % there is a category error.
                  Suppress it (show "—") for humans; keep it for archetypes. */}
              calibration{' '}
              <strong>{inboxClaimant.kind === 'human' ? '—' : `${pct}%`}</strong>{' '}
              &middot; n={total}
            </span>
          </div>

          {inboxLoading && inboxTasks.length === 0 && (
            <p className="tasks__empty">Loading inbox…</p>
          )}
          {inboxError && !inboxLoading && (
            <p className="tasks__empty">Could not load inbox: {inboxError}</p>
          )}

          {!inboxLoading && !inboxError && activeTasks.length === 0 && (
            <div className="inbox__zero">
              <span className="inbox__zero-glyph">✦</span>
              <span className="inbox__zero-title">inbox zero</span>
              <span className="inbox__zero-sub">no active tasks for this claimant</span>
            </div>
          )}

          {hero && (
            <div className="inbox__hero">
              <div className="inbox__hero-label">Next up</div>
              <TaskCard task={hero} elevated />
              <TaskActions task={hero} />
              <DependsChain hero={hero} pool={pool} />
            </div>
          )}

          {queued.length > 0 && (
            <div className="inbox__queue">
              <div className="inbox__queue-label">Queue ({queued.length})</div>
              {queued
                .slice()
                .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
                .map((t) => (
                  <TaskCard key={t.id} task={t} />
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
