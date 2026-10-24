/**
 * @symbol $daemon-lifecycle
 *
 * $daemon-lifecycle (spec §2.4 rule 1) — the kernel endpoint path for #socket.
 *
 * `<home>/gnomon.sock`. When that overflows `sun_path`, Linux falls back to
 * `$XDG_RUNTIME_DIR` (a per-user 0700 directory); macOS has no such fallback.
 * Gnomon deliberately DEPARTS from Warpline's `os.tmpdir()` fallback
 * (warpline lifecycle.ts:44-50): never `/tmp`; if nothing fits, refuse to
 * start. Windows: the named pipe `\\.\pipe\gnomon-<sha>` (windowsPipePath),
 * made owner-only by the helper before it serves (W3, probe P03).
 *
 * Lifted (copied, never imported) from packages/warpline/src/daemon/lifecycle.ts.
 */
import * as net from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { currentUid } from './home.js';

export const SOCKET_NAME = 'gnomon.sock';

/** Does something answer on `socketPath`? (client activation, `gnomon log quarantine`'s liveness probe). */
export function canConnectSocket(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const c = net.connect(socketPath);
    c.once('connect', () => {
      c.destroy();
      resolve(true);
    });
    c.once('error', () => resolve(false));
  });
}

/** sun_path is 104 bytes on macOS and 108 on Linux, NUL included; keep a margin. */
export const SUN_PATH_SAFE = 100;

/** Shared temp roots a kernel socket may never live under (§2.4). */
export const FORBIDDEN_SOCKET_ROOTS: readonly string[] = Object.freeze(['/tmp', '/private/tmp', '/var/tmp']);

export type EndpointVia = 'home' | 'xdg-runtime' | 'pipe';

export const PIPE_SALT_FILE = 'pipe.salt';

/**
 * The home's pipe salt (Aegis M2): 32 random hex in `<home>/pipe.salt`, created on first use. The home is owner-only,
 * so another local user cannot compute the pipe name and squat it before the kernel binds (a squat fails the
 * kernel's listen closed: a cross-user denial of service without the salt). null when the home does not exist yet.
 */
function pipeSalt(home: string): string | null {
  const file = path.join(home, PIPE_SALT_FILE);
  const read = (): string | null => {
    try {
      const s = fs.readFileSync(file, 'utf8').trim();
      return /^[0-9a-f]{32}$/.test(s) ? s : null;
    } catch {
      return null;
    }
  };
  const have = read();
  if (have) return have;
  try {
    fs.writeFileSync(file, `${randomBytes(16).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
  } catch {
    /* no home yet, or a concurrent creator won: read whatever is there */
  }
  return read();
}

/** The kernel pipe for a home on Windows: `\\.\pipe\gnomon-<32 hex>` (sha256 of the home's salt and its case-folded realpath). */
export function windowsPipePath(home: string, salt: string | null = pipeSalt(home)): string {
  const key = createHash('sha256').update(`${salt ?? ''}\n${realOrResolved(home).toLowerCase()}`).digest('hex').slice(0, 32);
  return `\\\\.\\pipe\\gnomon-${key}`;
}

/** The pipe name (no `\\.\pipe\` prefix) of a pipe path, or null for a socket path. */
export function pipeNameOf(socketPath: string): string | null {
  const m = /^\\\\[.?]\\pipe\\(.+)$/.exec(socketPath);
  return m ? m[1]! : null;
}

export type EndpointChoice =
  | { ok: true; path: string; via: EndpointVia }
  | { ok: false; reason: string; candidates: string[] };

export interface EndpointOptions {
  home: string;
  platform?: NodeJS.Platform;
  env?: Readonly<Record<string, string | undefined>>;
  /** Override the forbidden-root list (tests). Defaults to FORBIDDEN_SOCKET_ROOTS + a world-writable os.tmpdir(). */
  forbiddenRoots?: readonly string[];
}

export function fitsSunPath(p: string): boolean {
  return Buffer.byteLength(p, 'utf8') <= SUN_PATH_SAFE;
}

function realOrResolved(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** The default forbidden roots, plus os.tmpdir() when it is world-writable (Linux /tmp). */
export function defaultForbiddenRoots(): string[] {
  const roots = [...FORBIDDEN_SOCKET_ROOTS];
  try {
    const t = fs.realpathSync(os.tmpdir());
    if ((fs.statSync(t).mode & 0o002) !== 0) roots.push(t);
  } catch {
    /* no tmpdir — nothing to add */
  }
  return roots;
}

export function isUnderForbiddenRoot(p: string, roots: readonly string[]): boolean {
  const real = realOrResolved(p);
  return roots.some((r) => real === r || real.startsWith(r.endsWith('/') ? r : `${r}/`));
}

/** `$XDG_RUNTIME_DIR` is usable only when absolute, a real directory, ours, and 0700-tight. */
function xdgRuntimeDir(env: Readonly<Record<string, string | undefined>>, roots: readonly string[]): string | null {
  const dir = env.XDG_RUNTIME_DIR;
  if (!dir || !path.isAbsolute(dir)) return null;
  let st: fs.Stats;
  try {
    st = fs.lstatSync(dir);
  } catch {
    return null;
  }
  if (!st.isDirectory()) return null;
  const uid = currentUid();
  if (uid !== null && st.uid !== uid) return null;
  if ((st.mode & 0o077) !== 0) return null;
  if (isUnderForbiddenRoot(dir, roots)) return null;
  return dir;
}

/**
 * Pick the socket path for `home`. Deterministic: server, `status` and every
 * client derive the same path from the home, so no client trusts the pidfile's
 * `socketPath` (same-user writable, S29-K6).
 */
export function selectSocketPath(opts: EndpointOptions): EndpointChoice {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const roots = opts.forbiddenRoots ?? defaultForbiddenRoots();
  const candidates: string[] = [];

  if (platform === 'win32') {
    // spec §16: `\\.\pipe\gnomon-<sha>`, keyed by the home's realpath (case-folded: NTFS is case-insensitive) so
    // every client derives the same name. The kernel binds it first (libuv FIRST_PIPE_INSTANCE: a squatter fails the
    // listen closed) and the helper makes its DACL owner-only before any connection is served (P03, server.ts).
    const pipe = windowsPipePath(opts.home);
    candidates.push(pipe);
    return { ok: true, path: pipe, via: 'pipe' };
  }

  const preferred = path.join(opts.home, SOCKET_NAME);
  candidates.push(preferred);
  if (isUnderForbiddenRoot(opts.home, roots)) {
    return { ok: false, reason: `home ${opts.home} is under a shared temp root; refusing (never /tmp)`, candidates };
  }
  if (fitsSunPath(preferred)) return { ok: true, path: preferred, via: 'home' };

  if (platform === 'linux') {
    const xdg = xdgRuntimeDir(env, roots);
    if (xdg) {
      const key = createHash('sha256').update(path.resolve(opts.home)).digest('hex').slice(0, 16);
      const fallback = path.join(xdg, `gnomon-${key}.sock`);
      candidates.push(fallback);
      if (fitsSunPath(fallback)) return { ok: true, path: fallback, via: 'xdg-runtime' };
    }
  }

  return {
    ok: false,
    reason: `socket path overflows sun_path (${SUN_PATH_SAFE} bytes) and no safe fallback fits; refusing (never /tmp)`,
    candidates,
  };
}
