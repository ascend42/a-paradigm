/**
 * @symbol #gui-rules-view
 *
 * #gui-rules-view (8.0:rules-view; session 2026-10-23-gnomon-rules-view, Mika C1–C3, Aegis M2/L1/L2). PURE: the Rules
 * block of Settings › Permissions, its staging, the save bar's cost, the unsaved-close prompt and the request.
 *
 *   - Every rule, its words and its state come ONLY from the kernel's status.rules (rule-row: what · where · since ·
 *     state). The page never composes what a rule allows; the kernel does (rules.ts ruleWords).
 *   - Changes are STAGED in the page; nothing reaches the kernel until Save. Staged rows are marked by word and weight
 *     ("→ off for 1 hour"), never by a hue or the amber ◆; a removed row stays, struck through, with a "keep" key.
 *   - Turn off ▾ opens INLINE (like the card's Always ▾) with three presets whose ends the KERNEL clock names
 *     (status.rules.presets): "for 1 hour · until 15:07", "until tomorrow · 06:00", "until I turn it back on".
 *   - The save bar names its cost before the press: "Save · no Touch ID" when the batch only tightens, "Save · asks
 *     Touch ID or your Mac password once" when any rule turns back on. Save sends ONE request.rules.apply.
 *   - A refusal leaves every change staged and says so in plain words with `next:`. A card the same press could not
 *     decide (refused or waiting check) reads "card waiting · Decide in the stack".
 *   - Closing Settings with unsaved changes asks inline: "3 changes not saved · Save · Discard".
 *   - Grouped by repo with counts, newest first; a filter field above FILTER_AT rules. Planned for 0, 1, 5, 50, 200.
 *   - Folded (founder 2026-10-23: "folded works"): at FOLD_AT rules or more every repo group starts folded, showing its
 *     heading and count; the heading is the fold key (aria-expanded). A filter unfolds every group it matches; a group
 *     holding a staged change, an open Turn off ▾ or a rule waiting on a card stays unfolded (nothing staged hides).
 */
import type { ShownRefusal } from './client.js';

export const RULES_EMPTY = 'No Always rules yet. When you choose Always on a card, the rule shows here.';
/** Mika C1: the filter field shows above this many rules. */
export const FILTER_AT = 12;
/** Founder 2026-10-23 ("folded works"): at this many rules or more, each repo group starts folded. */
export const FOLD_AT = 50;
export const SAVE_LABEL = Object.freeze({ none: 'Save · no Touch ID', presence: 'Save · asks Touch ID or your Mac password once' });
export const CARD_WAITING = 'card waiting · Decide in the stack';
/** The waiting line: the narrowing is saved; the rules turning back on wait on the card (the key says where). */
export const waitingText = (saved: number, ons: number): string => `${saved ? `${changesWord(saved)} saved; ` : ''}${ons === 1 ? '1 rule comes' : `${ons} rules come`} back on when you allow its card.`;
/** A row whose turn-back-on waits on the card (no key: deciding the card is the next move). */
export const WAITING_ROW = '→ on again when you allow its card';
export const REMOVED_WORD = 'removed on save';
/** The request kind (dispatcher-only; contracts CLIENT_API_DESCRIPTOR.rulesView.request). */
export const RULES_APPLY_REQUEST = 'request.rules.apply';
/** Rows whose arrival changes status.rules (the page re-reads status on them). */
export const RULE_ROW_KINDS: ReadonlySet<string> = new Set(['approval.rule.learned', 'approval.rule.revoked', 'approval.rule.disabled', 'approval.rule.enabled', 'approval.mode.set']);

export type RulePreset = 'hour' | 'tomorrow' | 'manual';
export const RULE_PRESETS: readonly RulePreset[] = Object.freeze(['hour', 'tomorrow', 'manual'] as const);

export interface RuleItem {
  ruleId: string;
  match: string;
  tool: string;
  repoKey: string;
  repoName: string | null;
  words: string;
  learnedAt: string | null;
  hsid: string | null;
  state: 'on' | 'off';
  /** off only: the kernel-clock end, or null (until turned back on) */
  until: string | null;
}

