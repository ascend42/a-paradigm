/**
 * @symbol #gnomon-voice
 *
 * The kernel-supervised voice client (voice slice V2e, T-2026-10-19-026; Aegis V2c must-dos 1, 2, 5, 7).
 *
 *   - The daemon SPAWNS `@a-company/gnomon-voice` (`run --fd 3`) as its own child and hands it fd 3, one end of a
 *     socketpair (Node's stdio 'pipe' is a unix socketpair). The kernel serves its end through
 *     SocketServerHandle.adopt and authenticates it as `p:<ns>/voice` itself (dispatcher.adoptPreauthenticated):
 *     the child holds no key, no socket path, no kernel pin and reads no connect file (connect.json is gone).
 *   - ALLOW-LIST env: a fixed PATH, HOME, LANG/LC_*, TMPDIR and GNOMON_HOME; everything else (NODE_OPTIONS, every
 *     other GNOMON_*, DYLD_*) is dropped. Node flags: only `--disable-sigusr1`.
 *   - Dies with the kernel: stdin is a pipe the child watches (its end ⇒ exit), stop() at daemon exit / drain is
 *     SIGTERM → grace → SIGKILL and AWAITED; it never carries over an upgrade (TD-2026-10-19-908).
 *   - Restarted on crash with exponential backoff (1 s doubling to 60 s, reset after 60 s of uptime); a human
 *     stop() ends the restarts.
 *   - prepare() (install the verified GnomonVoiceIO.app copy, fetch models) runs before every spawn and reports a
 *     GUI-visible phase (`installing`, `downloading-models{mb}`), so first start needs no terminal step.
 */
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type * as net from 'node:net';
import { DEFAULT_REEXEC_PATH, DISABLE_SIGUSR1 } from '../lifecycle/env.js';

export type VoiceChildPhase = 'stopped' | 'preparing' | 'installing' | 'downloading-models' | 'starting' | 'running' | 'backoff' | 'failed' | 'unavailable';

export interface VoiceChildStatus {
  /** explicit boolean: the spawned client's authenticated connection is up (status.voice.clientConnected) */
  clientConnected: boolean;
  phase: VoiceChildPhase;
  /** set by a human start, cleared by a human stop: the supervisor keeps the child up while true */
  wanted: boolean;
  restarts: number;
  /** model download in progress: total MB (an integer) */
  downloadMb?: number;
  /** a dev build running UNSIGNED (shown LOUD in the GUI) */
  devUnsigned: boolean;
  /** the last failure, plain words */
  lastError?: string;
  /** the client is not available on this machine (non-darwin, package missing) */
  unavailable?: string;
}

export interface VoicePrepared {
  /** absolute path of the verified gnomon-voice-io binary inside the installed app copy */
  ioBinary: string;
  devUnsigned: boolean;
  /** Aegis M2: the kernel's verified COPY of the client entry; the spawn runs this, never the workspace */
  clientEntry?: string;
}

export interface VoiceChildOptions {
  home: string;
  /** absolute path of the client entry (gnomon-voice dist/cli.js); null ⇒ unavailable with `unavailableReason` */
  clientEntry: string | null;
  unavailableReason?: string;
  execPath?: string;
  sourceEnv?: NodeJS.ProcessEnv;
  spawn: (cmd: string, args: string[], o: SpawnOptions) => ChildProcess;
  /** install + verify + models; `report` updates the GUI-visible phase. Throws a plain-words Error to refuse. */
  prepare: (report: (phase: 'installing' | 'downloading-models', mb?: number) => void) => Promise<VoicePrepared>;
  /** serve the kernel's end of the socketpair as a pre-authenticated voice connection; resolves its connId */
  attach: (sock: net.Socket) => Promise<string>;
  /** a status change (the GUI re-reads status) */
  onChange?: () => void;
  graceMs?: number;
  backoffMinMs?: number;
  backoffMaxMs?: number;
  /** uptime after which the backoff resets */
  stableMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => { clear(): void };
}

/** Exact env names the voice child keeps; LC_* by pattern. */
export const VOICE_CHILD_ENV_ALLOWLIST: readonly string[] = Object.freeze(['HOME', 'LANG', 'TMPDIR', 'USER', 'LOGNAME']);

