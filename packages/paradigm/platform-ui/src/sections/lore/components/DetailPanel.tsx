import React, { useEffect, useState } from 'react';
import { useLoreStore, type LoreEntry } from '../store/loreStore';
import { DetailMeta } from './detail/DetailMeta';
import { DetailBody } from './detail/DetailBody';
import { DetailDecisions } from './detail/DetailDecisions';
import { DetailReview } from './detail/DetailReview';
import { DetailFiles } from './detail/DetailFiles';

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
              <span style={{ color: 'var(--p-text-muted)', fontSize: 12 }}>{entry.id}</span>
            </div>
          </div>
          <button className="detail-close" onClick={() => selectEntry(null)}>{'\u2715'}</button>
        </div>

        <div className="detail-body">
          <DetailMeta entry={entry} />
          <DetailBody entry={entry} onSelectEntry={selectEntry} />
          <DetailFiles entry={entry} />
          <DetailDecisions entry={entry} />
          <DetailReview entry={entry} />
        </div>
      </div>
    </div>
  );
}
