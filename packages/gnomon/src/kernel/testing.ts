/**
 * @symbol #kernel-log
 * @symbol #identity
 *
 * INTERNAL TEST ENTRY (spec §19.1 release gate (c), P8-D84; task
 * T-2026-10-17-009(c), Aegis S34-10). The one module that hands out the
 * kernel's test seams:
 *   - openKernelLog / openKernelLogForRecovery: #kernel-log with a substituted
 *     keystore anchor (`keystoreAnchor`) and boot session (`bootSession`), and
 *     the S33-10 recovery open;
 *   - acknowledgeGap: the presence-gated daemon.log.gap acknowledgement;
 *   - mintTestPresence: a PresenceToken with `method: 'test-seam'`.
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

export { PresenceToken };
