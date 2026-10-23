/**
 * @symbol #gui-local-model
 *
 * #gui-local-model (TD-2026-10-22-769; Atelier session 2026-10-22-gnomon-local-model, design-system settings-form,
 * sheet section-focused, card family ⊙ gnomon). PURE: the Settings sheet's "Local model · kernel-owned" section in
 * every state, its form's checks, the requests it sends and the words of every outcome. The press paths and the
 * requests in flight are ui/local-model.ts; the DOM is ui/settings-sheet.ts.
 *
 *   - Every value row is the kernel's status.local, never the form's copy of what was typed.
 *   - Nothing that can be checked without signing waits for the card (rule no-password-for-a-typo, C1 check-first):
 *     the page checks the address and the model on Save, then the kernel's read-only request.local.probe checks the
 *     server; only an answer with the model there raises the root card (request.local.config {op:'set'}).
 *   - One request at a time: while a card waits the form is replaced by the request line ("card waiting", plain chip)
 *     with Decide in the stack (rule form-says-where-the-card-is).
 *   - Turning it off is notify-and-proceed in the kernel ({op:'remove'}, no card); the GUI asks once, inline, only
 *     when loops would stop (C2 confirm-when-used).
 */
import { sanitizeDisplayText } from '@a-company/gnomon-contracts';
import type { FieldView, FormView, ResultView, SettingRow, SettingsSection } from './settings.js';
import type { FolderFieldView } from './folder-field.js';

export const LOCAL_SECTION = 'local-model' as const;
export const LOCAL_PROBE_REQUEST = 'request.local.probe' as const;
export const LOCAL_CONFIG_REQUEST = 'request.local.config' as const;
/** The kernel's context floor for sessions (config.ts DEFAULT_CTX_FLOOR), as the copy states it. */
export const LOCAL_CTX_FLOOR = 8192;

/* ── copy (session 2026-10-22-gnomon-local-model recommended_copy) ───────────────────────────────────────────────── */

export const LOCAL_COPY = Object.freeze({
  title: 'Local model',
  owner: '· kernel-owned',
  intro: 'A model server on this Mac that sessions and loops can use instead of Claude. The kernel owns it: setting or changing it raises a root card; turning it off doesn’t.',
  terminal: 'gnomon local status | set | remove',
  none: { value: 'none set up', how: 'Loops with model steps can’t start. A session that asks for a local model raises a fallback card instead.', key: 'Set up local model…' },
  windows: { value: 'not on Windows in 8.0', how: 'Local models run on the Mac for now. On this PC loops with model steps can’t start, and a session that asks for a local model raises a fallback card.' },
  notOffered: { value: 'not offered by this kernel', how: 'Update Gnomon to set one up here. The terminal form is `gnomon local status`.' },
  notConnected: { value: 'not connected', how: 'Reconnect (⌘K, then “Reconnect”) to see and change the local model.' },
  lead: 'Point Gnomon at a model server running on this Mac.',
  leadChange: 'Changing the local model. The card shows exactly what changes.',
  addressNote: 'this Mac only in 8.0: 127.0.0.1 or localhost',
  usedOn: 'loops run their model steps on it unattended, inside their budgets',
  usedOff: 'loops with model steps won’t start; sessions you open can still use it',
  nameNote: 'what cards and logs call this endpoint',
  runnerOverride: 'use another runner (optional)',
  runnerNote: 'the folder that holds cli.js; the card pins it by its hash',
  save: 'Save · root card',
  unchanged: 'no change',
  foot: 'Nothing changes until you Allow its card in the stack. Allow takes the root key and your presence: Touch ID or your Mac password.',
  requestHow: 'Allow takes the root key and your presence. Deny keeps things as they are and brings your entries back here.',
  decide: 'Decide in the stack',
  checkingHow: 'The kernel asks the server for its models, a tool call and its context size.',
  palette: { none: 'Set up local model…', set: 'Local model settings…' },
});

/* ── servers ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

export interface LocalServer {
  compat: string;
  label: string;
  base: string;
}
/** The local transports in the kernel's order of Mika's copy, with the address each listens on by default. */
export const LOCAL_SERVERS: readonly LocalServer[] = Object.freeze([
  { compat: 'ollama', label: 'Ollama', base: 'http://127.0.0.1:11434' },
  { compat: 'lm-studio', label: 'LM Studio', base: 'http://127.0.0.1:1234' },
  { compat: 'llama.cpp', label: 'llama.cpp', base: 'http://127.0.0.1:8080' },
  { compat: 'vllm', label: 'vLLM', base: 'http://127.0.0.1:8000' },
  { compat: 'mlx-lm', label: 'MLX', base: 'http://127.0.0.1:8080' },
]);
export const serverOf = (compat: string): LocalServer => LOCAL_SERVERS.find((s) => s.compat === compat) ?? LOCAL_SERVERS[0]!;
const hostPort = (base: string): string => base.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const portOf = (base: string): string => /:(\d+)$/.exec(hostPort(base))?.[1] ?? '';
export const serverNote = (compat: string): string => `${serverOf(compat).label} listens on ${hostPort(serverOf(compat).base)} unless you changed it`;
/** How the server names its models (backticks are code). */
const listsIt = (compat: string): string => (compat === 'ollama' ? 'as `ollama list` shows it' : `as ${serverOf(compat).label} lists it`);
export const modelNote = (compat: string): string => `its name ${listsIt(compat)}`;

