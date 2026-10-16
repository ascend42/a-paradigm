import React from 'react';
import type { LockedArea } from '../store/brainStore';
import { lockedFolderLabel, lockedKindLabel, plural } from '../labels';
import { card, h2, muted, num, row } from './styles';

/** Private & Locked — a lock and a count per folder. Never filenames. */
export function LockedPanel({ locked }: { locked: LockedArea[] }) {
  return (
    <div style={card}>
      <h2 style={h2}>Private &amp; Locked</h2>
      <div style={muted}>
        These stay on this Mac and are never listed, searched or suggested. Only the count is shown.
      </div>
      {locked.length === 0 && <div style={muted}>Nothing locked.</div>}
      {locked.map((z, i) => (
        <div key={i} style={row}>
          <span>
            <span aria-label="locked" style={{ marginRight: 6 }}>🔒</span>
            {lockedFolderLabel(z.folder)} <span style={{ color: 'var(--p-text-muted)' }}>· {lockedKindLabel(z.gate)}</span>
          </span>
          <span style={num}>{plural(z.count, 'file')}</span>
        </div>
      ))}
    </div>
  );
}
