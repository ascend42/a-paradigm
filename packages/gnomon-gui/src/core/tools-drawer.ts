/**
 * @symbol #gui-capability-browser
 *
 * #gui-capability-browser (8.0:local-lane slice C6'b1; Mika's design, TD-2026-10-28-956 and -969). PURE: the "Tools and
 * memory" drawer of a local, attended session in every state, its words, and the requests a press sends. The DOM and the
 * press paths are ui/tools-drawer.ts (ToolsFlow, modelled on TierFlow and TrustFlow); the kernel side is C6'a1
 * (request.session.capabilities, request.session.mcp.restart, session.mcp rows; local-session.ts #capabilities).
 *
 *   - ONE right drawer (the sheet's drawer variant, as Voice settings), seg keys "Tools · Memory". Opened from the ⋯ more
 *     menu, the tier key's menu (its last item) and the palette. No new header key. Local attended sessions only.
 *   - Tools: h3 sections over readonly rows with keys: Now offered · tier N · n of k; Pins · n of 8; Servers (the C5'b
 *     trust chip and the class counts); All tools (a filter at FILTER_AT tools, grouped by server with Gnomon's own
 *     verbs first, a group folds at FOLD_AT tools: the Rules block's fold).
 *   - Class is a word, never a hue: reads · changes · can't be undone. Availability is a word: offered now · findable ·
 *     / only · not at tier N · manual mode: reads only. No kernel code (a fit, a pin why, a refusal reason) is ever shown
 *     raw: every one maps to plain words here, and an unknown one to a generic sentence.
 *   - Memory: "From you and Gnomon" (goal, facts, your pins) and "Data the model and tools wrote" (notes, file-refs, the
 *     last failing tool; model-text-control's dashed edge and the label "data"). All text is text nodes (render.ts h()).
 *   - Every server-written string (a label, a tool name, a description, an error) passes displayText and is capped.
 */
import { displayText } from './render.js';
import { trustChipOf } from './mcp-servers.js';
import { FILTER_AT, FOLD_AT } from './rules.js';
import type { FormKey, ResultView, SettingRow } from './settings.js';

export const CAPABILITIES_REQUEST = 'request.session.capabilities' as const;
export const MCP_RESTART_REQUEST = 'request.session.mcp.restart' as const;
export const TOOLS_PIN_REQUEST = 'request.session.tools.pin' as const;
export const MEMORY_READ_REQUEST = 'request.session.memory.read' as const;
export const MEMORY_LIST_REQUEST = 'request.session.memory.list' as const;
export const MEMORY_DELETE_REQUEST = 'request.session.memory.delete' as const;
/** The kernel's MAX_TOOL_PINS and MAX_MODEL_NOTES (working-memory.ts). */
export const MAX_PINS = 8;
export const MAX_MODEL_NOTES = 16;
/** The filter field shows at this many tools (the Rules block's FILTER_AT); a server group folds at FOLD_AT. */
export const TOOLS_FILTER_AT = FILTER_AT;
export const TOOLS_FOLD_AT = FOLD_AT;
/** The group of Gnomon's own verbs (first in All tools). */
export const GNOMON_GROUP = 'Gnomon';

export type Seg = 'tools' | 'memory';
export type ToolClass = 'read' | 'mutate' | 'destructive';
export type Availability = 'offered' | 'findable' | 'slash-only' | 'not-at-tier' | 'manual-reads-only';
export type ServerState = 'running' | 'starting' | 'not-started' | 'refused' | 'failed';

/* ── copy (Mika) ─────────────────────────────────────────────────────────────────────────────────────────────────── */

export const TOOLS_COPY = Object.freeze({
  title: 'Tools and memory',
  seg: Object.freeze({ tools: 'Tools', memory: 'Memory' }) as Readonly<Record<Seg, string>>,
  segLabel: 'Tools and memory',
  open: 'Tools and memory…',
  reading: 'Reading this session’s tools…',
  readingMemory: 'Reading this session’s memory…',
  tier0: 'This model gets no tools at tier 0.',
  changeTier: 'Change tier…',
  noServers: 'No MCP servers in this session.',
  noServersHow: 'Servers you turn on in Settings › MCP servers start in the sessions you open after.',
  noOffered: 'Nothing offered yet: tools are picked at the model’s next step.',
  noPins: 'No pins. Pin a tool under All tools to keep it offered.',
  ended: 'This session has ended: its tools are gone. What it kept is under Memory.',
  notOwner: 'Only the person who opened this session can see its tools',
  notOwnerMemory: 'Only the person who opened this session can see its memory',
  unreachable: 'Can’t reach the kernel: nothing was read · next: Read again once Gnomon is connected',
  unreadable: 'The kernel’s answer was not one this page reads · next: Read again',
  again: 'Read again',
  filter: 'Filter',
  filterPlaceholder: 'tool, server or words',
  noMatch: 'No tool matches the filter.',
  pin: 'Pin',
  unpin: 'Unpin',
  restart: 'Restart server',
  restarting: 'Restarting…',
  stage: 'Stage in Settings',
  slashOnly: 'the model can’t use this one; run it from /',
  pinsFull: `${MAX_PINS} pins: unpin one first`,
  memory: Object.freeze({
    empty: 'No working memory yet. It fills when you send a prompt.',
    yours: 'From you and Gnomon',
    data: 'Data the model and tools wrote',
    tag: 'data',
    delete: 'Delete memory…',
    confirm: 'Delete this session’s working memory? The model loses its goal and notes. The conversation stays.',
    confirmEnded: 'Delete this session’s working memory? The conversation stays.',
    yes: 'Delete memory',
    yesStop: 'Delete and end session',
    keep: 'Keep',
    deleting: 'Deleting…',
    done: 'Memory deleted. The conversation still shows what was said.',
    doneLive: 'Memory deleted',
    doneStopped: 'Memory deleted and the session ended. The conversation still shows what was said.',
  }),
  kept: Object.freeze({
    label: 'Kept memory',
    how: 'The working memory of sessions that ended stays on this Mac until you delete it.',
    open: 'Open',
    delete: 'Delete',
    confirm: 'Delete this ended session’s working memory? The conversation stays.',
    none: 'none',
  }),
});

