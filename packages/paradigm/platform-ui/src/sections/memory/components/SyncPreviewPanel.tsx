import React, { useEffect } from 'react';
import { useMemoryStore } from '../store/memoryStore';

/**
 * The lean-rewrite PREVIEW panel. Read-only in C1: shows what `paradigm memory
 * sync` WOULD do (size delta, demotions, dedups, optional projection, and the
 * unified diff) — but nothing is applied here. A projection toggle refetches the
 * preview with projection=true.
 */
export function SyncPreviewPanel() {
  const sync = useMemoryStore((s) => s.sync);
  const loading = useMemoryStore((s) => s.syncLoading);
  const error = useMemoryStore((s) => s.syncError);
  const projection = useMemoryStore((s) => s.projection);
  const fetchSync = useMemoryStore((s) => s.fetchSync);
  const applySyncWrite = useMemoryStore((s) => s.applySyncWrite);
  const syncWriting = useMemoryStore((s) => s.syncWriting);
  const syncWriteResult = useMemoryStore((s) => s.syncWriteResult);

  useEffect(() => {
    fetchSync(false);
  }, []);

  const onApplyWrite = () => {
    const ok = window.confirm(
      'Apply the lean rewrite to MEMORY.md?\n\nMEMORY.md is backed up first (MEMORY.md.bak-<timestamp>), then rewritten atomically. Demoted entries move to an Archive section — never deleted.',
    );
    if (!ok) return;
    void applySyncWrite();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 16, color: 'var(--p-text-primary)' }}>Sync preview</h2>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--p-text-secondary)' }}>
          <input
            type="checkbox"
            checked={projection}
            onChange={(e) => fetchSync(e.target.checked)}
          />
          Include projection block
        </label>
      </div>

      {sync && sync.existed && sync.changed && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            fontSize: 12,
            color: 'var(--p-text-secondary)',
            background: 'var(--p-bg-tertiary)',
            border: '1px solid var(--p-border)',
            borderRadius: 'var(--p-radius)',
            padding: '8px 10px',
          }}
        >
          <button
            onClick={onApplyWrite}
            disabled={syncWriting}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: '5px 12px',
              borderRadius: 4,
              cursor: syncWriting ? 'default' : 'pointer',
              color: 'var(--p-text-primary)',
              background: 'var(--p-bg-card)',
              border: '1px solid var(--p-border)',
              opacity: syncWriting ? 0.6 : 1,
            }}
          >
            {syncWriting ? 'Writing…' : 'Apply sync (--write)'}
          </button>
          <span>
            Writes <strong>MEMORY.md</strong> (backed up first). Projection is{' '}
            <strong>{projection ? 'ON' : 'OFF'}</strong>.
          </span>
        </div>
      )}

      {syncWriteResult && (
        <div
          style={{
            fontSize: 12,
            color: syncWriteResult.wrote ? 'var(--p-accent-green)' : 'var(--p-text-muted)',
            background: 'var(--p-bg-tertiary)',
            border: '1px solid var(--p-border)',
            borderRadius: 'var(--p-radius)',
            padding: '6px 10px',
          }}
        >
          {syncWriteResult.wrote ? (
            <>
              Wrote MEMORY.md ({syncWriteResult.bytesAfter} bytes). Backup:{' '}
              <code style={{ fontFamily: 'monospace' }}>{syncWriteResult.backupPath}</code>
            </>
          ) : (
            'Nothing to write — MEMORY.md is already lean (or absent).'
          )}
        </div>
      )}

      {error && <div style={{ color: 'var(--p-accent-red)', fontSize: 13 }}>Error: {error}</div>}
      {loading && !sync && <div style={{ color: 'var(--p-text-muted)', fontSize: 13 }}>Loading preview…</div>}

      {sync && !sync.existed && (
        <div style={{ color: 'var(--p-text-muted)', fontSize: 13 }}>
          No native MEMORY.md found for this project; nothing to sync.
        </div>
      )}

      {sync && sync.existed && (
        <>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: 'var(--p-text-secondary)' }}>
            <span>
              bytes{' '}
              <strong style={{ color: 'var(--p-text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                {sync.bytesBefore} → {sync.bytesAfter}
              </strong>
            </span>
            <span>
              lines{' '}
              <strong style={{ color: 'var(--p-text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                {sync.linesBefore} → {sync.linesAfter}
              </strong>
            </span>
            <span style={{ color: sync.changed ? 'var(--p-accent-amber)' : 'var(--p-accent-green)' }}>
              {sync.changed ? 'changes proposed' : 'already lean'}
            </span>
          </div>

          {sync.demoted.length > 0 && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <h3 style={{ margin: 0, fontSize: 13, color: 'var(--p-text-secondary)' }}>
                Demotable leaf entries (→ Archive on write, never deleted) ({sync.demoted.length})
              </h3>
              {sync.demoted.map((d, i) => (
                <div
                  key={i}
                  style={{
                    padding: '8px 10px',
                    background: 'var(--p-bg-card)',
                    border: '1px solid var(--p-border)',
                    borderRadius: 'var(--p-radius)',
                  }}
                >
                  <div style={{ color: 'var(--p-text-primary)', fontSize: 13, fontWeight: 600 }}>{d.heading}</div>
                  <div style={{ color: 'var(--p-text-secondary)', fontSize: 12 }}>{d.reason}</div>
                  <code style={{ color: 'var(--p-text-muted)', fontSize: 12, fontFamily: 'monospace' }}>
                    → {d.applyHint}
                  </code>
                </div>
              ))}
            </section>
          )}

          {sync.deduped.length > 0 && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <h3 style={{ margin: 0, fontSize: 13, color: 'var(--p-text-secondary)' }}>
                Dedup candidates (exact-duplicate blocks; first kept) ({sync.deduped.length})
              </h3>
              {sync.deduped.map((d, i) => (
                <div key={i} style={{ color: 'var(--p-text-primary)', fontSize: 13 }}>
                  {d.heading}
                </div>
              ))}
            </section>
          )}

          {sync.projectionEnabled && sync.projectionItems.length > 0 && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <h3 style={{ margin: 0, fontSize: 13, color: 'var(--p-text-secondary)' }}>
                Projection preview (curated block) ({sync.projectionItems.length})
              </h3>
              {sync.projectionItems.map((it, i) => (
                <div key={i} style={{ color: 'var(--p-text-primary)', fontSize: 13 }}>
                  <span style={{ color: 'var(--p-text-muted)' }}>[{it.kind}]</span> {it.title}
                </div>
              ))}
            </section>
          )}

          {sync.diff && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <h3 style={{ margin: 0, fontSize: 13, color: 'var(--p-text-secondary)' }}>Diff</h3>
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  overflowX: 'auto',
                  maxHeight: 400,
                  fontSize: 12,
                  fontFamily: 'monospace',
                  lineHeight: 1.5,
                  color: 'var(--p-text-secondary)',
                  background: 'var(--p-bg-tertiary)',
                  border: '1px solid var(--p-border)',
                  borderRadius: 'var(--p-radius)',
                  whiteSpace: 'pre',
                }}
              >
                {sync.diff}
              </pre>
            </section>
          )}
        </>
      )}
    </div>
  );
}
