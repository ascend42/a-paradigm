/**
 * #gui-toast (design system: component toast, zone toasts, rule notices-by-kind; board gnomon-notices, choice
 * band-for-alerts): the pure policy (core/toasts.ts), the region's DOM (ui/toasts.ts) against a tiny fake document,
 * and the page wiring read from the source (the band keeps #repin and #voice-dev only).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { splitToastText, TOAST_INFO_MS, TOAST_MAX, TOAST_WARN_MS, toastClass, toastClosable, toastLive, toastMayClip, toastOverflow, toastTag, toastTtl } from '../src/core/toasts.js';
import { mountToasts, noticeChannel } from '../src/ui/toasts.js';
import { cardIn, notArrivedText } from '../src/ui/card-focus.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p: string[]): string => readFileSync(path.join(ROOT, ...p), 'utf8');

describe('toast policy (core/toasts.ts)', () => {
  it('info leaves after 6 s, warn after 10 s; fail and persistent never leave by themselves', () => {
    expect(toastTtl('info', false)).toBe(TOAST_INFO_MS);
    expect(TOAST_INFO_MS).toBe(6000);
    expect(toastTtl('warn', false)).toBe(TOAST_WARN_MS);
    expect(TOAST_WARN_MS).toBeGreaterThan(TOAST_INFO_MS);
    expect(toastTtl('fail', false)).toBeNull();
    expect(toastTtl('info', true)).toBeNull();
    expect(toastTtl('warn', true)).toBeNull();
  });
  it('fail is announced assertively; every other kind politely', () => {
    expect(toastLive('fail')).toBe('assertive');
    expect(toastLive('info')).toBe('polite');
    expect(toastLive('warn')).toBe('polite');
  });
  it('kind is never told by hue alone: fail and warn carry a word; info none', () => {
    expect(toastTag('fail', false)).toBe('failed');
    expect(toastTag('warn', false)).toBe('warning');
    expect(toastTag('warn', true)).toBe('asks first');
    expect(toastTag('info', false)).toBeNull();
    expect(toastTag('info', true)).toBeNull();
  });
  it('the edge goes by kind (class), and only fail and persistent toasts carry a close key', () => {
    expect([toastClass('info'), toastClass('warn'), toastClass('fail')]).toEqual(['toast', 'toast warn', 'toast fail']);
    expect(toastClosable('fail', false)).toBe(true);
    expect(toastClosable('info', true)).toBe(true);
    expect(toastClosable('info', false)).toBe(false);
    expect(toastClosable('warn', false)).toBe(false);
  });
  it('at most three, newest on top; an older info leaves first, then warn; fail and persistent wait hidden', () => {
    expect(TOAST_MAX).toBe(3);
    const e = (id: number, kind: 'info' | 'warn' | 'fail', persistent = false) => ({ id, kind, persistent });
    expect(toastOverflow([e(1, 'info'), e(2, 'fail'), e(3, 'info')])).toEqual({ drop: [], shown: [3, 2, 1] });
    expect(toastOverflow([e(1, 'warn'), e(2, 'info'), e(3, 'fail'), e(4, 'info')])).toEqual({ drop: [2], shown: [4, 3, 1] });
    expect(toastOverflow([e(1, 'warn'), e(2, 'fail'), e(3, 'fail'), e(4, 'fail')])).toEqual({ drop: [1], shown: [4, 3, 2] });
    // nothing may leave: the oldest waits hidden, and comes back when a slot frees
    expect(toastOverflow([e(1, 'fail'), e(2, 'info', true), e(3, 'fail'), e(4, 'fail')])).toEqual({ drop: [], shown: [4, 3, 2] });
  });
  it('a new info is never lost behind update, offer and a fail: it shows, the oldest persistent waits hidden', () => {
    const e = (id: number, kind: 'info' | 'warn' | 'fail', persistent = false) => ({ id, kind, persistent });
    const r = toastOverflow([e(1, 'info', true), e(2, 'info', true), e(3, 'fail'), e(4, 'info')]);
    expect(r.drop).toEqual([]);
    expect(r.shown).toEqual([4, 3, 2]);
    // a fifth: the older plain info gives way, never the newest
    expect(toastOverflow([e(1, 'info', true), e(2, 'info', true), e(3, 'fail'), e(4, 'info'), e(5, 'info')])).toEqual({ drop: [4], shown: [5, 3, 2] });
  });
  it("a refusal's next: line is kept apart from its main text; a long main text goes to title=", () => {
    expect(splitToastText('NOT_CONNECTED  nothing was sent\n  next: check the kernel · gnomon status')).toEqual({ main: 'NOT_CONNECTED  nothing was sent', next: 'next: check the kernel · gnomon status' });
    expect(splitToastText('send word saved')).toEqual({ main: 'send word saved', next: null });
    expect(toastMayClip('x'.repeat(176))).toBe(false);
    expect(toastMayClip('x'.repeat(177))).toBe(true);
  });
});

/* ── a tiny fake document: just what ui/toasts.ts touches ─────────────────── */
class FakeEl {
  tagName: string;
  className = '';
  textContent = '';
  title = '';
  type = '';
  hidden = false;
  parent: FakeEl | null = null;
  children: FakeEl[] = [];
  attrs = new Map<string, string>();
  listeners = new Map<string, Array<(e: unknown) => void>>();
  constructor(tag: string, readonly doc: FakeDoc) {
    this.tagName = tag.toUpperCase();
  }
  get childNodes(): FakeEl[] {
    return this.children;
  }
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }
  appendChild(c: FakeEl): FakeEl {
    c.remove();
    c.parent = this;
    this.children.push(c);
    return c;
  }
  get firstChild(): FakeEl | null {
    return this.children[0] ?? null;
  }
  get isConnected(): boolean {
    return true;
  }
  insertBefore(c: FakeEl, ref: FakeEl | null): FakeEl {
    if (c.parent === this) this.doc.moves++;
    c.remove();
    c.parent = this;
    this.children.splice(ref ? this.children.indexOf(ref) : this.children.length, 0, c);
    return c;
  }
  remove(): void {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  contains(o: unknown): boolean {
    for (let x = o as FakeEl | null; x; x = x.parent) if (x === this) return true;
    return false;
  }
  addEventListener(t: string, f: (e: unknown) => void): void {
    this.listeners.set(t, [...(this.listeners.get(t) ?? []), f]);
  }
  fire(t: string, e: Record<string, unknown> = {}): void {
    for (const f of this.listeners.get(t) ?? []) f({ isTrusted: true, stopPropagation() {}, ...e });
  }
  focus(): void {
    this.doc.activeElement = this;
  }
  /** only the one selector toasts.ts uses: '.toast:not([hidden]) button' */
  querySelector(): FakeEl | null {
    for (const t of this.children) if (!t.hidden && t.className.split(' ').includes('toast')) for (const b of all(t)) if (b.tagName === 'BUTTON') return b;
    return null;
  }
  text(): string {
    return [this.textContent, ...this.children.map((c) => c.text())].join('');
  }
}
const all = (e: FakeEl): FakeEl[] => e.children.flatMap((c) => [c, ...all(c)]);
class FakeDoc {
  activeElement: FakeEl | null = null;
  moves = 0;
  createElement(tag: string): FakeEl {
    return new FakeEl(tag, this);
  }
}

