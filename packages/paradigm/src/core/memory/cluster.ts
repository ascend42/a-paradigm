/**
 * #memory-steward-cluster — near-duplicate detection for the Memory Steward
 * (Memory Steward A1, TD-2026-09-19-110). Pure, deterministic, NO LLM.
 *
 * Two entries are "near-duplicate" when their bodies share a large fraction of
 * tokens (normalized-token Jaccard ≥ threshold). We union such pairs into
 * clusters and hand each clustered entry a stable clusterId so `deriveFinding`
 * can suggest a `merge`. Entries with no near-duplicate are simply absent from
 * the returned map.
 */

import type { ParsedMemoryEntry } from '@a-company/premise-core';

/** Jaccard threshold above which two bodies count as near-duplicates. */
const DEFAULT_THRESHOLD = 0.6;

/** Tokens shorter than this are dropped as noise. */
const MIN_TOKEN_LEN = 3;

export interface ClusterOptions {
  /** Override the Jaccard similarity threshold (0..1). Test seam. */
  threshold?: number;
}

/**
 * Cluster entries by body near-duplication. Returns a Map from each clustered
 * entry's `file` to a deterministic `clusterId`. Singletons are omitted.
 */
export function clusterEntries(
  entries: ParsedMemoryEntry[],
  opts: ClusterOptions = {},
): Map<string, string> {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const result = new Map<string, string>();
  const n = entries.length;
  if (n < 2) return result;

  const tokenSets = entries.map((e) => tokenize(e.body));

  // Union-find over entry indices.
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    // path compression
    let c = x;
    while (parent[c] !== c) {
      const next = parent[c];
      parent[c] = r;
      c = next;
    }
    return r;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (jaccard(tokenSets[i], tokenSets[j]) >= threshold) {
        union(i, j);
      }
    }
  }

  // Group indices by root; keep only clusters of size >= 2.
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  }

  for (const members of groups.values()) {
    if (members.length < 2) continue;
    // Deterministic id: the lexicographically-smallest member file basename.
    const files = members.map((i) => entries[i].file).sort();
    const clusterId = `dup:${basename(files[0])}`;
    for (const idx of members) {
      result.set(entries[idx].file, clusterId);
    }
  }

  return result;
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** Normalize a body into a set of lowercase, length-filtered word tokens. */
function tokenize(body: string): Set<string> {
  const set = new Set<string>();
  for (const raw of body.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= MIN_TOKEN_LEN) set.add(raw);
  }
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of small) if (large.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function basename(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}
