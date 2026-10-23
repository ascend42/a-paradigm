/**
 * @symbol #local-runner
 * @symbol ^subscription-only
 *
 * The local lane's configuration (spec §13.1 `local.yaml`, §3.3 argv). The
 * kernel validates it on EVERY local open, fail closed:
 *   - an endpoint outside loopback/LAN (kernel/local/endpoint.ts) refuses the
 *     whole lane BILLING_REFUSED (G-SUB-06: a poisoned config is not "use the
 *     other endpoints");
 *   - a compat profile outside the local allowlist refuses BILLING_REFUSED
 *     too (cloud providers are not in the build, §13.1);
 *   - the runner command is the gnomon-local executable: a command or
 *     argument whose basename is `claude` is refused PERMIT_REQUIRED — law 7
 *     never lets `claude` run under a backend:'local' permit (S8's mirror).
 *
 * ROOT-SIGNED (slice 2): the lane config is `<home>/local.signed.json` =
 * `{row: {schemaVersion: 'gnomon-root-local:v1', version, local: {…}},
 * signer, sig}` — the JSON subset of the spec's root-signed `local.yaml`
 * (zero deps), the same envelope as the meter's config.signed.json. Only a
 * row the root verifies is applied (loadLocalConfig); unsigned, badly
 * signed, unparseable, structurally invalid or older than the high-water
 * mark (sidecar `local.seen.json` and the last signed config.loaded{file}
 * row on the chain) ⇒ NO local config: model:local raises a fallback card,
 * model:any goes to Claude. Never a weaker config, always logged
 * (config.unsigned / config.loaded{file, fallback:'none'}). A structurally
 * valid config naming a public endpoint or a cloud compat is APPLIED and
 * then refuses every local open BILLING_REFUSED (G-SUB-06 is per open, so a
 * poisoned config is visible, not silently dropped). The runner is
 * root-signed (§2.4: backend binaries come from root-signed config) and its
 * pin is MANDATORY (round 2, Aegis H1): node + nodeSha256, the package dir +
 * treeSha256 and the entry; the kernel execs only a verified copy under
 * `<home>/runners/` (runner-pin.ts). An unpinned runner makes the whole
 * config invalid (no local config, logged). No env var,
 * project file or CLI flag names an endpoint or the runner.
 * The per-session file the kernel hands the child is written as JSON (the
 * JSON subset of YAML 1.2).
 */
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { canonicalJson, hex, refuse, RefusedError, sha256 } from '@a-company/gnomon-contracts';
import { classifyEndpoint, loopbackPort, type EndpointVerdict } from './endpoint.js';
import type { RootAuthority } from '../identity/root-authority.js';
import type { LocalRunnerPin } from './runner-pin.js';

/** The local transports the child's compat allowlist names (no cloud provider; parity-tested against gnomon-local). */
export const LOCAL_COMPAT_NAMES = Object.freeze(['llama.cpp', 'ollama', 'lm-studio', 'vllm', 'mlx-lm']);

export type ToolSurface = 'none' | 'compact' | 'full';

export interface LocalEndpointConfig {
  id: string;
  base: string;
  /** the model id to request (the probe's /v1/models id wins when present) */
  model: string;
  compat: string;
  surface?: ToolSurface;
  /** opt this model into the text-tool fallback when the probe finds no native tool calls (§13.1) */
  textTools?: boolean;
  /** loops step 8 (Aegis): unattended loop steps may use this endpoint (opt-in; absent ⇒ never for loops) */
  loops?: boolean;
}

export interface LocalRunnerCommand {
  /** absolute path of the executable (node, or a gnomon-local binary) */
  command: string;
  /** leading args (e.g. the gnomon-local dist/cli.js) */
  args?: string[];
}

export interface LocalLaneConfig {
  endpoints: LocalEndpointConfig[];
  /** the gnomon-local runner; absent ⇒ the lane can route and raise fallback cards but never spawns */
  runner?: LocalRunnerPin;
  /** the task floor for n_ctx (§13.3 "ctx ≥ task floor"; default 8192, the ~8k working target) */
  ctxFloor?: number;
  maxSteps?: number;
  maxTokens?: number;
  /** the child's compaction working target in tokens (default 8192, §13.1 ~8k; never above the endpoint's n_ctx) */
  contextTarget?: number;
}

export const DEFAULT_CTX_FLOOR = 8192;
export const DEFAULT_CONTEXT_TARGET = 8192;

