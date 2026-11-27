/**
 * @symbol #gui-board-turn
 *
 * The turn strip under an open board, drawn (boards S1.3 pass P4b-2 item 1; design component
 * board-leaf.turn_strip; specimen-board.html#turn-strip). The rows come from core/board-turn.ts; this module draws
 * them and measures the turn row's fit.
 *
 * RULES.
 *  - Text nodes only, through core/render.ts h() (THE display sanitizer: a planted U+202E shows as ⟨RLO⟩). No
 *    markdown, no `title=` on the person's or the model's words; the message and the reply are dir=auto isolates.
 *  - The strip is outside `.bd-host` and outside `.feed`: never inert, never a live region (#turn-say stays the one).
 *    Nothing in it is a drop source for the board: its text reaches a board only by the person's own paste.
 *  - Its keys press on a trusted event only (the dock checks: showChat). The working key has no caret and no
 *    aria-expanded: it never unfolds here; its name says its steps open in the chat (Mika 3).
 *  - A tight turn row drops by core order (reply, name, more), measured on the strip's own paint
 *    (line.scrollWidth > clientWidth), never by a viewport query.
 */
import { TURN_COPY, turnStripRows, withSlot, type LatestTurn, type TurnPart, type TurnStripRow } from '../core/board-turn.js';
import { UNDO_COPY } from '../core/board-leaf.js';
import type { NoticeStrip } from './board-dock.js';
import { workParts } from '../core/live-turn.js';
import { displayText, h, type MiniDoc, type MiniEl } from '../core/render.js';
import type { FoldedItem } from '../core/store.js';

/** A reply cut narrower than this is no reply (the row drops it): about four characters at 11.5px. */
const REPLY_MIN_PX = 28;

function partEl(doc: MiniDoc, p: TurnPart, turn: boolean): MiniEl {
  const drop: Record<string, string> | null = p.drop !== undefined ? { 'data-drop': String(p.drop) } : p.only !== undefined ? { 'data-only': String(p.only) } : null;
  if (p.cls === 'tail') {
    const sub = p.sub ? h(doc, 'span', { class: 'tsub', 'data-drop': String(p.sub.drop) }, p.sub.text) : null;
    const tail = h(doc, 'span', { class: `tail ${p.tone ?? 'quiet'}${p.first ? ' first' : ''}`, ...drop }, h(doc, 'span', { class: 'tsep' }, TURN_COPY.sep), ...(sub && p.sub!.lead ? [sub] : []), p.text, ...(sub && !p.sub!.lead ? [sub] : []));
    // Aegis I3: an end reason the labels do not know carries its words from the run: an isolate too
    if (p.bidi) tail.setAttribute('dir', 'auto');
    return tail;
  }
  const el = h(doc, 'span', { class: `${p.cls}${turn && p.cls === 'sep' && p.drop === 1 ? ' who-sep' : ''}`, ...drop }, p.text);
  // dir=auto: an isolate, so an RTL message keeps its first words and a reply's direction cannot leak (Mika 2)
  if (p.bidi) el.setAttribute('dir', 'auto');
  return el;
}

/** The strip's working key: the chat's key, without the caret and aria-expanded (it never unfolds here). */
export function stripWorkingEl(doc: MiniDoc, it: FoldedItem, now: number): MiniEl {
  const w = it.live ? workParts(it.live, now) : { label: 'working…', clock: '', aria: 'working' };
  const key = h(doc, 'div', { class: 'work-key', role: 'button', tabindex: '0', 'aria-label': TURN_COPY.workName(w.label), title: w.label, 'data-strip-work': it.key }, h(doc, 'span', { class: 'spin', 'aria-hidden': 'true' }), h(doc, 'span', { class: 'work-label' }, w.label), h(doc, 'span', { class: 'live-clock' }, w.clock));
  return h(doc, 'div', { class: 'trow role-working' }, key);
}

