/**
 * @symbol #gui-toast
 *
 * The toast region's DOM (core/toasts.ts is the policy). ui/app.ts mounts it once on #toasts, the region at the chat
 * column's right edge under the chat header row, over the conversation (it never pushes it down; with a sheet open
 * it lifts to the window's top right above the scrim, styles.css). Every
 * notice that is not a kernel alert goes through show(): notice() outcomes (noticeChannel), the voice idle auto-off
 * and the voice app's notices, the update-available toast and the standing-grant offer and confirmations.
 *
 * Text is always a text node (never innerHTML). A toast may carry ONE key (Restart now, Make it standing, Re-pin):
 * the key focuses a card or files a request, it never decides a card. Fail and persistent toasts carry a 24px close
 * key; Esc inside a toast closes it, and the page's Esc closes the newest fail (dismissNewestFail).
 * Announcements go through the two live regions index.html already holds (#toast-say polite, #toast-alert
 * assertive), so nothing is announced by inserting a live region. Focus: a new toast never takes or drops focus
 * (toasts are only ever inserted at the top, never moved); when a focused toast leaves, focus goes back to where it
 * was before it entered the toast, never onto another key.
 */
import { splitToastText, toastClass, toastClosable, toastLive, toastMayClip, toastOverflow, toastTag, toastTtl, type ToastEntry, type ToastKind } from '../core/toasts.js';

const ANNOUNCE_KEEP = 5;
const ANNOUNCE_KEEP_MS = 10_000;

export interface ToastKey {
  label: string;
  /** an accessible name that says which toast's key it is (Mika C6'b2-2 #6: several toasts can be up at once) */
  ariaLabel?: string;
  title?: string;
  /** the press; the caller checks e.isTrusted before it sends anything */
  onPress: (e: MouseEvent) => void;
}

export interface ToastOptions {
  kind?: ToastKind;
  /** stays until closed or dismissed by its owner (update available, an asks-first step, the standing offer) */
  persistent?: boolean;
  key?: ToastKey;
  /** the close key's words (default "close"; the standing offer's is "Not today") */
  closeLabel?: string;
  /** called once when the person closes it (close key or Esc), not when its owner dismisses it */
  onClose?: () => void;
  /** #gui-loops (toast loop-done): the family tag in place of the kind's ("↻ loop · evening-tidy") */
  tag?: string;
  /** C6'b2-2: a variant class (toast `rule-ran`) */
  variant?: string;
}

export interface ToastHandle {
  readonly kind: ToastKind;
  /** whether it is still present (shown or waiting for a slot) */
  readonly present: boolean;
  dismiss(): void;
  /** the key element, if any (so the owner can focus it) */
  readonly keyEl: HTMLButtonElement | null;
  /**
   * C6'b2-2 (variant rule-ran): the same toast says something new (its text, announced politely; its time starts
   * again). `dropKey`: its key goes (focus on it moves to the toast text). Nothing moves, no new toast is made.
   */
  update(text: string, o?: { dropKey?: boolean }): void;
}

export interface Toasts {
  show(text: string, opts?: ToastOptions): ToastHandle;
  /** Esc: close the newest fail toast; false when there is none */
  dismissNewestFail(): boolean;
}

export interface ToastMount {
  /** the polite and assertive live regions (index.html #toast-say, #toast-alert) */
  say?: HTMLElement | null;
  alert?: HTMLElement | null;
  /** where focus goes when a focused toast leaves and its previous focus is gone */
  returnFocus?: () => HTMLElement | null;
}

interface Live extends ToastEntry {
  el: HTMLElement;
  handle: ToastHandle;
  timer: ReturnType<typeof setTimeout> | null;
  remaining: number | null;
  startedAt: number;
  hovered: boolean;
  /** where focus was before it entered this toast */
  returnTo: HTMLElement | null;
  onClose?: () => void;
}

