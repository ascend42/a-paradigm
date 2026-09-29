/**
 * Tests for #live-index — the incremental live SymbolIndex cache.
 *
 * Contract:
 *  1. a warm call with nothing changed performs ZERO parses and returns the
 *     same index object;
 *  2. edit / add / delete of a .purpose (and a portal.yaml edit) is reflected;
 *  3. the cached result is identical (order included) to a cold
 *     aggregateFromDirectory — duplicate-symbol resolution included, which is the
 *     Loom Merkle determinism property (T-2026-06-13-011);
 *  4. invalidateLiveIndex forces a cold rebuild;
 *  5. loadLiveGraph reuses the same LiveGraph while nothing changed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getLiveIndex, invalidateLiveIndex, liveIndexRootCount, LIVE_INDEX_MAX_ROOTS } from './live-index.js';
import { aggregateFromDirectory } from './aggregator.js';
import { loadLiveGraph } from './graph-slice.js';
import { searchSymbols } from './symbol-index.js';
import type { AggregationResult } from './types.js';

let tmpDir: string;

function write(rel: string, content: string): string {
  const abs = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

/** Force a visibly different mtime even on coarse-mtime filesystems. */
function bumpMtime(abs: string, seconds = 5): void {
  const st = fs.statSync(abs);
  const t = new Date(st.mtimeMs + seconds * 1000);
  fs.utimesSync(abs, t, t);
}

function comparable(result: AggregationResult): unknown {
  return {
    symbols: result.symbols,
    purposeFiles: result.purposeFiles,
    portalFiles: result.portalFiles,
    errors: result.errors,
    duplicateSymbols: result.duplicateSymbols,
  };
}

async function expectMatchesCold(): Promise<void> {
  const live = await getLiveIndex(tmpDir);
  const cold = await aggregateFromDirectory(tmpDir);
  expect(JSON.stringify(comparable(live.result))).toBe(JSON.stringify(comparable(cold)));
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-index-'));
  write(
    '.purpose',
    'description: root\ncomponents:\n  alpha:\n    description: Alpha uses #beta\n    gates: [^auth]\n',
  );
  write('a/.purpose', 'components:\n  beta:\n    description: Beta component\n');
  write('b/.purpose', 'components:\n  gamma:\n    description: Gamma component\n    tags: [core]\n');
  write('portal.yaml', 'version: "2.0"\ngates:\n  auth:\n    description: Auth gate\n    prizes: []\n');
});

