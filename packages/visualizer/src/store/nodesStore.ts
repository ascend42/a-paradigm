/**
 * Nodes state management - all nodes from all sources
 */

import { create } from 'zustand';
import type { SymbolEntry, SymbolType, Position } from '../types';

interface NodesState {
  nodes: SymbolEntry[];
  selectedId: string | null;
  hoveredId: string | null;
  
  // Filters
  visibleTypes: SymbolType[];
  filterTags: string[];
  searchQuery: string;
  
  // Actions
  setNodes: (nodes: SymbolEntry[]) => void;
  selectNode: (id: string | null) => void;
  hoverNode: (id: string | null) => void;
  updateNodePosition: (id: string, position: Position) => void;
  addNode: (node: SymbolEntry) => void;
  removeNode: (id: string) => void;
  addTag: (id: string, tag: string) => void;
  removeTag: (id: string, tag: string) => void;
  
  // Filter actions
  setVisibleTypes: (types: SymbolType[]) => void;
  toggleType: (type: SymbolType) => void;
  setFilterTags: (tags: string[]) => void;
  setSearchQuery: (query: string) => void;
  
  // Computed
  getFilteredNodes: () => SymbolEntry[];
  getSelectedNode: () => SymbolEntry | undefined;
}

const ALL_TYPES: SymbolType[] = [
  'feature',
  'component',
  'flow',
  'state',
  'aspect',
  'gate',
  'signal',
  'idea',
];

