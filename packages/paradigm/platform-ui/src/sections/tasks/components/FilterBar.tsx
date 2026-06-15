import React from 'react';
import {
  useTasksStore,
  type TaskStatus,
  type TaskPriority,
} from '../store/tasksStore';

// FilterBar — lifted from the lore FilterBar pattern (status / priority /
// search idiom). Wired to the tasks store filter state. When a calibration
// cell filter is set it surfaces as a clearable active-filter chip.

const STATUSES: TaskStatus[] = ['open', 'in-progress', 'done', 'shelved'];
const PRIORITIES: TaskPriority[] = ['high', 'medium', 'low'];

export function FilterBar() {
  const filter = useTasksStore((s) => s.filter);
  const setFilter = useTasksStore((s) => s.setFilter);
  const clearFilters = useTasksStore((s) => s.clearFilters);
  const calibrationFilter = useTasksStore((s) => s.calibrationFilter);
  const setCalibrationFilter = useTasksStore((s) => s.setCalibrationFilter);

  const hasActiveFilters =
    !!filter.status ||
    !!filter.priority ||
    !!filter.search ||
    !!calibrationFilter;

  return (
    <div className="filter-bar tasks-filter-bar">
      <select
        value={filter.status || ''}
        onChange={(e) => setFilter({ status: (e.target.value as TaskStatus) || '' })}
      >
        <option value="">All statuses</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <select
        value={filter.priority || ''}
        onChange={(e) => setFilter({ priority: (e.target.value as TaskPriority) || '' })}
      >
        <option value="">All priorities</option>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>

      <input
        type="text"
        placeholder="Search blurb…"
        value={filter.search || ''}
        onChange={(e) => setFilter({ search: e.target.value || '' })}
        style={{ width: 180 }}
      />

      {calibrationFilter && (
        <span className="calib-chip" title="Calibration cell filter">
          <span className="calib-chip__label">
            {calibrationFilter.archetype} &times; {calibrationFilter.taskType}
          </span>
          <button
            className="calib-chip__clear"
            aria-label="Clear calibration filter"
            onClick={() => setCalibrationFilter(null)}
          >
            ×
          </button>
        </span>
      )}

      {hasActiveFilters && (
        <button className="filter-clear" onClick={clearFilters}>
          Clear filters
        </button>
      )}
    </div>
  );
}
