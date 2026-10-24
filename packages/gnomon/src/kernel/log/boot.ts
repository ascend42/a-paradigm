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
 *   - Windows: the parity phase (P8-D78) supplies a helper boot id; until then
 *     `unknown`.
 * Any failure yields `unknown`. `unknown` on either side never proves a
 * reboot, so classification falls closed to `tamper`.
 *
 * A real id is read once per process (a boot session cannot change under a
 * running process); `unknown` is retried on every open.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export const BOOT_UNKNOWN = 'unknown' as const;

/** A boot id is a UUID on both sources; anything else (garbage, an injected env) is `unknown` (S34-09). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let cached: string | undefined;

/** Validate a raw boot id: trimmed UUID, else `unknown`. */
export function normalizeBootId(raw: string): string {
  const v = raw.trim();
  return UUID.test(v) ? v.toUpperCase() : BOOT_UNKNOWN;
}

function readBootSessionUncached(): string {
  try {
    if (process.platform === 'darwin') {
      // absolute path, empty environment (S34-09): nothing from the caller's env reaches the child
      return normalizeBootId(execFileSync('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], { encoding: 'utf8', timeout: 2000, env: {}, stdio: ['ignore', 'pipe', 'ignore'] }));
    }
    if (process.platform === 'linux') return normalizeBootId(readFileSync('/proc/sys/kernel/random/boot_id', 'utf8'));
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
