import React from 'react';
import type { LoreEntry } from '../../store/loreStore';

interface DetailFilesProps {
  entry: LoreEntry;
}

export function DetailFiles({ entry }: DetailFilesProps) {
  if (!entry.files_created?.length && !entry.files_modified?.length) return null;

  return (
    <div className="detail-section">
      <h3>Files ({(entry.files_created?.length || 0) + (entry.files_modified?.length || 0)})</h3>
      <ul className="detail-files">
        {entry.files_created?.map(f => <li key={f} style={{ color: 'var(--p-accent-green)' }}>+ {f}</li>)}
        {entry.files_modified?.map(f => <li key={f} style={{ color: 'var(--p-accent-orange)' }}>~ {f}</li>)}
      </ul>
      {(entry.lines_added || entry.lines_removed) ? (
        <p style={{ fontSize: 12, color: 'var(--p-text-muted)', marginTop: 4 }}>
          <span style={{ color: 'var(--p-accent-green)' }}>+{entry.lines_added || 0}</span>{' '}
          <span style={{ color: 'var(--p-accent-red)' }}>-{entry.lines_removed || 0}</span> lines
        </p>
      ) : null}
    </div>
  );
}
