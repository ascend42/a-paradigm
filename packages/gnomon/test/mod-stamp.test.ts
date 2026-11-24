/**
 * G-MOD-12 and G-MOD-13 (S1.2 C1, C2): the host stamps `relayedFor` and `causes` on every row a mod appends, and
 * a mod is sent only the `relayedFor` fields of its method. The probe mod FORGES both on its appends.
 * Uses the unsandboxed launcher seam; no path literals.
 */
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DIM_KINDS, DIM_SURFACES, RELAYED_FOR_FIELDS, canonicalJson, foldDim } from '@a-company/gnomon-contracts';
import { clampModAppend, createModKernelCall, createModRelayPort, MOD_APPEND_FIELDS, MOD_APPEND_MAX_BYTES, ModRefusal, type ModAppendRow } from '../src/kernel/modhost/index.js';
import { relaySurfaceOf } from '../src/kernel/socket/dispatch.js';
import { MATRIX_CLASSES } from '../src/kernel/socket/methods.js';
import { unsandboxedModLauncher } from '../src/kernel/testing.js';
import { appendGrantRow } from '../src/kernel/manifest/index.js';
import { host, install, probeManifest, rig, writeModFolder } from './mod-helpers.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const TOOL = { principal: 'p:abcdefgh/s-01', surface: 'bridge', agent: 'kit', hsid: 'hs-1', turn: 'turn:hs-1/4' } as const;

async function started(caps: string[] = []) {
  const r = rig();
  cleanups.push(r.cleanup);
  const m = probeManifest(caps.length ? { requires: { capabilities: ['log.append:modns.acme.probe.*', ...caps], egress: [{ host: 'api.example.com', purpose: 'test' }] } } : {});
  const { manifestHash } = install(r, writeModFolder(path.join(r.root, 'src', 'acme.probe'), m));
  if (caps.length) appendGrantRow(r.home, r.auth, { kind: 'grant.capability', manifestHash, capabilities: caps });
  const rows: ModAppendRow[] = [];
  const kernelCall = createModKernelCall({ callAs: async () => ({}), append: async (row) => (rows.push(row), { seq: rows.length }) });
  const { h } = host(r, { launcher: unsandboxedModLauncher }, { kernelCall });
  cleanups.push(() => h.stopAll());
  await h.start('acme.probe');
  return { h, rows };
}

