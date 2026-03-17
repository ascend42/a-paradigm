import React from 'react';
import { FlowSteps } from './FlowSteps';
import { SymbolLink } from './SymbolLink';
import type { PageData } from '../store/docsStore';

export function DocsFlowPage({ data }: { data: PageData }) {
  const d = data as any;
  return (
    <div className="docs-page docs-page--flow">
      <header className="docs-page__header">
        <span className="docs-page__symbol" data-kind="flows">{d.symbol}</span>
        <h1 className="docs-page__title">{d.name}</h1>
      </header>

      {d.description && <p className="docs-page__description">{d.description}</p>}

      {d.trigger && (
        <div className="docs-page__trigger">
          <strong>Trigger:</strong> <code>{d.trigger}</code>
        </div>
      )}

      {d.steps?.length > 0 && (
        <section className="docs-page__section">
          <h2>Steps</h2>
          <FlowSteps steps={d.steps} />
        </section>
      )}

      {d.successSignal && (
        <div className="docs-page__signal">
          <strong>Success:</strong> <SymbolLink symbol={d.successSignal} />
        </div>
      )}

      {d.errorSignal && (
        <div className="docs-page__signal docs-page__signal--error">
          <strong>Error:</strong> <SymbolLink symbol={d.errorSignal} />
        </div>
      )}

      {d.tags?.length > 0 && (
        <div className="docs-page__tags">
          {d.tags.map((t: string) => <span key={t} className="docs-page__tag">{t}</span>)}
        </div>
      )}
    </div>
  );
}
