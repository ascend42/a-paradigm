/**
 * @symbol #gnomon-voice
 *
 * SpawnedAudioIO: the thin adapter over V2b's `gnomon-voice-io` Swift binary. ASSUMED wire (align once V2b
 * reports its protocol; everything protocol-specific lives in this file):
 *
 *   frame = u8 type · u32 BE payload length · payload        (both directions, stdin and stdout)
 *   type 0x01 PCM     payload = f64 BE t0 (wall ms of the first sample) · s16 LE mono samples
 *                     stdout: capture at the binary's rate; stdin: the samples of the last `play` control
 *   type 0x02 JSON    payload = UTF-8 JSON object
 *     from the binary:  {ev:'ready', sampleRate, route, aec} · {ev:'hotkey', down, at} · {ev:'mic', muted}
 *                       {ev:'route', route, aec} · {ev:'level', db} · {ev:'played', id, t0, t1, completed}
 *     to the binary:    {op:'play', id, sampleRate} (followed by one PCM frame) · {op:'stop'} · {op:'quit'}
 *
 * The binary never writes audio to disk and neither does this adapter (G-VOX-05): PCM moves pipe → memory only.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import type { AudioIO, AudioIOEvents, PlaybackResult, RouteInfo } from './types.js';

export const FRAME_PCM = 0x01;
export const FRAME_JSON = 0x02;
export const MAX_IO_FRAME = 4 * 1024 * 1024;

export function encodeFrame(type: number, payload: Buffer): Buffer {
  const h = Buffer.alloc(5);
  h.writeUInt8(type, 0);
  h.writeUInt32BE(payload.length, 1);
  return Buffer.concat([h, payload]);
}

export function encodePcm(t0: number, samples: Float32Array): Buffer {
  const p = Buffer.alloc(8 + samples.length * 2);
  p.writeDoubleBE(t0, 0);
  for (let i = 0; i < samples.length; i++) p.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i]! * 32767))), 8 + i * 2);
  return encodeFrame(FRAME_PCM, p);
}

export function decodePcm(payload: Buffer): { t0: number; samples: Float32Array } {
  const t0 = payload.readDoubleBE(0);
  const n = (payload.length - 8) >> 1;
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = payload.readInt16LE(8 + i * 2) / 32768;
  return { t0, samples };
}

/** Incremental frame splitter; throws on an oversize frame (the stream is then unusable). */
export class FrameReader {
  #buf = Buffer.alloc(0);
  push(chunk: Buffer, out: (type: number, payload: Buffer) => void): void {
    this.#buf = this.#buf.length ? Buffer.concat([this.#buf, chunk]) : chunk;
    while (this.#buf.length >= 5) {
      const len = this.#buf.readUInt32BE(1);
      if (len > MAX_IO_FRAME) throw new RangeError(`#gnomon-voice: audio-io frame of ${len} bytes exceeds the cap`);
      if (this.#buf.length < 5 + len) return;
      const type = this.#buf.readUInt8(0);
      const payload = this.#buf.subarray(5, 5 + len);
      this.#buf = this.#buf.subarray(5 + len);
      out(type, payload);
    }
  }
}

type Listeners = { [E in keyof AudioIOEvents]: Set<AudioIOEvents[E]> };

export class Emitter {
  readonly l: Listeners = { frame: new Set(), hotkey: new Set(), mic: new Set(), route: new Set(), level: new Set(), closed: new Set() };
  on<E extends keyof AudioIOEvents>(event: E, cb: AudioIOEvents[E]): () => void {
    (this.l[event] as Set<AudioIOEvents[E]>).add(cb);
    return () => (this.l[event] as Set<AudioIOEvents[E]>).delete(cb);
  }
  emit<E extends keyof AudioIOEvents>(event: E, ...args: Parameters<AudioIOEvents[E]>): void {
    for (const cb of this.l[event] as Set<(...a: unknown[]) => void>) cb(...args);
  }
}

export interface SpawnedAudioIOOptions {
  /** path of the gnomon-voice-io binary */
  binary: string;
  args?: string[];
  captureSampleRate?: number;
}

export class SpawnedAudioIO implements AudioIO {
  readonly captureSampleRate: number;
  readonly #o: SpawnedAudioIOOptions;
  readonly #ev = new Emitter();
  #child: ChildProcess | undefined;
  #route: RouteInfo = { route: 'unknown', aec: false };
  #pending: { id: string; resolve: (r: PlaybackResult) => void } | undefined;