describe('G-MOD-12: a mod-supplied relayedFor or causes on an append is replaced by the host\'s', () => {
  it('a relayed command: the row carries the caller\'s {principal, connId, surface}; the forged stamp and causes are gone', async () => {
    const { h, rows } = await started();
    const out = (await h.relayCommand({ name: 'acme.probe', commandId: 'probe.who', args: { op: 'append.forged' }, principal: 'p:abcdefgh/matt', connId: 'conn-7', surface: 'cli' })) as { relayedFor: unknown; out: { ok: boolean } };
    expect(out.out.ok).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toEqual({ note: 'n', relayedFor: { principal: 'p:abcdefgh/matt', connId: 'conn-7', surface: 'cli' } });
    expect(rows[0]!.causes).toBeUndefined();
    expect('causes' in rows[0]!).toBe(false);
    // the row holds exactly what the mod was sent
    expect(out.relayedFor).toEqual(rows[0]!.payload.relayedFor);
    expect(JSON.stringify(rows).includes('evil')).toBe(false);
  });

  it('a tool call with a host-known toolRelayedFor: an entitled mod\'s row carries it and causes: [turn]', async () => {
    const { h, rows } = await started(['log.read']);
    const out = (await h.callTool('acme.probe', 'probe.write', { who: true, op: 'append.forged' }, { hsid: 'hs-1', toolRelayedFor: { ...TOOL } })) as { relayedFor: unknown; out: { ok: boolean } };
    expect(out.out.ok).toBe(true);
    expect(rows[0]!.payload.relayedFor).toEqual({ ...TOOL });
    expect(rows[0]!.causes).toEqual(['turn:hs-1/4']);
    expect(out.relayedFor).toEqual({ ...TOOL });
    expect(JSON.stringify(rows).includes('evil')).toBe(false);
  });

  it('an idle or unstamped append has no relayedFor key at all, whatever the mod supplied', async () => {
    const { h, rows } = await started();
    // a tool call the host has no toolRelayedFor for (every caller before the S1.4 bridge)
    expect(((await h.callTool('acme.probe', 'probe.write', { who: true, op: 'append.forged' })) as { relayedFor: unknown }).relayedFor).toBeNull();
    // a host-initiated command (no relay)
    await h.runCommand('acme.probe', 'probe.who', { op: 'append.forged' });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.payload).toEqual({ note: 'n' });
      expect('relayedFor' in row.payload).toBe(false);
      expect('causes' in row).toBe(false);
    }
    // the pure clamp, idle: the key is removed, also when it is the only key, and the mod's object is not mutated
    const supplied = { relayedFor: { principal: 'p:evil/x', surface: 'gui' } };
    expect(clampModAppend('acme.probe', 'p:x/mod-acme.probe', { kind: 'modns.acme.probe.done', payload: supplied, causes: ['turn:evil/1'] })).toEqual({ kind: 'modns.acme.probe.done', principal: 'p:x/mod-acme.probe', payload: {} });
    expect(supplied.relayedFor.principal).toBe('p:evil/x');
    expect(MOD_APPEND_FIELDS).toEqual(['kind', 'payload', 'audience', 'sensitivity']);
  });

  it('a partial tool stamp vouches for nobody: nothing is sent and nothing is stamped (fail closed)', async () => {
    const { h, rows } = await started(['log.read']);
    const partials: Array<Record<string, unknown>> = [{ ...TOOL, agent: '' }, { ...TOOL, surface: 'gui' }, { ...TOOL, surface: 'telepathy' }, { ...TOOL, principal: undefined }, { surface: 'bridge', agent: 'kit' }, { ...TOOL, agent: 7 }];
    for (const p of partials) {
      const out = (await h.callTool('acme.probe', 'probe.write', { who: true, op: 'append.forged' }, { toolRelayedFor: p as never })) as { relayedFor: unknown };
      expect(out.relayedFor).toBeNull();
    }
    expect(rows).toHaveLength(partials.length);
    for (const row of rows) expect(row).toEqual({ kind: 'modns.acme.probe.done', principal: expect.stringMatching(/\/mod-acme\.probe$/), payload: { note: 'n' } });
  });

  it('A2: a top-level __proto__, constructor or prototype payload key is refused by key class, and the fold reads stamps as own keys only', () => {
    const stamp = { relayedFor: { principal: 'p:abcdefgh/matt', connId: 'conn-7', surface: 'cli' } };
    const forged = JSON.parse('{"note":"n","__proto__":{"relayedFor":{"principal":"p:evil/x","surface":"gui"}}}') as Record<string, unknown>;
    expect(Object.keys(forged)).toContain('__proto__');
    for (const st of [stamp, undefined]) {
      for (const payload of [forged, JSON.parse('{"constructor":{"prototype":{"x":1}}}'), JSON.parse('{"prototype":1}')] as Array<Record<string, unknown>>) {
        let err: unknown;
        try {
          clampModAppend('acme.probe', 'p', { kind: 'modns.acme.probe.done', payload }, st);
        } catch (e) {
          err = e;
        }
        expect(err).toBeInstanceOf(ModRefusal);
        expect((err as ModRefusal).modCode).toBe('LOG');
        expect((err as ModRefusal).detail).toMatchObject({ why: 'prototype-key' });
        expect(JSON.stringify([(err as Error).message, (err as ModRefusal).detail]).includes('evil')).toBe(false);
      }
    }
    // an accepted row's payload has no prototype to inherit a stamp from
    const row = clampModAppend('acme.probe', 'p', { kind: 'modns.acme.probe.done', payload: { note: 'n' } });
    expect(Object.getPrototypeOf(row.payload)).toBeNull();
    expect(canonicalJson(row.payload)).toBe('{"note":"n"}');
    // the fold: a stamp reachable only through a prototype vouches for nobody
    const dim = 'dim:01JVA1D0000000000000000001';
    const add = (payload: Record<string, unknown>) => foldDim([
      { seq: 1, kind: DIM_KINDS.start, payload: { v: 1, dim, title: 't', attached: ['hs-1'], opened: 'command' } },
      { seq: 2, kind: DIM_KINDS.op, payload },
    ]).nodes.get('01JVA1D0000000000000000031')!;
    const ops = [{ type: 'add', node: { id: '01JVA1D0000000000000000031', kind: 'rect', x: 0, y: 0, z: 'V', w: 1, h: 1 } }];
    const inherited = Object.assign(Object.create({ relayedFor: { principal: 'p:evil/x', surface: 'gui', hsid: 'hs-evil' } }) as Record<string, unknown>, { v: 1, dim, ops });
    expect(add(inherited)).toMatchObject({ by: { cls: 'unknown', principal: 'unknown' }, hsid: 'hs-1' });
    const innerProto = { v: 1, dim, ops, relayedFor: Object.create({ principal: 'p:evil/x', surface: 'gui', hsid: 'hs-evil' }) as Record<string, unknown> };
    expect(add(innerProto)).toMatchObject({ by: { cls: 'unknown', principal: 'unknown' }, hsid: 'hs-1' });
    const parsed = JSON.parse(`{"v":1,"dim":"${dim}","ops":${JSON.stringify(ops)},"__proto__":{"relayedFor":{"principal":"p:evil/x","surface":"gui"}}}`) as Record<string, unknown>;
    expect(add(parsed).by.cls).toBe('unknown');
  });

  it('the 16 KiB cap is measured AFTER stamping', () => {
    const stamp = { relayedFor: { principal: 'p:abcdefgh/matt', connId: 'conn-7', surface: 'cli' } };
    const size = (payload: Record<string, unknown>): number => Buffer.byteLength(canonicalJson(payload), 'utf8');
    const overhead = size({ note: '', relayedFor: stamp.relayedFor });
    const fits = { note: 'x'.repeat(MOD_APPEND_MAX_BYTES - overhead) };
    expect(size({ ...fits, relayedFor: stamp.relayedFor })).toBe(MOD_APPEND_MAX_BYTES);
    expect(clampModAppend('acme.probe', 'p', { kind: 'modns.acme.probe.done', payload: fits }, stamp).payload.relayedFor).toEqual(stamp.relayedFor);
    // one byte more: under the cap as the mod sent it, over it once stamped, so refused
    const over = { note: `${fits.note}x` };
    expect(size(over)).toBeLessThan(MOD_APPEND_MAX_BYTES);
    expect(() => clampModAppend('acme.probe', 'p', { kind: 'modns.acme.probe.done', payload: over }, stamp)).toThrow(/at most/);
    expect(() => clampModAppend('acme.probe', 'p', { kind: 'modns.acme.probe.done', payload: over })).not.toThrow();
    // a huge mod-supplied relayedFor is removed BEFORE measuring: it can neither be stored nor used to trip the cap
    const padded = { note: 'n', relayedFor: { junk: 'x'.repeat(MOD_APPEND_MAX_BYTES * 2) } };
    expect(clampModAppend('acme.probe', 'p', { kind: 'modns.acme.probe.done', payload: padded }, stamp).payload).toEqual({ note: 'n', relayedFor: stamp.relayedFor });
  });

  it('a stamped dimension row folds as the right hand; an unstamped one as the unknown hand, never as human', async () => {
    const { h, rows } = await started(['log.read']);
    await h.relayCommand({ name: 'acme.probe', commandId: 'probe.who', args: { op: 'append.forged' }, principal: 'p:abcdefgh/matt', connId: 'conn-7', surface: 'gui' });
    await h.callTool('acme.probe', 'probe.write', { who: true, op: 'append.forged' }, { toolRelayedFor: { ...TOOL, surface: 'voice' } });
    await h.callTool('acme.probe', 'probe.write', { who: true, op: 'append.forged' });
    const dim = 'dim:01JVA1D0000000000000000001';
    const stamps = rows.map((r) => r.payload.relayedFor as Record<string, string> | undefined);
    for (const s of stamps.slice(0, 2)) {
      expect(typeof s!.principal === 'string' && s!.principal.length > 0).toBe(true);
      expect(DIM_SURFACES).toContain(s!.surface);
      expect(s!.agent === undefined || s!.agent.length > 0).toBe(true);
    }
    const node = (n: number): Record<string, unknown> => ({ id: `01JVA1D000000000000000001${n}`, kind: 'rect', x: 0, y: 0, z: 'V', w: 1, h: 1 });
    const state = foldDim([
      { seq: 1, kind: DIM_KINDS.start, payload: { v: 1, dim, title: 't', attached: ['hs-1'], opened: 'command' } },
      ...stamps.map((relayedFor, i) => ({ seq: 2 + i, kind: DIM_KINDS.op, payload: { v: 1, dim, ops: [{ type: 'add', node: node(i) }], ...(relayedFor ? { relayedFor } : {}) } })),
    ]);
    expect([0, 1, 2].map((i) => state.nodes.get(node(i).id as string)!.by)).toEqual([
      { cls: 'human', principal: 'p:abcdefgh/matt' },
      { cls: 'agent', principal: 'p:abcdefgh/s-01', agent: 'kit' },
      { cls: 'unknown', principal: 'unknown' },
    ]);
  });
});

