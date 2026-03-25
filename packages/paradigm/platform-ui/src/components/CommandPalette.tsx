/**
 * CommandPalette — Cmd+K quick-navigation overlay
 *
 * Opens via the 'open-command-palette' custom event.
 * Provides filtered section navigation with keyboard support.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { usePlatformStore, type SectionId } from '../store/platformStore';

const SECTION_ICONS: Record<string, string> = {
  overview: '\u25C9',
  lore: '\u25C6',
  graph: '\u25CE',
  canvas: '\u25A6',
  git: '\u238B',
  sentinel: '\u25C8',
  university: '\u25A3',
  symphony: '\u266A',
  docs: '\u2630',
  ambient: '\u25CC',
  team: '\u25EB',
};

const SECTION_SHORTCUT: Record<string, string> = {
  overview: '1',
  lore: '2',
  graph: '3',
  canvas: '4',
  git: '5',
  sentinel: '6',
  university: '7',
  symphony: '8',
  docs: '9',
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const availableSections = usePlatformStore(s => s.availableSections);
  const setActiveSection = usePlatformStore(s => s.setActiveSection);

  const filteredSections = availableSections.filter(
    (s) => s.toLowerCase().includes(query.toLowerCase()),
  );

  const openPalette = useCallback(() => {
    setOpen(true);
    setQuery('');
    setActiveIndex(0);
  }, []);

  const closePalette = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
  }, []);

  const selectSection = useCallback(
    (section: SectionId) => {
      setActiveSection(section);
      closePalette();
    },
    [setActiveSection, closePalette],
  );

  // Listen for open/close custom events
  useEffect(() => {
    function handleOpen() {
      openPalette();
    }

    function handleClose() {
      if (open) closePalette();
    }

    window.addEventListener('open-command-palette', handleOpen);
    window.addEventListener('close-overlay', handleClose);
    return () => {
      window.removeEventListener('open-command-palette', handleOpen);
      window.removeEventListener('close-overlay', handleClose);
    };
  }, [open, openPalette, closePalette]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      // Small delay to let the DOM render
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Reset active index when query changes
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % filteredSections.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + filteredSections.length) % filteredSections.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const section = filteredSections[activeIndex];
      if (section) selectSection(section);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
    }
  }

  if (!open) return null;

  return (
    <div className="command-palette-backdrop" onClick={closePalette}>
      <div
        className="command-palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="command-palette__input-wrapper">
          <input
            ref={inputRef}
            className="command-palette__input"
            type="text"
            placeholder="Go to section..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {filteredSections.length > 0 ? (
          <ul className="command-palette__list">
            {filteredSections.map((section, i) => (
              <li
                key={section}
                className={`command-palette__item ${i === activeIndex ? 'command-palette__item--active' : ''}`}
                onClick={() => selectSection(section)}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <span className="command-palette__item-icon">
                  {SECTION_ICONS[section] || '\u25CB'}
                </span>
                <span className="command-palette__item-label">{section}</span>
                {SECTION_SHORTCUT[section] && (
                  <span className="command-palette__item-shortcut">
                    {SECTION_SHORTCUT[section]}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="command-palette__empty">No matching sections</div>
        )}
      </div>
    </div>
  );
}
