/**
 * @symbol #gui-tool-tier
 *
 * #gui-tool-tier, the DOM side and the press paths (words and views in core/tool-tier.ts), modelled on
 * ui/model-picker.ts: a quiet header key, a `.mode-menu`, then a confirm sheet (`.sheet-card`, as #model-switch-dialog).
 *
 *   - Header: for a local, attended session the tier label sits where a Claude session's model key sits. The owner of
 *     a live session gets the key (▾, the menu of tiers); another principal, or an ended session, gets a plain chip.
 *   - A tier picked from the menu opens the sheet AT ONCE ("Checking what tier n changes…", Apply disabled) and sends
 *     the preview; the sheet then says what changes. Apply commits the preview's token, once: a double press sends one
 *     commit, and a commit is NEVER retried (a wrong attempt burns the token). At the preview's expiresInMs the sheet
 *     swaps Apply for Preview again (no ticking countdown); a stale refusal shows the same. Preview again sends a new
 *     preview, on a trusted press only.
 *   - One preview at a time: its token is dropped when the sheet closes (TierFlow below holds it; no DOM there, so the
 *     flow is tested without a browser).
 *   - Every request is sent only on a trusted event (G-GUI-04). Esc closes the menu, then the sheet; focus returns to
 *     the tier key.
 */
import { RpcError } from '../core/client.js';
import { refusalLine } from '../core/local-model.js';
import { commitOutcome, previewOf, refusalPhase, sheetView, tierChipOf, tierMenu, tierRequest, TIER_COPY, type SessionTier, type SheetPhase, type SheetView, type Tier, type TierPreview, type TierRequest } from '../core/tool-tier.js';
import type { ToastKind } from '../core/toasts.js';

/* ── the flow (no DOM) ───────────────────────────────────────────────────────────────────────────────────────────── */

export interface TierFlowDeps {
  /** log.append of one request; throws RpcError on a refusal */
  call: (req: TierRequest) => Promise<unknown>;
  toast: (text: string, kind: ToastKind) => void;
  repaint: () => void;
  /** a one-shot timer; returns its cancel (default setTimeout) */
  timer?: (fn: () => void, ms: number) => () => void;
}
export interface TierSheetState {
  hsid: string;
  from: Tier;
  requested: Tier;
  model: string;
  phase: SheetPhase;
  preview: TierPreview | null;
  error: string | null;
  /** "in new sessions too": unticked by default (founder) */
  remember: boolean;
}

export class TierFlow {
  readonly #d: TierFlowDeps;
  #s: TierSheetState | null = null;
  /** the preview's single-use token: held only while its sheet is open and Apply has not been pressed */
  #token: string | null = null;
  #gen = 0;
  #cancelTimer: (() => void) | null = null;

  constructor(d: TierFlowDeps) {
    this.#d = d;
  }

  state(): Readonly<TierSheetState> | null {
    return this.#s;
  }

  view(): SheetView | null {
    const s = this.#s;
    return s ? sheetView({ phase: s.phase, from: s.from, requested: s.requested, preview: s.preview, model: s.model, error: s.error }) : null;
  }

  /** A tier picked from the menu: the sheet opens at once and the preview is sent (a trusted press only). */
  open(o: { hsid: string; from: Tier; requested: Tier; model: string }, trusted: boolean): void {
    if (!trusted) return; // G-GUI-04
    this.#drop();
    this.#s = { ...o, phase: 'loading', preview: null, error: null, remember: false };
    void this.#preview();
  }

  /** Preview again (expired or stale): a new preview of the same tier, on a trusted press only; never a commit. */
  again(trusted: boolean): void {
    const s = this.#s;
    if (!trusted || !s || (s.phase !== 'expired' && s.phase !== 'stale')) return;
    this.#drop();
    s.phase = 'loading';
    s.preview = null;
    s.error = null;
    void this.#preview();
  }

  setRemember(on: boolean, trusted: boolean): void {
    const s = this.#s;
    if (!trusted || !s || s.phase !== 'ready' || !s.preview?.rememberable) return;
    s.remember = on;
    // Mika F1: no repaint: the box already shows its own state (a repaint would rebuild it and drop its focus)
  }

