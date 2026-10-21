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
 *
 * IDENTITY FROM THE OS, NEVER FROM THE ACTIVATOR. A session's env must be the
 * same however the daemon was launched (terminal `gnomon up`, `gnomon daemon
 * --detach`, the upgrade successor, Gnomon.app). The clean re-exec
 * (lifecycle/env.ts) keeps no USER, and Claude Code looks its keychain
 * credentials up by `$USER`: without it every session on a re-exec'd daemon
 * was refused `not_subscription_auth`. So on POSIX the identity names
 * (IDENTITY_KEYS) are never copied from the daemon's env:
 *   - `USER` and `LOGNAME` = os.userInfo().username;
 *   - `SHELL` = os.userInfo().shell, when it is absolute;
 *   - `TMPDIR` (darwin) = the per-user temp dir, from `/usr/bin/getconf
 *     DARWIN_USER_TEMP_DIR` run by absolute path with an EMPTY env, accepted
 *     only as an absolute directory owned by this uid and not group- or
 *     world-writable (linux: none, absent).
 * A value the OS cannot give is OMITTED, never back-filled from the env (fail
 * closed: a missing USER is a visible auth refusal; a borrowed one could name
 * another user's keychain item). resolveSessionIdentity runs once at daemon
 * start (the supervisor's constructor). win32 keeps the allowlist as-is:
 * USERNAME/USERPROFILE are WINDOWS_EXTRA, and none of these names is a
 * Windows identity source.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const ENV_ALLOWLIST = Object.freeze(['HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'PATH', 'SHELL']);
export const WINDOWS_EXTRA = Object.freeze(['USERPROFILE', 'SYSTEMROOT', 'WINDIR', 'SystemDrive', 'ProgramFiles', 'COMSPEC', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'CLAUDE_CODE_GIT_BASH_PATH']);
/** The POSIX identity names a session gets from the OS, never from the daemon's env. */
export const IDENTITY_KEYS = Object.freeze(['USER', 'LOGNAME', 'SHELL', 'TMPDIR']);
const SCRUB = [/^ANTHROPIC_/i, /^CLAUDE_CODE_USE_/i, /^CLAUDE_CODE_OAUTH/i, /^CLAUDE_CONFIG_DIR$/i, /^NODE_OPTIONS$/i, /^GNOMON_/i, /_BASE_URL$/i];

export function isScrubbed(name: string): boolean {
  return SCRUB.some((r) => r.test(name));
}

export interface SessionIdentity {
  /** os.userInfo().username: becomes USER and LOGNAME */
  user?: string;
  /** os.userInfo().shell, when absolute */
  shell?: string;
  /** darwin: the per-user temp dir (getconf DARWIN_USER_TEMP_DIR), validated */
  tmpdir?: string;
}

export interface IdentityDeps {
  platform?: NodeJS.Platform;
  userInfo?: () => { username: string; shell: string | null };
  /** darwin: what `/usr/bin/getconf DARWIN_USER_TEMP_DIR` prints (throws on failure) */
  darwinUserTempDir?: () => string;
  uid?: () => number | undefined;
}

/** A value fit for an env var: non-empty, one line, no NUL. */
function envSafe(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && !/[\0\r\n]/.test(v);
}

function getconfDarwinUserTempDir(): string {
  // absolute binary, empty env: confstr(_CS_DARWIN_USER_TEMP_DIR) is keyed by the uid, not by anything inherited
  return execFileSync('/usr/bin/getconf', ['DARWIN_USER_TEMP_DIR'], { env: {}, encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] });
}

/** The darwin per-user temp dir, or undefined: absolute, a real dir owned by `uid`, not group- or world-writable. */
export function validTempDir(raw: string, uid: number | undefined): string | undefined {
  const v = raw.replace(/\r?\n$/, '');
  if (!envSafe(v) || !path.isAbsolute(v) || uid === undefined) return undefined;
  try {
    const st = fs.statSync(fs.realpathSync.native(v));
    if (!st.isDirectory() || st.uid !== uid || (st.mode & 0o022) !== 0) return undefined;
  } catch {
    return undefined;
  }
  return v; // verbatim, as macOS itself sets TMPDIR (the /var form, trailing slash)
}

/** The session identity from the OS (spec §3.3 "Environment"); null on win32. Never reads process.env. */
export function resolveSessionIdentity(d: IdentityDeps = {}): SessionIdentity | null {
  const platform = d.platform ?? process.platform;
  if (platform === 'win32') return null;
  const id: SessionIdentity = {};
  try {
    const u = (d.userInfo ?? (() => os.userInfo()))();
    if (envSafe(u.username)) id.user = u.username;
    if (envSafe(u.shell) && path.isAbsolute(u.shell)) id.shell = u.shell;
  } catch {
    /* no passwd entry for this uid: USER, LOGNAME and SHELL stay absent (fail closed) */
  }
  if (platform === 'darwin') {
    try {
      const t = validTempDir((d.darwinUserTempDir ?? getconfDarwinUserTempDir)(), (d.uid ?? (() => process.getuid?.()))());
      if (t) id.tmpdir = t;
    } catch {
      /* getconf failed: TMPDIR stays absent */
    }
  }
  return id;
}

let resolved: SessionIdentity | null | undefined;
/** resolveSessionIdentity, once per process (the daemon resolves it at start). */
export function sessionIdentity(): SessionIdentity | null {
  if (resolved === undefined) resolved = resolveSessionIdentity();
  return resolved;
}

export interface SessionEnvInput {
  /** the daemon's env (the source; only allowlisted names are read) */
  from: Readonly<Record<string, string | undefined>>;
  hsid: string;
  sock: string;
  sessionKeyPath: string;
  /** names the kernel adds after the scrub (an api-token card's one key); never a scrubbed name otherwise */
  inject?: Readonly<Record<string, string>>;
  /**
   * The OS identity (resolveSessionIdentity). Non-null: USER LOGNAME SHELL TMPDIR come ONLY from it (a name it
   * lacks is absent, whatever the daemon inherited). null (win32): the allowlist alone.
   */
  identity: SessionIdentity | null;
}

export function buildSessionEnv(i: SessionEnvInput): { env: Record<string, string>; envKeys: string[] } {
  const env: Record<string, string> = {};
  for (const k of [...ENV_ALLOWLIST, ...WINDOWS_EXTRA]) {
    const v = i.from[k];
    if (typeof v === 'string' && !isScrubbed(k)) env[k] = v;
  }
  if (i.identity) {
    for (const k of IDENTITY_KEYS) delete env[k];
    if (i.identity.user) {
      env.USER = i.identity.user;
      env.LOGNAME = i.identity.user;
    }
    if (i.identity.shell) env.SHELL = i.identity.shell;
    if (i.identity.tmpdir) env.TMPDIR = i.identity.tmpdir;
  }
  env.GNOMON_HSID = i.hsid;
  env.GNOMON_SOCK = i.sock;
  env.GNOMON_SESSION_KEY = i.sessionKeyPath;
  for (const [k, v] of Object.entries(i.inject ?? {})) env[k] = v;
  return { env, envKeys: Object.keys(env).sort() };
}