function refused(code: 'BILLING_REFUSED' | 'PERMIT_REQUIRED', message: string, data: Record<string, unknown>): RefusedError {
  return new RefusedError(refuse({ code, data }), `#local-runner: ${message}`);
}

/** Validate every endpoint (G-SUB-06) and the compat names; returns the classified endpoints. */
export function validateLocalEndpoints(cfg: LocalLaneConfig, forbiddenPorts: readonly number[]): Array<{ ep: LocalEndpointConfig; v: Extract<EndpointVerdict, { ok: true }> }> {
  const out: Array<{ ep: LocalEndpointConfig; v: Extract<EndpointVerdict, { ok: true }> }> = [];
  for (const ep of cfg.endpoints) {
    const v = classifyEndpoint(ep.base, forbiddenPorts);
    if (!v.ok) throw refused('BILLING_REFUSED', `local endpoint ${ep.id} refused: ${v.why} (loopback/LAN only, law 7)`, { dimension: 'local-endpoint', endpoint: ep.id, why: v.why });
    if (!LOCAL_COMPAT_NAMES.includes(ep.compat)) throw refused('BILLING_REFUSED', `compat ${String(ep.compat).slice(0, 32)} is not a local transport`, { dimension: 'local-compat', endpoint: ep.id, why: 'compat' });
    // Aegis L3 (TD-2026-10-22-769): 8.0 serves loopback endpoints only, whoever signed the config; LAN lands in 8.1
    if (loopbackPort(v.base) === null) throw refused('BILLING_REFUSED', `local endpoint ${ep.id} is not on this machine: loopback only in 8.0; LAN endpoints land in 8.1`, { dimension: 'local-endpoint', endpoint: ep.id, why: 'lan-8.1' });
    out.push({ ep, v });
  }
  return out;
}

const CLAUDE_NAME = /^claude(\.exe|\.cmd|\.js|\.mjs)?$/i;

const real = (p: string): string => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};

/**
 * Law 7 / S8 mirror: the local runner is never `claude` — by command or any argument, checked on the path AS
 * GIVEN and on its REALPATH (a symlink named gnomon-local pointing at claude is refused), and any path with an
 * `@anthropic-ai/claude-code` segment (Aegis L3). The positive pin is runner-pin.ts (round 2, mandatory).
 */
export function assertNotClaude(r: LocalRunnerCommand): void {
  for (const p of [r.command, ...(r.args ?? [])].flatMap((x) => [x, real(x)])) {
    if (CLAUDE_NAME.test(path.basename(p)) || /(^|[\\/])claude-[0-9a-f]{16,}$/i.test(p) || /(^|[\\/])@anthropic-ai[\\/]claude-code([\\/]|$)/i.test(p) || /(^|[\\/])claude[\\/]versions([\\/]|$)/i.test(p)) {
      throw refused('PERMIT_REQUIRED', 'claude never runs under a backend:local permit (law 7, S8)', { why: 'claude-under-local-permit' });
    }
  }
  if (!path.isAbsolute(r.command)) throw refused('PERMIT_REQUIRED', 'the local runner is resolved by absolute path, never PATH', { why: 'runner-not-absolute' });
}


