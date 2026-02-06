/**
 * Nodes state management - all nodes from all sources
 */

import { create } from 'zustand';
import type { SymbolEntry, SymbolType, Position, SourceType } from '../types';
import { parseSymbol } from '../types';

// Layout modes
export type LayoutMode = 'canvas' | 'grid' | 'list';

// Sort options
export type SortOption = 'alpha' | 'type' | 'updated' | 'stale';

// Helper to build symbol from type and name
function buildSymbol(type: SymbolType, name: string, ideaType?: SymbolType): string {
  const prefixMap: Record<SymbolType, string> = {
    feature: '@',
    component: '#',
    flow: '$',
    state: '%',
    aspect: '~',
    portal: '^',
    signal: '!',
    idea: '?',
  };

  if (type === 'idea' && ideaType) {
    // Compound idea: ?@name
    return `?${prefixMap[ideaType]}${name}`;
  }

  return `${prefixMap[type]}${name}`;
}

interface NodesState {
  nodes: SymbolEntry[];
  selectedId: string | null;
  hoveredId: string | null;
  isLoading: boolean;
  loadError: string | null;
  projectName: string | null;

  // Filters
  visibleTypes: SymbolType[];
  filterTags: string[];
  searchQuery: string;

  // Layout & Sorting
  layoutMode: LayoutMode;
  sortOption: SortOption;

  // Actions
  setNodes: (nodes: SymbolEntry[]) => void;
  loadFromApi: () => Promise<void>;
  selectNode: (id: string | null) => void;
  hoverNode: (id: string | null) => void;
  updateNodePosition: (id: string, position: Position) => void;
  updateNode: (id: string, updates: Partial<SymbolEntry>) => void;
  addNode: (node: SymbolEntry) => void;
  removeNode: (id: string) => void;
  addTag: (id: string, tag: string) => void;
  removeTag: (id: string, tag: string) => void;

  // Filter actions
  setVisibleTypes: (types: SymbolType[]) => void;
  toggleType: (type: SymbolType) => void;
  setFilterTags: (tags: string[]) => void;
  setSearchQuery: (query: string) => void;

  // Layout actions
  setLayoutMode: (mode: LayoutMode) => void;
  setSortOption: (option: SortOption) => void;
  reorganizeVisibleNodes: () => void;

  // Computed
  getFilteredNodes: () => SymbolEntry[];
  getSortedNodes: () => SymbolEntry[];
  getSelectedNode: () => SymbolEntry | undefined;
}

const ALL_TYPES: SymbolType[] = [
  'feature',
  'component',
  'flow',
  'state',
  'aspect',
  'portal',
  'signal',
  'idea',
];

/**
 * Convert API symbols to SymbolEntry with positions
 */
interface ApiSymbol {
  id: string;
  symbol: string;
  type: SymbolType;
  source: string;
  filePath: string;
  data?: Record<string, unknown>;
  description?: string;
  references?: string[];
  referencedBy?: string[];
  tags?: string[];
}

function apiSymbolsToEntries(symbols: ApiSymbol[]): SymbolEntry[] {
  // Grid layout parameters
  const NODE_WIDTH = 200;
  const NODE_HEIGHT = 120;
  const PADDING = 40;
  const START_X = 100;
  const START_Y = 100;
  const cols = Math.ceil(Math.sqrt(symbols.length * 1.5));

  return symbols.map((s, index) => ({
    id: s.id,
    symbol: s.symbol,
    type: s.type,
    source: (s.source || 'purpose') as SourceType,
    filePath: s.filePath,
    data: s.data || {},
    description: s.description,
    references: s.references || [],
    referencedBy: s.referencedBy || [],
    tags: s.tags || [],
    position: {
      x: START_X + (index % cols) * (NODE_WIDTH + PADDING),
      y: START_Y + Math.floor(index / cols) * (NODE_HEIGHT + PADDING),
    },
  }));
}

// Type order for sorting
const TYPE_ORDER: Record<SymbolType, number> = {
  feature: 1,
  component: 2,
  flow: 3,
  portal: 4,
  signal: 5,
  state: 6,
  aspect: 7,
  idea: 8,
};