  constructor(o: SpawnedAudioIOOptions) {
    this.#o = o;
    this.captureSampleRate = o.captureSampleRate ?? 16_000;
  }

  on<E extends keyof AudioIOEvents>(event: E, cb: AudioIOEvents[E]): () => void {
    return this.#ev.on(event, cb);
  }

  routeInfo(): RouteInfo {
    return this.#route;
  }

  async start(): Promise<void> {
    const child = spawn(this.#o.binary, this.#o.args ?? [], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.#child = child;
    const reader = new FrameReader();
    child.stdout!.on('data', (chunk: Buffer) => {
      try {
        reader.push(chunk, (type, payload) => this.#onFrame(type, payload));
      } catch (e) {
        this.#ev.emit('closed', e instanceof Error ? e.message : 'bad frame');
        child.kill();
      }
    });
    child.on('exit', (code, sig) => {
      this.#pending?.resolve({ t0: Date.now(), t1: Date.now(), completed: false });
      this.#pending = undefined;
      this.#ev.emit('closed', `gnomon-voice-io exited (${sig ?? code})`);
    });
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('spawn', () => resolve());
    });
  }

  #onFrame(type: number, payload: Buffer): void {
    if (type === FRAME_PCM) {
      const { t0, samples } = decodePcm(payload);
      this.#ev.emit('frame', { samples, sampleRate: this.captureSampleRate, t0 });
      return;
    }
    if (type !== FRAME_JSON) return;
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(payload.toString('utf8')) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (m.ev) {
      case 'ready':
      case 'route':
        if (typeof m.route === 'string') this.#route = { route: m.route, aec: m.aec === true };
        this.#ev.emit('route', this.#route);
        break;
      case 'hotkey':
        this.#ev.emit('hotkey', m.down === true, typeof m.at === 'number' ? m.at : Date.now());
        break;
      case 'mic':
        this.#ev.emit('mic', m.muted === true);
        break;
      case 'level':
        if (typeof m.db === 'number') this.#ev.emit('level', m.db);
        break;
      case 'played':
        if (this.#pending && m.id === this.#pending.id && typeof m.t0 === 'number' && typeof m.t1 === 'number') {
          const p = this.#pending;
          this.#pending = undefined;
          p.resolve({ t0: m.t0, t1: m.t1, completed: m.completed === true });
        }
        break;
    }
  }

  #write(type: number, payload: Buffer): void {
    this.#child?.stdin?.write(encodeFrame(type, payload));
  }

  play(chunk: { id: string; samples: Float32Array; sampleRate: number }): Promise<PlaybackResult> {
    if (this.#pending) return Promise.reject(new Error('#gnomon-voice: one chunk plays at a time'));
    return new Promise((resolve) => {
      this.#pending = { id: chunk.id, resolve };
      this.#write(FRAME_JSON, Buffer.from(JSON.stringify({ op: 'play', id: chunk.id, sampleRate: chunk.sampleRate })));
      this.#child?.stdin?.write(encodePcm(Date.now(), chunk.samples));
    });
  }

  stopPlayback(): void {
    if (this.#pending) this.#write(FRAME_JSON, Buffer.from(JSON.stringify({ op: 'stop' })));
  }

  async close(): Promise<void> {
    const c = this.#child;
    if (!c || c.exitCode !== null) return;
    this.#write(FRAME_JSON, Buffer.from(JSON.stringify({ op: 'quit' })));
    c.stdin?.end();
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => (c.kill(), resolve()), 2000);
      c.once('exit', () => (clearTimeout(t), resolve()));
    });
  }
}
