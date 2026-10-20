/**
 * @symbol $daemon-lifecycle
 *
 * $daemon-lifecycle (spec §2.4) — the PR-5 core: home (0700, read back) →
 * endpoint path (never /tmp) → O_EXCL pidfile lock → #socket at 0600 → idle
 * monitor. Exit paths (idle, signal) close the socket and release the lock
 * only if it is still ours.
 *
 * M1.4 slice 1: after the lock, the daemon opens #kernel-log with a kernel
 * key, then serves #socket through the hello/auth dispatcher. daemon.start,
 * daemon.exit, socket.connect, socket.frame.refused and every socket.hello /
 * socket.auth.* outcome are appended to the log (and still reported to
 * `onEvent`; daemon.lock.refused stays callback-only — the refused daemon
 * does not hold the log). KERNEL KEY SEAM: the key is a software Ed25519 key
 * — `opts.kernelSigner`, or an EPHEMERAL in-memory key per daemon start;
 * the daemon itself never reads a key file (§3.1). The ONE exception is the
 * DEV-ONLY `gnomon dev up` (#dev-launch), which runs startDaemon in the
 * `gnomon` CLI's own process and supplies a kernel key it read from a marked
 * dev home; gnomond never does, and refuses a dev home outright
 * (daemon-cli.ts refuseDevHome). Status reports custody `partial`. Only its PUBLIC half
 * is recorded in <home>/keys/kernel-pub.jsonl and every recorded key is loaded
 * into the log's key ring / kernelKeyIds, so verify works across restarts —
 * but across restarts a kernel signature proves nothing against a same-user
 * forger until M1.3 (identity/kernel-pub.ts). Pre-auth diagnostics
 * (socket.connect, socket.frame.refused, pre-auth closures) are COALESCED into
 * one signed counter row per kind per `diagFlushMs` window (default 10 s) and
 * at shutdown. socket.hello and socket.auth.fail are RATE-LIMITED: the first
 * `preAuthRowsPerWindow` (8) of each per window are written individually, the
 * rest are folded into that window's signed counter row of the same kind
 * (byOutcome / byReason); since #web-endpoint socket.auth.replay and
 * socket.auth.reconnect.requested are folded the same way. socket.auth.ok
 * stays individual. So an
 * unauthenticated flood adds at most 8 + 1 rows per kind per window. The keystore item
 * behind the signed helper is #identity M1.3. ROOT SEAM: `opts.rootAuthority`
 * defaults to UnprovisionedRootAuthority (no device can authenticate before
 * M1.3); the dev/test root is programmatic only, never env/argv (§15.3). The
 * one non-test caller is `gnomon dev up` (#dev-launch), which reloads it from a
 * marked DEV home file in the `gnomon` CLI process; gnomond never constructs it.
 *
 * M1.4 #web-endpoint: `requestWebLaunch(connId)` — the kernel side of
 * `gnomon open` for an authenticated HUMAN device connection on the unix
 * socket — starts the web endpoint on first use (web/endpoint.ts: the
 * `gnomon-web` transport child under the `transport` sandbox profile, the
 * pinned bundle) and mints a single-use launch token that is returned to the
 * caller in-process, never on any argv, env or file. The web endpoint runs its
 * own dispatcher (same verbs, log, status and read-token store rules; its
 * authenticator signs `ws://127.0.0.1:<port>/rpc`). It lingers 2 min after the
 * last GUI session and stops with the daemon. NOTE: §5 names no verb for
 * `gnomon open` and adding one is the M1.4 falsifier, so this is an
 * in-process API until the spec names the wire path (reported).
 *
 * M1.9: #scheduler runs log-derived timers and `automation:v1` records
 * (`opts.automations`; root-signed config supplies them later — none by
 * default, so a fresh install spends nothing, law 5) and holds idle exit while
 * a timer is due inside 10 min; DaemonChildren tracks session / local-runner /
 * mod children and every shutdown (idle included) stops them and awaits their
 * exit BEFORE `daemon.exit` is written (falsifier: daemon exits with a live
 * child); the start-up orphan sweep stops what a crashed daemon left behind
 * (`session.orphaned`, G-DMN-04); an open GUI WebSocket counts as a
 * subscriber. Not yet here: the session runner itself (M1.7/M1.8) and an
 * approved `stop` (#approval-broker, M1.6).
 *
 * M1.11 slice 2: #mod-host is constructed here (home, root authority,
 * DaemonChildren, the kernel log as its event sink, the kernel principal for
 * re-approve cards). Its `kernel.call` goes to the REAL dispatcher run as the
 * mod principal (`dispatcher.callAs`) and its own-modns `log.append` to the
 * log under the mod principal with the fields clamped (modhost/bridge.ts,
 * Aegis C2); the client relays `mod.view` / `mod.command` reach it through
 * both dispatchers (socket and web) with relayedFor stamped from the caller's
 * connection; `status.mods` lists the running and paused mods. Mods start on
 * first relay and never hold idle; every exit (idle included) stops them
 * (ModHost.stopAll, so no restart races the sweep) BEFORE the children sweep.
 */
import * as nodeOs from 'node:os';
import { generateKeyPairSync } from 'node:crypto';
import { ApprovalBroker, type ApprovalsKey } from '../broker/broker.js';
import type { HelperPush, HelperTransport } from '../identity/helper.js';
import { VoiceArmCustody } from '../broker/arm-custody.js';
import { readRegistry } from '../identity/registry.js';
import { ApiTokenBilling } from '../broker/api-token.js';
import { DaemonStopCards, type DaemonStopReason } from '../broker/daemon-stop.js';
import { LOOSEN_TIMEOUT_MS, modeSourceOf, RunModeBook, RunModeControl } from '../broker/run-mode.js';
import { repoKeyOf } from '../supervisor/repo-hooks.js';
import type { CardV1 } from '@a-company/gnomon-contracts';
import { createApprovalPort } from '../broker/port.js';
import { BudgetFuse, FUSE_RESTORE_KINDS, type FuseRow } from '../budget/fuse.js';
import { loadFuseConfig } from '../budget/config.js';
import { fileLayers } from '../budget/billing.js';
import * as path from 'node:path';
import { completePendingQuarantine, readBootSession, KernelLog, KeyRing, SoftwareEd25519Signer, type Signer } from '../log/index.js';
import { readKernelPubs, recordKernelPub, UNPROVISIONED_NS, UnprovisionedRootAuthority, type RootAuthority } from '../identity/index.js';
import {
  createKernelDispatcher,
  SubscriptionHub,
  listenSocket,
  SocketAuthenticator,
  type SocketEvent,
  type SocketLogKind,
  type SocketServerHandle,
  type SubscriptionStats,
  type KernelDispatcher,
  type HumanDeviceVerbPorts,
} from '../socket/index.js';
import { createGuiOpenHandler } from '../socket/gui-open.js';
import { createDaemonStopHandler } from '../socket/daemon-stop-verb.js';
import { spkiBase64Url, WebEndpoint, type LaunchGrant } from '../web/endpoint.js';
import type { LaunchAsker } from '../web/launch-cap.js';
import { selectSocketPath, type EndpointVia } from './endpoint.js';
import { ensureGnomonHome } from './home.js';
import { DEFAULT_IDLE_EXIT_MS, IdleMonitor } from './idle.js';
import { acquireDaemonLock, pidPathOf, reclaimResiduePidfile, releaseDaemonLock, type DaemonPidfile } from './pidfile.js';
import { helloProbe } from './ready.js';
import { LifecycleRefusal } from './refusal.js';
import { Scheduler } from '../scheduler/index.js';
import { DaemonChildren, sweepOrphans } from './children.js';
import { planResume, resumeAfterUpgrade, type ResumeReport, type ResumeRow } from '../supervisor/resume.js';
import { processControlFor, processStartMs } from './process-control.js';
import { SessionSupervisor, createSessionPort } from '../supervisor/index.js';
import { ClaudeRepinCards, REPIN_POLL_MS } from '../runner/repin-card.js';
import { resolveClaudeSource } from '../runner/preflight.js';
import { claudeVerifierFor } from '../../platform/claude-verifier.js';
import { claudeCodePlatform } from '../../platform/claude-code.js';
import { repoHookDecisionsFrom } from '../supervisor/repo-hooks.js';
import { catchUp, RuleBook, ruleSourceOf } from '../supervisor/rules.js';
import { createRulesRevokeHandler } from '../socket/rules-revoke.js';
import { loadLocalConfig, LOCAL_CONFIG_FILE } from '../local/config.js';
import { linkedFolders } from '../manifest/install.js';
import { ModHost, type KernelCallRequest } from '../modhost/host.js';
import { StagedCardPickup } from '../modhost/control.js';
import { createModKernelCall, createModRelayPort } from '../modhost/bridge.js';
import type { BillingScanSource } from '../budget/billing.js';
import { registerSeams } from '../internal-seams.js';
import { VoiceControl } from '../voice/voice-control.js';
import { defaultBuildStampPath, describeUpdate, readBuildStamp, writeKernelBuild, type BuildStamp } from './build-stamp.js';
import { UpdateWatch } from './update-watch.js';
import { mintResumeToken, resumeRecordOf, ResumeGate, RESUME_TOKEN_TTL_MS, type ResumeRecord } from '../web/resume.js';
import type * as net from 'node:net';
import { readEnrolled } from '../voice/enrolment.js';
import { VoiceChildSupervisor, type VoiceChildOptions } from '../voice/voice-child.js';
import { createVoicePrepare, resolveVoiceClientEntry } from '../voice/voice-install.js';
import { VoiceEnrolCards, VoiceReports } from '../voice/voice-requests.js';
import { KernelSpeakable } from '../voice/speakable.js';
import { spawn as spawnChild } from 'node:child_process';

