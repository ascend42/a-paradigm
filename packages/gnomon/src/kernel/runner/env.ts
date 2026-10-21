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
 * start (the supervisor's constructor), which logs one
 * session.sandbox{phase:'identity', missing} row (names only) when it is
 * incomplete. win32 keeps the allowlist as-is: USERPROFILE is in
 * WINDOWS_EXTRA (USERNAME is not allowlisted), and none of these names is a
 * Windows identity source.
 *
 * PATH (TD-2026-10-21-077) is NEVER the daemon's on POSIX either: it is the
 * root-signed `config.sessions.path` when set, else defaultSessionPath — on
 * darwin the running node's dir, <os home>/.local/bin, /opt/homebrew/bin,
 * /usr/local/bin, /usr/bin, /bin, /usr/sbin, /sbin (linux: the same without
 * /opt/homebrew/bin). win32 keeps today's behaviour (the allowlisted PATH):
 * its system PATH lives in the registry and has no clean fixed equivalent.
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
  /** os.userInfo().homedir, when absolute (the passwd home, never $HOME) */
  home?: string;
}

/** The identity names the OS did not give (logged at daemon start, names only); [] on win32 (null identity). */
export function missingIdentity(id: SessionIdentity | null, platform: NodeJS.Platform = process.platform): string[] {
  if (!id) return [];
  const out: string[] = [];
  if (!id.user) out.push('USER', 'LOGNAME');
  if (!id.shell) out.push('SHELL');
  if (platform === 'darwin' && !id.tmpdir) out.push('TMPDIR');
  if (!id.home) out.push('HOME');
  return out;
}

/** Aegis L1: the screen-socket deny's dir when the session has no TMPDIR — a literal, never the daemon's env (darwin) */
export const DARWIN_SCREEN_TMP_FALLBACK = '/private/tmp';

/** The darwin system dirs of the default session PATH, after the node dir and ~/.local/bin (TD-2026-10-21-077). */
export const DARWIN_SESSION_PATH_TAIL = Object.freeze(['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']);
export const LINUX_SESSION_PATH_TAIL = Object.freeze(['/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']);

/**
 * TD-2026-10-21-077: the built-in session PATH when `config.sessions.path` is unset; null on win32 (today's
 * behaviour: the allowlisted PATH). `nodeDir` is the dir of the node running the kernel (process.execPath, an OS
 * fact), `home` the OS home (os.userInfo().homedir). Never reads process.env. Entries holding `:` are skipped.
 */
export function defaultSessionPath(o: { platform?: NodeJS.Platform; nodeDir?: string; home?: string } = {}): string[] | null {
  const platform = o.platform ?? process.platform;
  if (platform === 'win32') return null;
  const tail = platform === 'darwin' ? DARWIN_SESSION_PATH_TAIL : LINUX_SESSION_PATH_TAIL;
  const head = [o.nodeDir, o.home ? path.posix.join(o.home, '.local', 'bin') : undefined].filter((d): d is string => typeof d === 'string' && path.posix.isAbsolute(d) && !d.includes(':'));
  return [...new Set([...head, ...tail])];
}

/**
 * Aegis L (TD-2026-10-21-077): the node dir a session PATH carries — the dir of the REALPATH of `execPath`. Chosen
 * option: it is always kept, and planSessionPath WRITE-DENIES it whenever this user can write it (under the home
 * for nvm/volta, inside the Homebrew prefix for brew); a root-owned dir needs no deny. null on win32 / failure.
 */
export function sessionNodeDir(execPath: string, d: { platform?: NodeJS.Platform } = {}): string | null {
  if ((d.platform ?? process.platform) === 'win32') return null;
  try {
    const dir = path.dirname(fs.realpathSync.native(execPath));
    return path.posix.isAbsolute(dir) && !dir.includes(':') ? dir : null;
  } catch {
    return null;
  }
}

/** Realpath the longest existing prefix of `p` and append the rest (SBPL matches resolved paths). */
function realLoose(p: string): string {
  let cur = p;
  const rest: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(cur), ...rest.reverse());
    } catch {
      const up = path.dirname(cur);
      if (up === cur) return p;
      rest.push(path.basename(cur));
      cur = up;
    }
  }
}

