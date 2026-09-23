import { create } from 'zustand';

// ── Types ────────────────────────────────────────────
// Mirror of the /api/memory response shapes. These are READ-ONLY in C1 — the
// store fetches the advisory digest (review) + the lean-rewrite preview (sync)
// and holds nothing that mutates memory. Apply/write actions arrive in C2/C3.

/** One suggestion bucket for a memory entry (mirrors MemorySuggestion). */
export type MemorySuggestion =
  | 'prune'
  | 'merge'
  | 'route:habits'
  | 'route:task'
  | 'route:decisions'
  | 'route:lore'
  | 'pin';

/** A single review finding — the /api/memory/review DigestItem shape verbatim. */
export interface DigestItem {
  id: string;
  entryFile: string;
  name: string;
  suggestion: MemorySuggestion;
  /** 0..1 staleness. */
  score: number;
  verdict: string;
  rationale: string;
  clusterId?: string;
  expiresAt: string;
  target: { file: string; symbol?: string };
  applyCommand: string;
}

export interface Digest {
  root: string;
  scanned: number;
  pinned: number;
  items: DigestItem[];
}

// ── Sync preview shapes (GET /api/memory/sync) ───────
export interface DemotedInfo {
  heading: string;
  reason: string;
  applyHint: string;
}

export interface DedupInfo {
  heading: string;
}

export interface ProjectionItem {
  kind: 'decision' | 'lore' | 'habit' | 'native';
  id: string;
  title: string;
}

export interface SyncPreview {
  root: string;
  memoryFile: string;
  existed: boolean;
  changed: boolean;
  bytesBefore: number;
  bytesAfter: number;
  linesBefore: number;
  linesAfter: number;
  demoted: DemotedInfo[];
  deduped: DedupInfo[];
  projectionEnabled: boolean;
  projectionItems: ProjectionItem[];
  diff: string;
}

/** The gated sync-write outcome (POST /api/memory/sync/write). */
export interface SyncWriteResult {
  wrote: boolean;
  backupPath?: string;
  bytesAfter?: number;
}

interface MemoryState {
  // Review (advisory digest) state
  digest: Digest | null;
  digestLoading: boolean;
  digestError: string | null;

  // Sync (lean-rewrite preview) state
  sync: SyncPreview | null;
  syncLoading: boolean;
  syncError: string | null;
  // The projection toggle the panel drives — persisted only in memory.
  projection: boolean;

  // ── C2/C3 write state ───────────────────────────────
  // The id (or 'merge:<clusterId>') currently being applied — drives per-row
  // pending UI. actionError holds the last apply failure (inline, not a toast).
  actionPendingId: string | null;
  actionError: string | null;
  // C3 gated sync write.
  syncWriting: boolean;
  syncWriteResult: SyncWriteResult | null;

  fetchReview: () => Promise<void>;
  fetchSync: (projection: boolean) => Promise<void>;
  setProjection: (on: boolean) => void;

  clearActionError: () => void;
  /** Apply a row's suggested action (prune / route:* / merge / pin). */
  applyRow: (item: DigestItem) => Promise<void>;
  /** C3: apply the lean-rewrite to MEMORY.md (backed up first). */
  applySyncWrite: () => Promise<void>;
  clearSyncWriteResult: () => void;
}

let reviewController: AbortController | null = null;
let syncController: AbortController | null = null;

