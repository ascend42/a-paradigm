import { create } from 'zustand';

export interface StreamEvent {
  id: string;
  type: string;
  source: string;
  timestamp: string;
  path?: string;
  symbols?: string[];
  context?: string;
  agent?: string;
  tool?: string;
  severity?: string;
}

export interface Nomination {
  id: string;
  agent: string;
  relevance: number;
  urgency: string;
  type: string;
  brief: string;
  timestamp: string;
  surfaced: boolean;
  engaged?: boolean;
  response?: string;
}

export interface Debate {
  id: string;
  topic: string;
  type: string;
  nominations: string[];
}

interface AmbientState {
  events: StreamEvent[];
  nominations: Nomination[];
  debates: Debate[];
  loading: boolean;
  eventFilter: { type?: string; since?: string };

  fetchEvents: (filter?: { type?: string; since?: string }) => Promise<void>;
  fetchNominations: () => Promise<void>;
  engageNomination: (id: string, response: 'accepted' | 'dismissed' | 'deferred') => Promise<void>;
  setEventFilter: (filter: { type?: string; since?: string }) => void;
  connectSSE: () => () => void;
}

export const useAmbientStore = create<AmbientState>((set, get) => ({
  events: [],
  nominations: [],
  debates: [],
  loading: false,
  eventFilter: {},

  fetchEvents: async (filter) => {
    set({ loading: true });
    try {
      const f = filter || get().eventFilter;
      const params = new URLSearchParams();
      if (f.type) params.set('type', f.type);
      if (f.since) params.set('since', f.since);

      const res = await fetch(`/api/ambient/events?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      set({ events: data.events || [], loading: false });
    } catch {
      set({ loading: false });
    }
  },

  fetchNominations: async () => {
    try {
      const res = await fetch('/api/ambient/nominations?pending_only=true&include_debates=true');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      set({
        nominations: data.nominations || [],
        debates: data.debates || [],
      });
    } catch {
      // ignore
    }
  },

  engageNomination: async (id, response) => {
    try {
      const res = await fetch(`/api/ambient/nominations/${encodeURIComponent(id)}/engage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Optimistically update the nomination in local state
      set((s) => ({
        nominations: s.nominations.map((n) =>
          n.id === id ? { ...n, engaged: true, response } : n
        ),
      }));
    } catch {
      // Refetch to get accurate state on error
      get().fetchNominations();
    }
  },

  setEventFilter: (filter) => {
    set({ eventFilter: filter });
    get().fetchEvents(filter);
  },

  /**
   * Connect to the SSE stream for real-time event updates.
   * Returns a cleanup function to close the connection.
   */
  connectSSE: () => {
    const eventSource = new EventSource('/api/ambient/stream');

    eventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as StreamEvent;
        set((s) => ({
          events: [event, ...s.events].slice(0, 200),
        }));
      } catch {
        // Skip malformed SSE data
      }
    };

    eventSource.onerror = () => {
      // SSE will auto-reconnect; no action needed
    };

    return () => eventSource.close();
  },
}));
