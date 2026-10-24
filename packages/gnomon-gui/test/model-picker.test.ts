/**
 * #gui-model-picker: the pure core (core/model-picker.ts) and the page wiring read from the source (ui/model-picker.ts
 * is browser glue; app.ts mounts it with a minimal diff).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { settingsModel } from '../src/core/settings.js';
import { sessionModelLine } from '../src/core/store.js';
import { mountModelPicker } from '../src/ui/model-picker.js';
import { CUSTOM, MODEL_BY_FOLDER_KEY, MODEL_CHOICES, MODEL_LAST_KEY, MODEL_REQUEST, modelChipText, modelLabel, openModelOf, sessionModelText, pickerProblem, rememberChoice, rememberedChoice, sessionModelOf, switchChoices, switchConfirmText, switchRequest } from '../src/core/model-picker.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f: string): string => readFileSync(path.join(ROOT, f), 'utf8');
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe('model picker: what session.open sends', () => {
  it('offers default first, the claude aliases, then custom', () => {
    expect(MODEL_CHOICES[0]).toBe('default');
    for (const a of ['opus', 'sonnet', 'haiku', 'fable']) expect(MODEL_CHOICES).toContain(a);
    expect(MODEL_CHOICES.at(-1)).toBe(CUSTOM);
  });
  it.each([
    ['claude', 'opus', '', 'opus'],
    ['claude', 'sonnet', '', 'sonnet'],
    ['claude', 'default', '', 'claude'],
    ['claude', CUSTOM, '  claude-opus-5-5 ', 'claude-opus-5-5'],
    ['any', 'opus', '', 'any'],
    ['local', 'opus', '', 'local'],
  ])('route %s, choice %s ⇒ model %s', (route, choice, custom, want) => {
    expect(openModelOf(route, choice, custom)).toBe(want);
  });
  it.each(['--dangerously-skip-permissions', '-p', 'opus --bare', 'gpt-5', ''])('a custom id %j is refused in the sheet (never sent)', (v) => {
    expect(pickerProblem(CUSTOM, v)).not.toBeNull();
  });
  it('a listed alias passes; an unlisted choice does not', () => {
    expect(pickerProblem('haiku', '')).toBeNull();
    expect(pickerProblem('gpt', '')).not.toBeNull();
  });
});

describe('model picker: memory per folder', () => {
  it('remembers per folder, then the last overall for a new folder', () => {
    const st = mem();
    rememberChoice(st, '/a', 'opus');
    rememberChoice(st, '/b', 'claude-sonnet-4-5');
    expect(rememberedChoice(st, '/a')).toEqual({ choice: 'opus', custom: '' });
    expect(rememberedChoice(st, '/b')).toEqual({ choice: CUSTOM, custom: 'claude-sonnet-4-5' });
    expect(rememberedChoice(st, '/new')).toEqual({ choice: CUSTOM, custom: 'claude-sonnet-4-5' });
    rememberChoice(st, '/a', 'claude'); // the default
    expect(rememberedChoice(st, '/a')).toEqual({ choice: 'default', custom: '' });
  });
  it('a tampered stored value is never restored', () => {
    const st = mem();
    st.setItem(MODEL_BY_FOLDER_KEY, JSON.stringify({ '/a': '--bare' }));
    st.setItem(MODEL_LAST_KEY, '-p');
    expect(rememberedChoice(st, '/a')).toEqual({ choice: 'default', custom: '' });
    st.setItem(MODEL_BY_FOLDER_KEY, 'not json');
    expect(rememberedChoice(st, '/a').choice).toBe('default');
  });
  it('keeps at most 64 folders (oldest dropped)', () => {
    const st = mem();
    for (let i = 0; i < 70; i++) rememberChoice(st, `/f${i}`, 'haiku');
    const m = JSON.parse(st.getItem(MODEL_BY_FOLDER_KEY)!) as Record<string, string>;
    expect(Object.keys(m)).toHaveLength(64);
    expect(m['/f0']).toBeUndefined();
    expect(m['/f69']).toBe('haiku');
  });
});

describe('model picker: the session model and the switch', () => {
  it('reads the model from the kernel rows: session.open, then a switched session.model', () => {
    const rows = [
      { kind: 'session.open', payload: { backend: 'claude-code', model: 'claude' } },
      { kind: MODEL_REQUEST, payload: { hsid: 'h', model: 'opus' } },
    ];
    expect(sessionModelOf(rows)).toEqual({ model: 'claude', backend: 'claude-code', pending: 'opus', uncertain: null });
    rows.push({ kind: 'session.model', payload: { outcome: 'switched', from: 'claude', to: 'opus' } } as never);
    expect(sessionModelOf(rows)).toEqual({ model: 'opus', backend: 'claude-code', pending: null, uncertain: null });
    rows.push({ kind: 'session.model', payload: { outcome: 'refused', from: 'opus', to: 'haiku' } } as never);
    expect(sessionModelOf(rows)!.model).toBe('opus');
    expect(sessionModelOf([])).toBeNull();
  });
  it('a timeout is UNCONFIRMED until the kernel reconciles it from the next reply (switching… (unconfirmed))', () => {
    const rows: Array<{ kind: string; payload: unknown }> = [
      { kind: 'session.open', payload: { backend: 'claude-code', model: 'haiku' } },
      { kind: MODEL_REQUEST, payload: { hsid: 'h', model: 'sonnet' } },
      { kind: 'session.model', payload: { outcome: 'timeout', from: 'haiku', to: 'sonnet' } },
    ];
    const m = sessionModelOf(rows)!;
    expect(m).toEqual({ model: 'haiku', backend: 'claude-code', pending: null, uncertain: 'sonnet' });
    expect(modelChipText(m)).toBe('model: switching… (unconfirmed)');
    expect(sessionModelText(m)).toMatch(/unconfirmed/);
    rows.push({ kind: 'session.model', payload: { outcome: 'reconciled', from: 'haiku', to: 'sonnet' } });
    expect(sessionModelOf(rows)).toEqual({ model: 'sonnet', backend: 'claude-code', pending: null, uncertain: null });
    expect(modelChipText(sessionModelOf(rows))).toBe('sonnet');
    rows.push({ kind: MODEL_REQUEST, payload: { hsid: 'h', model: 'opus' } }, { kind: 'session.model', payload: { outcome: 'timeout', from: 'sonnet', to: 'opus' } }, { kind: 'session.model', payload: { outcome: 'reconciled', from: 'sonnet', to: 'sonnet' } });
    expect(sessionModelOf(rows)).toMatchObject({ model: 'sonnet', uncertain: null });
    expect(sessionModelText(null)).toBe('no session focused');
  });
  it('after the session ended a timeout is never shown unconfirmed (Aegis L2), whichever row came first; a resume starts afresh', () => {
    const base = [
      { kind: 'session.open', payload: { backend: 'claude-code', model: 'haiku' } },
      { kind: MODEL_REQUEST, payload: { hsid: 'h', model: 'sonnet' } },
    ];
    const timeout = { kind: 'session.model', payload: { outcome: 'timeout', from: 'haiku', to: 'sonnet' } };
    const exited = { kind: 'session.exited', payload: { reason: 'session.stop' } };
    for (const rows of [[...base, timeout, exited], [...base, exited, timeout]]) {
      const m = sessionModelOf(rows)!;
      expect(m).toEqual({ model: 'haiku', backend: 'claude-code', pending: null, uncertain: null });
      expect(modelChipText(m)).toBe('haiku');
      expect(sessionModelText(m)).not.toMatch(/unconfirmed/);
    }
    const resumed = [...base, exited, { kind: 'session.open', payload: { backend: 'claude-code', model: 'haiku' } }, { kind: MODEL_REQUEST, payload: { hsid: 'h', model: 'opus' } }, { kind: 'session.model', payload: { outcome: 'timeout', from: 'haiku', to: 'opus' } }];
    expect(sessionModelOf(resumed)).toMatchObject({ uncertain: 'opus' });
  });
  it('the transcript says what each outcome did', () => {
    expect(sessionModelLine({ outcome: 'switched', from: 'claude', to: 'opus' })).toMatch(/default → opus · the conversation continues; the prompt cache restarts/);
    expect(sessionModelLine({ outcome: 'timeout', from: 'haiku', to: 'opus' })).toMatch(/switching… \(unconfirmed\)/);
    expect(sessionModelLine({ outcome: 'reconciled', from: 'haiku', to: 'haiku' })).toMatch(/did not take/);
    expect(sessionModelLine({ outcome: 'backend-refused', from: 'haiku', to: 'x' })).toMatch(/stays haiku/);
  });
  it('the request is log.append{request.session.model, {hsid, model}}', () => {
    expect(switchRequest('h', 'sonnet')).toEqual({ kind: 'request.session.model', payload: { hsid: 'h', model: 'sonnet' } });
  });
  it('the confirm text is truthful: the conversation continues, the cache restarts, nothing says context is lost', () => {
    const t = switchConfirmText('opus', 'sonnet').join(' ');
    expect(t).toMatch(/conversation continues/);
    expect(t).toMatch(/prompt cache restarts/);
    expect(t).not.toMatch(/lost|lose/i);
    expect(modelLabel('claude')).toBe('default');
  });
  it('the menu offers every choice but the current one', () => {
    expect(switchChoices('opus')).not.toContain('opus');
    expect(switchChoices('claude')).not.toContain('default');
  });
});

describe('model picker: Settings session-model slot', () => {
  it('a read-only Session model row carries the slot the picker repaints', () => {
    const rows = settingsModel({ theme: 'auto', motion: 'system', prefersDark: false, prefersReduced: false, layout: { name: 'desk', visible: { sessions: true, stack: true, workshop: true }, workshop: 'footer' } as never, status: null, mode: null, dictationDelayMs: null, sessionModel: 'sonnet · claude-code', connection: null, gui: { name: 'g', version: '1' }, unlock: { state: 'none', at: null, reason: null } }).flatMap((x) => x.rows);
    expect(rows.find((r) => r.id === 'session-model')).toMatchObject({ kind: 'readonly', value: 'sonnet · claude-code', slot: 'session-model' });
  });
});

describe('model picker: page wiring (source)', () => {
  const ui = src('src/ui/model-picker.ts');
  const app = src('src/ui/app.ts');
  it('app.ts mounts the module and sends the picker model on open', () => {
    expect(app).toMatch(/mountModelPicker\(document/);
    expect(app).toMatch(/modelPicker\.openModel\(\$<HTMLSelectElement>\('ns-model'\)\.value\)/);
    expect(app).toMatch(/await openSession\(cwd, model\)/); // #gui-folder-field: the sheet waits for the answer
    expect(app).toMatch(/modelPicker\?\.headChip\(meta, s\.hsid\)/);
  });
  it('the switch is sent only after a trusted click on the go key or a trusted Enter in the field (Aegis L1), never on the submit event\'s own isTrusted', () => {
    const i = ui.indexOf("card.addEventListener('submit'");
    expect(i).toBeGreaterThan(0);
    const submit = ui.slice(i, i + 300);
    expect(submit).toMatch(/const human = armed;\s*armed = false;[\s\S]*if \(!human \|\| !target\) return;/);
    expect(submit).not.toMatch(/e\.isTrusted/);
    // armed only by the go key's click or the id field's Enter, each from its own trusted event
    expect(ui).toMatch(/go\.addEventListener\('click', \(e\) => \{\s*armed = e\.isTrusted;/);
    expect(ui).toMatch(/customSwitch\.addEventListener\('keydown', \(e\) => \{\s*if \(e\.key === 'Enter'\) armed = e\.isTrusted;/);
    expect(ui.match(/armed = true/g)).toBeNull();
    // the sheet's open and close disarm it
    expect(ui).toMatch(/const closeSheet = \(\): void => \{[\s\S]{0,80}armed = false;/);
    expect(ui.match(/switchRequest\(/g)).toHaveLength(1);
  });
});

/* ── the header chip in a minimal DOM (no jsdom in the repo): the menu opens where nothing clips it and survives the
   header repaints a streaming session makes (founder: "default button when pressed does nothing") ── */
