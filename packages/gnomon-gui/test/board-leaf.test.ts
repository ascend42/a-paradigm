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
    expect([openedFrom('command'), openedFrom('menu'), openedFrom('offer', 'Arky')]).toEqual(['/board', 'the ⋯ menu', 'Arky’s offer']);
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
  it('nothing the kernel serves can load the host layer yet: app.js has none of it', () => {
    const app = bundle.get('app.js')!.toString('utf8');
    for (const marker of ['mountBoardLeaf', 'bd-rail', 'bd-leaf', 'railKeyAction', 'sealOf', 'A card has the keys', 'loadBoard(']) expect(app, marker).not.toContain(marker);
    for (const entry of ['src/main.ts', 'src/ui/app.ts']) expect(src(entry), entry).not.toMatch(/board-leaf|board-rail|board-tray|board-overlay|board-seal|core\/board\.js/);
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
      { about: 'open', code: 'open-failed' }, { about: 'close', code: 'close-failed' }, { about: 'check', code: 'hash-mismatch' }, { about: 'edit', code: 'too-large' }, { about: 'edit', code: 'row-too-large' },
      { about: 'edit', code: 'busy' }, { about: 'edit', code: 'not-sent' }, { about: 'edit', code: 'gesture-refused' }, { about: 'edit', code: 'timeout' }, { about: 'edit', code: 'no-answer' }, { about: 'edit', code: 'id-missing' },
    ].flatMap((n) => [noticeLine({ ...n, lost: 1 }), noticeLine({ ...n, lost: 64 })]);
    for (const line of [...lines, ...notices]) {
      expect(line.length, line).toBeLessThanOrEqual(59);
      // plain words: never a code, a field name or a kernel word
      expect(line, line).not.toMatch(/[a-z]-[a-z]+-|ops\b|\bdim\b|gesture|stamp|seq\b/);
    }
  });
});

