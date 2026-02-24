// @ts-nocheck — Cross-package import is resolved by vitest but not by tsc rootDir
import { describe, it, expect, beforeEach } from 'vitest';
import { ToolCache } from '../../../paradigm-mcp/src/utils/tool-cache.js';

describe('ToolCache', () => {
  let cache: ToolCache;

  beforeEach(() => {
    cache = new ToolCache(100); // 100ms TTL for fast tests
  });

  it('caches and returns computed values', async () => {
    let computeCount = 0;
    const compute = () => { computeCount++; return 'result'; };

    const r1 = await cache.getOrCompute('key', compute);
    const r2 = await cache.getOrCompute('key', compute);

    expect(r1).toBe('result');
    expect(r2).toBe('result');
    expect(computeCount).toBe(1); // Only computed once
  });

  it('recomputes after TTL expires', async () => {
    let computeCount = 0;
    const compute = () => { computeCount++; return `result-${computeCount}`; };

    const r1 = await cache.getOrCompute('key', compute);
    expect(r1).toBe('result-1');

    // Wait for TTL to expire
    await new Promise(resolve => setTimeout(resolve, 150));

    const r2 = await cache.getOrCompute('key', compute);
    expect(r2).toBe('result-2');
    expect(computeCount).toBe(2);
  });

  it('invalidate removes a single key', async () => {
    let computeCount = 0;
    const compute = () => { computeCount++; return 'result'; };

    await cache.getOrCompute('key', compute);
    cache.invalidate('key');
    await cache.getOrCompute('key', compute);

    expect(computeCount).toBe(2);
  });

  it('invalidatePrefix removes matching keys', async () => {
    await cache.getOrCompute('search:foo', () => 'a');
    await cache.getOrCompute('search:bar', () => 'b');
    await cache.getOrCompute('status', () => 'c');

    cache.invalidatePrefix('search:');

    expect(cache.stats().size).toBe(1); // only 'status' remains
  });

  it('clear removes all entries', async () => {
    await cache.getOrCompute('a', () => 1);
    await cache.getOrCompute('b', () => 2);

    cache.clear();
    expect(cache.stats().size).toBe(0);
  });

  it('stats returns cache size and TTL', () => {
    const stats = cache.stats();
    expect(stats.size).toBe(0);
    expect(stats.ttlMs).toBe(100);
  });
});
