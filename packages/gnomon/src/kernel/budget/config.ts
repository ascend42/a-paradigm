/**
 * @symbol #budget-fuse
 *
 * #budget-fuse configuration (spec §3.4 "The fuse — four dimensions", S16-6,
 * G-LAW-01b). Defaults are ON. They are tunable ONLY by a root-signed config
 * in the home the daemon reads; no env var, project file or CLI flag changes
 * them — this module takes no env and no argv at all. An unsigned, badly
 * signed or unparseable config is NOT applied (defaults stand,
 * `config.unsigned`); a root-signed config with an invalid value makes the
 * fuse corrupt, and a corrupt fuse denies (B5). A `fuse`/`budget`/
 * `strictness`/`review` key in `.gnomon/project.yaml` is ignored and logged
 * `config.ignored{field, source:'project.yaml'}`.
 *
 * The founder-interactive share of a subscription window is FIXED at 30 %
 * until the window shape is learned (OPEN 6): not a config value.
 *
 * Wire form: `<home>/config.signed.json` = `{row: {schemaVersion:
 * 'gnomon-root-config:v1', config: {fuse: …}}, signer, sig}` (the JSON
 * subset of the spec's root-signed `config.yaml`; the kernel has no YAML
 * parser, zero deps).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { canonicalJson, hex, sha256 } from '@a-company/gnomon-contracts';
import type { RootAuthority } from '../identity/root-authority.js';

export const ROOT_CONFIG_FILE = 'config.signed.json';
export const ROOT_CONFIG_SCHEMA = 'gnomon-root-config:v1' as const;
/** The highest root-config `version` this home has applied (rollback refusal). */
export const CONFIG_SEEN_FILE = 'config.seen.json';
/** OPEN 6: fixed until the window shape is learned. */
export const HUMAN_RESERVE = 0.3;

export type ScopeName = 'user' | 'repo' | 'loop' | 'session';

export interface FuseConfig {
  tokens: Record<ScopeName, number>;
  usd: Record<ScopeName, number>;
  /** concurrent session.spawn permits per scope */
  concurrent: Record<ScopeName, number>;
  compute: { concurrentLocalPerMachine: number; cpuSecondsPerHour: number; wallSecondsPerLocalTurn: number };
  subscription: { windowMs: number; windowTokens: number };
  breakerMs: number;
}

export const DEFAULT_FUSE: FuseConfig = Object.freeze({
  tokens: { user: 5_000_000, repo: 2_000_000, loop: 1_000_000, session: 400_000 },
  usd: { user: 50, repo: 20, loop: 10, session: 4 },
  concurrent: { user: 4, repo: 4, loop: 2, session: 1 },
  compute: { concurrentLocalPerMachine: 2, cpuSecondsPerHour: 3_600, wallSecondsPerLocalTurn: 600 },
  subscription: { windowMs: 5 * 60 * 60_000, windowTokens: 2_000_000 },
  breakerMs: 60 * 60_000,
}) as FuseConfig;

export type ConfigEvent = (kind: 'config.loaded' | 'config.unsigned' | 'config.ignored', payload: Record<string, unknown>) => void;

export interface LoadedFuseConfig {
  config: FuseConfig;
  signed: boolean;
  /** a root-signed config with an invalid value: the fuse denies (B5) */
  corrupt: boolean;
  hash: string | null;
}

const SCOPES: ScopeName[] = ['user', 'repo', 'loop', 'session'];

