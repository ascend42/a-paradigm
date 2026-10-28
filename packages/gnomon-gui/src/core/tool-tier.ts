/**
 * @symbol #gui-tool-tier
 *
 * #gui-tool-tier (TD-2026-10-27-833 slice C4'b; Mika's design, the founder's answers). PURE: what the chat header says
 * about a local session's tool tier, the tier menu, the confirm sheet's words in every state, the Settings row and the
 * requests. The DOM and the press paths are ui/tier-picker.ts; the kernel is #local-tool-tier (local-session.ts).
 *
 *   - The label is the kernel's rows only: the last model.capabilities{hsid, tier, tierSource} of the session. The
 *     source is a word, never a colour: `tier 2` (measured), `tier 3 · yours`, `tier 1 · provisional`.
 *   - The change is two-phase: request.session.tier{op:'preview'} says what changes and mints a single-use token;
 *     {op:'commit', token, remember} applies it. A commit is never retried (a wrong attempt burns the token): an
 *     expired or stale preview offers Preview again, which is a new preview on a trusted press.
 *   - Warnings are built from the preview's fields, never parsed from its `notice`.
 *   - "in new sessions too" starts unticked (founder); it is disabled with the kernel's reason when the tier cannot be
 *     remembered (rememberable false).
 */
import { pinWhyWords } from './tools-drawer.js';

export const TIER_REQUEST = 'request.session.tier' as const;
export const TIER_REMEASURE_REQUEST = 'request.local.tier.remeasure' as const;
export const TIER_CLEAR_REQUEST = 'request.local.tier.clear' as const;

export type Tier = 0 | 1 | 2 | 3;
export type TierSource = 'measured' | 'human' | 'provisional';
export const TIERS: readonly Tier[] = Object.freeze([0, 1, 2, 3] as const);
/** The smallest context target each tier needs (mirrors the kernel's WINDOW_TIER_MIN, kernel/local/tool-tier.ts). */
export const WINDOW_TIER_MIN: Readonly<Record<1 | 2 | 3, number>> = Object.freeze({ 1: 4096, 2: 8192, 3: 16384 });
export const isTier = (v: unknown): v is Tier => v === 0 || v === 1 || v === 2 || v === 3;
const isSource = (v: unknown): v is TierSource => v === 'measured' || v === 'human' || v === 'provisional';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/* ── copy (Mika) ─────────────────────────────────────────────────────────────────────────────────────────────────── */

export const TIER_COPY = Object.freeze({
  notOwner: 'Only the person who opened this session can change its tier.',
  ended: 'This session has ended; its tier no longer changes.',
  unknown: 'Not known whether it changed: the connection dropped. The header shows this session’s tier.',
  provisional: 'Set while the model was still being measured. It stays until you change it.',
  menu: Object.freeze({
    0: 'its own file tools only: no Gnomon or MCP tools',
    1: 'up to 4 tools, short forms',
    2: 'up to 12 tools, short forms',
    3: 'up to 12 tools with full forms, including ones you’d normally run yourself',
  }) as Readonly<Record<Tier, string>>,
  measuredMark: ' · measured',
  cache: 'prompt cache: starts over, so the next reply is slower',
  noneLeave: 'none leave',
  foot: 'Applies from the model’s next step; a call already running finishes as it started.',
  footMcp: 'MCP servers start first.',
  apply: 'Apply now · cache resets',
  applying: 'Applying…',
  again: 'Preview again',
  cancel: 'cancel',
  close: 'close',
  expired: 'Not changed: this preview expired (a preview holds for a minute).',
  stale: 'Not changed: this session’s tools changed since the preview.',
  gone: 'Not changed: this session isn’t running any more.',
  remember: Object.freeze({ 'no-fingerprint': 'can’t remember: the server didn’t name this model’s file', 'store-unwritable': 'can’t remember: Gnomon couldn’t write its tier file' }) as Readonly<Record<string, string>>,
  settings: Object.freeze({
    label: 'Tool tier',
    none: 'not measured yet',
    measuring: 'measuring…',
    how: 'Change it for one session from its header; tick ‘in new sessions too’ to keep it.',
    remeasure: 'Re-measure',
    reset: 'Reset to measured',
    resetNote: 'Reset to measured: new sessions go back to the measured tier; open sessions keep theirs.',
  }),
});

