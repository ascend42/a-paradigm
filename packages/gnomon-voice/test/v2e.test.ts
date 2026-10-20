/**
 * V2e client: the fd link (gnomon-rpc:v1 over an authenticated socket), run's exit triggers, kernel-speakable
 * consumption, gnomon-voice-io hardening (disclaimed fail-closed, allow-list env, stdin EOF), member-pinned
 * manifests (symlink / unpinned / tamper refusal) and the ⌃⌥M / ⌃⌥A controls. No network, no audio, no models.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { IO_CHILD_STDIO, ioChildEnv, SpawnedAudioIO } from '../src/audio-io.js';
import { FakeAudioIO } from '../src/fake-audio-io.js';
import { FdRpc, GnomonKernelLink, principalFromStatus } from '../src/kernel-link.js';
import { fetchModel, loadManifest, validateManifest, verifiedModelPaths, type FetchLike, type ModelEntry } from '../src/manifest.js';
import { runVoice } from '../src/run.js';
import { kernelSpeakable } from '../src/speakable.js';
import { PRINT_SCHEMA, type VoicePrint } from '../src/speaker.js';
import { toRefusal, VoiceClient, type ClientMode, type Delivery, type Notice } from '../src/voice-client.js';
import { FakeLink, stubEngines } from './stubs.js';

const FAKE_IO = fileURLToPath(new URL('./fixtures/fake-voice-io.mjs', import.meta.url));
const MATT: VoicePrint = { schemaVersion: PRINT_SCHEMA, name: 'matt', model: 'stub', dim: 2, phrases: 3, embedding: [1, 0], createdAt: '2026-10-19T00:00:00Z' };
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

let cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.reverse()) await c();
  cleanups = [];
});
const tmp = (p: string): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), p));
  cleanups.push(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};

/* ── a fake kernel on a unix socket: the server end of the "socketpair" ─────────────────────────────── */

