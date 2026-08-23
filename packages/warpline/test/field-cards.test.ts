/**
 * field-cards.test — habit (ii) capture, SCAN-based (B7 increment 1).
 *
 *   CARD       : a persisted KNOT payload (.warpline/knots/) becomes a blinded
 *                §5 rating card via the judge stripper; written idempotently by
 *                content-addressed cardId.
 *   BLINDNESS  : the serialized card on disk contains NONE of the words
 *                'verdict' / 'confidence' / 'resolve' / 'founder' — the answer
 *                never reaches the rater.
 *   B-3 GAP    : a byte-downgrade KNOT with NO payload (its refusal advertises
 *                no knotPayloadId in the f4 trace) is RECORDED card-less in
 *                byte-downgrades.jsonl — never faked into a card.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import * as fs from 'node:fs';
import { ObjectStore } from '../src/warp/object-store.js';
import { snapshotDir } from '../src/warp/snapshot.js';
import { envelopeProse } from '../src/envelope.js';
import {
  persistKnotPayload,
  KNOT_PAYLOAD_SCHEMA,
  KNOT_PROPOSAL_SCHEMA,
  type KnotPayload,
} from '../src/fabric/knot-payload.js';
import {
  collectFieldCards,
  writeCards,
  fieldCardsDirOf,
  byteDowngradesPathOf,
} from '../src/field/cards.js';

const MOD = 'src/mod.ts';
const BASE_SRC = 'export function foo() { return 1; }\n';
const A_SRC = 'export function foo() { return 10; }\n';
const B_SRC = 'export function foo() { return 20; }\n';

function treeOf(store: ObjectStore, scratch: string, files: Record<string, string>): string {
  const dir = fs.mkdtempSync(nodePath.join(scratch, 'tree-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = nodePath.join(dir, rel);
    fs.mkdirSync(nodePath.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, 'utf8');
  }
  return snapshotDir(store, dir).treeId;
}

/** A minimal but SHAPE-COMPLETE knotPayload:v1 fixture over real durable trees. */
function fixturePayload(trees: { base: string; ours: string; theirs: string }): KnotPayload {
  const symbol = `#code:${MOD}::foo`;
  return {
    schemaVersion: KNOT_PAYLOAD_SCHEMA,
    payloadId: 'knotPayload:v1:' + 'f'.repeat(64),
    verdict: 'KNOT',
    rebasedOnto: 'state:v0:selvage',
    base: { stateId: 'state:v0:base', treeId: trees.base },
    ours: {
      agentId: 'agent-b',
      actor: 'agent-b',
      intent: envelopeProse('double the constant'),
      stateId: 'state:v0:ours',
      treeId: trees.ours,
      gitCommit: null,
      ref: null,
    },
    theirs: {
      agentId: 'agent-a',
      actor: 'agent-a',
      intent: envelopeProse('increase the constant'),
      stateId: 'state:v0:theirs',
      treeId: trees.theirs,
      gitCommit: null,
      ref: null,
    },
    agentChanged: [symbol],
    otherChanged: [symbol],
    contested: [
      {
        kind: 'knot',
        stableKey: 'k1',
        symbol,
        conflictingSlots: ['body'],
        direct: true,
        base: { present: true, essence: 'essence:base', body: BASE_SRC, filePath: MOD, fileText: BASE_SRC },
        ours: { present: true, essence: 'essence:ours', body: B_SRC, filePath: MOD, fileText: B_SRC, delta: null },
        theirs: { present: true, essence: 'essence:theirs', body: A_SRC, filePath: MOD, fileText: A_SRC, delta: null },
      },
    ],
    blastRadius: { mode: 'ripple', roots: [symbol], symbols: [symbol], edges: [] },
    resolution: {
      submitVia: 'resolve',
      proposalSchema: KNOT_PROPOSAL_SCHEMA,
      requires: ['decidedBy', 'reason', 'resolvedRef'],
    },
  };
}

