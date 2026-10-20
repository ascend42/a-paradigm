/**
 * #mod-host test rig (M1.11): writes a probe mod (manifest + index.mjs + the
 * vendored SDK runtime), installs it through the real card path
 * (stageInstall → decideInstallCard with bound presence) and builds a host
 * over a real DaemonChildren.
 */
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEV_TEST_ROOT_ACK, DevTestRootAuthority } from '../src/kernel/identity/root-authority.js';
import { DaemonChildren } from '../src/kernel/lifecycle/children.js';
import { processControlFor } from '../src/kernel/lifecycle/process-control.js';
import { appendGrantRow, MANIFEST_FILE, readStaged, removeTree, stageInstall, type ManifestV2 } from '../src/kernel/manifest/index.js';
import { installPresenceBinding } from '../src/kernel/manifest/install.js';
import { createModHostForTest, decideInstallCard, mintTestPresence } from '../src/kernel/testing.js';
import type { ModHostOptions, ModHostSeams } from '../src/kernel/modhost/host.js';
import { PKG_ROOT } from './helpers.js';

export const SDK_RUNTIME = path.resolve(PKG_ROOT, '..', 'gnomon-mod-sdk', 'dist', 'runtime.js');
export const EXAMPLE_MOD = path.resolve(PKG_ROOT, '..', 'gnomon-mod-sdk', 'example', 'hello');

export const PROBE_SOURCE = `
import * as fs from 'node:fs';
import * as net from 'node:net';
import { serveMod } from './gnomon-mod-sdk.mjs';
const attempt = async (f) => { try { const v = await f(); return { ok: true, v: v === undefined ? null : String(v).slice(0, 64) }; } catch (e) { return { ok: false, code: e && (e.code || e.message) } } };
let held = null;
let kept = null;
const run = async (input, api) => {
  if (input.op === 'keep') { kept = api; return { ok: true, v: 'kept' }; }
  if (input.op === 'stale') return attempt(() => kept.state.set('k', 9));
  if (input.op === 'stale.get') return attempt(async () => JSON.stringify(await kept.state.get('k')));
  if (input.op === 'state.set') return attempt(() => api.state.set('k', input.value ?? 1));
  if (input.op === 'state.get') return attempt(async () => JSON.stringify(await api.state.get('k')));
  if (input.op === 'approve') return attempt(() => api.kernel('approve', {}));
  if (input.op === 'append') return attempt(async () => JSON.stringify(await api.kernel('log.append', { kind: 'modns.probe.done' })));
  if (input.op === 'send') return attempt(async () => JSON.stringify(await api.kernel('session.send', input.params ?? {})));
  if (input.op === 'fs.read') return attempt(() => fs.readFileSync(input.path, 'utf8'));
  if (input.op === 'fs.write') return attempt(() => fs.writeFileSync(input.path, 'x'));
  if (input.op === 'symlink') return attempt(() => fs.symlinkSync(input.target, input.path));
  if (input.op === 'rename') return attempt(() => fs.renameSync(input.from, input.to));
  if (input.op === 'net') return attempt(() => new Promise((res, rej) => { const s = net.connect({ host: input.host, port: input.port }); s.once('connect', () => { s.destroy(); res('connected'); }); s.once('error', rej); }));
  if (input.op === 'egress') return attempt(async () => { const s = await api.egress(input.host, 443); s.destroy(); return 'tunnel'; });
  if (input.op === 'hold') return attempt(async () => { held = await api.egress(input.host, 443); held.on('error', () => {}); return 'held'; });
  if (input.op === 'held') return { ok: true, v: held ? String(held.destroyed || held.readableEnded) : 'none' };
  if (input.op === 'link') return attempt(() => fs.linkSync(input.from, input.to));
  if (input.op === 'flood') { const rs = await Promise.allSettled(Array.from({ length: 40 }, () => api.state.get('k'))); return { ok: rs.filter((x) => x.status === 'fulfilled').length, busy: rs.filter((x) => x.status === 'rejected').length }; }
  if (input.op === 'aloop') { let n = 0; for (let i = 0; i < (input.n ?? 1000); i++) { try { await api.kernel(input.verb ?? 'approve', {}); } catch { n++; } } return { refused: n }; }
  if (input.op === 'kflood') { const rs = await Promise.allSettled(Array.from({ length: 20 }, () => api.kernel('status', {}))); return { ok: rs.filter((x) => x.status === 'fulfilled').length, busy: rs.filter((x) => x.status === 'rejected').length }; }
  if (input.op === 'hang') return new Promise(() => {});
  if (input.op === 'crash') process.exit(3);
  return null;
};
serveMod({
  views: { 'probe.view': async (input) => input && input.raw ? input.raw : ({ schemaVersion: 'display-block:v1', type: 'Text', text: 'hi' }) },
  commands: { 'probe.who': async (_a, ctx) => ({ relayedFor: ctx.relayedFor ?? null }) },
  tools: {
    'probe.read': (input, _c, api) => run(input, api),
    'probe.write': (input, _c, api) => run(input.op ? input : { op: 'state.set', value: 2 }, api),
    'probe.net': (input, _c, api) => run(input.op ? input : { op: 'egress', host: input.host }, api),
    'probe.spend': (input, _c, api) => run(input, api),
  },
});
`;

