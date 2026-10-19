/**
 * @symbol #gnomon-up
 *
 * `gnomon up [--home <abs>]` (#gnomon-up, spec §2.4 rule 7): the production
 * counterpart of `gnomon dev up`. It runs the kernel IN THIS PROCESS on a
 * PROVISIONED home (`~/.gnomon`, or `--home`) with the hardware identity —
 * the same `openHardwareIdentity` path gnomond takes (root + approvals key
 * behind the pinned signed helper) — connects as this home's registered human
 * device, starts the web endpoint and prints the GUI launch URL to an
 * interactive terminal only (launch-tty.ts, shared with dev up). Approvals
 * from the GUI go broker → helper presence prompt (Touch ID) → decisionSig.
 *
 * WHY IN-PROCESS (not `gnomon open` against a running gnomond): §5 names no
 * wire verb for `gnomon open`; adding one moves clientApiId. The in-process
 * path calls the kernel's existing `requestWebLaunch` API directly, exactly as
 * dev up does, so the socket ABI does not move.
 *
 * GUARDS (each has a falsifier in test/up-cli.test.ts), in this order, on a
 * home resolved ONCE (lstat: a plain directory, never a symlink; then
 * realpath) and never from GNOMON_HOME (like gnomond, §2.4 rule 1):
 *   - FIRST, before any home is read: a non-empty NODE_OPTIONS or any node
 *     interpreter flag (process.execArgv) → `unsafe-env` (Aegis C1; refused,
 *     not re-executed: gnomond's clean re-exec would have dropped them);
 *   - no home / a symlink / not a directory: `unprovisioned` / `unsafe-home`;
 *   - a DEV-ONLY marked home: `dev-home` (the #dev-launch tripwire's marker);
 *   - a kernel already running on it (pidfile holder alive, or the socket
 *     answers): `daemon-running` — this command runs its own kernel;
 *   - no keys/identity.json: `unprovisioned`;
 *   - any identity error (helper pin, SE key mismatch, approvals binding):
 *     `identity-<reason>`, fail closed, no software fallback;
 *   - the device key or its root-signed human registry row does not verify,
 *     or the registry holds any row this root does not verify:
 *     `device-unregistered` / `registry-damaged`.
 * Never prints or logs a key or a token. The kernel key is still an
 * ephemeral in-memory key per start (keystore custody is separate): the GUI
 * pins it from the launch fragment and this CLI pins it in-process; other
 * socket clients report serverVerified:false.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { GNOMON_VERSION } from '../version.js';
import { refused } from './readout.js';
import { isDevHome } from './dev-home.js';
import { attachInProcess, channelRefused, serveInProcess, serveWrapperChannel, unsafeRuntime, WRAPPER_UNSAFE_ENV_NEXT, wrapperChannelProblem, type InProcessKernel, type LaunchTtyIo, type RuntimeFacts } from './launch-tty.js';
import { canConnectSocket, daemonState, isLifecycleRefusal, resolveGnomonHome, selectSocketPath, startDaemon, type DaemonHandle, type DaemonOptions } from '../kernel/lifecycle/index.js';
import {
  IdentityError,
  loadDeviceCredential,
  openHardwareIdentity,
  readIdentity,
  readRegistry,
  type HelperTransport,
  type HelperVerifier,
  type OpenedIdentity,
  type PinnedHelper,
} from '../kernel/identity/index.js';
import type { SoftwareEd25519Signer } from '../kernel/log/signer.js';

export const UP_EXIT_OK = 0;
export const UP_EXIT_REFUSED = 1;
export const UP_EXIT_USAGE = 64;

export const UP_USAGE = `gnomon ${GNOMON_VERSION} up — run the kernel on your provisioned home and open the GUI
usage: gnomon up [--home <abs>] [--wrapper]   (default ~/.gnomon; GNOMON_HOME is not read)
  Needs \`gnomon setup\` first (bare \`gnomon\` runs it for you). Refuses a dev home and a home whose kernel already runs.
  --wrapper: spawned by Gnomon.app (#gnomon-wrapper): the launch grant goes on the stdout pipe the app holds, never a terminal.
`;

/** Test seams, programmatic only (gnomon.ts passes none): never env, never argv. */
export interface UpDeps {
  /** How the kernel is started (default startDaemon). */
  start?: (opts: DaemonOptions) => Promise<DaemonHandle>;
  /** Helper verification (default: the production code-signing check). */
  verifier?: HelperVerifier;
  /** The helper transport factory (default: spawn the pinned helper). */
  startHelper?: (pin: PinnedHelper) => HelperTransport;
  /** The user's home (default os.homedir()); `~/.gnomon` lives in it. */
  userHome?: string;
  idleMs?: number;
  /** The env / execArgv the unsafe-env guard reads (default this process's). */
  runtime?: RuntimeFacts;
}

