/**
 * @symbol #dev-launch
 * @symbol #gnomon-up
 * @symbol #wrapper-channel
 *
 * The in-process launcher shared by `gnomon dev up` (#dev-launch) and
 * `gnomon up` (#gnomon-up): a kernel started in THIS process, the CLI's own
 * device connection to it, and the terminal loop around the §11.2 launch.
 *
 * ONE copy of the launch rules:
 *   - the launch URL (it carries a single-use, 60 s token) is printed ONLY
 *     to an interactive terminal: never to a pipe, a file or a log. Without
 *     a TTY (#gui-relaunch, T-2026-10-20-001) it goes to the browser opener
 *     only (osascript's stdin) and is never printed; with neither a TTY nor
 *     an opener (checked BEFORE minting) no endpoint starts and no token
 *     exists;
 *   - the stop path is armed before anything else can throw or wait;
 *     SIGINT / SIGTERM / SIGHUP / `q` stop, and the handlers stay installed
 *     while stopping (a repeat is ignored, never the default kill); any
 *     other line on a TTY mints a fresh URL;
 *   - a failing stop is reported (exit 1), never an unhandled rejection.
 * Each caller decides its own home and identity guards before it gets here;
 * nothing in this module chooses a home, a root or a key. Writes plain text
 * to the streams it is given (zero deps, G-SEC-01; readout.ts voice).
 */
import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { DISABLE_SIGUSR1, isLifecycleRefusal, selectSocketPath, sigusr1Refusal, type DaemonHandle } from '../kernel/lifecycle/index.js';
import type { LaunchGrant } from '../kernel/web/endpoint.js';
import { LAUNCH_GRANT_CAP } from '../kernel/web/launch-cap.js';
import { GnomonClient, type ClientCredential, type KernelKeyPin } from '../clients/ts/index.js';
import { GNOMON_VERSION } from '../version.js';
import { readout, refused } from './readout.js';
import { presentUrl, type BrowserOpener, type OpenResult } from './open-browser.js';

type Out = { write(s: string): unknown; isTTY?: boolean; on?(ev: 'error', l: (e: Error) => void): unknown };
export interface LaunchTtyIo {
  stdin: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: unknown };
  stdout: Out;
  stderr: Out;
}

/** The Node runtime the in-process kernel would inherit: the env and the interpreter flags of THIS process. */
export interface RuntimeFacts {
  env: Readonly<Record<string, string | undefined>>;
  execArgv: readonly string[];
}

/**
 * Aegis C1 (round 2): an in-process kernel holds the keys in THIS Node process, which gnomond's clean
 * re-exec (§2.4 rule 2) would have scrubbed. So refuse, rather than inherit, anything that loads code
 * or opens a debugger in it: a non-empty NODE_OPTIONS, and ANY interpreter flag (process.execArgv —
 * --inspect*, --require, --import, --loader, …) except exactly one, `--disable-sigusr1`, which is
 * REQUIRED (T-2026-10-18-030 (1)): without it a same-user `kill -USR1` opens the V8 inspector at run
 * time, past every check here. The bin's shebang (`#!/usr/bin/env -S node --disable-sigusr1`) passes
 * it. Returns the refusal message, or null when clean.
 * Refusing (not re-executing) is deliberate: no second process ever holds the helper or the keys.
 *
 * Scope (spec §2.4 C1): this defends against an AMBIENT unsafe runtime (an exported NODE_OPTIONS, a
 * stray flag). It does not defend against a hostile preload already running as the user, which can
 * scrub env and execArgv before this check reads them.
 */
export function unsafeRuntime(r: RuntimeFacts = { env: process.env, execArgv: process.execArgv }): string | null {
  const why: string[] = [];
  if (r.env.NODE_OPTIONS !== undefined && r.env.NODE_OPTIONS.trim() !== '') why.push('NODE_OPTIONS is set');
  const other = r.execArgv.filter((a) => a !== DISABLE_SIGUSR1);
  if (other.length > 0) why.push(`node was started with interpreter flags (${other.length})`);
  if (r.execArgv.length - other.length > 1) why.push(`${DISABLE_SIGUSR1} was given more than once`);
  if (sigusr1Refusal(r.execArgv)) why.push(`node was started without ${DISABLE_SIGUSR1} (a same-user SIGUSR1 would open the V8 inspector)`);
  return why.length ? `${why.join('; ')}: the kernel would run inside the process that holds its keys` : null;
}

