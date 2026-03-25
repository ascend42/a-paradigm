import React from 'react';
import type { LoreEntry } from '../../store/loreStore';
import { SymbolTag } from '../SymbolTag';

interface DetailBodyProps {
  entry: LoreEntry;
  onSelectEntry: (id: string) => void;
}

export function DetailBody({ entry, onSelectEntry }: DetailBodyProps) {
  return (
    <>
      {/* Summary */}
      <div className="detail-section">
        <h3>Summary</h3>
        <p style={{ fontSize: 13, color: 'var(--p-text-secondary)' }}>{entry.summary}</p>
      </div>

      {/* Body */}
      {entry.body && (
        <div className="detail-section">
          <h3>Body</h3>
          <pre style={{
            fontSize: 12,
            color: 'var(--p-text-secondary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            background: 'var(--p-bg-primary)',
            padding: 12,
            borderRadius: 6,
            border: '1px solid var(--p-border)',
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
                <span key={id} onClick={() => onSelectEntry(id)} style={{
                  cursor: 'pointer',
                  color: 'var(--p-symbol-component)',
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

      {/* Symbols Touched */}
      {entry.symbols_touched?.length > 0 && (
        <div className="detail-section">
          <h3>Symbols Touched</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {entry.symbols_touched.map(s => <SymbolTag key={s} symbol={s} />)}
          </div>
        </div>
      )}

      {/* Symbols Created */}
      {entry.symbols_created && entry.symbols_created.length > 0 && (
        <div className="detail-section">
          <h3>Symbols Created</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {entry.symbols_created.map(s => <SymbolTag key={s} symbol={s} />)}
          </div>
        </div>
      )}

      {/* Errors */}
      {entry.errors_encountered && entry.errors_encountered.length > 0 && (
        <div className="detail-section">
          <h3>Errors Encountered</h3>
          {entry.errors_encountered.map((e, i) => (
            <div key={i} className="detail-error">
              <div style={{ color: 'var(--p-lore-incident)', fontSize: 13 }}>{e.description}</div>
              <div style={{ color: 'var(--p-text-secondary)', fontSize: 12, marginTop: 2 }}>
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
    </>
  );
}
