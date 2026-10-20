/**
 * @symbol #gnomon-voice
 *
 * SpawnedAudioIO: the thin adapter over V2b's `gnomon-voice-io` binary, protocol `gnomon-voice-io:v1`
 * (packages/gnomon-voice/io-darwin; everything wire-specific lives in this file):
 *
 *   frame = type:u8 · length:u32le · payload (max 1 MiB), both directions
 *   0x01 JSON      stdin: commands {op, id?} — info, mic.on, mic.off, play.stop, play.end, route.get, hotkeys.set, quit;
 *                  stdout: one {type:'reply', id, op, ok, error?, message?} per command, and
 *                  {type:'event', event, tUs, …}: ready, mic, route{route, aec: vpio|headphones|none}, level{rmsDBFS,
 *                  peakDBFS}, playback.start{audibleAtUs}, playback.end{reason, utteranceEnded, queuedMs}, hotkey{action,
 *                  phase}, engine, error, exit
 *   0x02 capture   stdout: hostTimeNs:u64le · sampleRate:u32le · s16le mono (16 kHz, after VPIO AEC)
 *   0x03 playback  stdin: sampleRate:u32le · s16le mono (8–48 kHz)
 *
 * Clocks: tUs / hostTimeNs are the binary's monotonic capture clock; they are mapped to wall ms by one offset taken
 * at the first timed message (ASSUMED: hostTimeNs/1000 and tUs share that clock). A played chunk's window is
 * [playback.start.audibleAtUs, playback.end.tUs] — the voice.turn.agent t0/t1. The binary only REPORTS hotkeys; this
 * adapter sends mic.on at start and mic.off at close. PCM moves pipe → memory only (G-VOX-05).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import type { AudioIO, AudioIOEvents, PlaybackResult, RouteInfo } from './types.js';

export const PROTOCOL = 'gnomon-voice-io:v1' as const;
export const FRAME_JSON = 0x01;
export const FRAME_CAPTURE = 0x02;
export const FRAME_PLAYBACK = 0x03;
export const MAX_IO_FRAME = 1024 * 1024;

export function encodeFrame(type: number, payload: Buffer): Buffer {
  if (payload.length > MAX_IO_FRAME) throw new RangeError('#gnomon-voice: audio-io frame exceeds 1 MiB');
  const h = Buffer.alloc(5);
  h.writeUInt8(type, 0);
  h.writeUInt32LE(payload.length, 1);
  return Buffer.concat([h, payload]);
}

function s16(samples: Float32Array, into: Buffer, at: number): void {
  for (let i = 0; i < samples.length; i++) into.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i]! * 32767))), at + i * 2);
}

/** 0x02 capture frame (the binary's stdout; tests build them with this). */
export function encodeCapture(hostTimeNs: bigint, sampleRate: number, samples: Float32Array): Buffer {
  const p = Buffer.alloc(12 + samples.length * 2);
  p.writeBigUInt64LE(hostTimeNs, 0);
  p.writeUInt32LE(sampleRate, 8);
  s16(samples, p, 12);
  return encodeFrame(FRAME_CAPTURE, p);
}

export function decodeCapture(payload: Buffer): { hostTimeNs: bigint; sampleRate: number; samples: Float32Array } {
  const n = (payload.length - 12) >> 1;
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = payload.readInt16LE(12 + i * 2) / 32768;
  return { hostTimeNs: payload.readBigUInt64LE(0), sampleRate: payload.readUInt32LE(8), samples };
}

/** 0x03 playback frames for one chunk (split under the 1 MiB cap). */
export function encodePlayback(sampleRate: number, samples: Float32Array): Buffer[] {
  const per = Math.floor((MAX_IO_FRAME - 4) / 2);
  const out: Buffer[] = [];
  for (let i = 0; i < samples.length; i += per) {
    const part = samples.subarray(i, Math.min(samples.length, i + per));
    const p = Buffer.alloc(4 + part.length * 2);
    p.writeUInt32LE(sampleRate, 0);
    s16(part, p, 4);
    out.push(encodeFrame(FRAME_PLAYBACK, p));
  }
  return out;
}

