import React, { useEffect, useState } from 'react';
import { useLoreStore, type LoreEntry } from '../store/loreStore';
import { SymbolTag } from './SymbolTag';
import { VerificationBadge } from './VerificationBadge';
import { ReviewStars } from './ReviewStars';

export function DetailPanel() {
  const selectedId = useLoreStore(s => s.selectedEntryId);
  const selectEntry = useLoreStore(s => s.selectEntry);
  const [entry, setEntry] = useState<LoreEntry | null>(null);

  useEffect(() => {
    if (!selectedId) {
      setEntry(null);
      return;
    }
    fetch(`/api/lore/${selectedId}`)
      .then(r => r.json())
      .then(setEntry)
      .catch(() => setEntry(null));
  }, [selectedId]);

  if (!selectedId || !entry) return null;

  return (
    <div className="detail-overlay">
      <div className="detail-backdrop" onClick={() => selectEntry(null)} />
      <div className="detail-panel">
        <div className="detail-header">
          <div>
            <div className="lore-card-title" style={{ fontSize: 16 }}>{entry.title}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center' }}>
              <span className={`lore-card-type ${entry.type}`}>{entry.type}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{entry.id}</span>
            </div>
          </div>
          <button className="detail-close" onClick={() => selectEntry(null)}>{'\u2715'}</button>
        </div>

        <div className="detail-body">
          {/* Meta */}
          <div className="detail-section">
            <h3>Details</h3>
            <dl className="detail-meta">
              <dt>Author</dt>
              <dd>{'\uD83D\uDC64'} {entry.author}</dd>
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
          </div>

          {/* Summary */}
          <div className="detail-section">
            <h3>Summary</h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{entry.summary}</p>
          </div>

          {/* Body */}
          {entry.body && (
            <div className="detail-section">
              <h3>Body</h3>
              <pre style={{
                fontSize: 12,
                color: 'var(--text-secondary)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                background: 'var(--bg-primary)',
                padding: 12,
                borderRadius: 6,
                border: '1px solid var(--border)',
                maxHeight: 300,
                overflowY: 'auto',
              }}>{entry.body}</pre>
            </div>
          )}

          {/* Linked Entries */}
          {(entry.linked_lore?.length || entry.linked_tasks?.length || entry.linked_commits?.length) ? (
            <div className="detail-section">
              <h3>Linked</h3>
              <dl className="detail-meta">
                {entry.linked_lore && entry.linked_lore.length > 0 && <>
                  <dt>Lore</dt>
                  <dd>{entry.linked_lore.map(id => (
                    <span key={id} onClick={() => selectEntry(id)} style={{
                      cursor: 'pointer',
                      color: 'var(--color-component)',
                      textDecoration: 'underline',
                      marginRight: 8,
                      fontSize: 12,
                    }}>{id}</span>
                  ))}</dd>
                </>}
                {entry.linked_tasks && entry.linked_tasks.length > 0 && <>
                  <dt>Tasks</dt>
                  <dd>{entry.linked_tasks.map(id => (
                    <span key={id} style={{ fontFamily: 'monospace', fontSize: 12, marginRight: 8 }}>{id}</span>
                  ))}</dd>
                </>}
                {entry.linked_commits && entry.linked_commits.length > 0 && <>
                  <dt>Commits</dt>
                  <dd>{entry.linked_commits.map(sha => (
                    <span key={sha} style={{ fontFamily: 'monospace', fontSize: 12, marginRight: 8 }}>{sha.slice(0, 8)}</span>
                  ))}</dd>
                </>}
              </dl>
            </div>
          ) : null}

          {/* Symbols */}
          {entry.symbols_touched?.length > 0 && (
            <div className="detail-section">
              <h3>Symbols Touched</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {entry.symbols_touched.map(s => <SymbolTag key={s} symbol={s} />)}
              </div>
            </div>
          )}

          {entry.symbols_created && entry.symbols_created.length > 0 && (
            <div className="detail-section">
              <h3>Symbols Created</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {entry.symbols_created.map(s => <SymbolTag key={s} symbol={s} />)}
              </div>
            </div>
          )}

          {/* Files */}
          {(entry.files_created?.length || entry.files_modified?.length) ? (
            <div className="detail-section">
              <h3>Files ({(entry.files_created?.length || 0) + (entry.files_modified?.length || 0)})</h3>
              <ul className="detail-files">
                {entry.files_created?.map(f => <li key={f} style={{ color: '#34d399' }}>+ {f}</li>)}
                {entry.files_modified?.map(f => <li key={f} style={{ color: '#fbbf24' }}>~ {f}</li>)}
              </ul>
              {(entry.lines_added || entry.lines_removed) ? (
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  <span style={{ color: '#34d399' }}>+{entry.lines_added || 0}</span>{' '}
                  <span style={{ color: '#f87171' }}>-{entry.lines_removed || 0}</span> lines
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Decisions */}
          {entry.decisions && entry.decisions.length > 0 && (
            <div className="detail-section">
              <h3>Decisions</h3>
              {entry.decisions.map(d => (
                <div key={d.id} className="detail-decision">
                  <div className="decision-text">{d.decision}</div>
                  <div className="decision-rationale">{d.rationale}</div>
                </div>
              ))}
            </div>
          )}

          {/* Errors */}
          {entry.errors_encountered && entry.errors_encountered.length > 0 && (
            <div className="detail-section">
              <h3>Errors Encountered</h3>
              {entry.errors_encountered.map((e, i) => (
                <div key={i} className="detail-error">
                  <div style={{ color: 'var(--color-incident)', fontSize: 13 }}>{e.description}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 2 }}>
                    {'\u2192'} {e.resolution}{e.time_to_fix ? ` (${e.time_to_fix})` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Learnings */}
          {entry.learnings && entry.learnings.length > 0 && (
            <div className="detail-section">
              <h3>Learnings</h3>
              {entry.learnings.map((l, i) => (
                <div key={i} className="detail-learning">{l}</div>
              ))}
            </div>
          )}

          {/* Verification */}
          {entry.verification && (
            <div className="detail-section">
              <h3>Verification</h3>
              <VerificationBadge status={entry.verification.status} />
              {entry.verification.details && (
                <dl className="detail-meta" style={{ marginTop: 8 }}>
                  {Object.entries(entry.verification.details).map(([k, v]) => (
                    <React.Fragment key={k}>
                      <dt>{k}</dt>
                      <dd style={{ color: v === 'pass' ? '#34d399' : '#f87171' }}>{v}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              )}
            </div>
          )}

          {/* Review */}
          {entry.review ? (
            <div className="detail-section">
              <h3>Review</h3>
              <dl className="detail-meta">
                <dt>Reviewer</dt>
                <dd>{entry.review.reviewer}</dd>
                <dt>Completeness</dt>
                <dd><ReviewStars rating={entry.review.completeness} /></dd>
                <dt>Quality</dt>
                <dd><ReviewStars rating={entry.review.quality} /></dd>
                {entry.review.notes && <>
                  <dt>Notes</dt>
                  <dd>{entry.review.notes}</dd>
                </>}
              </dl>
            </div>
          ) : (
            <div className="detail-section">
              <h3>Review</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                No review yet. Run <code style={{ background: 'var(--bg-card)', padding: '2px 4px', borderRadius: 3 }}>paradigm lore review {entry.id}</code>
              </p>
            </div>
          )}

          {/* Git Context */}
          {entry.git_context && (
            <div className="detail-section">
              <h3>Git Context</h3>
              <dl className="detail-meta">
                <dt>Commit</dt>
                <dd style={{ fontFamily: 'monospace', fontSize: 12 }}>{entry.git_context.ref.slice(0, 8)}</dd>
                <dt>Branch</dt>
                <dd>{entry.git_context.branch}</dd>
                <dt>Working tree</dt>
                <dd>{entry.git_context.dirty ? 'Dirty (uncommitted changes)' : 'Clean'}</dd>
              </dl>
            </div>
          )}

          {/* Meta */}
          {entry.meta && Object.keys(entry.meta).length > 0 && (
            <div className="detail-section">
              <h3>Metadata</h3>
              <dl className="detail-meta">
                {Object.entries(entry.meta).map(([k, v]) => (
                  <React.Fragment key={k}>
                    <dt>{k}</dt>
                    <dd>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </div>
          )}

          {/* Tags */}
          {entry.tags && entry.tags.length > 0 && (
            <div className="detail-section">
              <h3>Tags</h3>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {entry.tags.map(t => {
                  const isArc = t.startsWith('arc:');
                  return (
                    <span key={t} style={{
                      padding: '2px 8px',
                      background: isArc ? 'var(--color-flow-bg, rgba(96, 165, 250, 0.15))' : 'var(--bg-primary)',
                      border: `1px solid ${isArc ? 'var(--color-flow, #60a5fa)' : 'var(--border)'}`,
                      borderRadius: 12,
                      fontSize: 11,
                      color: isArc ? 'var(--color-flow, #60a5fa)' : 'var(--text-secondary)',
                    }}>{isArc ? '\u21BB ' : ''}{t}</span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
