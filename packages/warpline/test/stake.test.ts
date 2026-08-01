/**
 * stake.test — THE CHECKPOINT VALVE (T-2026-07-17-001; Phase 1 native-first).
 *
 * Covers the acceptance bar:
 *   - S4: disabled / non-allowlisted ref / working-branch target → refuse + audit
 *   - e2e: enable → stake a sealed state → git log shows the first-parent chain,
 *     the machine trailer, and the committed .warpline-stake marker; the human's
 *     working branch and worktree are untouched
 *   - determinism: staking the same sealed state twice = idempotent skip
 *   - stake → edit → stake = a linear first-parent chain (D3)
 *   - S2: adversarially crafted trees (planted sidecar path, serialized
 *     untrusted-prose content, spoofed marker, gitlink) → refuse + audit,
 *     nothing written to the git odb refs
 *   - S3: recompute mismatch (tampered build dir) → refuse, ref never advances
 *   - S1: pick/absorb (the hook path) REFUSE a stake commit / stake namespace /
 *     marked worktree as input
 *   - S5: `stake recover` verifies the reset tree, RECORDS the rollback as an
 *     explicit reversion strand (TD-2026-08-01-893) and advances both tip
 *     pointers onto it; an edited-after-reset tree refuses
 *   - D5: the deny-list is frozen + schema-versioned (the constitution test)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { recordPick } from '../src/fabric/pick.js';
import { absorb } from '../src/absorb.js';
import { stake, stakeRecover, stakeAuditPathOf, stakeMessage, parseStakeTrailers } from '../src/fabric/stake.js';
import {
  STAKE_MARKER,
  STAKE_MARKER_CONTENT,
  STAKE_DENYLIST_SCHEMA,
  STAKE_DENY_NAMES,
  STAKE_DENY_PATHS,
  STAKE_DENY_ENVELOPE_KINDS,
  STAKE_DENY_ROW_SCHEMAS,
  STAKE_DENY_ROW_SHAPES,
} from '../src/fabric/stake-guard.js';
import { appendStrand, writeSelvage, readSelvage, readFabric, warplineDirOf } from '../src/fabric/fabric.js';
import { verifyFabric } from '../src/fabric/verify.js';
import { ObjectStore } from '../src/warp/object-store.js';
import type { Strand } from '../src/fabric/strand.js';
import type { StakeAuditRow } from '../src/fabric/stake.js';

const execFileAsync = promisify(execFile);

class Repo {
  constructor(public readonly dir: string) {}
  static async create(prefix: string): Promise<Repo> {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
    const r = new Repo(dir);
    await r.git('init', '-q', '-b', 'base');
    await r.git('config', 'user.email', 'r@warpline.test');
    await r.git('config', 'user.name', 'Warpline R');
    await r.git('config', 'commit.gpgsign', 'false');
    return r;
  }
  git = async (...a: string[]): Promise<string> =>
    (await execFileAsync('git', a, { cwd: this.dir, encoding: 'utf8' })).stdout.trim();
  async write(rel: string, body: string): Promise<void> {
    const full = path.join(this.dir, rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, body, 'utf8');
  }
  async commitAll(msg: string): Promise<void> {
    await this.git('add', '-A');
    await this.git('commit', '-q', '-m', msg);
  }
  setConfig(cfg: unknown): void {
    fs.mkdirSync(path.join(this.dir, '.warpline'), { recursive: true });
    fs.writeFileSync(path.join(this.dir, '.warpline', 'config.json'), JSON.stringify(cfg), 'utf8');
  }
  auditRows(): StakeAuditRow[] {
    const p = stakeAuditPathOf(this.dir);
    if (!fs.existsSync(p)) return [];
    return fs
      .readFileSync(p, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as StakeAuditRow);
  }
  lastAudit(): StakeAuditRow {
    const rows = this.auditRows();
    expect(rows.length).toBeGreaterThan(0);
    return rows[rows.length - 1];
  }
  destroy = (): Promise<void> => fsp.rm(this.dir, { recursive: true, force: true });
}

/* ── e2e: the full valve loop on a real repo ─────────────────────────────────── */

