import { create } from 'zustand';
import type { CourseProgress, QuizResult } from '../types';

const STORAGE_KEY = 'paradigm-university-progress';

interface ProgressState {
  /** Per-course progress */
  progress: Record<string, CourseProgress>;

  /** Mark a lesson as completed */
  completeLesson: (courseId: string, lessonId: string) => void;
  /** Record a quiz result */
  recordQuiz: (result: QuizResult) => void;
  /** Get progress for a course */
  getCourseProgress: (courseId: string) => CourseProgress;
  /** Check if a lesson is completed */
  isLessonCompleted: (courseId: string, lessonId: string) => boolean;
  /** Get completion percentage for a course */
  getCoursePercentage: (courseId: string, totalLessons: number) => number;
  /** Reset all progress */
  resetProgress: () => void;
}

function loadFromStorage(): Record<string, CourseProgress> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveToStorage(progress: Record<string, CourseProgress>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // LocalStorage full or unavailable
  }
}

export const useProgressStore = create<ProgressState>((set, get) => ({
  progress: loadFromStorage(),

  completeLesson: (courseId, lessonId) => {
    set((state) => {
      const existing = state.progress[courseId] || {
        courseId,
        completedLessons: [],
        quizResults: {},
      };

      if (existing.completedLessons.includes(lessonId)) return state;

      const updated = {
        ...state.progress,
        [courseId]: {
          ...existing,
          completedLessons: [...existing.completedLessons, lessonId],
        },
      };
      saveToStorage(updated);
      return { progress: updated };
    });
  },

  recordQuiz: (result) => {
    set((state) => {
      const existing = state.progress[result.courseId] || {
        courseId: result.courseId,
        completedLessons: [],
        quizResults: {},
      };

      const updated = {
        ...state.progress,
        [result.courseId]: {
          ...existing,
          quizResults: {
            ...existing.quizResults,
            [result.lessonId]: result,
          },
        },
      };
      saveToStorage(updated);
      return { progress: updated };
    });
  },

  getCourseProgress: (courseId) => {
    return get().progress[courseId] || {
      courseId,
      completedLessons: [],
      quizResults: {},
    };
  },

  isLessonCompleted: (courseId, lessonId) => {
    const cp = get().progress[courseId];
    return cp ? cp.completedLessons.includes(lessonId) : false;
  },

  getCoursePercentage: (courseId, totalLessons) => {
    if (totalLessons === 0) return 0;
    const cp = get().progress[courseId];
    if (!cp) return 0;
    return Math.round((cp.completedLessons.length / totalLessons) * 100);
  },

  resetProgress: () => {
    saveToStorage({});
    set({ progress: {} });
  },
}));
