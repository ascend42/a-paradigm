import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useCoursesStore } from '../store/coursesStore';
import { useProgressStore } from '../store/progressStore';
import type { Course, Lesson } from '../types';

/** Apply inline markdown (bold, italic, code) to text */
function inlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

/** Parse a markdown table block into HTML */
function parseTable(block: string): string {
  const lines = block.trim().split('\n');
  if (lines.length < 2) return block;

  const parseRow = (line: string) =>
    line.split('|').map(c => c.trim()).filter(c => c.length > 0);

  const headers = parseRow(lines[0]);
  // lines[1] is the separator (|---|---|)
  const rows = lines.slice(2).map(parseRow);

  let html = '<table><thead><tr>';
  for (const h of headers) html += `<th>${inlineMarkdown(h)}</th>`;
  html += '</tr></thead><tbody>';
  for (const row of rows) {
    html += '<tr>';
    for (const cell of row) html += `<td>${inlineMarkdown(cell)}</td>`;
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

/** Minimal markdown-to-HTML renderer (handles ##, **, `, ```, -, |, tables) */
function renderMarkdown(md: string): string {
  // Extract code blocks first to protect them from paragraph processing
  const preserved: string[] = [];
  let html = md.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    const idx = preserved.length;
    preserved.push(`<pre><code>${code}</code></pre>`);
    return `\x00BLOCK${idx}\x00`;
  });

  // Extract tables (consecutive lines starting with |)
  html = html.replace(/((?:^\|.+\|\n?)+)/gm, (tableBlock) => {
    const lines = tableBlock.trim().split('\n');
    // Need at least header + separator + 1 row, and line 2 must be separator
    if (lines.length >= 3 && /^\|[\s-:|]+\|$/.test(lines[1])) {
      const idx = preserved.length;
      preserved.push(parseTable(tableBlock));
      return `\x00BLOCK${idx}\x00`;
    }
    return tableBlock;
  });

  html = html
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
    // Ordered lists (1. item, 2. item)
    .replace(/^\d+\.\s+(.+)$/gm, '<oli>$1</oli>')
    // Wrap consecutive <oli> in <ol>
    .replace(/((?:<oli>.*<\/oli>\n?)+)/g, (m) => '<ol>' + m.replace(/<\/?oli>/g, (t) => t.replace('oli', 'li')) + '</ol>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Wrap consecutive <li> in <ul>
    .replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
    // Paragraphs (lines not already wrapped)
    .replace(/^(?!<[huplbo\x00])((?!<).+)$/gm, '<p>$1</p>')
    // Clean up extra newlines
    .replace(/\n{2,}/g, '\n');

  // Restore preserved blocks (code + tables)
  html = html.replace(/\x00BLOCK(\d+)\x00/g, (_m, idx) => preserved[Number(idx)]);

  return html;
}

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
