// @gnomon-platform: darwin
/**
 * #gnomon-voice V2e END TO END (T-2026-10-19-026), through a REAL daemon: the kernel spawns the voice child over fd 3
 * (here a relay that bridges that fd to this test process), authenticates it as p:<ns>/voice, and the REAL voice
 * client (gnomon-voice runVoice, FakeAudioIO + stub engines) runs on it. Two legs:
 *   1. enrolment: request.voice.enrol → the strictness card → a presence allow → status.voice.enrolment 'requested'
 *      → the client records three phrases and reports ready … done → the print is stored, status.voice.enrolled.
 *   2. a turn: attach (voice.session.start) → push-to-talk → voice.turn.user + session.send → the fake claude
 *      replies → the kernel's speakable row (voice.turn.agent{source:'kernel-speakable'}) → TTS → played.
 * darwin: the session runs under the real session sandbox with the fake claude (session-helpers.ts).
 */
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { approvalsKeyFrom, type ApprovalsKey } from '../src/kernel/broker/index.js';
import { selectSocketPath } from '../src/kernel/lifecycle/index.js';
import { connectGnomon } from '../src/kernel/socket/index.js';
import { loadDevHome, provisionDevHome } from '../src/cli/dev-home.js';
import { recordKernelPub } from '../src/kernel/identity/index.js';
import { KeyRing, signaturePreimage } from '../src/kernel/log/signer.js';
import { darwinFloor } from '../src/kernel/sandbox/session.js';
import { mintTestPresence, startDaemonForTest } from '../src/kernel/testing.js';
import { kernelPinOf } from '../src/cli/daemon-cli.js';
import { humanDeviceOf } from '../src/cli/rules-cli.js';
import { GNOMON_VERSION } from '../src/version.js';
import { privateTmpRoot, tempHome } from './daemon-helpers.js';
import { sessionWorld, waitFor } from './session-helpers.js';
import { FdRpc, GnomonKernelLink } from '../../gnomon-voice/src/kernel-link.js';
import { FakeAudioIO } from '../../gnomon-voice/src/fake-audio-io.js';
import { runVoice } from '../../gnomon-voice/src/run.js';
import { readPrints } from '../../gnomon-voice/src/speaker.js';
import type { VoiceClient } from '../../gnomon-voice/src/voice-client.js';
import { stubEngines, tone } from '../../gnomon-voice/test/stubs.js';

const SANDBOX_OK = darwinFloor().ok;
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

/** The voice child: bridges the inherited, kernel-authenticated fd 3 to this test's socket; dies with stdin. */
const relay = (sock: string) => `
const net = require('node:net');
process.stdin.on('end', () => process.exit(0)); process.stdin.resume();
const a = new net.Socket({ fd: 3, readable: true, writable: true });
const b = net.connect(${JSON.stringify(sock)});
a.pipe(b); b.pipe(a);
a.on('close', () => process.exit(0)); b.on('close', () => process.exit(0));
`;

