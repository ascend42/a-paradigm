import { create } from 'zustand';

// v6.0: 'decision' removed. Use paradigm_decision_record; companion lore is
// written as type:'insight' with references.decision_id. Mirror of core LoreType.
export type LoreType = 'agent-session' | 'human-note' | 'review' | 'incident' | 'milestone' | 'retro' | 'insight';

export interface LoreEntry {
  id: string;
  type?: LoreType;
  timestamp: string;
  duration_minutes?: number;
  author: string;
  agent?: { provider: string; model: string };
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
  confidence?: number;
  assessment?: { verdict: 'correct' | 'partial' | 'incorrect'; assessed_by: string; assessed_at: string; notes?: string };
  assessment_delta?: number;
  body?: string;
  linked_lore?: string[];
  linked_tasks?: string[];
  linked_commits?: string[];
  tags?: string[];
  stream?: 'work-log' | 'journal' | 'decision' | 'auto';
  meta?: Record<string, unknown>;
  git_context?: { ref: string; branch: string; dirty: boolean };
}

export interface LoreFilter {
  author?: string;
  hasAgent?: boolean;
  /** @deprecated Use hasAgent instead */
  authorType?: 'human' | 'agent';
  symbol?: string;
  type?: string;
  tag?: string; // Filter by tag prefix (e.g., "arc:lore-evolution")
  dateFrom?: string;
  dateTo?: string;
  tags?: string[];
  hasReview?: boolean;
  hasBody?: boolean;
  search?: string;
}

export type ViewMode = 'timeline' | 'session' | 'symbol' | 'author';

interface SymbolInfo {
  symbol: string;
  count: number;
}

interface AuthorInfo {
  id: string;
  hasAgent: boolean;
  count: number;
  lastActive: string;
}

export interface Session {
  id: string;
  date: string;
  author: { name: string; hasAgent: boolean };
  startTime: string;
  endTime: string;
  entryCount: number;
  symbolsTouched: string[];
  entryIds: string[];
  breadcrumbs?: Array<{
    phase?: string;
    context?: string;
    timestamp?: string;
    modifiedFiles?: string[];
    symbolsTouched?: string[];
    decisions?: string[];
  }>;
  entries?: LoreEntry[];
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
  sessions: Session[];
  selectedSessionId: string | null;
  loading: boolean;
  projectName: string;
  theme: 'dark' | 'light';
  leftAuthors: string[];

  setView: (view: ViewMode) => void;
  setFilter: (filter: Partial<LoreFilter>) => void;
  clearFilters: () => void;
  selectEntry: (id: string | null) => void;
  selectSymbol: (symbol: string | null) => void;
  selectAuthor: (author: string | null) => void;
  selectSession: (id: string | null) => void;
  toggleTheme: () => void;
  toggleLeftAuthor: (authorId: string) => void;
  fetchEntries: () => Promise<void>;
  fetchSymbols: () => Promise<void>;
  fetchAuthors: () => Promise<void>;
  fetchSessions: () => Promise<void>;
  fetchAll: () => Promise<void>;
}