export class UpRefusal extends Error {
  constructor(
    readonly reason: string,
    message: string,
    readonly next: readonly string[] = [],
  ) {
    super(message);
    this.name = 'UpRefusal';
  }
}

export interface UpKernel extends InProcessKernel {
  readonly home: string;
  readonly identity: OpenedIdentity;
  readonly deviceId: string;
}

/** #first-run: the default home is set up by the guided `gnomon setup` (bare `gnomon` runs it on a terminal). */
const initHint = (home: string, dflt: boolean): string => (dflt ? 'gnomon setup   (or just `gnomon` in a repo: it sets this Mac up first)' : `gnomon identity init --home ${home}`);
/** Gnomon.app (MVP-a): the app has no setup screens yet, so it names the step without a command to paste. */
export const WRAPPER_SETUP_NEXT = 'Gnomon is not set up on this Mac yet. In-app setup is coming; until then, run gnomon once in Terminal and it walks you through it';

/** Resolve the home ONCE: `--home` or `~/.gnomon` (never GNOMON_HOME); a plain directory, never a symlink; realpath'd. */
export function resolveUpHome(given: string | undefined, userHome: string = os.userInfo().homedir): { home: string; isDefault: boolean } {
  const raw = given ?? resolveGnomonHome({ env: {}, homedir: userHome });
  const isDefault = given === undefined;
  let st: fs.Stats;
  try {
    st = fs.lstatSync(raw);
  } catch {
    throw new UpRefusal('unprovisioned', `no Gnomon home at ${raw}`, [initHint(raw, isDefault)]);
  }
  if (st.isSymbolicLink()) throw new UpRefusal('unsafe-home', `${raw} is a symlink; the home must be a plain directory`, ['name the real directory with --home']);
  if (!st.isDirectory()) throw new UpRefusal('unsafe-home', `${raw} is not a directory`);
  return { home: fs.realpathSync.native(raw), isDefault };
}

/** The pre-start guards (no helper is spawned, nothing is written): dev marker, a running kernel, an identity record. */
export async function refuseUnfitHome(home: string, isDefault: boolean): Promise<void> {
  if (isDevHome(home)) {
    throw new UpRefusal('dev-home', `${home} is a DEV-ONLY home: it runs only under gnomon dev up, never on the hardware identity`, [`gnomon dev up --home ${home}   (DEV ONLY)`]);
  }
  const sock = selectSocketPath({ home });
  const st = daemonState(home, sock.ok ? sock.path : undefined);
  if (st.state === 'running' || (sock.ok && (await canConnectSocket(sock.path)))) {
    const pid = st.state === 'running' ? ` (pidfile pid ${st.pidfile.pid}, diagnostic only)` : '';
    throw new UpRefusal('daemon-running', `a kernel already runs on ${home}${pid}; gnomon up runs its own kernel in this process`, [
      'stop it first: Ctrl-C in its terminal (gnomond --foreground / gnomon up), or let it exit on idle',
      'attaching a GUI to a running gnomond needs `gnomon open`, which has no wire verb yet (spec §11.2)',
    ]);
  }
  let rec;
  try {
    rec = readIdentity(home);
  } catch (e) {
    throw new UpRefusal('identity-malformed', e instanceof Error ? e.message : 'identity.json is unreadable');
  }
  if (!rec) throw new UpRefusal('unprovisioned', `${home} has no hardware identity (keys/identity.json)`, [initHint(home, isDefault)]);
}

