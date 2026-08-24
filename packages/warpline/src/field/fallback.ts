/**
 * #field-fallback — habit (iii): log every reach for the git fallback
 * (expo-field-test-protocol.md §6 habit (iii); field-test-readiness §B7).
 *
 * Any time an operator or agent drops to git to make progress — `git merge`, a
 * manual merge, `git stash` to escape a wedge, committing a resolution outside
 * Warpline, byte-only work unadmittable on the native path (audit B-1) — one
 * entry lands in `.warpline/field/git-fallback.jsonl`. Silent fallbacks are the
 * "tool was unaffordable" signal measured wrong in the flattering direction;
 * the protocol asks a LOG, not custody, so this is plain JSONL (no hash chain).
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface GitFallbackEntry {
  ts: string;
  actor: string;
  /** what was reached for and why — free prose, verbatim. */
  message: string;
  /** the KNOT this fallback relates to (payloadId / selector), when known. */
  knotId?: string;
  /** the admit this fallback relates to (ref / stateId / pickId), when known. */
  admitRef?: string;
}

export function gitFallbackPathOf(root: string): string {
  return path.join(root, '.warpline', 'field', 'git-fallback.jsonl');
}

export interface RecordGitFallbackInput {
  message: string;
  actor: string;
  knotId?: string;
  admitRef?: string;
  /** clock injection for deterministic tests. */
  now?: () => string;
}

/** Append one fallback entry. Returns the entry as written. */
export function recordGitFallback(root: string, input: RecordGitFallbackInput): GitFallbackEntry {
  if (!input.message || input.message.trim().length === 0) {
    throw new Error('warpline: field fallback — a fallback log entry needs a message (what was reached for, and why)');
  }
  const entry: GitFallbackEntry = {
    ts: (input.now ?? ((): string => new Date().toISOString()))(),
    actor: input.actor,
    message: input.message,
    ...(input.knotId ? { knotId: input.knotId } : {}),
    ...(input.admitRef ? { admitRef: input.admitRef } : {}),
  };
  const p = gitFallbackPathOf(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(entry) + '\n', 'utf8');
  return entry;
}

/** Every logged fallback, file order. [] when none have been recorded. */
export function listGitFallbacks(root: string): GitFallbackEntry[] {
  const p = gitFallbackPathOf(root);
  let raw: string;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(`warpline: git-fallback log unreadable at ${p}: ${(err as Error).message}`);
  }
  const out: GitFallbackEntry[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue;
    out.push(JSON.parse(line) as GitFallbackEntry); // a torn log line surfaces, never silently drops
  }
  return out;
}
