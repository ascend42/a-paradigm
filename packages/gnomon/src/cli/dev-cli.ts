/**
 * @symbol #dev-launch
 *
 * `gnomon dev init|up` (#dev-launch, spec §2.4 rule 6): the UNSIGNED,
 * DEV-ONLY dogfood path until #identity M1.3. See dev-home.ts for the home and
 * its guards. Every command prints a DEV ONLY banner. Writes plain text to the
 * streams it is given (zero deps, G-SEC-01; readout.ts voice). Never prints a
 * key; a launch token is printed only to an interactive terminal (the
 * launcher and terminal loop are shared with `gnomon up`: launch-tty.ts).
 */
import * as path from 'node:path';
import { GNOMON_VERSION } from '../version.js';
import { readout, refused } from './readout.js';
import { DevHomeRefusal, defaultDevHome, loadDevHome, provisionDevHome, type DevHomeOptions, type LoadedDevHome } from './dev-home.js';
import { isLifecycleRefusal, startDaemon, type DaemonHandle, type DaemonOptions } from '../kernel/lifecycle/index.js';
import { attachInProcess, channelRefused, serveInProcess, serveWrapperChannel, unsafeRuntime, WRAPPER_UNSAFE_ENV_NEXT, wrapperChannelProblem, type InProcessKernel, type LaunchTtyIo, type RuntimeFacts } from './launch-tty.js';

export type DevCliIo = LaunchTtyIo;

export const DEV_EXIT_OK = 0;
export const DEV_EXIT_REFUSED = 1;
export const DEV_EXIT_USAGE = 64;

export const DEV_BANNER =
  'DEV ONLY  unsigned dogfood path (#dev-launch): a SOFTWARE dev-test root, never production.\n' +
  '          Approvals are refused UNSUPPORTED until M1.3 (hardware root, signed helper).\n';

export const DEV_USAGE = `gnomon ${GNOMON_VERSION} dev — DEV ONLY, unsigned, until M1.3
usage: gnomon dev init [--home <abs>]   provision a dev home (default ~/${'.gnomon-dev'})
       gnomon dev up   [--home <abs>] [--wrapper]   run the kernel on it and print a GUI launch URL
                                    (--wrapper: the grant goes on the stdout pipe of the parent, #gnomon-wrapper)
  Never ~/.gnomon. A home holding another root's registry is refused.
`;

export interface DevCliOptions extends DevHomeOptions {
  host?: string;
}

function parseHome(rest: readonly string[], opts: DevCliOptions, allowWrapper = false): { home: string; wrapper: boolean } | string {
  let home: string | undefined;
  let wrapper = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === '--wrapper' && allowWrapper) wrapper = true;
    else if (a === '--home') {
      const v = rest[++i];
      if (!v || !path.isAbsolute(v)) return '--home needs an absolute path';
      home = path.resolve(v);
    } else return `unknown argument ${a}`;
  }
  return { home: home ?? defaultDevHome(opts.userHome), wrapper };
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
export interface DevKernel extends InProcessKernel {
  readonly dev: LoadedDevHome;
}

export interface DevUpDeps {
  /** How the kernel is started (default startDaemon; the smoke test passes the internal test entry's daemon). */
  start?: (opts: DaemonOptions) => Promise<DaemonHandle>;
  idleMs?: number;
  /** The env / execArgv the unsafe-env guard reads (default this process's). */
  runtime?: RuntimeFacts;
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
  const k = await attachInProcess(handle, { home: dev.home, clientName: 'gnomon-dev-up', kernelKey: dev.kernelKey, credential: dev.device });
  return { ...k, dev };
}

export async function runDevUp(argv: readonly string[], io: DevCliIo, opts: DevCliOptions & DevUpDeps = {}): Promise<number> {
  const parsed = parseHome(argv, opts, true);
  if (typeof parsed === 'string') {
    io.stderr.write(`gnomon dev: ${parsed}\n${DEV_USAGE}`);
    return DEV_EXIT_USAGE;
  }
  const wrapper = parsed.wrapper;
  // #gnomon-wrapper: stdout is the channel, so every human line goes to stderr; the channel is checked first
  (wrapper ? io.stderr : io.stdout).write(DEV_BANNER);
  if (wrapper) {
    const bad = wrapperChannelProblem(io);
    if (bad) {
      refused(io.stderr, 'dev', 'wrapper-channel', bad);
      return DEV_EXIT_REFUSED;
    }
  }
  const say = (reason: string, message: string, next: readonly string[] = []): void => (wrapper ? channelRefused(io, 'dev', reason, message, next) : refused(io.stderr, 'dev', reason, message, next));
  // Aegis C1 (the same rule as gnomon up): the kernel runs in THIS process, so the process must be clean
  const unsafe = unsafeRuntime(opts.runtime);
  if (unsafe) {
    say('unsafe-env', unsafe, wrapper ? [WRAPPER_UNSAFE_ENV_NEXT] : ['unset NODE_OPTIONS, and run `<clone>/packages/gnomon/dist/cli/gnomon.js dev up` (its shebang passes --disable-sigusr1) or `node --disable-sigusr1 <clone>/packages/gnomon/dist/cli/gnomon.js dev up`, with no other node flags']);
    return DEV_EXIT_REFUSED;
  }
  let k: DevKernel;
  try {
    k = await startDevKernel(parsed.home, opts);
  } catch (e) {
    if (e instanceof DevHomeRefusal) {
      if (!wrapper) return reportRefusal(io, e);
      say(e.reason, e.message, e.next);
      return DEV_EXIT_REFUSED;
    }
    if (isLifecycleRefusal(e)) {
      say(e.reason, e.message, e.reason === 'already-running' ? ['another kernel already runs on this home: stop it (Ctrl-C in its terminal) first'] : []);
      return DEV_EXIT_REFUSED;
    }
    throw e;
  }
  const code = await (wrapper ? serveWrapperChannel : serveInProcess)(k, io, {
    code: 'dev',
    noun: 'dev kernel',
    rows: [
      ['home', k.dev.home],
      ['socket', k.handle.pidfile.socketPath],
      ['root', `dev-test ${k.dev.root.rootKeyId}`],
      ['device', `${k.dev.device.deviceId} as ${k.client.principal ?? k.dev.device.principalId}`],
      ['approve', 'refused UNSUPPORTED until M1.3 (no presence, no approvals key)'],
    ],
    keysHint: 'Enter = a fresh URL (a reload cannot Reconnect until M1.3)   q or Ctrl-C = stop',
  });
  return code === 0 ? DEV_EXIT_OK : DEV_EXIT_REFUSED;
}

export async function runDevCommand(argv: readonly string[], io: DevCliIo, opts: DevCliOptions & DevUpDeps = {}): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === 'init') return runDevInit(rest, io, opts);
  if (sub === 'up') return runDevUp(rest, io, opts);
  io.stdout.write(DEV_USAGE);
  return sub === '--help' || sub === '-h' ? DEV_EXIT_OK : DEV_EXIT_USAGE;
}
