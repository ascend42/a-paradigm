import { create } from 'zustand';

export interface SidebarItem {
  id: string;
  label: string;
  kind: string;
  description?: string;
  badge?: string;
}

export interface SidebarGroup {
  id: string;
  label: string;
  collapsed: boolean;
  items: SidebarItem[];
  subgroups?: SidebarGroup[];
}

export interface DocsManifest {
  title: string;
  project: string;
  generatedAt: string;
  groups: SidebarGroup[];
  totalSymbols: number;
  symbolCounts: Record<string, number>;
}

export interface PageData {
  // Generic page data — actual structure varies by kind
  [key: string]: unknown;
}

export interface SearchResult {
  id: string;
  kind: string;
  label: string;
  description: string;
  score: number;
}

type PageKind = 'symbol' | 'flow' | 'portal' | 'custom';

interface DocsState {
  manifest: DocsManifest | null;
  activePage: { kind: PageKind; id: string } | null;
  pageData: PageData | null;
  searchQuery: string;
  searchResults: SearchResult[];
  loading: boolean;
  searchLoading: boolean;
  sidebarCollapsed: Record<string, boolean>;

  fetchManifest: () => Promise<void>;
  selectPage: (kind: PageKind, id: string) => Promise<void>;
  search: (query: string) => Promise<void>;
  clearSearch: () => void;
  toggleGroup: (groupId: string) => void;
}

export const useDocsStore = create<DocsState>((set, get) => ({
  manifest: null,
  activePage: null,
  pageData: null,
  searchQuery: '',
  searchResults: [],
  loading: false,
  searchLoading: false,
  sidebarCollapsed: {},

  fetchManifest: async () => {
    try {
      const res = await fetch('/api/docs/manifest');
      if (res.ok) {
        const data = await res.json();
        set({ manifest: data });
        // Initialize collapsed state from manifest
        const collapsed: Record<string, boolean> = {};
        for (const g of data.groups || []) {
          collapsed[g.id] = g.collapsed;
          if (g.subgroups) {
            for (const sg of g.subgroups) {
              collapsed[`${g.id}/${sg.id}`] = sg.collapsed;
            }
          }
        }
        set({ sidebarCollapsed: collapsed });
      }
    } catch {
      // Will retry on next section load
    }
  },

  selectPage: async (kind, id) => {
    set({ loading: true, activePage: { kind, id } });
    try {
      let url = '';
      switch (kind) {
        case 'symbol':
          url = `/api/docs/symbol/${encodeURIComponent(id)}`;
          break;
        case 'flow':
          url = `/api/docs/flow/${encodeURIComponent(id)}`;
          break;
        case 'portal':
          url = '/api/docs/portal';
          break;
        case 'custom':
          url = `/api/docs/page/${encodeURIComponent(id)}`;
          break;
      }
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        set({ pageData: data, loading: false });
      } else {
        set({ pageData: null, loading: false });
      }
    } catch {
      set({ pageData: null, loading: false });
    }
  },

  search: async (query) => {
    set({ searchQuery: query, searchLoading: true });
    if (!query.trim()) {
      set({ searchResults: [], searchLoading: false });
      return;
    }
    try {
      const res = await fetch(`/api/docs/search?q=${encodeURIComponent(query)}&limit=20`);
      if (res.ok) {
        const data = await res.json();
        set({ searchResults: data.results || [], searchLoading: false });
      } else {
        set({ searchResults: [], searchLoading: false });
      }
    } catch {
      set({ searchResults: [], searchLoading: false });
    }
  },

  clearSearch: () => set({ searchQuery: '', searchResults: [] }),

  toggleGroup: (groupId) => {
    const current = get().sidebarCollapsed;
    set({ sidebarCollapsed: { ...current, [groupId]: !current[groupId] } });
  },
}));
