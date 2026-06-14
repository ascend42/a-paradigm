import React, { useState, useCallback } from 'react';
import type { Task } from '../store/tasksStore';
import { TaskCard } from './TaskCard';
import { sortCards, sumPoints } from '../utils/board';

// SwimLane — a single vertical lane in the Board.
//
// Colored header (group label + presence dot + card count + SUMMED story
// points across its cards), a scrollable column of TaskCards (sorted
// priority-desc, in-progress first), and a chevron to collapse. Collapse state
// persists to localStorage per-lane key.

const COLLAPSE_PREFIX = 'paradigm.tasks.lane.collapsed.';

function loadCollapsed(laneKey: string, defaultCollapsed: boolean): boolean {
  try {
    const v = localStorage.getItem(COLLAPSE_PREFIX + laneKey);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {
    /* ignore */
  }
  return defaultCollapsed;
}

interface SwimLaneProps {
  /** Stable key for persisting collapse state. */
  laneKey: string;
  /** Display label (claimant ref, state name, or symbol). */
  label: string;
  /** Lane accent color (CSS color / token). */
  color: string;
  /** True if this lane represents an active/online claimant. */
  present?: boolean;
  cards: Task[];
  defaultCollapsed?: boolean;
}

export function SwimLane({
  laneKey,
  label,
  color,
  present,
  cards,
  defaultCollapsed = false,
}: SwimLaneProps) {
  const [collapsed, setCollapsed] = useState(() =>
    loadCollapsed(laneKey, defaultCollapsed)
  );

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_PREFIX + laneKey, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [laneKey]);

  const sorted = [...cards].sort(sortCards);
  const points = sumPoints(cards);

  return (
    <section
      className={`swim-lane ${collapsed ? 'swim-lane--collapsed' : ''}`}
      style={{ ['--lane-color' as string]: color }}
    >
      <header className="swim-lane__header" onClick={toggle}>
        <button
          className="swim-lane__chevron"
          aria-label={collapsed ? 'Expand lane' : 'Collapse lane'}
        >
          {collapsed ? '›' : '⌄'}
        </button>
        {present !== undefined && (
          <span
            className={`swim-lane__dot ${present ? 'is-present' : ''}`}
            title={present ? 'present' : 'idle'}
          />
        )}
        <span className="swim-lane__label">{label}</span>
        <span className="swim-lane__count">{cards.length}</span>
        <span className="swim-lane__points" title="summed story points">
          {points} pt
        </span>
      </header>

      {!collapsed && (
        <div className="swim-lane__cards">
          {sorted.length === 0 ? (
            <div className="swim-lane__empty">no tasks</div>
          ) : (
            sorted.map((task) => <TaskCard key={task.id} task={task} />)
          )}
        </div>
      )}
    </section>
  );
}
