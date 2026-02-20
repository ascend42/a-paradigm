import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useCoursesStore } from '../store/coursesStore';
import { useProgressStore } from '../store/progressStore';
import { QuestionCard } from '../components/QuestionCard';
import type { Lesson, QuizResult } from '../types';

export function QuizView() {
  const { courseId, lessonId } = useParams<{ courseId: string; lessonId: string }>();
  const loadCourse = useCoursesStore((s) => s.loadCourse);
  const { recordQuiz, completeLesson, getCourseProgress } = useProgressStore();

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [nextLessonId, setNextLessonId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isComplete, setIsComplete] = useState(false);
  const [score, setScore] = useState(0);

  // Check for existing quiz result
  const existingResult = courseId && lessonId
    ? getCourseProgress(courseId).quizResults[lessonId]
    : undefined;

  useEffect(() => {
    if (!courseId) return;
    setIsLoading(true);
    loadCourse(courseId).then((course) => {
      if (course && lessonId) {
        const idx = course.lessons.findIndex((l) => l.id === lessonId);
        setLesson(idx >= 0 ? course.lessons[idx] : null);
        if (idx >= 0 && idx < course.lessons.length - 1) {
          setNextLessonId(course.lessons[idx + 1].id);
        }
      }
      setIsLoading(false);
    });
  }, [courseId, lessonId, loadCourse]);

  // Track answers for all questions
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const handleAnswer = (questionId: string, letter: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: letter }));

    // Check if all answered
    if (lesson) {
      const newAnswers = { ...answers, [questionId]: letter };
      if (Object.keys(newAnswers).length === lesson.quiz.length) {
        // Calculate score
        const correctCount = lesson.quiz.filter(
          (q) => newAnswers[q.id] === q.correct
        ).length;
        setScore(correctCount);
        setIsComplete(true);

        // Record result
        if (courseId && lessonId) {
          const result: QuizResult = {
            courseId,
            lessonId,
            score: correctCount,
            total: lesson.quiz.length,
            answers: newAnswers,
            date: new Date().toISOString(),
          };
          recordQuiz(result);

          // Auto-complete lesson on quiz completion
          completeLesson(courseId, lessonId);
        }
      }
    }
  };

  if (isLoading) {
    return <div className="loading">Preparing your examination...</div>;
  }

  if (!lesson || lesson.quiz.length === 0) {
    return (
      <div className="empty-state">
        <h3>No quiz available</h3>
        <p>This lesson does not have a quiz.</p>
        <Link to={`/course/${courseId}`} className="btn btn-primary mt-lg">
          Back to Course
        </Link>
      </div>
    );
  }

  return (
    <div className="quiz-container">
      <div className="quiz-header">
        <h1>{lesson.title} — Quiz</h1>
        <p className="quiz-progress">
          {isComplete
            ? `Score: ${score}/${lesson.quiz.length} (${Math.round((score / lesson.quiz.length) * 100)}%)`
            : `${Object.keys(answers).length}/${lesson.quiz.length} answered`}
        </p>
        {existingResult && !isComplete && (
          <p className="text-muted mt-sm">
            Previous best: {existingResult.score}/{existingResult.total}
          </p>
        )}
      </div>

      {lesson.quiz.map((q, i) => (
        <QuestionCard
          key={q.id}
          number={i + 1}
          question={q.question}
          choices={q.choices}
          correct={q.correct}
          explanation={q.explanation}
          onAnswered={(letter) => handleAnswer(q.id, letter)}
        />
      ))}

      {isComplete && (
        <div className="text-center mt-xl">
          <p className="mb-lg" style={{ fontSize: '1.25rem', fontFamily: 'var(--font-serif)' }}>
            {score === lesson.quiz.length
              ? 'Perfect score! Exemplary scholarship.'
              : score >= lesson.quiz.length * 0.8
                ? 'Well done, scholar. You have demonstrated understanding.'
                : 'Review the material and try again. Persistence is the path to mastery.'}
          </p>
          {nextLessonId ? (
            <Link to={`/course/${courseId}/${nextLessonId}`} className="btn btn-primary">
              Next Lesson
            </Link>
          ) : (
            <Link to={`/course/${courseId}`} className="btn btn-primary">
              Return to Course
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
