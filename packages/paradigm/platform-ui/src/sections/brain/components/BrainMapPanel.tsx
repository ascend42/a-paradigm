import React from 'react';
import type { BrainMap } from '../store/brainStore';
import { RECENCY_LABELS, SIZE_LABELS, TYPE_LABELS } from '../labels';
import { card, h2, num, row } from './styles';

function Group<K extends string>({ title, counts, labels }: { title: string; counts: Record<K, number>; labels: Record<K, string> }) {
  const total = Object.values<number>(counts).reduce((a, b) => a + b, 0) || 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--p-text-muted)' }}>{title}</div>
      {(Object.keys(labels) as K[]).map((k) =>
        counts[k] ? (
          <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={row}>
              <span>{labels[k]}</span>
              <span style={num}>{counts[k].toLocaleString()}</span>
            </div>
            <div style={{ height: 4, background: 'var(--p-bg-tertiary)', borderRadius: 2 }}>
              <div style={{ width: `${(counts[k] / total) * 100}%`, height: 4, background: 'var(--p-accent-blue)', borderRadius: 2 }} />
            </div>
          </div>
        ) : null,
      )}
    </div>
  );
}

/** Map of what's in the folder: counts by type, size and recency. */
export function BrainMapPanel({ map, visible }: { map: BrainMap; visible: number }) {
  return (
    <div style={card}>
      <h2 style={h2}>Your notes at a glance</h2>
      <div style={{ fontSize: 13, color: 'var(--p-text-secondary)' }}>{visible.toLocaleString()} files you can browse</div>
      <Group title="Type" counts={map.byType} labels={TYPE_LABELS} />
      <Group title="Size" counts={map.bySize} labels={SIZE_LABELS} />
      <Group title="Last changed" counts={map.byRecency} labels={RECENCY_LABELS} />
    </div>
  );
}
