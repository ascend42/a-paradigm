/**
 * consistency-tracker — records round-trip transformation CLASSES during
 * indexing so reindex can surface them in the consistency manifest.
 *
 * Security guardrails (non-negotiable, per 2026-04-22 security audit §4c):
 *   - Each recorded transformation captures a FIXED `kind` classifier + a
 *     FIXED `surface` classifier (file classifier, e.g. "portal.yaml") + a
 *     numeric count.
 *   - It MUST NEVER capture gate names, route paths, file paths (only
 *     classifier strings), regex content, or any user data.
 *   - The manifest is written to `.paradigm/manifest.consistency.json` and
 *     embedded in the `paradigm_reindex` response envelope. Both surfaces
 *     are downstream of this module; content redaction is enforced here.
 *
 * The tracker is intended to be ONE injectable singleton per reindex pass.
 * Call sites `record()` a transformation; at the end, `report()` aggregates.
 */

import { isStrictMode } from './strict-mode.js';

export type ConsistencyTransformKind =
  | 'prefix-stripped'
  | 'array-coerced'
  | 'default-applied'
  | 'duplicate-key-detected'
  | 'case-normalized';

/**
 * A transformation classifier. NO content: `kind` + `surface` are fixed
 * enum strings, and `count` is a number.
 */
export interface ConsistencyTransform {
  kind: ConsistencyTransformKind;
  /**
   * Short file classifier — e.g. `'portal.yaml'`, `'purpose.yaml'`,
   * `'scan-index.json'`. NEVER a user route, gate id, or absolute path.
   */
  surface: string;
  count: number;
}

export interface ConsistencyReport {
  reindex_ts: string;
  transformations: ConsistencyTransform[];
  /**
   * Count of transformations that are lossy (would error under strict mode).
   * v5.38.0: all transformations are non-lossy by default; `duplicate-key-detected`
   * is lossy because js-yaml silently keeps the last value.
   */
  lossy_count: number;
  strict_mode: boolean;
}

/**
 * Transformations classified as lossy (would error in strict mode).
 * Lossy = information was silently dropped or ambiguity silently resolved.
 */
const LOSSY_KINDS = new Set<ConsistencyTransformKind>([
  'duplicate-key-detected',
]);

/**
 * Sanitize a surface classifier. Guardrail against accidental leakage:
 * strips anything that looks like a path (contains `/` or `\`) and
 * truncates to a fixed length.
 */
function sanitizeSurface(surface: string): string {
  // Strip leading/trailing whitespace
  let s = surface.trim();
  // If it looks like a path, keep only the basename
  if (s.includes('/') || s.includes('\\')) {
    const parts = s.split(/[/\\]/);
    s = parts[parts.length - 1] || 'unknown';
  }
  // Hard cap length — no classifier we use should exceed 40 chars
  if (s.length > 40) s = s.slice(0, 40);
  return s || 'unknown';
}

/**
 * Tracker for consistency transformations. Pass one instance through the
 * reindex call graph; each loader records transformations it applied.
 */
export class ConsistencyTracker {
  private transforms: Map<string, ConsistencyTransform> = new Map();

  /**
   * Record a transformation. If a matching (kind, surface) pair already
   * exists, increments the count; otherwise creates a new entry.
   */
  record(kind: ConsistencyTransformKind, surface: string, count = 1): void {
    const safeSurface = sanitizeSurface(surface);
    const key = `${kind}::${safeSurface}`;
    const existing = this.transforms.get(key);
    if (existing) {
      existing.count += count;
    } else {
      this.transforms.set(key, { kind, surface: safeSurface, count });
    }
  }

  /**
   * Build the report. Called at the end of a reindex pass.
   */
  report(): ConsistencyReport {
    const transformations = Array.from(this.transforms.values()).sort((a, b) => {
      // Deterministic order: by kind, then by surface
      if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
      return a.surface.localeCompare(b.surface);
    });
    const lossy_count = transformations
      .filter(t => LOSSY_KINDS.has(t.kind))
      .reduce((sum, t) => sum + t.count, 0);
    return {
      reindex_ts: new Date().toISOString(),
      transformations,
      lossy_count,
      strict_mode: isStrictMode(),
    };
  }

  /**
   * Whether any lossy transformations were recorded. Used by strict mode
   * to decide whether to fail the reindex.
   */
  hasLossy(): boolean {
    for (const t of this.transforms.values()) {
      if (LOSSY_KINDS.has(t.kind)) return true;
    }
    return false;
  }

  /**
   * Total count across all transformations (lossy + non-lossy).
   */
  totalCount(): number {
    let total = 0;
    for (const t of this.transforms.values()) total += t.count;
    return total;
  }
}
