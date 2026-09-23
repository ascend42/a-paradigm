import React from 'react';
import type { DigestItem, MemorySuggestion } from '../store/memoryStore';
import { LedgerRow } from './LedgerRow';

// The CLI's heading labels (SUGGESTION_HEADINGS in commands/memory/index.ts) —
// reused verbatim so the web ledger reads identically to `paradigm memory review`.
export const SUGGESTION_HEADINGS: Record<MemorySuggestion, string> = {
  prune: 'Prune (provably stale — nothing it references still exists)',
  merge: 'Merge (near-duplicate)',
  'route:habits': 'Route → habits (feedback/tips)',
  'route:task': 'Route → tasks (project/status)',
  'route:decisions': 'Route → decisions (durable "why")',
  'route:lore': 'Route → lore',
  pin: 'Pin (high-value durable knowledge)',
};

export function LedgerGroup({
  suggestion,
  items,
}: {
  suggestion: MemorySuggestion;
  items: DigestItem[];
}) {
  if (items.length === 0) return null;
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3
        style={{
          margin: '4px 0',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--p-text-secondary)',
          textTransform: 'none',
        }}
      >
        {SUGGESTION_HEADINGS[suggestion]}{' '}
        <span style={{ color: 'var(--p-text-muted)', fontWeight: 400 }}>({items.length})</span>
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((item) => (
          <LedgerRow key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}
