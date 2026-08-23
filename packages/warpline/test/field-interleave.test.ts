/**
 * field-interleave.test — the §5 card stream (B7 increment 2).
 *
 *   SAMPLE     : the §4 rule verbatim — every 5th true-clean by ledger order,
 *                floor 15, planted + non-clean rows excluded.
 *   BRIDGE     : OracleRow → blinded CLEAN rating card over the strand's own
 *                MergeRecipe trees; oracle-flagged carries the failing check
 *                NAME, audit-sample carries the F3c sentinel 'none-declared'.
 *   SHUFFLE    : deterministic Fisher–Yates by seed; the seed is COMMITTED —
 *                a later different seed refuses.
 *   SEEDS      : manifest-sealed card sets — sha256 + cardId verified, any
 *                mismatch refuses; absent dirs are empty sets.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import * as fs from 'node:fs';
import { ObjectStore } from '../src/warp/object-store.js';
import { snapshotDir } from '../src/warp/snapshot.js';
import { canonicalSerialize } from '../src/warp/canonical.js';
import { canonicalSafe } from '../src/fabric/strand.js';
import { envelopeProse } from '../src/envelope.js';
import { RATING_CARD_SCHEMA, type RatingCard } from '../src/judge/rating-card.js';
import { rubricRefForCardKind } from '../src/judge/rubric.js';
import { FIELD_ORACLE_ROW_SCHEMA, type OracleRow } from '../src/field/oracle.js';
import {
  selectAuditSample,
  buildCleanCardFromOracleRow,
  provenanceOfOracleRow,
  interleave,
  loadOrCommitShuffleSeed,
  shuffleSeedPathOf,
  loadSeedCards,
  seedsDirOf,
  AUDIT_SAMPLE_SENTINEL_FAILING_CHECK,
} from '../src/field/interleave.js';

/** A minimal OracleRow (hash-chain fields are irrelevant to selection). */
function row(over: Partial<OracleRow>): OracleRow {
  return {
    schemaVersion: FIELD_ORACLE_ROW_SCHEMA,
    ts: 'T0',
    strandId: over.pickId ?? 'pick:v3:x',
    pickId: 'pick:v3:x',
    seq: null,
    mode: 'merge',
    agents: ['a', 'b'],
    parentStateIds: ['state:v0:pa', 'state:v0:pb'],
    mergedTreeId: 'tree:none',
    greengate: 'declared',
    oracle: { checks: { typecheck: 'pass' } },
    changedPaths: ['src/foo.ts'],
    coveredClass: true,
    blind: [],
    objectiveRegression: false,
    source: 'clean-sweep',
    verdict: 'true-clean',
    notes: [],
    prevRowHash: null,
    rowHash: 'fieldOracleRow:v1:deadbeef',
    ...over,
  };
}

describe('FIELD INTERLEAVE — §4 audit-sample selection', () => {
  it('takes every 5th true-clean by LEDGER ORDER when that clears the floor', () => {
    const rows = Array.from({ length: 100 }, (_, i) => row({ pickId: `pick:v3:${i}` }));
    const sel = selectAuditSample(rows);
    expect(sel).toHaveLength(20); // 100 / 5
    expect(sel.map((r) => r.pickId)).toEqual(
      Array.from({ length: 20 }, (_, k) => `pick:v3:${5 * k + 4}`), // 1-based every 5th
    );
  });

  it('floor 15: every-5th under the floor → the FIRST 15 by ledger order; fewer exist → all', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => row({ pickId: `pick:v3:${i}` }));
    const sel = selectAuditSample(twenty);
    expect(sel).toHaveLength(15);
    expect(sel.map((r) => r.pickId)).toEqual(Array.from({ length: 15 }, (_, i) => `pick:v3:${i}`));

    const ten = Array.from({ length: 10 }, (_, i) => row({ pickId: `pick:v3:${i}` }));
    expect(selectAuditSample(ten)).toHaveLength(10); // all
  });

  it('planted rows and non-true-clean rows are EXCLUDED from selection (and from the ordering)', () => {
    const rows: OracleRow[] = [];
    for (let i = 0; i < 110; i++) {
      if (i % 11 === 0) rows.push(row({ pickId: `pick:v3:planted-${i}`, planted: true }));
      else if (i % 7 === 0) rows.push(row({ pickId: `pick:v3:flagged-${i}`, verdict: 'candidate-false-clean', objectiveRegression: true }));
      else rows.push(row({ pickId: `pick:v3:${i}` }));
    }
    const sel = selectAuditSample(rows);
    expect(sel.every((r) => r.verdict === 'true-clean')).toBe(true);
    expect(sel.every((r) => r.planted !== true)).toBe(true);
    // the every-5th rule counts over the ELIGIBLE sequence, not raw ledger indexes
    const eligible = rows.filter((r) => r.verdict === 'true-clean' && r.planted !== true);
    expect(sel.map((r) => r.pickId)).toEqual(eligible.filter((_, i) => (i + 1) % 5 === 0).map((r) => r.pickId));
  });
});

