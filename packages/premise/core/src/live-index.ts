/**
 * #live-index — incremental, in-process cache of the LIVE symbol index.
 *
 * getLiveIndex(rootDir) is a drop-in for
 *   buildSymbolIndex(await aggregateFromDirectory(rootDir))
 * that avoids re-parsing an unchanged project:
 *
 *   1. discover: findPurposeFiles + findGateFiles (the SAME globs, ignore lists
 *      and deterministic sort the cold path uses);
 *   2. stat every discovered file;
 *   3. if the ordered (path, mtimeMs, size) list for .purpose AND portal files is
 *      identical to the last build → return the cached SymbolIndex (same object);
 *   4. otherwise re-parse only changed .purpose files (#purpose-parse-cache),
 *      re-aggregate the FULL file set in discovery order from the cached parses,
 *      and rebuild the index.
 *
 * DETERMINISM: the cache never orders anything. File order always comes from
 * findPurposeFiles (depth, then repo-relative path — T-2026-06-13-011, Loom
 * Merkle determinism) and findGateFiles; aggregation runs over the full list
 * every rebuild, so duplicate-symbol last-write-wins resolution is identical to
 * a cold parse.
 *
 * READ-ONLY: the returned index (and entry.data objects) are shared between
 * callers until the next change. Do not mutate them.
 *
 * RECENT FILES: a file whose mtime is within 2s of now is stamped with a
 * content sha1 too, so a same-size edit inside one mtime tick still rebuilds.
 *
 * BOUNDED: at most LIVE_INDEX_MAX_ROOTS (8) roots are kept, LRU-evicted.
 *
 * invalidateLiveIndex(rootDir) drops everything for a root (paradigm_reindex
 * calls it); invalidateLiveIndex() drops all roots.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  findPurposeFiles,
  isRecentMtime,
  parsePurposeFilesCached,
  PurposeParseCache,
} from '@a-company/purpose-core';
import { findGateFiles } from '@a-company/portal-core';
import { aggregateFromDirectory, INDEX_DISCOVERY } from './aggregator.js';
import { buildSymbolIndex } from './symbol-index.js';
import type { AggregationResult, SymbolIndex } from './types.js';

export interface LiveIndex {
  /** The live symbol index (same object across calls while nothing changed). */
  index: SymbolIndex;
  /** The aggregation result the index was built from. */
  result: AggregationResult;
  /** Parse time of this index (ISO). Unchanged on cache hits. */
  generatedAt: string;
  /** Per-call diagnostics. */
  stats: LiveIndexCallStats;
}

export interface LiveIndexCallStats {
  /** true when this call rebuilt the index (first call or something changed). */
  rebuilt: boolean;
  /** .purpose files fully (re)parsed during this call. */
  parsedFiles: number;
  /** .purpose files discovered. */
  purposeFiles: number;
  /** portal files discovered. */
  portalFiles: number;
}

interface Stamp {
  path: string;
  mtimeMs: number;
  size: number;
  /** sha1 of the content — only for files whose mtime is within the recent window. */
  sha1?: string;
}

interface RootState {
  parseCache: PurposeParseCache;
  purposeStamps: Stamp[] | null;
  portalStamps: Stamp[] | null;
  index: SymbolIndex | null;
  result: AggregationResult | null;
  generatedAt: string;
  inflight: Promise<LiveIndex> | null;
}

/** Per-root states kept (LRU). Long-lived servers touching many roots stay bounded. */
export const LIVE_INDEX_MAX_ROOTS = 8;

/** Insertion order = recency (Map iteration order); most-recent last. */
const roots = new Map<string, RootState>();

/** Number of roots currently cached (diagnostics / tests). */
export function liveIndexRootCount(): number {
  return roots.size;
}

function stateFor(absRoot: string): RootState {
  let state = roots.get(absRoot);
  if (state) {
    roots.delete(absRoot);
    roots.set(absRoot, state);
  } else {
    state = {
      parseCache: new PurposeParseCache(),
      purposeStamps: null,
      portalStamps: null,
      index: null,
      result: null,
      generatedAt: '',
      inflight: null,
    };
    roots.set(absRoot, state);
    // Evict least-recently-used roots, skipping any with a refresh in flight.
    for (const [key, st] of roots) {
      if (roots.size <= LIVE_INDEX_MAX_ROOTS) break;
      if (key !== absRoot && !st.inflight) roots.delete(key);
    }
  }
  return state;
}