describe('A1 (Aegis S1.2 review): only a human-class caller earns a surface', () => {
  it('relaySurfaceOf: human gets gui or cli; agent, session, mod, voice, read token and peer get none, on any credential', () => {
    expect(MATRIX_CLASSES).toEqual(['human', 'agent', 'session', 'mod', 'voice', 'readToken', 'peer']);
    for (const cls of MATRIX_CLASSES) {
      for (const cred of ['gui', 'device', 'token', 'session', 'read-token', null, undefined]) {
        const want = cls !== 'human' ? undefined : cred === 'gui' ? 'gui' : 'cli';
        expect([cls, cred, relaySurfaceOf(cred, cls)]).toEqual([cls, cred, want]);
      }
    }
  });

  it('per caller class, through the relay port and the host: a non-human command row has no surface and folds as the unknown hand', async () => {
    const { h, rows } = await started();
    const port = createModRelayPort(h);
    const classes = ['human', 'agent', 'session', 'mod', 'voice'] as const;
    for (const cls of classes) {
      const surface = relaySurfaceOf('device', cls);
      await port.command({ principal: `p:abcdefgh/${cls}-1`, connId: 'conn-7', principalClass: cls, ...(surface ? { surface } : {}) }, { name: 'acme.probe', commandId: 'probe.who', args: { op: 'append.forged' } });
    }
    const dim = 'dim:01JVA1D0000000000000000001';
    const node = (n: number): Record<string, unknown> => ({ id: `01JVA1D000000000000000002${n}`, kind: 'rect', x: 0, y: 0, z: 'V', w: 1, h: 1 });
    const state = foldDim([
      { seq: 1, kind: DIM_KINDS.start, payload: { v: 1, dim, title: 't', attached: ['hs-1'], opened: 'command' } },
      ...rows.map((r, i) => ({ seq: 2 + i, kind: DIM_KINDS.op, payload: { v: 1, dim, ops: [{ type: 'add', node: node(i) }], relayedFor: r.payload.relayedFor } })),
    ]);
    expect(rows.map((r) => (r.payload.relayedFor as Record<string, string>).surface)).toEqual(['cli', undefined, undefined, undefined, undefined]);
    expect(classes.map((_c, i) => state.nodes.get(node(i).id as string)!.by.cls)).toEqual(['human', 'unknown', 'unknown', 'unknown', 'unknown']);
  });
});

