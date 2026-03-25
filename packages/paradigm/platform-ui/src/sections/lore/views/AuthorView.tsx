import React, { useEffect } from 'react';
import { useLoreStore } from '../store/loreStore';
import { LoreCard } from '../components/LoreCard';

export function AuthorView() {
  const authors = useLoreStore(s => s.authors);
  const entries = useLoreStore(s => s.entries);
  const selectedAuthor = useLoreStore(s => s.selectedAuthor);
  const selectAuthor = useLoreStore(s => s.selectAuthor);
  const setFilter = useLoreStore(s => s.setFilter);

  useEffect(() => {
    if (selectedAuthor) {
      setFilter({ author: selectedAuthor });
    } else {
      setFilter({ author: undefined });
    }
  }, [selectedAuthor]);

  return (
    <div className="sidebar-view">
      <div className="sidebar">
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--p-border)', fontSize: 11, color: 'var(--p-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Authors ({authors.length})
        </div>
        {authors.map(a => (
          <div
            key={a.id}
            className={`sidebar-item ${selectedAuthor === a.id ? 'active' : ''}`}
            onClick={() => selectAuthor(selectedAuthor === a.id ? null : a.id)}
          >
            <div>
              <span className="sidebar-item-name">
                {a.hasAgent ? '\uD83E\uDD16' : '\uD83D\uDC64'} {a.id}
              </span>
              <div style={{ fontSize: 10, color: 'var(--p-text-muted)', marginTop: 2 }}>
                Last active: {new Date(a.lastActive).toLocaleDateString()}
              </div>
            </div>
            <span className="sidebar-item-count">{a.count}</span>
          </div>
        ))}
        {authors.length === 0 && (
          <div style={{ padding: 20, color: 'var(--p-text-muted)', textAlign: 'center', fontSize: 13 }}>
            No authors found
          </div>
        )}
      </div>
      <div className="sidebar-content">
        {selectedAuthor ? (
          <>
            <h2 style={{ fontSize: 16, marginBottom: 16 }}>
              {selectedAuthor}'s entries
            </h2>
            {entries.length === 0 ? (
              <div style={{ color: 'var(--p-text-muted)' }}>No entries for this author</div>
            ) : (
              entries.map(e => (
                <div key={e.id} style={{ marginBottom: 12 }}>
                  <LoreCard entry={e} />
                </div>
              ))
            )}
          </>
        ) : (
          <div className="empty-state">
            <h2>Select an author</h2>
            <p>Choose an author from the sidebar to view their work.</p>
          </div>
        )}
      </div>
    </div>
  );
}
