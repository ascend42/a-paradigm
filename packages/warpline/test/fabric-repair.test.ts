/**
 * fabric-repair.test — THE REPAIR PATH (audit C-13 + the P1 entry "detection
 * without repair is a dead end a real crash will find").
 *
 * C-13, verbatim in shape: a real `pick` on a FULL DISK — no crash required —
 * committed a 142-byte partial line, and after freeing space `log`, `selvage`,
 * `restore`, `pick` and `fabric verify` all failed. `readFabric` throws on any
 * malformed line (correct fail-closed posture) but there was no `--skip-corrupt`,
 * no repair, no way to even READ the intact strands. The documented recovery was
 * hand-editing JSONL in a text editor — precisely what source control must never
 * require. The live fabric's largest line is 307,905 bytes, so the window is wide.
 *
 * And the second, smaller version of the same disease: `fabric verify` reports
 * "⚠ abandoned head(s) — no ref names" and recovering one required hand-editing
 * `.warpline/refs/heads/selvage`. A finding you cannot act on is a finding you
 * learn to scroll past.
 *
 * What is pinned here:
 *   - the torn tail BRICKS everything (the finding still reproduces);
 *   - repair is a DRY RUN by default and writes nothing;
 *   - --confirm quarantines the ORIGINAL bytes FIRST, then truncates to the last
 *     well-formed strand, byte-for-byte;
 *   - it reports EXACTLY what was dropped;
 *   - the fabric verifies afterwards;
 *   - mid-ledger corruption REFUSES (truncating there would discard good strands);
 *   - `refs set` refuses an absent pickId, refuses to clobber without --force, and
 *     recovers an abandoned head verify surfaced.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { recordPick } from '../src/fabric/pick.js';
import { warplineDirOf, readFabric, writeSelvage, scanFabric } from '../src/fabric/fabric.js';
import { verifyFabric } from '../src/fabric/verify.js';
import { repairFabric, setFabricRef, RepairRefusal } from '../src/fabric/repair.js';
import { migrateSelvageToRefs, readRef } from '../src/fabric/refs.js';
import type { Strand } from '../src/fabric/strand.js';

const NOW = '2026-07-31T00:00:00.000Z';

/** The 142-byte partial line C-13 observed: a real strand prefix, no newline. */
const TORN = '{"schemaVersion":2,"seq":3,"pickId":"pick:v2:9f2c","stateId":"state:v0:1a2b","intent":"the write that ran out of di';

function ledgerPathOf(root: string): string {
  return path.join(warplineDirOf(root), 'fabric.jsonl');
}

function writePurpose(root: string, n: number): void {
  const body = Array.from({ length: n }, (_, i) => `  c${i}:\n    description: C${i}\n    type: module\n`).join('');
  fs.writeFileSync(path.join(root, '.purpose'), `version: "2.0"\ndescription: Repair fixture\ncomponents:\n${body}`, 'utf8');
}

/** Three WORKTREE seals — no git needed, same ledger shape as the live fabric. */
async function sealThree(root: string): Promise<Strand[]> {
  writePurpose(root, 1);
  await recordPick(root, { cwd: root, intent: 'genesis', actor: 'tester', now: NOW });
  writePurpose(root, 2);
  await recordPick(root, { cwd: root, intent: 'add c1', actor: 'tester', now: NOW });
  writePurpose(root, 3);
  await recordPick(root, { cwd: root, intent: 'add c2', actor: 'tester', now: NOW });
  return readFabric(warplineDirOf(root));
}