/** One row of the strip, without show chat (the mount keeps that key, so its focus survives a repaint). */
export function renderTurnRow(doc: MiniDoc, row: TurnStripRow, now: number): MiniEl {
  if (row.kind === 'you') return h(doc, 'div', { class: 'bd-turn-r bd-turn-you' }, ...row.parts.map((p) => partEl(doc, p, false)));
  const line = h(doc, 'div', { class: 'bd-turn-line' }, ...(row.working ? [stripWorkingEl(doc, row.working, now)] : row.parts.map((p) => partEl(doc, p, true))));
  // S1.4 E3: notice and mark rows are not live regions (#turn-say and the leaf's status line speak)
  if (row.kind === 'notice' || row.kind === 'mark') return h(doc, 'div', { class: `bd-turn-r bd-turn-${row.kind}${row.done ? ' done' : ''}` }, line);
  return h(doc, 'div', { class: `bd-turn-r bd-turn-turn${row.refused ? ' refused' : ''}` }, line);
}

/**
 * What a repaint compares: the rows, and of the working key its item and what it names now (`live.now`), so a new
 * step repaints at once (keyed on the item alone, the key named the step before for up to a tick).
 */
export function stripSig(rows: readonly TurnStripRow[]): string {
  return JSON.stringify(rows.map((r) => ({ ...r, working: r.working ? { key: r.working.key, now: r.working.live?.now?.label ?? null, since: r.working.live?.now?.since ?? null } : null })));
}

export interface BoardTurnView {
  /** the board is open: the strip shows (and never hides while it is) */
  open: boolean;
  turn: LatestTurn;
  agent: 'Claude' | 'local model';
  /** the board's room in px measured WITHOUT the strip */
  room: () => number;
  /** the board is held still with words or unsaved changes: show chat does not fold, and its title says why */
  kept: boolean;
  /** S1.4 E3: the open board's standing notices (the slot's row and the +k menu's rows) */
  notices?: NoticeStrip | null;
}

/** S1.4 E3 (undo-key aegis U1): a key takes presses only this long after it, or its row's words, were last drawn. */
export const UNDO_ARM_MS = 500;
/** S1.4 E3 (undo-key pending): the working look only once the answer is slow. */
export const UNDO_QUIET_MS = 300;
type NoticeWhat = 'undo' | 'redo' | 'dismiss' | 'bring';
const WORD_WHAT: Readonly<Record<string, NoticeWhat>> = { undo: 'undo', redo: 'redo', 'put back': 'undo', dismiss: 'dismiss' };

export interface BoardTurnStrip {
  paint(v: BoardTurnView): void;
  /** the running turn's words and clock (the page's one ticker) */
  tick(now: number): void;
  /** true while the strip shows a running turn's key (the ticker must run) */
  live(): boolean;
}

