import { describe, expect, it } from 'vitest';
import { attachmentFromStatus, GnomonKernelLink, nsOf, type GnomonClientLike } from '../src/kernel-link.js';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { decodeCapture, encodeCapture, encodeFrame, FRAME_CAPTURE, FRAME_JSON, FRAME_PLAYBACK, FrameReader, SpawnedAudioIO } from '../src/audio-io.js';

describe('GnomonKernelLink (structural client)', () => {
  it('reads the attachment from status.voice and the V1 send contract content: [{text}]', async () => {
    const calls: Array<[string, unknown]> = [];
    const client: GnomonClientLike = {
      call: async (m, p) => (calls.push([m, p]), m === 'status' ? { voice: { attached: { voiceSessionId: 'vs:1', hsid: 'hs:1', mode: 'ptt', turns: 0 } } } : { seq: 7 }),
      subscribe: async () => ({}),
      close: async () => undefined,
    };
    const link = new GnomonKernelLink(client);
    expect(await link.attachment()).toEqual({ voiceSessionId: 'vs:1', hsid: 'hs:1', mode: 'ptt' });
    await link.send('hs:1', 'hello');
    await link.interrupt('hs:1');
    expect(await link.append('voice.turn.user', { a: 1 })).toEqual({ seq: 7 });
    expect(calls.slice(1)).toEqual([
      ['session.send', { hsid: 'hs:1', content: [{ text: 'hello' }] }],
      ['session.stop', { hsid: 'hs:1', interrupt: true }],
      ['log.append', { kind: 'voice.turn.user', payload: { a: 1 } }],
    ]);
  });
  it('no attachment ⇒ null; ns comes from p:<ns>/voice only', () => {
    expect(attachmentFromStatus({ voice: { attached: null } })).toBeNull();
    expect(attachmentFromStatus({})).toBeNull();
    expect(nsOf('p:abcd1234/voice')).toBe('abcd1234');
    expect(() => nsOf('p:abcd1234/human')).toThrow();
  });
});

describe('gnomon-voice-io:v1 framing', () => {
  it('round-trips capture and JSON frames split across chunks (u32le lengths)', () => {
    const cap = encodeCapture(5_000_000n, 16_000, Float32Array.from([0, 0.5, -0.5]));
    expect(cap.readUInt32LE(1)).toBe(12 + 6);
    const all = Buffer.concat([cap, encodeFrame(FRAME_JSON, Buffer.from('{"type":"event","event":"level"}'))]);
    const got: Array<[number, Buffer]> = [];
    const r = new FrameReader();
    r.push(all.subarray(0, 7), (t, p) => got.push([t, p]));
    r.push(all.subarray(7), (t, p) => got.push([t, p]));
    expect(got.map((g) => g[0])).toEqual([FRAME_CAPTURE, FRAME_JSON]);
    const d = decodeCapture(got[0]![1]);
    expect(d.hostTimeNs).toBe(5_000_000n);
    expect(d.sampleRate).toBe(16_000);
    expect(Math.abs(d.samples[1]! - 0.5)).toBeLessThan(1e-3);
  });
  it('refuses an oversize frame (1 MiB cap)', () => {
    const h = Buffer.alloc(5);
    h.writeUInt32LE(2 * 1024 * 1024, 1);
    expect(() => new FrameReader().push(h, () => undefined)).toThrow(/cap/);
  });
});