/**
 * `stop`: an accepted daemon-stop card (§3.1 I3, F3). `upgrade`: an accepted daemon-stop{reason:'upgrade'} card,
 * after the §2.4 rule 11 drain (T-2026-10-19-014 B1). The exit class of each is EXIT_REASON_CLASS (exit-codes.ts):
 * every reason but `error` is ok, exit 0, no restart.
 */
export type DaemonExitReason = 'idle' | 'signal' | 'error' | 'stop' | 'upgrade';

/** Events named after the §9.1 `daemon` and `socket` kinds; the kernel log takes them at M1.2. */
export type DaemonEvent =
  | { kind: 'daemon.start'; pid: number; socketPath: string; via: EndpointVia; idleMs: number }
  | { kind: 'daemon.exit'; reason: DaemonExitReason }
  | { kind: 'daemon.lock.refused'; reason: string; holderPid?: number }
  /** T-2026-10-19-017: a silent holder whose process started after the pidfile was written (a recycled pid) was reclaimed. */
  | { kind: 'daemon.lock.reclaimed'; holderPid: number; startedAt: string; holderStart: string }
  /** N3: a security-relevant mod row (mod.paused, mod.effect.refused) could not be written to the chain. */
  | { kind: 'daemon.mod.row.unrecorded'; rowKind: string; name: string | null; error: string }
  /** A read-token revocation could not be written to the chain twice; it stays pending and is retried on the token timer. */
  | { kind: 'daemon.token.revocation.unrecorded'; tokenId: string; error: string }
  /** #budget-fuse: the chain's time ran ahead of the wall clock beyond the skew allowance; the wall clock keys the day (once). */
  | { kind: 'daemon.fuse.clock.skew'; chainAt: string; wall: string }
  /** TD-2026-10-19-063: #update-watch saw a new build stamp and raised (or found) the upgrade card. */
  | { kind: 'daemon.update.detected'; from: string | null; to: string; cardId: string | null }
  | SocketEvent;

export interface DaemonOptions {
  /** Test seam: does a kernel answer `hello` on our socket (default helloProbe, ready.ts); judges a live pidfile holder (Aegis L2). */
  probeHolder?: (socketPath: string) => Promise<boolean>;
  /** How long a live-but-silent holder is given to start answering before `holder-silent` (default HOLDER_GRACE_MS). */
  holderGraceMs?: number;
  /** Test seam: wall-clock start (epoch ms) of a silent holder's pid, null = can't tell (default process-control.ts processStartMs). */
  holderStartMs?: (pid: number) => number | null;
  /** `gnomon mod` pickup scan period (default PICKUP_SCAN_MS); tests shorten it */
  modPickupMs?: number;
  home: string;
  idleMs?: number;
  /** Test seam: per-subscription undelivered-frame cap (default 10 000, §4.9). */
  subscriptionBacklogCap?: number;
  platform?: NodeJS.Platform;
  env?: Readonly<Record<string, string | undefined>>;
  maxFrameBytes?: number;
  onEvent?: (event: DaemonEvent) => void;
  /** Kernel key seam (software Ed25519; default: ephemeral per start). Keystore custody is M1.3. */
  kernelSigner?: Signer;
  /** Root seam (default: UnprovisionedRootAuthority). Tests pass a DevTestRootAuthority; gnomond passes the HardwareRootAuthority of a provisioned home (M1.3). */
  rootAuthority?: RootAuthority;
  /** M1.3: the approvals key (HelperApprovalsKey behind the signed helper). Default: none (approve refuses UNSUPPORTED presence). */
  approvalsKey?: ApprovalsKey & { onHelperExit?(cb: () => void): void; onHelperPush?(cb: (p: HelperPush) => void): void; closeArm?(armId: string): Promise<void> };
  /** M1.3: the helper child the keys live behind; closed (EOF: every unlock dies) at shutdown. */
  helper?: HelperTransport;
  /** Test seam: the auth clock (nonce expiry). */
  clock?: () => number;
  /** Coalesced diagnostic row window (default 10 s). */
  diagFlushMs?: number;
  /** Individual socket.hello / socket.auth.fail rows per window before folding (default 8). */
  preAuthRowsPerWindow?: number;
  /** Pre-auth inbound frame cap (default 16 KiB). */
  preAuthMaxFrameBytes?: number;
  /** Pre-auth and flow-control seams (defaults: dispatch.ts / server.ts). */
  helloTimeoutMs?: number;
  preAuthTimeoutMs?: number;
  maxPreAuth?: number;
  /** Token-file refresh period at the daemon (default 60 s; records revocations with no live token connection). */
  tokenRefreshMs?: number;
  /** Read-token revocation re-check period (default dispatch.ts TOKEN_RECHECK_MS). */
  tokenRecheckMs?: number;
  maxInFlight?: number;
  writeHighWater?: number;
  /** #web-endpoint timing seams (defaults: 2 min linger, 5 s auth deadline). */
  web?: { lingerMs?: number; authDeadlineMs?: number; /** the successor's `--prefer-port`: the web endpoint starts at boot on it (TD-2026-10-19-063) */ preferPort?: number; /** Aegis H: the predecessor's inherited listening socket fd */ inheritFd?: number };
  /** #gnomon-voice V2a config: voice.ambientIdleMs — a conversation ceiling's idle auto-off (clamped, never unbounded) */
  voice?: {
    ambientIdleMs?: number;
    /**
     * V2e: the kernel-spawned voice client. `entry` = gnomon-voice dist/cli.js (null ⇒ unavailable; default resolved
     * from the workspace on darwin only). `prepare`/`spawn` are seams (tests: a fake voice-io + stub engines).
     */
    client?: { entry?: string | null; prepare?: VoiceChildOptions['prepare']; spawn?: VoiceChildOptions['spawn']; devUnsigned?: boolean; backoffMinMs?: number };
  };
  /** #scheduler: raw `automation:v1` records (validated; refused ones are logged `schedule.dropped`). None by default (law 5). */
  automations?: readonly unknown[];
  /** #scheduler clock seam (default Date.now). */
  schedulerNow?: () => number;
  /** Staged-stop grace for supervised children and orphans (default 2 s). */
  childGraceMs?: number;
  /** TD-2026-10-19-063 (Aegis M): the GUI resume record the predecessor wrote to this successor's stdin (never a file). */
  resumeHandoff?: ResumeRecord | null;
  /**
   * TD-2026-10-19-063 #update-watch: the build stamp to watch (default: the running bundle's dist/build-id.json;
   * null: none), its poll cadence (default UPDATE_POLL_MS) and the helper re-pin check run on the same tick.
   */
  update?: { stampPath?: string | null; pollMs?: number; helper?: { check(): Promise<unknown> | unknown } };
}

/**
 * TD-2026-10-19-063: what an accepted, drained upgrade hands the successor. `successorKeyPem` is the successor's
 * software kernel key (PKCS#8), minted by THIS kernel at accept so the GUI can be told its public half over the
 * already-verified channel (gui.resume); it reaches the successor on its stdin pipe only (never argv, env or a file).
 */
export interface UpgradeHandoff {
  preferPort: number | null;
  successorKeyPem: string;
  /** the GUI resume record (digest + binding) for the successor's stdin, or null */
  resume: ResumeRecord | null;
  /** Aegis H: the web listening socket, detached from the endpoint and NOT closed: the successor inherits its fd */
  listener: net.Server | null;
}

export interface DaemonStatus {
  pid: number;
  startedAt: string;
  socketPath: string;
  via: EndpointVia;
  connections: number;
  idleMs: number;
  uptimeMs: number;
}

/**
 * The per-transport dispatcher options (Aegis L1): the unix-socket dispatcher gets the common options PLUS the
 * unix-only ports (the human-device verbs); the web dispatcher gets the common options alone. Structural: a
 * GUI WebSocket can never see a human-device verb port, whatever the common object grows.
 */
export function dispatcherOptionsFor<C extends object>(transport: 'unix' | 'web', common: C, unixOnly: { humanVerbs: HumanDeviceVerbPorts }): C & { humanVerbs?: HumanDeviceVerbPorts } {
  return transport === 'unix' ? { ...common, humanVerbs: unixOnly.humanVerbs } : { ...common };
}

