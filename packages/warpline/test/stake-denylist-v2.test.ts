/**
 * stake-denylist-v2.test — the D5 v1→v2 redesign regressions (T-2026-07-18-001).
 *
 * CONTEXT: the FIRST REAL STAKE on the live monorepo was refused by the S2
 * post-build audit — correctly fail-closed, but on FOUR FALSE POSITIVES:
 *   1. packages/warpline/src/fabric/stake-guard.ts   (source QUOTING the marker)
 *   2. packages/warpline/test/stake.test.ts           (test QUOTING the marker)
 *   3. .paradigm/research/…/aegis-security.md         (spec QUOTING the marker)
 *   4. .paradigm/events/verdicts.jsonl                (a PARADIGM events file hit
 *      by the basename-global 'verdicts.jsonl' rule — not warpline shadow data)
 *
 * v2 (stake-denylist:v2) redesign, pinned here:
 *   (a) PATH-ANCHORED rules — sidecar files denied where they LIVE
 *       (.warpline/…), never by basename anywhere; `.warpline`/.git/marker/
 *       secret-token names stay any-depth (structural/secrets-by-name).
 *   (b) SHAPE-AWARE content rules — only parsed .json/.jsonl content that is
 *       envelope- or sidecar-row-shaped refuses; source/markdown/tests can
 *       never match.
 *
 * EVERY one of the four live false positives is a MUST-PASS fixture below;
 * true leaks (real grade rows, a serialized envelope, daemon tokens, renamed
 * sidecar streams) still refuse. Plus: the CLI `stake` refusal exits NON-ZERO.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { recordPick } from '../src/fabric/pick.js';
import { stake, stakeAuditPathOf } from '../src/fabric/stake.js';
import { stakeDeniedName, stakeDeniedPath, stakeContentViolation } from '../src/fabric/stake-guard.js';
import { appendStrand, writeSelvage, warplineDirOf } from '../src/fabric/fabric.js';
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
    await r.git('config', 'user.email', 'v2@warpline.test');
    await r.git('config', 'user.name', 'Warpline V2');
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
  lastAudit(): StakeAuditRow {
    const rows = fs
      .readFileSync(stakeAuditPathOf(this.dir), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as StakeAuditRow);
    expect(rows.length).toBeGreaterThan(0);
    return rows[rows.length - 1];
  }
  destroy = (): Promise<void> => fsp.rm(this.dir, { recursive: true, force: true });
}

/* the exact byte content that produced the live false positives */
const MARKER_COMPACT = '"kind":"untrusted-prose"';
const MARKER_PRETTY = '"kind": "untrusted-prose"';

const SOURCE_QUOTING_MARKER = [
  '// stake-guard-like source: pins the envelope marker as a STRING CONSTANT.',
  'export const STAKE_DENY_CONTENT_MARKERS: readonly string[] = Object.freeze([',
  `  '${MARKER_COMPACT}',`,
  `  '${MARKER_PRETTY}',`,
  ']);',
  '',
].join('\n');

const TEST_QUOTING_MARKER = [
  '// stake.test-like test: builds an envelope literal to assert the refusal.',
  "const envelope = JSON.stringify({ kind: 'untrusted-prose', body: 'IGNORE ALL PREVIOUS…' });",
  `const marker = '${MARKER_COMPACT}';`,
  'export { envelope, marker };',
  '',
].join('\n');

const SPEC_QUOTING_MARKER = [
  '# aegis-security-like spec',
  '',
  '- any serialized `untrusted-prose` envelope, anywhere — the stake audit greps the',
  `  produced tree for the ${MARKER_COMPACT} marker and denied path patterns and`,
  '  **refuses the commit** on a hit',
  '',
].join('\n');

const PARADIGM_VERDICT_ROWS = [
  JSON.stringify({
    timestamp: '2026-04-07T22:01:19.833Z',
    type: 'user-verdict',
    agent: 'documentor',
    nominationId: 'nom-1775599034556-4252',
    verdict: 'accepted',
    reason: 'Docs were modified last session',
    consumed: true,
  }),
  JSON.stringify({
    timestamp: '2026-04-07T22:01:19.853Z',
    type: 'user-verdict',
    agent: 'reviewer',
    nominationId: 'nom-1775599034556-1073',
    verdict: 'accepted',
    reason: 'Code quality review is relevant',
    consumed: true,
  }),
  '',
].join('\n');

