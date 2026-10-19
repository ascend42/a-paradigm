/**
 * @symbol $daemon-lifecycle
 *
 * $daemon-lifecycle (spec §2.4 rule 2) — the readiness handshake.
 *
 * The activator spawns the detached kernel with one extra inherited pipe
 * (`--ready-fd 3`). Once the kernel holds the lock and serves its socket it
 * writes exactly one line, `gnomonReady:v1 {pid, startedAt, socketPath,
 * kernelPrincipal}`, on that fd and closes it. The activator keeps a bounded
 * tail of the child's stderr, so a kernel that dies before ready is reported
 * with its own words and its classified exit code (exit-codes.ts) — no more
 * 5 × 200 ms socket polling and "did not come up".
 *
 * Losing the race is not an error: two activators that both saw no socket
 * both spawn; one child wins the pidfile lock, the other exits `superseded`.
 * The losing activator then attaches to the winner's socket and reports
 * `attached`. Only when no winner answers in time is it a (transient) fault.
 *
 * Fallback (the Windows named-pipe path, or a kernel that cannot write the fd):
 * if the ready pipe closes without a line while the child is alive, or the
 * deadline passes, the socket is probed once; a live socket is `attached`.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import { canConnectSocket } from './endpoint.js';
import { cleanReexecEnv, reexecArgs, type DetachOptions } from './env.js';
import { classifyExitCode, DAEMON_EXIT, type DaemonExitClass, type DaemonExitCode } from './exit-codes.js';

export const DAEMON_READY_SCHEMA = 'gnomonReady:v1' as const;

/** The fd number the activator hands the kernel for its ready line (stdio slot 3). */
export const READY_FD = 3;

export interface DaemonReadyIdentity {
  schemaVersion: typeof DAEMON_READY_SCHEMA;
  pid: number;
  startedAt: string;
  socketPath: string;
  kernelPrincipal: string;
}

/** Kernel side: write the ready line on `fd` and close it. Never throws (a gone reader is not the kernel's fault). */
export function writeReady(fd: number, identity: Omit<DaemonReadyIdentity, 'schemaVersion'>): boolean {
  const line = `${JSON.stringify({ schemaVersion: DAEMON_READY_SCHEMA, ...identity } satisfies DaemonReadyIdentity)}\n`;
  let ok = true;
  try {
    fs.writeSync(fd, line);
  } catch {
    ok = false;
  }
  try {
    fs.closeSync(fd);
  } catch {
    /* already closed */
  }
  return ok;
}

export function parseReadyLine(line: string): DaemonReadyIdentity | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (r.schemaVersion !== DAEMON_READY_SCHEMA) return null;
  if (!Number.isInteger(r.pid) || typeof r.startedAt !== 'string' || typeof r.socketPath !== 'string' || typeof r.kernelPrincipal !== 'string') return null;
  return r as unknown as DaemonReadyIdentity;
}

/** Last `maxBytes` of a byte stream (the child's stderr). Older bytes are dropped and counted. */
export class BoundedTail {
  private chunks: Buffer[] = [];
  private size = 0;
  dropped = 0;
  constructor(readonly maxBytes = 8192) {}
  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size > this.maxBytes && this.chunks.length > 0) {
      const head = this.chunks[0]!;
      const over = this.size - this.maxBytes;
      if (head.length <= over) {
        this.chunks.shift();
        this.size -= head.length;
        this.dropped += head.length;
      } else {
        this.chunks[0] = head.subarray(over);
        this.size -= over;
        this.dropped += over;
      }
    }
  }
  text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

export type LaunchOutcome =
  | { kind: 'ready'; identity: DaemonReadyIdentity }
  /** Lost the race (or no ready line, Windows fallback): another kernel answers on the socket. */
  | { kind: 'attached'; socketPath: string; via: 'superseded' | 'no-ready-line' | 'socket-probe' }
  /** The child exited before ready and no winner answers. */
  | { kind: 'exited'; code: number | null; signal: NodeJS.Signals | null; class: DaemonExitClass; stderrTail: string }
  /** Still not ready at the deadline and no socket answers; the child is left running. */
  | { kind: 'timeout'; pid: number | undefined; stderrTail: string };

export interface LaunchOptions extends DetachOptions {
  socketPath: string;
  /** Deadline for the ready line (default 15 s: a cold start opens the hardware identity). */
  timeoutMs?: number;
  /** How long a superseded launcher waits for the winner's socket (default 5 s). */
  attachWaitMs?: number;
  /** stderr tail bound (default 8 KiB). */
  tailBytes?: number;
  /** Test seam: the spawn. */
  spawnChild?: (execPath: string, args: string[], env: Record<string, string>) => ChildProcess;
}

/** Probe the socket every 50 ms until it answers or `ms` pass (attach to a winner still binding). */
function waitForSocket(socketPath: string, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  return new Promise((resolve) => {
    const probe = (): void => {
      void canConnectSocket(socketPath).then((up) => {
        if (up) resolve(true);
        else if (Date.now() >= deadline) resolve(false);
        else setTimeout(probe, 50);
      });
    };
    probe();
  });
}

