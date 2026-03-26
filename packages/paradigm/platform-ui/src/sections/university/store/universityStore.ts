import { create } from 'zustand';

// ── Types ────────────────────────────────────────────

export interface CourseListing {
  id: string;
  title: string;
  description: string;
  lessonCount: number;
  quizCount: number;
  lessons: Array<{ id: string; title: string }>;
}

export interface PlsatVersion {
  version: string;
  frameworkVersion?: string;
  questionCount: number;
  timeLimit?: number;
  passThreshold?: number;
}

export interface Diploma {
  id: string;
  type: string;
  student?: string;
  earnedAt: string;
  source: string;
  score: number;
  total: number;
  percentage: number;
  passed: boolean;
}

// ── Store ────────────────────────────────────────────

interface UniversityState {
  courses: CourseListing[];
  plsatVersions: PlsatVersion[];
  diplomas: Diploma[];
  coursesLoading: boolean;
  selectedCourse: string | null;

  fetchCourses: () => Promise<void>;
  fetchPlsat: () => Promise<void>;
  fetchDiplomas: () => Promise<void>;
  selectCourse: (id: string | null) => void;
}

let coursesController: AbortController | null = null;

export const useUniversityStore = create<UniversityState>((set, get) => ({
  courses: [],
  plsatVersions: [],
  diplomas: [],
  coursesLoading: false,
  selectedCourse: null,

  fetchCourses: async () => {
    coursesController?.abort();
    coursesController = new AbortController();
    set({ coursesLoading: true });
    try {
      const res = await fetch('/api/university/courses', { signal: coursesController.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      set({ courses: data.courses || [], coursesLoading: false });
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        set({ coursesLoading: false });
      }
    }
  },

  fetchPlsat: async () => {
    try {
      const res = await fetch('/api/university/plsat');
      if (!res.ok) return;
      const data = await res.json();
      set({ plsatVersions: data.versions || [] });
    } catch { /* silent */ }
  },

  fetchDiplomas: async () => {
    try {
      const res = await fetch('/api/university/diplomas');
      if (!res.ok) return;
      const data = await res.json();
      set({ diplomas: data.diplomas || [] });
    } catch { /* silent */ }
  },

  selectCourse: (id) => set({ selectedCourse: id }),
}));
