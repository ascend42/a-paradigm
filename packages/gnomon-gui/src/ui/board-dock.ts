/**
 * @symbol #gui-board-dock
 *
 * Where the board leaf lives in the app (boards S1.3 pass P4b-1; draft point 7; design component board-leaf). The
 * dock owns the leaf's place over the centre column (the chat header and the chat; it stops above the pinned cards
 * and the composer), the edge tab `<title> · board`, and the ONE leaf of the focused session's open dimension. It
 * carries out the plans of core/board-open.ts on the trusted event that asked, through `DimSessions` (the one
 * sender), and says the session's notices in the leaf's own words.
 *
 * RULES.
 *  - A board opens ONLY on its own trusted event, and that event is the one handed to `sessions.open`.
 *  - One leaf. A session switch `leave()`s the open dimension and says what was lost; a rebuilt session (the link
 *    came back) gets a new leaf.
 *  - Held still (the link is down; the fold is out of date) the leaf still FOLDS: nothing can be sent, so the fold
 *    is the page's own and the dimension is not closed in the log.
 *  - Words being typed when the link goes are held in page memory only (Aegis, option b): cleaned and bounded by
 *    the leaf, kept per dimension and principal, put back only into a text the person opens on the rebuilt board,
 *    and dropped on a reset, a switch, a fold, a hash mismatch or a principal change. Never committed here.
 *  - No sizes in markup: the host's height and the tab's top are CSSOM properties.
 */
import type { BoardModule, BoardTheme } from '../core/board.js';
import { checkLine, checkTone, KEEP_COPY, keepStateLine, linkDownLine, noticeLine, tabTitle } from '../core/board-leaf.js';
import { dimensionRows, listingsFor, openedHowOf, planBoardCommand, planBoardKey, planBoardMenu, planBoardRow, type BoardAsk, type BoardOpenedHow, type BoardPlan, type DimensionRow } from '../core/board-open.js';
import { mintDimNodeId, type DimSession, type DimSessionNotice, type DimSessions, type DimSessionStatus } from '../core/dim-session.js';
import { mountBoardLeaf, type BoardLeaf } from './board-leaf.js';

export interface BoardDockDeps {
  /** the centre column (`#pane-transcript`) and the chat inside it (`.feed`): the leaf covers from the pane's top to the feed's bottom */
  pane: HTMLElement;
  feed: HTMLElement;
  sessions: DimSessions;
  /** the lazy loader of core/board.ts */
  load: () => Promise<BoardModule>;
  theme: () => BoardTheme;
  cardFocused: () => boolean;
  /** the focused session, or null */
  focused: () => string | null;
  /** how the leaf names a session: its name, its project and the project's hue class */
  sessionInfo: (hsid: string) => { name: string; fullName: string; project: string; hue: string; repo: string | null };
  /** the connection's principal now, or null while the link is down */
  principal: () => string | null;
  /** a line away from the leaf (the app's toast) */
  say: (text: string, kind: 'info' | 'warn' | 'fail') => void;
  /**
   * True while the page is reconnecting by itself (a restart it waits for); false when nothing is coming (the kernel
   * stopped, the session ended: the Reconnect dialog is up). The held-still line says which, so the leaf never
   * promises a reconnect the dialog does not.
   */
  reconnecting?: () => boolean;
  /** where focus goes when the leaf folds and what opened it is gone (the composer) */
  fallbackFocus: () => HTMLElement | null;
  /**
   * The leaf head's `Dimensions ▾` key: open this project's Dimensions list, the same one `/boards` opens. Called
   * only for a trusted press (the list is opened only on its own trusted event, Aegis final).
   */
  dimensions?: (event: Event) => void;
  /** #gui-board-turn: paint the turn strip again (the board opened or folded, the pane changed size) */
  turn?: () => void;
  now?: () => number;
}

