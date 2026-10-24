/**
 * @symbol #mod-host
 *
 * Per-mod KV for `state.get` / `state.set` (spec §12.3), owned by the HOST
 * and stored in `<home>/mods/<name>/state.db` (§12.3's path: a SIBLING of
 * `state/`, in a directory the `mod` profile NEVER grants — Aegis round 2 F1): the mod-writable `state/` and
 * `blobs/` dirs are never read or written by the unsandboxed host, so a
 * symlink a mod plants there cannot steer a host file operation.
 * Defence in depth on the host dir itself: it must be a real directory
 * (lstat, not a symlink, realpath = the expected path); reads open with
 * O_NOFOLLOW; writes go to an UNPREDICTABLE tmp name created O_EXCL |
 * O_NOFOLLOW (mode 0600), then rename.
 * Size-capped: key ≤ 256 chars of [A-Za-z0-9._:/-], value ≤ 64 KiB of JSON,
 * the whole store ≤ 1 MiB. A store the host cannot parse reads as empty.
 * The file holds JSON in slice 1 (`node:sqlite` is a slice-2 choice); the
 * calls are synchronous and bounded by the 1 MiB cap.
 */
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { modDir } from '../manifest/snapshot.js';
import { ModRefusal } from './refusal.js';

export const STATE_LIMITS = Object.freeze({ keyChars: 256, valueBytes: 64 * 1024, totalBytes: 1024 * 1024 });
const KEY = /^[A-Za-z0-9._:/-]{1,256}$/;

/** Mod-writable (granted by the profile when `write` is in force). The host never does file I/O inside it. */
export function stateDir(home: string, name: string): string {
  return path.join(modDir(home, name), 'state');
}
/** Mod-writable (as stateDir). */
export function blobsDir(home: string, name: string): string {
  return path.join(modDir(home, name), 'blobs');
}
/** Host-only: `<home>/mods/<name>/` — never granted to any profile (the store is its `state.db`, §12.3). */
export function hostDir(home: string, name: string): string {
  return modDir(home, name);
}

/** lstat: a real directory (not a symlink) whose realpath is exactly `p` resolved through its (real) parent. */
export function isRealDir(p: string): boolean {
  try {
    const st = fs.lstatSync(p);
    if (!st.isDirectory() || st.isSymbolicLink()) return false;
    return fs.realpathSync(p) === path.join(fs.realpathSync(path.dirname(p)), path.basename(p));
  } catch {
    return false;
  }
}

export class ModState {
  readonly #dir: string;
  readonly #file: string;
  readonly #name: string;

  constructor(home: string, name: string) {
    this.#name = name;
    this.#dir = hostDir(home, name);
    fs.mkdirSync(this.#dir, { recursive: true, mode: 0o700 });
    this.#file = path.join(this.#dir, 'state.db');
  }

  #assertDir(): void {
    if (!isRealDir(this.#dir)) throw new ModRefusal('STATE', `the host state dir of ${this.#name} is not a real directory`, { name: this.#name });
  }

  #read(): Record<string, unknown> {
    this.#assertDir();
    let fd: number;
    try {
      fd = fs.openSync(this.#file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    } catch {
      return {};
    }
    try {
      const v = JSON.parse(fs.readFileSync(fd, 'utf8')) as unknown;
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
    } finally {
      fs.closeSync(fd);
    }
  }

  #key(key: unknown): string {
    if (typeof key !== 'string' || !KEY.test(key)) throw new ModRefusal('STATE', 'state key must be 1–256 chars of [A-Za-z0-9._:/-]', { name: this.#name });
    return key;
  }

  get(key: unknown): unknown {
    const k = this.#key(key);
    const all = this.#read();
    return Object.hasOwn(all, k) ? all[k] : null;
  }

  set(key: unknown, value: unknown): void {
    const k = this.#key(key);
    const text = JSON.stringify(value ?? null);
    if (text === undefined || Buffer.byteLength(text) > STATE_LIMITS.valueBytes) throw new ModRefusal('STATE', `state value exceeds ${STATE_LIMITS.valueBytes} bytes`, { name: this.#name });
    const all = this.#read();
    if (value === null || value === undefined) delete all[k];
    else all[k] = JSON.parse(text) as unknown;
    const out = JSON.stringify(all);
    if (Buffer.byteLength(out) > STATE_LIMITS.totalBytes) throw new ModRefusal('STATE', `state store would exceed ${STATE_LIMITS.totalBytes} bytes`, { name: this.#name });
    const tmp = path.join(this.#dir, `.state.${randomBytes(16).toString('hex')}.tmp`);
    const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try {
      fs.writeFileSync(fd, out);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.#file);
  }
}
