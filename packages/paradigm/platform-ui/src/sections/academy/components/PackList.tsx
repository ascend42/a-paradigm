import React from 'react';
import type { PackSummary } from '../store/academyStore';

function countLine(counts: Record<string, number>): string {
  const parts = Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, n]) => `${n} ${type}${n === 1 ? '' : 's'}`);
  return parts.length > 0 ? parts.join(' · ') : 'no content yet';
}

export function PackList({
  packs,
  selectedId,
  onSelect,
}: {
  packs: PackSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {packs.map((p) => {
        const active = p.id === selectedId;
        return (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            style={{
              textAlign: 'left',
              background: active ? 'var(--p-bg-tertiary)' : 'var(--p-bg-secondary)',
              border: `1px solid ${active ? 'var(--p-accent-blue)' : 'var(--p-border)'}`,
              borderRadius: 'var(--p-radius)',
              padding: '10px 12px',
              cursor: 'pointer',
              color: 'var(--p-text-primary)',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600 }}>{p.title}</div>
            <div style={{ fontSize: 12, color: 'var(--p-text-muted)', marginTop: 2 }}>
              {p.id} &middot; {p.tenant_kind}
            </div>
            <div style={{ fontSize: 12, color: 'var(--p-text-secondary)', marginTop: 4 }}>{countLine(p.counts)}</div>
            {p.skillCount > 0 && (
              <div style={{ fontSize: 12, color: 'var(--p-text-muted)', marginTop: 2 }}>
                {p.skillCount} skill{p.skillCount === 1 ? '' : 's'} included
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