/* ── status.local ────────────────────────────────────────────────────────────────────────────────────────────────── */

export interface LocalEndpointView {
  id: string;
  base: string;
  model: string;
  compat: string;
  loops: boolean;
}
export interface LocalProbeView {
  /** the endpoint id it checked (status.local.lastProbe.endpoint) */
  endpoint?: string;
  at: string;
  ok: boolean;
  why: string;
  error?: string;
  tools: boolean;
  contextSize: number | null;
}
export interface LocalStatusView {
  state: 'not-connected' | 'not-offered' | 'windows' | 'none' | 'set';
  endpoints: LocalEndpointView[];
  version: number | null;
  signedAt: string | null;
  signer: string | null;
  runner: { dir: string; entry: string; node: string; nodeSha256: string; treeSha256: string; version: string | null; source: string } | null;
  bundled: { dir: string; version: string | null } | null;
  lastProbe: LocalProbeView | null;
  /** status.local.probing: a probe of a configured endpoint in flight (the automatic one after a set, or Check again) */
  probing: { since: string; endpoint?: string } | null;
  lastFallback: { at: string; cwd: string; title: string | null; reason: string } | null;
  pendingCardId: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** status.local as the section reads it; the GUI never guesses the platform or a config it was not told. */
export function localStatusOf(status: unknown): LocalStatusView {
  const empty: LocalStatusView = { state: 'not-connected', endpoints: [], version: null, signedAt: null, signer: null, runner: null, bundled: null, lastProbe: null, probing: null, lastFallback: null, pendingCardId: null };
  if (!isObj(status)) return empty;
  const l = isObj(status.local) ? status.local : null;
  if (!l || l.offered !== true) return { ...empty, state: 'not-offered' };
  const endpoints = (Array.isArray(l.endpoints) ? l.endpoints : []).filter(isObj).flatMap((e): LocalEndpointView[] => (str(e.id) && str(e.base) && str(e.model) && str(e.compat) ? [{ id: e.id as string, base: e.base as string, model: e.model as string, compat: e.compat as string, loops: e.loops === true }] : []));
  const r = isObj(l.runner) ? l.runner : null;
  const d = isObj(l.defaultRunner) ? l.defaultRunner : null;
  const p = isObj(l.lastProbe) ? l.lastProbe : null;
  const f = isObj(l.lastFallback) ? l.lastFallback : null;
  return {
    state: l.unsupported === 'platform' ? 'windows' : endpoints.length ? 'set' : 'none',
    endpoints,
    version: typeof l.version === 'number' ? l.version : null,
    signedAt: str(l.signedAt),
    signer: str(l.signer),
    runner: r && str(r.dir) && str(r.treeSha256) ? { dir: r.dir as string, entry: str(r.entry) ?? 'cli.js', node: str(r.node) ?? '', nodeSha256: str(r.nodeSha256) ?? '', treeSha256: r.treeSha256 as string, version: str(r.version), source: str(r.source) ?? 'override' } : null,
    bundled: d && d.source === 'bundled' && str(d.dir) ? { dir: d.dir as string, version: str(d.version) } : null,
    lastProbe: p && str(p.at) ? { ...(str(p.endpoint) ? { endpoint: p.endpoint as string } : {}), at: p.at as string, ok: p.ok === true, why: str(p.why) ?? (p.ok === true ? 'capable' : 'probe-failed'), ...(str(p.error) ? { error: p.error as string } : {}), tools: p.tools === true, contextSize: typeof p.contextSize === 'number' ? p.contextSize : null } : null,
    probing: l.probing === true ? { since: str(l.probingSince) ?? isoOf(Date.now()), ...(str(l.probingEndpoint) ? { endpoint: l.probingEndpoint as string } : {}) } : null,
    lastFallback: f && str(f.at) ? { at: f.at as string, cwd: str(f.cwd) ?? '', title: str(f.title), reason: str(f.reason) ?? 'no capable local model' } : null,
    pendingCardId: str(l.pendingCardId),
  };
}

/** The current config as a change card is compared with (render.ts rootRowsOf ctx.local; the diff marks only). */
export function localCurrentOf(v: LocalStatusView): { version: number | null; endpoints: LocalEndpointView[]; runner: { dir: string; entry: string; node: string; nodeSha256: string; treeSha256: string } | null; bundled: { dir: string; version: string | null } | null } | null {
  if (v.state !== 'set' && v.state !== 'none') return null;
  return { version: v.version, endpoints: v.endpoints, runner: v.runner ? { dir: v.runner.dir, entry: v.runner.entry, node: v.runner.node, nodeSha256: v.runner.nodeSha256, treeSha256: v.runner.treeSha256 } : null, bundled: v.bundled };
}

/* ── the form ────────────────────────────────────────────────────────────────────────────────────────────────────── */

export interface LocalForm {
  mode: 'setup' | 'change';
  compat: string;
  base: string;
  /** the address was typed: picking a server no longer fills it */
  baseTyped: boolean;
  model: string;
  loops: boolean;
  id: string;
  idTyped: boolean;
  runner: string;
  /** the endpoint a change edits (its values, to say what changes) */
  was: LocalEndpointView | null;
}
export type LocalField = 'base' | 'model' | 'id' | 'runner';
/** The order focus takes to the first invalid field. */
export const FIELD_ORDER: readonly LocalField[] = Object.freeze(['base', 'model', 'id', 'runner'] as const);
export type FieldErrors = Partial<Record<LocalField, string>>;

export function setupForm(): LocalForm {
  const s = LOCAL_SERVERS[0]!;
  return { mode: 'setup', compat: s.compat, base: s.base, baseTyped: false, model: '', loops: true, id: s.compat, idTyped: false, runner: '', was: null };
}
/** A change prefilled from the endpoint it edits (the first in signed order). */
export function changeForm(e: LocalEndpointView): LocalForm {
  return { mode: 'change', compat: e.compat, base: e.base, baseTyped: true, model: e.model, loops: e.loops, id: e.id, idTyped: true, runner: '', was: e };
}
/** Picking a server fills the address only while it was not typed; the endpoint name follows it until typed. */
export function pickServer(f: LocalForm, compat: string): LocalForm {
  const s = serverOf(compat);
  return { ...f, compat: s.compat, ...(f.baseTyped ? {} : { base: s.base }), ...(f.idTyped || f.mode === 'change' ? {} : { id: s.compat }) };
}
export function editField(f: LocalForm, name: LocalField, value: string): LocalForm {
  if (name === 'base') return { ...f, base: value, baseTyped: true };
  if (name === 'id') return { ...f, id: value, idTyped: true };
  return { ...f, [name]: value };
}

const PRIVATE_V4 = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|169\.254\.|100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.)/;
const LOOPBACK_HOST = /^(?:127\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|localhost|\[::1\])$/;