/** A kernel running in THIS process, with the CLI's own device connection held open. */
export interface InProcessKernel {
  readonly handle: DaemonHandle;
  readonly client: GnomonClient;
  /** The §11.2 `gnomon open` path, in-process: start the web endpoint if needed and mint a single-use, 60 s launch token for this device connection. */
  launch(): Promise<LaunchGrant>;
  stop(): Promise<void>;
}

/**
 * Connect to a kernel this process just started, as `credential`, with the
 * kernel key pinned (serverSig verified before the device signs anything),
 * and wrap it as an InProcessKernel. A failure here shuts the kernel down
 * (`error`) and rethrows: no kernel is left running without its launcher.
 */
export async function attachInProcess(handle: DaemonHandle, o: { home: string; clientName: string; kernelKey: KernelKeyPin; credential: ClientCredential }): Promise<InProcessKernel> {
  try {
    const sock = selectSocketPath({ home: o.home });
    if (!sock.ok) throw new Error(`no safe endpoint path: ${sock.reason}`);
    const client = await GnomonClient.connect({ socketPath: sock.path, client: { name: o.clientName, version: GNOMON_VERSION, surface: 'cli' }, kernelKey: o.kernelKey, credential: o.credential });
    return {
      handle,
      client,
      launch: () => handle.requestWebLaunch(client.connId!),
      stop: async () => {
        await client.close().catch(() => undefined);
        await handle.shutdown('signal');
      },
    };
  } catch (e) {
    await handle.shutdown('error').catch(() => undefined);
    throw e;
  }
}

/**
 * Print a launch URL — only to an interactive terminal: the token never lands in a pipe, a file or a log.
 * With an opener (open-browser.ts, spec §2.4 rule 10) the URL is also handed to the default browser on
 * osascript's STDIN (never argv or env), and stays printed below `opened in your browser` as the fallback.
 */
