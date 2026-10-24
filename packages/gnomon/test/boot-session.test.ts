// @gnomon-platform: darwin, linux, win32
/**
 * #kernel-log boot session (spec §3.2; research 33 S33-10, P8-D83) — the
 * reader every head anchor records as `boot`. Runs on EVERY platform; marked
 * only because it branches on process.platform (G-WIN-05, see
 * platform-registry.ts): macOS (kern.bootsessionuuid) and Linux (boot_id)
 * yield a UUID cached per process; win32 is `unknown` by design until the
 * parity phase's helper boot id (P8-D78) — and `unknown` never proves a
 * reboot, so classification falls closed to tamper: that fail-closed rule is
 * asserted (platform-independently, via the bootSession seam) in
 * test/kernel-log-gap.test.ts, test "(d) a forged boot … in the FILE anchor
 * alone changes nothing" (no comparable keystore boot ⇒ cause 'tamper',
 * bootPrev 'unknown', even across boots). Moved here from
 * kernel-log-posix.test.ts (T-2026-10-17-011).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BOOT_UNKNOWN, KernelLog, readBootSession, SoftwareEd25519Signer } from '../src/kernel/log/index.js';

const KERNEL = 'p:abcdefgh/kernel';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const homes: string[] = [];

afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

describe('#kernel-log boot session (S33-10, P8-D83)', () => {
  it.runIf(process.platform !== 'win32')('reads kern.bootsessionuuid (macOS) / boot_id (Linux) once per process, zero deps', async () => {
    const boot = readBootSession();
    expect(boot).toMatch(UUID);
    expect(readBootSession()).toBe(boot);
    const home = mkdtempSync(path.join(os.tmpdir(), 'gnomon-boot-'));
    homes.push(home);
    const log = KernelLog.open({ home, kernelPrincipal: KERNEL, signer: SoftwareEd25519Signer.generate() });
    expect(log.report.boot).toBe(boot);
    await log.close();
  });

  it.runIf(process.platform === 'win32')('win32 reads `unknown` until the helper boot id (P8-D78), and the open report says so', async () => {
    expect(readBootSession()).toBe(BOOT_UNKNOWN);
    const home = mkdtempSync(path.join(os.tmpdir(), 'gnomon-boot-'));
    homes.push(home);
    const log = KernelLog.open({ home, kernelPrincipal: KERNEL, signer: SoftwareEd25519Signer.generate() });
    expect(log.report.boot).toBe(BOOT_UNKNOWN);
    await log.close();
  });
});
