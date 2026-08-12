/**
 * admit-onto-branch.test — the M2.5 increment-3 SPINE (native.ts, TD-2026-08-12-813,
 * Arky's design): admit no longer hardcodes `selvage` — it advances the CURRENT
 * branch, resolved `opts.onto` → HEAD → selvage. This pins the two behaviors the
 * refactor turns on:
 *
 *   1. THE COMPATIBILITY SPINE — the legacy stateId `selvage` pointer (writeSelvage,
 *      a lockstep pointer that exists ONLY for selvage) is written ONLY when the
 *      target IS selvage. A named branch is refs-only; admitting onto it must NOT
 *      mint a legacy pointer, and must NOT move refs/heads/selvage.
 *   2. THE DEFAULT IS BYTE-IDENTICAL — admit with no `onto` (HEAD absent) advances
 *      refs/heads/selvage AND writes the legacy pointer in lockstep, exactly as
 *      before onto existed.
 *
 * No git anywhere — this is the native path.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { forkNative, proposeNative, admitNative } from '../src/fabric/native.js';
import { createBranch } from '../src/fabric/branch.js';
import { readRef } from '../src/fabric/refs.js';
import { warplineDirOf, readSelvage } from '../src/fabric/fabric.js';

const MOD = 'src/mod.ts';

function write(dir: string, rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

describe('#admit --onto — admit targets the current branch; the legacy selvage pointer is selvage-only', () => {
  let root: string;
  const scratchDirs: string[] = [];

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-admit-onto-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    for (const d of scratchDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  function forkDir(prefix: string): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), `warpline-admit-onto-${prefix}-`));
    scratchDirs.push(d);
    return d;
  }

  it('--onto <branch> advances THAT ref with NO legacy pointer; no-onto advances selvage AND the legacy pointer', async () => {
    const wdir = warplineDirOf(root);

    // ── Genesis on selvage (the default line). ──────────────────────────────
    write(root, MOD, 'export function foo() { return 1; }\n');
    await proposeNative(root, { worktree: root, agentId: 'genesis', intent: 'genesis' });
    await admitNative(root, { worktree: root, agentId: 'genesis', noRestore: true });

    const selvageTip0 = readRef(wdir, 'selvage');
    const legacy0 = readSelvage(wdir);
    expect(selvageTip0).not.toBeNull();
    expect(legacy0).not.toBeNull();

    // A named branch tip at the current selvage — a refs-only line.
    createBranch(root, 'feature');
    expect(readRef(wdir, 'feature')).toBe(selvageTip0);

    // ── Agent A: fork off the base, propose, admit --onto feature. ──────────
    const aDir = forkDir('A');
    forkNative(root, 'A', { into: aDir });
    write(aDir, MOD, 'export function foo() { return 42; }\n');
    const aProp = await proposeNative(root, { worktree: aDir, agentId: 'A', intent: 'A onto feature' });
    const aRes = await admitNative(root, { worktree: aDir, agentId: 'A', onto: 'feature', noRestore: true });

    expect(aRes.sealed).toBe(true);
    // feature ref MOVED to A's proposal…
    expect(readRef(wdir, 'feature')).toBe(aProp.strand!.pickId);
    // …selvage did NOT move…
    expect(readRef(wdir, 'selvage')).toBe(selvageTip0);
    // …and the selvage-only legacy pointer was NOT touched by a non-selvage admit.
    expect(readSelvage(wdir)).toBe(legacy0);

    // ── Agent B: fork off selvage, propose, admit with NO onto → selvage. ───
    const bDir = forkDir('B');
    forkNative(root, 'B', { into: bDir });
    write(bDir, MOD, 'export function foo() { return 7; }\n');
    const bProp = await proposeNative(root, { worktree: bDir, agentId: 'B', intent: 'B onto selvage' });
    const bRes = await admitNative(root, { worktree: bDir, agentId: 'B', noRestore: true });

    expect(bRes.sealed).toBe(true);
    // selvage MOVED to B's proposal AND the legacy pointer followed it in lockstep
    // (byte-identical to the pre-branch default path).
    expect(readRef(wdir, 'selvage')).toBe(bProp.strand!.pickId);
    expect(readSelvage(wdir)).toBe(bProp.strand!.stateId);
    expect(readSelvage(wdir)).not.toBe(legacy0);
    // The two lines are independent: feature stayed where A left it.
    expect(readRef(wdir, 'feature')).toBe(aProp.strand!.pickId);
  });
});