export interface BoardDock {
  /** `/board` and `/board <title>`, on the key that ran it (`typed`: the send key's click on a typed command) */
  command(arg: string, event: Event, typed?: boolean): void;
  /** the ⋯ menu's "Open board" row and the edge tab */
  menu(event: Event): void;
  /** ⌥B: folds the open board, or reopens the one this session has. True when it did either. */
  key(event: Event): boolean;
  /** the Dimensions list's rows for the focused session's repo */
  rows(): DimensionRow[];
  /** a press on a row of the Dimensions list */
  choose(dim: string, event: Event): void;
  /** Esc from outside the leaf: folds an open board, or says the held line of one it must not fold. True when one was open. */
  escape(event: Event): boolean;
  /**
   * #gui-board-turn: show chat (and the strip's working key). A trusted press folds the board as Esc does, then runs
   * `then` once the leaf is gone (the page puts focus in the chat). On a board held still with words or unsaved
   * changes it does not fold: the leaf says its held line again. Untrusted: nothing, said or done.
   */
  showChat(event: Event, then: () => void): void;
  /** true while the open board is held still with words or unsaved changes (show chat's title says it is kept open) */
  kept(): boolean;
  /** the app focused another session (or none) */
  sessionChanged(): void;
  /** rows were applied, the link changed: the tab and the menu row are drawn again */
  repaint(): void;
  /** true when the focused session has a board to reopen or one open */
  hasBoard(): boolean;
  isOpen(): boolean;
  /** True while a text is being typed on the board, and then SAYS that a card waits: the caller's programmatic card focus does not run (G-DDL-08; Aegis L5: never silently). */
  cardBlocked(): boolean;
  /** true while a text is being typed on the open board (no programmatic card focus runs then, G-DDL-08) */
  editingText(): boolean;
  setTheme(theme: BoardTheme): void;
  /** the open leaf and its session (tests and the app's layout checks) */
  current(): { leaf: BoardLeaf; session: DimSession } | null;
}

const two = (n: number): string => String(n).padStart(2, '0');