describe('FIELD INTERLEAVE — OracleRow → blinded CLEAN card bridge', () => {
  let root: string;
  let scratch: string;
  let store: ObjectStore;
  let baseTree: string;
  let oursTree: string;
  let theirsTree: string;
  let mergedTree: string;

  const OURS_SRC = 'export function foo() { return 10; }\n';
  const THEIRS_SRC = 'export function bar() { return 20; }\n';

  const treeOf = (files: Record<string, string>): string => {
    const dir = fs.mkdtempSync(nodePath.join(scratch, 'tree-'));
    for (const [rel, body] of Object.entries(files)) {
      const full = nodePath.join(dir, rel);
      fs.mkdirSync(nodePath.dirname(full), { recursive: true });
      fs.writeFileSync(full, body, 'utf8');
    }
    return snapshotDir(store, dir).treeId;
  };

  beforeAll(() => {
    root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'warpline-interleave-root-'));
    scratch = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'warpline-interleave-fixtures-'));
    store = new ObjectStore(root);
    const BASE = { 'src/foo.ts': 'export function foo() { return 1; }\n', 'src/bar.ts': 'export function bar() { return 2; }\n' };
    baseTree = treeOf(BASE);
    oursTree = treeOf({ ...BASE, 'src/foo.ts': OURS_SRC });
    theirsTree = treeOf({ ...BASE, 'src/bar.ts': THEIRS_SRC });
    mergedTree = treeOf({ 'src/foo.ts': OURS_SRC, 'src/bar.ts': THEIRS_SRC });

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
    const g = strand({ pickId: 'pick:v3:genesis0'.padEnd(24, '0'), stateId: 'state:v0:base', binding: { treeId: baseTree } });
    const a = strand({ pickId: 'pick:v3:oursaaaa'.padEnd(24, 'a'), parents: [g.pickId], stateId: 'state:v0:ours', intent: 'raise foo to ten', binding: { treeId: oursTree } });
    const b = strand({ pickId: 'pick:v3:theirsbb'.padEnd(24, 'b'), parents: [g.pickId], stateId: 'state:v0:theirs', intent: 'raise bar to twenty', binding: { treeId: theirsTree } });
    const m = strand({
      pickId: 'pick:v3:mergecccc'.padEnd(24, 'c'),
      parents: [a.pickId, b.pickId],
      stateId: 'state:v0:merged',
      binding: { treeId: mergedTree },
      merge: { algo: 'warpline-merge3-v1', base: baseTree, ours: oursTree, theirs: theirsTree, result: mergedTree },
    });
    fs.mkdirSync(nodePath.join(root, '.warpline'), { recursive: true });
    fs.writeFileSync(
      nodePath.join(root, '.warpline', 'fabric.jsonl'),
      [g, a, b, m].map((s) => JSON.stringify(s)).join('\n') + '\n',
      'utf8',
    );
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  const mergePick = 'pick:v3:mergecccc'.padEnd(24, 'c');

  it('oracle-FLAGGED: sides from the recipe trees, failingCheck = the failing check NAME', () => {
    const r = row({
      pickId: mergePick,
      strandId: mergePick,
      mergedTreeId: null as unknown as string, // set below
      verdict: 'candidate-false-clean',
      objectiveRegression: true,
      oracle: { checks: { typecheck: 'pass', test: 'fail' } },
      changedPaths: ['src/bar.ts', 'src/foo.ts'],
    });
    const card = buildCleanCardFromOracleRow({ ...r, mergedTreeId: mergedTree }, { store, root });
    expect(card.kind).toBe('clean');
    expect(card.filePaths).toEqual(['src/bar.ts', 'src/foo.ts']);
    expect(card.failingCheck).toBe('test');
    // sides read from the strand's own recipe trees
    const oursFiles = card.sides[0].files.map((f) => f.body);
    expect(oursFiles).toContain(OURS_SRC);
    const theirsFiles = card.sides[1].files.map((f) => f.body);
    expect(theirsFiles).toContain(THEIRS_SRC);
    // merged body present for the changed set
    expect(card.mergedBody?.map((f) => f.body)).toContain(OURS_SRC);
    // intents come from the parent strands' recorded intent prose
    expect(card.sides[0].intent.body).toBe('raise foo to ten');
    expect(card.sides[1].intent.body).toBe('raise bar to twenty');
    // provenance: oracle-flagged, ledger-only
    const p = provenanceOfOracleRow(r);
    expect(p.source).toBe('oracle-flagged');
    expect(p.auditSample).toBeUndefined();
    expect(p.objectiveRegression).toBe(true);
  });

  it("audit-sample: failingCheck is the F3c sentinel 'none-declared' and provenance says auditSample", () => {
    const r = row({ pickId: mergePick, strandId: mergePick, mergedTreeId: mergedTree, changedPaths: ['src/foo.ts'] });
    const card = buildCleanCardFromOracleRow(r, { store, root });
    expect(card.failingCheck).toBe(AUDIT_SAMPLE_SENTINEL_FAILING_CHECK);
    const p = provenanceOfOracleRow(r);
    expect(p.source).toBe('audit-sample');
    expect(p.auditSample).toBe(true);
  });

  it('refuses precisely on unrecorded inputs (missing strand / null changedPaths)', () => {
    expect(() =>
      buildCleanCardFromOracleRow(row({ pickId: 'pick:v3:absent', changedPaths: ['a.ts'] }), { store, root }),
    ).toThrow(/no strand in the fabric/);
    expect(() =>
      buildCleanCardFromOracleRow(row({ pickId: mergePick, changedPaths: null }), { store, root }),
    ).toThrow(/changedPaths:null/);
  });
});

