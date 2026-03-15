import { create } from 'zustand';

export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  symbols: string[];
}

export interface GitBranch {
  name: string;
  current: boolean;
  commit: string;
  label: string;
}

export type GitTab = 'files' | 'log';

interface GitState {
  // Status
  branch: string;
  ahead: number;
  behind: number;
  staged: string[];
  unstaged: string[];
  untracked: string[];

  // Log
  commits: GitCommit[];
  commitTotal: number;
  commitOffset: number;

  // Branches
  branches: GitBranch[];

  // UI state
  selectedFile: string | null;
  selectedFileStaged: boolean;
  diffContent: string;
  commitMessage: string;
  activeTab: GitTab;
  loading: boolean;
  pushing: boolean;
  committing: boolean;

  // Symbols for autocomplete
  symbols: string[];

  // Actions
  fetchStatus: () => Promise<void>;
  fetchBranches: () => Promise<void>;
  fetchLog: (reset?: boolean) => Promise<void>;
  loadMoreCommits: () => Promise<void>;
  selectFile: (path: string, staged: boolean) => Promise<void>;
  clearSelection: () => void;
  stageFiles: (paths: string[]) => Promise<void>;
  unstageFiles: (paths: string[]) => Promise<void>;
  commit: () => Promise<boolean>;
  push: () => Promise<boolean>;
  setCommitMessage: (msg: string) => void;
  setActiveTab: (tab: GitTab) => void;
  fetchSymbols: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const useGitStore = create<GitState>((set, get) => ({
  branch: '',
  ahead: 0,
  behind: 0,
  staged: [],
  unstaged: [],
  untracked: [],
  commits: [],
  commitTotal: 0,
  commitOffset: 0,
  branches: [],
  selectedFile: null,
  selectedFileStaged: false,
  diffContent: '',
  commitMessage: '',
  activeTab: 'files',
  loading: false,
  pushing: false,
  committing: false,
  symbols: [],

  fetchStatus: async () => {
    try {
      const res = await fetch('/api/git/status');
      if (!res.ok) return;
      const data = await res.json();
      set({
        branch: data.branch,
        ahead: data.ahead,
        behind: data.behind,
        staged: data.staged,
        unstaged: data.unstaged,
        untracked: data.untracked,
      });
    } catch {
      // ignore
    }
  },

  fetchBranches: async () => {
    try {
      const res = await fetch('/api/git/branches');
      if (!res.ok) return;
      const data = await res.json();
      set({ branches: data.branches || [] });
    } catch {
      // ignore
    }
  },

  fetchLog: async (reset = true) => {
    try {
      const offset = reset ? 0 : get().commitOffset;
      const res = await fetch(`/api/git/log?limit=20&offset=${offset}`);
      if (!res.ok) return;
      const data = await res.json();
      if (reset) {
        set({ commits: data.commits, commitTotal: data.total, commitOffset: 20 });
      } else {
        set(s => ({
          commits: [...s.commits, ...data.commits],
          commitTotal: data.total,
          commitOffset: s.commitOffset + 20,
        }));
      }
    } catch {
      // ignore
    }
  },

  loadMoreCommits: async () => {
    await get().fetchLog(false);
  },

  selectFile: async (filePath: string, staged: boolean) => {
    set({ selectedFile: filePath, selectedFileStaged: staged, diffContent: '' });
    try {
      const params = new URLSearchParams({ path: filePath });
      if (staged) params.set('staged', 'true');
      const res = await fetch(`/api/git/diff?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      set({ diffContent: data.diff || '(no diff available)' });
    } catch {
      set({ diffContent: '(error loading diff)' });
    }
  },

  clearSelection: () => set({ selectedFile: null, diffContent: '' }),

  stageFiles: async (paths: string[]) => {
    try {
      const res = await fetch('/api/git/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      });
      if (res.ok) await get().fetchStatus();
    } catch {
      // ignore
    }
  },

  unstageFiles: async (paths: string[]) => {
    try {
      const res = await fetch('/api/git/unstage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      });
      if (res.ok) await get().fetchStatus();
    } catch {
      // ignore
    }
  },

  commit: async () => {
    const msg = get().commitMessage.trim();
    if (!msg) return false;
    set({ committing: true });
    try {
      const res = await fetch('/api/git/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      if (res.ok) {
        set({ commitMessage: '' });
        await Promise.all([get().fetchStatus(), get().fetchLog()]);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      set({ committing: false });
    }
  },

  push: async () => {
    set({ pushing: true });
    try {
      const res = await fetch('/api/git/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        await get().fetchStatus();
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      set({ pushing: false });
    }
  },

  setCommitMessage: (msg: string) => set({ commitMessage: msg }),
  setActiveTab: (tab: GitTab) => set({ activeTab: tab }),

  fetchSymbols: async () => {
    try {
      const res = await fetch('/api/symbols');
      if (!res.ok) return;
      const data = await res.json();
      const symbolList = data.symbols || [];
      const names = symbolList.map((s: { id?: string; name?: string; category?: string }) => {
        const prefix = { component: '#', flow: '$', gate: '^', signal: '!', aspect: '~' }[s.category || ''] || '#';
        return `${prefix}${s.name || s.id}`;
      });
      set({ symbols: names });
    } catch {
      // ignore
    }
  },

  refresh: async () => {
    set({ loading: true });
    await Promise.all([
      get().fetchStatus(),
      get().fetchLog(),
      get().fetchBranches(),
    ]);
    set({ loading: false });
  },
}));
