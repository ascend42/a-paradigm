import React from 'react';
import { useMemoryStore, type DigestItem, type MemorySuggestion } from '../store/memoryStore';

// Human label for the one-click apply button, driven by the row's suggestion.
const ACTION_LABEL: Record<MemorySuggestion, string> = {
  prune: 'Prune',
  merge: 'Merge cluster',
  'route:habits': 'Route → habits',
  'route:task': 'Route → tasks',
  'route:decisions': 'Route → decisions',
  'route:lore': 'Route → lore',
  pin: 'Pin',
};

/**
 * One memory-entry finding with a one-click apply button (C2). The button POSTs
 * the row's suggested action through the memory-write router (which proxies the
 * same appliers the CLI uses). Prune archives a file, so it confirms first.
 */
export function LedgerRow({ item }: { item: DigestItem }) {
  const applyRow = useMemoryStore((s) => s.applyRow);
  const actionPendingId = useMemoryStore((s) => s.actionPendingId);

  const pendingKey = item.suggestion === 'merge' && item.clusterId ? `merge:${item.clusterId}` : item.id;
  const pending = actionPendingId === pendingKey;
  const anyPending = actionPendingId !== null;

  // Staleness 0..1 → a calm color ramp (low = green, high = red).
  const staleColor =
    item.score >= 0.66
      ? 'var(--p-accent-red)'
      : item.score >= 0.33
        ? 'var(--p-accent-amber)'
        : 'var(--p-accent-green)';

  const verdictColor =
    item.verdict === 'valid'
      ? 'var(--p-accent-green)'
      : item.verdict === 'invalid'
        ? 'var(--p-accent-red)'
        : 'var(--p-text-muted)';

  const onApply = () => {
    // Confirm before an archive-a-file action (prune). Others are reversible-ish
    // (route archives the source too but into typed homes; pin is a toggle).
    if (item.suggestion === 'prune') {
      const ok = window.confirm(`Prune (archive) "${item.name}"? The file is archived, never deleted.`);
      if (!ok) return;
    }
    void applyRow(item);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '10px 12px',
        background: 'var(--p-bg-card)',
        border: '1px solid var(--p-border)',
        borderRadius: 'var(--p-radius)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, color: 'var(--p-text-primary)' }}>{item.name}</span>
        <span
          title="staleness 0–1"
          style={{ fontSize: 12, color: staleColor, fontVariantNumeric: 'tabular-nums' }}
        >
          staleness {item.score.toFixed(2)}
        </span>
        <span style={{ fontSize: 12, color: verdictColor }}>· {item.verdict}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--p-text-muted)', fontFamily: 'monospace' }}>
          {item.id}
        </span>
      </div>

      <div style={{ fontSize: 13, color: 'var(--p-text-secondary)', lineHeight: 1.4 }}>
        {item.rationale}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
        <button
          onClick={onApply}
          disabled={anyPending}
          title={`Apply: ${item.applyCommand}`}
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: '4px 10px',
            borderRadius: 4,
            cursor: anyPending ? 'default' : 'pointer',
            color: 'var(--p-text-primary)',
            background: 'var(--p-bg-tertiary)',
            border: '1px solid var(--p-border)',
            opacity: anyPending && !pending ? 0.5 : 1,
          }}
        >
          {pending ? 'Applying…' : ACTION_LABEL[item.suggestion]}
        </button>

        <code
          title="The equivalent CLI command"
          style={{
            fontSize: 12,
            fontFamily: 'monospace',
            color: 'var(--p-text-muted)',
            background: 'var(--p-bg-tertiary)',
            padding: '2px 6px',
            borderRadius: 4,
          }}
        >
          {item.applyCommand}
        </code>
      </div>
    </div>
  );
}
