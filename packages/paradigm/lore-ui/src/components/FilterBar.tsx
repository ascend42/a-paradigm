import React, { useState, useRef, useEffect } from 'react';
import { useLoreStore } from '../store/loreStore';

const ENTRY_TYPES = [
  '', 'agent-session', 'human-note', 'decision', 'review', 'incident', 'milestone',
];

const AUTHOR_TYPES = [
  { value: undefined as 'human' | 'agent' | undefined, label: 'All' },
  { value: 'human' as const, label: 'Human' },
  { value: 'agent' as const, label: 'Agent' },
];

export function FilterBar() {
  const filter = useLoreStore(s => s.filter);
  const setFilter = useLoreStore(s => s.setFilter);
  const clearFilters = useLoreStore(s => s.clearFilters);
  const authors = useLoreStore(s => s.authors);
  const symbols = useLoreStore(s => s.symbols);

  const [symbolQuery, setSymbolQuery] = useState('');
  const [showSymbolDropdown, setShowSymbolDropdown] = useState(false);
  const symbolInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const hasActiveFilters = Object.values(filter).some(v => v !== undefined && v !== '' && (Array.isArray(v) ? v.length > 0 : true));

  // Filter symbols for autocomplete
  const filteredSymbols = symbolQuery
    ? symbols.filter(s => s.symbol.toLowerCase().includes(symbolQuery.toLowerCase())).slice(0, 10)
    : symbols.slice(0, 10);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        symbolInputRef.current && !symbolInputRef.current.contains(e.target as Node)
      ) {
        setShowSymbolDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="filter-bar">
      {/* Author type toggle */}
      <div className="author-type-toggle">
        {AUTHOR_TYPES.map(at => (
          <button
            key={at.label}
            className={`author-type-pill ${filter.authorType === at.value ? 'active' : ''} ${at.value || 'all'}`}
            onClick={() => setFilter({ authorType: at.value })}
          >
            {at.label}
          </button>
        ))}
      </div>

      {/* Author filter */}
      <select
        value={filter.author || ''}
        onChange={e => setFilter({ author: e.target.value || undefined })}
      >
        <option value="">All authors</option>
        {authors.map(a => (
          <option key={a.id} value={a.id}>
            {a.type === 'agent' ? '\uD83E\uDD16' : '\uD83D\uDC64'} {a.id}
          </option>
        ))}
      </select>

      {/* Type filter */}
      <select
        value={filter.type || ''}
        onChange={e => setFilter({ type: e.target.value || undefined })}
      >
        <option value="">All types</option>
        {ENTRY_TYPES.filter(Boolean).map(t => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>

      {/* Symbol autocomplete */}
      <div className="symbol-autocomplete-wrapper">
        <input
          ref={symbolInputRef}
          type="text"
          placeholder={filter.symbol ? `Symbol: ${filter.symbol}` : 'Filter by symbol...'}
          value={symbolQuery}
          onChange={e => {
            setSymbolQuery(e.target.value);
            setShowSymbolDropdown(true);
          }}
          onFocus={() => setShowSymbolDropdown(true)}
          style={{ width: 160 }}
        />
        {filter.symbol && (
          <button
            className="symbol-clear"
            onClick={() => {
              setFilter({ symbol: undefined });
              setSymbolQuery('');
            }}
          >
            x
          </button>
        )}
        {showSymbolDropdown && filteredSymbols.length > 0 && (
          <div className="symbol-dropdown" ref={dropdownRef}>
            {filteredSymbols.map(s => (
              <div
                key={s.symbol}
                className={`symbol-dropdown-item ${filter.symbol === s.symbol ? 'active' : ''}`}
                onClick={() => {
                  setFilter({ symbol: s.symbol });
                  setSymbolQuery('');
                  setShowSymbolDropdown(false);
                }}
              >
                <span className="symbol-dropdown-name">{s.symbol}</span>
                <span className="symbol-dropdown-count">{s.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search..."
        value={filter.search || ''}
        onChange={e => setFilter({ search: e.target.value || undefined })}
        style={{ width: 140 }}
      />

      {/* Date range */}
      <input
        type="date"
        value={filter.dateFrom || ''}
        onChange={e => setFilter({ dateFrom: e.target.value || undefined })}
        title="From date"
      />
      <input
        type="date"
        value={filter.dateTo || ''}
        onChange={e => setFilter({ dateTo: e.target.value || undefined })}
        title="To date"
      />

      {/* Review filter */}
      <button
        className={`filter-preset ${filter.hasReview === false ? 'active' : ''}`}
        onClick={() => setFilter({ hasReview: filter.hasReview === false ? undefined : false })}
      >
        Needs Review
      </button>

      {hasActiveFilters && (
        <button className="filter-clear" onClick={clearFilters}>
          Clear filters
        </button>
      )}
    </div>
  );
}
