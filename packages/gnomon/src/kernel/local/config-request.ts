/**
 * @symbol #local-config-request
 * @symbol #local-runner
 * @symbol ^subscription-only
 * @symbol $local-config-flow
 *
 * A REAL home's local-model config (TD-2026-10-22-769, spec §13.1): the human's `request.local.config` raises a
 * root-class card whose `allow` writes the root-signed `<home>/local.signed.json`, then the daemon applies it hot.
 * Before this, only `gnomon dev local` (the dev root, dev homes) wrote that file, so a real home had no local lane:
 * loops with a model node refused to start and attended model:local sessions raised fallback cards.
 *
 *   validateLocalConfigInput  the ONE input check, shared with `gnomon dev local` (dev homes are loopback-only too):
 *                             model required (≤ 128), compat a local transport, the id an endpoint id, the base
 *                             through validateLocalEndpoints with the kernel's web port forbidden, then LOOPBACK ONLY
 *                             (loopbackPort; "LAN endpoints land in 8.1"); the runner dir absolute and holding
 *                             cli.js, never claude (assertNotClaude). No dir ⇒ the runner that ships with this build
 *                             (bundled-runner.ts, verified against its compiled pin).
 *   LocalConfigCards.request  {op:'set', endpoint, runner?}: pins the runner (pinOf: node + sha256, the dir + tree
 *                             hash, entry cli.js), takes the next version (above the file, the sidecar and the
 *                             chain's high-water mark) and raises ONE `grant` card, detail.action 'local.config':
 *                             root class (fresh presence AND the root key), hand-only (never voice), never standing
 *                             ('grant' is in NEVER_STANDING_KINDS), never `always`. detail.rootRows is the ONE
 *                             gnomon-root-local:v1 row the allow signs (decision-batch.ts row table `local.config`,
 *                             helper 1.9.0, refused at raise on an older helper: "update the Gnomon app").
 *                             prepare re-pins the runner and recomputes the version under the home's one in-flight
 *                             root decision; any difference refuses "the config changed while the card was open: ask
 *                             again". The effect writes the signed row atomically (0600, never through a symlink) and
 *                             calls onApplied, the daemon's hot reload.
 *                             {op:'remove'}: a narrowing, so notify-and-proceed with NO card: the file is deleted,
 *                             the reload logs config.loaded{fallback:'none', why:'removed'} and applies "no config"
 *                             (Aegis M3: a tombstone sidecar first, under the one in-flight root decision, so the
 *                             removed file never applies again and an open set card refuses "changed while open";
 *                             afterwards model:any sessions go to Claude, Aegis L9).
 * The asker is the human on a gui or device connection only (the dispatcher routes nothing else here; refused again
 * here). A dev-home file copied into a real home is not applied: its row is signed by the dev root, which the real
 * root does not verify (config.ts loadLocalConfig).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mintId, sanitizeDisplayText, type CardV1 } from '@a-company/gnomon-contracts';
import type { RaiseInput } from '../broker/broker.js';
import { beginRootDecision } from '../manifest/grant-lock.js';
import { RpcRefusal } from '../socket/rpc.js';
import { writeLocalTombstone } from './config.js';
import { assertNotClaude, DEFAULT_CTX_FLOOR, ID_RE, LOCAL_COMPAT_NAMES, LOCAL_CONFIG_FILE, LOCAL_CONFIG_SCHEMA, nextLocalVersion, validateLocalEndpoints, writeLocalConfigDoc, type LocalEndpointConfig, type LocalLaneConfig } from './config.js';
import { loopbackPort } from './endpoint.js';
import { BUNDLED_RUNNER_ENTRY, compiledLocalRunnerPin, defaultLocalRunner, nodeVersionOf, runnerVersionOf, type DefaultRunner } from './bundled-runner.js';
import type { RootAuthority } from '../identity/root-authority.js';
import { probeLocalEndpoint, type LocalCapabilities, type ProbeFetch } from './probe.js';
import { capability } from './routing.js';
import { LOCAL_ROW_MAX_ENDPOINTS } from '../identity/decision-batch.js';
import { pinOf, type LocalRunnerPin } from './runner-pin.js';

export const LOCAL_CONFIG_REQUEST = 'request.local.config' as const;
export const LOCAL_PROBE_REQUEST = 'request.local.probe' as const;
/** The default endpoint when the human names none (Ollama on this Mac). */
export const DEFAULT_LOCAL_BASE = 'http://127.0.0.1:11434';
export const DEFAULT_LOCAL_COMPAT = 'ollama';
/** A base longer than this cannot be shown on the helper's one-line dialog. */
export const MAX_LOCAL_BASE = 256;
/** A local.config card waits this long for the human (then it expires; nothing changes). */
export const LOCAL_CONFIG_CARD_TTL_MS = 24 * 3600 * 1000;
export const LAN_LATER = 'LAN endpoints are not supported yet';
export const CHANGED_WHILE_OPEN = 'the config changed while the card was open: ask again';
const WRAP = 480;

