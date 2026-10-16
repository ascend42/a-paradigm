import React, { useState } from 'react';
import type { Badge, EgressItem } from '../store/brainStore';
import { badgeText, whenText } from '../labels';
import { muted } from './styles';

/** "Nothing has left this Mac", or "N things shared → see what left" (opens the egress list). */
export function PrivacyBadge({ badge, egress }: { badge: Badge; egress: EgressItem[] }) {
  const [open, setOpen] = useState(false);
  const color = badge.nothingLeft ? 'var(--p-accent-green)' : 'var(--p-accent-amber)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
          color,
          border: `1px solid ${color}`,
          borderRadius: 999,
          padding: '3px 10px',
          alignSelf: 'flex-start',
        }}
      >
        <span aria-hidden>{badge.nothingLeft ? '●' : '◐'}</span>
        {badgeText(badge.nothingLeft, badge.count)}
        {!badge.nothingLeft && (
          <button
            onClick={() => setOpen((o) => !o)}
            style={{ background: 'none', border: 'none', color: 'var(--p-accent-blue)', cursor: 'pointer', fontSize: 13, padding: 0 }}
          >
            → {open ? 'hide' : 'see what left'}
          </button>
        )}
      </span>
      {open && (
        <div style={{ fontSize: 12, color: 'var(--p-text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {egress.length === 0 && <span style={muted}>No details recorded.</span>}
          {egress.map((e, i) => (
            <span key={i}>
              {whenText(e.at)} — {e.items} {e.items === 1 ? 'note' : 'notes'} described to{' '}
              {e.channel === 'cloud' ? 'a cloud helper' : 'an AI assistant on this Mac'} ({e.bytes.toLocaleString()} bytes)
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
