import React from 'react';
import type { PageData } from '../store/docsStore';
import { renderMarkdown } from '../renderMarkdown';

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

// Shared with the Academy NoteView; lives in a React-free module so it unit-tests in node.
export { renderMarkdown };
