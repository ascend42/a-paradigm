/**
 * field-oracle.test — the §4 CLEAN-seal oracle automation (B7 increment 1).
 *
 *   POWER      : a check red on EITHER parent alone is 'excluded-parent-red'
 *                (proves nothing); green-both-parents + red-on-merge is an
 *                OBJECTIVE regression → verdict 'candidate-false-clean'.
 *   BLIND      : the §8 path classifier — app.config.js and package-lock.json
 *                are blind, src/foo.ts is covered; a merge touching ONLY blind
 *                classes is 'blind-untested' regardless of check greenness.
 *   ABSENT GATE: no greengate.json → every check 'absent', never a pass.
 *   LEDGER     : hash-chained rows, tamper detection, idempotent re-run.
 *
 * FAKE exec throughout: the CheckRunner is injected; tsc/expo never run here.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import * as fs from 'node:fs';
import { ObjectStore } from '../src/warp/object-store.js';
import { snapshotDir } from '../src/warp/snapshot.js';
import { classifyBlindPath, coveredClassOf } from '../src/field/blind-class.js';
import {
  discoverAuditTargets,
  auditOne,
  appendAuditRow,
  readAuditLedger,
  verifyAuditLedger,
  runFieldOracle,
  greenGatePathOf,
  readGreenGate,
  oracleRowHashOf,
  fieldOracleLedgerPathOf,
  type AuditTarget,
  type CheckRunner,
  type GreenGateConfig,
  type OracleRow,
  type OracleRowBody,
} from '../src/field/oracle.js';

/** Snapshot an in-memory file map into the store; returns the root treeId. */
function treeOf(store: ObjectStore, scratch: string, files: Record<string, string>): string {
  const dir = fs.mkdtempSync(nodePath.join(scratch, 'tree-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = nodePath.join(dir, rel);
    fs.mkdirSync(nodePath.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, 'utf8');
  }
  return snapshotDir(store, dir).treeId;
}

/** A fake runner that decides by (check name × which restored dir it runs in). */
function fakeRunner(
  table: Record<string, { ours: 'pass' | 'fail'; theirs: 'pass' | 'fail'; merged: 'pass' | 'fail' }>,
  calls?: Array<{ name: string; side: string }>,
): CheckRunner {
  return async (spec, cwd) => {
    const side = nodePath.basename(cwd) as 'ours' | 'theirs' | 'merged';
    calls?.push({ name: spec.name, side });
    const row = table[spec.name];
    if (!row) return { status: 'pass', output: '' };
    return { status: row[side] ?? 'pass', output: `${spec.name}@${side}` };
  };
}

const BASE_FILES = {
  'src/foo.ts': 'export function foo() { return 1; }\n',
  'src/bar.ts': 'export function bar() { return 2; }\n',
  'app.config.js': 'module.exports = { retries: 100 };\n',
  'package-lock.json': '{ "lockfileVersion": 3 }\n',
};

describe('FIELD BLIND-CLASS — the §8 path classifier', () => {
  it('classifies the §8 path-expressible classes with reasons', () => {
    expect(classifyBlindPath('app.config.js').blind).toBe(true);
    expect(classifyBlindPath('app.config.js').reason).toContain('config');
    expect(classifyBlindPath('nested/babel.config.cjs').blind).toBe(true);
    expect(classifyBlindPath('.env').blind).toBe(true);
    expect(classifyBlindPath('.env.production').blind).toBe(true);
    expect(classifyBlindPath('package-lock.json').blind).toBe(true);
    expect(classifyBlindPath('package-lock.json').reason).toContain('lockfile');
    expect(classifyBlindPath('yarn.lock').blind).toBe(true);
    expect(classifyBlindPath('assets/logo.png').blind).toBe(true);
    expect(classifyBlindPath('fonts/Inter.woff2').blind).toBe(true);
    expect(classifyBlindPath('scripts/build.mjs').blind).toBe(true); // no lens covers .mjs
    // covered: the lifted classes
    expect(classifyBlindPath('src/foo.ts')).toEqual({ blind: false, reason: null });
    expect(classifyBlindPath('src/screen.tsx').blind).toBe(false);
    expect(classifyBlindPath('app.json').blind).toBe(false); // cfg-lens covers .json
  });

  it('coveredClass is false for blind-only, empty, or UNDERIVABLE change sets', () => {
    expect(coveredClassOf(['app.config.js', 'package-lock.json']).coveredClass).toBe(false);
    expect(coveredClassOf(['app.config.js', 'src/foo.ts']).coveredClass).toBe(true);
    expect(coveredClassOf([]).coveredClass).toBe(false);
    expect(coveredClassOf(null).coveredClass).toBe(false); // ignorance is not coverage
    const r = coveredClassOf(['app.config.js', 'src/foo.ts']);
    expect(r.blind).toEqual([{ path: 'app.config.js', reason: expect.stringContaining('§8') }]);
  });
});

describe('FIELD GREENGATE — explicit path vs default path absence', () => {
  it('default path ENOENT → null (no declared gate); EXPLICIT path ENOENT → throws', () => {
    const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'field-gate-'));
    expect(readGreenGate(root)).toBeNull(); // default absence is honest "absent"
    expect(() => readGreenGate(root, nodePath.join(root, 'typo', 'greengate.json'))).toThrow(
      /explicitly given path/,
    );
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('FIELD ORACLE — §4 audit (fake exec, synthetic fabric)', () => {
  let root: string;
  let scratch: string;
  let store: ObjectStore;
  let baseTree: string;
  let oursTree: string;
  let theirsTree: string;
  let mergedTree: string;
  let mergeTarget: AuditTarget;

  const writeFabric = (strands: object[]): void => {
    fs.mkdirSync(nodePath.join(root, '.warpline'), { recursive: true });
    fs.writeFileSync(
      nodePath.join(root, '.warpline', 'fabric.jsonl'),
      strands.map((s) => JSON.stringify(s)).join('\n') + '\n',
      'utf8',
    );
  };

  const strand = (over: Record<string, unknown>): Record<string, unknown> => ({
    schemaVersion: 3,
    parents: [],
    stateId: 'state:v0:0000',
    actor: 'test',
    authoredBy: { agentId: null },
    intent: 'fixture',
    recordedAt: '2026-08-23T00:00:00.000Z',
    objectCount: 1,
    delta: { added: [], removed: [], changed: [] },
    provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
    ...over,
  });

  beforeAll(() => {
    root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'warpline-field-oracle-root-'));
    scratch = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'warpline-field-oracle-fixtures-'));
    store = new ObjectStore(root);
    baseTree = treeOf(store, scratch, BASE_FILES);
    oursTree = treeOf(store, scratch, { ...BASE_FILES, 'src/foo.ts': 'export function foo() { return 10; }\n' });
    theirsTree = treeOf(store, scratch, { ...BASE_FILES, 'src/bar.ts': 'export function bar() { return 20; }\n' });
    mergedTree = treeOf(store, scratch, {
      ...BASE_FILES,
      'src/foo.ts': 'export function foo() { return 10; }\n',
      'src/bar.ts': 'export function bar() { return 20; }\n',
    });

    const g = strand({ pickId: 'pick:v3:genesis0'.padEnd(24, '0'), stateId: 'state:v0:base', binding: { treeId: baseTree } });
    const a = strand({
      pickId: 'pick:v3:oursaaaa'.padEnd(24, 'a'),
      parents: [g.pickId],
      stateId: 'state:v0:ours',
      authoredBy: { agentId: 'agent-a' },
      binding: { treeId: oursTree },
    });
    const b = strand({
      pickId: 'pick:v3:theirsbb'.padEnd(24, 'b'),
      parents: [g.pickId],
      stateId: 'state:v0:theirs',
      authoredBy: { agentId: 'agent-b' },
      binding: { treeId: theirsTree },
    });
    const m = strand({
      pickId: 'pick:v3:mergecccc'.padEnd(24, 'c'),
      parents: [a.pickId, b.pickId],
      stateId: 'state:v0:merged',
      authoredBy: { agentId: 'agent-a' },
      binding: { treeId: mergedTree },
      merge: { algo: 'warpline-merge3-v1', base: baseTree, ours: oursTree, theirs: theirsTree, result: mergedTree },
    });
    writeFabric([g, a, b, m]);
    mergeTarget = discoverAuditTargets(root).find((t) => t.recipe !== null)!;
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('discoverAuditTargets reads the fabric without inventing (merge + single-parent seals)', () => {
    const targets = discoverAuditTargets(root);
    expect(targets).toHaveLength(4);
    expect(targets.filter((t) => t.recipe !== null)).toHaveLength(1);
    const m = mergeTarget;
    expect(m.recipe).toEqual({ baseTreeId: baseTree, oursTreeId: oursTree, theirsTreeId: theirsTree, resultTreeId: mergedTree });
    expect(m.agents).toEqual(['agent-a', 'agent-b']);
    expect(m.parentStateIds).toEqual(['state:v0:ours', 'state:v0:theirs']);
    expect(m.mergedTreeId).toBe(mergedTree);
    expect(m.seq).toBeNull(); // v3 strands carry no ledger position — null, not guessed
    // genesis: no parents recorded → falls back to its own author, [] parents
    const g = targets[0];
    expect(g.recipe).toBeNull();
    expect(g.parentTreeIds).toEqual([]);
  });

  const gate: GreenGateConfig = {
    checks: [
      { name: 'typecheck', cmd: 'fake-tsc', args: ['--noEmit'] },
      { name: 'test', cmd: 'fake-vitest', args: [] },
    ],
  };

  it('ESTABLISHING POWER: a check red on either parent alone is excluded-parent-red', async () => {
    const calls: Array<{ name: string; side: string }> = [];
    const row = await auditOne(mergeTarget, {
      store,
      runner: fakeRunner(
        {
          typecheck: { ours: 'fail', theirs: 'pass', merged: 'fail' }, // red parent → excluded
          test: { ours: 'pass', theirs: 'pass', merged: 'pass' },
        },
        calls,
      ),
      checks: gate,
      scratchBase: scratch,
    });
    expect(row.mode).toBe('merge');
    expect(row.oracle.checks.typecheck).toBe('excluded-parent-red');
    expect(row.oracle.checks.test).toBe('pass');
    expect(row.objectiveRegression).toBe(false);
    expect(row.verdict).toBe('true-clean'); // src/foo.ts + src/bar.ts changed → covered
    expect(row.coveredClass).toBe(true);
    expect(row.changedPaths).toEqual(['src/bar.ts', 'src/foo.ts']);
    // parents ran BEFORE the merge for the excluded check; the merged tree was never consulted for it
    expect(calls.filter((c) => c.name === 'typecheck').map((c) => c.side)).toEqual(['ours', 'theirs']);
    expect(calls.filter((c) => c.name === 'test').map((c) => c.side)).toEqual(['ours', 'theirs', 'merged']);
  });

  it('green-on-both-parents + red-on-merge → objectiveRegression → candidate-false-clean, oracle-flagged', async () => {
    const row = await auditOne(mergeTarget, {
      store,
      runner: fakeRunner({
        typecheck: { ours: 'pass', theirs: 'pass', merged: 'pass' },
        test: { ours: 'pass', theirs: 'pass', merged: 'fail' }, // the false CLEAN
      }),
      checks: gate,
      scratchBase: scratch,
    });
    expect(row.oracle.checks.test).toBe('fail');
    expect(row.objectiveRegression).toBe(true);
    expect(row.verdict).toBe('candidate-false-clean');
    expect(row.source).toBe('oracle-flagged');
  });

  it('behavioral assertions run under the same power rule, recorded under oracle.behavioral', async () => {
    const behavioralGate: GreenGateConfig = {
      checks: [],
      behavioral: { script: './smoke.sh', assertions: ['retry-count-matches-config', 'screen-renders'] },
    };
    const row = await auditOne(mergeTarget, {
      store,
      runner: fakeRunner({
        'behavioral:retry-count-matches-config': { ours: 'pass', theirs: 'pass', merged: 'fail' },
        'behavioral:screen-renders': { ours: 'pass', theirs: 'pass', merged: 'pass' },
      }),
      checks: behavioralGate,
      scratchBase: scratch,
    });
    expect(row.oracle.behavioral).toEqual({ 'retry-count-matches-config': 'fail', 'screen-renders': 'pass' });
    expect(row.objectiveRegression).toBe(true); // a frozen assertion regression is objective (§4)
    expect(row.verdict).toBe('candidate-false-clean');
  });

  it('a blind-only merge is blind-untested even when every check passes', async () => {
    const blindOurs = treeOf(store, scratch, { ...BASE_FILES, 'app.config.js': 'module.exports = { retries: 50 };\n' });
    const blindMerged = blindOurs;
    const target: AuditTarget = {
      ...mergeTarget,
      strandId: 'pick:v3:blindmerge',
      pickId: 'pick:v3:blindmerge',
      recipe: { baseTreeId: baseTree, oursTreeId: blindOurs, theirsTreeId: baseTree, resultTreeId: blindMerged },
      mergedTreeId: blindMerged,
    };
    const row = await auditOne(target, {
      store,
      runner: fakeRunner({}), // everything passes
      checks: gate,
      scratchBase: scratch,
    });
    expect(row.coveredClass).toBe(false);
    expect(row.changedPaths).toEqual(['app.config.js']);
    expect(row.blind[0].reason).toContain('§8');
    expect(row.objectiveRegression).toBe(false);
    expect(row.verdict).toBe('blind-untested'); // never evidence for (A) surviving
  });

  it("ABSENT config: every check recorded 'absent', the row says so, and the verdict is never a pass", async () => {
    const row = await auditOne(mergeTarget, {
      store,
      runner: fakeRunner({}),
      checks: null,
      scratchBase: scratch,
    });
    expect(row.greengate).toBe('absent');
    expect(Object.values(row.oracle.checks).every((o) => o === 'absent')).toBe(true);
    expect(row.notes.join(' ')).toContain('greengate');
    expect(row.verdict).toBe('blind-untested'); // untested, NOT 'true-clean'
    expect(row.verdict).not.toBe('true-clean');
  });

  it('single-parent seal: power rule not applicable, result-only run, objectiveRegression always false', async () => {
    const single = discoverAuditTargets(root).find((t) => t.recipe === null && t.parentTreeIds[0])!;
    const calls: Array<{ name: string; side: string }> = [];
    const row = await auditOne(single, {
      store,
      runner: fakeRunner({ test: { ours: 'fail', theirs: 'fail', merged: 'fail' } }, calls),
      checks: gate,
      scratchBase: scratch,
    });
    expect(row.mode).toBe('single-parent');
    expect(row.oracle.checks.test).toBe('fail'); // recorded, but no merge to regress
    expect(row.objectiveRegression).toBe(false);
    expect(calls.every((c) => c.side === 'merged')).toBe(true); // result tree only
  });

  it('the ledger hash-chains, verifies, detects tampering, and the run is idempotent', async () => {
    // fresh root so the ledger starts empty
    const root2 = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'warpline-field-oracle-ledger-'));
    try {
      // copy fabric + objects (same store layout) into root2
      fs.cpSync(nodePath.join(root, '.warpline'), nodePath.join(root2, '.warpline'), { recursive: true });
      fs.mkdirSync(nodePath.dirname(greenGatePathOf(root2)), { recursive: true });
      fs.writeFileSync(greenGatePathOf(root2), JSON.stringify(gate), 'utf8');

      const r1 = await runFieldOracle(root2, { runner: fakeRunner({}), scratchBase: scratch, now: () => 'T0' });
      expect(r1.greengate).toBe('declared');
      expect(r1.audited).toHaveLength(4);
      expect(r1.skipped).toBe(0);
      expect(verifyAuditLedger(root2)).toMatchObject({ ok: true, rows: 4, firstBadIndex: null });

      // rows chain: each prevRowHash is the preceding rowHash
      const rows = readAuditLedger(root2);
      expect(rows[0].prevRowHash).toBeNull();
      for (let i = 1; i < rows.length; i++) expect(rows[i].prevRowHash).toBe(rows[i - 1].rowHash);
      for (const row of rows) {
        const { rowHash, prevRowHash, ...body } = row;
        expect(oracleRowHashOf(body as OracleRowBody, prevRowHash)).toBe(rowHash);
      }

      // IDEMPOTENT: a re-run audits nothing and skips every already-audited strand
      const r2 = await runFieldOracle(root2, { runner: fakeRunner({}), scratchBase: scratch, now: () => 'T1' });
      expect(r2.audited).toHaveLength(0);
      expect(r2.skipped).toBe(4);
      expect(readAuditLedger(root2)).toHaveLength(4);

      // TAMPER: flip a sealed flag → the chain reports the exact row
      const tampered: OracleRow[] = readAuditLedger(root2);
      tampered[1] = { ...tampered[1], objectiveRegression: !tampered[1].objectiveRegression };
      fs.writeFileSync(
        fieldOracleLedgerPathOf(root2),
        tampered.map((r) => JSON.stringify(r)).join('\n') + '\n',
        'utf8',
      );
      const bad = verifyAuditLedger(root2);
      expect(bad.ok).toBe(false);
      expect(bad.firstBadIndex).toBe(1);
    } finally {
      fs.rmSync(root2, { recursive: true, force: true });
    }
  });

  it('appendAuditRow seals onto the current tail (direct append path)', async () => {
    const root3 = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'warpline-field-oracle-append-'));
    try {
      const body = await auditOne(mergeTarget, { store, runner: fakeRunner({}), checks: null, scratchBase: scratch });
      const first = appendAuditRow(root3, body);
      expect(first.prevRowHash).toBeNull();
      const second = appendAuditRow(root3, { ...body, ts: 'T-LATER' });
      expect(second.prevRowHash).toBe(first.rowHash);
      expect(verifyAuditLedger(root3).ok).toBe(true);
    } finally {
      fs.rmSync(root3, { recursive: true, force: true });
    }
  });
});
