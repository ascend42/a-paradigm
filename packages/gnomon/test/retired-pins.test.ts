/**
 * RETIRED_FIRST_PARTY_PINS (S1.4 P0; Aegis I2 and A7): a first-party tree this kernel no longer ships. The
 * dimension mod 1.0.0 is the first. What is held here:
 *  - an install already pinned at a retired hash KEEPS LOADING first-party (its tier is its signed grant.trust row)
 *    until the person approves the Update card;
 *  - a retired hash is never staged anew, a card an earlier kernel staged for it can only be denied, and it is
 *    never a rollback target, so an update cannot be undone into the retired build.
 * The 1.0.0 tree is kept as DATA in test/fixtures/first-party-retired/dimension-1.0.0.json (one JSON file, written
 * into a temp folder here and HASHED against the retired pin, so the fixture cannot drift).
 * "The earlier kernel" is this kernel with the one hash moved back from the retired set to the first-party set
 * for the length of a call: exactly the difference between the two releases for this mod.
 */
import * as fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HISTORICAL_FIRST_PARTY_PINS } from '../src/kernel/manifest/grants.js';
import { effectiveInstall, loadMod, readGrants } from '../src/kernel/manifest/index.js';
import { deriveTier, FIRST_PARTY_PACKAGE_HASHES, installPresenceBinding, readStaged, RETIRED_FIRST_PARTY_PINS, rollbackPresenceBinding, stageInstall, SUPERSEDED_FIRST_PARTY_PINS } from '../src/kernel/manifest/install.js';
import { ManifestRefusal, noEvents } from '../src/kernel/manifest/refusal.js';
import { hashSourceTree } from '../src/kernel/manifest/snapshot.js';
import { decideInstallCard, mintTestPresence, rollbackModSnapshot } from '../src/kernel/testing.js';
import { DIMENSION, DIMENSION_TREE, installTree } from './dimension-helpers.js';
import { PKG_ROOT } from './helpers.js';
import { rig, type Rig } from './mod-helpers.js';

const FIXTURE = path.join(PKG_ROOT, 'test', 'fixtures', 'first-party-retired', 'dimension-1.0.0.json');
const OLD = 'sha256:7e79c8439b116dbbc1dd542dba84e848546247c820e59954ce20ee49b4ee34c9';
const BY = 'p:abcdefgh/cli';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
function newRig(): Rig {
  const r = rig();
  cleanups.push(r.cleanup);
  return r;
}

