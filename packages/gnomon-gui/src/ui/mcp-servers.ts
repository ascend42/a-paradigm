/**
 * @symbol #gui-mcp-servers
 *
 * #gui-mcp-servers, the press path of the Settings sheet's MCP servers section (the words and the views are
 * core/mcp-servers.ts; the DOM is ui/settings-sheet.ts). No DOM here, so the flow is tested without a browser.
 *
 *   - Every press needs the human's own gesture (G-GUI-04); a script-made press changes nothing.
 *   - One server, one press: On for all repos / On in <folder> sends request.mcp.enable{id, scope} and the kernel raises
 *     its root card at once (Mika 2026-10-23, founder: fewer hurdles).
 *   - #batch-card: Mark several, then Mark for all repos / Mark in <folder> stages a server in the page (Unmark, Clear
 *     marks); Turn on sends ONE request.mcp.enable{servers} and the kernel raises ONE root card for every marked server.
 *     Decide closes the sheet and focuses the card group, never its Allow (rule form-says-where-the-card-is).
 *   - While that card waits, the other servers can be marked for the next card; Turn on waits until it is decided.
 *   - Turn off: request.mcp.disable, no card, applies at once (even while a card waits). The first-party Paradigm MCP
 *     turns off and on the same way.
 *   - The card's outcome comes from the kernel's rows (approval.decide / approval.expire for OUR card); servers the
 *     kernel skipped at allow (changed while the card waited) are named from status.mcp.skips (this card's entry, by
 *     cardId), and only when THIS page's connection decided it (entry.connId); the servers named On are entry.on.
 *   - C5'b trust: Trust… opens the preview inline under its row (TrustFlow holds the token); Trust · root card commits
 *     once and the request row shows while the root card waits; the outcome shows under the row and focus goes to
 *     that server's first key. Esc closes the panel, focus back on Trust…. Clear trust takes no card.
 */
import { RpcError } from '../core/client.js';
import { clearMcp, emptyMcpUi, markMcp, startMarking, MCP_BATCH, MCP_FIRST_PARTY, mcpBatchRequest, mcpRefusalText, mcpRequestOf, mcpStatusOf, notChangedResult, reconcileMcp, skippedResult, turnedOffResult, turnedOnResult, unmarkMcp, trustClearedResult, trustedResult, trustNotChangedResult, trustPreviewOf, trustRefusedResult, trustRequest, TRUST_COPY, type McpRowView, type McpTrustUi, type McpUi } from '../core/mcp-servers.js';

/* ── C5'b: the trust preview flow (no DOM; modelled on ui/tier-picker.ts TierFlow) ─────────────────────────────── */

export interface TrustFlowDeps {
  /** log.append of one request; throws RpcError on a refusal */
  call: (req: { kind: string; payload: Record<string, unknown> }) => Promise<unknown>;
  repaint: () => void;
  now: () => number;
  /** a one-shot timer; returns its cancel (default setTimeout) */
  timer?: (fn: () => void, ms: number) => () => void;
  /** a server's row (for the refusal words' where) */
  row: (id: string) => McpRowView | null;
}

/**
 * C5'b: one trust preview at a time, under its server's row. The preview's single-use token is held HERE, never in the
 * view state, and only while the panel is open and Trust · root card has not been pressed. A commit is sent once and
 * never retried (a double press finds no token); at expiresAt (or on a stale refusal) the key becomes Preview again.
 */
export class TrustFlow {
  readonly #d: TrustFlowDeps;
  #s: McpTrustUi | null = null;
  #token: string | null = null;
  #gen = 0;
  #cancelTimer: (() => void) | null = null;

  constructor(d: TrustFlowDeps) {
    this.#d = d;
  }

  view(): McpTrustUi | null {
    return this.#s ? { ...this.#s, reads: [...this.#s.reads] } : null;
  }