export interface DaemonHandle {
  readonly pidfile: DaemonPidfile;
  readonly via: EndpointVia;
  readonly log: KernelLog;
  readonly kernelSigner: Signer;
  readonly kernelPrincipal: string;
  /** Write the coalesced diagnostic rows now (tests; also runs on the window timer and at shutdown). */
  flushDiagnostics(): Promise<void>;
  readonly server: SocketServerHandle;
  /** log.read{follow} subscription telemetry (tests; status shows the counts). */
  subscriptions(): SubscriptionStats;
  status(): DaemonStatus;
  /** Resolves once the daemon has fully stopped. */
  readonly exited: Promise<DaemonExitReason>;
  shutdown(reason: DaemonExitReason): Promise<void>;
  /**
   * `gnomon daemon stop` (kernel side, T-2026-10-19-014 B0): raise (or return the pending) signed daemon-stop card
   * for an authenticated human device connection. The kernel shuts down with `reason` only when the human accepts
   * it with fresh presence; reject or expiry keeps it running. Any other connection is FORBIDDEN{matrix}.
   */
  requestStop(connId: string, reason?: DaemonStopReason): Promise<CardV1>;
  /** `gnomon open` (kernel side): start the web endpoint if needed and mint a launch token for an authenticated human device connection. */
  requestWebLaunch(connId: string, via?: LaunchAsker): Promise<LaunchGrant>;
  /** The web endpoint, once started (null before the first launch). */
  web(): WebEndpoint | null;
  /** Supervised children (sessions, local runners, mods): stopped and awaited before every exit. */
  readonly children: DaemonChildren;
  /** #mod-host (M1.11): mods started on first relay, stopped at every exit. */
  readonly mods: ModHost;
  /** `gnomon mod` control (M1.11 slice 3): staged install cards raised through the broker, pause markers, start requests. */
  readonly modPickup: StagedCardPickup;
  /** The exact kernel.call function the mod host uses (bridge.ts createModKernelCall over this daemon's dispatcher and log). */
  readonly modKernelCall: (req: KernelCallRequest) => Promise<unknown>;
  /** The unix-socket dispatcher (its `callAs` is the mods' kernel.call). */
  readonly dispatcher: Pick<KernelDispatcher, 'callAs' | 'clients'>;
  /** #scheduler (log-derived timers, automations). */
  readonly scheduler: Scheduler;
  /** V2e (#gnomon-voice): the kernel-spawned voice client (tests; the human drives it with request.voice.client). */
  readonly voiceClient: Pick<VoiceChildSupervisor, 'start' | 'stop' | 'status' | 'connId'>;
  /** The start-up orphan sweep's result (G-DMN-04). */
  readonly orphanSweep: { orphans: number; stopped: number };
  /** §2.4 rule 11 (T-2026-10-19-014 B2): the resume of the sessions an upgrade drained, and the old pending cards retired. */
  readonly resume: Promise<ResumeReport>;
  /** TD-2026-10-19-063: set once an upgrade card was ACCEPTED and drained: the successor asks for this web port. */
  upgradeHandoff(): UpgradeHandoff | null;
  /** TD-2026-10-19-063 #update-watch (null when no build stamp was loaded). */
  readonly updateWatch: UpdateWatch | null;
  /** The build stamp this kernel loaded (null: none). */
  readonly buildStamp: BuildStamp | null;
}

/** The kernel principal `p:<root ns>/kernel` (p:00000000/kernel while no root exists) — one source for the daemon and `gnomon log quarantine`. */
export function kernelPrincipalOf(authority: Pick<RootAuthority, 'ns'> = new UnprovisionedRootAuthority()): string {
  return `p:${authority.ns ?? UNPROVISIONED_NS}/kernel`;
}

/**
 * TEST SEAMS (internal-seams.ts slot `daemon`, read only by src/kernel/testing.ts):
 * the supervisor's test-rig options (a fake `#!` claude, its path, a throwaway
 * user home and env) and the fuse's law-7 billing scan source. Production
 * (`startDaemon`, gnomond, `gnomon dev up`) never passes any of them.
 */
export interface DaemonSeams {
  supervisor?: { claudePath?: string; allowScripts?: boolean; userHome?: string; env?: () => Readonly<Record<string, string | undefined>> };
  billing?: BillingScanSource;
  /** the §2.4 rule 11 drain deadline (default: the supervisor's DRAIN_DEADLINE_MS; no root-signed config names one) */
  drainDeadlineMs?: number;
}

/** How long a live pidfile holder whose socket is silent is given (it may be the race winner mid-start) before `holder-silent`. */
export const HOLDER_GRACE_MS = 2000;

/**
 * How far a silent holder's process start may lie AFTER the pidfile's
 * `startedAt` and still count as the pidfile's own writer. The true writer
 * started before it wrote `startedAt`; `ps -o lstart=` truncates to the second
 * (which only moves the witness earlier), so the allowance covers wall-clock
 * steps (NTP slew) between the two readings. A configured bound, not a
 * measurement.
 */
export const HOLDER_START_TOLERANCE_MS = 2000;

/**
 * T-2026-10-19-017: is a live, silent pidfile holder a recycled pid? `true`
 * only when its process provably started more than HOLDER_START_TOLERANCE_MS
 * after the pidfile's `startedAt` — the writer of that pidfile is then gone
 * (after a crash, or a reboot: every process of a later boot started after
 * the old `startedAt`). Can't tell (unparseable `startedAt`, no witness) is
 * `false`: never reclaim on doubt.
 */
export function holderIsRecycled(startedAt: string, holderStart: number | null): boolean {
  if (holderStart === null || !Number.isFinite(holderStart)) return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(startedAt)) return false;
  const written = Date.parse(startedAt);
  if (!Number.isFinite(written)) return false;
  return holderStart > written + HOLDER_START_TOLERANCE_MS;
}

/**
 * Aegis L2: a same-user live pid in the pidfile is a running kernel only if a
 * kernel answers `hello` on OUR socket path (never the pidfile's own
 * socketPath: the pidfile is same-user writable). A spoofed pid with a silent
 * socket is `holder-silent` (transient, restartable), never `already-running`
 * (superseded, never restarted). The pidfile is NOT reclaimed for silence
 * alone: a silent holder may be a racer between its lock and its listen, and
 * stealing its lock would make two kernels. It IS reclaimed (`'reclaim'`) when
 * the holder's start-time witness proves it started after the pidfile was
 * written (a recycled pid after a crash or reboot, T-2026-10-19-017) — a racer
 * always starts before it writes its own `startedAt`.
 */
