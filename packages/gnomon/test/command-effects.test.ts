/**
 * #mod-host command `effects` (Dimensions S1.4 pass P1; Aegis A7; spec §12.3). A command whose manifest entry
 * declares `effects` runs with exactly that set; a command without the field keeps the union of the mod's tool
 * effects (the default is not flipped in this pass); the command read cap (G-MOD-17) stays the outer cap, so a
 * third-party command that declares `write` is still read-only. Uses the unsandboxed launcher seam; no path literals.
 */
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createModKernelCall, type ModAppendRow } from '../src/kernel/modhost/index.js';
import { commandCap, commandEffects, declaredEffects, effectsFor, toolEffects, type CallContext } from '../src/kernel/modhost/effects.js';
import type { KernelCallRequest } from '../src/kernel/modhost/host.js';
import type { ManifestV2 } from '../src/kernel/manifest/manifest.js';
import type { ModLaunchInput } from '../src/kernel/sandbox/mod.js';
import { unsandboxedModLauncher } from '../src/kernel/testing.js';
import { FIRST_PARTY_PROBE, PROBE_SOURCE, firstPartyProbeManifest, host, install, installFirstParty, probeManifest, rig, writeModFolder } from './mod-helpers.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

type Cmd = NonNullable<NonNullable<ManifestV2['provides']>['commands']>[number];
const COMMANDS: Cmd[] = [
  { id: 'probe.who', title: 'No effects field' },
  { id: 'probe.ro', title: 'Declares read', effects: ['read'] },
  { id: 'probe.rw', title: 'Declares read and write', effects: ['read', 'write'] },
  { id: 'probe.w', title: 'Declares write only', effects: ['write'] },
];
const HANDLER = '(a, ctx, api) => run(a, api)';
/** The probe with one handler per command id above (the stock probe serves `probe.who` only). */
const SOURCE = (() => {
  const from = "commands: { 'probe.who':";
  if (!PROBE_SOURCE.includes(from)) throw new Error('the probe source changed: update command-effects.test.ts');
  return PROBE_SOURCE.replace(from, `commands: { 'probe.ro': ${HANDLER}, 'probe.rw': ${HANDLER}, 'probe.w': ${HANDLER}, 'probe.who':`);
})();
const GUI = { principal: 'p:abcdefgh/matt', connId: 'conn-7', surface: 'gui' as const };
type Out = { relayedFor?: unknown; out?: { ok: boolean }; ok?: boolean };
const okOf = (o: unknown): boolean => {
  const v = o as Out;
  return v.out ? v.out.ok : v.ok === true;
};

const cmd = (commandId: string | undefined, rf?: Record<string, string>): Extract<CallContext, { kind: 'command' }> => ({ kind: 'command', ...(commandId ? { commandId } : {}), ...(rf ? { stamp: { relayedFor: rf } } : {}) });
const M = (publisher: string, tools: NonNullable<NonNullable<ManifestV2['provides']>['tools']> = probeManifest().provides!.tools!): ManifestV2 => ({ ...probeManifest(), publisher, provides: { ...probeManifest().provides, tools, commands: COMMANDS } });

