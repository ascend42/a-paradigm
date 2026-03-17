import React from 'react';
import { SymbolLink } from './SymbolLink';
import { PropertyTable } from './PropertyTable';
import type { PageData } from '../store/docsStore';

export function DocsSymbolPage({ data }: { data: PageData }) {
  const d = data as any;
  return (
    <div className="docs-page docs-page--symbol">
      <header className="docs-page__header">
        <span className="docs-page__symbol" data-kind={d.category}>{d.symbol}</span>
        <h1 className="docs-page__title">{d.name}</h1>
        {d.componentType && <span className="docs-page__type">{d.componentType}</span>}
      </header>

      {d.description && <p className="docs-page__description">{d.description}</p>}

      {d.tags?.length > 0 && (
        <div className="docs-page__tags">
          {d.tags.map((t: string) => <span key={t} className="docs-page__tag">{t}</span>)}
        </div>
      )}

      <PropertyTable entries={[
        { key: 'Path', value: d.path },
        ...(d.parent ? [{ key: 'Parent', value: d.parent }] : []),
        ...(d.children?.length ? [{ key: 'Children', value: d.children.join(', ') }] : []),
      ]} />

      {d.related?.length > 0 && (
        <section className="docs-page__section">
          <h2>Related Symbols</h2>
          <div className="docs-page__symbol-list">
            {d.related.map((r: string) => <SymbolLink key={r} symbol={r} />)}
          </div>
        </section>
      )}

      {d.referencedBy?.length > 0 && (
        <section className="docs-page__section">
          <h2>Referenced By</h2>
          <div className="docs-page__symbol-list">
            {d.referencedBy.map((r: string) => <SymbolLink key={r} symbol={r} />)}
          </div>
        </section>
      )}

      {d.references?.length > 0 && (
        <section className="docs-page__section">
          <h2>References</h2>
          <div className="docs-page__symbol-list">
            {d.references.map((r: string) => <SymbolLink key={r} symbol={r} />)}
          </div>
        </section>
      )}

      {d.flows?.length > 0 && (
        <section className="docs-page__section">
          <h2>Flows</h2>
          <div className="docs-page__symbol-list">
            {d.flows.map((f: any) => <SymbolLink key={f.id} symbol={`$${f.id}`} label={f.name} />)}
          </div>
        </section>
      )}

      {d.gates?.length > 0 && (
        <section className="docs-page__section">
          <h2>Gates</h2>
          <div className="docs-page__symbol-list">
            {d.gates.map((g: any) => <SymbolLink key={g.id} symbol={`^${g.id}`} label={g.description} />)}
          </div>
        </section>
      )}

      {d.guides?.length > 0 && (
        <section className="docs-page__section">
          <h2>Related Guides</h2>
          {d.guides.map((g: any) => (
            <div key={g.id} className="docs-page__guide">{g.title}</div>
          ))}
        </section>
      )}
    </div>
  );
}
