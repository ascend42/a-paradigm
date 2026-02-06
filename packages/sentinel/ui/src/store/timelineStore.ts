/**
 * Timeline Store - Manages commit history for temporal navigation
 */

import { create } from 'zustand';
import type { CommitInfo } from '../types';

interface TimelineState {
  commits: CommitInfo[];
  selectedCommitHash: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  loadCommits: () => Promise<void>;
  selectCommit: (hash: string | null) => void;
  getSelectedCommit: () => CommitInfo | undefined;
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  commits: [],
  selectedCommitHash: null,
  isLoading: false,
  error: null,

  loadCommits: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await fetch('/api/commits');
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      const data = await response.json();
      set({
        commits: data.commits || [],
        isLoading: false,
      });
    } catch (error) {
      console.error('Failed to load commits:', error);
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to load commits',
        commits: [],
      });
    }
  },

  selectCommit: (hash) => set({ selectedCommitHash: hash }),

  getSelectedCommit: () => {
    const state = get();
    if (!state.selectedCommitHash) return undefined;
    return state.commits.find((c) => c.hash === state.selectedCommitHash);
  },
}));