type Listener = (e: { target: FakeEl; key?: string }) => void;
class FakeEl {
  attrs = new Map<string, string>();
  children: FakeEl[] = [];
  parentNode: FakeEl | null = null;
  listeners = new Map<string, Listener[]>();
  hidden = false;
  disabled = false;
  value = '';
  title = '';
  style: Record<string, string> = {};
  offsetWidth = 240;
  rect = { left: 0, top: 0, width: 0, height: 0 };
  #text = '';
  constructor(
    readonly tagName: string,
    readonly doc: FakeDoc,
  ) {}
  get textContent(): string {
    return this.#text + this.children.map((c) => c.textContent).join('');
  }
  set textContent(s: string) {
    for (const c of this.children) c.parentNode = null;
    this.children = [];
    this.#text = s;
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
  hasAttribute(k: string): boolean {
    return this.attrs.has(k);
  }
  classes(): string[] {
    return (this.attrs.get('class') ?? '').split(/\s+/).filter(Boolean);
  }
  matches(sel: string): boolean {
    return sel.split(',').some((one) => {
      const s = one.trim();
      if (s.startsWith('#')) return this.attrs.get('id') === s.slice(1);
      return s.split('.').filter(Boolean).every((c) => this.classes().includes(c));
    });
  }
  closest(sel: string): FakeEl | null {
    for (let e: FakeEl | null = this; e; e = e.parentNode) if (e.matches(sel)) return e;
    return null;
  }
  appendChild(c: FakeEl): FakeEl {
    c.remove();
    c.parentNode = this;
    this.children.push(c);
    return c;
  }
  append(...cs: FakeEl[]): void {
    for (const c of cs) this.appendChild(c);
  }
  prepend(...cs: FakeEl[]): void {
    for (const c of cs) c.remove();
    for (const c of cs) c.parentNode = this;
    this.children.unshift(...cs);
  }
  removeChild(c: FakeEl): FakeEl {
    this.children = this.children.filter((x) => x !== c);
    c.parentNode = null;
    if (this.doc.activeElement && c.contains(this.doc.activeElement)) this.doc.activeElement = null;
    return c;
  }
  remove(): void {
    this.parentNode?.removeChild(this);
  }
  contains(e: FakeEl): boolean {
    for (let x: FakeEl | null = e; x; x = x.parentNode) if (x === this) return true;
    return false;
  }
  replaceChildren(...cs: FakeEl[]): void {
    this.textContent = '';
    this.append(...cs);
  }
  after(...cs: FakeEl[]): void {
    const p = this.parentNode;
    if (!p) return;
    for (const c of cs) c.remove();
    for (const c of cs) c.parentNode = p;
    p.children.splice(p.children.indexOf(this) + 1, 0, ...cs);
  }
  focus(): void {
    this.doc.activeElement = this;
  }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return this.rect;
  }
  addEventListener(t: string, f: Listener): void {
    this.listeners.set(t, [...(this.listeners.get(t) ?? []), f]);
  }
  /** a click bubbles to the document */
  click(): void {
    for (let e: FakeEl | null = this; e; e = e.parentNode) for (const f of e.listeners.get('click') ?? []) f({ target: this });
    for (const f of this.doc.listeners.get('click') ?? []) f({ target: this });
  }
  querySelectorAll(sel: string): FakeEl[] {
    return this.children.flatMap((c) => [...(c.matches(sel) ? [c] : []), ...c.querySelectorAll(sel)]);
  }
}
class FakeDoc {
  listeners = new Map<string, Listener[]>();
  activeElement: FakeEl | null = null;
  body = new FakeEl('body', this);
  createElement(t: string): FakeEl {
    return new FakeEl(t, this);
  }
  createTextNode(s: string): FakeEl {
    const n = new FakeEl('#text', this);
    n.textContent = s;
    return n;
  }
  getElementById(id: string): FakeEl | null {
    return this.body.querySelectorAll(`#${id}`)[0] ?? null;
  }
  querySelectorAll(sel: string): FakeEl[] {
    return this.body.querySelectorAll(sel);
  }
  addEventListener(t: string, f: Listener): void {
    this.listeners.set(t, [...(this.listeners.get(t) ?? []), f]);
  }
}

