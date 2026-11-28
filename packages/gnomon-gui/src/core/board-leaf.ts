/**
 * @symbol #gui-board
 *
 * The board leaf's words and states (design component board-leaf). PURE: no DOM. Copy is the design's, verbatim;
 * the one line the design does not give (an image was refused) is marked.
 */
import { contentContrastWords, type ContentContrastWhy } from '@a-company/gnomon-contracts';
import { railLayout, railNeed } from './board-rail.js';

export type LeafLoad = 'loading' | 'ready' | 'failed';
export type LeafState = 'loading' | 'failed' | 'too-short' | 'yielded' | 'empty' | 'open';

/**
 * Under this much board height the leaf is too short to draw on (design `too_short.floor`): the tight rail's own
 * need, ONE number from the rail's model (core/board-rail.ts), never a second constant. 140px.
 */
export const BOARD_MIN_HEIGHT = railNeed(railLayout(0));
/** Under this much board the body is not drawn at all, too short or not: head, line, foot (design `too_short.shows`). */
export const BOARD_BODY_MIN = 56;
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
  // (the head key and its title are the specimen's: specimen-board.html#leaf)
  dimensions: 'Dimensions ▾',
  dimensionsTitle: 'Dimensions in this project',
  loading: 'opening the board…',
  yielded: 'A card has the keys · click the board to draw',
  // (design too_short.line: the dock passes the pinned count; a line never names a move that does nothing)
  tooShort: 'No room to draw · decide a card or make the window taller',
  tooShortNoCard: 'No room to draw · make the window taller',
  tooShortWords: 'No room to draw · your words are kept on this page',
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
export function noticeLine(n: { about: string; code: string; lost: number; why?: string | null; verified?: boolean | null }): string {
  if (n.code === 'link-down' && n.about !== 'link') return 'The link is down · that change wasn’t saved';
  if (n.code === 'redo-unavailable') return 'Redo isn’t on the board yet';
  // S1.4 P5 review: the mod profile could not be applied on this host (kernel ModRefusal SANDBOX): trying again fails the same way
  if (n.code === 'sandbox-unavailable') return 'The board can’t run here · this Mac can’t sandbox it';
  if (n.code === 'undo-nothing') return 'Nothing to undo';
  // (design check.signs.never_implied, aegis C2.3 and F7: "everything here is saved" only for a board that is checked)
  if (n.code === 'reconnected') return n.verified === true ? 'Reconnected · everything here is saved' : KEEP_COPY.reconnected;
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
  // a colour the contrast rule refused: the line says which part, in the tray's own words (Mika P0b S2)
  const contrast = n.code === 'colour-bad' && typeof n.why === 'string' ? /^(faint-line|faint-text|faint-fill|pair-line|pair-fill)(:night)?$/.exec(n.why) : null;
  if (contrast) return `That colour wasn’t kept · ${contentContrastWords(contrast[1] as ContentContrastWhy, !!contrast[2])}`;
  return n.lost > 1 ? `${n.lost} changes weren’t kept · the board is as it was` : 'That change wasn’t kept · the board is as it was';
}

/** What the leaf shows, for as long as it lasts, while the board is held still (the link is down; the fold is out of date). */
export const INERT_COPY = {
  'link-down': 'Reconnecting',
  'out-of-date': 'This board is out of date · fold it and open it again',
} as const;
export type LeafInert = keyof typeof INERT_COPY;

/**
 * The keep line's state of the live loop, from `DimSession.status()`: null while everything is saved and whole (the
 * leaf then shows the design's keep line: project, session, how it was opened, when). It reads BOTH `keep` and
 * `link`: the link down is said first, and "saved with the link down" is `Reconnecting` alone.
 *
 * "Not saved" is NEVER a state of its own here (Mika, final): a change is not saved only while the link is down, and
 * then the line says so with what is happening (`Not saved · reconnecting`). With the link up a pending change is
 * `Saving…`, and one that failed is said once as a notice. A board this page holds only in part (`partial`), or
 * whose rows it could not keep (`dropped`), says so whenever no passing state (opening, saving, the link down) has the line.
 */