/** This home's device credential, checked against its root-signed human registry row (fail closed). */
function deviceOf(home: string, hw: OpenedIdentity): { kind: 'device'; deviceId: string; principalId: string; privateKeyPem: string } {
  let cred: { signer: SoftwareEd25519Signer; privateKeyPem: string };
  try {
    cred = loadDeviceCredential(home);
  } catch (e) {
    throw new UpRefusal('device-key', e instanceof Error ? e.message : 'the device key does not load');
  }
  const reg = readRegistry(home, hw.root);
  if (reg.rejected.length > 0) {
    throw new UpRefusal('registry-damaged', `${reg.rejected.length} registry row(s) do not verify against this home's root (${[...new Set(reg.rejected.map((r) => r.reason))].join(', ')})`);
  }
  const row = reg.devices.get(hw.record.deviceId);
  if (!row || row.principalKind !== 'human' || row.principalId !== hw.record.principalId || row.keyId !== cred.signer.keyId) {
    throw new UpRefusal('device-unregistered', 'this device key has no matching human registry row signed by this root', [`gnomon setup   (it finishes an interrupted setup; otherwise re-provision: gnomon identity init --rotate)`]);
  }
  return { kind: 'device', deviceId: row.deviceId, principalId: row.principalId, privateKeyPem: cred.privateKeyPem };
}

/**
 * Open the hardware identity (the gnomond path), start the kernel in-process
 * on it and connect as this home's human device with the kernel key pinned.
 * Every failure after the helper opened closes it; nothing falls back.
 */
export async function startUpKernel(home: string, deps: UpDeps = {}): Promise<UpKernel> {
  let hw: OpenedIdentity | null;
  try {
    hw = await openHardwareIdentity(home, { ...(deps.verifier ? { verifier: deps.verifier } : {}), ...(deps.startHelper ? { start: deps.startHelper } : {}) });
  } catch (e) {
    if (e instanceof IdentityError) throw new UpRefusal(`identity-${e.reason}`, `the hardware identity of ${home} cannot be opened: ${e.message}`);
    throw e;
  }
  if (!hw) throw new UpRefusal('unprovisioned', `${home} has no hardware identity (keys/identity.json)`, ['gnomon setup']);
  let handle: DaemonHandle;
  let device: ReturnType<typeof deviceOf>;
  try {
    device = deviceOf(home, hw);
    const start = deps.start ?? startDaemon;
    handle = await start({ home, rootAuthority: hw.root, approvalsKey: hw.approvals, helper: hw.helper, ...(deps.idleMs !== undefined ? { idleMs: deps.idleMs } : {}) });
  } catch (e) {
    await hw.helper.close().catch(() => undefined);
    if (isLifecycleRefusal(e) && e.reason === 'already-running') throw new UpRefusal('daemon-running', `a kernel already runs on ${home}: ${e.message}`, ['stop it first (Ctrl-C in its terminal), or let it exit on idle']);
    throw e;
  }
  // in-process the kernel key is known directly: pin it (the ephemeral key has no root-signed row yet)
  const pem = (handle.kernelSigner as Partial<SoftwareEd25519Signer>).publicKeyPem;
  if (typeof pem !== 'string') {
    await handle.shutdown('error').catch(() => undefined);
    throw new UpRefusal('kernel-key', 'the kernel key has no public PEM to pin');
  }
  const k = await attachInProcess(handle, { home, clientName: 'gnomon-up', kernelKey: { keyId: handle.kernelSigner.keyId, publicKeyPem: pem }, credential: device });
  return { ...k, home, identity: hw, deviceId: device.deviceId };
}

function report(io: LaunchTtyIo, e: UpRefusal, wrapper = false, code = 'up'): number {
  if (wrapper) channelRefused(io, code, e.reason, e.message, e.reason === 'unprovisioned' ? [WRAPPER_SETUP_NEXT] : e.next);
  else refused(io.stderr, code, e.reason, e.message, e.next);
  return UP_EXIT_REFUSED;
}

/** How `runUp` was reached: `gnomon up` (argv parsed by runUpCommand) or bare `gnomon` (#bare-entry, bare-cli.ts). */
export interface UpRun {
  given?: string;
  wrapper?: boolean;
  /** The refusal code word (default `up`; bare `gnomon` passes `gnomon`). */
  code?: string;
  /** #bare-entry: extra readout rows (the folder hint, already escaped for display). */
  rows?: ReadonlyArray<readonly [string, string | number]>;
  /** #bare-entry: the fragment-only hint appended to each terminal launch URL. */
  urlSuffix?: string;
  /** #bare-entry: a kernel already running on the home is reported by the caller (another instance, not a fault). */
  onRunning?: (e: UpRefusal, home: string) => number;
}