describe('fabric repair — a torn tail line (C-13)', () => {
  let root: string;
  let strands: Strand[];
  let intactBytes: Buffer;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-repair-'));
    strands = await sealThree(root);
    expect(strands.length).toBe(3);
    intactBytes = fs.readFileSync(ledgerPathOf(root));
    // the short write: bytes land, the newline never does
    fs.appendFileSync(ledgerPathOf(root), TORN, 'utf8');
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('the finding reproduces — the torn line bricks readFabric AND the diagnostic itself', () => {
    expect(() => readFabric(warplineDirOf(root))).toThrow(/fabric ledger corrupt at .*fabric\.jsonl:4/);
    expect(() => verifyFabric(root)).toThrow(/fabric ledger corrupt/);
    // …but the error now names the way out instead of implying a text editor.
    expect(() => readFabric(warplineDirOf(root))).toThrow(/warpline fabric repair/);
  });

  it('the tolerant scan can still READ the intact strands underneath the tear', () => {
    const scan = scanFabric(warplineDirOf(root));
    expect(scan.strands.map((s) => s.pickId)).toEqual(strands.map((s) => s.pickId));
    expect(scan.malformed.length).toBe(1);
    expect(scan.malformed[0].line).toBe(4);
    expect(scan.malformed[0].bytes).toBe(Buffer.byteLength(TORN));
    expect(scan.lastGoodEnd).toBe(intactBytes.length);
  });

  it('DRY RUN by default: it reports the plan and writes NOTHING', async () => {
    const r = await repairFabric(root);
    expect(r.applied).toBe(false);
    expect(r.intact).toBe(false);
    expect(r.backup).toBeNull();
    expect(r.kept).toBe(3);
    expect(r.dropped.length).toBe(1);
    expect(r.keptBytes).toBe(intactBytes.length);
    expect(r.droppedBytes).toBe(Buffer.byteLength(TORN));
    expect(r.newTip).toBe(strands[2].pickId);
    // the ledger on disk is byte-identical to the corrupt state — no silent repair
    expect(fs.readFileSync(ledgerPathOf(root)).equals(Buffer.concat([intactBytes, Buffer.from(TORN)]))).toBe(true);
    expect(fs.existsSync(path.join(warplineDirOf(root), 'repair'))).toBe(false);
    expect(() => readFabric(warplineDirOf(root))).toThrow(/corrupt/); // still broken
  });

  it('it reports EXACTLY what was dropped — line, bytes, parse error, excerpt', async () => {
    const r = await repairFabric(root);
    const d = r.dropped[0];
    expect(d.line).toBe(4);
    expect(d.offset).toBe(intactBytes.length);
    expect(d.bytes).toBe(Buffer.byteLength(TORN));
    expect(d.error).toMatch(/JSON/i);
    expect(d.excerpt.startsWith('{"schemaVersion":2,"seq":3')).toBe(true);
    expect(d.excerpt.endsWith('…')).toBe(true); // bounded — a torn line can be 300 KB
    expect(d.excerpt.length).toBeLessThan(120);
  });

  it('--confirm: the ORIGINAL is quarantined FIRST, then the ledger truncates byte-exactly', async () => {
    const r = await repairFabric(root, { confirm: true, now: NOW });
    expect(r.applied).toBe(true);
    expect(r.backup).toBeTruthy();

    // the quarantine holds the pre-repair bytes VERBATIM, torn line included
    const quarantined = fs.readFileSync(r.backup!);
    expect(quarantined.equals(Buffer.concat([intactBytes, Buffer.from(TORN)]))).toBe(true);
    expect(r.backup!.startsWith(path.join(warplineDirOf(root), 'repair'))).toBe(true);

    // the repaired ledger is a byte-exact PREFIX — never re-serialized, because
    // every pickId and the epoch anchor's prefix digest hash the STORED bytes
    expect(fs.readFileSync(ledgerPathOf(root)).equals(intactBytes)).toBe(true);
  });

  it('after --confirm the fabric READS and VERIFIES again', async () => {
    await repairFabric(root, { confirm: true, now: NOW });
    const back = readFabric(warplineDirOf(root));
    expect(back.map((s) => s.pickId)).toEqual(strands.map((s) => s.pickId));
    const v = verifyFabric(root);
    expect(v.failures).toEqual([]);
    expect(v.checked).toBe(3);
  });

  it('re-running on a healthy ledger is a no-op that reports "nothing to repair"', async () => {
    await repairFabric(root, { confirm: true, now: NOW });
    const again = await repairFabric(root, { confirm: true, now: NOW });
    expect(again.intact).toBe(true);
    expect(again.applied).toBe(false);
    expect(again.dropped).toEqual([]);
    expect(again.backup).toBeNull();
    expect(again.kept).toBe(3);
  });
});

describe('fabric repair — refuses what it must not fix', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-repair-mid-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('MID-LEDGER corruption refuses — truncating there would discard good strands', async () => {
    const strands = await sealThree(root);
    const lines = fs.readFileSync(ledgerPathOf(root), 'utf8').split('\n').filter(Boolean);
    // corrupt line 2 of 3: two well-formed strands still follow the damage
    fs.writeFileSync(ledgerPathOf(root), [lines[0], '{"seq":1,"pickId":"pick', lines[1], lines[2]].join('\n') + '\n', 'utf8');
    const before = fs.readFileSync(ledgerPathOf(root));

    await expect(repairFabric(root, { confirm: true, now: NOW })).rejects.toThrow(RepairRefusal);
    await expect(repairFabric(root, { confirm: true, now: NOW })).rejects.toThrow(
      /NOT at the tail: 2 well-formed strand\(s\) follow it/,
    );
    // even the DRY RUN refuses rather than printing a plan that loses history
    await expect(repairFabric(root)).rejects.toThrow(/NOT at the tail/);
    expect(fs.readFileSync(ledgerPathOf(root)).equals(before)).toBe(true);
    expect(strands.length).toBe(3);
  });
});