/** The 1.0.0 tree written out as a folder named like the shipped one. */
function oldTree(r: Rig): string {
  const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as { packageHash: string; files: Record<string, string> };
  const dir = path.join(r.root, 'old', 'dimension');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(fx.files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

/** Run `fn` as the kernel that shipped 1.0.0: the hash is first-party and not retired. Restored in every case. */
function asEarlierKernel<T>(fn: () => T): T {
  const firstParty = FIRST_PARTY_PACKAGE_HASHES as Set<string>;
  const retired = RETIRED_FIRST_PARTY_PINS as Map<string, string>;
  const why = retired.get(OLD)!;
  firstParty.add(OLD);
  retired.delete(OLD);
  try {
    return fn();
  } finally {
    firstParty.delete(OLD);
    retired.set(OLD, why);
  }
}

function refusal(fn: () => unknown): ManifestRefusal {
  try {
    fn();
  } catch (e) {
    if (e instanceof ManifestRefusal) return e;
    throw e;
  }
  throw new Error('expected a ManifestRefusal');
}
const snapshots = (r: Rig): string[] => {
  const kept = path.join(r.home, 'mods', DIMENSION, 'pinned');
  return fs.existsSync(kept) ? fs.readdirSync(kept) : [];
};
const pinned = (r: Rig): string | undefined => effectiveInstall(readGrants(r.home, r.auth), DIMENSION)?.packageHash;

describe('RETIRED_FIRST_PARTY_PINS', () => {
  it('the kept 1.0.0 tree hashes to the retired pin; a retired pin is in no first-party set and derives local', () => {
    const r = newRig();
    expect(hashSourceTree(oldTree(r), DIMENSION, noEvents).packageHash).toBe(OLD);
    expect(JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).packageHash).toBe(OLD);
    expect([...RETIRED_FIRST_PARTY_PINS.keys()]).toEqual([OLD]);
    for (const [h, why] of RETIRED_FIRST_PARTY_PINS) {
      expect(why.length).toBeGreaterThan(0);
      expect(FIRST_PARTY_PACKAGE_HASHES.has(h)).toBe(false);
      expect(SUPERSEDED_FIRST_PARTY_PINS.has(h)).toBe(false);
      expect(HISTORICAL_FIRST_PARTY_PINS.has(h)).toBe(false);
      expect(deriveTier(h)).toBe('local');
    }
    // the shipped tree is not retired
    expect(RETIRED_FIRST_PARTY_PINS.has(hashSourceTree(DIMENSION_TREE, DIMENSION, noEvents).packageHash)).toBe(false);
    // the earlier-kernel seam restores both sets
    asEarlierKernel(() => expect(deriveTier(OLD)).toBe('first-party'));
    expect(deriveTier(OLD)).toBe('local');
    expect(RETIRED_FIRST_PARTY_PINS.has(OLD)).toBe(true);
  });

  it('a fresh stage of the 1.0.0 tree is refused TIER (why retired), as a package and as a linked folder, and no snapshot is kept', () => {
    for (const via of ['package', 'linked'] as const) {
      const r = newRig();
      const seen: Array<{ kind: string; payload: Record<string, unknown> }> = [];
      const err = refusal(() => stageInstall({ home: r.home, source: oldTree(r), via, requestedBy: BY, trust: r.auth, emit: (kind, payload) => void seen.push({ kind, payload }) }));
      expect(err.manifestCode).toBe('TIER');
      expect(err.detail).toMatchObject({ name: DIMENSION, why: 'retired' });
      expect(err.message).toContain('retired first-party build');
      expect(seen.filter((e) => e.kind === 'manifest.refuse')).toEqual([{ kind: 'manifest.refuse', payload: { name: DIMENSION, code: 'TIER', why: 'retired' } }]);
      expect(snapshots(r)).toEqual([]);
      expect(pinned(r)).toBeUndefined();
      // the shipped tree stages in the same home
      if (via === 'package') expect(stageInstall({ home: r.home, source: DIMENSION_TREE, via, requestedBy: BY, trust: r.auth }).state).toBe('staged');
    }
  });

  it('a card the earlier kernel staged for 1.0.0 cannot be approved now; it can be denied', () => {
    const r = newRig();
    const st = asEarlierKernel(() => stageInstall({ home: r.home, source: oldTree(r), via: 'package', requestedBy: BY, trust: r.auth }));
    if (st.state !== 'staged') throw new Error(`expected staged, got ${st.state}`);
    expect(st.record.detail).toMatchObject({ packageHash: OLD, tier: 'first-party' });
    const contentHash = readStaged(r.home, DIMENSION, st.cardId)!.card.contentHash;
    const token = (decision: 'install' | 'deny'): unknown => mintTestPresence('mod.install', { bind: installPresenceBinding(st.cardId, contentHash, decision) });
    const err = refusal(() => decideInstallCard(r.home, DIMENSION, st.cardId, 'install', { presenceToken: token('install'), authority: r.auth }));
    expect(err.manifestCode).toBe('TIER');
    expect(err.detail).toMatchObject({ name: DIMENSION, why: 'retired' });
    expect(pinned(r)).toBeUndefined();
    expect(readGrants(r.home, r.auth).installs).toEqual([]);
    expect(readStaged(r.home, DIMENSION, st.cardId)!.card.state).toBe('pending');
    // the earlier kernel would have approved the same card: the refusal is the retirement, nothing else
    expect(decideInstallCard(r.home, DIMENSION, st.cardId, 'deny', { presenceToken: token('deny'), authority: r.auth }).card.state).not.toBe('pending');
    expect(pinned(r)).toBeUndefined();
  });

  it('an installed 1.0.0 keeps loading first-party until its Update is approved; after the update, rollback is refused and 1.0.1 still loads', () => {
    const r = newRig();
    const old = asEarlierKernel(() => installTree(r, oldTree(r), DIMENSION));
    expect(old.packageHash).toBe(OLD);
    // this kernel, before the person approves anything: the installed tree loads, and its tier is the signed row's
    const before = loadMod({ home: r.home, name: DIMENSION, trust: r.auth });
    expect(before).toMatchObject({ state: 'ready', packageHash: OLD, tier: 'first-party', source: 'package' });
    expect(before.state === 'ready' && before.manifest.version).toBe('1.0.0');
    // the Update card for the shipped tree is an update, and approving it pins 1.0.1
    const now = installTree(r, DIMENSION_TREE, DIMENSION).packageHash;
    expect(now).not.toBe(OLD);
    expect(FIRST_PARTY_PACKAGE_HASHES.has(now)).toBe(true);
    expect(pinned(r)).toBe(now);
    const rows = readGrants(r.home, r.auth).installs.length;
    for (const to of [undefined, OLD]) {
      const seen: Array<{ kind: string; payload: Record<string, unknown> }> = [];
      const err = refusal(() => rollbackModSnapshot(r.home, DIMENSION, to, { presenceToken: mintTestPresence('mod.rollback', { bind: rollbackPresenceBinding(DIMENSION, to) }), authority: r.auth, emit: (kind, payload) => void seen.push({ kind, payload }) }));
      expect(err.manifestCode, String(to)).toBe('TIER');
      expect(err.detail).toMatchObject({ name: DIMENSION, why: 'retired', toPackageHash: OLD });
      expect(seen).toEqual([{ kind: 'manifest.refuse', payload: { name: DIMENSION, code: 'TIER', why: 'retired' } }]);
    }
    // nothing was appended, and the mod still loads 1.0.1 first-party
    expect(readGrants(r.home, r.auth).installs).toHaveLength(rows);
    expect(pinned(r)).toBe(now);
    const after = loadMod({ home: r.home, name: DIMENSION, trust: r.auth });
    expect(after).toMatchObject({ state: 'ready', packageHash: now, tier: 'first-party' });
    expect(after.state === 'ready' && after.manifest.version).toBe('1.0.1');
  });
});
