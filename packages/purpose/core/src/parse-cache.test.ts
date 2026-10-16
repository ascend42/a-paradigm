/**
 * Tests for #purpose-parse-cache and DEFAULT_PURPOSE_IGNORE.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PurposeParseCache, getAllPurposeFilesCached, isRecentMtime, RECENT_MTIME_WINDOW_MS } from './parse-cache.js';
import { findPurposeFiles, getAllPurposeFiles, DEFAULT_PURPOSE_IGNORE } from './aggregator.js';
import { parsePurposeFile } from './parser.js';

let tmpDir: string;

function write(rel: string, content: string): string {
  const abs = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

function bumpMtime(abs: string): void {
  const st = fs.statSync(abs);
  const t = new Date(st.mtimeMs + 5000);
  fs.utimesSync(abs, t, t);
}

/** Push mtime well outside the recent-edit window so the stat fast path applies. */
function age(abs: string, seconds = 60): void {
  const t = new Date(Date.now() - seconds * 1000);
  fs.utimesSync(abs, t, t);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parse-cache-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('#purpose-parse-cache', () => {
  it('parses once, then serves from the stat fast path', () => {
    const f = write('.purpose', 'components:\n  a:\n    description: A\n');
    age(f);
    const cache = new PurposeParseCache();
    const first = cache.parse(f);
    expect(first.parsed).toBe(true);
    const second = cache.parse(f);
    expect(second.parsed).toBe(false);
    expect(second.data).toBe(first.data);
    expect(cache.stats).toEqual({ parses: 1, hashes: 1, hits: 1 });
  });

  it('same-size edit within one mtime tick is caught by hashing recent files', () => {
    const f = write('.purpose', 'components:\n  a:\n    description: AAAA\n');
    const pinned = new Date(Date.now() - 500); // recent: inside the 2s window
    fs.utimesSync(f, pinned, pinned);
    const cache = new PurposeParseCache();
    expect(cache.parse(f).parsed).toBe(true);
    // Same size, same mtime — only the bytes differ.
    fs.writeFileSync(f, 'components:\n  a:\n    description: BBBB\n');
    fs.utimesSync(f, pinned, pinned);
    const next = cache.parse(f);
    expect(next.parsed).toBe(true);
    expect((next.data?.components as Record<string, { description: string }>).a.description).toBe('BBBB');
    // Unchanged recent file: hashed again, parse reused, no fast-path hit.
    const again = cache.parse(f);
    expect(again.parsed).toBe(false);
    expect(cache.stats).toEqual({ parses: 2, hashes: 3, hits: 0 });
  });

  it('isRecentMtime: inside the window (and future) is recent; older is not', () => {
    const now = 1_000_000;
    expect(isRecentMtime(now - (RECENT_MTIME_WINDOW_MS - 1), now)).toBe(true);
    expect(isRecentMtime(now + 5000, now)).toBe(true);
    expect(isRecentMtime(now - RECENT_MTIME_WINDOW_MS, now)).toBe(false);
  });

  it('produces the same data as parsePurposeFile (incl. #Key shorthand normalization)', () => {
    const f = write('.purpose', '"#Widget":\n  description: A widget\nsignals:\n  ping: Pinged\n');
    const cache = new PurposeParseCache();
    expect(cache.parse(f).data).toEqual(parsePurposeFile(f).data);
  });

  it('re-hashes on mtime change and reuses the parse when bytes are identical', () => {
    const f = write('.purpose', 'components:\n  a:\n    description: A\n');
    const cache = new PurposeParseCache();
    const first = cache.parse(f);
    bumpMtime(f);
    const again = cache.parse(f);
    expect(again.parsed).toBe(false);
    expect(again.data).toBe(first.data);
    expect(cache.stats.parses).toBe(1);
    expect(cache.stats.hashes).toBe(2);
  });

  it('re-parses when content changes', () => {
    const f = write('.purpose', 'components:\n  a:\n    description: A\n');
    const cache = new PurposeParseCache();
    cache.parse(f);
    write('.purpose', 'components:\n  a:\n    description: A changed\n');
    bumpMtime(f);
    const next = cache.parse(f);
    expect(next.parsed).toBe(true);
    expect((next.data?.components as Record<string, { description: string }>).a.description).toBe('A changed');
  });

  it('reports a missing file like parsePurposeFile and drops its entry', () => {
    const f = write('.purpose', 'description: x\n');
    const cache = new PurposeParseCache();
    cache.parse(f);
    fs.rmSync(f);
    const gone = cache.parse(f);
    expect(gone.data).toBeNull();
    expect(gone.errors[0]).toMatch(/^Cannot read file:/);
    expect(cache.size).toBe(0);
  });

  it('prune drops files outside the keep set', () => {
    const a = write('a/.purpose', 'description: a\n');
    const b = write('b/.purpose', 'description: b\n');
    const cache = new PurposeParseCache();
    cache.parse(a);
    cache.parse(b);
    cache.prune([a]);
    expect(cache.size).toBe(1);
  });

  it('getAllPurposeFilesCached equals getAllPurposeFiles, same order', async () => {
    write('.purpose', 'description: root\n');
    write('z/.purpose', 'components:\n  dup:\n    description: z\n');
    write('m/.purpose', 'components:\n  dup:\n    description: m\n');
    write('m/deep/.purpose', 'description: deep\n');
    const cache = new PurposeParseCache();
    const cached = await getAllPurposeFilesCached(tmpDir, cache);
    const cold = await getAllPurposeFiles(tmpDir);
    expect(cached).toEqual(cold);
    const again = await getAllPurposeFilesCached(tmpDir, cache);
    expect(again).toEqual(cold);
    expect(cache.stats.parses).toBe(4);
  });
});

describe('DEFAULT_PURPOSE_IGNORE', () => {
  it('keeps the historical three and adds build/worktree output', () => {
    for (const p of ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/.next/**', '**/build/**', '**/.worktrees/**']) {
      expect(DEFAULT_PURPOSE_IGNORE).toContain(p);
    }
  });

  it('findPurposeFiles skips ignored dirs and keeps depth-then-relpath order', async () => {
    write('.purpose', 'description: root\n');
    write('b/.purpose', 'description: b\n');
    write('a/.purpose', 'description: a\n');
    write('a/x/.purpose', 'description: ax\n');
    write('packages/site/.next/standalone/.purpose', 'description: stale\n');
    write('pkg/build/.purpose', 'description: built\n');
    write('ios/Pods/Foo/.purpose', 'description: pod\n');
    write('coverage/.purpose', 'description: cov\n');
    const rel = (await findPurposeFiles(tmpDir)).map((f) => path.relative(tmpDir, f));
    expect(rel).toEqual(['.purpose', 'a/.purpose', 'b/.purpose', 'a/x/.purpose']);
  });
});
