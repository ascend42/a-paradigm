import React from 'react';
import type { NoteDetail } from '../store/academyStore';
import { renderMarkdown } from '../../docs/components/DocsCustomPage';

/** A note rendered with the Platform's markdown renderer (HTML-escaped first). */
export function NoteView({ note }: { note: NoteDetail }) {
  const fm = note.frontmatter;
  return (
    <article style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2 style={{ margin: 0, fontSize: 18, color: 'var(--p-text-primary)' }}>{fm.title || fm.id}</h2>
      <div style={{ fontSize: 12, color: 'var(--p-text-muted)' }}>
        {fm.difficulty}
        {typeof fm.estimatedMinutes === 'number' && ` · about ${fm.estimatedMinutes} min`}
      </div>
      <div
        className="docs-page__body"
        style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--p-text-primary)' }}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(note.body || '') }}
      />
    </article>
  );
}
