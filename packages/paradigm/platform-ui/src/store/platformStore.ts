import { create } from 'zustand';

export type SectionId = 'overview' | 'lore' | 'graph' | 'git' | 'sentinel' | 'university' | 'symphony' | 'docs' | 'ambient';

export interface PlatformState {
  activeSection: SectionId;
  availableSections: SectionId[];
  projectName: string;
  theme: 'dark' | 'light';

  setActiveSection: (section: SectionId) => void;
  setAvailableSections: (sections: SectionId[]) => void;
  setProjectName: (name: string) => void;
  toggleTheme: () => void;
  fetchPlatformInfo: () => Promise<void>;
}

export const usePlatformStore = create<PlatformState>((set, get) => ({
  activeSection: 'overview',
  availableSections: ['overview', 'lore', 'graph', 'git'],
  projectName: '',
  theme: (localStorage.getItem('paradigm-platform-theme') as 'dark' | 'light') || 'dark',

  setActiveSection: (section) => {
    set({ activeSection: section });
    window.history.pushState(null, '', `/${section === 'overview' ? '' : section}`);
  },

  setAvailableSections: (sections) => set({ availableSections: sections }),

  setProjectName: (name) => set({ projectName: name }),

  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    set({ theme: next });
    localStorage.setItem('paradigm-platform-theme', next);
    document.documentElement.setAttribute('data-theme', next);
  },

  fetchPlatformInfo: async () => {
    try {
      const [infoRes, sectionsRes] = await Promise.all([
        fetch('/api/info'),
        fetch('/api/platform/sections'),
      ]);

      if (infoRes.ok) {
        const info = await infoRes.json();
        set({ projectName: info.project || info.name || '' });
      }

      if (sectionsRes.ok) {
        const data = await sectionsRes.json();
        if (data.sections?.length) {
          set({ availableSections: data.sections });
        }
      }
    } catch {
      // Platform info will be loaded when server is ready
    }
  },
}));