function positive(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/** Merge a signed fuse section over the defaults; returns null on any invalid value. */
export function mergeFuse(section: unknown): FuseConfig | null {
  if (section === undefined) return structuredClone(DEFAULT_FUSE);
  if (section === null || typeof section !== 'object' || Array.isArray(section)) return null;
  const s = section as Record<string, unknown>;
  const out = structuredClone(DEFAULT_FUSE);
  const known = new Set(['tokens', 'usd', 'concurrent', 'compute', 'subscription', 'breakerMs']);
  if (Object.keys(s).some((k) => !known.has(k))) return null;
  for (const dim of ['tokens', 'usd', 'concurrent'] as const) {
    const d = s[dim];
    if (d === undefined) continue;
    if (d === null || typeof d !== 'object') return null;
    for (const [k, v] of Object.entries(d)) {
      if (!SCOPES.includes(k as ScopeName) || !positive(v)) return null;
      out[dim][k as ScopeName] = v;
    }
  }
  for (const grp of ['compute', 'subscription'] as const) {
    const d = s[grp];
    if (d === undefined) continue;
    if (d === null || typeof d !== 'object') return null;
    for (const [k, v] of Object.entries(d)) {
      if (!(k in out[grp]) || !positive(v)) return null; // humanReserve is not a key: fixed (OPEN 6)
      (out[grp] as Record<string, number>)[k] = v;
    }
  }
  if (s.breakerMs !== undefined) {
    if (!positive(s.breakerMs)) return null;
    out.breakerMs = s.breakerMs;
  }
  return out;
}

/** Load the fuse config of `home`: only a row signed by `root` is applied. */
/**
 * Load the fuse config of `home`: only a row signed by `root` is applied.
 * ROLLBACK (Aegis N2): the high-water version is the max of the sidecar and
 * `chainHighWater` (the last signed `config.loaded{version}` on the
 * hash-chained log, which a sidecar edit cannot rewind). Once it is > 0 a
 * missing, unsigned or older config makes the fuse corrupt (deny), never the
 * looser defaults. Every config.loaded row carries version + hash.
 */
export function loadFuseConfig(home: string, root: RootAuthority, emit: ConfigEvent = () => undefined, opts: { chainHighWater?: number } = {}): LoadedFuseConfig {
  const file = path.join(home, ROOT_CONFIG_FILE);
  const seenFile = path.join(home, CONFIG_SEEN_FILE);
  let sidecar = 0;
  try {
    sidecar = Number((JSON.parse(fs.readFileSync(seenFile, 'utf8')) as { version?: unknown }).version ?? 0) || 0;
  } catch {
    sidecar = 0;
  }
  const chain = opts.chainHighWater ?? 0;
  const seen = Math.max(sidecar, chain);
  const rollback = (why: string, hash: string | null, version: unknown): LoadedFuseConfig => {
    emit('config.loaded', { hash, signed: false, corrupt: true, version: typeof version === 'number' ? version : null, highWater: seen, why, ...(sidecar !== chain && opts.chainHighWater !== undefined ? { sidecar, chain } : {}) });
    return { config: structuredClone(DEFAULT_FUSE), signed: false, corrupt: true, hash };
  };
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    if (seen > 0) return rollback('missing', null, null);
    return { config: structuredClone(DEFAULT_FUSE), signed: false, corrupt: false, hash: null };
  }
  let doc: { row?: { schemaVersion?: unknown; config?: { fuse?: unknown } }; signer?: unknown; sig?: unknown };
  try {
    doc = JSON.parse(raw) as typeof doc;
  } catch {
    if (seen > 0) return rollback('unparseable', null, null);
    emit('config.unsigned', { file: ROOT_CONFIG_FILE, why: 'unparseable' });
    return { config: structuredClone(DEFAULT_FUSE), signed: false, corrupt: false, hash: null };
  }
  const ok = doc?.row?.schemaVersion === ROOT_CONFIG_SCHEMA && typeof doc.signer === 'string' && typeof doc.sig === 'string' && root.verifyRow(doc.signer, doc.row, doc.sig);
  if (!ok) {
    if (seen > 0) return rollback('unsigned', null, null);
    emit('config.unsigned', { file: ROOT_CONFIG_FILE, why: 'signature' });
    return { config: structuredClone(DEFAULT_FUSE), signed: false, corrupt: false, hash: null };
  }
  const hash = `sha256:${hex(sha256(canonicalJson(doc.row)))}`;
  // version counter (Aegis C7): a signed config older than the newest one this home has applied is a rollback ⇒ corrupt (deny)
  const version = (doc.row as { version?: unknown }).version ?? 0;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0 || version < seen) return rollback('older', hash, version);
  if (version > sidecar) fs.writeFileSync(seenFile, `${JSON.stringify({ version })}\n`, { mode: 0o600 });
  const merged = mergeFuse(doc.row!.config?.fuse);
  emit('config.loaded', { hash, signed: true, version, highWater: seen, ...(merged ? {} : { corrupt: true }) });
  return merged ? { config: merged, signed: true, corrupt: false, hash } : { config: structuredClone(DEFAULT_FUSE), signed: true, corrupt: true, hash };
}

/** Write a root-signed config (the `gnomon config` root act; tests). Throws RootUnavailableError without a root. */
export function writeSignedConfig(home: string, root: RootAuthority, config: Record<string, unknown>, version = 0): void {
  const row = { schemaVersion: ROOT_CONFIG_SCHEMA, version, config };
  const { signer, sig } = root.signRow(row);
  fs.writeFileSync(path.join(home, ROOT_CONFIG_FILE), `${JSON.stringify({ row, signer, sig })}\n`, { mode: 0o600 });
}

/** Keys of `.gnomon/project.yaml` the fuse and strictness never read (logged, ignored). */
export const PROJECT_IGNORED_KEYS = Object.freeze(['fuse', 'budget', 'strictness', 'review']);

export function ignoredProjectKeys(repoRoot: string, emit: ConfigEvent = () => undefined): string[] {
  let text: string;
  try {
    text = fs.readFileSync(path.join(repoRoot, '.gnomon', 'project.yaml'), 'utf8');
  } catch {
    return [];
  }
  const found = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z_][\w-]*)\s*:/.exec(line);
    if (m && PROJECT_IGNORED_KEYS.includes(m[1]!)) found.add(m[1]!);
  }
  for (const field of found) emit('config.ignored', { field, source: 'project.yaml' });
  return [...found];
}
