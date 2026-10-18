import React from 'react';
import { type SectionId, usePlatformStore } from '../store/platformStore';

const SECTION_ICONS: Record<string, string> = {
  overview: '◉',
  lore: '◆',
  graph: '◎',
  git: '⎇',
  sentinel: '◈',
  academy: '▣',
  symphony: '♪',
  docs: '☰',
  ambient: '◌',
  team: '◫',
  tasks: '▤',
  memory: '🗂',
  warpline: '⋈',
  classroom: '⌂',
  brain: '◍',
  meetings: '●',
};

export function SidebarNav() {
  const activeSection = usePlatformStore(s => s.activeSection);
  const availableSections = usePlatformStore(s => s.availableSections);
  const setActiveSection = usePlatformStore(s => s.setActiveSection);
  const toggleTheme = usePlatformStore(s => s.toggleTheme);
  const theme = usePlatformStore(s => s.theme);
  const nextTheme = theme === 'dark' ? 'light' : 'dark';

  return (
    <nav className="sidebar" aria-label="Sections">
      <div className="sidebar__nav">
        {availableSections.map((section) => (
          <button
            key={section}
            className={`sidebar__item ${activeSection === section ? 'sidebar__item--active' : ''}`}
            onClick={() => setActiveSection(section as SectionId)}
            title={section.charAt(0).toUpperCase() + section.slice(1)}
            aria-current={activeSection === section ? 'page' : undefined}
          >
            <span className="sidebar__item-icon" aria-hidden="true">{SECTION_ICONS[section] || '○'}</span>
            <span className="sidebar__item-label">{section}</span>
          </button>
        ))}
      </div>
      <div className="sidebar__bottom">
        <button
          className="sidebar__item"
          onClick={toggleTheme}
          title={`Switch to ${nextTheme} theme`}
          aria-label={`${theme === 'dark' ? 'Dark' : 'Light'} theme on. Switch to ${nextTheme} theme`}
        >
          <span className="sidebar__item-icon" aria-hidden="true">{theme === 'dark' ? '◑' : '◐'}</span>
          {/* Visible label names the current theme, so its state is readable without the tooltip. */}
          <span className="sidebar__item-label">{theme}</span>
        </button>
      </div>
    </nav>
  );
}
