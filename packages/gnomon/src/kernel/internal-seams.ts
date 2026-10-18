/**
 * @symbol #kernel-log
 * @symbol #identity
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
 * import graph): kernel-log.ts, log/quarantine.ts and identity/presence.ts (to register) and
 * testing.ts (to read). Nothing reachable from a production entry (the
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
  mint(purpose: PresencePurpose, opts?: { method?: PresenceMethod; mintedAt?: number }): PresenceToken;
}

export interface QuarantineSeams {
  /** `quarantineLog` with a hook after each crash point (tests inject a crash by throwing). */
  quarantineWithSteps(opts: QuarantineOptions, onStep: (step: QuarantineStep, at: { staging?: string; evidence?: string }) => void, fsOps?: QuarantineFsOps): Promise<QuarantineReport>;
}

interface Slots {
  log?: KernelLogSeams;
  presence?: PresenceSeams;
  quarantine?: QuarantineSeams;
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
