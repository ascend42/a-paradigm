import React from 'react';
import type { LoreEntry } from '../../store/loreStore';

interface DetailDecisionsProps {
  entry: LoreEntry;
}

export function DetailDecisions({ entry }: DetailDecisionsProps) {
  if (!entry.decisions || entry.decisions.length === 0) return null;

  return (
    <div className="detail-section">
      <h3>Decisions</h3>
      {entry.decisions.map(d => (
        <div key={d.id} className="detail-decision">
          <div className="decision-text">{d.decision}</div>
          <div className="decision-rationale">{d.rationale}</div>
        </div>
      ))}
    </div>
  );
}
