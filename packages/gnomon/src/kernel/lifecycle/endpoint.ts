/**
 * @symbol $daemon-lifecycle
 *
 * $daemon-lifecycle (spec §2.4 rule 1) — the kernel endpoint path for #socket.
 *
 * `<home>/gnomon.sock`. When that overflows `sun_path`, Linux falls back to
 * `$XDG_RUNTIME_DIR` (a per-user 0700 directory); macOS has no such fallback.
 * Gnomon deliberately DEPARTS from Warpline's `os.tmpdir()` fallback
 * (warpline lifecycle.ts:44-50): never `/tmp`; if nothing fits, refuse to
 * start. Windows (named pipe via the signed helper) is the parity phase
 * (P8-D78) and refuses here.
 *
 * Lifted (copied, never imported) from packages/warpline/src/daemon/lifecycle.ts.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { currentUid } from './home.js';

export const SOCKET_NAME = 'gnomon.sock';

/** sun_path is 104 bytes on macOS and 108 on Linux, NUL included; keep a margin. */
export const SUN_PATH_SAFE = 100;

/** Shared temp roots a kernel socket may never live under (§2.4). */
export const FORBIDDEN_SOCKET_ROOTS: readonly string[] = Object.freeze(['/tmp', '/private/tmp', '/var/tmp']);

export type EndpointVia = 'home' | 'xdg-runtime';

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
    return { ok: false, reason: 'windows named pipe is the parity phase (P8-D78)', candidates };
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
