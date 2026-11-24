/**
 * G-MOD-15 (S1.2, Aegis point 9): an installed first-party snapshot at an exactly listed superseded pin starts
 * under the ONE prior modAbiId listed for it. Nothing else ever earns a prior id. The old trees are the vendored
 * fixtures hashed in superseded-pins.test.ts; they are installed here by writing the root-signed rows the previous
 * kernel wrote (a NEW stage of one is refused today, which is the rollback protection).
 */
import * as fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MOD_ABI_ID } from '@a-company/gnomon-contracts';
import { appendGrantRow, effectiveInstall, readGrants } from '../src/kernel/manifest/index.js';
import { HISTORICAL_FIRST_PARTY_PINS } from '../src/kernel/manifest/grants.js';
import { compatModAbiId, SUPERSEDED_FIRST_PARTY_PINS, SUPERSEDED_PINS_WRITTEN_FOR } from '../src/kernel/manifest/install.js';
import { MANIFEST_FILE, readManifest } from '../src/kernel/manifest/manifest.js';
import { noEvents } from '../src/kernel/manifest/refusal.js';
import { snapshotFolder } from '../src/kernel/manifest/snapshot.js';
import { ModRefusal } from '../src/kernel/modhost/index.js';
import { ModsAdmin } from '../src/kernel/modhost/mods-admin.js';
import { NEEDS_UPDATE_NOTE } from '../src/kernel/modhost/host.js';
import { unsandboxedModLauncher } from '../src/kernel/testing.js';
import { PKG_ROOT } from './helpers.js';
import { host, install, probeManifest, rig, writeModFolder, type Rig } from './mod-helpers.js';

const DIR = path.join(PKG_ROOT, 'test', 'fixtures', 'first-party-superseded');
const TREES = ['workshop', 'ledger', 'paradigm-context'] as const;
const PRIOR = 'sha256:7aaf92f46dc35fc35141557c1f89088958f220e6bf53ea31a630bb06430ba082';
const json = (...p: string[]): any => JSON.parse(fs.readFileSync(path.join(...p), 'utf8'));

/** A mod with no SDK that answers `init` with the PRIOR modAbiId (what a third-party build against the old SDK does). */
const OLD_ID_MOD = `
import * as readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined) return;
  const result = m.method === 'init' ? { abi: 'mod-abi:v1', features: [], modAbiId: '${PRIOR}' } : m.method === 'health' ? { ok: true, abi: 'mod-abi:v1' } : {};
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n');
});
`;

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

/** What the previous kernel left behind: the pinned snapshot and its root-signed trust and install rows. */
function installedBefore(r: Rig, mod: (typeof TREES)[number]): { name: string; packageHash: string } {
  const name = `gnomon.${mod}`;
  const snap = snapshotFolder(r.home, path.join(DIR, mod), name, noEvents);
  const read = readManifest(fs.readFileSync(path.join(snap.dir, MANIFEST_FILE)), { tier: 'first-party' });
  const cardId = 'card:01HZZZZZZZZZZZZZZZZZZZZZZC';
  appendGrantRow(r.home, r.auth, { kind: 'grant.trust', manifestHash: read.manifestHash, tier: 'first-party', cardId });
  const caps = read.manifest.requires?.capabilities ?? [];
  if (caps.length) appendGrantRow(r.home, r.auth, { kind: 'grant.capability', manifestHash: read.manifestHash, capabilities: [...caps] });
  appendGrantRow(r.home, r.auth, { kind: 'grant.install', name, manifestHash: read.manifestHash, packageHash: snap.packageHash, cardId, source: 'package' });
  return { name, packageHash: snap.packageHash };
}

function started(r: Rig) {
  const { h, children } = host(r, { launcher: unsandboxedModLauncher }, { callTimeoutMs: 10_000 });
  cleanups.push(() => h.stopAll());
  return { h, children };
}