export interface LocalConfigInput {
  id?: unknown;
  base?: unknown;
  model?: unknown;
  compat?: unknown;
  loops?: unknown;
  /** an absolute runner dir holding cli.js; absent ⇒ the runner that ships with this build */
  runner?: unknown;
}

export interface ValidatedLocalConfig {
  endpoint: LocalEndpointConfig;
  runnerDir: string;
  runnerSource: 'typed' | 'bundled' | 'clone';
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const bad = (field: string, msg: string, data: Record<string, unknown> = {}): RpcRefusal => new RpcRefusal('BAD_REQUEST', 'bad-params', `#local-config-request: ${msg}`, { field, ...data });

/**
 * The ONE input check of a local-model config (a real home's card and `gnomon dev local`). Throws RpcRefusal
 * (BAD_REQUEST bad-params with data.field; ENGINE not-implemented{milestone:'8.1'} for a LAN endpoint) or the
 * kernel's own RefusedError (BILLING_REFUSED for a public endpoint, a forbidden port or a cloud compat;
 * PERMIT_REQUIRED for a claude runner).
 */
export function validateLocalConfigInput(input: unknown, o: { forbiddenPorts?: readonly number[]; defaultRunner?: () => DefaultRunner; skipRunner?: boolean } = {}): ValidatedLocalConfig {
  if (!isObj(input)) throw bad('endpoint', 'the endpoint is {model, base?, compat?, id?, loops?, runner?}');
  for (const k of Object.keys(input)) if (!['id', 'base', 'model', 'compat', 'loops', 'runner'].includes(k)) throw bad(k, `unknown field ${k.slice(0, 32)}`);
  const model = input.model;
  if (typeof model !== 'string' || model.length === 0) throw bad('model', 'a model is required (the model id the endpoint serves, e.g. qwen3.5:9b)');
  if (model.length > 128 || sanitizeDisplayText(model).text !== model) throw bad('model', 'the model id is at most 128 plain characters');
  const compat = input.compat ?? DEFAULT_LOCAL_COMPAT;
  if (typeof compat !== 'string' || !LOCAL_COMPAT_NAMES.includes(compat)) throw bad('compat', `compat must be one of ${LOCAL_COMPAT_NAMES.join(', ')} (cloud providers are not in the build)`, { why: 'compat' });
  const id = input.id ?? compat;
  if (typeof id !== 'string' || !ID_RE.test(id)) throw bad('id', 'the endpoint id is 1..64 letters, digits, dot, dash or underscore, starting with a letter or digit');
  const base0 = input.base ?? DEFAULT_LOCAL_BASE;
  if (typeof base0 !== 'string' || base0.length === 0 || base0.length > 2048) throw bad('base', 'the base is the endpoint URL, e.g. http://127.0.0.1:11434');
  if (input.loops !== undefined && typeof input.loops !== 'boolean') throw bad('loops', 'loops is true or false');
  // G-SUB-06 (BILLING_REFUSED): public, link-local, named hosts, a cloud compat and the kernel's own loopback ports;
  // 8.0 is loopback only, dev homes included (Aegis L3: validateLocalEndpoints itself refuses a LAN base, why lan-8.1)
  let v: ReturnType<typeof validateLocalEndpoints>[number];
  try {
    [v] = validateLocalEndpoints({ endpoints: [{ id, base: base0, model, compat }] }, o.forbiddenPorts ?? []) as [typeof v];
  } catch (err) {
    if ((err as { refusal?: { data?: { why?: unknown } } }).refusal?.data?.why === 'lan-8.1') throw new RpcRefusal('ENGINE', 'not-implemented', `#local-config-request: ${base0.slice(0, 120)} is a LAN endpoint: loopback only in 8.0; ${LAN_LATER}`, { field: 'base', milestone: '8.1', why: 'lan-endpoint' });
    throw err;
  }
  // Aegis L1 + info: no path in 8.0 (the probe and the child add /v1/…), and localhost is 127.0.0.1 (one spelling)
  const u = new URL(v.v.base);
  if (u.pathname !== '/' && u.pathname !== '') throw bad('base', 'the base is scheme, host and port only in 8.0 (no path): e.g. http://127.0.0.1:11434', { why: 'base-path' });
  if (/[?#]/.test(base0)) throw bad('base', 'the base takes no query or fragment', { why: 'base-path' });
  if (loopbackPort(v.v.base) === null) throw new RpcRefusal('ENGINE', 'not-implemented', `#local-config-request: ${v.v.base.slice(0, 120)} is a LAN endpoint: loopback only in 8.0; ${LAN_LATER}`, { field: 'base', milestone: '8.1', why: 'lan-endpoint' });
  const base = `${u.protocol}//${u.hostname.toLowerCase() === 'localhost' ? '127.0.0.1' : u.hostname.includes(':') && !u.hostname.startsWith('[') ? `[${u.hostname}]` : u.hostname}${u.port ? `:${u.port}` : ''}`;
  if (base.length > MAX_LOCAL_BASE) throw bad('base', `the base is at most ${MAX_LOCAL_BASE} characters`);
  const endpoint0: LocalEndpointConfig = { id, base, model, compat, ...(input.loops === true ? { loops: true } : {}) };
  if (o.skipRunner) return { endpoint: endpoint0, runnerDir: '', runnerSource: 'bundled' };
  let runnerDir: string;
  let runnerSource: ValidatedLocalConfig['runnerSource'];
  if (input.runner !== undefined) {
    const r = input.runner;
    if (typeof r !== 'string' || r.length === 0 || r.length > 1024 || !path.isAbsolute(r)) throw bad('runner', 'the runner is an absolute directory holding cli.js (never a relative path)');
    runnerDir = path.resolve(r);
    runnerSource = 'typed';
  } else {
    const d = (o.defaultRunner ?? defaultLocalRunner)();
    if (!d.ok) throw bad('runner', d.why, { why: 'no-runner' });
    runnerDir = d.dir;
    runnerSource = d.source;
  }
  let entryOk = false;
  try {
    entryOk = fs.lstatSync(path.join(runnerDir, BUNDLED_RUNNER_ENTRY)).isFile();
  } catch {
    entryOk = false;
  }
  if (!entryOk) throw bad('runner', `no gnomon-local runner (${BUNDLED_RUNNER_ENTRY}) in ${runnerDir.slice(0, 200)}`, { why: 'no-runner' });
  // law 7 / S8: never claude, by the dir or the entry, as given or by realpath
  assertNotClaude({ command: process.execPath, args: [runnerDir, path.join(runnerDir, BUNDLED_RUNNER_ENTRY)] });
  // Aegis L6: a runner that is not the bundled one must say it is gnomon-local (its package.json, or the marker in cli.js)
  if (runnerSource !== 'bundled' && !isGnomonLocal(runnerDir)) throw bad('runner', `${runnerDir.slice(0, 200)} is not a gnomon-local runner (no @a-company/gnomon-local package.json beside it and no ${RUNNER_MARKER} marker in cli.js)`, { why: 'not-gnomon-local' });
  const endpoint: LocalEndpointConfig = { id, base, model, compat, ...(input.loops === true ? { loops: true } : {}) };
  return { endpoint, runnerDir, runnerSource };
}

/** The marker gnomon-local's cli.js carries (packages/gnomon-local/src/cli.ts RUNNER_MARKER). */
export const RUNNER_MARKER = 'gnomon-local-runner:v1';

/** Is `dir` gnomon-local: an @a-company/gnomon-local package.json one level up, or the marker in its cli.js? */
export function isGnomonLocal(dir: string): boolean {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(dir, '..', 'package.json'), 'utf8')) as { name?: unknown };
    if (p.name === '@a-company/gnomon-local') return true;
  } catch {
    /* no package.json */
  }
  try {
    const st = fs.lstatSync(path.join(dir, BUNDLED_RUNNER_ENTRY));
    return st.isFile() && st.size <= 16 << 20 && fs.readFileSync(path.join(dir, BUNDLED_RUNNER_ENTRY), 'utf8').includes(RUNNER_MARKER);
  } catch {
    return false;
  }
}

