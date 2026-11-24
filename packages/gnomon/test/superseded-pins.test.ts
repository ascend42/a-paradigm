/**
 * SUPERSEDED_FIRST_PARTY_PINS (S1.2; Judge J5, Aegis point 9a): the format-2 first-party pins of the release before
 * the modAbiId move. A superseded pin keeps the tier of an existing install, is never an alias source, and can never
 * be staged anew (rollback protection). The old trees are vendored under test/fixtures/first-party-superseded and
 * HASHED here against the pins, so the fixture cannot drift.
 */
import * as fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { aliasOf, HISTORICAL_FIRST_PARTY_PINS } from '../src/kernel/manifest/grants.js';
import { deriveTier, FIRST_PARTY_PACKAGE_HASHES, stageInstall, SUPERSEDED_FIRST_PARTY_PINS } from '../src/kernel/manifest/install.js';
import { ManifestRefusal, noEvents } from '../src/kernel/manifest/refusal.js';
import { hashSourceTree } from '../src/kernel/manifest/snapshot.js';
import { PKG_ROOT } from './helpers.js';
import { rig } from './mod-helpers.js';

export const SUPERSEDED_DIR = path.join(PKG_ROOT, 'test', 'fixtures', 'first-party-superseded');
export const SUPERSEDED_TREES = ['workshop', 'ledger', 'paradigm-context'] as const;
const SHIPPED = path.resolve(PKG_ROOT, '..', 'gnomon-mods');
const hashOf = (dir: string, id: string): string => hashSourceTree(dir, id, noEvents).packageHash;

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

describe('SUPERSEDED_FIRST_PARTY_PINS', () => {
  it('the vendored old trees hash to exactly the superseded pins (the fixture cannot drift)', () => {
    const hashes = SUPERSEDED_TREES.map((m) => hashOf(path.join(SUPERSEDED_DIR, m), `gnomon.${m}`));
    expect(new Set(hashes)).toEqual(new Set(SUPERSEDED_FIRST_PARTY_PINS));
    expect(hashes).toHaveLength(SUPERSEDED_FIRST_PARTY_PINS.size);
  });

  it('a superseded pin keeps its tier, never aliases, and is disjoint from the current and historical sets', () => {
    const current = ['workshop', 'ledger', 'paradigm-context', 'neurons', 'constellation'].map((m) => hashOf(path.join(SHIPPED, m), `gnomon.${m}`));
    for (const h of SUPERSEDED_FIRST_PARTY_PINS) {
      expect(deriveTier(h)).toBe('first-party');
      expect(FIRST_PARTY_PACKAGE_HASHES.has(h)).toBe(true);
      expect(HISTORICAL_FIRST_PARTY_PINS.has(h)).toBe(false);
      expect(current).not.toContain(h);
      // an alias resolves to gnomon.<name> only from a FORMAT-1 historical pin
      for (const legacy of SUPERSEDED_TREES) expect(aliasOf(legacy, 'first-party', h)).toBe(`local.${legacy}`);
    }
    for (const h of current) expect(FIRST_PARTY_PACKAGE_HASHES.has(h)).toBe(true);
    for (const h of HISTORICAL_FIRST_PARTY_PINS) expect(aliasOf('workshop', 'first-party', h)).toBe('gnomon.workshop');
  });

  it('rollback protection: a NEW stage of a superseded tree is refused TIER and its snapshot is not kept', () => {
    for (const m of SUPERSEDED_TREES) {
      const r = rig();
      cleanups.push(r.cleanup);
      let err: unknown;
      try {
        stageInstall({ home: r.home, source: path.join(SUPERSEDED_DIR, m), via: 'package', requestedBy: 'p:abcdefgh/s-01hzzzzz', trust: r.auth });
      } catch (e) {
        err = e;
      }
      expect(err, m).toBeInstanceOf(ManifestRefusal);
      expect((err as ManifestRefusal).manifestCode).toBe('TIER');
      expect((err as ManifestRefusal).detail).toMatchObject({ name: `gnomon.${m}`, why: 'superseded' });
      const kept = path.join(r.home, 'mods', `gnomon.${m}`);
      expect(fs.existsSync(kept) ? fs.readdirSync(kept).filter((d) => d.startsWith('sha256')) : []).toEqual([]);
      // the shipped tree of the same mod stages
      expect(stageInstall({ home: r.home, source: path.join(SHIPPED, m), via: 'package', requestedBy: 'p:abcdefgh/s-01hzzzzz', trust: r.auth }).state).toBe('staged');
    }
  });
});
