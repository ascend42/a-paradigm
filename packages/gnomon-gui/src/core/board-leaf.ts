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
export function noticeLine(n: { about: string; code: string; lost: number; why?: string | null }): string {
  if (n.code === 'link-down' && n.about !== 'link') return 'The link is down · that change wasn’t saved';
  if (n.code === 'redo-unavailable') return 'Redo isn’t on the board yet';
  if (n.code === 'undo-nothing') return 'Nothing to undo';
  if (n.code === 'reconnected') return 'Reconnected · everything here is saved';
  if (n.about === 'link' && n.code === 'link-down') return INERT_COPY['link-down'];
  if (n.code === 'out-of-date') return INERT_COPY['out-of-date'];
  if (n.code === 'closing') return 'The board is folding · that change wasn’t made';
  if (n.code === 'not-saved') return n.lost > 1 ? `${n.lost} changes weren’t saved before the link came back` : 'One change wasn’t saved before the link came back';
  // (Aegis N1: the limit is said only to a person who went over it; 50 shapes with 20 tied arrows did not)
  if (n.code === 'not-undoable') return n.why !== 'delete' ? 'Nothing was changed · that is too much for one change' : n.lost > 64 ? 'Nothing was deleted · a delete takes 64 marks at most' : 'Nothing was deleted · select fewer marks and try again';
  if (n.about === 'undo') return 'That was too much to undo · it stays as it is';
  if (n.about === 'open') {
    // why the mod refused, in plain words: retrying the same thing fails the same way, so the line says what to change
    if (n.why === 'title-bad' || n.why === 'title-missing') return 'That title can’t be used · try plain words';
    if (n.why === 'title-secret') return 'That title looks like a credential · use another';
    if (n.why === 'repo-mismatch') return 'That board belongs to another project';
    if (n.why === 'not-attached') return 'This session isn’t attached to that board';
    if (n.why === 'dim-cap') return 'There are too many boards here · no more can be made';
    return 'The board didn’t open · try again';
  }
  // (a fold is sent only after what was pending has settled: what was drawn is in the log)
  if (n.about === 'close') return 'Your marks are saved · the board didn’t fold · try again';
  if (n.code === 'hash-mismatch') return 'This board may be out of date · fold it and open it again';
  if (n.code === 'too-large' || n.code === 'row-too-large') return 'That is too much for one change · do it in smaller parts';
  if (n.code === 'busy') return 'Too many changes are waiting · try again in a moment';
  if (n.code === 'not-sent' || n.code === 'gesture-refused') return 'That change wasn’t sent · do it again';
  // (a command that left and was never answered may have been written: the line does not say it was not)
  if (n.code === 'timeout' || n.code === 'no-answer') return n.lost > 1 ? `${n.lost} changes may not be saved · fold and reopen to check` : 'That change may not be saved · fold and reopen to check';
  return n.lost > 1 ? `${n.lost} changes weren’t kept · the board is as it was` : 'That change wasn’t kept · the board is as it was';
}

/** What the leaf shows, for as long as it lasts, while the board is held still (the link is down; the fold is out of date). */
export const INERT_COPY = {
  'link-down': 'Reconnecting',
  'out-of-date': 'This board is out of date · fold it and open it again',
} as const;
export type LeafInert = keyof typeof INERT_COPY;

/**
 * The keep line's state of the live loop, from `DimSession.status()`: null while everything is saved (the leaf then
 * shows its usual keep line). Minimal words, in the keep line's own slot; the final words are the next pass's.
 */
