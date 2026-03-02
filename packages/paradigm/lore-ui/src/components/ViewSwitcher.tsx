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
  const theme = useLoreStore(s => s.theme);
  const toggleTheme = useLoreStore(s => s.toggleTheme);

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
      <button
        className="theme-toggle"
        onClick={toggleTheme}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {theme === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19'}
      </button>
    </div>
  );
}