/** Sanitize then wrap at 480 code points (card lines are capped at 512, card.ts MAX_LINE). */
function wrap(raw: string, indent = '    '): string[] {
  const line = sanitizeDisplayText(String(raw)).text;
  const cps = Array.from(line);
  if (cps.length <= WRAP) return [line];
  const out: string[] = [cps.slice(0, WRAP).join('')];
  for (let i = WRAP; i < cps.length; i += WRAP - indent.length) out.push(`${indent}${cps.slice(i, i + WRAP - indent.length).join('')}`);
  return out;
}

/** The server names Mika's copy uses (compat → what the human installed). */
export const COMPAT_DISPLAY: Readonly<Record<string, string>> = Object.freeze({ ollama: 'Ollama', 'lm-studio': 'LM Studio', 'llama.cpp': 'llama.cpp', vllm: 'vLLM', 'mlx-lm': 'MLX' });
const article = (name: string): string => (/^[AEIOU]/i.test(name) || /^(LM|MLX)/.test(name) ? 'an' : 'a');
const hhmm = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const mid = (h: string): string => `${h.slice(0, 8)}…${h.slice(-4)}`;

export interface CardRunner {
  pin: LocalRunnerPin;
  source: ValidatedLocalConfig['runnerSource'];
  /** the gnomon-local version when known (the bundled one's is compiled in) */
  version: string | null;
  /** the pinned node's version when it is the kernel's own node */
  nodeVersion: string | null;
}

