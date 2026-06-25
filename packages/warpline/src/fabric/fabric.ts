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
  } catch {
    return null;
  }
}

/** Advance the tip to `stateId` atomically (write-tmp + rename). */
export function writeSelvage(wdir: string, stateId: string): void {
  const p = selvagePath(wdir);
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
  try {
    const raw = fs.readFileSync(fabricPath(wdir), 'utf8');
    return raw
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Strand);
  } catch {
    return [];
  }
}