export const LOCAL_CONFIG_FILE = 'local.signed.json';
export const LOCAL_CONFIG_SCHEMA = 'gnomon-root-local:v1' as const;
/** The highest local-config `version` this home has applied (rollback detection). */
export const LOCAL_SEEN_FILE = 'local.seen.json';
const MAX_ENDPOINTS = 16;
/** An endpoint id (also the loop node's model.profile). */
export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SURFACES: readonly string[] = ['none', 'compact', 'full'];

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const onlyKeys = (o: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(o).every((k) => keys.includes(k));
const posInt = (v: unknown, max: number): boolean => Number.isInteger(v) && (v as number) > 0 && (v as number) <= max;
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

/**
 * Structural validation of a signed `local` section; null on any unknown key or bad type. Endpoint
 * CLASSIFICATION and compat names are not checked here: validateLocalEndpoints refuses them per open (G-SUB-06).
 */
export function parseLocalLaneConfig(raw: unknown): LocalLaneConfig | null {
  if (!isObj(raw) || !onlyKeys(raw, ['endpoints', 'runner', 'ctxFloor', 'maxSteps', 'maxTokens', 'contextTarget'])) return null;
  if (!Array.isArray(raw.endpoints) || raw.endpoints.length > MAX_ENDPOINTS) return null;
  const endpoints: LocalEndpointConfig[] = [];
  const ids = new Set<string>();
  for (const e of raw.endpoints as unknown[]) {
    if (!isObj(e) || !onlyKeys(e, ['id', 'base', 'model', 'compat', 'surface', 'textTools', 'loops'])) return null;
    if (!str(e.id, 64) || !ID_RE.test(e.id) || ids.has(e.id) || !str(e.base, 2048) || !str(e.model, 128) || !str(e.compat, 32)) return null;
    if (e.surface !== undefined && (typeof e.surface !== 'string' || !SURFACES.includes(e.surface))) return null;
    if (e.textTools !== undefined && typeof e.textTools !== 'boolean') return null;
    if (e.loops !== undefined && typeof e.loops !== 'boolean') return null;
    ids.add(e.id);
    endpoints.push({ id: e.id, base: e.base, model: e.model, compat: e.compat, ...(e.surface !== undefined ? { surface: e.surface as ToolSurface } : {}), ...(e.textTools !== undefined ? { textTools: e.textTools } : {}), ...(e.loops === true ? { loops: true } : {}) });
  }
  let runner: LocalRunnerPin | undefined;
  if (raw.runner !== undefined) {
    // round 2 (Aegis H1): every pin field is mandatory — an unpinned runner is an invalid config
    const r = raw.runner;
    const hex64 = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v);
    if (!isObj(r) || !onlyKeys(r, ['node', 'nodeSha256', 'dir', 'treeSha256', 'entry'])) return null;
    if (!str(r.node, 4096) || !path.isAbsolute(r.node) || !str(r.dir, 4096) || !path.isAbsolute(r.dir) || !hex64(r.nodeSha256) || !hex64(r.treeSha256)) return null;
    if (!str(r.entry, 512) || r.entry.startsWith('/') || /^[A-Za-z]:/.test(r.entry) || r.entry.split(/[\\/]/).some((c) => c === '..' || c === '')) return null;
    runner = { node: r.node, nodeSha256: r.nodeSha256.toLowerCase(), dir: r.dir, treeSha256: r.treeSha256.toLowerCase(), entry: r.entry };
  }
  for (const [k, max] of [['ctxFloor', 1 << 21], ['maxSteps', 128], ['maxTokens', 32768], ['contextTarget', 131072]] as const) {
    if (raw[k] !== undefined && !posInt(raw[k], max)) return null;
  }
  // round 3 (reviewer): a reply budget at or over 0.85 × the compaction target leaves no room for history
  if (((raw.maxTokens as number | undefined) ?? 1024) >= 0.85 * ((raw.contextTarget as number | undefined) ?? 8192)) return null;
  return {
    endpoints,
    ...(runner ? { runner } : {}),
    ...(raw.ctxFloor !== undefined ? { ctxFloor: raw.ctxFloor as number } : {}),
    ...(raw.maxSteps !== undefined ? { maxSteps: raw.maxSteps as number } : {}),
    ...(raw.maxTokens !== undefined ? { maxTokens: raw.maxTokens as number } : {}),
    ...(raw.contextTarget !== undefined ? { contextTarget: raw.contextTarget as number } : {}),
  };
}

export type LocalConfigEvent = (kind: 'config.loaded' | 'config.unsigned', payload: Record<string, unknown>) => void;

export interface LoadedLocalConfig {
  /** undefined ⇒ no local lane config (fallback cards / Claude for any) */
  config: LocalLaneConfig | undefined;
  signed: boolean;
  fellBack: boolean;
  hash: string | null;
  version: number | null;
  /** the applied row's signer key id and its createdAt (a card-signed row carries one; a dev-local row none) */
  signer?: string;
  signedAt?: string | null;
}

/**
 * Load `<home>/local.signed.json`: only a row signed by `root` is applied; anything else is NO config, logged.
 * `opts.missing: 'removed'` (the human's request.local.config{op:'remove'}) logs the missing file as
 * config.loaded{fallback:'none', why:'removed'} even on a home that never applied a version.
 */
