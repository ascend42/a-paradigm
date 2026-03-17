import React, { useEffect } from 'react';
import { useDocsStore } from './store/docsStore';
import { DocsSidebar } from './components/DocsSidebar';
import { DocsSymbolPage } from './components/DocsSymbolPage';
import { DocsFlowPage } from './components/DocsFlowPage';
import { DocsPortalPage } from './components/DocsPortalPage';
import { DocsCustomPage } from './components/DocsCustomPage';
import { DocsSearch } from './components/DocsSearch';
import './styles/docs.css';

export default function DocsSection() {
  const manifest = useDocsStore(s => s.manifest);
  const activePage = useDocsStore(s => s.activePage);
  const pageData = useDocsStore(s => s.pageData);
  const loading = useDocsStore(s => s.loading);
  const searchQuery = useDocsStore(s => s.searchQuery);
  const fetchManifest = useDocsStore(s => s.fetchManifest);

  useEffect(() => {
    fetchManifest();
  }, []);

  const renderPage = () => {
    if (searchQuery) return <DocsSearch />;
    if (loading) return <div className="docs__loading">Loading...</div>;
    if (!activePage || !pageData) {
      return (
        <div className="docs__welcome">
          <h2>{manifest?.title || 'Documentation'}</h2>
          <p>Select a symbol from the sidebar to view its documentation.</p>
          {manifest && (
            <div className="docs__stats">
              <span>{manifest.totalSymbols} symbols documented</span>
              {Object.entries(manifest.symbolCounts).map(([k, v]) => (
                <span key={k} className="docs__stat-item">{k}: {v}</span>
              ))}
            </div>
          )}
        </div>
      );
    }

    switch (activePage.kind) {
      case 'symbol': return <DocsSymbolPage data={pageData} />;
      case 'flow': return <DocsFlowPage data={pageData} />;
      case 'portal': return <DocsPortalPage data={pageData} />;
      case 'custom': return <DocsCustomPage data={pageData} />;
      default: return null;
    }
  };

  return (
    <div className="docs">
      <DocsSidebar />
      <div className="docs__content">
        {renderPage()}
      </div>
    </div>
  );
}
