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
import { TURN_COPY, turnStripRows, type LatestTurn, type TurnPart, type TurnStripRow } from '../core/board-turn.js';
import { workParts } from '../core/live-turn.js';
import { displayText, h, type MiniDoc, type MiniEl } from '../core/render.js';
import type { FoldedItem } from '../core/store.js';

/** A reply cut narrower than this is no reply (the row drops it): about four characters at 11.5px. */
const REPLY_MIN_PX = 28;

function partEl(doc: MiniDoc, p: TurnPart, turn: boolean): MiniEl {
  const drop = p.drop !== undefined ? { 'data-drop': String(p.drop) } : null;
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
}

export interface BoardTurnStrip {
  paint(v: BoardTurnView): void;
  /** the running turn's words and clock (the page's one ticker) */
  tick(now: number): void;
  /** true while the strip shows a running turn's key (the ticker must run) */
  live(): boolean;
}

export function mountBoardTurn(o: { el: HTMLElement; onShowChat: (e: Event) => void; onWorkKey: (e: Event, itemKey: string) => void }): BoardTurnStrip {
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
      const rows = turnStripRows(v.turn, v.agent, room);
      working = rows.find((r) => r.working)?.working ?? null;
      const next = stripSig(rows);
      if (next !== sig) {
        sig = next;
        const had = document.activeElement;
        const hadWork = had instanceof HTMLElement && el.contains(had) ? (had.dataset.stripWork ?? null) : null;
        const hadShow = had === show;
        while (el.firstChild) el.removeChild(el.firstChild);
        for (const r of rows) el.appendChild(renderTurnRow(doc, r, Date.now()) as unknown as Node);
        el.querySelector('.bd-turn-turn')?.appendChild(show);
        // a repaint keeps a focused working key focused (its row was rebuilt)
        if (hadWork !== null) el.querySelector<HTMLElement>(`[data-strip-work="${CSS.escape(hadWork)}"]`)?.focus({ preventScroll: true });
        // Aegis L3: show chat is moved into the rebuilt row, which detaches it: its focus comes back with it
        if (hadShow && document.activeElement !== show) show.focus({ preventScroll: true });
      }
      const turn = el.querySelector<HTMLElement>('.bd-turn-turn');
      if (turn) fit(turn);
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

