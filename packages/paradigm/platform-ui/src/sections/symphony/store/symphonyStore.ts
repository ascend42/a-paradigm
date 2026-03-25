/**
 * Symphony Store — Manages all Symphony state for the Platform UI
 *
 * Fetches agents, threads, messages, and file requests from /api/symphony/*
 * and handles real-time WS message updates.
 */

import { create } from 'zustand';

// ── Types ─────────────────────────────────────────────────

export interface AgentInfo {
  id: string;
  name: string;
  project: string;
  role: string;
  status: 'awake' | 'asleep';
  lastPoll?: string;
  startedAt: string;
  statusBlurb?: string;
}

export interface ThreadSummary {
  id: string;
  topic: string;
  status: 'active' | 'resolved';
  participants: { id: string; name: string; type: string }[];
  messageCount: number;
  lastActivity: string;
  decision?: string;
}

export interface ThreadMessage {
  id: string;
  sender: { id: string; name: string; type: string };
  intent: string;
  text: string;
  timestamp: string;
  symbols: string[];
  diff?: string;
  decision?: string;
  recipients?: { id: string; name: string }[];
}

export interface ThreadDetail {
  thread: ThreadSummary;
  messages: ThreadMessage[];
  symbolsDiscussed: string[];
}

export interface FileRequestInfo {
  requestId: string;
  filePath: string;
  reason: string;
  requester: { id: string; name: string };
  urgency: string;
  status: string;
  createdAt: string;
  resolvedAt?: string;
  denyReason?: string;
  snippet?: string;
}

export interface NetworkStatus {
  agentCount: number;
  awakeCount: number;
  asleepCount: number;
  activeThreadCount: number;
  unreadCount: number;
  pendingFileRequests: number;
}

export type SymphonyTab = 'threads' | 'network' | 'files';

// ── Store ─────────────────────────────────────────────────

interface SymphonyState {
  agents: AgentInfo[];
  myIdentity: { id: string; project: string; role: string } | null;
  threads: ThreadSummary[];
  activeThreadId: string | null;
  activeThread: ThreadDetail | null;
  fileRequests: FileRequestInfo[];
  status: NetworkStatus | null;
  loading: boolean;
  activeTab: SymphonyTab;
  threadFilter: 'active' | 'resolved' | 'all';
  fileFilter: 'pending' | 'all';

  // Actions
  fetchAgents: () => Promise<void>;
  fetchMyIdentity: () => Promise<void>;
  fetchThreads: () => Promise<void>;
  fetchThread: (threadId: string) => Promise<void>;
  fetchFileRequests: () => Promise<void>;
  fetchStatus: () => Promise<void>;
  sendMessage: (params: { intent: string; text: string; threadRoot?: string; recipients?: string[]; symbols?: string[]; diff?: string; decision?: string }) => Promise<void>;
  resolveThread: (threadId: string, decision?: string) => Promise<void>;
  handleFileAction: (requestId: string, action: 'approve' | 'deny' | 'approve-redacted', reason?: string) => Promise<void>;
  setActiveTab: (tab: SymphonyTab) => void;
  setActiveThread: (threadId: string | null) => void;
  setThreadFilter: (filter: 'active' | 'resolved' | 'all') => void;
  setFileFilter: (filter: 'pending' | 'all') => void;
  handleWsMessage: (msg: any) => void;
  refresh: () => Promise<void>;
}

let symphonyAgentsController: AbortController | null = null;
let symphonyIdentityController: AbortController | null = null;
let symphonyThreadsController: AbortController | null = null;
let symphonyThreadDetailController: AbortController | null = null;
let symphonyFileReqController: AbortController | null = null;
let symphonyStatusController: AbortController | null = null;

