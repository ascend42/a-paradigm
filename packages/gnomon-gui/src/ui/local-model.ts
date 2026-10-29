/**
 * @symbol #gui-local-model
 * @symbol $local-config-flow
 *
 * #gui-local-model, the press paths of the Settings sheet's Local model section (the words and the views are
 * core/local-model.ts; the DOM is ui/settings-sheet.ts). No DOM here: the sheet hands presses in, and this module
 * hands back a repaint and where focus goes, so the flow is tested without a browser.
 *
 *   - Every press needs the human's own gesture (G-GUI-04); a script-made press changes nothing.
 *   - One request at a time: a second Save while a check, a request or a card is in flight sends nothing, and while a
 *     card waits the form is replaced by the request line (component settings-form).
 *   - Save: the page's checks, then the kernel's read-only request.local.probe (C1 check-first; a rate-limited check
 *     is retried once after the kernel's retryAfterMs), then request.local.config {op:'set'} raises the root card.
 *     Errors move focus to the first invalid field; a raised card moves it to Decide in the stack.
 *   - Decide in the stack closes the sheet and focuses the card group, never its Allow (rule form-says-where-the-card-is).
 *   - The card's outcome comes from the kernel's rows: approval.decide allow (the section then shows "checking…" until
 *     status.local.lastProbe lands; a toast says how it went only when no sheet is open), deny or approval.expire
 *     (the form comes back with the entries and a "Not changed" line), daemon.start (expired: Gnomon restarted).
 *   - Turn off: {op:'remove'}, no card; one inline confirm only when loops use it (C2). A removal seen while no sheet
 *     is open (the terminal, another window) is a toast.
 *   - Esc closes the confirm or the form first (entries kept until the sheet closes), then the sheet.
 */
import { RpcError, type ShownRefusal } from '../core/client.js';
import { clearRequest, remeasureLaterText, remeasureRequest, TIER_COPY } from '../core/tool-tier.js';
import { changeForm, changesOf, deniedResult, editField, emptyLocalUi, expiredResult, firstInvalid, formErrors, localStatusOf, pickServer, probeAnswerOf, probeRequest, probeVerdict, REMOVE_REQUEST, refusalLine, requestLine, setRequest, setupForm, tierEndpointOf, turnedOffResult, appliedToast, turnedOffToast, type LocalField, type LocalForm, type LocalRequest, type LocalUi } from '../core/local-model.js';
import type { LocalFocus, LocalPress } from './settings-sheet.js';
import { FolderField, fieldView } from '../core/folder-field.js';
import { focusFolder, routeFolderPress } from './folder-field.js';

export interface LocalDeps {
  /** log.append of one request; throws RpcError on a refusal */
  call: (req: LocalRequest) => Promise<unknown>;
  status: () => unknown;
  /** loops that would stop if the local model went (enabled, trusted, with a model step, and a loops endpoint) */
  loopsUsing: () => string[];
  now: () => number;
  /** hh:mm of an ISO instant */
  time: (iso: string) => string;
  refreshStatus: () => Promise<void>;
  repaint: () => void;
  focus: (t: LocalFocus) => void;
  /** close the sheet and focus the card group (never its Allow) */
  decide: (cardId: string) => void;
  sheetOpen: () => boolean;
  /** a toast (only ever called with no sheet open); `open` adds the "Open settings" key */
  toast: (text: string, kind: 'info' | 'fail', open: boolean) => void;
  wait?: (ms: number) => Promise<void>;
  /** a pending local.config card the page did not ask for in this load (a reload): its request line and entries */
  card?: (cardId: string) => { at: number; line: string; entries: LocalForm | null } | null;
}

type Called = { ok: true; v: unknown } | { ok: false; refusal: ShownRefusal | null; text: string };

const iso = (ms: number): string => new Date(ms).toISOString();
const POLL_MS = 1500;
const POLL_MAX = 20;

export class LocalModelController implements LocalPress {
  readonly #d: LocalDeps;
  #ui: LocalUi = emptyLocalUi();
  /** an Allow seen: waiting for status.local.lastProbe after it (ms of the decision) */
  #applied: number | null = null;
  #polls = 0;
  #removedAt = 0;
  /** bumped by Esc and the sheet closing: a check in flight then raises no card */
  #gen = 0;