/* ── the session's tier (kernel rows) ────────────────────────────────────────────────────────────────────────────── */

export interface SessionTier {
  tier: Tier;
  source: TierSource;
  /** the measured skill (null: not measured yet) */
  measured: Tier | null;
  /** a human change's tier before it */
  previous?: Tier;
}
interface RowLike {
  kind: string;
  payload?: unknown;
}

/** One model.capabilities payload as the session's tier, or null when it is not one (the store folds this). */
export function tierOfCapabilities(p: unknown, hsid: string): SessionTier | null {
  if (!isObj(p) || p.hsid !== hsid || !isTier(p.tier) || !isSource(p.tierSource)) return null;
  return { tier: p.tier, source: p.tierSource, measured: isTier(p.measured) ? p.measured : null, ...(isTier(p.previous) ? { previous: p.previous } : {}) };
}

/** The tier of session `hsid` from its rows (oldest first): the last model.capabilities that names one; a session.open starts afresh. */
export function sessionTierOf(rows: Iterable<RowLike>, hsid: string): SessionTier | null {
  let t: SessionTier | null = null;
  for (const r of rows) {
    if (r.kind === 'session.open') t = null;
    else if (r.kind === 'model.capabilities') t = tierOfCapabilities(r.payload, hsid) ?? t;
  }
  return t;
}

/** The header label: the source as a word. */
export function tierLabel(t: Pick<SessionTier, 'tier' | 'source'>): string {
  return `tier ${t.tier}${t.source === 'human' ? ' · yours' : t.source === 'provisional' ? ' · provisional' : ''}`;
}

/**
 * What the header shows for a session: a key (the owner of a live, attended local session), a plain chip (another
 * principal's, or an ended one) or nothing (not local, a loop session, or no tier row yet).
 */
export function tierChipOf(i: { backend: string | null; loop: boolean; live: boolean; owner: string | null; me: string | null; tier: SessionTier | null }): { kind: 'key' | 'chip'; text: string; title: string } | null {
  if (i.backend !== 'local' || i.loop || !i.tier) return null;
  const label = tierLabel(i.tier);
  const owner = i.live && i.owner !== null && i.me !== null && i.owner === i.me;
  const prov = i.tier.source === 'provisional' ? TIER_COPY.provisional : '';
  if (!owner) return { kind: 'chip', text: label, title: [i.live ? TIER_COPY.notOwner : TIER_COPY.ended, prov].filter(Boolean).join(' ') };
  return { kind: 'key', text: `${label} ▾`, title: prov || `Tool tier of this session: ${label}. Change it for this session.` };
}

export interface TierMenuItem {
  tier: Tier;
  name: string;
  note: string;
  current: boolean;
}
/** The tier menu: every tier, the current one marked; the measured tier's note ends " · measured". */
export function tierMenu(cur: Tier, measured: Tier | null): TierMenuItem[] {
  return TIERS.map((t) => ({ tier: t, name: `Tier ${t}`, note: `${TIER_COPY.menu[t]}${t === measured ? TIER_COPY.measuredMark : ''}`, current: t === cur }));
}

/* ── the preview ─────────────────────────────────────────────────────────────────────────────────────────────────── */

export interface TierPreview {
  hsid: string;
  from: Tier;
  to: Tier;
  requested: Tier;
  measured: Tier | null;
  window: Tier;
  k: number;
  slotTokens: number;
  slotShare: number;
  /** 'a→b' (compact | full | none) */
  surface: { from: string; to: string };
  cacheLost: boolean;
  leaving: string[];
  unfitPins: Array<{ name: string; why: string }>;
  token: string;
  expiresInMs: number;
  rememberable: boolean;
  rememberWhy?: 'no-fingerprint' | 'store-unwritable';
}

const SURFACES = ['none', 'compact', 'full'];
const NAME_MAX = 128;
const nat = (v: unknown, max = 1e9): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;
const name = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= NAME_MAX;

