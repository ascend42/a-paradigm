// @gnomon-platform: darwin, linux
/**
 * #folder-picker (TD-2026-10-23-162; G-FLD-01..G-FLD-03): request.folder.choose | .check | .recent.
 *
 *   - G-FLD-01: dispatcher-only human requests (gui or device connection): never a row, no contract id moves, and
 *     every other class is refused with nothing appended.
 *   - G-FLD-02: choose opens the chooser with a FIXED prompt (caller text never reaches AppleScript: startIn is an
 *     argv item), one at a time (busy), {cancelled} on cancel or timeout, refused no-chooser off macOS.
 *   - G-FLD-03: check is read-only and classifies; recent is newest first, deduplicated, missing dropped, at most 6.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { type PrincipalKind } from '@a-company/gnomon-contracts';
import { DEV_TEST_ROOT_ACK, DevTestRootAuthority, RootVerifier, loadDeviceKey, mintReadToken, readRegistry, registerDevice, registerKernelKey, writeNewDeviceKey } from '../src/kernel/identity/index.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/index.js';
import { connectGnomon, type DeviceCredential, type GnomonSession, type RpcResponseFrame, type ServerKeyPin } from '../src/kernel/socket/index.js';
import { startDaemonForTest } from '../src/kernel/testing.js';
import { CHECK_BURST, CHOOSER_PROMPTS, FOLDER_RECENT_MAX, FolderPicker, checkFolder, chooserArgs, displayOf, homePlace, pathRefusal, type ChooserRun, type FolderAsker } from '../src/kernel/folders/folders.js';
import { tempHome } from './daemon-helpers.js';
import { PKG_ROOT } from './helpers.js';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const K = 'p:00000000/kernel';
const GUI: FolderAsker = { connId: 'conn:1', principal: 'p:00000000/founder', principalClass: 'human', credential: 'gui' };

/** A throwaway user home with projects, a file, a runner tree and an unreadable folder. */
function fixtureHome(): { home: string; outside: string } {
  const t = tempHome('gf-');
  cleanups.push(t.cleanup);
  const home = path.join(t.home, 'u');
  for (const d of ['code/a-paradigm', 'code/a-atelier', 'code/runner/dist', 'code/mod', 'locked']) fs.mkdirSync(path.join(home, d), { recursive: true });
  fs.writeFileSync(path.join(home, 'code/runner/dist/cli.js'), '');
  fs.writeFileSync(path.join(home, 'code/mod/gnomon-manifest.json'), '{}');
  fs.writeFileSync(path.join(home, 'notes.pdf'), 'x');
  fs.writeFileSync(path.join(home, 'tool.sh'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(home, 'plain.txt'), 'x', { mode: 0o644 });
  fs.chmodSync(path.join(home, 'locked'), 0o000);
  cleanups.push(() => fs.chmodSync(path.join(home, 'locked'), 0o755));
  const outside = path.join(t.home, 'elsewhere');
  fs.mkdirSync(outside);
  return { home: fs.realpathSync(home), outside: fs.realpathSync(outside) };
}

describe('folder.check: read-only classification (G-FLD-03)', () => {
  it('classifies ok, ~ expansion, not-absolute, missing, file, unreadable, home, outside-home, wrong-contents + suggest, and the file kind', async () => {
    const { home, outside } = fixtureHome();
    const c = (p: string, o: { kind?: 'folder' | 'file'; expect?: string } = {}) => checkFolder(p, { home, ...o });
    expect(await c('~/code/a-paradigm')).toMatchObject({ ok: true, why: 'ok', real: path.join(home, 'code/a-paradigm'), display: '~/code/a-paradigm', name: 'a-paradigm', home: 'inside' });
    expect(await c('code/a-paradigm')).toMatchObject({ ok: false, why: 'not-absolute' });
    expect(await c(path.join(home, 'nope'))).toMatchObject({ ok: false, why: 'missing', display: '~/nope' });
    expect(await c(path.join(home, 'notes.pdf'))).toMatchObject({ ok: false, why: 'file', display: '~/notes.pdf' });
    if (process.getuid?.() !== 0) expect(await c(path.join(home, 'locked'))).toMatchObject({ ok: false, why: 'unreadable' });
    expect(await c('~')).toMatchObject({ ok: true, why: 'home', home: 'home-or-above', display: '~' });
    expect(await c(path.dirname(home))).toMatchObject({ ok: true, why: 'home', home: 'home-or-above' });
    expect(await c(outside)).toMatchObject({ ok: true, why: 'outside-home', home: 'outside' });
    expect(await c('~/code/runner', { expect: 'cli.js' })).toMatchObject({ ok: false, why: 'wrong-contents', expectFound: false, suggest: { real: path.join(home, 'code/runner/dist'), display: '~/code/runner/dist' } });
    expect(await c('~/code/runner/dist', { expect: 'cli.js' })).toMatchObject({ ok: true, expectFound: true });
    expect(await c('~/code/a-paradigm', { expect: 'gnomon-manifest.json' })).toMatchObject({ ok: false, why: 'wrong-contents' });
    expect((await c('~/code/a-paradigm', { expect: 'gnomon-manifest.json' })).suggest).toBeUndefined();
    expect(await c('~/tool.sh', { kind: 'file' })).toMatchObject({ ok: true, why: 'ok', name: 'tool.sh' });
    expect(await c('~/plain.txt', { kind: 'file' })).toMatchObject({ ok: false, why: 'not-executable' });
    expect(await c('~/code', { kind: 'file' })).toMatchObject({ ok: false, why: 'not-a-file' });
  });
  it('display is ~-shortened and escaped (the ONE rule); a symlink resolves to its real folder', async () => {
    const { home } = fixtureHome();
    expect(displayOf(`${home}/a\nb`, home)).toBe('~/a\\u{a}b');
    expect(displayOf('/elsewhere/x', home)).toBe('/elsewhere/x');
    expect(homePlace('/', home)).toBe('home-or-above');
    fs.symlinkSync(path.join(home, 'code/a-paradigm'), path.join(home, 'link'));
    expect(await checkFolder('~/link', { home })).toMatchObject({ ok: true, real: path.join(home, 'code/a-paradigm'), display: '~/code/a-paradigm' });
  });
  it('the verb: human gui/device only, closed payload, rate-limited', async () => {
    const { home } = fixtureHome();
    let t = 0;
    const f = new FolderPicker({ kernelPrincipal: K, userHome: home, clock: () => t });
    for (const a of [{ ...GUI, principalClass: 'agent' }, { ...GUI, credential: 'read-token' }, { ...GUI, principalClass: 'voice' }, { ...GUI, principalClass: 'session' }, { ...GUI, principalClass: 'mod' }]) await expect(f.check(a, { path: '/' })).rejects.toThrow(/human's/);
    await expect(f.check(GUI, { path: '/', prompt: 'x' })).rejects.toThrow(/unknown field/);
    await expect(f.check(GUI, { path: '' })).rejects.toThrow(/path is a string/);
    await expect(f.check(GUI, { path: '/', expect: '../etc/passwd' })).rejects.toThrow(/expect is one of/);
    for (let i = 0; i < CHECK_BURST; i++) await f.check(GUI, { path: '~' });
    await expect(f.check({ ...GUI, credential: 'device' }, { path: '~' })).rejects.toThrow(/too many checks/);
    await expect(f.recent(GUI, {})).rejects.toThrow(/too many checks/); // recent shares the limiter
    t += 10_001;
    expect((await f.check(GUI, { path: '~' })).why).toBe('home');
  });
});

describe('folder.choose: the kernel opens the macOS chooser (G-FLD-02)', () => {
  it('the prompt is fixed by purpose; startIn is only ever an argv item, never AppleScript source', () => {
    const evil = '/tmp/x" & (do shell script "touch /tmp/pwned") & "';
    const args = chooserArgs('folder', 'session', evil);
    const script = args.filter((_, i) => args[i - 1] === '-e').join('\n');
    expect(script).toContain(`with prompt "${CHOOSER_PROMPTS.session}"`);
    expect(script).toContain('POSIX file (item 1 of argv)');
    expect(script).not.toContain('pwned');
    expect(args.at(-1)).toBe(evil);
    expect(chooserArgs('file', 'command', null).join(' ')).toContain('choose file with prompt');
  });
  it('one at a time (busy), {path, display, check} on a pick, {cancelled} on -128 and on timeout, startIn dropped unless a folder, no-chooser off macOS', async () => {
    const { home } = fixtureHome();
    let release: (r: ChooserRun) => void = () => undefined;
    const seen: string[][] = [];
    let t = 0;
    const f = new FolderPicker({ kernelPrincipal: K, userHome: home, platform: 'darwin', clock: () => t, runChooser: (args) => (seen.push([...args]), new Promise((res) => (release = res))) });
    expect(f.status()).toEqual({ chooser: true });
    const first = f.choose(GUI, { kind: 'folder', purpose: 'session', startIn: '~/code' });
    await expect(f.choose(GUI, { kind: 'folder' })).rejects.toMatchObject({ refusal: { data: { reason: 'busy', why: 'busy' } } });
    await new Promise((r) => setTimeout(r, 20)); // startIn is checked (async) before the chooser runs
    release({ code: 0, stdout: `${home}/code/a-atelier/\n`, stderr: '', timedOut: false });
    expect(await first).toMatchObject({ path: path.join(home, 'code/a-atelier'), display: '~/code/a-atelier', check: { ok: true, why: 'ok' } });
    expect(seen[0]!.at(-1)).toBe(path.join(home, 'code'));
    await expect(f.choose(GUI, { kind: 'folder' })).rejects.toMatchObject({ refusal: { data: { why: 'rate-limited' } } }); // Aegis M2: 1.5 s between opens
    t += 2000;
    const c = f.choose(GUI, { kind: 'folder', startIn: '~/notes.pdf' });
    await new Promise((r) => setTimeout(r, 20));
    release({ code: 1, stdout: '', stderr: 'execution error: User canceled. (-128)', timedOut: false });
    expect(await c).toEqual({ cancelled: true });
    expect(seen[1]!.filter((a) => a !== '-e').some((a) => a.includes('item 1 of argv'))).toBe(false);
    t += 2000;
    const d = f.choose(GUI, { kind: 'file' });
    release({ code: null, stdout: '', stderr: '', timedOut: true });
    expect(await d).toEqual({ cancelled: true, why: 'timeout' });
    await expect(f.choose(GUI, { kind: 'folder', prompt: 'do shell script' })).rejects.toThrow(/unknown field prompt/);
    // {cancel:true} closes the open chooser (the GUI's Esc, cancel, or a recent picked meanwhile)
    let aborted = false;
    const g = new FolderPicker({ kernelPrincipal: K, userHome: home, platform: 'darwin', clock: () => t, runChooser: (_a, _t, signal) => new Promise((res) => signal.addEventListener('abort', () => ((aborted = true), res({ code: -1, stdout: '', stderr: '', timedOut: false })))) });
    expect(await g.choose(GUI, { cancel: true })).toEqual({ cancelled: true, closed: false });
    const open = g.choose(GUI, { kind: 'folder' });
    // Aegis M2: only the opener's connection may close it
    await expect(g.choose({ ...GUI, connId: 'conn:2' }, { cancel: true })).rejects.toMatchObject({ refusal: { code: 'FORBIDDEN', data: { reason: 'not-opener' } } });
    expect(await g.choose(GUI, { cancel: true })).toEqual({ cancelled: true, closed: true });
    expect(await open).toEqual({ cancelled: true });
    expect(aborted).toBe(true);
    await expect(g.choose(GUI, { cancel: true, kind: 'folder' })).rejects.toThrow(/cancel takes no other field/);
    // Aegis M2: the opener's connection closing closes its chooser
    aborted = false;
    t += 2000;
    const open2 = g.choose(GUI, { kind: 'folder' });
    g.connectionClosed('conn:other');
    expect(aborted).toBe(false);
    g.connectionClosed(GUI.connId);
    expect(await open2).toEqual({ cancelled: true });
    expect(aborted).toBe(true);
    // at most six opens a minute
    const n = new FolderPicker({ kernelPrincipal: K, userHome: home, platform: 'darwin', clock: () => t, runChooser: async () => ({ code: 1, stdout: '', stderr: '(-128)', timedOut: false }) });
    for (let i = 0; i < 6; i++) {
      t += 2000;
      expect(await n.choose(GUI, { kind: 'folder' })).toEqual({ cancelled: true });
    }
    t += 2000;
    await expect(n.choose(GUI, { kind: 'folder' })).rejects.toMatchObject({ refusal: { data: { why: 'rate-limited', retryAfterMs: expect.any(Number) } } });
    // Aegis L3: '__proto__' or 'toString' is never a purpose
    for (const purpose of ['__proto__', 'toString', 'constructor']) await expect(n.choose(GUI, { kind: 'folder', purpose })).rejects.toThrow(/purpose is/);
    await expect(f.choose(GUI, { kind: 'folder', purpose: 'command' })).rejects.toThrow(/purpose is/);
    await expect(f.choose({ ...GUI, principalClass: 'agent' }, { kind: 'folder' })).rejects.toThrow(/human's/);
    const w = new FolderPicker({ kernelPrincipal: K, userHome: home, platform: 'win32', runChooser: () => Promise.reject(new Error('never')) });
    expect(w.status()).toEqual({ chooser: false });
    await expect(w.choose(GUI, { kind: 'folder' })).rejects.toMatchObject({ refusal: { code: 'UNSUPPORTED', data: { reason: 'no-chooser' } } });
  });
});

describe('Aegis M1 / M3 / L5: no fs call can stall the kernel; shares and devices are refused first; win32 home', () => {
  it('automount and share paths are refused before any fs call; win32 UNC and device paths too', async () => {
    const { home } = fixtureHome();
    for (const p of ['/net/server/x', '/Network/Servers/x', '//net/x', '/NET']) expect(await checkFolder(p, { home, platform: 'darwin' }), p).toMatchObject({ ok: false, why: 'network', real: '' });
    for (const [p, why] of [['\\\\server\\share', 'network'], ['//server/share', 'network'], ['\\\\?\\C:\\x', 'device'], ['\\\\.\\PhysicalDrive0', 'device'], ['//?/C:/x', 'device']] as const) expect(pathRefusal(p, 'win32'), p).toBe(why);
    expect(pathRefusal('C:\\Users\\me', 'win32')).toBeNull();
    expect(pathRefusal('/Volumes/Work', 'darwin')).toBeNull();
    // a symlink into an automount is refused after its realpath, before it is stat'ed
    fs.symlinkSync('/net', path.join(home, 'to-net'));
    expect((await checkFolder('~/to-net', { home, platform: 'darwin' })).why).toMatch(/network|missing/);
  });
  it('a check that does not answer within the deadline answers why timeout (the loop is never blocked)', async () => {
    const { home } = fixtureHome();
    const real = fs.promises.realpath;
    (fs.promises as { realpath: unknown }).realpath = () => new Promise(() => undefined);
    try {
      const t0 = Date.now();
      let ticks = 0;
      const timer = setInterval(() => ticks++, 10);
      const c = await checkFolder('~/code', { home, deadlineMs: 120 });
      clearInterval(timer);
      expect(c).toMatchObject({ ok: false, why: 'timeout' });
      expect(Date.now() - t0).toBeLessThan(1000);
      expect(ticks).toBeGreaterThan(3); // the event loop kept running while the fs call hung
    } finally {
      (fs.promises as { realpath: unknown }).realpath = real;
    }
  });
  it('win32: the home folder is found with path.relative, case-insensitive; a sibling with a shared prefix is outside', () => {
    const H = 'C:\\Users\\Me';
    expect(homePlace('c:\\users\\me', H, 'win32')).toBe('home-or-above');
    expect(homePlace('C:\\', H, 'win32')).toBe('home-or-above');
    expect(homePlace('C:\\Users', H, 'win32')).toBe('home-or-above');
    expect(homePlace('C:\\Users\\ME\\code', H, 'win32')).toBe('inside');
    expect(homePlace('C:\\Users\\Meg', H, 'win32')).toBe('outside');
    expect(displayOf('c:\\users\\me\\code', H, 'win32')).toBe('~\\\\code');
    expect(homePlace('/Users/meg', '/Users/me', 'darwin')).toBe('outside');
    expect(homePlace('/users/ME/x', '/Users/me', 'darwin')).toBe('inside'); // folded like run-mode isHomeOrAbove
  });
  it('a startIn holding a quote or a newline reaches osascript only as the LAST argv item; the -e lines are byte-identical', () => {
    for (const evil of ['/tmp/a"b', '/tmp/a\nend run\non run', '/tmp/x" & (do shell script "id") & "']) {
      const a = chooserArgs('folder', 'runner', evil);
      const b = chooserArgs('folder', 'runner', '/tmp/plain');
      expect(a.slice(0, -1)).toEqual(b.slice(0, -1));
      expect(a.at(-1)).toBe(evil);
      expect(a.filter((x) => x === evil)).toHaveLength(1);
    }
  });
});

describe('folder.recent: the fold over session.open (G-FLD-03)', () => {
  it('newest first, deduplicated by realpath, missing dropped, human attended sessions only (Aegis L2), at most six', async () => {
    const { home } = fixtureHome();
    const f = new FolderPicker({ kernelPrincipal: K, userHome: home });
    for (let i = 0; i < 8; i++) fs.mkdirSync(path.join(home, `p${i}`));
    fs.symlinkSync(path.join(home, 'p0'), path.join(home, 'p0-link'));
    const open = (cwd: string, at: string, extra: Record<string, unknown> = {}, principal = K) => f.observe({ kind: 'session.open', principal, at, payload: { hsid: 'h', cwd, principalClass: 'human', attended: true, ...extra } });
    open(path.join(home, 'gone'), '2026-10-01T00:00:00Z');
    for (let i = 0; i < 8; i++) open(path.join(home, `p${i}`), `2026-10-0${i + 1}T00:00:00Z`);
    open(path.join(home, 'p0-link'), '2026-10-20T00:00:00Z');
    open(path.join(home, 'code/a-paradigm'), '2026-10-21T00:00:00Z', { principalClass: 'agent' });
    open(path.join(home, 'code/a-atelier'), '2026-10-21T00:00:00Z', {}, 'p:00000000/founder');
    open(path.join(home, 'code/runner'), '2026-10-22T00:00:00Z', { attended: false });
    open(path.join(home, 'code/mod'), '2026-10-22T00:00:00Z', { principalClass: undefined });
    open('/net/server/share', '2026-10-23T00:00:00Z');
    const r = (await f.recent(GUI, {})).recent;
    expect(r).toHaveLength(FOLDER_RECENT_MAX);
    expect(r[0]).toEqual({ real: path.join(home, 'p0'), display: '~/p0', repoName: 'p0', lastUsedAt: '2026-10-20T00:00:00Z' });
    expect(r.map((x) => x.repoName)).toEqual(['p0', 'p7', 'p6', 'p5', 'p4', 'p3']);
    await expect(f.recent(GUI, { all: true })).rejects.toThrow(/takes \{\}/);
  });
});

describe('the wire: dispatcher-only, no contract id moves (G-FLD-01)', () => {
  it('clientApiId equals its pin and no folder kind is a §9.1 request kind (never a row)', async () => {
    const { CLIENT_API_ID, KIT_ID } = await import('@a-company/gnomon-contracts');
    const { HUMAN_REQUEST_KINDS } = await import('../src/kernel/socket/log-append.js');
    const { FOLDER_REQUESTS } = await import('../src/kernel/folders/folders.js');
    const pins = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, '..', 'gnomon-contracts', 'schemas', 'client-api.ids.json'), 'utf8')) as { clientApiId: string; kitId: string };
    expect({ clientApiId: CLIENT_API_ID, kitId: KIT_ID }).toEqual({ clientApiId: pins.clientApiId, kitId: pins.kitId });
    for (const k of FOLDER_REQUESTS) expect(HUMAN_REQUEST_KINDS).not.toContain(k);
  });

  it('a human device gets status.folders and the three answers; agent, mod and voice are refused; nothing is appended', async () => {
    const { home: userHome } = fixtureHome();
    const t = tempHome('gfd-');
    cleanups.push(t.cleanup);
    const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    const kernel = SoftwareEd25519Signer.generate('kernel');
    registerKernelKey(t.home, root, kernel.publicKeyPem);
    writeNewDeviceKey(t.home);
    const creds = new Map<PrincipalKind, DeviceCredential>();
    for (const kind of ['human', 'agent', 'mod', 'voice', 'session'] as PrincipalKind[]) {
      const file = path.join(t.home, 'keys', `${kind}.key`);
      const key = writeNewDeviceKey(t.home, file);
      const e = registerDevice(t.home, root, { host: `host-${kind}`, name: `n-${kind}`, publicKeyPem: key.publicKeyPem, principalKind: kind });
      creds.set(kind, { principalId: e.principalId, deviceId: e.deviceId, signer: loadDeviceKey(t.home, file) });
    }
    const d = await startDaemonForTest({ home: t.home, idleMs: 60_000, kernelSigner: kernel, rootAuthority: root }, { supervisor: { userHome }, folders: { platform: 'darwin', runChooser: async () => ({ code: 0, stdout: `${userHome}/code/mod\n`, stderr: '', timedOut: false }) } });
    cleanups.push(() => d.shutdown('signal'));
    const reg = readRegistry(t.home, new RootVerifier(root.publicKeyPem));
    const pin: ServerKeyPin = { keyId: kernel.keyId, publicKeyPem: reg.kernelKeys.get(kernel.keyId)! };
    const as = async (kind: PrincipalKind): Promise<GnomonSession> => {
      const s = await connectGnomon({ socketPath: d.pidfile.socketPath, client: { name: 'gnomon-test', version: '0.0.0', surface: 'cli' }, serverKey: pin, device: creds.get(kind)! });
      cleanups.push(() => s.conn.close());
      return s;
    };
    const ok = (f: RpcResponseFrame): Record<string, unknown> => {
      if ('error' in f) throw new Error(`refused: ${JSON.stringify(f.error)}`);
      return f.result as Record<string, unknown>;
    };
    await d.log.append({ kind: 'session.open', principal: d.kernelPrincipal, session: 'hsid:v1:01JABCDEFGHJKMNPQRSTVWXYZ0', payload: { hsid: 'hsid:v1:01JABCDEFGHJKMNPQRSTVWXYZ0', by: creds.get('human')!.principalId, cwd: path.join(userHome, 'code/a-paradigm'), backend: 'claude-code', principalClass: 'human', attended: true } });
    const before = d.log.head().seq;
    const h = await as('human');
    expect(ok(await h.conn.call('status')).folders).toEqual({ chooser: true });
    expect(ok(await h.conn.call('log.append', { kind: 'request.folder.recent', payload: {} })).recent).toEqual([expect.objectContaining({ display: '~/code/a-paradigm', repoName: 'a-paradigm' })]);
    expect(ok(await h.conn.call('log.append', { kind: 'request.folder.check', payload: { path: '~/code/mod', expect: 'gnomon-manifest.json' } }))).toMatchObject({ ok: true, why: 'ok', display: '~/code/mod' });
    expect(ok(await h.conn.call('log.append', { kind: 'request.folder.choose', payload: { kind: 'folder', purpose: 'mod' } }))).toMatchObject({ display: '~/code/mod', check: { ok: true } });
    const extra = await h.conn.call('log.append', { kind: 'request.folder.check', payload: { path: '/' }, extra: 1 });
    expect('error' in extra && extra.error.data.code).toBe('BAD_REQUEST');
    for (const cls of ['agent', 'mod', 'voice', 'session'] as const) {
      const s = await as(cls);
      const st = await s.conn.call('status');
      if (!('error' in st)) expect((st.result as Record<string, unknown>).folders, cls).toBeUndefined();
      for (const kind of ['request.folder.choose', 'request.folder.check', 'request.folder.recent']) {
        const f = await s.conn.call('log.append', { kind, payload: { kind: 'folder', path: '/' } });
        expect('error' in f && f.error.data.code, `${cls} ${kind}`).toBe('FORBIDDEN');
      }
    }
    // Aegis L6: the human's read token and a mod's kernel.call (callAs) are refused too
    const m = mintReadToken(t.home, root, { principalId: creds.get('human')!.principalId, ttlMs: 60_000 });
    const rt = await connectGnomon({ socketPath: d.pidfile.socketPath, client: { name: 'gnomon-test', version: '0.0.0', surface: 'cli' }, serverKey: pin, readToken: m.token });
    cleanups.push(() => rt.conn.close());
    for (const kind of ['request.folder.choose', 'request.folder.check', 'request.folder.recent']) {
      const f = await rt.conn.call('log.append', { kind, payload: { kind: 'folder', path: '/' } });
      expect('error' in f && f.error.data.code, `read-token ${kind}`).toBe('FORBIDDEN');
      await expect(d.dispatcher.callAs(`p:${root.ns}/mod-x`, 'log.append', { kind, payload: { kind: 'folder', path: '/' } }), `mod ${kind}`).rejects.toMatchObject({ refusal: { code: 'FORBIDDEN' } });
    }
    const db = new DatabaseSync(path.join(t.home, 'kernel.db'), { readOnly: true });
    const kinds = (db.prepare('SELECT kind FROM chain WHERE seq > ? ORDER BY seq').all(before) as Array<{ kind: string }>).map((x) => x.kind);
    db.close();
    expect(kinds.length).toBeGreaterThan(0); // the connections' own socket rows
    expect(kinds.filter((k) => k.startsWith('request.folder') || k.startsWith('folder.'))).toEqual([]);
  });
});
