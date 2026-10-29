/**
 * @symbol $daemon-lifecycle
 *
 * $daemon-lifecycle (spec §2.4 rule 2, §15.3, S-H3) — the clean re-exec env.
 *
 * The activator's environment never reaches the key-holding process: the
 * daemon re-execs itself with a FIXED env — `PATH` (from root-signed config;
 * until M1.1 ships that config, a fixed system PATH), `HOME`/`USERPROFILE` and
 * locale. Everything else is dropped, explicitly including `NODE_OPTIONS` and
 * every `GNOMON_*`. Node flags (`process.execArgv`) are dropped too, except
 * exactly one that is ADDED: `--disable-sigusr1` (T-2026-10-18-030 (1)).
 *
 * Why: a same-user `kill -USR1 <pid>` (or `process._debugProcess(pid)`) opens
 * the V8 inspector in a running Node process, and neither the env scrub nor an
 * execArgv check sees it. With `--disable-sigusr1` (Node >= 22.14 / >= 23.7)
 * Node ignores the signal. The kernel (gnomond --foreground, `gnomon up`,
 * `gnomon dev up`) refuses to start unless the flag is in its execArgv: a JS
 * `process.on('SIGUSR1')` listener does NOT count — it can be removed at run
 * time and is not what the guard reads.
 */
import { SEA_GNOMOND_ARG } from './sea.js';

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

/** The one Node flag the kernel runs with, and requires (T-2026-10-18-030 (1)). */
export const DISABLE_SIGUSR1 = '--disable-sigusr1';

/** True only when `--disable-sigusr1` is an interpreter flag of the process (a JS listener never counts). */
export function sigusr1Disabled(execArgv: readonly string[] = process.execArgv): boolean {
  return execArgv.includes(DISABLE_SIGUSR1);
}

/** The refusal text when the kernel would run with SIGUSR1 able to open the inspector, or null. */
export function sigusr1Refusal(execArgv: readonly string[] = process.execArgv): string | null {
  return sigusr1Disabled(execArgv) ? null : `node was started without ${DISABLE_SIGUSR1}: a same-user SIGUSR1 would open the V8 inspector inside the process that holds the keys`;
}

/**
 * argv for the re-exec'd foreground daemon. Home travels in argv, never env.
 * Under node the first arg is `--disable-sigusr1`; a SEA (no entry) cannot take
 * node flags in argv and must bake it into its sea-config `execArgv` — the
 * foreground guard refuses it otherwise (fail closed). The SEA kernel
 * (#kernel-sea, `gnomon.kernel`) carries both entries, so its argv starts with
 * SEA_GNOMOND_ARG (`--gnomond`), which selects gnomond over the CLI
 * (scripts/sea/sea-prelude.mjs).
 */
export function reexecArgs(opts: Pick<DetachOptions, 'entry' | 'home' | 'idleMs'> & { readyFd?: number; readyFifo?: string }): string[] {
  const args = opts.entry ? [DISABLE_SIGUSR1, opts.entry] : [SEA_GNOMOND_ARG];
  args.push('--foreground', '--home', opts.home);
  if (opts.idleMs !== undefined) args.push('--idle-ms', String(opts.idleMs));
  if (opts.readyFd !== undefined) args.push('--ready-fd', String(opts.readyFd)); // ready.ts handshake
  else if (opts.readyFifo !== undefined) args.push('--ready-fifo', opts.readyFifo); // ready.ts 'fifo' channel (linux)
  return args;
}

