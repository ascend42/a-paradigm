/**
 * @symbol #kernel-log
 * @symbol #identity
 * @symbol #manifest-loader
 *
 * INTERNAL TEST ENTRY (spec §19.1 release gate (c), P8-D84; task
 * T-2026-10-17-009(c), Aegis S34-10). The one module that hands out the
 * kernel's test seams:
 *   - openKernelLog / openKernelLogForRecovery: #kernel-log with a substituted
 *     keystore anchor (`keystoreAnchor`) and boot session (`bootSession`), and
 *     the S33-10 recovery open;
 *   - acknowledgeGap: the presence-gated daemon.log.gap acknowledgement;
 *   - mintTestPresence: a PresenceToken with `method: 'test-seam'`;
 *   - decideInstallCard / rollbackModSnapshot: the #manifest-loader install-card
 *     decision and the human rollback (M1.5), until the M1.6 broker owns cards.
 *   - quarantineWithSteps: `gnomon log quarantine` with crash injection.
 *
 * NEVER IMPORTED BY PRODUCTION CODE. It is not a tsup entry and no index
 * re-exports it; test/seams-fence.test.ts proves that no file under src/
 * imports it, that the import closure of every production entry (package
 * index, gnomon, gnomond, gnomon-web) excludes it, that dist/ never contains
 * it, and that nothing in the CLI or the daemon names acknowledgeGap or
 * openForRecovery. Tests import it as `../src/kernel/testing.js`.
 *
 * When presence lands (M1.3) the recovery path becomes a production API
 * gated by a PresenceToken from `requestPresence`; the seams stay here.
 */
import type { AppendResult, KernelLog, KernelLogOptions } from './log/kernel-log.js';
import './log/kernel-log.js'; // registers the 'log' seams (class static block)
import './manifest/install.js'; // registers the 'manifest' seams (class static block)
import type { DecideOptions, StagedRecord } from './manifest/install.js';
import type { GrantInstallRow } from './manifest/grants.js';
import './log/quarantine.js'; // registers the 'quarantine' seam
import type { QuarantineFsOps, QuarantineOptions, QuarantineReport, QuarantineStep } from './log/quarantine.js';
import { PresenceToken, type PresenceMethod, type PresencePurpose } from './identity/presence.js';
import { seamsOf, type KernelLogSeamOptions } from './internal-seams.js';

/** Marker string: test/seams-fence.test.ts asserts it never appears in dist/. */
export const GNOMON_INTERNAL_TEST_ENTRY = 'gnomon:internal-test-entry:v1' as const;

/** Production options plus the #kernel-log test seams. */
export type KernelLogTestOptions = KernelLogOptions & KernelLogSeamOptions;

function split(opts: KernelLogTestOptions): [KernelLogOptions, KernelLogSeamOptions] {
  const { keystoreAnchor, bootSession, ...rest } = opts;
  const seams: KernelLogSeamOptions = {};
  if (keystoreAnchor !== undefined) seams.keystoreAnchor = keystoreAnchor;
  if (bootSession !== undefined) seams.bootSession = bootSession;
  return [rest, seams];
}

/** `KernelLog.open` with the test seams. */
export function openKernelLog(opts: KernelLogTestOptions): KernelLog {
  const [o, s] = split(opts);
  return seamsOf('log').open(o, s);
}

/** The S33-10 recovery open (an anchor ahead of the db opens truncated instead of throwing). */
export function openKernelLogForRecovery(opts: KernelLogTestOptions): KernelLog {
  const [o, s] = split(opts);
  return seamsOf('log').openForRecovery(o, s);
}

/** Acknowledge an unclean-reboot gap on a recovery-mode log (presence-gated). */
export function acknowledgeGap(log: KernelLog, input: { presenceToken: PresenceToken }): Promise<AppendResult> {
  return seamsOf('log').acknowledgeGap(log, input);
}

/** A test-seam PresenceToken (default purpose `log.gap.acknowledge`, minted now). */
export function mintTestPresence(purpose: PresencePurpose = 'log.gap.acknowledge', opts: { method?: PresenceMethod; mintedAt?: number } = {}): PresenceToken {
  return seamsOf('presence').mint(purpose, opts);
}

/** Decide a staged #manifest-loader install card (the M1.6 broker owns this in production). */
export function decideInstallCard(home: string, name: string, cardId: string, decision: 'install' | 'deny', opts: DecideOptions): StagedRecord {
  return seamsOf('manifest').decideInstall(home, name, cardId, decision, opts);
}

/** The human rollback to a previously approved snapshot (`gnomon mod rollback`, human-only). */
export function rollbackModSnapshot(home: string, name: string, toPackageHash: string | undefined, opts: DecideOptions): GrantInstallRow {
  return seamsOf('manifest').rollbackMod(home, name, toPackageHash, opts);
}

/** `quarantineLog` with a hook after each crash point; throw from `onStep` to inject a crash there. */
export function quarantineWithSteps(
  opts: QuarantineOptions,
  onStep: (step: QuarantineStep, at: { staging?: string; evidence?: string }) => void,
  fsOps?: QuarantineFsOps,
): Promise<QuarantineReport> {
  return seamsOf('quarantine').quarantineWithSteps(opts, onStep, fsOps);
}

export { PresenceToken };
