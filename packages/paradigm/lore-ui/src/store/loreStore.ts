import { create } from 'zustand';

export interface LoreEntry {
  id: string;
  type: 'agent-session' | 'human-note' | 'decision' | 'review' | 'incident' | 'milestone';
  timestamp: string;
  duration_minutes?: number;
  author: { type: 'human' | 'agent'; id: string; model?: string };
  title: string;
  summary: string;
  symbols_touched: string[];
  symbols_created?: string[];
  files_created?: string[];
  files_modified?: string[];
  lines_added?: number;
  lines_removed?: number;
  commit?: string;
  decisions?: Array<{ id: string; decision: string; rationale: string }>;
  errors_encountered?: Array<{ description: string; resolution: string; time_to_fix?: string }>;
  learnings?: string[];
  verification?: { status: string; details?: Record<string, string> };
  review?: { reviewer: string; completeness: number; quality: number; notes?: string; reviewed_at: string };
  tags?: string[];
}

export interface LoreFilter {
  author?: string;
  authorType?: 'human' | 'agent';
  symbol?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  tags?: string[];
  hasReview?: boolean;
  search?: string;
}

export type ViewMode = 'thread' | 'symbol' | 'author';

interface SymbolInfo {
  symbol: string;
  count: number;
}

interface AuthorInfo {
  id: string;
  type: string;
  count: number;
  lastActive: string;
}

interface LoreState {
  entries: LoreEntry[];
  filter: LoreFilter;
  view: ViewMode;
  selectedEntryId: string | null;
  symbols: SymbolInfo[];
  authors: AuthorInfo[];
  selectedSymbol: string | null;
  selectedAuthor: string | null;
  loading: boolean;
  projectName: string;

  setView: (view: ViewMode) => void;
  setFilter: (filter: Partial<LoreFilter>) => void;
  clearFilters: () => void;
  selectEntry: (id: string | null) => void;
  selectSymbol: (symbol: string | null) => void;
  selectAuthor: (author: string | null) => void;
  fetchEntries: () => Promise<void>;
  fetchSymbols: () => Promise<void>;
  fetchAuthors: () => Promise<void>;
  fetchAll: () => Promise<void>;
}

export const useLoreStore = create<LoreState>((set, get) => ({
  entries: [],
  filter: {},
  view: 'thread',
  selectedEntryId: null,
  symbols: [],
  authors: [],
  selectedSymbol: null,
  selectedAuthor: null,
  loading: false,
  projectName: '',

  setView: (view) => set({ view }),

  setFilter: (partial) => {
    set((s) => ({ filter: { ...s.filter, ...partial } }));
    get().fetchEntries();
  },

  clearFilters: () => {
    set({ filter: {} });
    get().fetchEntries();
  },

  selectEntry: (id) => set({ selectedEntryId: id }),
  selectSymbol: (symbol) => set({ selectedSymbol: symbol }),
  selectAuthor: (author) => set({ selectedAuthor: author }),

  fetchEntries: async () => {
    set({ loading: true });
    try {
      const f = get().filter;
      const params = new URLSearchParams();
      if (f.author) params.set('author', f.author);
      if (f.authorType) params.set('authorType', f.authorType);
      if (f.symbol) params.set('symbol', f.symbol);
      if (f.type) params.set('type', f.type);
      if (f.dateFrom) params.set('from', f.dateFrom);
      if (f.dateTo) params.set('to', f.dateTo);
      if (f.tags?.length) params.set('tags', f.tags.join(','));
      if (f.hasReview !== undefined) params.set('hasReview', String(f.hasReview));
      params.set('limit', '200');

      const res = await fetch(`/api/lore?${params}`);
      const data = await res.json();

      let entries = data.entries || [];

      // Client-side search filter
      if (f.search) {
        const q = f.search.toLowerCase();
        entries = entries.filter((e: LoreEntry) =>
          e.title.toLowerCase().includes(q) ||
          e.summary.toLowerCase().includes(q) ||
          e.symbols_touched.some((s: string) => s.toLowerCase().includes(q))
        );
      }

      set({ entries, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  fetchSymbols: async () => {
    try {
      const res = await fetch('/api/lore/symbols');
      const data = await res.json();
      set({ symbols: data.symbols || [] });
    } catch {
      // ignore
    }
  },

  fetchAuthors: async () => {
    try {
      const res = await fetch('/api/lore/authors');
      const data = await res.json();
      set({ authors: data.authors || [] });
    } catch {
      // ignore
    }
  },

  fetchAll: async () => {
    try {
      const infoRes = await fetch('/api/info');
      const info = await infoRes.json();
      set({ projectName: info.project || '' });
    } catch {
      // ignore
    }
    await Promise.all([
      get().fetchEntries(),
      get().fetchSymbols(),
      get().fetchAuthors(),
    ]);
  },
}));
