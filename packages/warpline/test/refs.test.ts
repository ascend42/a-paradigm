/**
 * refs.test — pickId refs + per-ref CAS + the one-time selvage migration (V3.2,
 * v3-identity spec §2, founder-signed §9.1: refs hold pickIds, not stateIds).
 *
 * Covers the primitives (readRef/writeRef CAS, name validation, listRefs, heads),
 * the ONE-TIME migration (highest-seq disambiguation used for the LAST time,
 * idempotent, fail-closed on a corrupt tip), and the END-TO-END dual-write: after
 * migration, seal advances refs/heads/selvage (per-ref CAS) alongside the legacy
 * stateId selvage, select resolves HEAD through the ref (exact — no stateId
 * ambiguity), and drifted tip pointers refuse the seal.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readRef, writeRef, listRefs, heads, migrateSelvageToRefs } from '../src/fabric/refs.js';
import { warplineDirOf, writeSelvage, readSelvage, appendStrand } from '../src/fabric/fabric.js';
import { recordPick } from '../src/fabric/pick.js';
import { resolveSelector } from '../src/fabric/select.js';
import { verifyFabric } from '../src/fabric/verify.js';
import type { Strand } from '../src/fabric/strand.js';

const P = (n: string): string => `pick:v2:${n.repeat(64)}`;

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-refs-'));
}

/** A minimal parseable strand line (refs/migration tests never verify these). */
function junkStrand(seq: number, stateId: string, pickId: string): Strand {
  return {
    schemaVersion: 2, seq, pickId, parentPickId: null, stateId, parentStateId: null,
    actor: 't', intent: `s${seq}`, recordedAt: '2026-07-16T00:00:00.000Z', objectCount: 1,
    delta: { born: [], retired: [], contractChanged: [], renamedNoop: 0 },
    calibratedConfidence: null, provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
  };
}