export function keepStateLine(s: { keep: 'saved' | 'saving' | 'not-saved'; link: 'up' | 'down'; pending: number; phase?: string; partial?: boolean; dropped?: number; attrOff?: boolean }): string | null {
  // S1.4 E3 (keep_words.precedence 1b, aegis A1): under the mismatch line, over everything else; the session sets
  // attrOff only when the hash matched at that check point and only attr differs
  if (s.attrOff) return UNDO_COPY.attrOff;
  // (`not-saved` is the live loop's word for "pending while the link is down": it is never said without that)
  if (s.link === 'down' || s.keep === 'not-saved') return linkDownLine(s);
  // (design keep_words.precedence: the lines about missing marks, 5, outrank the passing states, 6)
  if ((s.dropped ?? 0) > 0) return KEEP_COPY.dropped;
  if (s.partial) return KEEP_COPY.partial;
  if (s.phase === 'opening') return KEEP_COPY.opening;
  if (s.phase === 'closing') return KEEP_COPY.folding;
  if (s.keep === 'saving') return KEEP_COPY.saving;
  return null;
}
/**
 * The words of the keep line's own states (design board-leaf.keep_words, design-foot). ONE rule of case and colour: a
 * QUIET readout is lower case in --sec (opening, folding, saving); a STATED line is a sentence in ink (.bd-said-line).
 * Contractions throughout, with the typographic apostrophe. A stated line's fact is before ' · ' and at most 40
 * characters, so it survives the cut in a 303px leaf.
 */
