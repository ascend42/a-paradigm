/**
 * Incidents Store - Manages incident data for triage view
 */

import { create } from 'zustand';
import type { IncidentSummary, PatternSummary } from '../types';

interface IncidentsState {
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
  setStatusFilter: (status: IncidentsState['statusFilter']) => void;
  setEnvironmentFilter: (env: string | null) => void;
  setSymbolFilter: (symbol: string | null) => void;
  resolveIncident: (id: string) => Promise<void>;

  // Computed
  getFilteredIncidents: () => IncidentSummary[];
  getSelectedIncident: () => IncidentSummary | undefined;
}

export const useIncidentsStore = create<IncidentsState>((set, get) => ({
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
      const response = await fetch('/api/incidents');
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      const data = await response.json();
      set({
        incidents: data.incidents || [],
        isLoading: false,
      });
    } catch (error) {
      console.error('Failed to load incidents:', error);
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to load incidents',
        incidents: [],
      });
    }
  },

  loadPatterns: async () => {
    try {
      const response = await fetch('/api/patterns');
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      const data = await response.json();
      set({ patterns: data.patterns || [] });
    } catch (error) {
      console.error('Failed to load patterns:', error);
    }
  },

  selectIncident: (id) => set({ selectedIncidentId: id }),

  setStatusFilter: (status) => set({ statusFilter: status }),
  setEnvironmentFilter: (env) => set({ environmentFilter: env }),
  setSymbolFilter: (symbol) => set({ symbolFilter: symbol }),

  resolveIncident: async (id) => {
    try {
      const response = await fetch(`/api/incidents/${id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      // Reload incidents after resolving
      await get().loadIncidents();
    } catch (error) {
      console.error('Failed to resolve incident:', error);
      throw error;
    }
  },

  getFilteredIncidents: () => {
    const state = get();
    let filtered = state.incidents;

    // Filter by status
    if (state.statusFilter !== 'all') {
      filtered = filtered.filter((i) => i.status === state.statusFilter);
    }

    // Filter by environment
    if (state.environmentFilter) {
      filtered = filtered.filter((i) => i.environment === state.environmentFilter);
    }

    // Filter by symbol
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
