import React from 'react';
import { type SectionId, usePlatformStore } from '../store/platformStore';

const SECTION_ICONS: Record<string, string> = {
  overview: '◉',
  lore: '◆',
  graph: '◎',
  git: '⎇',
  sentinel: '◈',
  university: '▣',
  symphony: '♪',
  docs: '☰',
  meetings: '●',
};

export function SidebarNav() {
  const activeSection = usePlatformStore(s => s.activeSection);
  const availableSections = usePlatformStore(s => s.availableSections);
  const setActiveSection = usePlatformStore(s => s.setActiveSection);
  const toggleTheme = usePlatformStore(s => s.toggleTheme);
  const theme = usePlatformStore(s => s.theme);

  return (
    <nav className="sidebar">
      <div className="sidebar__nav">
        {availableSections.map((section) => (
          <button
            key={section}
            className={`sidebar__item ${activeSection === section ? 'sidebar__item--active' : ''}`}
            onClick={() => setActiveSection(section as SectionId)}
            title={section.charAt(0).toUpperCase() + section.slice(1)}
          >
            <span className="sidebar__item-icon">{SECTION_ICONS[section] || '○'}</span>
            <span className="sidebar__item-label">{section}</span>
          </button>
        ))}
      </div>
      <div className="sidebar__bottom">
        <button
          className="sidebar__item"
          onClick={toggleTheme}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          <span className="sidebar__item-icon">{theme === 'dark' ? '◑' : '◐'}</span>
          <span className="sidebar__item-label">theme</span>
        </button>
      </div>
    </nav>
  );
}
