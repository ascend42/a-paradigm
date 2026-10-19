/**
 * @symbol $daemon-lifecycle
 *
 * $daemon-lifecycle (spec §2.4) — CLI glue for `gnomond` and `gnomon daemon`.
 * Writes to stdio directly: the kernel has zero deps (G-SEC-01) and cannot use
 * the Paradigm logger; #kernel-log brings structured logging at M1.2.
 *
 * M1.4 slice 1: `gnomon daemon status` sends `hello` only. It does NOT
 * verify serverSig (that needs a root-signed kernel-key row, #identity M1.3)
 * and does NOT authenticate or call `status` (no registered device before
 * M1.3): it reports `running` from the hello with `serverVerified:false,
 * authenticated:false` and the reason; the pidfile pid is shown as a
 * diagnostic only (§2.4: never trusted). `gnomon daemon stop` is
 * approval-signed (§3.1 I3) and refused locally until #approval-broker (M1.6):
 * there is no `daemon.stop` verb — the socket surface is exactly 12 verbs + 2
 * relays.
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canConnectSocket,
  DEFAULT_IDLE_EXIT_MS,
  exitCodeOfClass,
  exitCodeOfLaunch,
  exitCodeOfRefusal,
  launchDaemon,
  sealReadyFd,
  STARTUP_FAULT_CLASS,
  writeReady,
  daemonState,
  isLifecycleRefusal,
  resolveGnomonHome,
  selectSocketPath,
  sigusr1Refusal,
  startDaemon,
} from '../kernel/lifecycle/index.js';
import { connectGnomon, ServerAuthError } from '../kernel/socket/index.js';
import { IdentityError, openHardwareIdentity } from '../kernel/identity/index.js';
import { refuse, refusalOf, RefusedError } from '@a-company/gnomon-contracts';
import { GNOMON_VERSION } from '../version.js';
import { existsSync } from 'node:fs';
import { DEV_HOME_MARKER } from './dev-home.js';

/**
 * #dev-launch tripwire: gnomond (foreground or detaching) and `gnomon daemon start` refuse,
 * loudly, a home that holds the DEV-ONLY marker. A dev home runs only under `gnomon dev up`,
 * in the CLI's own process; the production daemon never runs on dev keys.
 */
export function refuseDevHome(home: string, err: { write(s: string): unknown } = process.stderr): boolean {
  if (!existsSync(path.join(home, DEV_HOME_MARKER))) return false;
  err.write(
    `REFUSED  GNOMOND  dev-home\n  ${home} is a DEV-ONLY home (${DEV_HOME_MARKER}): the production daemon never runs on dev keys.\n  next: gnomon dev up --home ${home}   (DEV ONLY, unsigned, until M1.3)\n`,
  );
  return true;
}

export const EXIT_OK = 0;
export const EXIT_REFUSED = 1;
export const EXIT_NOT_RUNNING = 3;
/** The CLI-wide usage code (unchanged since PR-5, same as every `gnomon` verb); gnomond's own table is exit-codes.ts. */
export const EXIT_USAGE = 64;

export interface DaemonArgs {
  foreground: boolean;
  home?: string;
  idleMs?: number;
  /** The activator's inherited ready pipe (§2.4 rule 2, ready.ts); set only by launchDaemon's re-exec. */
  readyFd?: number;
}

export function parseDaemonArgs(argv: readonly string[]): DaemonArgs | string {
  const out: DaemonArgs = { foreground: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--foreground') out.foreground = true;
    else if (a === '--detach') out.foreground = false;
    else if (a === '--home') {
      const v = argv[++i];
      if (!v || !path.isAbsolute(v)) return '--home needs an absolute path';
      out.home = v;
    } else if (a === '--idle-ms') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 0) return '--idle-ms needs a non-negative integer';
      out.idleMs = v;
    } else if (a === '--ready-fd') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 3) return '--ready-fd needs an inherited fd >= 3';
      out.readyFd = v;
    } else return `unknown argument ${a}`;
  }
  return out;
}

function homeOf(args: { home?: string }): string {
  return args.home ?? resolveGnomonHome();
}

function socketOf(home: string): string | null {
  const c = selectSocketPath({ home });
  return c.ok ? c.path : null;
}


/**
 * The DAEMON's home (§2.4 rule 1): `--home` from argv, else `~/.gnomon`.
 * Every `gnomond` path (foreground and the detaching activator) resolves its
 * home here and never reads `GNOMON_HOME`; the env seam is honoured only by
 * the `gnomon` client commands (`gnomon daemon status|stop|--detach`, via
 * homeOf), which pass the result to the daemon as `--home`.
 */
export function daemonHomeOf(args: { home?: string }): string {
  return args.home ?? resolveGnomonHome({ env: {} });
}

