import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useCoursesStore } from '../store/coursesStore';
import { useProgressStore } from '../store/progressStore';
import { renderMarkdown } from '../utils/renderMarkdown';
import type { Course, Lesson } from '../types';

export function CourseView() {
  const { courseId, lessonId } = useParams<{ courseId: string; lessonId?: string }>();
  const navigate = useNavigate();
  const loadCourse = useCoursesStore((s) => s.loadCourse);
  const [course, setCourse] = useState<Course | null>(null);
  const [activeLesson, setActiveLesson] = useState<Lesson | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const { isLessonCompleted, completeLesson } = useProgressStore();

  useEffect(() => {
    if (!courseId) return;
    setIsLoading(true);
    loadCourse(courseId).then((data) => {
      setCourse(data);
      if (data && data.lessons.length > 0) {
        // Restore lesson from URL param or default to first
        const target = lessonId
          ? data.lessons.find((l) => l.id === lessonId)
          : null;
        if (target) {
          setActiveLesson(target);
        } else {
          // No lessonId in URL — redirect to first lesson
          setActiveLesson(data.lessons[0]);
          navigate(`/course/${courseId}/${data.lessons[0].id}`, { replace: true });
        }
      }
      setIsLoading(false);
    });
  }, [courseId, lessonId, loadCourse, navigate]);

  if (isLoading) {
    return <div className="loading">Opening the textbook...</div>;
  }

  if (!course) {
    return (
      <div className="empty-state">
        <h3>Course not found</h3>
        <p>The requested course does not exist.</p>
        <Link to="/" className="btn btn-primary mt-lg">Return to Campus</Link>
      </div>
    );
  }

  const currentIndex = activeLesson
    ? course.lessons.findIndex((l) => l.id === activeLesson.id)
    : 0;

  const handleMarkComplete = () => {
    if (activeLesson && courseId) {
      completeLesson(courseId, activeLesson.id);
    }
  };

  const goToLesson = (lesson: Lesson, scrollTop = false) => {
    setActiveLesson(lesson);
    navigate(`/course/${courseId}/${lesson.id}`);
    if (scrollTop) {
      window.scrollTo(0, 0);
    }
  };

  const goToNext = () => {
    if (currentIndex < course.lessons.length - 1) {
      goToLesson(course.lessons[currentIndex + 1], true);
    }
  };

  const goToPrev = () => {
    if (currentIndex > 0) {
      goToLesson(course.lessons[currentIndex - 1], true);
    }
  };

  return (
    <div className="course-layout">
      <aside className="course-sidebar">
        <h2>{course.title}</h2>
        <nav className="lesson-nav">
          {course.lessons.map((lesson) => {
            const completed = courseId ? isLessonCompleted(courseId, lesson.id) : false;
            const active = activeLesson?.id === lesson.id;
            let className = 'lesson-nav-item';
            if (active) className += ' active';
            if (completed && !active) className += ' completed';

            return (
              <button
                key={lesson.id}
                className={className}
                onClick={() => goToLesson(lesson)}
              >
                {lesson.title}
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="course-content">
        {activeLesson && (
          <>
            <h1>{activeLesson.title}</h1>

            {activeLesson.keyConcepts.length > 0 && (
              <div className="key-concepts">
                {activeLesson.keyConcepts.map((concept) => (
                  <span key={concept} className="concept-tag">{concept}</span>
                ))}
              </div>
            )}

            <div
              className="lesson-content"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(activeLesson.content) }}
            />

            <div className="lesson-actions">
              <div>
                {currentIndex > 0 && (
                  <button className="btn btn-secondary" onClick={goToPrev}>
                    Previous
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {courseId && !isLessonCompleted(courseId, activeLesson.id) && (
                  <button className="btn btn-secondary" onClick={handleMarkComplete}>
                    Mark Complete
                  </button>
                )}

                {activeLesson.quiz.length > 0 && courseId && (
                  <Link
                    to={`/course/${courseId}/quiz/${activeLesson.id}`}
                    className="btn btn-gold"
                  >
                    Take Quiz
                  </Link>
                )}

                {currentIndex < course.lessons.length - 1 && (
                  <button className="btn btn-primary" onClick={goToNext}>
                    Next Lesson
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
