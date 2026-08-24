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
import { atomicWriteSync } from '../warp/durable.js';
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
  // Atomic + durable like every other ref publish: this was a bare truncate-then-
  // write, the one ref writer with no staging file at all (C-7/C-15).
  atomicWriteSync(scratchPath(wdir, agentId), (base ?? '') + '\n');
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
  // Unique staging name (C-15): a shared `${p}.tmp` here sat directly beneath
  // the CAS above — the CAS runs BEFORE the write, so two writers that both
  // passed it raced on one staging path and one could publish the other's value.
  atomicWriteSync(p, value + '\n');
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
