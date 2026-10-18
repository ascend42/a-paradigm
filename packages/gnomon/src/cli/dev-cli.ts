/**
 * @symbol #dev-launch
 *
 * `gnomon dev init|up` (#dev-launch, spec §2.4 rule 6): the UNSIGNED,
 * DEV-ONLY dogfood path until #identity M1.3. See dev-home.ts for the home and
 * its guards. Every command prints a DEV ONLY banner. Writes plain text to the
 * streams it is given (zero deps, G-SEC-01; readout.ts voice). Never prints a
 * key; a launch token is printed only to an interactive terminal.
 */
import * as path from 'node:path';
import * as readline from 'node:readline';
import { GNOMON_VERSION } from '../version.js';
import { readout, refused } from './readout.js';
import { DevHomeRefusal, defaultDevHome, loadDevHome, provisionDevHome, type DevHomeOptions, type LoadedDevHome } from './dev-home.js';
import { isLifecycleRefusal, selectSocketPath, startDaemon, type DaemonHandle, type DaemonOptions } from '../kernel/lifecycle/index.js';
import type { LaunchGrant } from '../kernel/web/endpoint.js';
import { GnomonClient } from '../clients/ts/index.js';

type Out = { write(s: string): unknown; isTTY?: boolean };
export interface DevCliIo {
  stdin: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: unknown };
  stdout: Out;
  stderr: Out;
}

export const DEV_EXIT_OK = 0;
export const DEV_EXIT_REFUSED = 1;
export const DEV_EXIT_USAGE = 64;

export const DEV_BANNER =
  'DEV ONLY  unsigned dogfood path (#dev-launch): a SOFTWARE dev-test root, never production.\n' +
  '          Approvals are refused UNSUPPORTED until M1.3 (hardware root, signed helper).\n';

export const DEV_USAGE = `gnomon ${GNOMON_VERSION} dev — DEV ONLY, unsigned, until M1.3
usage: gnomon dev init [--home <abs>]   provision a dev home (default ~/${'.gnomon-dev'})
       gnomon dev up   [--home <abs>]   run the kernel on it and print a GUI launch URL
  Never ~/.gnomon. A home holding another root's registry is refused.
`;

export interface DevCliOptions extends DevHomeOptions {
  host?: string;
}

function parseHome(rest: readonly string[], opts: DevCliOptions): { home: string } | string {
  let home: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === '--home') {
      const v = rest[++i];
      if (!v || !path.isAbsolute(v)) return '--home needs an absolute path';
      home = path.resolve(v);
    } else return `unknown argument ${a}`;
  }
  return { home: home ?? defaultDevHome(opts.userHome) };
}

export function reportRefusal(io: DevCliIo, e: DevHomeRefusal): number {
  refused(io.stderr, 'dev', e.reason, e.message, e.next);
  return DEV_EXIT_REFUSED;
}

export async function runDevInit(argv: readonly string[], io: DevCliIo, opts: DevCliOptions = {}): Promise<number> {
  const parsed = parseHome(argv, opts);
  if (typeof parsed === 'string') {
    io.stderr.write(`gnomon dev: ${parsed}\n${DEV_USAGE}`);
    return DEV_EXIT_USAGE;
  }
  io.stdout.write(DEV_BANNER);
  try {
    const { created, loaded } = provisionDevHome(parsed.home, { ...opts, ...(opts.host ? { host: opts.host } : {}) });
    io.stdout.write(created ? 'INITIALIZED  dev home\n' : 'ALREADY INITIALIZED  dev home (verified)\n');
    readout(io.stdout, [
      ['home', loaded.home],
      ['root', `dev-test ${loaded.root.rootKeyId}`],
      ['kernel key', loaded.kernel.keyId],
      ['device', loaded.device.deviceId],
      ['principal', `${loaded.device.principalId} (human)`],
      ['next', `gnomon dev up${parsed.home === defaultDevHome(opts.userHome) ? '' : ` --home ${parsed.home}`}`],
    ]);
    return DEV_EXIT_OK;
  } catch (e) {
    if (e instanceof DevHomeRefusal) return reportRefusal(io, e);
    throw e;
  }
}

/** A kernel running in THIS process on a dev home, with the CLI's own device connection held open. */
export interface DevKernel {
  readonly dev: LoadedDevHome;
  readonly handle: DaemonHandle;
  readonly client: GnomonClient;
  /** The §11.2 `gnomon open` path, in-process: start the web endpoint if needed and mint a single-use, 60 s launch token for this device connection. */
  launch(): Promise<LaunchGrant>;
  stop(): Promise<void>;
}

