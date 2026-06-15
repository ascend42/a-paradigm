import React, { useEffect, useMemo, useState } from 'react';
import { useTasksStore, type Task } from '../store/tasksStore';
import { nodeToTask, unclaimedToTask, deriveSymbols } from '../utils/board';
import { tokenBandToPoints } from '../utils/storyPoints';
import { TaskActions } from './TaskActions';

// TaskDetailPanel — a right-slide panel cloning lore's .detail-overlay /
// .detail-panel. Opened by clicking any TaskCard (store.openDetail(id)). Shows
// the full blurb, the dependsOn DAG (ids + resolved states), the estimate
// breakdown (token band + LEARNED/prior provenance + n), fragileSymbols/tags
// chips, a GitHub section, and related_lore ids. Closes on backdrop click / Esc.

function formatTokens(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return Number.isInteger(k) ? `${k}k` : `${k.toFixed(1)}k`;
  }
  return String(n);
}

// related_lore is not on the base Task type but the single-task endpoint may
// include it; read it defensively.
interface TaskExtra extends Task {
  related_lore?: string[];
  fragileSymbols?: string[];
}

function statePill(state?: string): string {
  return `tdp-dep__state tdp-dep__state--${state ?? 'unknown'}`;
}

export function TaskDetailPanel() {
  const selectedId = useTasksStore((s) => s.selectedTaskId);
  const closeDetail = useTasksStore((s) => s.closeDetail);
  const board = useTasksStore((s) => s.board);
  const inboxTasks = useTasksStore((s) => s.inboxTasks);
  const tasks = useTasksStore((s) => s.tasks);

  const [task, setTask] = useState<TaskExtra | null>(null);
  const [loading, setLoading] = useState(false);

  // A pool to seed the panel immediately from already-loaded data + to resolve
  // dependency states.
  const pool = useMemo(() => {
    const m = new Map<string, Task>();
    for (const t of tasks) m.set(t.id, t);
    for (const t of inboxTasks) m.set(t.id, t);
    if (board) {
      for (const run of board.runs) for (const n of run.nodes) m.set(n.taskId, nodeToTask(n));
      for (const u of board.unclaimed) m.set(u.taskId, unclaimedToTask(u));
    }
    return m;
  }, [tasks, inboxTasks, board]);

  // Esc to close
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDetail();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, closeDetail]);

  // Fetch the single task on open; seed from pool first so the panel is instant.
  useEffect(() => {
    if (!selectedId) {
      setTask(null);
      return;
    }
    const seed = pool.get(selectedId);
    if (seed) setTask(seed as TaskExtra);
    setLoading(true);
    fetch(`/api/tasks/${selectedId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setTask(data as TaskExtra);
      })
      .catch(() => {
        /* keep seed */
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // After a write verb the store refreshes board/list/inbox pools. Re-seed the
  // panel's local task from the refreshed pool so the status-aware action row
  // updates (e.g. open→in-progress hides [Start]) without a manual refetch.
  useEffect(() => {
    if (!selectedId) return;
    const fresh = pool.get(selectedId);
    if (fresh) setTask((prev) => ({ ...(prev ?? {}), ...(fresh as TaskExtra) }));
  }, [pool, selectedId]);

  if (!selectedId || !task) return null;

  const deps = task.dependsOn ?? [];
  const symbols = task.fragileSymbols && task.fragileSymbols.length > 0
    ? task.fragileSymbols
    : deriveSymbols(task);
  const points = tokenBandToPoints(task.estimate);
  const learned = task.estimate.source === 'learned';
  const gh = task.external_ref?.provider === 'github' ? task.external_ref : null;
  const relatedLore = task.related_lore ?? [];

  return (
    <div className="detail-overlay">
      <div className="detail-backdrop" onClick={closeDetail} />
      <div className="detail-panel tdp">
        <div className="detail-header">
          <div>
            <div className="tdp__id-row">
              <span className={`task-chip task-chip--prio task-chip--prio-${task.priority}`}>
                {task.priority}
              </span>
              <span className={`task-chip task-chip--status task-chip--status-${task.status}`}>
                {task.status}
              </span>
              <span className="tdp__id">{task.id}</span>
            </div>
          </div>
          <button className="detail-close" onClick={closeDetail}>{'✕'}</button>
        </div>

        <div className="tdp__actions">
          <TaskActions task={task} />
        </div>

        <div className="detail-body">
          <div className="detail-section">
            <h3>Blurb</h3>
            <p className="tdp__blurb">{task.blurb}</p>
          </div>

          <div className="detail-section">
            <h3>Estimate</h3>
            <div className={`tdp-estimate ${learned ? 'learned' : 'prior'}`}>
              <span className="tdp-estimate__points">{points} pt</span>
              <span className="tdp-estimate__band">
                {formatTokens(task.estimate.min)}–{formatTokens(task.estimate.max)} tokens
              </span>
              {learned ? (
                <span className="tdp-estimate__prov tdp-estimate__prov--learned">
                  ◆ LEARNED · n{task.estimate.n}
                </span>
              ) : (
                <span className="tdp-estimate__prov tdp-estimate__prov--prior">
                  ~prior~ (cold-start, n{task.estimate.n})
                </span>
              )}
            </div>
          </div>

          {deps.length > 0 && (
            <div className="detail-section">
              <h3>Depends on (DAG)</h3>
              <ul className="tdp-deps">
                {deps.map((id) => {
                  const dep = pool.get(id);
                  return (
                    <li key={id} className="tdp-dep">
                      <span className={statePill(dep?.status)}>
                        {dep?.status ?? 'unknown'}
                      </span>
                      <span className="tdp-dep__id">{id}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {symbols.length > 0 && (
            <div className="detail-section">
              <h3>Symbols</h3>
              <div className="tdp-chips">
                {symbols.map((s) => (
                  <span key={s} className="tdp-chip tdp-chip--symbol">{s}</span>
                ))}
              </div>
            </div>
          )}

          {task.tags.length > 0 && (
            <div className="detail-section">
              <h3>Tags</h3>
              <div className="tdp-chips">
                {task.tags.map((t) => (
                  <span
                    key={t}
                    className={`tdp-chip ${t === 'fragile' ? 'tdp-chip--fragile' : ''}`}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {gh && (
            <div className="detail-section">
              <h3>GitHub</h3>
              <div className="tdp-github">
                <span className="tdp-github__ref">⬢ {gh.ref}</span>
                {gh.url ? (
                  <a
                    className="tdp-github__link"
                    href={gh.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    open ↗
                  </a>
                ) : (
                  <span className="tdp-github__pending">push-pending</span>
                )}
              </div>
            </div>
          )}

          {relatedLore.length > 0 && (
            <div className="detail-section">
              <h3>Related lore</h3>
              <div className="tdp-chips">
                {relatedLore.map((id) => (
                  <span key={id} className="tdp-chip tdp-chip--lore">{id}</span>
                ))}
              </div>
            </div>
          )}

          {loading && <div className="tdp__loading">refreshing…</div>}
        </div>
      </div>
    </div>
  );
}
