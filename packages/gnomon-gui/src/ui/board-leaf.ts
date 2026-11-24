/**
 * @symbol #gui-board
 *
 * The board leaf's host layer (boards S1.1 pass B; design components board-leaf, board-rail, content-tray,
 * author-seal, pin, fallback-node, all `proposed`): the head, the keep line, the tool rail, the content tray, the
 * pins, seals and stubs laid over the engine's marks, the hands foot, and the loading, failed, too-short, yielded
 * and empty states. The engine is touched ONLY through the handle of core/board.ts.
 *
 * NOT reachable from the shipped app: nothing in src/main.ts or ui/app.ts imports this file (test/board-leaf.test.ts
 * and the isolation test hold that), so it is in no served bundle until the S1.3 leaf opens it. Today the dev
 * preview fixtures mount it.
 *
 * No inline style attribute is written: sizes and positions go through CSSOM properties, classes do the rest.
 */
import { CONTENT_DEFAULTS, DIM_FALLBACK_LEAD, dimKindName, resolveContentColour } from '@a-company/gnomon-contracts';
import type { DimOp, DimState } from '@a-company/gnomon-contracts';
import type { BoardHandle, BoardModule, BoardState, BoardTheme, BoardTool, BoardWeight } from '../core/board.js';
import { DimClipboard, dimPasteTextOp } from '../core/dim-clipboard.js';
import { BOARD_MIN_HEIGHT, failedCause, keepParts, LEAF_COPY, leafStateOf, LOADING_QUIET_MS, refusalLine, type LeafLoad, type LeafState, type OpenedHow } from '../core/board-leaf.js';
import { footHands, handName, overlayItems } from '../core/board-overlay.js';
import { RAIL_GROUPS, railKeyAction, railLayout, railTitle, railTool, zoomPercent, type RailTool } from '../core/board-rail.js';
import { SEAL_BEAD_RADIUS, SEAL_CENTRE, SEAL_POLYGONS, SEAL_ROUND_RADIUS, SEAL_VIEWBOX, sealBeadPoint, sealLetterBaseline, type Seal } from '../core/board-seal.js';
import { customEntry, MARKER_OFF_TITLE, TRAY_FILL, TRAY_LINE, TRAY_WEIGHTS, wellName } from '../core/board-tray.js';

export interface BoardLeafOptions {
  title: string;
  project: string;
  /** the project swatch's hue class (h0 … h5), as elsewhere in the console */
  projectHue?: string;
  session: string;
  more?: number;
  how: OpenedHow;
  agent?: string;
  /** hh:mm */
  time: string;
  theme: BoardTheme;
  /** the lazy loader of core/board.ts, handed in by whoever opens the leaf; a rejection is the failed state */
  load: () => Promise<BoardModule>;
  /** true while a card in the stack or the pinned zone has focus: the board then takes no key */
  cardFocused: () => boolean;
  /** called once the engine is up (the fixture adds its marks here) */
  onReady?: (handle: BoardHandle) => void;
  /** Esc with nothing else to leave */
  onFold?: () => void;
  /**
   * The dimension as the leaf's owner holds it now (the live controller's view; the fixture's fold). A copy reads
   * the copied nodes from it and a paste is placed on top of it. Without it nothing is copied and nothing pasted.
   */
  view?: () => DimState | null;
  /**
   * Ops the PERSON made outside a drawing gesture (a paste of the leaf's own copy, a pasted text), with the trusted
   * event that caused them. The owner sends them through the SAME path as the handle's `onEdit` ops (one sender,
   * one validator); the leaf applies nothing itself.
   */
  onOps?: (ops: DimOp[], cause: Event | null) => void;
  /** A new node id (a ULID) for each pasted mark; the leaf mints its own when none is given. */
  mint?: () => string;
}

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A new node id (a ULID, `DIM_NODE_ID_PATTERN`): the time, then 80 bits from `crypto.getRandomValues`. */
function mintNodeId(): string {
  let t = Date.now();
  let head = '';
  for (let i = 0; i < 10; i++) {
    head = B32[t % 32] + head;
    t = Math.floor(t / 32);
  }
  let tail = '';
  for (const b of crypto.getRandomValues(new Uint8Array(16))) tail += B32[b % 32];
  return head + tail;
}

export interface BoardLeaf {
  el: HTMLElement;
  handle(): BoardHandle | null;
  state(): LeafState;
  setTheme(theme: BoardTheme): void;
  /** load again from scratch (the head's Try again) */
  retry(): void;
  destroy(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** the foot's min-height plus its dashed rule (styles.css .bd-foot) */
const FOOT_HEIGHT = 29;
type Attrs = Record<string, string | number | boolean | undefined>;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', attrs: Attrs = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== false) e.setAttribute(k, v === true ? '' : String(v));
  e.append(...kids);
  return e;
}
function svg(tag: string, attrs: Attrs = {}, ...kids: Array<Node | string>): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) e.setAttribute(k, String(v));
  e.append(...kids);
  return e;
}