export async function printLaunch(k: Pick<InProcessKernel, 'launch'>, io: LaunchTtyIo, keysHint: string, urlSuffix = '', opener: BrowserOpener | null = null): Promise<boolean> {
  if (io.stdout.isTTY !== true) {
    // checked BEFORE minting: with no terminal and no browser opener there is nothing to hand the URL to, so no
    // endpoint is started and no token exists
    if (!opener) {
      io.stdout.write(`  gui     ${NO_TTY_NO_OPEN}\n`);
      return false;
    }
    // T-2026-10-20-001 #gui-relaunch: a start without a terminal (nohup, a script, a detached kernel) still opens the
    // GUI. The URL goes ONLY to the opener (osascript's STDIN, open-browser.ts): it is never written to this stdout,
    // which may be a pipe, a file or a log
    const g = await k.launch();
    let r: OpenResult;
    try {
      r = await opener(`${g.url}${urlSuffix}`);
    } catch (e) {
      r = { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
    io.stdout.write(r.ok ? `  gui     ${NO_TTY_OPENED}\n` : `  gui     ${noTtyOpenFailed(r.reason)}\n`);
    return r.ok;
  }
  const g = await k.launch();
  // #bare-entry: urlSuffix is a fragment-only hint (`&cwd=<base64url>`, built by bare-cli.ts): it rides after the
  // token in the SAME line, never a second copy of the token, and a fragment is never sent to the server
  await presentUrl(io.stdout, `${g.url}${urlSuffix}`, opener, 'open this in your browser within 60 s (single use)');
  io.stdout.write(`\n  ${keysHint}\n`);
  return true;
}

/** #gui-relaunch: the no-terminal lines (no URL in any of them: stdout may be a pipe, a file or a log). */
export const NO_TTY_OPENED = 'opened in your default browser (no terminal here, so the single-use launch URL is not printed)';
export const NO_TTY_NO_OPEN = 'not opened: auto-open is off (--no-open or GNOMON_NO_OPEN) and the launch URL is printed only to an interactive terminal (it carries a single-use token). Open Gnomon.app, or run `gnomon` in a terminal';
export function noTtyOpenFailed(reason: string): string {
  return `not opened: could not open your browser (${reason}). Open Gnomon.app, or run \`gnomon\` in a terminal (the launch URL is printed only there)`;
}

/** The signals that stop an in-process kernel (SIGHUP: the terminal went away). */
export const STOP_SIGNALS: readonly NodeJS.Signals[] = Object.freeze(['SIGINT', 'SIGTERM', 'SIGHUP']);

export interface ServeOptions {
  /** The refusal code word (`dev`, `up`). */
  code: string;
  /** What is up, e.g. `dev kernel` / `kernel` (UP / STOPPING / DOWN lines). */
  noun: string;
  /** The readout printed after UP. */
  rows: ReadonlyArray<readonly [string, string | number]>;
  /** The line under the URL (which keys do what). */
  keysHint: string;
  /** #bare-entry: a fragment-only suffix appended to every terminal launch URL (`&cwd=<base64url>`); never on the wrapper channel. */
  urlSuffix?: string;
  /** Auto-open (spec §2.4 rule 10): hand each terminal launch URL to the default browser; null/absent = print only. Never on the wrapper channel. */
  opener?: BrowserOpener | null;
}

/**
 * Serve an in-process kernel from the terminal until it exits: UP + readout,
 * the first launch URL, then Enter = a fresh URL, `q` / Ctrl-C = stop.
 * Returns 0, or 1 when the stop itself failed.
 */
export async function serveInProcess(k: InProcessKernel, io: LaunchTtyIo, o: ServeOptions): Promise<number> {
  // the stop path is armed FIRST, before anything else can throw or wait
  let stopping = false;
  let stopFailed = false;
  let stopped: Promise<void> = Promise.resolve();
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    io.stdout.write(`STOPPING  ${o.noun}\n`);
    stopped = k.stop().catch((e: unknown) => {
      stopFailed = true;
      refused(io.stderr, o.code, 'stop-failed', e instanceof Error ? e.message : String(e), ['the kernel may still hold its pidfile; check `gnomon daemon status --home <home>`']);
    });
  };
  // kept installed for the whole run: a repeat while stopping is ignored (stop() is idempotent), never the
  // default kill that would skip the child sweep and the helper close; SIGHUP (terminal closed) stops the same way
  const onSignal = (): void => stop();
  for (const s of STOP_SIGNALS) process.on(s, onSignal);
  // T-2026-10-18-030 (4): after SIGHUP the terminal is gone and a write to it fails EIO, emitted as a stream
  // 'error'. Unhandled, that throws out of the event loop and skips the shutdown sweep (children, helper close).
  // So a write error on either stream is swallowed and treated as a stop: nothing is left to show it on.
  // The listeners stay installed after the kernel exits (the DOWN line can itself fail EIO a tick later);
  // once it has exited they only swallow.
  let exited = false;
  const onStreamError = (): void => {
    if (!exited) stop();
  };
  io.stdout.on?.('error', onStreamError);
  io.stderr.on?.('error', onStreamError);
  io.stdout.write(`UP  ${o.noun} (in this process)\n`);
  readout(io.stdout, o.rows);
  try {
    await printLaunch(k, io, o.keysHint, o.urlSuffix, o.opener ?? null);
  } catch (e) {
    refused(io.stderr, o.code, 'web-launch', e instanceof Error ? e.message : String(e), ['the kernel stays up for socket clients; Ctrl-C to stop']);
  }
  let rl: readline.Interface | null = null;
  if (io.stdin.isTTY === true) {
    rl = readline.createInterface({ input: io.stdin, terminal: false });
    let presenting = false; // one fresh URL at a time: holding Enter does not fan out tabs (Aegis L1)
    rl.on('line', (l) => {
      if (l.trim() === 'q') stop();
      else if (!presenting) {
        presenting = true;
        void printLaunch(k, io, o.keysHint, o.urlSuffix, o.opener ?? null)
          .catch((e: unknown) => refused(io.stderr, o.code, 'web-launch', e instanceof Error ? e.message : String(e)))
          .finally(() => {
            presenting = false;
          });
      }
    });
  }
  const reason = await k.handle.exited;
  exited = true;
  await stopped; // a stop that rejects after the kernel exited is still reported
  rl?.close();
  for (const s of STOP_SIGNALS) process.off(s, onSignal);
  io.stdout.write(`DOWN  ${o.noun} (${reason})\n`);
  return stopFailed ? 1 : 0;
}

/* ── the wrapper channel (#gnomon-wrapper, spec §11.1, §11.2 rule 2; M1.13) ─────────────────── */

/**
 * `--wrapper`: the parent is the desktop wrapper (Gnomon.app), which spawned
 * this process with a clean env and holds BOTH ends of its stdio pipes. The
 * channel is newline-delimited JSON (`gnomon-wrapper-channel:v1`):
 *   child → wrapper, on stdout:  {v:1,t:'up'} · {v:1,t:'launch',port,launchToken,kernelPublicKey,bundleHash,expiresAt}
 *                                · {v:1,t:'launch-failed',message} · {v:1,t:'refused',code,reason,message,next} · {v:1,t:'down',reason}
 *   wrapper → child, on stdin:   `launch` (mint a fresh single-use token) · `quit`; EOF = quit (the wrapper went away)
 * The token travels ONLY on that pipe: never argv, never env, never a file,
 * never a log line. The human-readable lines go to stderr.
 * A stdout or stdin that is a terminal or a regular file is refused
 * (`wrapper-channel`): the channel is a pipe or a socket the parent holds.
 */
export const WRAPPER_CHANNEL = 'gnomon-wrapper-channel:v1';
/** At most this many `launch` grants per minute (one in flight at a time): the kernel's shared launch-grant cap. */
export const WRAPPER_LAUNCH_CAP = LAUNCH_GRANT_CAP;

/**
 * The next step for an `unsafe-env` refusal in --wrapper mode: the APP spawned
 * this process (it passes `--disable-sigusr1` first and only, with no
 * NODE_OPTIONS), so the fix is the app's, not a command line the user types.
 */
export const WRAPPER_UNSAFE_ENV_NEXT = 'Gnomon.app spawns its kernel as `node --disable-sigusr1 <gnomon.js> up --wrapper` with a clean env; this app predates that or was modified: rebuild it (node packages/gnomon-wrapper/scripts/build-darwin.mjs) and reopen';

/** What an fd-backed stream is (a stream with no fd is in-memory: only tests build one; the CLI passes process stdio). */
export function channelKind(s: { fd?: unknown; isTTY?: boolean }): 'pipe' | 'socket' | 'tty' | 'file' | 'other' | 'in-memory' {
  if (s.isTTY === true) return 'tty';
  if (typeof s.fd !== 'number') return 'in-memory';
  let st: fs.Stats;
  try {
    st = fs.fstatSync(s.fd);
  } catch {
    return 'other';
  }
  // win32: libuv reports a pipe as S_IFIFO (0o010000), but fs.constants has no S_IFIFO there, so isFIFO() is false
  if (st.isFIFO() || (st.mode & 0o170000) === 0o010000) return 'pipe';
  if (st.isSocket()) return 'socket';
  if (st.isCharacterDevice()) return 'tty';
  if (st.isFile()) return 'file';
  return 'other';
}

/** Null when stdin/stdout form a private parent channel; else why not. */
export function wrapperChannelProblem(io: LaunchTtyIo): string | null {
  const ok = (k: string): boolean => k === 'pipe' || k === 'socket' || k === 'in-memory';
  const out = channelKind(io.stdout as { fd?: unknown; isTTY?: boolean });
  const inp = channelKind(io.stdin as { fd?: unknown; isTTY?: boolean });
  if (!ok(out)) return `stdout is a ${out}: --wrapper writes the launch token only to a pipe its parent holds (Gnomon.app spawns this)`;
  if (!ok(inp)) return `stdin is a ${inp}: --wrapper reads its commands only from the parent's pipe`;
  return null;
}

/** One channel line. Never pass anything but the fields named in WRAPPER_CHANNEL. */
export function channelLine(out: Out, msg: Record<string, unknown>): void {
  out.write(`${JSON.stringify({ v: 1, ...msg })}\n`);
}

/** A refusal on the channel (for the wrapper's window) AND as text on stderr (for its log). */
export function channelRefused(io: LaunchTtyIo, code: string, reason: string, message: string, next: readonly string[] = []): void {
  refused(io.stderr, code, reason, message, next);
  channelLine(io.stdout, { t: 'refused', code, reason, message, next: [...next] });
}

/**
 * Serve an in-process kernel to the wrapper over its stdio channel until it
 * exits: `up`, then one `launch` grant per `launch` command, `quit` / EOF /
 * SIGINT / SIGTERM / SIGHUP stop. Same stop rules as serveInProcess.
 * Returns 0, or 1 when the stop itself failed.
 */
export async function serveWrapperChannel(k: InProcessKernel, io: LaunchTtyIo, o: ServeOptions): Promise<number> {
  let stopping = false;
  let stopFailed = false;
  let stopped: Promise<void> = Promise.resolve();
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    io.stderr.write(`STOPPING  ${o.noun}\n`);
    stopped = k.stop().catch((e: unknown) => {
      stopFailed = true;
      refused(io.stderr, o.code, 'stop-failed', e instanceof Error ? e.message : String(e));
    });
  };
  const onSignal = (): void => stop();
  for (const s of STOP_SIGNALS) process.on(s, onSignal);
  io.stderr.write(`UP  ${o.noun} (in this process, wrapper channel)\n`);
  readout(io.stderr, o.rows);
  channelLine(io.stdout, { t: 'up' });
  // repeated `launch` commands are capped by the web endpoint's ONE launch-grant cap (kernel/web/launch-cap.ts:
  // one mint in flight, at most LAUNCH_GRANT_CAP a minute), shared with the terminal and `gui.open`, never added on top
  const mint = async (): Promise<void> => {
    if (stopping) return;
    try {
      const g = await k.launch();
      // the kernel may have begun stopping while the token was minted: never hand out a grant then
      if (stopping) return;
      // the grant's own fields only: the url is rebuilt by the wrapper (it never needs a second copy of the token)
      channelLine(io.stdout, { t: 'launch', port: g.port, launchToken: g.launchToken, kernelPublicKey: g.kernelPublicKey, bundleHash: g.bundleHash, expiresAt: g.expiresAt });
    } catch (e) {
      if (isLifecycleRefusal(e) && e.reason === 'web-launch-capped') {
        channelLine(io.stdout, { t: 'launch-failed', message: e.message.replace(/^gnomond: /, '') });
        return;
      }
      const m = e instanceof Error ? e.message : String(e);
      refused(io.stderr, o.code, 'web-launch', m);
      channelLine(io.stdout, { t: 'launch-failed', message: m });
    }
  };
  const rl = readline.createInterface({ input: io.stdin, terminal: false });
  rl.on('line', (l) => {
    const cmd = l.trim();
    if (cmd === 'quit') stop();
    else if (cmd === 'launch') void mint();
    else io.stderr.write(`  ignored an unknown wrapper command (${cmd.length} chars)\n`);
  });
  rl.on('close', () => stop()); // EOF: the wrapper went away, so does its kernel
  const reason = await k.handle.exited;
  await stopped;
  rl.close();
  for (const s of STOP_SIGNALS) process.off(s, onSignal);
  io.stderr.write(`DOWN  ${o.noun} (${reason})\n`);
  channelLine(io.stdout, { t: 'down', reason: String(reason) });
  return stopFailed ? 1 : 0;
}
