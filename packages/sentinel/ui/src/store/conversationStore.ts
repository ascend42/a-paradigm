/**
 * Conversation Store — #ConversationStore
 *
 * Zustand store for Symphony conversation data.
 * Fetches threads and notes from Sentinel's event API,
 * supports real-time updates via WebSocket.
 */

import { create } from 'zustand';
import type { GenericEvent, ScopeSummary } from './eventsStore';

export interface SymphonyThread {
  id: string;
  topic: string;
  status: 'active' | 'resolved';
  participantCount: number;
  noteCount: number;
  lastActivity: string;
  decision?: string;
}

export interface ConversationState {
  threads: SymphonyThread[];
  selectedThreadId: string | null;
  threadFilter: 'all' | 'active' | 'resolved';
  notes: GenericEvent[];
  decisions: string[];
  loading: boolean;
  error: string | null;
  isLive: boolean;

  // Actions
  fetchThreads: () => Promise<void>;
  fetchThreadNotes: (threadId: string) => Promise<void>;
  selectThread: (threadId: string | null) => void;
  setThreadFilter: (filter: 'all' | 'active' | 'resolved') => void;
  setLive: (live: boolean) => void;
  addRealtimeNote: (event: GenericEvent) => void;
}

const SCHEMA_ID = 'paradigm-symphony';

export const useConversationStore = create<ConversationState>((set, get) => ({
  threads: [],
  selectedThreadId: null,
  threadFilter: 'all',
  notes: [],
  decisions: [],
  loading: false,
  error: null,
  isLive: true,

  fetchThreads: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`/api/events/scopes?schemaId=${encodeURIComponent(SCHEMA_ID)}`);
      if (!res.ok) throw new Error(`Failed to fetch threads: ${res.status}`);
      const data = await res.json();
      const scopes: ScopeSummary[] = data.scopes || [];

      // Map scopes to SymphonyThread format
      const threads: SymphonyThread[] = scopes.map((scope) => {
        const hasResolved = (scope.categories?.['lifecycle'] || 0) > 0;
        return {
          id: scope.scopeValue,
          topic: scope.scopeValue, // Will be enriched from thread:created events
          status: hasResolved ? 'resolved' as const : 'active' as const,
          participantCount: 0,
          noteCount: scope.eventCount,
          lastActivity: scope.lastTimestamp,
        };
      });

      // Sort by last activity
      threads.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));

      set({ threads, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch threads',
        loading: false,
      });
    }
  },

  fetchThreadNotes: async (threadId: string) => {
    set({ loading: true, error: null, selectedThreadId: threadId });
    try {
      const params = new URLSearchParams({
        schemaId: SCHEMA_ID,
        scopeValue: threadId,
      });
      const res = await fetch(`/api/events?${params}`);
      if (!res.ok) throw new Error(`Failed to fetch notes: ${res.status}`);
      const data = await res.json();
      const notes: GenericEvent[] = data.events || [];

      // Sort chronologically
      notes.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

      // Extract decisions
      const decisions: string[] = [];
      for (const note of notes) {
        if (note.eventType === 'note:decision' && note.data?.decision) {
          decisions.push(note.data.decision as string);
        }
        if (note.eventType === 'note:decision' && note.data?.text) {
          decisions.push(note.data.text as string);
        }
      }
      // Deduplicate
      const uniqueDecisions = [...new Set(decisions)];

      set({ notes, decisions: uniqueDecisions, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch notes',
        loading: false,
      });
    }
  },

  selectThread: (threadId) => {
    set({ selectedThreadId: threadId, notes: [], decisions: [] });
    if (threadId) {
      get().fetchThreadNotes(threadId);
    }
  },

  setThreadFilter: (filter) => set({ threadFilter: filter }),

  setLive: (live) => set({ isLive: live }),

  addRealtimeNote: (event) => {
    const state = get();

    // Only add if it's for the selected thread or if no thread is selected
    if (state.selectedThreadId && event.scopeValue === state.selectedThreadId) {
      set((s) => ({
        notes: [...s.notes, event],
      }));

      // Extract decision if applicable
      if (event.eventType === 'note:decision' && event.data?.decision) {
        set((s) => ({
          decisions: [...s.decisions, event.data!.decision as string],
        }));
      }
    }

    // Update thread list metadata
    set((s) => {
      const threadIndex = s.threads.findIndex((t) => t.id === event.scopeValue);
      if (threadIndex >= 0) {
        const updated = [...s.threads];
        updated[threadIndex] = {
          ...updated[threadIndex],
          noteCount: updated[threadIndex].noteCount + 1,
          lastActivity: event.timestamp,
        };
        return { threads: updated };
      }
      // New thread
      return {
        threads: [
          {
            id: event.scopeValue || event.id,
            topic: event.scopeValue || 'Direct',
            status: 'active' as const,
            participantCount: 1,
            noteCount: 1,
            lastActivity: event.timestamp,
          },
          ...s.threads,
        ],
      };
    });
  },
}));