export function voiceChildEnv(source: NodeJS.ProcessEnv, home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: DEFAULT_REEXEC_PATH, GNOMON_HOME: home };
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined) continue;
    if (VOICE_CHILD_ENV_ALLOWLIST.includes(k) || /^LC_[A-Z]+$/.test(k)) env[k] = v;
  }
  return env;
}

/** TD-2026-10-21-514: the capture kinds the human may start the client with (gnomon-voice run --capture) */
export const VOICE_CAPTURE_KINDS = ['ptt', 'open', 'toggle'] as const;
export type VoiceCaptureKind = (typeof VOICE_CAPTURE_KINDS)[number];

export function voiceChildArgs(entry: string, home: string, ioBinary: string, capture: VoiceCaptureKind | null = null): string[] {
  return [DISABLE_SIGUSR1, entry, 'run', '--fd', '3', '--home', home, '--io', ioBinary, ...(capture ? ['--capture', capture] : [])];
}

export const VOICE_BACKOFF_MIN_MS = 1_000;
export const VOICE_BACKOFF_MAX_MS = 60_000;
export const VOICE_STOP_GRACE_MS = 3_000;

export class VoiceChildSupervisor {
  readonly #o: VoiceChildOptions;
  #child: ChildProcess | null = null;
  #connId: string | null = null;
  #phase: VoiceChildPhase = 'stopped';
  #wanted = false;
  #restarts = 0;
  #backoff: number;
  #timer: { clear(): void } | null = null;
  #startedAt = 0;
  #downloadMb: number | undefined;
  #devUnsigned = false;
  #lastError: string | undefined;
  #unavailable: string | undefined;
  #closed = false;
  #exitWaiters: Array<() => void> = [];
  #starting: Promise<void> | null = null;

  constructor(o: VoiceChildOptions) {
    this.#o = o;
    this.#backoff = o.backoffMinMs ?? VOICE_BACKOFF_MIN_MS;
  }

