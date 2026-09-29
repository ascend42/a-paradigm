import { create } from 'zustand';

// ── Types ────────────────────────────────────────────
// Mirror of the /api/academy response shapes. Everything here is READ-ONLY —
// the Academy never writes to the server. Quiz results live only in this
// browser's localStorage.

export interface PackSection {
  id: string;
  name: string;
  order: number;
  style: string;
  description?: string;
}

export interface PackSummary {
  id: string;
  title: string;
  description: string;
  tenant_kind: string;
  origin: string;
  parentPackId?: string;
  counts: Record<string, number>;
  sections: PackSection[];
  skillCount: number;
}

export interface PathSummary {
  id: string;
  title: string;
  description: string;
  stepCount: number;
  section?: string;
  order?: number;
}

export type StepKind = 'note' | 'quiz' | 'path' | 'plsat' | 'missing';

export interface PathStep {
  content: string;
  kind: StepKind;
  title: string;
  required: boolean;
  passRequired?: boolean;
  note?: string;
}

export interface PathDetail {
  id: string;
  title: string;
  description: string;
  ordered: boolean;
  tags: string[];
  steps: PathStep[];
}

export interface NoteDetail {
  frontmatter: { id: string; title: string; difficulty?: string; estimatedMinutes?: number; tags?: string[] } & Record<string, unknown>;
  body: string;
}

export interface QuizQuestion {
  id: string;
  question: string;
  scenario?: string;
  choices: Record<string, string>;
  correct: string;
  explanation?: string;
  weight: number;
}

export interface QuizDetail {
  id: string;
  title: string;
  description: string;
  difficulty?: string;
  passThreshold: number;
  questions: QuizQuestion[];
}

export interface PackSkill {
  id: string;
  version: string;
  description: string;
  trust: 'external';
  allowedTools: string;
  scriptCount: number;
  shadowedBy?: 'project' | 'global';
}

/** A locally recorded quiz attempt (localStorage only). */
export interface QuizResult {
  score: number;
  passed: boolean;
  at: string;
}

/** What the reading pane is showing. */
export type Viewing =
  | { kind: 'none' }
  | { kind: 'note'; id: string }
  | { kind: 'quiz'; id: string };

const RESULTS_KEY = 'paradigm-academy-results';

function readResults(): Record<string, QuizResult> {
  try {
    const raw = localStorage.getItem(RESULTS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeResults(results: Record<string, QuizResult>): void {
  try {
    localStorage.setItem(RESULTS_KEY, JSON.stringify(results));
  } catch {
    /* storage full / disabled — results just won't persist */
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

interface AcademyState {
  packs: PackSummary[];
  packsLoading: boolean;
  packsError: string | null;

  selectedPackId: string | null;
  paths: PathSummary[];
  skills: PackSkill[];
  packLoading: boolean;
  packError: string | null;

  path: PathDetail | null;
  pathLoading: boolean;

  viewing: Viewing;
  note: NoteDetail | null;
  quiz: QuizDetail | null;
  contentLoading: boolean;
  contentError: string | null;

  /** keyed `${packId}:${quizId}` */
  results: Record<string, QuizResult>;

  fetchPacks: () => Promise<void>;
  selectPack: (packId: string) => Promise<void>;
  openPath: (pathId: string) => Promise<void>;
  closePath: () => void;
  openNote: (noteId: string) => Promise<void>;
  openQuiz: (quizId: string) => Promise<void>;
  closeContent: () => void;
  recordResult: (quizId: string, score: number, passed: boolean) => void;
}

let packController: AbortController | null = null;
let contentController: AbortController | null = null;

const base = (packId: string) => `/api/academy/packs/${encodeURIComponent(packId)}`;
const errMsg = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);
const isAbort = (err: unknown) => err instanceof Error && err.name === 'AbortError';

export const useAcademyStore = create<AcademyState>((set, get) => ({
  packs: [],
  packsLoading: false,
  packsError: null,

  selectedPackId: null,
  paths: [],
  skills: [],
  packLoading: false,
  packError: null,

  path: null,
  pathLoading: false,

  viewing: { kind: 'none' },
  note: null,
  quiz: null,
  contentLoading: false,
  contentError: null,

  results: readResults(),

  fetchPacks: async () => {
    set({ packsLoading: true, packsError: null });
    try {
      const packs = await getJson<PackSummary[]>('/api/academy/packs');
      set({ packs: Array.isArray(packs) ? packs : [], packsLoading: false });
      if (!get().selectedPackId && packs.length > 0) await get().selectPack(packs[0].id);
    } catch (err) {
      set({ packsLoading: false, packsError: errMsg(err, 'could not load packs') });
    }
  },

  selectPack: async (packId) => {
    packController?.abort();
    packController = new AbortController();
    const { signal } = packController;
    set({
      selectedPackId: packId,
      paths: [],
      skills: [],
      path: null,
      viewing: { kind: 'none' },
      note: null,
      quiz: null,
      packLoading: true,
      packError: null,
    });
    try {
      const [paths, skills] = await Promise.all([
        getJson<PathSummary[]>(`${base(packId)}/paths`, signal),
        getJson<PackSkill[]>(`${base(packId)}/skills`, signal).catch(() => [] as PackSkill[]),
      ]);
      set({ paths, skills, packLoading: false });
    } catch (err) {
      if (isAbort(err)) return;
      set({ packLoading: false, packError: errMsg(err, 'could not load pack') });
    }
  },

  openPath: async (pathId) => {
    const packId = get().selectedPackId;
    if (!packId) return;
    set({ pathLoading: true, packError: null, viewing: { kind: 'none' }, note: null, quiz: null });
    try {
      const path = await getJson<PathDetail>(`${base(packId)}/paths/${encodeURIComponent(pathId)}`);
      set({ path, pathLoading: false });
    } catch (err) {
      set({ pathLoading: false, packError: errMsg(err, 'could not load path') });
    }
  },

  closePath: () => set({ path: null, viewing: { kind: 'none' }, note: null, quiz: null }),

  openNote: async (noteId) => {
    const packId = get().selectedPackId;
    if (!packId) return;
    contentController?.abort();
    contentController = new AbortController();
    const { signal } = contentController;
    set({ viewing: { kind: 'note', id: noteId }, note: null, quiz: null, contentLoading: true, contentError: null });
    try {
      const note = await getJson<NoteDetail>(`${base(packId)}/notes/${encodeURIComponent(noteId)}`, signal);
      set({ note, contentLoading: false });
    } catch (err) {
      if (isAbort(err)) return;
      set({ contentLoading: false, contentError: errMsg(err, 'could not load note') });
    }
  },

  openQuiz: async (quizId) => {
    const packId = get().selectedPackId;
    if (!packId) return;
    contentController?.abort();
    contentController = new AbortController();
    const { signal } = contentController;
    set({ viewing: { kind: 'quiz', id: quizId }, note: null, quiz: null, contentLoading: true, contentError: null });
    try {
      const quiz = await getJson<QuizDetail>(`${base(packId)}/quizzes/${encodeURIComponent(quizId)}`, signal);
      set({ quiz, contentLoading: false });
    } catch (err) {
      if (isAbort(err)) return;
      set({ contentLoading: false, contentError: errMsg(err, 'could not load quiz') });
    }
  },

  closeContent: () => set({ viewing: { kind: 'none' }, note: null, quiz: null, contentError: null }),

  recordResult: (quizId, score, passed) => {
    const packId = get().selectedPackId;
    if (!packId) return;
    const results = { ...get().results, [`${packId}:${quizId}`]: { score, passed, at: new Date().toISOString() } };
    writeResults(results);
    set({ results });
  },
}));
