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
  // The calibration band's task type (feature|bugfix|refactor|design|analysis|
  // research|documentation|audit). Pairs with the claimant archetype to name the
  // calibration cell that produced `estimate`.
  taskType?: string;
}

export type TaskView = 'board' | 'list' | 'inbox';

// ── Board API shapes (GET /api/tasks/board) ──────────
// The board groups orchestration runs (epics) into nodes, plus a flat list of
// unclaimed tasks. Estimates ride along on every node/unclaimed entry.

export interface BoardNode {
  taskId: string;
  blurb: string;
  stage?: string;
  status: TaskStatus;
  claimant?: TaskClaimant;
  dependsOn?: string[];
  fragileSymbols?: string[];
  estimate: TaskEstimate;
  taskType?: string;
  // Fields not always present on a board node but useful for the card:
  priority?: TaskPriority;
  tags?: string[];
}

export interface BoardRun {
  epicTaskId: string;
  blurb: string;
  runStatus?: string;
  nodes: BoardNode[];
}

export interface BoardUnclaimed {
  taskId: string;
  blurb: string;
  priority: TaskPriority;
  tags: string[];
  rippleScore?: number;
  fragileSymbols?: string[];
  proposedClaimant?: TaskClaimant;
  estimate: TaskEstimate;
  taskType?: string;
}

export interface BoardSummary {
  runs: number;
  open: number;
  inFlight: number;
  unclaimed: number;
}

export interface BoardData {
  runs: BoardRun[];
  unclaimed: BoardUnclaimed[];
  summary: BoardSummary;
}

// ── Calibration API shapes (GET /api/tasks/calibration) ──
export interface CalibrationCell {
  min: number;
  max: number;
  n: number;
  source: 'learned' | 'prior';
}

export interface CalibrationData {
  archetypes: string[];
  taskTypes: string[];
  cells: Record<string, Record<string, CalibrationCell>>;
  coverage: { graduated: number; total: number; pct: number };
}

// ── Lanes + filters ──────────────────────────────────
export type LaneMode = 'claimant' | 'state' | 'symbol';

export interface TaskFilter {
  status?: TaskStatus | '';
  priority?: TaskPriority | '';
  search?: string;
}

export interface CalibrationFilter {
  archetype: string;
  taskType: string;
}

const LANE_MODE_KEY = 'paradigm.tasks.laneMode';

function loadLaneMode(): LaneMode {
  try {
    const v = localStorage.getItem(LANE_MODE_KEY);
    if (v === 'claimant' || v === 'state' || v === 'symbol') return v;
  } catch {
    /* localStorage unavailable */
  }
  return 'claimant';
}

interface TasksState {
  // List state (Round B — kept intact)
  tasks: Task[];
  loading: boolean;
  error: string | null;
  view: TaskView;

  // Board state (Round C)
  board: BoardData | null;
  boardLoading: boolean;
  boardError: string | null;

  // Calibration state (Round C)
  calibration: CalibrationData | null;
  calibrationLoading: boolean;

  // Inbox state (Round D — the agent face)
  whoami: TaskClaimant | null;
  inboxClaimant: TaskClaimant | null;
  inboxTasks: Task[];
  inboxLoading: boolean;
  inboxError: string | null;

  // Detail panel state (Round D)
  selectedTaskId: string | null;

  // Action state (Round E — enforced write verbs).
  // `actionError` holds the last write-verb failure message (e.g. a 409
  // "cannot displace" from claim). Transient: cleared on the next action.
  actionError: string | null;

  // Lane mode (persisted)
  laneMode: LaneMode;

  // Filters
  filter: TaskFilter;
  calibrationFilter: CalibrationFilter | null;

  setView: (view: TaskView) => void;
  setLaneMode: (mode: LaneMode) => void;
  setFilter: (patch: Partial<TaskFilter>) => void;
  clearFilters: () => void;
  setCalibrationFilter: (f: CalibrationFilter | null) => void;

  fetchTasks: () => Promise<void>;
  fetchBoard: () => Promise<void>;
  fetchCalibration: () => Promise<void>;

  // Inbox actions (Round D)
  fetchWhoami: () => Promise<TaskClaimant | null>;
  fetchInbox: (kind: string, ref: string) => Promise<void>;
  setInboxClaimant: (claimant: TaskClaimant) => void;

  // Detail actions (Round D)
  openDetail: (id: string) => void;
  closeDetail: () => void;

  // Write verbs (Round E — the ONLY mutations in this UI). Each POSTs the
  // enforced task-action endpoint, then refreshes board/list (+inbox if a
  // claimant is focused) so every view reflects the new state machine state.
  claimTask: (id: string, ref: string, kind?: string, force?: boolean) => Promise<void>;
  startTask: (id: string) => Promise<void>;
  doneTask: (id: string) => Promise<void>;
  blockTask: (id: string, reason: string) => Promise<void>;
  unblockTask: (id: string) => Promise<void>;
  clearActionError: () => void;
}