describe('toast region (ui/toasts.ts)', () => {
  let doc: FakeDoc;
  let region: FakeEl;
  let pill: FakeEl;
  let say: FakeEl;
  let alert: FakeEl;
  const textOf = (t: FakeEl): string => t.children.find((c) => c.className === 'toast-text')!.textContent;
  const shown = (): string[] => region.children.filter((t) => !t.hidden).map(textOf);
  const byText = (x: string): FakeEl => region.children.find((t) => textOf(t) === x)!;
  const mount = () => mountToasts(doc as unknown as Document, region as unknown as HTMLElement, { say: say as unknown as HTMLElement, alert: alert as unknown as HTMLElement, returnFocus: () => pill as unknown as HTMLElement });
  beforeEach(() => {
    vi.useFakeTimers();
    doc = new FakeDoc();
    region = doc.createElement('div');
    pill = doc.createElement('button');
    say = doc.createElement('span');
    alert = doc.createElement('span');
  });
  afterEach(() => vi.useRealTimers());

  it('info leaves after 6 s; hover pauses it; warn stays 10 s; fail stays until closed', () => {
    const t = mount();
    t.show('send word saved');
    t.show('Dictate turned off after 15 min idle', { kind: 'warn' });
    t.show('NOT_CONNECTED  nothing was sent', { kind: 'fail' });
    expect(shown()).toEqual(['NOT_CONNECTED  nothing was sent', 'Dictate turned off after 15 min idle', 'send word saved']);
    const info = byText('send word saved');
    info.fire('mouseenter');
    vi.advanceTimersByTime(TOAST_INFO_MS + 1);
    expect(shown()).toContain('send word saved'); // paused while hovered
    info.fire('mouseleave');
    vi.advanceTimersByTime(TOAST_INFO_MS + 1);
    expect(shown()).not.toContain('send word saved');
    vi.advanceTimersByTime(TOAST_WARN_MS);
    expect(shown()).toEqual(['NOT_CONNECTED  nothing was sent']);
    vi.advanceTimersByTime(60_000);
    expect(shown()).toEqual(['NOT_CONNECTED  nothing was sent']);
  });
  it('a word marks fail and warn; the next: line; a 24px close key on fail; Esc (page) closes the newest fail', () => {
    const t = mount();
    t.show('NOT_CONNECTED  nothing was sent\n  next: check the kernel', { kind: 'fail' });
    const el = region.children[0]!;
    expect(el.className).toBe('toast fail');
    expect(el.getAttribute('role')).toBeNull(); // the toast is not a live region; the page's regions announce
    expect(el.children[0]!.className).toBe('toast-tag');
    expect(el.children[0]!.textContent).toBe('failed');
    expect(el.children.find((c) => c.className === 'toast-next meta')!.textContent).toBe('next: check the kernel');
    const close = all(el).find((c) => c.className.includes('toast-close'))!;
    expect(close.className).toBe('key quiet toast-close'); // .key.quiet is at least 24 x 24
    expect(close.getAttribute('aria-label')).toBe('Close');
    expect(t.dismissNewestFail()).toBe(true);
    expect(region.children).toHaveLength(0);
    expect(t.dismissNewestFail()).toBe(false);
  });
  it('announces through the live regions index.html holds: fail assertive, the rest polite; two quick ones both kept', () => {
    const t = mount();
    t.show('send word saved');
    t.show('model switched'); // right after: appended, never replacing the first
    expect(say.children.map((c) => c.textContent)).toEqual(['send word saved', 'model switched']);
    t.show('NOT_CONNECTED  nothing was sent', { kind: 'fail' });
    expect(alert.children.map((c) => c.textContent)).toEqual(['failed: NOT_CONNECTED  nothing was sent']);
    vi.advanceTimersByTime(10_001);
    expect(say.children).toHaveLength(0); // pruned once read
  });
  it('a clamped text is focusable (it opens on focus) and announced whole; a fail is never clamped', () => {
    const t = mount();
    const long = 'x '.repeat(120).trim();
    t.show(long);
    const text = region.children[0]!.children.find((c) => c.className === 'toast-text')! as FakeEl & { tabIndex?: number };
    expect(text.title).toBe(long);
    expect(text.tabIndex).toBe(0);
    expect(say.children.at(-1)!.textContent).toBe(long);
    t.show(long, { kind: 'fail' });
    const failText = region.children[0]!.children.find((c) => c.className === 'toast-text')! as FakeEl & { tabIndex?: number };
    expect(failText.tabIndex).toBeUndefined();
  });
  it('a persistent toast with one key and a named close: the key runs its press, close calls onClose', () => {
    const t = mount();
    const press = vi.fn();
    const closed = vi.fn();
    const h = t.show("Let Gnomon handle these today?", { persistent: true, key: { label: 'Make it standing', onPress: press }, closeLabel: 'Not today', onClose: closed });
    const [key, close] = all(region.children[0]!).filter((c) => c.tagName === 'BUTTON');
    expect(key!.textContent).toBe('Make it standing');
    expect(close!.textContent).toBe('Not today');
    key!.fire('click');
    expect(press).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(60_000);
    expect(h.present).toBe(true); // persistent: never leaves by itself
    close!.fire('click');
    expect(closed).toHaveBeenCalledOnce();
    expect(h.present).toBe(false);
  });
  it('focus: a new toast moves no element (focus stays); a focused toast leaving returns focus where it was, never to another key', () => {
    const t = mount();
    const composer = doc.createElement('textarea');
    t.show('update', { persistent: true, key: { label: 'Restart now', onPress: () => undefined } });
    const f = t.show('NOT_CONNECTED', { kind: 'fail', key: { label: 'Re-pin', onPress: () => undefined } });
    const failKey = all(byText('NOT_CONNECTED')).find((c) => c.textContent === 'Re-pin')!;
    byText('NOT_CONNECTED').fire('focusin', { relatedTarget: composer });
    failKey.focus();
    t.show('send word saved'); // arrives on top while the fail's key has focus
    expect(doc.moves).toBe(0);
    expect(doc.activeElement).toBe(failKey);
    f.dismiss();
    expect(doc.activeElement).toBe(composer); // not the update toast's Restart now
    // no previous focus known: the page's fallback (the pill)
    const g = t.show('X_FAIL', { kind: 'fail' });
    all(byText('X_FAIL')).find((c) => c.tagName === 'BUTTON')!.focus();
    g.dismiss();
    expect(doc.activeElement).toBe(pill);
  });
  it('a new info shows even with update, offer and a fail up (the oldest persistent waits hidden, then returns)', () => {
    const t = mount();
    t.show('Gnomon was updated', { persistent: true });
    t.show('Let Gnomon handle these today?', { persistent: true });
    const f = t.show('NOT_CONNECTED', { kind: 'fail' });
    t.show('send word saved');
    expect(shown()).toEqual(['send word saved', 'NOT_CONNECTED', 'Let Gnomon handle these today?']);
    f.dismiss();
    expect(shown()).toEqual(['send word saved', 'Let Gnomon handle these today?', 'Gnomon was updated']);
  });
});