describe('stake — the checkpoint valve e2e (S1–S5, D3)', () => {
  let repo: Repo;
  let s1: Strand;
  let s2: Strand;
  let reversion: Strand; // the S5 recovery's reversion strand (TD-2026-08-01-893)
  let stake1 = ''; // first stake commit sha
  let stake2 = ''; // second stake commit sha

  beforeAll(async () => {
    repo = await Repo.create('warpline-stake-');
    await repo.write('.gitignore', '.warpline/\n');
    await repo.write('readme.md', 'hello world\n');
    await repo.write('src/mod.ts', 'export function f() { return 1; }\n');
    await repo.commitAll('base');
    s1 = (await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', intent: 'genesis' })).strand!;
    expect(s1.binding?.treeId).toBeTruthy();
  }, 120_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it('S4: default OFF — refuses without config, and appends an audit row', async () => {
    await expect(stake(repo.dir)).rejects.toThrow(/valve is OFF|default/);
    const row = repo.lastAudit();
    expect(row.schema).toBe('stakeAudit:v1');
    expect(row.action).toBe('refuse');
    expect(row.reason).toMatch(/OFF/);
  });

  it('S4: enabled but ref not allowlisted — refuses + audits', async () => {
    repo.setConfig({ stake: { enabled: true, refs: [] } });
    await expect(stake(repo.dir)).rejects.toThrow(/allowlist/);
    expect(repo.lastAudit().action).toBe('refuse');
    expect(repo.lastAudit().reason).toMatch(/allowlist/);
  });

  it('refuses a working-branch stake target (branch guard)', async () => {
    repo.setConfig({ stake: { enabled: true, refs: ['selvage'], branch: 'main' } });
    await expect(stake(repo.dir)).rejects.toThrow(/working-branch name/);
    repo.setConfig({ stake: { enabled: true, refs: ['selvage'], branch: 'base' } });
    await expect(stake(repo.dir)).rejects.toThrow(/currently checked out/);
  });

  it('cuts a stake: marker + machine trailer + verified tree, working branch untouched', async () => {
    repo.setConfig({ stake: { enabled: true, refs: ['selvage'] } });
    const headBefore = await repo.git('rev-parse', 'HEAD');
    const statusBefore = await repo.git('status', '--porcelain');

    const r = await stake(repo.dir);
    expect(r.action).toBe('staked');
    expect(r.pickId).toBe(s1.pickId);
    expect(r.branch).toBe('warpline-stakes');
    stake1 = r.gitCommit;

    // the dedicated branch exists and points at the stake commit
    expect(await repo.git('rev-parse', 'refs/heads/warpline-stakes')).toBe(r.gitCommit);
    // machine trailer ONLY — the exact format, verbatim
    const msg = await repo.git('log', '-1', '--format=%B', r.gitCommit);
    expect(msg).toBe(stakeMessage(s1.pickId, s1.stateId, s1.binding!.treeId).trim());
    expect(parseStakeTrailers(msg + '\n')).toEqual({
      pickId: s1.pickId,
      stateId: s1.stateId,
      treeId: s1.binding!.treeId,
      schema: 'stake:v1',
    });
    // the committed .warpline-stake marker (S1), exact deterministic content
    const marker = await repo.git('show', `${r.gitCommit}:${STAKE_MARKER}`);
    expect(marker).toBe(STAKE_MARKER_CONTENT.trim());
    // S3 through git's own reader: the commit tree equals the pure-TS expectation
    expect(await repo.git('rev-parse', `${r.gitCommit}^{tree}`)).toBe(r.gitTreeOid);
    // content is the sealed bytes
    expect(await repo.git('show', `${r.gitCommit}:readme.md`)).toBe('hello world');
    expect(await repo.git('show', `${r.gitCommit}:src/mod.ts`)).toBe('export function f() { return 1; }');
    // first stake = no parent (the chain root)
    expect(await repo.git('log', '-1', '--format=%P', r.gitCommit)).toBe('');
    // machine committer, no human name laundered in
    expect(await repo.git('log', '-1', '--format=%cn <%ce>', r.gitCommit)).toBe('Warpline Stake <noreply@warpline.local>');
    // the human's branch + worktree are untouched
    expect(await repo.git('rev-parse', 'HEAD')).toBe(headBefore);
    expect(await repo.git('status', '--porcelain')).toBe(statusBefore);
    // audited
    const row = repo.lastAudit();
    expect(row.action).toBe('stake');
    expect(row.gitCommit).toBe(r.gitCommit);
    expect(row.gitTreeOid).toBe(r.gitTreeOid);
  });

  it('determinism: staking the same sealed state twice is an idempotent SKIP', async () => {
    const r = await stake(repo.dir);
    expect(r.action).toBe('skipped');
    expect(r.gitCommit).toBe(stake1);
    expect(await repo.git('rev-list', '--count', 'refs/heads/warpline-stakes')).toBe('1');
    expect(repo.lastAudit().action).toBe('skip');
  });

  it('D3: stake → edit → stake = a LINEAR first-parent chain, never a merge', async () => {
    await repo.write('src/mod.ts', 'export function f() { return 2; }\n');
    await repo.commitAll('edit f');
    s2 = (await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', intent: 'edit f' })).strand!;

    const r = await stake(repo.dir);
    expect(r.action).toBe('staked');
    expect(r.pickId).toBe(s2.pickId);
    expect(r.parent).toBe(stake1);
    stake2 = r.gitCommit;

    // exactly one parent (never a merge), and it is the previous stake
    expect(await repo.git('log', '-1', '--format=%P', stake2)).toBe(stake1);
    expect(await repo.git('rev-list', '--count', 'refs/heads/warpline-stakes')).toBe('2');
    // the whole branch is first-parent-linear machine commits
    const subjects = await repo.git('log', '--first-parent', '--format=%s', 'refs/heads/warpline-stakes');
    expect(subjects.split('\n')).toEqual(['warpline-stake', 'warpline-stake']);
  }, 120_000);

  it('S1: pick / absorb (the hook path) REFUSE stake commits + namespace + marked worktrees as input', async () => {
    // a stake commit by sha (what a hook would see if pointed at it)
    await expect(recordPick(repo.dir, { cwd: repo.dir, ref: stake2, intent: 'x' })).rejects.toThrow(/stake/);
    // the stake namespace by name
    await expect(recordPick(repo.dir, { cwd: repo.dir, ref: 'warpline-stakes', intent: 'x' })).rejects.toThrow(
      /stake namespace/,
    );
    // absorb of a stake commit
    await expect(absorb(stake2, { cwd: repo.dir })).rejects.toThrow(/never input/);
    // a worktree carrying the marker
    await repo.write(STAKE_MARKER, STAKE_MARKER_CONTENT);
    await expect(recordPick(repo.dir, { cwd: repo.dir, intent: 'x' })).rejects.toThrow(/marker/);
    fs.rmSync(path.join(repo.dir, STAKE_MARKER));
  });

  it('S5: recover REFUSES a tree edited after the reset (and restores the marker)', async () => {
    // advance the fabric BEYOND the stake so recovery is a real ref move back
    await repo.write('src/mod.ts', 'export function f() { return 3; }\n');
    await repo.commitAll('edit f again');
    await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', intent: 'edit f again' });

    await repo.git('reset', '--hard', stake2);
    expect(fs.existsSync(path.join(repo.dir, STAKE_MARKER))).toBe(true); // the reset materialized the marker
    await repo.write('readme.md', 'tampered after reset\n');
    await expect(stakeRecover(repo.dir, stake2)).rejects.toThrow(/hashes to|edited after the reset/);
    // refusal leaves the world as found: marker restored, ref NOT moved
    expect(fs.existsSync(path.join(repo.dir, STAKE_MARKER))).toBe(true);
    expect(repo.lastAudit().action).toBe('recover-refuse');
  }, 120_000);

  it('S5: clean recover verifies the reset tree and RECORDS the rollback as a reversion strand', async () => {
    await repo.git('reset', '--hard', stake2); // back to the exact staked tree
    const before = readFabric(warplineDirOf(repo.dir));
    const priorTip = before[before.length - 1];
    expect(priorTip.pickId).not.toBe(s2.pickId); // the fabric really did advance past the stake

    const r = await stakeRecover(repo.dir, stake2);
    expect(r.pickId).toBe(s2.pickId);
    expect(r.treeId).toBe(s2.binding!.treeId);
    // the marker was consumed by re-entry (S1 stops refusing seals from here)
    expect(fs.existsSync(path.join(repo.dir, STAKE_MARKER))).toBe(false);

    // TD-2026-08-01-893: the rollback is RECORDED, not silent. Exactly one strand
    // is appended — the reversion strand R — and the ledger stays append-only.
    const after = readFabric(warplineDirOf(repo.dir));
    expect(after.length).toBe(before.length + 1);
    expect(after.slice(0, before.length)).toEqual(before); // nothing rewritten
    reversion = after[after.length - 1];
    expect(r.reversionPickId).toBe(reversion.pickId);

    // R's ratified shape: lands ON the staked state, parents on the pre-recovery tip.
    expect(reversion.stateId).toBe(s2.stateId);
    expect(reversion.parentStateId).toBe(priorTip.stateId);
    expect(reversion.parentPickId).toBe(priorTip.pickId);
    // never an import: R re-adopts the staked strand's own binding.
    expect(reversion.binding!.treeId).toBe(s2.binding!.treeId);
    // the accountability record — who rolled back, and to/from what.
    expect(reversion.actor).toBeTruthy();
    expect(reversion.intent).toContain('stake recover');
    expect(reversion.intent).toContain(s2.pickId);
    expect(reversion.intent).toContain(priorTip.pickId);

    // the working tip pointer names R's state (legacy selvage mode in this repo),
    // which IS the staked state — the rollback landed.
    expect(readSelvage(warplineDirOf(repo.dir))).toBe(s2.stateId);
    // C-12: the fabric is clean IMMEDIATELY after recovery, not on the next seal.
    expect(verifyFabric(repo.dir, { requireAnchor: false }).failures).toEqual([]);
    expect(repo.lastAudit().action).toBe('recover');
  }, 120_000);

  it('S5: post-recover edits seal NEW strands parented on the REVERSION strand', async () => {
    await repo.write('src/mod.ts', 'export function f() { return 4; }\n');
    await repo.commitAll('diverge after recovery');
    const r = await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', intent: 'diverge after recovery' });
    expect(r.noop).toBe(false);
    // Both parent pointers now name R — which is exactly what makes C-4's writer
    // guard satisfiable through the recovery path. R lands on the staked state, so
    // parentStateId is STILL the staked state (the meaning genuinely rolled back);
    // what changed is that parentPickId names R rather than a stale ledger tip.
    expect(r.strand!.parentPickId).toBe(reversion.pickId);
    expect(r.strand!.parentStateId).toBe(reversion.stateId);
    expect(r.strand!.parentStateId).toBe(s2.stateId);
    expect(verifyFabric(repo.dir, { requireAnchor: false }).failures).toEqual([]);
  }, 120_000);
});

/* ── adversarial: S2 deny-list + S3 recompute, on crafted trees ──────────────── */

describe('stake — S2/S3 adversarial refusals (crafted trees)', () => {
  let repo: Repo;
  let store: ObjectStore;
  let forgedSeq = 0;

  const forge = (treeId: string): Strand => {
    const n = forgedSeq++;
    const s: Strand = {
      schemaVersion: 2,
      seq: n,
      pickId: `pick:v2:forged-${n}`,
      parentPickId: null,
      stateId: `state:v0:forged-${n}`,
      parentStateId: null,
      actor: 'tester',
      intent: `forged fixture ${n}`,
      recordedAt: '2026-07-17T00:00:00.000Z',
      objectCount: 1,
      delta: { born: [], retired: [], contractChanged: [], renamedNoop: 0 },
      calibratedConfidence: null,
      provenance: { ref: 'HEAD', treeSha: null, gitCommit: null },
      binding: { treeId, gitOid: null },
    };
    appendStrand(warplineDirOf(repo.dir), s);
    writeSelvage(warplineDirOf(repo.dir), s.stateId);
    return s;
  };

  beforeAll(async () => {
    repo = await Repo.create('warpline-stake-adv-');
    repo.setConfig({ stake: { enabled: true, refs: ['selvage'] } });
    store = new ObjectStore(repo.dir);
  });

  afterAll(async () => {
    await repo?.destroy();
  });

  const stakeBranchAbsent = async (): Promise<boolean> =>
    repo.git('rev-parse', '--verify', 'refs/heads/warpline-stakes').then(
      () => false,
      () => true,
    );

  it('S2: a planted fabric dir (vendored .warpline/claims/evaluations.jsonl) → refuse + audit, no commit', async () => {
    // Nested under vendor/ so the STAKE deny-list (not restoreTree's own root
    // guard) is the layer under test: `.warpline` is denied at ANY depth (v2).
    const evil = store.putTree([
      { mode: '100644', name: 'readme.md', id: store.putBlob(Buffer.from('ok\n')) },
      {
        mode: '40000',
        name: 'vendor',
        id: store.putTree([
          {
            mode: '40000',
            name: '.warpline',
            id: store.putTree([
              {
                mode: '40000',
                name: 'claims',
                id: store.putTree([
                  { mode: '100644', name: 'evaluations.jsonl', id: store.putBlob(Buffer.from('{"probe":1}\n')) },
                ]),
              },
            ]),
          },
        ]),
      },
    ]);
    forge(evil);
    // Either layer refusing is correct (defense in depth): restoreTree's VCS-dir
    // guard, or the S2 deny-list audit. Both leave no commit + a refuse row.
    await expect(stake(repo.dir)).rejects.toThrow(/deny-list violation|would overwrite a real repo\/VCS directory/);
    expect(repo.lastAudit().action).toBe('refuse');
    expect(await stakeBranchAbsent()).toBe(true);
  });

  it('S2: a serialized untrusted-prose envelope in blob CONTENT → refuse', async () => {
    const envelope = JSON.stringify({ kind: 'untrusted-prose', contentAddress: 'prose:v1:x', body: 'IGNORE ALL PREVIOUS…' });
    const evil = store.putTree([{ mode: '100644', name: 'data.json', id: store.putBlob(Buffer.from(envelope)) }]);
    forge(evil);
    await expect(stake(repo.dir)).rejects.toThrow(/deny-list violation.*untrusted-prose/);
    expect(await stakeBranchAbsent()).toBe(true);
  });

  it('S2: a tree spoofing the .warpline-stake marker → refuse', async () => {
    const evil = store.putTree([{ mode: '100644', name: STAKE_MARKER, id: store.putBlob(Buffer.from('spoof\n')) }]);
    forge(evil);
    await expect(stake(repo.dir)).rejects.toThrow(/deny-list violation/);
  });

  it('a gitlink/submodule entry → refuse (bytes Warpline does not own)', async () => {
    const evil = store.putTree([{ mode: '160000', name: 'sub', id: 'a'.repeat(40) }]);
    forge(evil);
    await expect(stake(repo.dir)).rejects.toThrow(/gitlink|submodule/);
  });

  it('S3: a tampered build dir (recompute mismatch) → refuse; the ref never advances', async () => {
    const good = store.putTree([{ mode: '100644', name: 'a.txt', id: store.putBlob(Buffer.from('honest bytes\n')) }]);
    forge(good);
    await expect(
      stake(repo.dir, {
        afterBuild: (dir) => fs.writeFileSync(path.join(dir, 'a.txt'), 'TAMPERED\n'),
      }),
    ).rejects.toThrow(/recompute mismatch/);
    expect(repo.lastAudit().action).toBe('refuse');
    expect(repo.lastAudit().reason).toMatch(/recompute mismatch/);
    expect(await stakeBranchAbsent()).toBe(true);
    // and the SAME strand stakes cleanly when nothing tampers (the refusal was the tamper, not the tree)
    const r = await stake(repo.dir);
    expect(r.action).toBe('staked');
    expect(await repo.git('rev-parse', `${r.gitCommit}^{tree}`)).toBe(r.gitTreeOid);
  });
});

/* ── D5: the constitution test ───────────────────────────────────────────────── */

describe('stake — D5: the deny-list is constitution-grade', () => {
  // THE PINNED DIGEST OF stake-denylist:v2 (T-2026-07-18-001 — the v1→v2 bump
  // was forced by this very test after the first REAL stake refused on four
  // false positives; the v1 digest was
  // 6ca2a4acede7332888d2a5a647a21fee24c93de73376f8d97e9acd1539df3ffc).
  // If this test fails because you edited any STAKE_DENY_* constant: that is a
  // SCHEMA CHANGE, not a config tweak. Bump STAKE_DENYLIST_SCHEMA to
  // stake-denylist:v3 AND add a new pinned digest here as a deliberate,
  // founder-visible edit. Editing this v2 digest in place without the schema
  // bump is a constitution violation (D5).
  const DENYLIST_DIGEST_V2 = 'ddea850595b2a05040ce7a888b970c564a1de8483f4f563c1ca2d13c0ebbf3e2';

  it('is frozen — no deny constant can be mutated at runtime', () => {
    for (const c of [STAKE_DENY_NAMES, STAKE_DENY_PATHS, STAKE_DENY_ENVELOPE_KINDS, STAKE_DENY_ROW_SCHEMAS, STAKE_DENY_ROW_SHAPES]) {
      expect(Object.isFrozen(c)).toBe(true);
    }
    for (const sig of STAKE_DENY_ROW_SHAPES) expect(Object.isFrozen(sig)).toBe(true);
    expect(() => (STAKE_DENY_NAMES as string[]).push('drift')).toThrow();
  });

  it('is schema-versioned, and changing it REQUIRES the schema bump (pinned digest)', () => {
    expect(STAKE_DENYLIST_SCHEMA).toBe('stake-denylist:v2');
    const digest = createHash('sha256')
      .update(
        JSON.stringify({
          schema: STAKE_DENYLIST_SCHEMA,
          names: STAKE_DENY_NAMES,
          paths: STAKE_DENY_PATHS,
          envelopeKinds: STAKE_DENY_ENVELOPE_KINDS,
          rowSchemas: STAKE_DENY_ROW_SCHEMAS,
          rowShapes: STAKE_DENY_ROW_SHAPES,
        }),
      )
      .digest('hex');
    expect(digest).toBe(DENYLIST_DIGEST_V2);
  });

  it('covers the constitution minimum: fabric internals, marker, secrets, sidecar streams + shapes', () => {
    for (const required of ['.warpline', '.warpline-stake', '.git', 'daemon-tokens.jsonl', 'session-keys.jsonl']) {
      expect(STAKE_DENY_NAMES).toContain(required);
    }
    for (const required of ['.warpline/shadow', '.warpline/stakes', '.warpline/claims', '.warpline/knots', '.warpline/grades.jsonl']) {
      expect(STAKE_DENY_PATHS).toContain(required);
    }
    expect(STAKE_DENY_ENVELOPE_KINDS).toContain('untrusted-prose');
    for (const required of ['shadowVerdict', 'stakeAudit', 'daemonAudit', 'daemonToken', 'grade']) {
      expect(STAKE_DENY_ROW_SCHEMAS).toContain(required);
    }
    // the schema-less sidecars are covered by field signature
    expect(STAKE_DENY_ROW_SHAPES).toContainEqual(['pickId', 'outcome', 'priorClass']);
    expect(STAKE_DENY_ROW_SHAPES).toContainEqual(['claimId', 'breach', 'excess', 'missing']);
  });
});