export function probeManifest(over: Partial<ManifestV2> = {}): ManifestV2 {
  return {
    manifest: 2,
    kind: 'mod',
    publisher: 'acme',
    name: 'probe',
    version: '1.0.0',
    abi: 'mod-abi:v1',
    provides: {
      tools: [
        { name: 'probe.read', effects: ['read'] },
        { name: 'probe.write', effects: ['read', 'write'] },
        { name: 'probe.net', effects: ['network'] },
        { name: 'probe.spend', effects: ['read', 'spend'] },
      ],
      views: [{ id: 'probe.view', slot: 'panel', placement: 'append' }],
      commands: [{ id: 'probe.who', title: 'Who acted' }],
      events: ['modns.acme.probe.done'],
    },
    requires: { capabilities: ['log.append:modns.acme.probe.*'], egress: [{ host: 'api.example.com', purpose: 'test' }] },
    ...over,
  };
}

export function writeModFolder(dir: string, m: unknown, source = PROBE_SOURCE): string {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, MANIFEST_FILE), JSON.stringify(m, null, 2));
  fs.writeFileSync(path.join(dir, 'index.mjs'), source);
  fs.copyFileSync(SDK_RUNTIME, path.join(dir, 'gnomon-mod-sdk.mjs'));
  return dir;
}

export interface Rig {
  root: string;
  home: string;
  auth: DevTestRootAuthority;
  events: Array<{ kind: string; payload: Record<string, unknown> }>;
  cleanup: () => Promise<void>;
}

export function rig(): Rig {
  // short realpath'd root: SBPL matches resolved paths
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gmod-')));
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { mode: 0o700 });
  const events: Rig['events'] = [];
  return { root, home, auth: new DevTestRootAuthority(DEV_TEST_ROOT_ACK), events, cleanup: async () => removeTree(root) };
}

/** Stage + decide the install card (the human path), plus the egress grant when asked. */
export function install(r: Rig, folder: string, opts: { via?: 'package' | 'linked'; egress?: string[] } = {}): { manifestHash: string; packageHash: string } {
  const st = stageInstall({ home: r.home, source: folder, via: opts.via ?? 'package', requestedBy: 'p:abcdefgh/s-01hzzzzz', trust: r.auth });
  if (st.state !== 'staged') throw new Error('expected staged');
  const bind = installPresenceBinding(st.cardId, readStaged(r.home, st.record.detail.name, st.cardId)!.card.contentHash, 'install');
  decideInstallCard(r.home, st.record.detail.name, st.cardId, 'install', { presenceToken: mintTestPresence('mod.install', { bind }), authority: r.auth });
  const d = st.record.detail;
  appendGrantRow(r.home, r.auth, { kind: 'grant.capability', manifestHash: d.manifestHash, capabilities: ['log.append:modns.acme.probe.*', 'log.append:modns.example.hello.*'] });
  if (opts.egress) appendGrantRow(r.home, r.auth, { kind: 'grant.egress', manifestHash: d.manifestHash, hosts: opts.egress });
  return { manifestHash: d.manifestHash, packageHash: d.packageHash };
}

export function host(r: Rig, seams: ModHostSeams = {}, over: Partial<ModHostOptions> = {}) {
  const children = new DaemonChildren({ append: async (kind, payload) => void r.events.push({ kind, payload }), control: processControlFor(), boot: 'test', graceMs: 1_000 });
  const h = createModHostForTest({ home: r.home, trust: r.auth, children, emit: (kind, payload) => r.events.push({ kind, payload }), callTimeoutMs: 3_000, cancelGraceMs: 500, ...over }, seams);
  return { h, children };
}

/** A stub mod for the capability falsifiers and K3: it keeps the last view input and every fed event, and returns them from `<name>.seen`. */
export const ECHO_SOURCE = (name: string): string => `
import { serveMod } from './gnomon-mod-sdk.mjs';
const seen = [];
let last = null;
serveMod({
  onEvent: (e) => { if (seen.length < 1000) seen.push(e); },
  views: { '${name}.echo': async (input) => { last = input === undefined ? null : input; return { schemaVersion: 'display-block:v1', type: 'Text', text: 'echo' }; } },
  commands: { '${name}.seen': async () => ({ seen, last }) },
});
`;

/** Install (stage + decide the card, the human path) a stub mod `name` requiring `capabilities`; no egress. */
export function installStub(r: Rig, id: string, capabilities: string[]): void {
  // S0b: `id` is a mod id; a bare name installs as acme.<name>
  const [publisher, name] = id.includes('.') ? (id.split('.') as [string, string]) : ['acme', id];
  const m = { manifest: 2, kind: 'mod', publisher, name, version: '1.0.0', abi: 'mod-abi:v1', provides: { views: [{ id: `${name}.echo`, slot: 'sidebar', placement: 'append' }], commands: [{ id: `${name}.seen`, title: 'What it saw' }] }, requires: { capabilities, egress: 'none' } };
  const src = writeModFolder(path.join(r.root, 'src', name), m, ECHO_SOURCE(name));
  const st = stageInstall({ home: r.home, source: src, via: 'package', requestedBy: 'p:abcdefgh/cli', trust: r.auth });
  if (st.state !== 'staged') throw new Error(`expected staged, got ${JSON.stringify(st)}`);
  const bind = installPresenceBinding(st.cardId, readStaged(r.home, st.record.detail.name, st.cardId)!.card.contentHash, 'install');
  decideInstallCard(r.home, name, st.cardId, 'install', { presenceToken: mintTestPresence('mod.install', { bind }), authority: r.auth });
}
