import React from 'react';
import { useDocsStore } from '../store/docsStore';
import { SymbolLink } from './SymbolLink';

export function DocsSearch() {
  const searchResults = useDocsStore(s => s.searchResults);
  const searchQuery = useDocsStore(s => s.searchQuery);
  const searchLoading = useDocsStore(s => s.searchLoading);
  const selectPage = useDocsStore(s => s.selectPage);
  const clearSearch = useDocsStore(s => s.clearSearch);

  if (searchLoading) return <div className="docs__loading">Searching...</div>;

  return (
    <div className="docs-search">
      <h2 className="docs-search__title">
        {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for "{searchQuery}"
      </h2>
      {searchResults.length === 0 && <p className="docs-search__empty">No matching documentation found.</p>}
      <div className="docs-search__results">
        {searchResults.map(r => (
          <button
            key={r.id}
            className="docs-search__result"
            onClick={() => {
              clearSearch();
              const kindMap: Record<string, 'symbol' | 'flow' | 'portal' | 'custom'> = {
                component: 'symbol', signal: 'symbol', aspect: 'symbol', gate: 'symbol',
                flow: 'flow', portal: 'portal', custom: 'custom',
              };
              selectPage(kindMap[r.kind] || 'symbol', r.id);
            }}
          >
            <div className="docs-search__result-header">
              <span className="docs-search__result-kind" data-kind={r.kind}>{r.kind}</span>
              <span className="docs-search__result-label">{r.label}</span>
            </div>
            <p className="docs-search__result-desc">{r.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
