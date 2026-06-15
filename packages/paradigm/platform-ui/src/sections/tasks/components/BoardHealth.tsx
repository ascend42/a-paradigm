import React, { useState, useCallback } from 'react';
import { useTasksStore } from '../store/tasksStore';

// BoardHealth — a compact, collapsible ADVISORY banner above the board lanes.
//
// Surfaces the three Cid/Loid governance detections the backend attaches to
// /api/tasks/board:
//   • integrity      — DAG structural defects (self-parent / dangling / cycle)
//   • settlementDebt — runs whose children all settled but the epic never did
//   • staleClaims    — archetype-claimed open tasks past 7 days
//
// Tone is advisory, NOT alarming: amber (--p-accent-amber), never error-red.
// These are "worth a look", never blocking. When all three are empty/absent the
// board is healthy and this component renders NOTHING — no empty banner.
//
// Default collapsed (summary bar only); expand state persists to localStorage.

const COLLAPSE_KEY = 'paradigm.tasks.boardHealth.collapsed';

function loadCollapsed(): boolean {
  try {
    // Default collapsed: only an explicit '0' expands.
    return localStorage.getItem(COLLAPSE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function BoardHealth() {
  const board = useTasksStore((s) => s.board);
  const openDetail = useTasksStore((s) => s.openDetail);
  const [collapsed, setCollapsed] = useState(loadCollapsed);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const integrity = board?.integrity ?? [];
  const settlementDebt = board?.settlementDebt ?? [];
  const staleClaims = board?.staleClaims ?? [];

  const total = integrity.length + settlementDebt.length + staleClaims.length;

  // Healthy board → render nothing at all (no empty banner).
  if (total === 0) return null;

  // Build a count-summary fragment list, omitting zero-count categories.
  const parts: string[] = [];
  if (integrity.length) {
    parts.push(`${integrity.length} DAG issue${integrity.length === 1 ? '' : 's'}`);
  }
  if (settlementDebt.length) {
    parts.push(`${settlementDebt.length} settlement-debt`);
  }
  if (staleClaims.length) {
    parts.push(`${staleClaims.length} stale claim${staleClaims.length === 1 ? '' : 's'}`);
  }

  return (
    <section className="board-health">
      <header
        className="board-health__bar"
        onClick={toggle}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <span className="board-health__chevron" aria-hidden>
          {collapsed ? '›' : '⌄'}
        </span>
        <span className="board-health__icon" aria-hidden>
          ⚠
        </span>
        <span className="board-health__title">Board health</span>
        <span className="board-health__summary">{parts.join(' · ')}</span>
      </header>

      {!collapsed && (
        <div className="board-health__detail">
          {integrity.length > 0 && (
            <div className="board-health__group">
              <div className="board-health__group-label">DAG integrity</div>
              {integrity.map((v, i) => (
                <button
                  key={`integ:${v.kind}:${v.taskId}:${i}`}
                  className="board-health__row"
                  onClick={() => v.taskId && openDetail(v.taskId)}
                  disabled={!v.taskId}
                >
                  <span className="board-health__kind">{v.kind}</span>
                  <span className="board-health__row-detail">{v.detail}</span>
                </button>
              ))}
            </div>
          )}

          {settlementDebt.length > 0 && (
            <div className="board-health__group">
              <div className="board-health__group-label">Settlement debt</div>
              {settlementDebt.map((d, i) => (
                <button
                  key={`debt:${d.epicTaskId}:${i}`}
                  className="board-health__row"
                  onClick={() => d.epicTaskId && openDetail(d.epicTaskId)}
                  disabled={!d.epicTaskId}
                >
                  <span className="board-health__row-blurb">{d.blurb}</span>
                  <span className="board-health__row-detail">{d.reason}</span>
                </button>
              ))}
            </div>
          )}

          {staleClaims.length > 0 && (
            <div className="board-health__group">
              <div className="board-health__group-label">Stale claims</div>
              {staleClaims.map((c, i) => (
                <button
                  key={`stale:${c.taskId}:${i}`}
                  className="board-health__row"
                  onClick={() => c.taskId && openDetail(c.taskId)}
                  disabled={!c.taskId}
                >
                  <span className="board-health__row-blurb">{c.blurb}</span>
                  <span className="board-health__row-detail">
                    claimed by {c.claimant?.ref ?? 'unknown'}, {c.ageDays}d
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
