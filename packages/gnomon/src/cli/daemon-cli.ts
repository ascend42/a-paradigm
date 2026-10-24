/**
 * @symbol $daemon-lifecycle
 *
 * $daemon-lifecycle (spec §2.4) — CLI glue for `gnomond` and `gnomon daemon`.
 * Writes to stdio directly: the kernel has zero deps (G-SEC-01) and cannot use
 * the Paradigm logger; #kernel-log brings structured logging at M1.2.
 *
 * `gnomon daemon status` sends `hello` and does NOT authenticate or call
 * `status`. It PINS the hello's serverSig (T-2026-10-19-016(a)): the
 * kernel key the hello names must be in this home's root-signed registry
 * (pinSource `registry`) or in the home's own `keys/kernel-pub.jsonl`
 * (pinSource `home-kernel-pub`: same-user, not root-signed — custody
 * `partial`), and a fresh pinned hello must verify against it. Only then is
 * `running:true` printed. A hello whose key the home does not know is NOT
 * proof of a kernel (a socket squatter can claim any key id): it prints
 * `running:null, answering:true, serverVerified:false` with what the server
 * claimed nested under `unverified`. A hello whose key IS known but whose
 * signature does not verify is refused. The pidfile pid is shown as a
 * diagnostic only (§2.4: never trusted). `gnomon daemon stop` is
 * approval-signed (§3.1 I3, F3): the kernel raises a daemon-stop card
 * (DaemonHandle.requestStop) and stops only on a fresh-presence accept. The
 * CLI pins the kernel key, authenticates as the home's human device and calls
 * the human-device verb daemon.stop (TD-2026-10-19-339); it exits 0 once the
 * card is raised. With no kernel it refuses REFUSED ENGINE not-running.
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canConnectSocket,
  DEFAULT_IDLE_EXIT_MS,
  exitCodeOfClass,
  exitCodeOfExitReason,
  exitCodeOfLaunch,
  exitCodeOfRefusal,
  launchDaemon,
  openReadyFifo,
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
import { readKernelBuild } from '../kernel/lifecycle/build-stamp.js';
import { connectGnomon, ServerAuthError } from '../kernel/socket/index.js';
import { IdentityError, openHardwareIdentity, readKernelPubs, readRegistry } from '../kernel/identity/index.js';
import type { ServerKeyPin } from '../kernel/socket/client.js';
import { homeTrust } from './mod-cli.js';
import { refusalOf, RefusedError } from '@a-company/gnomon-contracts';
import { GNOMON_VERSION } from '../version.js';
import { existsSync } from 'node:fs';
import { DEV_HOME_MARKER } from './dev-home.js';
import { readHandoffStdin, spawnSuccessor, successorPlanOf, WEB_LISTEN_FD } from '../kernel/lifecycle/successor.js';
import { parseResumeRecord, type ResumeRecord } from '../kernel/web/resume.js';
import { SoftwareEd25519Signer } from '../kernel/log/index.js';
import { heading, readout, refused } from './readout.js';
import { humanDeviceOf } from './rules-cli.js';

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
  /** The activator's private ready FIFO (ready.ts 'fifo' channel, linux); set only by launchDaemon's re-exec. */
  readyFifo?: string;
  /** TD-2026-10-19-063: an upgrade successor asks for its predecessor's web port first (127.0.0.1, exclusive). */
  preferPort?: number;
  /** TD-2026-10-19-063: the predecessor hands this successor its kernel key on the stdin pipe. */
  kernelKeyStdin?: boolean;
  /** Aegis H: the predecessor's web listening socket is inherited at this fd */
  webListenFd?: number;
  /** #gui-relaunch: the activator does not open the GUI after the start (GNOMON_NO_OPEN=1 does the same). Never passed to gnomond. */
  noOpen?: boolean;
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
    } else if (a === '--ready-fifo') {
      const v = argv[++i];
      if (!v || !path.isAbsolute(v)) return '--ready-fifo needs an absolute path';
      out.readyFifo = v;
    } else if (a === '--kernel-key-stdin') out.kernelKeyStdin = true;
    else if (a === '--no-open') out.noOpen = true;
    else if (a === '--web-listen-fd') {
      const v = Number(argv[++i]);
      if (v !== WEB_LISTEN_FD) return `--web-listen-fd is ${WEB_LISTEN_FD}`;
      out.webListenFd = v;
    }
    else if (a === '--prefer-port') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 1 || v > 65535) return '--prefer-port needs a port 1..65535';
      out.preferPort = v;
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
  // (the 'fifo' channel: open our write end O_CLOEXEC and unlink the name, before anything is spawned)
  const readyFd = args.readyFd !== undefined ? sealReadyFd(args.readyFd) : args.readyFifo !== undefined ? openReadyFifo(args.readyFifo) : null;
  const launched = args.readyFd !== undefined || args.readyFifo !== undefined;
  // Exit codes are classified (exit-codes.ts): config faults never restart, transient ones may.
  if (refuseDevHome(daemonHomeOf(args))) return exitCodeOfClass(STARTUP_FAULT_CLASS['dev-home']);
  const sig = sigusr1Refusal(runtime.execArgv);
  if (sig) {
    process.stderr.write(`gnomond: ${sig} [sigusr1-enabled]\n  next: run gnomond via its bin (the shebang passes --disable-sigusr1) or \`node --disable-sigusr1 <gnomond.js> --foreground\` (Node >= 24, the source-install floor)\n`);
    return exitCodeOfClass(STARTUP_FAULT_CLASS['sigusr1-enabled']);
  }
  // Launched by an activator: its stderr pipe goes away once we are ready, and a write to it then is EPIPE, not a crash.
  let toStderr = (s: string): void => void process.stderr.write(s);
  if (launched) process.stderr.on('error', () => undefined);
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
    // TD-2026-10-19-063: an upgrade successor runs on the key its predecessor minted (the GUI was told its public half)
    let kernelSigner: SoftwareEd25519Signer | undefined;
    // Aegis M: a resume record is read ONLY from the stdin hand-off, ONLY when --kernel-key-stdin is set
    let resumeHandoff: ResumeRecord | null = null;
    if (args.kernelKeyStdin) {
      const h = await readHandoffStdin();
      if (h === null) {
        process.stderr.write('gnomond: --kernel-key-stdin given but no hand-off arrived on stdin [kernel-key-stdin]\n');
        return exitCodeOfClass(STARTUP_FAULT_CLASS.identity);
      }
      kernelSigner = new SoftwareEd25519Signer(h.kernelKeyPem, 'kernel');
      resumeHandoff = parseResumeRecord(h.resume, Date.now());
    }
    const handle = await startDaemon({
      ...(kernelSigner ? { kernelSigner, resumeHandoff } : {}),
      home,
      ...(hw ? { rootAuthority: hw.root, approvalsKey: hw.approvals, helper: hw.helper } : {}),
      idleMs: args.idleMs ?? DEFAULT_IDLE_EXIT_MS,
      onEvent: (e) => toStderr(`${JSON.stringify(e)}\n`),
      ...(args.preferPort !== undefined || args.webListenFd !== undefined ? { web: { ...(args.preferPort !== undefined ? { preferPort: args.preferPort } : {}), ...(args.webListenFd !== undefined ? { inheritFd: args.webListenFd } : {}) } } : {}),
      ...(hw?.repin ? { update: { helper: { check: () => hw!.repin() } } } : {}),
    });
    const onSignal = (): void => void handle.shutdown('signal');
    process.once('SIGTERM', onSignal);
    process.once('SIGINT', onSignal);
    process.stdout.write(`${JSON.stringify({ ready: true, pid: handle.pidfile.pid, socketPath: handle.pidfile.socketPath })}\n`);
    if (launched) {
      if (readyFd !== null) writeReady(readyFd, { pid: handle.pidfile.pid, startedAt: handle.pidfile.startedAt, socketPath: handle.pidfile.socketPath, kernelPrincipal: handle.kernelPrincipal });
      toStderr = () => undefined; // the activator stopped reading; detached events went nowhere before the handshake too
    }
    const reason = await handle.exited;
    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);
    // TD-2026-10-19-063: an ACCEPTED upgrade drained, released the lock and socket; now ONE detached successor, then exit
    const handoff = handle.upgradeHandoff();
    if (reason === 'upgrade' && handoff) {
      const fd = (handoff.listener as unknown as { _handle?: { fd?: number } } | null)?._handle?.fd;
      spawnSuccessor(successorPlanOf(home, handoff.preferPort, { ...(args.idleMs !== undefined ? { idleMs: args.idleMs } : {}), ...(typeof fd === 'number' && fd >= 0 ? { listenFd: fd } : {}), handoff: { kernelKeyPem: handoff.successorKeyPem, resume: handoff.resume } }));
      handoff.listener?.close(); // the successor holds its own copy of the socket now
    }
    return exitCodeOfExitReason(reason); // upgrade: ok, 0, no restart (EXIT_REASON_CLASS)
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
  /** #gui-relaunch (T-2026-10-20-001): open the GUI once a FRESH kernel is ready (cli/relaunch.ts); never after attach. */
  openGui: ((home: string, out: { write(s: string): unknown }) => Promise<boolean>) | null = null,
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
      // a start outside the terminal launch loop still opens the GUI (the URL goes to the browser opener only)
      if (openGui && args.noOpen !== true) await openGui(home, process.stdout).catch(() => false);
      break;
    case 'attached':
      process.stdout.write(`gnomond already running at ${outcome.socketPath}\n`);
      if (outcome.readyDowngrade) process.stderr.write(`gnomon: ${outcome.readyDowngrade}\n`);
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
export async function runDaemonCommand(argv: readonly string[], gnomondEntry: string, openGui: Parameters<typeof activateDetached>[4] = null): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === '--detach' || sub === 'start') {
    const parsed = parseDaemonArgs(rest);
    if (typeof parsed === 'string') return usage(parsed);
    return activateDetached(parsed, gnomondEntry, homeOf, launchDaemon, openGui);
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
  if (sub === 'stop') return runDaemonStop(home, sock);
  const client = { name: 'gnomon', version: GNOMON_VERSION, surface: 'cli' as const };
  try {
    // 1) an unpinned hello only learns which key the server CLAIMS to hold
    const probe = await connectGnomon({ socketPath: sock, client });
    await probe.conn.close();
    const st = daemonState(home, sock);
    const diagnosticPid = st.state === 'running' ? st.pidfile.pid : null;
    const found = kernelPinOf(home, probe.hello.serverKeyId);
    if (!found) {
      // never `running:true` on an unverified hello: a squatter can claim any key id
      process.stdout.write(
        `${JSON.stringify({
          running: null,
          answering: true,
          socketPath: sock,
          serverVerified: false,
          authenticated: false,
          unverified: { clientApi: probe.hello.clientApi, serverKeyId: probe.hello.serverKeyId },
          reason: 'unverified-server: the key this server names is in neither the root-signed registry nor this home\'s kernel-pub.jsonl, so its hello proves nothing',
          diagnosticPid,
        })}\n`,
      );
      return EXIT_OK;
    }
    // 2) a fresh hello (new clientNonce) whose serverSig must verify against the pin
    const session = await connectGnomon({ socketPath: sock, client, serverKey: found.pin });
    await session.conn.close();
    process.stdout.write(
      `${JSON.stringify({
        running: true,
        socketPath: sock,
        clientApi: session.hello.clientApi,
        serverKeyId: session.hello.serverKeyId,
        serverVerified: session.serverVerified,
        pinSource: found.source,
        // T-2026-10-21-028 #release-pins: `release` = helper and voice-io sha256-pinned; `dev` = signature + version floor only
        build: readKernelBuild(home)?.pins ?? 'unknown',
        authenticated: false,
        reason: 'status sends hello only; it does not authenticate',
        diagnosticPid,
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

/**
 * `gnomon daemon stop` (T-2026-10-19-014 B0, founder rulings F3 of TD-2026-10-19-528 and TD-2026-10-19-339).
 * No kernel answering: REFUSED ENGINE not-running. A kernel answering: its hello must verify against a key this
 * home records (kernelPinOf; an unrecorded key gets nothing sent to it), then the CLI authenticates as this home's
 * human device and calls the human-device verb `daemon.stop{reason:'stop'}`. The kernel raises its signed
 * daemon-stop card; this exits 0 once the card is raised and does NOT wait for the decision. The kernel stops only
 * when the human accepts the card with Touch ID. It is never stopped by a signal or the pidfile pid from here.
 */
async function runDaemonStop(home: string, sock: string): Promise<number> {
  const client = { name: 'gnomon', version: GNOMON_VERSION, surface: 'cli' as const };
  let keyId: string;
  try {
    const probe = await connectGnomon({ socketPath: sock, client });
    await probe.conn.close();
    keyId = probe.hello.serverKeyId;
  } catch (err) {
    if (err instanceof RefusedError || err instanceof ServerAuthError) {
      refused(process.stderr, err instanceof RefusedError ? err.refusal.code : 'AUTH', err instanceof RefusedError ? String(err.refusal.data?.reason ?? 'refused') : 'server-auth', err.message);
      return EXIT_REFUSED;
    }
    refused(process.stderr, 'ENGINE', 'not-running', `no daemon answers on ${home}; nothing to stop`);
    return EXIT_REFUSED;
  }
  const found = kernelPinOf(home, keyId);
  if (!found) {
    refused(process.stderr, 'AUTH', 'unverified-server', "the process answering this home's socket names a kernel key this home does not record; nothing is sent to it");
    return EXIT_REFUSED;
  }
  const device = humanDeviceOf(home);
  if (typeof device === 'string') {
    refused(process.stderr, 'FORBIDDEN', 'no-human-device', device, ['gnomon setup']);
    return EXIT_REFUSED;
  }
  let s: Awaited<ReturnType<typeof connectGnomon>>;
  try {
    s = await connectGnomon({ socketPath: sock, client, serverKey: found.pin, device });
  } catch (err) {
    if (err instanceof RefusedError) {
      refused(process.stderr, err.refusal.code, String(err.refusal.data?.reason ?? 'refused'), err.message);
      return EXIT_REFUSED;
    }
    refused(process.stderr, 'AUTH', 'server-auth', (err as Error).message);
    return EXIT_REFUSED;
  }
  try {
    const r = await s.conn.call('daemon.stop', { reason: 'stop' });
    if ('error' in r) {
      const data = refusalOf(r);
      refused(process.stderr, data?.code ?? 'ENGINE', String(data?.data?.reason ?? 'refused'), r.error.message);
      return EXIT_REFUSED;
    }
    const card = r.result as { cardId?: unknown; state?: unknown };
    heading(process.stdout, 'card raised', String(card.cardId ?? ''));
    readout(process.stdout, [
      ['kind', 'daemon-stop (signed)'],
      ['state', String(card.state ?? 'pending')],
      ['next', 'approve it in Gnomon with Touch ID; the kernel stops only on accept'],
      ['else', 'reject, or no answer in 2 min, keeps it running'],
    ]);
    return EXIT_OK;
  } finally {
    await s.conn.close();
  }
}

/**
 * The pin for `keyId`, read from the home (never from the server): the
 * root-signed registry first, else the home's same-user kernel-pub.jsonl.
 */
export function kernelPinOf(home: string, keyId: string): { pin: ServerKeyPin; source: 'registry' | 'home-kernel-pub' } | null {
  if (typeof keyId !== 'string' || keyId === '') return null;
  try {
    const pem = readRegistry(home, homeTrust(home)).kernelKeys.get(keyId);
    if (pem) return { pin: { keyId, publicKeyPem: pem }, source: 'registry' };
  } catch {
    /* no registry: fall through */
  }
  const pub = readKernelPubs(home).find((k) => k.keyId === keyId);
  return pub ? { pin: { keyId, publicKeyPem: pub.publicKeyPem }, source: 'home-kernel-pub' } : null;
}

function usage(msg: string): number {
  process.stderr.write(
    `gnomon ${GNOMON_VERSION}: ${msg}\nusage: gnomond [--foreground] [--home <abs>] [--idle-ms <n>] [--no-open]\n       gnomon daemon status|stop|--detach [--home <abs>] [--no-open]\n`,
  );
  return EXIT_USAGE;
}

export { usage as daemonUsage };

/** The gnomond entry next to this bundle (dist/cli/gnomond.js), or the SEA itself. */
export function gnomondEntryFrom(metaUrl: string): string {
  return path.join(path.dirname(fileURLToPath(metaUrl)), 'gnomond.js');
}
