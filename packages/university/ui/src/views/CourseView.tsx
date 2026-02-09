import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useCoursesStore } from '../store/coursesStore';
import { useProgressStore } from '../store/progressStore';
import type { Course, Lesson } from '../types';

/** Minimal markdown-to-HTML renderer (handles ##, **, `, ```, -, |) */
function renderMarkdown(md: string): string {
  let html = md
    // Code blocks (``` ... ```)
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Headers
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // Blockquotes
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Wrap consecutive <li> in <ul>
    .replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
    // Paragraphs (lines not already wrapped)
    .replace(/^(?!<[huplbo])((?!<).+)$/gm, '<p>$1</p>')
    // Clean up extra newlines
    .replace(/\n{2,}/g, '\n');

  return html;
}

export function CourseView() {
  const { courseId } = useParams<{ courseId: string }>();
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
        setActiveLesson(data.lessons[0]);
      }
      setIsLoading(false);
    });
  }, [courseId, loadCourse]);

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

  const goToNext = () => {
    if (currentIndex < course.lessons.length - 1) {
      setActiveLesson(course.lessons[currentIndex + 1]);
      window.scrollTo(0, 0);
    }
  };

  const goToPrev = () => {
    if (currentIndex > 0) {
      setActiveLesson(course.lessons[currentIndex - 1]);
      window.scrollTo(0, 0);
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
                onClick={() => {
                  setActiveLesson(lesson);
                  window.scrollTo(0, 0);
                }}
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