/** Incremental frame splitter; throws on an oversize frame (the stream is then unusable). */
export class FrameReader {
  #buf: Buffer = Buffer.alloc(0);
  push(chunk: Buffer, out: (type: number, payload: Buffer) => void): void {
    this.#buf = this.#buf.length ? Buffer.concat([this.#buf, chunk]) : chunk;
    while (this.#buf.length >= 5) {
      const len = this.#buf.readUInt32LE(1);
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
  readonly l: Listeners = { frame: new Set(), hotkey: new Set(), mic: new Set(), route: new Set(), level: new Set(), closed: new Set(), control: new Set() };
  on<E extends keyof AudioIOEvents>(event: E, cb: AudioIOEvents[E]): () => void {
    (this.l[event] as Set<AudioIOEvents[E]>).add(cb);
    return () => (this.l[event] as Set<AudioIOEvents[E]>).delete(cb);
  }
  emit<E extends keyof AudioIOEvents>(event: E, ...args: Parameters<AudioIOEvents[E]>): void {
    for (const cb of this.l[event] as Set<(...a: unknown[]) => void>) cb(...args);
  }
}

/** The bundled binary (V2b): packages/gnomon-voice/bin/darwin/GnomonVoiceIO.app/Contents/MacOS/gnomon-voice-io. */
export const DARWIN_IO_BINARY = 'bin/darwin/GnomonVoiceIO.app/Contents/MacOS/gnomon-voice-io';

export interface SpawnedAudioIOOptions {
  binary: string;
  args?: string[];
  /** wall clock (ms); default Date.now */
  now?: () => number;
  /** spawn seam for tests */
  spawnImpl?: typeof spawn;
}

/**
 * The ONLY environment the Swift child gets (item 5 hardening): locale, home and temp for CoreAudio/AppKit, a
 * fixed system PATH. Never GNOMON_VOICE_IO_DISCLAIMED (the binary's own re-spawn marker), never the parent's
 * secrets or DYLD_* / NODE_* variables.
 */
export const IO_ENV_ALLOW = ['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', '__CF_USER_TEXT_ENCODING'] as const;
export const IO_CHILD_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

export function ioChildEnv(src: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: IO_CHILD_PATH };
  for (const k of IO_ENV_ALLOW) if (typeof src[k] === 'string') env[k] = src[k];
  return env;
}

export class AudioIOError extends Error {
  constructor(readonly op: string, readonly code: string, message: string) {
    super(message);
    this.name = 'AudioIOError';
  }
}

/** The io child's stdio: frames on stdin/stdout, stderr shared, fd 3 (the kernel link here) replaced by /dev/null. */
export const IO_CHILD_STDIO: readonly ['pipe', 'pipe', 'inherit', 'ignore'] = Object.freeze(['pipe', 'pipe', 'inherit', 'ignore'] as const);

export class SpawnedAudioIO implements AudioIO {
  readonly captureSampleRate = 16_000;
  readonly #o: SpawnedAudioIOOptions;
  readonly #ev = new Emitter();
  readonly #now: () => number;
  #child: ChildProcess | undefined;
  #route: RouteInfo = { route: 'unknown', aec: false };
  #offsetMs: number | undefined;
  #nextId = 1;
  readonly #replies = new Map<string, { resolve: (r: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  #pending: { resolve: (r: PlaybackResult) => void; t0?: number } | undefined;
  /** capture/level frames are dropped unless the mic is on (after mic.on ok; off once mic.off is sent or mic:false arrives) */
  #micOn = false;
  #disclaimed: boolean | undefined;
  get micOn(): boolean {
    return this.#micOn;
  }
  #killOnExit: (() => void) | undefined;

  constructor(o: SpawnedAudioIOOptions) {
    this.#o = o;
    this.#now = o.now ?? Date.now;
  }

  on<E extends keyof AudioIOEvents>(event: E, cb: AudioIOEvents[E]): () => void {
    return this.#ev.on(event, cb);
  }
  routeInfo(): RouteInfo {
    return this.#route;
  }

  /** monotonic µs → wall ms (one offset, fixed at the first timed message) */
  #wall(us: number): number {
    const ms = us / 1000;
    this.#offsetMs ??= this.#now() - ms;
    return ms + this.#offsetMs;
  }

