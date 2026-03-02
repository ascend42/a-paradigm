import React from 'react';
import type { LoreEntry } from '../store/loreStore';
import { SymbolTag } from './SymbolTag';
import { VerificationBadge } from './VerificationBadge';
import { ReviewStars } from './ReviewStars';
import { useLoreStore } from '../store/loreStore';

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

interface LoreCardProps {
  entry: LoreEntry;
  side?: 'left' | 'right';
}

export function LoreCard({ entry, side = 'right' }: LoreCardProps) {
  const selectEntry = useLoreStore(s => s.selectEntry);
  const isHuman = entry.author.type === 'human';

  const fileCount = (entry.files_created?.length || 0) + (entry.files_modified?.length || 0);
  const loc = (entry.lines_added || 0) + (entry.lines_removed || 0);

  return (
    <div className={`lore-card-row ${side} ${isHuman ? 'human' : 'agent'}`}>
      <div className="lore-card" onClick={() => selectEntry(entry.id)}>
        <div className="lore-card-header">
          <div className="lore-card-author">
            <span className={`author-badge ${entry.author.type}`}>
              {isHuman ? '\uD83D\uDC64' : '\uD83E\uDD16'} {entry.author.id}
            </span>
          </div>
          <span className={`lore-card-type ${entry.type}`}>{entry.type}</span>
        </div>

        <div className="lore-card-title">{entry.title}</div>
        <div className="lore-card-summary">{entry.summary}</div>

        {entry.symbols_touched.length > 0 && (
          <div className="lore-card-symbols">
            {entry.symbols_touched.slice(0, 5).map(s => (
              <SymbolTag key={s} symbol={s} />
            ))}
            {entry.symbols_touched.length > 5 && (
              <span className="symbol-tag component">+{entry.symbols_touched.length - 5}</span>
            )}
          </div>
        )}

        <div className="lore-card-footer">
          <div className="lore-card-stats">
            {fileCount > 0 && <span>{fileCount} files</span>}
            {loc > 0 && <span>{loc} loc</span>}
            {entry.duration_minutes && <span>{entry.duration_minutes}m</span>}
            <VerificationBadge status={entry.verification?.status} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {entry.review && <ReviewStars rating={entry.review.quality} />}
            <span>{formatTime(entry.timestamp)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