export const useMemoryStore = create<MemoryState>((set, get) => ({
  digest: null,
  digestLoading: false,
  digestError: null,

  sync: null,
  syncLoading: false,
  syncError: null,
  projection: false,

  actionPendingId: null,
  actionError: null,
  syncWriting: false,
  syncWriteResult: null,

  fetchReview: async () => {
    reviewController?.abort();
    reviewController = new AbortController();
    const { signal } = reviewController;
    set({ digestLoading: true, digestError: null });
    try {
      const res = await fetch('/api/memory/review', { signal });
      if (!res.ok) {
        set({ digestLoading: false, digestError: `HTTP ${res.status}` });
        return;
      }
      const data = (await res.json()) as Digest;
      set({
        digest: {
          root: data.root || '',
          scanned: data.scanned || 0,
          pinned: data.pinned || 0,
          items: data.items || [],
        },
        digestLoading: false,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      set({ digestLoading: false, digestError: err instanceof Error ? err.message : 'fetch failed' });
    }
  },

  fetchSync: async (projection) => {
    syncController?.abort();
    syncController = new AbortController();
    const { signal } = syncController;
    set({ syncLoading: true, syncError: null, projection });
    try {
      const res = await fetch(`/api/memory/sync?projection=${projection ? 'true' : 'false'}`, { signal });
      if (!res.ok) {
        set({ syncLoading: false, syncError: `HTTP ${res.status}` });
        return;
      }
      const data = (await res.json()) as SyncPreview;
      set({
        sync: {
          root: data.root || '',
          memoryFile: data.memoryFile || '',
          existed: !!data.existed,
          changed: !!data.changed,
          bytesBefore: data.bytesBefore || 0,
          bytesAfter: data.bytesAfter || 0,
          linesBefore: data.linesBefore || 0,
          linesAfter: data.linesAfter || 0,
          demoted: data.demoted || [],
          deduped: data.deduped || [],
          projectionEnabled: !!data.projectionEnabled,
          projectionItems: data.projectionItems || [],
          diff: data.diff || '',
        },
        syncLoading: false,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      set({ syncLoading: false, syncError: err instanceof Error ? err.message : 'fetch failed' });
    }
  },

  setProjection: (on) => set({ projection: on }),

  clearActionError: () => set({ actionError: null }),

  // Apply a single row's suggested action. Maps the suggestion → the matching
  // write endpoint (prune / route:<to> / merge / pin), POSTs, and on success
  // re-fetches BOTH the review digest and the current sync preview (the entry
  // set changed). On failure, surfaces an inline actionError.
  applyRow: async (item) => {
    const pendingId = item.suggestion === 'merge' && item.clusterId ? `merge:${item.clusterId}` : item.id;
    set({ actionError: null, actionPendingId: pendingId });

    let url: string;
    let body: Record<string, unknown> | undefined;
    switch (item.suggestion) {
      case 'prune':
        url = `/api/memory/${encodeURIComponent(item.id)}/prune`;
        break;
      case 'pin':
        url = `/api/memory/${encodeURIComponent(item.id)}/pin`;
        break;
      case 'route:habits':
      case 'route:task':
      case 'route:decisions':
      case 'route:lore':
        url = `/api/memory/${encodeURIComponent(item.id)}/route`;
        body = { to: item.suggestion.slice('route:'.length) };
        break;
      case 'merge': {
        // Merge every ledger row in this near-duplicate cluster (primary first).
        const members = (get().digest?.items ?? [])
          .filter((i) => i.clusterId && i.clusterId === item.clusterId)
          .map((i) => i.id);
        const ids = [item.id, ...members.filter((m) => m !== item.id)];
        if (ids.length < 2) {
          set({ actionPendingId: null, actionError: 'merge needs at least two entries in the cluster' });
          return;
        }
        url = '/api/memory/merge';
        body = { ids };
        break;
      }
      default:
        set({ actionPendingId: null, actionError: `unknown suggestion: ${item.suggestion}` });
        return;
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (data && typeof data.error === 'string') msg = data.error;
        } catch {
          /* non-JSON body — keep the status string */
        }
        set({ actionPendingId: null, actionError: msg });
        return;
      }
      set({ actionPendingId: null });
      // Refresh the ledger + the sync preview at the current projection setting.
      await Promise.all([get().fetchReview(), get().fetchSync(get().projection)]);
    } catch (err) {
      set({ actionPendingId: null, actionError: err instanceof Error ? err.message : 'apply failed' });
    }
  },

  applySyncWrite: async () => {
    if (get().syncWriting) return;
    set({ syncWriting: true, syncWriteResult: null, actionError: null });
    try {
      const res = await fetch('/api/memory/sync/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projection: get().projection }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (data && typeof data.error === 'string') msg = data.error;
        } catch {
          /* keep status string */
        }
        set({ syncWriting: false, actionError: msg });
        return;
      }
      const data = (await res.json()) as SyncWriteResult;
      set({ syncWriting: false, syncWriteResult: data });
      // Reflect the applied write: the preview should now read "already lean".
      await get().fetchSync(get().projection);
    } catch (err) {
      set({ syncWriting: false, actionError: err instanceof Error ? err.message : 'sync write failed' });
    }
  },

  clearSyncWriteResult: () => set({ syncWriteResult: null }),
}));