  /** Apply: commits the preview's token ONCE (a second press finds no token and sends nothing). */
  async apply(trusted: boolean): Promise<void> {
    const s = this.#s;
    if (!trusted || !s || s.phase !== 'ready' || !s.preview || s.preview.to === s.preview.from || !this.#token) return;
    const token = this.#token;
    this.#token = null;
    this.#stopTimer();
    s.phase = 'applying';
    this.#d.repaint();
    const gen = this.#gen;
    const remember = s.remember && s.preview.rememberable;
    let v: unknown;
    try {
      v = await this.#d.call(tierRequest(s.hsid, 'commit', token, remember, s.preview.to));
    } catch (err) {
      if (gen !== this.#gen || this.#s !== s) return;
      this.#failed(s, err, true);
      return;
    }
    const out = commitOutcome(v, remember);
    if (gen === this.#gen && this.#s === s) this.close(true);
    if (!out) return this.#d.toast('the tier changed, but the kernel’s answer was not one the page reads: see the header', 'warn');
    this.#d.toast(out.info, 'info');
    if (out.warn) this.#d.toast(out.warn, 'warn');
  }

  /** Close the sheet (cancel, close, Esc): its token is dropped. A commit in flight keeps the sheet unless forced. */
  close(force = false): boolean {
    if (!this.#s) return false;
    if (this.#s.phase === 'applying' && !force) return true;
    this.#drop();
    this.#s = null;
    this.#d.repaint();
    return true;
  }

  #drop(): void {
    this.#gen++;
    this.#token = null;
    this.#stopTimer();
  }

  #stopTimer(): void {
    this.#cancelTimer?.();
    this.#cancelTimer = null;
  }

  async #preview(): Promise<void> {
    const s = this.#s!;
    const gen = this.#gen;
    this.#d.repaint();
    let v: unknown;
    try {
      v = await this.#d.call(tierRequest(s.hsid, 'preview', s.requested));
    } catch (err) {
      if (gen === this.#gen && this.#s === s) this.#failed(s, err);
      return;
    }
    if (gen !== this.#gen || this.#s !== s) return; // closed or superseded meanwhile: its token is never held
    const p = previewOf(v);
    if (!p || p.hsid !== s.hsid) {
      s.phase = 'error';
      s.error = 'Not changed: the kernel’s preview was not one the page reads.';
      return this.#d.repaint();
    }
    s.preview = p;
    s.phase = 'ready';
    s.remember = false;
    if (p.to !== p.from) {
      this.#token = p.token;
      const timer = this.#d.timer ?? ((fn: () => void, ms: number) => {
        const t = setTimeout(fn, ms);
        return () => clearTimeout(t);
      });
      this.#cancelTimer = timer(() => {
        if (gen !== this.#gen || this.#s !== s || s.phase !== 'ready') return;
        this.#token = null;
        this.#cancelTimer = null;
        s.phase = 'expired';
        this.#d.repaint();
      }, p.expiresInMs);
    }
    this.#d.repaint();
  }

  /** A refusal or a transport failure; `commit`: the commit may have reached the kernel, so nothing is claimed (F3). */
  #failed(s: TierSheetState, err: unknown, commit = false): void {
    const reason = err instanceof RpcError ? err.refusal.reason : null;
    const ph = refusalPhase(reason);
    this.#token = null;
    this.#stopTimer();
    if (ph === 'stale') s.phase = 'stale';
    else {
      s.phase = 'error';
      s.error = ph === 'gone' ? TIER_COPY.gone : err instanceof RpcError ? refusalLine(err.refusal) : commit ? TIER_COPY.unknown : `Not changed: nothing was sent (${err instanceof Error ? err.message.slice(0, 120) : 'failed'})`;
    }
    this.#d.repaint();
  }
}

/**
 * Mika F11: keep Tab inside an open dialog (aria-modal): Tab from the last focusable goes to the first, Shift+Tab
 * from the first to the last. Shared with #model-switch-dialog (ui/model-picker.ts).
 */
export function trapTab(dialog: HTMLElement, e: KeyboardEvent): void {
  const items = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((x) => !x.closest('[hidden]') && x.getClientRects().length > 0); // R1: nothing inside a hidden row
  if (!items.length) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const at = dialog.ownerDocument.activeElement;
  if (e.shiftKey && (at === first || !dialog.contains(at))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (at === last || !dialog.contains(at))) {
    e.preventDefault();
    first.focus();
  }
}

/* ── the DOM ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

interface Caller {
  call<T = unknown>(method: string, params?: unknown): Promise<T>;
}
/** What the picker reads of a session (core/store.ts SessionRow). */
export interface TierSessionLike {
  backend: string | null;
  loop?: boolean;
  owner?: string | null;
  tier?: SessionTier;
}
export interface TierPickerDeps {
  client: () => Caller | null;
  session: (hsid: string) => TierSessionLike | undefined;
  live: (hsid: string) => boolean;
  /** the connected human principal */
  me: () => string | null;
  /** the session's model name (the checkbox says it) */
  model: (hsid: string) => string;
  notice: (msg: string | null, kind?: ToastKind) => void;
  timer?: TierFlowDeps['timer'];
}
export interface TierPicker {
  /** the header label for a session, appended to `into` (nothing for a non-local or loop session; null removes it) */
  headChip(into: HTMLElement, hsid: string | null): void;
  repaint(): void;
  /** the flow (tests) */
  readonly flow: TierFlow;
}

