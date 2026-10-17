/**
 * $daemon-lifecycle (spec §2.4) — CLI glue for `gnomond` and `gnomon daemon`.
 * Writes to stdio directly: the kernel has zero deps (G-SEC-01) and cannot use
 * the Paradigm logger; #kernel-log brings structured logging at M1.2.
 */
import * as net from 'node:net';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_IDLE_EXIT_MS,
  daemonState,
  isLifecycleRefusal,
  resolveGnomonHome,
  selectSocketPath,
  spawnDetachedDaemon,
  startDaemon,
} from '../kernel/lifecycle/index.js';
import { rpcCall } from '../kernel/socket/index.js';
import { GNOMON_VERSION } from '../version.js';

export const EXIT_OK = 0;
export const EXIT_REFUSED = 1;
export const EXIT_NOT_RUNNING = 3;
export const EXIT_USAGE = 64;

export interface DaemonArgs {
  foreground: boolean;
  home?: string;
  idleMs?: number;
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

function canConnect(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const c = net.connect(socketPath);
    c.once('connect', () => {
      c.destroy();
      resolve(true);
    });
    c.once('error', () => resolve(false));
  });
}

/** `gnomond --foreground`: run until idle exit or a signal. */
export async function runForeground(args: DaemonArgs): Promise<number> {
  try {
    const handle = await startDaemon({
      home: homeOf(args),
      idleMs: args.idleMs ?? DEFAULT_IDLE_EXIT_MS,
      onEvent: (e) => process.stderr.write(`${JSON.stringify(e)}\n`),
    });
    const onSignal = (): void => void handle.shutdown('signal');
    process.once('SIGTERM', onSignal);
    process.once('SIGINT', onSignal);
    process.stdout.write(`${JSON.stringify({ ready: true, pid: handle.pidfile.pid, socketPath: handle.pidfile.socketPath })}\n`);
    await handle.exited;
    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);
    return EXIT_OK;
  } catch (err) {
    if (isLifecycleRefusal(err)) {
      process.stderr.write(`${err.message} [${err.reason}]\n`);
      return EXIT_REFUSED;
    }
    throw err;
  }
}

/**
 * Client activation (§2.4 rule 2): re-exec gnomond with the clean env and
 * wait for the socket (5 × 200 ms, then a little longer for a cold start).
 */
export async function activateDetached(args: DaemonArgs, gnomondEntry: string): Promise<number> {
  const home = homeOf(args);
  const sock = socketOf(home);
  if (!sock) {
    process.stderr.write('gnomond: no safe endpoint path for this home [no-safe-endpoint]\n');
    return EXIT_REFUSED;
  }
  if (await canConnect(sock)) {
    process.stdout.write(`gnomond already running at ${sock}\n`);
    return EXIT_OK;
  }
  const isSea = path.resolve(process.execPath) === path.resolve(gnomondEntry);
  spawnDetachedDaemon({
    execPath: process.execPath,
    ...(isSea ? {} : { entry: gnomondEntry }),
    home,
    ...(args.idleMs !== undefined ? { idleMs: args.idleMs } : {}),
  });
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await canConnect(sock)) {
      process.stdout.write(`gnomond started at ${sock}\n`);
      return EXIT_OK;
    }
  }
  process.stderr.write('gnomond: did not come up within 5 s\n');
  return EXIT_REFUSED;
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
  let resp;
  try {
    resp = await rpcCall(sock, sub === 'status' ? 'daemon.status' : 'daemon.stop');
  } catch {
    const st = daemonState(home, sock);
    process.stdout.write(`${JSON.stringify({ running: false, state: st.state })}\n`);
    return EXIT_NOT_RUNNING;
  }
  if ('error' in resp) {
    process.stderr.write(`${JSON.stringify(resp.error)}\n`);
    return EXIT_REFUSED;
  }
  process.stdout.write(`${JSON.stringify({ running: true, ...(resp.result as object) })}\n`);
  return EXIT_OK;
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
