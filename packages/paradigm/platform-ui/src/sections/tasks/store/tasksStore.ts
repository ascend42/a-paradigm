import { create } from 'zustand';

// ── Types ────────────────────────────────────────────
// Mirror of the /api/tasks Task shape. The `estimate` field is the moat:
// source:'learned' (n>=8) is a band learned from the team's actuals; 'prior'
// is a cold-start guess.

export type TaskPriority = 'high' | 'medium' | 'low';
export type TaskStatus = 'open' | 'in-progress' | 'done' | 'shelved';

export interface TaskClaimant {
  kind: string; // 'archetype' | 'human' | 'peer'
  ref: string;
}

export interface TaskEstimate {
  min: number;
  max: number;
  n: number;
  source: 'learned' | 'prior';
}

export interface TaskExternalRef {
  provider: string; // 'github' | ...
  ref: string;
  url?: string;
}

export interface Task {
  id: string;
  blurb: string;
  priority: TaskPriority;
  status: TaskStatus;
  tags: string[];
  created: string;
  claimant?: TaskClaimant;
  dependsOn?: string[];
  started_at?: string;
  blocked_on?: string[];
  external_ref?: TaskExternalRef;
  estimate: TaskEstimate;
}

export type TaskView = 'board' | 'list' | 'inbox';

interface TasksState {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  view: TaskView;

  setView: (view: TaskView) => void;
  fetchTasks: () => Promise<void>;
}

let tasksController: AbortController | null = null;

export const useTasksStore = create<TasksState>((set) => ({
  tasks: [],
  loading: false,
  error: null,
  view: 'list',

  setView: (view) => set({ view }),

  fetchTasks: async () => {
    tasksController?.abort();
    tasksController = new AbortController();
    const { signal } = tasksController;
    set({ loading: true, error: null });
    try {
      const res = await fetch('/api/tasks?status=active&limit=100', { signal });
      if (!res.ok) {
        set({ loading: false, error: `HTTP ${res.status}` });
        return;
      }
      const data = await res.json();
      set({ tasks: data.tasks || [], loading: false });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      set({ loading: false, error: err instanceof Error ? err.message : 'fetch failed' });
    }
  },
}));
