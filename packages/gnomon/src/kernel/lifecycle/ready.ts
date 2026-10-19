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
 * if the ready pipe closes without a line while the child is alive, the socket
 * is probed until the GLOBAL deadline; a kernel that answers is `attached`.
 * At the deadline the socket is probed once more, but an answer from OUR OWN
 * child (the pidfile names it: it bound the socket and never wrote ready) is
 * `timeout`, not `attached`. "Answers" is a short-deadline `hello` RPC, not a
 * bare connect: something that merely accepts connections is not a kernel.
 * Every probe loop stops the moment the launch settles.
 *
 * The ready line is bounded (READY_LINE_MAX, 4 KiB): more bytes without a
 * newline, a line that does not parse, a pid that is not our child or a
 * socketPath that is not the one we asked for is a malformed ready and is
 * ignored (noted in the stderr tail); the exit or the deadline decides.
 *
 * TRUST (Aegis M2): the ready line is an UNAUTHENTICATED hint from a process
 * we just spawned. `kernelPrincipal` from it must NEVER be pinned or treated
 * as an identity: only M1.4 mutual auth (hello serverSig + auth) authenticates
 * the kernel. The kernel seals the inherited fd at startup (sealReadyFd) so a
 * child it spawns before ready (the identity helper, the web transport)
 * cannot write a forged line: the fd is re-opened through /dev/fd with
 * O_CLOEXEC (Node always adds it) and the inheritable one closed. On Linux it
 * stays inheritable (a socketpair: see sealReadyFd's RESIDUAL); macOS libuv spawns with POSIX_SPAWN_CLOEXEC_DEFAULT, so unlisted fds
 * never reach a child (verified), and the same re-open via /dev/fd is applied
 * as belt and braces. RESIDUAL (Windows): the inherited handle stays
 * inheritable to the kernel's own children until writeReady closes it; Node
 * has no SetHandleInformation. Tracked for the Windows parity phase (P8-D78).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import { newClientNonce, rpcCall } from '../socket/client.js';
import { GNOMON_VERSION } from '../../version.js';
import { readPidfile } from './pidfile.js';
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

/** The ready line's byte bound: more without a newline is a malformed ready (Aegis L4). */
export const READY_LINE_MAX = 4096;

/** Per-attempt deadline of the `hello` probe. */
export const HELLO_PROBE_MS = 1000;

/**
 * Kernel side, FIRST thing at startup (before anything is spawned): make the
 * inherited ready fd close-on-exec so no child of the kernel can write a
 * forged ready line. Returns the fd to write to later, or null when it could
 * not be sealed: the fd is then closed (no line beats a forgeable line) and
 * the activator falls back to probing the socket. win32 returns `fd` as is
 * (residual, see the header).
 *
 * RESIDUAL (Linux): libuv hands stdio 'pipe' slots over as an AF_UNIX
 * socketpair, and /proc/self/fd/N cannot re-open a socket (ENXIO), so on Linux
 * the fd stays inheritable like win32 (CI 39222038624: closing it turned every
 * ready into a socket-probe attach). The activator still pins pid + socketPath,
 * and nothing trusts the ready identity (only M1.4 mutual auth does). A
 * private FIFO in place of the socketpair is the follow-up (T-2026-10-19-011).
 * macOS /dev/fd/N has dup semantics, so the re-open works there for sockets too.
 */
export function sealReadyFd(fd: number, platform: NodeJS.Platform = process.platform): number | null {
  if (platform === 'win32') return fd;
  if (platform === 'linux') {
    try {
      if (fs.fstatSync(fd).isSocket()) return fd;
    } catch {
      return null; // not open: nothing to write to
    }
  }
  const via = platform === 'linux' ? `/proc/self/fd/${fd}` : `/dev/fd/${fd}`;
  try {
    // O_NONBLOCK: opening a pipe whose reader is gone fails (ENXIO) instead of blocking
    const sealed = fs.openSync(via, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
    fs.closeSync(fd);
    return sealed;
  } catch {
    try {
      fs.closeSync(fd);
    } catch {
      /* already closed */
    }
    return null;
  }
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
  /** Test seam: does a kernel answer on the socket (default: helloProbe). */
  probeSocket?: (socketPath: string) => Promise<boolean>;
  /** Test seam: the pid the pidfile names as the lock holder (default: readPidfile(home)). */
  lockHolderPid?: () => number | null;
}

/** Does a gnomon kernel answer `hello` on the socket within `ms`? (A bare connect only proves something accepts.) */
export async function helloProbe(socketPath: string, ms = HELLO_PROBE_MS): Promise<boolean> {
  try {
    const r = await rpcCall(
      socketPath,
      'hello',
      { clientApis: ['gnomon-rpc:v1'], features: [], clientNonce: newClientNonce(), client: { name: 'gnomon-activator', version: GNOMON_VERSION, surface: 'cli' } },
      { timeoutMs: ms },
    );
    return 'result' in r;
  } catch {
    return false;
  }
}

/** Probe every 50 ms until it answers, `ms` pass, or `stopped()` (the launch settled: never outlive it). */
function waitForSocket(probe: () => Promise<boolean>, ms: number, stopped: () => boolean): Promise<boolean> {
  const deadline = Date.now() + ms;
  return new Promise((resolve) => {
    const tick = (): void => {
      if (stopped()) return resolve(false);
      void probe().then((up) => {
        if (up) resolve(true);
        else if (stopped() || Date.now() >= deadline) resolve(false);
        else setTimeout(tick, 50);
      });
    };
    tick();
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
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const deadline = Date.now() + timeoutMs;
  const probe = (): Promise<boolean> => (opts.probeSocket ?? helloProbe)(opts.socketPath);
  const lockHolder = opts.lockHolderPid ?? ((): number | null => readPidfile(opts.home)?.pid ?? null);

  return new Promise<LaunchOutcome>((resolve) => {
    let settled = false;
    let readyBuf = '';
    let readyDone = false; // the first line (or an overflow) was judged; later bytes are ignored
    let noReadyLine = false;
    let timer: NodeJS.Timeout | undefined;
    const stopped = (): boolean => settled;
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
    const timedOut = (): LaunchOutcome => ({ kind: 'timeout', pid: child.pid, stderrTail: tail.text() });
    const rejectReady = (why: string): void => {
      readyDone = true;
      readyBuf = '';
      tail.push(Buffer.from(`activator: ready line rejected: ${why}\n`));
    };

    stderr?.on('data', (c: Buffer) => tail.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))));
    stderr?.on('error', () => undefined);
    readyStream?.on('error', () => undefined);
    readyStream?.on('data', (c: Buffer) => {
      if (readyDone || settled) return;
      readyBuf += c.toString('utf8');
      const nl = readyBuf.indexOf('\n');
      if (nl === -1) {
        if (Buffer.byteLength(readyBuf) > READY_LINE_MAX) rejectReady(`more than ${READY_LINE_MAX} bytes without a newline`);
        return;
      }
      const line = readyBuf.slice(0, nl);
      if (Buffer.byteLength(line) > READY_LINE_MAX) return rejectReady(`longer than ${READY_LINE_MAX} bytes`);
      const identity = parseReadyLine(line);
      if (!identity) return rejectReady('malformed');
      if (identity.pid !== child.pid) return rejectReady(`pid ${identity.pid} is not the spawned child ${child.pid ?? '?'}`);
      if (identity.socketPath !== opts.socketPath) return rejectReady(`socketPath ${JSON.stringify(identity.socketPath)} is not the expected ${JSON.stringify(opts.socketPath)}`);
      readyDone = true;
      settle({ kind: 'ready', identity });
      // a rejected line is not an outcome: the exit or the deadline decides
    });
    readyStream?.on('end', () => {
      if (settled || readyDone || child.exitCode !== null || child.signalCode !== null) return;
      // the pipe closed without a line while the child lives (no fd 3 on this platform, or the kernel could not seal it):
      // after a beat, probe until the GLOBAL deadline, never past it
      setTimeout(() => {
        if (settled || child.exitCode !== null || child.signalCode !== null) return;
        noReadyLine = true;
        void waitForSocket(probe, Math.max(0, deadline - Date.now()), stopped).then((up) => {
          if (up) settle({ kind: 'attached', socketPath: opts.socketPath, via: 'no-ready-line' });
        });
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
          void waitForSocket(probe, opts.attachWaitMs ?? 5000, stopped).then((up) =>
            settle(up ? { kind: 'attached', socketPath: opts.socketPath, via: cls === 'superseded' ? 'superseded' : 'socket-probe' } : exited()),
          );
        } else settle(exited());
      }, 20);
    });
    timer = setTimeout(() => {
      if (settled) return;
      void probe().then((up) => {
        if (!up) return settle(timedOut());
        // our own live child bound the socket but never wrote ready: that is a timeout, not an attach
        // (the pidfile is only used to downgrade, the safe direction). In no-ready-line mode the child is expected to own it.
        const ours = child.exitCode === null && child.signalCode === null && child.pid !== undefined && lockHolder() === child.pid;
        if (ours && !noReadyLine) return settle(timedOut());
        settle({ kind: 'attached', socketPath: opts.socketPath, via: noReadyLine ? 'no-ready-line' : 'socket-probe' });
      });
    }, timeoutMs);
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
