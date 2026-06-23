import React, { useEffect, useState } from 'react';

/**
 * Warpline section — sub-phase 1 (the trivial slice).
 *
 * Fetches GET /api/warpline/ledger and renders a plain TABLE of past Oracle runs
 * (branchA → branchB, verdict, score, divergeMeaningOnly count). No viz — this
 * exists only to prove the data round-trips end-to-end (router → engine shapes →
 * UI). The rich Oracle Divergence Viewer is sub-phase 2 (gated on a design pass).
 */

// Minimal mirror of the engine's OracleRecord shape (only the fields this table
// reads). The full type lives in @a-company/warpline; sub-phase 2 will import it.
interface LedgerRow {
  ts: string;
  branchA: string;
  branchB: string;
  convergence?: {
    verdict?: 'CONVERGENT' | 'DIVERGENT';
    score?: number;
    divergeMeaningOnly?: string[];
  };
}

export default function WarplineSection() {
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/warpline/ledger?limit=100')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: LedgerRow[]) => {
        if (!cancelled) setRows(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ padding: 24, color: 'var(--p-text-primary)' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 22 }}>Warpline · Oracle Ledger</h2>
      <p style={{ margin: '0 0 20px', color: 'var(--p-text-muted)', fontSize: 13 }}>
        Past Convergence/Divergence Oracle runs (read-only). The seam between git's bytes and
        Warpline's meaning. Rich viewer coming in sub-phase 2.
      </p>

      {error && (
        <div style={{ color: 'var(--p-danger, #f85149)' }}>Failed to load ledger: {error}</div>
      )}

      {!error && rows === null && (
        <div style={{ color: 'var(--p-text-muted)' }}>Loading ledger…</div>
      )}

      {!error && rows?.length === 0 && (
        <div style={{ color: 'var(--p-text-muted)' }}>
          No Oracle runs yet. Run <code style={{ background: 'var(--p-surface, #21262d)', padding: '2px 6px', borderRadius: 4 }}>warpline oracle &lt;A&gt; &lt;B&gt;</code> (or POST /api/warpline/oracle) to populate the ledger.
        </div>
      )}

      {!error && rows && rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--p-text-muted)', borderBottom: '1px solid var(--p-border, #30363d)' }}>
              <th style={cell}>When</th>
              <th style={cell}>Merge</th>
              <th style={cell}>Verdict</th>
              <th style={cell}>Score</th>
              <th style={cell}>Meaning-only diverge</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const c = r.convergence ?? {};
              const meaningOnly = c.divergeMeaningOnly?.length ?? 0;
              const divergent = c.verdict === 'DIVERGENT';
              return (
                <tr key={i} style={{ borderBottom: '1px solid var(--p-border, #30363d)' }}>
                  <td style={cell}>{r.ts ? new Date(r.ts).toLocaleString() : '—'}</td>
                  <td style={{ ...cell, fontFamily: 'monospace' }}>{r.branchA} → {r.branchB}</td>
                  <td style={{ ...cell, color: divergent ? 'var(--p-warpline-seam, #a371f7)' : 'var(--p-success, #3fb950)', fontWeight: 600 }}>
                    {c.verdict ?? '—'}
                  </td>
                  <td style={cell}>{typeof c.score === 'number' ? c.score.toFixed(2) : '—'}</td>
                  <td style={{ ...cell, color: meaningOnly > 0 ? 'var(--p-warpline-seam, #a371f7)' : undefined, fontWeight: meaningOnly > 0 ? 600 : undefined }}>
                    {meaningOnly}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

const cell: React.CSSProperties = { padding: '8px 12px' };
