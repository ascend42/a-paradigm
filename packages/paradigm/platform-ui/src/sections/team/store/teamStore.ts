import { create } from 'zustand';

// ── Types ────────────────────────────────────────────

export interface AgentSummary {
  id: string;
  role: string;
  nickname?: string;
  benched: boolean;
  expertiseCount: number;
  topExpertise: Array<{ symbol: string; confidence: number }>;
  threshold?: number;
}

export interface ThreadMessage {
  id: string;
  threadRoot?: string;
  timestamp: string;
  sender: { name: string; role?: string; project?: string };
  intent: string;
  text: string;
  symbols: string[];
  diff?: string;
  decision?: string;
}

export interface TeamThread {
  id: string;
  displayName: string;
  messages: ThreadMessage[];
  lastActivity: string;
}

interface TeamState {
  // Roster
  activeAgents: AgentSummary[];
  benchedAgents: AgentSummary[];
  rosterLoading: boolean;

  // Threads
  threads: TeamThread[];
  threadsLoading: boolean;
  selectedThread: string | null;

  // Actions
  fetchRoster: () => Promise<void>;
  fetchThreads: () => Promise<void>;
  toggleBench: (id: string, benched: boolean) => Promise<void>;
  selectThread: (id: string | null) => void;
}

// ── Store ────────────────────────────────────────────

let rosterController: AbortController | null = null;
let threadsController: AbortController | null = null;

export const useTeamStore = create<TeamState>((set, get) => ({
  activeAgents: [],
  benchedAgents: [],
  rosterLoading: false,
  threads: [],
  threadsLoading: false,
  selectedThread: null,

  fetchRoster: async () => {
    rosterController?.abort();
    rosterController = new AbortController();
    const { signal } = rosterController;
    set({ rosterLoading: true });
    try {
      const res = await fetch('/api/team/roster', { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      set({
        activeAgents: data.active || [],
        benchedAgents: data.benched || [],
        rosterLoading: false,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      set({ rosterLoading: false });
    }
  },

  fetchThreads: async () => {
    threadsController?.abort();
    threadsController = new AbortController();
    const { signal } = threadsController;
    set({ threadsLoading: true });
    try {
      const res = await fetch('/api/team/threads', { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      set({
        threads: data.threads || [],
        threadsLoading: false,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      set({ threadsLoading: false });
    }
  },

  toggleBench: async (id, benched) => {
    try {
      const res = await fetch(`/api/team/agents/${id}/bench`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ benched }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Refetch roster after toggle
      get().fetchRoster();
    } catch {
      // Silent fail — will refresh on next poll
    }
  },

  selectThread: (id) => set({ selectedThread: id }),
}));
