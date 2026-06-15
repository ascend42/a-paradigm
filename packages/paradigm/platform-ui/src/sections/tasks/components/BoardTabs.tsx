import React from 'react';
import { useTasksStore, type BoardTab } from '../store/tasksStore';

// BoardTabs — the Board's sub-tab bar. Four tabs in confirmed order; State is
// the default. The three lane modes (State / Claimant / Symbol/Flow) regroup the
// swim-lane board; Calibration swaps the lanes for the calibration grid. Styled
// with the shared segmented .view-tab idiom.
const TABS: { tab: BoardTab; label: string }[] = [
  { tab: 'state', label: 'State' },
  { tab: 'claimant', label: 'Claimant' },
  { tab: 'symbol', label: 'Symbol/Flow' },
  { tab: 'calibration', label: 'Calibration' },
];

export function BoardTabs() {
  const boardTab = useTasksStore((s) => s.boardTab);
  const setBoardTab = useTasksStore((s) => s.setBoardTab);

  return (
    <div className="board-tabs view-switcher" role="tablist" aria-label="Board view">
      {TABS.map((t) => (
        <button
          key={t.tab}
          role="tab"
          aria-selected={boardTab === t.tab}
          className={`view-tab ${boardTab === t.tab ? 'active' : ''}`}
          onClick={() => setBoardTab(t.tab)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
