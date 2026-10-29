/**
 * @symbol #gui-toast
 *
 * The one toast (design system .atelier/systems/gnomon/design-system.yaml: component `toast`, zone `toasts`, rule
 * notices-by-kind; board gnomon-notices, choice band-for-alerts). PURE: kinds, timing, roles, the overflow policy and
 * the refusal split. ui/toasts.ts is the DOM.
 *
 *   - Every notice that is not a kernel alert is a toast: GUI outcomes (notice()), the voice idle auto-off and the
 *     voice app's notices, update available, standing-grant offers and confirmations. Kernel alerts (#repin,
 *     #voice-dev) stay in the band under the header.
 *   - Edge by kind: ink for info, amber for warn (and asks-first), vermilion for fail.
 *   - Timing: info leaves after 6 s, warn after 10 s, both paused while hovered or focused; fail and persistent
 *     (and a held asks-first) never leave by themselves.
 *   - Kind is never told by hue alone: a fail carries the word "failed" and a solid edge, a warn "warning" (or
 *     "asks first") and a dashed edge; info has neither.
 *   - Announcements go through two live regions that exist from page load (index.html): fail is assertive
 *     (role=alert), every other kind polite (role=status). The toasts themselves are not live regions.
 *   - Overflow: at most three shown, newest on top, and the newest is always shown (nothing arrives unseen). An
 *     older auto-leaving toast (info first, then warn) leaves to make room; a fail or persistent one never leaves
 *     for room, it waits hidden until a slot frees.
 */

import { displayText } from './render.js';

export type ToastKind = 'info' | 'warn' | 'fail';

/** At most this many toasts are shown at once (zone toasts, overflow). */
export const TOAST_MAX = 3;
/** info: 6 s (component toast, variant info). */
export const TOAST_INFO_MS = 6_000;
/** warn: the spec names no time; the conservative choice is longer than info. */
export const TOAST_WARN_MS = 10_000;
/** Text wraps to 4 lines at 44ch (zone toasts, overflow); the rest goes to title=. */
export const TOAST_LINES = 4;
export const TOAST_MEASURE_CH = 44;

/** How long a toast stays on its own, or null when it stays until closed or its cause is resolved. */
export function toastTtl(kind: ToastKind, persistent: boolean): number | null {
  if (persistent || kind === 'fail') return null;
  return kind === 'warn' ? TOAST_WARN_MS : TOAST_INFO_MS;
}

/** Which page live region announces it: fail interrupts (role=alert), every other kind waits its turn. */
export const toastLive = (kind: ToastKind): 'assertive' | 'polite' => (kind === 'fail' ? 'assertive' : 'polite');

/** The non-hue mark of a kind (rule status-in-ink: a word plus weight, never colour alone), or null for info. */
export function toastTag(kind: ToastKind, held: boolean): string | null {
  if (kind === 'fail') return 'failed';
  if (kind === 'warn') return held ? 'asks first' : 'warning';
  return null;
}

/** A fail or persistent toast carries a close key (component toast, anatomy); info and warn leave by themselves. */
export const toastClosable = (kind: ToastKind, persistent: boolean): boolean => persistent || kind === 'fail';

/** The CSS class of a toast (the edge colour goes by kind). */
export const toastClass = (kind: ToastKind): string => (kind === 'info' ? 'toast' : `toast ${kind}`);

export interface ToastEntry {
  id: number;
  kind: ToastKind;
  persistent: boolean;
}

/**
 * The overflow policy over the toasts in arrival order (oldest first). Returns the ids that leave now and the ids
 * shown, newest first. While more than TOAST_MAX are present, the oldest auto-leaving toast other than the newest
 * leaves (info before warn); a fail or persistent toast never leaves for room, it waits hidden until a slot frees.
 * The newest is always shown, so an info never arrives unseen behind fail and persistent ones.
 */
export function toastOverflow(entries: readonly ToastEntry[]): { drop: number[]; shown: number[] } {
  const keep = [...entries];
  const drop: number[] = [];
  const newest = entries[entries.length - 1]?.id;
  const leaves = (k: ToastKind): number => keep.findIndex((e) => !e.persistent && e.kind === k && e.id !== newest);
  while (keep.length > TOAST_MAX) {
    let i = leaves('info');
    if (i < 0) i = leaves('warn');
    if (i < 0) break;
    drop.push(keep[i]!.id);
    keep.splice(i, 1);
  }
  return { drop, shown: keep.slice(-TOAST_MAX).reverse().map((e) => e.id) };
}

/**
 * A refusal's text (app.ts refusalText: "CODE reason  message\n  next: a · b") as its main line and its next: line,
 * so a long refusal keeps next: visible while the main text is cut to 4 lines (zone toasts, overflow).
 */
export function splitToastText(text: string): { main: string; next: string | null } {
  const m = /\n\s*(next: [\s\S]*)$/.exec(text);
  if (!m) return { main: text, next: null };
  return { main: text.slice(0, m.index), next: m[1]!.trim() };
}

/** Whether the main text may not fit 4 lines at 44ch (then the full text goes in title= too). A cheap upper bound. */
export const toastMayClip = (main: string): boolean => main.length > TOAST_LINES * TOAST_MEASURE_CH || main.split('\n').length > TOAST_LINES;

/**
 * C5'b (8.0:local-lane): the kernel dropped a server's trust because it changed (a kernel-signed tool.trust{op:'dropped'}
 * with why launch-changed or tools-changed): a warn toast (10 s, not sticky) with the key Trust again…. A drop because it
 * was turned off (disabled), and a clear from Settings, raise no toast: the server's row says it. The name is the
 * server's as status.mcp lists it, as display text (a server's own words are untrusted).
 */
