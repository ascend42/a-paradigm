import React from 'react';
import { useTasksStore, type LaneMode } from '../store/tasksStore';

// LaneModeToggle — segmented pill that drives how the Board groups its lanes.
const MODES: { mode: LaneMode; label: string }[] = [
  { mode: 'claimant', label: 'Claimant' },
  { mode: 'state', label: 'State' },
  { mode: 'symbol', label: 'Symbol/Flow' },
];

export function LaneModeToggle() {
  const laneMode = useTasksStore((s) => s.laneMode);
  const setLaneMode = useTasksStore((s) => s.setLaneMode);

  return (
    <div className="lane-mode-toggle" role="tablist" aria-label="Lane grouping">
      {MODES.map((m) => (
        <button
          key={m.mode}
          role="tab"
          aria-selected={laneMode === m.mode}
          className={`lane-mode-pill ${laneMode === m.mode ? 'active' : ''}`}
          onClick={() => setLaneMode(m.mode)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