describe('G-MOD-13: relayedFor carries only the fields of its method; identity only for an entitled mod', () => {
  it('view.render and command.run never carry hsid, agent or turn, even when the caller object holds them', async () => {
    const { h } = await started(['log.read']);
    const loaded = { principal: 'p:abcdefgh/matt', connId: 'conn-7', surface: 'gui', hsid: 'hs-1', agent: 'kit', turn: 'turn:hs-1/4', principalClass: 'human' };
    const cmd = (await h.runCommand('acme.probe', 'probe.who', null, { relayedFor: loaded as never })) as { relayedFor: Record<string, string> };
    expect(cmd.relayedFor).toEqual({ principal: 'p:abcdefgh/matt', connId: 'conn-7', surface: 'gui' });
    expect(Object.keys(cmd.relayedFor)).toEqual([...RELAYED_FOR_FIELDS['command.run']]);
    const relayed = (await h.relayCommand({ name: 'acme.probe', commandId: 'probe.who', principal: 'p:abcdefgh/matt', connId: 'conn-7', surface: 'cli', ...({ hsid: 'hs-1', agent: 'kit', turn: 't' } as object) })) as { relayedFor: Record<string, string> };
    expect(relayed.relayedFor).toEqual({ principal: 'p:abcdefgh/matt', connId: 'conn-7', surface: 'cli' });
    const view = await h.render('acme.probe', 'probe.view', { who: true }, { relayedFor: loaded as never });
    expect(JSON.parse((view.block as { text: string }).text)).toEqual({ principal: 'p:abcdefgh/matt', connId: 'conn-7' });
    const rv = await h.relayView({ name: 'acme.probe', viewId: 'probe.view', input: { who: true }, principal: 'p:abcdefgh/matt', connId: 'conn-7', principalClass: 'human' });
    expect(Object.keys(JSON.parse((rv.block as { text: string }).text))).toEqual([...RELAYED_FOR_FIELDS['view.render']]);
  });

  it('a third-party mod without log.read gets agent and surface only, and its row has no causes', async () => {
    const { h, rows } = await started();
    const out = (await h.callTool('acme.probe', 'probe.write', { who: true, op: 'append.forged' }, { hsid: 'hs-1', toolRelayedFor: { ...TOOL } })) as { relayedFor: Record<string, string> };
    expect(out.relayedFor).toEqual({ principal: 'p:abcdefgh/s-01', surface: 'bridge', agent: 'kit' });
    expect(rows[0]!.payload).toEqual({ note: 'n', relayedFor: { principal: 'p:abcdefgh/s-01', surface: 'bridge', agent: 'kit' } });
    expect('causes' in rows[0]!).toBe(false);
    const text = JSON.stringify([out, rows]);
    expect(text.includes('hs-1')).toBe(false);
    expect(text.includes('turn:')).toBe(false);
  });

  it('a mod granted log.read gets hsid and turn; without a turn there is no causes', async () => {
    const { h, rows } = await started(['log.read']);
    const out = (await h.callTool('acme.probe', 'probe.write', { who: true, op: 'append.forged' }, { toolRelayedFor: { ...TOOL } })) as { relayedFor: Record<string, string> };
    expect(Object.keys(out.relayedFor)).toEqual([...RELAYED_FOR_FIELDS['tool.call']]);
    const { turn: _t, ...noTurn } = TOOL;
    await h.callTool('acme.probe', 'probe.write', { who: true, op: 'append.forged' }, { toolRelayedFor: { ...noTurn } });
    expect(rows[1]!.payload.relayedFor).toEqual({ ...noTurn });
    expect('causes' in rows[1]!).toBe(false);
  });
});