export function trustDropToastOf(row: { kind?: unknown; payload?: unknown }, status: unknown): { id: string; text: string } | null {
  if (row.kind !== 'tool.trust' || !row.payload || typeof row.payload !== 'object') return null;
  const p = row.payload as Record<string, unknown>;
  if (p.op !== 'dropped' || (p.why !== 'launch-changed' && p.why !== 'tools-changed') || typeof p.id !== 'string') return null;
  const m = status && typeof status === 'object' ? (status as { mcp?: { servers?: unknown; repos?: unknown } }).mcp : null;
  const repos = Array.isArray(m?.repos) ? (m.repos as Array<{ servers?: unknown }>) : [];
  const all = [...(Array.isArray(m?.servers) ? m.servers : []), ...repos.flatMap((r) => (r && Array.isArray(r.servers) ? r.servers : []))] as Array<{ id?: unknown; name?: unknown } | null>;
  const found = all.find((s) => s && s.id === p.id);
  const name = displayText(typeof found?.name === 'string' ? found.name : typeof p.label === 'string' ? p.label : 'an MCP server').slice(0, 64);
  const what = p.why === 'launch-changed' ? 'its command, arguments or environment changed' : 'its tool list changed';
  return { id: p.id, text: `${name} changed (${what}): Gnomon stopped trusting its tool labels. Its tools ask again; its Always rules are paused.` };
}

/** C5'b: the drop toast's kind and key (founder: warn, 10 s, not sticky). */
export const TRUST_DROP_TOAST = Object.freeze({ kind: 'warn' as ToastKind, key: 'Trust again…' });

/* ── C6'b2-2 (Mika): the "ran by rule" toast (variant rule-ran) ──────────────────────────────────────────────────── */

/** C6'a2-4: who started a call an Always rule passed (approval.auto{author}: 'human' a "/" run, absent the model). */
export type RuleRanBy = 'human' | 'model' | 'both';

export interface RuleRan {
  ruleId: string;
  hsid: string;
  tool: string;
  server: string;
  by: 'human' | 'model';
}

/**
 * A kernel approval.auto{modeRef:'rule:<ruleId>'} for an MCP tool (`mcp:<server>/<tool>`): an Always rule passed it with
 * no card. Anything else (an edit a mode allowed, a kernel tool, a malformed row) is null. The names are display text.
 * C6'a2-4: `by` is 'human' exactly when the row says author 'human' (a "/" run); no author is the model's call.
 */
export function ruleRanOf(row: { kind?: unknown; payload?: unknown }): RuleRan | null {
  if (row.kind !== 'approval.auto' || !row.payload || typeof row.payload !== 'object') return null;
  const p = row.payload as Record<string, unknown>;
  const ref = typeof p.modeRef === 'string' ? /^rule:(.{1,200})$/.exec(p.modeRef) : null;
  const m = typeof p.tool === 'string' ? /^mcp:([^/]{1,64})\/(.{1,64})$/.exec(p.tool) : null;
  if (!ref || !m || typeof p.hsid !== 'string') return null;
  return { ruleId: ref[1]!, hsid: p.hsid, server: displayText(m[1]!).slice(0, 64), tool: displayText(m[2]!).slice(0, 64), by: p.author === 'human' ? 'human' : 'model' };
}

export const RULE_RAN_TOAST = Object.freeze({
  key: 'Revoke',
  removing: 'Revoking…',
  removed: 'rule removed; its next call takes a card',
  /** a rule for a tool that can't be undone (or one the page cannot place) is a warn: amber, 10 s, paused on hover or focus */
  kind: (cls: 'destructive' | 'mutate' | null): ToastKind => (cls === 'mutate' ? 'info' : 'warn'),
  /** Mika C6'b2-2 #6: the key's accessible name says which rule */
  keyName: (t: Pick<RuleRan, 'tool' | 'server'>): string => `Revoke the rule for ${t.tool} on ${t.server}`,
});

/** One toast's passes so far: a pass by the other author makes it 'both'. */
export const ruleRanByMerge = (a: RuleRanBy, b: RuleRanBy): RuleRanBy => (a === b ? a : 'both');

const RULE_RAN_BY: Readonly<Record<RuleRanBy, string>> = Object.freeze({ human: 'by you from /', model: 'by the model', both: 'by you and the model' });

/**
 * "ran by rule · write on fs · by the model"; repeated passes of one rule: "ran 4 times by rule · … · by you and the
 * model" once both authors' calls passed it. WHO it ran for is the kernel's own approval.auto{author} (C6'a2-4): 'human'
 * a "/" run ("by you from /"), absent the model's call; the page never guesses.
 */
export function ruleRanText(t: Pick<RuleRan, 'tool' | 'server'>, n: number, by: RuleRanBy): string {
  return `${n > 1 ? `ran ${n} times by rule` : 'ran by rule'} · ${t.tool} on ${t.server} · ${RULE_RAN_BY[by]}`;
}

/** The Revoke key's request: remove the rule (it only tightens: no presence). */
export const ruleRevokeRequest = (ruleId: string): { kind: string; payload: { changes: Array<{ ruleId: string; op: 'remove' }> } } => ({ kind: 'request.rules.apply', payload: { changes: [{ ruleId, op: 'remove' }] } });

/** A refused or dropped Revoke, in words with next: (never the code). */
export function ruleRevokeFailWords(reason: string | null, network: boolean): string {
  if (network) return 'Not known whether the rule was removed: the connection dropped · next: look in Settings › Rules';
  if (reason === 'not-found') return 'Not removed: the rule is already gone · next: look in Settings › Rules';
  return 'Not removed: Gnomon refused it · next: look in Settings › Rules';
}