/**
 * The card's lines (Mika, .atelier/sessions/2026-10-22-gnomon-local-model card copy): the title, the kernel line, then
 * what the decision signs, field by field (the root row itself is rendered from detail.rootRows by rootRowLine).
 */
export function localConfigCardLines(f: { endpoint: LocalEndpointConfig; others: readonly LocalEndpointConfig[]; replaced: LocalEndpointConfig | null; runner: CardRunner; version: number; previous: number | null; via: 'settings' | 'terminal'; at: number; platform: string }): string[] {
  const { endpoint: e, runner: r } = f;
  const server = COMPAT_DISPLAY[e.compat] ?? e.compat;
  const changes: string[] = [];
  if (f.replaced) {
    for (const k of ['base', 'model', 'compat'] as const) if (f.replaced[k] !== e[k]) changes.push(`${k} ${f.replaced[k]} → ${e[k]}`);
    if ((f.replaced.loops === true) !== (e.loops === true)) changes.push(`loops ${f.replaced.loops === true ? 'yes' : 'no'} → ${e.loops === true ? 'yes' : 'no'}`);
  }
  const src = r.source === 'bundled' ? 'bundled' : r.source === 'typed' ? 'the folder you named' : "this clone's build";
  return [
    f.previous === null ? 'Set up the local model' : 'Change the local model',
    `asked from ${f.via === 'settings' ? 'Settings' : 'the terminal'} · ${hhmm(f.at)} · applies at once, no restart`,
    'This decision signs:',
    f.previous === null ? `local model config v${f.version} · new` : `local model config v${f.previous} → v${f.version}`,
    `endpoint ${e.id} · ${article(server)} ${server} server at ${e.base}${f.replaced ? (changes.length ? ` · changes: ${changes.join(', ')}` : ' · no field changes (re-pins the runner)') : ''}`,
    `model ${e.model} · ${e.loops === true ? 'loops may use it' : 'sessions only'}`,
    ...f.others.map((o) => `endpoint ${o.id} · unchanged (${o.base} · ${o.model})`),
    `runner gnomon-local ${r.version ?? '(version unknown)'} · ${src} · tree ${mid(r.pin.treeSha256)} · node ${r.nodeVersion ?? 'binary'} · sha ${r.pin.nodeSha256.slice(0, 8)}…`,
    `runner folder ${r.pin.dir}/${r.pin.entry} · node ${r.pin.node}`,
    `Loopback only; ${LAN_LATER}`,
    'Allow takes the root key and your presence (Touch ID or your Mac password) · never standing, never by voice; deny or no answer changes nothing',
    ...(f.platform === 'win32' ? ['Not on Windows in 8.0: a root-class decision needs the Windows root key, which is not built (refused UNSUPPORTED); deny changes nothing'] : []),
  ].flatMap((l) => wrap(l));
}