export interface RulesStatus {
  built: boolean;
  now: string | null;
  presets: { hour: string | null; tomorrow: string | null };
  pendingCardId: string | null;
  rules: RuleItem[];
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** status.rules, fail-safe: anything unreadable is "not offered" (never a rule the kernel did not list). */
export function rulesStatusOf(status: unknown): RulesStatus {
  const none: RulesStatus = { built: false, now: null, presets: { hour: null, tomorrow: null }, pendingCardId: null, rules: [] };
  const s = status && typeof status === 'object' ? (status as { rules?: unknown }).rules : null;
  if (!s || typeof s !== 'object') return none;
  const o = s as Record<string, unknown>;
  const p = o.presets && typeof o.presets === 'object' ? (o.presets as Record<string, unknown>) : {};
  const rules = Array.isArray(o.rules)
    ? o.rules.flatMap((x): RuleItem[] => {
        if (!x || typeof x !== 'object') return [];
        const r = x as Record<string, unknown>;
        if (typeof r.ruleId !== 'string' || typeof r.words !== 'string' || typeof r.repoKey !== 'string' || (r.state !== 'on' && r.state !== 'off')) return [];
        return [{ ruleId: r.ruleId, match: str(r.match) ?? 'exact', tool: str(r.tool) ?? '?', repoKey: r.repoKey, repoName: str(r.repoName), words: r.words, learnedAt: str(r.learnedAt), hsid: str(r.hsid), state: r.state, until: r.state === 'off' ? str(r.until) : null }];
      })
    : [];
  return { built: o.built === true, now: str(o.now), presets: { hour: str(p.hour), tomorrow: str(p.tomorrow) }, pendingCardId: str(o.pendingCardId), rules };
}

/* ── staging ─────────────────────────────────────────────────────── */

/** A staged change. `off` keeps the end resolved when it was staged (the time its label named). */
export type Staged = { op: 'off'; preset: RulePreset; until: string } | { op: 'on' } | { op: 'remove' };

export interface RulesResult {
  kind: 'saved' | 'waiting' | 'refused';
  text: string;
  next?: string;
}

export interface RulesUi {
  staged: ReadonlyMap<string, Staged>;
  /** the row whose Turn off ▾ presets are open (inline), or null */
  offOpen: string | null;
  filter: string;
  saving: boolean;
  result: RulesResult | null;
  /** the card of a saved batch the same press could not decide: its ons wait in the stack */
  waiting: { cardId: string; ruleIds: string[] } | null;
  /** closing Settings was asked with changes staged: the inline "N changes not saved · Save · Discard" */
  closePrompt: boolean;
  /** FOLD_AT and up: the repo groups the human unfolded (true) or folded again (false); absent = the default */
  folds: ReadonlyMap<string, boolean>;
}

export function emptyRulesUi(): RulesUi {
  return { staged: new Map(), offOpen: null, filter: '', saving: false, result: null, waiting: null, closePrompt: false, folds: new Map() };
}

const withStaged = (ui: RulesUi, f: (m: Map<string, Staged>) => void): RulesUi => {
  const m = new Map(ui.staged);
  f(m);
  return { ...ui, staged: m, result: ui.result?.kind === 'saved' ? null : ui.result, closePrompt: ui.closePrompt && m.size > 0 };
};

/** Stage "off" with a preset; its end is the kernel's preset time as the page last read it (or 'manual'). */
export function stageOff(ui: RulesUi, ruleId: string, preset: RulePreset, rs: RulesStatus): RulesUi {
  const until = preset === 'manual' ? 'manual' : rs.presets[preset];
  if (!until) return ui; // the kernel named no time: nothing is staged
  return { ...withStaged(ui, (m) => m.set(ruleId, { op: 'off', preset, until })), offOpen: null };
}
export function stageOn(ui: RulesUi, ruleId: string): RulesUi {
  return withStaged(ui, (m) => m.set(ruleId, { op: 'on' }));
}
export function stageRemove(ui: RulesUi, ruleId: string): RulesUi {
  return { ...withStaged(ui, (m) => m.set(ruleId, { op: 'remove' })), offOpen: ui.offOpen === ruleId ? null : ui.offOpen };
}
/** "keep" (a removed row) and "undo" (any staged row): the rule goes back to what the kernel says. */
export function unstage(ui: RulesUi, ruleId: string): RulesUi {
  return withStaged(ui, (m) => m.delete(ruleId));
}
/** The fold key of a repo group: open a folded group, fold an open one. */
export function toggleFold(ui: RulesUi, repoKey: string, wasOpen: boolean): RulesUi {
  const m = new Map(ui.folds);
  m.set(repoKey, !wasOpen);
  return { ...ui, folds: m };
}
export function toggleOffMenu(ui: RulesUi, ruleId: string): RulesUi {
  return { ...ui, offOpen: ui.offOpen === ruleId ? null : ruleId };
}
export function discard(ui: RulesUi): RulesUi {
  return { ...ui, staged: new Map(), offOpen: null, result: null, closePrompt: false };
}

/** Drop staged changes for rules the kernel no longer lists, or that already are what was staged. */
export function reconcile(ui: RulesUi, rs: RulesStatus, cardPending: (cardId: string) => boolean): RulesUi {
  const by = new Map(rs.rules.map((r) => [r.ruleId, r]));
  let changed = false;
  const m = new Map<string, Staged>();
  for (const [id, st] of ui.staged) {
    const r = by.get(id);
    const done = !r || (st.op === 'on' && r.state === 'on');
    if (done) changed = true;
    else m.set(id, st);
  }
  let waiting = ui.waiting;
  let result = ui.result;
  if (waiting && !cardPending(waiting.cardId)) {
    const allOn = waiting.ruleIds.every((id) => by.get(id)?.state === 'on' || !by.has(id));
    result = allOn ? { kind: 'saved', text: 'the rules are back on.' } : { kind: 'refused', text: 'The card was not allowed: those rules stay off', next: 'turn them on again and save' };
    waiting = null;
    changed = true;
  }
  return changed ? { ...ui, staged: m, waiting, result, closePrompt: ui.closePrompt && m.size > 0 } : ui;
}

/** The cost of saving what is staged: any rule turning back on asks for presence once. */
export function saveCost(ui: RulesUi): 'none' | 'presence' {
  for (const st of ui.staged.values()) if (st.op === 'on') return 'presence';
  return 'none';
}
export const saveLabel = (ui: RulesUi): string => SAVE_LABEL[saveCost(ui)];
export const changesWord = (n: number): string => `${n} change${n === 1 ? '' : 's'}`;
/** Mika: closing with changes staged asks inline. */
export const closePromptText = (n: number): string => `${changesWord(n)} not saved`;

/** May Settings close now? With changes staged it may not: the inline prompt opens instead. */
export function beforeClose(ui: RulesUi): { close: boolean; ui: RulesUi } {
  if (ui.staged.size === 0 || ui.saving) return { close: ui.staged.size === 0, ui };
  return { close: false, ui: { ...ui, closePrompt: true, offOpen: null } };
}

/** The one request for what is staged, in the kernel's shape. */
export function applyRequest(ui: RulesUi): { kind: string; payload: { changes: Array<{ ruleId: string; op: 'off' | 'on' | 'remove'; until?: string }> } } | null {
  if (ui.staged.size === 0) return null;
  const changes = [...ui.staged].map(([ruleId, st]) => (st.op === 'off' ? { ruleId, op: st.op, until: st.until } : { ruleId, op: st.op }));
  return { kind: RULES_APPLY_REQUEST, payload: { changes } };
}

/** A kernel refusal, in plain words with next: (every change stays staged). */
export function refusedResult(r: ShownRefusal): RulesResult {
  const words: Record<string, string> = {
    'not-found': 'A rule changed while you were editing; nothing was saved.',
    'too-large': 'Too many rules to turn back on in one card; nothing was saved.',
    'too-many': 'Too many changes for one save; nothing was saved.',
    'until-past': 'That off time has passed; nothing was saved.',
    'card-pending': 'A card turning rules back on is still waiting; nothing was saved.',
    partial: 'Some changes were saved, then Gnomon stopped.',
  };
  // principle 5: what didn't happen and why, in plain words; the kernel's message (rule and card ids, the symbol) stays
  // in the raw view and the kernel log, never in this line (Mika 2026-10-23)
  const lead = (r.reason && words[r.reason]) || 'Gnomon refused the change; nothing was saved.';
  const hint = r.data && typeof r.data.hint === 'string' ? r.data.hint : r.next[0] ?? 'look at the list, then save again';
  return { kind: 'refused', text: lead, next: hint };
}

/** After Save: what the bar says and what stays staged (narrowing applied at once; ons wait on the card). */
export function afterSave(ui: RulesUi, out: { cardId: string | null; decided: boolean | null }): RulesUi {
  const n = ui.staged.size;
  if (!out.cardId || out.decided === true) return { ...ui, staged: new Map(), offOpen: null, saving: false, closePrompt: false, waiting: null, result: { kind: 'saved', text: `${changesWord(n)}.` } };
  const ons = [...ui.staged].filter(([, s]) => s.op === 'on').map(([id]) => id);
  return { ...ui, staged: new Map(), offOpen: null, saving: false, closePrompt: false, waiting: { cardId: out.cardId, ruleIds: ons }, result: { kind: 'waiting', text: waitingText(n - ons.length, ons.length) } };
}

/* ── words ───────────────────────────────────────────────────────── */

const pad = (n: number): string => String(n).padStart(2, '0');
const hm = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayOf = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "today 12:53" · "yesterday" · "Oct 19" (against the kernel's now). */
export function sinceText(iso: string | null, now: string | null): string {
  if (!iso) return 'since an earlier session';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'since an earlier session';
  const n = now ? new Date(now) : d;
  const days = Math.round((dayOf(n) - dayOf(d)) / 86_400_000);
  return days <= 0 ? `today ${hm(d)}` : days === 1 ? 'yesterday' : `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** An end time against the kernel's now: "15:07" · "tomorrow 06:00" · "Oct 25 06:00". */
export function endText(iso: string, now: string | null): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const n = now ? new Date(now) : d;
  const days = Math.round((dayOf(d) - dayOf(n)) / 86_400_000);
  return days <= 0 ? hm(d) : days === 1 ? `tomorrow ${hm(d)}` : `${MONTHS[d.getMonth()]} ${d.getDate()} ${hm(d)}`;
}

/** Mika C2: the presets, each naming its end by the kernel clock. */
export function presetLabel(p: RulePreset, rs: RulesStatus): string {
  if (p === 'manual') return 'until I turn it back on';
  const at = rs.presets[p];
  if (p === 'hour') return `for 1 hour${at ? ` · until ${endText(at, rs.now)}` : ''}`;
  return `until tomorrow${at ? ` · ${hm(new Date(at))}` : ''}`;
}

export function stateText(r: RuleItem, now: string | null): string {
  if (r.state === 'on') return 'on';
  return r.until ? `off until ${endText(r.until, now)}` : 'off';
}

/** Staged rows are marked by word and weight (never a hue, never ◆). */
export function stagedText(st: Staged): string {
  if (st.op === 'on') return '→ on again';
  if (st.op === 'remove') return REMOVED_WORD;
  return st.preset === 'hour' ? '→ off for 1 hour' : st.preset === 'tomorrow' ? '→ off until tomorrow' : '→ off until you turn it back on';
}

/* ── the block's view ────────────────────────────────────────────── */

export interface RuleKey {
  act: 'off-menu' | 'off' | 'on' | 'remove' | 'keep' | 'undo';
  label: string;
  value?: RulePreset;
  expanded?: boolean;
  quiet?: boolean;
}

export interface RuleRowView {
  ruleId: string;
  what: string;
  where: string;
  since: string;
  /** from the card asked in <session> (the title=) */
  from: string | null;
  state: string;
  off: boolean;
  staged: string | null;
  removed: boolean;
  offOpen: boolean;
  presets: RuleKey[];
  keys: RuleKey[];
}

export interface RuleGroupView {
  repoKey: string;
  label: string;
  count: number;
  off: number;
  /** FOLD_AT and up: the heading is a fold key */
  foldable: boolean;
  /** folded: the heading and its count only, no rows */
  folded: boolean;
  rows: RuleRowView[];
}

export interface SaveBarView {
  count: string;
  save: string;
  cost: 'none' | 'presence';
  busy: boolean;
}

export interface RulesBlockView {
  built: boolean;
  empty: string | null;
  summary: string;
  filter: { value: string; shown: boolean };
  groups: RuleGroupView[];
  /** when a filter hides every rule */
  noMatch: string | null;
  saveBar: SaveBarView | null;
  result: RulesResult | null;
  closePrompt: string | null;
  /** the close prompt's Save names the same cost as the bar's */
  closeSave: string;
}

const newestFirst = (a: RuleItem, b: RuleItem): number => (b.learnedAt ?? '').localeCompare(a.learnedAt ?? '');

export function rowView(r: RuleItem, ui: RulesUi, rs: RulesStatus, sessionName?: (hsid: string) => string | null): RuleRowView {
  const st = ui.staged.get(r.ruleId) ?? null;
  const offOpen = ui.offOpen === r.ruleId && !st;
  const waits = !st && r.state === 'off' && !!ui.waiting?.ruleIds.includes(r.ruleId);
  let keys: RuleKey[];
  if (waits) keys = [];
  else if (st) keys = [st.op === 'remove' ? { act: 'keep', label: 'keep' } : { act: 'undo', label: 'undo' }];
  else if (r.state === 'off') keys = [{ act: 'on', label: 'Turn on' }, { act: 'remove', label: 'Remove', quiet: true }];
  else keys = [{ act: 'off-menu', label: `Turn off ${offOpen ? '▴' : '▾'}`, expanded: offOpen }, { act: 'remove', label: 'Remove', quiet: true }];
  const name = r.hsid ? (sessionName?.(r.hsid) ?? null) : null;
  return {
    ruleId: r.ruleId,
    what: r.words,
    where: r.repoName ?? 'a repo not open now',
    since: sinceText(r.learnedAt, rs.now),
    from: name ? `from the card asked in ${name}` : r.hsid ? `from a card in session ${r.hsid.slice(-10)}` : null,
    state: stateText(r, rs.now),
    off: r.state === 'off',
    staged: st ? stagedText(st) : waits ? WAITING_ROW : null,
    removed: st?.op === 'remove',
    offOpen,
    presets: offOpen ? RULE_PRESETS.map((p) => ({ act: 'off' as const, label: presetLabel(p, rs), value: p })) : [],
    keys,
  };
}

const matches = (r: RuleItem, q: string): boolean => {
  if (!q) return true;
  const s = q.toLowerCase();
  return [r.words, r.repoName ?? '', r.tool].some((x) => x.toLowerCase().includes(s));
};

/** Mika C1: grouped by repo with counts, newest first (groups by their newest rule); the filter above FILTER_AT rules. */
export function rulesBlock(rs: RulesStatus, ui: RulesUi, sessionName?: (hsid: string) => string | null): RulesBlockView {
  const total = rs.rules.length;
  const off = rs.rules.filter((r) => r.state === 'off').length;
  const shown = total > FILTER_AT;
  const q = shown ? ui.filter.trim() : '';
  const by = new Map<string, RuleItem[]>();
  for (const r of [...rs.rules].sort(newestFirst)) {
    if (!matches(r, q) && !ui.staged.has(r.ruleId)) continue; // a staged row never hides behind the filter
    const g = by.get(r.repoKey) ?? [];
    g.push(r);
    by.set(r.repoKey, g);
  }
  // founder 2026-10-23 ("folded works"): at FOLD_AT rules or more each group starts folded; a filter unfolds what it
  // matches; a group holding anything staged, open or waiting stays unfolded (nothing staged hides behind a fold)
  const foldable = total >= FOLD_AT;
  const groups = [...by].map(([repoKey, list]) => {
    const all = rs.rules.filter((r) => r.repoKey === repoKey);
    const busy = list.some((r) => ui.staged.has(r.ruleId) || ui.offOpen === r.ruleId || !!ui.waiting?.ruleIds.includes(r.ruleId));
    const open = !foldable || !!q || busy || ui.folds.get(repoKey) === true;
    return { repoKey, label: all.find((r) => r.repoName)?.repoName ?? 'a repo not open now', count: all.length, off: all.filter((r) => r.state === 'off').length, foldable: foldable && !q && !busy, folded: !open, rows: open ? list.map((r) => rowView(r, ui, rs, sessionName)) : [] };
  });
  const n = ui.staged.size;
  return {
    built: rs.built,
    empty: rs.built && total === 0 ? RULES_EMPTY : null,
    summary: !rs.built ? 'not offered by this kernel' : total === 0 ? '' : `${total} rule${total === 1 ? '' : 's'}${off ? ` · ${off} off` : ''}${groups.length > 1 ? ` · ${groups.length} repos` : ''}`,
    filter: { value: ui.filter, shown },
    groups,
    noMatch: total > 0 && groups.length === 0 ? `No rule matches “${q}”.` : null,
    saveBar: n > 0 ? { count: changesWord(n), save: saveLabel(ui), cost: saveCost(ui), busy: ui.saving } : null,
    result: ui.result,
    closePrompt: ui.closePrompt && n > 0 ? closePromptText(n) : null,
    closeSave: saveLabel(ui),
  };
}

/** The 6 s toast when a rule comes back on by itself (a kernel-signed approval.rule.enabled{cause:'expired'}). */
export function expiryToastOf(row: { kind?: unknown; payload?: unknown }, rs: RulesStatus): string | null {
  if (row.kind !== 'approval.rule.enabled' || !row.payload || typeof row.payload !== 'object') return null;
  const p = row.payload as Record<string, unknown>;
  if (p.cause !== 'expired' || typeof p.ruleId !== 'string') return null;
  const r = rs.rules.find((x) => x.ruleId === p.ruleId);
  return `rule back on: ${r ? r.words : 'an Always rule'}`;
}
