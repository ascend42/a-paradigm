import React, { useEffect } from 'react';
import { useMemoryStore, type MemorySuggestion, type DigestItem } from './store/memoryStore';
import { LedgerGroup, SUGGESTION_HEADINGS } from './components/LedgerGroup';
import { SyncPreviewPanel } from './components/SyncPreviewPanel';

// Group order mirrors the CLI's SUGGESTION_HEADINGS key order.
const SUGGESTION_ORDER = Object.keys(SUGGESTION_HEADINGS) as MemorySuggestion[];

/**
 * Memory Steward ledger — READ-ONLY (Phase C1, TD-2026-09-20-669). A ledger view
 * (the advisory hygiene digest grouped by suggestion) beside the lean-rewrite
 * sync preview. Nothing here mutates memory; apply/write verbs arrive in C2/C3.
 */
export default function MemorySection() {
  const digest = useMemoryStore((s) => s.digest);
  const loading = useMemoryStore((s) => s.digestLoading);
  const error = useMemoryStore((s) => s.digestError);
  const fetchReview = useMemoryStore((s) => s.fetchReview);
  const actionError = useMemoryStore((s) => s.actionError);
  const clearActionError = useMemoryStore((s) => s.clearActionError);

  useEffect(() => {
    fetchReview();
  }, []);

  const grouped = new Map<MemorySuggestion, DigestItem[]>();
  for (const item of digest?.items ?? []) {
    const list = grouped.get(item.suggestion) ?? [];
    list.push(item);
    grouped.set(item.suggestion, list);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--p-border)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--p-text-primary)' }}>Memory</span>
          <span style={{ fontSize: 13, color: 'var(--p-text-muted)' }}>
            {digest ? (
              <>
                {digest.scanned} scanned &middot; {digest.pinned} pinned &middot; {digest.items.length} findings
              </>
            ) : (
              'the Memory Steward ledger'
            )}
          </span>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: 24,
          padding: 24,
          overflow: 'auto',
          flex: 1,
        }}
      >
        {/* Ledger (advisory digest) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16, color: 'var(--p-text-primary)' }}>Ledger</h2>
          {error && <div style={{ color: 'var(--p-accent-red)', fontSize: 13 }}>Error: {error}</div>}
          {actionError && (
            <div
              onClick={clearActionError}
              title="Click to dismiss"
              style={{
                color: 'var(--p-accent-red)',
                fontSize: 13,
                cursor: 'pointer',
                background: 'var(--p-bg-tertiary)',
                border: '1px solid var(--p-border)',
                borderRadius: 'var(--p-radius)',
                padding: '6px 10px',
              }}
            >
              Apply failed: {actionError}
            </div>
          )}
          {loading && !digest && <div style={{ color: 'var(--p-text-muted)', fontSize: 13 }}>Loading ledger…</div>}
          {digest && digest.items.length === 0 && !loading && (
            <div style={{ color: 'var(--p-accent-green)', fontSize: 13 }}>
              No memory hygiene findings. Nothing to do.
            </div>
          )}
          {SUGGESTION_ORDER.map((suggestion) => (
            <LedgerGroup key={suggestion} suggestion={suggestion} items={grouped.get(suggestion) ?? []} />
          ))}
        </div>

        {/* Sync preview */}
        <div>
          <SyncPreviewPanel />
        </div>
      </div>
    </div>
  );
}
