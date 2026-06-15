/**
 * useKeyboardShortcuts — Global keyboard shortcuts for the Platform UI
 *
 * Handles:
 *   Cmd/Ctrl+K  → open command palette
 *   1-9         → switch sections (only when no input is focused)
 *   Escape      → close overlays
 */

import { useEffect } from 'react';
import { usePlatformStore, type SectionId } from '../store/platformStore';

const SECTION_BY_INDEX: Record<string, SectionId> = {
  '1': 'overview',
  '2': 'lore',
  '3': 'graph',
  '4': 'git',
  '5': 'sentinel',
  '6': 'university',
  '7': 'symphony',
  '8': 'docs',
};

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts() {
  const setActiveSection = usePlatformStore(s => s.setActiveSection);
  const availableSections = usePlatformStore(s => s.availableSections);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Cmd/Ctrl+K → open command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('open-command-palette'));
        return;
      }

      // Escape → close overlays
      if (e.key === 'Escape') {
        window.dispatchEvent(new CustomEvent('close-overlay'));
        return;
      }

      // Number keys 1-9 → switch section (only when not typing)
      if (isTypingTarget(document.activeElement)) return;

      const section = SECTION_BY_INDEX[e.key];
      if (section && availableSections.includes(section)) {
        e.preventDefault();
        setActiveSection(section);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [setActiveSection, availableSections]);
}
