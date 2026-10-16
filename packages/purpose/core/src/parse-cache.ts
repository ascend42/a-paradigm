/**
 * #purpose-parse-cache — per-file memo of parsed .purpose files.
 *
 * Keyed by ABSOLUTE path → { mtimeMs, size, sha1, data, errors }.
 *
 *   - Fast path: stat() only. If mtimeMs AND size match the cached stamp, the
 *     cached parse is returned without reading the file — UNLESS the mtime is
 *     within RECENT_MTIME_WINDOW_MS of now: a same-size edit inside one mtime
 *     tick would keep the stamp, so recent files are always read and hashed.
 *   - Stamp changed: the file is read and sha1-hashed. If the hash matches the
 *     cached one (touch / checkout that rewrote identical bytes) the stamp is
 *     refreshed and the cached parse reused. Otherwise it is re-parsed with the
 *     SAME pipeline as parsePurposeFileDetailed (parseRawPurposeFileContent).
 *
 * The cache never decides ORDER. getAllPurposeFilesCached takes its file list
 * from findPurposeFiles (depth-then-repo-relative-path sort — load-bearing for
 * Loom Merkle determinism, T-2026-06-13-011) and returns parses in exactly that
 * order.
 *
 * READ-ONLY CONTRACT: the returned `data` objects are shared across calls.
 * Callers must not mutate them (the premise aggregator only reads). Callers that
 * edit-and-serialize a .purpose file must keep using parsePurposeFile.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { PurposeFile } from './types.js';
import { parseRawPurposeFileContent } from './parser.js';
import { findPurposeFiles, type ParsedPurposeFile } from './aggregator.js';

/**
 * Files modified this recently are never trusted on (mtime, size) alone: two
 * same-size writes inside one filesystem mtime tick (coarse-granularity FSes,
 * fast agent edits) leave the stamp unchanged. They are content-hashed instead.
 */
export const RECENT_MTIME_WINDOW_MS = 2000;

/** True when `mtimeMs` is within RECENT_MTIME_WINDOW_MS of now (or in the future). */
export function isRecentMtime(mtimeMs: number, now: number = Date.now()): boolean {
  return now - mtimeMs < RECENT_MTIME_WINDOW_MS;
}

export interface PurposeParseCacheEntry {
  mtimeMs: number;
  size: number;
  sha1: string;
  data: PurposeFile | null;
  errors: string[];
}

export interface PurposeParseCacheStats {
  /** full YAML+Zod parses performed */
  parses: number;
  /** files read + hashed because their stat stamp changed */
  hashes: number;
  /** lookups served from the stat fast path */
  hits: number;
}

export interface CachedParseResult {
  data: PurposeFile | null;
  errors: string[];
  /** true when this call performed a full parse (not served from cache) */
  parsed: boolean;
}

export class PurposeParseCache {
  private readonly entries = new Map<string, PurposeParseCacheEntry>();
  readonly stats: PurposeParseCacheStats = { parses: 0, hashes: 0, hits: 0 };

  /** Number of cached files. */
  get size(): number {
    return this.entries.size;
  }

  /** Parse `filePath` (absolute or relative), reusing the cached parse when unchanged. */
  parse(filePath: string): CachedParseResult {
    const abs = path.resolve(filePath);

    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch (e: unknown) {
      this.entries.delete(abs);
      return { data: null, errors: [`Cannot read file: ${(e as Error).message}`], parsed: false };
    }

    const cached = this.entries.get(abs);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size && !isRecentMtime(stat.mtimeMs)) {
      this.stats.hits++;
      return { data: cached.data, errors: cached.errors, parsed: false };
    }

    let raw: string;
    try {
      raw = fs.readFileSync(abs, 'utf8');
    } catch (e: unknown) {
      this.entries.delete(abs);
      return { data: null, errors: [`Cannot read file: ${(e as Error).message}`], parsed: false };
    }

    this.stats.hashes++;
    const sha1 = createHash('sha1').update(raw).digest('hex');
    if (cached && cached.sha1 === sha1) {
      cached.mtimeMs = stat.mtimeMs;
      cached.size = stat.size;
      return { data: cached.data, errors: cached.errors, parsed: false };
    }

    this.stats.parses++;
    const result = parseRawPurposeFileContent(raw);
    this.entries.set(abs, {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      sha1,
      data: result.data,
      errors: result.errors,
    });
    return { data: result.data, errors: result.errors, parsed: true };
  }

  /** Drop entries whose path is not in `keep` (deleted / newly-ignored files). */
  prune(keep: Iterable<string>): void {
    const keepSet = new Set<string>();
    for (const p of keep) keepSet.add(path.resolve(p));
    for (const key of [...this.entries.keys()]) {
      if (!keepSet.has(key)) this.entries.delete(key);
    }
  }

  /** Drop one file, or everything when called without an argument. */
  invalidate(filePath?: string): void {
    if (filePath === undefined) {
      this.entries.clear();
      return;
    }
    this.entries.delete(path.resolve(filePath));
  }
}

/**
 * Parse an already-discovered, already-ORDERED list of .purpose files through
 * the cache. Output order === input order. Mirrors getAllPurposeFiles: files
 * whose parse yields `data === null` are skipped; schema warnings are reported
 * once, when the file is actually (re)parsed.
 */
export function parsePurposeFilesCached(
  files: readonly string[],
  cache: PurposeParseCache,
): ParsedPurposeFile[] {
  const parsed: ParsedPurposeFile[] = [];
  for (const filePath of files) {
    const { data, errors, parsed: fresh } = cache.parse(filePath);
    if (data) {
      parsed.push({ filePath, data });
      if (fresh && errors.length > 0) {
        console.warn(`Warnings parsing ${filePath}:`, errors);
      }
    }
  }
  return parsed;
}

/**
 * Cached counterpart of getAllPurposeFiles: same discovery (findPurposeFiles —
 * same ignore list, same depth-then-relpath order), cached per-file parse.
 * Does not prune: one cache may serve several roots. Call cache.prune() with
 * the full live file set when a root owns the cache.
 */
export async function getAllPurposeFilesCached(
  rootDir: string,
  cache: PurposeParseCache,
): Promise<ParsedPurposeFile[]> {
  const files = await findPurposeFiles(rootDir);
  return parsePurposeFilesCached(files, cache);
}