/** Class, never a hue. */
export const CLASS_WORD: Readonly<Record<ToolClass, string>> = Object.freeze({ read: 'reads', mutate: 'changes', destructive: 'can’t be undone' });

/** Availability as its word (a tier for "not at tier N"). */
export function availabilityWord(a: Availability, tier: number | null): string {
  switch (a) {
    case 'offered':
      return 'offered now';
    case 'findable':
      return 'findable';
    case 'slash-only':
      return '/ only';
    case 'not-at-tier':
      return `not at tier ${tier ?? '?'}`;
    default:
      return 'manual mode: reads only';
  }
}

/**
 * Why a pin is not offered, in words. Takes the capabilities reply's whys (over-k, no-room, no-full-form, tier-0) AND the
 * selector's own codes the tier preview carries (over-slot, not-offerable): the C4'b preview printed them raw ("over k").
 */
export function pinWhyWords(why: string | null | undefined, at: { tier: number | null; k: number | null }): string {
  switch (why) {
    case 'over-k':
      return `waits: tier ${at.tier ?? '?'} offers ${at.k ?? '?'} tool${at.k === 1 ? '' : 's'}`;
    case 'no-room':
    case 'over-slot':
      return 'no room in its tool space';
    case 'no-full-form':
    case 'not-offerable':
      return 'this tier can’t show its arguments';
    case 'tier-0':
      return 'tier 0 has no tools';
    default:
      return 'not offered at this tier';
  }
}

/** A refusal's fit (session.mcp{fit} and the capabilities' refused servers) as plain words, a next: step, and a key. */
export function fitWords(fit: string | null | undefined): { text: string; next: string; key?: 'stage' } {
  switch (fit) {
    case 'remote-refused':
      return { text: 'local sessions only reach servers on this Mac', next: 'run it on this Mac and turn that copy on in Settings' };
    case 'launch-writable':
      return { text: 'it runs from a folder this session can edit', next: 'open the session in another folder, or move the server out of this one' };
    case 'label-reserved':
      return { text: 'another server has this name', next: 'rename one of them where it is configured' };
    case 'pin-mismatch':
      return { text: 'Paradigm isn’t staged', next: 'Stage in Settings', key: 'stage' };
    case 'disabled':
      return { text: 'it was turned off in Settings after this session opened', next: 'open a new session' };
    case 'trust-changed':
      return { text: 'its trust changed', next: 'open a new session' };
    default:
      return { text: 'Gnomon won’t start it in this session', next: 'open a new session' };
  }
}

