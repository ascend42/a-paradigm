/**
 * @symbol $daemon-lifecycle
 *
 * $daemon-lifecycle (spec §2.4 rule 2, §15.3, S-H3) — the clean re-exec env.
 *
 * The activator's environment never reaches the key-holding process: the
 * daemon re-execs itself with a FIXED env — `PATH` (from root-signed config;
 * until M1.1 ships that config, a fixed system PATH), `HOME`/`USERPROFILE` and
 * locale. Everything else is dropped, explicitly including `NODE_OPTIONS` and
 * every `GNOMON_*`. Node flags (`process.execArgv`) are dropped too.
 */
import { spawn } from 'node:child_process';

/** Fixed PATH pending the root-signed config of M1.1. */
export const DEFAULT_REEXEC_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

/** Exact names kept from the activator's env. */
export const REEXEC_ENV_ALLOWLIST: readonly string[] = Object.freeze(['HOME', 'USERPROFILE', 'LANG']);

/** Locale variables (`LC_ALL`, `LC_CTYPE`, …) are kept by pattern. */
const LOCALE_PATTERN = /^LC_[A-Z]+$/;

export function isAllowlistedEnvKey(key: string): boolean {
  return REEXEC_ENV_ALLOWLIST.includes(key) || LOCALE_PATTERN.test(key);
}

export interface CleanEnvOptions {
  /** PATH for the daemon. Root-signed config supplies it from M1.1. */
  path?: string;
}

/** Build the daemon's env from `source`: allowlist only, PATH fixed. */
export function cleanReexecEnv(
  source: Readonly<Record<string, string | undefined>>,
  opts: CleanEnvOptions = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined || !isAllowlistedEnvKey(k)) continue;
    out[k] = v;
  }
  out.PATH = opts.path ?? DEFAULT_REEXEC_PATH;
  return out;
}

export interface DetachOptions {
  /** The executable: node today, the signed SEA later. */
  execPath: string;
  /** The gnomond entry script (omitted for a SEA, whose execPath is the entry). */
  entry?: string;
  home: string;
  idleMs?: number;
  sourceEnv?: Readonly<Record<string, string | undefined>>;
  path?: string;
}

/** argv for the re-exec'd foreground daemon. Home travels in argv, never env. */
export function reexecArgs(opts: Pick<DetachOptions, 'entry' | 'home' | 'idleMs'>): string[] {
  const args = opts.entry ? [opts.entry] : [];
  args.push('--foreground', '--home', opts.home);
  if (opts.idleMs !== undefined) args.push('--idle-ms', String(opts.idleMs));
  return args;
}

/** Spawn the detached daemon with the clean env. Returns its pid. */
export function spawnDetachedDaemon(opts: DetachOptions): number | undefined {
  const child = spawn(opts.execPath, reexecArgs(opts), {
    detached: true,
    stdio: 'ignore',
    env: cleanReexecEnv(opts.sourceEnv ?? process.env, opts.path !== undefined ? { path: opts.path } : {}),
  });
  child.unref();
  return child.pid;
}
