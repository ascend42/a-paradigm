import { create } from 'zustand';

// ── Types ────────────────────────────────────────────
// Mirror of the /api/brain response shapes. Everything shown here has already
// passed the server's owner view — locked areas arrive as counts only.

export interface BrainRef {
  id: string;
  name: string;
  root: string;
}

export interface Badge {
  nothingLeft: boolean;
  count: number;
  bytes: number;
  last: string | null;
}

export interface EgressItem {
  at: string;
  channel: 'mcp' | 'cloud';
  op: string;
  items: number;
  bytes: number;
}

export interface BrainMap {
  byType: { markdown: number; text: number; other: number };
  bySize: { small: number; medium: number; large: number; huge: number };
  byRecency: { week: number; month: number; year: number; older: number; unknown: number };
}

export interface LockedArea {
  folder: string | null;
  gate: string;
  count: number;
}

export interface Overview {
  brains: BrainRef[];
  selected: string | null;
  scannedAt?: string | null;
  visible?: number;
  badge?: Badge;
  egress?: EgressItem[];
  map?: BrainMap;
  locked?: LockedArea[];
  lockedTotal?: number;
  /** Owner-facing warning (e.g. brain.yaml changed outside Paradigm → agent access paused); null when none. */
  banner?: string | null;
  /** Suggestions auto-paused (too many dismissed). */
  paused?: boolean;
}

export interface NoteRef {
  id: string;
  title: string;
  path: string;
}

export interface Health {
  brokenLinks: Array<{ from: NoteRef; target: string }>;
  looseNotes: NoteRef[];
  sameName: Array<{ name: string; notes: NoteRef[] }>;
}

export interface Suggestion {
  id: string;
  label: string;
  scope: 'folder' | 'file';
  target: string;
  score: number;
  rationale: string;
}

export interface Suggestions {
  enabled: boolean;
  /** Auto mode switched suggestions off (too many dismissed). Optional: older servers omit it. */
  paused?: boolean;
  acceptance: number | null;
  suggestions: Suggestion[];
}

export interface FindHit {
  id: string;
  title: string;
  path: string;
  folder: string;
  kind: string;
  topics: string[];
  matched: 'title' | 'heading' | 'path' | 'topic';
}

export type Verdict = 'accept' | 'reject' | 'skip';

const SELECTED_KEY = 'paradigm-brain-selected';

function readSelected(): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
}

function writeSelected(id: string): void {
  try {
    localStorage.setItem(SELECTED_KEY, id);
  } catch {
    /* storage disabled — selection just won't persist */
  }
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data && typeof data.error === 'string') msg = data.error;
    } catch {
      /* keep status string */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

const errMsg = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);
const isAbort = (err: unknown) => err instanceof Error && err.name === 'AbortError';
const q = (brain: string | null) => (brain ? `brain=${encodeURIComponent(brain)}` : '');

interface BrainState {
  overview: Overview | null;
  loading: boolean;
  error: string | null;

  health: Health | null;
  healthError: string | null;

  suggestions: Suggestions | null;
  suggestionsError: string | null;
  cursor: number;
  verdictPending: boolean;
  verdictError: string | null;
  decided: Record<string, Verdict>;

  query: string;
  hits: FindHit[];
  findError: string | null;
  finding: boolean;

  load: (brain?: string) => Promise<void>;
  selectBrain: (brain: string) => Promise<void>;
  loadHealth: () => Promise<void>;
  loadSuggestions: () => Promise<void>;
  setCursor: (i: number) => void;
  decide: (verdict: Verdict) => Promise<void>;
  find: (query: string) => Promise<void>;
  /** Live refresh after a `brain:changed` broadcast (never resets an in-progress batch). */
  refresh: (brain?: string) => Promise<void>;
}

let findController: AbortController | null = null;