let tasksController: AbortController | null = null;
let boardController: AbortController | null = null;
let calibrationController: AbortController | null = null;
let inboxController: AbortController | null = null;

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  loading: false,
  error: null,
  view: 'board',

  board: null,
  boardLoading: false,
  boardError: null,

  calibration: null,
  calibrationLoading: false,

  whoami: null,
  inboxClaimant: null,
  inboxTasks: [],
  inboxLoading: false,
  inboxError: null,

  selectedTaskId: null,
  actionError: null,

  laneMode: loadLaneMode(),

  filter: { status: '', priority: '', search: '' },
  calibrationFilter: null,

  setView: (view) => set({ view }),

  setLaneMode: (mode) => {
    try {
      localStorage.setItem(LANE_MODE_KEY, mode);
    } catch {
      /* ignore */
    }
    set({ laneMode: mode });
  },

  setFilter: (patch) => set((s) => ({ filter: { ...s.filter, ...patch } })),

  clearFilters: () =>
    set({ filter: { status: '', priority: '', search: '' }, calibrationFilter: null }),

  setCalibrationFilter: (f) => set({ calibrationFilter: f }),

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

  fetchBoard: async () => {
    boardController?.abort();
    boardController = new AbortController();
    const { signal } = boardController;
    set({ boardLoading: true, boardError: null });
    try {
      const res = await fetch('/api/tasks/board', { signal });
      if (!res.ok) {
        set({ boardLoading: false, boardError: `HTTP ${res.status}` });
        return;
      }
      const data = (await res.json()) as BoardData;
      set({
        board: {
          runs: data.runs || [],
          unclaimed: data.unclaimed || [],
          summary: data.summary || { runs: 0, open: 0, inFlight: 0, unclaimed: 0 },
        },
        boardLoading: false,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      set({ boardLoading: false, boardError: err instanceof Error ? err.message : 'fetch failed' });
    }
  },

  fetchCalibration: async () => {
    calibrationController?.abort();
    calibrationController = new AbortController();
    const { signal } = calibrationController;
    set({ calibrationLoading: true });
    try {
      const res = await fetch('/api/tasks/calibration', { signal });
      if (!res.ok) {
        set({ calibrationLoading: false });
        return;
      }
      const data = (await res.json()) as CalibrationData;
      set({
        calibration: {
          archetypes: data.archetypes || [],
          taskTypes: data.taskTypes || [],
          cells: data.cells || {},
          coverage: data.coverage || { graduated: 0, total: 0, pct: 0 },
        },
        calibrationLoading: false,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      set({ calibrationLoading: false });
    }
  },

  // ── Inbox (Round D) ──────────────────────────────────
  // whoami resolves the human's claimant ref (git user.email-based). Cached so
  // the "Me" pill resolves without re-hitting the endpoint on every render.
  fetchWhoami: async () => {
    const cached = get().whoami;
    if (cached) return cached;
    try {
      const res = await fetch('/api/tasks/whoami');
      if (!res.ok) return null;
      const data = (await res.json()) as TaskClaimant;
      const claimant: TaskClaimant = {
        kind: data.kind || 'human',
        ref: data.ref || '',
      };
      set({ whoami: claimant });
      return claimant;
    } catch {
      return null;
    }
  },

  fetchInbox: async (kind, ref) => {
    inboxController?.abort();
    inboxController = new AbortController();
    const { signal } = inboxController;
    set({ inboxLoading: true, inboxError: null, inboxClaimant: { kind, ref } });
    try {
      const qs = new URLSearchParams({ kind, ref });
      const res = await fetch(`/api/tasks/inbox?${qs.toString()}`, { signal });
      if (!res.ok) {
        set({ inboxLoading: false, inboxError: `HTTP ${res.status}`, inboxTasks: [] });
        return;
      }
      const data = await res.json();
      set({
        inboxTasks: (data.tasks || []) as Task[],
        inboxClaimant: data.claimant || { kind, ref },
        inboxLoading: false,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      set({
        inboxLoading: false,
        inboxError: err instanceof Error ? err.message : 'fetch failed',
        inboxTasks: [],
      });
    }
  },

  setInboxClaimant: (claimant) => set({ inboxClaimant: claimant }),

  // ── Detail panel (Round D) ───────────────────────────
  openDetail: (id) => set({ selectedTaskId: id }),
  closeDetail: () => set({ selectedTaskId: null }),

  // ── Write verbs (Round E) ────────────────────────────
  clearActionError: () => set({ actionError: null }),

  claimTask: async (id, ref, kind, force) => {
    await runAction(set, get, `/api/tasks/${id}/claim`, {
      ref,
      ...(kind ? { kind } : {}),
      ...(force ? { force } : {}),
    });
  },
  startTask: async (id) => {
    await runAction(set, get, `/api/tasks/${id}/start`);
  },
  doneTask: async (id) => {
    await runAction(set, get, `/api/tasks/${id}/done`);
  },
  blockTask: async (id, reason) => {
    await runAction(set, get, `/api/tasks/${id}/block`, { reason });
  },
  unblockTask: async (id) => {
    await runAction(set, get, `/api/tasks/${id}/unblock`);
  },
}));

// runAction — shared POST→refresh helper for the five enforced write verbs.
// Clears any prior actionError up front; on a non-2xx reads the JSON error
// (falling back to a status string) into actionError; on success re-runs the
// affected fetchers so board/list/inbox all reflect the new state.
async function runAction(
  set: (partial: Partial<TasksState>) => void,
  get: () => TasksState,
  url: string,
  body?: Record<string, unknown>
): Promise<void> {
  set({ actionError: null });
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const data = await res.json();
        if (data && typeof data.error === 'string') {
          msg = data.claimant?.ref
            ? `${data.error} (held by ${data.claimant.ref})`
            : data.error;
        }
      } catch {
        /* non-JSON body — keep the status string */
      }
      set({ actionError: msg });
      return;
    }
    // Success — refresh every view that could reflect this task.
    const { fetchBoard, fetchTasks, fetchInbox, inboxClaimant } = get();
    const refreshes: Promise<void>[] = [fetchBoard(), fetchTasks()];
    if (inboxClaimant) refreshes.push(fetchInbox(inboxClaimant.kind, inboxClaimant.ref));
    await Promise.all(refreshes);
  } catch (err) {
    set({ actionError: err instanceof Error ? err.message : 'action failed' });
  }
}
