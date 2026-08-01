/**
 * staging-name-collision.test — soundness audit C-15: a FIXED `${p}.tmp` staging
 * name defeated the very CAS the ref writers publish, and staging residue was
 * promoted to a real ref.
 *
 * TWO DEFECTS, ONE CAUSE.
 *
 * (1) THE RACE. The CAS runs BEFORE the write, so two writers can both pass it
 *     and then collide on one shared staging path. Interleave stage-A, stage-B,
 *     rename-A, rename-B and A publishes B's VALUE while returning success —
 *     the losing writer's rename then fails ENOENT. Reproduced here
 *     deterministically by queueing the renames rather than by racing threads:
 *     a probabilistic test of a corruption window is not evidence.
 *
 * (2) THE PHANTOM HEAD. `REF_NAME` permits dots, so a crashed writer's
 *     `refs/heads/selvage.tmp` matched it and `listRefs` returned it — despite
 *     the comment there saying "tmp files / strays are not refs". `heads()` then
 *     reported a PERMANENT second head that `fabric verify` called intact.
 *     Unique staging names do NOT fix this on their own: `selvage.tmp.123.0`
 *     matches `REF_NAME` just as well. The filter is the fix, applied on BOTH
 *     sides (list and write) so there is no name you can mint and never see.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/** Lets a test hold renames back so an interleaving is scripted, not raced. */
const gate = vi.hoisted(() => ({
  queue: null as Array<[string, string]> | null,
  reset(): void {
    this.queue = null;
  },
}));

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return {
    ...real,
    default: real,
    renameSync: (a: unknown, b: unknown) => {
      if (gate.queue) {
        gate.queue.push([a as string, b as string]);
        return;
      }
      return real.renameSync(a as string, b as string);
    },
  };
});

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { warplineDirOf, appendStrand, writeSelvage, rewriteFabric, readFabric } from '../src/fabric/fabric.js';
import { writeRef, readRef, listRefs, heads } from '../src/fabric/refs.js';
import { writeScratchRef, readScratch } from '../src/fabric/scratch.js';
import { isTmpResidue } from '../src/warp/durable.js';
import { verifyFabric } from '../src/fabric/verify.js';
import { computePickId, type Strand, type StrandBody } from '../src/fabric/strand.js';

const P = (n: string): string => `pick:v2:${n.repeat(64)}`;

/** A real (identity-reproducing) v2 strand — verify's guards reject junk. */
function strand(seq: number, parentPickId: string | null, parentStateId: string | null): Strand {
  const body: StrandBody = {
    schemaVersion: 2, seq, parentPickId, stateId: `state:v0:seq${seq}`, parentStateId,
    actor: 't', intent: `seq ${seq}`, recordedAt: '2026-07-31T00:00:00.000Z', objectCount: 1,
    delta: { born: [], retired: [], contractChanged: [], renamedNoop: 0 },
    calibratedConfidence: null, provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
  };
  return { ...body, pickId: computePickId(body) };
}

let root: string;
let wdir: string;