export interface DevUpDeps {
  /** How the kernel is started (default startDaemon; the smoke test passes the internal test entry's daemon). */
  start?: (opts: DaemonOptions) => Promise<DaemonHandle>;
  idleMs?: number;
}

/**
 * Load the dev home, start the kernel in-process with ITS dev-test root and
 * kernel key (gnomond never does this), and connect as the registered human
 * device with the kernel key pinned (serverSig verified before the device
 * signs anything).
 */
export async function startDevKernel(home: string, opts: DevHomeOptions & DevUpDeps = {}): Promise<DevKernel> {
  const dev = loadDevHome(home, opts);
  const start = opts.start ?? startDaemon;
  const handle = await start({ home: dev.home, kernelSigner: dev.kernel, rootAuthority: dev.root, ...(opts.idleMs !== undefined ? { idleMs: opts.idleMs } : {}) });
  try {
    const sock = selectSocketPath({ home: dev.home });
    if (!sock.ok) throw new Error(`no safe endpoint path: ${sock.reason}`);
    const client = await GnomonClient.connect({ socketPath: sock.path, client: { name: 'gnomon-dev-up', version: GNOMON_VERSION, surface: 'cli' }, kernelKey: dev.kernelKey, credential: dev.device });
    return {
      dev,
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
export async function printLaunch(k: Pick<DevKernel, 'launch'>, io: DevCliIo): Promise<boolean> {
  const g = await k.launch();
  if (io.stdout.isTTY !== true) {
    io.stdout.write(`  gui     listening on 127.0.0.1:${g.port}; the launch URL is printed only to an interactive terminal (it carries a single-use token)\n`);
    return false;
  }
  io.stdout.write(`\n  open this in your browser within 60 s (single use):\n\n  ${g.url}\n\n  Enter = a fresh URL (a reload cannot Reconnect until M1.3)   q or Ctrl-C = stop\n`);
  return true;
}

export async function runDevUp(argv: readonly string[], io: DevCliIo, opts: DevCliOptions & DevUpDeps = {}): Promise<number> {
  const parsed = parseHome(argv, opts);
  if (typeof parsed === 'string') {
    io.stderr.write(`gnomon dev: ${parsed}\n${DEV_USAGE}`);
    return DEV_EXIT_USAGE;
  }
  io.stdout.write(DEV_BANNER);
  let k: DevKernel;
  try {
    k = await startDevKernel(parsed.home, opts);
  } catch (e) {
    if (e instanceof DevHomeRefusal) return reportRefusal(io, e);
    if (isLifecycleRefusal(e)) {
      refused(io.stderr, 'dev', e.reason, e.message, e.reason === 'already-running' ? ['another kernel already runs on this home: stop it (Ctrl-C in its terminal) first'] : []);
      return DEV_EXIT_REFUSED;
    }
    throw e;
  }
  io.stdout.write('UP  dev kernel (in this process)\n');
  readout(io.stdout, [
    ['home', k.dev.home],
    ['socket', k.handle.pidfile.socketPath],
    ['root', `dev-test ${k.dev.root.rootKeyId}`],
    ['device', `${k.dev.device.deviceId} as ${k.client.principal ?? k.dev.device.principalId}`],
    ['approve', 'refused UNSUPPORTED until M1.3 (no presence, no approvals key)'],
  ]);
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    io.stdout.write('STOPPING  dev kernel\n');
    void k.stop();
  };
  try {
    await printLaunch(k, io);
  } catch (e) {
    refused(io.stderr, 'dev', 'web-launch', e instanceof Error ? e.message : String(e), ['the kernel stays up for socket clients; Ctrl-C to stop']);
  }
  const onSignal = (): void => stop();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  let rl: readline.Interface | null = null;
  if (io.stdin.isTTY === true) {
    rl = readline.createInterface({ input: io.stdin, terminal: false });
    rl.on('line', (l) => {
      if (l.trim() === 'q') stop();
      else void printLaunch(k, io).catch((e: unknown) => refused(io.stderr, 'dev', 'web-launch', e instanceof Error ? e.message : String(e)));
    });
  }
  const reason = await k.handle.exited;
  rl?.close();
  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);
  io.stdout.write(`DOWN  dev kernel (${reason})\n`);
  return DEV_EXIT_OK;
}

export async function runDevCommand(argv: readonly string[], io: DevCliIo, opts: DevCliOptions & DevUpDeps = {}): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === 'init') return runDevInit(rest, io, opts);
  if (sub === 'up') return runDevUp(rest, io, opts);
  io.stdout.write(DEV_USAGE);
  return sub === '--help' || sub === '-h' ? DEV_EXIT_OK : DEV_EXIT_USAGE;
}