  async start(): Promise<void> {
    // V2b Aegis duty 3 + item 5: an ALLOW-LIST env (the disclaim marker is the binary's own re-spawn signal, never inherited)
    const env = ioChildEnv();
    // Aegis M1: fd 3 of THIS process is the kernel-authenticated voice link (`run --fd 3`). The io binary must never
    // inherit it: an explicit 'ignore' puts /dev/null on the child's fd 3 (Node has no fcntl to set FD_CLOEXEC on an
    // inherited fd, so the explicit stdio entry is the guarantee; macOS posix_spawn's CLOEXEC_DEFAULT is a second one).
    const child = (this.#o.spawnImpl ?? spawn)(this.#o.binary, this.#o.args ?? [], { stdio: IO_CHILD_STDIO as never, env });
    this.#child = child;
    this.#killOnExit = () => void child.kill();
    process.once('exit', this.#killOnExit);
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
      this.#micOn = false;
      if (this.#killOnExit) process.removeListener('exit', this.#killOnExit);
      this.#settlePlayback(false);
      for (const r of this.#replies.values()) r.reject(new AudioIOError('*', 'exit', 'gnomon-voice-io exited'));
      this.#replies.clear();
      this.#ev.emit('closed', `gnomon-voice-io exited (${sig ?? code})`);
    });
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('spawn', () => resolve());
    });
    // V2b Aegis duty 1: never start capture unless the binary disclaimed TCC responsibility (else the Microphone
    // grant would attach to the parent app)
    const info = await this.command('info');
    // fail CLOSED: only an explicit `disclaimed: true` (reply or ready event) lets the mic turn on
    if (!(info.disclaimed === true || (info.disclaimed === undefined && this.#disclaimed === true)) || this.#disclaimed === false) {
      await this.close();
      throw new AudioIOError('info', 'not-disclaimed', 'Gnomon voice will not turn the mic on: the mic permission would attach to the wrong app (gnomon-voice-io is not disclaimed).');
    }
    await this.command('mic.on');
    this.#micOn = true;
    const r = await this.command('route.get').catch(() => undefined);
    if (r) this.#setRoute(r);
  }

  /** Local mic toggle (⌃⌥M): mic.on / mic.off on the binary. Frames are dropped from the moment mic.off is sent. */
  async setMic(on: boolean): Promise<void> {
    if (!on) {
      this.#micOn = false;
      await this.command('mic.off');
      return;
    }
    await this.command('mic.on');
    this.#micOn = true;
  }

  /** One command → its one reply; rejects with AudioIOError on ok:false (e.g. mic-denied, hotkey-taken). */
  command(op: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = `c${this.#nextId++}`;
    return new Promise((resolve, reject) => {
      this.#replies.set(id, { resolve, reject });
      this.#child?.stdin?.write(encodeFrame(FRAME_JSON, Buffer.from(JSON.stringify({ op, id, ...extra }))));
    });
  }

  #setRoute(m: Record<string, unknown>): void {
    const r = m.route as { kind?: unknown; transport?: unknown; device?: unknown } | string | undefined;
    const name = typeof r === 'string' ? r : String(r?.kind ?? r?.transport ?? r?.device ?? 'unknown');
    // aec claim: VoiceProcessingIO is on, or the route cannot echo (headphones)
    const kind = m.aec === 'vpio' || m.aec === 'headphones' || m.aec === 'none' ? m.aec : undefined;
    const transport = typeof m.transport === 'string' ? m.transport : typeof (r as { transport?: unknown })?.transport === 'string' ? String((r as { transport: string }).transport) : this.#route.transport;
    this.#route = { route: name, aec: kind === 'vpio' || kind === 'headphones', ...(kind ? { aecKind: kind } : {}), ...(transport ? { transport } : {}) };
    this.#ev.emit('route', this.#route);
  }

  #settlePlayback(completed: boolean, at?: number): void {
    const p = this.#pending;
    if (!p) return;
    this.#pending = undefined;
    const t1 = at ?? this.#now();
    p.resolve({ t0: p.t0 ?? t1, t1, completed });
  }

