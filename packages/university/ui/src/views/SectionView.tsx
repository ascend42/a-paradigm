import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useCoursesStore, coursesBySection } from '../store/coursesStore';
import { usePackConfigStore } from '../store/packConfigStore';
import { useProgressStore } from '../store/progressStore';
import { SectionNav } from '../components/SectionNav';
import { ProgressRing } from '../components/ProgressRing';
import type { CourseSummary, Section, SectionStyle } from '../types';

// Module-level set so the "not yet implemented" warning fires once per style
// across renders/remounts within a session.
const warnedStyles = new Set<SectionStyle>();

function warnUnimplementedStyle(style: SectionStyle) {
  if (warnedStyles.has(style)) return;
  warnedStyles.add(style);
  // eslint-disable-next-line no-console
  console.warn(
    `[university] section style "${style}" not yet implemented; rendering as track`,
  );
}

/** Course card grid renderer — the "track" style. */
function CourseGrid({ courses }: { courses: CourseSummary[] }) {
  const getCoursePercentage = useProgressStore((s) => s.getCoursePercentage);

  return (
    <section className="course-catalog">
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

/**
 * v6.5 SectionView — style dispatcher for University Sections.
 *
 * Reads sections from pack config and courses from the courses store, holds
 * local activeSectionId state (default: the `default: true` section, else
 * first by `order`), and dispatches on `activeSection.style`.
 *
 * Only `track` has a real renderer at v6.5. `index | chronological | featured`
 * (and any unknown style) fall back to track with a one-time console warning.
 */
export function SectionView() {
  const sections = usePackConfigStore((s) => s.config?.sections ?? []);
  const courses = useCoursesStore((s) => s.courses);

  const sortedSections = useMemo(
    () => [...sections].sort((a, b) => a.order - b.order),
    [sections],
  );

  const defaultSectionId = useMemo(() => {
    const def = sortedSections.find((s) => s.default === true);
    return def?.id ?? sortedSections[0]?.id ?? '';
  }, [sortedSections]);

  const [activeSectionId, setActiveSectionId] = useState<string>(defaultSectionId);

  const activeSection: Section | undefined =
    sortedSections.find((s) => s.id === activeSectionId) ?? sortedSections[0];

  if (!activeSection) {
    // No sections at all — render flat grid as a safe fallback.
    return <CourseGrid courses={courses} />;
  }

  const visible = coursesBySection(courses, activeSection.id);

  // Dispatch on style. Only 'track' is a real renderer at v6.5.
  if (activeSection.style !== 'track') {
    warnUnimplementedStyle(activeSection.style);
  }

  return (
    <div className="section-view">
      <SectionNav
        sections={sortedSections}
        activeId={activeSection.id}
        onSelect={setActiveSectionId}
      />
      <CourseGrid courses={visible} />
    </div>
  );
}
