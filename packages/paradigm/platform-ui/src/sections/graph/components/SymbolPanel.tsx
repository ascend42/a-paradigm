import { useState, useMemo, useCallback } from 'react';
import type { SymbolData, SymbolCategory } from '../types';
import { CATEGORY_COLORS, CATEGORY_LABELS, CATEGORY_PREFIXES } from '../types';
import { useGraphStore } from '../store/graphStore';

const CATEGORIES: SymbolCategory[] = ['component', 'flow', 'gate', 'signal', 'aspect'];

export default function SymbolPanel() {
  const symbols = useGraphStore((s) => s.symbols);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    if (!search.trim()) return symbols;
    const q = search.toLowerCase();
    return symbols.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description || '').toLowerCase().includes(q) ||
        (s.tags || []).some((t) => t.toLowerCase().includes(q))
    );
  }, [symbols, search]);

  const grouped = useMemo(() => {
    const map: Record<string, SymbolData[]> = {};
    for (const cat of CATEGORIES) map[cat] = [];
    for (const sym of filtered) {
      const cat = sym.category || 'component';
      if (!map[cat]) map[cat] = [];
      map[cat].push(sym);
    }
    return map;
  }, [filtered]);

  const toggleSection = useCallback((cat: string) => {
    setCollapsed((prev) => ({ ...prev, [cat]: !prev[cat] }));
  }, []);

  const onDragStart = useCallback(
    (e: React.DragEvent, symbol: SymbolData) => {
      e.dataTransfer.setData('application/paradigm-symbol', JSON.stringify(symbol));
      e.dataTransfer.effectAllowed = 'move';
    },
    []
  );

  return (
    <div className="symbol-panel">
      <div className="symbol-panel__header">
        <h2>Symbols</h2>
        <span className="symbol-panel__count">{symbols.length}</span>
      </div>
      <input
        className="symbol-panel__search"
        type="text"
        placeholder="Search symbols..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="symbol-panel__list">
        {CATEGORIES.map((cat) => {
          const items = grouped[cat] || [];
          if (items.length === 0) return null;
          const color = CATEGORY_COLORS[cat];
          const isCollapsed = collapsed[cat];

          return (
            <div key={cat} className="symbol-panel__section">
              <button
                className="symbol-panel__section-header"
                onClick={() => toggleSection(cat)}
                style={{ color }}
              >
                <span className="symbol-panel__section-arrow">
                  {isCollapsed ? '▸' : '▾'}
                </span>
                <span>{CATEGORY_LABELS[cat]}</span>
                <span className="symbol-panel__section-count">{items.length}</span>
              </button>
              {!isCollapsed && (
                <div className="symbol-panel__section-items">
                  {items.map((sym) => (
                    <div
                      key={sym.id}
                      className="symbol-panel__item"
                      draggable
                      onDragStart={(e) => onDragStart(e, sym)}
                      style={{ borderLeftColor: color }}
                    >
                      <span className="symbol-panel__item-name" style={{ color }}>
                        {CATEGORY_PREFIXES[cat]}{sym.name}
                      </span>
                      {sym.description && (
                        <span className="symbol-panel__item-desc">
                          {sym.description.length > 40
                            ? sym.description.slice(0, 37) + '...'
                            : sym.description}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
