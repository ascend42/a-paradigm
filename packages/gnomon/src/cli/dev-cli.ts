/**
 * @symbol #dev-launch
 * @symbol #local-runner
 *
 * `gnomon dev init|up|local` (#dev-launch, spec §2.4 rule 6): the UNSIGNED,
 * DEV-ONLY dogfood path until #identity M1.3. See dev-home.ts for the home and
 * its guards. Every command prints a DEV ONLY banner. Writes plain text to the
 * streams it is given (zero deps, G-SEC-01; readout.ts voice). Never prints a
 * key; a launch token is printed only to an interactive terminal (the
 * launcher and terminal loop are shared with `gnomon up`: launch-tty.ts).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GNOMON_VERSION } from '../version.js';
import { LOCAL_COMPAT_NAMES, LOCAL_CONFIG_FILE, nextLocalVersion, writeSignedLocalConfig } from '../kernel/local/config.js';
import { LAN_LATER, validateLocalConfigInput, type ValidatedLocalConfig } from '../kernel/local/config-request.js';
import { pinOf } from '../kernel/local/runner-pin.js';
import { ensureDevApprovals } from '../platform/win32/approvals.js';
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
  (process.platform === 'win32'
    ? '          Approvals: routine cards by click (dev approvals key, no presence); sensitive cards by Windows Hello.\n'
    : '          Approvals are refused UNSUPPORTED until M1.3 (hardware root, signed helper).\n');

export const DEV_USAGE = `gnomon ${GNOMON_VERSION} dev — DEV ONLY, unsigned, until M1.3
usage: gnomon dev init [--home <abs>]   provision a dev home (default ~/${'.gnomon-dev'})
       gnomon dev up   [--home <abs>] [--wrapper]   run the kernel on it and print a GUI launch URL
                                    (--wrapper: the grant goes on the stdout pipe of the parent, #gnomon-wrapper)
       gnomon dev local --model <id> [--base <url>] [--compat <name>] [--id <name>] [--runner <dir>] [--loops] [--home <abs>]
                                    sign the local-model lane config (local.signed.json) with the dev root:
                                    one LOOPBACK endpoint (default http://127.0.0.1:11434, ollama; no LAN yet)
                                    and the gnomon-local runner pinned by sha256 (default: the runner that ships
                                    with this build, else this clone's gnomon-local/dist);
                                    --loops lets trusted loops' model steps use the endpoint (off by default);
                                    a running dev kernel picks it up at its next start
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
  /** win32: the helper-held approvals key is wired (routine cards are a click) */
  readonly approvals?: boolean;
  /** win32 (W4 phase B): the Windows Hello presence key's state (bound / created / off / unavailable: why) */
  readonly presence?: string;
  /** win32: the approvals key's long-lived helper, closed when the kernel stops (Aegis W4-A L4) */
  readonly approvalsHelper?: { close(): Promise<void> };
}

export interface DevUpDeps {
  /** How the kernel is started (default startDaemon; the smoke test passes the internal test entry's daemon). */
  start?: (opts: DaemonOptions) => Promise<DaemonHandle>;
  idleMs?: number;
  /** The env / execArgv the unsafe-env guard reads (default this process's). */
  runtime?: RuntimeFacts;
  /** The platform (default this process's): win32 wires the dev approvals key. */
  platform?: NodeJS.Platform;
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
  // W4 phase A (win32): the helper-held approvals key, bound to this home's human by the dev root; routine cards are
  // a click (platform/win32/approvals.ts). darwin dev homes keep refusing approvals until M1.3, as before.
  const wired = (opts.platform ?? process.platform) === 'win32' && !opts.start ? await ensureDevApprovals(dev.home, dev.root, dev.device.principalId, undefined, { presence: true }) : null;
  const approvals = wired?.approvals ?? null;
  const handle = await start({ home: dev.home, kernelSigner: dev.kernel, rootAuthority: dev.root, ...(approvals ? { approvalsKey: approvals } : {}), ...(opts.idleMs !== undefined ? { idleMs: opts.idleMs } : {}) });
  const k = await attachInProcess(handle, { home: dev.home, clientName: 'gnomon-dev-up', kernelKey: dev.kernelKey, credential: dev.device });
  return { ...k, dev, approvals: approvals !== null, ...(wired ? { approvalsHelper: wired.helper, presence: wired.presenceState } : {}) };
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
      ['approve', !k.approvals ? 'refused UNSUPPORTED until M1.3 (no presence, no approvals key)' : k.presence === 'bound' || k.presence === 'created' ? `routine cards by click; sensitive cards by Windows Hello (presence key ${k.presence})` : `routine cards by click; sensitive cards refused (Windows Hello ${k.presence ?? 'off'})`],
    ],
    keysHint: 'Enter = a fresh URL (a reload cannot Reconnect until M1.3)   q or Ctrl-C = stop',
  });
  await k.approvalsHelper?.close().catch(() => undefined);
  return code === 0 ? DEV_EXIT_OK : DEV_EXIT_REFUSED;
}