/** A fake gnomon-voice-io child: replies ok to every command and lets the test emit events/capture. */
function fakeBinary() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const child = Object.assign(new EventEmitter(), { stdin, stdout, exitCode: null as number | null, kill: () => true });
  const ops: string[] = [];
  const playback: number[] = [];
  const reader = new FrameReader();
  const send = (o: unknown): boolean => stdout.write(encodeFrame(FRAME_JSON, Buffer.from(JSON.stringify(o))));
  stdin.on('data', (c: Buffer) =>
    reader.push(c, (t, p) => {
      if (t === FRAME_PLAYBACK) return void playback.push(p.readUInt32LE(0));
      const m = JSON.parse(p.toString()) as { op: string; id: string };
      ops.push(m.op);
      if (m.op === 'route.get') send({ type: 'reply', id: m.id, op: m.op, ok: true, route: { device: 'AirPods', transport: 'bluetooth', kind: 'headphones' }, aec: 'headphones' });
      else if (m.op === 'quit') child.emit('exit', 0, null);
      else send({ type: 'reply', id: m.id, op: m.op, ok: true, ...(m.op === 'info' ? { disclaimed: true } : {}) });
    }),
  );
  setImmediate(() => child.emit('spawn'));
  return { child, ops, playback, send, stdout };
}
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('SpawnedAudioIO against a fake gnomon-voice-io:v1', () => {
  it('mic.on + route.get at start; aec from the route; talk hotkeys; playback window from playback.start/end', async () => {
    const f = fakeBinary();
    let wall = 1_000_000;
    const io = new SpawnedAudioIO({ binary: 'x', now: () => wall, spawnImpl: (() => f.child) as never });
    const keys: boolean[] = [];
    const frames: number[] = [];
    const controls: string[] = [];
    io.on('hotkey', (d) => keys.push(d));
    io.on('control', (a) => controls.push(a));
    io.on('frame', (fr) => frames.push(fr.t0));
    await io.start();
    expect(f.ops).toEqual(['info', 'mic.on', 'route.get']);
    expect(io.routeInfo()).toEqual({ route: 'headphones', aec: true, aecKind: 'headphones', transport: 'bluetooth' });
    f.send({ type: 'event', event: 'route', tUs: 1_000, route: { kind: 'speaker' }, aec: 'none' });
    f.send({ type: 'event', event: 'hotkey', tUs: 2_000, action: 'talk', phase: 'down' });
    f.send({ type: 'event', event: 'hotkey', tUs: 3_000, action: 'mode-toggle', phase: 'down' });
    f.send({ type: 'event', event: 'hotkey', tUs: 3_100, action: 'hold-toggle', phase: 'down' });
    f.send({ type: 'event', event: 'hotkey', tUs: 3_200, action: 'hold-toggle', phase: 'up' });
    f.stdout.write(encodeCapture(4_000_000n, 16_000, new Float32Array(160)));
    await tick();
    expect(io.routeInfo().aec).toBe(false);
    expect(keys).toEqual([true]);
    expect(controls).toEqual(['mode-toggle', 'hold-toggle']); // key down only (TD-2026-10-20-262)
    expect(frames[0]).toBe(1_000_000 - 1 + 4); // offset fixed at tUs 1000 → wall 1e6
    const played = io.play({ id: 'a1', samples: new Float32Array(2400), sampleRate: 24_000 });
    await tick();
    expect(f.playback).toEqual([24_000]);
    expect(f.ops).toContain('play.end');
    f.send({ type: 'event', event: 'playback.start', tUs: 10_000, audibleAtUs: 12_000 });
    f.send({ type: 'event', event: 'playback.end', tUs: 50_000, reason: 'drained', utteranceEnded: false, queuedMs: 0 });
    f.send({ type: 'event', event: 'playback.end', tUs: 112_000, reason: 'drained', utteranceEnded: true, queuedMs: 0 });
    const r = await played;
    expect(r).toEqual({ t0: 1_000_000 - 1 + 12, t1: 1_000_000 - 1 + 112, completed: true });
    const p2 = io.play({ id: 'a2', samples: new Float32Array(100), sampleRate: 24_000 });
    io.stopPlayback();
    await tick();
    expect(f.ops).toContain('play.stop');
    f.send({ type: 'event', event: 'playback.end', tUs: 200_000, reason: 'stopped', utteranceEnded: false, queuedMs: 40 });
    expect((await p2).completed).toBe(false);
    // duty 2: after mic:false, capture and level are dropped
    f.send({ type: 'event', event: 'mic', tUs: 210_000, on: false, aec: 'none', transport: 'built-in' });
    f.stdout.write(encodeCapture(220_000_000n, 16_000, new Float32Array(160)));
    await tick();
    expect(frames).toHaveLength(1);
    expect(io.routeInfo()).toMatchObject({ aecKind: 'none', transport: 'built-in' });
    wall += 1;
    await io.close();
    expect(f.ops.slice(-2)).toEqual(['mic.off', 'quit']);
  });

  it('refuses to start capture when the binary is not disclaimed (and strips the disclaim env)', async () => {
    const f = fakeBinary();
    f.child.stdin.removeAllListeners('data');
    const reader = new FrameReader();
    const ops: string[] = [];
    f.child.stdin.on('data', (c: Buffer) => reader.push(c, (_t, p) => {
      const m = JSON.parse(p.toString()) as { op: string; id: string };
      ops.push(m.op);
      if (m.op === 'quit') return void f.child.emit('exit', 0, null);
      f.send({ type: 'reply', id: m.id, op: m.op, ok: true, ...(m.op === 'info' ? { disclaimed: false } : {}) });
    }));
    process.env.GNOMON_VOICE_IO_DISCLAIMED = '1';
    let env: NodeJS.ProcessEnv | undefined;
    const io = new SpawnedAudioIO({ binary: 'x', spawnImpl: ((_b: string, _a: string[], o: { env: NodeJS.ProcessEnv }) => ((env = o.env), f.child)) as never });
    try {
      await expect(io.start()).rejects.toMatchObject({ code: 'not-disclaimed', message: expect.stringMatching(/wrong app/) });
    } finally {
      delete process.env.GNOMON_VOICE_IO_DISCLAIMED;
    }
    expect(ops).not.toContain('mic.on');
    expect(env && 'GNOMON_VOICE_IO_DISCLAIMED' in env).toBe(false);
  });

  it('a refused command (mic-denied) rejects start', async () => {
    const f = fakeBinary();
    f.child.stdin.removeAllListeners('data');
    const reader = new FrameReader();
    f.child.stdin.on('data', (c: Buffer) => reader.push(c, (_t, p) => {
      const m = JSON.parse(p.toString()) as { op: string; id: string };
      f.send({ type: 'reply', id: m.id, op: m.op, ok: false, error: 'mic-denied', message: 'Microphone access was denied' });
    }));
    const io = new SpawnedAudioIO({ binary: 'x', spawnImpl: (() => f.child) as never });
    await expect(io.start()).rejects.toMatchObject({ code: 'mic-denied' });
  });
});
