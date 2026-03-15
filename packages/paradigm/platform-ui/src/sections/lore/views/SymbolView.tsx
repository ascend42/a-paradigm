import React, { useEffect } from 'react';
import { useLoreStore } from '../store/loreStore';
import { LoreCard } from '../components/LoreCard';
import { SymbolTag } from '../components/SymbolTag';

export function SymbolView() {
  const symbols = useLoreStore(s => s.symbols);
  const entries = useLoreStore(s => s.entries);
  const selectedSymbol = useLoreStore(s => s.selectedSymbol);
  const selectSymbol = useLoreStore(s => s.selectSymbol);
  const setFilter = useLoreStore(s => s.setFilter);

  // When symbol is selected, filter entries
  useEffect(() => {
    if (selectedSymbol) {
      setFilter({ symbol: selectedSymbol });
    } else {
      setFilter({ symbol: undefined });
    }
  }, [selectedSymbol]);

  return (
    <div className="sidebar-view">
      <div className="sidebar">
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Symbols ({symbols.length})
        </div>
        {symbols.map(s => (
          <div
            key={s.symbol}
            className={`sidebar-item ${selectedSymbol === s.symbol ? 'active' : ''}`}
            onClick={() => selectSymbol(selectedSymbol === s.symbol ? null : s.symbol)}
          >
            <span className="sidebar-item-name"><SymbolTag symbol={s.symbol} /></span>
            <span className="sidebar-item-count">{s.count}</span>
          </div>
        ))}
        {symbols.length === 0 && (
          <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>
            No symbols found
          </div>
        )}
      </div>
      <div className="sidebar-content">
        {selectedSymbol ? (
          <>
            <h2 style={{ fontSize: 16, marginBottom: 16 }}>
              <SymbolTag symbol={selectedSymbol} /> entries
            </h2>
            {entries.length === 0 ? (
              <div style={{ color: 'var(--text-muted)' }}>No entries for this symbol</div>
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
            <h2>Select a symbol</h2>
            <p>Choose a symbol from the sidebar to view its history.</p>
          </div>
        )}
      </div>
    </div>
  );
}