describe('S1.4 command effects, the pure rule (effects.ts)', () => {
  it('PRESENT: a command with an effects field gets exactly that set, whatever the tools declare', () => {
    const gui = { principal: 'p', connId: 'c', surface: 'gui' };
    const m = M('gnomon'); // the tools declare read, write, network and spend
    expect([...effectsFor(m, cmd('probe.ro', gui), false)]).toEqual(['read']);
    expect([...effectsFor(m, cmd('probe.rw', gui), false)].sort()).toEqual(['read', 'write']);
    expect([...effectsFor(m, cmd('probe.w', gui), false)]).toEqual(['write']);
    // and never more than it declared: no tool's network or spend reaches a declared command
    for (const id of ['probe.ro', 'probe.rw', 'probe.w']) {
      const set = effectsFor(m, cmd(id, gui), false);
      expect([id, set.has('network'), set.has('spend')]).toEqual([id, false, false]);
    }
    // exactly its own set the other way too: write on the command though every tool is read-only
    const readOnlyTools = M('gnomon', [{ name: 'probe.read', effects: ['read'] }]);
    expect([...effectsFor(readOnlyTools, cmd('probe.rw', gui), false)].sort()).toEqual(['read', 'write']);
    expect([...commandEffects(readOnlyTools, 'probe.rw')].sort()).toEqual(['read', 'write']);
  });

  it('ABSENT: a command without the field keeps the old default, the union of the tool effects (not flipped in P1)', () => {
    const gui = { principal: 'p', connId: 'c', surface: 'gui' };
    const m = M('gnomon');
    expect([...effectsFor(m, cmd('probe.who', gui), false)].sort()).toEqual(['network', 'read', 'spend', 'write']);
    expect([...commandEffects(m, 'probe.who')].sort()).toEqual([...toolEffects(m)].sort());
    // a context with no command id, and an id the manifest does not hold, get the same default
    expect([...effectsFor(m, cmd(undefined, gui), false)].sort()).toEqual(['network', 'read', 'spend', 'write']);
    expect([...commandEffects(m, 'probe.nope')].sort()).toEqual(['network', 'read', 'spend', 'write']);
    // the default is the TOOL union only: another command's declared write does not leak into it
    const readOnlyTools = M('gnomon', [{ name: 'probe.read', effects: ['read'] }]);
    expect([...effectsFor(readOnlyTools, cmd('probe.who', gui), false)]).toEqual(['read']);
    expect([...toolEffects(readOnlyTools)]).toEqual(['read']);
  });

  it('the launch plan counts a command\'s declared effects for a gnomon-published mod only', () => {
    const tools: NonNullable<NonNullable<ManifestV2['provides']>['tools']> = [{ name: 'probe.read', effects: ['read'] }];
    // first-party: a command's write opens the mod's write paths
    expect([...declaredEffects(M('gnomon', tools))].sort()).toEqual(['read', 'write']);
    // third-party and local: the command can never write (commandCap), so its declaration opens nothing
    expect([...declaredEffects(M('acme', tools))]).toEqual(['read']);
    expect([...declaredEffects(M('local', tools))]).toEqual(['read']);
    // a tool's write counts for every publisher, as before
    expect([...declaredEffects(M('acme'))].sort()).toEqual(['network', 'read', 'spend', 'write']);
  });

  it('the read cap stays the OUTER cap: a third-party command that declares write is read-only, and so is every non-GUI caller', () => {
    const table: Array<[string, string, Record<string, string> | undefined]> = [
      ['third-party, human on the GUI', 'acme', { principal: 'p', connId: 'c', surface: 'gui' }],
      ['publisher local, human on the GUI', 'local', { principal: 'p', connId: 'c', surface: 'gui' }],
      ['first-party, human on a device key', 'gnomon', { principal: 'p', connId: 'c', surface: 'cli' }],
      ['first-party, no surface (agent, session, voice, mod)', 'gnomon', { principal: 'p', connId: 'c' }],
      ['first-party, no stamp (a direct runCommand)', 'gnomon', undefined],
    ];
    for (const [label, publisher, rf] of table) {
      expect([label, commandCap(M(publisher), cmd('probe.rw', rf))]).toEqual([label, 'read']);
      expect([label, [...effectsFor(M(publisher), cmd('probe.rw', rf), false)]]).toEqual([label, ['read']]);
      // a command that declared write ONLY has nothing left under the cap; the cap never adds read
      expect([label, [...effectsFor(M(publisher), cmd('probe.w', rf), false)]]).toEqual([label, []]);
    }
    // the dev cap on top, as for tools
    expect([...effectsFor(M('gnomon'), cmd('probe.rw', { surface: 'gui' }), true)]).toEqual(['read']);
  });

  it('a manifest object that skipped the loader cannot give a command network or spend', () => {
    const m = M('gnomon');
    m.provides!.commands = [{ id: 'probe.rw', title: 't', effects: ['read', 'network', 'spend'] as unknown as Cmd['effects'] }];
    expect([...effectsFor(m, cmd('probe.rw', { surface: 'gui' }), false)]).toEqual(['read']);
    // an inherited `effects` is not a declaration
    const inherited = Object.create({ effects: ['read'] }) as Cmd;
    inherited.id = 'probe.rw';
    inherited.title = 't';
    m.provides!.commands = [inherited];
    expect([...effectsFor(m, cmd('probe.rw', { surface: 'gui' }), false)].sort()).toEqual(['network', 'read', 'spend', 'write']);
  });
});

/** A started host with the given mods; `rows` are what the real bridge appended, `reqs` what the host handed it. */
async function started(mods: Array<{ firstParty: boolean; manifest: ManifestV2 }>) {
  const r = rig();
  cleanups.push(r.cleanup);
  const names: string[] = [];
  for (const m of mods) {
    if (m.firstParty) names.push(installFirstParty(r, m.manifest, SOURCE.replaceAll('modns.acme.probe.', `modns.gnomon.${m.manifest.name}.`)));
    else {
      install(r, writeModFolder(path.join(r.root, 'src', `${m.manifest.publisher}.${m.manifest.name}`), m.manifest, SOURCE));
      names.push(`${m.manifest.publisher}.${m.manifest.name}`);
    }
  }
  const rows: ModAppendRow[] = [];
  const reqs: KernelCallRequest[] = [];
  const launched: ModLaunchInput[] = [];
  const bridge = createModKernelCall({ callAs: async () => ({}), append: async (row) => (rows.push(row), { seq: rows.length }) });
  const { h } = host(r, { launcher: (input) => (launched.push(input), unsandboxedModLauncher(input)) }, { kernelCall: (req) => (reqs.push(req), bridge(req)) });
  cleanups.push(() => h.stopAll());
  for (const n of names) await h.start(n);
  const run = async (name: string, commandId: string, op: string, who: { principal: string; connId: string; surface?: 'gui' | 'cli' } = GUI): Promise<boolean> => okOf(await h.relayCommand({ name, commandId, args: { op }, ...who }));
  return { h, r, rows, reqs, launched, run };
}