export const useNodesStore = create<NodesState>((set, get) => ({
  nodes: [],
  selectedId: null,
  hoveredId: null,
  isLoading: true,
  loadError: null,
  projectName: null,
  visibleTypes: ALL_TYPES,
  filterTags: [],
  searchQuery: '',
  layoutMode: 'canvas',
  sortOption: 'type',

  setNodes: (nodes) => set({ nodes }),

  loadFromApi: async () => {
    set({ isLoading: true, loadError: null });
    try {
      // Fetch symbols from CLI server API
      const response = await fetch('/api/symbols');
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      const data = await response.json();
      const nodes = apiSymbolsToEntries(data.symbols || []);

      // Also fetch project info
      const infoResponse = await fetch('/api/info');
      const info = infoResponse.ok ? await infoResponse.json() : {};

      set({
        nodes,
        isLoading: false,
        projectName: info.projectName || null,
      });
    } catch (error) {
      console.error('Failed to load symbols from API:', error);
      set({
        isLoading: false,
        loadError: error instanceof Error ? error.message : 'Failed to load',
        nodes: [], // Keep empty on error
      });
    }
  },

  selectNode: (id) => set({ selectedId: id }),

  hoverNode: (id) => set({ hoveredId: id }),

  updateNodePosition: (id, position) =>
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id ? { ...n, position } : n
      ),
    })),

  updateNode: (id, updates) =>
    set((state) => {
      const node = state.nodes.find((n) => n.id === id);
      if (!node) return state;

      let finalUpdates = { ...updates };

      // Handle type change - update symbol prefix if needed
      if (updates.type && updates.type !== node.type) {
        const parsed = parseSymbol(node.symbol);
        if (parsed) {
          // Extract name without prefix
          const name = parsed.name;
          const newSymbol = buildSymbol(updates.type, name, updates.ideaType ?? node.ideaType);
          finalUpdates.symbol = newSymbol;

          // Clear ideaType if changing from idea to non-idea
          if (node.type === 'idea' && updates.type !== 'idea') {
            finalUpdates.ideaType = undefined;
          }
        }
      }

      // Handle symbol change - validate and update type if prefix changed
      if (updates.symbol && updates.symbol !== node.symbol) {
        const parsed = parseSymbol(updates.symbol);
        if (parsed) {
          finalUpdates.type = parsed.type;
          if (parsed.ideaType) {
            finalUpdates.ideaType = parsed.ideaType;
          } else if (parsed.type !== 'idea') {
            finalUpdates.ideaType = undefined;
          }
        }
      }

      // Set modified timestamp
      finalUpdates.modified = new Date().toISOString();

      return {
        nodes: state.nodes.map((n) =>
          n.id === id ? { ...n, ...finalUpdates } : n
        ),
      };
    }),

  addNode: (node) =>
    set((state) => ({
      nodes: [...state.nodes, node],
    })),

  removeNode: (id) =>
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
    })),

  addTag: (id, tag) =>
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id
          ? { ...n, tags: [...(n.tags || []), tag] }
          : n
      ),
    })),

  removeTag: (id, tag) =>
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id
          ? { ...n, tags: (n.tags || []).filter((t) => t !== tag) }
          : n
      ),
    })),

  setVisibleTypes: (types) => {
    set({ visibleTypes: types });
    // Reorganize after a short delay to allow state to update
    setTimeout(() => {
      get().reorganizeVisibleNodes();
    }, 50);
  },

  toggleType: (type) => {
    set((state) => ({
      visibleTypes: state.visibleTypes.includes(type)
        ? state.visibleTypes.filter((t) => t !== type)
        : [...state.visibleTypes, type],
    }));
    // Reorganize after a short delay to allow state to update
    setTimeout(() => {
      get().reorganizeVisibleNodes();
    }, 50);
  },

  setFilterTags: (tags) => set({ filterTags: tags }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  setLayoutMode: (mode) => {
    set({ layoutMode: mode });
    // Reorganize nodes for the new layout
    if (mode === 'canvas') {
      setTimeout(() => get().reorganizeVisibleNodes(), 50);
    }
  },

  setSortOption: (option) => {
    set({ sortOption: option });
    // Reorganize if in canvas mode
    if (get().layoutMode === 'canvas') {
      setTimeout(() => get().reorganizeVisibleNodes(), 50);
    }
  },

  reorganizeVisibleNodes: () => {
    const state = get();
    const visibleNodes = state.getFilteredNodes();

    if (visibleNodes.length === 0) return;

    // Grid layout parameters
    const NODE_WIDTH = 200;
    const NODE_HEIGHT = 120;
    const PADDING = 40;
    const START_X = 100;
    const START_Y = 100;

    // Calculate grid dimensions
    const cols = Math.ceil(Math.sqrt(visibleNodes.length * 1.5));

    // Update positions for visible nodes
    const updatedNodes = state.nodes.map((node) => {
      const visibleIndex = visibleNodes.findIndex((n) => n.id === node.id);
      if (visibleIndex === -1) {
        // Keep hidden nodes in their current position
        return node;
      }

      // Calculate grid position
      const col = visibleIndex % cols;
      const row = Math.floor(visibleIndex / cols);

      const newPosition = {
        x: START_X + col * (NODE_WIDTH + PADDING),
        y: START_Y + row * (NODE_HEIGHT + PADDING),
      };

      return { ...node, position: newPosition };
    });

    set({ nodes: updatedNodes });
  },

  getFilteredNodes: () => {
    const state = get();
    let filtered = state.nodes;

    // Filter by type
    filtered = filtered.filter((n) => state.visibleTypes.includes(n.type));

    // Filter by tags
    if (state.filterTags.length > 0) {
      filtered = filtered.filter((n) =>
        state.filterTags.some((tag: string) => n.tags?.includes(tag))
      );
    }

    // Filter by search query
    if (state.searchQuery) {
      const query = state.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (n) =>
          n.symbol.toLowerCase().includes(query) ||
          n.description?.toLowerCase().includes(query)
      );
    }

    return filtered;
  },

  getSortedNodes: () => {
    const state = get();
    const filtered = state.getFilteredNodes();

    const sorted = [...filtered].sort((a, b) => {
      switch (state.sortOption) {
        case 'alpha':
          return a.symbol.localeCompare(b.symbol);
        case 'type':
          const typeOrderDiff = TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
          if (typeOrderDiff !== 0) return typeOrderDiff;
          return a.symbol.localeCompare(b.symbol);
        case 'updated':
          // Most recently modified first
          const aTime = a.modified ? new Date(a.modified).getTime() : 0;
          const bTime = b.modified ? new Date(b.modified).getTime() : 0;
          return bTime - aTime;
        case 'stale':
          // Least recently modified first (stale = old)
          const aStaleTime = a.modified ? new Date(a.modified).getTime() : 0;
          const bStaleTime = b.modified ? new Date(b.modified).getTime() : 0;
          return aStaleTime - bStaleTime;
        default:
          return 0;
      }
    });

    return sorted;
  },

  getSelectedNode: () => {
    const state = get();
    return state.nodes.find((n) => n.id === state.selectedId);
  },
}));
