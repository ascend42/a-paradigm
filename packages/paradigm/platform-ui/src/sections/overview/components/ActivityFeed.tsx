import React from 'react';
import type { ActivityItem } from '../store/overviewStore';

interface ActivityFeedProps {
  items: ActivityItem[];
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60_000) return 'just now';
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
    if (diff < 604800_000) return `${Math.floor(diff / 86400_000)}d ago`;
    return d.toLocaleDateString();
  } catch {
    return '';
  }
}

export function ActivityFeed({ items }: ActivityFeedProps) {
  if (items.length === 0) {
    return <div className="activity-feed__empty">No recent activity</div>;
  }

  return (
    <div className="activity-feed">
      {items.map((item, i) => (
        <div key={`${item.type}-${item.link || i}`} className="activity-feed__item">
          <span className={`activity-feed__icon activity-feed__icon--${item.type}`}>
            {item.type === 'commit' ? '\u25CB' : '\u25C6'}
          </span>
          <div className="activity-feed__content">
            <span className="activity-feed__summary">{item.summary}</span>
            {item.symbol && (
              <span className="activity-feed__symbol">{item.symbol}</span>
            )}
          </div>
          <span className="activity-feed__time">{formatTime(item.timestamp)}</span>
        </div>
      ))}
    </div>
  );
}
