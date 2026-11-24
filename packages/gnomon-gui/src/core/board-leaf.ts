/**
 * @symbol #gui-board
 *
 * The board leaf's words and states (design component board-leaf). PURE: no DOM. Copy is the design's, verbatim;
 * the one line the design does not give (an image was refused) is marked.
 */
export type LeafLoad = 'loading' | 'ready' | 'failed';
export type LeafState = 'loading' | 'failed' | 'too-short' | 'yielded' | 'empty' | 'open';

/** Under this much board height the leaf cannot be drawn on (design `heights`). */
export const BOARD_MIN_HEIGHT = 148;
/** Under this the head drops '› board' (design `widths`; a container query in styles.css does it). */
export const HEAD_MEDIUM_MIN = 520;
/** Nothing but the head shows for this long while the chunk loads (no flash). */
export const LOADING_QUIET_MS = 300;

export function leafStateOf(s: { load: LeafLoad; alive: boolean; boardHeight: number; cardFocused: boolean; marks: number }): LeafState {
  if (s.load === 'loading') return 'loading';
  if (s.load === 'failed' || !s.alive) return 'failed';
  if (s.boardHeight < BOARD_MIN_HEIGHT) return 'too-short';
  if (s.cardFocused) return 'yielded';
  return s.marks === 0 ? 'empty' : 'open';
}

export const LEAF_COPY = {
  medium: '› board',
  loading: 'opening the board…',
  yielded: 'A card has the keys · click the board to draw',
  tooShort: 'The window is too short to draw here · make it taller, or decide the pinned cards',
  emptyTitle: 'Nothing drawn yet',
  emptyHint: 'N for a sticky · T to write · or pick a tool and draw.',
  failedTitle: 'The board didn’t open',
  failedNext: 'next: Try again, or Esc to go back to the chat',
  tryAgain: 'Try again',
  stubNote: 'not drawn by this Gnomon · kept as it is',
  unknownHand: 'unknown hand',
} as const;

/**
 * What the leaf says under its head when the board refused something. NOT in the design: proposed here for Luna
 * (what happened, then what to do; no code, no engine word). One line per kind of core/board.ts BoardRefusal.
 */
export const REFUSAL_COPY = {
  image: 'Images can’t go on a board yet · draw or write it instead',
  'scene-file': 'Board files can’t be dropped here · nothing was changed',
  'library-file': 'Library files can’t be dropped here · draw the shapes',
  file: 'Files can’t be dropped on a board · write or draw it instead',
  mark: 'Part of what you pasted isn’t a board mark · it was left out',
  // short enough for the leaf at a 1024 window (the line is one row: longer words were cut off there)
  fallback: 'This Gnomon can’t draw that mark · it is kept as it is',
  paste: 'Nothing there can be pasted as words · nothing was added',
  text: 'That is too long for one mark · nothing was changed',
  clipboard: 'Those copied marks are no longer held · copy them again',
} as const;
export const refusalLine = (what: keyof typeof REFUSAL_COPY): string => REFUSAL_COPY[what];
/** Lines of the leaf's own copy register (proposed for Luna). A copy takes 64 marks at most; a cut takes all of the selection or nothing. */
export const CLIP_COPY = {
  leftOut: (n: number): string => `${n} ${n === 1 ? 'mark was' : 'marks were'} left out of the copy · 64 at most, and only marks this Gnomon can draw`,
  cutRefused: 'That can’t all be cut at once · nothing was cut · cut 64 marks or fewer',
  notStored: 'That mark isn’t saved yet · try again in a moment',
} as const;

export type OpenedHow = 'command' | 'menu' | 'offer';
/** '<how>' of the keep line: '/board', 'the ⋯ menu', '<agent>’s offer'. */
export const openedFrom = (how: OpenedHow, agent?: string): string => (how === 'command' ? '/board' : how === 'menu' ? 'the ⋯ menu' : `${agent ?? 'an agent'}’s offer`);

/** The keep line's parts, in order; the leaf joins them with ' · ' and puts the project swatch before the project. */
export function keepParts(k: { project: string; session: string; more?: number; how: OpenedHow; agent?: string; time: string }): { project: string; session: string; opened: string; time: string } {
  return { project: k.project, session: `${k.session}${k.more ? ` +${k.more}` : ''}`, opened: `opened from ${openedFrom(k.how, k.agent)}`, time: k.time };
}

/** Why the board did not open, in plain words. No code and no engine text: those go to the raw view. */
export function failedCause(error: unknown, afterMount: boolean): string {
  const m = error instanceof Error ? error.message : String(error ?? '');
  if (afterMount) return 'The drawing engine stopped. Your marks are saved as they were made.';
  if (/in time/.test(m)) return 'It took too long to load.';
  if (/stylesheet|did not load|did not export|text face/.test(m)) return 'A part of it did not load.';
  return 'The drawing engine did not start.';
}

/** A dimension title in the edge tab: cut at 24 characters with … (the whole title stays in title=). */
export const TAB_TITLE_MAX = 24;
export const tabTitle = (title: string): string => ([...title].length > TAB_TITLE_MAX ? `${[...title].slice(0, TAB_TITLE_MAX - 1).join('')}…` : title);
