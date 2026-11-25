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
import { BOARD_MIN_HEIGHT, failedCause, keepParts, LEAF_COPY, leafStateOf, openedFrom, tabTitle } from '../src/core/board-leaf.js';
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
    expect(BOARD_MIN_HEIGHT).toBe(148);
  });
});

describe('#gui-board copy (the design\'s words)', () => {
  it('the lines the design gives, verbatim', () => {
    expect(LEAF_COPY.medium).toBe('› board');
    expect(LEAF_COPY.loading).toBe('opening the board…');
    expect(LEAF_COPY.yielded).toBe('A card has the keys · click the board to draw');
    expect(LEAF_COPY.tooShort).toBe('The window is too short to draw here · make it taller, or decide the pinned cards');
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
    expect(causes).toEqual(['A part of it did not load.', 'It took too long to load.', 'The drawing engine did not start.', 'The drawing engine stopped. Your marks are saved as they were made.', 'The drawing engine did not start.']);
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
    expect([...app.matchAll(/from '([^']*board[^']*)'/g)].map((m) => m[1]).sort()).toEqual(['../core/board-open.js', '../core/board.js', './board-dock.js']);
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
    // Aegis N1: 50 shapes with 20 tied arrows is under the limit the line used to state: no number is said
    expect(noticeLine({ about: 'edit', code: 'not-undoable', why: 'delete', lost: 50 })).toBe('Nothing was deleted · select fewer marks and try again');
    expect(noticeLine({ about: 'edit', code: 'timeout', why: 'no-ack', lost: 1 })).toBe('That change may not be saved · fold and reopen to check');
    const { KEEP_COPY, checkLine, linkDownLine } = await import('../src/core/board-leaf.js');
    // "Reconnecting" alone when nothing is pending; "Not saved" only when something is
    expect([linkDownLine({ keep: 'saved', pending: 0 }), linkDownLine({ keep: 'saving', pending: 2 }), linkDownLine({ keep: 'not-saved', pending: 0 })]).toEqual(['Reconnecting', 'Not saved · reconnecting', 'Not saved · reconnecting']);
    // the check display: never a bare "verified"; null is unchecked; behind the head it reads "checked up to"
    expect([checkLine({ verified: null, checkedSeq: null, seq: 9 }), checkLine({ verified: true, checkedSeq: 4, seq: 9 }), checkLine({ verified: true, checkedSeq: 9, seq: 9 })]).toEqual(['Not checked yet', 'Checked up to change 4 of 9', 'Checked up to change 9']);
    expect(checkLine({ verified: false, checkedSeq: 4, seq: 9 })).toMatch(/^Did not match at change 4/);
    for (const s of [checkLine({ verified: true, checkedSeq: 9, seq: 9 }), checkLine({ verified: null, checkedSeq: null, seq: 1 })]) expect(s).not.toMatch(/verified/i);
    notices.push(...Object.values(KEEP_COPY).map((v) => (typeof v === 'function' ? v(64) : v)));
    // Mika 2: a board folded on an earlier page is "folded", as the Dimensions list calls it (never an ended dimension)
    expect(KEEP_COPY.reopens).toBe('That board was folded · opening it starts it again');
    // nothing coming by itself (the kernel stopped): the line says not connected, never reconnecting
    expect([linkDownLine({ keep: 'saved', pending: 0 }, { coming: false }), linkDownLine({ keep: 'saved', pending: 0 }, { coming: false, unsaved: 1 }), linkDownLine({ keep: 'saved', pending: 0 }, { coming: false, words: true }), linkDownLine({ keep: 'saved', pending: 0 }, { words: true })]).toEqual(['Not connected', 'Not saved · not connected', 'Not connected · your words are kept on this page only', 'Reconnecting · your words are kept on this page only']);
    expect([noticeLine({ about: 'link', code: 'reconnected', lost: 0 }), noticeLine({ about: 'link', code: 'not-saved', lost: 3 }), noticeLine({ about: 'link', code: 'link-down', lost: 0 }), noticeLine({ about: 'edit', code: 'timeout', lost: 2 })]).toEqual(['Reconnected · everything here is saved', '3 changes weren’t saved before the link came back', 'Reconnecting', '2 changes may not be saved · fold and reopen to check']);
    expect(noticeLine({ about: 'undo', code: 'undo-too-many-ops', lost: 0 })).toBe('That was too much to undo · it stays as it is');
    expect(noticeLine({ about: 'close', code: 'close-failed', lost: 0 })).toBe('Your marks are saved · the board didn’t fold · try again');
    expect([keepStateLine({ keep: 'saved', link: 'up', pending: 0 }), keepStateLine({ keep: 'saving', link: 'up', pending: 1 }), keepStateLine({ keep: 'not-saved', link: 'down', pending: 1 }), keepStateLine({ keep: 'saved', link: 'down', pending: 0 })]).toEqual([null, 'Saving…', 'Not saved · reconnecting', 'Reconnecting']);
    // the keep line's own states: opening, folding, not saved (its own state), partly held, rows dropped
    expect([keepStateLine({ keep: 'saved', link: 'up', pending: 0, phase: 'opening' }), keepStateLine({ keep: 'not-saved', link: 'up', pending: 0 }), keepStateLine({ keep: 'saved', link: 'up', pending: 0, partial: true }), keepStateLine({ keep: 'saved', link: 'up', pending: 0, dropped: 2 })]).toEqual(['Opening…', 'Not saved', KEEP_COPY.partial, KEEP_COPY.dropped]);
    for (const line of [...lines, ...notices, ...Object.values(INERT_COPY)]) {
      expect(line.length, line).toBeLessThanOrEqual(59);
      // plain words: never a code, a field name or a kernel word
      expect(line, line).not.toMatch(/[a-z]-[a-z]+-|ops\b|\bdim\b|gesture|stamp|seq\b/);
    }
  });
});

