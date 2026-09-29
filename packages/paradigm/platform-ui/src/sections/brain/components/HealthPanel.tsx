import React from 'react';
import type { Health, NoteRef } from '../store/brainStore';
import { card, errorText, h2, muted } from './styles';

function Section({ title, hint, children, count }: { title: string; hint: string; count: number; children: React.ReactNode }) {
  return (
    <details open={count > 0 && count <= 5} style={{ fontSize: 13 }}>
      <summary style={{ cursor: 'pointer', color: 'var(--p-text-primary)' }}>
        {title} <span style={{ color: count ? 'var(--p-accent-amber)' : 'var(--p-accent-green)' }}>({count})</span>
      </summary>
      <div style={{ ...muted, margin: '4px 0 6px' }}>{hint}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--p-text-secondary)' }}>{children}</div>
    </details>
  );
}

const Note = ({ n }: { n: NoteRef }) => (
  <span title={n.path}>
    {n.title} <span style={{ color: 'var(--p-text-muted)' }}>— {n.path}</span>
  </span>
);

/** Broken links / Loose notes / Same-name notes. */
export function HealthPanel({ health, error }: { health: Health | null; error: string | null }) {
  return (
    <div style={card}>
      <h2 style={h2}>Health</h2>
      {error && <div style={errorText}>Couldn't check your notes: {error}</div>}
      {!health && !error && <div style={muted}>Checking…</div>}
      {health && (
        <>
          <Section title="Broken links" hint="Links that point to a note that isn't there." count={health.brokenLinks.length}>
            {health.brokenLinks.slice(0, 50).map((b, i) => (
              <span key={i}>
                <Note n={b.from} /> → <em>{b.target}</em>
              </span>
            ))}
          </Section>
          <Section title="Loose notes" hint="Notes nothing links to and that link to nothing." count={health.looseNotes.length}>
            {health.looseNotes.slice(0, 50).map((n) => (
              <Note key={n.id} n={n} />
            ))}
          </Section>
          <Section title="Same-name notes" hint="Different notes with the same name or title — links may land on the wrong one." count={health.sameName.length}>
            {health.sameName.slice(0, 50).map((g, i) => (
              <span key={i}>
                <strong>{g.name}</strong>: {g.notes.map((n) => n.path).join(', ')}
              </span>
            ))}
          </Section>
        </>
      )}
    </div>
  );
}
