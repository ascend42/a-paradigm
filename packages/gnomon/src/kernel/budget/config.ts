/**
 * @symbol #budget-fuse
 *
 * #budget-fuse configuration — a METER's display settings (spec §3.4 as
 * amended by P8-D92 "track everything, enforce nothing"). The config holds
 * only tracking/display keys: the per-scope token and USD reference amounts
 * the informational ladder rungs (50/75/90/100 %) are measured against, and
 * the subscription window's shape for the status display. Nothing here
 * denies a spend; law 7 (billing.ts) is not configurable at all.
 *
 * Tunable ONLY by a root-signed config in the home the daemon reads; no env
 * var, project file or CLI flag changes it (this module takes no env and no
 * argv). An unsigned, badly signed, unparseable, older (rollback) or invalid
 * config falls back to the defaults and is LOGGED (`config.unsigned` /
 * `config.loaded{fallback}`); it never stops tracking. Every config.loaded row
 * carries version + hash; the version high-water mark is the max of the
 * sidecar and the last signed `config.loaded{version}` on the hash-chained
 * log (Aegis N2). A `fuse`/`budget`/`strictness`/`review` key in
 * `.gnomon/project.yaml` is ignored and logged `config.ignored`.
 *
 * Wire form: `<home>/config.signed.json` = `{row: {schemaVersion:
 * 'gnomon-root-config:v1', version, config: {fuse: …}}, signer, sig}` (the
 * JSON subset of the spec's root-signed `config.yaml`; zero deps).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { canonicalJson, hex, sha256 } from '@a-company/gnomon-contracts';
import type { RootAuthority } from '../identity/root-authority.js';
import { DEFAULT_SESSION_HOOKS, SESSION_HOOKS_MODES, type SessionHooksMode } from '../../adapters/claude-code/adapter.js';

export const ROOT_CONFIG_FILE = 'config.signed.json';
export const ROOT_CONFIG_SCHEMA = 'gnomon-root-config:v1' as const;
/** The highest root-config `version` this home has applied (rollback detection). */
export const CONFIG_SEEN_FILE = 'config.seen.json';

export type ScopeName = 'user' | 'repo' | 'loop' | 'session';

export interface FuseConfig {
  /** reference amounts per scope per UTC day: the ladder rungs are fractions of these (informational) */
  tokens: Record<ScopeName, number>;
  usd: Record<ScopeName, number>;
  /** the subscription window's shape for the status display (measured, never a threshold) */
  subscription: { windowMs: number; windowTokens: number };
}

export const DEFAULT_FUSE: FuseConfig = Object.freeze({
  tokens: { user: 5_000_000, repo: 2_000_000, loop: 1_000_000, session: 400_000 },
  usd: { user: 50, repo: 20, loop: 10, session: 4 },
  subscription: { windowMs: 5 * 60 * 60_000, windowTokens: 2_000_000 },
}) as FuseConfig;

export type ConfigEvent = (kind: 'config.loaded' | 'config.unsigned' | 'config.ignored', payload: Record<string, unknown>) => void;

export interface LoadedFuseConfig {
  config: FuseConfig;
  signed: boolean;
  /** the config on disk could not be applied (unsigned after a signed one, older, invalid): defaults, logged */
  fellBack: boolean;
  hash: string | null;
  /**
   * T-2026-10-18-010 L4 / P8-D94: `config.sessions.hooks` (SESSION_HOOKS_MODES). No
   * config ever ⇒ DEFAULT_SESSION_HOOKS (`audited`). A
   * signed config that cannot be applied after one was (rollback, missing,
   * unsigned) or an invalid `sessions` section ⇒ `none` (fail closed:
   * never wider than what the founder may have chosen), logged.
   */
  sessions: { hooks: SessionHooksMode };
}

/** Parse the root config's `sessions` section; null on any unknown key or value. */
export function parseSessionsSection(section: unknown): { hooks: SessionHooksMode } | null {
  if (section === undefined) return { hooks: DEFAULT_SESSION_HOOKS };
  if (section === null || typeof section !== 'object' || Array.isArray(section)) return null;
  const s = section as Record<string, unknown>;
  if (Object.keys(s).some((k) => k !== 'hooks')) return null;
  if (s.hooks === undefined) return { hooks: DEFAULT_SESSION_HOOKS };
  return typeof s.hooks === 'string' && (SESSION_HOOKS_MODES as readonly string[]).includes(s.hooks) ? { hooks: s.hooks as SessionHooksMode } : null;
}

const SCOPES: ScopeName[] = ['user', 'repo', 'loop', 'session'];