export function mountToasts(doc: Document, region: HTMLElement, opts: ToastMount = {}): Toasts {
  const live: Live[] = []; // arrival order, oldest first
  let nextId = 1;
  /**
   * Each announcement is APPENDED to its live region as its own line (an addition is announced; replacing the text
   * would lose the first of two quick toasts), and the line is pruned after ANNOUNCE_KEEP_MS (at most 5 kept).
   */
  function announce(kind: ToastKind, text: string): void {
    const to = toastLive(kind) === 'assertive' ? opts.alert : opts.say;
    if (!to) return;
    const line = doc.createElement('span');
    line.textContent = text;
    to.appendChild(line);
    while (to.childNodes.length > ANNOUNCE_KEEP) (to.childNodes[0] as ChildNode).remove();
    setTimeout(() => line.remove(), ANNOUNCE_KEEP_MS);
  }

  function stopTimer(t: Live): void {
    if (t.timer === null) return;
    clearTimeout(t.timer);
    t.timer = null;
    if (t.remaining !== null) t.remaining = Math.max(0, t.remaining - (Date.now() - t.startedAt));
  }
  function startTimer(t: Live): void {
    if (t.remaining === null || t.timer !== null || t.el.hidden) return;
    if (t.hovered || t.el.contains(doc.activeElement)) return; // paused while hovered or focused
    t.startedAt = Date.now();
    t.timer = setTimeout(() => remove(t, false), t.remaining);
  }

  /** Show or hide by the overflow policy. Elements are never moved (a moved element loses focus). */
  function layout(): void {
    const { drop, shown } = toastOverflow(live);
    for (const id of drop) {
      const t = live.find((x) => x.id === id);
      if (t) remove(t, false, true);
    }
    const on = new Set(shown);
    for (const t of live) {
      t.el.hidden = !on.has(t.id);
      if (t.el.hidden) stopTimer(t);
      else startTimer(t);
    }
  }

  function remove(t: Live, byPerson: boolean, quiet = false): void {
    const i = live.indexOf(t);
    if (i < 0) return;
    stopTimer(t);
    const hadFocus = t.el.contains(doc.activeElement);
    live.splice(i, 1);
    t.el.remove();
    if (byPerson) t.onClose?.();
    if (!quiet) layout();
    if (hadFocus) {
      // back where it was before the toast, never onto another key
      const back = t.returnTo && t.returnTo.isConnected !== false && !region.contains(t.returnTo) ? t.returnTo : (opts.returnFocus?.() ?? null);
      back?.focus();
    }
  }

  function show(text: string, o: ToastOptions = {}): ToastHandle {
    const kind = o.kind ?? 'info';
    const persistent = o.persistent === true;
    const el = doc.createElement('div');
    el.className = `${toastClass(kind)}${persistent ? ' held' : ''}${o.variant ? ` ${o.variant.replace(/[^a-z0-9-]/g, '')}` : ''}`;
    const { main, next } = splitToastText(text);
    const tag = o.tag ?? toastTag(kind, persistent);
    if (tag) {
      const g = doc.createElement('span');
      g.className = 'toast-tag';
      g.textContent = tag;
      el.appendChild(g);
    }
    const body = doc.createElement('span');
    body.className = 'toast-text';
    body.textContent = main;
    if (toastMayClip(main) && kind !== 'fail') {
      // clamped to 4 lines: the full text is in title= (hover), opens on focus (tabindex) and is announced whole
      body.title = main;
      body.tabIndex = 0;
    }
    el.appendChild(body);
    if (next) {
      const n = doc.createElement('span');
      n.className = 'toast-next meta';
      n.textContent = next;
      el.appendChild(n);
    }
    let keyEl: HTMLButtonElement | null = null;
    const acts = doc.createElement('span');
    acts.className = 'toast-acts';
    if (o.key) {
      keyEl = doc.createElement('button');
      keyEl.type = 'button';
      keyEl.className = 'key quiet toast-key';
      keyEl.textContent = o.key.label;
      if (o.key.title) keyEl.title = o.key.title;
      if (o.key.ariaLabel) keyEl.setAttribute('aria-label', o.key.ariaLabel);
      const press = o.key.onPress;
      keyEl.addEventListener('click', (e) => press(e));
      acts.appendChild(keyEl);
    }
    const t: Live = { id: nextId++, kind, persistent, el, handle: null as unknown as ToastHandle, timer: null, remaining: toastTtl(kind, persistent), startedAt: 0, hovered: false, returnTo: null, onClose: o.onClose };
    if (toastClosable(kind, persistent)) {
      const close = doc.createElement('button');
      close.type = 'button';
      close.className = 'key quiet toast-close';
      close.textContent = o.closeLabel ?? 'close';
      if (!o.closeLabel) close.setAttribute('aria-label', 'Close');
      close.title = `${o.closeLabel ?? 'Close'} (Esc)`;
      close.addEventListener('click', () => remove(t, true));
      acts.appendChild(close);
    }
    if (acts.childNodes.length) el.appendChild(acts);
    el.addEventListener('mouseenter', () => {
      t.hovered = true;
      stopTimer(t);
    });
    el.addEventListener('mouseleave', () => {
      t.hovered = false;
      startTimer(t);
    });
    el.addEventListener('focusin', (e) => {
      const from = (e as FocusEvent).relatedTarget as HTMLElement | null;
      if (from && !el.contains(from) && !region.contains(from)) t.returnTo = from;
      stopTimer(t);
    });
    el.addEventListener('focusout', () => setTimeout(() => startTimer(t), 0));
    el.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key !== 'Escape' || !toastClosable(kind, persistent)) return;
      e.stopPropagation();
      remove(t, true);
    });
    t.handle = {
      kind,
      get present() {
        return live.includes(t);
      },
      dismiss: () => remove(t, false),
      get keyEl() {
        return keyEl;
      },
      update: (text2: string, u: { dropKey?: boolean } = {}) => {
        if (!live.includes(t)) return;
        body.textContent = splitToastText(text2).main;
        if (u.dropKey && keyEl) {
          const had = keyEl === doc.activeElement;
          keyEl.remove();
          keyEl = null;
          if (had) {
            body.tabIndex = -1;
            body.focus();
          }
        }
        stopTimer(t);
        t.remaining = toastTtl(kind, persistent);
        startTimer(t);
        announce(kind, tag ? `${tag}: ${text2}` : text2);
      },
    };
    live.push(t);
    // newest on top: a new toast goes in at the top and nothing else moves (focus stays where it is)
    region.insertBefore(el, region.firstChild);
    layout();
    announce(kind, tag ? `${tag}: ${text}` : text);
    return t.handle;
  }

  function dismissNewestFail(): boolean {
    for (let i = live.length - 1; i >= 0; i--) {
      const t = live[i]!;
      if (t.kind === 'fail' && !t.el.hidden) {
        remove(t, true);
        return true;
      }
    }
    return false;
  }

  return { show, dismissNewestFail };
}

