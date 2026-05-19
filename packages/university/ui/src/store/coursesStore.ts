import { create } from 'zustand';
import type { CourseSummary, Course } from '../types';

interface CoursesState {
  /** Course listing (summaries without full content) */
  courses: CourseSummary[];
  /** Cached full courses keyed by ID */
  courseCache: Record<string, Course>;
  isLoading: boolean;
  error: string | null;

  /** Fetch course listing */
  loadCourses: () => Promise<void>;
  /** Fetch full course with lessons */
  loadCourse: (courseId: string) => Promise<Course | null>;
}

export const useCoursesStore = create<CoursesState>((set, get) => ({
  courses: [],
  courseCache: {},
  isLoading: false,
  error: null,

  loadCourses: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch('/api/courses');
      if (!res.ok) throw new Error('Failed to load courses');
      const data = await res.json();
      set({ courses: data.courses, isLoading: false });
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
    }
  },

  loadCourse: async (courseId: string) => {
    const cached = get().courseCache[courseId];
    if (cached) return cached;

    try {
      const res = await fetch(`/api/courses/${courseId}`);
      if (!res.ok) return null;
      const course: Course = await res.json();
      set((state) => ({
        courseCache: { ...state.courseCache, [courseId]: course },
      }));
      return course;
    } catch {
      return null;
    }
  },
}));

/**
 * Filter courses by section id (v6.5 University Sections).
 *
 * Pure helper — pair with `useCoursesStore((s) => s.courses)` in components:
 *
 *   const courses = useCoursesStore((s) => s.courses);
 *   const sectionCourses = coursesBySection(courses, 'main');
 */
export const coursesBySection = (
  courses: CourseSummary[],
  sectionId: string,
): CourseSummary[] => courses.filter((c) => c.section === sectionId);
