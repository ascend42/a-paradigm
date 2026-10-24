/**
 * design-system card.body-scroll (founder 2026-10-23: "as long as the card text is scrollable in the event it's too
 * large that's fine"): a card body taller than its cap scrolls inside the card, once, in the shared card CSS and
 * renderer; the title, the keys and the presence line stay outside the scroll area; the area is a named tab stop only
 * while it overflows (Mika 2026-10-23: a short card adds no stop), with a worded cue under it.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CARD_BODY_LABEL, CARD_MORE, markCardBody, renderCard } from '../src/core/render.js';

const CSS = fs.readFileSync(path.join(__dirname, '..', 'static', 'styles.css'), 'utf8');
type El = { tag: string; className: string; attrs: Map<string, string>; kids: unknown[]; appendChild(c: unknown): unknown; setAttribute(n: string, v: string): void };
function mini() {
  const els: El[] = [];
  const doc = {
    createElement: (tag: string) => {
      const e: El = { tag, className: '', attrs: new Map(), kids: [], appendChild(c) { this.kids.push(c); return c; }, setAttribute(n, v) { this.attrs.set(n, v); } };
      els.push(e);
      return e;
    },
    createTextNode: (t: string) => t,
  };
  return { doc, els };
}
const within = (root: El, target: El): boolean => root === target || root.kids.some((k) => typeof k !== 'string' && within(k as El, target));
const textOf = (e: unknown): string => (typeof e === 'string' ? e : (e as El).kids.map(textOf).join('\n'));

describe('card.body-scroll', () => {
  it('the shared card CSS caps the body and scrolls it inside the card, with a visible focus ring', () => {
    const rule = /\.card-body \{[^}]*max-height: var\(--card-body-max\)[^}]*overflow-y: auto[^}]*\}/.exec(CSS);
    expect(rule, 'the .card-body scroll rule').not.toBeNull();
    expect(rule![0]).toContain('--card-body-max: min(42vh, 26em)');
    expect(rule![0]).toContain('overflow-x: hidden');
    expect(CSS).toMatch(/\.card-body:focus-visible \{ outline: 2px solid var\(--key-edge\)/);
    // nothing outside the body is capped: the keys and the presence line never scroll away
    expect(CSS).not.toMatch(/\.card-keys \{[^}]*overflow/);
    expect(CSS).not.toMatch(/\.card \{[^}]*max-height/);
  });

  it('a long batch card: the body (a tab stop once it overflows) and its cue; the title, the keys and the presence line sit outside it', () => {
    const { doc, els } = mini();
    const lines = ['Turn on 4 MCP servers', 'asked from Settings · 14:08 · applies to new sessions'];
    for (let i = 1; i <= 4; i++) lines.push(`server ${i} of 4: s${i} for all your repos:`, ...Array.from({ length: 12 }, (_, n) => `  │ fact ${n} of server ${i}`), `  └ end of server ${i} of 4`);
    lines.push('Allow takes the root key and your presence (Touch ID or your Mac password), once for all 4 · never standing, never by voice; deny changes nothing');
    const block = { type: 'Box', children: lines.map((text) => ({ type: 'Text', text })) };
    const card = renderCard({ doc } as never, { cardId: 'card:B1', kind: 'grant', requestedBy: 'p:abcdefgh/matt', hsid: null, repo: null, state: 'pending', contentHash: `sha256:${'a'.repeat(64)}`, flags: [], decisions: ['allow', 'deny'], decidable: true, rootRows: { lines: [], action: 'mcp.enable' } } as never, block) as unknown as El;
    const body = els.find((e) => e.className.startsWith('card-body'))!;
    // rendered, it is no tab stop yet: markCardBody decides once it is measured
    expect(body.attrs.has('tabindex')).toBe(false);
    const cue = els.find((e) => e.className.startsWith('meta card-more'))!;
    expect(cue.className).toContain('is-off');
    expect(card.kids.indexOf(cue)).toBe(card.kids.indexOf(body) + 1);
    expect(textOf(body)).toContain('fact 11 of server 4'); // every line, never cut
    const title = els.find((e) => e.className.startsWith('card-title'))!;
    const keys = els.find((e) => e.className === 'card-keys')!;
    const presence = els.find((e) => e.className === 'lt-presence')!;
    for (const outside of [title, keys, presence]) expect(within(body, outside)).toBe(false);
    // DOM order: the body, then the keys (Tab from the body lands on Allow; nothing traps focus)
    const order = (e: El): number => card.kids.indexOf(e);
    expect(order(body)).toBeGreaterThan(-1);
    expect(order(keys)).toBeGreaterThan(order(body));
    expect(textOf(keys)).toContain('allow');
    // no element in the card is a tab stop before measuring besides the keys and the details summary's native one
    expect(els.filter((e) => e.attrs.get('tabindex') === '0')).toEqual([]);
  });

  it('markCardBody: a tab stop, named, with "more below" only while the body overflows; "end" once scrolled to it', () => {
    const fake = (scrollHeight: number, clientHeight: number, scrollTop = 0) => {
      const attrs = new Map<string, string>();
      const cls = new Set<string>();
      const classList = { toggle: (c: string, on: boolean) => (on ? cls.add(c) : cls.delete(c)) };
      return { scrollHeight, clientHeight, scrollTop, attrs, cls, classList, setAttribute: (n: string, v: string) => attrs.set(n, v), removeAttribute: (n: string) => attrs.delete(n) };
    };
    const cueOf = () => { const cls = new Set<string>(['is-off']); return { textContent: '' as string | null, cls, classList: { toggle: (c: string, on: boolean) => (on ? cls.add(c) : cls.delete(c)) } }; };
    const long = fake(1453, 299);
    const cue = cueOf();
    expect(markCardBody(long, cue)).toBe(true);
    expect([long.attrs.get('tabindex'), long.attrs.get('role'), long.attrs.get('aria-label')]).toEqual(['0', 'group', CARD_BODY_LABEL]);
    expect(long.cls.has('scrolls')).toBe(true);
    expect([cue.cls.has('is-off'), cue.textContent]).toEqual([false, CARD_MORE.more]);
    long.scrollTop = 1453 - 299;
    markCardBody(long, cue);
    expect(cue.textContent).toBe(CARD_MORE.end);
    // a short card: no stop, no name, no cue
    const short = fake(120, 120);
    short.attrs.set('tabindex', '0');
    const c2 = cueOf();
    expect(markCardBody(short, c2)).toBe(false);
    expect(short.attrs.size).toBe(0);
    expect(c2.cls.has('is-off')).toBe(true);
    expect(CSS).toMatch(/\.card-more\.is-off \{ display: none; \}/);
  });
});
