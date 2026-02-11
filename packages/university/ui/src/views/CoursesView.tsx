import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useCoursesStore } from '../store/coursesStore';
import { useProgressStore } from '../store/progressStore';
import { ProgressRing } from '../components/ProgressRing';

export function CoursesView() {
  const { courses, isLoading, loadCourses } = useCoursesStore();
  const getCoursePercentage = useProgressStore((s) => s.getCoursePercentage);

  useEffect(() => {
    loadCourses();
  }, [loadCourses]);

  if (isLoading) {
    return <div className="loading">Loading courses...</div>;
  }

  return (
    <div className="home">
      <section className="course-catalog">
        <h2>Course Catalog</h2>
        {courses.map((course) => {
          const pct = getCoursePercentage(course.id, course.lessonCount);
          return (
            <Link to={`/course/${course.id}`} className="course-card" key={course.id}>
              <span className="course-number">{course.id.replace('para-', 'PARA ')}</span>
              <h3>{course.title.replace(/^PARA \d+: /, '')}</h3>
              <p className="course-description">{course.description}</p>
              <div className="course-meta">
                <span>{course.lessonCount} lessons</span>
                <ProgressRing percentage={pct} />
              </div>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