  #now(): number {
    return (this.#o.now ?? Date.now)();
  }
  #set(phase: VoiceChildPhase): void {
    this.#phase = phase;
    this.#o.onChange?.();
  }
  #timerAfter(fn: () => void, ms: number): { clear(): void } {
    if (this.#o.setTimer) return this.#o.setTimer(fn, ms);
    const t = setTimeout(fn, ms);
    t.unref?.();
    return { clear: () => clearTimeout(t) };
  }

  /** The connId of the live voice connection (the kernel's end), or null. */
  get connId(): string | null {
    return this.#connId;
  }

  status(): VoiceChildStatus {
    return {
      clientConnected: this.#connId !== null,
      phase: this.#phase,
      wanted: this.#wanted,
      restarts: this.#restarts,
      devUnsigned: this.#devUnsigned,
      ...(this.#downloadMb !== undefined && this.#phase === 'downloading-models' ? { downloadMb: this.#downloadMb } : {}),
      ...(this.#lastError ? { lastError: this.#lastError } : {}),
      ...(this.#o.clientEntry === null ? { unavailable: this.#o.unavailableReason ?? 'the voice client is not installed' } : this.#unavailable ? { unavailable: this.#unavailable } : {}),
    };
  }

  /** TD-2026-10-21-514: the capture kind the next spawn runs with (null = the client's default) */
  #capture: VoiceCaptureKind | null = null;

  /**
   * A human start (or an auto-start on attach): keep the client up. Idempotent. A start naming ANOTHER capture kind
   * restarts a running client with it (the GUI's preset / Mic key toggle choice).
   */
  async start(capture?: VoiceCaptureKind): Promise<VoiceChildStatus> {
    if (capture !== undefined && capture !== this.#capture) {
      this.#capture = capture;
      if (this.#child || this.#starting) await this.stop();
    }
    return this.#startNow();
  }

  #startNow(): Promise<VoiceChildStatus> {
    if (this.#closed) return Promise.resolve(this.status());
    if (this.#o.clientEntry === null) {
      this.#lastError = this.#o.unavailableReason ?? 'the voice client is not installed';
      this.#set('failed');
      return Promise.resolve(this.status());
    }
    this.#wanted = true;
    if (!this.#child && !this.#starting && !this.#timer) this.#starting = this.#spawn().finally(() => (this.#starting = null));
    return (this.#starting ?? Promise.resolve()).then(() => this.status());
  }

  /** A human stop: end the child and every restart. */
  async stop(): Promise<VoiceChildStatus> {
    this.#wanted = false;
    this.#timer?.clear();
    this.#timer = null;
    await this.#starting?.catch(() => undefined);
    await this.#kill();
    this.#set('stopped');
    return this.status();
  }

  /** Daemon exit / drain: stop and never restart again (TD-908: it never carries over). */
  async close(): Promise<void> {
    this.#closed = true;
    await this.stop();
  }

  /** The kernel's end of the voice connection closed (dispatcher onDisconnect). */
  connectionClosed(connId: string): void {
    if (this.#connId === connId) {
      this.#connId = null;
      this.#o.onChange?.();
    }
  }

  async #spawn(): Promise<void> {
    this.#set('preparing');
    let prepared: VoicePrepared;
    try {
      prepared = await this.#o.prepare((phase, mb) => {
        this.#downloadMb = mb;
        this.#set(phase);
      });
    } catch (e) {
      // a refusal to install (unsigned, mismatched requirement, bad model hash) is not retried by backoff;
      // a client copy that no longer matches the kernel's pin (Aegis M2) is 'unavailable', with the reason
      this.#lastError = e instanceof Error ? e.message : String(e);
      this.#wanted = false;
      if (e instanceof Error && e.name === 'VoiceClientRefused') {
        this.#unavailable = this.#lastError;
        this.#set('unavailable');
      } else this.#set('failed');
      return;
    }
    this.#downloadMb = undefined;
    this.#unavailable = undefined;
    this.#devUnsigned = prepared.devUnsigned;
    if (!this.#wanted || this.#closed) return void this.#set('stopped');
    this.#set('starting');
    const child = this.#o.spawn(this.#o.execPath ?? process.execPath, voiceChildArgs(prepared.clientEntry ?? this.#o.clientEntry!, this.#o.home, prepared.ioBinary, this.#capture), {
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      env: voiceChildEnv(this.#o.sourceEnv ?? process.env, this.#o.home),
      cwd: this.#o.home,
      detached: false,
    });
    this.#child = child;
    this.#startedAt = this.#now();
    child.stdout?.resume();
    let tail = '';
    child.stderr?.on('data', (b: Buffer) => void (tail = `${tail}${b.toString('utf8')}`.slice(-2000)));
    child.once('exit', (code, signal) => {
      if (this.#child !== child) return;
      this.#child = null;
      const waiters = this.#exitWaiters;
      this.#exitWaiters = [];
      for (const w of waiters) w();
      if (!this.#wanted || this.#closed) return;
      const last = tail.trim().split('\n').at(-1);
      this.#lastError = `the voice app stopped (${signal ?? `exit ${code}`})${last ? `: ${last.slice(0, 300)}` : ''}`;
      if (this.#now() - this.#startedAt >= (this.#o.stableMs ?? 60_000)) this.#backoff = this.#o.backoffMinMs ?? VOICE_BACKOFF_MIN_MS;
      const wait = this.#backoff;
      this.#backoff = Math.min(this.#backoff * 2, this.#o.backoffMaxMs ?? VOICE_BACKOFF_MAX_MS);
      this.#restarts++;
      this.#set('backoff');
      this.#timer = this.#timerAfter(() => {
        this.#timer = null;
        if (this.#wanted && !this.#closed && !this.#child) this.#starting = this.#spawn().finally(() => (this.#starting = null));
      }, wait);
    });
    child.on('error', (e) => void (this.#lastError = e.message));
    const sock = child.stdio[3] as net.Socket | null | undefined;
    if (!sock) {
      this.#lastError = 'the voice app has no kernel link';
      await this.#kill();
      return void this.#set('failed');
    }
    try {
      this.#connId = await this.#o.attach(sock);
    } catch (e) {
      this.#lastError = e instanceof Error ? e.message : String(e);
      await this.#kill();
      return void this.#set('failed');
    }
    this.#set('running');
  }

  async #kill(): Promise<void> {
    const child = this.#child;
    if (!child) return;
    const gone = new Promise<void>((resolve) => this.#exitWaiters.push(resolve));
    child.stdin?.end(); // the child exits on stdin end
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
    const t = this.#timerAfter(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* gone */
      }
    }, this.#o.graceMs ?? VOICE_STOP_GRACE_MS);
    await gone;
    t.clear();
    this.#connId = null;
  }
}
