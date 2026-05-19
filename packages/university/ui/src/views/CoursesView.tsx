import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useCoursesStore } from '../store/coursesStore';
import { usePackConfigStore } from '../store/packConfigStore';
import { useProgressStore } from '../store/progressStore';
import { ProgressRing } from '../components/ProgressRing';
import { SectionView } from './SectionView';
import type { CourseSummary } from '../types';

/** Flat course card grid — v6.4-identical render path for single-section packs. */
function CourseGrid({ courses }: { courses: CourseSummary[] }) {
  const getCoursePercentage = useProgressStore((s) => s.getCoursePercentage);

  return (
    <section className="course-catalog">
      <h2>Course Catalog</h2>
      {courses.map((course) => {
        const pct = getCoursePercentage(course.id, course.lessonCount);
        return (
          <Link to={`/course/${course.id}`} className="course-card" key={course.id}>
            <h3>{course.title}</h3>
            <p className="course-description">{course.description}</p>
            <div className="course-meta">
              <span>{course.lessonCount} lessons</span>
              <ProgressRing percentage={pct} />
            </div>
          </Link>
        );
      })}
    </section>
  );
}

export function CoursesView() {
  const { courses, isLoading, loadCourses } = useCoursesStore();
  const sections = usePackConfigStore((s) => s.config?.sections ?? []);

  useEffect(() => {
    loadCourses();
  }, [loadCourses]);

  if (isLoading) {
    return <div className="loading">Loading courses...</div>;
  }

  // Atelier-collapse: when there's 0 or 1 section, render flat without any
  // SectionNav / SectionView ceremony. This applies whether the single
  // section is the implicit default (synthesized by the loader) or a
  // first-party pack declaring exactly one section — keeping the v6.4
  // visual contract for both.
  const shouldUseSections = sections.length > 1;

  return (
    <div className="home">
      {shouldUseSections ? <SectionView /> : <CourseGrid courses={courses} />}
    </div>
  );
}