export function keepStateLine(s: { keep: 'saved' | 'saving' | 'not-saved'; link: 'up' | 'down'; pending: number; phase?: string; partial?: boolean; dropped?: number }): string | null {
  if (s.link === 'down') return linkDownLine(s);
  if (s.phase === 'opening') return 'Opening…';
  if (s.phase === 'closing') return 'Folding…';
  if (s.keep === 'saving') return 'Saving…';
  if (s.keep === 'not-saved') return 'Not saved';
  if ((s.dropped ?? 0) > 0) return KEEP_COPY.dropped;
  if (s.partial) return KEEP_COPY.partial;
  return null;
}
/** Minimal words of the keep line's own states (boards S1.3 P4b-1; Luna rules them in the next pass). */
export const KEEP_COPY = {
  notSavedDown: 'Not saved · reconnecting',
  dropped: 'Part of this board could not be held · marks are missing',
  partial: 'Earlier marks are not shown · this is part of the board',
  wordsHeld: 'Not connected · your words are kept on this page only',
  wordsHeldBack: 'Reconnecting · your words are kept on this page only',
  notConnected: 'Not connected',
  notSavedOff: 'Not saved · not connected',
  // (kept up for as long as the words are held; Mika's wording cut to fit the leaf at a 1024 window)
  wordsWait: 'Your words are waiting · T, then click, gets them back',
  wordsBack: 'Your words are back · click away to save them',
  wordsGone: 'The words you were typing were not saved',
  reconnected: 'Reconnected',
  copyDown: 'Nothing was copied · copy it again once reconnected',
  foldedDown: 'Folded while reconnecting · unsaved changes were dropped',
  reopens: 'That dimension had ended · opening it starts it again',
  noSession: 'Open a session first',
  wordsAndChangesGone: (n: number): string => `Your typed words and ${n === 1 ? 'one change' : `${n} changes`} were not saved`,
  changesGone: (n: number): string => (n === 1 ? 'One change on the board was not saved' : `${n} changes on the board were not saved`),
  cardWaits: 'A card needs you · finish the text on the board first',
  noBoard: 'This session has no board yet',
} as const;
/** The held-still line while the link is down: `Reconnecting` alone unless something of the person's is not saved. */
export function linkDownLine(s: { keep: 'saved' | 'saving' | 'not-saved'; pending: number }, o: { unsaved?: number; words?: boolean; coming?: boolean } = {}): string {
  // `coming`: the page is reconnecting by itself (a restart it is waiting for). Otherwise nothing is: the kernel
  // stopped or the session ended, and the line must not promise what the Reconnect dialog does not.
  const coming = o.coming !== false;
  if (o.words) return coming ? KEEP_COPY.wordsHeldBack : KEEP_COPY.wordsHeld;
  if (s.pending > 0 || s.keep === 'not-saved' || (o.unsaved ?? 0) > 0) return coming ? KEEP_COPY.notSavedDown : KEEP_COPY.notSavedOff;
  return coming ? INERT_COPY['link-down'] : KEEP_COPY.notConnected;
}
/**
 * The check display (Aegis, final): what the fold was compared with, in plain words. Never a bare "verified": the
 * mod vouches for a POINT, so the line reads "checked up to" it; `verified: null` is unchecked.
 */
export function checkLine(s: { verified: boolean | null; checkedSeq: number | null; seq: number }): string {
  if (s.verified === null || s.checkedSeq === null) return 'Not checked yet';
  if (s.verified === false) return `Did not match at change ${s.checkedSeq} · fold it and open it again`;
  return s.checkedSeq < s.seq ? `Checked up to change ${s.checkedSeq} of ${s.seq}` : `Checked up to change ${s.checkedSeq}`;
}
/** A save shows as `Saving…` only when it has lasted this long (a quick save never flickers the line). */
export const KEEP_SLOW_MS = 600;

export type OpenedHow = 'command' | 'menu' | 'offer';
/** '<how>' of the keep line: '/board', 'the ⋯ menu', '<agent>’s offer'. */
export const openedFrom = (how: OpenedHow, agent?: string): string => (how === 'command' ? 'from /board' : how === 'menu' ? 'here' : `from ${agent ?? 'an agent'}’s offer`);

/** The keep line's parts, in order; the leaf joins them with ' · ' and puts the project swatch before the project. */
export function keepParts(k: { project: string; session: string; more?: number; how: OpenedHow; agent?: string; time: string }): { project: string; session: string; opened: string; time: string } {
  return { project: k.project, session: `${k.session}${k.more ? ` +${k.more}` : ''}`, opened: `opened ${openedFrom(k.how, k.agent)}`, time: k.time };
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
