/**
 * Schema Store — Zustand store for event schema registry
 */

import { create } from 'zustand';

export interface StoredSchema {
  id: string;
  version: string;
  name: string;
  description?: string;
  scope: {
    field: string;
    type: 'number' | 'string';
    label: string;
    ordering: 'sequential' | 'independent';
    sessionField?: string;
  };
  eventTypes: Array<{
    type: string;
    category: string;
    label?: string;
    description?: string;
    fields?: Array<{
      name: string;
      type: string;
      description?: string;
      indexed?: boolean;
      display?: boolean;
    }>;
    frequency?: 'high' | 'medium' | 'low';
    severity?: 'debug' | 'info' | 'warn' | 'error';
  }>;
  causality?: {
    parentField?: string;
    depthField?: string;
    scopeStart?: string[];
    scopeEnd?: string[];
  };
  visualization?: {
    defaultView?: 'timeline' | 'table' | 'tree' | 'flame';
    categoryColors?: Record<string, string>;
    summaryFields?: string[];
    defaultExcluded?: string[];
  };
  tags: string[];
  registeredAt: string;
  updatedAt: string;
}

interface SchemasState {
  schemas: StoredSchema[];
  selectedSchemaId: string | null;
  loading: boolean;
  error: string | null;
  fetchSchemas: () => Promise<void>;
  selectSchema: (id: string | null) => void;
  getSelectedSchema: () => StoredSchema | undefined;
}

export const useSchemasStore = create<SchemasState>((set, get) => ({
  schemas: [],
  selectedSchemaId: null,
  loading: false,
  error: null,

  fetchSchemas: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch('/api/schemas');
      if (!res.ok) throw new Error(`Failed to fetch schemas: ${res.status}`);
      const data = await res.json();
      const schemas = data.schemas || [];
      set({ schemas, loading: false });

      // Auto-select first schema if none selected
      const state = get();
      if (!state.selectedSchemaId && schemas.length > 0) {
        set({ selectedSchemaId: schemas[0].id });
      }
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch schemas',
        loading: false,
      });
    }
  },

  selectSchema: (id) => set({ selectedSchemaId: id }),

  getSelectedSchema: () => {
    const state = get();
    return state.schemas.find((s) => s.id === state.selectedSchemaId);
  },
}));
