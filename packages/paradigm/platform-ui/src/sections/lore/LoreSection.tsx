import React, { useEffect } from 'react';
import { useLoreStore } from './store/loreStore';
import { ViewSwitcher } from './components/ViewSwitcher';
import { FilterBar } from './components/FilterBar';
import { DetailPanel } from './components/DetailPanel';
import { ThreadView } from './views/ThreadView';
import { SymbolView } from './views/SymbolView';
import { AuthorView } from './views/AuthorView';
import { SessionView } from './views/SessionView';
import './styles/index.css';
import './styles/thread.css';
import './styles/cards.css';

export default function LoreSection() {
  const view = useLoreStore(s => s.view);
  const entries = useLoreStore(s => s.entries);
  const projectName = useLoreStore(s => s.projectName);
  const authors = useLoreStore(s => s.authors);
  const fetchAll = useLoreStore(s => s.fetchAll);

  useEffect(() => {
    fetchAll();
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--p-border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: view === 'timeline' ? 8 : 0 }}>
          <div>
            <span style={{ fontSize: 16, fontWeight: 600 }}>Lore</span>
            <span style={{ fontSize: 12, color: 'var(--p-text-muted)', marginLeft: 10 }}>
              {projectName || 'project'} &middot; {entries.length} entries &middot; {authors.length} authors
            </span>
          </div>
          <ViewSwitcher />
        </div>
        {view === 'timeline' && <FilterBar />}
      </div>

      <main style={{ flex: 1, overflow: 'auto', paddingBottom: 32 }}>
        {view === 'timeline' && <ThreadView />}
        {view === 'session' && <SessionView />}
        {view === 'symbol' && <SymbolView />}
        {view === 'author' && <AuthorView />}
      </main>

      <DetailPanel />
    </div>
  );
}