describe('G-MOD-15: the compatibility table', () => {
  it('lists exact hashes, each with ONE prior id that is not the current one; no format-1 pin is listed', () => {
    expect(SUPERSEDED_FIRST_PARTY_PINS.size).toBe(3);
    for (const [hash, prior] of SUPERSEDED_FIRST_PARTY_PINS) {
      expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(prior).toBe(PRIOR);
      expect(prior).not.toBe(MOD_ABI_ID);
      expect(HISTORICAL_FIRST_PARTY_PINS.has(hash)).toBe(false);
    }
  });

  it('EXPIRY: the table was written for the modAbiId this kernel speaks; when the id next moves it must be emptied or re-justified', () => {
    // If this fails, modAbiId moved. Do NOT just update the literal: empty SUPERSEDED_FIRST_PARTY_PINS, or show again
    // that every listed tree is unaffected by the new change and that no prior id chains to another prior id.
    if (SUPERSEDED_FIRST_PARTY_PINS.size > 0) expect(SUPERSEDED_PINS_WRITTEN_FOR).toBe(MOD_ABI_ID);
    // no chains: with any other current id, nothing is accepted
    const ok = { packageHash: [...SUPERSEDED_FIRST_PARTY_PINS.keys()][0]!, tier: 'first-party', source: 'package', manifest: { publisher: 'gnomon' } };
    expect(compatModAbiId(ok, MOD_ABI_ID)).toBe(PRIOR);
    expect(compatModAbiId(ok, PRIOR)).toBeNull();
    expect(compatModAbiId(ok, `sha256:${'0'.repeat(64)}`)).toBeNull();
  });

  it('every condition is required: the exact hash, first-party tier, package source, publisher gnomon, no tools', () => {
    const hash = [...SUPERSEDED_FIRST_PARTY_PINS.keys()][0]!;
    const ok = { packageHash: hash, tier: 'first-party', source: 'package', manifest: { publisher: 'gnomon', provides: { tools: [] as unknown[] } } };
    expect(compatModAbiId(ok, MOD_ABI_ID)).toBe(PRIOR);
    const not: Array<Record<string, unknown>> = [
      { packageHash: `sha256:${'1'.repeat(64)}` },
      { packageHash: [...HISTORICAL_FIRST_PARTY_PINS][0]! },
      { tier: 'local' },
      { tier: undefined },
      { source: 'linked:/somewhere' },
      { source: 'git:https://github.com/gnomon/workshop#' + 'a'.repeat(40) },
      { manifest: { publisher: 'acme' } },
      { manifest: { publisher: 'gnomon', provides: { tools: [{ name: 't', effects: ['read'] }] } } },
    ];
    for (const over of not) expect([over, compatModAbiId({ ...ok, ...over } as never, MOD_ABI_ID)]).toEqual([over, null]);
  });

  it('no listed tree declares a tool (tool.call is the only method the ABI change touched), and each echoes the listed id', () => {
    for (const mod of TREES) {
      const m = json(DIR, mod, 'gnomon-manifest.json');
      expect(m.publisher).toBe('gnomon');
      expect(m.manifest).toBe(2);
      expect(m.provides?.tools ?? []).toEqual([]);
      expect(fs.readFileSync(path.join(DIR, mod, 'index.mjs'), 'utf8')).toContain(`const MOD_ABI_ID = '${PRIOR}'`);
    }
  });
});