/** Whether this user could write `p` (or create it: the nearest existing ancestor): owner, or W_OK. */
function userWritable(p: string, uid: number | undefined): boolean {
  let cur = p;
  for (;;) {
    try {
      const st = fs.statSync(cur);
      if (uid !== undefined && st.uid === uid) return true;
      try {
        fs.accessSync(cur, fs.constants.W_OK);
        return true;
      } catch {
        return false;
      }
    } catch {
      const up = path.dirname(cur);
      if (up === cur) return false;
      cur = up;
    }
  }
}

const within = (child: string, parent: string): boolean => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/**
 * TD-2026-10-21-162 (founder ruling; Aegis M): every user-writable dir on the session PATH is WRITE-DENIED in the
 * session profile, so a session cannot plant an `ls`/`git` a later session's auto-passed read-only command runs.
 * Per entry (POSIX; resolved by realpath, never from env — no HOMEBREW_PREFIX):
 *   - under the OS home (~/.local/bin, an nvm/volta node dir) ⇒ deny the dir (even before it exists);
 *   - a Homebrew prefix (the entry is <prefix>/bin|sbin and <prefix>/Cellar exists) that this user can write ⇒ deny
 *     the WHOLE prefix (bin entries are links into Cellar); for the Intel prefix /usr/local only
 *     /usr/local/{bin,sbin,Cellar} (not all of /usr/local);
 *   - any other entry this user can write (owner or W_OK, or its nearest existing ancestor) ⇒ deny the dir.
 * An entry that IS the home or an ancestor of it is DROPPED from the PATH (denying it would deny the whole home), and so
 * is an empty or non-absolute entry (Aegis L2: execvp reads it relative to the cwd).
 * Reads and exec stay allowed (file-write* only).
 */
export function planSessionPath(dirs: readonly string[], o: { home?: string; uid?: number } = {}): { dirs: string[]; denies: string[] } {
  const home = o.home ? realLoose(o.home) : undefined;
  const uid = o.uid ?? process.getuid?.();
  const kept: string[] = [];
  const denies = new Set<string>();
  for (const d of dirs) {
    // Aegis L2: an empty or relative entry means "the cwd" to execvp (a repo-planted binary): dropped
    if (d === '' || !path.isAbsolute(d)) continue;
    const real = realLoose(d);
    if (home && within(home, real)) continue; // the home itself, or `/`, `/Users`: never a PATH entry
    kept.push(d);
    if (home && within(real, home)) {
      denies.add(real);
      continue;
    }
    const base = path.basename(real);
    const prefix = path.dirname(real);
    const cellar = path.join(prefix, 'Cellar');
    if ((base === 'bin' || base === 'sbin') && fs.existsSync(cellar) && (userWritable(real, uid) || userWritable(cellar, uid))) {
      if (prefix === '/usr/local') for (const x of ['bin', 'sbin', 'Cellar']) denies.add(path.join(prefix, x));
      else denies.add(prefix);
      continue;
    }
    if (userWritable(real, uid)) denies.add(real);
  }
  // a deny inside another deny is redundant
  const all = [...denies].sort();
  return { dirs: kept, denies: all.filter((x) => !all.some((y) => y !== x && within(x, y))) };
}

/** The OS user home (os.userInfo().homedir via the resolved identity), else os.homedir(); one helper for every kernel reader. */
export function osUserHome(): string {
  return sessionIdentity()?.home ?? os.homedir();
}

/** The session PATH: the configured list, else the default; null ⇒ keep the allowlisted PATH (win32 only). */
export function sessionPathFor(configured: readonly string[] | null | undefined, o: { platform?: NodeJS.Platform; nodeDir?: string; home?: string } = {}): string | null {
  const platform = o.platform ?? process.platform;
  const dirs = configured && configured.length ? [...configured] : defaultSessionPath(o);
  return dirs ? dirs.join(platform === 'win32' ? ';' : ':') : null;
}

export interface IdentityDeps {
  platform?: NodeJS.Platform;
  userInfo?: () => { username: string; shell: string | null; homedir?: string };
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
    if (envSafe(u.homedir) && path.isAbsolute(u.homedir)) id.home = u.homedir;
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
  /** TD-2026-10-21-077: the session PATH (sessionPathFor); non-null REPLACES any daemon PATH. null (win32): the allowlist's. */
  path: string | null;
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
  if (i.path !== null) env.PATH = i.path;
  env.GNOMON_HSID = i.hsid;
  env.GNOMON_SOCK = i.sock;
  env.GNOMON_SESSION_KEY = i.sessionKeyPath;
  for (const [k, v] of Object.entries(i.inject ?? {})) env[k] = v;
  return { env, envKeys: Object.keys(env).sort() };
}
