/**
 * G-MOD-12 and G-MOD-13 (S1.2 C1, C2): the host stamps `relayedFor` and `causes` on every row a mod appends, and
 * a mod is sent only the `relayedFor` fields of its method. The probe mod FORGES both on its appends.
 * Uses the unsandboxed launcher seam; no path literals.
 */
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DIM_KINDS, DIM_SURFACES, RELAYED_FOR_FIELDS, canonicalJson, foldDim } from '@a-company/gnomon-contracts';
import { clampModAppend, createModKernelCall, createModRelayPort, MOD_APPEND_FIELDS, MOD_APPEND_MAX_BYTES, MOD_PAYLOAD_MAX_DEPTH, MOD_PAYLOAD_MAX_VISITED, MOD_PAYLOAD_PROTOTYPE_KEYS, ModRefusal, type ModAppendRow } from '../src/kernel/modhost/index.js';
import { relaySurfaceOf } from '../src/kernel/socket/dispatch.js';
import { MATRIX_CLASSES } from '../src/kernel/socket/methods.js';
import { unsandboxedModLauncher } from '../src/kernel/testing.js';
import { appendGrantRow } from '../src/kernel/manifest/index.js';
import { HOST_ARG_KEYS, type ModHostOptions } from '../src/kernel/modhost/host.js';
import { FIRST_PARTY_PROBE, host, install, installFirstParty, probeManifest, rig, writeModFolder } from './mod-helpers.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const text0 = (...v: unknown[]): string => JSON.stringify(v);
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

