/**
 * @symbol #gui-board-open
 *
 * How a board is opened from the app (boards S1.3 pass P4b-1; draft point 7). PURE: no DOM, no client. The rules of
 * `/board`, `/board <title>`, the ⋯ menu row, ⌥B and a row of the Dimensions list, as plans the dock (ui/board-dock.ts)
 * carries out on the ONE trusted event that asked; and the wrapper that feeds the followed log to both stores.
 *
 * `lastDim` and the listings are DISPLAY HINTS (core/dim-store.ts): the mod decides what a caller may open.
 */
import { DIM_LIMITS, sanitizeDisplayText } from '@a-company/gnomon-contracts';
import type { DimListing } from './dim-store.js';
import { sessionShort, type SessionNameOf } from './board-overlay.js';

/** `command`: a typed command. `menu`: every pointer entry and ⌥B. (The enum is hashed: no other value.) */
export type BoardOpenedHow = 'command' | 'menu';
/**
 * A press is `command` when it is a key that typed or chose a command, or the send key's click on a command the
 * person typed (`typed`); any other click, and ⌥B, are `menu`.
 */
export const openedHowOf = (event: { type: string }, altB = false, typed = false): BoardOpenedHow => (typed || (event.type === 'keydown' && !altB) ? 'command' : 'menu');

export type BoardPlan =
  /** nothing is sent: the line says why */
  | { type: 'none'; why: 'no-session' | 'no-board' }
  /** `dim.open` on a dimension the store holds (after `dim.attach` when this session is not attached: the session layer adds it, on the same press) */
  | { type: 'open'; dim: string; attach: boolean; reopens: boolean; title: string }
  /** `dim.open` of a NEW dimension with this title */
  | { type: 'new'; dim: string; title: string; titleFrom: 'session' | 'user' };

/**
 * A dimension title as it is sent: cleaned by the contracts' display sanitizer (a bidi control becomes a visible
 * mark, a zero-width joiner goes: the mod refuses invisible characters, so an emoji family or a pasted title would
 * be refused whole, and a listed title could reorder its row), one line, trimmed, cut at the title limit.
 */
export function boardTitleOf(text: string): string {
  const cut = (t: string): string => {
    let out = '';
    for (const ch of t) {
      if (out.length + ch.length > DIM_LIMITS.title) break;
      out += ch;
    }
    return out;
  };
  return cut(sanitizeDisplayText(text).text.replace(/\s+/g, ' ').trim()).trim();
}

/** `/board` and `/boards` as typed in the composer: the command and its argument, or null for anything else. */
export function parseBoardCommand(text: string): { cmd: 'board' | 'boards'; arg: string } | null {
  const m = /^\/(boards?)(?:[ \t]+([^\n]*))?$/.exec(text.trim());
  if (!m) return null;
  return { cmd: m[1] as 'board' | 'boards', arg: boardTitleOf(m[2] ?? '') };
}

export interface BoardAsk {
  hsid: string | null;
  /** `DimStore.lastDimOf(hsid)` */
  lastDim: string | null;
  /** the listing of `lastDim`, when the store holds it */
  last: Pick<DimListing, 'dim' | 'title' | 'ended' | 'attached'> | null;
  /** the session's name, for a new dimension's title */
  sessionName: string;
  /** a fresh dimension id */
  mintDim: () => string;
}

/** `/board` (no argument): the session's last dimension, else a new one titled with the session's name. `/board <title>`: a new one. */
export function planBoardCommand(a: BoardAsk, arg = ''): BoardPlan {
  if (!a.hsid) return { type: 'none', why: 'no-session' };
  const title = boardTitleOf(arg);
  if (title) return { type: 'new', dim: a.mintDim(), title, titleFrom: 'user' };
  if (a.lastDim && a.last) return { type: 'open', dim: a.lastDim, attach: !a.last.attached.includes(a.hsid), reopens: a.last.ended, title: a.last.title };
  return { type: 'new', dim: a.mintDim(), title: boardTitleOf(a.sessionName) || 'Board', titleFrom: 'session' };
}

/** The ⋯ menu row: as `/board` with no argument. */
export const planBoardMenu = (a: BoardAsk): BoardPlan => planBoardCommand(a);

/** ⌥B only reopens (or folds, the dock's part) a board this session already has: it never makes one. */
export function planBoardKey(a: BoardAsk): BoardPlan {
  if (!a.hsid) return { type: 'none', why: 'no-session' };
  if (!a.lastDim || !a.last) return { type: 'none', why: 'no-board' };
  return { type: 'open', dim: a.lastDim, attach: !a.last.attached.includes(a.hsid), reopens: a.last.ended, title: a.last.title };
}

