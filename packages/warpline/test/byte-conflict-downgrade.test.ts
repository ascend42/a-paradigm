/**
 * byte-conflict-downgrade.test — B-3 (T-2026-08-11-014), the downgrade arm.
 *
 * The audit's B-3: a meaning-CLEAN verdict whose BYTES overlap is downgraded to
 * KNOT (never a silent wrong-merge) — but the downgrade site used to return
 * without persisting a work order, so `health`'s contested denominator
 * (listKnotPayloads().length) counted it as ZERO while the shadow arm counted
 * it. This pins that a native byte-conflict downgrade now persists a payload and
 * therefore MOVES the denominator.
 *
 * The construction (Judge, Track-A review): put the byte conflict in a file NO
 * lens covers (`notes.txt` → zero meaning delta) and the meaning-CLEAN in two
 * DISJOINT code symbols (A in a.ts, B in b.ts). predict({A},{B}) → independent
 * CLEAN with rebasedOnto set; the 3-way merge of notes.txt (base/ours/theirs all
 * differ on one line) conflicts → downgrade. Same-symbol edits would read as a
 * meaning KNOT and never reach this branch, which is why it was untested.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { forkNative, proposeNative, admitNative } from '../src/fabric/native.js';
import { listKnotPayloads } from '../src/fabric/knot-payload.js';

const A = 'src/a.ts';
const B = 'src/b.ts';
const NOTES = 'notes.txt';
const A0 = 'export function alpha() { return 1; }\n';
const B0 = 'export function beta() { return 2; }\n';
const NOTES0 = 'header\nSHARED-LINE\nfooter\n';

function write(dir: string, rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

describe('B-3 native byte-conflict downgrade — meaning CLEAN, bytes overlap → counted KNOT', () => {
  let root: string;
  let dirX: string;
  let dirY: string;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-dg-root-'));
    dirX = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-dg-X-'));
    dirY = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-dg-Y-'));
    write(root, A, A0);
    write(root, B, B0);
    write(root, NOTES, NOTES0);
    await proposeNative(root, { worktree: root, agentId: 'genesis', intent: 'genesis' });
    await admitNative(root, { worktree: root, agentId: 'genesis' });
  });

  afterAll(() => {
    for (const d of [root, dirX, dirY]) fs.rmSync(d, { recursive: true, force: true });
  });

  it('persists a work order on the downgrade so health counts it', async () => {
    const before = listKnotPayloads(root).length;

    forkNative(root, 'X', { into: dirX });
    forkNative(root, 'Y', { into: dirY });

    // Y advances the selvage first: touches symbol beta AND the shared txt line.
    write(dirY, B, 'export function beta() { return 222; }\n');
    write(dirY, NOTES, 'header\nYYY-LINE\nfooter\n');
    await proposeNative(root, { worktree: dirY, agentId: 'Y', intent: 'Y: beta + notes' });
    const ay = await admitNative(root, { worktree: dirY, agentId: 'Y' });
    expect(ay.sealed).toBe(true); // first mover fast-forwards

    // X proposes concurrently off genesis: touches symbol alpha (disjoint from
    // beta → meaning independent-CLEAN) AND the SAME shared txt line (byte conflict).
    write(dirX, A, 'export function alpha() { return 111; }\n');
    write(dirX, NOTES, 'header\nXXX-LINE\nfooter\n');
    await proposeNative(root, { worktree: dirX, agentId: 'X', intent: 'X: alpha + notes' });
    const ax = await admitNative(root, { worktree: dirX, agentId: 'X' });

    // Meaning said CLEAN (alpha vs beta are disjoint), bytes overlapped on
    // notes.txt → the verdict is a KNOT, unsealed, fail-closed.
    expect(ax.decision.status).toBe('KNOT');
    expect(ax.sealed).toBe(false);
    // B-3: the work order persisted (rebasedOnto was set, so the payload built)…
    expect(ax.knotPayloadId).toBeDefined();
    expect(ax.payloadError).toBeUndefined();
    // …and the contested denominator actually moved.
    expect(listKnotPayloads(root).length).toBe(before + 1);
  });
});
