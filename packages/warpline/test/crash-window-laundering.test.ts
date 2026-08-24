/**
 * crash-window-laundering.test — C-4 regression: an integrity break that HEALS
 * ITSELF into a permanent lie.
 *
 * `sealState` appends the strand, then publishes the selvage (the "lesser-evil
 * crash ordering"). Crash between the two and the selvage LAGS the ledger tip.
 * `fabric verify` catches that correctly — chain-break, rolled-back tip, exit 1.
 *
 * The defect is what happens NEXT. The following `pick` derives `parentPickId`
 * from the LEDGER TIP while the CAS compares the SELVAGE — both stale, so both
 * pass. The strand it seals names one parent by `parentPickId` and a DIFFERENT
 * one by `parentStateId`; its delta is diffed against the wrong parent; and once
 * the selvage catches up, `fabric verify` reports "all intact", exit 0 —
 * permanently. The evidence of the break is consumed by the break.
 *
 * `strand.ts` documents the invariant — parentStateId is "always the ledger tip" —
 * and nothing anywhere enforced it. Two ends are pinned here:
 *   WRITER   — sealState REFUSES to seal across the crash window (never repairs).
 *   DETECTOR — verifyFabric flags a v2 strand whose two parent pointers disagree.
 *
 * SCOPE NOTE (live-data hazard): the detector is v2-ONLY on purpose. v1 strands
 * carry NO `parentPickId` (ordering is unauthenticatable by construction, OQ-A)
 * yet DO carry a non-null `parentStateId` — 14 of the 15 v1 strands on the live
 * fabric do. A check that ignored the epoch would fail real, legitimate history.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESOLVED — TD-2026-08-01-893. These blocks were skipped for one round because
 * both fixes, though green here, broke `stake recover`: recovery MOVED the tip
 * pointer back to an earlier staked strand and appended NOTHING ("a ref MOVE,
 * never an import"), so the next pick derived parentPickId from the LEDGER TIP
 * and parentStateId from the rolled-back selvage — the laundered two-parent shape,
 * produced ON PURPOSE by a legitimate verb. C-4 and C-12 were therefore ONE
 * mechanism: what C-12 called the post-recover fabric "self-healing on the next
 * seal" IS C-4's laundering.
 *
 * The founder resolved it by making the rollback a RECORDED act. `stake recover`
 * now appends a reversion strand R — R.stateId = the staked state, R.parentStateId
 * and R.parentPickId = the pre-recovery ledger tip — and advances BOTH tip
 * pointers to R. The ledger stays append-only, the v2 chain stays linear, no fork
 * is introduced, and the invariant these tests pin becomes enforceable rather than
 * merely documented. The superseded "ref MOVE, never an import" contract is gone
 * from stake.ts's header; post-recover strands now parent on R.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { recordPick } from '../src/fabric/pick.js';
import { warplineDirOf, readFabric, readSelvage, writeSelvage, appendStrand } from '../src/fabric/fabric.js';
import { computePickId, type Strand } from '../src/fabric/strand.js';
import { verifyFabric } from '../src/fabric/verify.js';

const NOW = '2026-07-01T00:00:00.000Z';

function writePurpose(root: string, components: string): void {
  fs.writeFileSync(
    path.join(root, '.purpose'),
    `version: "2.0"\ndescription: C-4 fixture\ncomponents:\n${components}`,
    'utf8',
  );
}

// Each component needs a DISTINCT essence, or the added symbol dedups onto an
// existing one and the strand lands on the SAME stateId as its parent (the
// many-to-one stateId case). Distinct `type`s guarantee four distinct states.
const A = '  alpha:\n    description: A\n    type: module\n';
const B = A + '  beta:\n    description: B\n    type: cli\n';
const C = B + '  gamma:\n    description: G\n    type: service\n';
const D = C + '  delta:\n    description: D\n    type: adapter\n';

async function sealFabric(root: string): Promise<Strand[]> {
  writePurpose(root, A);
  await recordPick(root, { cwd: root, intent: 'genesis', actor: 'tester', now: NOW });
  writePurpose(root, B);
  await recordPick(root, { cwd: root, intent: 'add beta', actor: 'tester', now: NOW });
  writePurpose(root, C);
  await recordPick(root, { cwd: root, intent: 'add gamma', actor: 'tester', now: NOW });
  return readFabric(warplineDirOf(root));
}

/**
 * The post-crash state, faithfully: the ledger holds the tip strand, but the
 * selvage still names its PREDECESSOR (writeSelvage never ran).
 */