describe('notice channel (ui/toasts.ts noticeChannel)', () => {
  let region: FakeEl;
  let doc: FakeDoc;
  beforeEach(() => {
    vi.useFakeTimers();
    doc = new FakeDoc();
    region = doc.createElement('div');
  });
  afterEach(() => vi.useRealTimers());
  const texts = (): string[] => region.children.map((t) => t.children.find((c) => c.className === 'toast-text')!.textContent);

  it('a stale fail clears when the same action succeeds, even after another notice came between', () => {
    const notice = noticeChannel(mountToasts(doc as unknown as Document, region as unknown as HTMLElement));
    notice('the name was not changed', 'fail', { source: 'rename' });
    notice('send word saved');
    expect(texts()).toEqual(['send word saved', 'the name was not changed']);
    notice(null, 'info', { source: 'rename' }); // the rename worked
    expect(texts()).toEqual(['send word saved']); // the other source's toast is untouched
    notice('the mic was not toggled', 'fail', { source: 'mic' });
    notice('voice stays off', 'fail', { source: 'voice' });
    notice('Starting voice…', 'info', { source: 'voice' });
    // the voice fail went with its own success; the mic fail stays; the plain info was replaced as usual
    expect(texts()).toEqual(['Starting voice…', 'the mic was not toggled']);
  });
  it('a new notice replaces the last unless it was a fail; a bare clear clears the last', () => {
    const notice = noticeChannel(mountToasts(doc as unknown as Document, region as unknown as HTMLElement));
    notice('run mode a → b: confirm with Touch ID', 'warn', { held: true, source: 'run-mode' });
    notice('model switched');
    expect(texts()).toEqual(['model switched']);
    notice('NOT_CONNECTED', 'fail');
    notice('send word saved');
    expect(texts()).toEqual(['send word saved', 'NOT_CONNECTED']);
    notice(null);
    expect(texts()).toEqual(['NOT_CONNECTED']);
  });
});