/**
 * `gnomond --foreground`: run until idle exit or a signal. Refuses to start
 * unless `--disable-sigusr1` is an interpreter flag (T-2026-10-18-030 (1)):
 * the clean re-exec passes it, and the bin's shebang passes it when gnomond
 * is run directly.
 */
export async function runForeground(args: DaemonArgs, runtime: { execArgv: readonly string[] } = { execArgv: process.execArgv }): Promise<number> {
  // Aegis M2: seal the inherited ready fd FIRST, before anything (the identity helper, the web transport) is spawned,
  // so no child of the kernel can write a forged ready line; unsealable => closed, the activator probes the socket
  const readyFd = args.readyFd !== undefined ? sealReadyFd(args.readyFd) : null;
  // Exit codes are classified (exit-codes.ts): config faults never restart, transient ones may.
  if (refuseDevHome(daemonHomeOf(args))) return exitCodeOfClass(STARTUP_FAULT_CLASS['dev-home']);
  const sig = sigusr1Refusal(runtime.execArgv);
  if (sig) {
    process.stderr.write(`gnomond: ${sig} [sigusr1-enabled]\n  next: run gnomond via its bin (the shebang passes --disable-sigusr1) or \`node --disable-sigusr1 <gnomond.js> --foreground\` (Node >= 22.14)\n`);
    return exitCodeOfClass(STARTUP_FAULT_CLASS['sigusr1-enabled']);
  }
  // Launched by an activator: its stderr pipe goes away once we are ready, and a write to it then is EPIPE, not a crash.
  let toStderr = (s: string): void => void process.stderr.write(s);
  if (args.readyFd !== undefined) process.stderr.on('error', () => undefined);
  let opened: { helper: { close(): Promise<void> } } | null = null;
  try {
    const home = daemonHomeOf(args);
    // M1.3: a provisioned home (keys/identity.json) runs on its hardware root + approvals key behind the
    // pinned signed helper; any failure to open it refuses to start (fail closed, never a software root)
    let hw: Awaited<ReturnType<typeof openHardwareIdentity>>;
    try {
      hw = await openHardwareIdentity(home);
    } catch (e) {
      if (e instanceof IdentityError) {
        process.stderr.write(`gnomond: the hardware identity of ${home} cannot be opened: ${e.message} [identity-${e.reason}]\n`);
        return exitCodeOfClass(STARTUP_FAULT_CLASS.identity);
      }
      throw e;
    }
    opened = hw;
    const handle = await startDaemon({
      home,
      ...(hw ? { rootAuthority: hw.root, approvalsKey: hw.approvals, helper: hw.helper } : {}),
      idleMs: args.idleMs ?? DEFAULT_IDLE_EXIT_MS,
      onEvent: (e) => toStderr(`${JSON.stringify(e)}\n`),
    });
    const onSignal = (): void => void handle.shutdown('signal');
    process.once('SIGTERM', onSignal);
    process.once('SIGINT', onSignal);
    process.stdout.write(`${JSON.stringify({ ready: true, pid: handle.pidfile.pid, socketPath: handle.pidfile.socketPath })}\n`);
    if (args.readyFd !== undefined) {
      if (readyFd !== null) writeReady(readyFd, { pid: handle.pidfile.pid, startedAt: handle.pidfile.startedAt, socketPath: handle.pidfile.socketPath, kernelPrincipal: handle.kernelPrincipal });
      toStderr = () => undefined; // the activator stopped reading; detached events went nowhere before the handshake too
    }
    await handle.exited;
    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);
    return EXIT_OK;
  } catch (err) {
    await opened?.helper.close().catch(() => undefined);
    if (isLifecycleRefusal(err)) {
      process.stderr.write(`${err.message} [${err.reason}]\n`);
      return exitCodeOfRefusal(err.reason);
    }
    throw err; // gnomond.ts maps it to DAEMON_EXIT.internal (exit-codes.ts)
  }
}

/**
 * Client activation (§2.4 rule 2): re-exec gnomond with the clean env and wait
 * for its `gnomonReady:v1` line on the inherited ready pipe (ready.ts). A
 * kernel that dies first is reported with its stderr tail and classified exit
 * code; an activator that lost the race attaches to the winner (exit 0).
 */
