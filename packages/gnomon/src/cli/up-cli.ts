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
import { attachInProcess, serveInProcess, type InProcessKernel, type LaunchTtyIo } from './launch-tty.js';
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
usage: gnomon up [--home <abs>]   (default ~/.gnomon; GNOMON_HOME is not read)
  Needs \`gnomon identity init\` first. Refuses a dev home and a home whose kernel already runs.
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

const initHint = (home: string, dflt: boolean): string => `gnomon identity init${dflt ? '' : ` --home ${home}`}`;

/** Resolve the home ONCE: `--home` or `~/.gnomon` (never GNOMON_HOME); a plain directory, never a symlink; realpath'd. */
export function resolveUpHome(given: string | undefined, userHome: string = os.homedir()): { home: string; isDefault: boolean } {
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
    throw new UpRefusal('device-unregistered', 'this device key has no matching human registry row signed by this root', [`re-provision: gnomon identity init --rotate (keeps the device key)`]);
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
  if (!hw) throw new UpRefusal('unprovisioned', `${home} has no hardware identity (keys/identity.json)`, ['gnomon identity init']);
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

function report(io: LaunchTtyIo, e: UpRefusal): number {
  refused(io.stderr, 'up', e.reason, e.message, e.next);
  return UP_EXIT_REFUSED;
}

export async function runUpCommand(argv: readonly string[], io: LaunchTtyIo, deps: UpDeps = {}): Promise<number> {
  let given: string | undefined;
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
    } else {
      io.stderr.write(`gnomon up: unknown argument ${a}\n${UP_USAGE}`);
      return UP_EXIT_USAGE;
    }
  }
  let k: UpKernel;
  try {
    const { home, isDefault } = resolveUpHome(given, deps.userHome);
    await refuseUnfitHome(home, isDefault);
    k = await startUpKernel(home, deps);
  } catch (e) {
    if (e instanceof UpRefusal) return report(io, e);
    if (isLifecycleRefusal(e)) {
      refused(io.stderr, 'up', e.reason, e.message);
      return UP_EXIT_REFUSED;
    }
    throw e;
  }
  const r = k.identity.record;
  const code = await serveInProcess(k, io, {
    code: 'up',
    noun: 'kernel',
    rows: [
      ['home', k.home],
      ['socket', k.handle.pidfile.socketPath],
      ['root', `hardware ${r.rootKeyId} (Secure Enclave, signed helper)`],
      ['device', `${k.deviceId} as ${k.client.principal ?? r.principalId}`],
      ['approve', 'from the GUI: Touch ID per decision (the helper prompt names Gnomon)'],
      ['kernel key', 'ephemeral for this run (other socket clients report serverVerified:false)'],
    ],
    keysHint: 'Enter = a fresh URL (a reload cannot Reconnect yet)   q or Ctrl-C = stop',
  });
  return code === 0 ? UP_EXIT_OK : UP_EXIT_REFUSED;
}
