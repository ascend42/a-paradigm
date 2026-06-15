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
  // Cid's SUGGESTED owner for an unclaimed task — distinct from an actual
  // claim. Surfaced as a "→ ref" hint on unclaimed cards/lanes.
  proposedClaimant?: TaskClaimant;
  dependsOn?: string[];
  started_at?: string;
  blocked_on?: string;
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
  loose?: number;
}

// ── Board health (Cid/Loid governance detections) ────
// Three advisory (never-blocking) signals the backend attaches to the board.
// All optional + absent when empty — a healthy board carries none of them, so
// BoardHealth self-hides entirely.

/** DAG structural defect — advise-only. */
export interface BoardIntegrityViolation {
  kind: 'self-parent' | 'dangling-parent' | 'dangling-dependency' | 'cycle';
  taskId: string;
  detail: string;
}

/** A run whose children all settled but whose epic never did. */
export interface BoardSettlementDebt {
  epicTaskId: string;
  blurb: string;
  reason: string;
}

/** An archetype-claimed open task past the 7-day staleness threshold. */
export interface BoardStaleClaim {
  taskId: string;
  blurb: string;
  claimant: TaskClaimant;
  ageDays: number;
}

export interface BoardData {
  runs: BoardRun[];
  unclaimed: BoardUnclaimed[];
  /** Full-forest tail — claimed standalone tasks not in a run or unclaimed. */
  loose?: BoardNode[];
  summary: BoardSummary;
  // ── Cid/Loid governance detections (advisory; absent when empty) ──
  integrity?: BoardIntegrityViolation[];
  settlementDebt?: BoardSettlementDebt[];
  staleClaims?: BoardStaleClaim[];
}

// ── GitHub two-way sync (POST /api/tasks/sync) ───────
// The server pulls each linked GitHub issue and reconciles it back through the
// enforced state machine. The client sends no task/remote state — at most a
// list of ids to scope the sync (omit = sync all linked tasks).

export type SyncVerdictStatus =
  | 'synced'
  | 'agree'
  | 'conflict'
  | 'offline'
  | 'remote-error'
  | 'unlinked'
  | 'no-pull';

export interface SyncVerdict {
  taskId: string;
  status: SyncVerdictStatus;
  targetStatus?: TaskStatus;
  drift: string[];
}

export interface SyncSummary {
  synced: number;
  conflict: number;
  agree: number;
  skipped: number;
}

export interface SyncResult {
  summary: SyncSummary;
  verdicts: SyncVerdict[];
  // Derived client-side: true when no verdict reached the remote (gh not authed
  // / no server) — every verdict is offline or skipped. Surfaced as a calm hint,
  // never a red failure.
  offline: boolean;
  // Conflicted task ids (local won, a human should look) — for clickable list.
  conflictIds: string[];
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
// laneMode = how BoardView groups its lanes. boardTab is the Board's sub-tab
// (the lane modes + a dedicated Calibration tab). When boardTab is one of the
// lane modes BoardView derives laneMode = boardTab; Calibration replaces the
// lanes entirely with the calibration grid.
export type LaneMode = 'claimant' | 'state' | 'symbol';
export type BoardTab = 'state' | 'claimant' | 'symbol' | 'calibration';

export interface TaskFilter {
  status?: TaskStatus | '';
  priority?: TaskPriority | '';
  search?: string;
}

export interface CalibrationFilter {
  archetype: string;
  taskType: string;
}

const BOARD_TAB_KEY = 'paradigm.tasks.boardTab';

function loadBoardTab(): BoardTab {
  try {
    const v = localStorage.getItem(BOARD_TAB_KEY);
    if (v === 'state' || v === 'claimant' || v === 'symbol' || v === 'calibration') return v;
  } catch {
    /* localStorage unavailable */
  }
  // STATE is the default for everyone — we intentionally do NOT inherit the
  // legacy laneMode key (which could land an existing user on Claimant).
  return 'state';
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

  // Cross-run dependency resolution cache (FIX C). Keyed by task id. A value of
  // `null` means a genuine 404 (resolve to "unknown"); a Task means resolved.
  // Absence means not-yet-fetched.
  depCache: Record<string, Task | null>;

  // Action state (Round E — enforced write verbs).
  // `actionError` holds the last write-verb failure message (e.g. a 409
  // "cannot displace" from claim). Transient: cleared on the next action.
  actionError: string | null;

  // GitHub two-way sync state (the real Sync button). `syncing` drives the
  // strip's spinner/disabled state; `lastSyncSummary` is the transient inline
  // result the strip renders after a sync.
  syncing: boolean;
  lastSyncSummary: SyncResult | null;

  // Board sub-tab (persisted) — drives lane grouping + the Calibration tab.
  boardTab: BoardTab;

  // Filters
  filter: TaskFilter;
  calibrationFilter: CalibrationFilter | null;

  setView: (view: TaskView) => void;
  setBoardTab: (tab: BoardTab) => void;
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

  // Lazily resolve a single task by id for cross-run dependency rendering
  // (FIX C). Dedups in-flight + cached fetches; caches null on a 404.
  resolveDep: (id: string) => Promise<void>;

  // Write verbs (Round E — the ONLY mutations in this UI). Each POSTs the
  // enforced task-action endpoint, then refreshes board/list (+inbox if a
  // claimant is focused) so every view reflects the new state machine state.
  claimTask: (id: string, ref: string, kind?: string, force?: boolean) => Promise<void>;
  startTask: (id: string) => Promise<void>;
  doneTask: (id: string) => Promise<void>;
  blockTask: (id: string, reason: string) => Promise<void>;
  unblockTask: (id: string) => Promise<void>;
  clearActionError: () => void;

  // GitHub two-way sync (Round F). POSTs /api/tasks/sync (no client state —
  // server pulls+reconciles each linked issue through the enforced state
  // machine), returns the summary, and on success re-runs fetchBoard/fetchTasks
  // (+inbox if focused) so applied changes show immediately. `ids` scopes the
  // sync; omit to sync all linked tasks.
  syncGitHub: (ids?: string[]) => Promise<SyncResult | null>;
  clearSyncSummary: () => void;
}

let tasksController: AbortController | null = null;
let boardController: AbortController | null = null;
let calibrationController: AbortController | null = null;
let inboxController: AbortController | null = null;
// In-flight dependency resolves (FIX C) — dedups concurrent GET /api/tasks/:id.
const depInFlight = new Set<string>();

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
  depCache: {},