export const KEEP_COPY = {
  // (keep_words.one_wording: the first open reads the same words from the head's first draw: LEAF_COPY.loading)
  opening: 'opening the board…',
  folding: 'folding the board…',
  saving: 'saving…',
  notSavedDown: 'Not saved · reconnecting',
  dropped: 'Some marks may be missing here · the saved board has them',
  partial: 'Earlier marks aren’t shown here · the saved board has them',
  wordsHeld: 'Not connected · your words are kept on this page only',
  wordsHeldBack: 'Reconnecting · your words are kept on this page only',
  notConnected: 'Not connected',
  notSavedOff: 'Not saved · not connected',
  // (kept up for as long as the words are held; Mika's wording cut to fit the leaf at a 1024 window)
  wordsWait: 'Your words are waiting · T, then click, gets them back',
  wordsBack: 'Your words are back · click away to save them',
  wordsGone: 'The words you were typing weren’t saved',
  // (aegis F1: a session switch cannot be refused; the words that went are named by their first characters)
  wordsGoneWith: (words: string): string => {
    // (aegis re-check: whitespace collapsed, so a newline in the words never breaks the toast's one line)
    const w = [...String(words).replace(/\s+/g, ' ').trim()];
    return `The words you were typing weren’t saved · “${w.length > 24 ? `${w.slice(0, 23).join('')}…` : w.join('')}”`;
  },
  reconnected: 'Reconnected',
  copyDown: 'Nothing was copied · copy it again once reconnected',
  foldedDown: 'Folded while reconnecting · unsaved changes were dropped',
  reopens: 'That board was folded · opening it starts it again',
  noSession: 'Open a session first',
  wordsAndChangesGone: (n: number): string => `Your words and ${n === 1 ? 'one change' : `${n} changes`} weren’t saved`,
  changesGone: (n: number): string => (n === 1 ? 'One change on the board wasn’t saved' : `${n} changes on the board weren’t saved`),
  cardWaits: 'A card needs you · finish the text on the board first',
  // (aegis C3_5: a drag or a stroke in hand when the board went too short is put back, and said)
  changeBack: 'That change wasn’t kept · the board is as it was',
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
/** The check's words (design board-leaf.check.words): no row number on the face; quiet, lower case. */
export const CHECK_COPY = {
  latest: 'checked up to the last change',
  behind: (k: number): string => `checked up to ${k > 999 ? '999+' : k} ${k === 1 ? 'change' : 'changes'} ago`,
  older: 'checked up to an older change',
  empty: 'nothing to check yet',
  unchecked: 'not checked yet',
  mismatch: 'doesn’t match the saved board',
} as const;
/** The longest wording (design check.place: 189px at 10.5): the foot's probe measures this, whatever the check says now. */
export const CHECK_LONGEST = CHECK_COPY.behind(1000);
/** The gap the check needs after the hands (design check.place). */
export const CHECK_GAP = 16;
export interface CheckInput {
  verified: boolean | null;
  checkedSeq: number | null;
  /** the dimension's latest seq as the fold holds it */
  seq: number;
  /** this dimension's held rows above `checkedSeq` (DimStore.rowsAfter) */
  after: number;
  /** the held rows include one that makes, changes or removes a mark */
  marks: boolean;
  /** the page holds only part of the dimension */
  partial: boolean;
  /** the person's changes not stored yet (pending and unsaved) */
  unstored: number;
  /** typed words are held on the page */
  words: boolean;
}
/**
 * The check (design board-leaf.check, aegis C1.1 to C1.6): what this page's fold was compared with, in the person's
 * terms. ONE function for the foot and the Dimensions row (C2.4). Precedence: mismatch, not checked, then a partly
 * held board (only the older-change form, C1.6), then empty, then latest or behind. "the last change" only when the
 * check is at the latest row with nothing of the person's unstored and no held words (C1.3, C1.4).
 */
export function checkLine(s: CheckInput): string {
  if (s.verified === false) return CHECK_COPY.mismatch;
  if (s.verified === null || s.checkedSeq === null) return CHECK_COPY.unchecked;
  if (s.partial) return CHECK_COPY.older;
  if (!s.marks) return CHECK_COPY.empty;
  if (s.unstored > 0 || s.words) return CHECK_COPY.older;
  if (s.checkedSeq === s.seq && s.after === 0) return CHECK_COPY.latest;
  return s.after > 0 ? CHECK_COPY.behind(s.after) : CHECK_COPY.older;
}
/** The check's title= (aegis C1.7): the log's row numbers, said as the log's. Empty while unchecked. */
export const checkTitle = (s: { checkedSeq: number | null; seq: number }): string => (s.checkedSeq === null ? '' : `log row ${s.checkedSeq}; this board’s latest is row ${s.seq}`);
/** How the check reads: `bad` when the fold did not match (drawn in the failed colour), `none` while unchecked. */
export const checkTone = (s: { verified: boolean | null; checkedSeq: number | null }): 'ok' | 'none' | 'bad' => (s.verified === null || s.checkedSeq === null ? 'none' : s.verified ? 'ok' : 'bad');
/** The lead of the line under the head while open and unchecked and the check is not in the foot (design check.signs.unchecked). */
export const UNCHECKED_LEAD = { quiet: 'not checked yet · ', stated: 'Not checked yet · ' } as const;
/** The out-of-date line's fact, drawn in --fail at 500 (design check.signs.mismatch). */
export const OUT_OF_DATE_FACT = 'This board is out of date';

/** The too-short line (design `too_short.line`): words held first, then whether a card is pinned to decide. */
export const tooShortLine = (o: { pinned: number; words: boolean }): string => (o.words ? LEAF_COPY.tooShortWords : o.pinned > 0 ? LEAF_COPY.tooShort : LEAF_COPY.tooShortNoCard);
/** The same line is spoken once per entry and never again within this long of the last time (aegis C3_6). */
export const TOO_SHORT_SPEAK_MS = 1500;
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
  if (/stylesheet|did not load|did not export|text face/.test(m)) return 'A part of it didn’t load.';
  return 'The drawing engine didn’t start.';
}

/** A dimension title in the edge tab: cut at 24 characters with … (the whole title stays in title=). */
export const TAB_TITLE_MAX = 24;
export const tabTitle = (title: string): string => ([...title].length > TAB_TITLE_MAX ? `${[...title].slice(0, TAB_TITLE_MAX - 1).join('')}…` : title);

// ── S1.4 P4b: the draw key, the said lines of an agent's hand (design draw-grant, board-leaf.said) ──────────────

/**
 * The draw key's words (design components.draw-grant.words, with edit_anything of E-design, 2026-11-26, which wins
 * where it differs: the face reads "may edit" since a grant lets an agent add, change and remove any mark).
 * Lines the record does not have are WORKING lines, listed for Luna: `titleIdle`, `titleUnknown`, `removedByPerson`
 * and `removedByUnknown`.
 */
