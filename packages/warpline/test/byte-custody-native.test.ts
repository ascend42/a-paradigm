/**
 * byte-custody-native.test — B-1 (T-2026-08-11-013).
 *
 * Before the fix, a meaning-NOOP proposal on the native path returned
 * `{ noop: true }` unconditionally (native.ts), discarding byte-only work —
 * assets, fonts, .js/.env configs, docs — and leaving admit in a dead-end loop
 * (propose no-ops → admit refuses "nothing proposed" → propose no-ops). This
 * pins the corrected behavior: a meaning-NOOP whose TREE advanced seals a
 * byte-custody strand at propose and is carried onto the selvage as a
 * FAST_ADMIT at admit, while a TRUE no-op (tree unchanged) still no-ops.
 *
 * The changed file is a non-lens asset (`.txt`) so the meaning delta is provably
 * empty and only the bytes move — exactly the class an Expo repo is full of.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { forkNative, proposeNative, admitNative } from '../src/fabric/native.js';
import { restore } from '../src/fabric/restore.js';
import { warplineDirOf } from '../src/fabric/fabric.js';
import { readRef } from '../src/fabric/refs.js';

const MOD = 'src/mod.ts';
const ASSET = 'assets/logo.txt';
const CODE = 'export function foo() { return 1; }\n';

function write(dir: string, rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}
function read(dir: string, rel: string): string {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

describe('B-1 native byte-custody — byte-only work is not dropped', () => {
  let root: string;
  let dirA: string;
  let dirB: string;
  let fresh: string;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-bc-root-'));
    dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-bc-A-'));
    dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-bc-B-'));
    fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-bc-fresh-'));
    write(root, MOD, CODE);
    write(root, ASSET, 'v1\n');
    const g = await proposeNative(root, { worktree: root, agentId: 'genesis', intent: 'genesis' });
    await admitNative(root, { worktree: root, agentId: 'genesis' });
    expect(g.noop).toBe(false);
  });

  afterAll(() => {
    for (const d of [root, dirA, dirB, fresh]) fs.rmSync(d, { recursive: true, force: true });
  });

  it('seals a byte-custody strand for a meaning-NOOP + tree-advance, and lands it on the selvage', async () => {
    forkNative(root, 'A', { into: dirA });
    const selvageBefore = readRef(warplineDirOf(root), 'selvage');

    // Byte-only change: a non-lens asset. Meaning delta is empty; only bytes move.
    write(dirA, ASSET, 'v2-brand-new-logo\n');
    const pa = await proposeNative(root, { worktree: dirA, agentId: 'A', intent: 'A: new logo bytes' });
    // The whole point of the fix: this is NOT a no-op — the tree advanced.
    expect(pa.noop).toBe(false);
    expect(pa.strand).toBeDefined();
    // Byte-custody: meaning unchanged, so stateId equals the base's; binding moved.
    expect(pa.strand!.delta.changed?.length ?? 0).toBe(0);

    const aa = await admitNative(root, { worktree: dirA, agentId: 'A' });
    expect(aa.sealed).toBe(true);
    expect(aa.decision.status).toBe('FAST_ADMIT');
    expect(aa.refusal).toBeUndefined();

    // The selvage advanced, and the new bytes are canonical: a fresh restore has them.
    expect(readRef(warplineDirOf(root), 'selvage')).not.toBe(selvageBefore);
    restore(root, { to: fresh });
    expect(read(fresh, ASSET)).toBe('v2-brand-new-logo\n');
    expect(read(fresh, MOD)).toBe(CODE); // meaning file untouched
  });

  it('still treats a TRUE no-op (no byte change) as a no-op', async () => {
    forkNative(root, 'B', { into: dirB });
    // No edits at all — worktree bytes equal the selvage tree.
    const pb = await proposeNative(root, { worktree: dirB, agentId: 'B', intent: 'B: nothing' });
    expect(pb.noop).toBe(true);
    expect(pb.strand).toBeUndefined();
  });
});