export function mountBoardDock(d: BoardDockDeps): BoardDock {
  const now = d.now ?? (() => Date.now());
  const host = document.createElement('div');
  host.className = 'bd-host';
  host.hidden = true;
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = 'lp-edgetab bd-edgetab';
  tab.hidden = true;
  // BEFORE the pinned cards and the composer in the document, so in the focus order (it is placed by CSS)
  d.feed.after(host, tab);
  /**
   * what lies UNDER an open leaf (the chat header's keys, the conversation, the Loops edge tab: it sits over the leaf's
   * edge and comes after the composer in the document): out of the focus order while it is open
   */
  const under = (): HTMLElement[] => [...d.pane.querySelectorAll<HTMLElement>(':scope > .pane-head, :scope > .feed > .viewport, :scope > .feed > .empty, :scope > .feed > .jump, :scope > .lp-edgetab:not(.bd-edgetab)')];
  const cover = (on: boolean): void => {
    for (const e of under()) e.inert = on;
  };

  let cur: { session: DimSession; leaf: BoardLeaf; off: Array<() => void>; how: BoardOpenedHow } | null = null;
  let opener: HTMLElement | null = null;
  /** #gui-board-turn: what show chat does once its fold has taken the leaf away (focus into the chat) */
  let afterShow: (() => void) | null = null;
  /** words being typed when the link went (page memory only) */
  let held: { dim: string; principal: string; words: string } | null = null;
  /** dimensions this page asked to open that were still opening when the link went: the list shows them */
  const opening = new Map<string, { title: string; titleFrom: 'session' | 'user' | null }>();
  /** dimensions the person folded on this page: reopening one is their own fold undone, and needs no line */
  const foldedHere = new Set<string>();
  const asked = new Map<string, { title: string; titleFrom: 'session' | 'user' | null; how: BoardOpenedHow }>();

  // the leaf covers the chat header and the chat, and stops above the pinned cards and the composer
  const fit = (): void => {
    if (host.hidden) return;
    host.style.height = `${Math.max(0, Math.round(d.feed.getBoundingClientRect().bottom - d.pane.getBoundingClientRect().top))}px`;
  };
  /** the turn strip is painted in the next frame, never inside the observer: its height changes the observed feed */
  let turnQueued = false;
  const turnSoon = (): void => {
    if (turnQueued || !d.turn) return;
    turnQueued = true;
    requestAnimationFrame(() => ((turnQueued = false), d.turn?.()));
  };
  const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => (fit(), placeTab(), turnSoon()));
  ro?.observe(d.pane);
  ro?.observe(d.feed);

  const store = d.sessions.store;
  const listingOf = (dim: string | null) => (dim ? (store.list().find((l) => l.dim === dim) ?? null) : null);
  const ask = (): BoardAsk => {
    const hsid = d.focused();
    const lastDim = hsid ? store.lastDimOf(hsid) : null;
    return { hsid, lastDim, last: listingOf(lastDim), sessionName: hsid ? d.sessionInfo(hsid).fullName : '', mintDim: () => `dim:${mintDimNodeId()}` };
  };

  function placeTab(): void {
    if (tab.hidden) return;
    const loops = [...d.pane.querySelectorAll<HTMLElement>('.lp-edgetab')].find((t) => t !== tab && !t.hidden);
    // under the Loops tab when it shows (8px below its bottom edge), else in its place
    tab.style.top = loops ? `${loops.offsetTop + loops.offsetHeight + 8}px` : '';
  }
  function paintTab(): void {
    const a = ask();
    const show = !cur && !!a.last;
    tab.hidden = !show;
    d.pane.classList.toggle('bd-tab-on', show);
    d.pane.classList.toggle('bd-open', !!cur);
    cover(!!cur);
    d.turn?.();
    if (show) {
      const title = a.last!.title || 'Untitled';
      tab.textContent = `${tabTitle(title)} · board`;
      tab.title = `Open the board “${title}” (⌥B)`;
      tab.setAttribute('aria-label', `${title} · board`);
      placeTab();
    }
  }

  function paint(session: DimSession, leaf: BoardLeaf, s: DimSessionStatus): void {
    const words = !!held && held.dim === session.dim;
    leaf.setTitle(s.title);
    // words that are waiting are said for AS LONG AS they are held (a six-second line was gone before it was read)
    leaf.setKeep(words && s.link === 'up' ? KEEP_COPY.wordsWait : keepStateLine(s));
    leaf.setCheck(checkLine(s), checkTone(s));
    leaf.el.dataset.words = words ? 'held' : '';
    if (s.link === 'down') leaf.setInertLine(linkDownLine(s, { unsaved: session.unsaved, words, coming: d.reconnecting?.() ?? true }));
  }
  /** held still (link down, out of date) with words or unsaved changes: Esc from outside and show chat never fold it */
  function keptOpen(): boolean {
    if (!cur) return false;
    const s = cur.session.status();
    return (s.link === 'down' || s.readOnly) && ((!!held && held.dim === cur.session.dim) || cur.session.unsaved > 0);
  }
  /** Held words are dropped: the person is told, once, wherever it happens (never a silent loss). */
  function dropWords(say = true): boolean {
    if (!held) return false;
    held = null;
    if (say) d.say(KEEP_COPY.wordsGone, 'warn');
    return true;
  }

  /** One notice of the session, said once, in the leaf's words. */
  function tell(session: DimSession, leaf: BoardLeaf, n: DimSessionNotice): void {
    if (n.about === 'link' && n.code === 'link-down') {
      // the link went: what was being typed is held in page memory (the held-still line says so while it lasts)
      const words = leaf.typed();
      const principal = heldPrincipal;
      held = words && principal ? { dim: session.dim, principal, words } : null;
      return paint(session, leaf, session.status());
    }
    if (n.about === 'open') {
      // a failed open closes its leaf (it showed a title the log never took) and says why, once, as a toast
      d.say(noticeLine(n), 'fail');
      asked.delete(session.dim);
      return drop();
    }
    if (n.code === 'hash-mismatch') dropWords();
    const mine = held && held.dim === session.dim;
    // words are waiting: the keep line says so for as long as they are (paint); never "everything here is saved"
    if (n.about === 'link' && n.code === 'reconnected' && mine) return paint(session, leaf, session.status());
    if (n.about === 'link' && n.code === 'not-saved' && mine) {
      // two things to say and one line: the count goes to the toast, the keep line says how the words come back
      d.say(noticeLine(n), 'warn');
      return paint(session, leaf, session.status());
    }
    leaf.say(noticeLine(n));
  }

  /** the principal of the connection the open session was made on (the link may be gone when its words are held) */
  let heldPrincipal: string | null = null;

  function mount(session: DimSession, o: { title: string; how: BoardOpenedHow }): void {
    if (cur && cur.session !== session) drop();
    if (cur) return;
    heldPrincipal = d.principal() ?? heldPrincipal;
    host.hidden = false;
    fit();
    const info = d.sessionInfo(session.hsid);
    const t = new Date(now());
    const leaf = mountBoardLeaf(host, {
      title: session.status().title || o.title || 'Board',
      project: info.project,
      projectHue: info.hue,
      session: info.name,
      how: o.how,
      time: `${two(t.getHours())}:${two(t.getMinutes())}`,
      theme: d.theme(),
      load: d.load,
      cardFocused: d.cardFocused,
      onFold: (cause) => void fold(cause),
      // the list opens only on the person's own press (written as every other trusted-event check here is: `!== true`)
      ...(d.dimensions
        ? {
            onDimensions: (cause: Event): void => {
              if (cause.isTrusted !== true) return;
              d.dimensions?.(cause);
            },
          }
        : {}),
      ...session.leafOptions(),
      onReady: (handle) => {
        session.attachHandle(handle);
        // opening moves focus to the board, so the letters on the empty note work at once; never off a focused card
        if (!d.cardFocused()) handle.focus();
      },
    });
    session.bindLeaf(leaf);
    const off = [
      session.onChange((c) => {
        if (!session.alive) return;
        paint(session, leaf, c.status);
        if (c.notice) tell(session, leaf, c.notice);
      }),
      // held words go back ONLY into a text the person opens on this dimension, for the same principal, link up
      leaf.onTextOpen(() => {
        requestAnimationFrame(() => {
          const s = session.alive ? session.status() : null;
          if (!held || !s || held.dim !== session.dim || held.principal !== d.principal() || s.link !== 'up' || s.readOnly) return;
          if (!leaf.putTyped(held.words)) return;
          held = null;
          paint(session, leaf, s);
          leaf.say(KEEP_COPY.wordsBack);
        });
      }),
    ];
    // words typed on while the link is down are still held (the field stays open under the reconnecting line)
    const onInput = (): void => {
      if (!session.alive || session.status().link !== 'down' || !heldPrincipal) return;
      const words = leaf.typed();
      if (words) held = { dim: session.dim, principal: heldPrincipal, words };
    };
    leaf.el.addEventListener('input', onInput, true);
    off.push(() => leaf.el.removeEventListener('input', onInput, true));
    // Mika 3 (review of PR #120): the board's own area changes size inside the leaf (its head and keep line settle,
    // the engine mounts) while the pane and the feed do not: watched too, so the strip's row count is never read
    // from a height that was stale when the board opened
    const stage = leaf.el.querySelector<HTMLElement>('.bd-stage');
    if (stage && ro) {
      ro.observe(stage);
      off.push(() => ro.unobserve(stage));
    }
    cur = { session, leaf, off, how: o.how };
    paint(session, leaf, session.status());
    // what the session was told before the leaf existed (what a reconnect lost, or that it is back)
    const told = session.lastNotice();
    if (told) tell(session, leaf, told);
    paintTab();
  }

  /** The leaf is gone (its session destroyed it, or is about to): the dock's own part. */
  function drop(): void {
    const c = cur;
    if (!c) return;
    cur = null;
    for (const f of c.off.splice(0)) f();
    if (c.session.alive) c.session.destroy('switch');
    host.hidden = true;
    paintTab();
  }

  async function fold(cause: Event): Promise<void> {
    const c = cur;
    if (!c) return;
    // a fold is the person's own press or key, held still or not (Aegis L2)
    if (cause.isTrusted !== true) return;
    const s = c.session.status();
    if (s.link === 'down' || !d.sessions.linked) {
      // nothing can be sent: the leaf folds here and the dimension stays open in the log. What goes with it is READ
      // FIRST (the destroy clears it) and said: the words being typed, and every change that was not saved (a mark
      // in flight when the link went is no longer pending, and is still lost).
      const words = !!held && held.dim === c.session.dim;
      const unsaved = c.session.unsaved;
      held = null;
      foldedHere.add(c.session.dim);
      c.session.destroy('fold');
      if (words && unsaved > 0) d.say(KEEP_COPY.wordsAndChangesGone(unsaved), 'warn');
      else if (words) d.say(KEEP_COPY.wordsGone, 'warn');
      else if (unsaved > 0) d.say(KEEP_COPY.changesGone(unsaved), 'warn');
      return;
    }
    foldedHere.add(c.session.dim);
    const closed = await c.session.fold(cause);
    // out of date and the close did not go: the person was told to fold, so the leaf folds anyway
    if (!closed && c.session.alive && c.session.status().readOnly) c.session.destroy('fold');
  }

  d.sessions.onEvent((e) => {
    if (e.type === 'rebuilt') {
      const was = cur && cur.session === e.from ? cur : null;
      const how = was?.how ?? asked.get(e.session.dim)?.how ?? 'menu';
      if (was) drop();
      // held words survive only for the same dimension and the same principal
      if (held && (held.dim !== e.session.dim || held.principal !== d.principal())) dropWords();
      if (e.session.hsid === d.focused()) mount(e.session, { title: e.session.status().title, how });
      return;
    }
    if (e.type !== 'destroyed') return;
    if (e.why !== 'link' && held && held.dim === e.session.dim) dropWords();
    if (e.why === 'link' && !e.session.openedOk) {
      // still opening when the link went: it is not resumed, though its open may have landed. The list shows it.
      const a = asked.get(e.session.dim);
      opening.set(e.session.dim, { title: a?.title ?? '', titleFrom: a?.titleFrom ?? null });
      d.say('The board was still opening when the link went · see /boards', 'warn');
    }
    if (cur && cur.session === e.session && e.why !== 'link') {
      const back = opener;
      const then = afterShow;
      opener = null;
      afterShow = null;
      drop();
      if (e.why !== 'fold') return;
      if (then) return then();
      // focus goes back to what opened the leaf ONLY when the fold took it (it was in the leaf): an Esc from the
      // composer or a press in the turn strip leaves focus where the person has it
      const a = document.activeElement;
      if (!a || a === document.body || !a.isConnected || host.contains(a)) (back && back.isConnected ? back : d.fallbackFocus())?.focus();
    } else if (cur && cur.session === e.session && !e.session.openedOk) drop();
  });

  function carry(plan: BoardPlan, event: Event, altB = false, typed = false): void {
    if (event.isTrusted !== true) return; // G-GUI-04: a board opens only on a person's own event (Aegis N2: and an untrusted one is told nothing)
    // a HELD key is one press: its repeats open, leave and drop nothing (checked before the open board is left)
    if ((event as Partial<KeyboardEvent>).repeat === true) return;
    if (plan.type === 'none') return d.say(plan.why === 'no-session' ? KEEP_COPY.noSession : KEEP_COPY.noBoard, 'info');
    const hsid = d.focused();
    if (!hsid) return;
    if (!d.sessions.linked) return d.say('The link is down · reconnect, then open the board', 'warn');
    if (cur && cur.session.dim === plan.dim) return void cur.leaf.handle()?.focus();
    if (cur) {
      // one leaf: the open dimension is left first, and what it lost is said
      const old = cur.session;
      const pending = old.pendingOps();
      drop();
      if (pending > 0) d.say(pending > 1 ? `${pending} changes on the other board weren’t saved` : 'One change on the other board wasn’t saved', 'warn');
    }
    const how = openedHowOf(event, altB, typed);
    const pend = opening.get(plan.dim);
    const fresh = plan.type === 'new' ? { title: plan.title, titleFrom: plan.titleFrom } : pend && pend.title && !store.has(plan.dim) ? { title: pend.title, titleFrom: pend.titleFrom ?? ('session' as const) } : null;
    opening.delete(plan.dim);
    asked.set(plan.dim, { title: fresh?.title ?? plan.title, titleFrom: fresh?.titleFrom ?? null, how });
    const active = document.activeElement;
    opener = active instanceof HTMLElement && active !== document.body ? active : null;
    const session = d.sessions.open({ dim: plan.dim, hsid, opened: how, ...(fresh ? { title: fresh.title, titleFrom: fresh.titleFrom } : {}) }, event);
    mount(session, { title: plan.title, how });
    if (plan.type === 'open' && plan.reopens && !foldedHere.has(plan.dim)) cur?.leaf.say(KEEP_COPY.reopens);
  }

  tab.addEventListener('click', (e) => carry(planBoardKey(ask()), e));

  return {
    command: (arg, event, typed = false) => carry(planBoardCommand(ask(), arg), event, false, typed),
    menu: (event) => carry(planBoardMenu(ask()), event),
    key(event) {
      // G-DDL-08: while a card has the keys, ⌥B changes nothing on an open board (no fold, nothing sent)
      if (cur && d.cardFocused()) return false;
      if (cur) return void fold(event), true;
      const plan = planBoardKey(ask());
      // ⌥B does nothing when the session has no board (no toast: the menu row says so)
      if (plan.type === 'none') return false;
      carry(plan, event, true);
      return true;
    },
    rows() {
      const hsid = d.focused();
      return dimensionRows(listingsFor(store.list(), hsid, hsid ? d.sessionInfo(hsid).repo : null), hsid, [...opening].map(([dim, o]) => ({ dim, title: o.title })), now());
    },
    choose(dim, event) {
      const l = listingOf(dim);
      const pend = opening.get(dim);
      const hsid = d.focused();
      if (l) return carry(planBoardRow(l, hsid), event);
      if (pend) carry(hsid ? { type: 'open', dim, attach: false, reopens: false, title: pend.title } : { type: 'none', why: 'no-session' }, event);
    },
    escape(event) {
      if (!cur || cur.leaf.el.contains(document.activeElement)) return false;
      // an untrusted Esc folds nothing and is told nothing (Aegis N2): checked BEFORE the held line is said
      if (event.isTrusted !== true) return true;
      // Esc from OUTSIDE the leaf never folds a board held still that is holding words or has unsaved changes: a
      // press on the Reconnect scrim takes focus out of the field, and the next Esc must not throw the words away
      // (Mika 1: nor is it met with silence: the leaf says its held line again, as an Esc inside it does)
      if (keptOpen()) return cur.leaf.sayHeld(), true;
      void fold(event);
      return true;
    },
    showChat(event, then) {
      // trusted first: a synthetic press neither folds nor says the held line (G-GUI-04, Aegis N2)
      if (event.isTrusted !== true || !cur) return;
      // Aegis L2: a second press while the first fold is on its way keeps the first one's focus move
      if (afterShow) return;
      if (keptOpen()) return cur.leaf.sayHeld();
      afterShow = then;
      void fold(event).finally(() => {
        // the fold did not take the leaf (a refused close): nothing waits to run on a later fold
        if (afterShow === then) afterShow = null;
      });
    },
    kept: keptOpen,
    sessionChanged() {
      const c = cur;
      if (c && c.session.hsid !== d.focused()) {
        // the leaf follows the session: this one is left (what is pending gets a moment to settle), and the loss is said
        cur = null;
        for (const f of c.off.splice(0)) f();
        host.hidden = true;
        dropWords();
        void c.session.leave().then((lost) => {
          if (lost > 0) d.say(lost > 1 ? `${lost} changes on the board weren’t saved` : 'One change on the board wasn’t saved', 'warn');
          paintTab();
        });
      }
      paintTab();
    },
    repaint: paintTab,
    hasBoard: () => !!cur || !!ask().last,
    isOpen: () => !!cur,
    cardBlocked() {
      const hd = cur?.leaf.handle();
      if (!hd || !hd.isAlive() || !hd.state().editingText) return false;
      d.say(KEEP_COPY.cardWaits, 'info');
      return true;
    },
    editingText() {
      const hd = cur?.leaf.handle();
      return !!hd && hd.isAlive() && hd.state().editingText;
    },
    setTheme: (theme) => cur?.leaf.setTheme(theme),
    current: () => (cur ? { leaf: cur.leaf, session: cur.session } : null),
  };
}
