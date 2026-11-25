/**
 * SUPERSEDED_FIRST_PARTY_PINS (S1.2; Judge J5, Aegis point 9a): the format-2 first-party pins of the release before
 * the modAbiId move. A superseded pin keeps the tier of an existing install, is never an alias source, and can never
 * be staged anew or re-pinned by rollbackMod (rollback protection). The old trees are vendored under test/fixtures/first-party-superseded and
 * HASHED here against the pins, so the fixture cannot drift.
 */
import * as fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { aliasOf, historicalFirstPartyPins, isHistoricalFirstPartyPin } from '../src/kernel/manifest/grants.js';
import { appendGrantRow, effectiveInstall, readGrants } from '../src/kernel/manifest/index.js';
import { deriveTier, firstPartyPins, isFirstPartyPin, rollbackPresenceBinding, stageInstall, isSupersededPin, supersededPins, supersededPriorModAbiId } from '../src/kernel/manifest/install.js';
import { MANIFEST_FILE, readManifest } from '../src/kernel/manifest/manifest.js';
import { snapshotFolder } from '../src/kernel/manifest/snapshot.js';
import { mintTestPresence, rollbackModSnapshot } from '../src/kernel/testing.js';
import { ManifestRefusal, noEvents } from '../src/kernel/manifest/refusal.js';
import { hashSourceTree } from '../src/kernel/manifest/snapshot.js';
import { PKG_ROOT } from './helpers.js';
import { install, rig } from './mod-helpers.js';

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
    expect(new Set(hashes)).toEqual(new Set(supersededPins().map(([h]) => h)));
    expect(hashes).toHaveLength(supersededPins().length);
  });

  it('a superseded pin keeps its tier, never aliases, and is disjoint from the current and historical sets', () => {
    const current = ['workshop', 'ledger', 'paradigm-context', 'neurons', 'constellation'].map((m) => hashOf(path.join(SHIPPED, m), `gnomon.${m}`));
    for (const h of supersededPins().map(([h]) => h)) {
      expect(deriveTier(h)).toBe('first-party');
      expect(isFirstPartyPin(h)).toBe(true);
      expect(isHistoricalFirstPartyPin(h)).toBe(false);
      expect(current).not.toContain(h);
      // an alias resolves to gnomon.<name> only from a FORMAT-1 historical pin
      for (const legacy of SUPERSEDED_TREES) expect(aliasOf(legacy, 'first-party', h)).toBe(`local.${legacy}`);
    }
    for (const h of current) expect(isFirstPartyPin(h)).toBe(true);
    for (const h of historicalFirstPartyPins()) expect(aliasOf('workshop', 'first-party', h)).toBe('gnomon.workshop');
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

  it('rollback protection: rollbackMod refuses to re-pin an earlier approved row at a superseded pin, by default and by explicit hash', () => {
    for (const m of SUPERSEDED_TREES) {
      const r = rig();
      cleanups.push(r.cleanup);
      const name = `gnomon.${m}`;
      // what the previous kernel left behind: the old tree pinned by root-signed rows (as in mod-abi-compat.test.ts)
      const snap = snapshotFolder(r.home, path.join(SUPERSEDED_DIR, m), name, noEvents);
      const read = readManifest(fs.readFileSync(path.join(snap.dir, MANIFEST_FILE)), { tier: 'first-party' });
      const cardId = 'card:01HZZZZZZZZZZZZZZZZZZZZZZC';
      appendGrantRow(r.home, r.auth, { kind: 'grant.trust', manifestHash: read.manifestHash, tier: 'first-party', cardId });
      appendGrantRow(r.home, r.auth, { kind: 'grant.install', name, manifestHash: read.manifestHash, packageHash: snap.packageHash, cardId, source: 'package' });
      expect(isSupersededPin(snap.packageHash)).toBe(true);
      // the human approves the Update card: the shipped tree is pinned
      const now = install(r, path.join(SHIPPED, m)).packageHash;
      expect(now).not.toBe(snap.packageHash);
      expect(effectiveInstall(readGrants(r.home, r.auth), name)!.packageHash).toBe(now);
      const rows = readGrants(r.home, r.auth).installs.length;
      for (const to of [undefined, snap.packageHash]) {
        const seen: Array<{ kind: string; payload: Record<string, unknown> }> = [];
        let err: unknown;
        try {
          rollbackModSnapshot(r.home, name, to, { presenceToken: mintTestPresence('mod.rollback', { bind: rollbackPresenceBinding(name, to) }), authority: r.auth, emit: (kind, payload) => void seen.push({ kind, payload }) });
        } catch (e) {
          err = e;
        }
        expect(err, `${m} ${to ?? '(previous)'}`).toBeInstanceOf(ManifestRefusal);
        expect((err as ManifestRefusal).manifestCode).toBe('TIER');
        expect((err as ManifestRefusal).detail).toMatchObject({ name, why: 'superseded', toPackageHash: snap.packageHash });
        expect(seen).toEqual([{ kind: 'manifest.refuse', payload: { name, code: 'TIER', why: 'superseded' } }]);
      }
      // nothing was appended and the shipped tree is still the pin
      expect(readGrants(r.home, r.auth).installs).toHaveLength(rows);
      expect(effectiveInstall(readGrants(r.home, r.auth), name)!.packageHash).toBe(now);
    }
  });
});
