import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useCoursesStore } from '../store/coursesStore';
import { useProgressStore } from '../store/progressStore';
import { usePLSATStore } from '../store/plsatStore';
import { Seal } from '../components/Seal';
import { ProgressRing } from '../components/ProgressRing';

export function HomeView() {
  const { courses, isLoading, loadCourses } = useCoursesStore();
  const getCoursePercentage = useProgressStore((s) => s.getCoursePercentage);
  const hasPassed = usePLSATStore((s) => s.hasPassed);

  useEffect(() => {
    loadCourses();
  }, [loadCourses]);

  if (isLoading) {
    return <div className="loading">Opening the campus gates...</div>;
  }

  return (
    <div className="home">
      <div className="home-hero">
        <Seal size={140} />
        <h1>Paradigm University</h1>
        <p className="motto">Universitas Paradigmatica — Lux in Codice</p>
        <p className="description">
          Master the Paradigm framework through structured courses, hands-on quizzes,
          and the legendary PLSAT certification exam.
        </p>
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
                  <span className="course-number">{course.id.replace('para-', 'PARA ')}</span>
                  <h3>{course.title.replace(/^PARA \d+: /, '')}</h3>
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
          <Link to="/plsat" className="quick-link">
            {hasPassed() ? 'Retake the PLSAT' : 'Take the PLSAT'}
          </Link>
          <Link to="/reference" className="quick-link">
            Reference Library
          </Link>
          <Link to="/certificate" className="quick-link">
            View Certificates
          </Link>
          <Link to="/course/para-101" className="quick-link">
            Start Learning
          </Link>
        </div>
      </section>
    </div>
  );
}
