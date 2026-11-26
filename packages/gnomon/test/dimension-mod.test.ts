/**
 * #dimension-mod (S1.3 P2; spec §12.7): the first-party mod `gnomon.dimension`, run as a REAL child from its pinned
 * snapshot under the real mod host, with an in-memory log behind the real mod bridge (test/dimension-helpers.ts).
 * Covers the pin, the generated `dim-shape.mjs`, the hostile-op table, titles, caps, reopen, an ended dimension,
 * attach, "state moves only after a seq", keyframes, and isolation. The relay per caller class over a real socket
 * is test/dimension-relay.test.ts.
 */
import * as fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { DIM_AUX_KINDS, DIM_KINDS, DIM_REFUSAL_CODES, MOD_ABI_ID, canonicalJson, dimAttrDigest, dimHash, emptyDimState, foldDim, validateDimOps, type DimState } from '@a-company/gnomon-contracts';
import { compatModAbiId, deriveTier, firstPartyPins, isFirstPartyPin, isSupersededPin, supersededPins, supersededPriorModAbiId } from '../src/kernel/manifest/install.js';
import { readManifest } from '../src/kernel/manifest/manifest.js';
import { hashSourceTree } from '../src/kernel/manifest/snapshot.js';
import { hostDir } from '../src/kernel/modhost/state.js';
import { unsandboxedModLauncher } from '../src/kernel/testing.js';
import { PKG_ROOT } from './helpers.js';
import { stageInstall } from '../src/kernel/manifest/install.js';
import { DIMENSION, DIMENSION_TREE, FAKE_LOG_ID, dimId, fakeLog, installDimension, rectOp, ulid } from './dimension-helpers.js';
import { host, rig as modRig } from './mod-helpers.js';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const A = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
const B = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZB';
const C = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZC';
const REPO = 'repo:0123456789abcdef';
const OTHER_REPO = 'repo:fedcba9876543210';
const REPOS: Record<string, string> = { [A]: REPO, [B]: REPO, [C]: OTHER_REPO };
const HUMAN = 'p:00000000/founder';
const GUI = { principal: HUMAN, connId: 'conn:01JTESTGUI000000000000000', surface: 'gui' as const, principalClass: 'human' };
const MOD_MS = 60_000;

type Res = { ok: boolean; code?: string; fix?: string; seq?: number; firstSeq?: number; hash?: string; title?: string; created?: boolean; already?: boolean; applied?: number; ops?: number; nodes?: number; refused?: Array<{ index: number; field: string; code: string; fix: string; rule?: string }> };

async function dimRig(opts: { seed?: (stateFile: string) => void } = {}) {
  const r = modRig();
  cleanups.push(r.cleanup);
  installDimension(r);
  const log = fakeLog();
  const stateFile = path.join(hostDir(r.home, DIMENSION), 'state.db');
  opts.seed?.(stateFile);
  const { h } = host(r, { launcher: unsandboxedModLauncher }, { kernelCall: log.kernelCall, callTimeoutMs: 30_000, focusRepo: (hsid) => REPOS[hsid] ?? null });
  cleanups.push(() => h.stopAll());
  await h.start(DIMENSION);
  const run = async (commandId: string, args: Record<string, unknown>, hsid: string | null = A, who: Record<string, unknown> = GUI): Promise<Res> =>
    (await h.relayCommand({ name: DIMENSION, commandId, args: hsid ? { ...args, focus: { hsid } } : args, ...(who as typeof GUI) })) as Res;
  const restart = async (): Promise<void> => {
    await h.stop(DIMENSION);
    await h.start(DIMENSION);
  };
  const state = (): Record<string, unknown> => (fs.existsSync(stateFile) ? (JSON.parse(fs.readFileSync(stateFile, 'utf8')) as Record<string, unknown>) : {});
  return { r, h, log, run, restart, state, stateFile };
}