function world() {
  const t = tempHome('ve2e-');
  cleanups.push(t.cleanup);
  fs.mkdirSync(path.dirname(t.home), { recursive: true });
  const userHome = fs.realpathSync.native(path.dirname(t.home));
  const home = path.join(userHome, 'devhome');
  provisionDevHome(home, { userHome });
  const l = loadDevHome(home, { userHome });
  recordKernelPub(home, l.kernelKey.publicKeyPem);
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ring = new KeyRing();
  const keyId = ring.addP256(publicKey);
  const approvalsKey: ApprovalsKey = {
    ...approvalsKeyFrom(ring, (p) => (p === l.device.principalId ? keyId : undefined)),
    signDecision: async (req) => ({
      decisionSig: cryptoSign('sha256', signaturePreimage('approve', req.message), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64'),
      token: req.presence ? mintTestPresence(req.presence.purpose, { bind: req.presence.binding }) : null,
      kept: false,
    }),
  };
  const sock = selectSocketPath({ home });
  if (!sock.ok) throw new Error('no socket path');
  return { home, l, approvalsKey, sock: sock.path };
}

async function call<T = Record<string, unknown>>(conn: { call: (m: string, p: unknown) => Promise<unknown> }, method: string, params: unknown): Promise<T> {
  const r = (await conn.call(method, params)) as { result?: T; error?: { message: string } };
  if (r.error) throw new Error(`${method}: ${r.error.message}`);
  return r.result as T;
}

describe.skipIf(!SANDBOX_OK)('#gnomon-voice V2e end to end through a real daemon', () => {
  it('enrol (card → requested → three phrases → done), attach, a push-to-talk turn is sent, the reply is spoken', async () => {
    const w = world();
    const sw = sessionWorld();
    cleanups.push(() => sw.cleanup());
    // the test end of the relay
    const relayDir = fs.mkdtempSync(path.join(privateTmpRoot(), 'vr-'));
    cleanups.push(() => fs.rmSync(relayDir, { recursive: true, force: true }));
    const relaySock = path.join(relayDir, 'r.sock');
    let accepted!: (s: net.Socket) => void;
    const voiceSock = new Promise<net.Socket>((r) => (accepted = r));
    const server = net.createServer((s) => accepted(s));
    await new Promise<void>((r) => server.listen(relaySock, r));
    cleanups.push(() => new Promise<void>((r) => server.close(() => r())));

    const d = await startDaemonForTest(
      {
        home: w.home,
        idleMs: 60_000,
        kernelSigner: w.l.kernel,
        rootAuthority: w.l.root,
        approvalsKey: w.approvalsKey,
        voice: { client: { entry: '/pkg/gnomon-voice/dist/cli.js', prepare: async () => ({ ioBinary: '/io/gnomon-voice-io', devUnsigned: true }), spawn: (_c, _a, o) => spawn(process.execPath, ['-e', relay(relaySock)], o) } },
      },
      { supervisor: { claudePath: sw.claude, allowScripts: true, userHome: sw.userHome, env: () => ({ HOME: sw.userHome, PATH: '/usr/bin:/bin' }) }, billing: { env: () => ({}), layers: () => [] } },
    );
    cleanups.push(() => d.shutdown('signal').catch(() => undefined));
    const found = kernelPinOf(w.home, w.l.kernelKey.keyId)!;
    const device = humanDeviceOf(w.home);
    if (typeof device === 'string') throw new Error(device);
    const human = (await connectGnomon({ socketPath: w.sock, client: { name: 'gnomon', version: GNOMON_VERSION, surface: 'cli' }, serverKey: found.pin, device })).conn;
    cleanups.push(() => human.close().catch(() => undefined));
    const hstatus = async () => (await call<{ voice: Record<string, unknown> }>(human, 'status', {})).voice;

    // the human starts the voice app; the kernel spawns the child and adopts fd 3 as p:<ns>/voice
    expect(await call(human, 'log.append', { kind: 'request.voice.client', payload: { op: 'start' } })).toMatchObject({ voiceClient: expect.anything() });
    const link = new GnomonKernelLink(new FdRpc(await voiceSock));
    const audio = new FakeAudioIO({ clock: Date.now() });
    const engines = stubEngines(['run the tests please']);
    const voiceHome = path.join(w.home, 'voice-client');
    let client: VoiceClient | undefined;
    const stdin = new PassThrough();
    const run = runVoice({ link, audio, engines, prints: () => readPrints(voiceHome), stdin, mode: 'ptt', enrol: { home: voiceHome, model: 'stub-campplus', pollMs: 50, timeoutMs: 10_000 }, started: (c) => (client = c) });
    cleanups.push(async () => (stdin.end(), await run.catch(() => undefined)));
    expect(await waitFor(() => client !== undefined, 5000)).toBe(true);
    expect((await hstatus()).clientConnected).toBe(true);

    // ── leg 1: enrolment, decided by the kernel ──
    const asked = await call<{ pending: boolean; cardId: string }>(human, 'log.append', { kind: 'request.voice.enrol', payload: { name: 'matt', consent: 'I agree to local voice enrolment' } });
    expect(asked).toMatchObject({ pending: true, cardId: expect.stringMatching(/^card:/) });
    expect((await hstatus()).enrolled).toEqual([]);
    await call(human, 'approve', { cardId: asked.cardId, decision: 'allow' });
    let enr: Record<string, unknown> | null = null;
    const poll = (): void => void hstatus().then((v) => (enr = (v.enrolment as Record<string, unknown> | null) ?? null));
    for (let i = 0; i < 3; i++) {
      const want = i;
      expect(await waitFor(() => (poll(), (enr as Record<string, unknown> | null)?.phase === 'recording' && (enr as Record<string, unknown>).phrase === want), 5000, 50)).toBe(true);
      audio.clock = Date.now();
      audio.capture(tone(1500, 0.5));
      audio.silence(400);
    }
    expect(await waitFor(() => (poll(), (enr as Record<string, unknown> | null)?.phase === 'done'), 5000, 50)).toBe(true);
    expect(enr).toMatchObject({ name: 'matt', phase: 'done', of: 3 });
    expect(readPrints(voiceHome).map((p) => p.name)).toEqual(['matt']);
    expect((await hstatus()).enrolled).toEqual(['matt']);

    // ── leg 2: attach → turn → send → speakable → TTS ──
    const opened = await call<{ hsid: string; state: string }>(human, 'session.open', { cwd: sw.cwd, attended: true });
    expect(opened.state).toBe('running');
    await call(human, 'log.append', { kind: 'voice.session.start', payload: { hsid: opened.hsid, mode: 'ptt' } });
    await client!.refresh();
    expect(client!.attachment?.hsid).toBe(opened.hsid);
    await new Promise((r) => setTimeout(r, 20));
    audio.clock = Date.now();
    audio.hotkey(true);
    audio.capture(tone(800, 0.5));
    audio.hotkey(false);
    await client!.idle();
    const rows = (kind: string) => [...d.log.read({ reader: { class: 'human' }, kinds: [kind] })].flatMap((v) => (v.view === 'full' ? [v.event.payload as Record<string, unknown>] : []));
    // TD-2026-10-20-262 dictation: the client appends (composer delivery, never a send); the kernel stamps forwardable
    expect(rows('voice.turn.user').at(-1)).toMatchObject({ speakerId: `spk:${w.l.root.ns}/matt`, speakerEnrolled: true, forwarded: false, forwardable: true, text: 'run the tests please' });
    expect(rows('turn.sent')).toHaveLength(0);
    expect(((await hstatus()) as Record<string, unknown>).dictation).toMatchObject({ activity: 'idle', holdToggles: 0 });
    // the GUI composer sends it as the human, with the attribution hint
    await call(human, 'session.send', { hsid: opened.hsid, content: [{ text: 'run the tests please' }], source: 'voice' });
    const sent = rows('turn.sent').at(-1)!;
    expect(sent).toMatchObject({ source: 'voice', voiceTurnSeqs: [expect.any(Number)] });
    expect(sent.voiceTurnSeq).toBe((sent.voiceTurnSeqs as number[])[0]);
    // the fake claude answers; the kernel writes the speakable row; the client speaks it
    expect(await waitFor(() => rows('voice.turn.agent').some((p) => p.source === 'kernel-speakable'), 20_000)).toBe(true);
    expect(await waitFor(() => (audio.tick(250), engines.tts.said.length > 0 && audio.played.length > 0 && !client!.playing), 10_000, 20)).toBe(true);
    expect(await waitFor(() => rows('voice.turn.agent').some((p) => typeof p.textSpoken === 'string'), 5000)).toBe(true);
    expect(audio.played.every((p) => p.completed)).toBe(true);
  }, 60_000);
});
