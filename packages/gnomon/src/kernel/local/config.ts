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
 * poisoned config is visible, not silently dropped). The runner is a
 * root-signed absolute path (§2.4: backend binaries come from root-signed
 * config); `runner.sha256` pins its entry file (args[0] when present, else
 * the command), checked at every spawn (assertRunnerPin). No env var,
 * project file or CLI flag names an endpoint or the runner.
 * The per-session file the kernel hands the child is written as JSON (the
 * JSON subset of YAML 1.2).
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { canonicalJson, hex, refuse, RefusedError, sha256 } from '@a-company/gnomon-contracts';
import { classifyEndpoint, type EndpointVerdict } from './endpoint.js';
import type { RootAuthority } from '../identity/root-authority.js';

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
}

export interface LocalRunnerCommand {
  /** absolute path of the executable (node, or a gnomon-local binary) */
  command: string;
  /** leading args (e.g. the gnomon-local dist/cli.js) */
  args?: string[];
  /** hex sha256 of the runner's entry file (args[0] when present, else command); checked at every spawn */
  sha256?: string;
}

export interface LocalLaneConfig {
  endpoints: LocalEndpointConfig[];
  /** the gnomon-local runner; absent ⇒ the lane can route and raise fallback cards but never spawns */
  runner?: LocalRunnerCommand;
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
 * `@anthropic-ai/claude-code` segment (Aegis L3). Slice 2: a positive pin of the runner (hash, like the claude pin).
 */
export function assertNotClaude(r: LocalRunnerCommand): void {
  for (const p of [r.command, ...(r.args ?? [])].flatMap((x) => [x, real(x)])) {
    if (CLAUDE_NAME.test(path.basename(p)) || /(^|[\\/])claude-[0-9a-f]{16,}$/i.test(p) || /(^|[\\/])@anthropic-ai[\\/]claude-code([\\/]|$)/i.test(p) || /(^|[\\/])claude[\\/]versions([\\/]|$)/i.test(p)) {
      throw refused('PERMIT_REQUIRED', 'claude never runs under a backend:local permit (law 7, S8)', { why: 'claude-under-local-permit' });
    }
  }
  if (!path.isAbsolute(r.command)) throw refused('PERMIT_REQUIRED', 'the local runner is resolved by absolute path, never PATH', { why: 'runner-not-absolute' });
}

/** Law 7 / S8 mirror, positive half: a pinned runner's entry file hashes to the root-signed sha256 (realpath'd). */
export function assertRunnerPin(r: LocalRunnerCommand): void {
  if (r.sha256 === undefined) return;
  const entry = real(r.args?.[0] ?? r.command);
  let got: string | null = null;
  try {
    got = createHash('sha256').update(fs.readFileSync(entry)).digest('hex');
  } catch {
    got = null;
  }
  if (got !== r.sha256.toLowerCase()) throw refused('PERMIT_REQUIRED', 'the local runner does not match its root-signed sha256 pin', { why: 'runner-pin-mismatch' });
}

export const LOCAL_CONFIG_FILE = 'local.signed.json';
export const LOCAL_CONFIG_SCHEMA = 'gnomon-root-local:v1' as const;
/** The highest local-config `version` this home has applied (rollback detection). */
export const LOCAL_SEEN_FILE = 'local.seen.json';
const MAX_ENDPOINTS = 16;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
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
    if (!isObj(e) || !onlyKeys(e, ['id', 'base', 'model', 'compat', 'surface', 'textTools'])) return null;
    if (!str(e.id, 64) || !ID_RE.test(e.id) || ids.has(e.id) || !str(e.base, 2048) || !str(e.model, 128) || !str(e.compat, 32)) return null;
    if (e.surface !== undefined && (typeof e.surface !== 'string' || !SURFACES.includes(e.surface))) return null;
    if (e.textTools !== undefined && typeof e.textTools !== 'boolean') return null;
    ids.add(e.id);
    endpoints.push({ id: e.id, base: e.base, model: e.model, compat: e.compat, ...(e.surface !== undefined ? { surface: e.surface as ToolSurface } : {}), ...(e.textTools !== undefined ? { textTools: e.textTools } : {}) });
  }
  let runner: LocalRunnerCommand | undefined;
  if (raw.runner !== undefined) {
    const r = raw.runner;
    if (!isObj(r) || !onlyKeys(r, ['command', 'args', 'sha256']) || !str(r.command, 4096) || !path.isAbsolute(r.command)) return null;
    if (r.args !== undefined && (!Array.isArray(r.args) || r.args.length > 8 || !r.args.every((a) => str(a, 4096)))) return null;
    if (r.sha256 !== undefined && (typeof r.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(r.sha256))) return null;
    runner = { command: r.command, ...(r.args !== undefined ? { args: [...(r.args as string[])] } : {}), ...(r.sha256 !== undefined ? { sha256: r.sha256 } : {}) };
  }
  for (const [k, max] of [['ctxFloor', 1 << 21], ['maxSteps', 128], ['maxTokens', 32768], ['contextTarget', 131072]] as const) {
    if (raw[k] !== undefined && !posInt(raw[k], max)) return null;
  }
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
}

