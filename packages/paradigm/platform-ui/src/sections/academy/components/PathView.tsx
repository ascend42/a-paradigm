import React from 'react';
import type { PathDetail, PathStep, PathSummary, QuizResult } from '../store/academyStore';

const KIND_LABEL: Record<PathStep['kind'], string> = {
  note: 'Read',
  quiz: 'Quiz',
  path: 'Path',
  plsat: 'Exam',
  missing: 'Missing',
};

/** The list of learning paths in a pack. */
export function PathList({ paths, onOpen }: { paths: PathSummary[]; onOpen: (id: string) => void }) {
  if (paths.length === 0) {
    return <div style={{ color: 'var(--p-text-muted)', fontSize: 13 }}>This pack has no learning paths yet.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {paths.map((p) => (
        <button
          key={p.id}
          onClick={() => onOpen(p.id)}
          style={{
            textAlign: 'left',
            background: 'var(--p-bg-secondary)',
            border: '1px solid var(--p-border)',
            borderRadius: 'var(--p-radius)',
            padding: '10px 12px',
            cursor: 'pointer',
            color: 'var(--p-text-primary)',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600 }}>{p.title}</div>
          {p.description && <div style={{ fontSize: 12, color: 'var(--p-text-secondary)', marginTop: 4 }}>{p.description}</div>}
          <div style={{ fontSize: 12, color: 'var(--p-text-muted)', marginTop: 4 }}>
            {p.stepCount} step{p.stepCount === 1 ? '' : 's'}
          </div>
        </button>
      ))}
    </div>
  );
}

/** One path, its steps in order. Notes and quizzes open in the reading pane. */
export function PathView({
  path,
  results,
  packId,
  onBack,
  onOpenNote,
  onOpenQuiz,
}: {
  path: PathDetail;
  results: Record<string, QuizResult>;
  packId: string;
  onBack: () => void;
  onOpenNote: (id: string) => void;
  onOpenQuiz: (id: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button
        onClick={onBack}
        style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: 'var(--p-accent-blue)', cursor: 'pointer', padding: 0, fontSize: 13 }}
      >
        ← All paths
      </button>
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--p-text-primary)' }}>{path.title}</div>
        {path.description && <div style={{ fontSize: 13, color: 'var(--p-text-secondary)', marginTop: 4 }}>{path.description}</div>}
      </div>
      <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {path.steps.map((step, i) => {
          const openable = step.kind === 'note' || step.kind === 'quiz';
          const result = step.kind === 'quiz' ? results[`${packId}:${step.content}`] : undefined;
          return (
            <li key={`${step.content}-${i}`} style={{ fontSize: 13, color: 'var(--p-text-primary)' }}>
              <span style={{ color: 'var(--p-text-muted)', marginRight: 6 }}>{KIND_LABEL[step.kind]}</span>
              {openable ? (
                <button
                  onClick={() => (step.kind === 'quiz' ? onOpenQuiz(step.content) : onOpenNote(step.content))}
                  style={{ background: 'none', border: 'none', color: 'var(--p-accent-blue)', cursor: 'pointer', padding: 0, fontSize: 13, textAlign: 'left' }}
                >
                  {step.title}
                </button>
              ) : (
                <span style={{ color: 'var(--p-text-secondary)' }}>
                  {step.title}
                  {step.kind === 'missing' && ' (not found in this pack)'}
                </span>
              )}
              {!step.required && <span style={{ color: 'var(--p-text-muted)' }}> · optional</span>}
              {result && (
                <span style={{ color: result.passed ? 'var(--p-accent-green)' : 'var(--p-accent-red)' }}>
                  {' '}· {result.passed ? 'passed' : 'not yet'} ({Math.round(result.score * 100)}%)
                </span>
              )}
              {step.note && <div style={{ fontSize: 12, color: 'var(--p-text-muted)' }}>{step.note}</div>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