function stampAll(files: readonly string[]): Stamp[] {
  const out: Stamp[] = [];
  for (const p of files) {
    try {
      const st = fs.statSync(p);
      const stamp: Stamp = { path: p, mtimeMs: st.mtimeMs, size: st.size };
      // Same-size edits inside one mtime tick keep (mtime, size): hash recent files.
      if (isRecentMtime(st.mtimeMs)) {
        stamp.sha1 = createHash('sha1').update(fs.readFileSync(p)).digest('hex');
      }
      out.push(stamp);
    } catch {
      // Vanished between glob and stat — a sentinel stamp that never matches a
      // real one, so the next call re-checks.
      out.push({ path: p, mtimeMs: -1, size: -1 });
    }
  }
  return out;
}

function sameStamps(a: Stamp[] | null, b: Stamp[]): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.path !== y.path || x.mtimeMs !== y.mtimeMs || x.size !== y.size || x.sha1 !== y.sha1) return false;
  }
  return true;
}

async function refresh(absRoot: string, state: RootState): Promise<LiveIndex> {
  const [purposeFiles, portalFiles] = await Promise.all([
    findPurposeFiles(absRoot, INDEX_DISCOVERY),
    findGateFiles(absRoot),
  ]);
  const purposeStamps = stampAll(purposeFiles);
  const portalStamps = stampAll(portalFiles);

  const baseStats = { purposeFiles: purposeFiles.length, portalFiles: portalFiles.length };

  if (
    state.index &&
    state.result &&
    sameStamps(state.purposeStamps, purposeStamps) &&
    sameStamps(state.portalStamps, portalStamps)
  ) {
    return {
      index: state.index,
      result: state.result,
      generatedAt: state.generatedAt,
      stats: { rebuilt: false, parsedFiles: 0, ...baseStats },
    };
  }

  const cache = state.parseCache;
  const parsesBefore = cache.stats.parses;
  cache.prune(purposeFiles);

  // Re-aggregate the FULL set in discovery order. Only the root source is
  // pre-globbed; any other source path falls back to a cached walk of its own.
  const result = await aggregateFromDirectory(absRoot, {
    loadPurposeFiles: async (sourcePath) =>
      parsePurposeFilesCached(
        path.resolve(sourcePath) === absRoot ? purposeFiles : await findPurposeFiles(sourcePath, INDEX_DISCOVERY),
        cache,
      ),
    findPortalFiles: async (sourcePath) =>
      path.resolve(sourcePath) === absRoot ? portalFiles : findGateFiles(sourcePath),
  });
  const index = buildSymbolIndex(result);

  state.purposeStamps = purposeStamps;
  state.portalStamps = portalStamps;
  state.index = index;
  state.result = result;
  state.generatedAt = new Date(result.timestamp).toISOString();

  return {
    index,
    result,
    generatedAt: state.generatedAt,
    stats: { rebuilt: true, parsedFiles: cache.stats.parses - parsesBefore, ...baseStats },
  };
}

/**
 * Return the live SymbolIndex for `rootDir`, rebuilding only when a .purpose or
 * portal file was added, removed, or changed (path / mtime / size). Concurrent
 * callers for the same root share one in-flight refresh.
 */
export async function getLiveIndex(rootDir: string): Promise<LiveIndex> {
  const absRoot = path.resolve(rootDir);
  const state = stateFor(absRoot);
  if (state.inflight) return state.inflight;
  const p = refresh(absRoot, state);
  state.inflight = p;
  try {
    return await p;
  } finally {
    if (state.inflight === p) state.inflight = null;
  }
}

/**
 * Drop the cached index + per-file parses for `rootDir`, or for every root when
 * called with no argument. The next getLiveIndex call is a cold parse.
 */
export function invalidateLiveIndex(rootDir?: string): void {
  if (rootDir === undefined) {
    roots.clear();
    return;
  }
  roots.delete(path.resolve(rootDir));
}