/** A press on a row of the Dimensions list: attach (when this session is not attached) then open, on that press. */
export function planBoardRow(l: Pick<DimListing, 'dim' | 'title' | 'ended' | 'attached'>, hsid: string | null): BoardPlan {
  if (!hsid) return { type: 'none', why: 'no-session' };
  return { type: 'open', dim: l.dim, attach: !l.attached.includes(hsid), reopens: l.ended, title: l.title };
}

/** One row of the Dimensions list as it is drawn (design components.dimension-list.anatomy). */
export interface DimensionRow {
  dim: string;
  /** line 1: the title through the title check (aegis C4.2), 'Untitled' when it fails */
  title: string;
  /** hh:mm (today), 'Nov 24', or 'Nov 24 2025' when not this year, from the listing's `lastAt`; '' when unknown */
  time: string;
  /** the older short facts (the palette's first form): ended, partly held, still opening, not this session's */
  notes: string[];
  ended: boolean;
  attached: boolean;
  /** the open board's check (core/board-leaf.ts checkLine, from this page's session): its row reads 'open here · <check>' */
  check?: string;
  /** the mark: ● open somewhere, ○ folded, … was opening when the link dropped (ink only) */
  mark: '●' | '○' | '…';
  /** line 2: fixed words and host labels only (aegis C4.2, C4.3) */
  line2: string;
  /** the words line 2 drops first when it would be cut ('open here · '): the check is never cut (mika D4) */
  lead: string;
  /** line 2 is a mismatch's fact, in --fail */
  bad: boolean;
  /** this is the board open in this leaf: always the first row (mika D1), aria-checked */
  current: boolean;
  /** the attached sessions as the row was drawn (aegis C4.5: a press compares them with the listing at the press) */
  seen: { ended: boolean; attached: readonly string[] };
}