/** Load `<home>/local.signed.json`: only a row signed by `root` is applied; anything else is NO config, logged. */
export function loadLocalConfig(home: string, root: Pick<RootAuthority, 'verifyRow'>, emit: LocalConfigEvent = () => undefined, opts: { chainHighWater?: number } = {}): LoadedLocalConfig {
  const file = path.join(home, LOCAL_CONFIG_FILE);
  const seenFile = path.join(home, LOCAL_SEEN_FILE);
  let sidecar = 0;
  try {
    sidecar = Number((JSON.parse(fs.readFileSync(seenFile, 'utf8')) as { version?: unknown }).version ?? 0) || 0;
  } catch {
    sidecar = 0;
  }
  const seen = Math.max(sidecar, opts.chainHighWater ?? 0);
  const none = (signed: boolean, hash: string | null, version: number | null): LoadedLocalConfig => ({ config: undefined, signed, fellBack: true, hash, version });
  const fallBack = (why: string, hash: string | null, version: unknown, signed = false): LoadedLocalConfig => {
    emit('config.loaded', { file: LOCAL_CONFIG_FILE, hash, signed, fallback: 'none', version: typeof version === 'number' ? version : null, highWater: seen, why });
    return none(signed, hash, typeof version === 'number' ? version : null);
  };
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
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
  const config = parseLocalLaneConfig(doc.row!.local);
  if (!config) return fallBack('invalid', hash, version, true);
  if (version > sidecar) {
    try {
      fs.writeFileSync(seenFile, `${JSON.stringify({ version })}\n`, { mode: 0o600 });
    } catch (err) {
      emit('config.loaded', { file: LOCAL_CONFIG_FILE, hash, signed: true, version, sidecarWrite: 'failed', error: err instanceof Error ? err.message.slice(0, 200) : 'write failed' });
    }
  }
  emit('config.loaded', { file: LOCAL_CONFIG_FILE, hash, signed: true, version, highWater: seen, endpoints: config.endpoints.map((e) => e.id), runner: config.runner ? { command: config.runner.command, pinned: config.runner.sha256 !== undefined } : null });
  return { config, signed: true, fellBack: false, hash, version };
}

/** Write a root-signed local config (the root act; tests). Throws RootUnavailableError without a root. */
export function writeSignedLocalConfig(home: string, root: Pick<RootAuthority, 'signRow'>, local: Record<string, unknown>, version = 0): void {
  const row = { schemaVersion: LOCAL_CONFIG_SCHEMA, version, local };
  const { signer, sig } = root.signRow(row);
  fs.writeFileSync(path.join(home, LOCAL_CONFIG_FILE), `${JSON.stringify({ row, signer, sig })}\n`, { mode: 0o600 });
}