describe('S1.4 command effects through the running host (host.ts passes the command id of the call in force)', () => {
  it('first-party, a human on the GUI: read declared ⇒ no append and no state.set; read+write declared ⇒ both; no field ⇒ the tool union as before', async () => {
    const fp = firstPartyProbeManifest();
    fp.provides = { ...fp.provides, commands: COMMANDS };
    const { rows, run, r } = await started([{ firstParty: true, manifest: fp }]);
    const seen: Array<[string, boolean, boolean, boolean]> = [];
    for (const c of COMMANDS) {
      const n = rows.length;
      const append = await run(FIRST_PARTY_PROBE, c.id, 'append');
      seen.push([c.id, append, await run(FIRST_PARTY_PROBE, c.id, 'state.set'), await run(FIRST_PARTY_PROBE, c.id, 'state.get')]);
      expect([c.id, rows.length - n]).toEqual([c.id, append ? 1 : 0]);
    }
    expect(seen).toEqual([
      // command, log.append, state.set, state.get
      ['probe.who', true, true, true], // no field: the tool union (the probe's tools declare write)
      ['probe.ro', false, false, true], // exactly read, though the mod's tools declare write
      ['probe.rw', true, true, true],
      ['probe.w', true, true, false], // exactly write: not even a read
    ]);
    // each refused call is a logged effect refusal: probe.ro's append and state.set, probe.w's state.get
    expect(r.events.filter((e) => e.kind === 'mod.effect.refused').map((e) => [e.payload.effect, e.payload.method])).toEqual([['write', 'kernel.call'], ['write', 'state.set'], ['read', 'state.get']]);
  });

  it('a command may write though every tool is read-only, the launch plan then has write, and the undeclared command stays at the tool union', async () => {
    const fp = firstPartyProbeManifest();
    fp.provides = { ...fp.provides, tools: [{ name: 'probe.read', effects: ['read'] }], commands: COMMANDS };
    const { rows, run, launched } = await started([{ firstParty: true, manifest: fp }]);
    expect(await run(FIRST_PARTY_PROBE, 'probe.rw', 'append')).toBe(true);
    expect(await run(FIRST_PARTY_PROBE, 'probe.who', 'append')).toBe(false);
    expect(await run(FIRST_PARTY_PROBE, 'probe.who', 'state.get')).toBe(true);
    expect(rows).toHaveLength(1);
    expect(launched.map((l) => l.write)).toEqual([true]);
  });

  it('a third-party mod with read-only tools and a command declaring write launches WITHOUT write paths, and its command is read-only', async () => {
    const third = probeManifest();
    third.provides = { ...third.provides, tools: [{ name: 'probe.read', effects: ['read'] }], commands: COMMANDS };
    const { rows, run, launched } = await started([{ firstParty: false, manifest: third }]);
    expect(launched.map((l) => l.write)).toEqual([false]);
    expect([await run('acme.probe', 'probe.rw', 'append'), await run('acme.probe', 'probe.rw', 'state.set'), await run('acme.probe', 'probe.rw', 'state.get')]).toEqual([false, false, true]);
    expect(rows).toHaveLength(0);
  });

  it('a third-party command declaring write is still read-only on the GUI (commandCap is the outer cap); a first-party one is read-only off the GUI', async () => {
    const third = probeManifest();
    third.provides = { ...third.provides, commands: COMMANDS };
    const fp = firstPartyProbeManifest();
    fp.provides = { ...fp.provides, commands: COMMANDS };
    const { rows, run } = await started([
      { firstParty: false, manifest: third },
      { firstParty: true, manifest: fp },
    ]);
    for (const id of ['probe.rw', 'probe.w', 'probe.who']) {
      expect([id, await run('acme.probe', id, 'append'), await run('acme.probe', id, 'state.set')]).toEqual([id, false, false]);
    }
    expect(await run('acme.probe', 'probe.rw', 'state.get')).toBe(true);
    const cli = { principal: 'p:abcdefgh/matt', connId: 'conn-8', surface: 'cli' as const };
    const agent = { principal: 'p:abcdefgh/s-01', connId: 'conn-9' };
    for (const who of [cli, agent]) expect([await run(FIRST_PARTY_PROBE, 'probe.rw', 'append', who), await run(FIRST_PARTY_PROBE, 'probe.rw', 'state.set', who)]).toEqual([false, false]);
    expect(rows).toHaveLength(0);
  });

});
