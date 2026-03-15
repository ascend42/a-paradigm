/**
 * Sentinel Incidents Store — Manages incident data for Platform sentinel section
 *
 * Ported from sentinel/ui/src/store/incidentsStore.ts with /api/sentinel/ prefix.
 */

import { create } from 'zustand';

export interface IncidentSummary {
  id: string;
  timestamp: string;
  status: 'open' | 'investigating' | 'resolved' | 'wont-fix';
  error: {
    message: string;
    type?: string;
  };
  symbols: {
    feature?: string;
    component?: string;
    flow?: string;
    gate?: string;
    signal?: string;
  };
  environment: string;
  patternMatches?: Array<{
    patternId: string;
    patternName: string;
    confidence: number;
  }>;
}

export interface PatternSummary {
  id: string;
  name: string;
  description?: string;
  confidence: {
    score: number;
    timesMatched: number;
    timesResolved: number;
  };
  tags: string[];
}

interface SentinelIncidentsState {
  incidents: IncidentSummary[];
  patterns: PatternSummary[];
  selectedIncidentId: string | null;
  isLoading: boolean;
  error: string | null;

  // Filters
  statusFilter: 'all' | 'open' | 'investigating' | 'resolved' | 'wont-fix';
  environmentFilter: string | null;
  symbolFilter: string | null;

  // Actions
  loadIncidents: () => Promise<void>;
  loadPatterns: () => Promise<void>;
  selectIncident: (id: string | null) => void;
  setStatusFilter: (status: SentinelIncidentsState['statusFilter']) => void;
  setEnvironmentFilter: (env: string | null) => void;
  setSymbolFilter: (symbol: string | null) => void;
  resolveIncident: (id: string) => Promise<void>;

  // Computed
  getFilteredIncidents: () => IncidentSummary[];
  getSelectedIncident: () => IncidentSummary | undefined;
}

export const useSentinelIncidentsStore = create<SentinelIncidentsState>((set, get) => ({
  incidents: [],
  patterns: [],
  selectedIncidentId: null,
  isLoading: false,
  error: null,
  statusFilter: 'all',
  environmentFilter: null,
  symbolFilter: null,

  loadIncidents: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await fetch('/api/sentinel/incidents');
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = await response.json();
      set({ incidents: data.incidents || [], isLoading: false });
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to load incidents',
        incidents: [],
      });
    }
  },

  loadPatterns: async () => {
    try {
      const response = await fetch('/api/sentinel/patterns');
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = await response.json();
      set({ patterns: data.patterns || [] });
    } catch {
      // Patterns are optional
    }
  },

  selectIncident: (id) => set({ selectedIncidentId: id }),

  setStatusFilter: (status) => set({ statusFilter: status }),
  setEnvironmentFilter: (env) => set({ environmentFilter: env }),
  setSymbolFilter: (symbol) => set({ symbolFilter: symbol }),

  resolveIncident: async (id) => {
    try {
      const response = await fetch(`/api/sentinel/incidents/${id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      await get().loadIncidents();
    } catch (error) {
      throw error;
    }
  },

  getFilteredIncidents: () => {
    const state = get();
    let filtered = state.incidents;

    if (state.statusFilter !== 'all') {
      filtered = filtered.filter((i) => i.status === state.statusFilter);
    }

    if (state.environmentFilter) {
      filtered = filtered.filter((i) => i.environment === state.environmentFilter);
    }

    if (state.symbolFilter) {
      filtered = filtered.filter((i) => {
        const symbols = i.symbols;
        return (
          symbols.feature === state.symbolFilter ||
          symbols.component === state.symbolFilter ||
          symbols.flow === state.symbolFilter ||
          symbols.gate === state.symbolFilter ||
          symbols.signal === state.symbolFilter
        );
      });
    }

    return filtered;
  },

  getSelectedIncident: () => {
    const state = get();
    return state.incidents.find((i) => i.id === state.selectedIncidentId);
  },
}));