beforeEach(() => {
  gate.reset();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-staging-'));
  wdir = warplineDirOf(root);
});
afterEach(() => {
  gate.reset();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('C-15 · concurrent writers cannot publish each other’s value', () => {
  it('writeRef: stage-A, stage-B, rename-A, rename-B publishes A then B — never A-holding-B', () => {
    const VA = P('a');
    const VB = P('b');
    gate.queue = [];
    writeRef(wdir, 'selvage', VA); // writer A stages; its rename is held
    writeRef(wdir, 'selvage', VB); // writer B stages; its rename is held
    const pending = gate.queue;
    gate.queue = null;

    expect(pending.length).toBe(2);

    // THE HARM, asserted before the mechanism. A publishes. Under the shared
    // staging name this renamed B's BYTES into place and returned success:
    // readRef was VB while A believed it had written VA.
    fs.renameSync(pending[0][0], pending[0][1]);
    expect(readRef(wdir, 'selvage')).toBe(VA);

    // B publishes. Under the shared staging name B's file had already been
    // renamed away by A, so this threw ENOENT — the losing writer discovers the
    // collision as a raw fs error, long after its CAS said it had the ref.
    expect(() => fs.renameSync(pending[1][0], pending[1][1])).not.toThrow();
    expect(readRef(wdir, 'selvage')).toBe(VB);

    // THE MECHANISM: two writers, two DISTINCT staging paths.
    expect(pending[0][0]).not.toBe(pending[1][0]);

    // last-writer-wins, cleanly: exactly one file, no residue to be promoted later
    expect(fs.readdirSync(path.join(wdir, 'refs', 'heads'))).toEqual(['selvage']);
    expect(listRefs(wdir).size).toBe(1);
  });

  it('writeScratchRef: the same interleaving on the per-agent scratch ref', () => {
    gate.queue = [];
    writeScratchRef(root, 'agent-1', P('1'));
    writeScratchRef(root, 'agent-1', P('2'));
    const pending = gate.queue;
    gate.queue = null;
    fs.renameSync(pending[0][0], pending[0][1]);
    expect(readScratch(root, 'agent-1')).toBe(P('1'));
    expect(() => fs.renameSync(pending[1][0], pending[1][1])).not.toThrow();
    expect(readScratch(root, 'agent-1')).toBe(P('2'));
    expect(pending[0][0]).not.toBe(pending[1][0]);
    expect(fs.readdirSync(path.join(wdir, 'refs', 'scratch'))).toEqual(['agent-1']);
  });

  it('the ledger rewrite and the legacy selvage stage to unique names too', () => {
    const body: StrandBody = {
      schemaVersion: 2, seq: 0, parentPickId: null, stateId: 'state:v0:a',
      parentStateId: null, actor: 't', intent: 'x', recordedAt: '2026-07-31T00:00:00.000Z',
      objectCount: 1, delta: { born: [], retired: [], contractChanged: [], renamedNoop: 0 },
      calibratedConfidence: null, provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
    };
    appendStrand(wdir, { ...body, pickId: computePickId(body) } as Strand);
    gate.queue = [];
    writeSelvage(wdir, 'state:v0:a');
    writeSelvage(wdir, 'state:v0:b');
    rewriteFabric(wdir, readFabric(wdir));
    rewriteFabric(wdir, readFabric(wdir));
    const staged = gate.queue.map(([from]) => from);
    gate.queue = null;
    expect(new Set(staged).size).toBe(staged.length); // all four staging paths distinct
    for (const s of staged) expect(s).toMatch(/\.tmp\.\d+\.\d+$/);
  });
});

describe('C-15 · staging residue is never readable as a ref', () => {
  it('a leftover .tmp file is NOT a ref and does NOT become a phantom second head', () => {
    writeRef(wdir, 'selvage', P('1'));
    const headsDir = path.join(wdir, 'refs', 'heads');
    // exactly what a crash between write and rename leaves behind, old and new naming
    fs.writeFileSync(path.join(headsDir, 'selvage.tmp'), P('9') + '\n', 'utf8');
    fs.writeFileSync(path.join(headsDir, 'selvage.tmp.4242.0'), P('8') + '\n', 'utf8');
    fs.writeFileSync(path.join(headsDir, 'fabric.jsonl.tmp'), P('7') + '\n', 'utf8');

    expect([...listRefs(wdir).keys()]).toEqual(['selvage']);
    expect(heads(wdir)).toEqual([P('1')]); // ONE head — the phantom is gone
  });

  it('residue holding a VALID pickId is not a head that `fabric verify` blesses', () => {
    // The case that actually bit: a crashed writer's staging file holds a pickId
    // that IS present in the ledger, so nothing downstream can tell it apart from
    // a real ref. Before the filter, heads() reported TWO tips forever and
    // verifyFabric reported the fabric intact with no abandoned head — a
    // permanent phantom second head, blessed.
    const s0 = strand(0, null, null);
    const s1 = strand(1, s0.pickId, s0.stateId);
    appendStrand(wdir, s0);
    appendStrand(wdir, s1);
    writeRef(wdir, 'selvage', s1.pickId);
    fs.writeFileSync(path.join(wdir, 'refs', 'heads', 'selvage.tmp'), s0.pickId + '\n', 'utf8');

    expect([...listRefs(wdir).keys()]).toEqual(['selvage']);
    expect(heads(wdir)).toEqual([s1.pickId]); // exactly one tip
    const report = verifyFabric(root);
    expect(report.failures).toEqual([]);
    expect(report.abandonedHeads).toEqual([]);
  });

  it('a legitimate dotted ref name still works — the filter is residue-shaped, not dot-shaped', () => {
    writeRef(wdir, 'v1.0', P('1'));
    writeRef(wdir, 'release.candidate', P('2'));
    expect([...listRefs(wdir).keys()]).toEqual(['release.candidate', 'v1.0']);
  });

  it('writeRef REFUSES to mint an unenumerable name (list/write symmetry)', () => {
    for (const bad of ['selvage.tmp', 'selvage.tmp.4242.0', 'x.tmp', 'a.tmp.b']) {
      expect(() => writeRef(wdir, bad, P('1'))).toThrow(/illegal ref name/);
    }
    // and the original traversal guard is intact
    for (const bad of ['../escape', 'a/b', '.hidden', '']) {
      expect(() => writeRef(wdir, bad, P('1'))).toThrow(/illegal ref name/);
    }
    expect(fs.existsSync(path.join(wdir, 'refs', 'heads'))).toBe(false);
  });

  it('isTmpResidue matches a .tmp segment anywhere, and nothing else', () => {
    for (const n of ['a.tmp', 'a.tmp.1', 'a.tmp.1.2', 'x.tmp.y']) expect(isTmpResidue(n)).toBe(true);
    for (const n of ['selvage', 'v1.0', 'tmp', 'tmpish', 'a.tmpx', 'a-tmp']) {
      expect(isTmpResidue(n)).toBe(false);
    }
  });
});