  /** Trust…: the panel opens at once (Checking…) and the preview is sent (a trusted press only). */
  open(id: string, name: string, trusted: boolean): boolean {
    if (!trusted || (this.#s && this.#s.id !== id)) return false; // G-GUI-04; one panel at a time
    if (this.#s && (this.#s.phase === 'committing' || this.#s.phase === 'pending')) return false;
    this.#drop();
    this.#s = { id, name, phase: 'checking', notice: null, reads: [], expiresAt: null, result: null, cardId: null };
    void this.#preview();
    return true;
  }

  /** Preview again (expired or stale): a new preview, never a commit. */
  again(trusted: boolean): boolean {
    const s = this.#s;
    if (!trusted || !s || s.phase !== 'expired') return false;
    this.#drop();
    s.phase = 'checking';
    s.result = null;
    void this.#preview();
    return true;
  }

  /** Trust · root card: commits the token ONCE (a second press finds no token and sends nothing). */
  async commit(trusted: boolean): Promise<'pending' | 'refused' | 'expired' | null> {
    const s = this.#s;
    if (!trusted || !s || s.phase !== 'ready' || !this.#token) return null;
    const token = this.#token;
    this.#token = null;
    this.#stopTimer();
    s.phase = 'committing';
    this.#d.repaint();
    const gen = this.#gen;
    let v: unknown;
    try {
      v = await this.#d.call(trustRequest(s.id, 'commit', token));
    } catch (err) {
      if (gen !== this.#gen || this.#s !== s) return null;
      return this.#failed(s, err);
    }
    if (gen !== this.#gen || this.#s !== s) return null;
    const r = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
    if (r.pending === true && typeof r.cardId === 'string') {
      // a repeat commit returns the same card: the same request row
      s.phase = 'pending';
      s.cardId = r.cardId;
      this.#d.repaint();
      return 'pending';
    }
    s.phase = 'refused';
    s.result = { lead: 'Not changed:', text: ' the kernel’s answer was not one the page reads · next: close Settings and open it again', fail: true };
    this.#d.repaint();
    return 'refused';
  }

  /** Cancel or Esc: the token is dropped. A commit in flight, or a card waiting, keeps the panel. */
  cancel(): boolean {
    const s = this.#s;
    if (!s || s.phase === 'committing' || s.phase === 'pending') return false;
    this.#drop();
    this.#s = null;
    this.#d.repaint();
    return true;
  }

  /** A kernel row: our trust card decided or expired. Returns the outcome (the panel closes) or null. */
  outcome(r: { kind: string; payload?: unknown }): { id: string; name: string; reads: number; allowed: boolean; why: 'denied' | 'expired' } | null {
    const s = this.#s;
    const p = (r.payload && typeof r.payload === 'object' ? r.payload : {}) as Record<string, unknown>;
    if (!s || s.phase !== 'pending' || !s.cardId || p.cardId !== s.cardId || (r.kind !== 'approval.decide' && r.kind !== 'approval.expire')) return null;
    this.#drop();
    this.#s = null;
    const allowed = r.kind === 'approval.decide' && p.decision === 'allow';
    return { id: s.id, name: s.name, reads: s.reads.length, allowed, why: r.kind === 'approval.expire' ? 'expired' : 'denied' };
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
      v = await this.#d.call(trustRequest(s.id, 'preview'));
    } catch (err) {
      if (gen === this.#gen && this.#s === s) this.#failed(s, err);
      return;
    }
    if (gen !== this.#gen || this.#s !== s) return; // cancelled or superseded meanwhile: its token is never held
    const p = trustPreviewOf(v);
    if (!p) {
      s.phase = 'refused';
      s.result = { lead: 'Not changed:', text: ' the kernel’s preview was not one the page reads · next: close Settings and open it again', fail: true };
      return this.#d.repaint();
    }
    s.notice = p.notice;
    s.reads = p.reads;
    s.expiresAt = p.expiresAt;
    s.phase = 'ready';
    this.#token = p.token;
    const ms = p.expiresAt ? Date.parse(p.expiresAt) - this.#d.now() : NaN;
    if (Number.isFinite(ms)) {
      const timer = this.#d.timer ?? ((fn: () => void, t: number) => {
        const h = setTimeout(fn, t);
        return () => clearTimeout(h);
      });
      // no ticking countdown: at expiresAt the key becomes Preview again
      this.#cancelTimer = timer(() => {
        if (gen !== this.#gen || this.#s !== s || s.phase !== 'ready') return;
        this.#token = null;
        this.#cancelTimer = null;
        this.#expired(s);
      }, Math.max(0, ms));
    }
    this.#d.repaint();
  }

  #expired(s: McpTrustUi): void {
    s.phase = 'expired';
    s.result = { lead: 'Not changed:', text: ` ${TRUST_COPY.expired.replace(/^Not changed: /, '')} next: ${TRUST_COPY.again}.` };
    this.#d.repaint();
  }

  /** A refusal or a transport failure. stale: Preview again; else the table's words (never the code). */
  #failed(s: McpTrustUi, err: unknown): 'refused' | 'expired' {
    this.#token = null;
    this.#stopTimer();
    const data = err instanceof RpcError ? (err.refusal as { data?: Record<string, unknown> | null }).data : null;
    const why = data && typeof data.why === 'string' ? data.why : null;
    if (why === 'stale') {
      s.phase = 'expired';
      s.result = { lead: 'Not changed:', text: ` ${TRUST_COPY.stale.replace(/^Not changed: /, '')} next: ${TRUST_COPY.again}.` };
      this.#d.repaint();
      return 'expired';
    }
    s.phase = 'refused';
    s.result = err instanceof RpcError ? trustRefusedResult(why ?? (err.refusal.code === 'FORBIDDEN' ? 'forbidden' : 'unknown'), this.#d.row(s.id) ?? undefined) : { lead: 'Not changed:', text: ' Gnomon did not answer · next: check the connection (⌘K, Reconnect), then press Trust… again', fail: true };
    if (why === 'forbidden' || (err instanceof RpcError && err.refusal.code === 'FORBIDDEN')) s.result = { lead: 'Not changed:', text: ' only you can trust a server, from Settings on this Mac · next: press Trust… again here', fail: true };
    this.#d.repaint();
    return 'refused';
  }
}


export interface McpDeps {
  /** log.append of one request; throws RpcError on a refusal */
  call: (req: { kind: string; payload: Record<string, unknown> }) => Promise<unknown>;
  status: () => unknown;
  /** the focused session */
  hsid: () => string | null;
  now: () => number;
  time: (iso: string) => string;
  refreshStatus: () => Promise<void>;
  repaint: () => void;
  /** close the sheet and focus the card group (never its Allow) */
  decide: (cardId: string) => void;
  /** after a press's outcome: move focus to this selector inside the section (Mika: never an off-screen heading) */
  focus?: (selector: string) => void;
  /** this page's kernel connection (hello connId): a skip is shown only to the connection that decided its card */
  connId?: () => string | null;
  /** C5'b: the data-lm-act of the focused key inside the section (null: focus is elsewhere) */
  focused?: () => string | null;
  /** C5'b: the trust preview's expiry timer (default setTimeout) */
  timer?: TrustFlowDeps['timer'];
}

const iso = (ms: number): string => new Date(ms).toISOString();
const sel = (act: string, value: string): string => `[data-lm-act="${act}"][data-lm-value="${value.replace(/["\\]/g, '\\$&')}"]`;

export class McpServersController {
  readonly #d: McpDeps;
  #ui: McpUi = emptyMcpUi();
  #name = '';
  /** the names on our waiting card, by server id */
  #names = new Map<string, string>();

  readonly #trust: TrustFlow;

  constructor(d: McpDeps) {
    this.#d = d;
    this.#trust = new TrustFlow({ call: d.call, now: d.now, row: (id) => this.#row(id), ...(d.timer ? { timer: d.timer } : {}), repaint: () => this.#trustPaint() });
  }

  ui(): McpUi {
    return { ...this.#ui, trust: this.#trust.view() };
  }

  /** the flow (tests) */
  get trust(): TrustFlow {
    return this.#trust;
  }

  /**
   * C5'b focus: a repaint while focus is in the trust panel (or on its Trust… key) moves it to the panel's primary key
   * for the phase: Trust · root card, Preview again, Cancel (refused), Decide in the stack (pending). A busy key is
   * aria-disabled, so it keeps its focus; focus elsewhere in the sheet is never taken.
   */
  #trustPaint(): void {
    const was = this.#d.focused?.() ?? null;
    this.#d.repaint();
    const t = this.#trust.view();
    if (!t || !was || !was.startsWith('mcp:trust')) return;
    const to = t.phase === 'pending' && t.cardId ? sel('mcp:decide', t.cardId) : t.phase === 'expired' ? sel('mcp:trust-again', t.id) : t.phase === 'refused' ? sel('mcp:trust-cancel', t.id) : sel('mcp:trust-commit', t.id);
    this.#d.focus?.(to);
  }

  /** Esc inside the sheet: the trust panel closes first, focus back on its Trust… key. */
  escape(): boolean {
    const t = this.#trust.view();
    if (!t || !this.#trust.cancel()) return false;
    this.#d.focus?.(sel('mcp:trust', t.id));
    return true;
  }

  /** The sheet closed: an open preview's token is dropped (a waiting card stays in the stack). */
  sheetClosed(): void {
    this.#trust.cancel();
  }

  /** C5'b: Trust…, Trust · root card, Preview again, Cancel, Clear trust. */
  #trustPress(act: string, value: string): void {
    if (act === 'mcp:trust') {
      const r = this.#row(value);
      // a passing refusal keeps the key aria-disabled: its press does nothing (the row's how line says why)
      if (!r || r.trust?.level !== 'untrusted' || r.trust.why || this.#ui.busy) return;
      this.#ui = { ...this.#ui, result: this.#ui.at === value ? null : this.#ui.result };
      this.#trust.open(r.id, r.name, true);
      return;
    }
    if (act === 'mcp:trust-commit') return void this.#trust.commit(true);
    if (act === 'mcp:trust-again') return void this.#trust.again(true);
    if (act === 'mcp:trust-cancel') {
      const t = this.#trust.view();
      if (t && this.#trust.cancel()) this.#d.focus?.(sel('mcp:trust', t.id));
      return;
    }
    if (act === 'mcp:untrust') {
      if (this.#ui.busy) return;
      const name = this.#row(value)?.name ?? 'the server';
      this.#ui = { ...this.#ui, at: value, busy: `mcp:untrust|${value}`, result: null };
      this.#d.repaint();
      void this.#clear(value, name);
    }
  }

  async #clear(id: string, name: string): Promise<void> {
    const at = this.#d.time(iso(this.#d.now()));
    try {
      await this.#d.call(trustRequest(id, 'clear'));
      this.#ui = { ...this.#ui, busy: null, result: trustClearedResult(name, at) };
    } catch (err) {
      const text = err instanceof RpcError && err.refusal ? mcpRefusalText(err.refusal as never) : ' Gnomon did not answer. next: check the connection (⌘K, Reconnect), then press it again.';
      this.#ui = { ...this.#ui, busy: null, result: { lead: 'Not changed:', text, fail: true } };
    }
    await this.#d.refreshStatus().catch(() => undefined);
    this.#d.repaint();
    this.#d.focus?.(`[data-lm-value="${id.replace(/["\\]/g, '\\$&')}"]:not([disabled])`);
  }

  /** status changed: drop marks for servers gone, broken, or already on */
  reconcile(): void {
    this.#ui = reconcileMcp(this.#ui, mcpStatusOf(this.#d.status()));
  }

  #row(id: string): McpRowView | null {
    const v = mcpStatusOf(this.#d.status());
    return [...v.servers, ...v.repos.flatMap((r) => r.servers)].find((r) => r.id === id) ?? null;
  }

  #repo(): { repo: string; folder: string } | null {
    const h = this.#d.hsid();
    if (!h) return null;
    const r = mcpStatusOf(this.#d.status()).repos.find((x) => x.hsids.includes(h));
    return r ? { repo: r.repo, folder: r.folder } : null;
  }

  press(act: string, value: string | null, trusted: boolean): void {
    if (!trusted || value === null) return; // G-GUI-04
    if (act === 'mcp:decide') return this.#d.decide(value);
    if (act.startsWith('mcp:trust') || act === 'mcp:untrust') return this.#trustPress(act, value);
    if (this.#ui.busy) return;
    if (act === 'mcp:marking') {
      this.#ui = startMarking(this.#ui);
      this.#d.repaint();
      // the next press is a Mark key: focus the first one (it is a screen up; the sheet scrolls it into view)
      return this.#d.focus?.('[data-lm-act^="mcp:mark-"]:not([disabled])');
    }
    // #batch-card staging: in the page only, nothing reaches the kernel until Turn on
    if (act === 'mcp:mark-all' || act === 'mcp:mark-repo') {
      const r = this.#row(value);
      const repo = act === 'mcp:mark-repo' ? this.#repo() : null;
      if (!r || (act === 'mcp:mark-repo' && !repo)) return;
      this.#ui = markMcp(this.#ui, { id: r.id, name: r.name, scope: repo ? 'repo' : 'all', repo: repo?.repo ?? null, folder: repo?.folder ?? null }, mcpStatusOf(this.#d.status()).max);
      this.#d.repaint();
      return this.#d.focus?.(sel('mcp:unmark', value));
    }
    if (act === 'mcp:unmark') {
      this.#ui = unmarkMcp(this.#ui, value);
      this.#d.repaint();
      return this.#d.focus?.(`[data-lm-value="${value.replace(/["\\]/g, '\\$&')}"]:not([disabled])`);
    }
    if (act === 'mcp:clear') {
      this.#ui = clearMcp(this.#ui);
      this.#d.repaint();
      // the pressed key is gone: focus the entry to marking it brought back (never the page body)
      // (the sheet prefixes one selector with the section, so no comma list: the fallback first, then Mark several)
      this.#d.focus?.('[data-lm-act^="mcp:on-"]:not([disabled])');
      return this.#d.focus?.('[data-lm-act="mcp:marking"]');
    }
    if (act === 'mcp:enable') {
      const req = mcpBatchRequest(this.#ui);
      if (!req || this.#ui.request || mcpStatusOf(this.#d.status()).pending.length) return; // one card at a time
      this.#ui = { ...this.#ui, at: MCP_BATCH, busy: 'mcp:enable|batch', result: null };
      this.#d.repaint();
      return void this.#sendBatch(req);
    }
    const one = act === 'mcp:on-all' || act === 'mcp:on-repo';
    // one card at a time (the keys are Mark keys while a card waits; this guards a stale press)
    if (one && (this.#ui.request || mcpStatusOf(this.#d.status()).pending.length)) return;
    const req = mcpRequestOf(act, value, act === 'mcp:on-repo' ? (this.#repo()?.repo ?? null) : null);
    if (!req) return;
    const name = act.startsWith('mcp:fp-') ? 'the Paradigm MCP' : (this.#row(value)?.name ?? 'the server');
    this.#name = name;
    this.#ui = { ...this.#ui, at: act.startsWith('mcp:fp-') ? MCP_FIRST_PARTY : value, busy: `${act}|${value}`, result: null };
    this.#d.repaint();
    void this.#send(act, req, name);
  }

  async #sendBatch(req: { kind: string; payload: { servers: Array<Record<string, unknown>> } }): Promise<void> {
    const at = this.#d.time(iso(this.#d.now()));
    const marked = this.#ui.staged;
    const names = marked.map((m) => m.name).join(', ');
    try {
      const r = (await this.#d.call(req)) as Record<string, unknown> | null;
      if (r && r.pending === true && typeof r.cardId === 'string') {
        const ids = Array.isArray(r.ids) ? r.ids.filter((x): x is string => typeof x === 'string') : marked.map((m) => m.id);
        this.#names = new Map(marked.filter((m) => ids.includes(m.id)).map((m) => [m.id, m.name]));
        this.#name = [...this.#names.values()].join(', ') || names;
        const line = `${at} · turn on ${marked.filter((m) => ids.includes(m.id)).map((m) => `${m.name} · ${m.scope === 'all' ? 'all repos' : (m.folder ?? 'this folder')}`).join(', ')}`;
        // the marks moved onto the card: the page is free to mark the next batch
        this.#ui = { ...this.#ui, busy: null, result: null, staged: [], marking: false, request: { cardId: r.cardId, line, ids } };
      } else {
        // every marked server was on already: no card
        this.#ui = { ...this.#ui, busy: null, staged: [], marking: false, request: null, result: turnedOnResult(names, at) };
      }
    } catch (err) {
      // a refusal keeps every mark (the Rules view's rule) and says why in plain words with next:
      const text = err instanceof RpcError && err.refusal ? mcpRefusalText(err.refusal as never) : ' Gnomon did not answer. next: check the connection (⌘K, Reconnect), then press it again.';
      this.#ui = { ...this.#ui, busy: null, request: null, result: { lead: 'Not changed:', text, fail: true } };
    }
    await this.#d.refreshStatus().catch(() => undefined);
    this.reconcile();
    this.#d.repaint();
    this.#d.focus?.(this.#ui.request ? '[data-lm-act="mcp:decide"]' : '[data-lm-act="mcp:enable"]:not([disabled])');
  }

  async #send(act: string, req: { kind: string; payload: Record<string, unknown> }, name: string): Promise<void> {
    const at = this.#d.time(iso(this.#d.now()));
    try {
      const r = (await this.#d.call(req)) as Record<string, unknown> | null;
      const id = String(req.payload.id ?? '');
      if (r && r.pending === true && typeof r.cardId === 'string') {
        // one server's root card: its request row shows under that server's row
        const scope = req.payload.scope === 'all' ? 'all repos' : (this.#repo()?.folder ?? String(req.payload.repo ?? '').split(/[\\/]/).pop());
        this.#names = new Map([[id, name]]);
        this.#ui = { ...this.#ui, busy: null, result: null, request: { cardId: r.cardId, line: `${at} · turn on ${name} · ${scope}`, ids: [id] } };
      } else this.#ui = { ...this.#ui, busy: null, result: act === 'mcp:off' || act === 'mcp:fp-off' ? turnedOffResult(name, at) : turnedOnResult(name, at) };
    } catch (err) {
      const text = err instanceof RpcError && err.refusal ? mcpRefusalText(err.refusal as never) : ' Gnomon did not answer. next: check the connection (⌘K, Reconnect), then press it again.';
      this.#ui = { ...this.#ui, busy: null, result: { lead: 'Not changed:', text, fail: true } };
    }
    await this.#d.refreshStatus().catch(() => undefined);
    this.reconcile();
    this.#d.repaint();
    // focus follows the outcome: the card's Decide key, else the same server's first key (the result line under it is a
    // status announcement); never the section heading a screen above the press
    const id = this.#ui.at ?? '';
    this.#d.focus?.(this.#ui.request ? '[data-lm-act="mcp:decide"]' : `[data-lm-value="${id.replace(/["\\]/g, '\\$&')}"]:not([disabled])`);
  }

  /** A kernel row: our card's outcome. */
  row(r: { kind: string; at?: string; payload?: unknown }): void {
    // C5'b: our trust card's outcome, under its server's row; focus on that server's first key
    const out = this.#trust.outcome(r);
    if (out) {
      const at = this.#d.time(r.at ?? iso(this.#d.now()));
      this.#ui = { ...this.#ui, at: out.id, result: out.allowed ? trustedResult(out.name, at, out.reads) : trustNotChangedResult(out.name, at, out.why) };
      void this.#d
        .refreshStatus()
        .catch(() => undefined)
        .then(() => {
          this.#d.repaint();
          this.#d.focus?.(`[data-lm-value="${out.id.replace(/["\\]/g, '\\$&')}"]:not([disabled])`);
        });
      return;
    }
    // C5'b: a trust row (set, cleared, dropped) changes the rows' chips and keys: re-read status
    if (r.kind === 'tool.trust') {
      void this.#d
        .refreshStatus()
        .catch(() => undefined)
        .then(() => this.#d.repaint());
      return;
    }
    const req = this.#ui.request;
    const p = (r.payload && typeof r.payload === 'object' ? r.payload : {}) as Record<string, unknown>;
    if (!req || p.cardId !== req.cardId || (r.kind !== 'approval.decide' && r.kind !== 'approval.expire')) return;
    const at = this.#d.time(r.at ?? iso(this.#d.now()));
    const allowed = r.kind === 'approval.decide' && p.decision === 'allow';
    const cardId = req.cardId;
    // a one-server card's outcome shows under that server; a batch's with the batch
    const only = (req.ids ?? []).length === 1 ? req.ids![0]! : null;
    this.#ui = { ...this.#ui, at: only ?? MCP_BATCH, busy: null, request: null, result: allowed ? turnedOnResult(this.#name, at) : notChangedResult(this.#name, at, r.kind === 'approval.expire' ? 'expired' : 'denied') };
    void this.#d
      .refreshStatus()
      .catch(() => undefined)
      .then(() => {
        // #batch-card: the kernel names the servers it skipped at allow (changed while the card waited), per card;
        // the servers that did turn on are the kernel's `on`, never this page's guess
        const sk = allowed ? mcpStatusOf(this.#d.status()).skips.find((s) => s.cardId === cardId) : undefined;
        if (sk) {
          const nameOf = (id: string): string => this.#names.get(id) ?? this.#row(id)?.name ?? 'a server';
          const on = sk.on.map(nameOf);
          const mine = !!sk.connId && sk.connId === (this.#d.connId?.() ?? null);
          // only the connection that decided the card is told what it skipped (another window's Allow is its own);
          // here the result names only what the kernel says turned on, and nothing when none did
          this.#ui = { ...this.#ui, result: mine ? skippedResult(on, sk.names, at) : on.length ? turnedOnResult(on.join(', '), at) : null };
        }
        this.reconcile();
        this.#d.repaint();
      });
  }
}