export const useBrainStore = create<BrainState>((set, get) => ({
  overview: null,
  loading: false,
  error: null,

  health: null,
  healthError: null,

  suggestions: null,
  suggestionsError: null,
  cursor: 0,
  verdictPending: false,
  verdictError: null,
  decided: {},

  query: '',
  hits: [],
  findError: null,
  finding: false,

  load: async (brain) => {
    const wanted = brain ?? readSelected();
    set({ loading: true, error: null });
    try {
      let ov = await getJson<Overview>(`/api/brain/overview?${q(wanted)}`).catch(async (err) => {
        // A remembered brain that no longer exists → fall back to the default.
        if (wanted) return getJson<Overview>('/api/brain/overview');
        throw err;
      });
      ov = { ...ov, brains: Array.isArray(ov.brains) ? ov.brains : [] };
      set({ overview: ov, loading: false });
      if (ov.selected) {
        writeSelected(ov.selected);
        void get().loadHealth();
        void get().loadSuggestions();
      }
    } catch (err) {
      set({ loading: false, error: errMsg(err, 'could not load your notes') });
    }
  },

  selectBrain: async (brain) => {
    set({ health: null, suggestions: null, hits: [], query: '', cursor: 0, decided: {} });
    await get().load(brain);
  },

  loadHealth: async () => {
    const brain = get().overview?.selected ?? null;
    set({ healthError: null });
    try {
      const h = await getJson<Health>(`/api/brain/health?${q(brain)}`);
      set({
        health: {
          brokenLinks: h.brokenLinks ?? [],
          looseNotes: h.looseNotes ?? [],
          sameName: h.sameName ?? [],
        },
      });
    } catch (err) {
      set({ healthError: errMsg(err, 'could not check your notes') });
    }
  },

  loadSuggestions: async () => {
    const brain = get().overview?.selected ?? null;
    set({ suggestionsError: null });
    try {
      const s = await getJson<Suggestions>(`/api/brain/suggestions?${q(brain)}`);
      set({
        suggestions: {
          enabled: !!s.enabled,
          ...(typeof s.paused === 'boolean' ? { paused: s.paused } : {}),
          acceptance: s.acceptance ?? null,
          suggestions: (s.suggestions ?? []).slice(0, 10),
        },
        cursor: 0,
        decided: {},
      });
    } catch (err) {
      set({ suggestionsError: errMsg(err, 'could not load suggestions') });
    }
  },

  setCursor: (i) => {
    const n = get().suggestions?.suggestions.length ?? 0;
    set({ cursor: Math.max(0, Math.min(i, Math.max(0, n - 1))) });
  },

  decide: async (verdict) => {
    const { suggestions, cursor, overview, verdictPending } = get();
    const item = suggestions?.suggestions[cursor];
    if (!item || verdictPending || !overview?.selected) return;
    set({ verdictPending: true, verdictError: null });
    try {
      // ^brain-owner-write: the owner token rides in the HttpOnly `brain_owner`
      // cookie set by GET /overview — never readable from script.
      const res = await fetch('/api/brain/verdict', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId: item.id, verdict, brain: overview.selected }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (data && typeof data.error === 'string') msg = data.error;
        } catch {
          /* keep status */
        }
        throw new Error(msg);
      }
      const decided = { ...get().decided, [item.id]: verdict };
      const list = suggestions!.suggestions;
      // Advance to the next undecided suggestion.
      let next = cursor;
      for (let i = 1; i <= list.length; i++) {
        const j = (cursor + i) % list.length;
        if (!decided[list[j].id]) {
          next = j;
          break;
        }
      }
      set({ decided, cursor: next, verdictPending: false });
    } catch (err) {
      set({ verdictPending: false, verdictError: errMsg(err, 'could not save that') });
    }
  },

  refresh: async (brain) => {
    const { overview } = get();
    const selected = overview?.selected ?? null;
    // A change to another brain (or before anything loaded) is not ours to show.
    if (!selected || (brain && brain !== selected)) return;
    try {
      const ov = await getJson<Overview>(`/api/brain/overview?${q(selected)}`);
      set({ overview: { ...ov, brains: Array.isArray(ov.brains) ? ov.brains : [] } });
    } catch {
      /* keep the current view; the next change or reload will catch up */
    }
    void get().loadHealth();
    // Mid-batch (some verdicts already given here) → keep the batch and cursor;
    // "show the next batch" picks up the change.
    const { decided, verdictPending } = get();
    if (!verdictPending && Object.keys(decided).length === 0) void get().loadSuggestions();
  },

  find: async (query) => {
    set({ query });
    findController?.abort();
    const text = query.slice(0, 200);
    if (!text.trim()) {
      set({ hits: [], findError: null, finding: false });
      return;
    }
    findController = new AbortController();
    const { signal } = findController;
    const brain = get().overview?.selected ?? null;
    set({ finding: true, findError: null });
    try {
      const r = await getJson<{ hits: FindHit[] }>(`/api/brain/find?q=${encodeURIComponent(text)}&${q(brain)}`, signal);
      set({ hits: r.hits ?? [], finding: false });
    } catch (err) {
      if (isAbort(err)) return;
      set({ finding: false, findError: errMsg(err, 'search failed') });
    }
  },
}));