  syncing: false,
  lastSyncSummary: null,

  boardTab: loadBoardTab(),

  filter: { status: '', priority: '', search: '' },
  calibrationFilter: null,

  setView: (view) => set({ view }),

  setBoardTab: (tab) => {
    try {
      localStorage.setItem(BOARD_TAB_KEY, tab);
    } catch {
      /* ignore */
    }
    set({ boardTab: tab });
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
          loose: data.loose || [],
          summary: data.summary || { runs: 0, open: 0, inFlight: 0, unclaimed: 0, loose: 0 },
          // Governance detections — pass through verbatim. Left undefined when the
          // backend omits them (healthy board) so BoardHealth self-hides.
          integrity: data.integrity,
          settlementDebt: data.settlementDebt,
          staleClaims: data.staleClaims,
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

  // ── Cross-run dependency resolution (FIX C) ──────────
  // Fetch a single task by id when a dependency isn't in the loaded board/inbox
  // pool. Dedups: skips ids already cached (incl. cached-null 404s) or in flight.
  // Caches the resolved Task, or null on a genuine 404, so deps render "unknown"
  // only after a fetch truly fails.
  resolveDep: async (id) => {
    if (!id) return;
    if (id in get().depCache) return; // already resolved or known-404
    if (depInFlight.has(id)) return; // dedup concurrent fetches
    depInFlight.add(id);
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`);
      if (res.status === 404) {
        set((s) => ({ depCache: { ...s.depCache, [id]: null } }));
        return;
      }
      if (!res.ok) return; // transient — leave uncached so a later pass retries
      const data = await res.json();
      const task = (data && data.task ? data.task : data) as Task;
      if (task && task.id) {
        set((s) => ({ depCache: { ...s.depCache, [id]: task } }));
      }
    } catch {
      /* network error — leave uncached for a retry */
    } finally {
      depInFlight.delete(id);
    }
  },

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

  // ── GitHub two-way sync (Round F) ────────────────────
  clearSyncSummary: () => set({ lastSyncSummary: null }),

  syncGitHub: async (ids) => {
    if (get().syncing) return get().lastSyncSummary;
    set({ syncing: true });
    try {
      const body = ids && ids.length ? { ids } : {};
      const res = await fetch('/api/tasks/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // Treat a server-level failure as "GitHub not available" — calm, not red.
        const result: SyncResult = {
          summary: { synced: 0, conflict: 0, agree: 0, skipped: 0 },
          verdicts: [],
          offline: true,
          conflictIds: [],
        };
        set({ syncing: false, lastSyncSummary: result });
        return result;
      }
      const data = (await res.json()) as {
        summary?: Partial<SyncSummary>;
        verdicts?: SyncVerdict[];
      };
      const summary: SyncSummary = {
        synced: data.summary?.synced ?? 0,
        conflict: data.summary?.conflict ?? 0,
        agree: data.summary?.agree ?? 0,
        skipped: data.summary?.skipped ?? 0,
      };
      const verdicts = data.verdicts ?? [];
      // Offline when nothing reached the remote — every verdict is offline or
      // skipped (gh not authed / no linked work that could be pulled).
      const reached = verdicts.some(
        (v) => v.status !== 'offline' && v.status !== 'skipped'
      );
      const offline = verdicts.length > 0 && !reached;
      const conflictIds = verdicts
        .filter((v) => v.status === 'conflict')
        .map((v) => v.taskId);

      const result: SyncResult = { summary, verdicts, offline, conflictIds };
      set({ syncing: false, lastSyncSummary: result });

      // Refresh every view that could reflect an applied change. Only worth the
      // round-trips when the server actually moved or reconciled something.
      if (summary.synced > 0 || summary.conflict > 0 || summary.agree > 0) {
        const { fetchBoard, fetchTasks, fetchInbox, inboxClaimant } = get();
        const refreshes: Promise<void>[] = [fetchBoard(), fetchTasks()];
        if (inboxClaimant) {
          refreshes.push(fetchInbox(inboxClaimant.kind, inboxClaimant.ref));
        }
        await Promise.all(refreshes);
      }
      return result;
    } catch {
      // Network error (no server / fetch failed) — calm offline hint, not red.
      const result: SyncResult = {
        summary: { synced: 0, conflict: 0, agree: 0, skipped: 0 },
        verdicts: [],
        offline: true,
        conflictIds: [],
      };
      set({ syncing: false, lastSyncSummary: result });
      return result;
    }
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
