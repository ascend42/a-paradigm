/**
 * Lore Filter - Filtering and query logic for lore entries
 */

import type { LoreEntry, LoreFilter } from './types.js';

/**
 * Apply filters to a list of lore entries
 */
export function applyLoreFilter(entries: LoreEntry[], filter: LoreFilter): LoreEntry[] {
  let result = entries;

  if (filter.author) {
    result = result.filter(e => e.author.id === filter.author);
  }

  if (filter.authorType) {
    result = result.filter(e => e.author.type === filter.authorType);
  }

  if (filter.symbol) {
    result = result.filter(e =>
      e.symbols_touched.includes(filter.symbol!) ||
      e.symbols_created?.includes(filter.symbol!)
    );
  }

  if (filter.dateFrom) {
    const from = new Date(filter.dateFrom).getTime();
    result = result.filter(e => new Date(e.timestamp).getTime() >= from);
  }

  if (filter.dateTo) {
    const to = new Date(filter.dateTo).getTime();
    result = result.filter(e => new Date(e.timestamp).getTime() <= to);
  }

  if (filter.type) {
    result = result.filter(e => e.type === filter.type);
  }

  if (filter.tags && filter.tags.length > 0) {
    result = result.filter(e =>
      filter.tags!.some(tag => e.tags?.includes(tag))
    );
  }

  if (filter.hasReview !== undefined) {
    result = result.filter(e =>
      filter.hasReview ? e.review != null : e.review == null
    );
  }

  if (filter.minCompleteness !== undefined) {
    result = result.filter(e =>
      e.review != null && e.review.completeness >= filter.minCompleteness!
    );
  }

  // Sort by timestamp descending (newest first)
  result.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Apply offset and limit
  if (filter.offset) {
    result = result.slice(filter.offset);
  }

  if (filter.limit) {
    result = result.slice(0, filter.limit);
  }

  return result;
}

/**
 * Full-text search across titles and summaries
 */
export function searchLoreEntries(entries: LoreEntry[], query: string): LoreEntry[] {
  const lower = query.toLowerCase();
  return entries.filter(e =>
    e.title.toLowerCase().includes(lower) ||
    e.summary.toLowerCase().includes(lower) ||
    e.symbols_touched.some(s => s.toLowerCase().includes(lower)) ||
    e.tags?.some(t => t.toLowerCase().includes(lower))
  );
}