  #onFrame(type: number, payload: Buffer): void {
    if (type === FRAME_CAPTURE) {
      if (!this.#micOn) return; // duty 2
      const c = decodeCapture(payload);
      this.#ev.emit('frame', { samples: c.samples, sampleRate: c.sampleRate, t0: this.#wall(Number(c.hostTimeNs / 1000n)) });
      return;
    }
    if (type !== FRAME_JSON) return;
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(payload.toString('utf8')) as Record<string, unknown>;
    } catch {
      return;
    }
    if (m.type === 'reply') {
      const r = typeof m.id === 'string' ? this.#replies.get(m.id) : undefined;
      if (!r) return;
      this.#replies.delete(m.id as string);
      if (m.ok === true) r.resolve(m);
      else r.reject(new AudioIOError(String(m.op), String(m.error ?? 'error'), String(m.message ?? m.error ?? 'refused')));
      return;
    }
    if (m.type !== 'event') return;
    const at = typeof m.tUs === 'number' ? this.#wall(m.tUs) : this.#now();
    switch (m.event) {
      case 'ready':
        if (typeof m.disclaimed === 'boolean') this.#disclaimed = m.disclaimed;
        if (m.route !== undefined) this.#setRoute(m);
        break;
      case 'route':
        if (m.route !== undefined) this.#setRoute(m);
        break;
      case 'mic':
        if (m.on !== true) this.#micOn = false; // duty 2
        this.#ev.emit('mic', m.on !== true);
        if (typeof m.aec === 'string') this.#setRoute({ route: this.#route.route, aec: m.aec, ...(m.transport !== undefined ? { transport: m.transport } : {}) });
        break;
      case 'level':
        if (this.#micOn && typeof m.rmsDBFS === 'number') this.#ev.emit('level', m.rmsDBFS);
        break;
      case 'hotkey':
        // talk → push-to-talk; mic-toggle (⌃⌥M) / mode-toggle (⌃⌥A) / hold-toggle (⌃⌥H, dictation) → local controls, on key down only
        if (m.action === 'talk') this.#ev.emit('hotkey', m.phase === 'down', at);
        else if ((m.action === 'mic-toggle' || m.action === 'mode-toggle' || m.action === 'hold-toggle') && m.phase === 'down') this.#ev.emit('control', m.action, at);
        break;
      case 'playback.start':
        if (this.#pending && this.#pending.t0 === undefined) this.#pending.t0 = typeof m.audibleAtUs === 'number' ? this.#wall(m.audibleAtUs) : at;
        break;
      case 'playback.end':
        if (m.reason === 'drained' && m.utteranceEnded !== true) break; // queue ran dry mid-utterance: keep waiting
        this.#settlePlayback(m.reason === 'drained', at);
        break;
      case 'exit':
        this.#ev.emit('closed', 'gnomon-voice-io exit event');
        break;
    }
  }

  play(chunk: { id: string; samples: Float32Array; sampleRate: number }): Promise<PlaybackResult> {
    if (this.#pending) return Promise.reject(new Error('#gnomon-voice: one chunk plays at a time'));
    return new Promise((resolve) => {
      this.#pending = { resolve };
      for (const f of encodePlayback(chunk.sampleRate, chunk.samples)) this.#child?.stdin?.write(f);
      void this.command('play.end').catch(() => undefined);
    });
  }

  stopPlayback(): void {
    if (this.#pending) void this.command('play.stop').catch(() => undefined);
  }

  async close(): Promise<void> {
    const c = this.#child;
    if (!c || c.exitCode !== null) return;
    this.#micOn = false; // duty 2: drop frames from the moment mic.off is sent
    await Promise.race([this.command('mic.off').catch(() => undefined), new Promise((r) => setTimeout(r, 500))]);
    c.stdin?.write(encodeFrame(FRAME_JSON, Buffer.from(JSON.stringify({ op: 'quit', id: 'quit' }))));
    c.stdin?.end();
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => (c.kill(), resolve()), 2000);
      c.once('exit', () => (clearTimeout(t), resolve()));
    });
  }
}
