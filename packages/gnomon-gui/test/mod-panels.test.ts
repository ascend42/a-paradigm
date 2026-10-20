/**
 * #gui K0 mod panels (core/mod-panels.ts): slot → region mapping, the
 * `mod:<name>` fence with its dev badge, the debounced single-flight
 * scheduler, and no render without a feed-kind row. Fake DOM + fake timers.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fenceLabel, holdsButton, PANEL_BUTTON_REFUSAL, PANEL_HEADING, isFeedRow, MOD_FEED_KINDS, MOD_PANEL_DEBOUNCE_MS, ModPanelScheduler, modPanelsOf, modViewParams, panelsIn, renderModFence, SLOT_REGIONS } from '../src/core/mod-panels.js';
import { renderBlock, type MiniDoc, type MiniEl } from '../src/core/render.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

class FakeTimers {
  now = 0;
  #next = 1;
  readonly pending = new Map<number, { at: number; fn: () => void }>();
  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = this.#next++;
    this.pending.set(id, { at: this.now + ms, fn });
    return id;
  };
  clearTimeout = (t: unknown): void => void this.pending.delete(t as number);
  advance(ms: number): void {
    this.now += ms;
    for (const [id, p] of [...this.pending].sort((a, b) => a[1].at - b[1].at)) {
      if (p.at <= this.now) {
        this.pending.delete(id);
        p.fn();
      }
    }
  }
}
const flush = () => new Promise((r) => setTimeout(r, 0));

const status = {
  mods: {
    modAbiId: 'sha256:x',
    running: [],
    paused: [],
    views: [
      { name: 'ledger', viewId: 'ledger.sheet', slot: 'sidebar', placement: 'append', dev: false },
      { name: 'ledger', viewId: 'ledger.strip', slot: 'composer.footer', placement: 'append', dev: false },
      { name: 'hello', viewId: 'hello.panel', slot: 'panel', placement: 'append', dev: true },
      { name: 'hello', viewId: 'hello.status', slot: 'status.mod', placement: 'append', dev: true },
      { name: 'evil', viewId: 'evil.card', slot: 'card.detail:permission', placement: 'replace', dev: false },
      { name: 'Bad Name', viewId: 'x.y', slot: 'panel', dev: false },
      { name: 'inbox', viewId: 'inbox.card', slot: 'inbox.card', dev: false },
      'junk',
    ],
  },
};

describe('#gui mod panels: slots', () => {
  it('maps composer.footer → desk footer, sidebar → left pane bottom, panel → right pane; every other slot and every kernel-owned region has none', () => {
    expect(SLOT_REGIONS).toEqual({ 'composer.footer': 'desk-footer', sidebar: 'left-bottom', panel: 'right' });
    const v = modPanelsOf(status);
    expect(v.map((x) => `${x.name}:${x.viewId}@${x.region}`)).toEqual(['ledger:ledger.sheet@left-bottom', 'ledger:ledger.strip@desk-footer', 'hello:hello.panel@right']);
    expect(panelsIn(v, 'desk-footer').map((x) => x.viewId)).toEqual(['ledger.strip']);
    for (const kernelOwned of ['inbox.card', 'card.detail:permission', 'status.mod', 'voice.pill', '__proto__', 'constructor']) expect(modPanelsOf({ mods: { views: [{ name: 'm', viewId: 'm.v', slot: kernelOwned }] } })).toEqual([]);
    expect(modPanelsOf(null)).toEqual([]);
    expect(modPanelsOf({ mods: { running: { n: 1 } } })).toEqual([]); // the non-human status has counts only
  });

  it('the mod.view params carry only the focused hsid as {focus:{hsid}} (K3)', () => {
    const [sheet] = modPanelsOf(status);
    // K3: {focus:{hsid}} only; the HOST joins it to the live session's repo, the GUI never names a repo or path
    expect(modViewParams(sheet!, 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA')).toEqual({ name: 'ledger', viewId: 'ledger.sheet', input: { focus: { hsid: 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA' } } });
    expect(modViewParams(sheet!, null)).toEqual({ name: 'ledger', viewId: 'ledger.sheet', input: {} });
  });

  it('the GUI feed kinds equal the kernel FEED_KINDS (packages/gnomon/src/kernel/modhost/feed.ts)', () => {
    const src = readFileSync(path.resolve(ROOT, '..', 'gnomon', 'src', 'kernel', 'modhost', 'feed.ts'), 'utf8');
    const body = /export const FEED_KINDS[^=]*= Object\.freeze\(\[([\s\S]*?)\]\);/.exec(src)![1]!;
    expect([...body.matchAll(/'([a-z.]+)'/g)].map((m) => m[1])).toEqual([...MOD_FEED_KINDS]);
  });
});

describe('#gui mod panels: the fence', () => {
  it('is labelled mod:<name> with a dev badge for tier local, and renders the block through the kit renderer as text', () => {
    const [, strip, panel] = modPanelsOf(status);
    const block = { schemaVersion: 'display-block:v1', type: 'Box', direction: 'row', children: [{ type: 'Text', text: '●', tone: 'hue-2' }, { type: 'Text', text: '182k in · 9k out', tone: 'warn' }, { type: 'Progress', value: 75, max: 100, label: 'tokens 75 of 100%' }] };
    const el = renderModFence({ doc: fdoc }, strip!, { block, dev: false }) as FEl;
    expect(fenceLabel('ledger')).toBe('mod:ledger');
    expect(el.tag).toBe('section');
    expect(el.className).toContain('mod-fence');
    expect(el.attrs.get('data-mod')).toBe('ledger');
    expect(el.all().find((e) => e.className === 'mod-label')!.text).toBe('mod:ledger');
    expect(el.all().some((e) => e.className.includes('mod-dev'))).toBe(false);
    expect(el.text).toContain('182k in · 9k out');
    expect(el.all().map((e) => e.className)).toEqual(expect.arrayContaining(['blk blk-box blk-row', 'blk blk-text tone-hue-2', 'blk blk-text tone-warn']));
    expect(el.all().some((e) => e.tag === 'progress')).toBe(true);
    const dev = renderModFence({ doc: fdoc }, panel!, { block: { type: 'Text', text: 'hi' } }) as FEl;
    expect(dev.all().find((e) => e.className.includes('mod-dev'))!.text).toBe('dev');
    // the kernel's dev flag on the result also badges it
    expect((renderModFence({ doc: fdoc }, strip!, { block, dev: true }) as FEl).all().some((e) => e.className.includes('mod-dev'))).toBe(true);
    // a refusal shows in the fence, verbatim, never as a mod block
    expect((renderModFence({ doc: fdoc }, strip!, null, 'PAUSED') as FEl).text).toContain('ledger.strip unavailable: PAUSED');
  });

  it('Aegis M2: a block holding a kit.Button anywhere is refused in the panel slot (beside the decision keys), allowed elsewhere', () => {
    const [sheet, strip, panel] = modPanelsOf(status);
    const nested = { schemaVersion: 'display-block:v1', type: 'Box', children: [{ type: 'Text', text: 'ok' }, { type: 'List', items: [{ type: 'Button', label: 'Allow', command: 'theme.night' }] }] };
    expect(holdsButton(nested)).toBe(true);
    expect(holdsButton({ type: 'Box', children: [{ type: 'Text', text: 'Button' }] })).toBe(false);
    const el = renderModFence({ doc: fdoc }, panel!, { block: nested }) as FEl;
    expect(el.text).toContain(PANEL_BUTTON_REFUSAL);
    expect(el.all().some((e) => e.tag === 'button' || e.className.includes('blk-button'))).toBe(false);
    for (const v of [sheet!, strip!]) expect((renderModFence({ doc: fdoc }, v, { block: nested }) as FEl).text).not.toContain(PANEL_BUTTON_REFUSAL);
    expect(PANEL_HEADING).toBe('mods');
  });

  it('Aegis M2: the panel region is ruled and headed outside the stack scroll; hue chips have a non-key border', () => {
    const css = readFileSync(path.join(ROOT, 'static', 'styles.css'), 'utf8');
    expect(css).toMatch(/\.mod-slot-right \{[^}]*border-top: 2px solid var\(--rule\)/);
    const chip = /\.blk-text\[class\*="tone-hue-"\] \{([^}]*)\}/.exec(css)![1]!;
    expect(chip).not.toContain('--key-edge');
    const mount = readFileSync(path.join(ROOT, 'src', 'ui', 'mod-panels-mount.ts'), 'utf8');
    expect(mount).toContain("right: { id: 'mod-slot-panel', parent: 'pane-stack' }"); // a sibling of #stack, never inside it
    expect(mount).toContain('PANEL_HEADING');
  });

  it('a tone that is not a token is dropped (no class injection)', () => {
    const el = renderBlock({ doc: fdoc }, { type: 'Text', text: 'x', tone: 'warn" onclick="x' }) as FEl;
    expect(el.className).toBe('blk blk-text');
  });
});

describe('#gui mod panels: the scheduler', () => {
  it('never renders without a feed-kind row, and never on a timer', async () => {
    const t = new FakeTimers();
    let n = 0;
    const s = new ModPanelScheduler(async () => void n++, t);
    for (const k of ['turn.event', 'turn.text', 'session.spawned', 'approval.unlock', undefined, 7]) expect(s.row(k)).toBe(false);
    t.advance(10_000);
    await flush();
    expect(n).toBe(0);
    expect(t.pending.size).toBe(0);
    expect(isFeedRow('budget.usage')).toBe(true);
  });

  it('K3: a focus change renders now (no debounce); the same focus, or the mount focus, does not', async () => {
    const t = new FakeTimers();
    let n = 0;
    const s = new ModPanelScheduler(async () => void n++, t);
    expect(s.focus('hsid:v1:A')).toBe(false); // the mount render uses it
    expect(s.focus('hsid:v1:A')).toBe(false);
    expect(s.focus('hsid:v1:B')).toBe(true);
    await flush();
    expect(n).toBe(1);
    expect(s.focus(null)).toBe(true);
    await flush();
    expect(n).toBe(2);
    const app = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
    expect(app).toMatch(/function focus\(hsid: string \| null\): void \{[\s\S]*?modPanelsFocus\(hsid\);[\s\S]*?\n\}/);
  });

  it('debounces 250 ms: a burst of feed rows is one render', async () => {
    const t = new FakeTimers();
    let n = 0;
    const s = new ModPanelScheduler(async () => void n++, t);
    for (let i = 0; i < 20; i++) {
      s.row('turn.usage');
      t.advance(100);
    }
    expect(n).toBe(0);
    t.advance(MOD_PANEL_DEBOUNCE_MS);
    await flush();
    expect(n).toBe(1);
    expect(t.pending.size).toBe(0);
  });

  it('one render in flight: rows during a render queue exactly one more', async () => {
    const t = new FakeTimers();
    let n = 0;
    let open = 0;
    let maxOpen = 0;
    const gates: Array<() => void> = [];
    const s = new ModPanelScheduler(async () => {
      n++;
      open++;
      maxOpen = Math.max(maxOpen, open);
      await new Promise<void>((r) => gates.push(r));
      open--;
    }, t);
    s.now();
    await flush();
    expect(n).toBe(1);
    s.row('turn.result');
    t.advance(MOD_PANEL_DEBOUNCE_MS);
    s.row('session.compacted');
    t.advance(MOD_PANEL_DEBOUNCE_MS);
    await flush();
    expect(n).toBe(1); // still the first, in flight
    gates.shift()!();
    await flush();
    t.advance(MOD_PANEL_DEBOUNCE_MS);
    await flush();
    expect(n).toBe(2);
    gates.shift()!();
    await flush();
    t.advance(10_000);
    await flush();
    expect(n).toBe(2);
    expect(maxOpen).toBe(1);
  });
});