  /**
   * #gui-folder-field (TD-2026-10-23-162): the runner override is CHOSEN (the kernel's chooser or a typed path the
   * kernel checks for cli.js), never a bare text field; its value is the kernel's real path, kept in form.runner.
   */
  readonly #runner: FolderField;

  constructor(d: LocalDeps) {
    this.#d = d;
    this.#runner = new FolderField({
      purpose: 'runner',
      call: (req) => d.call(req),
      changed: () => {
        const f = this.#ui.form;
        if (f) this.#ui.form = { ...f, runner: this.#runner.value() ?? '' };
        if (this.#ui.errors.runner) {
          const { runner: _gone, ...rest } = this.#ui.errors;
          this.#ui.errors = rest;
        }
        this.#d.repaint();
      },
    });
  }

  /** The section's state (settings model input); the runner field is drawn while the form is open. */
  ui(): LocalUi {
    return this.#ui.form && this.#ui.open ? { ...this.#ui, runnerView: fieldView(this.#runner, 'compact') } : this.#ui;
  }

  /** A press in the runner's folder field (Choose folder…, Clear, Type a path, Use …/dist). */
  folder(act: string, real: string | null, trusted: boolean): void {
    if (!this.#ui.form || this.#ui.busy) return;
    routeFolderPress(this.#runner, act, real, trusted);
  }

  folderInput(value: string): void {
    if (this.#ui.form && !this.#ui.busy) this.#runner.typedInput(value);
  }

  afterPaint(body: HTMLElement): void {
    const host = body.querySelector('[data-ff="lm-runner"]');
    if (host) focusFolder(host, this.#runner);
  }

  #paint(focus?: LocalFocus): void {
    this.#d.repaint();
    if (focus) this.#d.focus(focus);
  }

  async #call(req: LocalRequest): Promise<Called> {
    try {
      return { ok: true, v: await this.#d.call(req) };
    } catch (err) {
      if (err instanceof RpcError) return { ok: false, refusal: err.refusal, text: refusalLine(err.refusal) };
      return { ok: false, refusal: null, text: `nothing was sent (${err instanceof Error ? err.message.slice(0, 120) : 'failed'})` };
    }
  }

  /** request.local.probe, retried once after the kernel's rate limit (it allows one check every few seconds). */
  async #probe(req: LocalRequest): Promise<Called> {
    const r = await this.#call(req);
    if (r.ok || r.refusal?.data?.why !== 'rate-limited') return r;
    const ms = Number(r.refusal.data.retryAfterMs);
    await (this.#d.wait ?? ((x: number) => new Promise((res) => setTimeout(res, x))))(Math.min(10_000, Math.max(0, Number.isFinite(ms) ? ms : 2000)) + 50);
    return this.#call(req);
  }

  press(act: string, value: string | null, trusted: boolean): void {
    if (!trusted) return; // G-GUI-04
    const ui = this.#ui;
    switch (act) {
      case 'setup':
      case 'change': {
        if (ui.request || ui.busy) return;
        const v = localStatusOf(this.#d.status());
        const keep = ui.form && ui.form.mode === (act === 'change' ? 'change' : 'setup') ? ui.form : null;
        const e = v.endpoints[0];
        if (act === 'change' && !e && !keep) return;
        ui.form = keep ?? (act === 'change' ? changeForm(e!) : setupForm());
        this.#runner.reset();
        this.#runner.setStatus(this.#d.status());
        if (ui.form.runner) this.#runner.setValue(ui.form.runner);
        ui.open = true;
        ui.result = null;
        ui.confirmOff = false;
        return this.#paint({ field: 'model' });
      }
      case 'cancel':
        return void this.escape();
      case 'server':
        if (!ui.form || ui.busy || !value) return;
        ui.form = pickServer(ui.form, value);
        return this.#paint();
      case 'loops':
        if (!ui.form || ui.busy) return;
        ui.form = { ...ui.form, loops: value === 'yes' };
        return this.#paint();
      case 'decide':
        if (ui.request) this.#d.decide(ui.request.cardId);
        return;
      case 'turn-off': {
        if (ui.busy || ui.request) return;
        const loops = this.#d.loopsUsing();
        if (!loops.length) return void this.#remove([]);
        ui.confirmOff = true;
        return this.#paint({ act: 'confirm-off' });
      }
      case 'confirm-off':
        return void this.#remove(this.#d.loopsUsing());
      case 'keep':
        ui.confirmOff = false;
        return this.#paint({ act: 'turn-off' });
      case 'check':
        return void this.#checkAgain();
      // #gui-tool-tier (C4'b): Re-measure and Reset to measured (the kernel's request.local.tier.*)
      case 'tier-remeasure':
        return void this.#remeasure();
      case 'tier-reset':
        return void this.#resetTier();
      default:
        return;
    }
  }

  input(name: string, value: string): void {
    const f = this.#ui.form;
    if (!f || !['base', 'model', 'id', 'runner'].includes(name)) return;
    this.#ui.form = editField(f, name as LocalField, value);
    if (this.#ui.errors[name as LocalField]) {
      const { [name as LocalField]: _gone, ...rest } = this.#ui.errors;
      this.#ui.errors = rest;
    }
    this.#paint();
  }

  advanced(open: boolean): void {
    this.#ui.advanced = open;
  }

  /** Save · root card (a form submit: the key or Enter in a field). */
  async submit(trusted: boolean): Promise<void> {
    const ui = this.#ui;
    if (!trusted || !ui.open || !ui.form || ui.busy || ui.request) return; // one request at a time
    // #gui-folder-field: a runner check in flight lands first (form.runner is the kernel's real path)
    await this.#runner.settled();
    if (!ui.form || ui.busy || ui.request) return;
    const f = ui.form;
    if (f.mode === 'change' && !changesOf(f).length) return; // Save is disabled: "no change"
    ui.result = null;
    // a runner chosen or typed but not checked usable stops the Save, with its reason
    const rs = this.#runner.state();
    const runnerOff = rs.chosen || rs.typed.trim() ? this.#runner.whyOff() : null;
    const errs = runnerOff ? { ...formErrors(f), runner: `✕ ${runnerOff}` } : formErrors(f);
    const first = firstInvalid(errs);
    if (first) {
      ui.errors = errs;
      if (first === 'id' || first === 'runner') ui.advanced = true;
      return this.#paint({ field: first });
    }
    ui.errors = {};
    ui.busy = 'checking';
    const gen = this.#gen;
    this.#paint();
    const p = await this.#probe(probeRequest(f));
    if (gen !== this.#gen) {
      ui.busy = null; // cancelled while the check ran: nothing is asked
      return this.#paint();
    }
    const a = p.ok ? probeAnswerOf(p.v) : null;
    if (!a) {
      ui.busy = null;
      ui.result = { text: p.ok ? 'the kernel’s check gave no answer: nothing was sent' : p.text, fail: true };
      return this.#paint({ act: 'save' });
    }
    const verdict = probeVerdict(a, f);
    if (!verdict.go) {
      ui.busy = null;
      ui.errors = { [verdict.field]: verdict.text };
      return this.#paint({ field: verdict.field });
    }
    ui.busy = 'submitting';
    this.#paint();
    const s = await this.#call(setRequest(f));
    ui.busy = null;
    const cardId = s.ok && s.v && typeof s.v === 'object' && typeof (s.v as { cardId?: unknown }).cardId === 'string' ? (s.v as { cardId: string }).cardId : null;
    if (!cardId) {
      ui.result = { text: s.ok ? 'the kernel raised no card: nothing changed' : s.text, fail: true };
      return this.#paint({ act: 'save' });
    }
    const now = this.#d.now();
    ui.request = { cardId, at: now, line: requestLine(this.#d.time(iso(now)), { id: f.id.trim(), base: f.base.trim(), model: f.model.trim(), loops: f.loops }), entries: f };
    ui.open = false;
    this.#paint({ act: 'decide' });
    void this.#d.refreshStatus();
  }

  async #remove(loops: string[]): Promise<void> {
    const ui = this.#ui;
    if (ui.busy || ui.request) return;
    ui.confirmOff = false;
    ui.busy = 'removing';
    this.#paint();
    const r = await this.#call(REMOVE_REQUEST);
    ui.busy = null;
    if (!r.ok) {
      ui.result = { text: r.text, fail: true };
      return this.#paint({ act: 'turn-off' });
    }
    const now = this.#d.now();
    this.#removedAt = now;
    ui.result = turnedOffResult(this.#d.time(iso(now)), loops);
    ui.form = null;
    ui.open = false;
    ui.check = null;
    await this.#d.refreshStatus();
    this.#paint({ act: 'setup' });
  }

  async #checkAgain(): Promise<void> {
    const ui = this.#ui;
    if (ui.checking !== null) return; // one check at a time
    const e = localStatusOf(this.#d.status()).endpoints[0];
    if (!e) return;
    ui.checking = this.#d.now();
    ui.check = null;
    this.#paint();
    const r = await this.#probe(probeRequest(e));
    const a = r.ok ? probeAnswerOf(r.v) : null;
    // the kernel records a check of the configured endpoint in status.local.lastProbe: read it back; only a call that
    // failed (refused, nothing sent) is held here
    if (!a) ui.check = { at: iso(this.#d.now()), ok: false, why: 'probe-failed', error: r.ok ? 'no answer' : r.text, tools: false, contextSize: null };
    else await this.#d.refreshStatus();
    ui.checking = null;
    this.#paint({ act: a?.ok ? 'change' : 'check' });
  }

  /** Re-measure: the kernel answers at once; the row says measuring… until status.local.lastProbe.tier says otherwise. */
  async #remeasure(): Promise<void> {
    const ui = this.#ui;
    const v = localStatusOf(this.#d.status());
    const ep = tierEndpointOf(v);
    if (!ep || (ui.measuring ?? null) !== null || (v.lastProbe?.endpoint === ep && v.lastProbe.tier?.measuring)) return; // disabled while measuring
    ui.measuring = this.#d.now();
    ui.result = null;
    this.#paint();
    const r = await this.#call(remeasureRequest(ep));
    if (!r.ok) {
      ui.measuring = null;
      // Aegis C4'b L1: the kernel allows one re-measure per endpoint every few seconds: say when, never auto-retry
      const wait = r.refusal?.data?.why === 'rate-limited' ? Number(r.refusal.data.retryAfterMs) : NaN;
      ui.result = Number.isFinite(wait) ? { text: remeasureLaterText(wait) } : { text: r.text, fail: true };
      return this.#paint({ act: 'tier-remeasure' });
    }
    // the result lands in lastProbe.tier (a model.capabilities row also refreshes status): re-read until it settles
    for (let n = 0; n < POLL_MAX; n++) {
      await this.#d.refreshStatus();
      const s = localStatusOf(this.#d.status());
      if (!(s.lastProbe?.endpoint === ep && s.lastProbe.tier?.measuring)) break;
      await (this.#d.wait ?? ((x: number) => new Promise((res) => setTimeout(res, x))))(POLL_MS);
    }
    ui.measuring = null;
    this.#paint();
  }

  /** Reset to measured: the kernel forgets the remembered tier; new sessions open measured, open ones keep theirs. */
  async #resetTier(): Promise<void> {
    const ui = this.#ui;
    const ep = tierEndpointOf(localStatusOf(this.#d.status()));
    if (!ep || ui.resetting) return;
    ui.resetting = true;
    ui.result = null;
    this.#paint();
    const r = await this.#call(clearRequest(ep));
    ui.resetting = false;
    const why = r.ok && r.v && typeof r.v === 'object' ? (r.v as { cleared?: unknown; why?: unknown }) : null;
    if (!r.ok) ui.result = { text: r.text, fail: true };
    else if (why?.cleared !== true && typeof why?.why === 'string' && why.why !== 'none') ui.result = { text: `Not changed: ${(TIER_COPY.remember[why.why] ?? why.why).replace(/^can’t remember: /, '')}`, fail: true };
    await this.#d.refreshStatus();
    this.#paint({ act: r.ok ? 'tier-remeasure' : 'tier-reset' });
  }

  escape(): boolean {
    const ui = this.#ui;
    if (ui.confirmOff) {
      ui.confirmOff = false;
      this.#paint({ act: 'turn-off' });
      return true;
    }
    if (ui.open && ui.busy !== 'submitting') {
      // entries are kept until the sheet closes; a check in flight raises no card
      this.#gen++;
      const mode = ui.form?.mode === 'change' ? 'change' : 'setup';
      ui.open = false;
      ui.errors = {};
      ui.result = null;
      this.#paint({ act: mode });
      return true;
    }
    return false;
  }

  sheetClosed(): void {
    this.#runner.closed();
    const ui = this.#ui;
    if (ui.busy === 'checking') this.#gen++;
    ui.confirmOff = false;
    ui.open = false;
    ui.errors = {};
    ui.advanced = false;
    ui.check = null;
    if (ui.busy === 'removing') return;
    // a waiting card keeps its entries (Deny brings them back); otherwise the entries go with the sheet
    if (!ui.request) {
      if (!ui.busy) ui.form = null;
      ui.result = null;
    }
  }

  /** A live kernel row: the outcome of our card, a restart, a removal elsewhere, a probe. */
  row(r: { kind: string; payload?: unknown }): void {
    const p = (r.payload && typeof r.payload === 'object' ? r.payload : {}) as Record<string, unknown>;
    const ui = this.#ui;
    const time = this.#d.time(iso(this.#d.now()));
    if ((r.kind === 'approval.decide' || r.kind === 'approval.expire') && ui.request && p.cardId === ui.request.cardId) {
      const entries = ui.request.entries;
      ui.request = null;
      if (r.kind === 'approval.decide' && p.decision === 'allow') {
        ui.form = null;
        ui.open = false;
        ui.result = null;
        ui.check = null;
        this.#applied = this.#d.now();
        this.#polls = 0;
        void this.#poll();
      } else {
        ui.form = entries ?? setupForm();
        ui.open = true;
        ui.result = r.kind === 'approval.expire' ? expiredResult(time, false) : deniedResult(time);
      }
      return this.#paint();
    }
    if (r.kind === 'daemon.start' && ui.request) {
      ui.form = ui.request.entries ?? setupForm();
      ui.request = null;
      ui.open = true;
      ui.result = expiredResult(time, true);
      return this.#paint();
    }
    if (r.kind === 'config.loaded' && p.file === 'local.signed.json') {
      const ownRemove = this.#d.now() - this.#removedAt < 15_000;
      if (p.why === 'removed' && !ownRemove && !this.#d.sheetOpen()) this.#d.toast(turnedOffToast(this.#d.loopsUsing()), 'info', true);
      void this.#d.refreshStatus();
      return;
    }
    if (r.kind === 'model.probe' || r.kind === 'model.capabilities') void this.#d.refreshStatus();
  }

  async #poll(): Promise<void> {
    while (this.#applied !== null && this.#polls++ < POLL_MAX) {
      await this.#d.refreshStatus();
      if (this.#applied === null) return;
      await (this.#d.wait ?? ((x: number) => new Promise((res) => setTimeout(res, x))))(POLL_MS);
    }
    this.#applied = null;
  }

  /** A status re-read: adopt a card waiting from an earlier load; after an Allow, say how the check went. */
  statusChanged(): void {
    const v = localStatusOf(this.#d.status());
    const ui = this.#ui;
    if (!ui.request && v.pendingCardId && !ui.busy && this.#d.card) {
      const c = this.#d.card(v.pendingCardId);
      if (c) {
        ui.request = { cardId: v.pendingCardId, at: c.at, line: c.line, entries: c.entries };
        ui.open = false;
      }
    }
    if (v.probing) ui.check = null; // a new kernel check supersedes a failed call
    if (this.#applied !== null && v.lastProbe && Date.parse(v.lastProbe.at) >= this.#applied - 1000) {
      this.#applied = null;
      if (!this.#d.sheetOpen()) {
        const t = appliedToast(v);
        if (t) this.#d.toast(t.text, t.kind, t.kind === 'fail');
      }
    }
  }
}