export const useSymphonyStore = create<SymphonyState>((set, get) => ({
  agents: [],
  myIdentity: null,
  threads: [],
  activeThreadId: null,
  activeThread: null,
  fileRequests: [],
  status: null,
  loading: false,
  activeTab: 'threads',
  threadFilter: 'active',
  fileFilter: 'pending',

  fetchAgents: async () => {
    symphonyAgentsController?.abort();
    symphonyAgentsController = new AbortController();
    const { signal } = symphonyAgentsController;
    try {
      const res = await fetch('/api/symphony/agents', { signal });
      if (!res.ok) return;
      const data = await res.json();
      set({ agents: data.agents || [] });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      // ignore
    }
  },

  fetchMyIdentity: async () => {
    symphonyIdentityController?.abort();
    symphonyIdentityController = new AbortController();
    const { signal } = symphonyIdentityController;
    try {
      const res = await fetch('/api/symphony/agents/me', { signal });
      if (!res.ok) return;
      const data = await res.json();
      set({ myIdentity: data.identity || null });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      // ignore
    }
  },

  fetchThreads: async () => {
    symphonyThreadsController?.abort();
    symphonyThreadsController = new AbortController();
    const { signal } = symphonyThreadsController;
    try {
      const filter = get().threadFilter;
      const params = filter !== 'all' ? `?status=${filter}` : '';
      const res = await fetch(`/api/symphony/threads${params}`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      set({ threads: data.threads || [] });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      // ignore
    }
  },

  fetchThread: async (threadId: string) => {
    symphonyThreadDetailController?.abort();
    symphonyThreadDetailController = new AbortController();
    const { signal } = symphonyThreadDetailController;
    try {
      const res = await fetch(`/api/symphony/threads/${threadId}`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      set({
        activeThreadId: threadId,
        activeThread: {
          thread: data.thread,
          messages: data.messages || [],
          symbolsDiscussed: data.symbolsDiscussed || [],
        },
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      // ignore
    }
  },

  fetchFileRequests: async () => {
    symphonyFileReqController?.abort();
    symphonyFileReqController = new AbortController();
    const { signal } = symphonyFileReqController;
    try {
      const filter = get().fileFilter;
      const params = filter !== 'all' ? `?status=${filter}` : '';
      const res = await fetch(`/api/symphony/file-requests${params}`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      set({ fileRequests: data.fileRequests || [] });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      // ignore
    }
  },

  fetchStatus: async () => {
    symphonyStatusController?.abort();
    symphonyStatusController = new AbortController();
    const { signal } = symphonyStatusController;
    try {
      const res = await fetch('/api/symphony/status', { signal });
      if (!res.ok) return;
      const data = await res.json();
      set({ status: data });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      // ignore
    }
  },

  sendMessage: async (params) => {
    try {
      const res = await fetch('/api/symphony/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!res.ok) return;

      // Refetch active thread to show the new message
      const { activeThreadId } = get();
      const data = await res.json();
      const threadId = data.threadId || activeThreadId;
      if (threadId) {
        await get().fetchThread(threadId);
      }
      await get().fetchThreads();
    } catch {
      // ignore
    }
  },

  resolveThread: async (threadId: string, decision?: string) => {
    try {
      const res = await fetch(`/api/symphony/threads/${threadId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      if (res.ok) {
        await get().fetchThread(threadId);
        await get().fetchThreads();
      }
    } catch {
      // ignore
    }
  },

  handleFileAction: async (requestId: string, action: 'approve' | 'deny' | 'approve-redacted', reason?: string) => {
    try {
      const res = await fetch(`/api/symphony/file-requests/${requestId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason }),
      });
      if (res.ok) {
        await get().fetchFileRequests();
      }
    } catch {
      // ignore
    }
  },

  setActiveTab: (tab) => set({ activeTab: tab }),

  setActiveThread: (threadId) => {
    if (threadId) {
      get().fetchThread(threadId);
    } else {
      set({ activeThreadId: null, activeThread: null });
    }
  },

  setThreadFilter: (filter) => {
    set({ threadFilter: filter });
    get().fetchThreads();
  },

  setFileFilter: (filter) => {
    set({ fileFilter: filter });
    get().fetchFileRequests();
  },

  handleWsMessage: (msg: any) => {
    if (msg.type === 'symphony:message') {
      const { activeThreadId, activeThread } = get();
      // If the message belongs to the currently viewed thread, append it
      if (msg.threadId && msg.threadId === activeThreadId && activeThread && msg.message) {
        const exists = activeThread.messages.some(m => m.id === msg.message.id);
        if (!exists) {
          set({
            activeThread: {
              ...activeThread,
              messages: [...activeThread.messages, msg.message],
            },
          });
        }
      }
      // Refresh thread list
      get().fetchThreads();
    }

    if (msg.type === 'symphony:thread_resolved') {
      const { activeThreadId } = get();
      if (msg.threadId === activeThreadId) {
        get().fetchThread(msg.threadId);
      }
      get().fetchThreads();
    }
  },

  refresh: async () => {
    set({ loading: true });
    await Promise.all([
      get().fetchThreads(),
      get().fetchAgents(),
      get().fetchStatus(),
    ]);
    set({ loading: false });
  },
}));