/** `lastAt` as the list prints it: hh:mm when it is today (by `now`), else `Mon D`, and `Mon D YYYY` when not this year (mika). */
export function listTime(lastAt: string | null, now: number): string {
  const t = lastAt ? Date.parse(lastAt) : Number.NaN;
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const n = new Date(now);
  const two = (v: number): string => String(v).padStart(2, '0');
  if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()) return `${two(d.getHours())}:${two(d.getMinutes())}`;
  const md = `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === n.getFullYear() ? md : `${md} ${d.getFullYear()}`;
}

/** A listed title as line 1 shows it (aegis C4.2): the leaf head's check, then no control or format character; 'Untitled' when nothing is left. */
export function listTitle(title: string): string {
  return boardTitleOf(String(title ?? '')).replace(/[\p{Cc}\p{Cf}]/gu, '').trim() || 'Untitled';
}

/** What the open board's row says of its check (from this page's session, never the listing: aegis C4.4). */
export interface ListCheck {
  line: string;
  bad: boolean;
}

/** The words of the list (design dimension-list anatomy line 2, state-notes). */
export const DIM_LIST_COPY = {
  openHere: 'open here · ',
  attaches: 'opening attaches this session',
  folded: 'folded · opening starts it again',
  foldedPart: 'folded · opening shows part of it',
  partShown: 'part of it is shown',
  wasOpening: 'didn’t finish opening · a press tries again',
  menuLabel: 'Dimensions in this project',
  find: 'Find a dimension…',
  findHint: '/boards',
  empty: 'No dimensions here yet · /board opens one',
  noSession: 'Open a session first',
  down: 'Not connected · nothing can be opened yet',
  opening: 'opening the board…',
} as const;

/** Who is attached, in line 2's form: this session first; a session the page cannot name is counted (aegis C4.3). */
function whoLine(attached: readonly string[], hsid: string | null, name: SessionNameOf | undefined): string {
  const order = hsid && attached.includes(hsid) ? [hsid, ...attached.filter((a) => a !== hsid)] : [...attached];
  if (!order.length) return '';
  const first = name?.(order[0]!) ?? null;
  if (!first) return `${order.length} ${order.length === 1 ? 'session' : 'sessions'}`;
  return `◇ ${sessionShort(first)}${order.length > 1 ? ` +${order.length - 1}` : ''}`;
}

/**
 * The Dimensions list: this repo's dimensions. The board open in this leaf first (mika D1), then the dimensions this
 * page asked to open whose rows it has not read (a session still opening when the link went: its `dim.open` may
 * have landed; listed so none is lost from sight), then the rest, newest first. Nothing in a row comes from a mark,
 * an agent's own words or a last row: the title, fixed words and the host's labels only (aegis 4).
 */
export function dimensionRows(listings: readonly DimListing[], hsid: string | null, opening: readonly { dim: string; title: string }[], now: number, o: { sessionName?: SessionNameOf; openDim?: string | null; check?: ListCheck | null } = {}): DimensionRow[] {
  const rows: DimensionRow[] = [...listings]
    .sort((a, b) => b.lastSeq - a.lastSeq)
    .map((l) => {
      const attached = !!hsid && l.attached.includes(hsid);
      const current = !!o.openDim && l.dim === o.openDim;
      const who = whoLine(l.attached, hsid, o.sessionName);
      let lead = '';
      let line2: string;
      let bad = false;
      if (current) {
        lead = DIM_LIST_COPY.openHere;
        line2 = o.check?.line ?? '';
        bad = !!o.check?.bad;
        if (!line2) lead = 'open here';
      } else if (l.ended) line2 = l.partial ? DIM_LIST_COPY.foldedPart : DIM_LIST_COPY.folded;
      else if (attached) line2 = `attached ${who.startsWith('◇') ? who : `· ${who}`}`;
      else line2 = who ? `${who} · ${DIM_LIST_COPY.attaches}` : DIM_LIST_COPY.attaches;
      if (!l.ended && l.partial) line2 = line2 ? `${line2} · ${DIM_LIST_COPY.partShown}` : DIM_LIST_COPY.partShown;
      const row: DimensionRow = { dim: l.dim, title: listTitle(l.title), time: listTime(l.lastAt, now), ended: l.ended, attached, notes: [...(l.ended ? ['folded'] : []), ...(l.partial ? ['partly held'] : []), ...(attached ? [] : ['not this session’s yet'])], mark: l.ended ? '○' : '●', line2, lead, bad, current, seen: { ended: l.ended, attached: [...l.attached] } };
      if (current && o.check) row.check = o.check.line;
      return row;
    });
  const have = new Set(rows.map((r) => r.dim));
  const pending: DimensionRow[] = opening.filter((p) => !have.has(p.dim)).map((p) => ({ dim: p.dim, title: listTitle(p.title), time: '', ended: false, attached: true, notes: ['was opening when the link went'], mark: '…', line2: DIM_LIST_COPY.wasOpening, lead: '', bad: false, current: false, seen: { ended: false, attached: [] } }));
  const cur = rows.filter((r) => r.current);
  return [...cur, ...pending, ...rows.filter((r) => !r.current)];
}

/** aegis C4.5: what the row said when it was drawn still holds at the press (ended, and who is attached). */
export function rowStillHolds(seen: DimensionRow['seen'], now: Pick<DimListing, 'ended' | 'attached'> | null): boolean {
  if (!now) return false;
  return now.ended === seen.ended && now.attached.length === seen.attached.length && now.attached.every((a) => seen.attached.includes(a));
}

/**
 * The listings the Dimensions list shows for a session. When the session's repo can be told, that repo's; when it
 * cannot (the GUI store holds the session's repo as a path and a listing's as the host's `repo:<hex>` scope, and
 * nothing the page reads joins the two), ONLY the dimensions this session is attached to: never another
 * session's, which may be another project's (choosing one was refused by the mod, over the wrong session).
 */
export function listingsFor(listings: readonly DimListing[], hsid: string | null, sessionRepo: string | null): DimListing[] {
  const repo = listRepoOf(listings, hsid, sessionRepo);
  if (repo) return listings.filter((l) => l.repo === repo);
  return hsid ? listings.filter((l) => l.attached.includes(hsid)) : [];
}

/** The repo whose dimensions the list shows for a session: the repo of a dimension it is attached to, else the session's own. */
export function listRepoOf(listings: readonly DimListing[], hsid: string | null, sessionRepo: string | null): string | null {
  const mine = hsid ? listings.find((l) => l.attached.includes(hsid) && l.repo) : undefined;
  if (mine?.repo) return mine.repo;
  return sessionRepo && listings.some((l) => l.repo === sessionRepo) ? sessionRepo : null;
}

/** What `followLog` needs of a store (core/client.ts). */
export interface FollowStore {
  cursor(): unknown;
  adopt(id: string): void;
  apply(rows: unknown[]): void;
  advance(n: number): void;
  reset(): void;
}

/**
 * ONE store for `followLog` that feeds BOTH: every row the GUI store takes (each backlog page, each followed row)
 * also goes to the dimension sessions, and a `cursor-epoch` reset resets both. The cursor is the GUI store's.
 */
export function followBoth<S extends FollowStore>(gui: S, dims: { apply(rows: readonly unknown[]): void; reset(): void }): S {
  // the log the dimension side was folded from. The GUI store clears itself when it adopts ANOTHER log id; the
  // dimension store, the sessions and the vouched hashes must go with it (Aegis L1): rows of two logs never mix.
  let log: string | null = null;
  return {
    cursor: () => gui.cursor(),
    adopt: (id: string) => {
      if (log !== null && log !== id) dims.reset();
      log = id;
      gui.adopt(id);
    },
    apply: (rows: unknown[]) => {
      gui.apply(rows);
      dims.apply(rows);
    },
    advance: (n: number) => gui.advance(n),
    reset: () => {
      log = null;
      gui.reset();
      dims.reset();
    },
  } as unknown as S;
}