function getInitialTheme(): 'dark' | 'light' {
  try {
    const saved = localStorage.getItem('paradigm-lore-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {}
  return 'dark';
}

function getInitialLeftAuthors(): string[] {
  try {
    const saved = localStorage.getItem('paradigm-lore-left-authors');
    if (saved) return JSON.parse(saved);
  } catch {}
  return [];
}

let entriesController: AbortController | null = null;
let symbolsController: AbortController | null = null;
let authorsController: AbortController | null = null;
let sessionsController: AbortController | null = null;
let sessionDetailController: AbortController | null = null;
let loreInfoController: AbortController | null = null;

export const useLoreStore = create<LoreState>((set, get) => ({
  entries: [],
  filter: {},
  view: 'timeline',
  selectedEntryId: null,
  symbols: [],
  authors: [],
  selectedSymbol: null,
  selectedAuthor: null,
  sessions: [],
  selectedSessionId: null,
  loading: false,
  projectName: '',
  theme: getInitialTheme(),
  leftAuthors: getInitialLeftAuthors(),

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

  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('paradigm-lore-theme', next); } catch {}
    set({ theme: next });
  },

  toggleLeftAuthor: (authorId) => {
    const current = get().leftAuthors;
    const next = current.includes(authorId)
      ? current.filter(a => a !== authorId)
      : [...current, authorId];
    try { localStorage.setItem('paradigm-lore-left-authors', JSON.stringify(next)); } catch {}
    set({ leftAuthors: next });
  },

  selectSession: async (id) => {
    set({ selectedSessionId: id });
    if (id) {
      sessionDetailController?.abort();
      sessionDetailController = new AbortController();
      const { signal } = sessionDetailController;
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { signal });
        const data = await res.json();
        // Update the session in the list with full entries
        set((s) => ({
          sessions: s.sessions.map(sess =>
            sess.id === id ? { ...sess, entries: data.entries } : sess
          ),
        }));
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        // ignore
      }
    }
  },

  fetchEntries: async () => {
    entriesController?.abort();
    entriesController = new AbortController();
    const { signal } = entriesController;
    set({ loading: true });
    try {
      const f = get().filter;
      const params = new URLSearchParams();
      if (f.author) params.set('author', f.author);
      if (f.hasAgent !== undefined) params.set('hasAgent', String(f.hasAgent));
      else if (f.authorType) params.set('authorType', f.authorType);
      if (f.symbol) params.set('symbol', f.symbol);
      if (f.type) params.set('type', f.type);
      if (f.dateFrom) params.set('from', f.dateFrom);
      if (f.dateTo) params.set('to', f.dateTo);
      if (f.tag) params.set('tag', f.tag);
      if (f.tags?.length) params.set('tags', f.tags.join(','));
      if (f.hasReview !== undefined) params.set('hasReview', String(f.hasReview));
      if (f.hasBody !== undefined) params.set('hasBody', String(f.hasBody));
      params.set('limit', '200');

      const res = await fetch(`/api/lore?${params}`, { signal });
      const data = await res.json();

      let entries = data.entries || [];

      // Client-side search filter
      if (f.search) {
        const q = f.search.toLowerCase();
        entries = entries.filter((e: LoreEntry) =>
          e.title.toLowerCase().includes(q) ||
          e.summary.toLowerCase().includes(q) ||
          e.symbols_touched?.some((s: string) => s.toLowerCase().includes(q))
        );
      }

      set({ entries, loading: false });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      set({ loading: false });
    }
  },

  fetchSymbols: async () => {
    symbolsController?.abort();
    symbolsController = new AbortController();
    const { signal } = symbolsController;
    try {
      const res = await fetch('/api/lore/symbols', { signal });
      const data = await res.json();
      set({ symbols: data.symbols || [] });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      // ignore
    }
  },

  fetchAuthors: async () => {
    authorsController?.abort();
    authorsController = new AbortController();
    const { signal } = authorsController;
    try {
      const res = await fetch('/api/lore/authors', { signal });
      const data = await res.json();
      set({ authors: data.authors || [] });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      // ignore
    }
  },

  fetchSessions: async () => {
    sessionsController?.abort();
    sessionsController = new AbortController();
    const { signal } = sessionsController;
    try {
      const res = await fetch('/api/sessions', { signal });
      const data = await res.json();
      set({ sessions: data.sessions || [] });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      // ignore
    }
  },

  fetchAll: async () => {
    loreInfoController?.abort();
    loreInfoController = new AbortController();
    const { signal } = loreInfoController;
    try {
      const infoRes = await fetch('/api/info', { signal });
      const info = await infoRes.json();
      set({ projectName: info.project || '' });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      // ignore
    }
    await Promise.all([
      get().fetchEntries(),
      get().fetchSymbols(),
      get().fetchAuthors(),
      get().fetchSessions(),
    ]);
  },
}));