describe('FIELD INTERLEAVE — deterministic shuffle + committed seed', () => {
  it('same seed ⇒ identical order; different seed ⇒ different order; input not mutated', () => {
    const cards = Array.from({ length: 12 }, (_, i) => ({ id: i }));
    const snapshot = cards.map((c) => c.id);
    const a1 = interleave(cards, 'aaaaaaaaaaaaaaaa');
    const a2 = interleave(cards, 'aaaaaaaaaaaaaaaa');
    const b = interleave(cards, 'bbbbbbbbbbbbbbbb');
    expect(a1.map((c) => c.id)).toEqual(a2.map((c) => c.id));
    expect(a1.map((c) => c.id)).not.toEqual(b.map((c) => c.id));
    expect(cards.map((c) => c.id)).toEqual(snapshot); // pure
    expect([...a1].sort((x, y) => x.id - y.id).map((c) => c.id)).toEqual(snapshot); // a permutation
  });

  it('the seed is COMMITTED: first call writes it, a later DIFFERENT seed refuses', () => {
    const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'warpline-interleave-seed-'));
    try {
      const seed = loadOrCommitShuffleSeed(root, 'deadbeefdeadbeef');
      expect(seed).toBe('deadbeefdeadbeef');
      expect(fs.readFileSync(shuffleSeedPathOf(root), 'utf8').trim()).toBe('deadbeefdeadbeef');
      // reuse without a proposal → the committed seed
      expect(loadOrCommitShuffleSeed(root)).toBe('deadbeefdeadbeef');
      // same proposal → fine; different → refuse
      expect(loadOrCommitShuffleSeed(root, 'deadbeefdeadbeef')).toBe('deadbeefdeadbeef');
      expect(() => loadOrCommitShuffleSeed(root, 'cafecafecafecafe')).toThrow(/already committed/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('FIELD INTERLEAVE — manifest-sealed seed card sets', () => {
  /** A minimal well-formed RatingCard with a CORRECT content address. */
  function makeCard(kind: 'knot' | 'clean', marker: string): RatingCard {
    const body: Omit<RatingCard, 'cardId'> = {
      schemaVersion: RATING_CARD_SCHEMA,
      kind,
      filePaths: ['src/seed.ts'],
      ...(kind === 'knot' ? { base: { files: [{ filePath: 'src/seed.ts', body: `base ${marker}\n` }] } } : {}),
      ...(kind === 'clean' ? { parents: [{ stateId: 'state:v0:pa' }, { stateId: 'state:v0:pb' }] } : {}),
      sides: [
        {
          role: kind === 'knot' ? 'ours' : 'parentA',
          intent: envelopeProse(`intent A ${marker}`),
          files: [{ filePath: 'src/seed.ts', body: `A ${marker}\n` }],
        },
        {
          role: kind === 'knot' ? 'theirs' : 'parentB',
          intent: envelopeProse(`intent B ${marker}`),
          files: [{ filePath: 'src/seed.ts', body: `B ${marker}\n` }],
        },
      ],
      ...(kind === 'clean' ? { mergedBody: [{ filePath: 'src/seed.ts', body: `M ${marker}\n` }], failingCheck: 'behavioral:retry' } : {}),
      rubricRef: rubricRefForCardKind(kind),
    };
    const cardId =
      RATING_CARD_SCHEMA +
      ':' +
      createHash('sha256').update(canonicalSerialize(canonicalSafe(body)), 'utf8').digest('hex');
    return { cardId, ...body };
  }

  function sealDir(
    root: string,
    dirName: string,
    entries: Array<{ card: RatingCard; groundTruth?: string; steeredLabel?: string }>,
  ): void {
    const dir = nodePath.join(seedsDirOf(root), dirName);
    fs.mkdirSync(dir, { recursive: true });
    const manifest = { cards: [] as object[] };
    entries.forEach(({ card, groundTruth, steeredLabel }, i) => {
      const file = `card-${i}.json`;
      const bytes = Buffer.from(JSON.stringify(card, null, 2), 'utf8');
      fs.writeFileSync(nodePath.join(dir, file), bytes);
      manifest.cards.push({
        file,
        cardId: card.cardId,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        ...(groundTruth ? { groundTruth } : {}),
        ...(steeredLabel ? { steeredLabel } : {}),
      });
    });
    fs.writeFileSync(nodePath.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  }

  it('loads sealed sets, verifies sha256 + cardId, and yields provenance-tagged cards', () => {
    const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'warpline-interleave-seeds-'));
    try {
      sealDir(root, 'planted', [{ card: makeCard('clean', 'planted'), groundTruth: 'broken' }]);
      sealDir(root, 'genuine', [{ card: makeCard('knot', 'gen'), groundTruth: 'GENUINE' }]);
      sealDir(root, 'over-block', [{ card: makeCard('knot', 'ob'), groundTruth: 'OVER-BLOCK' }]);
      sealDir(root, 'corpus', [{ card: makeCard('knot', 'inj'), steeredLabel: 'OVER-BLOCK' }]);
      const sets = loadSeedCards(root);
      expect(sets.planted).toHaveLength(1);
      expect(sets.planted[0].provenance).toMatchObject({ source: 'planted-control', planted: true, groundTruth: 'broken' });
      expect(sets.genuine[0].provenance).toMatchObject({ source: 'seeded-control', seededControl: true, groundTruth: 'GENUINE' });
      expect(sets.overBlock[0].provenance).toMatchObject({ source: 'seeded-control', groundTruth: 'OVER-BLOCK' });
      expect(sets.corpus[0].steeredLabel).toBe('OVER-BLOCK');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a tampered card file, a forged cardId, and an unsealed card; absent dirs are empty', () => {
    const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'warpline-interleave-seeds2-'));
    try {
      // absent seeds dir → all sets empty
      expect(loadSeedCards(root)).toEqual({ planted: [], genuine: [], overBlock: [], corpus: [] });

      // tampered bytes after the manifest froze → refuse
      const card = makeCard('knot', 'x');
      sealDir(root, 'genuine', [{ card, groundTruth: 'GENUINE' }]);
      const file = nodePath.join(seedsDirOf(root), 'genuine', 'card-0.json');
      fs.writeFileSync(file, JSON.stringify({ ...card, filePaths: ['src/EVIL.ts'] }, null, 2), 'utf8');
      expect(() => loadSeedCards(root)).toThrow(/sealed sha256|altered/);

      // forged content address (bytes re-sealed, cardId not matching content) → refuse
      const forged = { ...makeCard('knot', 'y'), cardId: RATING_CARD_SCHEMA + ':' + 'f'.repeat(64) };
      sealDir(root, 'genuine', [{ card: forged as RatingCard, groundTruth: 'GENUINE' }]);
      expect(() => loadSeedCards(root)).toThrow(/does not match its own content/);

      // an unsealed extra file in a sealed dir → refuse
      sealDir(root, 'genuine', [{ card: makeCard('knot', 'z'), groundTruth: 'GENUINE' }]);
      fs.writeFileSync(nodePath.join(seedsDirOf(root), 'genuine', 'smuggled.json'), JSON.stringify(makeCard('knot', 'w')), 'utf8');
      expect(() => loadSeedCards(root)).toThrow(/not in .*manifest/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