export async function runUpCommand(argv: readonly string[], io: LaunchTtyIo, deps: UpDeps = {}): Promise<number> {
  let given: string | undefined;
  let wrapper = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') {
      io.stdout.write(UP_USAGE);
      return UP_EXIT_OK;
    }
    if (a === '--home') {
      const v = argv[++i];
      if (!v || !path.isAbsolute(v)) {
        io.stderr.write(`gnomon up: --home needs an absolute path\n${UP_USAGE}`);
        return UP_EXIT_USAGE;
      }
      given = path.resolve(v);
    } else if (a === '--wrapper') {
      wrapper = true;
    } else {
      io.stderr.write(`gnomon up: unknown argument ${a}\n${UP_USAGE}`);
      return UP_EXIT_USAGE;
    }
  }
  return runUp(io, deps, { ...(given !== undefined ? { given } : {}), wrapper });
}

/** The `gnomon up` body after argv: every guard in order, then serve. Shared with bare `gnomon` (#bare-entry). */
export async function runUp(io: LaunchTtyIo, deps: UpDeps, run: UpRun): Promise<number> {
  const { given, wrapper = false } = run;
  const code = run.code ?? 'up';
  // Aegis C1: before any home is read or the helper opens, the process that will hold the keys must be clean
  // #gnomon-wrapper: the channel must be the parent's pipe BEFORE anything else (a refusal itself goes on it)
  if (wrapper) {
    const bad = wrapperChannelProblem(io);
    if (bad) {
      refused(io.stderr, code, 'wrapper-channel', bad, ['open Gnomon.app, or run `gnomon up` without --wrapper in a terminal']);
      return UP_EXIT_REFUSED;
    }
  }
  const unsafe = unsafeRuntime(deps.runtime);
  if (unsafe) return report(io, new UpRefusal('unsafe-env', unsafe, wrapper ? [WRAPPER_UNSAFE_ENV_NEXT] : ['unset NODE_OPTIONS, and run `<clone>/packages/gnomon/dist/cli/gnomon.js up` (its shebang passes --disable-sigusr1) or `node --disable-sigusr1 <clone>/packages/gnomon/dist/cli/gnomon.js up`, with no other node flags']), wrapper, code);
  let k: UpKernel;
  let home: string | undefined;
  try {
    const resolved = resolveUpHome(given, deps.userHome);
    home = resolved.home;
    await refuseUnfitHome(resolved.home, resolved.isDefault);
    k = await startUpKernel(resolved.home, deps);
  } catch (e) {
    if (e instanceof UpRefusal) {
      if (e.reason === 'daemon-running' && run.onRunning && home !== undefined) return run.onRunning(e, home);
      return report(io, e, wrapper, code);
    }
    if (isLifecycleRefusal(e)) {
      if (wrapper) channelRefused(io, code, e.reason, e.message);
      else refused(io.stderr, code, e.reason, e.message);
      return UP_EXIT_REFUSED;
    }
    throw e;
  }
  const r = k.identity.record;
  const served = await (wrapper ? serveWrapperChannel : serveInProcess)(k, io, {
    code,
    noun: 'kernel',
    rows: [
      ['home', k.home],
      ['socket', k.handle.pidfile.socketPath],
      ['root', `hardware ${r.rootKeyId} (Secure Enclave, signed helper)`],
      ['device', `${k.deviceId} as ${k.client.principal ?? r.principalId}`],
      ['approve', 'from the GUI: Touch ID per decision (the helper prompt names Gnomon)'],
      ['kernel key', 'ephemeral for this run (other socket clients report serverVerified:false)'],
      ...(run.rows ?? []),
    ],
    keysHint: 'Enter = a fresh URL (a reload cannot Reconnect yet)   q or Ctrl-C = stop',
    ...(run.urlSuffix && !wrapper ? { urlSuffix: run.urlSuffix } : {}),
  });
  return served === 0 ? UP_EXIT_OK : UP_EXIT_REFUSED;
}