/** The short cause of a failure (the first clause of a cleaned error), for a toast. */
export function shortCause(error: unknown, max = 80): string {
  const s = displayText(typeof error === 'string' ? error : '').replace(/\s+/g, ' ').trim() || 'it failed';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/* ── the kernel's answer, shape-checked ──────────────────────────────────────────────────────────────────────────── */

export interface CapTool {
  id: string;
  name: string;
  server: string;
  class: ToolClass;
  humanOnly: boolean;
  availability: Availability;
  description: string;
}
export interface CapServer {
  label: string;
  trust: 'enabled' | 'trusted' | 'first-party';
  state: ServerState;
  fit: string | null;
  error: string | null;
  starts: number;
  counts: { read: number; mutate: number; destructive: number };
}
export interface CapPin {
  name: string;
  offered: boolean;
  why: string | null;
}
export interface Capabilities {
  hsid: string;
  generation: number;
  tier: number | null;
  k: number | null;
  mode: string | null;
  verbs: Array<{ name: string; class: ToolClass }>;
  servers: CapServer[];
  pins: CapPin[];
  tools: CapTool[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nat = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
/** Untrusted text: the one sanitizer, then capped (a server's own words). */
export const shown = (v: unknown, n = 240): string => {
  const s = typeof v === 'string' ? displayText(v) : '';
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
const CLASSES: readonly string[] = ['read', 'mutate', 'destructive'];
const AVAIL: readonly string[] = ['offered', 'findable', 'slash-only', 'not-at-tier', 'manual-reads-only'];
const STATES: readonly string[] = ['running', 'starting', 'not-started', 'refused', 'failed'];
const isClass = (v: unknown): v is ToolClass => typeof v === 'string' && CLASSES.includes(v);

/** request.session.capabilities' answer, every string cleaned; null when it is not one (the drawer says so). */
export function capabilitiesOf(v: unknown, hsid: string): Capabilities | null {
  if (!isObj(v) || v.hsid !== hsid || !nat(v.generation)) return null;
  if (!(v.tier === null || (nat(v.tier) && v.tier <= 3)) || !(v.k === null || v.k === undefined || nat(v.k))) return null;
  if (!Array.isArray(v.servers) || !Array.isArray(v.pins) || !Array.isArray(v.tools) || !Array.isArray(v.verbs)) return null;
  const servers: CapServer[] = v.servers.filter(isObj).filter((s) => typeof s.label === 'string' && typeof s.state === 'string' && STATES.includes(s.state)).map((s) => {
    const c = isObj(s.counts) ? s.counts : {};
    return {
      label: shown(s.label, 64),
      trust: s.trust === 'trusted' || s.trust === 'first-party' ? s.trust : 'enabled',
      state: s.state as ServerState,
      fit: typeof s.fit === 'string' ? s.fit : null,
      error: typeof s.error === 'string' ? shown(s.error) : null,
      starts: nat(s.starts) ? s.starts : 0,
      counts: { read: nat(c.read) ? c.read : 0, mutate: nat(c.mutate) ? c.mutate : 0, destructive: nat(c.destructive) ? c.destructive : 0 },
    };
  });
  const pins: CapPin[] = v.pins.filter(isObj).filter((p) => typeof p.name === 'string').map((p) => ({ name: shown(p.name, 64), offered: p.offered === true, why: typeof p.why === 'string' ? p.why : null }));
  const tools: CapTool[] = v.tools.filter(isObj).filter((t) => typeof t.id === 'string' && typeof t.name === 'string' && typeof t.server === 'string' && isClass(t.class) && typeof t.availability === 'string' && AVAIL.includes(t.availability)).map((t) => ({
    id: shown(t.id, 160),
    name: shown(t.name, 64),
    server: shown(t.server, 64),
    class: t.class as ToolClass,
    humanOnly: t.humanOnly === true,
    availability: t.availability as Availability,
    description: shown(t.description),
  }));
  const verbs = v.verbs.filter(isObj).filter((x) => typeof x.name === 'string' && isClass(x.class)).map((x) => ({ name: shown(x.name, 64), class: x.class as ToolClass }));
  return { hsid, generation: v.generation, tier: v.tier as number | null, k: nat(v.k) ? v.k : null, mode: typeof v.mode === 'string' ? shown(v.mode, 32) : null, verbs, servers, pins, tools };
}

/* ── memory ──────────────────────────────────────────────────────────────────────────────────────────────────────── */

export interface MemEntry {
  id: string;
  kind: 'goal' | 'fact' | 'note' | 'file-ref' | 'tool-pin';
  source: string;
  text: string;
}
const KINDS: readonly string[] = ['goal', 'fact', 'note', 'file-ref', 'tool-pin'];

/** request.session.memory.read's entries, cleaned; null when it is not one. */
export function memoryOf(v: unknown, hsid: string): { live: boolean; entries: MemEntry[] } | null {
  if (!isObj(v) || v.hsid !== hsid || !Array.isArray(v.entries)) return null;
  const entries = v.entries.filter(isObj).filter((e) => typeof e.id === 'string' && typeof e.kind === 'string' && KINDS.includes(e.kind) && typeof e.source === 'string' && typeof e.text === 'string').map((e) => ({ id: shown(e.id, 16), kind: e.kind as MemEntry['kind'], source: shown(e.source, 80), text: shown(e.text, 700) }));
  return { live: v.live === true, entries };
}

/** Whose words an entry is: the human's or the kernel's (goal, facts, your pins), else data (model or tool text). */
export function isYours(e: MemEntry): boolean {
  if (e.kind === 'note' || e.kind === 'file-ref') return false;
  if (e.kind === 'tool-pin') return e.source === 'human';
  // a goal from unverified voice (tool:voice) renders as data in the kernel's block too
  return e.source === 'human' || e.source === 'kernel';
}

/** An entry's label: what it is, in a word. */
export function entryLabel(e: MemEntry): string {
  if (e.kind === 'tool-pin') return e.source === 'human' ? 'your pin' : 'last failing tool';
  if (e.kind === 'file-ref') return 'file';
  if (e.kind === 'note') return 'note';
  if (e.kind === 'goal') return e.source === 'human' || e.source === 'kernel' ? 'goal' : 'goal (heard)';
  return 'fact';
}

/** The text an entry shows: the kernel's own prefixes dropped ("pinned tool: ", "last failing tool: "). */
export function entryText(e: MemEntry): string {
  return e.text.replace(/^(pinned tool|last failing tool): /, '');
}

/** "3 of 16 model notes" */
export function notesLine(entries: readonly MemEntry[]): string {
  const n = entries.filter((e) => e.kind === 'note').length;
  return `${n} of ${MAX_MODEL_NOTES} model notes`;
}

/* ── what the page knows from the session's rows ─────────────────────────────────────────────────────────────────── */

interface RowLike {
  kind: string;
  payload?: unknown;
}

/** The capability ids the last find_tool brought in, and the tools that ran lately (the word "found" and "recent"). */
export function selectionHintsOf(rows: Iterable<RowLike>, hsid: string, recentRuns = 8): { found: Set<string>; recent: Set<string> } {
  let found = new Set<string>();
  const ran: string[] = [];
  for (const r of rows) {
    const p = isObj(r.payload) ? r.payload : null;
    if (!p || p.hsid !== hsid) continue;
    if (r.kind === 'session.open') {
      found = new Set();
      ran.length = 0;
    } else if (r.kind === 'tool.selection' && Array.isArray(p.found)) {
      if (p.trigger === 'find') found = new Set(p.found.filter((x): x is string => typeof x === 'string'));
    } else if (r.kind === 'tool.brokered' && p.decision === 'ran' && typeof p.tool === 'string' && typeof p.server === 'string') ran.push(`${p.server}/${p.tool}`);
  }
  return { found, recent: new Set(ran.slice(-recentRuns)) };
}

/** The word on a Now offered row: pinned, found, recent or ranked (the first that holds). */
export function offeredWord(t: CapTool, pins: readonly CapPin[], hints: { found: Set<string>; recent: Set<string> }): 'pinned' | 'found' | 'recent' | 'ranked' {
  if (pins.some((p) => p.name === t.name)) return 'pinned';
  if (hints.found.has(t.id)) return 'found';
  if (hints.recent.has(`${t.server}/${t.name}`)) return 'recent';
  return 'ranked';
}

/**
 * The servers of a session that are off now (the chat header's "· 1 server off"): the last session.mcp row of each server
 * is failed, or refused after the server had started or failed in this session (a server refused at open never ran).
 */
export function serversOffOf(rows: Iterable<RowLike>, hsid: string): number {
  const last = new Map<string, string>();
  const ran = new Set<string>();
  for (const r of rows) {
    const p = isObj(r.payload) ? r.payload : null;
    if (r.kind === 'session.open' && p?.hsid === hsid) {
      last.clear();
      ran.clear();
      continue;
    }
    if (r.kind !== 'session.mcp' || !p || p.hsid !== hsid || typeof p.server !== 'string' || typeof p.state !== 'string') continue;
    if (p.state === 'refused' && !ran.has(p.server)) continue;
    if (p.state === 'started' || p.state === 'failed') ran.add(p.server);
    last.set(p.server, p.state);
  }
  return [...last.values()].filter((s) => s === 'failed' || s === 'refused').length;
}

/** The header meta part: "· 1 server off", "· 2 servers off", or '' (plain meta text, never a chip). */
export const serversOffText = (n: number): string => (n > 0 ? ` · ${n} server${n === 1 ? '' : 's'} off` : '');

/** A live session.mcp{state:'failed'} row as its toast: "<server> stopped: <short cause>", with the key "see Tools". */
export function mcpFailToastOf(row: RowLike): { hsid: string; server: string; text: string } | null {
  const p = isObj(row.payload) ? row.payload : null;
  if (row.kind !== 'session.mcp' || !p || p.state !== 'failed' || typeof p.hsid !== 'string' || typeof p.server !== 'string') return null;
  const server = shown(p.server, 64);
  return { hsid: p.hsid, server, text: `${server} stopped: ${shortCause(p.error)}` };
}
export const MCP_FAIL_TOAST = Object.freeze({ kind: 'fail' as const, key: 'see Tools' });

/* ── who may open it ─────────────────────────────────────────────────────────────────────────────────────────────── */

export type Access = 'owner' | 'not-owner' | 'ended';
/** Whether the drawer is offered for a session (local, attended), and what it may show. */
export function drawerAccess(i: { backend: string | null; loop: boolean; live: boolean; owner: string | null; me: string | null }): Access | null {
  if (i.backend !== 'local' || i.loop) return null;
  if (i.owner === null || i.me === null || i.owner !== i.me) return 'not-owner';
  return i.live ? 'owner' : 'ended';
}

/* ── the drawer's state and views ────────────────────────────────────────────────────────────────────────────────── */

export type ReadPhase = 'reading' | 'loaded' | 'unreachable' | 'unreadable';
export interface MemoryUi {
  phase: ReadPhase | 'gone';
  entries: MemEntry[];
  confirm: boolean;
  deleting: 'memory' | 'stop' | null;
  result: ResultView | null;
}
export interface DrawerUi {
  hsid: string;
  title: string;
  access: Access;
  seg: Seg;
  phase: ReadPhase;
  caps: Capabilities | null;
  /** "12:53" once a re-read moved the generation or a server row came */
  updatedAt: string | null;
  filter: string;
  folds: ReadonlyMap<string, boolean>;
  /** the tool name whose pin is in flight */
  pinBusy: string | null;
  /** server labels whose restart is in flight */
  restarting: ReadonlySet<string>;
  /** a restart's outcome under its server's row */
  serverResult: { label: string; result: ResultView } | null;
  /** a pin's refusal under the Pins heading */
  pinResult: ResultView | null;
  memory: MemoryUi;
}
export const emptyMemoryUi = (): MemoryUi => ({ phase: 'reading', entries: [], confirm: false, deleting: null, result: null });

export interface Notice {
  text: string;
  fail?: boolean;
  key?: { act: string; label: string };
}

/** One tool row of All tools (a rule-row: name, then class · availability, then its description; a Pin key). */
export interface ToolRowView {
  name: string;
  meta: string;
  description: string;
  key: FormKey | null;
  /** the visible why of an aria-disabled Pin (linked by aria-describedby) */
  why: string | null;
}
export interface ToolGroupView {
  label: string;
  count: number;
  foldable: boolean;
  folded: boolean;
  rows: ToolRowView[];
}
export interface ToolsView {
  /** a line above everything (tier 0, ended, not the owner, unreachable, reading) and its key */
  notice: Notice | null;
  sections: Array<{ id: string; title: string; rows: SettingRow[]; result?: ResultView | null }>;
  all: { title: string; filter: { shown: boolean; value: string }; groups: ToolGroupView[]; noMatch: string | null } | null;
}

/** The Pin key of a tool (or null: Gnomon's own verbs are not pinnable), with the why when it is aria-disabled. */
export function pinKeyOf(t: CapTool, ui: Pick<DrawerUi, 'pinBusy'>, pins: readonly CapPin[]): { key: FormKey | null; why: string | null } {
  const pinned = pins.some((p) => p.name === t.name);
  const busy = ui.pinBusy === t.name ? { busy: true, ariaDisabled: true } : {};
  if (pinned) return { key: { act: 'unpin', value: t.name, label: TOOLS_COPY.unpin, quiet: true, pressed: true, ...busy }, why: null };
  let why: string | null = null;
  if (t.availability === 'slash-only') why = TOOLS_COPY.slashOnly;
  else if (t.humanOnly && t.availability === 'not-at-tier') why = pinWhyWords('no-full-form', { tier: null, k: null });
  else if (pins.length >= MAX_PINS) why = TOOLS_COPY.pinsFull;
  return { key: { act: 'pin', value: t.name, label: TOOLS_COPY.pin, quiet: true, pressed: false, ...(why ? { ariaDisabled: true } : busy) }, why };
}

const countsWords = (c: CapServer['counts']): string => `${c.read} ${CLASS_WORD.read} · ${c.mutate} ${CLASS_WORD.mutate} · ${c.destructive} ${CLASS_WORD.destructive}`;
const trustLevel = (t: CapServer['trust']): 'untrusted' | 'trusted' | 'first-party' => (t === 'enabled' ? 'untrusted' : t);

/** A server's row: its state in words (a refusal in plain words with next:), its trust chip, its class counts, its key. */
export function serverRow(s: CapServer, ui: Pick<DrawerUi, 'restarting' | 'serverResult'>, n: number): SettingRow {
  const chip = trustChipOf({ level: trustLevel(s.trust), why: null })!;
  const restarting = ui.restarting.has(s.label);
  let value: string;
  let how = countsWords(s.counts);
  let mark: string | undefined;
  const keys: FormKey[] = [];
  switch (s.state) {
    case 'running':
      value = 'running';
      mark = '✓';
      break;
    case 'starting':
      value = 'starting…';
      break;
    case 'not-started':
      value = 'not started (tier 0)';
      break;
    case 'refused': {
      const w = fitWords(s.fit);
      value = `refused: ${w.text}`;
      mark = '✕';
      how = `next: ${w.next}`;
      if (w.key === 'stage') keys.push({ act: 'stage', value: s.label, label: TOOLS_COPY.stage, quiet: true });
      break;
    }
    default:
      value = `stopped after ${s.starts} start${s.starts === 1 ? '' : 's'}: ${s.error ?? 'it failed'}`;
      mark = '✕';
      how = `${how} · next: Restart server`;
      keys.push({ act: 'restart', value: s.label, label: restarting ? TOOLS_COPY.restarting : TOOLS_COPY.restart, ...(restarting ? { busy: true, ariaDisabled: true } : {}) });
  }
  return { kind: 'readonly', id: `td-server-${n}`, label: s.label, value, how, chip, ...(mark ? { mark } : {}), ...(keys.length ? { keys } : {}) };
}

const matches = (q: string, ...xs: string[]): boolean => !q || xs.some((x) => x.toLowerCase().includes(q));

/** The Tools segment in its state. */
export function toolsView(ui: DrawerUi, hints: { found: Set<string>; recent: Set<string> } = { found: new Set(), recent: new Set() }): ToolsView {
  const none = (notice: Notice): ToolsView => ({ notice, sections: [], all: null });
  if (ui.access === 'not-owner') return none({ text: TOOLS_COPY.notOwner });
  if (ui.access === 'ended') return none({ text: TOOLS_COPY.ended, key: { act: 'seg-memory', label: TOOLS_COPY.seg.memory } });
  if (ui.phase === 'reading' && !ui.caps) return none({ text: TOOLS_COPY.reading });
  if (ui.phase === 'unreachable' && !ui.caps) return none({ text: TOOLS_COPY.unreachable, fail: true, key: { act: 'again', label: TOOLS_COPY.again } });
  if (ui.phase === 'unreadable' || !ui.caps) return none({ text: TOOLS_COPY.unreadable, fail: true, key: { act: 'again', label: TOOLS_COPY.again } });
  const c = ui.caps;
  const at = { tier: c.tier, k: c.k };
  const sections: ToolsView['sections'] = [];
  const zero = c.tier === 0;
  // 1. Now offered
  if (!zero) {
    const offered = c.tools.filter((t) => t.availability === 'offered');
    const rows: SettingRow[] = offered.map((t, n) => ({ kind: 'readonly', id: `td-offered-${n}`, label: t.name, value: `${t.server} · ${offeredWord(t, c.pins, hints)}`, how: '' }));
    if (!rows.length) rows.push({ kind: 'readonly', id: 'td-offered-none', label: '', value: TOOLS_COPY.noOffered, how: '' });
    sections.push({ id: 'offered', title: `Now offered · tier ${c.tier ?? '?'} · ${offered.length} of ${c.k ?? '?'}`, rows });
  }
  // 2. Pins
  const pinRows: SettingRow[] = c.pins.map((p, n) => {
    const t = c.tools.find((x) => x.name === p.name);
    const busy = ui.pinBusy === p.name ? { busy: true, ariaDisabled: true } : {};
    return { kind: 'readonly', id: `td-pin-${n}`, label: p.name, value: p.offered ? 'offered now' : pinWhyWords(p.why ?? (zero ? 'tier-0' : null), at), how: t ? t.server : '', keys: [{ act: 'unpin', value: p.name, label: TOOLS_COPY.unpin, quiet: true, pressed: true, ...busy }] };
  });
  if (!pinRows.length) pinRows.push({ kind: 'readonly', id: 'td-pin-none', label: '', value: TOOLS_COPY.noPins, how: '' });
  sections.push({ id: 'pins', title: `Pins · ${c.pins.length} of ${MAX_PINS}`, rows: pinRows, result: ui.pinResult });
  // 3. Servers
  const srvRows: SettingRow[] = c.servers.map((s, n) => serverRow(s, ui, n));
  if (!srvRows.length) srvRows.push({ kind: 'readonly', id: 'td-server-none', label: '', value: TOOLS_COPY.noServers, how: TOOLS_COPY.noServersHow });
  sections.push({ id: 'servers', title: 'Servers', rows: srvRows, result: ui.serverResult?.result ?? null });
  if (zero) return { notice: { text: TOOLS_COPY.tier0, key: { act: 'tier', label: TOOLS_COPY.changeTier } }, sections, all: null };
  // 4. All tools: Gnomon's verbs first, then each server's tools
  const total = c.verbs.length + c.tools.length;
  const shownFilter = total >= TOOLS_FILTER_AT;
  const q = shownFilter ? ui.filter.trim().toLowerCase() : '';
  const groups: ToolGroupView[] = [];
  const verbRows: ToolRowView[] = c.verbs.filter((v) => matches(q, v.name, GNOMON_GROUP)).map((v) => ({ name: v.name, meta: `${CLASS_WORD[v.class]} · ${availabilityWord(zero ? 'not-at-tier' : 'offered', c.tier)}`, description: 'Gnomon’s own verb', key: null, why: null }));
  if (c.verbs.length) groups.push(groupOf(GNOMON_GROUP, c.verbs.length, verbRows, ui, q));
  const servers = [...new Set(c.tools.map((t) => t.server))];
  for (const sv of servers) {
    const all = c.tools.filter((t) => t.server === sv);
    const rows = all.filter((t) => matches(q, t.name, t.server, t.description)).map((t) => {
      const k = pinKeyOf(t, ui, c.pins);
      return { name: t.name, meta: `${CLASS_WORD[t.class]} · ${availabilityWord(t.availability, c.tier)}`, description: t.description, key: k.key, why: k.why };
    });
    groups.push(groupOf(sv, all.length, rows, ui, q));
  }
  const shownGroups = groups.filter((g) => !q || g.rows.length);
  return { notice: null, sections, all: { title: `All tools · ${total}`, filter: { shown: shownFilter, value: ui.filter }, groups: shownGroups, noMatch: q && !shownGroups.length ? TOOLS_COPY.noMatch : null } };
}

function groupOf(label: string, count: number, rows: ToolRowView[], ui: Pick<DrawerUi, 'folds'>, q: string): ToolGroupView {
  const foldable = count >= TOOLS_FOLD_AT;
  // the Rules block's fold: folded by default at FOLD_AT; a filter unfolds what it matches; the human's choice holds
  const folded = foldable && !q && (ui.folds.get(label) === undefined ? true : !ui.folds.get(label));
  return { label, count, foldable, folded, rows };
}

/** The fold key of a group: open a folded one, fold an open one. */
export function toggleFold(folds: ReadonlyMap<string, boolean>, label: string, foldedNow: boolean): Map<string, boolean> {
  const m = new Map(folds);
  m.set(label, foldedNow);
  return m;
}

export interface MemoryView {
  notice: Notice | null;
  line: string | null;
  yours: SettingRow[];
  data: SettingRow[];
  /** the foot: the quiet Delete key, or the inline confirm */
  foot: { confirm: string | null; keys: FormKey[] };
  result: ResultView | null;
}

/** The Memory segment in its state. */
export function memoryView(ui: DrawerUi): MemoryView {
  const m = ui.memory;
  const blank = (notice: Notice): MemoryView => ({ notice, line: null, yours: [], data: [], foot: { confirm: null, keys: [] }, result: m.result });
  if (ui.access === 'not-owner') return blank({ text: TOOLS_COPY.notOwnerMemory });
  if (m.phase === 'reading') return blank({ text: TOOLS_COPY.readingMemory });
  if (m.phase === 'unreachable') return blank({ text: TOOLS_COPY.unreachable, fail: true, key: { act: 'again', label: TOOLS_COPY.again } });
  if (m.phase === 'unreadable') return blank({ text: TOOLS_COPY.unreadable, fail: true, key: { act: 'again', label: TOOLS_COPY.again } });
  const row = (e: MemEntry, n: number, pre: string): SettingRow => ({ kind: 'readonly', id: `td-mem-${pre}-${n}`, label: entryLabel(e), value: entryText(e), how: '' });
  const yours = m.entries.filter(isYours).map((e, n) => row(e, n, 'y'));
  const data = m.entries.filter((e) => !isYours(e)).map((e, n) => row(e, n, 'd'));
  const empty = m.phase === 'gone' || m.entries.length === 0;
  const busy = m.deleting;
  const ended = ui.access === 'ended';
  const keys: FormKey[] = empty
    ? []
    : m.confirm
      ? [
          { act: 'mem-delete', label: busy === 'memory' ? TOOLS_COPY.memory.deleting : TOOLS_COPY.memory.yes, pri: true, ...(busy === 'memory' ? { busy: true, ariaDisabled: true } : busy ? { ariaDisabled: true } : {}) },
          ...(ended ? [] : [{ act: 'mem-delete-stop', label: busy === 'stop' ? TOOLS_COPY.memory.deleting : TOOLS_COPY.memory.yesStop, ...(busy === 'stop' ? { busy: true, ariaDisabled: true } : busy ? { ariaDisabled: true } : {}) }]),
          { act: 'mem-keep', label: TOOLS_COPY.memory.keep, quiet: true, ...(busy ? { ariaDisabled: true } : {}) },
        ]
      : [{ act: 'mem-confirm', label: TOOLS_COPY.memory.delete, quiet: true }];
  return {
    notice: empty && !m.result ? { text: TOOLS_COPY.memory.empty } : null,
    line: empty ? null : notesLine(m.entries),
    yours,
    data,
    foot: { confirm: m.confirm && !empty ? (ended ? TOOLS_COPY.memory.confirmEnded : TOOLS_COPY.memory.confirm) : null, keys },
    result: m.result,
  };
}

/** The head's meta line: "updated 12:53" (after a re-read moved the generation), else the session's title. */
export const drawerMeta = (ui: Pick<DrawerUi, 'updatedAt' | 'title'>): string => (ui.updatedAt ? `${ui.title} · updated ${ui.updatedAt}` : ui.title);

/* ── outcomes ────────────────────────────────────────────────────────────────────────────────────────────────────── */

/** A refusal (code, reason, data) in plain words with next: for a pin, a restart or a memory delete. Never the code. */
export function refusalWords(what: 'pin' | 'restart' | 'delete', r: { reason: string | null; data: Record<string, unknown> | null } | null): string {
  const reason = r?.reason ?? null;
  if (what === 'restart' && reason === 'refused') {
    const w = fitWords(typeof r?.data?.fit === 'string' ? r.data.fit : null);
    return `Not restarted: ${w.text} · next: ${w.next}`;
  }
  if (what === 'restart' && reason === 'busy') return 'Not restarted: it is already starting · next: wait for it, then look again';
  if (what === 'pin' && reason === 'full') return `Not pinned: ${TOOLS_COPY.pinsFull}`;
  const lead = what === 'pin' ? 'Not pinned' : what === 'restart' ? 'Not restarted' : 'Not deleted';
  if (reason === 'not-found') return what === 'delete' ? `${lead}: Gnomon holds no memory for this session any more · next: close this and look again` : `${lead}: this session isn’t running any more · next: open a new session`;
  if (r === null) return `${lead}: nothing was sent, the connection dropped · next: try again once Gnomon is connected`;
  return `${lead}: the kernel refused it · next: close this and try again`;
}

/** The live line after a pin: "Pinned X; offered from the next step", or why it waits. */
export function pinLive(name: string, pinned: boolean, pin: CapPin | null, at: { tier: number | null; k: number | null }): string {
  if (!pinned) return `Unpinned ${name}`;
  if (!pin || pin.offered) return `Pinned ${name}; offered from the next step`;
  return `Pinned ${name}; ${pinWhyWords(pin.why, at)}`;
}

/* ── requests ────────────────────────────────────────────────────────────────────────────────────────────────────── */

export type DrawerRequest = { kind: string; payload: Record<string, unknown> };
export const capabilitiesRequest = (hsid: string): DrawerRequest => ({ kind: CAPABILITIES_REQUEST, payload: { hsid } });
export const restartRequest = (hsid: string, server: string): DrawerRequest => ({ kind: MCP_RESTART_REQUEST, payload: { hsid, server } });
export const pinRequest = (hsid: string, name: string, pinned: boolean): DrawerRequest => ({ kind: TOOLS_PIN_REQUEST, payload: { hsid, name, pinned } });
export const memoryReadRequest = (hsid: string): DrawerRequest => ({ kind: MEMORY_READ_REQUEST, payload: { hsid } });
export const memoryListRequest = (): DrawerRequest => ({ kind: MEMORY_LIST_REQUEST, payload: {} });
export const memoryDeleteRequest = (hsid: string, stop: boolean): DrawerRequest => ({ kind: MEMORY_DELETE_REQUEST, payload: stop ? { hsid, stop: true } : { hsid } });

/* ── Settings › Local model: Kept memory ─────────────────────────────────────────────────────────────────────────── */

export interface KeptUi {
  /** the ended sessions that keep memory (request.session.memory.list, live false), oldest first; null: not read */
  sessions: Array<{ hsid: string; title: string }> | null;
  /** the hsid whose Delete asks inline */
  confirm: string | null;
  busy: string | null;
  result: ResultView | null;
}
export const emptyKeptUi = (): KeptUi => ({ sessions: null, confirm: null, busy: null, result: null });

/** request.session.memory.list's ended sessions (live false). */
export function keptOf(v: unknown): string[] | null {
  if (!isObj(v) || !Array.isArray(v.sessions)) return null;
  return v.sessions.filter(isObj).filter((s) => typeof s.hsid === 'string' && s.live !== true).map((s) => s.hsid as string);
}

/** The rows Settings › Local model gets: "Kept memory · N sessions", then each with Open and Delete (confirmed inline). */
export function keptRows(k: KeptUi): SettingRow[] {
  if (k.sessions === null) return [];
  const n = k.sessions.length;
  const rows: SettingRow[] = [{ kind: 'readonly', id: 'kept-memory', label: TOOLS_COPY.kept.label, value: n ? `${n} session${n === 1 ? '' : 's'}` : TOOLS_COPY.kept.none, how: TOOLS_COPY.kept.how, grp: true, live: true }];
  k.sessions.forEach((s, i) => {
    if (k.confirm === s.hsid) {
      const busy = k.busy === s.hsid;
      rows.push({ kind: 'form', id: `kept-${i}`, label: s.title, keys: [], confirm: { label: `Delete the memory of ${s.title}`, text: TOOLS_COPY.kept.confirm, keys: [{ act: 'kept:delete-yes', value: s.hsid, label: busy ? TOOLS_COPY.memory.deleting : TOOLS_COPY.memory.yes, pri: true, ...(busy ? { busy: true, ariaDisabled: true } : {}) }, { act: 'kept:keep', value: s.hsid, label: TOOLS_COPY.memory.keep, quiet: true, ...(busy ? { ariaDisabled: true } : {}) }] } });
    } else rows.push({ kind: 'readonly', id: `kept-${i}`, label: s.title, value: 'ended · memory kept', how: '', keys: [{ act: 'kept:open', value: s.hsid, label: TOOLS_COPY.kept.open, quiet: true }, { act: 'kept:delete', value: s.hsid, label: TOOLS_COPY.kept.delete, quiet: true, ...(k.busy ? { ariaDisabled: true } : {}) }] });
  });
  if (k.result) rows.push({ kind: 'form', id: 'kept-result', label: '', keys: [], result: k.result });
  return rows;
}