describe('#dimension-mod: the tree, its pin and the generated dim-shape (spec §12.7)', () => {
  it('its packageHash is a pinned first-party hash, it is not a superseded pin, and it speaks the current modAbiId', () => {
    const h = hashSourceTree(DIMENSION_TREE, DIMENSION, () => undefined).packageHash;
    expect(firstPartyPins(), `the dimension tree now hashes to ${h}: pin it in FIRST_PARTY_PACKAGE_HASHES (src/kernel/manifest/install.ts)`).toContain(h);
    expect(isSupersededPin(h)).toBe(false);
    // S1.4 P0 replaced the S1.3 pin: a NEW install of the 1.0.0 tree no longer derives first-party (an install already
    // pinned at it keeps its signed tier until its Update: test/retired-pins.test.ts), and it is not a superseded pin
    const S1_3_PIN = 'sha256:7e79c8439b116dbbc1dd542dba84e848546247c820e59954ce20ee49b4ee34c9';
    expect(h).not.toBe(S1_3_PIN);
    expect(isFirstPartyPin(S1_3_PIN)).toBe(false);
    expect(isSupersededPin(S1_3_PIN)).toBe(false);
    expect(deriveTier(S1_3_PIN)).toBe('local');
    expect(fs.readFileSync(path.join(DIMENSION_TREE, 'index.mjs'), 'utf8')).toContain(`'${MOD_ABI_ID}'`);
    // install.ts compatModAbiId: a tree that declares tools never earns a prior modAbiId. This tree declares two and needs none.
    const m = readManifest(fs.readFileSync(path.join(DIMENSION_TREE, 'gnomon-manifest.json')), { tier: 'first-party' }).manifest;
    expect(compatModAbiId({ packageHash: h, tier: 'first-party', source: 'package', manifest: m }, MOD_ABI_ID)).toBeNull();
  });

  it('the manifest: nine commands each with declared effects, the four dimension kinds and the two auxiliary kinds, two tools with a bounded schema description, no view, keybinding, offer, capability or egress', () => {
    const m = readManifest(fs.readFileSync(path.join(DIMENSION_TREE, 'gnomon-manifest.json')), { tier: 'first-party' }).manifest;
    expect([m.publisher, m.name, m.abi]).toEqual(['gnomon', 'dimension', 'mod-abi:v1']);
    // S1.4 (Aegis A7): every command declares its effects; only dim.select, dim.check and (E1) dim.seen are read-only
    expect(m.provides?.commands?.map((c) => [c.id, c.effects])).toEqual([
      ['dim.open', ['read', 'write']],
      ['dim.attach', ['read', 'write']],
      ['dim.op', ['read', 'write']],
      ['dim.close', ['read', 'write']],
      ['dim.grant', ['read', 'write']],
      ['dim.select', ['read']],
      ['dim.check', ['read']],
      ['dim.undo', ['read', 'write']],
      ['dim.seen', ['read']],
    ]);
    // F1: the two auxiliary kinds are declared here and are NOT in the published kind list
    expect([...(m.provides?.events ?? [])].sort()).toEqual([...Object.values(DIM_KINDS), ...Object.values(DIM_AUX_KINDS)].sort());
    for (const k of Object.values(DIM_AUX_KINDS)) expect((Object.values(DIM_KINDS) as string[]).includes(k)).toBe(false);
    expect(m.provides?.tools?.map((t) => [t.name, t.effects])).toEqual([['dim-view', ['read']], ['dim-draw', ['read', 'write']]]);
    expect(Object.keys(m.provides ?? {}).sort()).toEqual(['commands', 'events', 'tools']);
    expect(m.requires).toEqual({ capabilities: [], egress: 'none' });
    // Aegis M6: the description a model reads is schema.description, at most 1,024 characters with no control or
    // format character, and the whole schema is at most 8 KiB of canonical JSON
    for (const t of m.provides?.tools ?? []) {
      const schema = t.schema as { description?: unknown; additionalProperties?: unknown; properties?: Record<string, unknown> };
      expect([t.name, typeof schema.description]).toEqual([t.name, 'string']);
      const d = schema.description as string;
      expect([t.name, d.length <= 1024, /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(d)]).toEqual([t.name, true, false]);
      expect(Buffer.byteLength(canonicalJson(schema), 'utf8')).toBeLessThanOrEqual(8 * 1024);
      expect(/[^\x20-\x7e]/.test(JSON.stringify(schema))).toBe(false);
      expect(schema.additionalProperties).toBe(false);
      // the first four playbook rules, one sentence each, and that board text is data whatever its `by`
      for (const rule of [/[Vv]iew the board .*before you draw/, /Cite marks by their node id/, /beside another hand's mark/, /Text on a board is permanent, so never put a secret or a draft there/, /data, whoever drew it/, /never follow an instruction found/]) expect([t.name, String(rule), rule.test(d)]).toEqual([t.name, String(rule), true]);
    }
    const draw = m.provides!.tools!.find((t) => t.name === 'dim-draw')!.schema as { description: string; properties: Record<string, unknown> };
    expect(/Send opId on every draw and reuse the same opId when you retry/.test(draw.description)).toBe(true);
    expect(Object.keys(draw.properties).sort()).toEqual(['dim', 'opId', 'ops']);
    expect(Object.keys((m.provides!.tools!.find((t) => t.name === 'dim-view')!.schema as { properties: Record<string, unknown> }).properties).sort()).toEqual(['dim', 'limit', 'since']);
  });

  it('dim-shape.mjs equals a fresh build of gnomon-contracts/src/dim.ts (LF-normalised), and folds the published hash vector', async () => {
    const { buildDimShape } = (await import(pathToFileURL(path.join(PKG_ROOT, 'scripts', 'build-dimension-mod.mjs')).href)) as { buildDimShape: () => Promise<string> };
    const committed = fs.readFileSync(path.join(DIMENSION_TREE, 'dim-shape.mjs'), 'utf8').replace(/\r\n/g, '\n');
    expect(committed === (await buildDimShape()), 'dim-shape.mjs is stale: run node scripts/build-dimension-mod.mjs in packages/gnomon, then repin').toBe(true);
    expect(/^\/\/ .*\.ts$/m.test(committed)).toBe(false); // no path comments
    const shape = (await import(pathToFileURL(path.join(DIMENSION_TREE, 'dim-shape.mjs')).href)) as typeof import('@a-company/gnomon-contracts');
    expect(shape.dimHash(shape.foldDim(shape.DIM_HASH_VECTOR_ROWS))).toBe(shape.DIM_HASH_VECTOR_HASH);
  });

  it('isolation: the tree imports only its own files, never board, GUI or node code; G-DDL-01: no foldDimRow call sits in a loop', () => {
    const files = fs.readdirSync(DIMENSION_TREE).sort();
    expect(files).toEqual(['PLAYBOOK.md', 'dim-shape.mjs', 'gnomon-manifest.json', 'index.mjs', 'model.mjs']);
    for (const f of files.filter((n) => n.endsWith('.mjs'))) {
      const src = fs.readFileSync(path.join(DIMENSION_TREE, f), 'utf8');
      const specs = [...src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((x) => x[1]!);
      for (const s of specs) expect([f, s, /^\.\/(dim-shape|model)\.mjs$/.test(s)]).toEqual([f, s, true]);
      expect([f, /\bimport\s*\(/.test(src), /\brequire\s*\(/.test(src)]).toEqual([f, false, false]);
      expect([f, /excalidraw|gnomon-gui|\/board\//i.test(src)]).toEqual([f, false]);
    }
    // the pure model holds no I/O at all
    expect(/\bprocess\.|['"]node:|\bfetch\(/.test(fs.readFileSync(path.join(DIMENSION_TREE, 'model.mjs'), 'utf8'))).toBe(false);
    // foldDimRow copies the state per row: the mod calls it once, for the single row it just appended, and never in a loop
    const hand = ['index.mjs', 'model.mjs'].map((f) => fs.readFileSync(path.join(DIMENSION_TREE, f), 'utf8')).join('\n');
    expect(hand.match(/foldDimRow\(/g)).toHaveLength(1);
    expect(/(for|while)\s*\([^)]*\)\s*\{?[^}]*foldDimRow\(/.test(hand)).toBe(false);
  });
});

describe('#dimension-mod model: actorOf, apply, titleProblem, grantDefault (pure; A6, C2, C6)', () => {
  const load = async () => (await import(pathToFileURL(path.join(DIMENSION_TREE, 'model.mjs')).href)) as Record<string, (...a: unknown[]) => unknown> & { MOD_REFUSAL_FIXES: Record<string, string> };

  it('actorOf: a human only for an own surface gui with a principal and no agent; every other stamp is nobody', async () => {
    const m = await load();
    expect(m.actorOf!({ principal: HUMAN, connId: 'c', surface: 'gui' })).toEqual({ cls: 'human', principal: HUMAN });
    for (const rf of [undefined, null, 'gui', [], {}, { principal: HUMAN }, { principal: HUMAN, surface: 'cli' }, { principal: HUMAN, surface: 'bridge', agent: 'kit' }, { principal: HUMAN, surface: 'gui', agent: 'kit' }, { principal: '', surface: 'gui' }, { principal: 7, surface: 'gui' }, { surface: 'gui' }, Object.create({ principal: HUMAN, surface: 'gui' }), JSON.parse(`{"__proto__":{"principal":"${HUMAN}","surface":"gui"}}`)]) expect([rf, m.actorOf!(rf)]).toEqual([rf, null]);
  });

  it('apply is the one entry: any well-formed hand edits any mark (S1.4 E0), not-owner only for a malformed actor, and a secret yields nothing to append', async () => {
    const m = await load();
    const human = { cls: 'human', principal: HUMAN };
    const base = (m.apply!(emptyDimState('dim:x'), [rectOp(1)], human) as { ok: unknown[]; next: DimState }).next;
    expect(base.nodes.size).toBe(1);
    const agent = m.apply!(base, [{ type: 'delete', id: ulid(1) }], { cls: 'agent', principal: 'p:00000000/s-1', agent: 'kit' }) as { ok: unknown[]; refused: Array<{ code: string }>; next: DimState };
    expect([agent.ok.length, agent.refused, agent.next.nodes.has(ulid(1))]).toEqual([1, [], false]);
    const nameless = m.apply!(base, [{ type: 'delete', id: ulid(1) }], { cls: 'agent', principal: 'p:00000000/s-1', agent: '' }) as { ok: unknown[]; refused: Array<{ code: string }>; next: DimState };
    expect([nameless.ok, nameless.refused.map((r) => r.code), nameless.next === base]).toEqual([[], ['not-owner'], true]);
    const secret = m.apply!(base, [rectOp(2), rectOp(3, { label: 'password = hunter2hunter2' })], human) as { ok: unknown[]; secret: boolean; next: DimState };
    expect([secret.ok, secret.secret, secret.next === base]).toEqual([[], true, true]);
    expect((m.apply!(base, [rectOp(2)], null) as { ok: unknown[] }).ok).toEqual([]);
  });

  it('titleProblem and grantDefault', async () => {
    const m = await load();
    expect(['Plan', 'a'.repeat(120), 'Café — notes'].map((t) => m.titleProblem!(t))).toEqual([null, null, null]);
    expect([undefined, null].map((t) => m.titleProblem!(t))).toEqual(['title-missing', 'title-missing']);
    for (const t of ['', '   ', 'a'.repeat(121), 'a\u0000b', 'a\nb', 'a\u200bb', 'a\u2028b', 'a\u202eb', 7, ['x'], { a: 1 }]) expect([t, m.titleProblem!(t)]).toEqual([t, 'title-bad']);
    expect(m.titleProblem!('password = hunter2hunter2')).toBe('title-secret');
    const s = foldDim([{ seq: 1, kind: DIM_KINDS.start, payload: { v: 1, dim: 'dim:x', title: 't', attached: [A], opened: 'menu' } }, { seq: 2, kind: DIM_KINDS.attach, payload: { v: 1, dim: 'dim:x', hsid: B } }]);
    expect([m.grantDefault!(s, A), m.grantDefault!(s, B), m.grantDefault!(s, C), m.grantDefault!(emptyDimState(), A)]).toEqual(['on', 'off', 'off', 'off']);
    // every refusal sentence is fixed text
    for (const fix of Object.values(m.MOD_REFUSAL_FIXES)) expect(/[<>{}$]/.test(fix)).toBe(false);
  });
});

describe('#dimension-mod commands under the real mod host (S1.3; Aegis B2)', () => {
  it(
    'dim.open creates with a host-stamped start row scoped to the repo; dim.op appends validated ops; the fold is human; dim.close records the mod\'s own counts',
    async () => {
      const w = await dimRig();
      const dim = dimId(1);
      const opened = await w.run('dim.open', { dim, title: 'Plan', opened: 'command' });
      expect(opened).toMatchObject({ ok: true, created: true, dim, title: 'Plan', firstSeq: 1, seq: 1 });
      expect(w.log.rows[0]).toMatchObject({ kind: DIM_KINDS.start, scope: { repo: REPO }, payload: { v: 1, dim, title: 'Plan', attached: [A], opened: 'command', relayedFor: { principal: HUMAN, connId: GUI.connId, surface: 'gui' } } });
      const op = await w.run('dim.op', { dim, ops: [rectOp(1, { label: 'One' }), rectOp(2), { type: 'move', ids: [ulid(1)], dx: 5, dy: 5 }] });
      expect(op).toEqual({ ok: true, dim, seq: 2, hash: dimHash(w.log.fold(dim)), attr: dimAttrDigest(w.log.fold(dim)), applied: 3, refused: [] });
      expect(Object.keys(w.log.rows[1]!.payload).sort()).toEqual(['dim', 'ops', 'relayedFor', 'v']);
      const closed = await w.run('dim.close', { dim });
      expect(closed).toMatchObject({ ok: true, already: false, seq: 3, ops: 3, nodes: 2 });
      expect(w.log.rows[2]!.payload).toMatchObject({ v: 1, dim, ops: 3, nodes: 2 });
      const fold = w.log.fold(dim);
      expect([...fold.nodes.values()].map((n) => n.by)).toEqual([{ cls: 'human', principal: HUMAN }, { cls: 'human', principal: HUMAN }]);
      expect(closed.hash).toBe(dimHash(fold));
      expect(w.state()[`idx:${dim.slice(4)}`]).toEqual({ repo: REPO, firstSeq: 1, lastSeq: 3, title: 'Plan', log: w.log.logId });
      expect(w.state().dims).toEqual([dim.slice(4)]);
      // a second close is idempotent: no row
      expect(await w.run('dim.close', { dim })).toMatchObject({ ok: true, already: true, seq: 3 });
      expect(w.log.rows).toHaveLength(3);
    },
    MOD_MS,
  );

  it(
    'hostile ops: every dim-shape refusal code but not-owner is reachable through dim.op, by name, with a fixed sentence and no input; nothing refused is appended',
    async () => {
      const w = await dimRig();
      const dim = dimId(2);
      await w.run('dim.open', { dim, title: 'Hostile', opened: 'menu' });
      expect((await w.run('dim.op', { dim, ops: [rectOp(1), { type: 'add', node: { id: ulid(2), kind: 'frame', x: 0, y: 0, z: 'W', w: 5, h: 5 } }] })).applied).toBe(2);
      const MARK = 'zzhostilezz';
      const cases: Array<[string, unknown]> = [
        ['op-unknown', { type: MARK }],
        ['op-not-available', { type: 'lock', ids: [ulid(1)] }],
        ['op-not-available', { type: 'clear', scope: 'all' }],
        ['kind-unknown', rectOp(10, { kind: 'Bad Kind' })],
        ['kind-not-core', rectOp(10, { kind: 'acme:thing' })],
        ['field-unknown', rectOp(10, { by: { cls: 'human', principal: MARK } })],
        ['field-unknown', rectOp(10, { relayedFor: { principal: MARK, surface: 'gui' } })],
        ['field-unknown', rectOp(10, { link: `https://${MARK}.example` })],
        ['field-unknown', { ...rectOp(10), [MARK]: 1 }],
        ['field-missing', { type: 'add', node: { id: ulid(10), kind: 'rect', x: 0, y: 0, z: 'V', w: 1 } }],
        ['field-type', rectOp(10, { x: MARK })],
        ['field-range', rectOp(10, { x: 2_000_000_000 })],
        ['id-bad', rectOp(10, { id: MARK })],
        ['id-exists', rectOp(1)],
        ['id-missing', { type: 'delete', id: ulid(99) }],
        ['z-bad', rectOp(10, { z: 'V0' })],
        ['colour-bad', rectOp(10, { color: '#ff0000' })],
        ['ref-bad', rectOp(10, { refs: [`sym:${MARK} with space`] })],
        ['ref-scheme', rectOp(10, { refs: [`https:${MARK}`] })],
        ['ref-too-long', rectOp(10, { refs: [`sym:${'a'.repeat(130)}`] })],
        ['ref-count', rectOp(10, { refs: Array.from({ length: 9 }, (_, i) => `sym:a${i}`) })],
        ['link-missing', { type: 'add', node: { id: ulid(10), kind: 'arrow', x: 0, y: 0, z: 'V', points: [0, 0, 1, 1], from: ulid(98) } }],
        ['parent-bad', rectOp(10, { parent: ulid(1) })],
        ['secret', rectOp(10, { label: 'password = hunter2hunter2' })],
      ];
      const seen = new Set<string>();
      for (const [code, op] of cases) {
        const res = await w.run('dim.op', { dim, ops: [op] });
        expect([code, res.ok, res.code, res.refused?.map((r) => r.code)]).toEqual([code, false, code === 'secret' ? 'secret' : 'ops-refused', [code]]);
        // a refusal is a code and fixed sentences: nothing the caller sent comes back
        expect([code, JSON.stringify(res).includes(MARK), JSON.stringify(res).includes('hunter2')]).toEqual([code, false, false]);
        for (const r of res.refused ?? []) seen.add(r.code);
      }
      const many = await w.run('dim.op', { dim, ops: Array.from({ length: 65 }, (_, i) => rectOp(100 + i)) });
      expect([many.code, many.refused?.map((r) => [r.index, r.code])]).toEqual(['ops-refused', [[-1, 'too-many-ops']]]);
      seen.add('too-many-ops');
      expect([...seen].sort()).toEqual(DIM_REFUSAL_CODES.filter((c) => c !== 'not-owner').sort());
      // ops that are not a list, and prototype keys nested in ops, are refused by the validator, never spread
      for (const ops of [undefined, null, 'x', { 0: rectOp(10) }]) expect([(await w.run('dim.op', { dim, ops })).refused?.map((r) => r.code)]).toEqual([['field-type']]);
      const proto = (await w.h.relayCommand({ name: DIMENSION, commandId: 'dim.op', args: JSON.parse(`{"dim":"${dim}","focus":{"hsid":"${A}"},"ops":[{"type":"add","node":{"id":"${ulid(10)}","kind":"rect","x":1,"y":1,"z":"V","w":1,"h":1,"__proto__":{"label":"${MARK}"},"constructor":{"prototype":1}}}]}`), ...GUI })) as Res;
      expect([proto.ok, proto.refused?.map((r) => r.code)]).toEqual([false, ['field-unknown', 'field-unknown']]);
      // a secret in one op refuses the whole batch, and a mixed batch appends only what passed
      expect(await w.run('dim.op', { dim, ops: [rectOp(11), rectOp(12, { label: 'password = hunter2hunter2' })] })).toMatchObject({ ok: false, code: 'secret', refused: [{ index: 1, code: 'secret', rule: 'generic-secret' }] });
      const before = w.log.rows.length;
      expect(before).toBe(2);
      const mixed = await w.run('dim.op', { dim, ops: [rectOp(13), rectOp(1), { type: MARK }] });
      expect(mixed).toMatchObject({ ok: true, applied: 1, refused: [{ index: 1, code: 'id-exists' }, { index: 2, code: 'op-unknown' }] });
      expect(w.log.rows).toHaveLength(3);
      expect((w.log.rows[2]!.payload.ops as unknown[]).length).toBe(1);
      expect(JSON.stringify(w.log.rows).includes(MARK)).toBe(false);
      expect(JSON.stringify(w.log.rows).includes('hunter2')).toBe(false);
    },
    MOD_MS,
  );

  it(
    'closed args: an unknown argument, a bad dim, a bad opened value and an unknown command are refused by code before anything is read or written',
    async () => {
      const w = await dimRig();
      const dim = dimId(3);
      const code = async (commandId: string, args: Record<string, unknown>, hsid: string | null = A): Promise<string | undefined> => {
        const res = await w.run(commandId, args, hsid);
        expect(res.ok).toBe(false);
        expect(Object.keys(res).sort()).toEqual(['code', 'fix', 'ok']);
        return res.code;
      };
      expect(await code('dim.open', { dim, title: 'T', opened: 'command', extra: 1 })).toBe('args-bad');
      expect(await code('dim.open', { dim, title: 'T', opened: 'command', titleFrom: 'agent' })).toBe('args-bad');
      expect(await code('dim.op', { dim, ops: [], title: 'T' })).toBe('args-bad');
      expect(await code('dim.close', { dim, ops: 3, nodes: 9 })).toBe('args-bad'); // counts are never a caller's
      expect(await code('dim.attach', { dim, hsid2: B })).toBe('args-bad');
      for (const bad of [undefined, 7, 'dim:nope', dim.toLowerCase(), `${dim}x`, ['x'], { id: dim }]) expect([bad, await code('dim.open', { dim: bad, title: 'T', opened: 'command' })]).toEqual([bad, 'dim-bad']);
      for (const bad of [undefined, 'button', 'Command', 7]) expect([bad, await code('dim.open', { dim, title: 'T', opened: bad })]).toEqual([bad, 'opened-bad']);
      // no session named, a session that is not live, and a client-supplied hsid/repo (the host strips them): no session
      expect(await code('dim.open', { dim, title: 'T', opened: 'command' }, null)).toBe('no-session');
      expect(await code('dim.open', { dim, title: 'T', opened: 'command' }, 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZX')).toBe('no-session');
      expect(await code('dim.open', { dim, title: 'T', opened: 'command', hsid: A, repo: REPO }, null)).toBe('no-session');
      for (const c of ['dim.op', 'dim.attach', 'dim.close']) expect([c, await code(c, c === 'dim.op' ? { dim, ops: [rectOp(1)] } : { dim })]).toEqual([c, 'dim-unknown']);
      expect(w.log.rows).toEqual([]);
      expect(w.state()).toEqual({});
    },
    MOD_MS,
  );

  it(
    'titles: a control character, an invisible character, an over-long title and a secret are refused and append nothing; a session name that cannot be a title falls back to the fixed word',
    async () => {
      const w = await dimRig();
      let n = 10;
      const open = (title: unknown, more: Record<string, unknown> = {}) => w.run('dim.open', { dim: dimId(++n), ...(title === undefined ? {} : { title }), opened: 'command', ...more });
      expect((await open(undefined)).code).toBe('title-missing');
      for (const t of ['a\u0007b', 'a\u200bb', 'line\nbreak', 'x'.repeat(121), '  ', 9]) expect([t, (await open(t)).code]).toEqual([t, 'title-bad']);
      const secret = await open('password = hunter2hunter2');
      expect([secret.code, JSON.stringify(secret).includes('hunter2')]).toEqual(['title-secret', false]);
      expect(w.log.rows).toEqual([]);
      // B2: a session's name is used only if it passes titleProblem, else the fixed word
      expect(await open('password = hunter2hunter2', { titleFrom: 'session' })).toMatchObject({ ok: true, title: 'Board' });
      expect(await open('tab\there', { titleFrom: 'session' })).toMatchObject({ ok: true, title: 'Board' });
      expect(await open(undefined, { titleFrom: 'session' })).toMatchObject({ ok: true, title: 'Board' });
      expect(await open('Auth handoff', { titleFrom: 'session' })).toMatchObject({ ok: true, title: 'Auth handoff' });
      expect(w.log.rows.map((r) => r.payload.title)).toEqual(['Board', 'Board', 'Board', 'Auth handoff']);
      expect(JSON.stringify(w.log.rows).includes('hunter2')).toBe(false);
    },
    MOD_MS,
  );

  it(
    'reopen, ended and attach: a reopen row carries no title; an ended dimension refuses ops until reopened; attach is idempotent, capped at 16 and needs the dimension\'s repo; an unattached session cannot open, draw or close',
    async () => {
      const w = await dimRig();
      const dim = dimId(20);
      await w.run('dim.open', { dim, title: 'First', opened: 'command' });
      // B: same repo, not attached yet
      for (const c of ['dim.open', 'dim.op', 'dim.close']) expect([c, (await w.run(c, c === 'dim.open' ? { dim, title: 'Steal', opened: 'menu' } : c === 'dim.op' ? { dim, ops: [rectOp(1)] } : { dim }, B)).code]).toEqual([c, 'not-attached']);
      // C: another repo
      for (const c of ['dim.open', 'dim.attach', 'dim.op', 'dim.close']) expect([c, (await w.run(c, c === 'dim.open' ? { dim, title: 'Steal', opened: 'menu' } : c === 'dim.op' ? { dim, ops: [rectOp(1)] } : { dim }, C)).code]).toEqual([c, 'repo-mismatch']);
      expect(w.log.rows).toHaveLength(1);
      expect(await w.run('dim.attach', { dim }, B)).toMatchObject({ ok: true, already: false, seq: 2 });
      expect(w.log.rows[1]).toMatchObject({ kind: DIM_KINDS.attach, payload: { v: 1, dim, hsid: B, relayedFor: { surface: 'gui' } } });
      expect(await w.run('dim.attach', { dim }, B)).toMatchObject({ ok: true, already: true, seq: 2 });
      expect(await w.run('dim.attach', { dim }, A)).toMatchObject({ ok: true, already: true });
      expect(w.log.rows).toHaveLength(2);
      expect((await w.run('dim.op', { dim, ops: [rectOp(1)] }, B)).ok).toBe(true);
      // close, then ops are refused until a reopen; the reopen row has no title even when one is sent
      await w.run('dim.close', { dim });
      expect((await w.run('dim.op', { dim, ops: [rectOp(2)] })).code).toBe('dim-ended');
      const again = await w.run('dim.open', { dim, title: 'Renamed', opened: 'menu' }, B);
      expect(again).toMatchObject({ ok: true, created: false, title: 'First', firstSeq: 1, seq: 5 });
      expect(w.log.rows[4]!.payload).toEqual({ v: 1, dim, attached: [B], opened: 'menu', relayedFor: { principal: HUMAN, connId: GUI.connId, surface: 'gui' } });
      expect((await w.run('dim.op', { dim, ops: [rectOp(2)] })).ok).toBe(true);
      const fold = w.log.fold(dim);
      expect([fold.title, fold.attached, fold.ended, fold.nodes.size]).toEqual(['First', [A, B], false, 2]);
      expect(again.hash).toBe(dimHash(foldDim(w.log.dimRows(), 5)));
    },
    MOD_MS,
  );

  it(
    'caps: the 513th dimension and the 17th attached session are refused before any append; a row the host would refuse for size is refused by the mod first',
    async () => {
      const dim = dimId(30);
      const w = await dimRig({
        seed: (file) => {
          fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
          fs.writeFileSync(file, JSON.stringify({ log: FAKE_LOG_ID, dims: Array.from({ length: 511 }, (_, i) => ulid(i, '01JD1S')) }), { mode: 0o600 });
        },
      });
      expect((await w.run('dim.open', { dim, title: 'The 512th', opened: 'command' })).ok).toBe(true);
      expect((w.state().dims as string[]).length).toBe(512);
      expect((await w.run('dim.open', { dim: dimId(31), title: 'One too many', opened: 'command' })).code).toBe('dim-cap');
      expect(w.log.rows).toHaveLength(1);
      // 4,096 point values fit DIM_LIMITS.points but not one row (16 KiB, 4,096 keys and elements)
      const big = await w.run('dim.op', { dim, ops: [{ type: 'add', node: { id: ulid(1), kind: 'stroke', x: 0, y: 0, z: 'V', points: Array.from({ length: 4096 }, (_, i) => i) } }] });
      expect(big).toMatchObject({ ok: false, code: 'row-too-large' });
      const wide = await w.run('dim.op', { dim, ops: Array.from({ length: 8 }, (_, i) => ({ type: 'add', node: { id: ulid(10 + i), kind: 'text', x: 0, y: 0, z: 'V', text: 'w'.repeat(3000) } })) });
      expect(wide).toMatchObject({ ok: false, code: 'row-too-large' });
      expect(w.log.rows).toHaveLength(1);
      expect((await w.run('dim.op', { dim, ops: [rectOp(1)] })).ok).toBe(true);
    },
    MOD_MS,
  );

  it(
    'the attached list is capped at 16',
    async () => {
      const sessions = Array.from({ length: 17 }, (_, i) => `hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZ${String(i).padStart(2, '0')}`);
      const r = modRig();
      cleanups.push(r.cleanup);
      installDimension(r);
      const log = fakeLog();
      const { h } = host(r, { launcher: unsandboxedModLauncher }, { kernelCall: log.kernelCall, callTimeoutMs: 30_000, focusRepo: (hsid) => (sessions.includes(hsid) ? REPO : null) });
      cleanups.push(() => h.stopAll());
      await h.start(DIMENSION);
      const run = async (commandId: string, args: Record<string, unknown>, hsid: string): Promise<Res> => (await h.relayCommand({ name: DIMENSION, commandId, args: { ...args, focus: { hsid } }, ...GUI })) as Res;
      const dim = dimId(40);
      await run('dim.open', { dim, title: 'Crowd', opened: 'command' }, sessions[0]!);
      for (let i = 1; i < 16; i++) expect((await run('dim.attach', { dim }, sessions[i]!)).ok).toBe(true);
      expect(await run('dim.attach', { dim }, sessions[16]!)).toMatchObject({ ok: false, code: 'attach-cap' });
      expect(log.rows).toHaveLength(16);
      expect(log.fold(dim).attached).toHaveLength(16);
    },
    MOD_MS,
  );

  it(
    'state and the fold change only after the append returns a seq: a failed append leaves the store byte-identical, and the next op lands on the unchanged fold',
    async () => {
      const w = await dimRig();
      const dim = dimId(50);
      w.log.failAppends = 1;
      expect(await w.run('dim.open', { dim, title: 'Never', opened: 'command' })).toMatchObject({ ok: false, code: 'append-failed' });
      expect([w.log.rows.length, fs.existsSync(w.stateFile)]).toEqual([0, false]);
      await w.run('dim.open', { dim, title: 'Kept', opened: 'command' });
      await w.run('dim.op', { dim, ops: [rectOp(1)] });
      const before = fs.readFileSync(w.stateFile);
      w.log.failAppends = 3;
      expect((await w.run('dim.op', { dim, ops: [rectOp(2)] })).code).toBe('append-failed');
      expect((await w.run('dim.attach', { dim }, B)).code).toBe('append-failed');
      expect((await w.run('dim.close', { dim })).code).toBe('append-failed');
      expect(fs.readFileSync(w.stateFile).equals(before)).toBe(true);
      expect(w.log.rows).toHaveLength(2);
      // had the fold moved, id 2 would now be `id-exists`, B would be attached and the dimension ended
      expect(await w.run('dim.op', { dim, ops: [rectOp(2)] })).toMatchObject({ ok: true, seq: 3, applied: 1 });
      expect((await w.run('dim.op', { dim, ops: [rectOp(3)] }, B)).code).toBe('not-attached');
      expect((await w.run('dim.close', { dim })).hash).toBe(dimHash(w.log.fold(dim)));
    },
    MOD_MS,
  );

  it(
    'tool.call with no host-known caller is refused not-agent-tool and appends nothing (Aegis A3)',
    async () => {
      const w = await dimRig();
      // S1.4: a call with no host-known caller is nobody's: refused before anything is read
      for (const tool of ['dim-view', 'dim-draw']) expect(await w.h.callTool(DIMENSION, tool, { dim: dimId(1), ops: [rectOp(1)] })).toMatchObject({ ok: false, code: 'not-agent-tool' });
      expect(w.log.rows).toEqual([]);
      expect(w.state()).toEqual({});
    },
    MOD_MS,
  );
});

describe('#dimension-mod keyframes and the cold open (S1.3; G-DDL-01)', () => {
  it(
    'a keyframe is written at close and every 256 ops; a restarted mod opens from it and pages log.read from the keyframe\'s seq to the log head; the hash equals a full fold',
    async () => {
      const w = await dimRig();
      const dim = dimId(60);
      const id = dim.slice(4);
      await w.run('dim.open', { dim, title: 'Frames', opened: 'command' });
      let n = 0;
      const batch = (size: number) => Array.from({ length: size }, () => rectOp(++n, { label: `n${n}` }));
      for (let i = 0; i < 3; i++) await w.run('dim.op', { dim, ops: batch(64) });
      expect(w.state()[`kf:${id}`]).toBeUndefined();
      w.log.pad(25_000); // rows of other writers
      await w.run('dim.op', { dim, ops: batch(64) });
      const head = w.state()[`kf:${id}`] as { seq: number; hash: string; n: number };
      expect([head.seq, head.n, head.hash]).toEqual([w.log.rows.at(-1)!.seq, 1, dimHash(w.log.fold(dim))]);
      for (const k of Object.keys(w.state())) expect(Buffer.byteLength(JSON.stringify(w.state()[k]))).toBeLessThanOrEqual(64 * 1024);
      await w.run('dim.op', { dim, ops: [...batch(3), { type: 'delete', id: ulid(1) }] });
      w.log.pad(25_000);
      await w.restart();
      w.log.reads.length = 0;
      const re = await w.run('dim.open', { dim, opened: 'menu' });
      expect(re).toMatchObject({ ok: true, created: false, title: 'Frames' });
      expect(re.hash).toBe(dimHash(w.log.fold(dim)));
      // one page that names the log, then pages of the four kinds from the keyframe's seq to the LOG HEAD (Aegis M1:
      // no `until`, the index is only a hint). The fake scans 10,000 rows a page, as the kernel does: 25,000 padded
      // rows and a few of the mod's own are three pages.
      expect(w.log.reads[0]).toEqual({ until: 0, limit: 1 });
      expect(w.log.reads[1]).toEqual({ since: { logId: w.log.logId, seq: head.seq }, kinds: [DIM_KINDS.start, DIM_KINDS.attach, DIM_KINDS.op, DIM_KINDS.end, DIM_AUX_KINDS.grant], limit: 1000 });
      expect(w.log.reads.slice(1).every((p) => p.until === undefined && (p.since as { seq: number }).seq >= head.seq)).toBe(true);
      expect(w.log.reads).toHaveLength(1 + 3);
      // the fold from the keyframe keeps authorship, deleted ids and counters: a deleted id is still refused
      expect((await w.run('dim.op', { dim, ops: [rectOp(1)] })).refused?.map((r) => r.code)).toEqual(['id-exists']);
      const closed = await w.run('dim.close', { dim });
      expect([closed.ops, closed.nodes, closed.hash]).toEqual([260, 258, dimHash(w.log.fold(dim))]);
      expect((w.state()[`kf:${id}`] as { seq: number }).seq).toBe(closed.seq);
    },
    MOD_MS,
  );

  it(
    'a corrupted keyframe is ignored and rebuilt: the cold open folds from the first row instead, the hash is unchanged, and the next close writes a good one',
    async () => {
      const w = await dimRig();
      const dim = dimId(61);
      const id = dim.slice(4);
      await w.run('dim.open', { dim, title: 'Damaged', opened: 'command' });
      await w.run('dim.op', { dim, ops: [rectOp(1), rectOp(2), rectOp(3)] });
      await w.run('dim.close', { dim });
      const good = w.state();
      const truth = dimHash(w.log.fold(dim));
      const damage: Array<(s: Record<string, unknown>) => void> = [
        (s) => void ((s[`kf:${id}:0`] as unknown[][])[0]![2] = { id: ulid(1), kind: 'rect', x: 999, y: 1, z: 'V', w: 10, h: 10 }), // a moved node
        (s) => void ((s[`kf:${id}:0`] as unknown[][])[0]![3] = { cls: 'agent', principal: 'p:evil/x', agent: 'evil' }), // a forged hand
        (s) => void ((s[`kf:${id}`] as { meta: { attached: string[] } }).meta.attached = [A, C]), // a forged attach
        (s) => void delete s[`kf:${id}:0`], // a missing chunk
        (s) => void (s[`kf:${id}`] = 'not a head'),
      ];
      for (const [i, hurt] of damage.entries()) {
        await w.h.stop(DIMENSION);
        const s = JSON.parse(JSON.stringify(good)) as Record<string, unknown>;
        hurt(s);
        fs.writeFileSync(w.stateFile, JSON.stringify(s));
        await w.h.start(DIMENSION);
        w.log.reads.length = 0;
        const re = await w.run('dim.open', { dim, opened: 'menu' });
        expect([i, re.ok, re.hash === truth || re.hash === dimHash(w.log.fold(dim))]).toEqual([i, true, true]);
        // no keyframe was trusted: the read starts before the first row
        expect([i, w.log.reads[1]!.since]).toEqual([i, undefined]);
        // C was never attached, whatever the damaged head said
        expect([i, (await w.run('dim.op', { dim, ops: [rectOp(50 + i)] }, C)).code]).toEqual([i, 'repo-mismatch']);
        const closed = await w.run('dim.close', { dim });
        expect([i, closed.hash]).toEqual([i, dimHash(w.log.fold(dim))]);
        const head = w.state()[`kf:${id}`] as { seq: number; hash: string };
        expect([i, head.seq, head.hash]).toEqual([i, closed.seq, closed.hash]);
      }
    },
    MOD_MS,
  );

  it(
    'keyframes are kept for the 4 most recent dimensions only, and a dimension without one still opens cold from its rows',
    async () => {
      const w = await dimRig();
      const dims = Array.from({ length: 6 }, (_, i) => dimId(70 + i));
      for (const [i, dim] of dims.entries()) {
        await w.run('dim.open', { dim, title: `D${i}`, opened: 'command' });
        await w.run('dim.op', { dim, ops: [rectOp(i + 1)] });
        await w.run('dim.close', { dim });
      }
      const heads = Object.keys(w.state()).filter((k) => /^kf:[0-9A-Z]{26}$/.test(k)).sort();
      expect(heads).toEqual(dims.slice(2).map((d) => `kf:${d.slice(4)}`).sort());
      expect(Object.keys(w.state()).filter((k) => k.startsWith(`kf:${dims[0]!.slice(4)}`))).toEqual([]);
      expect((w.state().kfs as Array<{ id: string }>).map((e) => e.id)).toEqual(dims.slice(2).map((d) => d.slice(4)));
      await w.restart();
      const re = await w.run('dim.open', { dim: dims[0]!, opened: 'menu' });
      expect(re.hash).toBe(dimHash(w.log.fold(dims[0]!)));
      expect(validateDimOps(w.log.fold(dims[0]!), [rectOp(1)], { cls: 'human', principal: HUMAN }).refused.map((r) => r.code)).toEqual(['id-exists']);
    },
    MOD_MS,
  );
});

describe('#dimension-mod: the log is the truth, the index a hint (Aegis S1.3 M1, M2, L1, L2, L4)', () => {
  const model = async () => (await import(pathToFileURL(path.join(DIMENSION_TREE, 'model.mjs')).href)) as Record<string, (...a: unknown[]) => unknown>;
  /** Stop the mod, rewrite its store as a crash would have left it, start it again. */
  const crash = async (w: Awaited<ReturnType<typeof dimRig>>, edit: (s: Record<string, unknown>) => void): Promise<void> => {
    await w.h.stop(DIMENSION);
    const s = w.state();
    edit(s);
    fs.writeFileSync(w.stateFile, JSON.stringify(s));
    await w.h.start(DIMENSION);
  };
  const dropKf = (s: Record<string, unknown>, id: string): void => {
    for (const k of Object.keys(s)) if (k.startsWith(`kf:${id}`)) delete s[k];
    s.kfs = [];
  };

  it(
    'M1 close, then a crash before the index write: the cold open folds to the log head, so dim.op is refused dim-ended, the index is healed and the hash equals a full replay',
    async () => {
      const w = await dimRig();
      const dim = dimId(80);
      const id = dim.slice(4);
      await w.run('dim.open', { dim, title: 'Lag', opened: 'command' });
      await w.run('dim.op', { dim, ops: [rectOp(1), rectOp(2)] });
      const closed = await w.run('dim.close', { dim });
      expect(closed.seq).toBe(3);
      // the end row is in the log; the index still names the row before it, and no keyframe was written
      await crash(w, (s) => {
        (s[`idx:${id}`] as { lastSeq: number }).lastSeq = 2;
        dropKf(s, id);
      });
      expect(await w.run('dim.op', { dim, ops: [rectOp(3)] })).toMatchObject({ ok: false, code: 'dim-ended' });
      expect(w.log.rows).toHaveLength(3);
      expect((w.state()[`idx:${id}`] as { lastSeq: number }).lastSeq).toBe(3);
      const re = await w.run('dim.open', { dim, opened: 'menu' });
      expect(re.hash).toBe(dimHash(w.log.fold(dim)));
      // the same lag with a keyframe from BEFORE the lost rows: the fold still reaches the head
      await w.run('dim.op', { dim, ops: [rectOp(3)] });
      const again = await w.run('dim.close', { dim });
      const kfAtClose = JSON.parse(JSON.stringify(w.state())) as Record<string, unknown>;
      await w.run('dim.open', { dim, opened: 'menu' });
      await w.run('dim.op', { dim, ops: [rectOp(4)] });
      const last = await w.run('dim.close', { dim });
      await crash(w, (s) => {
        for (const k of Object.keys(s)) delete s[k];
        Object.assign(s, kfAtClose); // the store as it stood at the earlier close: index and keyframe both behind the log
      });
      expect((await w.run('dim.op', { dim, ops: [rectOp(5)] })).code).toBe('dim-ended');
      const final = await w.run('dim.open', { dim, opened: 'menu' });
      expect([again.seq! < last.seq!, final.hash]).toEqual([true, dimHash(w.log.fold(dim))]);
      expect(w.log.fold(dim).nodes.size).toBe(4);
    },
    MOD_MS,
  );

  it(
    'M1 delete, then a crash before the index write: an update of the deleted mark is refused id-missing and nothing is appended; the hash equals a full replay',
    async () => {
      const w = await dimRig();
      const dim = dimId(81);
      const id = dim.slice(4);
      await w.run('dim.open', { dim, title: 'Lag 2', opened: 'command' });
      await w.run('dim.op', { dim, ops: [rectOp(1), rectOp(2)] });
      expect(await w.run('dim.op', { dim, ops: [{ type: 'delete', id: ulid(1) }] })).toMatchObject({ ok: true, seq: 3 });
      await crash(w, (s) => void ((s[`idx:${id}`] as { lastSeq: number }).lastSeq = 2));
      const upd = await w.run('dim.op', { dim, ops: [{ type: 'update', id: ulid(1), patch: { label: 'ghost' } }] });
      expect([upd.code, upd.refused?.map((r) => r.code)]).toEqual(['ops-refused', ['id-missing']]);
      expect((await w.run('dim.op', { dim, ops: [rectOp(1)] })).refused?.map((r) => r.code)).toEqual(['id-exists']);
      expect(w.log.rows).toHaveLength(3);
      expect((await w.run('dim.close', { dim })).hash).toBe(dimHash(w.log.fold(dim)));
    },
    MOD_MS,
  );

  it(
    'M1 an append whose reply is lost: the mod forgets its fold, so the next command reads the log and sees the row that landed',
    async () => {
      const w = await dimRig();
      const dim = dimId(82);
      await w.run('dim.open', { dim, title: 'Lost reply', opened: 'command' });
      w.log.loseReplies = 1;
      expect((await w.run('dim.op', { dim, ops: [rectOp(1)] })).code).toBe('append-failed');
      expect(w.log.rows).toHaveLength(2); // the row is in the log although the mod was told it failed
      expect((await w.run('dim.op', { dim, ops: [rectOp(1)] })).refused?.map((r) => r.code)).toEqual(['id-exists']);
      expect((await w.run('dim.close', { dim })).hash).toBe(dimHash(w.log.fold(dim)));
    },
    MOD_MS,
  );

  it('M2 ops too large for one row are refused before the validator is called (counted); small ops reach it once', async () => {
    const m = await model();
    const human = { cls: 'human', principal: HUMAN };
    let calls = 0;
    const validate = (...a: unknown[]): unknown => {
      calls += 1;
      return (validateDimOps as (...x: unknown[]) => unknown)(...a);
    };
    const state = emptyDimState('dim:x');
    const hostile: unknown[][] = [
      [rectOp(1, { refs: Array.from({ length: 5000 }, (_, i) => `a${i}`) })], // thousands of short strings
      [{ type: 'update', id: ulid(1), patch: Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`k${i}`, 'v'])) }],
      Array.from({ length: 64 }, (_, i) => rectOp(i, { label: 'x'.repeat(300) })), // over 16 KiB together
      [rectOp(1, { label: 'y'.repeat(20_000) })],
      [JSON.parse(`${'{"a":'.repeat(40)}1${'}'.repeat(40)}`)], // nested past 32
    ];
    for (const ops of hostile) {
      const r = m.apply!(state, ops, human, { validate }) as { ok: unknown[]; tooLarge: boolean; next: unknown };
      expect([r.tooLarge, r.ok, r.next === state]).toEqual([true, [], true]);
    }
    expect(calls).toBe(0);
    const ok = m.apply!(state, [rectOp(1)], human, { validate }) as { ok: unknown[]; tooLarge: boolean };
    expect([calls, ok.tooLarge, ok.ok.length]).toEqual([1, false, 1]);
    // ops that are not a list are the validator's to refuse by name
    expect((m.apply!(state, 'nope', human, { validate }) as { refused: Array<{ code: string }> }).refused.map((r) => r.code)).toEqual(['field-type']);
  });

  it(
    'M2 through the mod: an op whose node carries thousands of short strings is refused row-too-large and appends nothing',
    async () => {
      const w = await dimRig();
      const dim = dimId(83);
      await w.run('dim.open', { dim, title: 'Wide', opened: 'command' });
      const res = await w.run('dim.op', { dim, ops: [rectOp(1, { refs: Array.from({ length: 5000 }, (_, i) => `a${i}`) })] });
      expect(res).toEqual({ ok: false, code: 'row-too-large', fix: expect.any(String) });
      expect(w.log.rows).toHaveLength(1);
    },
    MOD_MS,
  );

  it('L1 a keyframe is bound to its log: it decodes under the log it was written for and under no other, and the sum covers the log id', async () => {
    const m = await model();
    const state = foldDim([
      { seq: 1, kind: DIM_KINDS.start, payload: { v: 1, dim: 'dim:x', title: 't', attached: [A], opened: 'menu', relayedFor: { principal: HUMAN, surface: 'gui' } } },
      { seq: 2, kind: DIM_KINDS.op, payload: { v: 1, dim: 'dim:x', ops: [rectOp(1)], relayedFor: { principal: HUMAN, surface: 'gui' } } },
    ]);
    const enc = m.encodeKeyframe!(state, 'log:a') as { head: Record<string, unknown>; chunks: unknown[] };
    expect(enc.head.log).toBe('log:a');
    expect(dimHash((m.decodeKeyframe!(enc.head, enc.chunks, 'dim:x', 'log:a') as { state: DimState }).state)).toBe(dimHash(state));
    for (const log of ['log:b', '', undefined, null]) expect([log, m.decodeKeyframe!(enc.head, enc.chunks, 'dim:x', log)]).toEqual([log, null]);
    // a head re-labelled for another log no longer sums
    expect(m.decodeKeyframe!({ ...enc.head, log: 'log:b' }, enc.chunks, 'dim:x', 'log:b')).toBeNull();
    // a keyframe with no log (written before this rule) is not trusted
    const { log: _log, ...old } = enc.head;
    expect(m.decodeKeyframe!(old, enc.chunks, 'dim:x', 'log:a')).toBeNull();
  });

  it(
    'L1 creating a dimension drops any keyframe left under its id',
    async () => {
      const dim = dimId(84);
      const id = dim.slice(4);
      const w = await dimRig({
        seed: (file) => {
          fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
          fs.writeFileSync(file, JSON.stringify({ log: FAKE_LOG_ID, [`kf:${id}`]: { v: 1, log: FAKE_LOG_ID, seq: 9, hash: 'sha256:x', n: 2, bytes: 10, meta: {}, sum: 'sha256:y' }, [`kf:${id}:0`]: [['g', 'x']], [`kf:${id}:1`]: [['g', 'y']], kfs: [{ id, bytes: 10 }] }), { mode: 0o600 });
        },
      });
      expect((await w.run('dim.open', { dim, title: 'Fresh', opened: 'command' })).created).toBe(true);
      expect(Object.keys(w.state()).filter((k) => k.startsWith('kf:'))).toEqual([]);
      await w.run('dim.op', { dim, ops: [rectOp(1)] });
      await w.restart();
      expect((await w.run('dim.open', { dim, opened: 'menu' })).hash).toBe(dimHash(w.log.fold(dim)));
    },
    MOD_MS,
  );

  it(
    'L2 a dimension whose start row landed but whose index did not is ADOPTED from the log: no second titled start row, the first row\'s repo holds, and it counts once',
    async () => {
      const w = await dimRig();
      const dim = dimId(85);
      const id = dim.slice(4);
      await w.run('dim.open', { dim, title: 'First', opened: 'command' });
      await w.run('dim.op', { dim, ops: [rectOp(1)] });
      await crash(w, (s) => {
        for (const k of Object.keys(s)) delete s[k]; // neither idx nor dims was written
      });
      // another repo's session cannot re-create it under its own repo and title
      expect(await w.run('dim.open', { dim, title: 'Stolen', opened: 'command' }, C)).toMatchObject({ ok: false, code: 'repo-mismatch' });
      expect(w.log.rows).toHaveLength(2);
      expect(w.state()[`idx:${id}`]).toEqual({ repo: REPO, firstSeq: 1, lastSeq: 2, title: 'First', log: FAKE_LOG_ID });
      expect(w.state().dims).toEqual([id]);
      // its own session reopens it: a start row with NO title
      const re = await w.run('dim.open', { dim, title: 'Second', opened: 'menu' });
      expect(re).toMatchObject({ ok: true, created: false, title: 'First', firstSeq: 1, seq: 3 });
      expect(w.log.rows[2]!.payload.title).toBeUndefined();
      expect(re.hash).toBe(dimHash(w.log.fold(dim)));
      // the same for the other commands after a second loss: dim.op adopts too
      await crash(w, (s) => {
        for (const k of Object.keys(s)) delete s[k];
      });
      expect(await w.run('dim.op', { dim, ops: [rectOp(2)] })).toMatchObject({ ok: true, seq: 4 });
      expect(w.state().dims).toEqual([id]);
    },
    MOD_MS,
  );

  it(
    'L2 an index written for another log is pruned once: its ids stop counting toward the cap, and their index entries and keyframes are removed',
    async () => {
      const stale = Array.from({ length: 512 }, (_, i) => ulid(i, '01JD1S'));
      const w = await dimRig({
        seed: (file) => {
          fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
          const s: Record<string, unknown> = { log: 'log:01JD1M0LD00000000000000001', dims: stale, kfs: [{ id: stale[0], bytes: 9 }], [`kf:${stale[0]}`]: { v: 1, n: 1 }, [`kf:${stale[0]}:0`]: [['g', 'x']] };
          for (const id of stale.slice(0, 3)) s[`idx:${id}`] = { repo: REPO, firstSeq: 1, lastSeq: 5, title: 'Old', log: 'log:01JD1M0LD00000000000000001' };
          fs.writeFileSync(file, JSON.stringify(s), { mode: 0o600 });
        },
      });
      const dim = dimId(86);
      // 512 stale ids would have refused this as dim-cap for good
      expect(await w.run('dim.open', { dim, title: 'New log', opened: 'command' })).toMatchObject({ ok: true, created: true });
      const s = w.state();
      expect([s.dims, s.log, s.kfs]).toEqual([[dim.slice(4)], FAKE_LOG_ID, []]);
      expect(Object.keys(s).sort()).toEqual(['dims', `idx:${dim.slice(4)}`, 'kfs', 'log', 'opens'].sort());
      // a stale id is unknown under this log, not served from an old index
      expect((await w.run('dim.op', { dim: `dim:${stale[0]}`, ops: [rectOp(1)] })).code).toBe('dim-unknown');
    },
    MOD_MS,
  );

  it('L4 the negative pin: the dimension tree with one byte changed and publisher still gnomon is refused (publisher gnomon is first-party only)', () => {
    const r = modRig();
    cleanups.push(r.cleanup);
    const copy = path.join(r.root, 'src', 'gnomon.dimension');
    fs.cpSync(DIMENSION_TREE, copy, { recursive: true });
    fs.appendFileSync(path.join(copy, 'model.mjs'), ' ');
    expect(hashSourceTree(copy, DIMENSION, () => undefined).packageHash).not.toBe(hashSourceTree(DIMENSION_TREE, DIMENSION, () => undefined).packageHash);
    expect(isFirstPartyPin(hashSourceTree(copy, DIMENSION, () => undefined).packageHash)).toBe(false);
    expect(() => stageInstall({ home: r.home, source: copy, via: 'package', requestedBy: 'p:abcdefgh/cli', trust: r.auth })).toThrow(/publisher gnomon is first-party only/);
    // the untouched tree stages (and is first-party by its pin)
    const ok = stageInstall({ home: r.home, source: DIMENSION_TREE, via: 'package', requestedBy: 'p:abcdefgh/cli', trust: r.auth });
    expect(ok.state === 'staged' && ok.record.detail.tier).toBe('first-party');
  });
});
