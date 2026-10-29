/**
 * @symbol #gui-capability-browser
 *
 * #gui-capability-browser, the "Tools and memory" drawer's DOM and press paths (the words and the views are
 * core/tools-drawer.ts). ToolsFlow (no DOM, modelled on TierFlow and TrustFlow) holds the drawer's state and sends the
 * requests; mountToolsDrawer paints it with core/render.ts h() (text nodes only, allowlisted attributes) reusing the
 * Settings sheet's readonly rows with keys (ui/settings-sheet.ts rowEl) and the Rules block's fold.
 *
 *   - The drawer is the sheet's drawer variant (`.overlay.vs-drawer`, as Voice settings): role dialog, aria-modal. It
 *     opens focused on its heading; Tab stays inside (the shared trapTab, imported, never copied); Esc closes it and
 *     focus returns to the opener. The seg keys Tools · Memory are a radiogroup driven by the arrow keys.
 *   - One persistent role=status line from open ("Pinned grep; offered from the next step", "Memory deleted").
 *   - A disabled key is aria-disabled (it keeps its focus; the flow ignores its press), draws the quiet look, and has a
 *     visible why line linked by aria-describedby: never a tooltip only.
 *   - Every request is sent only on a trusted event (G-GUI-04), the reads excepted: a re-read when a tool.selection or a
 *     session.mcp row of the open session arrives is read only (request.session.capabilities sends nothing anywhere).
 *   - A pin, a restart and a delete are sent once: a second press while one is in flight sends nothing.
 */
import { RpcError } from '../core/client.js';
import { h, type MiniDoc, type MiniEl } from '../core/render.js';
import {
  capabilitiesOf,
  capabilitiesRequest,
  drawerMeta,
  emptyKeptUi,
  emptyMemoryUi,
  keptOf,
  memoryDeleteRequest,
  memoryListRequest,
  memoryOf,
  memoryReadRequest,
  memoryView,
  pinKeyOf,
  pinLive,
  pinRequest,
  policyRequest,
  refusalWords,
  restartRequest,
  selectionHintsOf,
  toggleFold,
  toolsView,
  TOOLS_COPY,
  type Access,
  type DrawerRequest,
  type DrawerUi,
  type KeptUi,
  type MemoryView,
  type Seg,
  type ToolsView,
} from '../core/tools-drawer.js';
import type { FormKey, ResultView, SettingRow } from '../core/settings.js';
import { keyEl, resultEl, rowEl } from './settings-sheet.js';
import { trapTab } from './tier-picker.js';

interface RowLike {
  kind: string;
  payload?: unknown;
}

/** Where focus goes after a state lands (the DOM finds it after the repaint). */
export type DrawerFocus = { act: string; value?: string } | { heading: 'drawer' | Seg | 'pins' | 'servers' } | { result: true };

/* ── the flow (no DOM) ───────────────────────────────────────────────────────────────────────────────────────────── */

export interface ToolsFlowDeps {
  /** log.append of one request; throws RpcError on a refusal */
  call: (req: DrawerRequest) => Promise<unknown>;
  repaint: () => void;
  /** the drawer's one live line */
  live: (text: string) => void;
  /** "12:53" now */
  now: () => string;
  /** the session's rows (found and recent words) */
  rows?: (hsid: string) => Iterable<RowLike>;
}

const reasonOf = (err: unknown): { reason: string | null; data: Record<string, unknown> | null } | null => (err instanceof RpcError ? { reason: err.refusal.reason, data: err.refusal.data } : null);

export class ToolsFlow {
  readonly #d: ToolsFlowDeps;
  #s: DrawerUi | null = null;
  /** bumped on every open and close: an answer for an older drawer is dropped */
  #gen = 0;
  #toolsRead = 0;
  #memRead = 0;
  #focus: DrawerFocus | null = null;
  /** where focus goes once the tools are read (the toast's "see Tools": the server's Restart key) */
  #after: DrawerFocus | null = null;

  constructor(d: ToolsFlowDeps) {
    this.#d = d;
  }

  state(): Readonly<DrawerUi> | null {
    return this.#s;
  }

