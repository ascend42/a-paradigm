import { create } from 'zustand';
import type { PackConfigResponse } from '../types';

interface PackConfigState {
  config: PackConfigResponse | null;
  isLoaded: boolean;
  loadPackConfig: () => Promise<void>;
}

const DEFAULT_CONFIG: PackConfigResponse = {
  mode: 'paradigm',
  branding: {
    name: 'Paradigm University',
    tagline: 'Lux in Codice',
    logo: null,
    institution: null,
    favicon: null,
    tabs: ['campus', 'courses', 'plsat', 'library', 'certificates'],
    startCourse: null,
  },
  theme: null,
  version: '6.4.0',
  hasProjectLibrary: false,
  sections: [],
};

export const usePackConfigStore = create<PackConfigState>((set) => ({
  config: null,
  isLoaded: false,

  loadPackConfig: async () => {
    try {
      const res = await fetch('/api/pack-config');
      if (!res.ok) throw new Error('Failed to load pack config');
      const data: PackConfigResponse = await res.json();
      set({ config: data, isLoaded: true });
    } catch {
      set({ config: DEFAULT_CONFIG, isLoaded: true });
    }
  },
}));
