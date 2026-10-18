/**
 * @symbol #mod-host
 *
 * Per-mod KV for `state.get` / `state.set` (spec §12.3), owned by the host and
 * stored under `<home>/mods/<name>/state/`, the one directory the `mod` profile
 * lets a write-declaring mod touch. Size-capped: key ≤ 256 chars of
 * [A-Za-z0-9._:/-], value ≤ 64 KiB of JSON, the whole store ≤ 1 MiB.
 * Written atomically (tmp + rename, 0600). A store the host cannot parse
 * reads as empty and is replaced on the next set (it is the mod's own data).
 * DEVIATION (slice 1, stated): §12.3 names `state.db`; Node's `node:sqlite`
 * lands with slice 2 — the file here is `state/kv.json`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { modDir } from '../manifest/snapshot.js';
import { ModRefusal } from './refusal.js';

export const STATE_LIMITS = Object.freeze({ keyChars: 256, valueBytes: 64 * 1024, totalBytes: 1024 * 1024 });
const KEY = /^[A-Za-z0-9._:/-]{1,256}$/;

export function stateDir(home: string, name: string): string {
  return path.join(modDir(home, name), 'state');
}
export function blobsDir(home: string, name: string): string {
  return path.join(modDir(home, name), 'blobs');
}

export class ModState {
  readonly #file: string;
  readonly #name: string;

  constructor(home: string, name: string) {
    this.#name = name;
    const dir = stateDir(home, name);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.#file = path.join(dir, 'kv.json');
  }

  #read(): Record<string, unknown> {
    try {
      const v = JSON.parse(fs.readFileSync(this.#file, 'utf8')) as unknown;
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
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
    const tmp = `${this.#file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, out, { mode: 0o600 });
    fs.renameSync(tmp, this.#file);
  }
}
