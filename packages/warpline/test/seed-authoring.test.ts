/**
 * seed-authoring.test — the PRODUCER→CONSUMER round-trip (PRE-APP KIT).
 *
 * The critical constraint: every card `sealCardSet` writes must round-trip through
 * #field-interleave's `loadSeedCards` — the RUN'S OWN loader — with zero errors. A
 * producer whose output the consumer rejects is a failure. These tests seal REAL
 * cards and load them back through the exact consumer code path, then prove the
 * seal actually seals (byte tamper / cardId mismatch / unsealed file all refuse).
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { ObjectStore } from '../src/warp/object-store.js';
import { buildBenignTwin } from '../src/judge/preflight.js';
import { loadSeedCards, seedsDirOf } from '../src/field/interleave.js';
import {
  sealCardSet,
  starterInjectionCorpusCards,
  buildInjectionCorpusCards,
  buildDefaultPlantedControlCard,
  buildPlantedControlCard,
  DEFAULT_PLANTED_PAIR,
  recomputeCardId,
  seedFileName,
} from '../src/field/seed-authoring.js';
import { STARTER_INJECTION_PAYLOADS } from '../src/field/corpus-payloads.js';

function tmpRoot(tag: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `warpline-${tag}-`));
}

describe('SEED AUTHORING — producer→consumer round-trip', () => {
  it('sealCardSet output loads back through the RUN loader (loadSeedCards) with zero errors', () => {
    const root = tmpRoot('seedauth-rt');
    try {
      const store = new ObjectStore(root);
      // planted (groundTruth broken), corpus (steeredLabel) — the two the kit produces now.
      const planted = buildDefaultPlantedControlCard(store);
      sealCardSet(path.join(seedsDirOf(root), 'planted'), [
        { card: planted.card, groundTruth: planted.groundTruth },
      ]);
      const corpus = starterInjectionCorpusCards();
      sealCardSet(
        path.join(seedsDirOf(root), 'corpus'),
        corpus.map((c) => ({ card: c.card, steeredLabel: c.steeredLabel })),
      );

      // THE ROUND TRIP: the consumer accepts it verbatim.
      const sets = loadSeedCards(root);
      expect(sets.planted).toHaveLength(1);
      expect(sets.planted[0].provenance).toMatchObject({ source: 'planted-control', planted: true, groundTruth: 'broken' });
      expect(sets.corpus).toHaveLength(STARTER_INJECTION_PAYLOADS.length);
      expect(sets.corpus.every((c) => typeof c.steeredLabel === 'string' && c.steeredLabel.length > 0)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('deterministic filenames (seed-NNN.json) and a manifest sha256 the operator can commit', () => {
    const root = tmpRoot('seedauth-names');
    try {
      const store = new ObjectStore(root);
      const dir = path.join(seedsDirOf(root), 'corpus');
      const cards = starterInjectionCorpusCards();
      const res = sealCardSet(dir, cards.map((c) => ({ card: c.card, steeredLabel: c.steeredLabel })));
      expect(res.files[0]).toBe('seed-000.json');
      expect(res.files).toEqual(cards.map((_, i) => seedFileName(i)));
      expect(res.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
      // manifest sha matches the bytes on disk
      const bytes = fs.readFileSync(path.join(dir, 'manifest.json'));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(res.manifestSha256);
      void store;
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('a byte-tampered card file AFTER sealing → the loader throws (the seal works)', () => {
    const root = tmpRoot('seedauth-tamper');
    try {
      const store = new ObjectStore(root);
      const corpus = starterInjectionCorpusCards();
      const dir = path.join(seedsDirOf(root), 'corpus');
      sealCardSet(dir, corpus.map((c) => ({ card: c.card, steeredLabel: c.steeredLabel })));
      // tamper the first card's bytes without touching the manifest
      const f = path.join(dir, 'seed-000.json');
      const card = JSON.parse(fs.readFileSync(f, 'utf8'));
      card.filePaths = ['src/EVIL.ts'];
      fs.writeFileSync(f, JSON.stringify(card, null, 2));
      expect(() => loadSeedCards(root)).toThrow(/sealed sha256|altered/);
      void store;
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('a manifest cardId mismatch → the loader throws', () => {
    const root = tmpRoot('seedauth-cardid');
    try {
      const store = new ObjectStore(root);
      const corpus = starterInjectionCorpusCards();
      const dir = path.join(seedsDirOf(root), 'corpus');
      sealCardSet(dir, corpus.map((c) => ({ card: c.card, steeredLabel: c.steeredLabel })));
      // corrupt the sealed cardId in the manifest (bytes + sha still consistent)
      const mp = path.join(dir, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(mp, 'utf8'));
      manifest.cards[0].cardId = 'ratingCard:v1:' + 'f'.repeat(64);
      fs.writeFileSync(mp, JSON.stringify(manifest, null, 2));
      expect(() => loadSeedCards(root)).toThrow(/cardId/);
      void store;
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('SEED AUTHORING — injection corpus cards (v2 §A9)', () => {
  it('every starter card is a well-formed RatingCard carrying its steeredLabel', () => {
    const cards = buildInjectionCorpusCards(STARTER_INJECTION_PAYLOADS);
    expect(cards).toHaveLength(STARTER_INJECTION_PAYLOADS.length);
    for (let i = 0; i < cards.length; i++) {
      const { card, steeredLabel } = cards[i];
      expect(card.schemaVersion).toBe('ratingCard:v1');
      expect(card.kind).toBe('knot');
      expect(recomputeCardId(card)).toBe(card.cardId); // content address correct
      expect(steeredLabel).toBe(STARTER_INJECTION_PAYLOADS[i].steeredLabel);
      // the payload rides the untrusted-prose intent channel, verbatim
      expect(card.sides[0].intent.body).toBe(STARTER_INJECTION_PAYLOADS[i].payloadText);
    }
  });

  it('the benign TWIN of a corpus card DIFFERS (payload is in framed prose → detectable)', () => {
    const [{ card }] = buildInjectionCorpusCards(STARTER_INJECTION_PAYLOADS);
    const twin = buildBenignTwin(card);
    // the twin neutralizes the intent → a different content address (structure the
    // §5 differential injection gate needs; we assert structure, run no model).
    expect(twin.cardId).not.toBe(card.cardId);
    expect(twin.sides[0].intent.body).not.toBe(card.sides[0].intent.body);
  });
});

describe('SEED AUTHORING — planted false-CLEAN control (§4/A6)', () => {
  it('the DEFAULT synthetic pair builds a valid CleanAuditRow-backed card, groundTruth broken', () => {
    const root = tmpRoot('seedauth-planted');
    try {
      const store = new ObjectStore(root);
      const res = buildDefaultPlantedControlCard(store);
      expect(res.groundTruth).toBe('broken');
      expect(res.synthetic).toBe(true);
      expect(res.card.kind).toBe('clean');
      expect(recomputeCardId(res.card)).toBe(res.card.cardId);
      // the two sides carry the operator's file versions read back from durable trees
      const oursBodies = res.card.sides[0].files.map((f) => f.body).join('\n');
      expect(oursBodies).toContain('PAGE_LIMIT = 50');
      const theirsBodies = res.card.sides[1].files.map((f) => f.body).join('\n');
      expect(theirsBodies).toContain('fetchAll');
      // merged body present (the silently-broken CLEAN result)
      expect(res.card.mergedBody?.map((f) => f.body).join('\n')).toContain('PAGE_LIMIT = 50');
      expect(res.card.failingCheck).toBe(DEFAULT_PLANTED_PAIR.failingCheck);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('operator-supplied file versions are honored (not synthetic)', () => {
    const root = tmpRoot('seedauth-planted2');
    try {
      const store = new ObjectStore(root);
      const res = buildPlantedControlCard(store, {
        ours: { 'src/a.ts': 'export const X = 1;\n' },
        theirs: { 'src/a.ts': 'export const X = 2;\n' },
        failingCheck: 'test:x-consistent',
      });
      expect(res.synthetic).toBe(false);
      expect(res.card.failingCheck).toBe('test:x-consistent');
      expect(res.card.filePaths).toEqual(['src/a.ts']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
