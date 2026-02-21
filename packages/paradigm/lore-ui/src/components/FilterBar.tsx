import React from 'react';
import { useLoreStore } from '../store/loreStore';

const ENTRY_TYPES = [
  '', 'agent-session', 'human-note', 'decision', 'review', 'incident', 'milestone',
];

export function FilterBar() {
  const filter = useLoreStore(s => s.filter);
  const setFilter = useLoreStore(s => s.setFilter);
  const clearFilters = useLoreStore(s => s.clearFilters);
  const authors = useLoreStore(s => s.authors);

  const hasActiveFilters = Object.values(filter).some(v => v !== undefined && v !== '' && (Array.isArray(v) ? v.length > 0 : true));

  // Quick date presets
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  return (
    <div className="filter-bar">
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

      {/* Search */}
      <input
        type="text"
        placeholder="Search..."
        value={filter.search || ''}
        onChange={e => setFilter({ search: e.target.value || undefined })}
        style={{ width: 160 }}
      />

      {/* Presets */}
      <button
        className={`filter-preset ${filter.dateFrom === today ? 'active' : ''}`}
        onClick={() => setFilter({ dateFrom: today, dateTo: undefined })}
      >
        Today
      </button>
      <button
        className={`filter-preset ${filter.dateFrom === weekAgo ? 'active' : ''}`}
        onClick={() => setFilter({ dateFrom: weekAgo, dateTo: undefined })}
      >
        This Week
      </button>
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
