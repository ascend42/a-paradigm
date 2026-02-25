/**
 * Logs Store - Manages structured log data for the log viewer
 */

import { create } from 'zustand';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  symbol: string;
  symbolType: string;
  message: string;
  data?: Record<string, unknown>;
  service: string;
  sessionId?: string;
  correlationId?: string;
  durationMs?: number;
  environment?: string;
}

export interface ServiceInfo {
  name: string;
  version?: string;
  pid?: number;
  startedAt: string;
  lastSeenAt: string;
  environment?: string;
}

export interface FlowEvent {
  type: 'flow_event';
  flowId?: string;
  nodeSymbol: string;
  event: string;
  timestamp: string;
  service: string;
}

interface LogsState {
  logs: LogEntry[];
  services: ServiceInfo[];
  flowEvents: FlowEvent[];
  isLoading: boolean;
  error: string | null;
  isLive: boolean;
  ws: WebSocket | null;

  // Filters
  levelFilter: LogLevel | 'all';
  serviceFilter: string | null;
  symbolFilter: string | null;
  searchQuery: string;

  // Actions
  loadLogs: () => Promise<void>;
  loadServices: () => Promise<void>;
  connectWebSocket: () => void;
  disconnectWebSocket: () => void;
  setLevelFilter: (level: LogLevel | 'all') => void;
  setServiceFilter: (service: string | null) => void;
  setSymbolFilter: (symbol: string | null) => void;
  setSearchQuery: (query: string) => void;
  clearLogs: () => void;

  // Computed
  getFilteredLogs: () => LogEntry[];
}

export const useLogsStore = create<LogsState>((set, get) => ({
  logs: [],
  services: [],
  flowEvents: [],
  isLoading: false,
  error: null,
  isLive: false,
  ws: null,

  levelFilter: 'all',
  serviceFilter: null,
  symbolFilter: null,
  searchQuery: '',

  loadLogs: async () => {
    set({ isLoading: true, error: null });
    try {
      const params = new URLSearchParams();
      const state = get();
      if (state.levelFilter !== 'all') params.set('level', state.levelFilter);
      if (state.serviceFilter) params.set('service', state.serviceFilter);
      if (state.symbolFilter) params.set('symbol', state.symbolFilter);
      if (state.searchQuery) params.set('search', state.searchQuery);
      params.set('limit', '200');

      const response = await fetch(`/api/logs?${params}`);
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = await response.json();
      set({ logs: data.logs || [], isLoading: false });
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to load logs',
        logs: [],
      });
    }
  },

  loadServices: async () => {
    try {
      const response = await fetch('/api/services');
      if (!response.ok) return;
      const data = await response.json();
      set({ services: data.services || [] });
    } catch {
      // Services are optional
    }
  },

  connectWebSocket: () => {
    const existing = get().ws;
    if (existing && existing.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
      ws.send(JSON.stringify({ method: 'subscribe', id: 1 }));
      set({ isLive: true, ws });
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'log' && msg.entry) {
          set((state) => ({
            logs: [msg.entry, ...state.logs].slice(0, 500),
          }));
        }

        if (msg.type === 'flow_event') {
          set((state) => ({
            flowEvents: [msg as FlowEvent, ...state.flowEvents].slice(0, 200),
          }));
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      set({ isLive: false, ws: null });
    };

    ws.onerror = () => {
      set({ isLive: false, ws: null });
    };
  },

  disconnectWebSocket: () => {
    const ws = get().ws;
    if (ws) {
      ws.close();
      set({ isLive: false, ws: null });
    }
  },

  setLevelFilter: (level) => set({ levelFilter: level }),
  setServiceFilter: (service) => set({ serviceFilter: service }),
  setSymbolFilter: (symbol) => set({ symbolFilter: symbol }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  clearLogs: () => set({ logs: [], flowEvents: [] }),

  getFilteredLogs: () => {
    const state = get();
    let filtered = state.logs;

    if (state.levelFilter !== 'all') {
      filtered = filtered.filter((l) => l.level === state.levelFilter);
    }

    if (state.serviceFilter) {
      filtered = filtered.filter((l) => l.service === state.serviceFilter);
    }

    if (state.symbolFilter) {
      filtered = filtered.filter((l) => l.symbol.includes(state.symbolFilter!));
    }

    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (l) => l.message.toLowerCase().includes(q) || l.symbol.toLowerCase().includes(q)
      );
    }

    return filtered;
  },
}));