/** The kernel's preview answer, shape-checked; null on anything malformed (the sheet then shows an error). */
export function previewOf(v: unknown): TierPreview | null {
  if (!isObj(v)) return null;
  if (!name(v.hsid) || !isTier(v.from) || !isTier(v.to) || !isTier(v.requested) || !isTier(v.window) || !(v.measured === null || isTier(v.measured))) return null;
  if (!nat(v.k, 64) || !nat(v.slotTokens) || typeof v.slotShare !== 'number' || !(v.slotShare >= 0 && v.slotShare <= 1)) return null;
  if (typeof v.surface !== 'string') return null;
  const sf = v.surface.split('→');
  if (sf.length !== 2 || !sf.every((x) => SURFACES.includes(x))) return null;
  if (typeof v.cacheLost !== 'boolean' || typeof v.token !== 'string' || !/^[0-9a-f]{32}$/.test(v.token) || !nat(v.expiresInMs, 3_600_000) || v.expiresInMs === 0) return null;
  if (!Array.isArray(v.leaving) || v.leaving.length > 64 || !v.leaving.every(name)) return null;
  if (!Array.isArray(v.unfitPins) || v.unfitPins.length > 64 || !v.unfitPins.every((u) => isObj(u) && name(u.name) && name(u.why))) return null;
  if (typeof v.rememberable !== 'boolean') return null;
  if (v.rememberWhy !== undefined && v.rememberWhy !== 'no-fingerprint' && v.rememberWhy !== 'store-unwritable') return null;
  if (!v.rememberable && v.rememberWhy === undefined) return null;
  return {
    hsid: v.hsid, from: v.from, to: v.to, requested: v.requested, measured: v.measured, window: v.window, k: v.k, slotTokens: v.slotTokens, slotShare: v.slotShare,
    surface: { from: sf[0]!, to: sf[1]! }, cacheLost: v.cacheLost, leaving: [...(v.leaving as string[])], unfitPins: (v.unfitPins as Array<{ name: string; why: string }>).map((u) => ({ name: u.name, why: u.why })),
    token: v.token, expiresInMs: v.expiresInMs, rememberable: v.rememberable, ...(v.rememberWhy ? { rememberWhy: v.rememberWhy as 'no-fingerprint' | 'store-unwritable' } : {}),
  };
}

/** "16 384" (groups of three, a space between). */
const grouped = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const formsOf = (tier: Tier, surface: string): string => (tier === 0 || surface === 'none' ? 'no' : surface === 'full' ? 'full' : 'short');
/** Mika F12: at most this many names on a line; the rest is "and N more", the whole list in the line's title. */
export const LIST_SHOWN = 8;
function shortList(lead: string, xs: readonly string[]): [string, string | null] {
  if (xs.length <= LIST_SHOWN) return [`${lead}${xs.join(', ')}`, null];
  return [`${lead}${xs.slice(0, LIST_SHOWN).join(', ')} and ${xs.length - LIST_SHOWN} more`, `${lead}${xs.join(', ')}`];
}


export interface PreviewView {
  lines: string[];
  /** the full text of a shortened line (the leaving list and the pins past LIST_SHOWN names), by line index */
  titles: Array<string | null>;
  warnings: string[];
  /** null: nothing changes (no Apply, no checkbox) */
  checkbox: { label: string; disabled: boolean; why?: string } | null;
  apply: boolean;
  foot: string;
}

