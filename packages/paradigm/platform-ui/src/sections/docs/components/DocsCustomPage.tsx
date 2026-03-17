import React from 'react';
import type { PageData } from '../store/docsStore';

export function DocsCustomPage({ data }: { data: PageData }) {
  const d = data as any;
  return (
    <div className="docs-page docs-page--custom">
      <header className="docs-page__header">
        <h1 className="docs-page__title">{d.title || d.slug}</h1>
      </header>
      {d.description && <p className="docs-page__description">{d.description}</p>}
      <div className="docs-page__body" dangerouslySetInnerHTML={{ __html: renderMarkdown(d.body || '') }} />
    </div>
  );
}

/** Simple markdown rendering — basic subset for docs pages */
function renderMarkdown(md: string): string {
  return md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>');
}