export const GRANT_COPY = Object.freeze({
  on: 'may edit',
  off: 'may not edit',
  titleOn: (name: string): string => `${name} may draw on this board and change or remove any mark, yours included · press to stop it`,
  titleOff: (name: string): string => `${name} may not draw, change or remove marks on this board · press to let it`,
  titlePending: (name: string, words: string): string => `${name} ${words} this board · saving the change`,
  titleDown: 'Not connected · this can’t be changed until the board is back',
  /** ORCHESTRATOR RULING (Luna to confirm): a session that is not live can be neither granted nor revoked (Aegis, P3 review) */
  titleIdle: (name: string, write: boolean): string => `${name} ${write ? 'may edit' : 'may not edit'} this board · its session isn’t running, so this can’t be changed now`,
  /** WORKING LINE (Luna): the grant map has not arrived yet (opening) */
  titleUnknown: (name: string): string => `${name} · the board has not said yet who may edit`,
  /** WORKING LINE (Luna, aegis I-3): a change the board never answered; the key waits for a row or an answer */
  titleUnsure: (name: string): string => `${name} · not known whether the change was made · waiting for the board`,
  /** ORCHESTRATOR RULING (mika F4; Luna to confirm): said after the key of a session that is not running */
  notRunning: 'not running',
  spokenOn: (name: string): string => `${name} may edit this board: it can change and remove any mark`,
  spokenOff: (name: string): string => `${name} may not edit this board`,
  refusedOn: (name: string): string => `Not changed · ${name} may still edit`,
  refusedOff: (name: string): string => `Not changed · ${name} still may not edit`,
  /** WORKING LINE (Luna, aegis I-3): the board did not answer a press in time */
  unsure: (name: string): string => `Not known whether it changed · the key for ${name} waits for the board`,
  noKey: 'can’t draw on a board yet',
});

/** A count in the foot's fixed 4-character slot (design hands_foot.order, aegis): over 999 reads '999+'. */
export const countSlot = (n: number): string => (n > 999 ? '999+' : String(n));

/** What an agent turn did on this board (counted from its rows). */
export interface HandMarks {
  added: number;
  changed: number;
  removed: number;
}

const marksWord = (n: number): string => (n === 1 ? '1 mark' : `${n} marks`);

/**
 * The arrival line (design board-leaf.said.arrival): ONE line per agent turn, spoken only. 'Claude added 3 marks',
 * 'Claude added 3 marks, changed 2 and removed 1', 'Claude changed 2 marks'. A part that is zero is left out; null
 * when nothing landed.
 */
export function arrivalLine(name: string, m: HandMarks): string | null {
  const parts: Array<[string, number]> = (
    [
      ['added', m.added],
      ['changed', m.changed],
      ['removed', m.removed],
    ] as Array<[string, number]>
  ).filter(([, n]) => n > 0);
  if (parts.length === 0) return null;
  const [lead, ...rest] = parts;
  const head = `${name} ${lead![0]} ${marksWord(lead![1])}`;
  if (rest.length === 0) return head;
  const tail = rest.map(([w, n]) => `${w} ${n}`);
  return rest.length === 1 ? `${head} and ${tail[0]}` : `${head}, ${tail.slice(0, -1).join(', ')} and ${tail[tail.length - 1]}`;
}

/**
 * The removed-mid-drag line (design board-leaf.said.removed): 'Claude removed the mark you were moving', or '… you
 * were changing' for a resize, a restyle or a text edit. `name` null: a person or the unknown hand removed it
 * (WORKING LINES, listed for Luna).
 */
export function removedLine(name: string | null, change: 'moving' | 'changing', who: 'agent' | 'self' | 'person' | 'unknown' = name ? 'agent' : 'unknown'): string {
  if (who === 'agent' && name) return `${name} removed the mark you were ${change}`;
  // ORCHESTRATOR RULING (Luna to confirm): the person's own other page
  if (who === 'self') return `The mark you were ${change} was removed on another of your pages`;
  // another person: a row names no person, so it reads as the unknown hand (aegis I-7); WORKING LINE (Luna)
  return `An unknown hand removed the mark you were ${change}`;
}

/* ── S1.4 E3: what the undo family's keys say (design board-leaf.said.undo, undo-key) ── */

const nMarks = (n: number, verb: string, plural: string): string => (n === 1 ? `1 mark ${verb}` : `${n} marks ${plural}`);

