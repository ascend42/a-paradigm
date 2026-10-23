/**
 * @symbol #gui-mcp-servers
 *
 * #gui-mcp-servers, the press path of the Settings sheet's MCP servers section (the words and the views are
 * core/mcp-servers.ts; the DOM is ui/settings-sheet.ts). No DOM here, so the flow is tested without a browser.
 *
 *   - Every press needs the human's own gesture (G-GUI-04); a script-made press changes nothing.
 *   - One press at a time; while a card waits, the request row with Decide in the stack replaces the result line.
 *   - On for all repos / On in <folder>: request.mcp.enable raises the root card; Decide closes the sheet and focuses
 *     the card group, never its Allow (rule form-says-where-the-card-is).
 *   - Turn off: request.mcp.disable, no card. The first-party Paradigm MCP turns off and on the same way.
 *   - The card's outcome comes from the kernel's rows (approval.decide / approval.expire for OUR card).
 */
import { RpcError } from '../core/client.js';
import { emptyMcpUi, MCP_FIRST_PARTY, mcpRefusalText, mcpRequestOf, mcpStatusOf, notChangedResult, turnedOffResult, turnedOnResult, type McpRowView, type McpUi } from '../core/mcp-servers.js';

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
}

const iso = (ms: number): string => new Date(ms).toISOString();

export class McpServersController {
  readonly #d: McpDeps;
  #ui: McpUi = emptyMcpUi();
  #name = '';

  constructor(d: McpDeps) {
    this.#d = d;
  }

  ui(): McpUi {
    return this.#ui;
  }

  #row(id: string): McpRowView | null {
    const v = mcpStatusOf(this.#d.status());
    return [...v.servers, ...v.repos.flatMap((r) => r.servers)].find((r) => r.id === id) ?? null;
  }

  #repo(): string | null {
    const h = this.#d.hsid();
    if (!h) return null;
    return mcpStatusOf(this.#d.status()).repos.find((r) => r.hsids.includes(h))?.repo ?? null;
  }

  press(act: string, value: string | null, trusted: boolean): void {
    if (!trusted || value === null) return; // G-GUI-04
    if (act === 'mcp:decide') return this.#d.decide(value);
    if (this.#ui.busy || this.#ui.request) return;
    const req = mcpRequestOf(act, value, this.#repo());
    if (!req) return;
    const name = act.startsWith('mcp:fp-') ? 'the Paradigm MCP' : (this.#row(value)?.name ?? 'the server');
    this.#name = name;
    this.#ui = { ...this.#ui, at: act.startsWith('mcp:fp-') ? MCP_FIRST_PARTY : value, busy: `${act}|${value}`, result: null };
    this.#d.repaint();
    void this.#send(act, req, name);
  }

  async #send(act: string, req: { kind: string; payload: Record<string, unknown> }, name: string): Promise<void> {
    const at = this.#d.time(iso(this.#d.now()));
    try {
      const r = (await this.#d.call(req)) as Record<string, unknown> | null;
      if (r && r.pending === true && typeof r.cardId === 'string') {
        const scope = req.payload.scope === 'all' ? 'all repos' : String(req.payload.repo ?? '').split(/[\\/]/).pop();
        this.#ui = { ...this.#ui, busy: null, result: null, request: { cardId: r.cardId, line: `${at} · turn on ${name} · ${scope}` } };
      } else if (act === 'mcp:off' || act === 'mcp:fp-off') this.#ui = { ...this.#ui, busy: null, request: null, result: turnedOffResult(name, at) };
      else this.#ui = { ...this.#ui, busy: null, request: null, result: turnedOnResult(name, at) };
    } catch (err) {
      const text = err instanceof RpcError && err.refusal ? mcpRefusalText(err.refusal as never) : ' Gnomon did not answer. next: check the connection (⌘K, Reconnect), then press it again.';
      this.#ui = { ...this.#ui, busy: null, request: null, result: { lead: 'Not changed:', text, fail: true } };
    }
    await this.#d.refreshStatus().catch(() => undefined);
    this.#d.repaint();
    // focus follows the outcome: the card's Decide key, else the same server's first key (the result line under it is
    // a status announcement); never the section heading a screen above the press
    const id = this.#ui.at ?? '';
    this.#d.focus?.(this.#ui.request ? '[data-lm-act="mcp:decide"]' : `[data-lm-value="${id.replace(/["\\]/g, '\\$&')}"]:not([disabled])`);
  }

  /** A kernel row: our card's outcome. */
  row(r: { kind: string; at?: string; payload?: unknown }): void {
    const req = this.#ui.request;
    const p = (r.payload && typeof r.payload === 'object' ? r.payload : {}) as Record<string, unknown>;
    if (!req || p.cardId !== req.cardId || (r.kind !== 'approval.decide' && r.kind !== 'approval.expire')) return;
    const at = this.#d.time(r.at ?? iso(this.#d.now()));
    this.#ui = { ...this.#ui, busy: null, request: null, result: r.kind === 'approval.decide' && p.decision === 'allow' ? turnedOnResult(this.#name, at) : notChangedResult(this.#name, at, r.kind === 'approval.expire' ? 'expired' : 'denied') };
    void this.#d.refreshStatus().catch(() => undefined).then(() => this.#d.repaint());
  }
}