describe('G-MOD-15: an upgraded machine, one test per pinned mod', () => {
  for (const mod of TREES) {
    it(`${mod}: the old tree starts and is healthy, a relayed render passes the sanitiser, and a relayed render does not replay fixture events`, async () => {
      const r = rig();
      cleanups.push(r.cleanup);
      const { name, packageHash } = installedBefore(r, mod);
      expect(SUPERSEDED_FIRST_PARTY_PINS.get(packageHash)).toBe(PRIOR);
      const { h } = started(r);
      // 1. starts under the prior id; one health row says so; nothing is granted, re-tiered or marked for update
      const before = JSON.stringify(readGrants(r.home, r.auth).installs);
      expect(await h.start(name)).toMatchObject({ state: 'running' });
      expect(r.events.filter((e) => e.kind === 'mod.health' && e.payload.name === name)).toEqual([{ kind: 'mod.health', payload: { name, ok: true, why: 'abi-compat' } }, { kind: 'mod.health', payload: { name, ok: true } }]);
      expect(h.needsUpdate()).toEqual([]);
      expect(h.down()).toEqual([]);
      expect(JSON.stringify(readGrants(r.home, r.auth).installs)).toBe(before);
      expect(effectiveInstall(readGrants(r.home, r.auth), name)!.packageHash).toBe(packageHash);
      // 2. a relayed render comes back through the closed-kit sanitiser, fenced and labelled
      const manifest = json(DIR, mod, 'gnomon-manifest.json');
      const fixtures = fs.readdirSync(path.join(DIR, mod, 'fixtures')).filter((f) => f.endsWith('.json') && !f.endsWith('.golden.json')).sort();
      const fx = fixtures.map((f) => json(DIR, mod, 'fixtures', f)).find((f) => Array.isArray(f.input?.fixtureEvents) && f.input.fixtureEvents.length > 0) ?? json(DIR, mod, 'fixtures', fixtures[0]!);
      const viewId: string = fx.view ?? manifest.provides.views[0].id;
      const who = { principal: 'p:abcdefgh/matt', connId: 'conn-7', principalClass: 'human' };
      const plain = await h.relayView({ name, viewId, input: {}, ...who });
      expect(plain.label).toBe(`mod:${name}`);
      expect(plain.block).toMatchObject({ type: expect.any(String) });
      expect(plain.nodes).toBeGreaterThan(0);
      // 3. a relayed render carrying fixtureEvents shows what the plain relayed render shows: nothing is replayed
      const events = fx.input?.fixtureEvents ?? [{ kind: 'session.open', payload: { hsid: 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA', cwd: '/p' } }];
      const relayed = await h.relayView({ name, viewId, input: { fixtureEvents: events }, ...who });
      expect(relayed.block).toEqual(plain.block);
      if (mod !== 'paradigm-context') {
        // the falsifier: the same input rendered by the host itself (no relayedFor) DOES replay them
        const hostRendered = await h.render(name, viewId, { fixtureEvents: events });
        expect(hostRendered.block).not.toEqual(plain.block);
      }
    });
  }
});

describe('G-MOD-15: the same prior id from anything else is refused ABI', () => {
  function oldIdProbe(dir: string): string {
    return writeModFolder(dir, probeManifest(), OLD_ID_MOD);
  }

  it('a third-party mod (another publisher, another hash) echoing the prior id', async () => {
    const r = rig();
    cleanups.push(r.cleanup);
    install(r, oldIdProbe(path.join(r.root, 'src', 'acme.probe')));
    const { h } = started(r);
    const err = await h.start('acme.probe').then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ModRefusal);
    expect((err as ModRefusal).modCode).toBe('ABI');
    expect(h.running()).toEqual([]);
    expect(r.events.some((e) => e.kind === 'mod.health' && e.payload.why === 'abi-compat')).toBe(false);
  });

  it('a linked source echoing the prior id', async () => {
    const r = rig();
    cleanups.push(r.cleanup);
    install(r, oldIdProbe(path.join(r.root, 'src', 'acme.probe')), { via: 'linked' });
    const { h } = started(r);
    const err = await h.start('acme.probe').then(() => null, (e: unknown) => e);
    expect((err as ModRefusal).modCode).toBe('ABI');
    expect(h.running()).toEqual([]);
  });

  it('a first-party tree at a superseded pin echoing ANOTHER id than the one listed for it', async () => {
    // the listed tree itself is fixed by its hash, so this is the predicate: only the listed id is compared
    const hash = [...SUPERSEDED_FIRST_PARTY_PINS.keys()][0]!;
    const prior = compatModAbiId({ packageHash: hash, tier: 'first-party', source: 'package', manifest: { publisher: 'gnomon' } }, MOD_ABI_ID);
    expect(prior).toBe(PRIOR);
    expect(prior).not.toBe(`sha256:${'2'.repeat(64)}`);
  });
});

describe('G-MOD-15: an ABI refusal is a sticky needs-update state, never the DOWN text', () => {
  it('one attempt spawns the child; later relays are refused without a spawn; an operator start tries once more; status and the Mods panel say it needs an update', async () => {
    const r = rig();
    cleanups.push(r.cleanup);
    const folder = writeModFolder(path.join(r.root, 'src', 'acme.probe'), probeManifest(), OLD_ID_MOD);
    install(r, folder);
    const { h } = started(r);
    const spawns = (): number => r.events.filter((e) => e.kind === 'mod.sandbox').length;
    const refused = async (): Promise<ModRefusal> => (await h.admit('acme.probe').then(() => null, (e: unknown) => e)) as ModRefusal;
    const first = await refused();
    expect(first.modCode).toBe('ABI');
    expect(spawns()).toBe(1);
    expect(h.needsUpdate()).toEqual(['acme.probe']);
    for (let i = 0; i < 8; i++) {
      const e = await refused();
      expect(e.modCode).toBe('ABI');
      expect(e.detail).toMatchObject({ name: 'acme.probe', why: 'needs-update' });
      expect(e.message).toContain(NEEDS_UPDATE_NOTE);
      expect(e.message).not.toMatch(/is down|operator start/);
    }
    expect(spawns()).toBe(1);
    expect(h.down()).toEqual([]);
    expect((h.status() as { needsUpdate: string[] }).needsUpdate).toEqual(['acme.probe']);
    // an operator start is one more attempt, not a loop
    expect(((await h.start('acme.probe').then(() => null, (e: unknown) => e)) as ModRefusal).modCode).toBe('ABI');
    expect(spawns()).toBe(2);
    expect((await refused()).detail).toMatchObject({ why: 'needs-update' });
    expect(spawns()).toBe(2);
    // the Mods panel view: a stopped mod with the host-composed note
    const admin = new ModsAdmin({ home: r.home, trust: r.auth, host: h, scan: async () => undefined, scanConfig: async () => undefined, firstPartyRoot: null });
    const view = admin.status().installed.find((m) => m.name === 'acme.probe')!;
    expect(view).toMatchObject({ state: 'stopped', note: 'needs an update for this Gnomon' });
    expect(NEEDS_UPDATE_NOTE).toBe('needs an update for this Gnomon');
  });
});
