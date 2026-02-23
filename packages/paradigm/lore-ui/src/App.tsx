import React, { useEffect } from 'react';
import { useLoreStore } from './store/loreStore';
import { ViewSwitcher } from './components/ViewSwitcher';
import { FilterBar } from './components/FilterBar';
import { DetailPanel } from './components/DetailPanel';
import { ThreadView } from './views/ThreadView';
import { SymbolView } from './views/SymbolView';
import { AuthorView } from './views/AuthorView';
import { SessionView } from './views/SessionView';

export default function App() {
  const view = useLoreStore(s => s.view);
  const entries = useLoreStore(s => s.entries);
  const projectName = useLoreStore(s => s.projectName);
  const authors = useLoreStore(s => s.authors);
  const fetchAll = useLoreStore(s => s.fetchAll);

  useEffect(() => {
    fetchAll();
  }, []);

  return (
    <>
      <header className="header">
        <div className="header-top">
          <div className="header-title">
            <h1>PARADIGM LORE</h1>
            <span className="project-name">
              {projectName || 'project'} &middot; {entries.length} entries &middot; {authors.length} authors
            </span>
          </div>
          <ViewSwitcher />
        </div>
        {view === 'timeline' && <FilterBar />}
      </header>

      <main style={{ flex: 1, paddingBottom: 32 }}>
        {view === 'timeline' && <ThreadView />}
        {view === 'session' && <SessionView />}
        {view === 'symbol' && <SymbolView />}
        {view === 'author' && <AuthorView />}
      </main>

      <DetailPanel />

      <div className="status-bar">
        <span>{entries.length} entries loaded</span>
        <span>Paradigm Lore v1.0</span>
      </div>
    </>
  );
}
