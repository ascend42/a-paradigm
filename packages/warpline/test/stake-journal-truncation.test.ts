/**
 * stake-journal-truncation.test — AUDIT C-6: "history truncation is completely
 * undetectable".
 *
 * The finding, verbatim in shape: on a faithful copy of the live 64-strand fabric
 * an auditor cut it to 26 strands, rolled the selvage back, and got
 * `VERIFY 26 strand(s) — all intact`, exit 0. 59% of the record erased, zero
 * evidence, and the remainder a fully operable base new strands chain onto
 * cleanly. The hash chain authenticates that what is PRESENT is consistent;
 * nothing attested to how much should be there.
 *
 * The evidence was already on disk and simply not consulted: with `stake.auto`
 * on, every seal appends a row to `.warpline/stakes/audit.jsonl` naming the pickId
 * it staked — a git-backed journal of every tip this fabric has ever had, which
 * `verify.ts` never imported.
 *
 * This file pins BOTH halves, and the negative half matters as much as the
 * positive one:
 *   1. the reproduction — truncate a staked fabric's tail, roll the selvage back,
 *      and `stake-journal-orphan` must fire (HARD, exit 1);
 *   2. the three ways `verify` must STAY usable — no journal, valve disabled,
 *      fresh fabric. Absence of evidence is not evidence of truncation, and a
 *      check that fails on every repo not running the valve is not shippable.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { recordPick } from '../src/fabric/pick.js';
import { warplineDirOf, readFabric, readSelvage, writeSelvage } from '../src/fabric/fabric.js';
import { readRef, writeRef } from '../src/fabric/refs.js';
import { verifyFabric } from '../src/fabric/verify.js';
import { readStakeJournal, stakeAuditPathOf } from '../src/fabric/stake-journal.js';
import type { Strand } from '../src/fabric/strand.js';

const execFileAsync = promisify(execFile);

/** A scratch git repo with the checkpoint valve wired exactly like the live fabric. */
class StakedRepo {
  constructor(public readonly dir: string) {}

  static async create(prefix: string, stakeOn: boolean): Promise<StakedRepo> {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
    const r = new StakedRepo(dir);
    await r.git('init', '-q', '-b', 'base');
    await r.git('config', 'user.email', 'r@warpline.test');
    await r.git('config', 'user.name', 'Warpline R');
    await r.git('config', 'commit.gpgsign', 'false');
    fs.mkdirSync(path.join(dir, '.warpline'), { recursive: true });
    // The LIVE fabric's own config (.warpline/config.json), minus the shadow gate.
    fs.writeFileSync(
      path.join(dir, '.warpline', 'config.json'),
      JSON.stringify(stakeOn ? { stake: { enabled: true, refs: ['selvage'], auto: 'every-seal' } } : {}),
      'utf8',
    );
    await r.write('.gitignore', '.warpline/\n');
    return r;
  }

  git = async (...a: string[]): Promise<string> =>
    (await execFileAsync('git', a, { cwd: this.dir, encoding: 'utf8' })).stdout.trim();

  async write(rel: string, body: string): Promise<void> {
    const full = path.join(this.dir, rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, body, 'utf8');
  }

  /** Commit a `.purpose` revision and seal it — the auto-stake cadence fires on each. */
  async sealRevision(components: string, intent: string): Promise<Strand> {
    await this.write(
      '.purpose',
      `version: "2.0"\ndescription: Journal fixture\ncomponents:\n${components}`,
    );
    await this.git('add', '-A');
    await this.git('commit', '-q', '-m', intent);
    const r = await recordPick(this.dir, { cwd: this.dir, ref: 'HEAD', intent, actor: 'tester' });
    expect(r.strand, `seal "${intent}" produced no strand`).toBeTruthy();
    return r.strand!;
  }

  ledgerPath = (): string => path.join(warplineDirOf(this.dir), 'fabric.jsonl');

