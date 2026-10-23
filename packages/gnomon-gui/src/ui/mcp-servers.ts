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
 */
import { RpcError } from '../core/client.js';
import { clearMcp, emptyMcpUi, markMcp, startMarking, MCP_BATCH, MCP_FIRST_PARTY, mcpBatchRequest, mcpRefusalText, mcpRequestOf, mcpStatusOf, notChangedResult, reconcileMcp, skippedResult, turnedOffResult, turnedOnResult, unmarkMcp, type McpRowView, type McpUi } from '../core/mcp-servers.js';

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
}

const iso = (ms: number): string => new Date(ms).toISOString();
const sel = (act: string, value: string): string => `[data-lm-act="${act}"][data-lm-value="${value.replace(/["\\]/g, '\\$&')}"]`;

export class McpServersController {
  readonly #d: McpDeps;
  #ui: McpUi = emptyMcpUi();
  #name = '';
  /** the names on our waiting card, by server id */
  #names = new Map<string, string>();

  constructor(d: McpDeps) {
    this.#d = d;
  }

  ui(): McpUi {
    return this.#ui;
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
