/**
 * Theme Store - Manages color themes (spectrum, focus, deep)
 */

import { create } from 'zustand';

export type Theme = 'spectrum' | 'focus' | 'deep';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

// Load theme from localStorage on init
const getStoredTheme = (): Theme => {
  if (typeof window === 'undefined') return 'focus';
  const stored = localStorage.getItem('paradigm-theme');
  if (stored === 'spectrum' || stored === 'focus' || stored === 'deep') {
    return stored;
  }
  // Migrate old theme names
  if (stored === 'morning') return 'spectrum';
  if (stored === 'daytime') return 'focus';
  if (stored === 'nighttime') return 'deep';
  return 'focus';
};

// Apply theme to document
const applyTheme = (theme: Theme) => {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('paradigm-theme', theme);
  }
};

// Initialize theme
const initialTheme = getStoredTheme();
applyTheme(initialTheme);

export const useThemeStore = create<ThemeState>((set) => ({
  theme: initialTheme,
  setTheme: (theme: Theme) => {
    set({ theme });
    applyTheme(theme);
  },
}));