// Sample nodes from ShopFlow example project
const SAMPLE_NODES: SymbolEntry[] = [
  // Features
  {
    id: 'shopflow-checkout',
    symbol: '@checkout-flow',
    type: 'feature',
    source: 'purpose',
    filePath: 'examples/shopflow/.purpose',
    data: {},
    description: 'Multi-step checkout with payment integration',
    references: ['@cart-management', '@payment-processing', '^auth-required', '$checkout-to-confirmation'],
    referencedBy: [],
    position: { x: 400, y: 100 },
    tags: ['core', 'checkout'],
  },
  {
    id: 'shopflow-cart',
    symbol: '@cart-management',
    type: 'feature',
    source: 'purpose',
    filePath: 'examples/shopflow/.purpose',
    data: {},
    description: 'Add, remove, and update cart items',
    references: ['#CartDrawer', '#CartItem', '@product-browse'],
    referencedBy: ['@checkout-flow'],
    position: { x: 150, y: 100 },
    tags: ['core', 'shopping'],
  },
  {
    id: 'shopflow-login',
    symbol: '@user-login',
    type: 'feature',
    source: 'purpose',
    filePath: 'examples/shopflow/auth/.purpose',
    data: {},
    description: 'Email/password and OAuth authentication',
    references: ['#AuthProvider', '#LoginForm', '!login-failed'],
    referencedBy: ['^auth-required'],
    position: { x: 650, y: 100 },
    tags: ['auth'],
  },
  {
    id: 'shopflow-payment',
    symbol: '@payment-processing',
    type: 'feature',
    source: 'purpose',
    filePath: 'examples/shopflow/payments/.purpose',
    data: {},
    description: 'Core Stripe integration for payments',
    references: ['#PaymentForm', '!payment-failed', '!payment-success'],
    referencedBy: ['@checkout-flow'],
    position: { x: 400, y: 280 },
    tags: ['payments', 'stripe'],
  },
  // Components
  {
    id: 'shopflow-cartdrawer',
    symbol: '#CartDrawer',
    type: 'component',
    source: 'purpose',
    filePath: 'examples/shopflow/.purpose',
    data: {},
    description: 'Slide-out drawer showing current cart contents',
    references: ['#CartItem'],
    referencedBy: ['@cart-management'],
    position: { x: 150, y: 280 },
    tags: ['ui'],
  },
  {
    id: 'shopflow-productcard',
    symbol: '#ProductCard',
    type: 'component',
    source: 'purpose',
    filePath: 'examples/shopflow/.purpose',
    data: {},
    description: 'Displays product thumbnail, price, and quick-add button',
    references: [],
    referencedBy: ['@product-browse', '#ProductGrid'],
    position: { x: 150, y: 450 },
    tags: ['ui', 'products'],
  },
  // Gates
  {
    id: 'shopflow-auth-gate',
    symbol: '^auth-required',
    type: 'gate',
    source: 'gate',
    filePath: 'examples/shopflow/gate.yaml',
    data: {},
    description: 'User must be logged in to access',
    references: ['@user-login'],
    referencedBy: ['@checkout-flow', '@wishlist'],
    position: { x: 650, y: 280 },
    tags: ['security', 'auth'],
  },
  {
    id: 'shopflow-premium-gate',
    symbol: '^premium-checkout',
    type: 'gate',
    source: 'gate',
    filePath: 'examples/shopflow/gate.yaml',
    data: {},
    description: 'Enhanced checkout for premium subscribers',
    references: [],
    referencedBy: [],
    position: { x: 650, y: 450 },
    tags: ['premium', 'upsell'],
  },
  // Signals
  {
    id: 'shopflow-payment-failed',
    symbol: '!payment-failed',
    type: 'signal',
    source: 'gate',
    filePath: 'examples/shopflow/payments/.purpose',
    data: {},
    description: 'Payment could not be processed',
    references: [],
    referencedBy: ['@payment-processing'],
    position: { x: 400, y: 450 },
    tags: ['error', 'payments'],
  },
  // Flows
  {
    id: 'shopflow-checkout-flow',
    symbol: '$checkout-to-confirmation',
    type: 'flow',
    source: 'purpose',
    filePath: 'examples/shopflow/payments/.purpose',
    data: {},
    description: 'Complete purchase journey: Cart → Shipping → Payment → Confirm',
    references: ['@checkout-flow', '@payment-processing'],
    referencedBy: [],
    position: { x: 900, y: 180 },
    tags: ['flow', 'checkout'],
  },
  // Ideas
  {
    id: 'shopflow-idea-subscription',
    symbol: '?subscription-model',
    type: 'idea',
    source: 'dream',
    filePath: 'examples/shopflow/.dream',
    data: {},
    description: 'Consider adding recurring subscription purchases',
    references: [],
    referencedBy: [],
    position: { x: 900, y: 350 },
    tags: ['future', 'monetization'],
    created: new Date().toISOString(),
  },
  {
    id: 'shopflow-idea-ai',
    symbol: '?ai-recommendations',
    type: 'idea',
    source: 'dream',
    filePath: 'examples/shopflow/.dream',
    data: {},
    description: 'ML-powered product recommendations based on browsing history',
    references: [],
    referencedBy: [],
    position: { x: 900, y: 500 },
    tags: ['future', 'ml', 'high-priority'],
    created: new Date().toISOString(),
  },
];

export const useNodesStore = create<NodesState>((set, get) => ({
  nodes: SAMPLE_NODES,
  selectedId: null,
  hoveredId: null,
  visibleTypes: ALL_TYPES,
  filterTags: [],
  searchQuery: '',

  setNodes: (nodes) => set({ nodes }),

  selectNode: (id) => set({ selectedId: id }),

  hoverNode: (id) => set({ hoveredId: id }),

  updateNodePosition: (id, position) =>
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id ? { ...n, position } : n
      ),
    })),

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

  setVisibleTypes: (types) => set({ visibleTypes: types }),

  toggleType: (type) =>
    set((state) => ({
      visibleTypes: state.visibleTypes.includes(type)
        ? state.visibleTypes.filter((t) => t !== type)
        : [...state.visibleTypes, type],
    })),

  setFilterTags: (tags) => set({ filterTags: tags }),

  setSearchQuery: (query) => set({ searchQuery: query }),

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

  getSelectedNode: () => {
    const state = get();
    return state.nodes.find((n) => n.id === state.selectedId);
  },
}));
