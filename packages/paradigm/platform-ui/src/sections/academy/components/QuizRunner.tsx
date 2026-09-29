import React, { useState } from 'react';
import type { QuizDetail, QuizResult } from '../store/academyStore';

/**
 * Runs a quiz entirely in the browser: pick answers, submit, see which were
 * right. The score is weighted and compared to the quiz's pass threshold.
 * Results are saved to this browser only (localStorage) — nothing is sent anywhere.
 */
export function QuizRunner({
  quiz,
  previous,
  onFinish,
}: {
  quiz: QuizDetail;
  previous?: QuizResult;
  onFinish: (score: number, passed: boolean) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const totalWeight = quiz.questions.reduce((sum, q) => sum + (q.weight || 1), 0) || 1;
  const earned = quiz.questions.reduce((sum, q) => sum + (answers[q.id] === q.correct ? q.weight || 1 : 0), 0);
  const score = earned / totalWeight;
  const passed = score >= quiz.passThreshold;
  const allAnswered = quiz.questions.every((q) => answers[q.id]);

  const submit = () => {
    setSubmitted(true);
    onFinish(score, passed);
  };
  const retry = () => {
    setAnswers({});
    setSubmitted(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, color: 'var(--p-text-primary)' }}>{quiz.title}</h2>
        <div style={{ fontSize: 12, color: 'var(--p-text-muted)', marginTop: 4 }}>
          {quiz.questions.length} question{quiz.questions.length === 1 ? '' : 's'} · pass at {Math.round(quiz.passThreshold * 100)}%
          {previous && ` · last try ${Math.round(previous.score * 100)}%`}
        </div>
      </div>

      {quiz.questions.map((q, i) => {
        const picked = answers[q.id];
        return (
          <fieldset key={q.id} style={{ border: '1px solid var(--p-border)', borderRadius: 'var(--p-radius)', padding: 12, margin: 0 }}>
            <legend style={{ fontSize: 13, color: 'var(--p-text-secondary)', padding: '0 4px' }}>Question {i + 1}</legend>
            {q.scenario && <div style={{ fontSize: 13, color: 'var(--p-text-secondary)', marginBottom: 8 }}>{q.scenario}</div>}
            <div style={{ fontSize: 14, color: 'var(--p-text-primary)', marginBottom: 8 }}>{q.question}</div>
            {Object.entries(q.choices).map(([key, text]) => {
              let color = 'var(--p-text-primary)';
              if (submitted && key === q.correct) color = 'var(--p-accent-green)';
              else if (submitted && key === picked) color = 'var(--p-accent-red)';
              return (
                <label key={key} style={{ display: 'flex', gap: 8, fontSize: 13, color, padding: '3px 0', cursor: submitted ? 'default' : 'pointer' }}>
                  <input
                    type="radio"
                    name={q.id}
                    value={key}
                    checked={picked === key}
                    disabled={submitted}
                    onChange={() => setAnswers((a) => ({ ...a, [q.id]: key }))}
                  />
                  <span>
                    <strong>{key}.</strong> {text}
                  </span>
                </label>
              );
            })}
            {submitted && q.explanation && (
              <div style={{ fontSize: 12, color: 'var(--p-text-muted)', marginTop: 8 }}>{q.explanation}</div>
            )}
          </fieldset>
        );
      })}

      {submitted ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: passed ? 'var(--p-accent-green)' : 'var(--p-accent-red)' }}>
            {passed ? 'Nice — you passed!' : 'Not quite yet.'} {Math.round(score * 100)}%
          </span>
          <button onClick={retry} style={buttonStyle}>
            Try again
          </button>
        </div>
      ) : (
        <button onClick={submit} disabled={!allAnswered} style={{ ...buttonStyle, opacity: allAnswered ? 1 : 0.5 }}>
          {allAnswered ? 'Check my answers' : 'Answer every question to check'}
        </button>
      )}
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  background: 'var(--p-bg-tertiary)',
  border: '1px solid var(--p-border)',
  borderRadius: 'var(--p-radius)',
  color: 'var(--p-text-primary)',
  padding: '6px 12px',
  fontSize: 13,
  cursor: 'pointer',
};
