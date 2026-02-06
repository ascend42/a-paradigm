/**
 * Help Panel - Toggleable display of hotkeys and navigation tips
 */

import { useState, useEffect, useCallback } from 'react';

interface Hotkey {
  key: string;
  description: string;
  category: 'navigation' | 'interaction' | 'general';
}

const HOTKEYS: Hotkey[] = [
  { key: 'Click + Drag', description: 'Pan the canvas', category: 'navigation' },
  { key: 'Wheel', description: 'Zoom in/out', category: 'navigation' },
  { key: 'Click Node', description: 'Select a node', category: 'interaction' },
  { key: 'Drag Node', description: 'Move a node', category: 'interaction' },
  { key: '/', description: 'Focus command input', category: 'general' },
  { key: '?', description: 'Toggle this help panel', category: 'general' },
  { key: 'Esc', description: 'Deselect / Close panels', category: 'general' },
];

const CATEGORY_LABELS: Record<Hotkey['category'], string> = {
  navigation: 'Navigation',
  interaction: 'Interaction',
  general: 'Keyboard Shortcuts',
};

export function HelpPanel() {
  const [isVisible, setIsVisible] = useState(false);

  const toggle = useCallback(() => {
    setIsVisible((prev) => !prev);
  }, []);

  // Toggle with '?' key (works with Shift+? or just ?)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement;
      const isInputFocused = activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA';

      // Toggle with '?' key (Shift+? on most keyboards)
      if (e.key === '?' && !isInputFocused && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        toggle();
      }
      // Close with Escape (only if panel is visible)
      if (e.key === 'Escape' && isVisible && !isInputFocused) {
        setIsVisible(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggle, isVisible]);

  if (!isVisible) {
    return (
      <button
        className="help-toggle"
        onClick={toggle}
        title="Show help (?)"
        aria-label="Show help"
      >
        ?
      </button>
    );
  }

  // Group hotkeys by category
  const grouped = HOTKEYS.reduce(
    (acc, hotkey) => {
      if (!acc[hotkey.category]) {
        acc[hotkey.category] = [];
      }
      acc[hotkey.category].push(hotkey);
      return acc;
    },
    {} as Record<Hotkey['category'], Hotkey[]>
  );

  return (
    <div className="help-panel">
      <div className="help-panel-header">
        <h3>Help & Shortcuts</h3>
        <button
          className="help-panel-close"
          onClick={toggle}
          aria-label="Close help"
        >
          &times;
        </button>
      </div>
      <div className="help-panel-content">
        {Object.entries(grouped).map(([category, hotkeys]) => (
          <div key={category} className="help-category">
            <h4>{CATEGORY_LABELS[category as Hotkey['category']]}</h4>
            <div className="help-hotkeys">
              {hotkeys.map((hotkey, idx) => (
                <div key={idx} className="help-hotkey">
                  <kbd className="help-key">{hotkey.key}</kbd>
                  <span className="help-description">{hotkey.description}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="help-panel-footer">
        <span className="help-hint">Press <kbd>?</kbd> to toggle</span>
      </div>
    </div>
  );
}
