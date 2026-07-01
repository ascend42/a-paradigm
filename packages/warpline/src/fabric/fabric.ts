/**
 * #fabric — the durable Warpline history of this project. The append-only
 * PICK-DAG ledger (`.warpline/fabric.jsonl`) + the live tip pointer
 * (`.warpline/refs/selvage`).
 *
 * COEXISTENCE INVARIANT: the fabric writes ONLY under `.warpline/` — never the
 * user's git HEAD/index/worktree/tracked files. Git keeps running normally;
 * Warpline accumulates its OWN meaning-history alongside it. This is the same
 * disk boundary the read-only Phase-1 oracle already honored (~read-only),
 * extended from a debug cache into the authoritative store.
 *
 * The selvage publish is atomic (write-tmp + rename) so a crash never leaves a
 * half-written tip. The fabric append is line-atomic JSONL.
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Strand } from './strand.js';

/** The `.warpline/` dir for a repo root (same dir #warp-store writes under). */
export function warplineDirOf(root: string): string {
  return path.join(root, '.warpline');
}

function selvagePath(wdir: string): string {
  return path.join(wdir, 'refs', 'selvage');
}

function fabricPath(wdir: string): string {
  return path.join(wdir, 'fabric.jsonl');
}

/** The current tip stateId, or null if no pick has ever been sealed. */
export function readSelvage(wdir: string): string | null {
  try {
    return fs.readFileSync(selvagePath(wdir), 'utf8').trim() || null;
  } catch (err) {
    // ENOENT = never sealed (genuinely no tip). ANY other error (permission, I/O,
    // a selvage that exists but can't be read) must NOT masquerade as "no history"
    // — that would let a caller fast-admit a fresh genesis over a real tip. Fail closed.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(
      `warpline: selvage pointer unreadable at ${selvagePath(wdir)} — refusing to treat a corrupt tip as empty history: ${(err as Error).message}`,
    );
  }
}

/**
 * Advance the tip to `stateId` atomically (write-tmp + rename). When `expectedOld`
 * is supplied, this is a COMPARE-AND-SWAP: it throws if the on-disk selvage no
 * longer equals what the caller's decision was based on (a concurrent writer moved
 * it). Callers seal inside #fabric-lock; the CAS is defense-in-depth against a
 * stolen/stale lock so a lost-update can never silently publish a wrong tip.
 */
export function writeSelvage(wdir: string, stateId: string, expectedOld?: string | null): void {
  const p = selvagePath(wdir);
  if (expectedOld !== undefined) {
    const cur = readSelvage(wdir);
    if (cur !== expectedOld) {
      throw new Error(
        `warpline: selvage CAS failed — expected ${expectedOld ?? '(none)'}, found ${cur ?? '(none)'} (a concurrent writer advanced the tip)`,
      );
    }
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, stateId + '\n', 'utf8');
  fs.renameSync(tmp, p); // atomic publish — no half-written selvage
}

/** Append one strand to the fabric ledger (newest last). */
export function appendStrand(wdir: string, strand: Strand): void {
  const p = fabricPath(wdir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(strand) + '\n', 'utf8');
}

/** The full fabric history in seal order (oldest first). [] if none yet. */
export function readFabric(wdir: string): Strand[] {
  let raw: string;
  try {
    raw = fs.readFileSync(fabricPath(wdir), 'utf8');
  } catch (err) {
    // ENOENT = the ledger has never been written (genuinely empty). Any other read
    // failure must fail closed — reading real history as [] is silent data loss.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(
      `warpline: fabric ledger unreadable at ${fabricPath(wdir)} — refusing to read history as empty: ${(err as Error).message}`,
    );
  }
  // A malformed line must THROW (with its position) — never silently drop the rest
  // of the history. The ledger is authoritative; a truncated/corrupt strand is a
  // signal to stop, not to forget everything after it.
  const lines = raw.split('\n');
  const strands: Strand[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().length === 0) continue;
    try {
      strands.push(JSON.parse(line) as Strand);
    } catch (err) {
      throw new Error(
        `warpline: fabric ledger corrupt at ${fabricPath(wdir)}:${i + 1} — a malformed strand must not silently drop history: ${(err as Error).message}`,
      );
    }
  }
  return strands;
}

/**
 * Rewrite the whole ledger atomically (write-tmp + rename). Used ONLY to update
 * graded annotations (calibratedConfidence) — which are excluded from the pickId,
 * so a strand's content-address is unchanged. The meaning-history (stateId/delta/
 * pickId) is never rewritten. Callers hold #fabric-lock.
 */
export function rewriteFabric(wdir: string, strands: Strand[]): void {
  const p = fabricPath(wdir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, strands.map((s) => JSON.stringify(s)).join('\n') + (strands.length ? '\n' : ''), 'utf8');
  fs.renameSync(tmp, p);
}

/** Append a calibration-grade event to .warpline/grades.jsonl (the confidence trajectory). */
export function appendGradeEvent(wdir: string, ev: unknown): void {
  const p = path.join(wdir, 'grades.jsonl');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(ev) + '\n', 'utf8');
}
