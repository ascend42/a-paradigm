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

export function mountBoardTurn(o: { el: HTMLElement; onShowChat: (e: Event) => void; onWorkKey: (e: Event, itemKey: string) => void; onNoticeKey?: (what: NoticeWhat, target: { key: string; rev: number; id?: string }, e: Event) => void; onFreeze?: (on: boolean) => void; onFocusBoard?: () => void; onTrace?: (key: string | null) => void; now?: () => number }): BoardTurnStrip {
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
  let targets = new Map<string, { key: string; rev: number; id?: string }>();
  let menuOpen = false;
  let hover = false;
  let focusIn = false;
  let frozen = false;
  let lastNotices: NoticeStrip | null = null;
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
    if (e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return;
    focusIn = false;
    freeze();
  });
  const keyEl = (what: string, word: string, target: { key: string; rev: number; id?: string }, aria: string | undefined, title?: string): HTMLElement => {
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
        more.setAttribute('aria-haspopup', 'menu');
        more.setAttribute('aria-expanded', String(menuOpen));
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
    m.setAttribute('role', 'menu');
    for (const row of rows) {
      const line = document.createElement('div');
      line.className = 'bd-menu-row';
      line.dataset.notice = row.target!.key;
      const words = document.createElement('button');
      words.type = 'button';
      words.className = 'bd-menu-words';
      words.setAttribute('role', 'menuitem');
      words.textContent = row.title ?? '';
      const id = `bring|${row.target!.key}|${row.target!.rev}`;
      words.dataset.undoKey = id;
      if (!armed.has(id)) armed.set(id, now());
      targets.set(id, row.target!);
      line.append(words, col('bd-undo-col', keyEl('undo', UNDO_COPY.undo, row.target!, row.aria?.undo)));
      m.appendChild(line);
    }
    return m;
  }
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
      el.appendChild(menuEl((lastNotices?.behind ?? []) as TurnStripRow[]));
      return;
    }
    // dropped while pending, held or link-down: never queued, never replayed
    if (disabled()) return;
    const target = targets.get(id);
    if (!target) return;
    const act: NoticeWhat = what === 'bring' ? 'bring' : (WORD_WHAT[id.split('|').at(-1)!] ?? 'undo');
    if (act === 'bring') closeMenu(false);
    o.onNoticeKey?.(act, target, e);
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
    row.classList.remove('tight-1', 'tight-2', 'tight-3', 'tight-4', 'tight-5');
    const line = row.querySelector<HTMLElement>('.bd-turn-line');
    if (!line || !row.querySelector('[data-drop]')) return;
    const said = line.querySelector<HTMLElement>('.said[data-drop]');
    const over = (): boolean => line.scrollWidth > line.clientWidth + 0.5;
    const starved = (): boolean => !!said && said.offsetParent !== null && said.scrollWidth > said.clientWidth + 0.5 && said.clientWidth < REPLY_MIN_PX;
    for (const level of [1, 2, 3, 4, 5] as const) {
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
      const next = stripSig(rows) + JSON.stringify(v.notices?.behind.map((r) => r.target) ?? []);
      if (next !== sig) {
        sig = next;
        const had = document.activeElement;
        // a focused key whose row leaves: focus goes to the board, never to another key (undo-key press 4)
        const hadKey = had instanceof HTMLElement && el.contains(had) ? (had.dataset.undoKey ?? null) : null;
        targets = new Map();
        if (menuOpen && !(v.notices?.behind.length ?? 0)) closeMenu(false);
        const hadWork = had instanceof HTMLElement && el.contains(had) ? (had.dataset.stripWork ?? null) : null;
        const hadShow = had === show;
        while (el.firstChild) el.removeChild(el.firstChild);
        for (const r of rows) el.appendChild(r.kind === 'notice' || r.kind === 'mark' ? slotRow(r) : (renderTurnRow(doc, r, Date.now()) as unknown as Node));
        if (menuOpen && v.notices) el.appendChild(menuEl(v.notices.behind));
        // keys no longer drawn forget their arming (a key drawn again is armed afresh)
        const live = new Set([...el.querySelectorAll<HTMLElement>('[data-undo-key]')].map((k) => k.dataset.undoKey!));
        for (const id of [...armed.keys()]) if (!live.has(id)) armed.delete(id);
        if (hadKey !== null) {
          const again = el.querySelector<HTMLElement>(`[data-undo-key="${CSS.escape(hadKey)}"]`);
          if (again) again.focus({ preventScroll: true });
          else o.onFocusBoard?.();
        }
        el.querySelector('.bd-turn-turn')?.appendChild(show);
        // a repaint keeps a focused working key focused (its row was rebuilt)
        if (hadWork !== null) el.querySelector<HTMLElement>(`[data-strip-work="${CSS.escape(hadWork)}"]`)?.focus({ preventScroll: true });
        // Aegis L3: show chat is moved into the rebuilt row, which detaches it: its focus comes back with it
        if (hadShow && document.activeElement !== show) show.focus({ preventScroll: true });
      }
      const turn = el.querySelector<HTMLElement>('.bd-turn-turn');
      if (turn) fit(turn);
      // S1.4 E3: every undo-family key disabled while one is pending past 300 ms or the board is held
      const n = v.notices;
      const off = !!n && (n.held !== null || (n.pending !== null && Date.now() - n.pending.since >= UNDO_QUIET_MS));
      for (const k of el.querySelectorAll<HTMLElement>('[data-undo-key]')) {
        if (k.dataset.undoKey!.startsWith('more|') || k.dataset.undoKey!.startsWith('bring|')) continue;
        if (off) k.setAttribute('aria-disabled', 'true');
        else k.removeAttribute('aria-disabled');
        if (n?.held) k.title = UNDO_COPY.linkDown;
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

