/**
 * Symbol index state management
 */

import { create } from 'zustand';
import type { SymbolIndex, SymbolEntry } from '../types';
import { createSymbolIndex } from '../types';

interface SymbolState {
  index: SymbolIndex;
  isLoading: boolean;
  error: string | null;
  lastUpdated: number | null;

  // Actions
  setIndex: (index: SymbolIndex) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Queries
  search: (query: string) => SymbolEntry[];
  getAutocomplete: (partial: string) => SymbolEntry[];
}

export const useSymbolStore = create<SymbolState>((set, get) => ({
  index: createSymbolIndex(),
  isLoading: false,
  error: null,
  lastUpdated: null,

  setIndex: (index) =>
    set({
      index,
      lastUpdated: Date.now(),
      error: null,
    }),

  setLoading: (loading) => set({ isLoading: loading }),

  setError: (error) => set({ error, isLoading: false }),

  search: (query) => {
    const { index } = get();
    const lowerQuery = query.toLowerCase();
    const results: SymbolEntry[] = [];

    for (const entry of index.entries.values()) {
      if (
        entry.symbol.toLowerCase().includes(lowerQuery) ||
        entry.description?.toLowerCase().includes(lowerQuery)
      ) {
        results.push(entry);
      }
    }

    return results.slice(0, 20);
  },

  getAutocomplete: (partial) => {
    const { index } = get();
    if (!partial) return [];

    const lowerPartial = partial.toLowerCase();
    const results: SymbolEntry[] = [];

    for (const entry of index.entries.values()) {
      if (entry.symbol.toLowerCase().startsWith(lowerPartial)) {
        results.push(entry);
      }
    }

    // Sort by relevance (exact prefix match first)
    results.sort((a, b) => {
      const aExact = a.symbol.toLowerCase() === lowerPartial;
      const bExact = b.symbol.toLowerCase() === lowerPartial;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      return a.symbol.localeCompare(b.symbol);
    });

    return results.slice(0, 10);
  },
}));
