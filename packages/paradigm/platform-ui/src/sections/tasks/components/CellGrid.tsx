import React from 'react';
import { useTasksStore, type CalibrationCell } from '../store/tasksStore';
import { claimantColor } from '../utils/board';

// CellGrid — archetype rows × taskType columns.
//
// Each cell: solid + agent-color tint + a small ● when source==='learned';
// PRIOR cells encode progress-to-graduation: a cell graduates at n>=8, so its
// fill/opacity ramps by min(n,8)/8 and it shows a "{n}/8" tick — cells with
// accumulating actuals (n=5) read as visibly closer to learning than empty ones
// (n=0). The grid answers "where is the team about to learn something."
// Clicking a cell sets the store calibrationFilter (archetype × taskType),
// which BoardView honors and FilterBar surfaces as a clearable chip.

// A cell graduates from prior→learned once it has this many sampled actuals.
const GRADUATION_N = 8;

function formatTokens(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return Number.isInteger(k) ? `${k}k` : `${k.toFixed(1)}k`;
  }
  return String(n);
}

function Cell({
  archetype,
  taskType,
  cell,
}: {
  archetype: string;
  taskType: string;
  cell: CalibrationCell | undefined;
}) {
  const calibrationFilter = useTasksStore((s) => s.calibrationFilter);
  const setCalibrationFilter = useTasksStore((s) => s.setCalibrationFilter);

  const active =
    calibrationFilter?.archetype === archetype &&
    calibrationFilter?.taskType === taskType;

  const learned = cell?.source === 'learned';
  const color = claimantColor(archetype);

  const onClick = () => {
    if (active) setCalibrationFilter(null);
    else setCalibrationFilter({ archetype, taskType });
  };

  if (!cell) {
    return <td className="cell-grid__cell cell-grid__cell--empty">·</td>;
  }

  // PRIOR progress ramp: how close this cell is to graduating (0 → 1).
  const progress = Math.min(cell.n, GRADUATION_N) / GRADUATION_N;

  // Ramp the prior cell's fill + opacity by progress so accumulating actuals
  // look visibly closer to graduating. Tint toward the archetype color as it
  // approaches graduation. Base opacity 0.35 keeps an n=0 cell faintly present.
  const priorStyle = !learned
    ? ({
        ['--cell-color' as string]: color,
        ['--cell-progress' as string]: String(progress),
        opacity: 0.35 + progress * 0.45,
      } as React.CSSProperties)
    : undefined;

  return (
    <td
      className={`cell-grid__cell ${learned ? 'is-learned' : 'is-prior'} ${active ? 'is-active' : ''}`}
      style={learned ? ({ ['--cell-color' as string]: color } as React.CSSProperties) : priorStyle}
      onClick={onClick}
      title={`${archetype} × ${taskType} — ${cell.source} (n${cell.n}${
        learned ? '' : ` / ${GRADUATION_N} to graduate`
      })`}
    >
      {learned ? (
        <span className="cell-grid__band">
          <span className="cell-grid__learned-dot">●</span>
          {formatTokens(cell.min)}–{formatTokens(cell.max)}
          <span className="cell-grid__n">n{cell.n}</span>
        </span>
      ) : (
        <span className="cell-grid__prior">
          <span
            className="cell-grid__prior-ramp"
            aria-hidden="true"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
          <span className="cell-grid__prior-tick">
            {cell.n}/{GRADUATION_N}
          </span>
        </span>
      )}
    </td>
  );
}

export function CellGrid() {
  const calibration = useTasksStore((s) => s.calibration);

  if (!calibration) {
    return <div className="cell-grid__loading">Loading calibration…</div>;
  }

  const { archetypes, taskTypes, cells } = calibration;

  if (archetypes.length === 0 || taskTypes.length === 0) {
    return (
      <div className="cell-grid__loading">
        No calibration cells yet — estimates will graduate as the team logs actuals.
      </div>
    );
  }

  return (
    <div className="cell-grid__scroll">
      <table className="cell-grid">
        <thead>
          <tr>
            <th className="cell-grid__corner" />
            {taskTypes.map((tt) => (
              <th key={tt} className="cell-grid__col-head">
                {tt}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {archetypes.map((arch) => (
            <tr key={arch}>
              <th
                className="cell-grid__row-head"
                style={{ color: claimantColor(arch) }}
              >
                {arch}
              </th>
              {taskTypes.map((tt) => (
                <Cell
                  key={tt}
                  archetype={arch}
                  taskType={tt}
                  cell={cells[arch]?.[tt]}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