export interface LocalAsker {
  connId: string;
  principal: string | undefined;
  principalClass: string;
  credential: string | undefined;
}

export interface LocalProbeResult {
  ok: boolean;
  /** capable | probe-failed | model-missing | no-tools | ctx-unknown | ctx-below-floor (routing.ts), plus the probe's error text */
  why: string;
  error?: string;
  toolsNative: boolean;
  contextSize: number | null;
  /** the configured model (Aegis L1: never an id the server chose) */
  model: string;
  /** does the server list that model? */
  listed: boolean;
  endpoint: { base: string; model: string; compat: string };
}

export interface LocalConfigOptions {
  home: string;
  broker: { raise(input: RaiseInput): Promise<CardV1>; card?(cardId: string): CardV1 | undefined };
  /** the kernel's web endpoint port (forbidden as a model endpoint) */
  forbiddenPorts: () => number[];
  /** the chain's high-water mark for local.signed.json (config.ts localChainHighWater over the log) */
  chainHighWater: () => number;
  /** the hot apply: reload local.signed.json and hand it to the supervisor (the daemon's reloadLocalConfig) */
  onApplied: (why: 'set' | 'removed', removedVersion?: number) => Promise<unknown> | unknown;
  /** the root: the file's version counts toward the next only when its signature verifies (Aegis L8) */
  verify?: Pick<RootAuthority, 'verifyRow'>;
  /** the tree hash compiled into this build for its bundled runner (Aegis L5; default compiledLocalRunnerPin) */
  bundledPin?: () => string | null;
  /** the applied config (a set edits ONE endpoint by id and keeps the others) */
  current?: () => LocalLaneConfig | undefined;
  defaultRunner?: () => DefaultRunner;
  /** the node that runs gnomon-local (default: the kernel's own node, the bundled one in the app) */
  node?: string;
  clock?: () => number;
  platform?: string;
  /** TEST RIG ONLY: the probe's fetch */
  probeFetch?: ProbeFetch;
  /** the check's rate limit: at most one in flight, and this long between two (default 2 s) */
  probeGapMs?: number;
  /**
   * The lane's probe state (the supervisor's LocalLane): a check of a CONFIGURED endpoint (Check again) shows as
   * status.local.probing while it runs, and its answer refreshes status.local.lastProbe and the probe cache, the same as
   * the automatic probe after a set. A check of an unsaved address records nothing there.
   */
  lane?: LocalProbeSink;
}

/** The part of LocalLane a request.local.probe of a configured endpoint reports to. */
export interface LocalProbeSink {
  configuredEndpoint(ep: { base: string; model: string; compat: string }): string | null;
  probeGen(): number;
  beginProbe(id: string): () => void;
  recordProbe(id: string, caps: LocalCapabilities, o?: { why?: string; gen?: number }): void;
}

/** The kernel half of request.local.config and request.local.probe. */
export class LocalConfigCards {
  readonly #o: LocalConfigOptions;
  #open: string | null = null;
  #probing = false;
  #lastProbeAt = -Infinity;

  constructor(o: LocalConfigOptions) {
    this.#o = o;
  }

