import React, { useEffect } from 'react';
import { useAcademyStore } from './store/academyStore';
import { PackList } from './components/PackList';
import { PathList, PathView } from './components/PathView';
import { NoteView } from './components/NoteView';
import { QuizRunner } from './components/QuizRunner';
import { PackSkills } from './components/PackSkills';

/**
 * The Academy — University content packs in the Platform (7.11.0). Read-only:
 * browse packs → learning paths → steps; notes render as markdown; quizzes are
 * graded in the browser with results kept in localStorage.
 */
export default function AcademySection() {
  const s = useAcademyStore();

  useEffect(() => {
    s.fetchPacks();
  }, []);

  const pack = s.packs.find((p) => p.id === s.selectedPackId) ?? null;
  const muted = { color: 'var(--p-text-muted)', fontSize: 13 } as const;
  const error = { color: 'var(--p-accent-red)', fontSize: 13 } as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--p-border)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--p-text-primary)' }}>Academy</span>
          <span style={{ fontSize: 13, color: 'var(--p-text-muted)' }}>
            {s.packs.length > 0
              ? `${s.packs.length} learning pack${s.packs.length === 1 ? '' : 's'} — pick one to start`
              : 'learning packs for this project'}
          </span>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '240px minmax(0, 1fr) minmax(0, 1.4fr)',
          gap: 24,
          padding: 24,
          overflow: 'auto',
          flex: 1,
        }}
      >
        {/* Packs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16, color: 'var(--p-text-primary)' }}>Packs</h2>
          {s.packsError && <div style={error}>Couldn't load packs: {s.packsError}</div>}
          {s.packsLoading && s.packs.length === 0 && <div style={muted}>Loading packs…</div>}
          {!s.packsLoading && !s.packsError && s.packs.length === 0 && (
            <div style={muted}>
              No learning packs yet. Create one with <code>paradigm university init</code>.
            </div>
          )}
          <PackList packs={s.packs} selectedId={s.selectedPackId} onSelect={s.selectPack} />
        </div>

        {/* Paths / steps */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16, color: 'var(--p-text-primary)' }}>{pack ? pack.title : 'Paths'}</h2>
          {pack?.description && <div style={{ fontSize: 13, color: 'var(--p-text-secondary)' }}>{pack.description}</div>}
          {s.packError && <div style={error}>Something went wrong: {s.packError}</div>}
          {(s.packLoading || s.pathLoading) && <div style={muted}>Loading…</div>}
          {pack && !s.packLoading && !s.path && <PathList paths={s.paths} onOpen={s.openPath} />}
          {pack && s.path && (
            <PathView
              path={s.path}
              packId={pack.id}
              results={s.results}
              onBack={s.closePath}
              onOpenNote={s.openNote}
              onOpenQuiz={s.openQuiz}
            />
          )}
          {pack && !s.packLoading && <PackSkills packId={pack.id} skills={s.skills} />}
        </div>

        {/* Reading pane */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {s.viewing.kind === 'none' && <div style={muted}>Open a step to read it or take its quiz.</div>}
          {s.contentError && <div style={error}>Couldn't open that: {s.contentError}</div>}
          {s.contentLoading && <div style={muted}>Loading…</div>}
          {s.viewing.kind === 'note' && s.note && <NoteView note={s.note} />}
          {s.viewing.kind === 'quiz' && s.quiz && pack && (
            <QuizRunner
              key={s.quiz.id}
              quiz={s.quiz}
              previous={s.results[`${pack.id}:${s.quiz.id}`]}
              onFinish={(score, passed) => s.recordResult(s.quiz!.id, score, passed)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
