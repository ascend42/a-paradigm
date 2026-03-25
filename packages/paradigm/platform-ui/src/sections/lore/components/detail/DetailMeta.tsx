import React from 'react';
import type { LoreEntry } from '../../store/loreStore';

interface DetailMetaProps {
  entry: LoreEntry;
}

export function DetailMeta({ entry }: DetailMetaProps) {
  return (
    <div className="detail-section">
      <h3>Details</h3>
      <dl className="detail-meta">
        <dt>Author</dt>
        <dd>{'\uD83D\uDC64'} {typeof entry.author === 'string' ? entry.author : 'unknown'}</dd>
        {entry.agent && <>
          <dt>AI Agent</dt>
          <dd>{'\uD83E\uDD16'} {entry.agent.model}{entry.agent.provider ? ` (${entry.agent.provider})` : ''}</dd>
        </>}
        <dt>Time</dt>
        <dd>{new Date(entry.timestamp).toLocaleString()}</dd>
        {entry.duration_minutes && <>
          <dt>Duration</dt>
          <dd>{entry.duration_minutes} minutes</dd>
        </>}
        {entry.commit && <>
          <dt>Commit</dt>
          <dd style={{ fontFamily: 'monospace', fontSize: 12 }}>{entry.commit}</dd>
        </>}
      </dl>

      {/* Confidence & Assessment */}
      {(entry.confidence != null || entry.assessment) && (
        <dl className="detail-meta" style={{ marginTop: 12 }}>
          {entry.confidence != null && <>
            <dt>Confidence</dt>
            <dd>
              <span style={{
                padding: '2px 8px',
                background: 'color-mix(in srgb, var(--p-accent-purple) 15%, transparent)',
                border: '1px solid color-mix(in srgb, var(--p-accent-purple) 30%, transparent)',
                borderRadius: 10,
                fontSize: 12,
                color: 'var(--p-accent-purple)',
              }}>{(entry.confidence * 100).toFixed(0)}%</span>
            </dd>
          </>}
          {entry.assessment && <>
            <dt>Verdict</dt>
            <dd>
              <span style={{
                padding: '2px 8px',
                background: entry.assessment.verdict === 'correct' ? 'color-mix(in srgb, var(--p-accent-green) 15%, transparent)'
                  : entry.assessment.verdict === 'partial' ? 'color-mix(in srgb, var(--p-accent-orange) 15%, transparent)'
                  : 'color-mix(in srgb, var(--p-accent-red) 15%, transparent)',
                border: `1px solid ${entry.assessment.verdict === 'correct' ? 'color-mix(in srgb, var(--p-accent-green) 30%, transparent)'
                  : entry.assessment.verdict === 'partial' ? 'color-mix(in srgb, var(--p-accent-orange) 30%, transparent)'
                  : 'color-mix(in srgb, var(--p-accent-red) 30%, transparent)'}`,
                borderRadius: 10,
                fontSize: 12,
                color: entry.assessment.verdict === 'correct' ? 'var(--p-accent-green)'
                  : entry.assessment.verdict === 'partial' ? 'var(--p-accent-orange)'
                  : 'var(--p-accent-red)',
              }}>{entry.assessment.verdict}</span>
            </dd>
            <dt>Assessed by</dt>
            <dd>{entry.assessment.assessed_by}</dd>
            <dt>Assessed at</dt>
            <dd>{new Date(entry.assessment.assessed_at).toLocaleString()}</dd>
            {entry.assessment.notes && <>
              <dt>Notes</dt>
              <dd>{entry.assessment.notes}</dd>
            </>}
          </>}
          {entry.assessment_delta != null && <>
            <dt>Delta</dt>
            <dd style={{
              color: Math.abs(entry.assessment_delta) <= 0.1 ? 'var(--p-accent-green)'
                : Math.abs(entry.assessment_delta) <= 0.3 ? 'var(--p-accent-orange)'
                : 'var(--p-accent-red)',
            }}>
              {entry.assessment_delta > 0 ? '+' : ''}{entry.assessment_delta.toFixed(2)}
              {' '}
              <span style={{ fontSize: 11, color: 'var(--p-text-muted)' }}>
                ({entry.assessment_delta > 0.1 ? 'under-confident' : entry.assessment_delta < -0.1 ? 'over-confident' : 'well-calibrated'})
              </span>
            </dd>
          </>}
        </dl>
      )}

      {/* Tags */}
      {entry.tags && entry.tags.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {entry.tags.map(t => {
              const isArc = t.startsWith('arc:');
              return (
                <span key={t} style={{
                  padding: '2px 8px',
                  background: isArc ? 'color-mix(in srgb, var(--p-lore-milestone) 15%, transparent)' : 'var(--p-bg-primary)',
                  border: `1px solid ${isArc ? 'var(--p-lore-milestone)' : 'var(--p-border)'}`,
                  borderRadius: 12,
                  fontSize: 11,
                  color: isArc ? 'var(--p-lore-milestone)' : 'var(--p-text-secondary)',
                }}>{isArc ? '\u21BB ' : ''}{t}</span>
              );
            })}
          </div>
        </div>
      )}

      {/* Git Context */}
      {entry.git_context && (
        <dl className="detail-meta" style={{ marginTop: 12 }}>
          <dt>Commit</dt>
          <dd style={{ fontFamily: 'monospace', fontSize: 12 }}>{entry.git_context.ref.slice(0, 8)}</dd>
          <dt>Branch</dt>
          <dd>{entry.git_context.branch}</dd>
          <dt>Working tree</dt>
          <dd>{entry.git_context.dirty ? 'Dirty (uncommitted changes)' : 'Clean'}</dd>
        </dl>
      )}

      {/* Extra Metadata */}
      {entry.meta && Object.keys(entry.meta).length > 0 && (
        <dl className="detail-meta" style={{ marginTop: 12 }}>
          {Object.entries(entry.meta).map(([k, v]) => (
            <React.Fragment key={k}>
              <dt>{k}</dt>
              <dd>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
    </div>
  );
}