  /** The pending card, if any (status.local.pendingCardId). */
  pendingCardId(): string | null {
    if (this.#open === null) return null;
    const c = this.#o.broker.card?.(this.#open);
    if (c && c.state !== 'pending') this.#open = null;
    return this.#open;
  }

  #human(asker: LocalAsker, kind: string): void {
    if (asker.principalClass !== 'human' || !asker.principal || (asker.credential !== 'gui' && asker.credential !== 'device')) {
      throw new RpcRefusal('FORBIDDEN', 'matrix', `${kind} is the human's, on a gui or device connection (never voice, an agent or a session)`);
    }
  }

  /**
   * request.local.probe{base?, model, compat?} (Mika C1, "no password for a typo"): the same validation as a set, then
   * the kernel asks the LOOPBACK server for its models, a tool call and its context size. Read-only: no card, no row,
   * no config. The human only; one at a time and at most one every probeGapMs.
   */
  async probe(asker: LocalAsker, payload: unknown): Promise<LocalProbeResult> {
    this.#human(asker, LOCAL_PROBE_REQUEST);
    if (!isObj(payload)) throw bad('model', `${LOCAL_PROBE_REQUEST} takes {model, base?, compat?}`);
    for (const k of Object.keys(payload)) if (!['base', 'model', 'compat'].includes(k)) throw bad(k, `unknown field ${k.slice(0, 32)}`);
    const v = validateLocalConfigInput(payload, { forbiddenPorts: this.#o.forbiddenPorts(), skipRunner: true });
    const now = (this.#o.clock ?? Date.now)();
    const gap = this.#o.probeGapMs ?? 2000;
    if (this.#probing || now - this.#lastProbeAt < gap) throw bad('base', 'a check is already running or just ran: try again in a moment', { why: 'rate-limited', retryAfterMs: Math.max(0, Math.ceil(gap - (now - this.#lastProbeAt))) });
    this.#probing = true;
    this.#lastProbeAt = now;
    const lane = this.#o.lane;
    const id = lane?.configuredEndpoint({ base: v.endpoint.base, model: v.endpoint.model, compat: v.endpoint.compat }) ?? null;
    const gen = lane?.probeGen();
    const end = id !== null ? lane!.beginProbe(id) : null;
    try {
      const caps = await probeLocalEndpoint({ id: v.endpoint.id, base: v.endpoint.base, model: v.endpoint.model }, { forbiddenPorts: this.#o.forbiddenPorts(), ...(this.#o.probeFetch ? { fetch: this.#o.probeFetch } : {}) });
      const k = capability(caps, DEFAULT_CTX_FLOOR, false);
      // Mika C1: the card is raised only when the model is there; Aegis L1: the CONFIGURED model and whether the
      // server lists it (never another id the server named), and one error word (never the server's text)
      const listed = caps.ok && caps.model === v.endpoint.model;
      const missing = caps.ok && !listed;
      if (id !== null) lane!.recordProbe(id, caps, { gen: gen!, ...(missing ? { why: 'model-missing' } : {}) });
      return { ok: k.capable && !missing, why: missing ? 'model-missing' : k.reason, ...(caps.ok ? {} : { error: 'unreachable' }), toolsNative: caps.tools, contextSize: caps.nCtx, model: v.endpoint.model, listed, endpoint: { base: v.endpoint.base, model: v.endpoint.model, compat: v.endpoint.compat } };
    } finally {
      end?.();
      this.#probing = false;
    }
  }

  async request(asker: LocalAsker, payload: unknown): Promise<unknown> {
    this.#human(asker, LOCAL_CONFIG_REQUEST);
    if (!isObj(payload)) throw bad('op', `${LOCAL_CONFIG_REQUEST} takes {op:'set', endpoint, runner?} or {op:'remove'}`);
    if (payload.op === 'remove') {
      if (Object.keys(payload).length !== 1) throw bad('op', "remove takes no other field: {op:'remove'}");
      return this.#remove();
    }
    if (payload.op !== 'set') throw bad('op', "op is 'set' or 'remove'");
    for (const k of Object.keys(payload)) if (!['op', 'endpoint', 'runner'].includes(k)) throw bad(k, `unknown field ${k.slice(0, 32)}`);
    if (!isObj(payload.endpoint)) throw bad('endpoint', 'endpoint is {model, base?, compat?, id?, loops?}');
    if ('runner' in payload.endpoint) throw bad('endpoint', 'the runner is named beside the endpoint: {op, endpoint, runner}');
    const v = validateLocalConfigInput({ ...payload.endpoint, ...(payload.runner !== undefined ? { runner: payload.runner } : {}) }, { forbiddenPorts: this.#o.forbiddenPorts(), ...(this.#o.defaultRunner ? { defaultRunner: this.#o.defaultRunner } : {}) });
    return this.#raise(asker, v);
  }

  #pin(dir: string): LocalRunnerPin {
    const pin = pinOf(dir, BUNDLED_RUNNER_ENTRY, this.#o.node ?? process.execPath);
    assertNotClaude({ command: pin.node, args: [pin.dir, path.join(pin.dir, pin.entry)] });
    return pin;
  }

  /** The endpoints a set keeps (every applied one but `id`), each checked against the 8.0 row table. */
  #others(id: string): { others: LocalEndpointConfig[]; replaced: LocalEndpointConfig | null } {
    const cur = this.#o.current?.()?.endpoints ?? [];
    const others: LocalEndpointConfig[] = [];
    let replaced: LocalEndpointConfig | null = null;
    for (const e of cur) {
      if (e.id === id) {
        replaced = e;
        continue;
      }
      if (e.surface !== undefined || e.textTools !== undefined) throw bad('endpoint', `endpoint ${e.id} carries a tool-surface setting this card cannot keep: set it from the terminal, or gnomon local remove first`, { why: 'other-endpoint' });
      if (loopbackPort(e.base) === null || e.base.length > MAX_LOCAL_BASE) throw bad('endpoint', `endpoint ${e.id} (${e.base.slice(0, 80)}) is not loopback, so a new config cannot keep it (${LAN_LATER}): gnomon local remove first`, { why: 'other-endpoint' });
      others.push({ id: e.id, base: e.base, model: e.model, compat: e.compat, ...(e.loops === true ? { loops: true } : {}) });
    }
    if (1 + others.length > LOCAL_ROW_MAX_ENDPOINTS) throw bad('endpoint', `a local config holds at most ${LOCAL_ROW_MAX_ENDPOINTS} endpoints in 8.0`, { why: 'too-many-endpoints' });
    return { others, replaced };
  }

  async #raise(asker: LocalAsker, v: ValidatedLocalConfig): Promise<unknown> {
    let pin: LocalRunnerPin;
    try {
      pin = this.#pin(v.runnerDir);
    } catch (err) {
      if (err instanceof RpcRefusal || (err as { refusal?: unknown }).refusal) throw err;
      throw bad('runner', `the runner cannot be pinned: ${err instanceof Error ? err.message.slice(0, 160) : 'unreadable'}`, { why: 'runner-pin' });
    }
    const cur = this.#o.current?.();
    if (cur && (cur.ctxFloor !== undefined || cur.maxSteps !== undefined || cur.maxTokens !== undefined || cur.contextTarget !== undefined)) throw bad('endpoint', 'the applied config carries lane limits this card cannot keep: gnomon local remove first', { why: 'lane-limits' });
    const { others, replaced } = this.#others(v.endpoint.id);
    // the endpoint keeps its place in signed order (the first capable endpoint serves): replace in place, else append
    const order = (this.#o.current?.()?.endpoints ?? []).map((e) => e.id);
    const endpoints = replaced ? order.map((id) => (id === v.endpoint.id ? v.endpoint : others.find((o) => o.id === id)!)) : [...others, v.endpoint];
    // Aegis L5: a runner called bundled IS this build's: its tree hash is the compiled pin
    if (v.runnerSource === 'bundled' && pin.treeSha256 !== (this.#o.bundledPin ?? compiledLocalRunnerPin)()) throw bad('runner', "the bundled gnomon-local runner does not match this build's pin: reinstall Gnomon", { why: 'bundled-pin' });
    const { version, previous } = nextLocalVersion(this.#o.home, this.#o.chainHighWater(), this.#o.verify);
    const cardId = mintId('card');
    const local = { endpoints, runner: { ...pin } };
    const row = { schemaVersion: LOCAL_CONFIG_SCHEMA, version, local, cardId, runnerSource: v.runnerSource === 'bundled' ? 'bundled' : 'override' };
    const now = this.#o.clock ?? Date.now;
    const runner: CardRunner = { pin, source: v.runnerSource, version: runnerVersionOf(pin.dir, v.runnerSource === 'bundled' ? pin.treeSha256 : null), nodeVersion: nodeVersionOf(pin.node) };
    const lines = localConfigCardLines({ endpoint: v.endpoint, others, replaced, runner, version, previous, via: asker.credential === 'gui' ? 'settings' : 'terminal', at: now(), platform: this.#o.platform ?? process.platform });
    const home = this.#o.home;
    this.#open = cardId;
    try {
      const card = await this.#o.broker.raise({
        kind: 'grant',
        cardId,
        requestedBy: asker.principal!,
        attended: true,
        detail: { action: 'local.config', file: LOCAL_CONFIG_FILE, version, previous, endpoint: v.endpoint.id, change: replaced ? 'edit' : previous === null ? 'new' : 'add', runnerSource: v.runnerSource, rootRows: [row] },
        lines,
        decisions: ['allow', 'deny'],
        handOnly: true,
        timeoutMs: LOCAL_CONFIG_CARD_TTL_MS,
        prepare: (decision: string) => {
          if (decision !== 'allow') return null;
          const release = beginRootDecision(home);
          try {
            // TOCTOU: the runner and the version must still be what the card shows (checked inside the one touch)
            let again: LocalRunnerPin;
            try {
              again = pinOf(pin.dir, pin.entry, pin.node);
            } catch {
              throw bad('runner', CHANGED_WHILE_OPEN, { why: 'changed' });
            }
            if (again.treeSha256 !== pin.treeSha256 || again.nodeSha256 !== pin.nodeSha256) throw bad('runner', CHANGED_WHILE_OPEN, { why: 'changed' });
            if (nextLocalVersion(home, this.#o.chainHighWater(), this.#o.verify).version !== version) throw bad('version', CHANGED_WHILE_OPEN, { why: 'changed' });
            return { rows: [{ ...row, createdAt: new Date(now()).toISOString() }], release };
          } catch (err) {
            release();
            throw err;
          }
        },
        effect: async (decision, ctx) => {
          if (this.#open === cardId) this.#open = null;
          if (decision !== 'allow') return;
          const signed = ctx.prepared?.rows[0];
          const sig = ctx.rowSigs?.[0];
          if (!signed || !sig) throw new Error('#local-config-request: a local config commits only its prepared, root-signed row');
          writeLocalConfigDoc(home, { row: signed, signer: sig.signer, sig: sig.sig });
          await this.#o.onApplied('set');
        },
      });
      return { pending: true, cardId: card.cardId, version, previous, endpoint: v.endpoint.id, change: replaced ? 'edit' : previous === null ? 'new' : 'add', unchanged: others.map((o) => o.id), runner: { dir: pin.dir, treeSha256: pin.treeSha256, source: v.runnerSource } };
    } catch (err) {
      if (this.#open === cardId) this.#open = null;
      throw err;
    }
  }

  /**
   * Aegis M3: a remove is durable and serialized. Under the home's one in-flight root decision: the tombstone sidecar
   * {version: next, removed: true} is written atomically FIRST (so an open set card's prepare sees a newer version and
   * refuses "changed while open", and the removed file can never apply again), then the file is unlinked; the reload
   * logs config.loaded{removed: true, version}.
   */
  async #remove(): Promise<unknown> {
    const home = this.#o.home;
    const file = path.join(home, LOCAL_CONFIG_FILE);
    const release = beginRootDecision(home);
    let existed = false;
    let version: number;
    try {
      version = nextLocalVersion(home, this.#o.chainHighWater(), this.#o.verify).version;
      writeLocalTombstone(home, version);
      try {
        fs.lstatSync(file);
        existed = true;
        fs.unlinkSync(file); // a symlink is removed itself, never its target
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    } finally {
      release();
    }
    await this.#o.onApplied('removed', version);
    // Aegis L9: say what changes for sessions too
    return { removed: true, existed, version, now: 'model: local sessions raise a fallback card, model: any sessions go to Claude, and loops with a model node refuse to start' };
  }
}
