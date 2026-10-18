/**
 * @symbol #kernel-log
 * @symbol #identity
 * @symbol #web-endpoint
 * @symbol #manifest-loader
 *
 * Internal seam channel (spec §19.1 release gate (c), P8-D84; task
 * T-2026-10-17-009(c), Aegis S34-10). The kernel's TEST SEAMS — the
 * #kernel-log keystore anchor and boot session overrides, the recovery open
 * and the gap acknowledgement, and the presence mint — are not on any public
 * surface. Each owning module registers its capabilities here once, from a
 * class static block, and the ONLY reader is the internal test entry
 * (src/kernel/testing.ts).
 *
 * WHO MAY IMPORT THIS FILE (test/seams-fence.test.ts proves it on the source
 * import graph): kernel-log.ts, log/quarantine.ts, identity/presence.ts,
 * manifest/install.ts, web/endpoint.ts, modhost/host.ts and lifecycle/daemon.ts (to register) and testing.ts (to read).
 * The `daemon` slot is the ONLY way to start a daemon whose supervisor runs a script (fake) claude.
 * The manifest slot holds the M1.5 install-card decision and the rollback until the
 * M1.6 broker owns cards. The `web` slot (#web-endpoint, M1.4) is the ONLY way to
 * run the transport child without its sandbox profile or against another bundle pin.
 * Nothing reachable from a production entry (the
 * package index, the gnomon / gnomond CLIs, gnomon-web) imports testing.ts,
 * and no index re-exports this file, so production code cannot open a log
 * with a substituted keystore anchor or boot id, open one for recovery, or
 * acknowledge a gap. When presence lands (M1.3, the signed helper) the
 * recovery path moves to a production API gated by a real PresenceToken.
 *
 * A slot is written once: a second registration throws, so a module that
 * reached this file could not swap a registered capability for its own.
 */
import type { AnchorStore } from './log/anchor.js';
import type { AppendResult, KernelLog, KernelLogOptions } from './log/kernel-log.js';
import type { PresenceMethod, PresencePurpose, PresenceToken } from './identity/presence.js';
import type { WebEndpoint, WebEndpointOptions, WebEndpointSeams } from './web/endpoint.js';
import type { DecideOptions, StagedRecord } from './manifest/install.js';
import type { GrantInstallRow } from './manifest/grants.js';
import type { ModHost, ModHostOptions, ModHostSeams } from './modhost/host.js';
import type { DaemonHandle, DaemonOptions, DaemonSeams } from './lifecycle/daemon.js';
import type { QuarantineFsOps, QuarantineOptions, QuarantineReport, QuarantineStep } from './log/quarantine.js';

/** The #kernel-log options that are test seams only (never on KernelLogOptions). */
export interface KernelLogSeamOptions {
  /** The keystore anchor store (production: the helper-backed store; until M1.3 the `unavailable` stub). */
  keystoreAnchor?: AnchorStore;
  /** The boot session id (production: boot.ts `readBootSession()`, read once at open). */
  bootSession?: string;
}

export interface KernelLogSeams {
  open(opts: KernelLogOptions, seams: KernelLogSeamOptions): KernelLog;
  /** S33-10 recovery open: an anchor ahead of the db opens in recovery mode instead of throwing. */
  openForRecovery(opts: KernelLogOptions, seams: KernelLogSeamOptions): KernelLog;
  /** Presence-gated acknowledgement of rows lost to an unclean reboot (kernel-log.ts). */
  acknowledgeGap(log: KernelLog, input: { presenceToken: PresenceToken }): Promise<AppendResult>;
}

export interface PresenceSeams {
  /** Mint a presence token without a human (tests only, until the helper's presence prompt, M1.3). */
  /** `bind` = the decision it authorizes (bound presence); `ageMs` backdates it on the kernel-trusted clock (staleness tests). */
  mint(purpose: PresencePurpose, opts?: { method?: PresenceMethod; mintedAt?: number; bind?: Readonly<Record<string, string>>; ageMs?: number }): PresenceToken;
}

/** #web-endpoint: construct an endpoint with a substituted launcher (the unsandboxed child, tests on every OS) or bundle pin. */
export interface WebSeams {
  create(opts: WebEndpointOptions, seams: WebEndpointSeams): WebEndpoint;
}

/**
 * #manifest-loader decisions (M1.5): deciding an install card and the human
 * rollback. The approval broker that owns card decisions is M1.6; until then
 * these are reachable ONLY through the internal test entry.
 */
export interface ManifestSeams {
  decideInstall(home: string, name: string, cardId: string, decision: 'install' | 'deny', opts: DecideOptions): StagedRecord;
  rollbackMod(home: string, name: string, toPackageHash: string | undefined, opts: DecideOptions): GrantInstallRow;
}

export interface QuarantineSeams {
  /** `quarantineLog` with a hook after each crash point (tests inject a crash by throwing). */
  quarantineWithSteps(opts: QuarantineOptions, onStep: (step: QuarantineStep, at: { staging?: string; evidence?: string }) => void, fsOps?: QuarantineFsOps): Promise<QuarantineReport>;
}

/** #mod-host: construct a host with an unsandboxed launcher and/or a substituted egress dialer (M1.11). */
export interface ModHostSeamSlot {
  create(opts: ModHostOptions, seams: ModHostSeams): ModHost;
}

/** $daemon-lifecycle: start a daemon with the supervisor test rig (fake claude) and a substituted law-7 billing source (#dev-launch smoke test). */
export interface DaemonSeamSlot {
  start(opts: DaemonOptions, seams: DaemonSeams): Promise<DaemonHandle>;
}

interface Slots {
  daemon?: DaemonSeamSlot;
  log?: KernelLogSeams;
  presence?: PresenceSeams;
  web?: WebSeams;
  manifest?: ManifestSeams;
  quarantine?: QuarantineSeams;
  modhost?: ModHostSeamSlot;
}

const slots: Slots = {};

/** Register an owner's seams (called once, from the owner's class static block). */
export function registerSeams<K extends keyof Slots>(slot: K, seams: NonNullable<Slots[K]>): void {
  if (slots[slot]) throw new Error(`internal seam ${slot} is already registered`);
  slots[slot] = Object.freeze(seams) as Slots[K];
}

/** Read a registered seam; throws if its owner module was never loaded. */
export function seamsOf<K extends keyof Slots>(slot: K): NonNullable<Slots[K]> {
  const s = slots[slot];
  if (!s) throw new Error(`internal seam ${slot} is not registered (its owner module was not loaded)`);
  return s as NonNullable<Slots[K]>;
}