describe('model picker: the header model key (DOM)', () => {
  const H = 'hsid:v1:A';
  const setup = () => {
    const doc = new FakeDoc();
    const el = (tag: string, cls: string, id?: string): FakeEl => {
      const e = doc.createElement(tag);
      e.setAttribute('class', cls);
      if (id) e.setAttribute('id', id);
      return e;
    };
    // the chat header as index.html draws it: .pane-head.chead > .chead-l (clips: overflow hidden) > #chead-meta
    const head = el('div', 'pane-head chead');
    const left = el('span', 'chead-l');
    const meta = el('span', 'meta chead-meta', 'chead-meta');
    left.append(meta);
    head.append(left);
    doc.body.append(head);
    head.rect = { left: 100, top: 0, width: 900, height: 40 };
    const rows = [{ kind: 'session.open', payload: { hsid: H, backend: 'claude-code', model: 'claude' } }];
    const store = mem();
    const picker = mountModelPicker(doc as unknown as Document, { client: () => null, rows: () => rows, live: () => true, focused: () => H, notice: () => {}, storage: store });
    /** what app.ts paintChatHead does on every header paint: keep the model key's nodes, rebuild the parts around it */
    const paint = (hsid: string | null): void => {
      for (const n of Array.from(meta.childNodes)) if (!n.hasAttribute('data-model-chip')) meta.removeChild(n);
      if (!hsid) return picker.headChip(meta as unknown as HTMLElement, null);
      meta.prepend(el('span', 'pink'), el('span', 'chead-backend'));
      picker.headChip(meta as unknown as HTMLElement, hsid);
      meta.append(el('span', 'chead-when'));
    };
    return { doc, head, left, meta, paint, rows };
  };

  it('pressing the key opens the menu outside the clipped header part, under the key', () => {
    const { doc, head, left, meta, paint } = setup();
    paint(H);
    const btn = meta.querySelectorAll('.model-btn')[0]!;
    expect(btn.textContent).toBe('default ▾');
    btn.rect = { left: 340, top: 10, width: 80, height: 28 };
    btn.click();
    const menu = doc.querySelectorAll('.model-menu')[0]!;
    expect(menu.hidden).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(menu.parentNode).toBe(head); // hangs from the row, so .chead-l's overflow: hidden cannot clip it
    expect(left.contains(menu)).toBe(false);
    expect(head.childNodes.indexOf(menu)).toBe(head.childNodes.indexOf(left) + 1); // Tab: key → its items → the next header key
    expect(menu.style.left).toBe('240px');
    expect(menu.querySelectorAll('.mode-item').map((b) => b.getAttribute('data-model'))).toContain('opus');
  });

  it('a header repaint (a streamed row) keeps the same key, its focus and the open menu', () => {
    const { doc, meta, paint, rows } = setup();
    paint(H);
    const btn = meta.querySelectorAll('.model-btn')[0]!;
    btn.focus();
    btn.click();
    const menu = doc.querySelectorAll('.model-menu')[0]!;
    for (let i = 0; i < 5; i++) {
      rows.push({ kind: 'turn.event', payload: { hsid: H } } as never);
      paint(H);
    }
    expect(meta.querySelectorAll('.model-btn')).toEqual([btn]);
    expect(doc.querySelectorAll('.model-menu')).toEqual([menu]);
    expect(menu.hidden).toBe(false);
    expect(doc.activeElement).toBe(btn);
    // the parts around the key are in their order: ■ project · backend · model · when
    expect(meta.childNodes.map((n) => n.classes()[0])).toEqual(['pink', 'chead-backend', 'chead-sep', 'model-wrap', 'chead-when']);
    // a menu item still opens the confirm sheet (display only; the switch needs the trusted Switch click)
    menu.querySelectorAll('.mode-item').find((b) => b.getAttribute('data-model') === 'opus')!.click();
    expect(menu.hidden).toBe(true);
    expect(doc.getElementById('model-switch-dialog')!.hidden).toBe(false);
  });

  it('a click elsewhere closes it; another session or none drops the key and its menu', () => {
    const { doc, head, meta, paint } = setup();
    paint(H);
    const btn = meta.querySelectorAll('.model-btn')[0]!;
    btn.click();
    head.click();
    expect(doc.querySelectorAll('.model-menu')[0]!.hidden).toBe(true);
    btn.click();
    paint('hsid:v1:B');
    expect(meta.querySelectorAll('.model-btn')[0]).not.toBe(btn);
    expect(doc.querySelectorAll('.model-menu')).toHaveLength(0); // the old menu went with its key; the new one is made on open
    paint(null);
    expect(meta.querySelectorAll('[data-model-chip]')).toHaveLength(0);
  });

  it('app.ts keeps the key across paints instead of clearing the meta; the header row positions the menu', () => {
    const app = src('src/ui/app.ts');
    const css = src('static/styles.css');
    const paint = app.slice(app.indexOf('function paintChatHead'), app.indexOf("const ROLE_LABEL"));
    expect(paint).not.toMatch(/clear\(meta\)/);
    expect(paint).toMatch(/hasAttribute\('data-model-chip'\)/);
    expect(paint).toMatch(/modelPicker\?\.headChip\(meta, null\)/);
    expect(css).toContain('.pane-head.chead { position: relative; }');
    expect(css).toContain('.chead-l { display: flex; flex: 1 1 auto; align-items: baseline; gap: 10px; min-width: 0; overflow: hidden; }'); // the ellipsis keeps its clip
  });
});