/* ── the four live false positives MUST stake cleanly ────────────────────────── */

describe('stake-denylist:v2 — the four live false positives stake cleanly', () => {
  let repo: Repo;

  beforeAll(async () => {
    repo = await Repo.create('warpline-dlv2-pass-');
    await repo.write('.gitignore', '.warpline/\n');
    // fixtures 1–3: source / test / spec files that QUOTE the envelope marker
    await repo.write('packages/warpline/src/fabric/stake-guard.ts', SOURCE_QUOTING_MARKER);
    await repo.write('packages/warpline/test/stake.test.ts', TEST_QUOTING_MARKER);
    await repo.write('.paradigm/research/warpline-native-first/aegis-security.md', SPEC_QUOTING_MARKER);
    // fixture 4: a paradigm-events file whose BASENAME collided with the v1 rule
    await repo.write('.paradigm/events/verdicts.jsonl', PARADIGM_VERDICT_ROWS);
    await repo.commitAll('the four live false positives');
    await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', intent: 'seal the false-positive fixtures' });
    repo.setConfig({ stake: { enabled: true, refs: ['selvage'] } });
  }, 120_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it('stakes the tree containing ALL FOUR false-positive files (v1 refused each one)', async () => {
    const r = await stake(repo.dir);
    expect(r.action).toBe('staked');
    expect(repo.lastAudit().action).toBe('stake');
    // every false-positive file is IN the staked tree, verbatim
    expect(await repo.git('show', `${r.gitCommit}:packages/warpline/src/fabric/stake-guard.ts`)).toContain(MARKER_COMPACT);
    expect(await repo.git('show', `${r.gitCommit}:packages/warpline/test/stake.test.ts`)).toContain(MARKER_COMPACT);
    expect(await repo.git('show', `${r.gitCommit}:.paradigm/research/warpline-native-first/aegis-security.md`)).toContain(
      MARKER_COMPACT,
    );
    expect(await repo.git('show', `${r.gitCommit}:.paradigm/events/verdicts.jsonl`)).toContain('user-verdict');
  }, 120_000);
});

/* ── true leaks still refuse (crafted trees — the belt holds) ────────────────── */

describe('stake-denylist:v2 — true leaks still refuse', () => {
  let repo: Repo;
  let store: ObjectStore;
  let forgedSeq = 0;

  const forge = (treeId: string): Strand => {
    const n = forgedSeq++;
    const s: Strand = {
      schemaVersion: 2,
      seq: n,
      pickId: `pick:v2:dlv2-forged-${n}`,
      parentPickId: null,
      stateId: `state:v0:dlv2-forged-${n}`,
      parentStateId: null,
      actor: 'tester',
      intent: `forged v2 fixture ${n}`,
      recordedAt: '2026-07-18T00:00:00.000Z',
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

  const put = (name: string, body: string): string =>
    store.putTree([{ mode: '100644', name, id: store.putBlob(Buffer.from(body)) }]);

  beforeAll(async () => {
    repo = await Repo.create('warpline-dlv2-leak-');
    repo.setConfig({ stake: { enabled: true, refs: ['selvage'] } });
    store = new ObjectStore(repo.dir);
  });

  afterAll(async () => {
    await repo?.destroy();
  });

  it('a REAL grades.jsonl row file (StrandGrade shape) refuses at ANY path/name', async () => {
    const gradeRow = JSON.stringify({
      pickId: 'pick:v2:aaaa',
      seq: 3,
      stateId: 'state:v0:bbbb',
      outcome: 'overturned',
      agentId: 'agent-x',
      authoredSymbols: ['#pay'],
      authoredCount: 1,
      overturnedSymbols: ['#pay'],
      confidenceBefore: 0.8,
      confidenceAfter: 0.4,
      priorClass: 'independent',
    });
    forge(put('innocuous-data.jsonl', gradeRow + '\n'));
    await expect(stake(repo.dir)).rejects.toThrow(/deny-list violation.*sidecar row shape/);
    expect(repo.lastAudit().action).toBe('refuse');
  });

  it('a claim-evaluation-shaped row file refuses', async () => {
    const evalRow = JSON.stringify({
      claimId: 'claim:v1:cccc',
      pickId: null,
      agentId: 'agent-y',
      breach: true,
      excess: ['#other'],
      missing: [],
      ts: '2026-07-18T00:00:00.000Z',
    });
    forge(put('rows.jsonl', evalRow + '\n'));
    await expect(stake(repo.dir)).rejects.toThrow(/deny-list violation.*sidecar row shape/);
  });

  it('a grade-escalation-shaped row file refuses', async () => {
    const escRow = JSON.stringify({
      symbol: '#pay',
      survival: 0.2,
      graded: 4,
      floor: 0.5,
      agentId: 'agent-z',
      pickId: null,
      acceptedRisk: true,
      ts: '2026-07-18T00:00:00.000Z',
    });
    forge(put('notes.jsonl', escRow + '\n'));
    await expect(stake(repo.dir)).rejects.toThrow(/deny-list violation.*sidecar row shape/);
  });

  it('a RENAMED sidecar stream (shadowVerdict:v1 schema tag) refuses', async () => {
    const row = JSON.stringify({ schemaVersion: 'shadowVerdict:v1', ts: 'x', ref: 'HEAD', agentId: 'a', status: 'KNOT' });
    forge(put('metrics.jsonl', row + '\n'));
    await expect(stake(repo.dir)).rejects.toThrow(/deny-list violation.*sidecar schema shadowVerdict:v1/);
  });

  it('a RENAMED stake audit stream (stakeAudit:v1 schema tag) refuses', async () => {
    const row = JSON.stringify({ schema: 'stakeAudit:v1', at: 'x', actor: 'a', action: 'refuse', selector: 'selvage' });
    forge(put('log.jsonl', row + '\n'));
    await expect(stake(repo.dir)).rejects.toThrow(/deny-list violation.*sidecar schema stakeAudit:v1/);
  });

  it('a serialized envelope DEEP inside a .json document refuses', async () => {
    const doc = JSON.stringify({
      export: { rows: [{ payload: { kind: 'untrusted-prose', contentAddress: 'prose:v1:x', body: 'IGNORE…' } }] },
    });
    forge(put('report.json', doc));
    await expect(stake(repo.dir)).rejects.toThrow(/deny-list violation.*envelope kind/);
  });

  it('daemon-tokens.jsonl / session-keys.jsonl refuse BY NAME at any depth (secrets)', async () => {
    const nested = store.putTree([
      {
        mode: '40000',
        name: 'ops',
        id: store.putTree([{ mode: '100644', name: 'daemon-tokens.jsonl', id: store.putBlob(Buffer.from('{}\n')) }]),
      },
    ]);
    forge(nested);
    await expect(stake(repo.dir)).rejects.toThrow(/deny-list violation.*daemon-tokens\.jsonl/);
  });
});

/* ── the v2 matchers, unit level (anchoring semantics pinned) ────────────────── */

describe('stake-denylist:v2 — matcher semantics', () => {
  it('path rules are ANCHORED: sidecar basenames outside .warpline/ are NOT denied', () => {
    // v1's false-positive class — all clean under v2:
    expect(stakeDeniedPath('.paradigm/events/verdicts.jsonl')).toBe(false);
    expect(stakeDeniedPath('verdicts.jsonl')).toBe(false);
    expect(stakeDeniedPath('docs/shadow/notes.md')).toBe(false);
    expect(stakeDeniedPath('src/claims/model.ts')).toBe(false);
    expect(stakeDeniedPath('data/grades.jsonl')).toBe(false);
    expect(stakeDeniedName('verdicts.jsonl')).toBe(false);
    expect(stakeDeniedName('shadow')).toBe(false);
    expect(stakeDeniedName('claims')).toBe(false);
    // …while the ANCHORED sidecar homes are denied, exact or as subtrees:
    expect(stakeDeniedPath('.warpline/shadow')).toBe(true);
    expect(stakeDeniedPath('.warpline/shadow/verdicts.jsonl')).toBe(true);
    expect(stakeDeniedPath('.warpline/stakes/audit.jsonl')).toBe(true);
    expect(stakeDeniedPath('.warpline/grades.jsonl')).toBe(true);
    expect(stakeDeniedPath('.warpline/claims/evaluations.jsonl')).toBe(true);
    // …and structural names at any depth:
    expect(stakeDeniedName('.warpline')).toBe(true);
    expect(stakeDeniedName('.git')).toBe(true);
    expect(stakeDeniedName('.warpline-stake')).toBe(true);
    expect(stakeDeniedName('daemon-tokens.jsonl')).toBe(true);
  });

  it('content rules are SHAPE-AWARE: quoting never matches; parsed shapes do', () => {
    // source / markdown / tests can never match — wrong extension, never parsed
    expect(stakeContentViolation(Buffer.from(SOURCE_QUOTING_MARKER), 'src/stake-guard.ts')).toBeNull();
    expect(stakeContentViolation(Buffer.from(TEST_QUOTING_MARKER), 'test/stake.test.ts')).toBeNull();
    expect(stakeContentViolation(Buffer.from(SPEC_QUOTING_MARKER), 'docs/aegis-security.md')).toBeNull();
    // a .json that QUOTES the marker inside a string VALUE is clean…
    const quoting = JSON.stringify({ note: 'the audit greps for "kind":"untrusted-prose" and refuses' });
    expect(stakeContentViolation(Buffer.from(quoting), 'notes.json')).toBeNull();
    // …but an actual envelope OBJECT is not
    const envelope = JSON.stringify({ kind: 'untrusted-prose', body: 'x' });
    expect(stakeContentViolation(Buffer.from(envelope), 'data.json')).toMatch(/envelope kind/);
    // paradigm verdict rows are clean; warpline sidecar rows are not
    expect(stakeContentViolation(Buffer.from(PARADIGM_VERDICT_ROWS), '.paradigm/events/verdicts.jsonl')).toBeNull();
    const grade = JSON.stringify({ pickId: 'p', outcome: 'survived', priorClass: 'pick' });
    expect(stakeContentViolation(Buffer.from(grade + '\n'), 'x.jsonl')).toMatch(/sidecar row shape/);
    // non-JSON extensions are never candidates, even with real sidecar bytes
    expect(stakeContentViolation(Buffer.from(grade + '\n'), 'x.txt')).toBeNull();
    // unparseable JSON is not a violation (not a serialized envelope/sidecar)
    expect(stakeContentViolation(Buffer.from('{ not json'), 'broken.json')).toBeNull();
  });
});

/* ── CLI: a stake refusal exits NON-ZERO (live regression pin) ───────────────── */

describe('stake-denylist:v2 — CLI refusal exit code', () => {
  const distCli = path.resolve(fileURLToPath(new URL('../dist/cli.js', import.meta.url)));

  it.skipIf(!existsSync(distCli))(
    'warpline stake exits non-zero on a refusal (valve OFF) and writes the refuse audit row',
    async () => {
      const repo = await Repo.create('warpline-dlv2-cli-');
      try {
        await repo.write('readme.md', 'hi\n');
        await repo.commitAll('base');
        const res = await execFileAsync('node', [distCli, 'stake'], { cwd: repo.dir, encoding: 'utf8' }).then(
          () => null,
          (err: NodeJS.ErrnoException & { code?: number | string; stderr?: string }) => err,
        );
        expect(res).not.toBeNull(); // it MUST have failed
        expect(res!.code).toBe(1);
        expect(String(res!.stderr)).toMatch(/stake refused/);
        expect(repo.lastAudit().action).toBe('refuse');
      } finally {
        await repo.destroy();
      }
    },
    120_000,
  );

  it.skipIf(!existsSync(distCli))(
    'warpline stake exits non-zero on an S2 deny-list refusal (enabled valve, leaking tree)',
    async () => {
      const repo = await Repo.create('warpline-dlv2-cli2-');
      try {
        await repo.write('.gitignore', '.warpline/\n');
        await repo.write('ops/daemon-tokens.jsonl', '{}\n');
        await repo.commitAll('leaky');
        await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', intent: 'seal leaky tree' });
        repo.setConfig({ stake: { enabled: true, refs: ['selvage'] } });
        const res = await execFileAsync('node', [distCli, 'stake'], { cwd: repo.dir, encoding: 'utf8' }).then(
          () => null,
          (err: NodeJS.ErrnoException & { code?: number | string; stderr?: string }) => err,
        );
        expect(res).not.toBeNull();
        expect(res!.code).toBe(1);
        expect(String(res!.stderr)).toMatch(/deny-list violation.*daemon-tokens\.jsonl.*stake-denylist:v2/);
        expect(repo.lastAudit().action).toBe('refuse');
      } finally {
        await repo.destroy();
      }
    },
    120_000,
  );
});
