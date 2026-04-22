import React, { useState, useRef, useEffect } from 'react';
import { useLoreStore } from '../store/loreStore';

// v6.0: 'decision' removed from the filter list. Decisions are surfaced via the
// decision-store UI; lore links them through references.decision_id on insights.
const ENTRY_TYPES = [
  '', 'agent-session', 'human-note', 'review', 'incident', 'milestone', 'retro', 'insight',
];

const AGENT_FILTER_OPTIONS = [
  { value: undefined as boolean | undefined, label: 'All' },
  { value: false as const, label: 'Human Only' },
  { value: true as const, label: 'AI-Assisted' },
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
  const [availableTags, setAvailableTags] = useState<Array<{ tag: string; count: number }>>([]);

  const hasActiveFilters = Object.values(filter).some(v => v !== undefined && v !== '' && (Array.isArray(v) ? v.length > 0 : true));

  // Filter symbols for autocomplete
  const filteredSymbols = symbolQuery
    ? symbols.filter(s => s.symbol.toLowerCase().includes(symbolQuery.toLowerCase())).slice(0, 10)
    : symbols.slice(0, 10);

  // Fetch available tags
  useEffect(() => {
    fetch('/api/lore/tags')
      .then(r => r.json())
      .then(data => setAvailableTags(data.tags || []))
      .catch(() => {});
  }, []);

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
      {/* Agent filter toggle */}
      <div className="author-type-toggle">
        {AGENT_FILTER_OPTIONS.map(opt => (
          <button
            key={opt.label}
            className={`author-type-pill ${filter.hasAgent === opt.value ? 'active' : ''} ${opt.value === undefined ? 'all' : opt.value ? 'agent' : 'human'}`}
            onClick={() => setFilter({ hasAgent: opt.value })}
          >
            {opt.label}
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
            {a.hasAgent ? '\uD83E\uDD16' : '\uD83D\uDC64'} {a.id}
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

      {/* Tag filter */}
      {availableTags.length > 0 && (
        <select
          value={filter.tag || ''}
          onChange={e => setFilter({ tag: e.target.value || undefined })}
        >
          <option value="">All tags</option>
          {availableTags.map(t => (
            <option key={t.tag} value={t.tag}>
              {t.tag} ({t.count})
            </option>
          ))}
        </select>
      )}

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
