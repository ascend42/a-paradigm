/**
 * @symbol #gui-board-open
 *
 * How a board is opened from the app (boards S1.3 pass P4b-1; draft point 7). PURE: no DOM, no client. The rules of
 * `/board`, `/board <title>`, the ⋯ menu row, ⌥B and a row of the Dimensions list, as plans the dock (ui/board-dock.ts)
 * carries out on the ONE trusted event that asked; and the wrapper that feeds the followed log to both stores.
 *
 * `lastDim` and the listings are DISPLAY HINTS (core/dim-store.ts): the mod decides what a caller may open.
 */
import { DIM_LIMITS } from '@a-company/gnomon-contracts';
import type { DimListing } from './dim-store.js';

/** `command`: a typed command. `menu`: every pointer entry and ⌥B. (The enum is hashed: no other value.) */
export type BoardOpenedHow = 'command' | 'menu';
/** A press is `command` only when it is a key that typed or chose a command; a click, and ⌥B, are `menu`. */
export const openedHowOf = (event: { type: string }, altB = false): BoardOpenedHow => (event.type === 'keydown' && !altB ? 'command' : 'menu');

export type BoardPlan =
  /** nothing is sent: the line says why */
  | { type: 'none'; why: 'no-session' | 'no-board' }
  /** `dim.open` on a dimension the store holds (after `dim.attach` when this session is not attached: the session layer adds it, on the same press) */
  | { type: 'open'; dim: string; attach: boolean; reopens: boolean; title: string }
  /** `dim.open` of a NEW dimension with this title */
  | { type: 'new'; dim: string; title: string; titleFrom: 'session' | 'user' };

/** A dimension title as it is sent: one line, trimmed, cut at the title limit. */
export function boardTitleOf(text: string): string {
  return [...text.replace(/\s+/g, ' ').trim()].slice(0, DIM_LIMITS.title).join('');
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

/** One row of the Dimensions list as it is drawn. */
export interface DimensionRow {
  dim: string;
  title: string;
  /** hh:mm (today) or the date, from the listing's `lastAt` (the kernel's time of its last row); '' when unknown */
  time: string;
  /** what the row says after its time: ended, partly held, still opening, not this session's */
  notes: string[];
  ended: boolean;
  attached: boolean;
}

/** `lastAt` as the list prints it: hh:mm when it is today (by `now`), else `Mon D`. */
export function listTime(lastAt: string | null, now: number): string {
  const t = lastAt ? Date.parse(lastAt) : Number.NaN;
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const n = new Date(now);
  const two = (v: number): string => String(v).padStart(2, '0');
  if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()) return `${two(d.getHours())}:${two(d.getMinutes())}`;
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getDate()}`;
}

/**
 * The Dimensions list: this repo's dimensions, newest first. `opening` are dimensions this page asked to open whose
 * rows it has not read (a session still opening when the link went: its `dim.open` may have landed): they are
 * listed too, so none is lost from sight.
 */
export function dimensionRows(listings: readonly DimListing[], hsid: string | null, opening: readonly { dim: string; title: string }[], now: number): DimensionRow[] {
  const rows: DimensionRow[] = [...listings]
    .sort((a, b) => b.lastSeq - a.lastSeq)
    .map((l) => {
      const attached = !!hsid && l.attached.includes(hsid);
      return { dim: l.dim, title: l.title || 'Untitled', time: listTime(l.lastAt, now), ended: l.ended, attached, notes: [...(l.ended ? ['folded'] : []), ...(l.partial ? ['partly held'] : []), ...(attached ? [] : ['not this session’s yet'])] };
    });
  const have = new Set(rows.map((r) => r.dim));
  const pending = opening.filter((o) => !have.has(o.dim)).map((o) => ({ dim: o.dim, title: o.title || 'Untitled', time: '', ended: false, attached: true, notes: ['was opening when the link went'] }));
  return [...pending, ...rows];
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
  return {
    cursor: () => gui.cursor(),
    adopt: (id: string) => gui.adopt(id),
    apply: (rows: unknown[]) => {
      gui.apply(rows);
      dims.apply(rows);
    },
    advance: (n: number) => gui.advance(n),
    reset: () => {
      gui.reset();
      dims.reset();
    },
  } as unknown as S;
}
