/**
 * Theme Store - Manages color themes (morning, daytime, nighttime)
 */

import { create } from 'zustand';

export type Theme = 'morning' | 'daytime' | 'nighttime';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

// Load theme from localStorage on init
const getStoredTheme = (): Theme => {
  if (typeof window === 'undefined') return 'daytime';
  const stored = localStorage.getItem('horizon-theme');
  if (stored === 'morning' || stored === 'daytime' || stored === 'nighttime') {
    return stored;
  }
  return 'daytime';
};

// Apply theme to document
const applyTheme = (theme: Theme) => {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('horizon-theme', theme);
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