export function loadLocalConfig(home: string, root: Pick<RootAuthority, 'verifyRow'>, emit: LocalConfigEvent = () => undefined, opts: { chainHighWater?: number; chainRemoved?: number; missing?: 'removed'; removedVersion?: number } = {}): LoadedLocalConfig {
  const file = path.join(home, LOCAL_CONFIG_FILE);
  const seenFile = path.join(home, LOCAL_SEEN_FILE);
  let sidecar = 0;
  let tombstone = -1;
  try {
    const j = JSON.parse(fs.readFileSync(seenFile, 'utf8')) as { version?: unknown; removed?: unknown };
    sidecar = Number(j.version ?? 0) || 0;
    if (j.removed === true) tombstone = sidecar;
  } catch {
    sidecar = 0;
  }
  const seen = Math.max(sidecar, opts.chainHighWater ?? 0);
  // Aegis M3: a removed config's version is a floor no file may equal (the tombstone sidecar and the chain's removed rows)
  const removedFloor = Math.max(tombstone, opts.chainRemoved ?? -1);
  const none = (signed: boolean, hash: string | null, version: number | null): LoadedLocalConfig => ({ config: undefined, signed, fellBack: true, hash, version });
  const fallBack = (why: string, hash: string | null, version: unknown, signed = false): LoadedLocalConfig => {
    emit('config.loaded', { file: LOCAL_CONFIG_FILE, hash, signed, fallback: 'none', version: typeof version === 'number' ? version : null, highWater: seen, why });
    return none(signed, hash, typeof version === 'number' ? version : null);
  };
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    if (opts.missing === 'removed') {
      emit('config.loaded', { file: LOCAL_CONFIG_FILE, hash: null, signed: false, removed: true, fallback: 'none', version: opts.removedVersion ?? seen, highWater: seen, why: 'removed' });
      return none(false, null, null);
    }
    if (seen > 0) return fallBack('missing', null, null);
    return { config: undefined, signed: false, fellBack: false, hash: null, version: null };
  }
  let doc: { row?: { schemaVersion?: unknown; version?: unknown; local?: unknown }; signer?: unknown; sig?: unknown };
  try {
    doc = JSON.parse(text) as typeof doc;
  } catch {
    if (seen > 0) return fallBack('unparseable', null, null);
    emit('config.unsigned', { file: LOCAL_CONFIG_FILE, why: 'unparseable' });
    return none(false, null, null);
  }
  const ok = isObj(doc) && isObj(doc.row) && doc.row.schemaVersion === LOCAL_CONFIG_SCHEMA && typeof doc.signer === 'string' && typeof doc.sig === 'string' && root.verifyRow(doc.signer, doc.row, doc.sig);
  if (!ok) {
    if (seen > 0) return fallBack('unsigned', null, null);
    emit('config.unsigned', { file: LOCAL_CONFIG_FILE, why: 'signature' });
    return none(false, null, null);
  }
  const hash = `sha256:${hex(sha256(canonicalJson(doc.row)))}`;
  const version = doc.row!.version ?? 0;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0 || version < seen) return fallBack('older', hash, version, true);
  if (version <= removedFloor) return fallBack('removed-older', hash, version, true);
  const config = parseLocalLaneConfig(doc.row!.local);
  if (!config) return fallBack('invalid', hash, version, true);
  if (version > sidecar) {
    try {
      writeHomeFileAtomic(home, LOCAL_SEEN_FILE, `${JSON.stringify({ version })}\n`);
    } catch (err) {
      emit('config.loaded', { file: LOCAL_CONFIG_FILE, hash, signed: true, version, sidecarWrite: 'failed', error: err instanceof Error ? err.message.slice(0, 200) : 'write failed' });
    }
  }
  emit('config.loaded', { file: LOCAL_CONFIG_FILE, hash, signed: true, version, highWater: seen, endpoints: config.endpoints.map((e) => e.id), runner: config.runner ? { node: config.runner.node, dir: config.runner.dir, treeSha256: config.runner.treeSha256 } : null });
  const createdAt = (doc.row as { createdAt?: unknown }).createdAt;
  return { config, signed: true, fellBack: false, hash, version, signer: doc.signer as string, signedAt: typeof createdAt === 'string' ? createdAt.slice(0, 40) : null };
}

/**
 * THE one writer of `<home>/local.signed.json` (TD-2026-10-22-769): `{row, signer, sig}` written to a private temp
 * file (0600, exclusive create), fsynced, then renamed over the target. A target that is a symlink (or anything but a
 * regular file) is refused, never followed or replaced. Used by the root act of `gnomon dev local`, the allow effect
 * of a real home's local.config card (config-request.ts) and tests.
 */