  /**
   * Cut the ledger to its first `keep` strands and roll the tip back — the
   * auditor's exact move: cut the tail, then MAKE THE SURVIVORS AGREE.
   *
   * BOTH TIP POINTERS, not one. This used to roll back only the legacy stateId
   * selvage, which was a faithful model while a fresh fabric came up unmigrated.
   * Genesis is now born in refs mode (finding B5), so a fabric has a second tip —
   * refs/heads/selvage, holding a pickId — and leaving it pointing into the erased
   * region makes `verify` report `ref-unresolved`. That is a truncator who forgot
   * a file, not the C-6 finding: the finding is that a COMPETENT truncation leaves
   * the surviving record self-consistent and only the stake journal dissents. A
   * fixture that models an incompetent attacker would make the negative half of
   * this file ("verify must STAY usable without a journal") pass for the wrong
   * reason, so the helper models the competent one.
   */
  truncateTo(keep: number): void {
    const raw = fs.readFileSync(this.ledgerPath(), 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    fs.writeFileSync(this.ledgerPath(), lines.slice(0, keep).join('\n') + '\n', 'utf8');
    const wdir = warplineDirOf(this.dir);
    const survivors = readFabric(wdir);
    const tip = survivors[survivors.length - 1];
    writeSelvage(wdir, tip.stateId);
    if (readRef(wdir, 'selvage') !== null) writeRef(wdir, 'selvage', tip.pickId);
  }

  destroy = (): Promise<void> => fsp.rm(this.dir, { recursive: true, force: true });
}

const COMP = (n: number): string =>
  Array.from({ length: n }, (_, i) => `  c${i}:\n    description: C${i}\n    type: module\n`).join('');

describe('C-6 — the stake journal makes tail truncation loud', () => {
  let repo: StakedRepo;
  let strands: Strand[];

  beforeAll(async () => {
    repo = await StakedRepo.create('warpline-c6-', true);
    strands = [
      await repo.sealRevision(COMP(1), 'genesis'),
      await repo.sealRevision(COMP(2), 'add c1'),
      await repo.sealRevision(COMP(3), 'add c2'),
    ];
  }, 180_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it('the valve actually attested every seal (anti-vacuity: without this the truncation test proves nothing)', () => {
    const journal = readStakeJournal(repo.dir);
    expect(fs.existsSync(stakeAuditPathOf(repo.dir))).toBe(true);
    expect(journal.present).toBe(true);
    // every sealed pickId has a COMPLETED (stake/skip/recover) attestation
    const attested = new Set(journal.attestations.map((a) => a.pickId));
    for (const s of strands) expect(attested.has(s.pickId), `no checkpoint attests ${s.pickId}`).toBe(true);
    expect(journal.attestations.length).toBe(3);
    expect(journal.attestations.every((a) => a.action === 'stake')).toBe(true);
    expect(journal.attestations.every((a) => typeof a.gitCommit === 'string' && a.gitCommit.length === 40)).toBe(true);
  });

  it('the intact staked fabric verifies clean and cross-checks every checkpoint', () => {
    const r = verifyFabric(repo.dir);
    expect(r.failures).toEqual([]);
    expect(r.checked).toBe(3);
    expect(r.stakeJournal).toEqual({ present: true, attested: 3, missing: [] });
  });

  it('THE FINDING: tail cut + selvage rolled back → the survivors agree, and the journal is the only witness', () => {
    repo.truncateTo(1);

    // The auditor's observation, still true: everything the chain CAN see is fine.
    const r = verifyFabric(repo.dir);
    expect(r.checked).toBe(1);
    expect(r.v2Chain.ok).toBe(true); // the surviving chain is internally consistent
    expect(r.failures.filter((f) => f.kind === 'chain-break')).toEqual([]);
    expect(r.failures.filter((f) => f.kind === 'pickId-mismatch')).toEqual([]);

    // …and the journal now contradicts it. HARD, exit 1, one failure per erased tip.
    const orphans = r.failures.filter((f) => f.kind === 'stake-journal-orphan');
    expect(orphans.length).toBe(2);
    expect(new Set(orphans.map((o) => o.pickId))).toEqual(new Set([strands[1].pickId, strands[2].pickId]));
    expect(r.stakeJournal.missing.sort()).toEqual([strands[1].pickId, strands[2].pickId].sort());
    expect(r.failures.length).toBe(2); // NOTHING else fires — this is the sole evidence

    // The detail names the checkpoint and the remedy, and is its own kind (never
    // folded into chain-break: "a strand that was here is gone" is a different
    // fact, with a different fix, than "the strands present disagree").
    expect(orphans[0].detail).toMatch(/stake journal attests this pickId/);
    expect(orphans[0].detail).toMatch(/TRUNCATED or REWRITTEN/);
    expect(orphans[0].detail).toMatch(/stake commit [0-9a-f]{12}/);
    expect(orphans[0].seq).toBe(-1); // journal-level, not a strand line
  });
});

describe('C-6 — absence of evidence is not evidence of truncation', () => {
  it('NO JOURNAL: the same truncation on a fabric whose journal was deleted still verifies clean', async () => {
    const repo = await StakedRepo.create('warpline-c6-nojournal-', true);
    try {
      await repo.sealRevision(COMP(1), 'genesis');
      await repo.sealRevision(COMP(2), 'add c1');
      await repo.sealRevision(COMP(3), 'add c2');
      expect(readStakeJournal(repo.dir).attestations.length).toBe(3);

      fs.rmSync(stakeAuditPathOf(repo.dir), { force: true });
      repo.truncateTo(1);

      const r = verifyFabric(repo.dir);
      expect(r.stakeJournal).toEqual({ present: false, attested: 0, missing: [] });
      expect(r.failures).toEqual([]); // the C-6 hole, deliberately left open: the
      // journal is advisory, so a truncator who also deletes it leaves no LOCAL
      // trace. The git stake branch is the tamper-resistant corroborator.
    } finally {
      await repo.destroy();
    }
  }, 180_000);

  it('VALVE DISABLED: a repo that never staked verifies clean, truncated or not', async () => {
    const repo = await StakedRepo.create('warpline-c6-off-', false);
    try {
      await repo.sealRevision(COMP(1), 'genesis');
      await repo.sealRevision(COMP(2), 'add c1');
      await repo.sealRevision(COMP(3), 'add c2');
      // the valve never ran, so the sidecar was never even created
      expect(fs.existsSync(stakeAuditPathOf(repo.dir))).toBe(false);

      const before = verifyFabric(repo.dir);
      expect(before.failures).toEqual([]);
      expect(before.stakeJournal).toEqual({ present: false, attested: 0, missing: [] });

      repo.truncateTo(1);
      const after = verifyFabric(repo.dir);
      expect(after.checked).toBe(1);
      expect(after.failures).toEqual([]);
      expect(after.stakeJournal.missing).toEqual([]);
    } finally {
      await repo.destroy();
    }
  }, 180_000);

  it('FRESH FABRIC: an empty root verifies clean and reports no journal', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-c6-fresh-'));
    try {
      const r = verifyFabric(root);
      expect(r.checked).toBe(0);
      expect(r.failures).toEqual([]);
      expect(r.stakeJournal).toEqual({ present: false, attested: 0, missing: [] });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('#stake-journal — only COMPLETED valve actions attest', () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-journal-rows-'));
    const rows = [
      { schema: 'stakeAudit:v1', at: '2026-07-01T00:00:00.000Z', actor: 'a', action: 'stake', selector: 'selvage', pickId: 'pick:v2:aaa', gitCommit: 'c'.repeat(40) },
      { schema: 'stakeAudit:v1', at: '2026-07-02T00:00:00.000Z', actor: 'a', action: 'skip', selector: 'selvage', pickId: 'pick:v2:bbb' },
      { schema: 'stakeAudit:v1', at: '2026-07-03T00:00:00.000Z', actor: 'a', action: 'recover', selector: 'x', pickId: 'pick:v2:ccc' },
      { schema: 'stakeAudit:v1', at: '2026-07-04T00:00:00.000Z', actor: 'a', action: 'refuse', selector: 'selvage', pickId: 'pick:v2:ddd' },
      // The unsound one: `recover-refuse`'s own documented reason is "stake names
      // pickId X, which is ABSENT from the fabric". Attesting it would turn a
      // correct refusal into a permanent false truncation alarm.
      { schema: 'stakeAudit:v1', at: '2026-07-05T00:00:00.000Z', actor: 'a', action: 'recover-refuse', selector: 'x', pickId: 'pick:v2:eee' },
      { schema: 'stakeAudit:v1', at: '2026-07-06T00:00:00.000Z', actor: 'a', action: 'stake', selector: 'selvage', pickId: 'pick:v2:aaa' },
    ];
    fs.mkdirSync(path.dirname(stakeAuditPathOf(root)), { recursive: true });
    fs.writeFileSync(
      stakeAuditPathOf(root),
      rows.map((r) => JSON.stringify(r)).join('\n') + '\n{"schema":"stakeAudit:v1","action":"stake","pick', // torn tail row
      'utf8',
    );
  });

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('stake/skip/recover attest; refuse and recover-refuse do not; a torn row is counted, not fatal', () => {
    const j = readStakeJournal(root);
    expect(j.present).toBe(true);
    expect(j.malformed).toBe(1); // the half-written tail row — telemetry, never fatal
    expect(j.rows).toBe(6);
    expect(j.attestations.map((a) => a.pickId)).toEqual(['pick:v2:aaa', 'pick:v2:bbb', 'pick:v2:ccc']);
    expect(j.attestations[0].at).toBe('2026-07-01T00:00:00.000Z'); // EARLIEST wins on a repeat
    expect(j.attestations[0].gitCommit).toBe('c'.repeat(40));
    expect(j.attestations[1].gitCommit).toBeNull();
  });

  it('an unreadable journal yields no evidence rather than breaking verify', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-journal-eisdir-'));
    try {
      // a DIRECTORY where the journal file should be — readFileSync throws EISDIR
      fs.mkdirSync(stakeAuditPathOf(dir), { recursive: true });
      const j = readStakeJournal(dir);
      expect(j.present).toBe(false);
      expect(j.attestations).toEqual([]);
      expect(j.unreadable).toBeTruthy();
      expect(() => verifyFabric(dir)).not.toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** Guard the reader's own contract: readSelvage/readFabric untouched by this work. */
describe('C-6 — the cross-check is read-only', () => {
  it('verifyFabric writes nothing to the stakes sidecar', async () => {
    const repo = await StakedRepo.create('warpline-c6-ro-', true);
    try {
      await repo.sealRevision(COMP(1), 'genesis');
      const before = fs.readFileSync(stakeAuditPathOf(repo.dir), 'utf8');
      const selvageBefore = readSelvage(warplineDirOf(repo.dir));
      verifyFabric(repo.dir);
      verifyFabric(repo.dir);
      expect(fs.readFileSync(stakeAuditPathOf(repo.dir), 'utf8')).toBe(before);
      expect(readSelvage(warplineDirOf(repo.dir))).toBe(selvageBefore);
    } finally {
      await repo.destroy();
    }
  }, 180_000);
});
