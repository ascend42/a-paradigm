import React from 'react';
import { useBrainStore } from '../store/brainStore';
import { MATCH_LABELS } from '../labels';
import { card, errorText, h2, muted } from './styles';

/** Find — searches titles, headings, locations and topics of browsable notes. */
export function FindPanel() {
  const query = useBrainStore((s) => s.query);
  const hits = useBrainStore((s) => s.hits);
  const finding = useBrainStore((s) => s.finding);
  const error = useBrainStore((s) => s.findError);
  const find = useBrainStore((s) => s.find);

  return (
    <div style={card}>
      <h2 style={h2}>Find</h2>
      <input
        type="search"
        value={query}
        maxLength={200}
        placeholder='Ask for something, e.g. "lease"'
        onChange={(e) => find(e.target.value)}
        style={{
          fontSize: 14,
          padding: '8px 10px',
          borderRadius: 'var(--p-radius)',
          border: '1px solid var(--p-border)',
          background: 'var(--p-bg-primary)',
          color: 'var(--p-text-primary)',
        }}
      />
      {error && <div style={errorText}>{error}</div>}
      {finding && <div style={muted}>Searching…</div>}
      {!finding && query.trim() && hits.length === 0 && !error && <div style={muted}>Nothing found.</div>}
      {hits.map((h) => (
        <div key={h.id} style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 13 }}>
          <span style={{ color: 'var(--p-text-primary)' }}>{h.title}</span>
          <span style={{ color: 'var(--p-text-muted)', fontSize: 12 }}>
            {h.path} · matched by {MATCH_LABELS[h.matched] ?? 'text'}
            {h.topics.length > 0 && ` · topics: ${h.topics.join(', ')}`}
          </span>
        </div>
      ))}
    </div>
  );
}