function rollSelvageBackOne(root: string, fabric: Strand[]): void {
  writeSelvage(warplineDirOf(root), fabric[fabric.length - 2].stateId);
}

describe('C-4 WRITER — sealState refuses to seal across the crash window', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-c4-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('the fixture really is the post-crash state, and verify DOES catch it', async () => {
    const fabric = await sealFabric(root);
    rollSelvageBackOne(root, fabric);
    const wdir = warplineDirOf(root);
    expect(readSelvage(wdir)).toBe(fabric[fabric.length - 2].stateId);
    expect(readSelvage(wdir)).not.toBe(fabric[fabric.length - 1].stateId);
    // This much already worked — verify is right about the break itself.
    const r = verifyFabric(root);
    expect(r.failures.some((f) => f.kind === 'chain-break')).toBe(true);
  });

  it('THE LAUNDERING — the next pick REFUSES instead of sealing a two-parent strand', async () => {
    const fabric = await sealFabric(root);
    rollSelvageBackOne(root, fabric);

    writePurpose(root, D);
    await expect(
      recordPick(root, { cwd: root, intent: 'add delta', actor: 'tester', now: NOW }),
    ).rejects.toThrow(/ledger|tip|selvage/i);

    // Refuse, do NOT repair: the ledger is untouched and the break is still visible.
    const after = readFabric(warplineDirOf(root));
    expect(after.length).toBe(fabric.length);
    expect(verifyFabric(root).failures.some((f) => f.kind === 'chain-break')).toBe(true);
  });

  it('a healthy fabric still seals normally (the guard must not block real work)', async () => {
    const fabric = await sealFabric(root);
    writePurpose(root, D);
    await recordPick(root, { cwd: root, intent: 'add delta', actor: 'tester', now: NOW });
    const after = readFabric(warplineDirOf(root));
    expect(after.length).toBe(fabric.length + 1);
    expect(verifyFabric(root).failures).toEqual([]);
  });
});

describe('C-4 DETECTOR — a laundered strand no longer verifies clean', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-c4d-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('parentPickId and parentStateId naming DIFFERENT parents is caught', async () => {
    const fabric = await sealFabric(root);
    const wdir = warplineDirOf(root);
    const tip = fabric[fabric.length - 1];
    const grandparent = fabric[fabric.length - 2];

    // Exactly the strand the pre-fix laundering produced: chained correctly by
    // pickId to the real tip, but declaring the GRANDPARENT's stateId as its
    // parent state. Built properly (not forged) so its pickId RECOMPUTES — the
    // integrity and chain checks both pass and only the new check can fire.
    const { pickId: _drop, ...tipBody } = tip;
    const body = {
      ...tipBody,
      seq: fabric.length,
      parentPickId: tip.pickId,
      parentStateId: grandparent.stateId,
    };
    const laundered: Strand = { ...body, pickId: computePickId(body) };
    appendStrand(wdir, laundered);
    writeSelvage(wdir, laundered.stateId); // the selvage caught up — the lie is "healed"

    const r = verifyFabric(root);
    // Pre-fix this reported ZERO failures, exit 0, permanently.
    expect(r.failures.length).toBeGreaterThan(0);
    expect(r.v2Chain.ok).toBe(false);
    const f = r.failures.find((x) => x.pickId === laundered.pickId);
    expect(f, 'the laundered strand itself must be named').toBeTruthy();
    expect(f!.detail).toMatch(/parentStateId/i);
    // ...and it is NOT being caught merely as a hash/integrity failure.
    expect(r.failures.every((x) => x.kind !== 'pickId-mismatch')).toBe(true);
  });

  it('an untampered fabric still verifies clean (no false positive)', async () => {
    await sealFabric(root);
    expect(verifyFabric(root).failures).toEqual([]);
  });
});
