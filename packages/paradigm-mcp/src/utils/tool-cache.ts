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

    const data = await compute();
    this.cache.set(key, { data, createdAt: Date.now() });
    return data;
  }

  /**
   * Invalidate a specific key
   */
  invalidate(key: string): void {
    this.cache.delete(key);
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
  }

  /**
   * Clear the entire cache
   */
  clear(): void {
    this.cache.clear();
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
