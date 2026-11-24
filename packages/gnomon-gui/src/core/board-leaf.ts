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
  drag: 'Nothing can be dropped on a board · paste the words instead',
  mark: 'Part of what you pasted isn’t a board mark · it was left out',
  // short enough for the leaf at a 1024 window (the line is one row: longer words were cut off there)
  fallback: 'This Gnomon can’t draw that mark · it is kept as it is',
  paste: 'Only words can be pasted on a board · nothing was added',
  text: 'That is too long for one mark',
  clipboard: 'Those copied marks are no longer held · copy them again',
} as const;
export const refusalLine = (what: keyof typeof REFUSAL_COPY): string => REFUSAL_COPY[what];
/** The line for a refusal as the handle reports it: some kinds have their own words by reason, and a length limit is said. */
export function refusalLineOf(r: { what: keyof typeof REFUSAL_COPY; why?: string; detail?: string }): string {
  if (r.why === 'no-file-paste') return 'Files can’t be pasted on a board · write or draw it instead';
  if (r.why === 'not-stored') return CLIP_COPY.notStored;
  if (r.what === 'text' && r.why === 'too-long' && /^\d+$/.test(r.detail ?? '')) return `One mark holds ${Number(r.detail).toLocaleString('en-US')} characters · paste or type less`;
  return REFUSAL_COPY[r.what];
}
/** Lines of the leaf's own copy register (proposed for Luna). A copy takes 64 marks at most; a cut takes all of the selection or nothing. */
export const CLIP_COPY = {
  // (Mika's wording: about 59 characters fit the leaf at a 1024 window)
  leftOut: (n: number): string => `${n} ${n === 1 ? 'mark was' : 'marks were'} left out · a copy takes 64 at most`,
  cutRefused: 'Nothing was cut · a cut takes 64 marks at most',
  notStored: 'That mark isn’t saved yet · try again in a moment',
} as const;

/**
 * What the leaf says for a notice of the live loop (core/dim-session.ts `DimSessionNotice`). A STAND-IN table,
 * proposed for Luna: the pass that mounts the leaf in the app owns the keep line's words. Plain words only: a
 * notice's `code`, `field` and `why` are never shown. Every line fits the leaf at a 1024 window.
 */
export function noticeLine(n: { about: string; code: string; lost: number }): string {
  if (n.about === 'link') return 'Not saved · reconnecting';
  if (n.code === 'link-down') return 'The link is down · that change wasn’t saved';
  if (n.code === 'redo-unavailable') return 'Redo isn’t on the board yet';
  if (n.code === 'undo-nothing') return 'Nothing to undo';
  if (n.about === 'undo') return 'That can’t be undone any more';
  if (n.about === 'open') return 'The dimension didn’t open · try again';
  if (n.about === 'close') return 'The dimension didn’t close · try again';
  if (n.code === 'hash-mismatch') return 'This board may be out of date · fold it and open it again';
  if (n.code === 'too-large' || n.code === 'row-too-large') return 'That is too much for one change · do it in smaller parts';
  if (n.code === 'busy') return 'Too many changes are waiting · try again in a moment';
  if (n.code === 'not-sent' || n.code === 'gesture-refused') return 'That change wasn’t sent · do it again';
  if (n.code === 'timeout' || n.code === 'no-answer') return 'That change wasn’t saved · do it again';
  return n.lost > 1 ? `${n.lost} changes weren’t kept · the board is as it was` : 'That change wasn’t kept · the board is as it was';
}

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
