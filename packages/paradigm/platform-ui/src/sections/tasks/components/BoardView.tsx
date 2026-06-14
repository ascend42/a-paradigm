import React, { useMemo } from 'react';
import { useTasksStore, type Task, type TaskStatus } from '../store/tasksStore';
import { SwimLane } from './SwimLane';
import { LaneModeToggle } from './LaneModeToggle';
import {
  AGENT_COLORS,
  claimantColor,
  claimantArchetype,
  nodeToTask,
  unclaimedToTask,
  firstSymbol,
  matchesFilter,
} from '../utils/board';

// BoardView — a horizontally-scrollable row of SwimLanes built from
// /api/tasks/board. Three lane modes (claimant / state / symbol) regroup the
// SAME underlying card set. Store filters (status/priority/search +
// calibration cell) are applied to the cards shown in every mode.

interface Lane {
  key: string;
  label: string;
  color: string;
  present?: boolean;
  cards: Task[];
  defaultCollapsed?: boolean;
}

const STATE_LANES: { status: TaskStatus; label: string; color: string }[] = [
  { status: 'open', label: 'Open', color: 'var(--p-accent-blue)' },
  { status: 'in-progress', label: 'In Progress', color: 'var(--p-accent-purple)' },
  { status: 'done', label: 'Done', color: 'var(--p-accent-green)' },
  { status: 'shelved', label: 'Shelved', color: 'var(--p-text-muted)' },
];

// Map a task's claimant to its calibration archetype key. Claimant refs are
// archetype IDs (cid/forge/compliance); the calibration grid is keyed by role
// words, so resolve through claimantArchetype().
function archetypeOf(task: Task): string | null {
  if (!task.claimant) return null;
  if (task.claimant.kind === 'archetype') return claimantArchetype(task.claimant.ref);
  return null;
}

export function BoardView() {
  const board = useTasksStore((s) => s.board);
  const loading = useTasksStore((s) => s.boardLoading);
  const error = useTasksStore((s) => s.boardError);
  const laneMode = useTasksStore((s) => s.laneMode);
  const filter = useTasksStore((s) => s.filter);
  const calibrationFilter = useTasksStore((s) => s.calibrationFilter);

  // Flatten board into a single card list + keep unclaimed separate (it gets
  // its own trailing lane in claimant mode).
  const { runCards, unclaimedCards } = useMemo(() => {
    const runCards: Task[] = [];
    const unclaimedCards: Task[] = [];
    if (board) {
      for (const run of board.runs) {
        for (const node of run.nodes) runCards.push(nodeToTask(node));
      }
      for (const u of board.unclaimed) unclaimedCards.push(unclaimedToTask(u));
    }
    return { runCards, unclaimedCards };
  }, [board]);

  // Apply store filters (status / priority / search) + calibration cell filter.
  const passes = useMemo(() => {
    return (task: Task): boolean => {
      if (!matchesFilter(task, filter)) return false;
      if (calibrationFilter) {
        // Claimant archetype must match the clicked cell's row.
        const arch = archetypeOf(task);
        if (arch !== calibrationFilter.archetype) return false;
        // taskType is now a real field on the task — match it directly to the
        // clicked cell's column.
        if ((task.taskType || '').toLowerCase() !== calibrationFilter.taskType.toLowerCase())
          return false;
      }
      return true;
    };
  }, [filter, calibrationFilter]);

  const lanes = useMemo<Lane[]>(() => {
    const all = [...runCards, ...unclaimedCards].filter(passes);
    const runFiltered = runCards.filter(passes);
    const unclaimedFiltered = unclaimedCards.filter(passes);

    if (laneMode === 'state') {
      return STATE_LANES.map((sl) => ({
        key: `state:${sl.status}`,
        label: sl.label,
        color: sl.color,
        cards: all.filter((t) => t.status === sl.status),
        defaultCollapsed: sl.status === 'done' || sl.status === 'shelved',
      }));
    }

    if (laneMode === 'symbol') {
      const groups = new Map<string, Task[]>();
      for (const t of all) {
        const sym = firstSymbol(t) ?? '(no symbol)';
        if (!groups.has(sym)) groups.set(sym, []);
        groups.get(sym)!.push(t);
      }
      return [...groups.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([sym, cards]) => ({
          key: `symbol:${sym}`,
          label: sym,
          color: sym === '(no symbol)' ? 'var(--p-text-muted)' : 'var(--p-symbol-component)',
          cards,
        }));
    }

    // laneMode === 'claimant' (default)
    const byClaimant = new Map<string, Task[]>();
    const doneCards: Task[] = [];
    for (const t of runFiltered) {
      if (t.status === 'done') {
        doneCards.push(t);
        continue;
      }
      const ref = t.claimant?.ref ?? '(unassigned)';
      if (!byClaimant.has(ref)) byClaimant.set(ref, []);
      byClaimant.get(ref)!.push(t);
    }

    const claimantLanes: Lane[] = [...byClaimant.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([ref, cards]) => ({
        key: `claimant:${ref}`,
        label: ref,
        color: claimantColor(ref),
        present: cards.some((c) => c.status === 'in-progress'),
        cards,
      }));

    // Trailing Unclaimed lane (board.unclaimed)
    claimantLanes.push({
      key: 'claimant:__unclaimed__',
      label: 'Unclaimed',
      color: 'var(--p-accent-orange)',
      cards: unclaimedFiltered,
    });

    // Collapsed Done lane
    claimantLanes.push({
      key: 'claimant:__done__',
      label: 'Done',
      color: 'var(--p-accent-green)',
      cards: doneCards,
      defaultCollapsed: true,
    });

    return claimantLanes;
  }, [laneMode, runCards, unclaimedCards, passes]);

  const totalVisible = lanes.reduce((acc, l) => acc + l.cards.length, 0);

  return (
    <div className="board">
      <div className="board__toolbar">
        <LaneModeToggle />
      </div>

      {loading && !board && <p className="tasks__empty">Loading board…</p>}
      {error && !board && (
        <p className="tasks__empty">Could not load board: {error}</p>
      )}

      {board && totalVisible === 0 && (
        <p className="tasks__empty">
          {calibrationFilter
            ? `No ${calibrationFilter.taskType} tasks claimed by ${calibrationFilter.archetype} yet`
            : 'No tasks match the current filters'}
        </p>
      )}

      {board && (
        <div className="board__lanes">
          {lanes.map((lane) => (
            <SwimLane
              key={lane.key}
              laneKey={lane.key}
              label={lane.label}
              color={lane.color}
              present={lane.present}
              cards={lane.cards}
              defaultCollapsed={lane.defaultCollapsed}
            />
          ))}
        </div>
      )}
    </div>
  );
}
