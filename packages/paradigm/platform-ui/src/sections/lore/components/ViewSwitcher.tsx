import React from 'react';
import { useLoreStore, type ViewMode } from '../store/loreStore';

const VIEWS: { mode: ViewMode; label: string }[] = [
  { mode: 'timeline', label: 'Timeline' },
  { mode: 'session', label: 'Sessions' },
  { mode: 'symbol', label: 'Symbol' },
  { mode: 'author', label: 'Author' },
];

export function ViewSwitcher() {
  const view = useLoreStore(s => s.view);
  const setView = useLoreStore(s => s.setView);

  return (
    <div className="view-switcher-row">
      <div className="view-switcher">
        {VIEWS.map(v => (
          <button
            key={v.mode}
            className={`view-tab ${view === v.mode ? 'active' : ''}`}
            onClick={() => setView(v.mode)}
          >
            {v.label}
          </button>
        ))}
      </div>
    </div>
  );
}
