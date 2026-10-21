/**
 * #gui S5 the Workshop (critique 2026-10-20 §2 S5): structured caps drawn from checked fields only
 * (core/render.ts renderCap, contracts checkCap), the Workshop's own Layout-placed region
 * (core/mod-panels.ts, ui/mod-panels-mount.ts, core/commands.ts), the reduced-motion word. Fake DOM.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyPreset, BLOCK_SAFE_COMMANDS, parseLayout, placeWorkshop, serializeLayout, togglePane, WORKSHOP_PLACES } from '../src/core/commands.js';
import { modPanelsOf, PANEL_BUTTON_REFUSAL, renderModFence, workshopInstallKey, WORKSHOP_VIEW, workshopAbsence } from '../src/core/mod-panels.js';
import { CAP_PATHS, renderBlock, TONES, type MiniDoc, type MiniEl } from '../src/core/render.js';

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
class FNsEl extends FEl {
  constructor(
    readonly ns: string,
    tag: string,
  ) {
    super(tag);
  }
}
const fdoc: MiniDoc = { createElement: (t) => new FEl(t), createTextNode: (s) => new FText(s) };
const nsdoc: MiniDoc = { ...fdoc, createElementNS: (ns, t) => new FNsEl(ns, t) };
const CAP = { shape: 'floppy', hue: 4, filled: true, state: 'needs', label: '! gate-class' } as const;
const capNode = (cap: unknown, extra: Record<string, unknown> = {}) => ({ type: 'Text', text: '▲ gate-class', tone: 'cap', cap, ...extra });
const css = readFileSync(path.join(ROOT, 'static', 'styles.css'), 'utf8');

describe('S5 Workshop caps (core/render.ts renderCap)', () => {
  it('a valid cap draws one svg > path whose d is a GUI constant; classes come from the fields', () => {
    const el = renderBlock({ doc: nsdoc }, capNode(CAP)) as FEl;
    expect(el.tag).toBe('span');
    expect(el.className).toBe('cap h4 cap-floppy st-needs');
    expect(el.attrs.get('role')).toBe('img');
    expect(el.attrs.get('aria-label')).toBe('▲ gate-class');
    const svgs = el.all().filter((e): e is FNsEl => e instanceof FNsEl);
    expect(svgs.map((e) => [e.ns, e.tag])).toEqual([
      ['http://www.w3.org/2000/svg', 'svg'],
      ['http://www.w3.org/2000/svg', 'path'],
    ]);
    expect(svgs[0]!.attrs.get('viewBox')).toBe('0 0 22 28');
    expect(svgs[1]!.attrs.get('d')).toBe(CAP_PATHS.floppy);
    expect([...svgs[1]!.attrs.keys()]).toEqual(['d']);
    expect(el.all().find((e) => e.className === 'q')!.text).toBe('! gate-class');
    for (const [shape, d] of Object.entries(CAP_PATHS)) {
      const p = (renderBlock({ doc: nsdoc }, capNode({ ...CAP, shape })) as FEl).all().find((e) => e.tag === 'path')!;
      expect(p.attrs.get('d')).toBe(d);
    }
  });
  it('outlined, knot and working map to classes; only working bobs and carries the reduced-motion word', () => {
    const c = (o: Record<string, unknown>) => renderBlock({ doc: nsdoc }, capNode({ ...CAP, ...o })) as FEl;
    expect(c({ filled: false }).className).toContain(' outlined');
    expect(c({ state: 'knot' }).className).toBe('cap h4 cap-floppy st-knot knot');
    const w = c({ state: 'working', label: 'builder' });
    expect(w.className).toBe('cap h4 cap-floppy st-working bob');
    expect(w.all().find((e) => e.className === 'cap-word')!.text).toBe('working');
    expect(w.all().some((e) => e.className === 'q')).toBe(false);
    for (const st of ['idle', 'needs', 'knot']) {
      const x = c({ state: st });
      expect(x.className).not.toContain('bob');
      expect(x.all().some((e) => e.className === 'cap-word')).toBe(false);
    }
  });
  it('an invalid cap (unknown or out-of-range field, mod path data) draws no svg: the plain text form shows', () => {
    for (const bad of [{ ...CAP, d: 'M0 0 L99 99' }, { ...CAP, hue: 6 }, { ...CAP, hue: -1 }, { ...CAP, shape: 'star' }, { ...CAP, state: 'bob' }, { ...CAP, label: 'x'.repeat(41) }, { ...CAP, style: 'fill:red' }, 'tall', null]) {
      const el = renderBlock({ doc: nsdoc }, capNode(bad)) as FEl;
      expect(el.tag, JSON.stringify(bad)).toBe('p');
      expect(el.all().some((e) => e instanceof FNsEl)).toBe(false);
      expect(el.text).toBe('▲ gate-class');
    }
  });
  it('the label and accessible text are sanitized text; nothing in them reaches an attribute name or the path', () => {
    const el = renderBlock({ doc: nsdoc }, capNode({ ...CAP, label: '<svg onload=x>' }, { text: '"><path d="M0' })) as FEl;
    expect(el.all().find((e) => e.className === 'q')!.text).toBe('<svg onload=x>');
    expect(el.all().filter((e) => e.tag === 'path').map((e) => e.attrs.get('d'))).toEqual([CAP_PATHS.floppy]);
    for (const e of el.all()) for (const k of e.attrs.keys()) expect(k).toMatch(/^(role|aria-label|aria-hidden|title|data-cap-state|viewBox|d|focusable)$/);
  });
  it('without createElementNS (a fake doc) the cap still renders, with a text glyph instead of the svg', () => {
    const el = renderBlock({ doc: fdoc }, capNode(CAP)) as FEl;
    expect(el.className).toContain('cap');
    expect(el.all().some((e) => e.className === 'cap-glyph')).toBe(true);
  });
  it('tones are the closed set; an unknown tone adds no class', () => {
    expect((renderBlock({ doc: fdoc }, { type: 'Text', text: 'x', tone: 'quiet' }) as FEl).className).toBe('blk blk-text tone-quiet');
    expect((renderBlock({ doc: fdoc }, { type: 'Text', text: 'x', tone: 'violet' }) as FEl).className).toBe('blk blk-text'); // Aegis L2: violet is the knot cap's only
    expect((renderBlock({ doc: fdoc }, { type: 'Text', text: 'x', tone: 'hue-7' }) as FEl).className).toBe('blk blk-text');
    expect((renderBlock({ doc: fdoc }, { type: 'Text', text: 'x', tone: 'evil' }) as FEl).className).toBe('blk blk-text');
    expect([...TONES].sort()).toEqual(['cap', 'deny', 'hue-0', 'hue-1', 'hue-2', 'hue-3', 'hue-4', 'hue-5', 'paused', 'quiet', 'warn']);
  });
  it('the CSS colours caps by class only, bobs only .bob, and prints `working` under reduced motion', () => {
    expect(css).toMatch(/\.cap\.bob svg \{ transform-origin: 50% 100%; animation: bob var\(--t-bob\) infinite; \}/);
    expect(css).toMatch(/@keyframes bob \{ 50% \{ transform: translateY\(-4px\) rotate\(-3deg\); \} \}/);
    expect(css).toMatch(/\[data-motion="reduced"\] \.cap\.bob \.cap-word \{ display: block; \}/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.cap\.bob \.cap-word \{ display: block; \}/);
    expect(css).toMatch(/\.cap\.knot path \{ fill: var\(--knot\); stroke: var\(--knot-edge\); \}/);
    expect(css).toMatch(/\.cap path \{ stroke: var\(--key-edge\);/);
    for (let i = 0; i < 6; i++) expect(css).toMatch(new RegExp(`\\.cap\\.h${i} path \\{ fill: var\\(--p-[a-z-]+-fill\\); \\}`));
    expect(css).not.toMatch(/tone-hue-[67]/);
    expect(css).not.toMatch(/\.tone-violet/);
  });
});

describe('S5 Workshop region and placement', () => {
  const W = { name: 'gnomon.workshop', viewId: 'workshop.strip', slot: 'sidebar', dev: false };
  it('the Workshop sidebar view mounts in its own region; another sidebar view stays left-bottom', () => {
    const v = modPanelsOf({ mods: { views: [W, { name: 'gnomon.ledger', viewId: 'ledger.sheet', slot: 'sidebar' }, { name: 'gnomon.workshop', viewId: 'workshop.other', slot: 'sidebar' }] } });
    expect(v.map((x) => `${x.name}/${x.viewId}:${x.region}`)).toEqual(['gnomon.workshop/workshop.strip:workshop', 'gnomon.ledger/ledger.sheet:left-bottom', 'gnomon.workshop/workshop.other:left-bottom']);
    expect(WORKSHOP_VIEW).toEqual({ name: 'gnomon.workshop', viewId: 'workshop.strip', slot: 'sidebar' });
  });
  it('one quiet line when the Workshop is not running: not installed, or paused and why', () => {
    expect(workshopAbsence({ mods: { views: [W] } }, modPanelsOf({ mods: { views: [W] } }))).toBeNull();
    expect(workshopAbsence({}, [])).toBe('workshop not installed · gnomon mod install packages/gnomon-mods/workshop');
    expect(workshopAbsence({ mods: { views: [], paused: [{ name: 'gnomon.workshop', why: 'user' }] } }, [])).toBe('workshop paused (user) · gnomon mod start gnomon.workshop');
    expect(workshopAbsence({ mods: { views: [], paused: [{ name: 'gnomon.workshop', why: '<b>x' }] } }, [])).toBe('workshop paused · gnomon mod start gnomon.workshop');
    // #gui-mods-panel (founder dogfood 2026-10-21): the key is never a dead, disabled one; it installs from the
    // kernel's shipped source, or (no source) opens the Mods panel, which says why (test/mods.test.ts)
    expect(workshopInstallKey('/x/gnomon-mods/workshop')).toMatchObject({ label: 'Install Workshop', action: 'install' });
    expect(workshopInstallKey(null)).toMatchObject({ label: 'Install Workshop', action: 'open-mods' });
  });
  it('the fence keeps its mod:workshop label and shows the zone titles; card bodies never show a Box title', () => {
    const v = modPanelsOf({ mods: { views: [W] } })[0]!;
    const el = renderModFence({ doc: nsdoc }, v, { block: { type: 'Box', title: 'Workshop', children: [{ type: 'Box', title: 'needs you 1', children: [capNode(CAP)] }] } }) as FEl;
    expect(el.className).toBe('mod-fence mod-region-workshop');
    expect(el.all().find((e) => e.className === 'mod-label')!.text).toBe('mod:workshop');
    expect(el.all().filter((e) => e.className === 'blk-title').map((e) => e.text)).toEqual(['Workshop', 'needs you 1']);
    expect((renderBlock({ doc: fdoc }, { type: 'Box', title: 'T', children: [] }) as FEl).all().some((e) => e.className === 'blk-title')).toBe(false);
  });
  it('Aegis S5 M1: a kit.Button in the Workshop is refused in every placement (the region, not the placement, decides)', () => {
    const v = modPanelsOf({ mods: { views: [W] } })[0]!;
    const block = { type: 'Box', children: [{ type: 'Button', label: 'hide', command: 'layout.focus' }] };
    for (const place of [...WORKSHOP_PLACES, 'hidden']) {
      const el = renderModFence({ doc: nsdoc }, v, { block }) as FEl;
      expect(el.text, place).toContain(PANEL_BUTTON_REFUSAL);
      expect(el.all().some((e) => e.tag === 'button'), place).toBe(false);
    }
    const other = renderModFence({ doc: nsdoc }, { name: 'gnomon.ledger', viewId: 'ledger.sheet', slot: 'sidebar', region: 'left-bottom', dev: false }, { block }) as FEl;
    expect(other.text).not.toContain(PANEL_BUTTON_REFUSAL);
    const src = readFileSync(path.join(ROOT, 'src', 'core', 'mod-panels.ts'), 'utf8');
    expect(src).toMatch(/\(v\.region === 'right' \|\| v\.region === 'workshop'\) && holdsButton/);
  });
  it('Aegis S5 L4: a block button can name no pane.* or workshop.* command', () => {
    for (const id of BLOCK_SAFE_COMMANDS) expect(id).not.toMatch(/^(pane|workshop|mode|voice)\./);
    for (const id of ['pane.workshop.toggle', 'pane.sessions.toggle', 'workshop.footer', 'workshop.right', 'workshop.left']) expect(BLOCK_SAFE_COMMANDS.has(id), id).toBe(false);
  });
  it('the Layout places it (footer default, left, right; hidden) and the placement round-trips', () => {
    const l = applyPreset('desk');
    expect(l.workshop).toBe('footer');
    expect(l.visible.workshop).toBe(true);
    for (const p of WORKSHOP_PLACES) expect(parseLayout(serializeLayout(placeWorkshop(l, p)))!.workshop).toBe(p);
    expect(applyPreset('focus', 'right')).toMatchObject({ workshop: 'right', visible: { workshop: false } });
    expect(parseLayout(serializeLayout(togglePane(l, 'workshop')))!.visible.workshop).toBe(false);
    expect(parseLayout(JSON.stringify({ name: 'desk', visible: { sessions: true, stack: true, shuttle: true }, stackWide: false }))).toMatchObject({ workshop: 'footer', visible: { workshop: true } });
    expect(parseLayout(JSON.stringify({ name: 'desk', visible: {}, stackWide: false, workshop: 'top' }))!.workshop).toBe('footer');
  });
  it('wiring: #pane-workshop hosts #workshop-host and the status line; app places the host per Layout', () => {
    const html = readFileSync(path.join(ROOT, 'static', 'index.html'), 'utf8');
    const app = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
    expect(html).toContain('<footer id="pane-workshop" class="workshop" aria-label="Workshop"><div id="workshop-host" class="workshop-host"></div><button id="status-line"');
    expect(html).toContain('<aside id="workshop-col" class="workshop-col"');
    expect(html).not.toContain('pane-shuttle');
    expect(app).toMatch(/const place: WorkshopPlace = narrowQ\.matches \? 'footer' : layout\.workshop;/);
    expect(app).toMatch(/\$\('status-line'\)\.addEventListener\('click', \(e\) => run\('view\.kernel-feed', e\.isTrusted\)\)/);
    const mount = readFileSync(path.join(ROOT, 'src', 'ui', 'mod-panels-mount.ts'), 'utf8');
    expect(mount).toContain("workshop: { id: 'mod-slot-workshop', parent: 'workshop-host' }");
  });
});
