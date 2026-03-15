/**
 * Sentinel Logs Store — Manages structured log data for the Platform sentinel section
 *
 * Ported from sentinel/ui/src/store/logsStore.ts with:
 * - API paths prefixed with /api/sentinel/
 * - WS replaced with handleWsMessage() action
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

interface SentinelLogsState {
  logs: LogEntry[];
  services: ServiceInfo[];
  flowEvents: FlowEvent[];
  isLoading: boolean;
  error: string | null;
  isLive: boolean;

  // Filters
  levelFilter: LogLevel | 'all';
  serviceFilter: string | null;
  symbolFilter: string | null;
  searchQuery: string;

  // Exclusion filters
  excludedSymbols: Set<string>;
  excludedSymbolTypes: Set<string>;
  excludedMessages: Set<string>;
  excludedServices: Set<string>;

  // Actions
  loadLogs: () => Promise<void>;
  loadServices: () => Promise<void>;
  handleWsMessage: (msg: any) => void;
  setIsLive: (live: boolean) => void;
  setLevelFilter: (level: LogLevel | 'all') => void;
  setServiceFilter: (service: string | null) => void;
  setSymbolFilter: (symbol: string | null) => void;
  setSearchQuery: (query: string) => void;
  clearLogs: () => void;
  toggleExcludedSymbol: (symbol: string) => void;
  toggleExcludedSymbolType: (type: string) => void;
  toggleExcludedMessage: (message: string) => void;
  toggleExcludedService: (service: string) => void;
  clearAllExclusions: () => void;

  // Computed
  getFilteredLogs: () => LogEntry[];
}

export const useSentinelLogsStore = create<SentinelLogsState>((set, get) => ({
  logs: [],
  services: [],
  flowEvents: [],
  isLoading: false,
  error: null,
  isLive: false,

  levelFilter: 'all',
  serviceFilter: null,
  symbolFilter: null,
  searchQuery: '',

  excludedSymbols: new Set<string>(),
  excludedSymbolTypes: new Set<string>(),
  excludedMessages: new Set<string>(),
  excludedServices: new Set<string>(),

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

      const response = await fetch(`/api/sentinel/logs?${params}`);
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
      const response = await fetch('/api/sentinel/services');
      if (!response.ok) return;
      const data = await response.json();
      set({ services: data.services || [] });
    } catch {
      // Services are optional
    }
  },

  handleWsMessage: (msg: any) => {
    if (msg.type === 'sentinel:log' && msg.entry) {
      set((state) => ({
        logs: [msg.entry, ...state.logs].slice(0, 500),
      }));
    }

    if (msg.type === 'sentinel:flow_event') {
      const flowEvent: FlowEvent = {
        type: 'flow_event',
        flowId: msg.flowId,
        nodeSymbol: msg.nodeSymbol,
        event: msg.event,
        timestamp: msg.timestamp,
        service: msg.service,
      };
      set((state) => ({
        flowEvents: [flowEvent, ...state.flowEvents].slice(0, 200),
      }));
    }
  },

  setIsLive: (live) => set({ isLive: live }),

  setLevelFilter: (level) => set({ levelFilter: level }),
  setServiceFilter: (service) => set({ serviceFilter: service }),
  setSymbolFilter: (symbol) => set({ symbolFilter: symbol }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  clearLogs: () => set({ logs: [], flowEvents: [] }),

  toggleExcludedSymbol: (symbol) => {
    const s = new Set(get().excludedSymbols);
    s.has(symbol) ? s.delete(symbol) : s.add(symbol);
    set({ excludedSymbols: s });
  },
  toggleExcludedSymbolType: (type) => {
    const s = new Set(get().excludedSymbolTypes);
    s.has(type) ? s.delete(type) : s.add(type);
    set({ excludedSymbolTypes: s });
  },
  toggleExcludedMessage: (message) => {
    const s = new Set(get().excludedMessages);
    s.has(message) ? s.delete(message) : s.add(message);
    set({ excludedMessages: s });
  },
  toggleExcludedService: (service) => {
    const s = new Set(get().excludedServices);
    s.has(service) ? s.delete(service) : s.add(service);
    set({ excludedServices: s });
  },
  clearAllExclusions: () => set({
    excludedSymbols: new Set(),
    excludedSymbolTypes: new Set(),
    excludedMessages: new Set(),
    excludedServices: new Set(),
  }),

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

    // Apply exclusion filters
    if (state.excludedSymbols.size > 0) {
      filtered = filtered.filter((l) => !state.excludedSymbols.has(l.symbol));
    }
    if (state.excludedSymbolTypes.size > 0) {
      filtered = filtered.filter((l) => !state.excludedSymbolTypes.has(l.symbolType));
    }
    if (state.excludedMessages.size > 0) {
      filtered = filtered.filter((l) => !state.excludedMessages.has(l.message));
    }
    if (state.excludedServices.size > 0) {
      filtered = filtered.filter((l) => !state.excludedServices.has(l.service));
    }

    return filtered;
  },
}));