export interface NoticeOptions {
  /** an asks-first step: stays until cleared or replaced */
  held?: boolean;
  key?: ToastKey;
  /**
   * The action it reports (rename, run mode, voice…). A fail with a source is cleared when the same source later
   * reports success (any non-fail notice, or a clear, with the same source): a stale failure never outlives its fix.
   */
  source?: string;
}
export type Notice = (msg: string | null, kind?: ToastKind, opts?: NoticeOptions) => ToastHandle | null;

/**
 * The GUI-outcome channel over the toasts (app.ts notice()). A new notice replaces the last one unless that was a
 * fail (a fail stays until closed, or until its own source succeeds); notice(null) clears the last one.
 */
export function noticeChannel(t: Toasts): Notice {
  let last: ToastHandle | null = null;
  let lastSource: string | undefined;
  const fails = new Map<string, ToastHandle>();
  return (msg, kind = 'info', o = {}) => {
    // a clear with a source clears only that source's toast; a bare clear clears the last
    const clearsLast = msg === null ? !o.source || o.source === lastSource : last?.kind !== 'fail';
    if (last && clearsLast) last.dismiss();
    if (o.source && (msg === null || kind !== 'fail')) {
      fails.get(o.source)?.dismiss();
      fails.delete(o.source);
    }
    if (msg === null && !clearsLast) return null;
    last = msg ? t.show(msg, { kind, persistent: o.held === true, key: o.key }) : null;
    lastSource = msg ? o.source : undefined;
    if (last && kind === 'fail' && o.source) {
      fails.get(o.source)?.dismiss();
      fails.set(o.source, last);
    }
    return last;
  };
}