/** What the sheet says about a preview (Mika's meta lines, the ◆ warnings, the checkbox and the foot). */
export function previewView(p: TierPreview, model: string): PreviewView {
  const now = formsOf(p.from, p.surface.from);
  // C6'b1: the same words as the Tools drawer (pinWhyWords); never the selector's raw code ("over k")
  const pins = p.unfitPins.map((u) => `${u.name} (${pinWhyWords(u.why, { tier: p.to, k: p.k })})`);
  const rows: Array<[string, string | null]> = [
    [p.to === 0 ? `tools: its own file tools only (now ${now} forms)` : `tools: up to ${p.k}, ${formsOf(p.to, p.surface.to)} forms (now ${now})`, null],
    [`tool space: ${grouped(p.slotTokens)} tokens, ${Math.round(p.slotShare * 100)}% of its context`, null],
    p.leaving.length ? shortList('leaving: ', p.leaving) : [TIER_COPY.noneLeave, null],
    ...(pins.length ? [shortList('pins that won’t fit: ', pins)] : []),
    ...(p.cacheLost ? [[TIER_COPY.cache, null] as [string, string | null]] : []),
  ];
  const lines = rows.map((r) => r[0]);
  const titles = rows.map((r) => r[1]);
  const warnings: string[] = [];
  if (p.measured === null ? p.to > 1 : p.to > p.measured) warnings.push(`◆ Above what this model measured (${p.measured ?? 'not yet'}). It may call tools badly; every call is still checked and carded.`);
  if (p.requested > p.window && p.requested > 0) warnings.push(`◆ Tier ${p.requested} needs a context target of ${grouped(WINDOW_TIER_MIN[p.requested as 1 | 2 | 3])} tokens or more, so this applies tier ${p.to}.`);
  const apply = p.to !== p.from;
  const checkbox = apply ? { label: `Use tier ${p.to} for ${model} in new sessions too`, disabled: !p.rememberable, ...(!p.rememberable ? { why: TIER_COPY.remember[p.rememberWhy ?? 'no-fingerprint'] } : {}) } : null;
  return { lines, titles, warnings, checkbox, apply, foot: p.from === 0 && p.to > 0 ? `${TIER_COPY.foot} ${TIER_COPY.footMcp}` : TIER_COPY.foot };
}

/* ── the sheet in every state ────────────────────────────────────────────────────────────────────────────────────── */

export type SheetPhase = 'loading' | 'ready' | 'applying' | 'expired' | 'stale' | 'error';
export interface SheetKey {
  act: 'apply' | 'again' | 'cancel' | 'close';
  label: string;
  pri?: boolean;
  quiet?: boolean;
  disabled?: boolean;
  busy?: boolean;
}
export interface SheetView {
  title: string;
  /** role=status: loading, expired, stale and error say it here */
  status: string | null;
  fail: boolean;
  body: PreviewView | null;
  keys: SheetKey[];
  /** where focus goes when the state lands */
  focus: SheetKey['act'];
}

/** The sheet: from the session's tier to the requested one, in its phase. */
export function sheetView(s: { phase: SheetPhase; from: Tier; requested: Tier; preview: TierPreview | null; model: string; error?: string | null }): SheetView {
  const p = s.preview;
  const title = `Change this session’s tool tier from ${p?.from ?? s.from} to ${p?.to ?? s.requested}?`;
  const cancel: SheetKey = { act: 'cancel', label: TIER_COPY.cancel, quiet: true };
  const body = p ? previewView(p, s.model) : null;
  switch (s.phase) {
    case 'loading':
      return { title, status: `Checking what tier ${s.requested} changes…`, fail: false, body: null, keys: [{ act: 'apply', label: TIER_COPY.apply, pri: true, disabled: true, busy: true }, cancel], focus: 'cancel' };
    case 'ready':
      if (body && !body.apply) return { title: `This session already uses tier ${p!.from}`, status: null, fail: false, body, keys: [{ act: 'close', label: TIER_COPY.close, quiet: true }], focus: 'close' };
      return { title, status: null, fail: false, body, keys: [{ act: 'apply', label: TIER_COPY.apply, pri: true }, cancel], focus: 'apply' };
    case 'applying':
      return { title, status: null, fail: false, body, keys: [{ act: 'apply', label: TIER_COPY.applying, pri: true, disabled: true, busy: true }, { ...cancel, disabled: true }], focus: 'apply' };
    case 'expired':
    case 'stale':
      return { title, status: s.phase === 'expired' ? TIER_COPY.expired : TIER_COPY.stale, fail: false, body, keys: [{ act: 'again', label: TIER_COPY.again, pri: true }, cancel], focus: 'again' };
    default:
      return { title, status: s.error ?? TIER_COPY.gone, fail: true, body, keys: [{ act: 'close', label: TIER_COPY.close, quiet: true }], focus: 'close' };
  }
}

/* ── the commit's outcome ────────────────────────────────────────────────────────────────────────────────────────── */