  tools(): ToolsView | null {
    const s = this.#s;
    return s ? toolsView(s, selectionHintsOf(this.#d.rows?.(s.hsid) ?? [], s.hsid)) : null;
  }

  memory(): MemoryView | null {
    return this.#s ? memoryView(this.#s) : null;
  }

  /** Where focus should go now (taken once). */
  takeFocus(): DrawerFocus | null {
    const f = this.#focus;
    this.#focus = null;
    return f;
  }

  /** Open the drawer for a session (a trusted press only): both segments are read at once. */
  open(o: { hsid: string; title: string; access: Access }, seg: Seg | null, trusted: boolean, after: DrawerFocus | null = null): boolean {
    if (!trusted) return false; // G-GUI-04
    this.#gen++;
    this.#after = after;
    const at: Seg = seg ?? (o.access === 'ended' ? 'memory' : 'tools');
    this.#s = { ...o, seg: at, phase: 'reading', caps: null, updatedAt: null, filter: '', folds: new Map(), pinBusy: null, restarting: new Set(), serverResult: null, pinResult: null, memory: emptyMemoryUi() };
    this.#focus = { heading: 'drawer' };
    this.#d.live('');
    this.#d.repaint();
    if (o.access === 'owner') void this.readTools();
    if (o.access !== 'not-owner') void this.readMemory();
    return true;
  }

  close(): boolean {
    if (!this.#s) return false;
    this.#gen++;
    this.#s = null;
    this.#d.repaint();
    return true;
  }

  setSeg(seg: Seg): void {
    const s = this.#s;
    if (!s || s.seg === seg) return;
    s.seg = seg;
    this.#d.repaint();
  }

  /** Read again (a trusted press), or a re-read when the session's tools moved (`why`: 'selection' | 'server'). */
  async readTools(why: 'open' | 'selection' | 'server' = 'open'): Promise<void> {
    const s = this.#s;
    if (!s || s.access !== 'owner') return;
    const gen = this.#gen;
    const n = ++this.#toolsRead;
    if (!s.caps) s.phase = 'reading';
    let v: unknown;
    try {
      v = await this.#d.call(capabilitiesRequest(s.hsid));
    } catch (err) {
      if (gen !== this.#gen || n !== this.#toolsRead || this.#s !== s) return;
      // not-found: the session is not running any more (its tools are gone; its memory may be kept)
      if (err instanceof RpcError && err.refusal.reason === 'not-found') s.access = 'ended';
      else s.phase = err instanceof RpcError ? 'unreadable' : 'unreachable';
      return this.#d.repaint();
    }
    if (gen !== this.#gen || n !== this.#toolsRead || this.#s !== s) return;
    const c = capabilitiesOf(v, s.hsid);
    if (!c) {
      s.phase = 'unreadable';
      return this.#d.repaint();
    }
    const before = s.caps?.generation ?? null;
    s.caps = c;
    s.phase = 'loaded';
    // "updated 12:53": a re-read that found the generation moved, or a server row (its state changed)
    if (why === 'server' || (why === 'selection' && before !== null && before !== c.generation)) s.updatedAt = this.#d.now();
    if (this.#after && s.seg === 'tools') {
      this.#focus = this.#after;
      this.#after = null;
    }
    this.#d.repaint();
  }

  async readMemory(): Promise<void> {
    const s = this.#s;
    if (!s || s.access === 'not-owner') return;
    const gen = this.#gen;
    const n = ++this.#memRead;
    let v: unknown;
    try {
      v = await this.#d.call(memoryReadRequest(s.hsid));
    } catch (err) {
      if (gen !== this.#gen || n !== this.#memRead || this.#s !== s) return;
      if (err instanceof RpcError && err.refusal.reason === 'not-found') {
        s.memory = { ...s.memory, phase: 'loaded', entries: [] };
      } else s.memory = { ...s.memory, phase: err instanceof RpcError ? 'unreadable' : 'unreachable' };
      return this.#d.repaint();
    }
    if (gen !== this.#gen || n !== this.#memRead || this.#s !== s) return;
    const m = memoryOf(v, s.hsid);
    s.memory = m ? { ...s.memory, phase: 'loaded', entries: m.entries } : { ...s.memory, phase: 'unreadable' };
    this.#d.repaint();
  }

  /** A row of the log: the open session's tool.selection or session.mcp re-reads its tools; session.memory its memory. */
  row(r: RowLike): void {
    const s = this.#s;
    const p = r.payload && typeof r.payload === 'object' ? (r.payload as Record<string, unknown>) : null;
    if (!s || !p || p.hsid !== s.hsid) return;
    // C6'b2-2: a sent result or a skill's text taints the session; a policy row moves a tool's words: re-read
    if (r.kind === 'tool.selection' || r.kind === 'tool.result.sent' || r.kind === 'skill.run' || r.kind === 'tool.result.policy') void this.readTools('selection');
    else if (r.kind === 'session.mcp') void this.readTools('server');
    else if (r.kind === 'session.memory' && !s.memory.deleting && s.memory.phase !== 'reading') void this.readMemory();
  }

  filter(text: string): void {
    const s = this.#s;
    if (!s) return;
    s.filter = text.slice(0, 120);
    this.#d.repaint();
  }

  fold(label: string, trusted: boolean): void {
    const s = this.#s;
    if (!trusted || !s) return;
    const g = this.tools()?.all?.groups.find((x) => x.label === label);
    if (!g?.foldable) return;
    s.folds = toggleFold(s.folds, label, g.folded);
    this.#focus = { act: 'fold', value: label };
    this.#d.repaint();
  }

  /** Pin or unpin a tool, once (a press while a pin is in flight, or on an aria-disabled Pin, sends nothing). */
  async pin(name: string, pinned: boolean, trusted: boolean, from: 'all' | 'pins' = 'all'): Promise<void> {
    const s = this.#s;
    if (!trusted || !s || !s.caps || s.pinBusy || s.access !== 'owner') return;
    const isPinned = s.caps.pins.some((p) => p.name === name);
    if (pinned === isPinned) return;
    if (pinned) {
      const t = s.caps.tools.find((x) => x.name === name);
      if (!t || pinKeyOf(t, s, s.caps.pins).key?.ariaDisabled) return;
    }
    s.pinBusy = name;
    s.pinResult = null;
    this.#d.repaint();
    const gen = this.#gen;
    try {
      await this.#d.call(pinRequest(s.hsid, name, pinned));
    } catch (err) {
      if (gen !== this.#gen || this.#s !== s) return;
      s.pinBusy = null;
      s.pinResult = { text: refusalWords('pin', reasonOf(err)), fail: true };
      this.#d.live(s.pinResult.text);
      this.#focus = from === 'pins' ? { heading: 'pins' } : { act: pinned ? 'pin' : 'unpin', value: name };
      return this.#d.repaint();
    }
    if (gen !== this.#gen || this.#s !== s) return;
    await this.readTools('selection');
    if (gen !== this.#gen || this.#s !== s) return;
    s.pinBusy = null;
    const c = s.caps;
    this.#d.live(pinLive(name, pinned, c?.pins.find((p) => p.name === name) ?? null, { tier: c?.tier ?? null, k: c?.k ?? null }));
    // focus stays on the same tool's key (now Unpin or Pin); an unpin from the Pins list loses its row: its heading
    this.#focus = from === 'pins' && !pinned ? { heading: 'pins' } : { act: pinned ? 'unpin' : 'pin', value: name };
    this.#d.repaint();
  }

  /**
   * C6'b2-2: Stop sending — request.session.tools.policy{policy:'ask'} for a tool that sends, once per trusted press
   * (aria-busy while it runs). Focus stays on the tool's row (its Pin key) once the tools are read again.
   */
  async stopSending(id: string, trusted: boolean): Promise<void> {
    const s = this.#s;
    if (!trusted || !s || !s.caps || s.policyBusy || s.access !== 'owner') return;
    const t = s.caps.tools.find((x) => x.id === id);
    if (!t || t.policy !== 'send') return;
    s.policyBusy = id;
    s.policyResult = null;
    this.#d.repaint();
    const gen = this.#gen;
    try {
      await this.#d.call(policyRequest(s.hsid, id, 'ask'));
    } catch (err) {
      if (gen !== this.#gen || this.#s !== s) return;
      s.policyBusy = null;
      s.policyResult = { id, text: refusalWords('stop', reasonOf(err)) };
      this.#d.live(s.policyResult.text);
      // Mika C6'b2-2 #4: read the tools again, so the row shows the kernel's state (not a Stop sending it refused)
      if (err instanceof RpcError) await this.readTools('selection');
      if (gen !== this.#gen || this.#s !== s) return;
      const still = this.tools()?.all?.groups.some((g) => g.rows.some((r) => r.stop?.value === id)) ?? false;
      this.#focus = still ? { act: 'stop-sending', value: id } : { act: s.caps?.pins.some((p) => p.name === t.name) ? 'unpin' : 'pin', value: t.name };
      return this.#d.repaint();
    }
    if (gen !== this.#gen || this.#s !== s) return;
    await this.readTools('selection');
    if (gen !== this.#gen || this.#s !== s) return;
    s.policyBusy = null;
    this.#d.live(TOOLS_COPY.stopped(t.name));
    this.#focus = { act: s.caps?.pins.some((p) => p.name === t.name) ? 'unpin' : 'pin', value: t.name };
    this.#d.repaint();
  }

  /** Restart a failed server, once (aria-busy while it runs). */
  async restart(label: string, trusted: boolean): Promise<void> {
    const s = this.#s;
    if (!trusted || !s || !s.caps || s.restarting.has(label) || s.access !== 'owner') return;
    const srv = s.caps.servers.find((x) => x.label === label);
    if (!srv || srv.state !== 'failed') return;
    s.restarting = new Set([...s.restarting, label]);
    s.serverResult = null;
    this.#d.repaint();
    const gen = this.#gen;
    let result: ResultView;
    try {
      const v = (await this.#d.call(restartRequest(s.hsid, label))) as Record<string, unknown> | null;
      const tools = typeof v?.tools === 'number' ? v.tools : 0;
      result = v && v.state === 'running' ? { lead: 'Restarted', text: ` ${label}: running · ${tools} tool${tools === 1 ? '' : 's'}` } : { lead: 'Not restarted:', text: ` ${label} stopped again${typeof v?.error === 'string' ? `: ${v.error}` : ''}`, fail: true };
    } catch (err) {
      result = { text: refusalWords('restart', reasonOf(err)), fail: true };
    }
    if (gen !== this.#gen || this.#s !== s) return;
    await this.readTools('server');
    if (gen !== this.#gen || this.#s !== s) return;
    const left = new Set(s.restarting);
    left.delete(label);
    s.restarting = left;
    s.serverResult = { label, result };
    this.#d.live(`${result.lead ?? ''}${result.text}`.trim());
    this.#focus = s.caps?.servers.some((x) => x.label === label && x.state === 'failed') ? { act: 'restart', value: label } : { result: true };
    this.#d.repaint();
  }

  /** Delete memory…: the inline confirm (no request). */
  memConfirm(): void {
    const s = this.#s;
    if (!s || s.memory.deleting) return;
    s.memory = { ...s.memory, confirm: true, result: null };
    this.#focus = { act: 'mem-keep' };
    this.#d.repaint();
  }

  memKeep(): void {
    const s = this.#s;
    if (!s || s.memory.deleting || !s.memory.confirm) return;
    s.memory = { ...s.memory, confirm: false };
    this.#focus = { act: 'mem-confirm' };
    this.#d.repaint();
  }

  /** Delete memory (or delete and end the session), once; confirmed first. */
  async memDelete(stop: boolean, trusted: boolean): Promise<void> {
    const s = this.#s;
    if (!trusted || !s || !s.memory.confirm || s.memory.deleting || s.access === 'not-owner') return;
    if (stop && s.access !== 'owner') return;
    s.memory = { ...s.memory, deleting: stop ? 'stop' : 'memory' };
    this.#d.repaint();
    const gen = this.#gen;
    try {
      await this.#d.call(memoryDeleteRequest(s.hsid, stop));
    } catch (err) {
      if (gen !== this.#gen || this.#s !== s) return;
      // a delete lost in transit may have reached the kernel: nothing is claimed
      const text = err instanceof RpcError ? refusalWords('delete', reasonOf(err)) : 'Not known whether it was deleted: the connection dropped · next: Read again once Gnomon is connected';
      s.memory = { ...s.memory, deleting: null, confirm: false, result: { text, fail: true } };
      this.#d.live(text);
      this.#focus = { act: 'mem-confirm' };
      return this.#d.repaint();
    }
    if (gen !== this.#gen || this.#s !== s) return;
    s.memory = { phase: 'gone', entries: [], confirm: false, deleting: null, result: { text: stop ? TOOLS_COPY.memory.doneStopped : TOOLS_COPY.memory.done } };
    if (stop) s.access = 'ended';
    this.#d.live(TOOLS_COPY.memory.doneLive);
    this.#focus = { result: true };
    this.#d.repaint();
  }
}

/* ── Settings › Local model › Kept memory (no DOM) ───────────────────────────────────────────────────────────────── */

export interface KeptFlowDeps {
  call: (req: DrawerRequest) => Promise<unknown>;
  repaint: () => void;
  /** a session's title (the store's), for the row */
  title: (hsid: string) => string;
  /** Open: the drawer on that session's memory */
  open: (hsid: string) => void;
  /** after a press, where focus goes in the Local model section */
  focus?: (f: { act: string; value?: string } | { heading: true }) => void;
}

export class KeptFlow {
  readonly #d: KeptFlowDeps;
  #k: KeptUi = emptyKeptUi();
  #reads = 0;

  constructor(d: KeptFlowDeps) {
    this.#d = d;
  }

  ui(): Readonly<KeptUi> {
    return this.#k;
  }

  /** request.session.memory.list (read only): the ended sessions that keep memory. */
  async read(): Promise<void> {
    const n = ++this.#reads;
    let v: unknown;
    try {
      v = await this.#d.call(memoryListRequest());
    } catch {
      return; // the row stays as it was (or absent): nothing is claimed
    }
    if (n !== this.#reads) return;
    const ids = keptOf(v);
    if (!ids) return;
    this.#k = { ...this.#k, sessions: ids.map((hsid) => ({ hsid, title: this.#d.title(hsid) })) };
    this.#d.repaint();
  }

  /** A `kept:` key of the Settings sheet. */
  press(act: string, hsid: string | null, trusted: boolean): void {
    if (!trusted || !hsid) return; // G-GUI-04
    const k = this.#k;
    if (act === 'kept:open') return this.#d.open(hsid);
    if (k.busy) return;
    if (act === 'kept:delete') {
      this.#k = { ...k, confirm: hsid, result: null };
      this.#d.repaint();
      return this.#d.focus?.({ act: 'kept:keep', value: hsid });
    }
    if (act === 'kept:keep') {
      this.#k = { ...k, confirm: null };
      this.#d.repaint();
      return this.#d.focus?.({ act: 'kept:delete', value: hsid });
    }
    if (act === 'kept:delete-yes' && k.confirm === hsid) void this.#delete(hsid);
  }

  /** Esc in the sheet: an open confirm closes first. */
  escape(): boolean {
    if (!this.#k.confirm || this.#k.busy) return false;
    const hsid = this.#k.confirm;
    this.#k = { ...this.#k, confirm: null };
    this.#d.repaint();
    this.#d.focus?.({ act: 'kept:delete', value: hsid });
    return true;
  }

  async #delete(hsid: string): Promise<void> {
    this.#k = { ...this.#k, busy: hsid };
    this.#d.repaint();
    let result: ResultView;
    let gone = false;
    try {
      await this.#d.call(memoryDeleteRequest(hsid, false));
      result = { lead: 'Deleted:', text: ` the memory of ${this.#d.title(hsid)}. The conversation stays.` };
      gone = true;
    } catch (err) {
      result = { text: err instanceof RpcError ? refusalWords('delete', reasonOf(err)) : 'Not known whether it was deleted: the connection dropped · next: close Settings and open it again', fail: true };
      gone = err instanceof RpcError && err.refusal.reason === 'not-found';
    }
    const sessions = gone ? (this.#k.sessions ?? []).filter((s) => s.hsid !== hsid) : this.#k.sessions;
    this.#k = { ...this.#k, sessions, busy: null, confirm: null, result };
    this.#d.repaint();
    this.#d.focus?.({ heading: true });
  }
}

/* ── the DOM ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

interface Caller {
  call<T = unknown>(method: string, params?: unknown): Promise<T>;
}
export interface ToolsDrawerDeps {
  client: () => Caller | null;
  /** who may see what of a session (core/tools-drawer.ts drawerAccess), and its title; null: not a local attended one */
  session: (hsid: string) => { access: Access; title: string } | null;
  rows: (hsid: string) => Iterable<RowLike>;
  /** "12:53" */
  now: () => string;
  /** Change tier…: the session's tier key menu (false when there is none) */
  openTier: (hsid: string) => boolean;
  /** Stage in Settings: Settings at its MCP servers section */
  openSettings: () => void;
}
export interface ToolsDrawer {
  /** open on a session (a trusted press), at a segment; focus returns to `opener` (default: the focused element) */
  open(hsid: string, seg: Seg | null, trusted: boolean, opener?: HTMLElement | null): boolean;
  close(): void;
  isOpen(): boolean;
  /** the open session (null when closed) */
  hsid(): string | null;
  /** a live row of the log */
  row(r: RowLike): void;
  /** the toast's "see Tools": open on the Tools segment, focus on the server's Restart key once read */
  openServer(hsid: string, label: string, trusted: boolean): boolean;
  /** Settings › Kept memory › Open: an ended session's memory (it may be from an earlier run: no row of it is read) */
  openMemory(hsid: string, title: string, trusted: boolean, opener: HTMLElement | null): boolean;
  readonly flow: ToolsFlow;
}

const setId = (el: MiniEl, id: string): MiniEl => (el.setAttribute('id', id), el);

function noticeEl(doc: MiniDoc, n: NonNullable<ToolsView['notice']>): MiniEl {
  return h(doc, 'div', { class: 'settings-sec td-notice' }, h(doc, 'p', { class: `sf-result${n.fail ? ' fail' : ''}`, ...(n.fail ? { role: 'alert' } : {}) }, n.text), n.key ? h(doc, 'div', { class: 'sf-keys' }, keyEl(doc, { act: n.key.act, label: n.key.label, quiet: true })) : null);
}

/** One h3 section over readonly rows with keys (the Settings sheet's), its outcome under them. */
function sectionOf(doc: MiniDoc, id: string, title: string, rows: SettingRow[], result?: ResultView | null): MiniEl {
  const hid = `td-h-${id}`;
  const sec = h(doc, 'section', { class: 'settings-sec', 'data-td-section': id, 'aria-labelledby': hid, 'data-kernel-owned': 'true' }, setId(h(doc, 'h3', { class: 'title settings-h', tabindex: '-1' }, title), hid));
  for (const r of rows) sec.appendChild(rowEl(doc, r));
  if (result) sec.appendChild(setId(h(doc, 'div', { class: 'settings-row', tabindex: '-1' }, resultEl(doc, result)), `td-result-${id}`));
  return sec;
}

/** Paint the Tools segment into fresh elements (exported for tests over a fake document). */
export function toolsEls(doc: MiniDoc, v: ToolsView): MiniEl[] {
  const out: MiniEl[] = [];
  if (v.notice) out.push(noticeEl(doc, v.notice));
  // C6'b2-2: the injection pause, said once at the top of Tools (the transcript has its one note too)
  if (v.taint) out.push(h(doc, 'div', { class: 'settings-sec td-taint' }, h(doc, 'p', { class: 'sf-result' }, v.taint)));
  for (const s of v.sections) out.push(sectionOf(doc, s.id, s.title, s.rows, s.result));
  if (v.all) {
    const box = h(doc, 'div', { class: 'settings-row rules-block' });
    if (v.all.filter.shown) {
      const input = h(doc, 'input', { class: 'field w-name', type: 'search', name: 'td-filter', value: v.all.filter.value, 'data-td-filter': '', placeholder: TOOLS_COPY.filterPlaceholder, 'aria-label': 'Filter tools' });
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('spellcheck', 'false');
      box.appendChild(h(doc, 'label', { class: 'rules-filter' }, h(doc, 'span', { class: 'sf-label' }, TOOLS_COPY.filter), input));
    }
    if (v.all.noMatch) box.appendChild(h(doc, 'p', { class: 'rules-empty' }, v.all.noMatch));
    let n = 0;
    for (const g of v.all.groups) {
      const count = h(doc, 'span', { class: 'rules-count' }, `${g.count} tool${g.count === 1 ? '' : 's'}`);
      // the Rules block's fold: at 50 tools the heading is the group's fold key (▸ folded, ▾ open)
      const head = g.foldable
        ? h(doc, 'p', { class: 'rules-repo', role: 'heading', 'aria-level': '4' }, h(doc, 'button', { class: 'rules-fold', type: 'button', 'data-lm-act': 'fold', 'data-lm-value': g.label, 'aria-expanded': String(!g.folded) }, h(doc, 'span', { class: 'rules-fold-mark', 'aria-hidden': 'true' }, g.folded ? '▸' : '▾'), ' ', g.label, ' ', count))
        : h(doc, 'p', { class: 'rules-repo', role: 'heading', 'aria-level': '4' }, g.label, ' ', count);
      const list = g.folded
        ? null
        : h(doc, 'ul', { class: 'rules-list', role: 'list' }, ...g.rows.map((r) => {
            const whyId = r.why ? `td-why-${n++}` : null;
            const key: FormKey | null = r.key ? { ...r.key, ...(whyId ? { describedBy: whyId } : {}) } : null;
            return h(doc, 'li', { class: 'rule-row' }, h(doc, 'span', { class: 'rule-what' }, r.name), h(doc, 'span', { class: 'rule-meta' }, r.meta), r.description ? h(doc, 'span', { class: 'rule-meta' }, r.description) : null, whyId ? setId(h(doc, 'span', { class: 'rule-meta why-off' }, r.why!), whyId) : null, r.stopNote ? h(doc, 'span', { class: 'rule-meta td-stop-note', role: 'alert' }, r.stopNote) : null, key || r.stop ? h(doc, 'span', { class: 'rule-keys' }, r.stop ? keyEl(doc, r.stop) : null, key ? keyEl(doc, key) : null) : null);
          }));
      box.appendChild(h(doc, 'section', { class: `rules-group${g.folded ? ' is-folded' : ''}`, 'aria-label': `${g.label}, ${g.count} tools` }, head, list));
    }
    const hid = 'td-h-all';
    out.push(h(doc, 'section', { class: 'settings-sec', 'data-td-section': 'all', 'aria-labelledby': hid }, setId(h(doc, 'h3', { class: 'title settings-h', tabindex: '-1' }, v.all.title), hid), box));
  }
  return out;
}

/** Paint the Memory segment (exported for tests over a fake document). */
export function memoryEls(doc: MiniDoc, v: MemoryView): MiniEl[] {
  const out: MiniEl[] = [];
  if (v.notice) out.push(noticeEl(doc, v.notice));
  if (v.line) out.push(h(doc, 'p', { class: 'settings-intro' }, v.line));
  if (v.yours.length) out.push(sectionOf(doc, 'mem-yours', TOOLS_COPY.memory.yours, v.yours));
  if (v.data.length) {
    const hid = 'td-h-mem-data';
    // model-text-control: model and tool text sits behind a dashed edge with the label "data" (text nodes only)
    const box = h(doc, 'div', { class: 'agent-claimed', role: 'group', 'aria-labelledby': hid }, h(doc, 'span', { class: 'ac-tag' }, TOOLS_COPY.memory.tag), ...v.data.map((r) => rowEl(doc, r)));
    out.push(h(doc, 'section', { class: 'settings-sec', 'data-td-section': 'mem-data' }, setId(h(doc, 'h3', { class: 'title settings-h', tabindex: '-1' }, TOOLS_COPY.memory.data), hid), box));
  }
  if (v.result) out.push(setId(h(doc, 'div', { class: 'settings-sec', tabindex: '-1' }, resultEl(doc, v.result)), 'td-result-memory'));
  if (v.foot.keys.length) {
    // a key aria-disabled while another runs says why in a visible line, linked by aria-describedby
    const waiting = v.foot.keys.some((k) => k.busy);
    const keys = v.foot.keys.map((k) => keyEl(doc, k.ariaDisabled && !k.busy ? { ...k, describedBy: 'td-mem-busy' } : k));
    const foot = v.foot.confirm
      ? h(doc, 'div', { class: 'set-form', role: 'group', 'aria-label': TOOLS_COPY.memory.yes }, h(doc, 'p', { class: 'sf-lead' }, v.foot.confirm), h(doc, 'div', { class: 'sf-keys' }, ...keys), waiting ? setId(h(doc, 'p', { class: 'sf-note' }, 'Deleting this session’s working memory…'), 'td-mem-busy') : null)
      : h(doc, 'div', { class: 'sf-keys' }, ...keys);
    out.push(h(doc, 'div', { class: 'settings-sec td-foot' }, foot));
  }
  return out;
}

export function mountToolsDrawer(doc: Document, d: ToolsDrawerDeps): ToolsDrawer {
  const mini = doc as unknown as MiniDoc;
  const overlay = doc.createElement('div');
  overlay.id = 'tools-drawer';
  overlay.className = 'overlay vs-drawer';
  overlay.hidden = true;
  const card = doc.createElement('div');
  card.className = 'sheet-card settings-card voice-sheet tools-sheet';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'tools-drawer-title');
  const head = doc.createElement('div');
  head.className = 'settings-head';
  const title = doc.createElement('h2');
  title.id = 'tools-drawer-title';
  title.className = 'title';
  title.tabIndex = -1;
  title.textContent = TOOLS_COPY.title;
  const meta = doc.createElement('span');
  meta.className = 'meta';
  const done = doc.createElement('button');
  done.id = 'tools-drawer-close';
  done.className = 'key quiet';
  done.type = 'button';
  done.title = 'Close (Esc)';
  done.textContent = 'done';
  head.append(title, meta, done);
  // the seg keys: a radiogroup, one Tab stop, the arrows move and choose
  const segRow = doc.createElement('div');
  segRow.className = 'vs-row td-segs';
  const seg = doc.createElement('span');
  seg.className = 'seg';
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', TOOLS_COPY.segLabel);
  const segKeys = (['tools', 'memory'] as const).map((k) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'key quiet seg-key';
    b.setAttribute('role', 'radio');
    b.dataset.tdSeg = k;
    b.textContent = TOOLS_COPY.seg[k];
    seg.appendChild(b);
    return b;
  });
  segRow.appendChild(seg);
  // one persistent live line from open (a region must exist before its text changes to be announced)
  const live = doc.createElement('p');
  live.className = 'sr-only';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  const body = doc.createElement('div');
  body.id = 'tools-drawer-body';
  body.className = 'settings-body vs-body';
  card.append(head, segRow, live, body);
  overlay.appendChild(card);
  doc.body.appendChild(overlay);
  let back: HTMLElement | null = null;

  const call = async (req: DrawerRequest): Promise<unknown> => {
    const c = d.client();
    if (!c) throw new Error('not connected');
    return c.call('log.append', req);
  };
  const flow = new ToolsFlow({ call, repaint: () => paint(), live: (t) => void (live.textContent = t), now: d.now, rows: d.rows });

  const focusOf = (f: DrawerFocus): HTMLElement | null => {
    if ('heading' in f) return f.heading === 'drawer' ? title : (body.querySelector(f.heading === 'tools' || f.heading === 'memory' ? 'h3' : `#td-h-${f.heading}`) as HTMLElement | null);
    if ('result' in f) return body.querySelector('[id^="td-result-"]') as HTMLElement | null;
    const sel = `[data-lm-act="${CSS.escape(f.act)}"]${f.value !== undefined ? `[data-lm-value="${CSS.escape(f.value)}"]` : ''}`;
    // a tool's key in All tools first (the same name may also sit in Pins)
    return (body.querySelector(`[data-td-section="all"] ${sel}`) ?? body.querySelector(sel)) as HTMLElement | null;
  };

  const paint = (): void => {
    const s = flow.state();
    if (!s) {
      if (!overlay.hidden) {
        overlay.hidden = true;
        back?.focus();
        back = null;
      }
      return;
    }
    meta.textContent = drawerMeta(s);
    segKeys.forEach((b) => {
      const on = b.dataset.tdSeg === s.seg;
      b.classList.toggle('current', on);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    // a repaint keeps focus (and the filter's caret) on the same control
    const a = doc.activeElement as HTMLElement | null;
    const inBody = !!a && body.contains(a);
    const keep = !inBody ? null : a!.dataset.tdFilter !== undefined ? '[data-td-filter]' : a!.dataset.lmAct ? `[data-lm-act="${CSS.escape(a!.dataset.lmAct)}"]${a!.dataset.lmValue !== undefined ? `[data-lm-value="${CSS.escape(a!.dataset.lmValue)}"]` : ''}` : a!.id ? `#${CSS.escape(a!.id)}` : null;
    const caret = a instanceof HTMLInputElement ? [a.selectionStart, a.selectionEnd] : null;
    const top = body.scrollTop;
    const els = s.seg === 'tools' ? toolsEls(mini, flow.tools()!) : memoryEls(mini, flow.memory()!);
    body.replaceChildren(...(els as unknown as Node[]));
    body.scrollTop = top;
    overlay.hidden = false;
    const f = flow.takeFocus();
    const to = f ? focusOf(f) : keep ? (body.querySelector(keep) as HTMLElement | null) : null;
    if (to) {
      if (f) to.scrollIntoView?.({ block: 'nearest' });
      to.focus({ preventScroll: true });
      if (caret && to instanceof HTMLInputElement && caret[0] !== null) to.setSelectionRange(caret[0], caret[1]);
    } else if (inBody) (body.querySelector('h3') as HTMLElement | null ?? title).focus({ preventScroll: true }); // never dropped to the page
  };

  const close = (): void => {
    flow.close();
  };
  done.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close(); // a press on the scrim closes it
  });
  seg.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-td-seg]') as HTMLElement | null;
    if (b) flow.setSeg(b.dataset.tdSeg as Seg);
  });
  seg.addEventListener('keydown', (e) => {
    const i = segKeys.indexOf(e.target as HTMLButtonElement);
    if (i < 0) return;
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % 2 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i + 1) % 2 : e.key === 'Home' ? 0 : e.key === 'End' ? 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    flow.setSeg(segKeys[to]!.dataset.tdSeg as Seg);
    segKeys[to]!.focus();
  });
  body.addEventListener('click', (e) => {
    const k = (e.target as HTMLElement).closest('[data-lm-act]') as HTMLButtonElement | null;
    const s = flow.state();
    if (!k || !s) return;
    const trusted = e.isTrusted;
    if (!trusted) return; // G-GUI-04: a script-made press changes nothing
    if (k.getAttribute('aria-disabled') === 'true') return; // it keeps its focus; its why line says why
    const act = k.dataset.lmAct!;
    const value = k.dataset.lmValue ?? '';
    const inPins = !!k.closest('[data-td-section="pins"]');
    if (act === 'pin') void flow.pin(value, true, trusted);
    else if (act === 'unpin') void flow.pin(value, false, trusted, inPins ? 'pins' : 'all');
    else if (act === 'restart') void flow.restart(value, trusted);
    else if (act === 'stop-sending') void flow.stopSending(value, trusted);
    else if (act === 'fold') flow.fold(value, trusted);
    else if (act === 'again') void (s.seg === 'tools' ? flow.readTools() : flow.readMemory());
    else if (act === 'seg-memory') {
      flow.setSeg('memory');
      segKeys[1]!.focus();
    } else if (act === 'tier') {
      const hsid = s.hsid;
      back = null;
      close();
      if (!d.openTier(hsid)) title.ownerDocument.getElementById('more-btn')?.focus();
    } else if (act === 'stage') {
      back = null;
      close();
      d.openSettings();
    } else if (act === 'mem-confirm') flow.memConfirm();
    else if (act === 'mem-keep') flow.memKeep();
    else if (act === 'mem-delete') void flow.memDelete(false, trusted);
    else if (act === 'mem-delete-stop') void flow.memDelete(true, trusted);
  });
  body.addEventListener('input', (e) => {
    const f = e.target as HTMLInputElement;
    if (f.dataset?.tdFilter !== undefined) flow.filter(f.value);
  });
  // Tab stays inside the open drawer (aria-modal; the shared trapTab). Esc is the page's one Escape chain (ui/app.ts):
  // it closes the drawer and focus returns to the opener.
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !overlay.hidden) trapTab(card, e);
  });

  return {
    flow,
    open(hsid, seg0, trusted, opener) {
      const s = d.session(hsid);
      if (!s) return false;
      if (overlay.hidden) back = opener ?? (doc.activeElement as HTMLElement | null);
      return flow.open({ hsid, title: s.title, access: s.access }, seg0, trusted);
    },
    close,
    isOpen: () => !overlay.hidden,
    hsid: () => flow.state()?.hsid ?? null,
    row: (r) => flow.row(r),
    openMemory(hsid, title, trusted, opener) {
      if (overlay.hidden) back = opener ?? (doc.activeElement as HTMLElement | null);
      return flow.open({ hsid, title, access: 'ended' }, 'memory', trusted);
    },
    openServer(hsid, label, trusted) {
      const s = d.session(hsid);
      if (!s) return false;
      if (overlay.hidden) back = doc.activeElement as HTMLElement | null;
      return flow.open({ hsid, title: s.title, access: s.access }, 'tools', trusted, { act: 'restart', value: label });
    },
  };
}