export async function activateDetached(
  args: DaemonArgs,
  gnomondEntry: string,
  resolveHome: (a: { home?: string }) => string = homeOf,
  launch: typeof launchDaemon = launchDaemon,
): Promise<number> {
  const home = resolveHome(args);
  if (refuseDevHome(home)) return exitCodeOfClass(STARTUP_FAULT_CLASS['dev-home']);
  const sock = socketOf(home);
  if (!sock) {
    process.stderr.write('gnomond: no safe endpoint path for this home [no-safe-endpoint]\n');
    return exitCodeOfRefusal('no-safe-endpoint');
  }
  if (await canConnectSocket(sock)) {
    process.stdout.write(`gnomond already running at ${sock}\n`);
    return EXIT_OK;
  }
  const isSea = path.resolve(process.execPath) === path.resolve(gnomondEntry);
  const outcome = await launch({
    execPath: process.execPath,
    ...(isSea ? {} : { entry: gnomondEntry }),
    home,
    socketPath: sock,
    ...(args.idleMs !== undefined ? { idleMs: args.idleMs } : {}),
  });
  switch (outcome.kind) {
    case 'ready':
      process.stdout.write(`gnomond started at ${outcome.identity.socketPath} (pid ${outcome.identity.pid})\n`);
      break;
    case 'attached':
      process.stdout.write(`gnomond already running at ${outcome.socketPath}\n`);
      break;
    case 'exited':
      process.stderr.write(
        `gnomond: exited ${outcome.code ?? outcome.signal} before ready [${outcome.class}]\n${outcome.stderrTail.replace(/^/gm, '  | ')}${outcome.stderrTail.endsWith('\n') || outcome.stderrTail === '' ? '' : '\n'}`,
      );
      break;
    case 'timeout':
      process.stderr.write(`gnomond: not ready in time (pid ${outcome.pid ?? '?'} left running) [transient]\n${outcome.stderrTail.replace(/^/gm, '  | ')}\n`);
      break;
  }
  return exitCodeOfLaunch(outcome);
}

/** `gnomon daemon status|stop|--detach`. */
export async function runDaemonCommand(argv: readonly string[], gnomondEntry: string): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === '--detach' || sub === 'start') {
    const parsed = parseDaemonArgs(rest);
    if (typeof parsed === 'string') return usage(parsed);
    return activateDetached(parsed, gnomondEntry);
  }
  if (sub !== 'status' && sub !== 'stop') return usage(`unknown daemon subcommand ${sub ?? '(none)'}`);
  const parsed = parseDaemonArgs(rest);
  if (typeof parsed === 'string') return usage(parsed);
  const home = homeOf(parsed);
  const sock = socketOf(home);
  if (!sock) {
    process.stderr.write('gnomon: no safe endpoint path for this home\n');
    return EXIT_REFUSED;
  }
  if (sub === 'stop') {
    const refusal = refuse({ code: 'ENGINE', data: { reason: 'not-implemented', verb: 'daemon stop', milestone: 'M1.6' } });
    process.stderr.write(
      `${JSON.stringify({ code: -32000, message: 'daemon stop is approval-signed (§3.1 I3); it arrives with #approval-broker (M1.6). The daemon exits on idle.', data: refusal })}\n`,
    );
    return EXIT_REFUSED;
  }
  try {
    const session = await connectGnomon({ socketPath: sock, client: { name: 'gnomon', version: GNOMON_VERSION, surface: 'cli' } });
    await session.conn.close();
    const st = daemonState(home, sock);
    process.stdout.write(
      `${JSON.stringify({
        running: true,
        socketPath: sock,
        clientApi: session.hello.clientApi,
        serverKeyId: session.hello.serverKeyId,
        serverVerified: session.serverVerified,
        authenticated: false,
        reason: 'root-unprovisioned: no root-signed kernel-key or device row until #identity M1.3',
        diagnosticPid: st.state === 'running' ? st.pidfile.pid : null,
      })}\n`,
    );
    return EXIT_OK;
  } catch (err) {
    if (err instanceof RefusedError || err instanceof ServerAuthError) {
      process.stderr.write(`${JSON.stringify({ refused: true, message: err.message, ...(err instanceof RefusedError ? { data: refusalOf({ refusal: err.refusal }) } : {}) })}\n`);
      return EXIT_REFUSED;
    }
    const st = daemonState(home, sock);
    process.stdout.write(`${JSON.stringify({ running: false, state: st.state })}\n`);
    return EXIT_NOT_RUNNING;
  }
}

function usage(msg: string): number {
  process.stderr.write(
    `gnomon ${GNOMON_VERSION}: ${msg}\nusage: gnomond [--foreground] [--home <abs>] [--idle-ms <n>]\n       gnomon daemon status|stop|--detach [--home <abs>]\n`,
  );
  return EXIT_USAGE;
}

export { usage as daemonUsage };

/** The gnomond entry next to this bundle (dist/cli/gnomond.js), or the SEA itself. */
export function gnomondEntryFrom(metaUrl: string): string {
  return path.join(path.dirname(fileURLToPath(metaUrl)), 'gnomond.js');
}
