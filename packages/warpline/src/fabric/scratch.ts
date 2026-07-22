/**
 * #scratch — a per-agent ephemeral view. forkScratch(agentId) pins the stateId
 * the agent is working against (its optimistic base), so N agents can fork the
 * SAME selvage concurrently with zero contention — the thing git's single shared
 * working-tree/index/HEAD cannot do. A SCRATCH is just a pointer under
 * .warpline/refs/scratch/<agentId>; forking is O(1), no working-tree lock.
 *
 * This is the read side of the multi-writer protocol; #admit is the write side.
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { warplineDirOf, readSelvage } from './fabric.js';

function scratchPath(wdir: string, agentId: string): string {
  // agentId is a label; sanitize so it can't escape refs/scratch/.
  const safe = agentId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(wdir, 'refs', 'scratch', safe);
}

/** Fork a scratch for `agentId` at the current selvage (its optimistic base). */
export function forkScratch(root: string, agentId: string): { base: string | null } {
  const wdir = warplineDirOf(root);
  const base = readSelvage(wdir);
  const p = scratchPath(wdir, agentId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, (base ?? '') + '\n', 'utf8');
  return { base };
}

/**
 * Write an agent's scratch ref VALUE directly (native-first, I9): the native
 * write path stores a PICKID here — `warpline fork` mints the ref at the selvage
 * tip pickId and `propose` advances it to each sealed scratch strand. The legacy
 * (git-era) flow stores a stateId via forkScratch. Consumers dispatch on the
 * `pick:`/`state:` prefix; a mismatch fails closed, never silently coerces.
 *
 * CAS (PW-10, optional): pass `expect` to make the write conditional on the
 * CURRENT value (null = "must be absent"). A mismatch throws instead of
 * silently clobbering — before this, two same-principal sessions could orphan
 * each other's sealed-but-unadmitted proposal with no error anywhere.
 */
export function writeScratchRef(
  root: string,
  agentId: string,
  value: string,
  expect?: string | null,
): void {
  const p = scratchPath(warplineDirOf(root), agentId);
  if (expect !== undefined) {
    const current = readScratch(root, agentId);
    if (current !== expect) {
      throw new Error(
        `warpline: scratch ref for ${JSON.stringify(agentId)} is ${current ?? '(absent)'}, expected ${expect ?? '(absent)'} — concurrent write detected, refusing to clobber`,
      );
    }
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, value + '\n', 'utf8');
  fs.renameSync(tmp, p); // atomic publish — no half-written scratch ref
}

/** The stateId an agent's scratch was forked at, or null if none / unforked. */
export function readScratch(root: string, agentId: string): string | null {
  try {
    return fs.readFileSync(scratchPath(warplineDirOf(root), agentId), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/** Discard an agent's scratch (after admission or abandonment). */
export function clearScratch(root: string, agentId: string): void {
  fs.rmSync(scratchPath(warplineDirOf(root), agentId), { force: true });
}