describe('G-MOD-14: only a human-class caller earns a surface; a row without principal, surface or a tool agent folds as the unknown hand', () => {
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

  it('A3: a third-party mod without log.read gets surface and agent only (no principal, hsid or turn), and its row has no causes', async () => {
    const { h, rows } = await started();
    const out = (await h.callTool('acme.probe', 'probe.write', { who: true, op: 'append.forged' }, { hsid: 'hs-1', toolRelayedFor: { ...TOOL } })) as { relayedFor: Record<string, string> };
    expect(out.relayedFor).toEqual({ surface: 'bridge', agent: 'kit' });
    expect(rows[0]!.payload).toEqual({ note: 'n', relayedFor: { surface: 'bridge', agent: 'kit' } });
    expect(text0(out, rows).includes('p:abcdefgh/s-01')).toBe(false);
    // with no principal the row vouches for nobody: the unknown hand, not the agent and not a human
    const dim = 'dim:01JVA1D0000000000000000001';
    const st = foldDim([
      { seq: 1, kind: DIM_KINDS.start, payload: { v: 1, dim, title: 't', attached: ['hs-1'], opened: 'command' } },
      { seq: 2, kind: DIM_KINDS.op, payload: { v: 1, dim, ops: [{ type: 'add', node: { id: '01JVA1D0000000000000000041', kind: 'rect', x: 0, y: 0, z: 'V', w: 1, h: 1 } }], relayedFor: rows[0]!.payload.relayedFor } },
    ]);
    expect(st.nodes.get('01JVA1D0000000000000000041')!.by).toEqual({ cls: 'unknown', principal: 'unknown' });
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

const LIVE = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
const LIVE2 = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZC';
const GONE = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZB';
const REPO = 'repo:0123456789abcdef';
const REPO2 = 'repo:fedcba9876543210';
const SESSION_OWNER: Record<string, string> = { [LIVE]: 'p:abcdefgh/s-live', [LIVE2]: 'p:abcdefgh/s-other' };
const GUI = { principal: 'p:abcdefgh/matt', connId: 'conn-7', principalClass: 'human', surface: 'gui' } as const;
interface ProbeArgs {
  keys: string[];
  args: Record<string, unknown>;
  hsid: unknown;
  repo: unknown;
  gesture: unknown;
}

/** The first-party probe (gnomon.probe) and the third-party one (acme.probe) in one host, with a live-session port. */
async function both(over: Partial<ModHostOptions> = {}) {
  const r = rig();
  cleanups.push(r.cleanup);
  install(r, writeModFolder(path.join(r.root, 'src', 'acme.probe'), probeManifest()));
  installFirstParty(r);
  const rows: ModAppendRow[] = [];
  const kernelCall = createModKernelCall({ callAs: async () => ({}), append: async (row) => (rows.push(row), { seq: rows.length }) });
  const joins: string[] = [];
  const { h } = host(r, { launcher: unsandboxedModLauncher }, { kernelCall, focusRepo: (hsid) => (joins.push(hsid), hsid === LIVE ? REPO : hsid === LIVE2 ? REPO2 : null), focusPrincipal: (hsid) => SESSION_OWNER[hsid] ?? null, ...over });
  cleanups.push(() => h.stopAll());
  await h.start('acme.probe');
  await h.start(FIRST_PARTY_PROBE);
  /** what the mod's command handler received as `args` */
  const seen = async (name: string, args: unknown, who: { principal: string; connId: string; principalClass?: string; surface?: 'gui' | 'cli' } = GUI): Promise<ProbeArgs> =>
    ((await h.relayCommand({ name, commandId: 'probe.who', args, ...who })) as { out: ProbeArgs }).out;
  return { h, rows, joins, seen };
}

describe('G-MOD-17: a command\'s args are host-composed; hsid and repo come from the host, for a first-party mod and a live joinable session only', () => {
  it('args survival: a client repo, hsid, focus, paradigm, gesture or prototype key never reaches any mod', async () => {
    const { seen, rows } = await both();
    const hostile = '{"op":"args","keep":{"a":[1]},"repo":"repo:evil","hsid":"hs-evil","focus":{"hsid":"hs-evil","repo":"/evil"},"paradigm":{"evil":1},"gesture":{"n":1,"kind":"key","evil":1},"__proto__":{"hsid":"hs-evil","repo":"repo:evil"},"constructor":{"evil":1},"prototype":{"evil":1}}';
    for (const name of ['acme.probe', FIRST_PARTY_PROBE]) {
      for (const who of [GUI, { ...GUI, surface: 'cli' as const }, { principal: 'p:abcdefgh/s-live', connId: 'conn-8', principalClass: 'agent' }, { principal: 'p:abcdefgh/v', connId: 'conn-9', principalClass: 'voice' }]) {
        const got = await seen(name, JSON.parse(hostile), who);
        expect([name, who.principalClass, got.keys]).toEqual([name, who.principalClass, ['op', 'keep']]);
        expect([got.hsid, got.repo, got.gesture]).toEqual([null, null, null]);
        expect(JSON.stringify(got).includes('evil')).toBe(false);
      }
    }
    expect(HOST_ARG_KEYS).toEqual(['repo', 'hsid', 'focus', 'paradigm', 'gesture']);
    expect(rows).toEqual([]);
  });

  it('args that are not a plain object compose to an empty one', async () => {
    const { h } = await both();
    for (const args of [null, undefined, 'op', 7, [{ op: 'args' }], [['op', 'args']]]) {
      // the probe answers {relayedFor} alone when its args carry no `op`: nothing of a non-object got through
      expect(await h.relayCommand({ name: FIRST_PARTY_PROBE, commandId: 'probe.who', args, ...GUI })).toEqual({ relayedFor: { principal: GUI.principal, connId: GUI.connId, surface: 'gui' } });
    }
  });

  it('hsid and repo are composed, both or neither: a first-party mod, a caller entitled to the focus, and a session the host knows as live', async () => {
    const { seen, joins } = await both();
    const focus = (hsid: unknown): Record<string, unknown> => ({ op: 'args', focus: { hsid } });
    const pair = (g: ProbeArgs): unknown[] => [g.hsid, g.repo, g.keys];
    const none = [null, null, ['op']];
    // the human on the GUI, a live session: both, and the repo is the HOST's value
    expect(pair(await seen(FIRST_PARTY_PROBE, { ...focus(LIVE), repo: REPO2, hsid: LIVE2 }))).toEqual([LIVE, REPO, ['op', 'hsid', 'repo']]);
    expect(pair(await seen(FIRST_PARTY_PROBE, focus(LIVE2)))).toEqual([LIVE2, REPO2, ['op', 'hsid', 'repo']]);
    // a human naming a string that is no live session (#mayJoin alone says yes to any string): neither
    expect(pair(await seen(FIRST_PARTY_PROBE, focus(GONE)))).toEqual(none);
    expect(pair(await seen(FIRST_PARTY_PROBE, focus('made-up')))).toEqual(none);
    // no focus, the K0 bare {hsid}, a malformed focus: neither (and no join is attempted)
    const before = joins.length;
    for (const args of [{ op: 'args' }, { op: 'args', hsid: LIVE }, focus(7), focus('has space'), focus(''), { op: 'args', focus: LIVE }, { op: 'args', focus: [LIVE] }, { op: 'args', focus: JSON.parse(`{"__proto__":{"hsid":"${LIVE}"}}`) }]) {
      expect([args, pair(await seen(FIRST_PARTY_PROBE, args))]).toEqual([args, none]);
    }
    expect(joins.length).toBe(before);
    // a third-party mod: neither, whatever the caller and the session
    expect(pair(await seen('acme.probe', focus(LIVE)))).toEqual(none);
    // an agent or session principal: only its OWN session
    const agent = { principal: SESSION_OWNER[LIVE]!, connId: 'conn-8', principalClass: 'agent' };
    expect(pair(await seen(FIRST_PARTY_PROBE, focus(LIVE), agent))).toEqual([LIVE, REPO, ['op', 'hsid', 'repo']]);
    expect(pair(await seen(FIRST_PARTY_PROBE, focus(LIVE2), agent))).toEqual(none);
    expect(pair(await seen(FIRST_PARTY_PROBE, focus(LIVE), { ...agent, principalClass: 'session' }))).toEqual([LIVE, REPO, ['op', 'hsid', 'repo']]);
    // voice, mod, an unknown class and a call with no class: never
    for (const principalClass of ['voice', 'mod', 'readToken', 'peer', 'root', undefined]) {
      expect([principalClass, pair(await seen(FIRST_PARTY_PROBE, focus(LIVE), { principal: SESSION_OWNER[LIVE]!, connId: 'conn-9', ...(principalClass ? { principalClass } : {}) }))]).toEqual([principalClass, none]);
    }
  });

  it('fails closed on the port: absent, throwing, or returning anything but repo:<16 hex> composes neither', async () => {
    for (const focusRepo of [undefined, () => null, () => '/Users/x/repo', () => 'repo:XYZ', () => `${REPO}0`, () => 'sha256:' + '0'.repeat(64), () => 7 as unknown as string, () => { throw new Error('boom'); }] as Array<ModHostOptions['focusRepo']>) {
      const { seen, h } = await both({ focusRepo });
      const got = await seen(FIRST_PARTY_PROBE, { op: 'args', focus: { hsid: LIVE } });
      expect([got.hsid, got.repo, got.keys]).toEqual([null, null, ['op']]);
      await h.stopAll();
    }
  });

  it('a host-initiated runCommand (no relayedFor) is composed too: no client key survives and nothing is joined', async () => {
    const { h } = await both();
    const out = ((await h.runCommand(FIRST_PARTY_PROBE, 'probe.who', { op: 'args', focus: { hsid: LIVE }, hsid: LIVE, repo: REPO, gesture: { n: 1, kind: 'key' } })) as { out: ProbeArgs }).out;
    expect([out.keys, out.hsid, out.repo, out.gesture]).toEqual([['op'], null, null, null]);
  });

  it('row scope: a joined focus stamps the envelope scope.repo on the rows of that call; a mod can never supply it', async () => {
    const { h, rows } = await both();
    const append = (name: string, args: Record<string, unknown>) => h.relayCommand({ name, commandId: 'probe.who', args: { op: 'append.forged', ...args }, ...GUI });
    await append(FIRST_PARTY_PROBE, { focus: { hsid: LIVE } });
    await append(FIRST_PARTY_PROBE, { focus: { hsid: LIVE2 } });
    await append(FIRST_PARTY_PROBE, {});
    await append(FIRST_PARTY_PROBE, { focus: { hsid: GONE }, repo: REPO });
    expect(rows.map((r) => r.scope)).toEqual([{ repo: REPO }, { repo: REPO2 }, undefined, undefined]);
    expect('scope' in rows[2]!).toBe(false);
    // the scope is on the envelope only: the payload holds the stamp and the mod's keys, never a repo
    expect(rows[0]!.payload).toEqual({ note: 'n', relayedFor: { principal: GUI.principal, connId: GUI.connId, surface: 'gui' } });
    // the pure clamp: a mod-supplied scope is never read; a stamp's scope passes only as repo:<16 hex>
    const stamp = { relayedFor: { principal: GUI.principal, connId: GUI.connId, surface: 'gui' } };
    const kind = 'modns.gnomon.probe.done';
    expect(clampModAppend(FIRST_PARTY_PROBE, 'p', { kind, payload: {}, scope: { repo: REPO2 } }, stamp).scope).toBeUndefined();
    expect(clampModAppend(FIRST_PARTY_PROBE, 'p', { kind, payload: { scope: { repo: REPO2 } }, scope: { repo: REPO2 } }, { ...stamp, scope: { repo: REPO } }).scope).toEqual({ repo: REPO });
    for (const repo of ['/Users/x/repo', 'repo:XYZ', '', `${REPO}0`, 7 as unknown as string]) expect(clampModAppend(FIRST_PARTY_PROBE, 'p', { kind, payload: {} }, { ...stamp, scope: { repo } }).scope).toBeUndefined();
    expect(MOD_APPEND_FIELDS).toEqual(['kind', 'payload', 'audience', 'sensitivity']);
  });
});

describe('G-MOD-18: a prototype key at any depth of a mod payload is refused, and the walk is bounded', () => {
  const KIND = 'modns.acme.probe.done';
  const refusal = (payload: unknown, stamp?: { relayedFor: Record<string, string> }): ModRefusal => {
    let err: unknown;
    try {
      clampModAppend('acme.probe', 'p', { kind: KIND, payload: payload as Record<string, unknown> }, stamp);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ModRefusal);
    return err as ModRefusal;
  };
  /** `key` as an OWN key `depth` levels down (depth 1 = a key of the payload itself), built as JSON.parse builds it. */
  const nested = (depth: number, key: string): unknown => {
    let s = `{${JSON.stringify(key)}:{"relayedFor":{"principal":"p:evil/x","surface":"gui"}}}`;
    for (let i = 1; i < depth; i++) s = `{"a":${s}}`;
    return JSON.parse(s);
  };
  /** A payload whose deepest container sits `levels` deep (the payload itself is level 1). */
  const deep = (levels: number, open: string, close: string): Record<string, unknown> => JSON.parse(`{"a":${open.repeat(levels - 1)}1${close.repeat(levels - 1)}}`) as Record<string, unknown>;

  it('refused (never dropped) at depth 1, 5 and 32, for each of __proto__, constructor and prototype, with or without a stamp', () => {
    const stamp = { relayedFor: { principal: 'p:abcdefgh/matt', connId: 'conn-7', surface: 'gui' } };
    for (const key of MOD_PAYLOAD_PROTOTYPE_KEYS) {
      for (const depth of [1, 5, MOD_PAYLOAD_MAX_DEPTH]) {
        for (const st of [stamp, undefined]) {
          const e = refusal(nested(depth, key), st);
          expect([key, depth, e.modCode, e.detail.why, e.detail.depth]).toEqual([key, depth, 'LOG', 'prototype-key', depth]);
          expect(JSON.stringify([e.message, e.detail]).includes('evil')).toBe(false);
        }
      }
    }
    expect(MOD_PAYLOAD_PROTOTYPE_KEYS).toEqual(['__proto__', 'constructor', 'prototype']);
  });

  it('refused inside arrays: an array element, an array in an array, and an object under both', () => {
    const inner = '{"__proto__":{"x":1}}';
    for (const text of [`{"ops":[${inner}]}`, `{"ops":[[${inner}]]}`, `{"ops":[1,"s",null,{"node":{"tags":[{"deep":${inner}}]}}]}`, `{"ops":[{"constructor":1}]}`, `{"ops":[[[{"prototype":[]}]]]}`]) {
      expect([text, refusal(JSON.parse(text)).detail.why]).toEqual([text, 'prototype-key']);
    }
    // the same shapes without the key are accepted, and a VALUE that is one of the words is not a key
    const text = '{"ops":[[{"node":{"tags":[{"deep":{"x":1}}]}}]],"word":"__proto__","words":["constructor","prototype"]}';
    expect(canonicalJson(clampModAppend('acme.probe', 'p', { kind: KIND, payload: JSON.parse(text) as Record<string, unknown> }).payload)).toBe(text);
  });

  it('a mod-supplied relayedFor is walked too: a prototype key inside it refuses the row instead of being removed with it', () => {
    expect(refusal(JSON.parse('{"note":"n","relayedFor":{"__proto__":{"surface":"gui"}}}')).detail.why).toBe('prototype-key');
  });

  it('depth bound: 32 levels pass, 33 are refused payload-depth (objects and arrays), without recursion', () => {
    for (const [open, close] of [['{"a":', '}'], ['[', ']']] as const) {
      expect(() => clampModAppend('acme.probe', 'p', { kind: KIND, payload: deep(MOD_PAYLOAD_MAX_DEPTH, open, close) })).not.toThrow();
      const e = refusal(deep(MOD_PAYLOAD_MAX_DEPTH + 1, open, close));
      expect([e.modCode, e.detail.why]).toEqual(['LOG', 'payload-depth']);
    }
    // far beyond any call stack: built by a loop, refused by the bound, never a RangeError
    let huge: unknown = 1;
    for (let i = 0; i < 200_000; i++) huge = i % 2 ? [huge] : { a: huge };
    expect(refusal({ a: huge }).detail.why).toBe('payload-depth');
    expect(MOD_PAYLOAD_MAX_DEPTH).toBe(32);
  });

  it('size bound: 4,096 visited keys and elements pass, one more is refused payload-size, before the byte cap is measured', () => {
    // 1 key (`a`) + (n - 1) elements
    const at = (n: number): Record<string, unknown> => ({ a: Array.from({ length: n - 1 }, () => 0) });
    expect(() => clampModAppend('acme.probe', 'p', { kind: KIND, payload: at(MOD_PAYLOAD_MAX_VISITED) })).not.toThrow();
    expect(refusal(at(MOD_PAYLOAD_MAX_VISITED + 1)).detail.why).toBe('payload-size');
    // keys count as well as elements, across containers (64 + 64 * 64)
    const wide = Object.fromEntries(Array.from({ length: 64 }, (_v, i) => [`k${i}`, Object.fromEntries(Array.from({ length: 64 }, (_w, j) => [`j${j}`, 0]))]));
    expect(refusal(wide).detail.why).toBe('payload-size');
    // a payload over BOTH bounds is refused by the walk, so nothing was canonicalised to measure it first
    const both = refusal({ a: Array.from({ length: MOD_PAYLOAD_MAX_VISITED + 1 }, () => 'x'.repeat(64)) });
    expect([both.detail.why, both.detail.bytes]).toEqual(['payload-size', undefined]);
    expect(MOD_PAYLOAD_MAX_VISITED).toBe(4096);
  });

  it('the walk reads own keys only and never mutates the mod\'s object', () => {
    const inherited = Object.assign(Object.create({ constructor: 1, prototype: 2 }) as Record<string, unknown>, { note: 'n' });
    expect(canonicalJson(clampModAppend('acme.probe', 'p', { kind: KIND, payload: { nested: inherited } }).payload)).toBe('{"nested":{"note":"n"}}');
    const forged = JSON.parse('{"a":{"b":{"__proto__":{"x":1}}}}') as Record<string, unknown>;
    const before = JSON.stringify(forged);
    refusal(forged);
    expect(JSON.stringify(forged)).toBe(before);
  });

  it('through a running mod: a deep prototype key on a real append is refused BAD_REQUEST and no row is written', async () => {
    const { h, rows } = await started();
    const call = (text: string) => h.callTool('acme.probe', 'probe.write', { who: true, op: 'append.raw', text }) as Promise<{ out: { ok: boolean; code?: unknown } }>;
    expect((await call('{"ops":[{"node":{"__proto__":{"x":1}}}]}')).out.ok).toBe(false);
    expect((await call(JSON.stringify(deep(MOD_PAYLOAD_MAX_DEPTH + 1, '[', ']')))).out.ok).toBe(false);
    expect(rows).toEqual([]);
    expect((await call('{"ops":[{"node":{"x":1}}]}')).out.ok).toBe(true);
    expect(rows).toHaveLength(1);
  });
});