export function mountBoardTurn(o: { el: HTMLElement; onShowChat: (e: Event) => void; onWorkKey: (e: Event, itemKey: string) => void; onNoticeKey?: (what: NoticeWhat, target: { key: string; rev: number; id?: string; own?: boolean }, e: Event) => void; onFreeze?: (on: boolean) => void; onFocusBoard?: () => void; onTrace?: (key: string | null) => void; now?: () => number; menuRoom?: () => { top: number; bottom: number; left?: number } | null }): BoardTurnStrip {
  const doc = document as unknown as MiniDoc;
  const el = o.el;
  const show = document.createElement('button');
  show.type = 'button';
  show.className = 'key quiet bd-turn-key';
  show.textContent = TURN_COPY.showChat;
  show.title = TURN_COPY.showChatTitle;
  show.addEventListener('click', (e) => o.onShowChat(e));
  let sig = '';
  let working: FoldedItem | null = null;
  const now = o.now ?? (() => performance.now());

  // ── S1.4 E3: the notice and mark rows' keys ────────────────────────────────
  /** when each key (by what, target and word) was last drawn: a press inside UNDO_ARM_MS is dropped (U1) */
  const armed = new Map<string, number>();
  let targets = new Map<string, { key: string; rev: number; id?: string; own?: boolean }>();
  let menuOpen = false;
  let hover = false;
  let focusIn = false;
  let frozen = false;
  let lastNotices: NoticeStrip | null = null;
  /** Mika E3 C2: the next paint focuses the slot's undo key (a notice was brought from the menu) */
  let focusSlotUndo = false;
  /** true while paint rebuilds the rows and puts focus back */
  let rebuilding = false;
  /** Mika E3 C4: the key the person pressed (its row and column): aria-busy, and the working mark after 300 ms */
  let pressed: { id: string; key: string; col: string } | null = null;
  const colOf = (k: HTMLElement): string => (k.closest('.bd-undo-menu') ? 'menu-' : '') + ([...(k.closest('.bd-col')?.classList ?? [])].find((c) => c !== 'bd-col') ?? '');
  /** a key in the row of set `key`, in column `col` (the slot's or the menu's row) */
  const keyAt = (key: string, col: string): HTMLElement | null => {
    for (const k of el.querySelectorAll<HTMLElement>('[data-undo-key]')) if (targets.get(k.dataset.undoKey!)?.key === key && colOf(k) === col) return k;
    return null;
  };
  const freeze = (): void => {
    const on = hover || focusIn || menuOpen;
    if (on === frozen) return;
    frozen = on;
    o.onFreeze?.(on);
  };
  el.addEventListener('pointerenter', () => ((hover = true), freeze()));
  // board-trace: pointing at or focusing a notice (or a +k menu row) traces that turn's marks
  let traced: string | null = null;
  const trace = (e: Event): void => {
    const row = (e.target as HTMLElement | null)?.closest?.('[data-notice]') as HTMLElement | null;
    const key = row?.dataset.notice ?? null;
    if (key === traced) return;
    traced = key;
    o.onTrace?.(key);
  };
  el.addEventListener('pointerover', trace);
  el.addEventListener('focusin', trace);
  el.addEventListener('pointerleave', () => traced !== null && ((traced = null), o.onTrace?.(null)));
  el.addEventListener('pointerleave', () => ((hover = false), freeze()));
  el.addEventListener('focusin', () => ((focusIn = true), freeze()));
  el.addEventListener('focusout', (e) => {
    // (a repaint rebuilds the rows: the focused key it removes is not focus leaving; paint settles focusIn after)
    if (rebuilding) return;
    if (e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return;
    focusIn = false;
    // Mika E3 D2: the trace ends with the focus (a pointer still over a row keeps its own)
    if (traced !== null && !hover) (traced = null), o.onTrace?.(null);
    // Mika E3 C1: focus left the strip and its menu: the menu closes where it is (the U2 freeze then ends)
    closeMenu(false);
    freeze();
  });
  // Mika E3 C1: a press outside the strip and its menu closes the menu, focus left where the press put it
  document.addEventListener('pointerdown', (e) => {
    if (menuOpen && !(e.target instanceof Node && el.contains(e.target))) closeMenu(false);
  }, true);
  const keyEl = (what: string, word: string, target: { key: string; rev: number; id?: string; own?: boolean }, aria: string | undefined, title?: string): HTMLElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'key quiet bd-undo-key';
    b.textContent = word;
    const id = `${what}|${target.key}|${target.id ?? ''}|${target.rev}|${word}`;
    b.dataset.undoKey = id;
    if (aria) b.setAttribute('aria-label', aria);
    if (title) b.title = title;
    if (!armed.has(id)) armed.set(id, now());
    targets.set(id, target);
    return b;
  };
  const col = (cls: string, kid: HTMLElement | null): HTMLElement => {
    const c = document.createElement('span');
    c.className = `bd-col ${cls}`;
    if (kid) c.appendChild(kid);
    return c;
  };
  /** a notice or mark row: the words, then the three fixed columns from the right (+k, undo, right) */
  function slotRow(row: TurnStripRow): HTMLElement {
    const r = renderTurnRow(doc, row, Date.now()) as unknown as HTMLElement;
    if (row.title) r.title = row.title;
    r.dataset.notice = row.target!.key;
    const t = row.target!;
    const k = row.keys!;
    const keys = document.createElement('span');
    keys.className = 'bd-turn-keys';
    if (row.kind === 'notice') {
      const more = k.more > 0 ? keyEl('more', `+${k.more} ▾`, t, row.aria?.more, row.aria?.more) : null;
      if (more) {
        more.setAttribute('aria-expanded', String(menuOpen));
        more.setAttribute('aria-controls', 'bd-undo-menu');
      }
      keys.appendChild(col('bd-more-col', more));
    }
    keys.appendChild(col('bd-undo-col', k.undo ? keyEl(k.undo, k.undo, t, row.aria?.undo) : null));
    keys.appendChild(col('bd-right-col', k.right ? keyEl(k.right, k.right, t, row.aria?.right, k.right === 'dismiss' ? UNDO_COPY.dismissTitle : undefined) : null));
    r.appendChild(keys);
    return r;
  }
  /** the +k menu (one menu component, .bd-menu, upward over the board): one row per notice behind, each with its own undo */
  function menuEl(rows: readonly TurnStripRow[]): HTMLElement {
    const m = document.createElement('div');
    m.className = 'bd-menu bd-undo-menu';
    // Mika E3 C2: a list of rows, each with its own key: no menu role (its keys are Tab stops), +k keeps aria-expanded
    m.id = 'bd-undo-menu';
    for (const row of rows) {
      const line = document.createElement('div');
      line.className = 'bd-menu-row';
      line.dataset.notice = row.target!.key;
      const words = document.createElement('button');
      words.type = 'button';
      words.className = 'bd-menu-words';
      words.textContent = row.title ?? '';
      words.title = row.title ?? '';
      const id = `bring|${row.target!.key}|${row.target!.rev}`;
      words.dataset.undoKey = id;
      if (!armed.has(id)) armed.set(id, now());
      targets.set(id, row.target!);
      line.append(words, col('bd-undo-col', keyEl('undo', UNDO_COPY.undo, row.target!, row.aria?.undo)));
      m.appendChild(line);
    }
    return m;
  }
  /**
   * Mika E3 B3 (the orchestrator's ruling: the menu never covers the foot): the menu goes right after the +k key in
   * the DOM (C2), its right edge on the key (more_menu.key), its bottom above the room the page gives (the hands
   * foot's top), its height capped to that room with the rows scrolling inside.
   */
  const placeMenu = (m: HTMLElement): void => {
    const key = el.querySelector<HTMLElement>('[data-undo-key^="more|"]');
    if (!key) return;
    key.after(m);
    const strip = el.getBoundingClientRect();
    const k = key.getBoundingClientRect();
    const room = o.menuRoom?.() ?? null;
    const bottom = Math.min(room?.bottom ?? strip.top, strip.top) - 4;
    const top = (room?.top ?? 0) + 4;
    m.style.right = `${Math.max(0, strip.right - k.right)}px`;
    m.style.bottom = `${strip.bottom - bottom}px`;
    m.style.maxHeight = `${Math.max(0, bottom - top)}px`;
    // inside the leaf: a menu wider than the room left of its key has its rows' words cut (whole in title=)
    m.style.maxWidth = `${Math.max(0, k.right - Math.max(room?.left ?? strip.left, strip.left) - 4)}px`;
  };
  const closeMenu = (back: boolean): void => {
    if (!menuOpen) return;
    menuOpen = false;
    el.querySelector('.bd-undo-menu')?.remove();
    el.querySelector('[data-undo-key^="more|"]')?.setAttribute('aria-expanded', 'false');
    if (back) el.querySelector<HTMLElement>('[data-undo-key^="more|"]')?.focus({ preventScroll: true });
    freeze();
  };
  const disabled = (): boolean => {
    const n = lastNotices;
    if (!n) return true;
    return n.held !== null || n.pending !== null;
  };
  el.addEventListener('click', (e) => {
    const k = (e.target as HTMLElement | null)?.closest?.('[data-undo-key]') as HTMLElement | null;
    if (!k) return;
    const id = k.dataset.undoKey ?? '';
    const what = id.split('|')[0]!;
    // a trusted press only; never the second press of a double click; never within UNDO_ARM_MS of being drawn (U1)
    if (!e.isTrusted || e.detail > 1 || now() - (armed.get(id) ?? Infinity) < UNDO_ARM_MS) return;
    if (what === 'more') {
      if (menuOpen) return closeMenu(true);
      menuOpen = true;
      freeze();
      k.setAttribute('aria-expanded', 'true');
      placeMenu(menuEl((lastNotices?.behind ?? []) as TurnStripRow[]));
      return;
    }
    // dropped while pending, held or link-down: never queued, never replayed
    if (disabled()) return;
    const target = targets.get(id);
    if (!target) return;
    const act: NoticeWhat = what === 'bring' ? 'bring' : (WORD_WHAT[id.split('|').at(-1)!] ?? 'undo');
    // Mika E3 C2: a notice brought from the menu takes the slot, and focus goes to the slot's undo key
    // (focus moves to the slot's key BEFORE the menu goes: a removed focused row would drop focus to the body and end
    // the U2 freeze, which gives the slot back to the newest before the brought notice is drawn)
    if (act === 'bring') {
      focusSlotUndo = true;
      el.querySelector<HTMLElement>('.bd-turn-notice > .bd-turn-keys > .bd-undo-col > [data-undo-key]')?.focus({ preventScroll: true });
      closeMenu(false);
    }
    else pressed = { id, key: target.key, col: colOf(k) };
    o.onNoticeKey?.(act, target, e);
  });
  // Mika E3 B2: a HELD Enter or Space never presses again (the key under it may be redo by then)
  el.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.repeat && (e.target as HTMLElement | null)?.closest?.('[data-undo-key]')) e.preventDefault();
  });
  el.addEventListener('keydown', (e) => {
    if (!menuOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(true);
    } else if (e.key === 'ArrowDown' && (e.target as HTMLElement | null)?.closest?.('[data-undo-key^="more|"]')) {
      e.preventDefault();
      el.querySelector<HTMLElement>('.bd-undo-menu .bd-menu-words')?.focus();
    }
  });

  const pressWork = (e: Event): void => {
    const k = (e.target as HTMLElement | null)?.closest?.('[data-strip-work]') as HTMLElement | null;
    if (k) o.onWorkKey(e, k.dataset.stripWork ?? '');
  };
  el.addEventListener('click', pressWork);
  el.addEventListener('keydown', (e) => {
    if ((e.key !== 'Enter' && e.key !== ' ') || e.repeat || !(e.target as HTMLElement | null)?.closest?.('[data-strip-work]')) return;
    e.preventDefault();
    pressWork(e);
  });

  /** a notice or mark row drops by core order (the time, then ' of your marks'), and last becomes two lines (R5) */
  function fitSlot(row: HTMLElement): void {
    row.classList.remove('tight-1', 'tight-2', 'tight-3', 'tight-4', 'two-line');
    const line = row.querySelector<HTMLElement>('.bd-turn-line');
    if (!line) return;
    const over = (): boolean => line.scrollWidth > line.clientWidth + 0.5;
    for (const level of [1, 2, 3, 4] as const) {
      if (!over()) return;
      row.classList.add(`tight-${level}`);
    }
    if (over()) row.classList.add('two-line');
  }

  /** the turn row drops by core order until it fits: reply (when it overflows or is cut to nothing), name, more */
  function fit(row: HTMLElement): void {
    row.classList.remove('tight-1', 'tight-2', 'tight-3', 'tight-4', 'tight-5', 'tight-6');
    const line = row.querySelector<HTMLElement>('.bd-turn-line');
    if (!line || !row.querySelector('[data-drop]')) return;
    const said = line.querySelector<HTMLElement>('.said[data-drop]');
    const over = (): boolean => line.scrollWidth > line.clientWidth + 0.5;
    const starved = (): boolean => !!said && said.offsetParent !== null && said.scrollWidth > said.clientWidth + 0.5 && said.clientWidth < REPLY_MIN_PX;
    row.classList.remove('tight-6');
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      if (!over() && !(level === 1 && starved())) return;
      row.classList.add(`tight-${level}`);
    }
  }

  return {
    paint(v) {
      if (!v.open) {
        el.hidden = true;
        working = null;
        return;
      }
      // the room is read BEFORE the strip shows: while it is hidden the board has all of it (measured without the strip)
      const room = v.room();
      el.hidden = false;
      show.title = v.kept ? TURN_COPY.keptTitle : TURN_COPY.showChatTitle;
      lastNotices = v.notices ?? null;
      // S1.4 E3: a standing notice takes the you row's slot (and the strip is two rows while it stands)
      const rows = withSlot(turnStripRows(v.turn, v.agent, room), v.notices?.slot ?? null);
      working = rows.find((r) => r.working)?.working ?? null;
      // (Aegis E3 N-3: R3's own-turn key is in the signature: its coming or going repaints)
      const next = stripSig(rows) + JSON.stringify(v.notices?.behind.map((r) => r.target) ?? []) + JSON.stringify(v.notices?.own ?? null);
      if (next !== sig) {
        sig = next;
        const had = document.activeElement;
        // a focused key whose row leaves: focus goes to the board, never to another key (undo-key press 4)
        const hadKey = had instanceof HTMLElement && el.contains(had) ? (had.dataset.undoKey ?? null) : null;
        // Mika E3 B2: the focused key's row and column, so undo's key becoming redo keeps the focus
        const hadAt = hadKey !== null && targets.has(hadKey) ? { key: targets.get(hadKey)!.key, col: colOf(had as HTMLElement) } : null;
        targets = new Map();
        if (menuOpen && !(v.notices?.behind.length ?? 0)) closeMenu(false);
        const hadWork = had instanceof HTMLElement && el.contains(had) ? (had.dataset.stripWork ?? null) : null;
        const hadShow = had === show;
        rebuilding = true;
        while (el.firstChild) el.removeChild(el.firstChild);
        for (const r of rows) el.appendChild(r.kind === 'notice' || r.kind === 'mark' ? slotRow(r) : (renderTurnRow(doc, r, Date.now()) as unknown as Node));
        if (menuOpen && v.notices) placeMenu(menuEl(v.notices.behind));
        // keys no longer drawn forget their arming (a key drawn again is armed afresh)
        const live = new Set([...el.querySelectorAll<HTMLElement>('[data-undo-key]')].map((k) => k.dataset.undoKey!));
        for (const id of [...armed.keys()]) if (!live.has(id)) armed.delete(id);
        if (focusSlotUndo) {
          focusSlotUndo = false;
          const u = el.querySelector<HTMLElement>('.bd-turn-notice > .bd-turn-keys > .bd-undo-col > [data-undo-key]');
          if (u) u.focus({ preventScroll: true });
        } else if (hadKey !== null) {
          // the same key; else the same row's key in the same column (undo became redo: armed afresh, U1); else the board
          const again = el.querySelector<HTMLElement>(`[data-undo-key="${CSS.escape(hadKey)}"]`) ?? (hadAt ? keyAt(hadAt.key, hadAt.col) : null);
          if (again) again.focus({ preventScroll: true });
          else o.onFocusBoard?.();
        }
        el.querySelector('.bd-turn-turn')?.appendChild(show);
        // R3: this session's own ended turn has its undo in the UNDO column left of show chat, only while the slot
        // shows the you row (the dock passes it only then); the sixth drop level takes it away, show chat stays
        const own = v.notices?.own;
        if (own) show.before(col('bd-undo-col', keyEl('undo', UNDO_COPY.undo, { key: own.key, rev: own.rev, own: true }, `Undo ${v.agent}’s last turn on this board`)));
        // a repaint keeps a focused working key focused (its row was rebuilt)
        if (hadWork !== null) el.querySelector<HTMLElement>(`[data-strip-work="${CSS.escape(hadWork)}"]`)?.focus({ preventScroll: true });
        // Aegis L3: show chat is moved into the rebuilt row, which detaches it: its focus comes back with it
        if (hadShow && document.activeElement !== show) show.focus({ preventScroll: true });
        rebuilding = false;
        if (focusIn && !el.contains(document.activeElement)) {
          focusIn = false;
          if (traced !== null && !hover) (traced = null), o.onTrace?.(null);
          closeMenu(false);
          freeze();
        }
      }
      const turn = el.querySelector<HTMLElement>('.bd-turn-turn');
      if (turn) fit(turn);
      // S1.4 E3: every undo-family key disabled while one is pending past 300 ms or the board is held
      const n = v.notices;
      const slow = !!n && n.pending !== null && Date.now() - n.pending.since >= UNDO_QUIET_MS;
      const off = !!n && (n.held !== null || slow);
      if (!n?.pending) pressed = null;
      // Mika E3 C4 (undo-key.state-notes.pending): the pressed key, or its row's key in its column, is busy at once
      // and shows the working mark before its words once the answer is slow
      const busy = pressed ? (el.querySelector<HTMLElement>(`[data-undo-key="${CSS.escape(pressed.id)}"]`) ?? keyAt(pressed.key, pressed.col)) : null;
      // Mika E3 C5, Aegis N-5: a held key's title and description name the real hold, and give back its own after
      const heldWords = n?.held === 'link-down' ? UNDO_COPY.linkDown : n?.held === 'catching-up' ? UNDO_COPY.catchingUp : n?.held === 'out-of-date' ? UNDO_COPY.outOfDate : null;
      for (const k of el.querySelectorAll<HTMLElement>('[data-undo-key]')) {
        if (k.dataset.undoKey!.startsWith('more|') || k.dataset.undoKey!.startsWith('bring|')) continue;
        if (off) k.setAttribute('aria-disabled', 'true');
        else k.removeAttribute('aria-disabled');
        if (k === busy) k.setAttribute('aria-busy', 'true');
        else k.removeAttribute('aria-busy');
        k.classList.toggle('working', k === busy && slow);
        if (k === busy && slow && !k.querySelector('.spin')) k.prepend(h(doc, 'span', { class: 'spin', 'aria-hidden': 'true' }) as unknown as Node);
        else if (!(k === busy && slow)) k.querySelector('.spin')?.remove();
        if (heldWords !== null) {
          if (k.dataset.ownTitle === undefined) k.dataset.ownTitle = k.getAttribute('title') ?? '';
          k.title = heldWords;
          k.setAttribute('aria-description', heldWords);
        } else if (k.dataset.ownTitle !== undefined) {
          if (k.dataset.ownTitle) k.title = k.dataset.ownTitle;
          else k.removeAttribute('title');
          delete k.dataset.ownTitle;
          k.removeAttribute('aria-description');
        }
      }
      for (const r of el.querySelectorAll<HTMLElement>('.bd-turn-notice, .bd-turn-mark')) fitSlot(r);
    },
    tick(now) {
      if (!working?.live) return;
      const w = workParts(working.live, now);
      const key = el.querySelector<HTMLElement>('[data-strip-work]');
      if (!key) return;
      const lb = key.querySelector('.work-label');
      const c = key.querySelector('.live-clock');
      // the same text path as h(): THE display sanitizer, a text node's content
      if (lb) lb.textContent = displayText(w.label);
      if (c) c.textContent = displayText(w.clock);
      if (key.title !== displayText(w.label)) key.title = displayText(w.label);
      key.setAttribute('aria-label', displayText(TURN_COPY.workName(w.label)));
    },
    live: () => !!working?.live,
  };
}