function glyph(t: RailTool): SVGElement {
  return svg(
    'svg',
    { class: 'bd-i', viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true' },
    ...t.paths.map((d) => svg('path', { d })),
    ...(t.ellipse ? [svg('ellipse', t.ellipse)] : []),
    ...(t.dot ? [svg('circle', { ...t.dot, class: 'solid' })] : []),
  );
}

/** A seal, 22 square on screen (the 18 box plus the overhang of the diamond, the hex and a bead on a point). */
export function sealElement(seal: Seal, name: string, cls = ''): SVGElement {
  const cut = seal.cut === 'round' ? svg('circle', { class: 'sl-cut', cx: SEAL_CENTRE, cy: SEAL_CENTRE, r: SEAL_ROUND_RADIUS }) : svg('polygon', { class: 'sl-cut', points: SEAL_POLYGONS[seal.cut].map((p) => p.join(',')).join(' ') });
  const bead = sealBeadPoint(seal.cut, seal.bead);
  return svg('svg', { class: `bd-seal ${cls}`.trim(), viewBox: SEAL_VIEWBOX, width: 22, height: 22, role: 'img', 'aria-label': name }, cut, svg('text', { x: SEAL_CENTRE, y: sealLetterBaseline(seal.cut), 'text-anchor': 'middle' }, seal.letter), svg('circle', { class: 'sl-bead', cx: bead.x, cy: bead.y, r: SEAL_BEAD_RADIUS }));
}

const place = (e: HTMLElement | SVGElement, left: number, top: number): void => void (e.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`);
const isField = (n: Element | null): boolean => !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA');

export function mountBoardLeaf(parent: HTMLElement, o: BoardLeafOptions): BoardLeaf {
  let handle: BoardHandle | null = null;
  let load: LeafLoad = 'loading';
  let cause = '';
  let theme = o.theme;
  let trayOpen = false;
  let menu: 'more' | 'zoom' | null = null;
  let quiet = true;
  let said = '';
  let saidTimer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  const offs: Array<() => void> = [];
  // The copy register (core/dim-clipboard.ts; condition C8, Aegis A6): ONE per leaf, in memory only. A copy on the
  // board remembers the selected nodes and answers the plain text for the system clipboard; a paste of that same
  // text adds clones as the person's own ops; any other pasted text becomes one text mark. It is forgotten on window
  // blur, when the leaf goes, and on a copy or cut anywhere else on the page. So a copy that had words, pasted
  // after a blur, arrives as those bare words (fail-safe: decided here, for Aegis to confirm), and the stand-in line
  // of a wordless copy pasted with nothing held adds nothing and says so.
  const clip = new DimClipboard();
  const forget = (): void => clip.clear();
  window.addEventListener('blur', forget);
  const copied = (ids: string[]): string => {
    const view = o.view?.() ?? null;
    return view ? clip.copy(view, ids).text : (clip.clear(), '');
  };
  const pasted = (hd: BoardHandle, text: string, cause: Event): void => {
    const view = o.view?.() ?? null;
    if (!view || !o.onOps) return;
    const r = clip.paste(text, view, o.mint ?? mintNodeId);
    if (r.kind === 'nothing-held') return say(refusalLine('clipboard'));
    if (r.kind === 'clones') return void (r.ops.length > 0 && o.onOps(r.ops, cause));
    const v = hd.view();
    o.onOps([dimPasteTextOp(text, view, { x: v.width / 2 / v.zoom - v.scrollX, y: v.height / 2 / v.zoom - v.scrollY }, o.mint ?? mintNodeId)], cause);
  };

  // ── the frame ────────────────────────────────────────────────────────────
  const titleEl = h('span', 'title', { title: o.title }, o.title);
  const headKey = h('button', 'key quiet', { type: 'button' });
  const escKey = h('button', 'key quiet', { type: 'button', title: 'Fold to the edge tab (Esc)' }, 'esc');
  const head = h('div', 'lp-head bd-head', {}, h('span', 'bd-g', { 'aria-hidden': 'true' }, '◰'), titleEl, h('span', 'bd-medium', {}, LEAF_COPY.medium), h('button', 'key quiet rename-btn', { type: 'button', 'aria-label': 'Rename dimension', 'aria-disabled': 'true', title: 'Rename arrives with the live board' }, '✎'), h('span', 'spacer'), headKey, escKey);
  const keep = h('div', 'lp-keep bd-keep');
  const rail = h('div', 'bd-rail', { role: 'radiogroup', 'aria-label': 'Board tools', 'aria-orientation': 'vertical' });
  // the drawing surface is one region with a name; its description is the empty note's hint (design `tab_order`)
  const boardHost = h('div', 'bd-board', { role: 'application', 'aria-roledescription': 'board', 'aria-label': `Board: ${o.title}`, 'aria-description': LEAF_COPY.emptyHint });
  // what the board refused is said here, under the head, and announced
  // always in the tree, so a screen reader hears each refusal; the keep line shows the same words
  const saidLine = h('span', 'sr-only', { role: 'status', 'aria-live': 'polite' });
  const over = h('div', 'bd-over', { 'aria-hidden': 'true' });
  const tray = h('div', 'bd-tray', { role: 'group', 'aria-label': 'Line and fill', hidden: true });
  const note = h('div', 'bd-scrap bd-note', { hidden: true });
  const stage = h('div', 'bd-stage', {}, boardHost, over, tray, note);
  const foot = h('div', 'bd-foot', { 'aria-label': 'Hands on this board' });
  const el = h('div', 'bd-leaf', { role: 'region', 'aria-label': `Dimension: ${o.title}` }, head, keep, saidLine, h('div', 'bd-body', {}, rail, stage), foot);
  parent.appendChild(el);

  const st = (): BoardState | null => (handle && handle.isAlive() ? handle.state() : null);
  const leafState = (): LeafState => leafStateOf({ load, alive: !handle || handle.isAlive(), boardHeight: boardHeight(), cardFocused: o.cardFocused(), marks: st()?.marks ?? 0 });
  /** the height the board has (or would have, when the body is hidden): the leaf less its head, keep line and foot */
  const boardHeight = (): number => Math.max(0, el.clientHeight - head.offsetHeight - keep.offsetHeight - FOOT_HEIGHT);
  /** under the least height a board can be drawn on, whatever the state: the body and the foot are not drawn */
  const short = (): boolean => boardHeight() < BOARD_MIN_HEIGHT;
  const yielded = (): boolean => load === 'ready' && o.cardFocused();
  const colour = (token: string | null, role: 'line' | 'fill'): string => (token === null ? 'transparent' : (resolveContentColour(token, role, theme) ?? 'transparent'));

  // ── head and keep line ───────────────────────────────────────────────────
  function drawHead(state: LeafState): void {
    const failed = state === 'failed';
    headKey.textContent = failed ? LEAF_COPY.tryAgain : 'Dimensions ▾';
    headKey.title = failed ? '' : 'Dimensions in this project (/boards)';
    if (failed) headKey.removeAttribute('aria-disabled');
    else headKey.setAttribute('aria-disabled', 'true'); // the list is S1.3's
    keep.className = `lp-keep bd-keep${state === 'yielded' ? ' bd-yield' : ''}${said ? ' bd-said-line' : ''}`;
    keep.replaceChildren();
    // what the board refused is said in the keep line's place (as the yielded line is), so nothing below moves
    if (said && state !== 'failed' && state !== 'loading') {
      keep.title = said;
      return void keep.append(said);
    }
    // too short to hold the failed note: the head keeps the Try again key and this one line says what and why
    if (state === 'failed' && short()) {
      keep.title = `${LEAF_COPY.failedTitle} · ${cause}`;
      return void keep.append(keep.title);
    }
    // one line, cut from its end with …; the whole text is always in title=
    keep.title = state === 'loading' ? '' : state === 'too-short' ? LEAF_COPY.tooShort : state === 'yielded' ? LEAF_COPY.yielded : '';
    if (state === 'loading') return void keep.append(quiet ? '' : LEAF_COPY.loading);
    if (state === 'too-short') return void keep.append(LEAF_COPY.tooShort);
    if (state === 'yielded') return void keep.append(h('span', 'bd-yield-m', { 'aria-hidden': 'true' }, '◆'), ` ${LEAF_COPY.yielded}`);
    const k = keepParts(o);
    const text = `dimension in ${k.project} · attached ◇ ${k.session} · ${k.opened} · ${k.time}`;
    keep.title = text;
    keep.append('dimension in ', h('span', `swatch ${o.projectHue ?? 'h0'}`), ` ${k.project} · attached ◇ ${k.session} · ${k.opened} · ${k.time}`);
  }

  // ── the rail ─────────────────────────────────────────────────────────────
  function act(run: () => void, press?: Event): void {
    // while a card has the keys the first press only wakes the board: focus moves, nothing is chosen or drawn
    if (yielded()) {
      if (!press || press.isTrusted) handle?.focus();
      return;
    }
    run();
  }
  const row = (letter: string, key: HTMLElement, ...extra: Node[]): HTMLElement => h('span', 'bd-row', {}, h('kbd', '', {}, letter), key, ...extra);
  function toolKey(t: RailTool, s: BoardState | null, off: boolean): HTMLElement {
    const on = s?.tool === t.tool;
    const b = h('button', `key quiet seg-key bd-tool${on && !off ? ' current' : ''}`, { type: 'button', role: 'radio', 'aria-checked': on && !off ? 'true' : 'false', 'aria-disabled': off ? 'true' : undefined, title: t.tool === 'hand' ? 'Hand: drag to move the view (H, or hold Space)' : railTitle(t), 'aria-label': t.name.replace(' · connect', ''), tabindex: on || (!s && t.tool === 'select') ? 0 : -1, 'data-tool': t.tool, 'data-key': `tool:${t.tool}` });
    b.append(glyph(t));
    b.addEventListener('click', (e) => act(() => chooseTool(t.tool), e));
    return b;
  }
  const quietKey = (cls: string, label: string, title: string, off: boolean, run: (e: Event) => void, attrs: Attrs = {}): HTMLElement => {
    const b = h('button', `key quiet ${cls}`, { type: 'button', title, 'aria-disabled': off ? 'true' : undefined, tabindex: -1, ...attrs }, label);
    b.addEventListener('click', (e) => (off ? act(() => undefined, e) : act(() => run(e), e)));
    return b;
  };
  function menuOf(items: Array<{ label: string; letter?: string; glyph?: SVGElement; run: () => void }>): HTMLElement {
    const m = h('div', 'bd-menu', { role: 'menu' });
    for (const it of items) {
      const b = h('button', 'bd-mi', { type: 'button', role: 'menuitem' }, ...(it.glyph ? [it.glyph] : []), it.label, ...(it.letter ? [h('kbd', '', {}, it.letter)] : []));
      b.addEventListener('click', () => {
        menu = null;
        it.run();
        draw();
        handle?.focus(); // the menu is gone: the keyboard goes back to the board, never to the page body
      });
      m.append(b);
    }
    return m;
  }
  function chooseTool(tool: BoardTool): void {
    handle?.setTool(tool);
    handle?.focus();
  }
  function drawRail(state: LeafState): void {
    const s = st();
    const off = state !== 'open' && state !== 'empty';
    rail.className = `bd-rail${off ? ' yielded' : ''}`;
    const lay = railLayout(boardHeight() || 9999, s?.tool ?? 'select');
    const style = s?.style ?? { line: CONTENT_DEFAULTS.line, fill: null, weight: 'fine' as BoardWeight };
    // the rail is rebuilt only when what it shows has changed: a rebuild under a pointer press loses the press, and a
    // rebuild on a focus move sent focus round in a loop (review B1)
    const key = JSON.stringify([off, s?.tool ?? null, lay, menu, zoomPercent(s?.zoom ?? 1), style.line, style.fill, trayOpen, theme]);
    if (key === railKey) return;
    railKey = key;
    const kids: Node[] = [];
    let first = true;
    for (const group of RAIL_GROUPS) {
      const all = group.filter((t) => lay.visible.includes(t));
      if (all.length === 0) continue;
      if (!first) kids.push(h('span', 'bd-brk', { 'aria-hidden': 'true' }));
      first = false;
      for (const t of all) kids.push(row(off ? '' : railTool(t).letter, toolKey(railTool(t), s, off)));
    }
    if (lay.folded.length) {
      const names = lay.folded.map((t) => `${railTool(t).name.replace(' · connect', '')} (${railTool(t).letter})`).join(', ');
      const more = quietKey('bd-tool bd-more', '⋯', `More tools: ${names}`, off, () => void ((menu = menu === 'more' ? null : 'more'), draw()), { 'aria-haspopup': 'menu', 'aria-label': 'More tools', 'aria-expanded': menu === 'more' ? 'true' : 'false', 'data-key': 'more' });
      kids.push(row('', more, ...(menu === 'more' && !off ? [menuOf(lay.folded.map((t) => ({ label: railTool(t).name, letter: railTool(t).letter, glyph: glyph(railTool(t)), run: () => chooseTool(t) })))] : [])));
    }
    kids.push(h('span', 'bd-brk', { 'aria-hidden': 'true' }));
    const ink = quietKey('bd-tool bd-ink', '', 'Line and fill', off, () => void ((trayOpen = !trayOpen), draw()), { 'aria-label': `Line ${wellName(style.line)}, fill ${wellName(style.fill)}`, 'aria-expanded': trayOpen ? 'true' : 'false', 'data-key': 'ink' });
    const wl = h('span', 'bd-well line');
    wl.style.setProperty('--wl', colour(style.line, 'line'));
    const wf = h('span', `bd-well fill${style.fill === null ? ' c-none' : ''}`);
    if (style.fill !== null) wf.style.setProperty('--wf', colour(style.fill, 'fill'));
    ink.append(wl, wf);
    kids.push(row('', ink), h('span', 'bd-grow'));
    if (lay.hand) kids.push(row(off ? '' : 'H', toolKey(railTool('hand'), s, off)));
    if (lay.zoomKeys) kids.push(row('', quietKey('bd-tool', '+', 'Zoom in (⌘ +)', off, () => handle?.zoomIn(), { 'aria-label': 'Zoom in', 'data-key': 'zoom-in' })));
    const pct = quietKey('bd-zoom', zoomPercent(s?.zoom ?? 1), lay.zoomKeys ? 'Fit everything (⌘ 0)' : 'Zoom', off, () => (lay.zoomKeys ? handle?.zoomToFit() : void ((menu = menu === 'zoom' ? null : 'zoom'), draw())), lay.zoomKeys ? { 'data-key': 'percent' } : { 'aria-haspopup': 'menu', 'aria-expanded': menu === 'zoom' ? 'true' : 'false', 'data-key': 'percent' });
    kids.push(row('', pct, ...(menu === 'zoom' && !lay.zoomKeys && !off ? [menuOf([{ label: 'Zoom in', letter: '⌘ +', run: () => handle?.zoomIn() }, { label: 'Fit everything', letter: '⌘ 0', run: () => handle?.zoomToFit() }, { label: 'Zoom out', letter: '⌘ −', run: () => handle?.zoomOut() }])] : [])));
    if (lay.zoomKeys) kids.push(row('', quietKey('bd-tool', '−', 'Zoom out (⌘ −)', off, () => handle?.zoomOut(), { 'aria-label': 'Zoom out', 'data-key': 'zoom-out' })));
    const focused = rail.contains(document.activeElement) ? (document.activeElement as HTMLElement).getAttribute('data-key') : null;
    rail.replaceChildren(...kids);
    // focus goes back to the same key (every rail key has a data-key), or to the chosen tool when that key is gone
    if (focused) (rail.querySelector<HTMLElement>(`[data-key="${focused}"]`) ?? rail.querySelector<HTMLElement>('[tabindex="0"]'))?.focus();
  }

  // ── the tray ─────────────────────────────────────────────────────────────
  let hexText = '';
  let trayKey = '';
  let railKey = '';
  function drawTray(state: LeafState): void {
    const s = st();
    tray.hidden = !trayOpen || !s || (state !== 'open' && state !== 'empty');
    if (tray.hidden) return void (trayKey = '');
    const style = s!.style;
    // the tray is rebuilt only when what it shows has changed: a focus move must not replace a field being typed in
    const key = JSON.stringify([style, s!.tool === 'stroke', theme]);
    if (key === trayKey) return;
    trayKey = key;
    // each row is ONE tab stop; the arrow keys move within it (design content-tray: a radiogroup per row)
    const roving = (row: HTMLElement): void => {
      row.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const keys = [...row.querySelectorAll<HTMLElement>('button:not([disabled])')];
        const at = keys.indexOf(document.activeElement as HTMLElement);
        if (at < 0) return;
        e.preventDefault();
        keys[(at + (e.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length]!.focus();
      });
    };
    const wells = (role: 'line' | 'fill', tokens: ReadonlyArray<string | null>, chosen: string | null): HTMLElement => {
      const name = h('span', 'bd-wn', {}, wellName(chosen));
      const r = h('div', 'bd-tr', { role: 'radiogroup', 'aria-label': role }, h('span', 'bd-tl', {}, role));
      const anyChosen = tokens.includes(chosen);
      tokens.forEach((t, n) => {
        const on = t === chosen;
        const w = h('button', `bd-well ${role}${t === null ? ' c-none' : ''}${on ? ' sel' : ''}`, { type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', title: wellName(t), 'aria-label': wellName(t), tabindex: on || (!anyChosen && n === 0) ? 0 : -1, 'data-key': `${role}:${t ?? 'none'}` });
        if (t !== null) w.style.setProperty(role === 'line' ? '--wl' : '--wf', colour(t, role));
        const show = (): void => void (name.textContent = wellName(t));
        const back = (): void => void (name.textContent = wellName(chosen));
        w.addEventListener('pointerenter', show);
        w.addEventListener('focus', show);
        w.addEventListener('pointerleave', back);
        w.addEventListener('blur', back);
        w.addEventListener('click', (e) => {
          handle?.setStyle(role === 'line' ? { line: t as string } : { fill: t }, e);
          draw();
        });
        r.append(w);
      });
      r.append(name);
      roving(r);
      return r;
    };
    const weight = h('div', 'bd-tr', { role: 'group', 'aria-label': 'weight' }, h('span', 'bd-tl', {}, 'weight'));
    for (const wgt of TRAY_WEIGHTS) {
      const off = wgt === 'marker' && s!.tool !== 'stroke';
      const b = h('button', `key quiet seg-key${style.weight === wgt ? ' current' : ''}`, { type: 'button', 'aria-pressed': style.weight === wgt ? 'true' : 'false', disabled: off, title: off ? MARKER_OFF_TITLE : undefined, tabindex: style.weight === wgt ? 0 : -1, 'data-key': `weight:${wgt}` }, wgt);
      b.addEventListener('click', (e) => {
        handle?.setStyle({ weight: wgt }, e);
        draw();
      });
      weight.append(b);
    }
    roving(weight);
    const field = h('input', 'field bd-hex', { 'aria-label': 'Custom colour, hex', value: hexText, spellcheck: 'false', autocomplete: 'off', maxlength: 7, 'data-key': 'hex' });
    const custom = h('div', 'bd-tr', {}, h('span', 'bd-tl', {}, 'custom'), field);
    const answer = h('div', 'bd-refuse-row', { role: 'status' });
    const read = (): void => {
      hexText = field.value;
      custom.querySelectorAll('.bd-well, .meta').forEach((n) => n.remove());
      answer.replaceChildren();
      if (!hexText.trim()) return;
      // one well per role the colour passes for: "use as line", "use as fill". Nothing is applied until one is pressed.
      const entries = (['line', 'fill'] as const).map((role) => ({ role, c: customEntry(hexText, role) }));
      const passing = entries.filter((e) => e.c.ok);
      for (const { role, c } of passing) {
        if (!c.ok) continue;
        const w = h('button', `bd-well ${role}`, { type: 'button', title: `use as ${role}`, 'aria-label': `Use this colour as the ${role}`, 'data-key': `custom:${role}` });
        w.style.setProperty(role === 'line' ? '--wl' : '--wf', colour(c.token, role));
        w.addEventListener('click', (e) => {
          handle?.setStyle(role === 'line' ? { line: c.token } : { fill: c.token }, e);
          draw();
        });
        custom.append(w);
      }
      // the night values are quoted only for the roles the colour is offered in
      const first = passing[0]?.c;
      if (first?.ok) custom.append(h('span', 'meta', {}, `custom · at night ${passing.map(({ role, c }) => (c.ok ? `${c.night[role]} as a ${role}` : '')).join(', ')}`));
      // a role the colour fails for: nothing is applied and nothing is substituted; the nearest swatch is an offer
      for (const { role, c } of entries) {
        if (c.ok) continue;
        answer.append(h('span', 'bd-refuse', {}, passing.length && !c.line.includes(`as a ${role}`) ? `${c.line} as a ${role}` : c.line));
        if (c.offer) {
          const offer = c.offer;
          const b = h('button', 'key quiet', { type: 'button', 'data-key': `offer:${role}` }, passing.length ? `Use ${offer} as the ${role}` : `Use ${offer}`);
          b.addEventListener('click', (e) => {
            hexText = '';
            trayKey = '';
            handle?.setStyle(role === 'line' ? { line: offer } : { fill: offer }, e);
            draw();
          });
          answer.append(b);
        }
        if (!passing.length) break; // refused for both roles: say it once
      }
    };
    field.addEventListener('input', read);
    // the control that had focus keeps it through the rebuild (review B2: choosing a well dropped focus to the body,
    // so Esc no longer closed the tray and the tool letters did nothing)
    const focused = tray.contains(document.activeElement) ? (document.activeElement as HTMLElement).getAttribute('data-key') : null;
    tray.replaceChildren(wells('line', TRAY_LINE, style.line), wells('fill', TRAY_FILL, style.fill), weight, custom, answer);
    read();
    if (focused) {
      const again = tray.querySelector<HTMLElement>(`[data-key="${focused}"]`) ?? tray.querySelector<HTMLElement>('[tabindex="0"]');
      again?.focus();
      if (again === field) field.setSelectionRange(hexText.length, hexText.length);
    }
  }

  // ── the overlay: pins, seals, an agent text's box, a stub's words ────────
  function drawOver(): void {
    if (!handle || !handle.isAlive()) return void over.replaceChildren();
    const kids: Array<HTMLElement | SVGElement> = [];
    for (const it of overlayItems(handle.marks(), handle.view())) {
      if (it.type === 'pin' || it.type === 'hollow') {
        const p = h('span', `bd-pin${it.type === 'hollow' ? ' unk' : ''}`);
        place(p, it.left - 4, it.top - 4);
        kids.push(p);
      } else if (it.type === 'seal') {
        const s = sealElement(it.seal, it.name);
        place(s, it.left - 11, it.top - 11);
        kids.push(s);
      } else if (it.type === 'textbox') {
        const b = h('div', 'bd-textbox');
        place(b, it.left, it.top);
        b.style.width = `${Math.round(it.width)}px`;
        b.style.height = `${Math.round(it.height)}px`;
        kids.push(b);
      } else {
        // the only text taken from the node is its kind, pattern-checked by the contracts; the lead word is never dropped
        const name = dimKindName(it.kind);
        const b = h('div', `bd-stub${it.dashed ? ' agent' : ''}`, {}, h('span', 'bd-stub-k', { title: name }, h('span', 'bd-stub-l', {}, DIM_FALLBACK_LEAD), name.length > 36 ? `${name.slice(0, 35)}…` : name), h('span', 'bd-stub-n', {}, LEAF_COPY.stubNote));
        place(b, it.left, it.top);
        b.style.width = `${Math.round(it.width)}px`;
        b.style.height = `${Math.round(it.height)}px`;
        kids.push(b);
      }
    }
    over.replaceChildren(...kids);
  }

  // ── notes and the foot ───────────────────────────────────────────────────
  function drawNote(state: LeafState): void {
    note.hidden = state !== 'empty' && state !== 'failed';
    if (note.hidden) return;
    const pin = h('span', 'bd-pin', { 'aria-hidden': 'true' });
    if (state === 'empty') note.replaceChildren(pin, h('p', 'bd-en-t', {}, LEAF_COPY.emptyTitle), h('p', '', {}, LEAF_COPY.emptyHint));
    else note.replaceChildren(pin, h('p', 'bd-en-t', {}, LEAF_COPY.failedTitle), h('p', '', {}, cause), h('p', '', {}, LEAF_COPY.failedNext));
  }
  function drawFoot(): void {
    const kids: Node[] = [];
    for (const f of handle && handle.isAlive() ? footHands(handle.marks()) : [{ hand: 'you' as const, n: 0 }]) {
      if (f.hand === 'you') kids.push(h('span', 'bd-hand', {}, h('span', 'bd-pin inline', { 'aria-hidden': 'true' }), ` you ${f.n}`));
      else if (f.hand === 'agent') {
        const name = h('bdi', '', { title: f.name }, handName(f.name));
        kids.push(h('span', 'bd-hand', {}, sealElement(f.seal, f.name), ' ', name, ` ${f.n}`));
      } else kids.push(h('span', 'bd-hand', {}, h('span', 'bd-pin unk inline', { 'aria-hidden': 'true' }), ` ${LEAF_COPY.unknownHand} ${f.n}`));
    }
    foot.replaceChildren(...kids);
    // hands that do not fit become '+<k> more', with every hand in title=; 'you' is always first and always shown
    const all = kids.map((k) => (k.textContent ?? '').trim()).join(' · ');
    let cut = 0;
    while (foot.scrollWidth > foot.clientWidth && kids.length - cut > 1) {
      cut++;
      foot.replaceChildren(...kids.slice(0, kids.length - cut), h('span', 'bd-hand bd-more-hands', { title: all }, `+${cut} more`));
    }
  }
  let saidAt = 0;
  function say(text: string): void {
    said = text;
    saidAt = Date.now();
    saidLine.textContent = text;
    clearTimeout(saidTimer);
    saidTimer = setTimeout(unsay, 6000);
    draw();
  }
  /** The refusal line goes after six seconds, or as soon as something else is done on the board. */
  function unsay(): void {
    if (!said) return;
    said = '';
    saidLine.textContent = '';
    clearTimeout(saidTimer);
    draw();
  }

  let drawing = false;
  let again = false;
  function draw(): void {
    // one draw at a time: a draw that moves focus must not start another inside itself (review B1)
    if (drawing) return void (again = true);
    drawing = true;
    try {
      const state = leafState();
      // under the least height nothing of the body or the foot is drawn, in EVERY state (review B3: loading and
      // failed used to draw the rail over the pinned card and the composer)
      el.classList.toggle('too-short', short());
      el.dataset.state = state;
      // the failed note stands on the bare desk: nothing of a stopped engine is left showing
      boardHost.hidden = state === 'failed';
      over.hidden = state === 'failed';
      drawHead(state);
      drawRail(state);
      drawTray(state);
      drawNote(state);
      drawFoot();
      drawOver();
      wasYielded = yielded();
      // while a card has the keyboard the engine's document-level listeners do nothing (G-DDL-08)
      if (handle?.isAlive()) handle.setYielded(wasYielded);
    } finally {
      drawing = false;
    }
    if (again) {
      again = false;
      draw();
    }
  }
  let wasYielded = false;
  /** pins, seals and the foot follow the scene once per frame, however many changes a frame holds */
  let sceneFrame = 0;
  const sceneSoon = (): void => {
    if (sceneFrame) return;
    sceneFrame = requestAnimationFrame(() => {
      sceneFrame = 0;
      drawOver();
      drawFoot();
    });
  };

  // ── loading the engine ───────────────────────────────────────────────────
  function fail(error: unknown, afterMount: boolean): void {
    cause = failedCause(error, afterMount);
    load = 'failed';
    trayOpen = false;
    draw();
    headKey.focus(); // Try again is where the keyboard is, not the page body
  }
  function start(): void {
    const mine = ++generation;
    handle?.unmount();
    handle = null;
    load = 'loading';
    quiet = true;
    setTimeout(() => {
      if (mine === generation && load === 'loading') {
        quiet = false;
        draw();
      }
    }, LOADING_QUIET_MS);
    draw();
    if (!o.cardFocused()) headKey.focus(); // while it loads the keyboard is in the head, not on the page body
    o.load()
      .then((m) => m.mountBoard(boardHost, { theme, onError: (err) => mine === generation && fail(err, true) }))
      .then(
        (hd) => {
          if (mine !== generation) return hd.unmount();
          handle = hd;
          load = 'ready';
          offs.push(
            hd.onState(() => {
              if (said && Date.now() - saidAt > 400) unsay(); // something else was done: the refusal has been read
              draw();
            }),
            hd.onScene(sceneSoon),
            hd.onRefusal((r) => say(refusalLine(r.what))),
            hd.onCopy((ids) => copied(ids)),
            hd.onCut((ids) => copied(ids)),
            hd.onCopyOutside(forget),
            hd.onPasteText((text, cause) => pasted(hd, text, cause)),
          );
          try {
            o.onReady?.(hd);
          } catch (err) {
            globalThis.reportError(err); // the opener's mistake is reported, and the board still opens
          }
          draw();
          // opening moves focus to the board, unless a card has the keys; a leaf too short to draw on has no board
          // to focus, so the head key takes it (never the page body)
          if (!o.cardFocused()) short() ? headKey.focus() : hd.focus();
        },
        (err: unknown) => mine === generation && fail(err, false),
      );
  }

  // ── keys and presses ─────────────────────────────────────────────────────
  const onKey = (e: KeyboardEvent): void => {
    const active = document.activeElement;
    const s = st();
    // a field of the engine's own (a text being typed, a frame title being renamed) keeps every key
    if (isField(active) && boardHost.contains(active)) return;
    if (e.key === 'Escape' && !o.cardFocused() && el.contains(active) && !s?.editingText && (!s || s.tool === 'select')) {
      // Esc order: a text edit or the tool first (the rail action below), then the tray, then the leaf folds
      if (menu) return void ((menu = null), draw(), e.stopPropagation());
      if (trayOpen) return void ((trayOpen = false), draw(), handle?.focus(), e.stopPropagation());
      return void o.onFold?.();
    }
    if (isField(active) && !boardHost.contains(active)) return;
    const a = railKeyAction(e, { boardFocused: el.contains(active), editingText: s?.editingText ?? false, cardFocused: o.cardFocused() });
    if (!a || !handle || !s) return;
    e.preventDefault();
    e.stopPropagation();
    if (a.type === 'fit') handle.zoomToFit();
    else chooseTool(a.tool);
  };
  el.addEventListener('keydown', onKey, true);
  // a refusal has been read once the person does anything else: it goes at the next press or key (it used to stay
  // through a press on empty ground and through selecting another mark)
  el.addEventListener('pointerdown', unsay, true);
  el.addEventListener('keydown', unsay, true);
  // the rail is one tab stop; ↑ and ↓ move within it
  rail.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const keys = [...rail.querySelectorAll<HTMLElement>('button')];
    const i = keys.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    keys[(i + (e.key === 'ArrowDown' ? 1 : keys.length - 1)) % keys.length]!.focus();
  });
  // a press on the board while a card has the keys only wakes it: it never reaches the engine
  // The waking press is one whole gesture: for the length of a double-click after it, nothing more of that gesture
  // reaches the engine (its release, its click, a second press, the double-click that would start a text).
  const WAKE_HOLD_MS = 500;
  let wakeUntil = 0;
  const onWake = (e: Event): void => {
    if (!yielded()) {
      if (performance.now() < wakeUntil) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.isTrusted) {
      wakeUntil = performance.now() + WAKE_HOLD_MS;
      handle?.focus();
    }
  };
  stage.addEventListener('pointerdown', onWake, true);
  // and nothing else reaches the engine while yielded (review S4): a double-click, a wheel, a drop, a context menu
  const onHeld = (e: Event): void => {
    if (!yielded() && performance.now() >= wakeUntil) return;
    e.preventDefault();
    e.stopPropagation();
  };
  // (touchmove, touchend and touchcancel too: the engine handles touches on its canvas. Its keyup and Safari
  // gesture listeners are on the DOCUMENT and cannot be stopped from here: recorded for S1.3)
  for (const type of ['pointerup', 'pointermove', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'dragover', 'drop', 'paste', 'touchstart', 'touchmove', 'touchend', 'touchcancel']) stage.addEventListener(type, onHeld, true);
  stage.addEventListener('wheel', onHeld, { capture: true, passive: false });
  headKey.addEventListener('click', () => load === 'failed' && start());
  escKey.addEventListener('click', () => o.onFold?.());
  // the leaf redraws on a focus move ONLY when the yield state flips (review B1: redrawing on every focusin replaced
  // the rail key under the pointer and looped with the redraw's own refocus)
  const onFocus = (): void => void queueMicrotask(() => yielded() !== wasYielded && draw());
  document.addEventListener('focusin', onFocus);
  document.addEventListener('focusout', onFocus);
  const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => draw());
  ro?.observe(el);

  start();
  return {
    el,
    handle: () => handle,
    state: leafState,
    setTheme(next) {
      theme = next;
      handle?.setTheme(next);
      draw();
    },
    retry: start,
    destroy() {
      generation++;
      clearTimeout(saidTimer);
      for (const off of offs.splice(0)) off();
      window.removeEventListener('blur', forget);
      clip.clear();
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onFocus);
      cancelAnimationFrame(sceneFrame);
      ro?.disconnect();
      handle?.unmount();
      el.remove();
    },
  };
}

/** Under this much board height the leaf keeps its head and one line (re-exported for the fixtures). */
export { BOARD_MIN_HEIGHT };
