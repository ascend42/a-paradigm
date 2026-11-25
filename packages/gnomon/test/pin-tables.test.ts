/**
 * #manifest-loader, S1.4 P0 review (Aegis F2): the first-party pin tables are private to their modules. Nothing an
 * importer can reach is a Set, a Map or an unfrozen list, the copies handed out are fresh and frozen, and the only
 * way to change a table is the internal test seam, which puts it back.
 */
import { describe, expect, it } from 'vitest';
import * as grants from '../src/kernel/manifest/grants.js';
import * as install from '../src/kernel/manifest/install.js';
import * as manifestIndex from '../src/kernel/manifest/index.js';
import { withPinTablesForTest } from '../src/kernel/testing.js';

const PROBE = `sha256:${'ab'.repeat(32)}`;

describe('the first-party pin tables are module-private', () => {
  it('no module of the manifest loader exports a Set, a Map or an unfrozen array', () => {
    // the two files that hold pins and trusted keys; the index is checked by name below (it re-exports unrelated lists)
    for (const [file, mod] of Object.entries({ 'install.ts': install, 'grants.ts': grants })) {
      for (const [name, value] of Object.entries(mod as Record<string, unknown>)) {
        expect(value instanceof Set || value instanceof Map || value instanceof WeakMap || value instanceof WeakSet, `${file} exports the collection ${name}`).toBe(false);
        if (Array.isArray(value)) expect(Object.isFrozen(value), `${file} exports the unfrozen array ${name}`).toBe(true);
      }
    }
    for (const gone of ['FIRST_PARTY_PACKAGE_HASHES', 'SUPERSEDED_FIRST_PARTY_PINS', 'RETIRED_FIRST_PARTY_PINS', 'HISTORICAL_FIRST_PARTY_PINS', 'TRUSTED_MANIFEST_KEYS']) {
      expect(gone in install, gone).toBe(false);
      expect(gone in grants, gone).toBe(false);
      expect(gone in manifestIndex, gone).toBe(false);
    }
  });

  it('the copies are fresh and frozen: changing one is refused and changes no answer', () => {
    const lists: Array<[string, () => readonly unknown[]]> = [
      ['firstPartyPins', install.firstPartyPins],
      ['supersededPins', install.supersededPins],
      ['retiredPins', install.retiredPins],
      ['historicalFirstPartyPins', grants.historicalFirstPartyPins],
    ];
    for (const [name, get] of lists) {
      const a = get();
      expect(a.length, name).toBeGreaterThan(0);
      expect(Object.isFrozen(a), name).toBe(true);
      expect(get(), name).not.toBe(a);
      expect(() => (a as unknown[]).push(PROBE), name).toThrow(TypeError);
      for (const e of a) if (Array.isArray(e)) expect(Object.isFrozen(e), name).toBe(true);
      expect(get(), name).toEqual(a);
    }
    expect([install.isFirstPartyPin(PROBE), install.isSupersededPin(PROBE), install.isRetiredPin(PROBE), grants.isHistoricalFirstPartyPin(PROBE)]).toEqual([false, false, false, false]);
    expect(install.deriveTier(PROBE)).toBe('local');
    // every superseded and historical pin is first-party; a retired one is not
    for (const [h, prior] of install.supersededPins()) expect([install.isFirstPartyPin(h), install.supersededPriorModAbiId(h)]).toEqual([true, prior]);
    for (const h of grants.historicalFirstPartyPins()) expect(install.isFirstPartyPin(h)).toBe(true);
    for (const [h, why] of install.retiredPins()) expect([install.isFirstPartyPin(h), install.retiredPinReason(h)]).toEqual([false, why]);
    expect([install.supersededPriorModAbiId(PROBE), install.retiredPinReason(PROBE)]).toEqual([null, null]);
  });

  it('the test seam edits the tables for one call and restores all three, also after a throw and after a kept reference is used', () => {
    const before = { fp: install.firstPartyPins(), sup: install.supersededPins(), ret: install.retiredPins() };
    let kept: { firstParty: Set<string>; superseded: Map<string, string>; retired: Map<string, string> } | undefined;
    const inside = withPinTablesForTest(
      (t) => {
        kept = t;
        t.firstParty.add(PROBE);
        t.superseded.clear();
        t.retired.set(PROBE, 'probe');
      },
      () => [install.deriveTier(PROBE), install.supersededPins().length, install.isRetiredPin(PROBE)],
    );
    expect(inside).toEqual(['first-party', 0, true]);
    expect({ fp: install.firstPartyPins(), sup: install.supersededPins(), ret: install.retiredPins() }).toEqual(before);
    expect(() => withPinTablesForTest((t) => void t.firstParty.add(PROBE), () => { throw new Error('boom'); })).toThrow('boom');
    expect(() => withPinTablesForTest(() => { throw new Error('edit'); }, () => 1)).toThrow('edit');
    expect({ fp: install.firstPartyPins(), sup: install.supersededPins(), ret: install.retiredPins() }).toEqual(before);
    expect(install.deriveTier(PROBE)).toBe('local');
    expect(kept).toBeDefined();
  });
});
