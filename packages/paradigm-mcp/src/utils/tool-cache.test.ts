/**
 * tool-cache.test — a compute that straddles an index rebind (or clear) must
 * not repopulate the cache with a result computed against the old index.
 */

import { describe, it, expect } from 'vitest';
import { ToolCache } from './tool-cache.js';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('ToolCache', () => {
  it('caches within the TTL', async () => {
    const cache = new ToolCache(30_000);
    let calls = 0;
    await cache.getOrCompute('k', () => ++calls);
    await cache.getOrCompute('k', () => ++calls);
    expect(calls).toBe(1);
  });

  it('drops everything when bound to a new index', async () => {
    const cache = new ToolCache(30_000);
    const index1 = {};
    cache.bindIndex(index1);
    await cache.getOrCompute('k', () => 'v1');
    cache.bindIndex(index1);
    expect(await cache.getOrCompute('k', () => 'other')).toBe('v1');
    cache.bindIndex({});
    expect(await cache.getOrCompute('k', () => 'v2')).toBe('v2');
  });

  it('does not cache a compute that finished after bindIndex moved to a new index', async () => {
    const cache = new ToolCache(30_000);
    cache.bindIndex({ name: 'index1' });

    const gate = deferred<string>();
    const inflight = cache.getOrCompute('search:x', () => gate.promise);

    cache.bindIndex({ name: 'index2' }); // live index rebuilt mid-compute
    gate.resolve('stale-from-index1');
    expect(await inflight).toBe('stale-from-index1'); // caller still gets its answer

    // ...but the stale answer was NOT cached against index2.
    expect(await cache.getOrCompute('search:x', () => 'fresh-from-index2')).toBe('fresh-from-index2');
  });

  it('does not cache a compute that straddles an explicit clear()', async () => {
    const cache = new ToolCache(30_000);
    const gate = deferred<string>();
    const inflight = cache.getOrCompute('k', () => gate.promise);
    cache.clear();
    gate.resolve('stale');
    await inflight;
    expect(cache.stats().size).toBe(0);
  });
});

describe('ToolCache — targeted invalidation races', () => {
  it('invalidate(key) stops an in-flight compute from writing back', async () => {
    const cache = new ToolCache(30_000);
    const gate = deferred<string>();
    const inflight = cache.getOrCompute('purpose:a', () => gate.promise);
    cache.invalidate('purpose:a');
    gate.resolve('stale');
    expect(await inflight).toBe('stale');
    expect(await cache.getOrCompute('purpose:a', () => 'fresh')).toBe('fresh');
  });

  it('invalidatePrefix() stops matching in-flight computes, leaves others', async () => {
    const cache = new ToolCache(30_000);
    const hit = deferred<string>();
    const miss = deferred<string>();
    const a = cache.getOrCompute('search:x', () => hit.promise);
    const b = cache.getOrCompute('nav:y', () => miss.promise);
    cache.invalidatePrefix('search:');
    hit.resolve('stale');
    miss.resolve('kept');
    await Promise.all([a, b]);
    expect(await cache.getOrCompute('search:x', () => 'fresh')).toBe('fresh');
    expect(await cache.getOrCompute('nav:y', () => 'recomputed')).toBe('kept');
  });
});
