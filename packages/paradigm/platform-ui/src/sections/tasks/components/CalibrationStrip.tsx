import React, { useState, useCallback } from 'react';
import { useTasksStore } from '../store/tasksStore';
import { CellGrid } from './CellGrid';

// CalibrationStrip — the default-ON, collapsible hero strip ABOVE the board
// (NOT a separate tab). Leads with a coverage StatCard, then the CellGrid.
// When the whole grid is cold-start (every cell source:'prior', 0% graduated)
// it reads as "learning in progress", not broken.

const COLLAPSE_KEY = 'paradigm.tasks.calibrationStrip.collapsed';

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

export function CalibrationStrip() {
  const calibration = useTasksStore((s) => s.calibration);
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

  const cov = calibration?.coverage ?? { graduated: 0, total: 0, pct: 0 };
  const coldStart = cov.graduated === 0;

  // Cold-start should never start hidden — the differentiated artifact shouldn't
  // be invisible on a project that has never calibrated. Force-expand when there
  // are zero graduated cells, regardless of stored collapse state. Manual collapse
  // still works once the user toggles (sets `collapsed` true → coldStart keeps it
  // expanded only until any cell graduates; this is the cold-start guarantee).
  const effectiveCollapsed = coldStart ? false : collapsed;

  return (
    <section className={`calib-strip ${coldStart ? 'calib-strip--cold' : ''}`}>
      <header className="calib-strip__header" onClick={toggle}>
        <button
          className="calib-strip__chevron"
          aria-label={effectiveCollapsed ? 'Expand calibration' : 'Collapse calibration'}
        >
          {effectiveCollapsed ? '›' : '⌄'}
        </button>

        <span className="calib-strip__title">Calibration</span>

        {effectiveCollapsed ? (
          // Collapsed summary — keep the moat at least glanceable so a returning
          // user who collapsed the strip still sees the calibration signal.
          <span className="calib-strip__summary">
            <span className="calib-strip__summary-pct">{cov.pct}%</span> &middot;{' '}
            {cov.graduated}/{cov.total} cells learned
          </span>
        ) : (
          <div className="calib-strip__stat">
            <span className="calib-strip__pct">{cov.pct}%</span>
            <span className="calib-strip__stat-label">
              calibrated cells &middot; {cov.graduated} of {cov.total} graduated
            </span>
          </div>
        )}

        {coldStart && (
          <span className="calib-strip__badge">learning in progress</span>
        )}
      </header>

      {!effectiveCollapsed && (
        <div className="calib-strip__body">
          {coldStart && (
            <p className="calib-strip__cta">
              Run <code>paradigm calibrate</code> after orchestration runs to graduate
              cells from estimates to learned bands.
            </p>
          )}
          <CellGrid />
        </div>
      )}
    </section>
  );
}
