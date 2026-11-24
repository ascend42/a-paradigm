/**
 * #gui-dim-clipboard (boards S1.3, draft point 4; C8; Aegis A6): the copy register.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DIM_KINDS, foldDim, validateDimOps } from '@a-company/gnomon-contracts';
import type { DimOp, DimRow, DimState } from '@a-company/gnomon-contracts';
import { DIM_CLIPBOARD_KEYS, DIM_CLIPBOARD_LIMITS, DimClipboard, dimStandInLine } from '../src/core/dim-clipboard.js';
import type { DimPasteResult } from '../src/core/dim-clipboard.js';

const clonesOf = (r: DimPasteResult): DimOp[] => {
  if (r.kind !== 'clones') throw new Error(`expected clones, got ${r.kind}`);
  return r.ops;
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIM = 'dim:01JD1MVECT0R00000000000001';
const HUMAN = { principal: 'p:me/human', surface: 'gui' };
const AGENT = { principal: 'p:me/session', surface: 'bridge', agent: 'kit', hsid: 'hsid-1' };
const ME = { cls: 'human' as const, principal: 'p:me/human' };
const ULID = (n: number): string => `01JD1MC11P${String(n).padStart(16, '0')}`;
const start: DimRow = { seq: 1, kind: DIM_KINDS.start, payload: { v: 1, dim: DIM, title: 'Clip', attached: ['hsid-1'], opened: 'command', relayedFor: HUMAN } };
const opRow = (seq: number, ops: unknown[], relayedFor: unknown = HUMAN): DimRow => ({ seq, kind: DIM_KINDS.op, payload: { v: 1, dim: DIM, ops, relayedFor } });
const minter = (from = 800): (() => string) => {
  let n = from;
  return () => ULID(n++);
};
const add = (node: Record<string, unknown>): unknown => ({ type: 'add', node });

const board = (): DimState =>
  foldDim([
    start,
    opRow(2, [
      add({ id: ULID(1), kind: 'frame', x: 0, y: 0, z: 'V', w: 400, h: 300, title: 'Plan' }),
      add({ id: ULID(2), kind: 'rect', x: 10, y: 10, z: 'W', w: 50, h: 40, fill: 'lemon', label: 'note', parent: ULID(1), refs: ['sym:#x'] }),
      add({ id: ULID(3), kind: 'ellipse', x: 200, y: 10, z: 'X', w: 50, h: 40, color: 'cobalt', weight: 2 }),
    ]),
    // an agent's arrow, with a carried-through field and a forged author
    opRow(3, [add({ id: ULID(4), kind: 'arrow', x: 60, y: 30, z: 'Y', points: [0, 0, 140, 0], from: ULID(2), to: ULID(3), rel: 'leads-to', head: 'both', by: { cls: 'human' }, link: 'https://x.example' }), add({ id: ULID(5), kind: 'acme:chart', x: 0, y: 0, z: 'Z' })], AGENT),
  ]);

describe('#gui-dim-clipboard', () => {
  it('copy answers the marks’ words, and a paste of exactly that text adds clones with new ids, offset 16', () => {
    const state = board();
    const clip = new DimClipboard();
    expect(clip.copy(state, [ULID(4), ULID(2), ULID(3)])).toMatchObject({ text: 'note', copied: 3, skipped: 0 });
    expect(clip.matches('note')).toBe(true);
    expect(clip.matches('note ')).toBe(false);
    expect(clip.paste('other', state, minter())).toEqual({ kind: 'text' });
    const ops = clonesOf(clip.paste('note', state, minter()));
    expect(ops).toEqual([
      // the frame was not copied but still stands and the clone lands inside it: `parent` is kept (review of PR #117,
      // A5); refs are not carried
      { type: 'add', node: { id: ULID(800), kind: 'rect', x: 26, y: 26, z: expect.any(String), w: 50, h: 40, fill: 'lemon', label: 'note', parent: ULID(1) } },
      { type: 'add', node: { id: ULID(801), kind: 'ellipse', x: 216, y: 26, z: expect.any(String), w: 50, h: 40, color: 'cobalt', weight: 2 } },
      // from and to point at the clones; rel, the forged author and the carried link are gone
      { type: 'add', node: { id: ULID(802), kind: 'arrow', x: 76, y: 46, z: expect.any(String), points: [0, 0, 140, 0], head: 'both', from: ULID(800), to: ULID(801) } },
    ]);
    const zs = ops.map((o) => (o as { node: { z: string } }).node.z);
    expect(zs[0]! > 'Z' && zs[0]! < zs[1]! && zs[1]! < zs[2]!).toBe(true);
    // the paster is the author of every clone, the agent's arrow included
    const v = validateDimOps(state, ops, ME);
    expect(v.refused).toEqual([]);
    const after = foldDim([opRow(4, v.ok)], undefined, state);
    expect(after.nodes.get(ULID(802))!.by).toEqual({ cls: 'human', principal: 'p:me/human' });
    // a second paste steps further and mints again
    const again = clonesOf(clip.paste('note', after, minter(900)));
    expect((again[0] as { node: { x: number; id: string } }).node).toMatchObject({ x: 42, id: ULID(900) });
  });

  it('a link to a mark outside the copied set is dropped, never left pointing at the original', () => {
    const state = board();
    const clip = new DimClipboard();
    clip.copy(state, [ULID(4)]);
    const [op] = clonesOf(clip.paste('(1 board mark)', state, minter()));
    expect(op).toEqual({ type: 'add', node: { id: ULID(800), kind: 'arrow', x: 76, y: 46, z: expect.any(String), points: [0, 0, 140, 0], head: 'both' } });
    // the words are joined in paint order, and only that exact text matches
    clip.copy(state, [ULID(2), ULID(1)]);
    expect(clip.paste('note\nPlan', state, minter())).toEqual({ kind: 'text' });
    expect(clip.matches('Plan\nnote')).toBe(true);
  });

  it('a frame and its child: the frame comes first and the child follows the cloned frame', () => {
    const state = board();
    const clip = new DimClipboard();
    const { text } = clip.copy(state, [ULID(2), ULID(1)]);
    expect(text).toBe('Plan\nnote');
    const ops = clonesOf(clip.paste(text, state, minter())) as unknown as Array<{ node: Record<string, unknown> }>;
    expect(ops.map((o) => o.node.kind)).toEqual(['frame', 'rect']);
    expect(ops[1]!.node.parent).toBe(ops[0]!.node.id);
    expect(validateDimOps(state, ops, ME).refused).toEqual([]);
  });

  it('an empty register text never matches; marks with no words are copied under a fixed line', () => {
    const state = board();
    const clip = new DimClipboard();
    expect(clip.matches('')).toBe(false);
    expect(clip.paste('', state, minter())).toEqual({ kind: 'text' });
    expect(clip.copy(state, [ULID(3)])).toMatchObject({ text: '(1 board mark)', copied: 1, skipped: 0 });
    expect(clip.matches('')).toBe(false);
    expect(clip.matches(undefined)).toBe(false);
    expect(clonesOf(clip.paste('(1 board mark)', state, minter()))).toHaveLength(1);
    // copying nothing, or only a mark this build cannot write, clears it
    expect(clip.copy(state, [ULID(5), 'nope'])).toMatchObject({ text: '', copied: 0, skipped: 2 });
    expect(clip.holds()).toBe(false);
    expect(clip.matches('(1 board mark)')).toBe(false);
    expect(clip.matches('')).toBe(false);
  });

  it('clear forgets the register (blur, unmount)', () => {
    const state = board();
    const clip = new DimClipboard();
    clip.copy(state, [ULID(2)]);
    expect(clip.holds()).toBe(true);
    clip.clear();
    expect(clip.holds()).toBe(false);
    expect(clip.paste('note', state, minter())).toEqual({ kind: 'text' });
  });

  it('clones at most 64 marks and says how many it left out', () => {
    const ops: unknown[] = [];
    const ids: string[] = [];
    for (let i = 0; i < 70; i++) {
      ids.push(ULID(100 + i));
      ops.push(add({ id: ULID(100 + i), kind: 'rect', x: i, y: 0, z: 'V', w: 5, h: 5 }));
    }
    const state = foldDim([start, opRow(2, ops.slice(0, 64)), opRow(3, ops.slice(64))]);
    const clip = new DimClipboard();
    expect(clip.copy(state, ids)).toMatchObject({ text: '(64 board marks)', copied: DIM_CLIPBOARD_LIMITS.clones, skipped: 6 });
    const pasted = clonesOf(clip.paste('(64 board marks)', state, minter()));
    expect(pasted).toHaveLength(64);
    expect(validateDimOps(state, pasted, ME).ok).toHaveLength(64);
  });

  it('carries a closed key list, keeps a snapshot, and has no DOM or clipboard access', () => {
    expect([...DIM_CLIPBOARD_KEYS].sort()).toEqual(['color', 'fill', 'h', 'head', 'kind', 'label', 'points', 'rot', 'size', 'text', 'title', 'w', 'weight', 'x', 'y']);
    const state = board();
    const clip = new DimClipboard();
    clip.copy(state, [ULID(4)]);
    // the board changes after the copy: the clone is what was copied
    const later = foldDim([opRow(5, [{ type: 'update', id: ULID(4), patch: { points: [0, 0, 1, 1] } }])], undefined, state);
    const [op] = clonesOf(clip.paste('(1 board mark)', later, minter())) as unknown as Array<{ node: { points: number[] } }>;
    expect(op!.node.points).toEqual([0, 0, 140, 0]);
    const src = readFileSync(path.join(ROOT, 'src', 'core', 'dim-clipboard.ts'), 'utf8');
    expect(src).not.toMatch(/navigator\.|document\.|window\.|console\.|setTimeout|addEventListener/);
  });

  it('19. skipped is the number of distinct ids asked for that were not copied', () => {
    const state = board();
    const clip = new DimClipboard();
    expect(clip.copy(state, [ULID(2), ULID(2), 'nope'])).toMatchObject({ text: 'note', copied: 1, skipped: 1 });
    expect(clip.copy(state, ['nope', 'nope'])).toMatchObject({ text: '', copied: 0, skipped: 1 });
    expect(clip.copy(state, [ULID(2), ULID(2)])).toMatchObject({ copied: 1, skipped: 0 });
    expect(clip.copy(state, [ULID(3), ULID(5), ULID(5), 'a', 'b'])).toMatchObject({ copied: 1, skipped: 3 });
    expect(clip.copy(state, [])).toMatchObject({ text: '', copied: 0, skipped: 0 });
  });

  it('19. a paste of the stand-in line when the register does not hold it is nothing-held, not plain text', () => {
    const state = board();
    const clip = new DimClipboard();
    expect(clip.paste('(1 board mark)', state, minter())).toEqual({ kind: 'nothing-held' });
    // the match is exact (review of PR #117, C3): the line with anything around it is words somebody typed
    expect(clip.paste('(12 board marks)\r\n', state, minter())).toEqual({ kind: 'text' });
    expect(clip.paste(' (12 board marks) ', state, minter())).toEqual({ kind: 'text' });
    clip.copy(state, [ULID(3)]);
    clip.clear();
    expect(clip.paste(dimStandInLine(1), state, minter())).toEqual({ kind: 'nothing-held' });
    // another copy replaced it: the old stand-in line is not this register's
    clip.copy(state, [ULID(2)]);
    expect(clip.paste('(1 board mark)', state, minter())).toEqual({ kind: 'nothing-held' });
    // ordinary words, and things that only look a little like the line, are text
    for (const text of ['hello', '(1 board marks)', '(0 board marks)', 'see (1 board mark)', '(999 board marks)', '(65 board marks)', '']) expect(clip.paste(text, state, minter())).toEqual({ kind: 'text' });
    expect(clip.paste(undefined, state, minter())).toEqual({ kind: 'text' });
    expect(dimStandInLine(2)).toBe('(2 board marks)');
  });

  it('19. line ends are normalised before matching (a Windows clipboard hands back CRLF)', () => {
    const state = foldDim([opRow(4, [add({ id: ULID(7), kind: 'text', x: 0, y: 0, z: 'a', text: 'two\r\nlines' })])], undefined, board());
    const clip = new DimClipboard();
    const { text } = clip.copy(state, [ULID(1), ULID(2), ULID(7)]);
    expect(text).toBe('Plan\nnote\ntwo\nlines');
    expect(clip.matches('Plan\r\nnote\r\ntwo\r\nlines')).toBe(true);
    expect(clip.matches('Plan\rnote\rtwo\rlines')).toBe(true);
    expect(clip.paste('Plan\r\nnote\r\ntwo\r\nlines', state, minter()).kind).toBe('clones');
    expect(clip.matches('Plan\n\nnote\ntwo\nlines')).toBe(false);
    // the clone keeps the words as they were stored
    const ops = clonesOf(clip.paste(text, state, minter())) as unknown as Array<{ node: { text?: string } }>;
    expect(ops.find((o) => o.node.text !== undefined)!.node.text).toBe('two\r\nlines');
  });
});

describe('#gui-dim-clipboard dimPasteTextOp: a pasted text that is not the register\'s', () => {
  it('is ONE add of a text node holding the words as pasted (never parsed), on top, at the point given; a long line is wrapped to a column', async () => {
    const { dimPasteTextOp, DIM_PASTE_WRAP } = await import('../src/core/dim-clipboard.js');
    const { emptyDimState, validateDimOps } = await import('@a-company/gnomon-contracts');
    let n = 0;
    const mint = (): string => `01JPASTE00000000000000000${n++}`;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    // the BOX is centred on the point: 5 characters wide, 2 lines high
    const short = dimPasteTextOp('two\r\nlines', emptyDimState(), { x: 100, y: 100 }, mint) as { type: string; node: Record<string, unknown> };
    expect(short).toEqual({ type: 'add', node: { id: '01JPASTE000000000000000000', kind: 'text', x: Math.round(100 - (5 * DIM_PASTE_WRAP.char) / 2), y: 100 - DIM_PASTE_WRAP.line, z: short.node.z, text: 'two\nlines' } });
    const long = dimPasteTextOp(svg, emptyDimState(), { x: 500, y: 300 }, mint) as { type: string; node: Record<string, unknown> };
    expect(long.node).toMatchObject({ kind: 'text', text: svg, w: DIM_PASTE_WRAP.w, x: 500 - DIM_PASTE_WRAP.w / 2, y: 300 - (Math.ceil(svg.length / DIM_PASTE_WRAP.over) * DIM_PASTE_WRAP.line) / 2 });
    expect(Object.keys(long.node).sort()).toEqual(['id', 'kind', 'text', 'w', 'x', 'y', 'z']);
    // the wrap numbers agree: a line of `over` characters fits the column, one more does not
    expect(DIM_PASTE_WRAP.over * DIM_PASTE_WRAP.char).toBeLessThanOrEqual(DIM_PASTE_WRAP.w);
    expect((DIM_PASTE_WRAP.over + 1) * DIM_PASTE_WRAP.char).toBeGreaterThan(DIM_PASTE_WRAP.w);
    expect((dimPasteTextOp('x'.repeat(DIM_PASTE_WRAP.over), emptyDimState(), { x: 0, y: 0 }, mint) as { node: object }).node).not.toHaveProperty('w');
    // a repeat steps by 16; a long paste keeps its top in view; control characters go, a tab and a line end stay
    const again = dimPasteTextOp('two\nlines', emptyDimState(), { x: 100, y: 100 }, mint, { repeat: 2 }) as { node: { x: number; y: number } };
    expect([again.node.x - (short.node.x as number), again.node.y - (short.node.y as number)]).toEqual([32, 32]);
    const tall = dimPasteTextOp(Array.from({ length: 100 }, () => 'line').join('\n'), emptyDimState(), { x: 0, y: 300 }, mint, { top: 40 }) as { node: { y: number } };
    expect(tall.node.y).toBe(40 + DIM_PASTE_WRAP.margin);
    expect((dimPasteTextOp('a\u001b[31mb\u0007\tc\u0000', emptyDimState(), { x: 0, y: 0 }, mint) as { node: { text: string } }).node.text).toBe('ab\tc');
    for (const blank of ['   ', ' \n\t ', '\u0007\u0000', '\u001b[2J']) expect(dimPasteTextOp(blank, emptyDimState(), { x: 0, y: 0 }, mint)).toBeNull();
    for (const op of [short, long]) expect(validateDimOps(emptyDimState(), [op], { cls: 'human', principal: 'p:test/you' } as never).refused ?? []).toEqual([]);
  });
});

describe('#gui-dim-clipboard review of PR #117: frames, parents and what a cut takes', () => {
  it('a copied frame takes its children; `ids` is exactly what was taken; a parent outside the set is kept only in the same dimension, for a live frame the clone lands in', async () => {
    const { DimClipboard } = await import('../src/core/dim-clipboard.js');
    const { foldDim, DIM_KINDS } = await import('@a-company/gnomon-contracts');
    const id = (n: number): string => `01JCL1PB0ARD0000000000000${n}`;
    const state = (dim: string, frameW = 300) => foldDim([
      { seq: 1, kind: DIM_KINDS.start, payload: { v: 1, dim, title: 't', attached: ['h'], opened: 'command', relayedFor: { principal: 'p:t/you', connId: 'c', surface: 'gui' } } },
      { seq: 2, kind: DIM_KINDS.op, payload: { v: 1, dim, relayedFor: { principal: 'p:t/you', connId: 'c', surface: 'gui' }, ops: [
        { type: 'add', node: { id: id(1), kind: 'frame', x: 0, y: 0, z: 'a', w: frameW, h: 300, title: 'f' } },
        { type: 'add', node: { id: id(2), kind: 'rect', x: 20, y: 20, z: 'b', w: 50, h: 40, parent: id(1), label: 'in' } },
        { type: 'add', node: { id: id(3), kind: 'text', x: 30, y: 100, z: 'c', text: 'words', parent: id(1) } },
        { type: 'add', node: { id: id(4), kind: 'rect', x: 500, y: 20, z: 'd', w: 50, h: 40 } },
      ] } },
    ] as never);
    let n = 0;
    const mint = (): string => `01JCL1PC10NE00000000000${String(n++).padStart(3, '0')}`;
    const a = state('dim:01JCL1PD1MA000000000000001');
    const clip = new DimClipboard();
    // the frame alone: its two children travel with it
    const framed = clip.copy(a, [id(1)]);
    expect(framed).toMatchObject({ copied: 3, skipped: 0 });
    expect([...framed.ids].sort()).toEqual([id(1), id(2), id(3)]);
    const back = clip.paste(framed.text, a, mint) as { kind: 'clones'; ops: Array<{ node: Record<string, unknown> }> };
    const frame = back.ops.find((o) => o.node.kind === 'frame')!.node;
    expect(back.ops.filter((o) => o.node.kind !== 'frame').map((o) => o.node.parent)).toEqual([frame.id, frame.id]);
    // a child alone, pasted back into the same dimension: it lands inside the frame and keeps it
    const child = clip.copy(a, [id(2)]);
    expect(child.ids).toEqual([id(2)]);
    expect((clip.paste(child.text, a, mint) as { ops: Array<{ node: Record<string, unknown> }> }).ops[0]!.node.parent).toBe(id(1));
    // …but not when the clone lands outside the frame, when the frame is gone, or in another dimension
    expect((clip.paste(child.text, state('dim:01JCL1PD1MA000000000000001', 60), mint) as { ops: Array<{ node: Record<string, unknown> }> }).ops[0]!.node).not.toHaveProperty('parent');
    clip.copy(a, [id(2)]);
    expect((clip.paste(child.text, state('dim:01JCL1PD1MB000000000000002'), mint) as { ops: Array<{ node: Record<string, unknown> }> }).ops[0]!.node).not.toHaveProperty('parent');
    clip.clear();
    expect(clip.copy(a, [id(4), 'nope']).skipped).toBe(1);
  });

  it('review of PR #117, group C: the clipboard words are cleaned, a copy over the text limit goes under the stand-in line, the stand-in match is exact, and clones land in view', async () => {
    const { DimClipboard, dimClipboardWords, dimStandInLine } = await import('../src/core/dim-clipboard.js');
    const { foldDim, DIM_KINDS } = await import('@a-company/gnomon-contracts');
    const id = (n: number): string => `01JCL1PC0ARD0000000000000${n}`;
    const who = { relayedFor: { principal: 'p:t/you', connId: 'c', surface: 'gui' } };
    const state = foldDim([
      { seq: 1, kind: DIM_KINDS.start, payload: { v: 1, dim: 'dim:01JCL1PD1MC000000000000003', title: 't', attached: ['h'], opened: 'command', ...who } },
      { seq: 2, kind: DIM_KINDS.op, payload: { v: 1, dim: 'dim:01JCL1PD1MC000000000000003', ...who, ops: [
        { type: 'add', node: { id: id(1), kind: 'text', x: 10, y: 10, z: 'a', text: 'red\u001b[31m ‮evil​\ttab' } },
        { type: 'add', node: { id: id(2), kind: 'text', x: 10, y: 60, z: 'b', text: 'x'.repeat(2500) } },
        { type: 'add', node: { id: id(3), kind: 'text', x: 10, y: 90, z: 'c', text: 'y'.repeat(2500) } },
        { type: 'add', node: { id: id(4), kind: 'rect', x: 100, y: 100, z: 'd', w: 50, h: 40 } },
      ] } },
    ] as never);
    expect(dimClipboardWords('a\u001b[0m‮b‏\r\nc\td')).toBe('a⟨RLO⟩b⟨RLM⟩\nc\td'); // the contracts sanitizer: the escape sequence goes, a bidi control is its visible glyph
    const clip = new DimClipboard();
    expect(clip.copy(state, [id(1)]).text).toBe('red ⟨RLO⟩evil\ttab');
    // 5,001 joined characters: the stand-in line, and it still pastes back as clones
    expect(clip.copy(state, [id(2), id(3)]).text).toBe(dimStandInLine(2));
    let n = 0;
    const mint = (): string => `01JCL1PC20NE00000000000${String(n++).padStart(3, '0')}`;
    expect(clip.paste(dimStandInLine(2), state, mint)).toMatchObject({ kind: 'clones' });
    // words that only LOOK like the stand-in line are words
    clip.clear();
    expect(clip.paste(' (3 board marks) ', state, mint)).toEqual({ kind: 'text' });
    expect(clip.paste('(3 board marks)', state, mint)).toEqual({ kind: 'nothing-held' });
    // panned away: the offset copy would be out of view, so the set is centred on the view; in view, it is offset 16
    clip.copy(state, [id(4)]);
    const far = clip.paste(dimStandInLine(1), state, mint, { x: 5000, y: 3000, w: 800, h: 600 }) as { ops: Array<{ node: { x: number; y: number } }> };
    expect([far.ops[0]!.node.x + 25, far.ops[0]!.node.y + 20]).toEqual([5400, 3300]);
    const near = clip.paste(dimStandInLine(1), state, mint, { x: 0, y: 0, w: 800, h: 600 }) as { ops: Array<{ node: { x: number; y: number } }> };
    expect([near.ops[0]!.node.x, near.ops[0]!.node.y]).toEqual([132, 132]);
  });
});