export function writeLocalConfigDoc(home: string, doc: { row: Record<string, unknown>; signer: string; sig: string }): void {
  writeHomeFileAtomic(home, LOCAL_CONFIG_FILE, `${JSON.stringify(doc)}\n`);
}

/**
 * Write `<home>/<name>` (local.signed.json, local.seen.json): a private temp file (0600, exclusive create), fsynced,
 * renamed over the target. A target that is a symlink or anything but a regular file is refused, never followed.
 */
export function writeHomeFileAtomic(home: string, name: string, text: string): void {
  const file = path.join(home, name);
  const refuseTarget = (): void => {
    let st: fs.Stats;
    try {
      st = fs.lstatSync(file);
    } catch {
      return; // no file yet
    }
    if (!st.isFile()) throw new RefusedError(refuse({ code: 'BAD_REQUEST', data: { reason: 'bad-params', why: 'local-config-target' } }), `#local-config-request: ${name} is not a regular file (a symlink is never followed): remove it first`);
  };
  refuseTarget();
  const tmp = path.join(home, `.${name}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`);
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    refuseTarget(); // again, right before the rename
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/** Aegis M3: a remove leaves a tombstone sidecar {version, removed: true}; no file at or below that version applies again. */
export function writeLocalTombstone(home: string, version: number): void {
  writeHomeFileAtomic(home, LOCAL_SEEN_FILE, `${JSON.stringify({ version, removed: true })}\n`);
}

/** Write a root-signed local config (the dev root act; tests). Throws RootUnavailableError without a root. */
export function writeSignedLocalConfig(home: string, root: Pick<RootAuthority, 'signRow'>, local: Record<string, unknown>, version = 0): void {
  const row = { schemaVersion: LOCAL_CONFIG_SCHEMA, version, local };
  const { signer, sig } = root.signRow(row);
  writeLocalConfigDoc(home, { row, signer, sig });
}

/**
 * The chain's rollback high-water mark for local.signed.json: the highest version of a SIGNED config.loaded row
 * naming the file (kernel rows only: the caller reads the log as the kernel principal's rows).
 */
export function localChainHighWater(payloads: Iterable<unknown>): number {
  let hw = 0;
  for (const raw of payloads) {
    const p = raw as { file?: unknown; signed?: unknown; removed?: unknown; version?: unknown } | null | undefined;
    if (p?.file === LOCAL_CONFIG_FILE && (p.signed === true || p.removed === true) && typeof p.version === 'number' && Number.isInteger(p.version) && p.version > hw) hw = p.version;
  }
  return hw;
}

/** Aegis M3: the highest version a config.loaded{removed:true} row names (-1 = none): no file at or below it applies. */
export function localChainRemoved(payloads: Iterable<unknown>): number {
  let hw = -1;
  for (const raw of payloads) {
    const p = raw as { file?: unknown; removed?: unknown; version?: unknown } | null | undefined;
    if (p?.file === LOCAL_CONFIG_FILE && p.removed === true && typeof p.version === 'number' && Number.isInteger(p.version) && p.version > hw) hw = p.version;
  }
  return hw;
}

/**
 * The version the next local config takes: one above the highest of the file's row, the sidecar and the chain
 * (so the loader never refuses it as older). `previous` is that highest version, or null for a first config.
 */
export function nextLocalVersion(home: string, chainHighWater: number, verify?: Pick<RootAuthority, 'verifyRow'>): { version: number; previous: number | null } {
  const read = (f: string, pick: (j: Record<string, unknown>) => unknown): number | null => {
    try {
      const v = pick(JSON.parse(fs.readFileSync(path.join(home, f), 'utf8')) as Record<string, unknown>);
      return Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : null;
    } catch {
      return null;
    }
  };
  // Aegis L8: the file's version counts only when its signature verifies (a planted file cannot push the version up)
  const fileV = read(LOCAL_CONFIG_FILE, (j) => (isObj(j.row) && (!verify || (typeof j.signer === 'string' && typeof j.sig === 'string' && verify.verifyRow(j.signer, j.row, j.sig))) ? j.row.version : undefined));
  const seenV = read(LOCAL_SEEN_FILE, (j) => j.version);
  const known = [fileV, seenV, chainHighWater > 0 ? chainHighWater : null].filter((x): x is number => x !== null);
  if (!known.length) return { version: 1, previous: null };
  const top = Math.max(...known);
  return { version: top + 1, previous: top };
}