describe('page wiring (source read)', () => {
  const app = read('src', 'ui', 'app.ts');
  const html = read('static', 'index.html');
  const css = read('static', 'styles.css');
  it('the band keeps #repin and #voice-dev only; one #toasts region replaces #notice and #voice-toast', () => {
    expect(html).toMatch(/id="repin" class="notice repin kernel-owned" role="alert"/);
    expect(html).toMatch(/id="voice-dev" class="notice voice-dev kernel-owned" role="alert"/);
    expect(html).not.toMatch(/id="notice"|id="voice-toast"/);
    // the live regions are in the page from load (announcements need no DOM churn)
    expect(html).toContain('<div class="toast-anchor"><span id="toast-say" class="sr-only" role="status" aria-live="polite"></span><span id="toast-alert" class="sr-only" role="alert" aria-live="assertive"></span><div id="toasts" class="toasts"></div></div>');
    // placement A (founder): the first child of the chat column's .feed, under the chat header row (Tab meets it
    // after the chat header and before the conversation)
    expect(html).toMatch(/<div class="feed">\n<div class="toast-anchor">/);
    expect(html.indexOf('id="toasts"')).toBeGreaterThan(html.indexOf('id="more-menu"'));
    expect(html.indexOf('id="toasts"')).toBeLessThan(html.indexOf('id="viewport"'));
    expect(html.indexOf('id="toasts"')).toBeLessThan(html.indexOf('id="pane-stack"'));
    // the desk can be removed (a forged serverSig): the region is lifted and moves to the shell first
    expect(app).toMatch(/anchor\.classList\.add\('lifted'\);[^\n]*\n\s*\$\('gnomon'\)\.appendChild\(anchor\);\s*\}\s*document\.querySelector\('\.desk'\)\?\.remove\(\);/);
    expect(app).not.toMatch(/\$\('notice'\)|\$\('voice-toast'\)|update-banner|document\.body\.prepend/);
  });
  it('every notice() names its kind; the update toast focuses the card and never decides it', () => {
    expect(app).not.toMatch(/notice\([^;]*, true\)/);
    expect(app).toMatch(/key: \{ label: 'Restart now', [^}]*onPress: \(\) => focusCard\(cardId, 'upgrade card'\) \}/);
    expect(app).toContain("focusCard: (cardId) => focusCard(cardId, 'grant card'),");
    expect(app).toMatch(/e\.key === 'Escape' && !editableFocus\(\) && toasts\(\)\.dismissNewestFail\(\)/);
    // classifications (Mika/Aegis): re-pin not arrived is a warn that clears when the card arrives; restarting is held
    expect(app).toMatch(/notice\(notArrivedText\(what\), 'warn'\);\s*if \(noticeShown\) cardWait = \{ cardId, toast: noticeShown \};/);
    // Mika #1: focusCard matches the exact cardId only, never any gate-class card
    expect(app).not.toMatch(/kind-gate-class/);
    expect(app).toContain("const cardInPile = (cardId: string): Element | null => cardIn($('stack'), cardId);"); 
    expect(app).toMatch(/paintUpdateBanner\(\);\s*checkCardWait\(\);/);
    expect(app).toContain("notice('Gnomon is restarting with the new version…', 'info', { held: true });");
    expect(app).toContain("bare ? 'warn' : 'info', { source: 'mic-key' }");
    expect(app).toContain("if (!cardId) return notice(notArrivedText('Touch ID card'), 'warn');");
  });
  it('styles: the chat column\'s right edge under its header, edge by kind, no bottom placement, reduced motion', () => {
    expect(css).toMatch(/\.feed > \.toast-anchor \{ position: absolute; top: 8px; left: 20px; right: 20px; height: 0; z-index: 15; \}/);
    expect(css).toMatch(/\.toasts \{ position: absolute; top: 0; left: 0; right: 0;[^}]*pointer-events: none; \}/);
    // Mika #3: one fixed width, clamped to the column
    expect(css).toMatch(/\.toast \{ box-sizing: border-box; width: min\(calc\(44ch \+ 26px\), 100%\);/);
    // Mika #4: the clamp opens on hover or focus, and a fail is never clamped
    expect(css).toMatch(/\.toast:hover \.toast-text, \.toast-text:focus, \.toast\.fail \.toast-text \{ display: block; -webkit-line-clamp: none;/);
    expect(css).not.toMatch(/\.toasts \{[^}]*display: none|\.toasts \{ display: none/); // never hidden under a sheet any more
    expect(css).toMatch(/\.toast \{[^}]*font-size: 11\.5px;[^}]*border-left: 3px solid var\(--ink\);[^}]*border-radius: var\(--radius\);/);
    expect(css).toMatch(/\.toast\.warn \{ border-left: 3px dashed var\(--warn-edge\); \}/);
    expect(css).toMatch(/\.toast-tag \{ font-size: 10\.5px; font-weight: 600; text-transform: uppercase;[^}]*color: var\(--ink\); \}/);
    expect(css).toMatch(/\.toast\.fail \{ border-left-color: var\(--fail-edge\); \}/);
    expect(css).toMatch(/-webkit-line-clamp: 4;/);
    expect(css).toMatch(/\[data-motion="full"\] \.toast \{ animation: toast-in 120ms/);
    expect(css).not.toMatch(/\.voice-toast|\.standing-toast|\.standing-offer|\.notice\.fail/);
  });
  it('a sheet open: the region moves to the window\'s top right above the scrim, left of the Voice settings drawer', () => {
    const overlayZ = Number(/\.overlay \{ z-index: (\d+); \}/.exec(css)![1]);
    const m = /body:has\(\.overlay:not\(\[hidden\]\)\) \.feed > \.toast-anchor, \.toast-anchor\.lifted \{([^}]*)\}/.exec(css);
    expect(css).not.toMatch(/\.shell > \.toast-anchor/); // Mika #6: no dead selector
    expect(m).not.toBeNull();
    expect(m![1]).toContain('position: fixed; top: 48px; right: 14px; left: auto;'); // under the 44px header row (48: a layout step)
    expect(Number(/z-index: (\d+)/.exec(m![1])![1])).toBeGreaterThan(overlayZ);
    expect(css).toMatch(/body:has\(\.vs-drawer:not\(\[hidden\]\)\) \.feed > \.toast-anchor \{ right: calc\(min\(520px, 100vw\) \+ 14px\); \}/);
    expect(css).toMatch(/\.vs-drawer \.voice-sheet \{ width: min\(520px, 100vw\);/); // the drawer's width that offset assumes
  });
});