function defaultSpawn(execPath: string, args: string[], env: Record<string, string>): ChildProcess {
  return spawn(execPath, args, { detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe'], env });
}

/** Activator side: spawn the detached kernel and wait for its ready line (or its classified exit). */
export function launchDaemon(opts: LaunchOptions): Promise<LaunchOutcome> {
  const args = reexecArgs({ ...opts, readyFd: READY_FD });
  const env = cleanReexecEnv(opts.sourceEnv ?? process.env, opts.path !== undefined ? { path: opts.path } : {});
  const child = (opts.spawnChild ?? defaultSpawn)(opts.execPath, args, env);
  const tail = new BoundedTail(opts.tailBytes);
  const stderr = child.stdio[2] as NodeJS.ReadableStream | null;
  const readyStream = child.stdio[READY_FD] as NodeJS.ReadableStream | null;

  return new Promise<LaunchOutcome>((resolve) => {
    let settled = false;
    let readyBuf = '';
    let timer: NodeJS.Timeout | undefined;
    const release = (): void => {
      if (timer) clearTimeout(timer);
      (stderr as unknown as { destroy?: () => void } | null)?.destroy?.();
      (readyStream as unknown as { destroy?: () => void } | null)?.destroy?.();
      child.removeAllListeners('exit');
      child.unref();
    };
    const settle = (o: LaunchOutcome): void => {
      if (settled) return;
      settled = true;
      release();
      resolve(o);
    };
    const probeThen = (orElse: () => LaunchOutcome, via: 'no-ready-line' | 'socket-probe'): void => {
      void canConnectSocket(opts.socketPath).then((up) => settle(up ? { kind: 'attached', socketPath: opts.socketPath, via } : orElse()));
    };

    stderr?.on('data', (c: Buffer) => tail.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))));
    stderr?.on('error', () => undefined);
    readyStream?.on('error', () => undefined);
    readyStream?.on('data', (c: Buffer) => {
      readyBuf += c.toString('utf8');
      const nl = readyBuf.indexOf('\n');
      if (nl === -1) return;
      const identity = parseReadyLine(readyBuf.slice(0, nl));
      if (identity && identity.pid === child.pid) settle({ kind: 'ready', identity });
      // a malformed or foreign line is ignored: the exit or the deadline decides
    });
    readyStream?.on('end', () => {
      if (settled || child.exitCode !== null || child.signalCode !== null) return;
      // the pipe closed without a line while the child lives (no fd 3 on this platform): fall back to one probe after a beat
      setTimeout(() => {
        if (!settled && child.exitCode === null && child.signalCode === null) {
          void waitForSocket(opts.socketPath, opts.timeoutMs ?? 15_000).then((up) =>
            settle(up ? { kind: 'attached', socketPath: opts.socketPath, via: 'no-ready-line' } : { kind: 'timeout', pid: child.pid, stderrTail: tail.text() }),
          );
        }
      }, 100);
    });
    child.once('error', (err) => {
      tail.push(Buffer.from(`spawn failed: ${err.message}\n`));
      settle({ kind: 'exited', code: null, signal: null, class: 'internal', stderrTail: tail.text() });
    });
    child.once('exit', (code, signal) => {
      if (settled) return;
      const cls = classifyExitCode(code);
      // let the last stderr bytes drain before judging
      setTimeout(() => {
        if (settled) return;
        const exited = (): LaunchOutcome => ({ kind: 'exited', code, signal, class: cls, stderrTail: tail.text() });
        if (cls === 'superseded' || cls === 'transient') {
          // a lost lock race (or a racer mid-bind): the winner may still be binding its socket
          void waitForSocket(opts.socketPath, opts.attachWaitMs ?? 5000).then((up) =>
            settle(up ? { kind: 'attached', socketPath: opts.socketPath, via: cls === 'superseded' ? 'superseded' : 'socket-probe' } : exited()),
          );
        } else settle(exited());
      }, 20);
    });
    timer = setTimeout(() => probeThen(() => ({ kind: 'timeout', pid: child.pid, stderrTail: tail.text() }), 'socket-probe'), opts.timeoutMs ?? 15_000);
  });
}

/** The activator's own exit code for an outcome (`gnomon daemon --detach`, plain `gnomond`). */
export function exitCodeOfLaunch(o: LaunchOutcome): DaemonExitCode {
  switch (o.kind) {
    case 'ready':
    case 'attached':
      return DAEMON_EXIT.ok;
    case 'timeout':
      return DAEMON_EXIT.transient;
    case 'exited':
      switch (o.class) {
        case 'ok': // exited 0 before ready: it never served
        case 'transient':
          return DAEMON_EXIT.transient;
        case 'superseded':
          return DAEMON_EXIT.transient; // no winner answered
        case 'config':
          return DAEMON_EXIT.config;
        case 'internal':
          return DAEMON_EXIT.internal;
      }
  }
}
