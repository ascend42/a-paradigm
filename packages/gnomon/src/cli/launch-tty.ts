/**
 * @symbol #dev-launch
 * @symbol #gnomon-up
 *
 * The in-process launcher shared by `gnomon dev up` (#dev-launch) and
 * `gnomon up` (#gnomon-up): a kernel started in THIS process, the CLI's own
 * device connection to it, and the terminal loop around the §11.2 launch.
 *
 * ONE copy of the launch rules:
 *   - the launch URL (it carries a single-use, 60 s token) is printed ONLY
 *     to an interactive terminal: never to a pipe, a file or a log;
 *   - the stop path is armed before anything else can throw or wait;
 *     SIGINT / SIGTERM / `q` stop; any other line on a TTY mints a fresh URL;
 *   - a failing stop is reported (exit 1), never an unhandled rejection.
 * Each caller decides its own home and identity guards before it gets here;
 * nothing in this module chooses a home, a root or a key. Writes plain text
 * to the streams it is given (zero deps, G-SEC-01; readout.ts voice).
 */
import * as readline from 'node:readline';
import { selectSocketPath, type DaemonHandle } from '../kernel/lifecycle/index.js';
import type { LaunchGrant } from '../kernel/web/endpoint.js';
import { GnomonClient, type ClientCredential, type KernelKeyPin } from '../clients/ts/index.js';
import { GNOMON_VERSION } from '../version.js';
import { readout, refused } from './readout.js';

type Out = { write(s: string): unknown; isTTY?: boolean };
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
 * --inspect*, --require, --import, --loader, …). Returns the refusal message, or null when clean.
 * Refusing (not re-executing) is deliberate: no second process ever holds the helper or the keys.
 */
export function unsafeRuntime(r: RuntimeFacts = { env: process.env, execArgv: process.execArgv }): string | null {
  const why: string[] = [];
  if (r.env.NODE_OPTIONS !== undefined && r.env.NODE_OPTIONS.trim() !== '') why.push('NODE_OPTIONS is set');
  if (r.execArgv.length > 0) why.push(`node was started with interpreter flags (${r.execArgv.length})`);
  return why.length ? `${why.join('; ')}: the kernel would run them inside the process that holds its keys` : null;
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

/** Print a launch URL — only to an interactive terminal: the token never lands in a pipe, a file or a log. */
export async function printLaunch(k: Pick<InProcessKernel, 'launch'>, io: LaunchTtyIo, keysHint: string): Promise<boolean> {
  const g = await k.launch();
  if (io.stdout.isTTY !== true) {
    io.stdout.write(`  gui     listening on 127.0.0.1:${g.port}; the launch URL is printed only to an interactive terminal (it carries a single-use token)\n`);
    return false;
  }
  io.stdout.write(`\n  open this in your browser within 60 s (single use):\n\n  ${g.url}\n\n  ${keysHint}\n`);
  return true;
}

export interface ServeOptions {
  /** The refusal code word (`dev`, `up`). */
  code: string;
  /** What is up, e.g. `dev kernel` / `kernel` (UP / STOPPING / DOWN lines). */
  noun: string;
  /** The readout printed after UP. */
  rows: ReadonlyArray<readonly [string, string | number]>;
  /** The line under the URL (which keys do what). */
  keysHint: string;
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
  const onSignal = (): void => stop();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  io.stdout.write(`UP  ${o.noun} (in this process)\n`);
  readout(io.stdout, o.rows);
  try {
    await printLaunch(k, io, o.keysHint);
  } catch (e) {
    refused(io.stderr, o.code, 'web-launch', e instanceof Error ? e.message : String(e), ['the kernel stays up for socket clients; Ctrl-C to stop']);
  }
  let rl: readline.Interface | null = null;
  if (io.stdin.isTTY === true) {
    rl = readline.createInterface({ input: io.stdin, terminal: false });
    rl.on('line', (l) => {
      if (l.trim() === 'q') stop();
      else void printLaunch(k, io, o.keysHint).catch((e: unknown) => refused(io.stderr, o.code, 'web-launch', e instanceof Error ? e.message : String(e)));
    });
  }
  const reason = await k.handle.exited;
  await stopped; // a stop that rejects after the kernel exited is still reported
  rl?.close();
  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);
  io.stdout.write(`DOWN  ${o.noun} (${reason})\n`);
  return stopFailed ? 1 : 0;
}