/** The words of said.undo, the keys, and the 1b line. Plain words only; never a wire code, a seq or a row count. */
export const UNDO_COPY = Object.freeze({
  undo: 'undo',
  redo: 'redo',
  putBack: 'put back',
  dismiss: 'dismiss',
  dismissTitle: 'Keep these changes · after this, undo them mark by mark while the board still can',
  doneTurn: (name: string): string => `Undid ${name}’s turn`,
  doneMark: (name: string): string => `Undid ${name}’s change to this mark`,
  putBackYours: 'Put back your mark',
  putBackTheirs: (name: string): string => `Put back ${name}’s mark`,
  redone: (name: string): string => `Redone · ${name}’s changes are back`,
  more: (name: string): string => `Undid part of ${name}’s turn · undo again for the rest`,
  expired: 'Too old to undo in one step · change the marks by hand',
  nothing: 'Nothing to undo · the marks are already as they were',
  busy: 'Not undone · the board was busy; press undo again',
  other: 'Not undone · nothing was changed',
  linkDown: 'Not connected · this can’t be undone until the board is back',
  /** E3 review C5 (the orchestrator's words, for Luna): the other two holds, on a key's title and description */
  catchingUp: 'Catching up with the board · this can be pressed in a moment',
  outOfDate: 'This board is out of date · fold it and open it again',
  pushedOut: (name: string, at: string): string => `An older change of ${name}’s${at ? ` from ${at}` : ''} can’t be undone in one step now`,
  /** E3 r3 (the orchestrator's words, for Luna): a notice dismissed on another page, or unpinned by the mod */
  // (E3 r4 F3, the orchestrator's words: what it means for the person, not where it went)
  noLonger: (name: string, at: string): string => `${name}’s ${at ? `${at} ` : ''}change can’t be undone from here now`,
  attrOff: 'Who changed what couldn’t be checked · the marks themselves match',
  /** the partial tail: changed since, removed since, couldn't be put back, joined by ', ' */
  skipped: (k: { changed: number; gone: number; refused: number }): string =>
    [
      k.changed > 0 ? `${nMarks(k.changed, 'changed since was left as it is', 'changed since were left as they are')}` : '',
      k.gone > 0 ? `${nMarks(k.gone, 'removed since stays removed', 'removed since stay removed')}` : '',
      k.refused > 0 ? (k.changed + k.gone > 0 ? `${k.refused} couldn’t be put back` : `${nMarks(k.refused, 'couldn’t be put back', 'couldn’t be put back')}`) : '',
    ]
      .filter(Boolean)
      .join(', '),
});

/**
 * The line said once an undo-family key's press is answered (said.undo). `name` is the hand's name (boardAgentName);
 * `n` is the session's notice (`about: 'undo'`). Null for a code that says nothing.
 */
export function undoLine(n: { code: string; scope?: 'turn' | 'mark' | 'own'; removed?: boolean; skipped?: { changed: number; gone: number; refused: number }; at?: number }, name: string, hhmm: (t: number) => string): string | null {
  if (n.code === 'undo-done') {
    const head = n.scope === 'mark' ? (n.removed ? UNDO_COPY.putBackYours : UNDO_COPY.doneMark(name)) : n.scope === 'own' ? null : UNDO_COPY.doneTurn(name);
    const tail = n.skipped ? UNDO_COPY.skipped(n.skipped) : '';
    if (head === null) return tail ? `Undone · ${tail}` : null;
    return tail ? `${head} · ${tail}` : head;
  }
  if (n.code === 'undo-more') return UNDO_COPY.more(name);
  if (n.code === 'undo-expired') return UNDO_COPY.expired;
  if (n.code === 'undo-nothing') return UNDO_COPY.nothing;
  if (n.code === 'undo-busy') return UNDO_COPY.busy;
  if (n.code === 'undo-other') return UNDO_COPY.other;
  if (n.code === 'redone') return UNDO_COPY.redone(name);
  if (n.code === 'pushed-out') return UNDO_COPY.pushedOut(name, typeof n.at === 'number' ? hhmm(n.at) : '');
  if (n.code === 'no-longer') return UNDO_COPY.noLonger(name, typeof n.at === 'number' ? hhmm(n.at) : '');
  if (n.code === 'link-down') return UNDO_COPY.linkDown;
  return null;
}