describe('refs set — the actionable half of the abandoned-head report', () => {
  let root: string;
  let strands: Strand[];

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-refs-set-'));
    strands = await sealThree(root);
    // REFS MODE (V3.2) — abandoned heads only exist here. Asserted as the
    // POSTCONDITION rather than as "a migration happened": genesis is now born in
    // refs mode (finding B5), so `migrateSelvageToRefs` is an idempotent no-op on
    // a fabric sealed by `pick` and reports migrated:false. What this fixture
    // needs is the state, and the state is now stronger — the ref names the tip.
    migrateSelvageToRefs(warplineDirOf(root));
    expect(readRef(warplineDirOf(root), 'selvage')).toBe(strands[2].pickId);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('refuses a pickId absent from the fabric — a repair verb must not MINT corruption', async () => {
    const ghost = 'pick:v2:' + '0'.repeat(64);
    await expect(setFabricRef(root, 'ghost', ghost)).rejects.toThrow(RepairRefusal);
    await expect(setFabricRef(root, 'ghost', ghost)).rejects.toThrow(/no strand in the fabric carries pickId/);
    expect(readRef(warplineDirOf(root), 'ghost')).toBeNull();
    expect(verifyFabric(root).failures).toEqual([]); // no ref-unresolved was created
  });

  it('refuses to clobber an existing ref without --force, and obeys it with', async () => {
    expect(readRef(warplineDirOf(root), 'selvage')).toBe(strands[2].pickId);
    await expect(setFabricRef(root, 'selvage', strands[0].pickId)).rejects.toThrow(
      /already points at .*Overwriting a head is how sealed work becomes an ABANDONED head/s,
    );
    expect(readRef(warplineDirOf(root), 'selvage')).toBe(strands[2].pickId); // untouched

    const forced = await setFabricRef(root, 'selvage', strands[0].pickId, { force: true });
    expect(forced).toEqual({
      name: 'selvage',
      pickId: strands[0].pickId,
      previous: strands[2].pickId,
      moved: true,
      forced: true,
    });
    expect(readRef(warplineDirOf(root), 'selvage')).toBe(strands[0].pickId);
  });

  it('setting a ref to the value it already holds is an idempotent no-op', async () => {
    const r = await setFabricRef(root, 'selvage', strands[2].pickId);
    expect(r.moved).toBe(false);
    expect(r.forced).toBe(false);
  });

  it('recovers an ABANDONED HEAD that verify surfaced', async () => {
    // Manufacture the audit's scenario: the published head falls back to an
    // earlier strand (a lost race that never re-published), stranding the tip.
    await setFabricRef(root, 'selvage', strands[1].pickId, { force: true });
    writeSelvage(warplineDirOf(root), strands[1].stateId); // keep the legacy pointer honest

    const before = verifyFabric(root);
    expect(before.failures).toEqual([]); // an abandoned head is LEGAL — reported, not a failure
    expect(before.abandonedHeads).toEqual([strands[2].pickId]);

    // the recovery that used to require hand-editing .warpline/refs/heads/
    const set = await setFabricRef(root, 'recovered', strands[2].pickId);
    expect(set.moved).toBe(true);
    expect(set.previous).toBeNull();

    const after = verifyFabric(root);
    expect(after.abandonedHeads).toEqual([]);
    expect(after.failures).toEqual([]);
    expect(readRef(warplineDirOf(root), 'recovered')).toBe(strands[2].pickId);
  });

  it('a torn ledger does not block ref repair — the two verbs work in either order', async () => {
    fs.appendFileSync(ledgerPathOf(root), TORN, 'utf8');
    const set = await setFabricRef(root, 'recovered', strands[2].pickId);
    expect(set.moved).toBe(true);
    await expect(setFabricRef(root, 'ghost', 'pick:v2:' + '0'.repeat(64))).rejects.toThrow(
      /malformed line\(s\) — run `warpline fabric repair`/,
    );
  });
});
