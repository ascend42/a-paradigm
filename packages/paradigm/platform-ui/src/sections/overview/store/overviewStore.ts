import { create } from 'zustand';

export interface ActivityItem {
  timestamp: string;
  type: 'commit' | 'lore';
  summary: string;
  symbol?: string;
  link?: string;
}

export interface OverviewData {
  project: { name: string; branch: string; discipline: string };
  symbols: { total: number; byType: Record<string, number> };
  lore: { total: number; thisWeek: number; lastEntry: string | null };
  calibration: { score: number | null; assessed: number };
  tasks: { total: number; inProgress: number; completed: number };
  health: {
    purposeCoverage: number;
    aspectAnchors: number;
    gateCompliance: number;
    calibration: number;
    loreFreshnessDays: number;
  };
  recentActivity: ActivityItem[];
}

interface OverviewState {
  data: OverviewData | null;
  loading: boolean;
  error: string | null;
  fetchOverview: () => Promise<void>;
}

export const useOverviewStore = create<OverviewState>((set) => ({
  data: null,
  loading: false,
  error: null,

  fetchOverview: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch('/api/platform/overview');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: OverviewData = await res.json();
      set({ data, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },
}));