type Handler = (method: string, params: Record<string, unknown>, id: number, write: (o: unknown) => void) => void;
async function fakeKernel(h: Handler): Promise<{ client: net.Socket; server: net.Server; conn: () => net.Socket | undefined; frames: Array<Record<string, unknown>> }> {
  const dir = tmp('gv-k-');
  const sockPath = path.join(dir, 'k.sock');
  const frames: Array<Record<string, unknown>> = [];
  let conn: net.Socket | undefined;
  const server = net.createServer((c) => {
    conn = c;
    let buf = '';
    const write = (o: unknown): void => void c.write(`${JSON.stringify(o)}\n`);
    c.on('data', (d) => {
      buf += d.toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const f = JSON.parse(buf.slice(0, i)) as Record<string, unknown>;
        buf = buf.slice(i + 1);
        frames.push(f);
        h(f.method as string, (f.params ?? {}) as Record<string, unknown>, f.id as number, write);
      }
    });
  });
  await new Promise<void>((r) => server.listen(sockPath, r));
  const client = net.connect(sockPath);
  await new Promise<void>((r) => client.once('connect', () => r()));
  await settle();
  cleanups.push(() => new Promise<void>((r) => (client.destroy(), server.close(() => r()))));
  return { client, server, conn: () => conn, frames };
}
const ok = (id: number, result: unknown) => ({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id, result });
const ev = (params: unknown) => ({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', method: 'event', params });
const STATUS = { voice: { principal: 'p:abcd1234/voice', attached: true, hsid: 'hs:01TEST', voiceSessionId: 'vs:01TEST', ceiling: 'ambient' } };

describe('the fd link: gnomon-rpc:v1 over the authenticated socket', () => {
  it('calls verbs with the kernel framing, maps refusals, and follows from the head (backlog never spoken)', async () => {
    const k = await fakeKernel((method, params, id, write) => {
      if (method === 'status') write(ok(id, STATUS));
      else if (method === 'log.append') write(ok(id, { seq: 41 }));
      else if (method === 'session.send') write({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id, error: { code: -32003, message: 'that is a decision', data: { code: 'FORBIDDEN', data: { reason: 'voice-grammar' } } } });
      else if (method === 'log.read') {
        expect(params).toMatchObject({ follow: true, scope: { hsid: 'hs:01TEST' }, kinds: ['voice.turn.agent'] });
        // the reply and its events in ONE write: the subscription must be bound synchronously
        write(ok(id, { subscription: 'sub1', since: 0, head: 5, logId: 'L' }));
        write(ev({ subscription: 'sub1', row: { seq: 5, kind: 'voice.turn.agent', session: 'hs:01TEST', payload: { source: 'kernel-speakable', items: [{ kind: 'reply', text: 'old' }] } } }));
        write(ev({ subscription: 'sub1', row: { seq: 6, kind: 'voice.turn.agent', session: 'hs:01TEST', payload: { source: 'kernel-speakable', items: [{ kind: 'reply', text: 'new' }] } } }));
        write(ev({ subscription: 'sub1', end: { reason: 'attachment' } }));
      }
    });
    const link = new GnomonKernelLink(new FdRpc(k.client));
    expect(principalFromStatus(await link.status())).toBe('p:abcd1234/voice');
    expect(await link.attachment()).toEqual({ hsid: 'hs:01TEST', voiceSessionId: 'vs:01TEST', mode: 'ambient' });
    expect(await link.append('voice.turn.user', { a: 1 })).toEqual({ seq: 41 });
    const refused = await link.send('hs:01TEST', 'approve it').catch((e: unknown) => e);
    expect(toRefusal(refused)).toMatchObject({ code: 'FORBIDDEN', reason: 'voice-grammar' });
    const rows: number[] = [];
    const ends: string[] = [];
    await link.follow('hs:01TEST', (r) => rows.push(r.seq), (e) => ends.push(e));
    await settle();
    expect(rows).toEqual([6]);
    expect(ends).toEqual(['attachment']);
    expect(k.frames[0]).toMatchObject({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id: 1, method: 'status' });
    expect(k.frames.find((f) => f.method === 'session.send')!.params).toEqual({ hsid: 'hs:01TEST', content: [{ text: 'approve it' }] });
  });

  it('the link closing rejects pending calls and reports close; fromFd refuses stdio descriptors', async () => {
    const k = await fakeKernel(() => undefined);
    const rpc = new FdRpc(k.client);
    const closed: string[] = [];
    rpc.onClose((r) => closed.push(r));
    const pending = rpc.call('status', {});
    await settle();
    k.conn()!.destroy();
    await expect(pending).rejects.toMatchObject({ code: 'CLOSED' });
    expect(closed).toHaveLength(1);
    await expect(rpc.call('status', {})).rejects.toMatchObject({ code: 'CLOSED' });
    expect(() => FdRpc.fromFd(1)).toThrow(/>= 3/);
  });
});

describe('run: exits when the fd closes or stdin ends', () => {
  const boot = async () => {
    const k = await fakeKernel((method, _p, id, write) => {
      if (method === 'status') write(ok(id, STATUS));
      else if (method === 'log.read') write(ok(id, { subscription: 's', head: 0, logId: 'L' }));
      else write(ok(id, {}));
    });
    const audio = new FakeAudioIO();
    const stdin = new PassThrough();
    let client: VoiceClient | undefined;
    const run = runVoice({ link: new GnomonKernelLink(new FdRpc(k.client)), audio, engines: stubEngines(), prints: () => [MATT], stdin, started: (c) => (client = c) });
    for (let i = 0; i < 10 && !client; i++) await settle();
    expect(client?.attachment?.hsid).toBe('hs:01TEST');
    expect(audio.started).toBe(true);
    return { k, audio, stdin, run };
  };
  it('fd close → link-closed, audio closed', async () => {
    const { k, audio, run } = await boot();
    k.conn()!.destroy();
    expect((await run).reason).toBe('link-closed');
    expect(audio.started).toBe(false);
  });
  it('an attachment that lands after the client started is picked up by the status re-read (dogfood 2026-10-19)', async () => {
    let attached = false;
    const k = await fakeKernel((method, _p, id, write) => {
      if (method === 'status') {
        const s = STATUS as { voice: Record<string, unknown> };
        write(ok(id, attached ? s : { ...s, voice: { ...s.voice, attached: false, hsid: null, voiceSessionId: null, ceiling: null } }));
      } else if (method === 'log.read') write(ok(id, { subscription: 's', head: 0, logId: 'L' }));
      else write(ok(id, {}));
    });
    const stdin = new PassThrough();
    let client: VoiceClient | undefined;
    const run = runVoice({ link: new GnomonKernelLink(new FdRpc(k.client)), audio: new FakeAudioIO(), engines: stubEngines(), prints: () => [MATT], stdin, attachPollMs: 20, started: (c) => (client = c) });
    for (let i = 0; i < 10 && !client; i++) await settle();
    expect(client?.attachment).toBeNull();
    attached = true;
    for (let i = 0; i < 50 && !client?.attachment; i++) await new Promise((r) => setTimeout(r, 10));
    expect(client?.attachment?.hsid).toBe('hs:01TEST');
    stdin.end();
    await run;
  });
  it('stdin end → stdin-end, audio closed', async () => {
    const { stdin, audio, run } = await boot();
    stdin.end();
    expect((await run).reason).toBe('stdin-end');
    expect(audio.started).toBe(false);
  });
});

/* ── speakable ─────────────────────────────────────────────────────────────────────────────────────── */

async function setup(o: { mode?: ClientMode; attachMode?: string; delivery?: Delivery } = {}) {
  const audio = new FakeAudioIO();
  const engines = stubEngines();
  const link = new FakeLink();
  if (o.attachMode) link.att = { ...link.att!, mode: o.attachMode };
  const notices: Notice[] = [];
  const client = new VoiceClient({ audio, engines, link, ns: 'abcd1234', prints: () => [MATT], mode: o.mode ?? 'ptt', delivery: o.delivery ?? 'direct', now: () => audio.clock, notice: (n) => notices.push(n) });
  cleanups.push(() => client.close());
  await client.start();
  return { audio, engines, link, client, notices };
}

describe('kernel-speakable rows', () => {
  it('only voice.turn.agent{source:kernel-speakable} items are speakable', () => {
    expect(kernelSpeakable('voice.turn.agent', { source: 'kernel-speakable', turnSeq: 3, items: [{ kind: 'reply', text: '**Done.**' }, { kind: 'ask', text: 'Ship it?' }, { kind: 'edits', text: 'Edited 2 files.' }, { kind: 'diff', text: 'x' }, { kind: 'reply' }] })).toEqual([
      { kind: 'reply', text: 'Done.' },
      { kind: 'ask', text: 'Ship it?' },
      { kind: 'edits', text: 'Edited 2 files.' },
    ]);
    expect(kernelSpeakable('voice.turn.agent', { turnId: 'a1', t0: 1, t1: 2, textPlanned: 'mine', textSpoken: 'mine' })).toEqual([]);
    expect(kernelSpeakable('turn.event', { source: 'kernel-speakable', items: [{ kind: 'reply', text: 'x' }] })).toEqual([]);
  });

  it('the client never speaks turn.event or its own playback rows, says each turnSeq once, and logs its windows without source', async () => {
    const { audio, engines, link, client } = await setup();
    link.row!({ seq: 1, kind: 'turn.event', payload: { line: JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Raw.' }] } }) } });
    link.row!({ seq: 2, kind: 'voice.turn.agent', payload: { turnId: 'a0', t0: 1, t1: 2, textPlanned: 'Mine.', textSpoken: 'Mine.' } });
    link.speakable([{ kind: 'reply', text: 'Once.' }], 7);
    link.speakable([{ kind: 'reply', text: 'Once.' }], 7);
    for (let i = 0; i < 4; i++) {
      await settle();
      audio.tick(1000);
    }
    await client.idle();
    expect(engines.tts.said).toEqual(['Once.']);
    const mine = link.appends.filter((a) => a.kind === 'voice.turn.agent');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.payload).toMatchObject({ textPlanned: 'Once.', textSpoken: 'Once.' });
    expect(mine[0]!.payload).not.toHaveProperty('source');
  });

  it('L4: a play() that throws leaves an echo window, drops the rest, and logs no window row', async () => {
    const { audio, engines, link, client } = await setup();
    audio.play = () => Promise.reject(new Error('device gone'));
    link.speakable([{ kind: 'reply', text: 'One. Two.' }]);
    await settle();
    await client.idle();
    // T-2026-10-19-026 pipelining: 'Two.' was prefetched while 'One.' played, but never played
    expect(engines.tts.said).toEqual(['One.', 'Two.']);
    expect(link.appends.filter((a) => a.kind === 'voice.turn.agent')).toHaveLength(0);
  });
});

/* ── ⌃⌥M / ⌃⌥A ─────────────────────────────────────────────────────────────────────────────────────── */

describe('hotkeys: ⌃⌥M mic, ⌃⌥A ambient within the ceiling', () => {
  it('⌃⌥M toggles the mic locally with a status note', async () => {
    const { audio, notices } = await setup();
    audio.control('mic-toggle');
    await settle();
    expect(audio.micOps).toEqual([false]);
    audio.control('mic-toggle');
    await settle();
    expect(audio.micOps).toEqual([false, true]);
    expect(notices.map((n) => n.text)).toEqual(expect.arrayContaining([expect.stringMatching(/^Mic off/), 'Mic on.']));
  });
  it('⌃⌥A narrows ambient → ptt and re-widens only up to an ambient ceiling', async () => {
    const { audio, client, link } = await setup({ mode: 'ambient', attachMode: 'conversation' });
    expect(client.mode).toBe('ambient');
    audio.control('mode-toggle');
    await settle();
    expect(client.mode).toBe('ptt');
    audio.control('mode-toggle');
    await settle();
    expect(client.mode).toBe('ambient');
    expect(link.appends.filter((a) => a.kind === 'request.voice.report')).toHaveLength(0);
  });
  it('⌃⌥A above a ptt ceiling does nothing but say so and relay a notice for the GUI (request.voice.report)', async () => {
    const { audio, client, link, notices } = await setup({ mode: 'ptt', attachMode: 'ptt' });
    audio.control('mode-toggle');
    await settle();
    expect(client.mode).toBe('ptt');
    expect(notices.at(-1)!.text).toMatch(/Open Gnomon to turn on ambient/);
    expect(link.appends.filter((a) => a.kind === 'request.voice.report')[0]!.payload).toEqual({ notice: { text: expect.stringMatching(/Open Gnomon to turn on ambient/), code: 'ambient-above-ceiling' } });
    expect(link.appends.some((a) => a.kind === 'voice.client.notice')).toBe(false);
    expect(link.appends.some((a) => a.kind.startsWith('voice.session'))).toBe(false);
  });
});

/* ── gnomon-voice-io hardening ─────────────────────────────────────────────────────────────────────── */

describe('gnomon-voice-io hardening', () => {
  const spawned: ChildProcess[] = [];
  afterEach(() => {
    for (const c of spawned.splice(0)) c.kill('SIGKILL');
  });
  const io = (mode?: string, envOut?: { env?: NodeJS.ProcessEnv }) =>
    new SpawnedAudioIO({
      binary: process.execPath,
      args: [FAKE_IO, ...(mode ? [mode] : [])],
      spawnImpl: ((b: string, a: string[], o: { env: NodeJS.ProcessEnv }) => {
        if (envOut) envOut.env = o.env;
        const c = spawn(b, a, o as never);
        spawned.push(c);
        return c;
      }) as never,
    });

  it('fails closed unless info says disclaimed === true', async () => {
    await expect(io('no-disclaim').start()).rejects.toMatchObject({ code: 'not-disclaimed' });
  });

  it('the child gets an allow-list env only', async () => {
    process.env.GNOMON_VOICE_IO_DISCLAIMED = '1';
    process.env.GV_TEST_SECRET = 'x';
    process.env.DYLD_INSERT_LIBRARIES = '/tmp/evil.dylib';
    const got: { env?: NodeJS.ProcessEnv } = {};
    const a = io(undefined, got);
    try {
      await a.start();
    } finally {
      delete process.env.GNOMON_VOICE_IO_DISCLAIMED;
      delete process.env.GV_TEST_SECRET;
      delete process.env.DYLD_INSERT_LIBRARIES;
    }
    expect(Object.keys(got.env!).every((k) => ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', '__CF_USER_TEXT_ENCODING'].includes(k))).toBe(true);
    expect(got.env!.PATH).toBe('/usr/bin:/bin:/usr/sbin:/sbin');
    expect(ioChildEnv({ NODE_OPTIONS: '--require x', HOME: '/h' })).toEqual({ PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: '/h' });
    await a.close();
  });

  it('Aegis M1: the io child never inherits fd 3 (the kernel link): IO_CHILD_STDIO, falsified against a real socket fd 3', async () => {
    let stdio: unknown;
    const a = new SpawnedAudioIO({
      binary: process.execPath,
      args: [FAKE_IO],
      spawnImpl: ((b: string, args: string[], o: { stdio: unknown }) => {
        stdio = o.stdio;
        const c = spawn(b, args, o as never);
        spawned.push(c);
        return c;
      }) as never,
    });
    await a.start();
    expect(stdio).toEqual([...IO_CHILD_STDIO]);
    await a.close();
    // a stand-in for `gnomon-voice run --fd 3`: its fd 3 IS a socket (the kernel's socketpair); it spawns the io
    // child with the given stdio, which reports what it holds on fd 3
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-fd3-'));
    const runAs = async (childStdio: unknown): Promise<{ open: boolean; socket?: boolean }> => {
      const file = path.join(dir, `${Math.random().toString(36).slice(2)}.json`);
      const wrapper = `const { spawn } = require('node:child_process'); const fs = require('node:fs');
if (!fs.fstatSync(3).isSocket()) { console.error('wrapper fd 3 is not a socket'); process.exit(2); }
const c = spawn(process.execPath, [${JSON.stringify(FAKE_IO)}, 'report-fd3', ${JSON.stringify(file)}], { stdio: ${JSON.stringify(childStdio)} });
setTimeout(() => { c.kill(); process.exit(0); }, 400);`;
      const w = spawn(process.execPath, ['-e', wrapper], { stdio: ['pipe', 'inherit', 'inherit', 'pipe'] });
      spawned.push(w);
      const code = await new Promise<number | null>((r) => w.once('exit', (c) => r(c)));
      expect(code).toBe(0);
      return JSON.parse(fs.readFileSync(file, 'utf8')) as { open: boolean; socket?: boolean };
    };
    // the control: without the explicit entry the link leaks (Linux; macOS posix_spawn may close it anyway)
    const leaked = await runAs(['pipe', 'pipe', 'inherit', 3]);
    expect(leaked).toMatchObject({ open: true, socket: true });
    const guarded = await runAs([...IO_CHILD_STDIO]);
    expect(guarded.socket ?? false).toBe(false);
  });

  it('the child quits when its stdin closes (quit ignored: EOF alone ends it)', async () => {
    const a = io('ignore-quit');
    await a.start();
    const child = spawned[0]!;
    const exited = new Promise<number | null>((r) => child.once('exit', (c) => r(c)));
    const t = Date.now();
    await a.close();
    expect(await exited).toBe(0);
    expect(Date.now() - t).toBeLessThan(1900); // not the 2 s kill fallback
  });
});

/* ── member-pinned manifests ───────────────────────────────────────────────────────────────────────── */

const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
const serve = (bytes: Buffer): FetchLike => async () => ({ ok: true, status: 200, body: (async function* () { yield bytes; })() });

function archive(build: (root: string) => void): Buffer {
  const d = tmp('gv-ar-');
  fs.mkdirSync(path.join(d, 'm', 'data'), { recursive: true });
  build(path.join(d, 'm'));
  const out = path.join(d, 'a.tar.bz2');
  const r = spawnSync('tar', ['-cjf', out, '-C', d, 'm']);
  expect(r.status).toBe(0);
  return fs.readFileSync(out);
}
const A = 'model bytes';
const B = 'tokens';
const entryFor = (bytes: Buffer, members: Record<string, string> = { 'a.onnx': A, 'data/b.txt': B }): ModelEntry => ({
  id: 'arch', role: 'tts', kind: 'tar.bz2', url: 'https://example.invalid/a.tar.bz2', sha256: sha(bytes), size: bytes.length, root: 'm',
  files: { model: 'a.onnx', dataDir: 'data' },
  members: Object.fromEntries(Object.entries(members).map(([k, v]) => [k, { sha256: sha(v), size: Buffer.byteLength(v) }])),
});
const good = (root: string): void => {
  fs.writeFileSync(path.join(root, 'a.onnx'), A);
  fs.writeFileSync(path.join(root, 'data', 'b.txt'), B);
};

describe('member-pinned manifest', () => {
  it('the shipped manifest pins every archive member (parakeet 5, kokoro 360)', () => {
    const m = loadManifest();
    const n = Object.fromEntries(m.models.filter((e) => e.kind === 'tar.bz2').map((e) => [e.id, Object.keys(e.members!).length]));
    expect(n).toEqual({ 'parakeet-tdt-0.6b-v2-int8': 5, 'kokoro-int8-en-v0_19': 360 });
    expect(() => validateManifest({ schemaVersion: 'voiceModels:v1', models: [{ ...m.models.find((e) => e.kind === 'tar.bz2')!, members: undefined }] })).toThrow(/every member/);
  });

  it('installs a pinned archive; load verifies each member against the MANIFEST (tamper, extra, symlink refused)', async () => {
    const h = tmp('gv-h-');
    const bytes = archive(good);
    const e = entryFor(bytes);
    expect(await fetchModel(h, e, { fetch: serve(bytes) })).toBe('fetched');
    const p = verifiedModelPaths(h, e);
    expect(fs.readFileSync(p.model!, 'utf8')).toBe(A);
    // verified.json is not the authority: rewriting it changes nothing
    fs.writeFileSync(path.join(path.dirname(p.model!), 'verified.json'), '{"files":{}}');
    expect(() => verifiedModelPaths(h, e)).not.toThrow();
    fs.writeFileSync(path.join(path.dirname(p.model!), 'extra.bin'), 'x');
    expect(() => verifiedModelPaths(h, e)).toThrow(/not a pinned member/);
    fs.rmSync(path.join(path.dirname(p.model!), 'extra.bin'));
    fs.writeFileSync(path.join(p.dataDir!, 'b.txt'), 'tokenZ');
    expect(() => verifiedModelPaths(h, e)).toThrow(/does not match its manifest pin/);
    fs.rmSync(path.join(p.dataDir!, 'b.txt'));
    fs.symlinkSync('/etc/hosts', path.join(p.dataDir!, 'b.txt'));
    expect(() => verifiedModelPaths(h, e)).toThrow(/symlink/);
  });

  it('refuses an archive with a symlink member, an unpinned member, or a member that does not match its pin', async () => {
    const withLink = archive((r) => (good(r), fs.symlinkSync('/etc/passwd', path.join(r, 'data', 'link'))));
    await expect(fetchModel(tmp('gv-h-'), entryFor(withLink), { fetch: serve(withLink) })).rejects.toMatchObject({ reason: 'member', message: expect.stringMatching(/symlink/) });
    const extra = archive((r) => (good(r), fs.writeFileSync(path.join(r, 'surprise.py'), 'x')));
    await expect(fetchModel(tmp('gv-h-'), entryFor(extra), { fetch: serve(extra) })).rejects.toMatchObject({ reason: 'member', message: expect.stringMatching(/unpinned/) });
    const wrong = archive((r) => (fs.writeFileSync(path.join(r, 'a.onnx'), 'other bytes'), fs.writeFileSync(path.join(r, 'data', 'b.txt'), B)));
    const h = tmp('gv-h-');
    await expect(fetchModel(h, entryFor(wrong), { fetch: serve(wrong) })).rejects.toMatchObject({ reason: 'sha256' });
    expect(fs.readdirSync(path.join(h, 'voice', 'models'))).toEqual([]);
  });
});
