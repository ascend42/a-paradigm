/**
 * ToolCache — Simple TTL cache for MCP tool results
 *
 * Avoids redundant recomputation when agents call the same tool
 * multiple times within a short window (e.g., search -> navigate -> search again).
 */

interface CacheEntry<T> {
  data: T;
  createdAt: number;
}

export class ToolCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private readonly ttlMs: number;
  /** The symbol index cached results were computed against (see bindIndex). */
  private boundIndex: object | null = null;
  /** Bumped by clear(); a compute that straddles a clear must not repopulate. */
  private generation = 0;
  /**
   * In-flight computes by key. invalidate()/invalidatePrefix() drop the token,
   * so a compute that straddles a targeted invalidation can't write back.
   */
  private inflight = new Map<string, symbol>();

  constructor(ttlMs: number = 30_000) {
    this.ttlMs = ttlMs;
  }

  /**
   * Get a cached value, or compute and cache it
   */
  async getOrCompute<T>(key: string, compute: () => T | Promise<T>): Promise<T> {
    const existing = this.cache.get(key);
    if (existing && Date.now() - existing.createdAt < this.ttlMs) {
      return existing.data as T;
    }

    // A compute started against one index/generation may finish after
    // bindIndex()/clear() moved on — return its result, but don't cache it.
    const generation = this.generation;
    const token = Symbol(key);
    this.inflight.set(key, token);
    try {
      const data = await compute();
      if (generation === this.generation && this.inflight.get(key) === token) {
        this.cache.set(key, { data, createdAt: Date.now() });
      }
      return data;
    } finally {
      if (this.inflight.get(key) === token) this.inflight.delete(key);
    }
  }

  /**
   * Invalidate a specific key
   */
  invalidate(key: string): void {
    this.cache.delete(key);
    this.inflight.delete(key);
  }

  /**
   * Invalidate all keys matching a prefix
   */
  invalidatePrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
    for (const key of this.inflight.keys()) {
      if (key.startsWith(prefix)) this.inflight.delete(key);
    }
  }

  /**
   * Clear the entire cache
   */
  clear(): void {
    this.cache.clear();
    this.inflight.clear();
    this.generation++;
  }

  /**
   * Tie cached results to one symbol index. When the index object changes
   * (the live index rebuilt after a file edit), every cached result may be
   * stale, so the whole cache is dropped.
   */
  bindIndex(index: object): void {
    if (index !== this.boundIndex) {
      this.clear();
      this.boundIndex = index;
    }
  }

  /**
   * Get cache stats for debugging
   */
  stats(): { size: number; ttlMs: number } {
    return { size: this.cache.size, ttlMs: this.ttlMs };
  }
}

/** Shared tool cache instance — 30 second TTL */
export const toolCache = new ToolCache(30_000);