describe('FIELD CARDS — habit (ii) scan-based capture', () => {
  let root: string;
  let scratch: string;
  let store: ObjectStore;

  beforeAll(() => {
    root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'warpline-field-cards-'));
    scratch = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'warpline-field-cards-fixtures-'));
    store = new ObjectStore(root);
    const trees = {
      base: treeOf(store, scratch, { [MOD]: BASE_SRC }),
      ours: treeOf(store, scratch, { [MOD]: B_SRC }),
      theirs: treeOf(store, scratch, { [MOD]: A_SRC }),
    };
    persistKnotPayload(root, fixturePayload(trees));

    // The f4 trace: one byte-downgrade KNOT refusal WITHOUT a payload (the B-3
    // gap), one refusal WITH a payload (covered by the card scan), one ok row.
    const tracePath = nodePath.join(root, '.warpline', 'f4', 'trace.jsonl');
    fs.mkdirSync(nodePath.dirname(tracePath), { recursive: true });
    const rows = [
      {
        ok: false,
        refusal: {
          code: 'GATE_REFUSED',
          verdict: 'KNOT',
          pointers: { proposedStateId: 'state:v0:downgraded', rebasedOnto: 'state:v0:selvage' },
        },
      },
      {
        ok: false,
        refusal: {
          code: 'GATE_REFUSED',
          verdict: 'KNOT',
          pointers: { knotPayloadId: 'knotPayload:v1:' + 'f'.repeat(64), proposedStateId: 'state:v0:ours' },
        },
      },
      { ok: true, resultClass: 'sealed' },
    ];
    fs.writeFileSync(tracePath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('builds one blinded card per persisted payload, with both sides read from durable trees', () => {
    const cards = collectFieldCards(root, { store });
    expect(cards.knotCards).toHaveLength(1);
    const card = cards.knotCards[0];
    expect(card.kind).toBe('knot');
    expect(card.filePaths).toEqual([MOD]);
    expect(card.sides.map((s) => s.role)).toEqual(['ours', 'theirs']);
    expect(card.sides[0].files[0].body).toBe(B_SRC);
    expect(card.sides[1].files[0].body).toBe(A_SRC);
    expect(card.base?.files[0].body).toBe(BASE_SRC);
  });

  it("BLINDNESS: the serialized card contains none of 'verdict' / 'confidence' / 'resolve' / 'founder'", () => {
    const cards = collectFieldCards(root, { store });
    writeCards(root, cards);
    const dir = fieldCardsDirOf(root);
    const files = fs.readdirSync(dir).filter((n) => n.endsWith('.json') && n.startsWith('ratingCard'));
    expect(files.length).toBe(1);
    const onDisk = fs.readFileSync(nodePath.join(dir, files[0]), 'utf8');
    for (const forbidden of ['verdict', 'confidence', 'resolve', 'founder']) {
      expect(onDisk.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('records the B-3 byte-downgrade gap card-less — never fakes a card', () => {
    const cards = collectFieldCards(root, { store });
    expect(cards.byteDowngrades).toHaveLength(1); // the payload-bearing refusal is NOT double-counted
    expect(cards.byteDowngrades[0].stateRef).toBe('state:v0:downgraded');
    expect(cards.byteDowngrades[0].reason).toContain('B-3');
    expect(cards.byteDowngrades[0].reason).toContain('increment-2');
  });

  it('writeCards is idempotent by cardId and by downgrade identity', () => {
    const cards = collectFieldCards(root, { store });
    const first = writeCards(root, cards);
    // the blindness test above already wrote once — first here may be 0-written
    expect(first.written + first.skippedExisting).toBe(1);
    const again = writeCards(root, cards);
    expect(again.written).toBe(0);
    expect(again.skippedExisting).toBe(1);
    expect(again.downgradesRecorded).toBe(0);
    const lines = fs
      .readFileSync(byteDowngradesPathOf(root), 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(1); // recorded exactly once across every pass
  });
});