const el = <K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] => {
  const e = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
};

export function mountTierPicker(doc: Document, d: TierPickerDeps): TierPicker {
  let chip: { hsid: string; kind: 'key' | 'chip'; sep: HTMLElement; wrap: HTMLElement; btn: HTMLElement; menu: HTMLElement | null } | null = null;
  const closeMenu = (): void => {
    if (!chip?.menu) return;
    chip.menu.hidden = true;
    chip.btn.setAttribute('aria-expanded', 'false');
  };
  const dropChip = (): void => {
    chip?.sep.remove();
    chip?.wrap.remove();
    chip?.menu?.remove();
    chip = null;
  };

  /* the sheet */
  const sheet = el(doc, 'div', { id: 'tier-dialog', class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'change tool tier' });
  sheet.hidden = true;
  const card = el(doc, 'div', { class: 'sheet-card' });
  // Mika F8: one live region for the card's life (a region must exist before its text changes to be announced)
  const status = el(doc, 'p', { class: 'meta', role: 'status' });
  sheet.appendChild(card);
  doc.body.appendChild(sheet);
  let lastPhase: SheetPhase | null = null;

  const call = async (req: TierRequest): Promise<unknown> => {
    const c = d.client();
    if (!c) throw new Error('not connected');
    return c.call('log.append', req);
  };
  const flow = new TierFlow({ call, toast: (t, k) => d.notice(t, k), repaint: () => paintSheet(), ...(d.timer ? { timer: d.timer } : {}) });

  const focusKey = (): void => {
    if (chip?.kind === 'key') chip.btn.focus();
  };
  const paintSheet = (): void => {
    const v = flow.view();
    const s = flow.state();
    if (!v || !s) {
      if (!sheet.hidden) {
        sheet.hidden = true;
        lastPhase = null;
        focusKey();
      }
      return;
    }
    // Mika F1: the focused node (by id or data-act) is found again after the rebuild
    const active = doc.activeElement as HTMLElement | null;
    const had = active && card.contains(active) ? { id: active.getAttribute('id'), act: active.getAttribute('data-act') } : null;
    const kids: HTMLElement[] = [el(doc, 'p', { class: 'title' }, v.title), status];
    status.textContent = v.status ?? '';
    status.setAttribute('class', `meta${v.fail ? ' fail' : ''}`);
    const keyBy = new Map<string, HTMLButtonElement>();
    if (v.body) {
      const lines = el(doc, 'div', { class: 'model-switch-lines' });
      v.body.lines.forEach((t, n) => {
        const line = el(doc, 'p', { class: 'meta' }, t);
        const full = v.body!.titles[n];
        if (full) line.title = full; // Mika F12: the whole list of a shortened line
        lines.appendChild(line);
      });
      for (const w of v.body.warnings) lines.appendChild(el(doc, 'p', { class: 'meta warn' }, w));
      kids.push(lines);
      const cb = v.body.checkbox;
      if (cb && s.phase !== 'error') {
        const label = el(doc, 'label', { class: 'meta tier-remember' });
        const box = el(doc, 'input', { type: 'checkbox', id: 'tier-remember' });
        box.checked = s.remember;
        box.disabled = cb.disabled || s.phase !== 'ready';
        box.addEventListener('change', (e) => {
          flow.setRemember(box.checked, e.isTrusted);
          box.checked = flow.state()?.remember ?? false;
        });
        label.append(box, doc.createTextNode(` ${cb.label}`));
        kids.push(label);
        if (cb.why) kids.push(el(doc, 'p', { class: 'meta', id: 'tier-remember-why' }, cb.why));
        if (cb.why) box.setAttribute('aria-describedby', 'tier-remember-why');
      }
    }
    const foot = el(doc, 'div', { class: 'composer-foot' });
    for (const k of v.keys) {
      const b = el(doc, 'button', { class: `key${k.pri ? ' pri' : ''}${k.quiet ? ' quiet' : ''}`, type: 'button', 'data-act': k.act }, k.label);
      // Mika F2: a busy key is aria-disabled (it keeps its focus; the flow ignores its press), never disabled
      if (k.busy) {
        b.setAttribute('aria-disabled', 'true');
        b.setAttribute('aria-busy', 'true');
      } else if (k.disabled) b.disabled = true;
      b.addEventListener('click', (e) => {
        const trusted = e.isTrusted;
        if (k.act === 'apply') void flow.apply(trusted);
        else if (k.act === 'again') flow.again(trusted);
        else flow.close();
      });
      keyBy.set(k.act, b);
      foot.appendChild(b);
    }
    kids.push(foot);
    if (v.body && s.phase !== 'error') kids.push(el(doc, 'p', { class: 'meta' }, v.body.foot));
    card.replaceChildren(...kids);
    sheet.hidden = false;
    if (lastPhase !== s.phase) {
      lastPhase = s.phase;
      keyBy.get(v.focus)?.focus();
    } else if (had) {
      const again = (had.id ? card.querySelector(`#${had.id}`) : null) ?? (had.act ? card.querySelector(`[data-act="${had.act}"]`) : null);
      (again as HTMLElement | null)?.focus();
    }
  };

  doc.addEventListener('click', (e) => {
    if (chip?.menu && !chip.menu.hidden && !(e.target as HTMLElement).closest('.tier-wrap, .tier-menu')) closeMenu();
  });
  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !sheet.hidden) return trapTab(sheet, e);
    if (e.key !== 'Escape') return;
    if (chip?.menu && !chip.menu.hidden) {
      closeMenu();
      chip.btn.focus();
      return;
    }
    if (!sheet.hidden) flow.close();
  });

  const chipOf = (hsid: string): ReturnType<typeof tierChipOf> => {
    const s = d.session(hsid);
    return s ? tierChipOf({ backend: s.backend, loop: s.loop === true, live: d.live(hsid), owner: s.owner ?? null, me: d.me(), tier: s.tier ?? null }) : null;
  };
  const paintChip = (): void => {
    if (!chip) return;
    const c = chipOf(chip.hsid);
    if (!c) return;
    chip.btn.textContent = c.text;
    chip.btn.title = c.title;
  };

  return {
    flow,
    headChip(into: HTMLElement, hsid: string | null): void {
      const c = hsid ? chipOf(hsid) : null;
      if (!hsid || !c) {
        dropChip();
        return;
      }
      // a streaming session repaints the header on every row: the same session keeps its key, its open menu and focus
      if (chip?.hsid === hsid && chip.kind === c.kind) {
        if (chip.wrap.parentNode !== into) into.append(chip.sep, chip.wrap);
        paintChip();
        return;
      }
      dropChip();
      const sep = el(doc, 'span', { class: 'chead-sep', 'data-tier-chip': '' }, ' · ');
      const w = el(doc, 'span', { class: 'tier-wrap mode-wrap', 'data-tier-chip': '' });
      if (c.kind === 'chip') {
        // rule chip-is-not-a-key: not the owner, or ended: a plain chip that says why
        const label = el(doc, 'span', { class: 'chip' }, c.text);
        label.title = c.title;
        w.append(label);
        into.append(sep, w);
        chip = { hsid, kind: 'chip', sep, wrap: w, btn: label, menu: null };
        return;
      }
      const btn = el(doc, 'button', { class: 'key quiet model-btn kernel-owned', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
      const menu = el(doc, 'span', { class: 'mode-menu model-menu tier-menu', role: 'menu', 'aria-label': 'tool tier' });
      menu.hidden = true;
      btn.addEventListener('click', () => {
        if (!menu.hidden) return closeMenu();
        const t = d.session(hsid)?.tier;
        if (!t) return;
        menu.replaceChildren(...tierMenu(t.tier, t.measured).map((m) => {
          const b = el(doc, 'button', { class: `mode-item${m.current ? ' current' : ''}`, type: 'button', role: 'menuitem', 'data-tier': String(m.tier), ...(m.current ? { 'aria-current': 'true' } : {}) });
          b.append(el(doc, 'span', { class: 'mode-name' }, m.name), el(doc, 'span', { class: 'mode-note' }, m.note));
          b.addEventListener('click', (e) => {
            closeMenu();
            // Mika F4: the current tier asks nothing: the menu closes and focus goes back to the key
            if (m.current) return btn.focus();
            // the preview is a request: only the human's own press sends it (G-GUI-04)
            flow.open({ hsid, from: t.tier, requested: m.tier, model: d.model(hsid) }, e.isTrusted);
          });
          return b;
        }));
        // as the model key: the menu hangs from the header row (the left part clips), right after that part
        const host = (btn.closest('.pane-head') as HTMLElement | null) ?? into;
        const part = btn.closest('.chead-l') as HTMLElement | null;
        if (menu.parentNode !== host) {
          if (part && part.parentNode === host) part.after(menu);
          else host.append(menu);
        }
        menu.hidden = false;
        const hr = host.getBoundingClientRect();
        const left = btn.getBoundingClientRect().left - hr.left;
        menu.style.left = `${Math.max(0, Math.min(left, hr.width - menu.offsetWidth))}px`;
        btn.setAttribute('aria-expanded', 'true');
      });
      w.append(btn);
      into.append(sep, w);
      chip = { hsid, kind: 'key', sep, wrap: w, btn, menu };
      paintChip();
    },
    repaint(): void {
      paintChip();
    },
  };
}