function positive(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/** Merge a signed fuse section over the defaults; null on any unknown key or invalid value. */
export function mergeFuse(section: unknown): FuseConfig | null {
  if (section === undefined) return structuredClone(DEFAULT_FUSE);
  if (section === null || typeof section !== 'object' || Array.isArray(section)) return null;
  const s = section as Record<string, unknown>;
  const out = structuredClone(DEFAULT_FUSE);
  if (Object.keys(s).some((k) => !['tokens', 'usd', 'subscription'].includes(k))) return null;
  for (const dim of ['tokens', 'usd'] as const) {
    const d = s[dim];
    if (d === undefined) continue;
    if (d === null || typeof d !== 'object') return null;
    for (const [k, v] of Object.entries(d)) {
      if (!SCOPES.includes(k as ScopeName) || !positive(v)) return null;
      out[dim][k as ScopeName] = v;
    }
  }
  const sub = s.subscription;
  if (sub !== undefined) {
    if (sub === null || typeof sub !== 'object') return null;
    for (const [k, v] of Object.entries(sub)) {
      if (!(k in out.subscription) || !positive(v)) return null;
      (out.subscription as Record<string, number>)[k] = v;
    }
  }
  return out;
}

/** Load the meter config of `home`: only a row signed by `root` is applied; anything else falls back to defaults, logged. */
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
  // a fallback AFTER a signed config was seen ⇒ sessions `none` (fail closed); first-run defaults ⇒ DEFAULT_SESSION_HOOKS
  const defaults = (signed: boolean, hash: string | null): LoadedFuseConfig => ({ config: structuredClone(DEFAULT_FUSE), signed, fellBack: true, hash, sessions: { hooks: seen > 0 ? 'none' : DEFAULT_SESSION_HOOKS } });
  const fallBack = (why: string, hash: string | null, version: unknown): LoadedFuseConfig => {
    emit('config.loaded', { hash, signed: false, fallback: 'defaults', version: typeof version === 'number' ? version : null, highWater: seen, why, ...(opts.chainHighWater !== undefined && sidecar !== chain ? { sidecar, chain } : {}) });
    return defaults(false, hash);
  };
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    if (seen > 0) return fallBack('missing', null, null);
    return { config: structuredClone(DEFAULT_FUSE), signed: false, fellBack: false, hash: null, sessions: { hooks: DEFAULT_SESSION_HOOKS } };
  }
  let doc: { row?: { schemaVersion?: unknown; version?: unknown; config?: { fuse?: unknown; sessions?: unknown } }; signer?: unknown; sig?: unknown };
  try {
    doc = JSON.parse(raw) as typeof doc;
  } catch {
    if (seen > 0) return fallBack('unparseable', null, null);
    emit('config.unsigned', { file: ROOT_CONFIG_FILE, why: 'unparseable' });
    return defaults(false, null);
  }
  const ok = doc?.row?.schemaVersion === ROOT_CONFIG_SCHEMA && typeof doc.signer === 'string' && typeof doc.sig === 'string' && root.verifyRow(doc.signer, doc.row, doc.sig);
  if (!ok) {
    if (seen > 0) return fallBack('unsigned', null, null);
    emit('config.unsigned', { file: ROOT_CONFIG_FILE, why: 'signature' });
    return defaults(false, null);
  }
  const hash = `sha256:${hex(sha256(canonicalJson(doc.row)))}`;
  const version = doc.row!.version ?? 0;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0 || version < seen) return fallBack('older', hash, version);
  const merged = mergeFuse(doc.row!.config?.fuse);
  const sessions = parseSessionsSection(doc.row!.config?.sessions);
  if (!merged || !sessions) {
    emit('config.loaded', { hash, signed: true, version, highWater: seen, fallback: 'defaults', why: 'invalid', ...(!sessions ? { sessions: { hooks: 'none' } } : {}) });
    return { ...defaults(true, hash), sessions: { hooks: sessions?.hooks ?? 'none' } };
  }
  // only a validated config advances the high-water mark; a failed sidecar write is logged, never thrown (the chain row still carries the version)
  if (version > sidecar) {
    try {
      fs.writeFileSync(seenFile, `${JSON.stringify({ version })}\n`, { mode: 0o600 });
    } catch (err) {
      emit('config.loaded', { hash, signed: true, version, sidecarWrite: 'failed', error: err instanceof Error ? err.message.slice(0, 200) : 'write failed' });
    }
  }
  emit('config.loaded', { hash, signed: true, version, highWater: seen, sessions });
  return { config: merged, signed: true, fellBack: false, hash, sessions };
}

/** Write a root-signed config (the `gnomon config` root act; tests). Throws RootUnavailableError without a root. */
export function writeSignedConfig(home: string, root: RootAuthority, config: Record<string, unknown>, version = 0): void {
  const row = { schemaVersion: ROOT_CONFIG_SCHEMA, version, config };
  const { signer, sig } = root.signRow(row);
  fs.writeFileSync(path.join(home, ROOT_CONFIG_FILE), `${JSON.stringify({ row, signer, sig })}\n`, { mode: 0o600 });
}

/** Keys of `.gnomon/project.yaml` the meter and strictness never read (logged, ignored). */
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
