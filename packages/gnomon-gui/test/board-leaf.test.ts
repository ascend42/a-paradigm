/**
 * The board leaf's states and words (design component board-leaf; boards S1.1 pass B), and the two fences round the
 * host layer: nothing the kernel serves can load it yet, and every bd-* class it draws with is in styles.css.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DIM_FALLBACK_LEAD, dimKindName } from '@a-company/gnomon-contracts';
// @ts-expect-error plain .mjs (the zero-dependency probe harness)
import { embeddedBundle } from '../../gnomon/probes/p12-excalidraw-csp/harness.mjs';
import { railLayout, railNeed } from '../src/core/board-rail.js';
import { BOARD_MIN_HEIGHT, TOO_SHORT_SPEAK_MS, tooShortLine, failedCause, keepParts, LEAF_COPY, leafStateOf, openedFrom, tabTitle } from '../src/core/board-leaf.js';
import { cardHasFocus } from '../src/ui/card-focus.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string): string => readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8');

describe('#gui-board states', () => {
  const base = { load: 'ready' as const, alive: true, boardHeight: 400, cardFocused: false, marks: 3 };
  it('loading, failed, too short, yielded, empty, open, in that order of precedence', () => {
    expect(leafStateOf({ ...base, load: 'loading' })).toBe('loading');
    expect(leafStateOf({ ...base, load: 'failed' })).toBe('failed');
    expect(leafStateOf({ ...base, alive: false })).toBe('failed'); // the engine stopped after mounting
    expect(leafStateOf({ ...base, boardHeight: BOARD_MIN_HEIGHT - 1 })).toBe('too-short');
    expect(leafStateOf({ ...base, boardHeight: BOARD_MIN_HEIGHT })).toBe('open');
    expect(leafStateOf({ ...base, cardFocused: true })).toBe('yielded');
    expect(leafStateOf({ ...base, cardFocused: true, marks: 0 })).toBe('yielded');
    expect(leafStateOf({ ...base, marks: 0 })).toBe('empty');
    expect(leafStateOf({ ...base, load: 'failed', cardFocused: true, boardHeight: 10 })).toBe('failed');
    // design too_short.floor: ONE number, the tight rail's own need from the rail's model (it was a second constant, 148)
    expect(BOARD_MIN_HEIGHT).toBe(140);
    expect(BOARD_MIN_HEIGHT).toBe(railNeed(railLayout(0)));
    expect(railLayout(BOARD_MIN_HEIGHT).tight).toBe(true);
  });
  it('design too_short.line: the dock\'s pinned count decides whether deciding a card is named; held words are said first', () => {
    expect(tooShortLine({ pinned: 1, words: false })).toBe('No room to draw · decide a card or make the window taller');
    expect(tooShortLine({ pinned: 0, words: false })).toBe('No room to draw · make the window taller');
    expect(tooShortLine({ pinned: 2, words: true })).toBe('No room to draw · your words are kept on this page');
    expect(tooShortLine({ pinned: 0, words: true })).not.toMatch(/saved/);
    expect(TOO_SHORT_SPEAK_MS).toBe(1500);
  });
});

describe('#gui-board copy (the design\'s words)', () => {
  it('the lines the design gives, verbatim', () => {
    expect(LEAF_COPY.medium).toBe('› board');
    expect(LEAF_COPY.loading).toBe('opening the board…');
    expect(LEAF_COPY.yielded).toBe('A card has the keys · click the board to draw');
    expect(LEAF_COPY.tooShort).toBe('No room to draw · decide a card or make the window taller');
    expect(LEAF_COPY.emptyTitle).toBe('Nothing drawn yet');
    expect(LEAF_COPY.emptyHint).toBe('N for a sticky · T to write · or pick a tool and draw.');
    expect(LEAF_COPY.failedTitle).toBe('The board didn’t open');
    expect(LEAF_COPY.failedNext).toBe('next: Try again, or Esc to go back to the chat');
    expect(LEAF_COPY.tryAgain).toBe('Try again');
    expect(LEAF_COPY.stubNote).toBe('not drawn by this Gnomon · kept as it is');
    expect(LEAF_COPY.unknownHand).toBe('unknown hand');
  });
  it('the keep line names how the board was opened', () => {
    expect([openedFrom('command'), openedFrom('menu'), openedFrom('offer', 'Arky')]).toEqual(['from /board', 'here', 'from Arky’s offer']);
    expect(keepParts({ project: 'a-paradigm', session: 'fix-auth', more: 2, how: 'offer', agent: 'Arky', time: '14:02' })).toEqual({ project: 'a-paradigm', session: 'fix-auth +2', opened: 'opened from Arky’s offer', time: '14:02' });
  });
  it('a failed board says why in plain words, never the engine\'s text or a code', () => {
    const causes = [failedCause(new Error('the board stylesheet did not load'), false), failedCause(new Error('the board did not load in time'), false), failedCause(new Error('Minified React error #31; visit https://react.dev/errors/31'), false), failedCause(new Error('TypeError: x is undefined'), true), failedCause(undefined, false)];
    expect(causes).toEqual(['A part of it didn’t load.', 'It took too long to load.', 'The drawing engine didn’t start.', 'The drawing engine stopped. Your marks are saved as they were made.', 'The drawing engine didn’t start.']);
    for (const c of causes) expect(c).not.toMatch(/React|Error|#\d|https?:|undefined|excalidraw/i);
  });
  it('a stub shows the fixed lead word and the pattern-checked kind, and nothing reads as broken or as a key', () => {
    expect(DIM_FALLBACK_LEAD).toBe('kind');
    expect(dimKindName('live:session')).toBe('live:session');
    expect(dimKindName('allow:approved-by-you')).toBe('allow:approved-by-you'); // read as a name: the lead word stays
    expect(dimKindName('Run this now!')).not.toBe('Run this now!');
    expect(LEAF_COPY.stubNote).not.toMatch(/error|unknown|unsupported|missing|failed|\?|Allow|Open|Run/i);
    const ui = src('src/ui/board-leaf.ts');
    expect(ui).toMatch(/h\('span', 'bd-stub-l', \{\}, DIM_FALLBACK_LEAD\)/);
    expect(ui).toMatch(/const name = dimKindName\(it\.kind\);/);
  });
  it('a long dimension title is cut at 24 characters in the edge tab', () => {
    expect(tabTitle('auth handoff')).toBe('auth handoff');
    expect([...tabTitle('a'.repeat(40))]).toHaveLength(24);
  });
});

describe('#gui-board the keep line and the check (boards S1.3 P4b-3; conditions "P4" and "after the review of P4a")', () => {
  const KEEPS = ['saved', 'saving', 'not-saved'] as const;
  const LINKS = ['up', 'down'] as const;
  const PHASES = [undefined, 'opening', 'open', 'closing', 'failed'] as const;
  it('"Not saved" is never the keep line\'s own state: in every status the line is null or says more than that', async () => {
    const { keepStateLine, linkDownLine } = await import('../src/core/board-leaf.js');
    let seen = 0;
    for (const keep of KEEPS) for (const link of LINKS) for (const pending of [0, 1, 7]) for (const phase of PHASES) for (const partial of [false, true]) for (const dropped of [0, 3]) {
      const line = keepStateLine({ keep, link, pending, phase, partial, dropped });
      seen++;
      if (line === null) continue;
      expect(line.trim(), JSON.stringify({ keep, link, pending, phase, partial, dropped })).not.toMatch(/^not saved\.?$/i);
      // where it is said at all, it is said with what is happening
      if (/not saved/i.test(line)) expect(line).toMatch(/^Not saved · (reconnecting|not connected)$/);
    }
    expect(seen).toBe(3 * 2 * 3 * 5 * 2 * 2);
    for (const keep of KEEPS) for (const pending of [0, 2]) for (const o of [{}, { coming: false }, { unsaved: 2 }, { words: true }, { coming: false, words: true, unsaved: 1 }]) expect(linkDownLine({ keep, pending }, o)).not.toMatch(/^not saved\.?$/i);
  });

  it('it reads both keep and link: saved with the link down is "Reconnecting" alone; pending with the link down says it is not saved', async () => {
    const { keepStateLine } = await import('../src/core/board-leaf.js');
    expect(keepStateLine({ keep: 'saved', link: 'down', pending: 0 })).toBe('Reconnecting');
    expect(keepStateLine({ keep: 'not-saved', link: 'down', pending: 2 })).toBe('Not saved · reconnecting');
    expect(keepStateLine({ keep: 'saving', link: 'up', pending: 2 })).toBe('saving…');
    expect(keepStateLine({ keep: 'saved', link: 'up', pending: 0 })).toBeNull();
  });

  it('design keep_words.precedence: `partial` and `dropped` (5) outrank the passing states (6), dropped first; the link down (2) is said over them', async () => {
    const { KEEP_COPY, keepStateLine } = await import('../src/core/board-leaf.js');
    const up = { keep: 'saved', link: 'up', pending: 0 } as const;
    expect(keepStateLine({ ...up, partial: true })).toBe(KEEP_COPY.partial);
    expect(keepStateLine({ ...up, dropped: 1 })).toBe(KEEP_COPY.dropped);
    expect(keepStateLine({ ...up, partial: true, dropped: 4 })).toBe(KEEP_COPY.dropped);
    expect(keepStateLine({ ...up, phase: 'open', partial: true })).toBe(KEEP_COPY.partial);
    expect(keepStateLine({ keep: 'saving', link: 'up', pending: 1, partial: true, dropped: 2 })).toBe(KEEP_COPY.dropped);
    expect(keepStateLine({ keep: 'saving', link: 'up', pending: 1, partial: true })).toBe(KEEP_COPY.partial);
    expect(keepStateLine({ keep: 'saved', link: 'up', pending: 0, phase: 'opening', partial: true })).toBe(KEEP_COPY.partial);
    expect(keepStateLine({ keep: 'saving', link: 'up', pending: 1 })).toBe('saving…');
    expect(keepStateLine({ keep: 'saved', link: 'down', pending: 0, partial: true })).toBe('Reconnecting');
    expect(keepStateLine({ ...up, partial: false, dropped: 0 })).toBeNull();
    for (const line of [KEEP_COPY.partial, KEEP_COPY.dropped]) expect(line.length, line).toBeLessThanOrEqual(59);
  });

  it('design check.words with aegis C1.1 to C1.7: no number on the face; k counts rows, every kind; the last change only at the latest with nothing unstored; the precedence; a partial board shows no count', async () => {
    const { checkLine, checkTone, checkTitle, CHECK_COPY, CHECK_LONGEST } = await import('../src/core/board-leaf.js');
    const ok = { verified: true, checkedSeq: 79, seq: 81, after: 2, marks: true, partial: false, unstored: 0, words: false } as const;
    expect(checkLine(ok)).toBe('checked up to 2 changes ago');
    expect(checkLine({ ...ok, after: 1 })).toBe('checked up to 1 change ago');
    expect(checkLine({ ...ok, after: 1000 })).toBe('checked up to 999+ changes ago');
    // C1.1: k is the row count (79 and 81 with ONE held row between: another dimension's row is not this one's)
    expect(checkLine({ ...ok, after: 1 })).toBe('checked up to 1 change ago');
    // C1.3: the last change only at the latest row
    expect(checkLine({ ...ok, checkedSeq: 81, after: 0 })).toBe('checked up to the last change');
    expect(checkLine({ ...ok, checkedSeq: 80, after: 0 })).toBe('checked up to an older change');
    // C1.4: never the last change with a change unstored or words held
    expect(checkLine({ ...ok, checkedSeq: 81, after: 0, unstored: 1 })).toBe('checked up to an older change');
    expect(checkLine({ ...ok, checkedSeq: 81, after: 0, words: true })).toBe('checked up to an older change');
    // C1.5: mismatch, then not checked, then (C1.6, ruled) partial, then empty
    expect(checkLine({ ...ok, verified: false })).toBe('doesn’t match the saved board');
    expect(checkLine({ ...ok, verified: false, partial: true, marks: false })).toBe('doesn’t match the saved board');
    expect(checkLine({ ...ok, verified: null })).toBe('not checked yet');
    expect(checkLine({ ...ok, checkedSeq: null })).toBe('not checked yet');
    expect(checkLine({ ...ok, verified: null, partial: true, marks: false })).toBe('not checked yet');
    expect(checkLine({ ...ok, partial: true })).toBe('checked up to an older change');
    expect(checkLine({ ...ok, partial: true, checkedSeq: 81, after: 0 })).toBe('checked up to an older change');
    expect(checkLine({ ...ok, marks: false })).toBe('nothing to check yet');
    // C1.7 and the tones
    expect(checkTitle({ checkedSeq: 79, seq: 81 })).toBe('log row 79; this board’s latest is row 81');
    expect(checkTitle({ checkedSeq: null, seq: 81 })).toBe('');
    expect([checkTone({ verified: true, checkedSeq: 4 }), checkTone({ verified: false, checkedSeq: 4 }), checkTone({ verified: null, checkedSeq: null })]).toEqual(['ok', 'bad', 'none']);
    // no number of the log on the face, never a bare "verified", lower case; the probe is the longest wording
    for (const w of [CHECK_COPY.latest, CHECK_COPY.older, CHECK_COPY.empty, CHECK_COPY.unchecked, CHECK_COPY.mismatch, CHECK_COPY.behind(3)]) {
      expect(w).not.toMatch(/\b79\b|\b81\b|verified/i);
      expect(w).toBe(w.toLowerCase());
      expect(w.length).toBeLessThanOrEqual(CHECK_LONGEST.length);
    }
  });
});

describe('design keep_words (design-foot): case, colour and contractions', () => {
  it('the recorded lines verbatim; quiet readouts lower case; stated lines are sentences; no uncontracted "not"; each fact within 40 characters', async () => {
    const { KEEP_COPY, LEAF_COPY, failedCause } = await import('../src/core/board-leaf.js');
    expect([KEEP_COPY.opening, KEEP_COPY.folding, KEEP_COPY.saving]).toEqual(['opening the board…', 'folding the board…', 'saving…']);
    expect(KEEP_COPY.opening).toBe(LEAF_COPY.loading);
    expect(KEEP_COPY.partial).toBe('Earlier marks aren’t shown here · the saved board has them');
    expect(KEEP_COPY.dropped).toBe('Some marks may be missing here · the saved board has them');
    expect(KEEP_COPY.wordsGone).toBe('The words you were typing weren’t saved');
    expect([KEEP_COPY.wordsAndChangesGone(1), KEEP_COPY.wordsAndChangesGone(3)]).toEqual(['Your words and one change weren’t saved', 'Your words and 3 changes weren’t saved']);
    expect(KEEP_COPY.wordsGoneWith('hel\n\n  lo')).toBe('The words you were typing weren’t saved · “hel lo”');
    expect(KEEP_COPY.wordsGoneWith('x'.repeat(40))).toBe(`The words you were typing weren’t saved · “${'x'.repeat(23)}…”`);
    expect([KEEP_COPY.changesGone(1), KEEP_COPY.changesGone(2)]).toEqual(['One change on the board wasn’t saved', '2 changes on the board weren’t saved']);
    for (const q of [KEEP_COPY.opening, KEEP_COPY.folding, KEEP_COPY.saving]) expect(q).toBe(q.toLowerCase());
    const stated = Object.values(KEEP_COPY).map((v) => (typeof v === 'function' ? v(2) : v)).filter((v) => ![KEEP_COPY.opening, KEEP_COPY.folding, KEEP_COPY.saving].includes(v as never));
    for (const line of [...stated, LEAF_COPY.tooShort, LEAF_COPY.tooShortNoCard, LEAF_COPY.tooShortWords, failedCause(new Error('x did not load'), false), failedCause(new Error('?'), false)]) {
      expect(line[0], line).toBe(line[0]!.toUpperCase());
      expect(line, line).not.toMatch(/\b(were|was|could|are|is|did|does|can) not\b|'/);
      expect(line.split(' · ')[0]!.length, line).toBeLessThanOrEqual(40);
    }
  });
});

describe('#gui-board G-DDL-08 (the parts that exist before the S1.3 leaf)', () => {
  it('a card has focus exactly when the active element is inside a .card', () => {
    const inside = { closest: (sel: string) => (sel === '.card' ? {} : null) };
    const outside = { closest: () => null };
    expect(cardHasFocus({ activeElement: inside })).toBe(true);
    expect(cardHasFocus({ activeElement: outside })).toBe(false);
    expect(cardHasFocus({ activeElement: null })).toBe(false);
  });
  it('the leaf routes every key through railKeyAction with that predicate, and wakes on a trusted press only', () => {
    const ui = src('src/ui/board-leaf.ts');
    expect(ui).toMatch(/railKeyAction\(e, \{ boardFocused: el\.contains\(active\), editingText: s\?\.editingText \?\? false, cardFocused: o\.cardFocused\(\) \}\)/);
    expect(ui).toMatch(/e\.preventDefault\(\);\s+e\.stopPropagation\(\);\s+if \(e\.isTrusted\) \{\s+wakeUntil = performance\.now\(\) \+ WAKE_HOLD_MS;\s+handle\?\.focus\(\);/);
    for (const type of ['dblclick', 'drop', 'contextmenu', 'paste']) expect(ui, type).toContain(`'${type}'`);
    expect(ui).toMatch(/stage\.addEventListener\('wheel', onHeld, \{ capture: true, passive: false \}\)/);
    expect(ui).toMatch(/stage\.addEventListener\('pointerdown', onWake, true\)/);
  });
});

describe('#gui-board fences', () => {
  const bundle = embeddedBundle() as Map<string, Buffer>;
  it('the app mounts the leaf through the dock only (S1.3 P4b-1): app.ts imports the loader, the opening rules and the dock, never the leaf or its parts', () => {
    expect(src('src/main.ts')).not.toMatch(/board-leaf|board-rail|board-tray|board-overlay|board-seal|board-dock|core\/board\.js/);
    const app = src('src/ui/app.ts');
    expect([...app.matchAll(/from '([^']*board[^']*)'/g)].map((m) => m[1]).sort()).toEqual(['../core/board-open.js', '../core/board-turn.js', '../core/board.js', './board-dock.js', './board-turn.js']);
    expect(app).toContain('load: () => loadBoard(),');
  });
  it('only the dev preview imports the leaf', () => {
    expect(src('src/preview/main.ts')).toMatch(/from '\.\.\/ui\/board-leaf\.js'/);
  });
  it('every bd-* class the leaf draws with is in the shipped stylesheet, and the leaf writes no inline style attribute', () => {
    const ui = src('src/ui/board-leaf.ts');
    const css = bundle.get('styles.css')!.toString('utf8');
    const used = [...new Set([...ui.matchAll(/\bbd-[a-z-]+[a-z]/g)].map((m) => m[0]))].sort();
    expect(used.length).toBeGreaterThan(25);
    for (const cls of used) expect(css, cls).toMatch(new RegExp(`\\.${cls}(?![a-z-])`));
    expect(ui).not.toMatch(/setAttribute\(\s*['"]style['"]|style=\\?["']|innerHTML|insertAdjacentHTML/);
  });
  it('drift() is diagnostic only: nothing under src/ calls it, so its unfiltered diff is never sent (Aegis, P3b-1 review)', () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.ts') ? [path.join(dir, d.name)] : []));
    const callers = walk(root).filter((f) => /\.drift\s*\(|\bdrift\s*\(\s*\)\s*[;,)]/.test(readFileSync(f, 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, ''))).map((f) => path.relative(root, f));
    expect(callers).toEqual([]);
    // it is declared on the handle and defined once, in the chunk
    expect(readFileSync(path.join(root, 'core', 'board.ts'), 'utf8')).toMatch(/drift\(\): DimOp\[\];/);
    expect(readFileSync(path.join(root, 'board', 'index.ts'), 'utf8')).toMatch(/drift: \(\) => \(live\(\), diff\(prev\)\),/);
  });

  it('the app never asks for untrusted input to count: `syntheticInput` is the probe harness\'s alone (review batch A3)', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
    for (const f of ['ui/board-leaf.ts', 'ui/app.ts', 'core/board-leaf.ts', 'preview/main.ts']) expect(readFileSync(path.join(root, f), 'utf8'), f).not.toMatch(/syntheticInput/);
    expect(readFileSync(path.join(root, 'core', 'board.ts'), 'utf8')).toMatch(/syntheticInput\?: boolean/);
  });
});

describe('#gui-board lines of the leaf fit one row at a 1024 window (about 59 characters; Mika, review of PR #117)', () => {
  it('the three shortened lines, and every stand-in line for a notice of the live loop', async () => {
    const { CLIP_COPY, noticeLine, refusalLineOf } = await import('../src/core/board-leaf.js');
    const lines = [refusalLineOf({ what: 'text', why: 'too-long', detail: '4000' }), CLIP_COPY.leftOut(6), CLIP_COPY.leftOut(1), CLIP_COPY.cutRefused];
    expect(lines).toEqual(['One mark holds 4,000 characters · paste or type less', '6 marks were left out · a copy takes 64 at most', '1 mark was left out · a copy takes 64 at most', 'Nothing was cut · a cut takes 64 marks at most']);
    const notices = [
      { about: 'link', code: 'link-down' }, { about: 'edit', code: 'link-down' }, { about: 'undo', code: 'redo-unavailable' }, { about: 'undo', code: 'undo-nothing' }, { about: 'undo', code: 'undo-invalid' },
      { about: 'open', code: 'open-failed' }, { about: 'open', code: 'open-failed', why: 'title-bad' }, { about: 'open', code: 'open-failed', why: 'title-secret' }, { about: 'open', code: 'open-failed', why: 'repo-mismatch' }, { about: 'open', code: 'open-failed', why: 'not-attached' }, { about: 'open', code: 'open-failed', why: 'dim-cap' }, { about: 'close', code: 'close-failed' }, { about: 'check', code: 'hash-mismatch' }, { about: 'edit', code: 'too-large' }, { about: 'edit', code: 'row-too-large' },
      { about: 'edit', code: 'busy' }, { about: 'edit', code: 'not-sent' }, { about: 'edit', code: 'gesture-refused' }, { about: 'edit', code: 'timeout' }, { about: 'edit', code: 'no-answer' }, { about: 'edit', code: 'id-missing' },
      { about: 'link', code: 'reconnected' }, { about: 'link', code: 'not-saved' }, { about: 'edit', code: 'out-of-date' }, { about: 'edit', code: 'closing' }, { about: 'edit', code: 'not-undoable', why: 'delete' }, { about: 'edit', code: 'not-undoable', why: 'too-many-rows' }, { about: 'undo', code: 'undo-too-large' },
    ].flatMap((n) => [noticeLine({ ...n, lost: 1 }), noticeLine({ ...n, lost: 64 })]);
    const { INERT_COPY, keepStateLine } = await import('../src/core/board-leaf.js');
    expect(noticeLine({ about: 'edit', code: 'not-undoable', why: 'delete', lost: 65 })).toBe('Nothing was deleted · a delete takes 64 marks at most');
    expect(noticeLine({ about: 'open', code: 'sandbox-unavailable', why: 'SANDBOX', lost: 0 })).toBe('The board can’t run here · this Mac can’t apply its sandbox');
    // Mika P0b S2b: a colour the contrast rule refused is named, in the tray's words; a malformed why says nothing new
    expect(noticeLine({ about: 'edit', code: 'colour-bad', why: 'pair-line', lost: 1 })).toBe("That colour wasn’t kept · it would not show against this mark's fill");
    expect(noticeLine({ about: 'edit', code: 'colour-bad', why: 'faint-fill:night', lost: 1 })).toBe('That colour wasn’t kept · words would be too faint on it at night');
    expect(noticeLine({ about: 'edit', code: 'colour-bad', why: 'pair-line<script>', lost: 1 })).toBe('That change wasn’t kept · the board is as it was');
    // Aegis N1: 50 shapes with 20 tied arrows is under the limit the line used to state: no number is said
    expect(noticeLine({ about: 'edit', code: 'not-undoable', why: 'delete', lost: 50 })).toBe('Nothing was deleted · select fewer marks and try again');
    expect(noticeLine({ about: 'edit', code: 'timeout', why: 'no-ack', lost: 1 })).toBe('That change may not be saved · fold and reopen to check');
    const { KEEP_COPY, checkLine, linkDownLine } = await import('../src/core/board-leaf.js');
    // "Reconnecting" alone when nothing is pending; "Not saved" only when something is
    expect([linkDownLine({ keep: 'saved', pending: 0 }), linkDownLine({ keep: 'saving', pending: 2 }), linkDownLine({ keep: 'not-saved', pending: 0 })]).toEqual(['Reconnecting', 'Not saved · reconnecting', 'Not saved · reconnecting']);
    const c0 = { verified: true, checkedSeq: 9, seq: 9, after: 0, marks: true, partial: false, unstored: 0, words: false };
    for (const s of [checkLine(c0), checkLine({ ...c0, verified: null })]) expect(s).not.toMatch(/verified/i);
    notices.push(...Object.values(KEEP_COPY).map((v) => (typeof v === 'function' ? v(64) : v)));
    // Mika 2: a board folded on an earlier page is "folded", as the Dimensions list calls it (never an ended dimension)
    expect(KEEP_COPY.reopens).toBe('That board was folded · opening it starts it again');
    // nothing coming by itself (the kernel stopped): the line says not connected, never reconnecting
    expect([linkDownLine({ keep: 'saved', pending: 0 }, { coming: false }), linkDownLine({ keep: 'saved', pending: 0 }, { coming: false, unsaved: 1 }), linkDownLine({ keep: 'saved', pending: 0 }, { coming: false, words: true }), linkDownLine({ keep: 'saved', pending: 0 }, { words: true })]).toEqual(['Not connected', 'Not saved · not connected', 'Not connected · your words are kept on this page only', 'Reconnecting · your words are kept on this page only']);
    expect([noticeLine({ about: 'link', code: 'reconnected', lost: 0, verified: true }), noticeLine({ about: 'link', code: 'not-saved', lost: 3 }), noticeLine({ about: 'link', code: 'link-down', lost: 0 }), noticeLine({ about: 'edit', code: 'timeout', lost: 2 })]).toEqual(['Reconnected · everything here is saved', '3 changes weren’t saved before the link came back', 'Reconnecting', '2 changes may not be saved · fold and reopen to check']);
    expect(noticeLine({ about: 'undo', code: 'undo-too-many-ops', lost: 0 })).toBe('That was too much to undo · it stays as it is');
    // aegis C2.3 and F7, in noticeLine itself: no word of saving for a board that is not checked
    expect([noticeLine({ about: 'link', code: 'reconnected', lost: 0, verified: null }), noticeLine({ about: 'link', code: 'reconnected', lost: 0, verified: false }), noticeLine({ about: 'link', code: 'reconnected', lost: 0 })]).toEqual(['Reconnected', 'Reconnected', 'Reconnected']);
    expect(noticeLine({ about: 'close', code: 'close-failed', lost: 0 })).toBe('Your marks are saved · the board didn’t fold · try again');
    expect([keepStateLine({ keep: 'saved', link: 'up', pending: 0 }), keepStateLine({ keep: 'saving', link: 'up', pending: 1 }), keepStateLine({ keep: 'not-saved', link: 'down', pending: 1 }), keepStateLine({ keep: 'saved', link: 'down', pending: 0 })]).toEqual([null, 'saving…', 'Not saved · reconnecting', 'Reconnecting']);
    // the keep line's own states: opening, partly held, rows dropped. "Not saved" is never a state of its own (Mika, final)
    expect([keepStateLine({ keep: 'saved', link: 'up', pending: 0, phase: 'opening' }), keepStateLine({ keep: 'not-saved', link: 'up', pending: 0 }), keepStateLine({ keep: 'saved', link: 'up', pending: 0, partial: true }), keepStateLine({ keep: 'saved', link: 'up', pending: 0, dropped: 2 })]).toEqual(['opening the board…', 'Not saved · reconnecting', KEEP_COPY.partial, KEEP_COPY.dropped]);
    for (const line of [...lines, ...notices, ...Object.values(INERT_COPY)]) {
      expect(line.length, line).toBeLessThanOrEqual(59);
      // plain words: never a code, a field name or a kernel word
      expect(line, line).not.toMatch(/[a-z]-[a-z]+-|ops\b|\bdim\b|gesture|stamp|seq\b/);
    }
  });
});