describe('refs · primitives (read/write/CAS/list/heads)', () => {
  let root: string;
  let wdir: string;
  beforeEach(() => {
    root = mkTmp();
    wdir = warplineDirOf(root);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('round-trips a ref atomically (no leftover tmp)', () => {
    expect(readRef(wdir, 'selvage')).toBeNull();
    writeRef(wdir, 'selvage', P('1'));
    expect(readRef(wdir, 'selvage')).toBe(P('1'));
    writeRef(wdir, 'selvage', P('2'));
    expect(readRef(wdir, 'selvage')).toBe(P('2'));
    expect(fs.existsSync(path.join(wdir, 'refs', 'heads', 'selvage.tmp'))).toBe(false);
  });

  it('CAS: refuses when the on-disk ref moved off the expected value', () => {
    writeRef(wdir, 'selvage', P('1'));
    expect(() => writeRef(wdir, 'selvage', P('3'), P('2'))).toThrow(/ref CAS failed/);
    expect(readRef(wdir, 'selvage')).toBe(P('1')); // untouched by the losing writer
    writeRef(wdir, 'selvage', P('3'), P('1')); // correct expectation advances
    expect(readRef(wdir, 'selvage')).toBe(P('3'));
    // expectedOld null = "must not exist yet"
    expect(() => writeRef(wdir, 'other', P('4'), P('9'))).toThrow(/ref CAS failed/);
    writeRef(wdir, 'other', P('4'), null);
    expect(readRef(wdir, 'other')).toBe(P('4'));
  });

  it('refs hold pickIds, not stateIds (§9.1) — and names cannot traverse', () => {
    expect(() => writeRef(wdir, 'selvage', 'state:v0:abc')).toThrow(/refs hold pickIds/);
    for (const bad of ['../escape', 'a/b', '.hidden', '']) {
      expect(() => writeRef(wdir, bad, P('1'))).toThrow(/illegal ref name/);
    }
  });

  it('listRefs + heads: refs mode wins; legacy mode falls back to the ledger tip', () => {
    // legacy: no refs — heads() is the single physical tip
    appendStrand(wdir, junkStrand(0, 'state:v0:a', P('a')));
    appendStrand(wdir, junkStrand(1, 'state:v0:b', P('b')));
    expect(listRefs(wdir).size).toBe(0);
    expect(heads(wdir)).toEqual([P('b')]);
    // refs mode: every refs/heads/* value (sorted by name, deduped)
    writeRef(wdir, 'selvage', P('b'));
    writeRef(wdir, 'feature-x', P('a'));
    expect(Object.fromEntries(listRefs(wdir))).toEqual({ 'feature-x': P('a'), selvage: P('b') });
    expect(heads(wdir)).toEqual([P('a'), P('b')]);
  });

  it('heads() on an empty fabric is []', () => {
    expect(heads(wdir)).toEqual([]);
  });
});

describe('refs · the ONE-TIME selvage migration', () => {
  let root: string;
  let wdir: string;
  beforeEach(() => {
    root = mkTmp();
    wdir = warplineDirOf(root);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('converts the stateId selvage to the HIGHEST-SEQ strand pickId (the hack, used last)', () => {
    // the same stateId lands at seq 0 AND seq 2 (many-to-one) — migration must pick seq 2
    appendStrand(wdir, junkStrand(0, 'state:v0:dup', P('a')));
    appendStrand(wdir, junkStrand(1, 'state:v0:mid', P('b')));
    appendStrand(wdir, junkStrand(2, 'state:v0:dup', P('c')));
    writeSelvage(wdir, 'state:v0:dup');
    const r = migrateSelvageToRefs(wdir);
    expect(r).toEqual({ migrated: true, pickId: P('c') });
    expect(readRef(wdir, 'selvage')).toBe(P('c'));
    // idempotent — the second call is a no-op, never a re-resolution
    expect(migrateSelvageToRefs(wdir)).toEqual({ migrated: false, pickId: P('c'), reason: 'already migrated' });
  });

  it('is a reasoned no-op on an empty fabric, and fails CLOSED on a corrupt tip', () => {
    expect(migrateSelvageToRefs(wdir).migrated).toBe(false);
    writeSelvage(wdir, 'state:v0:ghost'); // a tip no strand carries
    expect(() => migrateSelvageToRefs(wdir)).toThrow(/no strand in the fabric carries that state/);
  });
});

describe('refs · end-to-end: seal dual-writes, select resolves via the ref', () => {
  let root: string;
  beforeEach(() => {
    root = mkTmp();
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  function writePurpose(components: string): void {
    fs.writeFileSync(
      path.join(root, '.purpose'),
      `version: "2.0"\ndescription: refs fixture\ncomponents:\n${components}`,
      'utf8',
    );
  }

  it('after migration, seal advances refs/heads/selvage alongside the legacy selvage', async () => {
    const wdir = warplineDirOf(root);
    writePurpose('  alpha:\n    description: Alpha\n    type: module\n');
    const g = await recordPick(root, { cwd: root, intent: 'genesis', actor: 'tester', now: '2026-07-16T00:00:00.000Z' });

    // A GENUINE LEGACY FABRIC, MADE BY HAND. Genesis is now BORN in refs mode
    // (finding B5), so a fresh `recordPick` no longer produces the unmigrated
    // shape this test needs. Deleting the ref is not a simulation of a legacy
    // fabric — it IS one: a pre-V3.2 fabric on disk is exactly a ledger plus a
    // stateId selvage with nothing under refs/heads/.
    expect(readRef(wdir, 'selvage')).toBe(g.strand!.pickId);
    fs.rmSync(path.join(wdir, 'refs', 'heads', 'selvage'));
    expect(readRef(wdir, 'selvage')).toBeNull();

    expect(migrateSelvageToRefs(wdir)).toEqual({ migrated: true, pickId: g.strand!.pickId });

    writePurpose('  alpha:\n    description: Alpha\n    type: module\n  gamma:\n    description: Gamma\n    type: cli\n');
    const r = await recordPick(root, { cwd: root, intent: 'add gamma', actor: 'tester', now: '2026-07-16T00:01:00.000Z' });
    // dual-write: the pickId ref AND the legacy stateId selvage both advanced
    expect(readRef(wdir, 'selvage')).toBe(r.strand!.pickId);
    expect(readSelvage(wdir)).toBe(r.stateId);
    expect(heads(wdir)).toEqual([r.strand!.pickId]);

    // select resolves HEAD through the ref — exact event identity
    const sel = resolveSelector(wdir, 'HEAD');
    expect(sel.strand!.pickId).toBe(r.strand!.pickId);
    expect(sel.treeId).toBe(r.strand!.binding!.treeId);

    // and the whole fabric (v2 strands, refs mode) verifies clean
    const report = verifyFabric(root);
    expect(report.failures).toEqual([]);
    expect(report.abandonedHeads).toEqual([]);
  });

  /* ─────────── B5: a new fabric is BORN in refs mode, not in legacy ─────────── */

  /**
   * WHAT WAS WRONG. A brand-new project sealed its genesis strand with no
   * refs/heads/selvage at all, so it came up LEGACY: the per-ref CAS disengaged
   * (audit C-1), `warpline health` warning on run one, the native write path
   * refusing outright ("this fabric predates them; run `warpline refs migrate`"),
   * and no authoritative pickId tip for git's .gitignore allowlist to carry. The
   * fix is in seal.ts, gated on an EMPTY LEDGER — not on "the ref is missing".
   *
   * WHAT MIGRATION DOES THAT THIS SKIPS: nothing, and the test below is how that
   * is confirmed rather than asserted. `migrateSelvageToRefs` has exactly one
   * job — recover a pickId from a legacy stateId selvage via the highest-seq
   * disambiguation hack, because stateIds are many-to-one. At genesis there is no
   * legacy selvage to resolve and the tip's pickId is in hand, so the hack has
   * nothing to disambiguate; on an empty fabric migration already declines with
   * "no legacy selvage (empty fabric — nothing to migrate)". So the check is not
   * "did we remember to do migration's other steps" (there are none) but "does
   * migration agree there is nothing left for it to do" — which it must report as
   * `already migrated`, its idempotent branch, and the fabric must VERIFY.
   */
  describe('refs · genesis is born in REFS mode (finding B5)', () => {
    it('a fresh fabric has refs/heads/selvage after its FIRST pick — no second command', async () => {
      const wdir = warplineDirOf(root);
      writePurpose('  alpha:\n    description: Alpha\n    type: module\n');
      const g = await recordPick(root, { cwd: root, intent: 'genesis', actor: 'tester', now: '2026-07-16T00:00:00.000Z' });

      expect(readRef(wdir, 'selvage')).toBe(g.strand!.pickId);
      expect(readSelvage(wdir)).toBe(g.stateId); // the legacy pointer is still kept in lockstep
      expect(heads(wdir)).toEqual([g.strand!.pickId]);
      expect(resolveSelector(wdir, 'HEAD').strand!.pickId).toBe(g.strand!.pickId);
      expect(verifyFabric(root).failures).toEqual([]);

      // MIGRATION HAS NOTHING LEFT TO DO — its idempotent branch, not its
      // resolution branch. If genesis had skipped a step migration performs, this
      // would report `migrated: true` and do it.
      expect(migrateSelvageToRefs(wdir)).toEqual({
        migrated: false,
        pickId: g.strand!.pickId,
        reason: 'already migrated',
      });

      // and it keeps advancing normally on the second seal
      writePurpose('  alpha:\n    description: Alpha\n    type: module\n  beta:\n    description: Beta\n    type: cli\n');
      const r2 = await recordPick(root, { cwd: root, intent: 'beta', actor: 'tester', now: '2026-07-16T00:01:00.000Z' });
      expect(readRef(wdir, 'selvage')).toBe(r2.strand!.pickId);
    });

    /**
     * THE CONTROL THE REQUIREMENT NAMES: existing legacy fabrics must be
     * unaffected. The predicate is an EMPTY LEDGER, so a fabric that already has
     * history and no ref must stay refless through further seals — it migrates
     * when its operator says so, exactly as before. Without this, the obvious
     * wrong implementation ("mint the ref whenever it is missing") would silently
     * auto-migrate every legacy fabric on its next commit, which is precisely the
     * founder-visible step refs.ts says must never be automatic.
     */
    it('CONTROL: an EXISTING legacy fabric is not auto-migrated by a later seal', async () => {
      const wdir = warplineDirOf(root);
      writePurpose('  alpha:\n    description: Alpha\n    type: module\n');
      await recordPick(root, { cwd: root, intent: 'genesis', actor: 'tester', now: '2026-07-16T00:00:00.000Z' });
      // make it legacy: history exists, refs/heads/selvage does not
      fs.rmSync(path.join(wdir, 'refs', 'heads', 'selvage'));
      expect(readRef(wdir, 'selvage')).toBeNull();

      writePurpose('  alpha:\n    description: Alpha\n    type: module\n  beta:\n    description: Beta\n    type: cli\n');
      const r2 = await recordPick(root, { cwd: root, intent: 'beta', actor: 'tester', now: '2026-07-16T00:01:00.000Z' });
      expect(r2.strand).toBeDefined();

      expect(readRef(wdir, 'selvage'), 'a legacy fabric must NOT be silently migrated by a seal').toBeNull();
      expect(listRefs(wdir).size).toBe(0);
      expect(readSelvage(wdir)).toBe(r2.stateId); // the legacy pointer still advances
      // …and migration still has real work to do, which is the point of it staying manual
      expect(migrateSelvageToRefs(wdir)).toEqual({ migrated: true, pickId: r2.strand!.pickId });
    });
  });

  it('drifted tip pointers refuse the seal (per-ref CAS, fail closed)', async () => {
    const wdir = warplineDirOf(root);
    writePurpose('  alpha:\n    description: Alpha\n    type: module\n');
    await recordPick(root, { cwd: root, intent: 'genesis', actor: 'tester', now: '2026-07-16T00:00:00.000Z' });
    migrateSelvageToRefs(wdir); // no-op now that genesis is born in refs mode (B5)
    // simulate a drifted/foreign ref (not the ledger tip this seal chains off)
    writeRef(wdir, 'selvage', P('f'));
    writePurpose('  alpha:\n    description: Alpha\n    type: module\n  beta:\n    description: Beta\n    type: cli\n');
    await expect(
      recordPick(root, { cwd: root, intent: 'should refuse', actor: 'tester', now: '2026-07-16T00:02:00.000Z' }),
    ).rejects.toThrow(/ref CAS failed/);
  });
});