/** This clone's gnomon-local runner dir (dist/), next to this package: the bundled CLI or the sources. */
export function defaultLocalRunnerDir(from: string = path.dirname(fileURLToPath(import.meta.url))): string | null {
  for (const up of ['../../..', '../../../..', '../..']) {
    const d = path.resolve(from, up, 'gnomon-local', 'dist');
    if (fs.existsSync(path.join(d, 'cli.js'))) return d;
  }
  return null;
}

/**
 * `gnomon dev local`: the root act that enables the local lane on a DEV home (spec §13.1). A real home takes the same
 * config through `gnomon local set` (a root-class card, #local-config-request); both go through ONE input check
 * (validateLocalConfigInput: loopback only in 8.0, dev homes included, TD-2026-10-22-769) and ONE writer. Nothing but
 * flags names the endpoint; the kernel re-validates the row (G-SUB-06) and the runner pin at every local open anyway.
 */
export async function runDevLocal(argv: readonly string[], io: DevCliIo, opts: DevCliOptions = {}): Promise<number> {
  const usage = (why: string): number => (io.stderr.write(`gnomon dev local: ${why}\n${DEV_USAGE}`), DEV_EXIT_USAGE);
  const flags: Record<string, string> = {};
  let loops = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--loops') {
      loops = true;
      continue;
    }
    const v = argv[i + 1];
    if (!['--home', '--base', '--model', '--compat', '--id', '--runner'].includes(a)) return usage(`unknown argument ${a}`);
    if (v === undefined || v.startsWith('--')) return usage(`${a} needs a value`);
    flags[a.slice(2)] = v;
    i++;
  }
  if (!flags.model) return usage('--model is required (the model id the endpoint serves, e.g. qwen3.5:9b)');
  if (flags.home !== undefined && !path.isAbsolute(flags.home)) return usage('--home needs an absolute path');
  if (flags.runner !== undefined && !path.isAbsolute(flags.runner)) return usage('--runner needs an absolute path');
  const home = flags.home ? path.resolve(flags.home) : defaultDevHome(opts.userHome);
  if (flags.compat !== undefined && !LOCAL_COMPAT_NAMES.includes(flags.compat)) return usage(`--compat must be one of ${LOCAL_COMPAT_NAMES.join(', ')}`);
  io.stdout.write(DEV_BANNER);
  // loops step 8 (Aegis): an endpoint serves unattended loop steps only when the root-signed row says loops: true
  let v: ValidatedLocalConfig;
  try {
    v = validateLocalConfigInput({ model: flags.model, ...(flags.base !== undefined ? { base: flags.base } : {}), ...(flags.compat !== undefined ? { compat: flags.compat } : {}), ...(flags.id !== undefined ? { id: flags.id } : {}), ...(loops ? { loops: true } : {}), ...(flags.runner !== undefined ? { runner: flags.runner } : {}) });
  } catch (e) {
    const r = (e as { refusal?: { data?: { field?: unknown; why?: unknown; reason?: unknown } } }).refusal;
    const field = r?.data?.field;
    if (field === 'runner') {
      refused(io.stderr, 'dev', 'no-runner', e instanceof Error ? e.message : String(e), ['build it: npm run build -w @a-company/gnomon-local', 'or pass --runner <abs dir holding cli.js>']);
      return DEV_EXIT_REFUSED;
    }
    refused(io.stderr, 'dev', 'local-endpoint', e instanceof Error ? e.message : String(e), [`a local model endpoint is loopback only in 8.0 (${LAN_LATER})`]);
    return DEV_EXIT_REFUSED;
  }
  let dev: LoadedDevHome;
  try {
    dev = loadDevHome(home, opts);
  } catch (e) {
    if (e instanceof DevHomeRefusal) return reportRefusal(io, e);
    throw e;
  }
  // the next version: above the file, the sidecar the kernel keeps and (unread here) the chain; the kernel refuses older
  const { version } = nextLocalVersion(home, 0);
  const runner = pinOf(v.runnerDir, 'cli.js');
  const endpoint = v.endpoint;
  writeSignedLocalConfig(home, dev.root, { endpoints: [endpoint], runner }, version);
  io.stdout.write('SIGNED  local-model lane config\n');
  readout(io.stdout, [
    ['home', home],
    ['file', LOCAL_CONFIG_FILE],
    ['version', String(version)],
    ['endpoint', `${endpoint.id} ${endpoint.base} (${endpoint.compat})`],
    ['model', endpoint.model],
    ['loops', loops ? 'trusted loops may use this endpoint' : 'no (add --loops to let trusted loops use it)'],
    ['runner', `${runner.dir} (tree ${runner.treeSha256.slice(0, 12)}…)`],
    ['node', `${runner.node} (${runner.nodeSha256.slice(0, 12)}…)`],
    ['next', 'restart gnomon dev up, then open a session with model: local'],
  ]);
  return DEV_EXIT_OK;
}

export async function runDevCommand(argv: readonly string[], io: DevCliIo, opts: DevCliOptions & DevUpDeps = {}): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === 'init') return runDevInit(rest, io, opts);
  if (sub === 'up') return runDevUp(rest, io, opts);
  if (sub === 'local') return runDevLocal(rest, io, opts);
  io.stdout.write(DEV_USAGE);
  return sub === '--help' || sub === '-h' ? DEV_EXIT_OK : DEV_EXIT_USAGE;
}