afterEach(() => {
  invalidateLiveIndex(tmpDir);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('#live-index', () => {
  it('first call parses every file; a second unchanged call parses zero and reuses the index', async () => {
    const first = await getLiveIndex(tmpDir);
    expect(first.stats.rebuilt).toBe(true);
    expect(first.stats.parsedFiles).toBe(3);

    const second = await getLiveIndex(tmpDir);
    expect(second.stats.rebuilt).toBe(false);
    expect(second.stats.parsedFiles).toBe(0);
    expect(second.index).toBe(first.index);
    expect(second.generatedAt).toBe(first.generatedAt);
  });

  it('same-size edit within one mtime tick rebuilds (recent files are content-hashed)', async () => {
    const abs = path.join(tmpDir, 'a/.purpose');
    const pinned = new Date(Date.now() - 500);
    fs.utimesSync(abs, pinned, pinned);
    await getLiveIndex(tmpDir);
    const before = fs.statSync(abs).size;
    write('a/.purpose', 'components:\n  beta:\n    description: Beta componenX\n');
    fs.utimesSync(abs, pinned, pinned);
    expect(fs.statSync(abs).size).toBe(before);

    const live = await getLiveIndex(tmpDir);
    expect(live.stats.rebuilt).toBe(true);
    const beta = [...live.index.entries.values()].find((e) => e.symbol === '#beta');
    expect(beta?.description).toBe('Beta componenX');
    await expectMatchesCold();
  });

  it(`caps cached roots at ${LIVE_INDEX_MAX_ROOTS} (LRU)`, async () => {
    invalidateLiveIndex();
    const extra: string[] = [];
    try {
      await getLiveIndex(tmpDir);
      for (let i = 0; i < LIVE_INDEX_MAX_ROOTS; i++) {
        const d = fs.mkdtempSync(path.join(os.tmpdir(), 'live-index-lru-'));
        fs.writeFileSync(path.join(d, '.purpose'), `description: r${i}\n`);
        extra.push(d);
        // Touch tmpDir after the first extra root so it stays most-recent-but-one.
        await getLiveIndex(d);
        if (i === 0) await getLiveIndex(tmpDir);
      }
      expect(liveIndexRootCount()).toBe(LIVE_INDEX_MAX_ROOTS);
      // extra[0] was least recently used → evicted (cold re-parse); tmpDir survived.
      expect((await getLiveIndex(tmpDir)).stats.rebuilt).toBe(false);
      expect((await getLiveIndex(extra[0])).stats.rebuilt).toBe(true);
      expect(liveIndexRootCount()).toBe(LIVE_INDEX_MAX_ROOTS);
    } finally {
      for (const d of extra) {
        invalidateLiveIndex(d);
        fs.rmSync(d, { recursive: true, force: true });
      }
    }
  });

  it('cold equivalence: the cached result equals a cold aggregateFromDirectory', async () => {
    await getLiveIndex(tmpDir);
    await expectMatchesCold();
  });

  it('reflects an edited .purpose, re-parsing only that file', async () => {
    await getLiveIndex(tmpDir);
    const abs = write('a/.purpose', 'components:\n  beta:\n    description: Beta RENAMED and longer\n');
    bumpMtime(abs);

    const live = await getLiveIndex(tmpDir);
    expect(live.stats.rebuilt).toBe(true);
    expect(live.stats.parsedFiles).toBe(1);
    const beta = [...live.index.entries.values()].find((e) => e.symbol === '#beta');
    expect(beta?.description).toBe('Beta RENAMED and longer');
    await expectMatchesCold();
  });

  it('touch without content change rebuilds nothing new (hash reuse, zero parses)', async () => {
    await getLiveIndex(tmpDir);
    bumpMtime(path.join(tmpDir, 'b/.purpose'));
    const live = await getLiveIndex(tmpDir);
    expect(live.stats.parsedFiles).toBe(0);
    await expectMatchesCold();
  });

  it('reflects an added .purpose', async () => {
    await getLiveIndex(tmpDir);
    write('c/deep/.purpose', 'components:\n  delta:\n    description: Delta\n');
    const live = await getLiveIndex(tmpDir);
    expect(live.stats.parsedFiles).toBe(1);
    expect([...live.index.entries.values()].some((e) => e.symbol === '#delta')).toBe(true);
    await expectMatchesCold();
  });

  it('reflects a deleted .purpose', async () => {
    await getLiveIndex(tmpDir);
    fs.rmSync(path.join(tmpDir, 'b/.purpose'));
    const live = await getLiveIndex(tmpDir);
    expect(live.stats.rebuilt).toBe(true);
    expect(live.stats.parsedFiles).toBe(0);
    expect([...live.index.entries.values()].some((e) => e.symbol === '#gamma')).toBe(false);
    await expectMatchesCold();
  });

  it('reflects a portal.yaml change', async () => {
    await getLiveIndex(tmpDir);
    const abs = write(
      'portal.yaml',
      'version: "2.0"\ngates:\n  auth:\n    description: Auth gate\n    prizes: []\n  admin:\n    description: Admin gate\n    prizes: []\n',
    );
    bumpMtime(abs);
    const live = await getLiveIndex(tmpDir);
    expect(live.stats.rebuilt).toBe(true);
    expect([...live.index.entries.values()].some((e) => e.symbol === '^admin')).toBe(true);
    await expectMatchesCold();
  });

  it('keeps cold duplicate-symbol resolution + order (depth, then repo-relative path)', async () => {
    // Same symbol at the same depth in two dirs: last-write-wins must follow the
    // relpath sort (z/ after m/), never cache-insertion order.
    write('z/.purpose', 'components:\n  dup:\n    description: from z\n');
    await getLiveIndex(tmpDir);
    write('m/.purpose', 'components:\n  dup:\n    description: from m\n');
    const live = await getLiveIndex(tmpDir);
    const dup = [...live.index.entries.values()].find((e) => e.symbol === '#dup');
    expect(dup?.description).toBe('from z');
    const rel = live.result.purposeFiles.map((f) => path.relative(tmpDir, f));
    expect(rel).toEqual(['.purpose', 'a/.purpose', 'b/.purpose', 'm/.purpose', 'z/.purpose']);
    await expectMatchesCold();
  });

  it('invalidateLiveIndex forces a full cold re-parse', async () => {
    await getLiveIndex(tmpDir);
    invalidateLiveIndex(tmpDir);
    const live = await getLiveIndex(tmpDir);
    expect(live.stats.rebuilt).toBe(true);
    expect(live.stats.parsedFiles).toBe(3);
  });

  it('concurrent callers share one refresh', async () => {
    const [a, b] = await Promise.all([getLiveIndex(tmpDir), getLiveIndex(tmpDir)]);
    expect(a.index).toBe(b.index);
  });

  it('loadLiveGraph returns the same LiveGraph while nothing changed, a new one after an edit', async () => {
    const g1 = await loadLiveGraph(tmpDir);
    const g2 = await loadLiveGraph(tmpDir);
    expect(g2).toBe(g1);
    write('c/.purpose', 'components:\n  epsilon:\n    description: Epsilon\n');
    const g3 = await loadLiveGraph(tmpDir);
    expect(g3).not.toBe(g1);
    expect(g3.allSymbols).toContain('#epsilon');
  });

  it('search over a cached index sees in-place entry mutations (haystack revalidation)', async () => {
    const live = await getLiveIndex(tmpDir);
    expect(searchSymbols(live.index, 'zebra')).toHaveLength(0);
    const gamma = [...live.index.entries.values()].find((e) => e.symbol === '#gamma')!;
    const original = gamma.description;
    gamma.description = 'now mentions zebra';
    try {
      expect(searchSymbols(live.index, 'zebra').map((e) => e.symbol)).toEqual(['#gamma']);
    } finally {
      gamma.description = original;
    }
  });
});
