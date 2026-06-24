import React, { useEffect, useState } from 'react';
import type { OracleRecord, RefsResponse } from './types';
import { forecastToRecord, rowKey } from './viewerState';
import { OracleLedgerRail } from './components/OracleLedgerRail';
import { OracleDivergenceViewer } from './components/OracleDivergenceViewer';
import './styles/warpline.css';

/**
 * Warpline section — sub-phase 2: the Oracle Divergence Viewer.
 *
 * Layout: a left OracleLedgerRail (RefPicker + /ledger rows newest-first, live via
 * the `warpline:oracle-record-appended` WS broadcast) beside the
 * OracleDivergenceViewer (the meaning-vs-bytes hero · the literal 2×2 · the
 * verdict card · the knot/dangle render · a basic drill-down slide-over).
 *
 * Data layers consumed (all read-only):
 *   GET  /api/warpline/ledger?limit=  — past OracleRecords
 *   GET  /api/warpline/refs           — branch selects
 *   POST /api/warpline/oracle         — Run (records → prepends via WS)
 *   POST /api/warpline/forecast?vsGit — Preview (ephemeral, adapted to a record)
 *
 * WS: the central hub (useAgentEffects) forwards `warpline:*` server broadcasts
 * as a `warpline-ws` CustomEvent; on `warpline:oracle-record-appended` we prepend
 * the new row so a live run repaints the rail without a poll.
 */
export default function WarplineSection() {
  const [rows, setRows] = useState<OracleRecord[]>([]);
  const [refs, setRefs] = useState<RefsResponse | null>(null);
  const [selected, setSelected] = useState<OracleRecord | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // initial ledger + refs
  useEffect(() => {
    let cancelled = false;
    fetch('/api/warpline/ledger?limit=200')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: OracleRecord[]) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        setRows(list);
        if (list.length > 0) setSelected(list[0]);
      })
      .catch((err) => !cancelled && setError(String(err)));

    fetch('/api/warpline/refs')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: RefsResponse | null) => !cancelled && data && setRefs(data))
      .catch(() => {
        /* refs are best-effort — the picker just shows empty */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // WS live repaint — prepend a newly-appended record (deduped by rowKey).
  useEffect(() => {
    function onWarplineWs(e: Event) {
      const msg = (e as CustomEvent).detail;
      if (!msg || msg.type !== 'warpline:oracle-record-appended' || !msg.record) return;
      const record = msg.record as OracleRecord;
      setRows((prev) => {
        const k = rowKey(record);
        if (prev.some((r) => rowKey(r) === k)) return prev;
        return [record, ...prev];
      });
    }
    window.addEventListener('warpline-ws', onWarplineWs);
    return () => window.removeEventListener('warpline-ws', onWarplineWs);
  }, []);

  const runOracle = async (a: string, b: string) => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/warpline/oracle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchA: a, branchB: b }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const record: OracleRecord = await res.json();
      // prepend immediately (the WS broadcast also fires, but dedupes by rowKey)
      setRows((prev) => {
        const k = rowKey(record);
        return prev.some((r) => rowKey(r) === k) ? prev : [record, ...prev];
      });
      setSelected(record);
    } catch (err) {
      setError(`Oracle failed: ${String(err)}`);
    } finally {
      setRunning(false);
    }
  };

  const runPreview = async (a: string, b: string) => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/warpline/forecast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // vsGit so the preview carries the full convergence + git reality.
        body: JSON.stringify({ branchA: a, branchB: b, vsGit: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const forecast = await res.json();
      // ephemeral — never added to the ledger rows, just rendered.
      setSelected(forecastToRecord(forecast));
    } catch (err) {
      setError(`Preview failed: ${String(err)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="warpline">
      <OracleLedgerRail
        rows={rows}
        refs={refs}
        selectedKey={selected ? rowKey(selected) : null}
        onSelect={setSelected}
        onRun={runOracle}
        onPreview={runPreview}
        running={running}
      />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {error && (
          <div
            style={{
              padding: '8px 16px',
              color: 'var(--p-accent-red)',
              fontSize: 12,
              borderBottom: '1px solid var(--p-border)',
            }}
          >
            {error}
          </div>
        )}
        <OracleDivergenceViewer record={selected} />
      </div>
    </div>
  );
}
