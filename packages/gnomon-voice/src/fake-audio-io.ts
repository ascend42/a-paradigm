/**
 * @symbol #gnomon-voice
 *
 * FakeAudioIO: an AudioIO for tests and dry runs. It "captures" WAV fixtures (in-memory buffers) as timed PCM
 * frames on a virtual clock, injects hotkey presses, and "plays" chunks by advancing the clock by their duration
 * (or until stopPlayback). Nothing touches the disk or a sound device.
 */
import { Emitter } from './audio-io.js';
import type { AudioIO, AudioIOEvents, PlaybackResult, RouteInfo } from './types.js';

/** Decode a PCM16 / float32 mono-or-stereo RIFF WAV buffer to mono Float32. */
export function decodeWav(buf: Buffer): { samples: Float32Array; sampleRate: number } {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new TypeError('#gnomon-voice: not a RIFF/WAVE buffer');
  let off = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | undefined;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    if (id === 'data') {
      if (!fmt) throw new TypeError('#gnomon-voice: WAV data before fmt');
      const bytes = fmt.bits / 8;
      const frames = Math.floor(size / (bytes * fmt.channels));
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let s = 0;
        for (let c = 0; c < fmt.channels; c++) {
          const p = body + (i * fmt.channels + c) * bytes;
          s += fmt.format === 3 ? buf.readFloatLE(p) : buf.readInt16LE(p) / 32768;
        }
        out[i] = s / fmt.channels;
      }
      return { samples: out, sampleRate: fmt.rate };
    }
    off = body + size + (size & 1);
  }
  throw new TypeError('#gnomon-voice: WAV has no data chunk');
}

/** Encode mono Float32 as a PCM16 WAV buffer (in memory; fixtures only). */
export function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i]! * 32767))), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

export class FakeAudioIO implements AudioIO {
  readonly captureSampleRate: number;
  readonly frameMs: number;
  readonly #ev = new Emitter();
  /** virtual wall clock (ms); pass `() => fake.clock` as the client's `now` */
  clock: number;
  route: RouteInfo = { route: 'headphones', aec: true, aecKind: 'headphones', transport: 'wired' };
  readonly played: Array<{ id: string; t0: number; t1: number; completed: boolean }> = [];
  #playing: { id: string; durMs: number; t0: number; resolve: (r: PlaybackResult) => void } | undefined;
  started = false;
  micOn = true;
  readonly micOps: boolean[] = [];

  constructor(o: { sampleRate?: number; frameMs?: number; clock?: number } = {}) {
    this.captureSampleRate = o.sampleRate ?? 16_000;
    this.frameMs = o.frameMs ?? 32;
    this.clock = o.clock ?? 1_700_000_000_000;
  }

  on<E extends keyof AudioIOEvents>(event: E, cb: AudioIOEvents[E]): () => void {
    return this.#ev.on(event, cb);
  }
  routeInfo(): RouteInfo {
    return this.route;
  }
  async start(): Promise<void> {
    this.started = true;
  }
  async close(): Promise<void> {
    this.started = false;
  }

  /** Emit captured audio as frames, advancing the clock; a chunk now playing ends when its duration elapses. */
  capture(samples: Float32Array, sampleRate = this.captureSampleRate): void {
    const n = Math.round((sampleRate * this.frameMs) / 1000);
    for (let i = 0; i < samples.length; i += n) {
      const f = samples.subarray(i, Math.min(samples.length, i + n));
      const t0 = this.clock;
      this.#advance((f.length / sampleRate) * 1000);
      if (this.micOn) this.#ev.emit('frame', { samples: f, sampleRate, t0 });
    }
  }
  captureWav(wav: Buffer): void {
    const { samples, sampleRate } = decodeWav(wav);
    this.capture(samples, sampleRate);
  }
  /** Silence for `ms`. */
  silence(ms: number): void {
    this.capture(new Float32Array(Math.round((this.captureSampleRate * ms) / 1000)));
  }
  async setMic(on: boolean): Promise<void> {
    this.micOn = on;
    this.micOps.push(on);
  }
  /** Press a control hotkey (mic-toggle / mode-toggle). */
  control(action: 'mic-toggle' | 'mode-toggle'): void {
    this.#ev.emit('control', action, this.clock);
  }
  hotkey(down: boolean): void {
    this.#ev.emit('hotkey', down, this.clock);
  }
  emitClosed(reason: string): void {
    this.#ev.emit('closed', reason);
  }

  get isPlaying(): boolean {
    return this.#playing !== undefined;
  }

  play(chunk: { id: string; samples: Float32Array; sampleRate: number }): Promise<PlaybackResult> {
    if (this.#playing) return Promise.reject(new Error('one chunk at a time'));
    return new Promise((resolve) => {
      this.#playing = { id: chunk.id, durMs: (chunk.samples.length / chunk.sampleRate) * 1000, t0: this.clock, resolve };
    });
  }

  stopPlayback(): void {
    this.#finish(false);
  }

  /** Let virtual time pass with no capture (plays out the current chunk if it ends in the window). */
  tick(ms: number): void {
    this.#advance(ms);
  }

  #advance(ms: number): void {
    this.clock += ms;
    const p = this.#playing;
    if (p && this.clock >= p.t0 + p.durMs) {
      this.clock = Math.max(this.clock, p.t0 + p.durMs);
      this.#finish(true, p.t0 + p.durMs);
    }
  }

  #finish(completed: boolean, at = this.clock): void {
    const p = this.#playing;
    if (!p) return;
    this.#playing = undefined;
    const r = { t0: p.t0, t1: at, completed };
    this.played.push({ id: p.id, ...r });
    p.resolve(r);
  }
}
