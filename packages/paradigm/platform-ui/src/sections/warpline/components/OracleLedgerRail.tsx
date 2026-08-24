import React, { useState } from 'react';
import type { OracleRecord, RefsResponse } from '../types';
import { isDivergentRow, ledgerRowLabel, rowKey } from '../viewerState';

/**
 * OracleLedgerRail — the left rail. Lists /ledger rows newest-first
 * (branchA→branchB · verdict · ts); DIVERGENT rows carry a seam-violet dot.
 * Clicking a row selects it → drives the viewer. New rows (WS
 * `!oracle-record-appended`) are prepended by the parent section.
 *
 * Top: RefPicker — two branch selects (from /refs) + Run (POST /oracle, records)
 * and Preview (POST /forecast, ephemeral).
 */
export function OracleLedgerRail({
  rows,
  refs,
  selectedKey,
  onSelect,
  onRun,
  onPreview,
  running,
}: {
  rows: OracleRecord[];
  refs: RefsResponse | null;
  selectedKey: string | null;
  onSelect: (record: OracleRecord) => void;
  onRun: (a: string, b: string) => void;
  onPreview: (a: string, b: string) => void;
  running: boolean;
}) {
  return (
    <div className="warpline__rail">
      <RefPicker refs={refs} onRun={onRun} onPreview={onPreview} running={running} />
      <div className="wl-rail__list">
        {rows.length === 0 ? (
          <div className="wl-rail__empty">
            No Oracle runs yet. Pick two branches above and Run, or POST{' '}
            /api/warpline/oracle.
          </div>
        ) : (
          rows.map((r) => {
            const key = rowKey(r);
            const divergent = isDivergentRow(r);
            return (
              <div
                key={key}
                className={`wl-rail__row ${key === selectedKey ? 'wl-rail__row--active' : ''}`}
                onClick={() => onSelect(r)}
              >
                <span className={`wl-rail__dot ${divergent ? 'wl-rail__dot--divergent' : ''}`} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="wl-rail__branches">{ledgerRowLabel(r)}</div>
                  <div>
                    <span
                      className={`wl-rail__verdict ${
                        divergent ? 'wl-rail__verdict--divergent' : 'wl-rail__verdict--convergent'
                      }`}
                    >
                      {r.convergence?.verdict ?? '—'}
                    </span>{' '}
                    <span className="wl-rail__ts">
                      {r.ts ? new Date(r.ts).toLocaleString() : ''}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function RefPicker({
  refs,
  onRun,
  onPreview,
  running,
}: {
  refs: RefsResponse | null;
  onRun: (a: string, b: string) => void;
  onPreview: (a: string, b: string) => void;
  running: boolean;
}) {
  const branches = refs?.branches ?? [];
  const [a, setA] = useState<string>('');
  const [b, setB] = useState<string>('');

  // default the selects to head + first other branch once refs arrive
  const effA = a || refs?.head || branches[0] || '';
  const effB = b || branches.find((x) => x !== effA) || '';

  const canRun = !!effA && !!effB && effA !== effB && !running;

  return (
    <div className="wl-refpicker">
      <div className="wl-refpicker__row">
        <select value={effA} onChange={(e) => setA(e.target.value)} aria-label="branch A">
          {branches.map((br) => (
            <option key={br} value={br}>
              {br}
            </option>
          ))}
        </select>
      </div>
      <div className="wl-refpicker__weave">◀ weave ▶</div>
      <div className="wl-refpicker__row">
        <select value={effB} onChange={(e) => setB(e.target.value)} aria-label="branch B">
          {branches.map((br) => (
            <option key={br} value={br}>
              {br}
            </option>
          ))}
        </select>
      </div>
      <div className="wl-refpicker__actions">
        <button
          className="wl-btn wl-btn--run"
          disabled={!canRun}
          onClick={() => onRun(effA, effB)}
          title="POST /oracle — full git-reality, appends the ledger"
        >
          {running ? 'Running…' : 'Run'}
        </button>
        <button
          className="wl-btn"
          disabled={!canRun}
          onClick={() => onPreview(effA, effB)}
          title="POST /forecast — ephemeral meaning forecast, no ledger write"
        >
          Preview
        </button>
      </div>
    </div>
  );
}

export default OracleLedgerRail;
