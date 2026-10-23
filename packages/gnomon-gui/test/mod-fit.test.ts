/**
 * #gui fitted mod views (core/render.ts `fit`, core/mod-panels.ts renderModFence; founder 2026-10-23: "these mods
 * have terrible display in gnomon"). Generic renderer rules, so every mod reads right in a 200-460px column:
 * a table fits its column (label-style heads, numbers right-aligned and tabular, a width bucket that switches to a
 * key-value layout per row), ids truncate on one line and never break mid-token, prose after an id starts its own
 * line, the project hue is the ■ swatch, and the mod kit's `head` and `chip` tones render.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { markTruncated, renderModFence, TRUNCATABLE_SELECTOR, type ModPanelView, type TruncEl } from '../src/core/mod-panels.js';
import { FIT_CELL_MAX, FIT_TABLE_BUCKETS, FIT_TOKEN_MIN, fitTextKind, isNilCell, renderBlock, tableFit, type MiniDoc, type MiniEl } from '../src/core/render.js';
// @ts-ignore -- the first-party mods are plain ESM with no types (their packageHash is pinned: no .d.ts beside them)
import * as ledger from '../../gnomon-mods/ledger/model.mjs';
// @ts-ignore -- as above
import * as paradigm from '../../gnomon-mods/paradigm-context/model.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(path.join(ROOT, 'static', 'styles.css'), 'utf8');

class FText {
  constructor(readonly data: string) {}
}
class FEl implements MiniEl {
  className = '';
  readonly attrs = new Map<string, string>();
  readonly children: Array<FEl | FText> = [];
  constructor(readonly tag: string) {}
  appendChild(c: unknown): unknown {
    this.children.push(c as FEl | FText);
    return c;
  }
  setAttribute(n: string, v: string): void {
    this.attrs.set(n, v);
  }
  get text(): string {
    return this.children.map((c) => (c instanceof FText ? c.data : c.text)).join('');
  }
  all(): FEl[] {
    return [this, ...this.children.flatMap((c) => (c instanceof FEl ? c.all() : []))];
  }
}
const fdoc: MiniDoc = { createElement: (t) => new FEl(t), createTextNode: (s) => new FText(s) };
const fit = (node: unknown): FEl => renderBlock({ doc: fdoc, fit: true }, node) as FEl;
const view = (region: ModPanelView['region']): ModPanelView => ({ name: 'gnomon.ledger', viewId: 'ledger.sheet', slot: 'sidebar', region, dev: false });

describe('fitted tables: the fit', () => {
  it('numbers (and columns of only empty cells) align right; text columns do not', () => {
    const f = tableFit(['session', 'in', 'out', 'cache', 'cost', '⇣ compactions'], [['…FJFEQZ', '0', '-', '-', '-', '0'], ['…ABCDEF (ended)', '10.4M', '98k', '87%', '$123.46', '2 (190k → 41k)']]);
    expect(f.numeric).toEqual([false, true, true, true, true, false]);
    expect(tableFit(['a'], [['-'], ['—'], ['']]).numeric).toEqual([true]);
    expect(tableFit(['n'], [['1,204'], ['~3k'], ['$0.42'], ['−2'], ['71%']]).numeric).toEqual([true]);
    expect(tableFit(['n'], [['12'], ['n/a']]).numeric).toEqual([false]);
  });

  it('its natural width (ch) picks the smallest bucket that holds it; cells count at most FIT_CELL_MAX', () => {
    const small = tableFit(['k', 'v'], [['a', '1']]);
    expect(small.bucket).toBe(FIT_TABLE_BUCKETS[0]);
    const ledgerish = tableFit(['session', 'in', 'out', 'cache', 'cost', '⇣ compactions'], [['…FJFEQZ', '0', '-', '-', '-', '0']]);
    // 7 + 2 + 3 + 5 + 4 + 12 (the head at label size) + 5 gaps of 1.2ch + 1ch slack
    expect(ledgerish.need).toBe(40);
    expect(ledgerish.bucket).toBe(40);
    const long = tableFit(['id'], [['x'.repeat(200)]]);
    expect(long.need).toBe(FIT_CELL_MAX + 1);
    // wider than every bucket: the last bucket (the key-value layout below 96ch)
    expect(tableFit(Array.from({ length: 12 }, (_, i) => `col${i}`), [Array.from({ length: 12 }, () => 'x'.repeat(20))]).bucket).toBe(FIT_TABLE_BUCKETS.at(-1));
    expect([...FIT_TABLE_BUCKETS]).toEqual([...FIT_TABLE_BUCKETS].sort((a, b) => a - b));
  });

  it('empty cells are -, —, · or nothing', () => {
    for (const s of ['-', '—', '·', '', '  ']) expect(isNilCell(s)).toBe(true);
    for (const s of ['0', '-1', 'none']) expect(isNilCell(s)).toBe(false);
  });
});

describe('fitted tables: the render', () => {
  const t = fit({ type: 'Table', columns: ['session', 'in', 'cost'], rows: [['…' + 'Q'.repeat(30), '182k', '-'], ['…FJFEQZ', '0', '$0.42']] });
  it('carries its bucket, explicit table roles, label-style heads with the numeric class, and data-col on every cell', () => {
    expect(t.tag).toBe('table');
    expect(t.className).toMatch(/^blk blk-table tw-\d+$/);
    expect(FIT_TABLE_BUCKETS).toContain(Number(/tw-(\d+)/.exec(t.className)![1]));
    expect(t.attrs.get('role')).toBe('table');
    const th = t.all().filter((e) => e.tag === 'th');
    expect(th.map((e) => [e.text, e.className, e.attrs.get('role')])).toEqual([
      ['session', '', 'columnheader'],
      ['in', 'num', 'columnheader'],
      ['cost', 'num', 'columnheader'],
    ]);
    const td = t.all().filter((e) => e.tag === 'td');
    expect(td.map((e) => e.attrs.get('data-col'))).toEqual(['session', 'in', 'cost', 'session', 'in', 'cost']);
    expect(td.map((e) => e.className)).toEqual(['', 'num', 'num blk-nil', '', 'num', 'num']);
    expect(td.every((e) => e.attrs.get('role') === 'cell')).toBe(true);
  });
  it('a long cell keeps its full text in title (the CSS truncates it with an ellipsis); a short one has no title', () => {
    const cells = t.all().filter((e) => e.className === 'blk-cell');
    const long = cells.find((e) => e.text.startsWith('…QQ'))!;
    expect(long.attrs.get('title')).toBe('…' + 'Q'.repeat(30));
    expect(cells.find((e) => e.text === '182k')!.attrs.has('title')).toBe(false);
  });
  it('outside a fitted view (a card body) a table renders plain, as before', () => {
    const plain = renderBlock({ doc: fdoc }, { type: 'Table', columns: ['a'], rows: [['1']] }) as FEl;
    expect(plain.className).toBe('blk blk-table');
    expect(plain.all().some((e) => e.className === 'blk-cell')).toBe(false);
  });
});

describe('fitted text: ids, words and prose', () => {
  it('a Text with no whitespace longer than FIT_TOKEN_MIN is a token; shorter is a word; anything with a space is prose', () => {
    expect(fitTextKind('L-2026-10-23-matt-canoy-claude-195956-001', null)).toBe('token');
    expect(fitTextKind('x'.repeat(FIT_TOKEN_MIN), null)).toBe('word');
    expect(fitTextKind('x'.repeat(FIT_TOKEN_MIN + 1), null)).toBe('token');
    expect(fitTextKind('lore insight', 'quiet')).toBe('prose');
    expect(fitTextKind('#a-very-long-symbol-name', 'chip')).toBe('chip');
  });
  it('a token never breaks mid-token: one line (blk-tok), the full id in title', () => {
    const el = fit({ type: 'Text', text: 'L-2026-10-23-matt-canoy-claude-195956-001', tone: 'quiet' });
    expect(el.className).toBe('blk blk-text tone-quiet blk-tok');
    expect(el.attrs.get('title')).toBe('L-2026-10-23-matt-canoy-claude-195956-001');
    expect(css).toMatch(/\.mod-fit \.blk-tok \{[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis;/);
    // the fitted view never breaks inside a word to make room (the card rule word-break: break-word is undone)
    expect(css).toContain('.mod-fit .blk-text { word-break: normal; overflow-wrap: break-word; }');
  });
  it('in a row, prose after an id starts its own line and clamps to two lines (full text in title past 40 characters)', () => {
    const title = '“Define core combat loop and the frame-data budget for the first playable fighter”';
    const row = fit({ type: 'Box', direction: 'row', children: [{ type: 'Text', text: 'lore insight', tone: 'quiet' }, { type: 'Text', text: 'L-2026-10-23-001-abc', tone: 'quiet' }, { type: 'Text', text: title, tone: 'quiet' }] });
    const [kind, id, t] = row.children as FEl[];
    expect(kind!.className).toBe('blk blk-text tone-quiet blk-prose'); // before the id: stays on line 1
    expect(id!.className).toContain('blk-tok');
    expect(t!.className).toBe('blk blk-text tone-quiet blk-prose blk-break');
    expect(t!.attrs.get('title')).toBe(title);
    expect(css).toMatch(/\.mod-fit \.blk-row > \.blk-prose \{[^}]*-webkit-line-clamp: 2;/);
    expect(css).toContain('.mod-fit .blk-row > .blk-prose.blk-break { flex-basis: 100%; }');
    // a date (a short word) after the id stays beside it
    const dated = fit({ type: 'Box', direction: 'row', children: [{ type: 'Text', text: 'decision' }, { type: 'Text', text: 'TD-2026-10-20-294' }, { type: 'Text', text: '2026-10-20' }] });
    expect((dated.children as FEl[]).map((c) => c.className)).toEqual(['blk blk-text blk-word', 'blk blk-text blk-tok', 'blk blk-text blk-word']);
  });
  it('outside a fitted view text renders as before (no fit classes, no title)', () => {
    const el = renderBlock({ doc: fdoc }, { type: 'Text', text: 'L-2026-10-23-matt-canoy-claude-195956-001' }) as FEl;
    expect(el.className).toBe('blk blk-text');
    expect(el.attrs.has('title')).toBe(false);
  });
});

describe('the project swatch and the kit tones', () => {
  it('a hue tone is the ■ swatch in the hue ink (the chat header’s); a hollow mark is □; decorative', () => {
    const filled = fit({ type: 'Text', text: '●', tone: 'hue-3' });
    expect([filled.tag, filled.className, filled.text, filled.attrs.get('aria-hidden')]).toEqual(['span', 'blk blk-swatch pink h3', '■', 'true']);
    expect(fit({ type: 'Text', text: '○', tone: 'hue-1' }).text).toBe('□');
    expect(css).toMatch(/\.pink\.h3 \{ color: var\(--p-ochre-ink\); \}/);
    // no ringed dot any more: the radio-looking fill rules are gone
    expect(css).not.toMatch(/\.blk-text\[class\*="tone-hue-"\]/);
    expect(css).not.toMatch(/\.tone-hue-\d/);
  });
  it('the head and chip tones render (they were dropped, so section heads read as body text)', () => {
    expect(fit({ type: 'Text', text: 'tasks', tone: 'head' }).className).toBe('blk blk-text tone-head blk-word');
    expect(fit({ type: 'Text', text: '#gui', tone: 'chip' }).className).toBe('blk blk-text tone-chip');
    expect(css).toMatch(/\.tone-head \{ color: var\(--sec\); font-size: var\(--fs-label\); text-transform: uppercase;/);
  });
});

describe('the fence fits every mod but the Workshop', () => {
  it('right, left-bottom and desk-footer fences are fitted; the Workshop keeps its own rules', () => {
    for (const r of ['right', 'left-bottom', 'desk-footer'] as const) {
      const f = renderModFence({ doc: fdoc }, view(r), { block: { type: 'Text', text: 'hi' } }) as FEl;
      expect(f.all().find((e) => e.className.startsWith('mod-fence-body'))!.className).toBe('mod-fence-body mod-fit');
    }
    const w = renderModFence({ doc: fdoc }, { ...view('workshop'), name: 'gnomon.workshop', viewId: 'workshop.strip' }, { block: { type: 'Text', text: 'L-2026-10-23-matt-canoy-claude-195956-001' } }) as FEl;
    expect(w.all().find((e) => e.className.startsWith('mod-fence-body'))!.className).toBe('mod-fence-body');
    expect(w.all().some((e) => e.className.includes('blk-tok'))).toBe(false);
  });

  it('the side-column type: 11.5 body, 10.5 quiet and heads, an inline-size container named mod-fit', () => {
    expect(css).toMatch(/\.mod-fit \{ container: mod-fit \/ inline-size;[^}]*font-size: var\(--fs-control\);/);
    expect(css).toContain('.mod-fit .tone-quiet, .mod-fit .tone-paused { font-size: var(--fs-label); }');
    expect(css).toMatch(/\.mod-fit \.blk-table th \{ font-size: var\(--fs-label\); font-weight: 400; color: var\(--sec\);/);
    expect(css).toMatch(/\.mod-fit \.blk-table \{[^}]*font-variant-numeric: tabular-nums;/);
    expect(css).toContain('.mod-fit .blk-table .num { text-align: right; }');
    // never wider than its column (Mika: the 200px rail overflowed by 6px at max-width 24ch alone)
    expect(css).toMatch(/\.mod-fit \.blk-cell \{[^}]*max-width: min\(24ch, 100%\);[^}]*text-overflow: ellipsis;/);
    // key-value rows sit 8px apart
    expect(css).toContain('.mod-fit .blk-table tbody tr + tr { margin-top: 8px; }');
    expect(FIT_CELL_MAX).toBe(24);
  });

  it('every width bucket has its container query switching that table to key-value rows (and only those)', () => {
    const queries = [...css.matchAll(/@container mod-fit \(max-width: (\d+)ch\) \{([^\n]*)\}/g)];
    expect(queries.map((q) => Number(q[1]))).toEqual([...FIT_TABLE_BUCKETS]);
    for (const [, b, body] of queries) {
      expect(body).toContain(`.mod-fit .tw-${b} thead, .mod-fit .tw-${b} td.blk-nil { display: none; }`);
      expect(body).toContain(`.mod-fit .tw-${b} td::before { display: inline; }`);
      expect(body).toContain(`.mod-fit .tw-${b} td { display: inline-flex; align-items: baseline; max-width: 100%; min-width: 0; padding: 0 8px 0 0; }`);
      expect([...body!.matchAll(/\.tw-(\d+)/g)].every((m) => m[1] === b)).toBe(true);
    }
    expect(css).toContain('.mod-fit .blk-table td::before { content: attr(data-col);');
  });

  it('the mod meter is ink on a rule track, never the platform blue', () => {
    expect(css).toContain('.mod-fence progress::-webkit-progress-value { background: var(--ink2); }');
  });
});

describe('the first-party mods through the fitted renderer', () => {
  it('the Ledger sheet: one session with no usage fits as a table with right-aligned counts', () => {
    const s = ledger.emptyState();
    ledger.apply(s, { kind: 'session.open', payload: { hsid: 'hsid:v1:01JZZZZZZZZZZZZZZZZZFJFEQZ', backend: 'claude', project: 1 } });
    const el = fit(ledger.renderSheet(s, {}));
    const table = el.all().find((e) => e.tag === 'table')!;
    expect(table.all().filter((e) => e.tag === 'th').map((e) => e.className)).toEqual(['', 'num', 'num', 'num', 'num', 'num']);
    expect(table.all().filter((e) => e.tag === 'td').map((e) => e.text)).toEqual(['…FJFEQZ', '0', '-', '-', '-', '0']);
  });

  it('Paradigm Context: the swatch head, label-style zone heads with their counts as quiet meta, a truncating lore id', () => {
    const el = fit(
      paradigm.renderSheet({
        paradigm: { v: 'paradigm-slice:v1', state: 'ok', project: 4, name: 'a-platform-fighter', at: '2026-10-23', newest: '2026-10-23', tasks: { open: 0, items: [] }, decisions: { items: [] }, lore: { items: [{ id: 'L-2026-10-23-matt-canoy-claude-195956-001', title: 'Define core combat loop', type: 'insight' }], count: { of: 1 } }, symbols: [] },
      }),
    );
    expect(el.all().find((e) => e.className.includes('blk-swatch'))!.className).toBe('blk blk-swatch pink h4');
    const heads = el.all().filter((e) => e.className.includes('tone-head'));
    expect(heads.map((e) => e.text)).toEqual(['tasks', 'decisions', 'lore']);
    // the count sits beside its head, quiet
    expect(heads.map((e) => (el.all().find((p) => p.children.includes(e))!.children[1] as FEl).text)).toEqual(['0 of 0 open', '0 of 0', '1 of 1']);
    expect(el.all().find((e) => e.text === 'L-2026-10-23-matt-canoy-claude-195956-001' && e.tag === 'p')!.className).toContain('blk-tok');
    expect(el.all().filter((e) => e.text === 'no open tasks' || e.text === 'no decisions').every((e) => e.className === 'blk blk-text tone-quiet blk-prose')).toBe(true);
  });
});

describe('truncated items are reachable by keyboard (Mika 2026-10-23)', () => {
  class TEl implements TruncEl {
    readonly a = new Map<string, string>();
    constructor(public scrollWidth: number, public clientWidth: number, readonly textContent: string, public scrollHeight = 14, public clientHeight = 14) {}
    getAttribute(n: string): string | null {
      return this.a.has(n) ? this.a.get(n)! : null;
    }
    setAttribute(n: string, v: string): void {
      this.a.set(n, v);
    }
    removeAttribute(n: string): void {
      this.a.delete(n);
    }
  }
  it('only the items the CSS cut get one tab stop each and their full text in title; one that fits again loses it', () => {
    const id = new TEl(300, 120, 'L-2026-10-23-matt-canoy-claude-195956-001');
    const fits = new TEl(60, 60, 'T-1');
    const clamped = new TEl(200, 200, '“a long title”', 60, 36);
    const titled = new TEl(300, 120, '…QQQQ');
    titled.setAttribute('title', 'the full cell');
    expect(markTruncated([id, fits, clamped, titled])).toBe(3);
    expect([id, fits, clamped, titled].map((e) => e.getAttribute('tabindex'))).toEqual(['0', null, '0', '0']);
    expect(id.getAttribute('title')).toBe('L-2026-10-23-matt-canoy-claude-195956-001');
    expect(titled.getAttribute('title')).toBe('the full cell'); // a renderer title is kept
    expect(fits.getAttribute('title')).toBeNull();
    // the column widens: it fits, so it is no longer a stop
    id.clientWidth = 300;
    expect(markTruncated([id])).toBe(0);
    expect(id.getAttribute('tabindex')).toBeNull();
    expect(id.getAttribute('data-trunc')).toBeNull();
  });
  it('covers ids, cells and clamped row prose; focus shows the whole text with a visible ring', () => {
    expect(TRUNCATABLE_SELECTOR).toBe('.mod-fit .blk-tok, .mod-fit .blk-cell, .mod-fit .blk-row > .blk-prose');
    expect(css).toMatch(/\.mod-fit \[data-trunc\]:focus-visible \{ outline: 2px solid var\(--key-edge\);[^}]*white-space: normal;[^}]*overflow: visible;[^}]*-webkit-line-clamp: unset;/);
    const mount = readFileSync(path.join(ROOT, 'src', 'ui', 'mod-panels-mount.ts'), 'utf8');
    expect(mount).toContain('markTruncated(root.querySelectorAll<HTMLElement>(TRUNCATABLE_SELECTOR))');
    expect(mount).toContain('new ResizeObserver(');
    expect(mount).toContain('resize?.disconnect();');
  });
});
