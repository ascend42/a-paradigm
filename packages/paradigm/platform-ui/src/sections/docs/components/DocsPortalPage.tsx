import React from 'react';
import { SymbolLink } from './SymbolLink';
import { GateChain } from './GateChain';
import type { PageData } from '../store/docsStore';

export function DocsPortalPage({ data }: { data: PageData }) {
  const d = data as any;
  return (
    <div className="docs-page docs-page--portal">
      <header className="docs-page__header">
        <h1 className="docs-page__title">Portal — Gates & Routes</h1>
      </header>

      {d.gates?.length > 0 && (
        <section className="docs-page__section">
          <h2>Gates</h2>
          <table className="docs-table">
            <thead>
              <tr><th>Gate</th><th>Description</th><th>Routes</th></tr>
            </thead>
            <tbody>
              {d.gates.map((g: any) => (
                <tr key={g.symbol}>
                  <td><SymbolLink symbol={g.symbol} /></td>
                  <td>{g.description}</td>
                  <td>{g.routes?.length || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {d.routes?.length > 0 && (
        <section className="docs-page__section">
          <h2>Routes</h2>
          <table className="docs-table">
            <thead>
              <tr><th>Method</th><th>Route</th><th>Gate Chain</th></tr>
            </thead>
            <tbody>
              {d.routes.map((r: any, i: number) => (
                <tr key={i}>
                  <td><code className="docs-method">{r.method}</code></td>
                  <td><code>{r.route}</code></td>
                  <td><GateChain gates={r.gates || []} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {(!d.gates || d.gates.length === 0) && (!d.routes || d.routes.length === 0) && (
        <p className="docs-page__empty">No portal.yaml found. Add one to document your API authorization.</p>
      )}
    </div>
  );
}
