/**
 * spill-and-handle — the generic large-output primitive (#spill).
 *
 * Some tool outputs are unboundedly large: a full symbol graph, a worktree
 * `admit`'s changed-symbol set (measured at 4.4 MB in the field —
 * T-2026-07-17-009), an agent transcript. Dumping the whole array into a
 * response wastes the reader's context and, in the worst case, is unusable.
 *
 * The pattern generalized here (first shipped for `paradigm_graph_generate`,
 * which always spills to `.paradigm/graphs/`): when a payload exceeds a byte
 * threshold, write the FULL payload to `<spill-dir>/{handle}.json` and return a
 * BOUNDED preview (top-N items for an array, or a byte-clipped string preview)
 * plus the handle + path + total. The spill is LOSSLESS — the complete data is
 * on disk and rehydrated verbatim via {@link retrieveSpilled} (the
 * `paradigm_retrieve` MCP tool).
 *
 * This module is pure I/O over a caller-supplied directory: it never assumes a
 * project layout beyond the dir it is handed. Use {@link spillDirFor} for the
 * canonical `<root>/.paradigm/spill` location so a spill written by one surface
 * (e.g. `warpline admit`) is retrievable by `paradigm_retrieve` in the same
 * repo.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Default byte threshold (~2k tokens at 4 chars/token). Above it, we spill. */
export const DEFAULT_SPILL_THRESHOLD = 8192;

/** Default number of leading array items kept in the bounded preview. */
export const DEFAULT_SPILL_PREVIEW = 20;

export interface SpillOptions {
  /** Logical kind label — becomes the handle prefix (e.g. 'admit-changed', 'transcript'). */
  kind: string;
  /** Absolute directory to write spill files into (e.g. `<root>/.paradigm/spill`). */
  dir: string;
  /** Byte threshold on the serialized payload; at or below it we keep the payload inline. */
  threshold?: number;
  /** How many leading items to keep in the preview for array payloads. */
  previewCount?: number;
}

export interface SpillResult {
  /** true when the payload exceeded the threshold and the full data was written to disk. */
  spilled: boolean;
  /** Short id to retrieve the full payload; null when kept inline. */
  handle: string | null;
  /** Absolute path to the spilled JSON; null when kept inline. */
  path: string | null;
  /** Total item count for arrays; serialized byte length otherwise. */
  total: number;
  /** Bounded preview: top-N items for arrays, the full payload when inline, else a clipped string. */
  truncatedPreview: unknown;
  /** One-line human summary of what happened. */
  summary: string;
}

export interface RetrieveOptions {
  /** The spill directory the handle lives in (e.g. `<root>/.paradigm/spill`). */
  dir: string;
  /** For array payloads: start index of the returned window (default 0). */
  offset?: number;
  /** For array payloads: max items to return from `offset` (default: to the end). */
  limit?: number;
}

export interface RetrieveResult {
  found: boolean;
  handle: string;
  path: string | null;
  /** Array length when the payload is an array; null otherwise. */
  total: number | null;
  /** Full payload, or — for an array with offset/limit — the requested window. */
  payload: unknown;
  /** Window descriptor when a slice was applied; null otherwise. */
  window: { offset: number; limit: number; returned: number } | null;
  error?: string;
}

/** Canonical spill directory for a project root. */
export function spillDirFor(root: string): string {
  return path.join(root, '.paradigm', 'spill');
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'spill'
  );
}

/** A short, filesystem-safe, collision-resistant handle. */
function makeHandle(kind: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${slug(kind)}-${Date.now().toString(36)}-${rand}`;
}

function clip(json: string, threshold: number): string {
  if (json.length <= threshold) return json;
  return `${json.slice(0, threshold)}… [clipped — full payload spilled]`;
}

/**
 * Spill a payload to disk when it exceeds the byte threshold; otherwise keep it
 * inline. Arrays get a top-N preview + total count; other payloads get a
 * byte-clipped preview. The write is atomic-per-file (one JSON per handle).
 */
export function spillLargeOutput(payload: unknown, opts: SpillOptions): SpillResult {
  const threshold = opts.threshold ?? DEFAULT_SPILL_THRESHOLD;
  const previewCount = opts.previewCount ?? DEFAULT_SPILL_PREVIEW;
  const isArray = Array.isArray(payload);
  const arr = payload as unknown[];
  const json = JSON.stringify(payload);
  const bytes = Buffer.byteLength(json ?? 'null', 'utf8');

  if (bytes <= threshold) {
    const total = isArray ? arr.length : bytes;
    return {
      spilled: false,
      handle: null,
      path: null,
      total,
      truncatedPreview: payload,
      summary: isArray
        ? `${arr.length} item${arr.length === 1 ? '' : 's'} (${fmtBytes(bytes)}) — inline`
        : `${fmtBytes(bytes)} — inline`,
    };
  }

  const handle = makeHandle(opts.kind);
  fs.mkdirSync(opts.dir, { recursive: true });
  const outPath = path.join(opts.dir, `${handle}.json`);
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');

  const shown = isArray ? Math.min(previewCount, arr.length) : 0;
  const preview = isArray ? arr.slice(0, previewCount) : clip(json, threshold);

  return {
    spilled: true,
    handle,
    path: outPath,
    total: isArray ? arr.length : bytes,
    truncatedPreview: preview,
    summary: isArray
      ? `${arr.length} item${arr.length === 1 ? '' : 's'} (${fmtBytes(bytes)}) — showing first ${shown}; full set spilled to handle ${handle} (paradigm_retrieve)`
      : `${fmtBytes(bytes)} spilled to handle ${handle} (paradigm_retrieve)`,
  };
}

/**
 * Rehydrate a spilled payload from its handle. For array payloads an optional
 * offset/limit returns a window; otherwise the full payload is returned. The
 * handle is validated to prevent path traversal.
 */
export function retrieveSpilled(handle: string, opts: RetrieveOptions): RetrieveResult {
  const base = (h: Partial<RetrieveResult> = {}): RetrieveResult => ({
    found: false,
    handle,
    path: null,
    total: null,
    payload: null,
    window: null,
    ...h,
  });

  if (typeof handle !== 'string' || !/^[A-Za-z0-9._-]+$/.test(handle) || handle.includes('..')) {
    return base({ error: 'invalid handle' });
  }

  const p = path.join(opts.dir, `${handle}.json`);
  if (!fs.existsSync(p)) {
    return base({ path: p, error: 'handle not found (spill may have been cleared)' });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    return base({ path: p, error: `failed to parse spill: ${(err as Error).message}` });
  }

  if (Array.isArray(payload) && (opts.offset != null || opts.limit != null)) {
    const offset = Math.max(0, opts.offset ?? 0);
    const limit = Math.max(0, opts.limit ?? payload.length);
    const win = payload.slice(offset, offset + limit);
    return {
      found: true,
      handle,
      path: p,
      total: payload.length,
      payload: win,
      window: { offset, limit, returned: win.length },
    };
  }

  return {
    found: true,
    handle,
    path: p,
    total: Array.isArray(payload) ? payload.length : null,
    payload,
    window: null,
  };
}
