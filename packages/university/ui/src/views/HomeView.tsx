import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useCoursesStore } from '../store/coursesStore';
import { useProgressStore } from '../store/progressStore';
import { usePLSATStore } from '../store/plsatStore';
import { BrandLogo } from '../components/BrandLogo';
import { ProgressRing } from '../components/ProgressRing';
import { usePackConfigStore } from '../store/packConfigStore';

export function HomeView() {
  const { courses, isLoading, loadCourses } = useCoursesStore();
  const getCoursePercentage = useProgressStore((s) => s.getCoursePercentage);
  const hasPassed = usePLSATStore((s) => s.hasPassed);
  const config = usePackConfigStore((s) => s.config);

  useEffect(() => {
    loadCourses();
  }, [loadCourses]);

  if (isLoading) {
    return <div className="loading">Opening the campus gates...</div>;
  }

  const name = config?.branding.name ?? 'Paradigm University';
  const tagline = config?.branding.tagline ?? 'Lux in Codice';
  const tabs = config?.branding.tabs ?? ['campus', 'courses', 'plsat', 'library', 'certificates'];
  const startCoursePath = config?.branding.startCourse
    ? `/course/${config.branding.startCourse}`
    : '/courses';
  const isParadigm = !config || config.mode === 'paradigm';

  return (
    <div className="home">
      <div className="home-hero">
        <BrandLogo size={140} />
        <h1>{name}</h1>
        <p className="motto">{isParadigm ? `Universitas Paradigmatica — ${tagline}` : tagline}</p>
        {isParadigm && (
          <p className="description">
            Master the Paradigm framework through structured courses, hands-on quizzes,
            and the legendary PLSAT certification exam.
          </p>
        )}
      </div>

      <div className="gold-divider" />

      <section className="course-catalog">
        <h2>Course Catalog</h2>
        {courses.map((course) => {
          const pct = getCoursePercentage(course.id, course.lessonCount);
          return (
            <Link to={`/course/${course.id}`} className="course-card" key={course.id}>
              <div className="course-card-header">
                <div className="course-card-title">
                  <h3>{course.title}</h3>
                </div>
                <ProgressRing percentage={pct} />
              </div>
              <p className="course-description">{course.description}</p>
              <div className="course-topics">
                {course.lessons.map((lesson) => (
                  <span key={lesson.id} className="course-topic-tag">{lesson.title}</span>
                ))}
              </div>
              <div className="course-meta">
                <span>{course.lessonCount} lessons</span>
                <span className="course-meta-cta">Start course &rarr;</span>
              </div>
            </Link>
          );
        })}
      </section>

      <div className="gold-divider" />

      <section>
        <h2 className="mb-lg">Quick Links</h2>
        <div className="quick-links">
          {tabs.includes('plsat') && (
            <Link to="/plsat" className="quick-link">
              {hasPassed() ? 'Retake the PLSAT' : 'Take the PLSAT'}
            </Link>
          )}
          {tabs.includes('library') && (
            <Link to="/reference" className="quick-link">
              Reference Library
            </Link>
          )}
          {tabs.includes('certificates') && (
            <Link to="/certificate" className="quick-link">
              View Certificates
            </Link>
          )}
          {tabs.includes('courses') && (
            <Link to={startCoursePath} className="quick-link">
              Start Learning
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}