async function judgeLiveHolder(
  refusal: LifecycleRefusal,
  home: string,
  socketPath: string,
  opts: DaemonOptions,
): Promise<LifecycleRefusal | { reclaim: true; pid: number; startedAt: string; holderStart: number }> {
  const probe = opts.probeHolder ?? ((p: string) => helloProbe(p));
  const deadline = Date.now() + (opts.holderGraceMs ?? HOLDER_GRACE_MS);
  for (;;) {
    if (await probe(socketPath)) return refusal;
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const pid = refusal.detail.pid;
  const startedAt = refusal.detail.startedAt;
  if (typeof pid === 'number' && typeof startedAt === 'string') {
    const holderStart = (opts.holderStartMs ?? ((p: number) => processStartMs(p)))(pid);
    if (holderStart !== null && holderIsRecycled(startedAt, holderStart)) return { reclaim: true, pid, startedAt, holderStart };
  }
  return new LifecycleRefusal(
    'holder-silent',
    `the pidfile names a live process (pid ${String(pid)}) but no kernel answers on ${socketPath}; if pid ${String(pid)} is not gnomond, remove ${pidPathOf(home)} and retry`,
    { ...refusal.detail },
  );
}

registerSeams('daemon', { start: (opts, seams) => startDaemonWith(opts, seams) });

export async function startDaemon(opts: DaemonOptions): Promise<DaemonHandle> {
  return startDaemonWith(opts, {});
}

async function startDaemonWith(opts: DaemonOptions, seams: DaemonSeams): Promise<DaemonHandle> {
  const emit = (e: DaemonEvent): void => opts.onEvent?.(e);
  const idleMs = opts.idleMs ?? DEFAULT_IDLE_EXIT_MS;
  // T-2026-10-17-009(a): finish a quarantine interrupted between its two
  // renames BEFORE a home is created, so no fresh unrelated log fills the gap.
  if (path.isAbsolute(opts.home)) {
    const pending = completePendingQuarantine(opts.home);
    if (pending.conflict) throw new LifecycleRefusal('quarantine-pending', `an interrupted quarantine (${pending.conflict}) names this home, but the home and its evidence both exist`, { staging: pending.conflict });
  }
  const home = ensureGnomonHome(opts.home);

  const choice = selectSocketPath({ home, ...(opts.platform ? { platform: opts.platform } : {}), ...(opts.env ? { env: opts.env } : {}) });
  if (!choice.ok) {
    throw new LifecycleRefusal('no-safe-endpoint', choice.reason, { candidates: choice.candidates });
  }

  let pidfile: DaemonPidfile | undefined;
  // At most one reclaim of a recycled-pid pidfile (T-2026-10-19-017); a second live holder is judged, never reclaimed again.
  for (let reclaims = 0; pidfile === undefined; ) {
    try {
      pidfile = acquireDaemonLock(home, process.pid, { socketPath: choice.path });
    } catch (caught) {
      let err: unknown = caught;
      if (err instanceof LifecycleRefusal && err.reason === 'already-running') {
        const verdict = await judgeLiveHolder(err, home, choice.path, opts);
        if (!(verdict instanceof LifecycleRefusal)) {
          if (reclaims === 0 && reclaimResiduePidfile(home, verdict)) {
            reclaims++;
            emit({ kind: 'daemon.lock.reclaimed', holderPid: verdict.pid, startedAt: verdict.startedAt, holderStart: new Date(verdict.holderStart).toISOString() });
            continue;
          }
          err = new LifecycleRefusal('holder-silent', `the pidfile names a live process (pid ${String(verdict.pid)}) but no kernel answers on ${choice.path}; if pid ${String(verdict.pid)} is not gnomond, remove ${pidPathOf(home)} and retry`, { pid: verdict.pid, startedAt: verdict.startedAt });
        } else {
          err = verdict;
        }
      }
      if (err instanceof LifecycleRefusal) {
        const holderPid = typeof err.detail.pid === 'number' ? err.detail.pid : undefined;
        emit({ kind: 'daemon.lock.refused', reason: err.reason, ...(holderPid !== undefined ? { holderPid } : {}) });
      }
      throw err;
    }
  }

  const kernelSigner = opts.kernelSigner ?? SoftwareEd25519Signer.generate('kernel');
  const kernelKeySource = opts.kernelSigner ? 'supplied-software' : 'ephemeral-software';
  const authority = opts.rootAuthority ?? new UnprovisionedRootAuthority();
  const kernelPrincipal = kernelPrincipalOf(authority);
  /** Principal continuity across root provisioning (M1.3): rows written before it carry the unprovisioned kernel principal. */
  const kernelPrincipals = [...new Set([kernelPrincipalOf(new UnprovisionedRootAuthority()), kernelPrincipal])];
  // Aegis L4: KernelLog.open (which may complete an interrupted rotation or
  // quarantine, i.e. WRITE the home's log) runs BEFORE the socket is published,
  // and it stays there: the orphan sweep, the dispatcher and every pre-auth row
  // need the log before the first connection is accepted, and a refused open
  // must never leave a briefly-served endpoint behind. Its exclusivity rests
  // on the pidfile lock alone, which ASSUMES every contender runs as the same
  // uid in the same pid namespace (the home is 0700, so another uid cannot
  // reach it): a holder in another pid namespace (a container sharing this
  // home) can look dead, be reclaimed, and two kernels would open one log.
  // Sharing a home across pid namespaces is unsupported.
  let log: KernelLog;
  try {
    const pem = (kernelSigner as Partial<SoftwareEd25519Signer>).publicKeyPem;
    if (typeof pem === 'string') recordKernelPub(home, pem);
    const keyRing = new KeyRing();
    const pubs = readKernelPubs(home);
    for (const k of pubs) keyRing.addEd25519(k.publicKeyPem);
    log = KernelLog.open({ home, kernelPrincipal, signer: kernelSigner, keyRing, kernelKeyIds: pubs.map((k) => k.keyId) });
  } catch (err) {
    releaseDaemonLock(home, pidfile);
    throw err;
  }
  // TD-2026-10-19-063 #gui-resume: take (read + unlink) the predecessor's GUI resume hand-off at once, under the lock
  const resumeGate = new ResumeGate({
    record: opts.resumeHandoff ?? null,
    ns: authority.ns ?? UNPROVISIONED_NS,
    isHumanDevice: (principal, deviceId) => {
      try {
        const d = readRegistry(home, authority).devices.get(deviceId);
        return d !== undefined && d.principalKind === 'human' && d.principalId === principal;
      } catch {
        return false;
      }
    },
  });
  const pendingRows = new Set<Promise<unknown>>();
  const appendRow = (kind: string, payload: Record<string, unknown>, ids: { connId?: string; deviceId?: string } = {}): Promise<void> => {
    const p = log.append({ kind, principal: kernelPrincipal, payload, ...ids }).then(() => undefined);
    pendingRows.add(p);
    void p.finally(() => pendingRows.delete(p)).catch(() => undefined);
    return p;
  };
  const control = processControlFor(opts.platform ?? process.platform);
  const boot = readBootSession();
  const children = new DaemonChildren({ append: (kind, payload) => appendRow(kind, payload), control, boot, holdIdle: () => idle.hold('session'), ...(opts.childGraceMs !== undefined ? { graceMs: opts.childGraceMs } : {}) });
  /** Coalesced pre-auth diagnostics: counters, flushed as one signed row per kind per window. */
  const diag = {
    windowStart: new Date().toISOString(),
    connects: 0,
    refused: new Map<string, number>(),
    preAuthClosed: new Map<string, number>(),
    individual: new Map<string, number>(), // kind → individual rows written this window
    // Aegis C4: the web endpoint's Reconnect and post-TTL replay rows are attacker-triggerable too
    folded: {
      'socket.hello': new Map<string, number>(),
      'socket.auth.fail': new Map<string, number>(),
      'socket.auth.replay': new Map<string, number>(),
      'socket.auth.reconnect.requested': new Map<string, number>(),
    } as Record<string, Map<string, number>>,
  };
  const perWindow = opts.preAuthRowsPerWindow ?? 8;
  /** Rate-limited pre-auth rows: individual up to `perWindow`, then a counter increment. */
  const logSocketRow = (kind: SocketLogKind | `socket.${string}`, payload: Record<string, unknown>, ids: { connId?: string; deviceId?: string } = {}): Promise<void> => {
    const folded = diag.folded[kind];
    if (folded) {
      const n = diag.individual.get(kind) ?? 0;
      if (n >= perWindow) {
        bump(folded, String(kind === 'socket.hello' ? payload.outcome : (payload.reason ?? payload.surface ?? kind)));
        return Promise.resolve();
      }
      diag.individual.set(kind, n + 1);
    }
    return appendRow(kind, payload, ids);
  };
  const bump = (m: Map<string, number>, k: string): void => void m.set(k, (m.get(k) ?? 0) + 1);
  const flushDiagnostics = async (): Promise<void> => {
    const windowEnd = new Date().toISOString();
    const rowsOut: Array<Promise<void>> = [];
    if (diag.connects > 0 || diag.preAuthClosed.size > 0) {
      rowsOut.push(
        appendRow('socket.connect', { coalesced: true, count: diag.connects, preAuthClosed: Object.fromEntries(diag.preAuthClosed), windowStart: diag.windowStart, windowEnd }),
      );
    }
    if (diag.refused.size > 0) {
      const byReason = Object.fromEntries(diag.refused);
      rowsOut.push(
        appendRow('socket.frame.refused', { coalesced: true, count: Object.values(byReason).reduce((a, b) => a + b, 0), byReason, windowStart: diag.windowStart, windowEnd }),
      );
    }
    for (const [kind, m] of Object.entries(diag.folded)) {
      if (m.size === 0) continue;
      const by = Object.fromEntries(m);
      const count = Object.values(by).reduce((a, b) => a + b, 0);
      rowsOut.push(appendRow(kind, { coalesced: true, count, [kind === 'socket.hello' ? 'byOutcome' : 'byReason']: by, windowStart: diag.windowStart, windowEnd }));
      m.clear();
    }
    diag.individual.clear();
    diag.windowStart = windowEnd;
    diag.connects = 0;
    diag.refused.clear();
    diag.preAuthClosed.clear();
    await Promise.all(rowsOut.map((p) => p.catch(() => undefined)));
  };
  const diagTimer = setInterval(() => void flushDiagnostics(), opts.diagFlushMs ?? 10_000);
  diagTimer.unref();

  const startedMs = Date.now();
  const releases = new Map<string, () => void>();
  let server: SocketServerHandle | null = null;
  let stopping: Promise<void> | null = null;
  let updateWatch: UpdateWatch | null = null;
  let upgradeHandoff: UpgradeHandoff | null = null;
  let resolveExited!: (r: DaemonExitReason) => void;
  const exited = new Promise<DaemonExitReason>((r) => (resolveExited = r));

  const shutdown = (reason: DaemonExitReason): Promise<void> => {
    if (stopping) return stopping;
    stopping = (async () => {
      idle.stop();
      updateWatch?.stop();
      let liveChildren = 0;
      try {
        await scheduler.stop().catch(() => undefined); // an in-flight tick finishes before children stop
        // §2.4 rule 3: mod, session and transport children stop BEFORE daemon.exit — never exit with a live child
        try {
          modPickup.stop();
        } catch {
          /* shutdown before the pickup existed */
        }
        try {
          await voiceChild.close(); // V2e: the voice child dies with the kernel and never carries over (TD-908)
        } catch {
          /* shutdown before the voice child existed */
        }
        await mods.stopAll(reason).catch(() => undefined); // first: no mod restart can race the sweep
        liveChildren = await children.stopAll(reason).catch(() => children.live());
        await web?.stop(reason === 'idle' ? 'idle' : 'daemon-exit').catch(() => undefined);
        emit({ kind: 'daemon.exit', reason });
        hub.close();
        try {
          voice.close(); // V2a: the idle auto-off timer goes with the daemon
        } catch {
          /* shutdown before voice existed */
        }
        await server?.close();
        clearInterval(diagTimer);
        clearInterval(tokenTimer);
        clearInterval(brokerTimer);
        clearInterval(repinTimer);
        await flushDiagnostics();
        await appendRow('daemon.exit', { reason, liveChildren }).catch(() => undefined);
        await Promise.allSettled([...pendingRows]);
        await log.close();
        await opts.helper?.close().catch(() => undefined);
      } finally {
        releaseDaemonLock(home, pidfile);
        resolveExited(reason);
      }
    })();
    return stopping;
  };

  const idle = new IdleMonitor({ idleMs, onIdle: () => void shutdown('idle') });
  const scheduler = new Scheduler({
    log: {
      append: (kind, payload) => appendRow(kind, payload),
      rows: (kinds) => fullRows(kinds),
    },
    kernelPrincipals,
    holdIdle: () => idle.hold('timer'),
    ...(opts.automations ? { automations: opts.automations } : {}),
    ...(opts.schedulerNow ? { now: opts.schedulerNow } : {}),
  });
  function* fullRows(kinds: readonly string[]): Generator<{ kind: string; payload: unknown; principal: string; at: string }> {
    for (const v of log.read({ reader: { class: 'human' }, kinds })) {
      if (v.view === 'full') yield { kind: v.event.kind, payload: v.event.payload, principal: v.event.principal, at: v.event.at };
    }
  }

  const status = (): DaemonStatus => ({
    pid: pidfile.pid,
    startedAt: pidfile.startedAt,
    socketPath: pidfile.socketPath,
    via: choice.via,
    connections: server?.connections() ?? 0,
    idleMs,
    uptimeMs: Date.now() - startedMs,
  });

  // Read-token revocations are sticky across restarts: seed them from the chain (P8-D89, Aegis).
  const chainRevoked = new Set<string>();
  /** Revocations seen but not yet on the chain: retried, never dropped (Aegis follow-up 1). */
  const unrecorded = new Set<string>();
  const recordRevocation = async (tokenId: string): Promise<void> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await appendRow('key.token.revoked', { tokenId });
        unrecorded.delete(tokenId);
        return;
      } catch (err) {
        if (attempt === 1) {
          unrecorded.add(tokenId);
          emit({ kind: 'daemon.token.revocation.unrecorded', tokenId, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
  };
  for (const v of log.read({ reader: { class: 'human' }, kinds: ['key.token.revoked'] })) {
    const id = v.view === 'full' ? (v.event.payload as { tokenId?: unknown } | undefined)?.tokenId : undefined;
    if (typeof id === 'string') chainRevoked.add(id);
  }
  const authenticator = new SocketAuthenticator({
    home,
    endpointPath: choice.path,
    kernelSigner,
    trust: authority,
    readTokens: {
      revoked: chainRevoked,
      onRevoked: (tokenId) => void recordRevocation(tokenId),
      onUntrusted: (reason) => void appendRow('key.registry.malformed', { file: 'read-tokens.jsonl', reason }).catch(() => undefined),
    },
    ...(opts.clock ? { clock: opts.clock } : {}),
  });
  // Read the token file now and on a slow timer, whether or not a token connection is live,
  // so a revocation row reaches the chain promptly (Aegis follow-up 1).
  authenticator.refreshTokens();
  const tokenTimer = setInterval(() => {
    authenticator.refreshTokens();
    for (const id of [...unrecorded]) void recordRevocation(id);
  }, opts.tokenRefreshMs ?? 60_000);
  tokenTimer.unref();
  const hub = new SubscriptionHub({
    log,
    holdIdle: () => idle.hold('subscriber'),
    onDropped: (connId, payload) => void appendRow('socket.subscription.dropped', payload, { connId }).catch(() => undefined),
    ...(opts.subscriptionBacklogCap !== undefined ? { backlogCap: opts.subscriptionBacklogCap } : {}),
  });
  let web: WebEndpoint | null = null;
  const statusSource = {
    daemon: () => ({ ...status() }),
    log: () => ({ ...log.head() }),
    kernelKey: () => ({ keyId: kernelSigner.keyId, custody: 'partial' as const, source: kernelKeySource }),
    root: () => ({ state: authority.state, rootKeyId: authority.rootKeyId }),
    web: () => {
      const st = (web?.status() ?? { listening: false }) as Record<string, unknown> & { guiSessions?: { n: number; sessions: Array<Record<string, unknown> & { connId: string }> } };
      if (!st.guiSessions) return st;
      return { ...st, guiSessions: { ...st.guiSessions, sessions: st.guiSessions.sessions.map((g) => ({ ...g, unlock: approvals.unlockOf(g.connId) })) } };
    },
  };
  // #approval-broker + #budget-fuse (M1.6). Production: no presence prompt, no approvals key and no keystore
  // until the signed helper (M1.3), so every presence-taking decision and every api-token activation refuses.
  const brokerLog = (kind: string, payload: Record<string, unknown>, ids: { connId?: string; session?: string } = {}): Promise<void> =>
    log.append({ kind, principal: kernelPrincipal, payload, ...(ids.connId ? { connId: ids.connId } : {}) }).then(() => undefined);
  const broker = new ApprovalBroker({
    kernel: kernelSigner,
    kernelPrincipal,
    log: brokerLog,
    root: authority,
    ...(opts.approvalsKey ? { approvals: opts.approvalsKey } : {}),
    guiSessions: () => ((web?.status() as { guiSessions?: { n?: number } } | undefined)?.guiSessions?.n ?? 0),
  });
  // §3.1 failure modes: a helper exit drops every cached unlock; the next decision on each connection prompts again
  opts.approvalsKey?.onHelperExit?.(() => void broker.helperExited());
  // helper 1.6.0 (§14.7, S29-K5): voice-arm references. A helper exit or a session push (lock, sleep, user
  // switch) disarms every arm (approval.voice.disarm); a push also drops every cached-unlock reference.
  const ak = opts.approvalsKey;
  const voiceArms = new VoiceArmCustody(brokerLog, ak?.closeArm ? { closeArm: (a) => ak.closeArm!(a) } : null);
  ak?.onHelperExit?.(() => void voiceArms.helperExited());
  ak?.onHelperPush?.((p) => {
    void voiceArms.helperPushed(p);
    void broker.helperSessionEnded(p.cause);
  });
  const apiTokens = new ApiTokenBilling(broker, brokerLog);
  // T-2026-10-19-014 B0 (F3): the daemon-stop card; an accept shuts down with the card's reason. B1: an `upgrade`
  // accept drains every session first (§2.4 rule 11: session.drained before session.exited), then exits `upgrade`.
  // TD-2026-10-19-063: an accept from a live GUI session mints a single-use resume token for THAT connection (sent
  // to it alone, gui.resume); its digest is handed to the successor in a 0600 file after the drain (#gui-resume).
  const stopCards = new DaemonStopCards(broker, (reason, ctx) => {
    if (reason !== 'upgrade') return void shutdown(reason);
    if (stopping) return;
    const gui = web?.access.session(ctx.connId);
    const resumeToken = gui ? mintResumeToken() : null;
    const successorKeyPem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const successorPub = new SoftwareEd25519Signer(successorKeyPem, 'kernel').publicKeyPem;
    if (gui && resumeToken) web?.notifyConn(ctx.connId, 'gui.resume', { resumeToken, ttlMs: RESUME_TOKEN_TTL_MS, kernelPublicKey: spkiBase64Url(successorPub) });
    const st = web?.status() as { listening?: boolean; port?: number } | undefined;
    const preferPort = st?.listening && typeof st.port === 'number' ? st.port : null;
    void supervisor
      .drain(seams.drainDeadlineMs !== undefined ? { deadlineMs: seams.drainDeadlineMs } : {})
      .catch(() => undefined) // a drain that failed part way still exits: the new kernel sweeps what it left (rule 4)
      .then(() => {
        const resume = gui && resumeToken ? resumeRecordOf(resumeToken, { principal: gui.principal, deviceId: gui.deviceId, ns: authority.ns ?? UNPROVISIONED_NS }, Date.now()) : null;
        // Aegis H: keep the port bound: the listener leaves the endpoint open and goes to the successor as an fd
        const listener = process.platform === 'win32' ? null : (web?.detachListener() ?? null);
        upgradeHandoff = { preferPort, successorKeyPem, resume, listener };
        return shutdown('upgrade');
      });
  });
  // N2: the rollback high-water mark comes from the hash-chained log (the last signed config.loaded{version})
  let chainHighWater = 0;
  for (const v of log.read({ reader: { class: 'human' }, kinds: ['config.loaded'] })) {
    const p = v.view === 'full' ? (v.event.payload as { file?: unknown; signed?: unknown; version?: unknown } | undefined) : undefined;
    // M1.8 slice 2: rows naming another file (local.signed.json) carry THAT file's version, never the meter config's
    if (p?.file === undefined && p?.signed === true && typeof p.version === 'number' && p.version > chainHighWater) chainHighWater = p.version;
  }
  const fuseCfg = loadFuseConfig(home, authority, (kind, payload) => void appendRow(kind, payload).catch(() => undefined), { chainHighWater });
  const fuse = new BudgetFuse({
    kernel: kernelSigner,
    logId: log.head().log,
    // a turn counts under its own budget.usage row's chain time (the time restore reads back)
    log: (kind, payload, ids = {}) =>
      log.append({ kind, principal: kernelPrincipal, payload, ...(ids.connId ? { connId: ids.connId } : {}), ...(ids.session ? { session: ids.session } : {}) }).then((r) => ({ at: r.event.at })),
    onClockSkew: (d) => emit({ kind: 'daemon.fuse.clock.skew', chainAt: new Date(d.chainAt).toISOString(), wall: new Date(d.wall).toISOString() }),
    config: fuseCfg.config,
    apiTokens,
    // S-L2: day windows from the chain's last event time, never the wall clock
    lastEventTime: () => {
      const at = Date.parse(log.lastEventAt());
      return Number.isFinite(at) ? at : Date.now();
    },
    // law 7 scan: the env a child would inherit and the user settings layer; the versioned per-OS
    // managed-policy list and the mid-session watch are M1.7 (#claude-adapter, G-SUB-01/05)
    billing: seams.billing ?? {
      env: () => ({ ...process.env }),
      layers: () => fileLayers([{ where: 'user-settings', path: path.join(nodeOs.homedir(), '.claude', 'settings.json'), kind: 'settings' }]),
    },
  });
  // M1.6 slice 2: a restart no longer forgets today's spend — the meter is rebuilt from the chain. Runs BEFORE
  // daemon.start is written, so "today" is the day of the chain's last event (clamped to the wall clock + skew).
  // Only the kernel's own signed rows count (Aegis C1).
  fuse.restore(
    (function* (): Generator<FuseRow> {
      for (const v of log.read({ reader: { class: 'human' }, kinds: FUSE_RESTORE_KINDS })) {
        if (v.view === 'full') yield { kind: v.event.kind, at: v.event.at, principal: v.event.principal, ...(typeof v.event.keyId === 'string' ? { keyId: v.event.keyId } : {}), payload: (v.event.payload ?? {}) as Record<string, unknown> };
      }
    })(),
    { principals: kernelPrincipals, isKernelKey: (k) => log.isKernelKey(k) },
  );
  // P8-D91: an agent's spend lands in its human's user bucket. Its parent is not known at dispatch before
  // M1.7, so it is attributed to the root's human principal (8.0 is single-human: the founder).
  const founder = (): string | null => {
    const humans = [...readRegistry(home, authority).devices.values()].filter((d) => d.principalKind === 'human').map((d) => d.principalId).sort();
    return humans[0] ?? null;
  };
  const approvals = createApprovalPort({ broker, fuse, kernelPrincipal, extraStatus: () => ({ billing: apiTokens.status() }), userOf: (_p, cls) => (cls === 'agent' ? founder() : null) });
  const brokerTimer = setInterval(() => {
    void broker.expireDue().catch(() => undefined);
    void apiTokens.sweep().catch(() => undefined);
  }, 5_000);
  brokerTimer.unref();
  // #supervisor (M1.7 slice 1): attended, human-started Claude Code sessions. The claude binary comes from the
  // platform's known locations (never PATH, p01) until the root-signed config names one.
  // #local-runner (M1.8 slice 2): the root-signed local lane config; its rollback high-water mark is the last
  // signed config.loaded{file: local.signed.json, version} on the chain. Anything unsigned ⇒ no local config.
  let localHighWater = 0;
  for (const v of log.read({ reader: { class: 'human' }, kinds: ['config.loaded'] })) {
    const p = v.view === 'full' ? (v.event.payload as { file?: unknown; signed?: unknown; version?: unknown } | undefined) : undefined;
    if (p?.file === LOCAL_CONFIG_FILE && p.signed === true && typeof p.version === 'number' && p.version > localHighWater) localHighWater = p.version;
  }
  const localCfg = loadLocalConfig(home, authority, (kind, payload) => void appendRow(kind, payload).catch(() => undefined), { chainHighWater: localHighWater });
  const ruleBook = new RuleBook({ principal: kernelPrincipal, isKernelKey: (k) => log.isKernelKey(k) });
  // S-L1: fold the KERNEL-signed approval.* rows appended since the last catch-up (rules.ts); shared by the
  // supervisor's exact-match check and the rules.revoke handler, so both read one book
  const syncRuleBook = (): RuleBook => {
    // Aegis H1: catch up to the RELEASED head only (ruleSourceOf) — the committed tip would skip rows hidden behind a pending critical row
    catchUp(ruleBook, ruleSourceOf(log));
    return ruleBook;
  };
  // P8-D86/D87 run modes: folded from KERNEL-signed approval.mode.set / session.open{runMode} rows (a repo's mode
  // persists across sessions and restarts); strictness levels are not built (no level source ⇒ the ceiling permits
  // every mode). The control is the request.mode.set handler (dispatcher `requests`) and the session port's runMode.
  const modeBook = new RunModeBook({ principal: kernelPrincipal, isKernelKey: (k) => log.isKernelKey(k) });
  const syncModeBook = (): RunModeBook => {
    catchUp(modeBook, modeSourceOf(log));
    return modeBook;
  };
  const runModes = new RunModeControl({
    broker,
    book: syncModeBook,
    sessions: { scope: (hsid) => supervisor.scopeOf(hsid), live: () => supervisor.liveScopes() },
    logRequest: (payload, ids) => log.append({ kind: 'request.mode.set', principal: kernelPrincipal, payload: { ...payload }, connId: ids.connId, ...(ids.session ? { session: ids.session } : {}) }).then(() => undefined),
    repoKeyOfPath: (abs) => repoKeyOf([abs]),
    ...(seams.supervisor?.userHome ? { userHome: seams.supervisor.userHome } : {}),
    // Aegis L2: every applied change reaches the live sessions at once (manual re-entered ⇒ the plan is dropped)
    onChange: () => supervisor.noteModeChange(),
  });
  // TD-2026-10-19-063: the GUI re-pin of the claude binary. A refused open and a poll of the resolved source
  // pre-stage ONE re-pin card per new sha; only its approved (fresh-presence) effect writes the pin.
  const supSeams = seams.supervisor ?? {};
  const claudeRow = claudeCodePlatform(process.platform);
  const repin = new ClaudeRepinCards({
    home,
    broker,
    requestedBy: kernelPrincipal,
    verifier: claudeVerifierFor(process.platform),
    source: () => (claudeRow ? (resolveClaudeSource({ ...(supSeams.claudePath ? { explicit: supSeams.claudePath } : {}), row: claudeRow, home: supSeams.userHome ?? nodeOs.homedir() })?.real ?? null) : null),
    ...(supSeams.allowScripts ? { allowScripts: true } : {}),
  });
  const repinTimer = setInterval(() => void repin.poll().catch(() => undefined), REPIN_POLL_MS);
  repinTimer.unref();
  const supervisor: SessionSupervisor = new SessionSupervisor({
    onClaudeBinaryChanged: (real, found) => repin.onRefused(real, found),
    ...(localCfg.config ? { local: localCfg.config } : {}),
    // T-2026-10-18-010 L4 / P8-D94: whose hooks run inside sessions — the root-signed `config.sessions.hooks` (default `audited`)
    hooksMode: fuseCfg.sessions.hooks,
    // P8-D94: per-hook decisions, read back from KERNEL-signed gate-class.decided rows only (the last one per hook wins)
    repoHookDecisions: (repoKey, setHash) =>
      repoHookDecisionsFrom(
        (function* () {
          for (const v of log.read({ reader: { class: 'human' }, kinds: ['gate-class.decided'] })) if (v.view === 'full') yield { principal: v.event.principal, keyId: v.event.keyId, payload: v.event.payload };
        })(),
        { principal: kernelPrincipal, isKernelKey: (k) => log.isKernelKey(k) },
        repoKey,
        setHash,
      ),
    // S-L1: standing `always` rules, folded incrementally from KERNEL-signed approval.* rows only (rules.ts)
    alwaysRule: (repoKey, tool, hash) => syncRuleBook().match(repoKey, tool, hash),
    // P8-D87: the effective run mode at each permission request
    runMode: (hsid, repoKey) => runModes.view(hsid, repoKey),
    ...(seams.supervisor ?? {}),
    log: (kind, payload, ids = {}) => log.append({ kind, principal: kernelPrincipal, payload, ...(ids.session ? { session: ids.session } : {}) }).then(() => undefined),
    children,
    fuse,
    broker,
    home,
    kernelPrincipal,
    sock: choice.path,
    endpointPort: () => {
      const st = web?.status() as { listening?: boolean; port?: number } | undefined;
      return st?.listening && typeof st.port === 'number' ? st.port : null;
    },
    linkedFolders: () => {
      try {
        return linkedFolders(home, authority);
      } catch {
        return [];
      }
    },
  });
  // TD-2026-10-20-262 dictation: a human send{source:'voice'} is attributed by #gnomon-voice (declared below; called
  // only once the daemon serves, so the late binding is safe)
  const sessions = createSessionPort(supervisor, runModes, {
    attributeHumanSend: (human, hsid, parts) => voice.attributeHumanSend(human, hsid, parts),
    releaseAttribution: (attr) => voice.releaseAttribution(attr),
  });
  // #mod-host (M1.11 slice 2): kernel.call → the real dispatcher as the mod principal; own-modns appends clamped (C2)
  const mods = new ModHost({
    home,
    trust: authority,
    children,
    emit: (kind, payload) => {
      if (kind === 'manifest.staged' && typeof payload.cardId === 'string' && kernelStaged.size < 4096) kernelStaged.add(payload.cardId);
      void appendRow(kind, payload).catch((err: unknown) => {
        // N3: a lost pause / refusal row surfaces on the diag channel (as recordRevocation does)
        if (kind === 'mod.paused' || kind === 'mod.effect.refused') emit({ kind: 'daemon.mod.row.unrecorded', rowKind: kind, name: typeof payload.name === 'string' ? payload.name : null, error: err instanceof Error ? err.message : String(err) });
      });
    },
    kernelPrincipal,
    ...(opts.platform ? { platform: opts.platform } : {}),
    kernelCall: (req) => modKernelCall(req),
    onCallEnd: (name, callId) => modKernelCall.endCall(name, callId),
  });
  // M1.11 slice 3 (#mod-cli): what `gnomon mod install|link` staged on disk reaches the human only through the broker
  const kernelStaged = new Set<string>();
  // the `event` feed to log.read-granted mods (feed.ts): a projection only, and only of RELEASED rows
  // (review: a mod never sees a row the log has not released to readers). Committed rows wait in a
  // bounded queue until the release head passes them; overflow drops the oldest (display only).
  const feedQueue: Array<{ seq: number; e: Parameters<typeof mods.feed>[0] }> = [];
  let feedScheduled = false;
  const flushFeed = (head: number): void => {
    while (feedQueue.length && feedQueue[0]!.seq <= head) {
      const { e } = feedQueue.shift()!;
      try {
        mods.feed(e);
      } catch {
        /* a mod's feed never breaks a release */
      }
    }
  };
  // commit listeners run BEFORE the release (kernel-log.ts onCommit): deliver on the next turn, up to the released head
  log.onCommit((e) => {
    if (feedQueue.length >= 4096) feedQueue.shift();
    feedQueue.push({ seq: e.seq, e });
    if (feedScheduled) return;
    feedScheduled = true;
    setImmediate(() => {
      feedScheduled = false;
      flushFeed(log.releasedHead());
    });
  });
  log.onRelease((head) => flushFeed(head));
  const modPickup = new StagedCardPickup({
    home,
    broker,
    authority,
    host: mods,
    emit: (kind, payload) => void appendRow(kind, payload).catch(() => undefined),
    alreadyLogged: (cardId) => kernelStaged.has(cardId),
  });
  const modKernelCall = createModKernelCall({
      callAs: (principal, verb, params) => dispatcher.callAs(principal, verb, params),
      append: async (row) => {
        // B1: modns.* is userland-owned (L7) ⇒ appended `as: 'userland'` under the MOD principal; the kernel key signs it as an
        // attestation that the kernel accepted a mod-originated row — readers attribute it by principal, never by keyId
        const r = await log.append({ kind: row.kind, principal: row.principal, payload: row.payload, as: 'userland', ...(row.audience ? { audience: row.audience } : {}), ...(row.sensitivity ? { sensitivity: row.sensitivity } : {}) });
        return { seq: r.seq };
      },
  });
  const voiceReports = new VoiceReports();
  // voice slice V1 (#gnomon-voice, talk-only): attachment by human gesture, forwarding guards, voice.* shape checks.
  // Voice rows are userland (voice.* is the voice principal's grant, A23-2): appended `as: 'userland'` under the
  // appending principal, kernel-key attested like modns rows. Enrolment is read from the root-signed file each check.
  const voice = new VoiceControl({
    sessions: {
      ownerOf: (hsid) => supervisor.ownerOf(hsid),
      send: (owner, p) => supervisor.send(owner, p),
      stop: (owner, p) => supervisor.stop(owner, p),
      // V2a kernel-side busy: the supervisor's own turn state (turn.sent until its result)
      busy: (hsid) => supervisor.turnBusy(hsid),
    },
    append: async (row) => {
      const r = await log.append({ kind: row.kind, principal: row.principal, payload: row.payload, as: 'userland', ...(row.connId ? { connId: row.connId } : {}), ...(row.session ? { session: row.session } : {}), ...(row.sensitivity ? { sensitivity: row.sensitivity as 'normal' } : {}) });
      return { seq: r.seq, hash: r.hash, id: r.event.id };
    },
    enrolled: () => readEnrolled(home, authority),
    // Aegis M3: a voice follow subscription never outlives the attachment it was opened under; V2e: attaching
    // (or re-attaching at a wider ceiling) auto-starts the kernel-spawned voice client when it is not running
    onAttachmentChange: () => {
      void hub.endReaderClass('voice');
      if (voice.attachedHsid() !== null && !voiceChild.status().clientConnected) void voiceChild.start();
    },
    clientStatus: () => voiceChild.status(),
    reportStatus: () => voiceReports.status(),
    voiceConnections: () => dispatcher.clients().filter((c) => c.principalKind === 'voice' && c.credential !== 'read-token').map((c) => c.connId),
    kernelPrincipal,
    ...(opts.voice?.ambientIdleMs !== undefined ? { ambientIdleMs: opts.voice.ambientIdleMs } : {}),
    // V2a widening to conversation: the run-mode loosening path — a `strictness` card whose allow is fresh presence
    // (classes.ts: strictness.allow = 'fresh', never a cached unlock, never voice: VOICE_ALLOWLIST names no approving row)
    presence: ({ asker, hsid, from, to, onAllow }) =>
      broker.raise({
        kind: 'strictness',
        requestedBy: asker.principal!,
        hsid,
        attended: true,
        detail: { op: 'voice.widen', hsid, from, to, connId: asker.connId },
        lines: [`Voice: listen ambiently to session …${hsid.slice(-10)}`, `${from ?? 'not attached'} → ${to}: an enrolled speaker's speech is sent to the model without push-to-talk`, 'Once for this GUI login; ends after the idle timeout', 'Allow needs Touch ID; deny or no answer keeps push-to-talk'],
        decisions: ['allow', 'deny'],
        timeoutMs: LOOSEN_TIMEOUT_MS,
        effect: async (decision) => {
          if (decision === 'allow') await onAllow();
        },
      }),
    // Aegis V2a L1: a denied or expired widening card is dropped and a new one raised
    presenceState: (cardId) => broker.card(cardId)?.state,
    // Aegis V2a M2: a failed idle end is counted in status.voice.idleEndFailures{n} and the timer re-armed (no new log
    // kind: the end row itself is what failed to write); send() already refuses past idleAt, so it fails closed
  });
  // TD-2026-10-19-063: the build stamp this kernel LOADED, read once at boot (Aegis V2e M2: it also pins the voice
  // client manifest, so it is read before the voice client is verified and copied below)
  const stampPath = opts.update?.stampPath === undefined ? defaultBuildStampPath() : opts.update.stampPath;
  const buildStamp = stampPath ? readBuildStamp(stampPath) : null;
  // V2e (#gnomon-voice): the voice client is the kernel's own supervised child, linked over an inherited socketpair
  const voiceEntry = opts.voice?.client?.entry !== undefined ? { entry: opts.voice.client.entry } : resolveVoiceClientEntry();
  const voiceChild: VoiceChildSupervisor = new VoiceChildSupervisor({
    home,
    clientEntry: voiceEntry.entry,
    ...('reason' in voiceEntry && voiceEntry.reason ? { unavailableReason: voiceEntry.reason } : {}),
    spawn: opts.voice?.client?.spawn ?? ((cmd, args, o) => spawnChild(cmd, args, o)),
    // Aegis M2: the client runs from the kernel's pinned copy in <home>/bin/voice/client, never from the workspace
    prepare: opts.voice?.client?.prepare ?? (voiceEntry.entry ? createVoicePrepare({ home, entry: voiceEntry.entry, devUnsigned: opts.voice?.client?.devUnsigned === true, expectedManifest: buildStamp?.voiceClientManifest ?? null }) : async () => Promise.reject(new Error('the voice client is not installed'))),
    ...(opts.voice?.client?.backoffMinMs !== undefined ? { backoffMinMs: opts.voice.client.backoffMinMs } : {}),
    attach: async (sock) => {
      if (!server) throw new Error('the kernel socket is not up yet');
      if (authority.ns === null) throw new Error('this home has no root identity yet (gnomon setup)');
      const ctx = server.adopt(sock);
      await dispatcher.adoptPreauthenticated(ctx, { principal: `p:${authority.ns}/voice`, client: { name: '@a-company/gnomon-voice', version: 'spawned' } });
      return ctx.connId;
    },
  });
  // V2e item 4 + GUI alignment: GUI enrolment (fresh-presence card → the root-signed row), forget (no card)
  const voiceEnrol = new VoiceEnrolCards({ home, root: authority, broker: broker as never, onEnrolled: (name) => voiceReports.requested(name) });
  // V2e item 3: the kernel's speakable reply row — watch the ATTACHED session's turn rows, append
  // voice.turn.agent{source:'kernel-speakable'} as the kernel principal (userland kind, kernel-attested)
  const speakable = new KernelSpeakable(() => voice.attachedHsid());
  log.onCommit((e) => {
    const row = speakable.observe(e);
    if (!row) return;
    setImmediate(() => void log.append({ kind: row.kind, principal: kernelPrincipal, payload: { ...row.payload }, session: row.session, as: 'userland' }).catch(() => undefined));
  });
  const dispatcherCommon = {
    voice,
    voiceClient: {
      start: () => voiceChild.start(),
      stop: () => voiceChild.stop(),
      connectionClosed: (connId: string) => voiceChild.connectionClosed(connId),
      enrol: (asker: { connId: string; principal: string }, p: { name: string; consent: string }) => voiceEnrol.enrol(asker, p),
      forget: (p: { name: string }) => voiceEnrol.forget(p),
      report: (p: unknown, connId?: string) => voiceReports.report(p, connId),
      stopSpeaking: () => voiceReports.stopSpeaking(),
    },
    mods: createModRelayPort(mods),
    sessions,
    approvals,
    requests: { modeSet: (asker: Parameters<RunModeControl['request']>[0], payload: unknown) => runModes.request(asker, payload), status: () => runModes.status() },
    reads: { log, hub },
    ...(opts.helloTimeoutMs !== undefined ? { helloTimeoutMs: opts.helloTimeoutMs } : {}),
    ...(opts.preAuthTimeoutMs !== undefined ? { preAuthTimeoutMs: opts.preAuthTimeoutMs } : {}),
    ...(opts.maxPreAuth !== undefined ? { maxPreAuth: opts.maxPreAuth } : {}),
    ...(opts.tokenRecheckMs !== undefined ? { tokenRecheckMs: opts.tokenRecheckMs } : {}),
    onPreAuthClose: (why: Parameters<NonNullable<Parameters<typeof createKernelDispatcher>[0]['onPreAuthClose']>>[0]) => bump(diag.preAuthClosed, why),
    log: logSocketRow,
    status: statusSource,
  };
  // P8-D98 human-device verbs (#socket): UNIX SOCKET ONLY (Aegis L1). They ride in their own object, handed to the
  // unix dispatcher alone (dispatcherOptionsFor), so the web dispatcher has no port for them: its status reports
  // them unavailable and a call is refused not-implemented. gui.open is the in-process launch path, under the
  // endpoint's shared launch-grant cap as a `socket` asker (its own share, launch-cap.ts).
  // One handler module per verb (socket/<verb>.ts; daemon.stop is socket/daemon-stop-verb.ts), one key per verb here.
  const humanVerbs: HumanDeviceVerbPorts = {
    'rules.revoke': createRulesRevokeHandler({
      lookup: (ruleId) => syncRuleBook().get(ruleId),
      append: (payload, ids) => log.append({ kind: 'approval.rule.revoked', principal: kernelPrincipal, payload: { ...payload }, connId: ids.connId }),
    }),
    'gui.open': createGuiOpenHandler({ requestLaunch: (connId: string) => requestWebLaunch(connId, 'socket'), withdrawLaunch: (t: string) => void web?.withdrawLaunch(t) }),
    // T-2026-10-19-014 B0 (TD-2026-10-19-339): raises the signed daemon-stop card; stops only on a Touch ID accept
    'daemon.stop': createDaemonStopHandler({ requestStop: (connId, reason) => requestStop(connId, reason) }),
  };
  const dispatcher = createKernelDispatcher({ authenticator, ...dispatcherOptionsFor('unix', dispatcherCommon, { humanVerbs }) });
  const kernelPem = (kernelSigner as Partial<SoftwareEd25519Signer>).publicKeyPem;
  const requestStop = (connId: string, reason: DaemonStopReason = 'stop'): Promise<CardV1> => {
    const c = dispatcher.clients().find((x) => x.connId === connId && x.phase === 'authenticated');
    const cls = c?.credential === 'read-token' ? 'readToken' : (c?.principalKind ?? 'none');
    return stopCards.request({ connId, principal: c?.principal, principalClass: cls, credential: c?.credential }, reason);
  };
  const requestWebLaunch = async (connId: string, via: LaunchAsker = 'in-process'): Promise<LaunchGrant> => {
    const asker = dispatcher.clients().find((c) => c.connId === connId);
    if (!asker) throw new LifecycleRefusal('web-launch-refused', 'no authenticated unix-socket connection with that connId', { connId });
    if (typeof kernelPem !== 'string') throw new LifecycleRefusal('web-launch-refused', 'the kernel key has no public PEM to hand the page (keystore custody is M1.3)');
    return ensureWeb(kernelPem).requestLaunch(asker, via);
  };
  const ensureWeb = (pem: string): WebEndpoint =>
    (web ??= WebEndpoint.create({
      home,
      ...(opts.web?.preferPort !== undefined ? { preferPort: opts.web.preferPort } : {}),
      ...(opts.web?.inheritFd !== undefined ? { inheritFd: opts.web.inheritFd } : {}),
      resume: resumeGate,
      kernelPublicKeyPem: pem,
      log: (kind, payload, ids) => logSocketRow(kind as `socket.${string}`, payload, ids),
      // §2.4 rule 3 / §11.2: an open GUI WebSocket is a subscriber; a closed one counts for nothing
      holdIdle: () => idle.hold('subscriber'),
      ...(opts.web?.lingerMs !== undefined ? { lingerMs: opts.web.lingerMs } : {}),
      ...(opts.web?.authDeadlineMs !== undefined ? { authDeadlineMs: opts.web.authDeadlineMs } : {}),
      dispatcher: (endpointPath, webHook) =>
        createKernelDispatcher({
          ...dispatcherOptionsFor('web', dispatcherCommon, { humanVerbs }),
          web: webHook,
          authenticator: new SocketAuthenticator({
            home,
            endpointPath,
            kernelSigner,
            trust: authority,
            // revocations are recorded by the socket authenticator's store (and its timer); this store honours them
            readTokens: { revoked: chainRevoked, onRevoked: () => undefined, onUntrusted: () => undefined },
            ...(opts.clock ? { clock: opts.clock } : {}),
          }),
        }),
    }));
  const onSocketEvent = (e: SocketEvent): void => {
    emit(e);
    if (e.kind === 'socket.connect') diag.connects++;
    else if (e.kind === 'socket.frame.refused') bump(diag.refused, e.reason);
    // socket.disconnect has no §9.1 kind: callback only (contract gap, reported).
  };

  // §2.4 rule 11 (TD-2026-10-19-908, T-2026-10-19-014 B2): BEFORE the orphan sweep, read what an upgrade drained
  // (drained + exited ⇒ resume; drained without an exit ⇒ the sweep's) and the cards the old kernel left pending
  const resumePlan = planResume(
    (function* (): Generator<ResumeRow> {
      for (const v of log.read({ reader: { class: 'human' }, kinds: ['permit.grant', 'permit.reattributed', 'session.open', 'session.sandbox', 'session.drained', 'session.exited', 'session.refused', 'approval.request', 'approval.decide', 'approval.expire'] })) {
        if (v.view === 'full') yield { id: v.event.id, kind: v.event.kind, principal: v.event.principal, ...(typeof v.event.keyId === 'string' ? { keyId: v.event.keyId } : {}), ...(v.event.session ? { session: v.event.session } : {}), at: v.event.at, payload: v.event.payload };
      }
    })(),
    { principals: kernelPrincipals, isKernelKey: (k) => log.isKernelKey(k) },
  );
  let orphanSweep: { orphans: number; stopped: number };
  try {
    // §2.4 rule 4: before serving anyone, stop what a crashed daemon left running
    orphanSweep = await sweepOrphans({
      rows: fullRows(['session.spawned', 'session.exited', 'session.orphaned']),
      kernelPrincipals,
      boot,
      append: (kind, payload) => appendRow(kind, payload),
      control,
      ...(opts.childGraceMs !== undefined ? { graceMs: opts.childGraceMs } : {}),
      resuming: new Set(resumePlan.resume.map((c) => c.hsid)),
    });
    server = await listenSocket({
      socketPath: choice.path,
      handle: dispatcher.handle,
      ...(opts.maxFrameBytes !== undefined ? { maxFrameBytes: opts.maxFrameBytes } : {}),
      ...(opts.maxInFlight !== undefined ? { maxInFlight: opts.maxInFlight } : {}),
      ...(opts.preAuthMaxFrameBytes !== undefined ? { preAuthMaxFrameBytes: opts.preAuthMaxFrameBytes } : {}),
      ...(opts.writeHighWater !== undefined ? { writeHighWater: opts.writeHighWater } : {}),
      onEvent: onSocketEvent,
      onConnect: (ctx) => {
        dispatcher.onConnect(ctx);
        releases.set(ctx.connId, idle.hold('connection'));
      },
      onDisconnect: (ctx) => {
        dispatcher.onDisconnect(ctx);
        releases.get(ctx.connId)?.();
        releases.delete(ctx.connId);
      },
    });
  } catch (err) {
    clearInterval(diagTimer);
    clearInterval(tokenTimer);
    clearInterval(brokerTimer);
    await log.close().catch(() => undefined);
    releaseDaemonLock(home, pidfile);
    throw err;
  }

  emit({ kind: 'daemon.start', pid: pidfile.pid, socketPath: pidfile.socketPath, via: choice.via, idleMs });
  // §13.2: probe every configured local endpoint once at start (background; never blocks serving, never throws)
  if (localCfg.config?.endpoints.length) void supervisor.probeLocal().catch(() => undefined);
  await appendRow('daemon.start', {
    pid: pidfile.pid,
    socketPath: pidfile.socketPath,
    via: choice.via,
    idleMs,
    kernelKeyId: kernelSigner.keyId,
    kernelKeySource,
    kernelKeyCustody: 'partial',
    root: authority.state,
  });
  try {
    // before idle.start(): a timer due inside the horizon holds the daemon from its first instant
    await scheduler.start();
  } catch (err) {
    await shutdown('error');
    throw err;
  }
  // TD-2026-10-19-063: record what this kernel LOADED (0600) for the launcher, and watch the on-disk stamp
  try {
    writeKernelBuild(home, { stamp: buildStamp, pid: pidfile.pid, startedAt: pidfile.startedAt });
  } catch {
    /* the launcher then sees no record and never claims a mismatch */
  }
  if (stampPath && (buildStamp || opts.update?.helper)) {
    updateWatch = new UpdateWatch({
      stampPath,
      loaded: buildStamp,
      ...(opts.update?.pollMs !== undefined ? { pollMs: opts.update.pollMs } : {}),
      ...(opts.update?.helper ? { helper: opts.update.helper } : {}),
      onKernelUpdate: async (next) => {
        const card = await stopCards.raiseUpgrade(kernelPrincipal, describeUpdate(buildStamp, next));
        emit({ kind: 'daemon.update.detected', from: buildStamp?.distHash ?? null, to: next.distHash, cardId: card?.cardId ?? null });
      },
    });
    updateWatch.start();
  }
  // the successor of an upgrade (`--prefer-port`) starts its web endpoint at once, so the reloading GUI finds it
  if ((opts.web?.preferPort !== undefined || opts.web?.inheritFd !== undefined) && typeof kernelPem === 'string') void ensureWeb(kernelPem).ensureListening().catch(() => resumeGate.drop());
  else resumeGate.drop(); // no hand-over endpoint ⇒ nothing to resume on
  // §2.4 rule 11: resume the drained sessions and retire the old kernel's pending cards (background: never blocks serving)
  const resume = resumeAfterUpgrade(resumePlan, { supervisor, broker }).catch((): ResumeReport => ({ resumed: [], refused: [], retired: [] }));
  modPickup.start(opts.modPickupMs);
  idle.start();
  return {
    pidfile,
    via: choice.via,
    log,
    kernelSigner,
    kernelPrincipal,
    flushDiagnostics,
    server: server!,
    subscriptions: () => hub.stats(),
    status,
    exited,
    shutdown,
    requestStop,
    requestWebLaunch,
    web: () => web,
    children,
    mods,
    modPickup,
    modKernelCall,
    voiceClient: voiceChild,
    dispatcher,
    scheduler,
    orphanSweep,
    resume,
    upgradeHandoff: () => upgradeHandoff,
    updateWatch,
    buildStamp,
  };
}
