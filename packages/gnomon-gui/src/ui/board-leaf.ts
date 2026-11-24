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
import type { BoardHandle, BoardModule, BoardState, BoardTheme, BoardTool, BoardWeight } from '../core/board.js';
import { BOARD_MIN_HEIGHT, failedCause, keepParts, LEAF_COPY, leafStateOf, LOADING_QUIET_MS, type LeafLoad, type LeafState, type OpenedHow } from '../core/board-leaf.js';
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
  let customRole: 'line' | 'fill' = 'line';
  let menu: 'more' | 'zoom' | null = null;
  let quiet = true;
  let said = '';
  let saidTimer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  const offs: Array<() => void> = [];

  // ── the frame ────────────────────────────────────────────────────────────
  const titleEl = h('span', 'title', { title: o.title }, o.title);
  const headKey = h('button', 'key quiet', { type: 'button' });
  const escKey = h('button', 'key quiet', { type: 'button', title: 'Fold to the edge tab (Esc)' }, 'esc');
  const head = h('div', 'lp-head bd-head', {}, h('span', 'bd-g', { 'aria-hidden': 'true' }, '◰'), titleEl, h('span', 'bd-medium', {}, LEAF_COPY.medium), h('button', 'key quiet rename-btn', { type: 'button', 'aria-label': 'Rename dimension', 'aria-disabled': 'true', title: 'Rename arrives with the live board' }, '✎'), h('span', 'spacer'), headKey, escKey);
  const keep = h('div', 'lp-keep bd-keep');
  const rail = h('div', 'bd-rail', { role: 'radiogroup', 'aria-label': 'Board tools', 'aria-orientation': 'vertical' });
  const boardHost = h('div', 'bd-board');
  const over = h('div', 'bd-over', { 'aria-hidden': 'true' });
  const tray = h('div', 'bd-tray', { role: 'group', 'aria-label': 'Line and fill', hidden: true });
  const note = h('div', 'bd-scrap bd-note', { hidden: true });
  const stage = h('div', 'bd-stage', {}, boardHost, over, tray, note);
  const foot = h('div', 'bd-foot', { 'aria-label': 'Hands on this board' });
  const el = h('div', 'bd-leaf', { role: 'region', 'aria-label': `Board: ${o.title}` }, head, keep, h('div', 'bd-body', {}, rail, stage), foot);
  parent.appendChild(el);

  const st = (): BoardState | null => (handle && handle.isAlive() ? handle.state() : null);
  const leafState = (): LeafState => leafStateOf({ load, alive: !handle || handle.isAlive(), boardHeight: boardHeight(), cardFocused: o.cardFocused(), marks: st()?.marks ?? 0 });
  /** the height the board has (or would have, when the body is hidden): the leaf less its head, keep line and foot */
  const boardHeight = (): number => Math.max(0, el.clientHeight - head.offsetHeight - keep.offsetHeight - FOOT_HEIGHT);
  const yielded = (): boolean => load === 'ready' && o.cardFocused();
  const colour = (token: string | null, role: 'line' | 'fill'): string => (token === null ? 'transparent' : (resolveContentColour(token, role, theme) ?? 'transparent'));

  // ── head and keep line ───────────────────────────────────────────────────
  function drawHead(state: LeafState): void {
    const failed = state === 'failed';
    headKey.textContent = failed ? LEAF_COPY.tryAgain : 'Dimensions ▾';
    headKey.title = failed ? '' : 'Dimensions in this project (/boards)';
    if (failed) headKey.removeAttribute('aria-disabled');
    else headKey.setAttribute('aria-disabled', 'true'); // the list is S1.3's
    keep.className = `lp-keep bd-keep${state === 'yielded' ? ' bd-yield' : ''}`;
    keep.replaceChildren();
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
    const b = h('button', `key quiet seg-key bd-tool${on && !off ? ' current' : ''}`, { type: 'button', role: 'radio', 'aria-checked': on && !off ? 'true' : 'false', 'aria-disabled': off ? 'true' : undefined, title: t.tool === 'hand' ? 'Hand: drag to move the view (H, or hold Space)' : railTitle(t), 'aria-label': t.name.replace(' · connect', ''), tabindex: on || (!s && t.tool === 'select') ? 0 : -1, 'data-tool': t.tool });
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
      const more = quietKey('bd-tool bd-more', '⋯', `More tools: ${names}`, off, () => void ((menu = menu === 'more' ? null : 'more'), draw()), { 'aria-haspopup': 'menu', 'aria-label': 'More tools', 'aria-expanded': menu === 'more' ? 'true' : 'false' });
      kids.push(row('', more, ...(menu === 'more' && !off ? [menuOf(lay.folded.map((t) => ({ label: railTool(t).name, letter: railTool(t).letter, glyph: glyph(railTool(t)), run: () => chooseTool(t) })))] : [])));
    }
    kids.push(h('span', 'bd-brk', { 'aria-hidden': 'true' }));
    const style = s?.style ?? { line: CONTENT_DEFAULTS.line, fill: null, weight: 'fine' as BoardWeight };
    const ink = quietKey('bd-tool bd-ink', '', 'Line and fill', off, () => void ((trayOpen = !trayOpen), draw()), { 'aria-label': `Line ${wellName(style.line)}, fill ${wellName(style.fill)}`, 'aria-expanded': trayOpen ? 'true' : 'false' });
    const wl = h('span', 'bd-well line');
    wl.style.setProperty('--wl', colour(style.line, 'line'));
    const wf = h('span', `bd-well fill${style.fill === null ? ' c-none' : ''}`);
    if (style.fill !== null) wf.style.setProperty('--wf', colour(style.fill, 'fill'));
    ink.append(wl, wf);
    kids.push(row('', ink), h('span', 'bd-grow'));
    if (lay.hand) kids.push(row(off ? '' : 'H', toolKey(railTool('hand'), s, off)));
    if (lay.zoomKeys) kids.push(row('', quietKey('bd-tool', '+', 'Zoom in (⌘ +)', off, () => handle?.zoomIn(), { 'aria-label': 'Zoom in' })));
    const pct = quietKey('bd-zoom', zoomPercent(s?.zoom ?? 1), lay.zoomKeys ? 'Fit everything (⌘ 0)' : 'Zoom', off, () => (lay.zoomKeys ? handle?.zoomToFit() : void ((menu = menu === 'zoom' ? null : 'zoom'), draw())), lay.zoomKeys ? {} : { 'aria-haspopup': 'menu', 'aria-expanded': menu === 'zoom' ? 'true' : 'false' });
    kids.push(row('', pct, ...(menu === 'zoom' && !lay.zoomKeys && !off ? [menuOf([{ label: 'Zoom in', letter: '⌘ +', run: () => handle?.zoomIn() }, { label: 'Fit everything', letter: '⌘ 0', run: () => handle?.zoomToFit() }, { label: 'Zoom out', letter: '⌘ −', run: () => handle?.zoomOut() }])] : [])));
    if (lay.zoomKeys) kids.push(row('', quietKey('bd-tool', '−', 'Zoom out (⌘ −)', off, () => handle?.zoomOut(), { 'aria-label': 'Zoom out' })));
    const focused = rail.contains(document.activeElement) ? (document.activeElement as HTMLElement).getAttribute('data-tool') : null;
    rail.replaceChildren(...kids);
    if (focused) rail.querySelector<HTMLElement>(`[data-tool="${focused}"]`)?.focus();
  }

  // ── the tray ─────────────────────────────────────────────────────────────
  let hexText = '';
  let trayKey = '';
  function drawTray(state: LeafState): void {
    const s = st();
    tray.hidden = !trayOpen || !s || (state !== 'open' && state !== 'empty');
    if (tray.hidden) return void (trayKey = '');
    const style = s!.style;
    // the tray is rebuilt only when what it shows has changed: a focus move must not replace a field being typed in
    const key = JSON.stringify([style, s!.tool === 'stroke', theme, customRole]);
    if (key === trayKey) return;
    trayKey = key;
    const wells = (role: 'line' | 'fill', tokens: ReadonlyArray<string | null>, chosen: string | null): HTMLElement => {
      const name = h('span', 'bd-wn', {}, wellName(chosen));
      const r = h('div', 'bd-tr', { role: 'radiogroup', 'aria-label': role }, h('span', 'bd-tl', {}, role));
      for (const t of tokens) {
        const on = t === chosen;
        const w = h('button', `bd-well ${role}${t === null ? ' c-none' : ''}${on ? ' sel' : ''}`, { type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', title: wellName(t), 'aria-label': wellName(t) });
        if (t !== null) w.style.setProperty(role === 'line' ? '--wl' : '--wf', colour(t, role));
        const show = (): void => void (name.textContent = wellName(t));
        const back = (): void => void (name.textContent = wellName(chosen));
        w.addEventListener('pointerenter', show);
        w.addEventListener('focus', show);
        w.addEventListener('pointerleave', back);
        w.addEventListener('blur', back);
        w.addEventListener('click', () => {
          customRole = role;
          handle?.setStyle(role === 'line' ? { line: t as string } : { fill: t });
          draw();
        });
        r.append(w);
      }
      r.append(name);
      return r;
    };
    const weight = h('div', 'bd-tr', {}, h('span', 'bd-tl', {}, 'weight'));
    for (const wgt of TRAY_WEIGHTS) {
      const off = wgt === 'marker' && s!.tool !== 'stroke';
      const b = h('button', `key quiet seg-key${style.weight === wgt ? ' current' : ''}`, { type: 'button', 'aria-pressed': style.weight === wgt ? 'true' : 'false', disabled: off, title: off ? MARKER_OFF_TITLE : undefined }, wgt);
      b.addEventListener('click', () => handle?.setStyle({ weight: wgt }));
      weight.append(b);
    }
    const field = h('input', 'field bd-hex', { 'aria-label': 'Custom colour, hex', value: hexText, spellcheck: 'false', autocomplete: 'off', maxlength: 7 });
    const custom = h('div', 'bd-tr', {}, h('span', 'bd-tl', {}, 'custom'), field);
    const answer = h('div', 'bd-refuse-row', { role: 'status' });
    const read = (): void => {
      hexText = field.value;
      custom.querySelectorAll('.bd-well, .meta').forEach((n) => n.remove());
      answer.replaceChildren();
      if (!hexText.trim()) return;
      const c = customEntry(hexText, customRole);
      if (c.ok) {
        // a passing colour is offered as a well; pressing it (or Enter) applies it to the row last used
        const w = h('button', `bd-well ${customRole}`, { type: 'button', title: 'custom', 'aria-label': `Use this colour as the ${customRole}` });
        w.style.setProperty(customRole === 'line' ? '--wl' : '--wf', colour(c.token, customRole));
        const use = (): void => void handle?.setStyle(customRole === 'line' ? { line: c.token } : { fill: c.token });
        w.addEventListener('click', use);
        field.onkeydown = (e) => void (e.key === 'Enter' && use());
        custom.append(w, h('span', 'meta', {}, c.line));
        return;
      }
      // refused: nothing is applied and nothing is substituted; the nearest swatch is an offer, taken only by its key
      field.onkeydown = null;
      answer.append(h('span', 'bd-refuse', {}, c.line));
      if (c.offer) {
        const offer = c.offer;
        const b = h('button', 'key quiet', { type: 'button' }, `Use ${offer}`);
        b.addEventListener('click', () => {
          hexText = '';
          trayKey = '';
          handle?.setStyle(customRole === 'line' ? { line: offer } : { fill: offer });
          draw();
        });
        answer.append(b);
      }
    };
    field.addEventListener('input', read);
    const hadFocus = tray.contains(document.activeElement) && isField(document.activeElement);
    tray.replaceChildren(wells('line', TRAY_LINE, style.line), wells('fill', TRAY_FILL, style.fill), weight, custom, answer);
    read();
    if (hadFocus) {
      field.focus();
      field.setSelectionRange(hexText.length, hexText.length);
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
    const line = said ? h('span', 'bd-said', { role: 'status', title: said }, said) : null;
    foot.replaceChildren(...kids, ...(line ? [line] : []));
    // hands that do not fit become '+<k> more', with every hand in title=; 'you' is always first and always shown
    const all = kids.map((k) => (k.textContent ?? '').trim()).join(' · ');
    let cut = 0;
    while (foot.scrollWidth > foot.clientWidth && kids.length - cut > 1) {
      cut++;
      foot.replaceChildren(...kids.slice(0, kids.length - cut), h('span', 'bd-hand bd-more-hands', { title: all }, `+${cut} more`), ...(line ? [line] : []));
    }
  }
  function say(text: string): void {
    said = text;
    clearTimeout(saidTimer);
    saidTimer = setTimeout(() => {
      said = '';
      drawFoot();
    }, 6000);
    drawFoot();
  }

  function draw(): void {
    const state = leafState();
    el.classList.toggle('too-short', state === 'too-short');
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
  }

  // ── loading the engine ───────────────────────────────────────────────────
  function fail(error: unknown, afterMount: boolean): void {
    cause = failedCause(error, afterMount);
    load = 'failed';
    trayOpen = false;
    draw();
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
    o.load()
      .then((m) => m.mountBoard(boardHost, { theme, onError: (err) => mine === generation && fail(err, true) }))
      .then(
        (hd) => {
          if (mine !== generation) return hd.unmount();
          handle = hd;
          load = 'ready';
          offs.push(hd.onState(() => draw()), hd.onScene(() => (drawOver(), drawFoot())), hd.onRefused(() => say(LEAF_COPY.imageRefused)));
          o.onReady?.(hd);
          draw();
          if (!o.cardFocused()) hd.focus(); // opening moves focus to the board, unless a card has the keys
        },
        (err: unknown) => mine === generation && fail(err, false),
      );
  }

  // ── keys and presses ─────────────────────────────────────────────────────
  const onKey = (e: KeyboardEvent): void => {
    const active = document.activeElement;
    const s = st();
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
  const onWake = (e: PointerEvent): void => {
    if (!yielded()) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.isTrusted) handle?.focus();
  };
  stage.addEventListener('pointerdown', onWake, true);
  headKey.addEventListener('click', () => load === 'failed' && start());
  escKey.addEventListener('click', () => o.onFold?.());
  const onFocus = (): void => draw();
  document.addEventListener('focusin', onFocus);
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
      document.removeEventListener('focusin', onFocus);
      ro?.disconnect();
      handle?.unmount();
      el.remove();
    },
  };
}

/** Under this much board height the leaf keeps its head and one line (re-exported for the fixtures). */
export { BOARD_MIN_HEIGHT };
