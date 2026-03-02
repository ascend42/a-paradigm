/**
 * Events Store — Zustand store for generic events + scopes
 */

import { create } from 'zustand';

export interface GenericEvent {
  id: string;
  schemaId: string;
  eventType: string;
  category: string;
  timestamp: string;
  scopeValue?: string;
  scopeOrdinal?: number;
  sessionId?: string;
  service: string;
  data?: Record<string, unknown>;
  severity?: 'debug' | 'info' | 'warn' | 'error';
  parentEventId?: string;
  depth?: number;
}

export interface ScopeSummary {
  scopeValue: string;
  scopeOrdinal?: number;
  eventCount: number;
  categories: Record<string, number>;
  firstTimestamp: string;
  lastTimestamp: string;
}

interface EventsState {
  events: GenericEvent[];
  scopes: ScopeSummary[];
  selectedScope: string | null;
  excludedTypes: Set<string>;
  excludedServices: Set<string>;
  categoryFilter: string | null;
  loading: boolean;
  error: string | null;
  total: number;

  fetchEvents: (schemaId: string, query?: Record<string, string>) => Promise<void>;
  fetchScopes: (schemaId: string) => Promise<void>;
  fetchScopeEvents: (schemaId: string, scopeValue: string) => Promise<void>;
  selectScope: (scopeValue: string | null) => void;
  toggleExcludedType: (type: string) => void;
  toggleExcludedService: (service: string) => void;
  clearAllExclusions: () => void;
  setCategoryFilter: (category: string | null) => void;
  addRealtimeEvent: (event: GenericEvent) => void;
}

export const useEventsStore = create<EventsState>((set, get) => ({
  events: [],
  scopes: [],
  selectedScope: null,
  excludedTypes: new Set<string>(),
  excludedServices: new Set<string>(),
  categoryFilter: null,
  loading: false,
  error: null,
  total: 0,

  fetchEvents: async (schemaId, query = {}) => {
    set({ loading: true, error: null });
    try {
      const params = new URLSearchParams({ schemaId, ...query });
      const res = await fetch(`/api/events?${params}`);
      if (!res.ok) throw new Error(`Failed to fetch events: ${res.status}`);
      const data = await res.json();
      set({ events: data.events || [], total: data.total || 0, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch events',
        loading: false,
      });
    }
  },

  fetchScopes: async (schemaId) => {
    try {
      const res = await fetch(`/api/events/scopes?schemaId=${encodeURIComponent(schemaId)}`);
      if (!res.ok) throw new Error(`Failed to fetch scopes: ${res.status}`);
      const data = await res.json();
      set({ scopes: data.scopes || [] });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch scopes',
      });
    }
  },

  fetchScopeEvents: async (schemaId, scopeValue) => {
    set({ loading: true, error: null, selectedScope: scopeValue });
    try {
      const res = await fetch(
        `/api/events/scope/${encodeURIComponent(scopeValue)}?schemaId=${encodeURIComponent(schemaId)}`
      );
      if (!res.ok) throw new Error(`Failed to fetch scope events: ${res.status}`);
      const data = await res.json();
      set({ events: data.events || [], total: data.count || 0, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch scope events',
        loading: false,
      });
    }
  },

  selectScope: (scopeValue) => set({ selectedScope: scopeValue }),

  toggleExcludedType: (type) => {
    const excluded = new Set(get().excludedTypes);
    if (excluded.has(type)) {
      excluded.delete(type);
    } else {
      excluded.add(type);
    }
    set({ excludedTypes: excluded });
  },

  toggleExcludedService: (service) => {
    const s = new Set(get().excludedServices);
    s.has(service) ? s.delete(service) : s.add(service);
    set({ excludedServices: s });
  },

  clearAllExclusions: () => set({
    excludedTypes: new Set(),
    excludedServices: new Set(),
  }),

  setCategoryFilter: (category) => set({ categoryFilter: category }),

  addRealtimeEvent: (event) => {
    set((state) => ({
      events: [event, ...state.events].slice(0, 500),
      total: state.total + 1,
    }));
  },
}));
