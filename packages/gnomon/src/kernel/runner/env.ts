/**
 * @symbol #session-runner
 *
 * #session-runner child environment (spec §3.3 "Environment"; G-RUN-02,
 * G-SEC-02). The child's env is built from an ALLOWLIST, never by copying the
 * daemon's: `HOME USER LOGNAME LANG LC_ALL LC_CTYPE TMPDIR PATH SHELL` (plus
 * the Windows names, data in WINDOWS_EXTRA — the allowlist is the union, a
 * name absent on a platform is simply absent), then the scrub list is removed
 * again (defence in depth: `ANTHROPIC_* CLAUDE_CODE_USE_* CLAUDE_CODE_OAUTH*
 * CLAUDE_CONFIG_DIR NODE_OPTIONS GNOMON_* *_BASE_URL`), then the kernel adds
 * `GNOMON_HSID GNOMON_SOCK GNOMON_SESSION_KEY`. `envKeys[]` (names only, never
 * values) is what the supervisor logs.
 */
export const ENV_ALLOWLIST = Object.freeze(['HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'PATH', 'SHELL']);
export const WINDOWS_EXTRA = Object.freeze(['USERPROFILE', 'SYSTEMROOT', 'WINDIR', 'SystemDrive', 'ProgramFiles', 'COMSPEC', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'CLAUDE_CODE_GIT_BASH_PATH']);
const SCRUB = [/^ANTHROPIC_/i, /^CLAUDE_CODE_USE_/i, /^CLAUDE_CODE_OAUTH/i, /^CLAUDE_CONFIG_DIR$/i, /^NODE_OPTIONS$/i, /^GNOMON_/i, /_BASE_URL$/i];

export function isScrubbed(name: string): boolean {
  return SCRUB.some((r) => r.test(name));
}

export interface SessionEnvInput {
  /** the daemon's env (the source; only allowlisted names are read) */
  from: Readonly<Record<string, string | undefined>>;
  hsid: string;
  sock: string;
  sessionKeyPath: string;
  /** names the kernel adds after the scrub (an api-token card's one key); never a scrubbed name otherwise */
  inject?: Readonly<Record<string, string>>;
}

export function buildSessionEnv(i: SessionEnvInput): { env: Record<string, string>; envKeys: string[] } {
  const env: Record<string, string> = {};
  for (const k of [...ENV_ALLOWLIST, ...WINDOWS_EXTRA]) {
    const v = i.from[k];
    if (typeof v === 'string' && !isScrubbed(k)) env[k] = v;
  }
  env.GNOMON_HSID = i.hsid;
  env.GNOMON_SOCK = i.sock;
  env.GNOMON_SESSION_KEY = i.sessionKeyPath;
  for (const [k, v] of Object.entries(i.inject ?? {})) env[k] = v;
  return { env, envKeys: Object.keys(env).sort() };
}