/** What a commit answer says: the info toast, and a warn toast when "in new sessions too" could not be kept. */
export function commitOutcome(v: unknown, remember: boolean): { info: string; warn: string | null } | null {
  if (!isObj(v) || !isTier(v.tier) || !isTier(v.previous)) return null;
  const info = `tier ${v.previous} → ${v.tier} · applies from the next step · prompt cache starts over`;
  const why = typeof v.rememberWhy === 'string' ? v.rememberWhy : 'store-unwritable';
  return { info, warn: remember && v.remembered !== true ? `tier ${v.tier} applies to this session only: ${TIER_COPY.remember[why] ?? TIER_COPY.remember['store-unwritable']}` : null };
}

/** A refusal's reason as the sheet's phase: stale → stale; not-found → error with "isn't running"; else error. */
export function refusalPhase(reason: string | null | undefined): 'stale' | 'gone' | 'error' {
  return reason === 'stale' ? 'stale' : reason === 'not-found' ? 'gone' : 'error';
}

/* ── the Settings row ────────────────────────────────────────────────────────────────────────────────────────────── */

export interface ProbeTier {
  skill: Tier | null;
  passed: number | null;
  measuring: boolean;
  window: Tier;
  human: Tier | null;
}
/** status.local.lastProbe.tier, shape-checked (null when absent or malformed). */
export function probeTierOf(v: unknown): ProbeTier | null {
  if (!isObj(v) || !(v.skill === null || isTier(v.skill)) || !(v.human === null || isTier(v.human)) || !isTier(v.window) || typeof v.measuring !== 'boolean') return null;
  return { skill: v.skill, passed: nat(v.passed, 4) ? v.passed : null, measuring: v.measuring, window: v.window, human: v.human };
}

/** The Settings value: "2 · measured", "3 · yours (measured 2)", "1 · provisional · measuring…", "1 · measured 3, capped by context", "not measured yet". */
export function tierSettingsValue(t: ProbeTier | null, measuring = false): string {
  const busy = measuring || t?.measuring === true;
  if (!t) return busy ? TIER_COPY.settings.measuring : TIER_COPY.settings.none;
  const tail = busy ? ` · ${TIER_COPY.settings.measuring}` : '';
  if (t.human !== null) {
    const tier = Math.min(t.human, t.window);
    return `${tier} · yours${t.skill !== null ? ` (measured ${t.skill})` : ''}${tier < t.human ? ', capped by context' : ''}${tail}`;
  }
  if (t.skill === null) return busy ? `${Math.min(1, t.window)} · provisional${tail}` : TIER_COPY.settings.none;
  if (t.skill > t.window) return `${t.window} · measured ${t.skill}, capped by context${tail}`;
  return `${t.skill} · measured${tail}`;
}

/* ── requests ────────────────────────────────────────────────────────────────────────────────────────────────────── */

export type TierRequest = { kind: string; payload: Record<string, unknown> };
/** request.session.tier: a preview of `tier`, or the commit of a preview's token (sent only on a trusted press). */
export function tierRequest(hsid: string, op: 'preview', tier: Tier): TierRequest;
export function tierRequest(hsid: string, op: 'commit', token: string, remember: boolean, tier: Tier): TierRequest;
export function tierRequest(hsid: string, op: 'preview' | 'commit', a: Tier | string, remember = false, tier?: Tier): TierRequest {
  if (op === 'preview') return { kind: TIER_REQUEST, payload: { hsid, op, tier: a } };
  return { kind: TIER_REQUEST, payload: { hsid, op, token: a, remember, ...(tier !== undefined ? { tier } : {}) } };
}
/** Aegis C4'b L1: the quiet line when the kernel refused a Re-measure as rate-limited (never retried by itself). */
export function remeasureLaterText(retryAfterMs: number): string {
  const s = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return `Not re-measured: one ran moments ago. Try again in ${s} s.`;
}
export const remeasureRequest = (endpoint: string): TierRequest => ({ kind: TIER_REMEASURE_REQUEST, payload: { endpoint } });
export const clearRequest = (endpoint: string): TierRequest => ({ kind: TIER_CLEAR_REQUEST, payload: { endpoint } });