/** The address check on Save (design copy errors.malformed | lan | cloud | port), or null. Mirrors the row table. */
export function addressError(raw: string, compat: string): string | null {
  const t = raw.trim();
  const malformed = '✕ Not an address: start it with http://';
  const m = /^https?:\/\/(\[[^\]\s]*\]|[^/:?#@\s[\]]+)(?::([^/?#\s]*))?(\/[^?#\s]*)?$/.exec(t);
  if (!m) return malformed;
  const host = m[1]!;
  if (!LOOPBACK_HOST.test(host)) {
    if (LOOPBACK_HOST.test(host.toLowerCase())) return `✕ Write the host in lower case: ${host.toLowerCase()}`;
    if (PRIVATE_V4.test(host) || /\.(local|lan|home|internal)$/i.test(host) || /^\[(fe8|fc|fd)/i.test(host)) return `✕ ${host} is another machine on your network. In 8.0 the server must be on this Mac: use 127.0.0.1 or localhost.`;
    return `✕ ${host} is not a local server`;
  }
  const eg = `:${portOf(serverOf(compat).base)}`;
  if (m[2] === undefined || m[2] === '') return `✕ Add the port, e.g. ${eg}`;
  if (!/^[0-9]{1,5}$/.test(m[2]) || Number(m[2]) < 1 || Number(m[2]) > 65535) return `✕ The port is a number from 1 to 65535, e.g. ${eg}`;
  // 8.0: scheme, host and port only (the kernel refuses a path: the probe and the runner add /v1/…)
  if (m[3] !== undefined && m[3] !== '/') return `✕ Leave out the path: scheme, host and port only, e.g. http://127.0.0.1:${m[2]}`;
  if (t.length > 256) return '✕ The address is at most 256 characters';
  return null;
}

const ENDPOINT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** A string the contracts sanitizer would change or flag (control, bidi, hidden): the helper cannot show it. */
const unshowable = (s: string): boolean => {
  const r = sanitizeDisplayText(s);
  return r.text !== s || r.flags.length > 0;
};

/** The page's own checks on Save (before any request): scheme, a loopback host, a port, a model name. */
export function formErrors(f: LocalForm): FieldErrors {
  const out: FieldErrors = {};
  const a = addressError(f.base, f.compat);
  if (a) out.base = a;
  const m = f.model.trim();
  if (!m || m.length > 128 || unshowable(m)) out.model = `✕ Name the model ${listsIt(f.compat)}, e.g. qwen2.5-coder:14b.`;
  if (!ENDPOINT_ID.test(f.id.trim())) out.id = '✕ An endpoint name is 1 to 64 letters, digits, dots, dashes or underscores, starting with a letter or digit.';
  const r = f.runner.trim();
  if (r && (!r.startsWith('/') || r.length > 256 || unshowable(r))) out.runner = '✕ Name the folder by its full path, starting with /';
  return out;
}
export const firstInvalid = (e: FieldErrors): LocalField | null => FIELD_ORDER.find((k) => e[k]) ?? null;

const usedWords = (loops: boolean): string => (loops ? 'sessions and loops' : 'sessions only');

/** What a change changes, in words ("model a → b"); [] = nothing (Save stays disabled: "no change"). */
export function changesOf(f: LocalForm): string[] {
  const w = f.was;
  if (!w) return [];
  const out: string[] = [];
  if (w.compat !== f.compat) out.push(`server ${serverOf(w.compat).label} → ${serverOf(f.compat).label}`);
  if (w.base !== f.base.trim()) out.push(`address ${w.base} → ${f.base.trim()}`);
  if (w.model !== f.model.trim()) out.push(`model ${w.model} → ${f.model.trim()}`);
  if (w.loops !== f.loops) out.push(`used by ${usedWords(w.loops)} → ${usedWords(f.loops)}`);
  if (f.runner.trim()) out.push(`runner → ${f.runner.trim()}`);
  return out;
}

/* ── requests (log.append; the kernel stamps the human asker) ────────────────────────────────────────────────────── */

export type LocalRequest = { kind: string; payload: Record<string, unknown> };
export function probeRequest(e: { base: string; model: string; compat: string }): LocalRequest {
  return { kind: LOCAL_PROBE_REQUEST, payload: { model: e.model.trim(), base: e.base.trim(), compat: e.compat } };
}
export function setRequest(f: LocalForm): LocalRequest {
  return { kind: LOCAL_CONFIG_REQUEST, payload: { op: 'set', endpoint: { id: f.id.trim(), base: f.base.trim(), model: f.model.trim(), compat: f.compat, loops: f.loops }, ...(f.runner.trim() ? { runner: f.runner.trim() } : {}) } };
}
export const REMOVE_REQUEST: Readonly<LocalRequest> = Object.freeze({ kind: LOCAL_CONFIG_REQUEST, payload: Object.freeze({ op: 'remove' }) });

/** request.local.probe's answer ({ok, why, error?, toolsNative, contextSize, model}). */
export interface ProbeAnswer {
  ok: boolean;
  why: string;
  error?: string;
  toolsNative: boolean;
  contextSize: number | null;
  model: string | null;
}
export function probeAnswerOf(v: unknown): ProbeAnswer | null {
  if (!isObj(v) || typeof v.ok !== 'boolean' || typeof v.why !== 'string') return null;
  return { ok: v.ok, why: v.why, ...(str(v.error) ? { error: v.error as string } : {}), toolsNative: v.toolsNative === true, contextSize: typeof v.contextSize === 'number' ? v.contextSize : null, model: str(v.model) };
}

/**
 * C1 check-first: does the kernel's check let Save raise the card? Only an answer with the model there does; a
 * server that does not answer or lacks the model is a field error, so a typo never costs a card and a password.
 * A model without tool calls or with a short context still raises the card: the set section then says so.
 */
export function probeVerdict(a: ProbeAnswer, f: LocalForm): { go: true } | { go: false; field: LocalField; text: string } {
  if (a.ok || (a.why !== 'probe-failed' && a.why !== 'model-missing' && a.why !== 'no-endpoint')) return { go: true };
  const at = hostPort(f.base.trim());
  if (a.why === 'model-missing') return { go: false, field: 'model', text: `✕ ${at} answers, but has no model ${f.model.trim()}. Name it ${listsIt(f.compat)}.` };
  return { go: false, field: 'base', text: `✕ No answer at ${at}: ${errorWords(a.error)}. Start the server, then Save again.` };
}

/** The kernel's one-word probe error in words ("unreachable:ECONNREFUSED" → "connection refused"). */
export function errorWords(e: string | undefined): string {
  if (!e) return 'connection refused';
  const x = e.replace(/^unreachable:?/, '');
  if (/ECONNREFUSED/i.test(x)) return 'connection refused';
  if (/timeout|ETIMEDOUT|abort/i.test(x)) return 'no answer in time';
  return x || 'unreachable';
}

/** "32 768" (groups of three, a space between). */
export const ctxText = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** A refusal in the refusal voice: "CODE  message · next: …" (the kernel's own words; the symbol tag dropped). */
export function refusalLine(r: { code: string; reason: string | null; message: string; next: string[] }): string {
  const msg = r.message.replace(/^#[a-z0-9-]+: /, '');
  return `${r.code}  ${msg}${r.next.length ? ` · next: ${r.next.join(' · ')}` : ''}`;
}

/* ── the section's transient state (ui/local-model.ts owns it) ───────────────────────────────────────────────────── */

export interface LocalRequestSeen {
  cardId: string;
  /** ms */
  at: number;
  line: string;
  /** the entries that asked (brought back on deny or expiry) */
  entries: LocalForm | null;
}
export interface LocalUi {
  /** the entries (kept until the sheet closes, or while a card waits) */
  form: LocalForm | null;
  /** the form is open under its row */
  open: boolean;
  errors: FieldErrors;
  advanced: boolean;
  busy: null | 'checking' | 'submitting' | 'removing';
  confirmOff: boolean;
  request: LocalRequestSeen | null;
  result: ResultView | null;
  /** a Check again in flight (ms it started) */
  checking: number | null;
  /** a Check again whose call failed (refused, or nothing sent): the kernel's lastProbe does not hold it */
  check: LocalProbeView | null;
  /** #gui-folder-field: the runner override as the compact folder field (the controller draws it while the form is open) */
  runnerView?: FolderFieldView | null;
}
export const emptyLocalUi = (): LocalUi => ({ form: null, open: false, errors: {}, advanced: false, busy: null, confirmOff: false, request: null, result: null, checking: null, check: null });

/* ── the section ─────────────────────────────────────────────────────────────────────────────────────────────────── */

export interface LocalSectionInput {
  status: unknown;
  ui: LocalUi;
  /** loops that would stop if the local model went (enabled, trusted, with a model step) */
  loopsUsing: readonly string[];
  /** hh:mm of an ISO instant */
  time: (iso: string) => string;
}

const folderOf = (cwd: string): string => cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || cwd;
const isoOf = (ms: number): string => new Date(ms).toISOString();
const FALLBACK_WHY: Readonly<Record<string, string>> = { 'probe-failed': 'no answer', 'no-tools': 'it can’t call tools', 'ctx-unknown': 'context size unknown', 'ctx-below-floor': 'context too short', 'no-endpoint': 'no endpoint', 'no-runner': 'no runner pinned' };
/** "evening-tidy and green-typecheck-gnomon" / "a, b and c". */
export const andList = (xs: readonly string[]): string => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** The Check row's words for a probe (design check.*), with how and Check again where a check can help. */
export function checkRowOf(p: LocalProbeView | null, v: LocalStatusView, checking: number | null, time: (iso: string) => string): { value: string; mark?: string; how: string; key: boolean; keyLabel?: string } {
  if (!v.runner) return { value: 'runner not pinned', mark: '✕', how: 'Change… and Save to pin the bundled runner.', key: false };
  if (checking !== null || v.probing) return { value: `checking… started ${time(v.probing?.since ?? isoOf(checking!))}`, how: LOCAL_COPY.checkingHow, key: false };
  if (!p) return { value: 'not checked yet', how: '', key: true, keyLabel: 'Check now' };
  const at = time(p.at);
  const e = v.endpoints[0];
  const server = e ? serverOf(e.compat).label : 'the server';
  if (p.ok) return { value: `answers · tools ${p.tools ? 'native' : 'by template'} · context ${p.contextSize !== null ? ctxText(p.contextSize) : 'unknown'} · ${at}`, mark: '✓', how: '', key: false };
  switch (p.why) {
    case 'no-tools':
      return { value: `answers, but can’t call tools · ${at}`, mark: '✕', how: 'Pick a model with tool calls (qwen2.5-coder has them), then Change….', key: true };
    case 'ctx-below-floor':
      return { value: `context ${p.contextSize !== null ? ctxText(p.contextSize) : '?'}: sessions need ${ctxText(LOCAL_CTX_FLOOR)} · ${at}`, mark: '✕', how: 'Raise num_ctx for this model (a Modelfile’s PARAMETER num_ctx 16384), then Check again.', key: true };
    case 'ctx-unknown':
      return { value: `context size unknown · ${at}`, mark: '?', how: 'Gnomon couldn’t read it from the server; sessions fall back until it can.', key: true };
    case 'model-missing':
      return { value: `answers, but has no model ${e?.model ?? ''} · ${at}`.replace('  ', ' '), mark: '✕', how: `Name the model ${listsIt(e?.compat ?? 'ollama')}: Change….`, key: true };
    default:
      return { value: `no answer: ${errorWords(p.error)} · ${at}`, mark: '✕', how: `${e?.compat === 'ollama' ? 'Start Ollama (the menu bar app, or `ollama serve`)' : `Start ${server}`}, then Check again. Until then local sessions raise a fallback card and loops stop at their first model step.`, key: true };
  }
}

/** The request line ("23:20 · ollama · 127.0.0.1:11434 · qwen2.5-coder:14b · sessions and loops"). */
export function requestLine(at: string, e: { id: string; base: string; model: string; loops: boolean }): string {
  return `${at} · ${e.id} · ${hostPort(e.base)} · ${e.model} · ${usedWords(e.loops)}`;
}

function fieldsOf(f: LocalForm, errors: FieldErrors, runnerView: FolderFieldView | null = null): { fields: FieldView[]; advanced: FieldView[] } {
  const server: FieldView = { kind: 'seg', name: 'compat', label: 'server', options: LOCAL_SERVERS.map((s) => ({ act: 'server', value: s.compat, label: s.label, quiet: true, ...(f.compat === s.compat ? { pri: true } : {}) })), note: serverNote(f.compat) };
  const text = (name: LocalField, label: string, value: string, width: 'w-addr' | 'w-model' | 'w-name' | 'w-path', note: string, extra: { placeholder?: string } = {}): FieldView => ({ kind: 'text', name, label, value, width, note, ...(errors[name] ? { error: errors[name] } : {}), ...extra });
  const used: FieldView = { kind: 'seg', name: 'loops', label: 'used by', options: [{ act: 'loops', value: 'yes', label: 'Sessions and loops', quiet: true, ...(f.loops ? { pri: true } : {}) }, { act: 'loops', value: 'no', label: 'Sessions only', quiet: true, ...(!f.loops ? { pri: true } : {}) }], note: f.loops ? LOCAL_COPY.usedOn : LOCAL_COPY.usedOff };
  const name: FieldView = f.mode === 'change' ? { kind: 'value', name: 'id', label: 'endpoint name', value: `${f.id} · the endpoint this changes` } : text('id', 'endpoint name', f.id, 'w-name', LOCAL_COPY.nameNote);
  return {
    fields: [server, text('base', 'address', f.base, 'w-addr', LOCAL_COPY.addressNote), text('model', 'model', f.model, 'w-model', modelNote(f.compat)), used],
    advanced: [name, { kind: 'value', name: 'runner-bundled', label: 'runner', value: 'gnomon-local · bundled with Gnomon' }, runnerView ? { kind: 'folder', name: 'runner', label: LOCAL_COPY.runnerOverride, view: runnerView, note: LOCAL_COPY.runnerNote } : text('runner', LOCAL_COPY.runnerOverride, f.runner, 'w-path', LOCAL_COPY.runnerNote)],
  };
}

/** The open form in its state (open, invalid, checking, submitting, denied, expired, refused). */
export function formViewOf(ui: LocalUi, bundledVersion: string | null): FormView {
  const f = ui.form ?? setupForm();
  const { fields, advanced } = fieldsOf(f, ui.errors, ui.runnerView ?? null);
  const runnerValue = advanced.find((x) => x.name === 'runner-bundled');
  if (runnerValue && runnerValue.kind === 'value') runnerValue.value = `gnomon-local${bundledVersion ? ` ${bundledVersion}` : ''} · bundled with Gnomon`;
  const changes = f.mode === 'change' ? changesOf(f) : [];
  const unchanged = f.mode === 'change' && changes.length === 0;
  const busy = ui.busy === 'checking' || ui.busy === 'submitting';
  const saveLabel = ui.busy === 'checking' ? 'Checking…' : ui.busy === 'submitting' ? `${LOCAL_COPY.save}…` : LOCAL_COPY.save;
  const result: ResultView | undefined = ui.busy === 'checking' ? { text: `checking ${hostPort(f.base.trim())} before raising the card…` } : (ui.result ?? undefined);
  return {
    label: f.mode === 'change' ? 'Change the local model' : 'Set up a local model',
    lead: f.mode === 'change' ? LOCAL_COPY.leadChange : LOCAL_COPY.lead,
    ...(result ? { result } : {}),
    fields,
    advanced: { open: ui.advanced || !!ui.errors.id || !!ui.errors.runner, label: 'Advanced', fields: advanced },
    ...(changes.length ? { changes: changes.join(' · ') } : {}),
    keys: [
      { act: 'save', label: saveLabel, pri: true, submit: true, ...(busy || unchanged ? { disabled: true } : {}), ...(busy ? { busy: true } : {}) },
      { act: 'cancel', label: 'cancel', quiet: true, ...(ui.busy === 'submitting' ? { disabled: true } : {}) },
    ],
    ...(unchanged && !busy ? { whyOff: LOCAL_COPY.unchanged } : {}),
    foot: LOCAL_COPY.foot,
  };
}

/** The "Local model · kernel-owned" section in every state (design local-model.html, sections 1-3). */
export function localSection(i: LocalSectionInput): SettingsSection {
  const v = localStatusOf(i.status);
  const ui = i.ui;
  const rows: SettingRow[] = [];
  const term: SettingRow = { kind: 'term', id: 'local-term', text: 'Terminal: ', code: LOCAL_COPY.terminal };
  const sec = (r: SettingRow[]): SettingsSection => ({ id: LOCAL_SECTION, title: LOCAL_COPY.title, owner: LOCAL_COPY.owner, intro: LOCAL_COPY.intro, rows: r });
  if (v.state === 'not-connected') return sec([{ kind: 'readonly', id: 'local-model', label: 'Local model', value: LOCAL_COPY.notConnected.value, how: LOCAL_COPY.notConnected.how }]);
  if (v.state === 'not-offered') return sec([{ kind: 'readonly', id: 'local-model', label: 'Local model', value: LOCAL_COPY.notOffered.value, how: LOCAL_COPY.notOffered.how }]);
  if (v.state === 'windows') return sec([{ kind: 'readonly', id: 'local-model', label: 'Local model', value: LOCAL_COPY.windows.value, how: LOCAL_COPY.windows.how }, term]);

  const quiet = !!ui.request || !!ui.result || ui.open;
  if (v.state === 'none') rows.push({ kind: 'readonly', id: 'local-model', label: 'Local model', value: LOCAL_COPY.none.value, how: quiet && !ui.open ? '' : ui.request || ui.result ? '' : LOCAL_COPY.none.how });
  else {
    v.endpoints.forEach((e, n) => {
      rows.push({ kind: 'readonly', id: `local-endpoint-${n}`, label: 'Endpoint', value: `${e.id} · ${e.base}`, how: '', ...(n ? { grp: true } : {}) });
      rows.push({ kind: 'readonly', id: `local-model-${n}`, label: 'Model', value: e.model, how: '' });
      rows.push({ kind: 'readonly', id: `local-used-${n}`, label: 'Used by', value: usedWords(e.loops), how: '' });
    });
    // the kernel's lastProbe holds every check (the automatic one and Check again); ui.check only a call that failed
    const probe = ui.check ?? v.lastProbe;
    const c = checkRowOf(probe, v, ui.checking, i.time);
    // with several endpoints the one check names the endpoint it is about (Check again checks the first)
    const which = v.endpoints.length > 1 ? `${v.probing?.endpoint ?? ((ui.checking === null && probe?.endpoint) || v.endpoints[0]!.id)} · ` : '';
    rows.push({ kind: 'readonly', id: 'local-check', label: 'Check', value: `${which}${c.value}`, how: c.how, grp: true, live: true, ...(c.mark ? { mark: c.mark } : {}), ...(c.key ? { keys: [{ act: 'check', label: c.keyLabel ?? 'Check again', quiet: true }] } : {}), ...(probe?.contextSize !== null && probe ? { title: `context ${probe.contextSize} tokens, as the server reports it` } : {}) });
    const r = v.runner;
    if (r) rows.push({ kind: 'readonly', id: 'local-runner', label: 'Runner', value: `gnomon-local${r.version ? ` ${r.version}` : ''} · ${r.source === 'bundled' ? 'bundled' : 'your folder'} · tree ${r.treeSha256.slice(0, 8)}`, how: '', grp: true, title: `${r.dir}/${r.entry} · node ${r.node}` });
    rows.push({ kind: 'readonly', id: 'local-signed', label: 'Signed', value: `config v${v.version ?? '?'}${v.signedAt ? ` · ${i.time(v.signedAt)}` : ''} · root key`, how: '', ...(r ? {} : { grp: true }) });
    const fb = v.lastFallback;
    rows.push({ kind: 'readonly', id: 'local-fallback', label: 'Last fallback', value: fb && (!v.signedAt || fb.at >= v.signedAt) ? `${i.time(fb.at)} · “${fb.title ?? folderOf(fb.cwd)}” asked for local and got a fallback card: ${FALLBACK_WHY[fb.reason] ?? fb.reason}` : 'none since it was set', how: '' });
  }

  if (ui.request) {
    rows.push({ kind: 'request', id: 'local-request', label: 'Asked', chip: 'card waiting', line: ui.request.line, keys: [{ act: 'decide', label: LOCAL_COPY.decide }], how: LOCAL_COPY.requestHow });
  } else if (ui.open && ui.form) {
    rows.push({ kind: 'form', id: 'local-form', label: ui.form.mode === 'change' ? 'Change' : 'Set up', keys: [], form: formViewOf(ui, v.bundled?.version ?? v.runner?.version ?? null) });
  } else if (v.state === 'none') {
    rows.push({ kind: 'form', id: 'local-form', label: '', keys: [{ act: 'setup', label: LOCAL_COPY.none.key, pri: true, expanded: false }], ...(ui.result ? { result: ui.result } : {}) });
  } else if (ui.confirmOff) {
    const n = i.loopsUsing.length;
    const what = v.endpoints.length === 1 ? v.endpoints[0]!.model : `the ${v.endpoints.length} local models`;
    rows.push({ kind: 'form', id: 'local-form', label: '', keys: [], confirm: { label: 'Turn off the local model', text: `Turn off ${what}? ${n} loop${n === 1 ? ' uses' : 's use'} it: ${i.loopsUsing.join(', ')}. ${n === 1 ? 'It won’t' : 'They won’t'} start until you set one up again, and that takes a card and your password.`, keys: [{ act: 'confirm-off', label: 'Turn off' }, { act: 'keep', label: 'keep it', quiet: true }] } });
  } else {
    const removing = ui.busy === 'removing';
    rows.push({ kind: 'form', id: 'local-form', label: '', keys: [{ act: 'change', label: v.endpoints.length > 1 ? `Change ${v.endpoints[0]!.id}…` : 'Change…', expanded: false, ...(removing ? { disabled: true } : {}) }, { act: 'turn-off', label: removing ? 'Turning off…' : 'Turn off', quiet: true, ...(removing ? { disabled: true, busy: true } : {}) }], ...(ui.result ? { result: ui.result } : {}) });
  }
  rows.push(term);
  return sec(rows);
}

/* ── outcome words (results and toasts) ──────────────────────────────────────────────────────────────────────────── */

export const deniedResult = (at: string): ResultView => ({ lead: 'Not changed:', text: ` you denied the card at ${at}. Your entries are below.` });
export const expiredResult = (at: string, restarted: boolean): ResultView => ({ lead: 'Not changed:', text: ` the card expired at ${at}${restarted ? ' (Gnomon restarted)' : ''}. Your entries are below.` });
export const turnedOffResult = (at: string, loops: readonly string[]): ResultView => ({ lead: 'Turned off', text: ` at ${at}.${loops.length ? ` ${andList(loops)} won’t start until a local model is set up.` : ''}` });

/** The toast once the check after Allow lands (only when no sheet is open): info on ✓, a fail that stays otherwise. */
export function appliedToast(v: LocalStatusView): { text: string; kind: 'info' | 'fail' } | null {
  const e = v.endpoints[0];
  const p = v.lastProbe;
  if (!e || !p) return null;
  const at = hostPort(e.base);
  if (p.ok) return { kind: 'info', text: `set · ${e.model} on ${at} · ✓ answers · tools ${p.tools ? 'native' : 'by template'} · context ${p.contextSize !== null ? ctxText(p.contextSize) : 'unknown'}` };
  const server = serverOf(e.compat).label;
  if (p.why === 'no-tools') return { kind: 'fail', text: `set, but ${e.model} can’t call tools\n  next: pick a model with tool calls, then Settings → Local model → Change…` };
  if (p.why === 'ctx-below-floor') return { kind: 'fail', text: `set, but context ${p.contextSize !== null ? ctxText(p.contextSize) : '?'}: sessions need ${ctxText(LOCAL_CTX_FLOOR)}\n  next: raise num_ctx, then Settings → Local model → Check again` };
  if (p.why === 'ctx-unknown') return { kind: 'info', text: `set · ${e.model} on ${at} · ✓ answers · ? context size unknown` };
  return { kind: 'fail', text: `set, but no answer: ${errorWords(p.error)} at ${at}\n  next: start ${server}, then Settings → Local model → Check again` };
}
export const turnedOffToast = (loops: readonly string[]): string => `turned off${loops.length ? ` · ${andList(loops)} won’t start until one is set up` : ''}`;

/** The palette's title for local.setup (design palette: none | set). */
export const localPaletteTitle = (status: unknown): string => (localStatusOf(status).state === 'set' ? LOCAL_COPY.palette.set : LOCAL_COPY.palette.none);