describe('a toast key focuses its own card or none (ui/card-focus.ts, Mika #1)', () => {
  const card = (id: string, cls: string) => ({ id, cls, getAttribute: (n: string) => (n === 'data-card-id' ? id : null) });
  const pile = (...cards: ReturnType<typeof card>[]) => ({ querySelectorAll: (sel: string) => (sel === '.card[data-card-id]' ? cards : []) });
  it('the exact cardId only; a different gate-class card is never taken for a missing one', () => {
    const gate = card('card:gate-other', 'card kind-gate-class');
    const grant = card('card:grant', 'card');
    expect(cardIn(pile(gate, grant), 'card:grant')).toBe(grant);
    expect(cardIn(pile(gate), 'card:grant')).toBeNull(); // the grant card has not arrived: nothing, not the gate card
    expect(cardIn(pile(gate), 'card:upgrade')).toBeNull();
    expect(cardIn(pile(), 'card:repin')).toBeNull();
  });
  it('the warn names the card that was asked for', () => {
    expect(notArrivedText('grant card')).toBe('the grant card has not arrived yet; it shows in the stack when it does');
    expect(notArrivedText('upgrade card')).toBe('the upgrade card has not arrived yet; it shows in the stack when it does');
    expect(notArrivedText('re-pin card')).toMatch(/^the re-pin card /);
  });
});
