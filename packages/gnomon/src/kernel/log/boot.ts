/**
 * @symbol #kernel-log
 *
 * #kernel-log (spec §3.2; research 33 S33-10, P8-D83) — the boot session id
 * every head anchor records as `boot`.
 *
 * On open, a keystore anchor AHEAD of the db is INTEGRITY_BROKEN{truncated}
 * whatever the cause; the boot session only CLASSIFIES it: an unchanged boot
 * session means no power loss or panic can have happened since the anchor was
 * written (cause `tamper`), a changed one means an unclean reboot may have
 * dropped a durable-in-cache WAL tail (cause `unclean-reboot`). Only the
 * keystore anchor's copy is authoritative — a same-user process can rewrite
 * the file anchor.
 *
 * Sources (zero deps, G-SEC-01 — node builtins only):
 *   - macOS: `kern.bootsessionuuid`, read by spawning `/usr/sbin/sysctl -n
 *     kern.bootsessionuuid` (node exposes no sysctl binding).
 *   - Linux: `/proc/sys/kernel/random/boot_id`.
 *   - Windows: gnomon-helper `boot.id` (W3), the boot counter Windows keeps in
 *     HKLM\...\PrefetchParameters\BootId, as `win:<n>` (admin-writable only). It
 *     never changes on a running system; whether a fast-startup (hybrid) boot
 *     bumps it is unprobed, and a counter that did NOT change only classifies
 *     as `tamper` (fail closed), never the other way.
 * Any failure yields `unknown`. `unknown` on either side never proves a
 * reboot, so classification falls closed to `tamper`.
 *
 * A real id is read once per process (a boot session cannot change under a
 * running process); `unknown` is retried on every open.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { helperOpSync, kernelWin32Helper } from '../../platform/win32/helper-client.js';

export const BOOT_UNKNOWN = 'unknown' as const;

/** A boot id is a UUID (macOS, Linux) or the helper's `win:<n>` (Windows); anything else (garbage, an injected env) is `unknown` (S34-09). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WIN_BOOT = /^win:\d{1,10}$/;

let cached: string | undefined;

/** Validate a raw boot id: trimmed UUID, else `unknown`. */
export function normalizeBootId(raw: string): string {
  const v = raw.trim();
  if (UUID.test(v)) return v.toUpperCase();
  return WIN_BOOT.test(v) ? v : BOOT_UNKNOWN;
}

/** Platform registry of boot-id sources (G-WIN-05: no inline platform branch); a platform without one is `unknown`. */
const BOOT_SOURCES: Readonly<Partial<Record<NodeJS.Platform, () => string>>> = Object.freeze({
  // absolute path, empty environment (S34-09): nothing from the caller's env reaches the child
  darwin: () => execFileSync('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], { encoding: 'utf8', timeout: 2000, env: {}, stdio: ['ignore', 'pipe', 'ignore'] }),
  linux: () => readFileSync('/proc/sys/kernel/random/boot_id', 'utf8'),
  win32: () => String(helperOpSync(kernelWin32Helper(), 'boot.id').bootId ?? ''),
});

function readBootSessionUncached(): string {
  const source = BOOT_SOURCES[process.platform];
  try {
    if (source) return normalizeBootId(source());
  } catch {
    /* fall through: unknown never proves a reboot */
  }
  return BOOT_UNKNOWN;
}

/**
 * The current boot session id (`kern.bootsessionuuid` / `boot_id`), or
 * `unknown`. A real id is cached per process; `unknown` is NOT cached (a
 * transient sysctl failure is retried on the next open; the log emits an
 * onDiagnostic `boot.unknown`).
 */
export function readBootSession(): string {
  if (cached) return cached;
  const v = readBootSessionUncached();
  if (v !== BOOT_UNKNOWN) cached = v;
  return v;
}
