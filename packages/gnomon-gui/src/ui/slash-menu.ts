/**
 * @symbol #gui-slash-menu
 * @symbol #gui-slash-runs
 *
 * #gui-slash-menu and #gui-slash-runs, the DOM and the press paths (the rows, words and requests are core/slash-menu.ts
 * and core/slash-runs.ts). SlashFlow (no DOM, modelled on ToolsFlow) holds the menu's state and the page's runs and
 * sends the requests; mountSlashMenu paints the listbox and the args panel above the composer with core/render.ts h()
 * (text nodes only, allowlisted attributes); renderRunRow paints a run's transcript row.
 *
 *   - The menu opens when the composer holds "/" and one word (the typeahead), or from a host slip's "Open / menu" and
 *     the palette (slash.open). The TEXTAREA KEEPS FOCUS: the listbox is driven by aria-activedescendant with option
 *     ids that stay the same across repaints; ↑/↓ move, Enter acts, Esc closes only the menu (nothing under it).
 *   - Enter on a row only opens its args panel (focus moves into it; Tab stays inside, the shared trapTab); a read tool
 *     with no arguments runs at once; a Gnomon command opens its screen; the tier 0 Start row sends
 *     request.session.tools.start. An aria-disabled row sends nothing and its reason is always shown.
 *   - Every request goes on a trusted event only (G-GUI-04). A run is sent once per press; while a skill run is in
 *     flight the Run key is aria-busy and a second press sends nothing.
 *   - A run row is added to the transcript at the press. A carded run reads request.session.tools.result EXACTLY ONCE,
 *     when its card's run settled allowed (its tool.brokered{author:'human', cardId} row); a reply that says the
 *     result is still pending consumed nothing, so it is asked again at most PENDING_ASKS times. Never after a reload:
 *     the runs live in this page's memory only.
 *   - One persistent live line (#slash-say), created at mount: never a region made per update.
 */
import { RpcError } from '../core/client.js';
import { h, type MiniDoc, type MiniEl } from '../core/render.js';
import {
  argFieldsOf,
  argsOf,
  filterSlash,
  runKeyLabel,
  runsOnEnter,
  SKILL_COPY,
  skillArgsProblem,
  skillRefusalWords,
  skillRunRequest,
  skillsListRequest,
  skillsOf,
  slashItemsOf,
  SLASH_COPY,
  startFailWords,
  toolsResultRequest,
  toolsPolicyRequest,
  toolsRunRequest,
  toolsSendRequest,
  toolsStartRequest,
  type ArgField,
  type SkillListing,
  type SlashCommand,
  type SlashItem,
  type SlashRequest,
} from '../core/slash-menu.js';
import { ASK_COPY, askedOf, canSend, rateWaitSecs, RUN_COPY, runReducer, runWords, SEND_COPY, settledDecisionOf, startRun, type RunEvent, type RunView, type RunWords } from '../core/slash-runs.js';
import { capabilitiesOf, type Capabilities } from '../core/tools-drawer.js';
import { trapTab } from './tier-picker.js';

interface RowLike {
  kind: string;
  payload?: unknown;
}

/** A pending tools.result reply consumed nothing: it is asked again at most this many times, this far apart. */
export const PENDING_ASKS = 3;
export const PENDING_GAP_MS = 400;

/* ── the flow (no DOM) ───────────────────────────────────────────────────────────────────────────────────────────── */

export interface SlashAccess {
  /** the owner of a live local session: tools from / */
  tools: boolean;
  /** the owner of a live session: skills from / */
  skills: boolean;
}

export interface SlashFlowDeps {
  /** log.append of one request; throws RpcError on a refusal */
  call: (req: SlashRequest) => Promise<unknown>;
  repaint: () => void;
  /** the menu's one live line */
  live: (text: string) => void;
  /** epoch ms now */
  now: () => number;
  /** what "/" offers in a session (null: nothing, the menu does not open) */
  access: (hsid: string) => SlashAccess | null;
  commands: readonly SlashCommand[];
  /** a run row was added (the page adds its transcript row) and changed (the page repaints it) */
  runAdded: (v: RunView) => void;
  runChanged: (v: RunView) => void;
  /** a Gnomon command: the palette's own run(id, trusted) */
  command: (id: string, trusted: boolean) => void;
  /** "servers are off": the Tools drawer */
  openTools: (hsid: string, trusted: boolean) => void;
  /** a skill ran as the human's turn: the page posts "you ran skill /x args", stamped with the turn id */
  skillRan: (hsid: string, name: string, args: string, turn: string | null) => void;
  /** a session's loaded skills were read (the host slips of its replies change: run it from /) */
  skillsChanged?: (hsid: string) => void;
  /** the menu closed after a run: the composer's "/word" goes and the textarea has focus */
  done: () => void;
  /** a one-shot timer (default setTimeout) */
  timer?: (fn: () => void, ms: number) => void;
}

export interface SlashUi {
  hsid: string;
  query: string;
  /** the active row's key (aria-activedescendant) */
  active: string | null;
  /** the row whose args panel is open */
  args: string | null;
  values: Record<string, string>;
  errors: Record<string, string>;
  /** a refused skill run or a run the page refused, under the panel's keys */
  result: string | null;
  /** a skill run in flight (the Run key is aria-busy) */
  busy: boolean;
  phase: 'reading' | 'loaded' | 'unreachable';
  caps: Capabilities | null;
  skills: SkillListing[] | null;
  starting: boolean;
  startError: string | null;
}

const reasonOf = (err: unknown): { reason: string | null; data: Record<string, unknown> | null } | null => (err instanceof RpcError ? { reason: err.refusal.reason, data: err.refusal.data } : null);

export class SlashFlow {
  readonly #d: SlashFlowDeps;
  #s: SlashUi | null = null;
  #gen = 0;
  #reads = 0;
  #n = 0;
  readonly #runs = new Map<string, RunView>();
  /** each session's "/" presses in the last minute (the "try again in Ns" count) */
  readonly #presses = new Map<string, number[]>();
  /** each session's skills as last read (the host slips read the loaded names), and the reads in flight */
  readonly #skillsBy = new Map<string, SkillListing[]>();
  readonly #skillsAsked = new Set<string>();
  /** where focus goes after a repaint (taken once) */
  #focus: 'textarea' | 'panel' | 'run' | null = null;
  /** the human moved the active row (↑/↓): from then on a refresh keeps it while it is shown */
  #moved = false;

  constructor(d: SlashFlowDeps) {
    this.#d = d;
  }

  state(): Readonly<SlashUi> | null {
    return this.#s;
  }

  isOpen(): boolean {
    return this.#s !== null;
  }

  takeFocus(): 'textarea' | 'panel' | 'run' | null {
    const f = this.#focus;
    this.#focus = null;
    return f;
  }

  /** Every row (unfiltered). */
  all(): SlashItem[] {
    const s = this.#s;
    if (!s) return [];
    const a = this.#d.access(s.hsid);
    return slashItemsOf({ caps: a?.tools ? s.caps : null, skills: a?.skills ? s.skills : null, commands: this.#d.commands, starting: s.starting, startError: s.startError });
  }

  /** The rows the query keeps. */
  items(): SlashItem[] {
    return this.#s ? filterSlash(this.all(), this.#s.query) : [];
  }

  item(key: string | null): SlashItem | null {
    return key === null ? null : (this.all().find((i) => i.key === key) ?? null);
  }

  /** The names of a session's listed, loaded skills, as last read (none before a read). */
  loadedSkills(hsid: string): string[] {
    return (this.#skillsBy.get(hsid) ?? []).filter((x) => x.loaded).map((x) => x.name);
  }

  /** Read a session's skills once (read only), for its host slips; the menu re-reads them each time it opens. */
  async ensureSkills(hsid: string): Promise<void> {
    if (this.#skillsBy.has(hsid) || this.#skillsAsked.has(hsid) || !this.#d.access(hsid)?.skills) return;
    this.#skillsAsked.add(hsid);
    try {
      const v = skillsOf(await this.#d.call(skillsListRequest(hsid)), hsid);
      if (v) this.#keepSkills(hsid, v);
    } catch {
      // nothing is claimed: the slips keep their plain words
    } finally {
      this.#skillsAsked.delete(hsid);
    }
  }

  #keepSkills(hsid: string, v: SkillListing[]): void {
    const before = this.loadedSkills(hsid).join('\u0000');
    this.#skillsBy.set(hsid, v);
    if (this.loadedSkills(hsid).join('\u0000') !== before) this.#d.skillsChanged?.(hsid);
  }

  run(key: string): RunView | null {
    return this.#runs.get(key) ?? null;
  }

  /**
   * C6'b2-2: is a "/" run of this tool on this server in flight from this page (the kernel's approval.auto names no
   * author; a rule that passed it while one of ours runs passed ours: "by you from /")?
   */
  humanRunning(hsid: string, server: string, tool: string): boolean {
    for (const v of this.#runs.values()) if (v.hsid === hsid && v.phase === 'running' && v.server === server && v.tool === tool) return true;
    return false;
  }

  /** Open the menu on a session (typing "/" is the human's own input; the palette and a slip key are trusted presses). */
  open(hsid: string, query: string, trusted: boolean): boolean {
    if (!trusted) return false; // G-GUI-04
    const a = this.#d.access(hsid);
    if (!a) return false;
    if (this.#s?.hsid === hsid) {
      this.setQuery(query);
      return true;
    }
    this.#gen++;
    this.#moved = false;
    this.#s = { hsid, query, active: null, args: null, values: {}, errors: {}, result: null, busy: false, phase: a.tools || a.skills ? 'reading' : 'loaded', caps: null, skills: null, starting: false, startError: null };
    this.#pickActive();
    this.#d.live('');
    this.#d.repaint();
    void this.read();
    return true;
  }

  close(): boolean {
    if (!this.#s) return false;
    this.#gen++;
    this.#s = null;
    this.#focus = 'textarea';
    this.#d.repaint();
    return true;
  }

  /** Read the session's capabilities and skills (read only: nothing starts, runs or is sent). */
  async read(): Promise<void> {
    const s = this.#s;
    if (!s) return;
    const a = this.#d.access(s.hsid);
    if (!a) return;
    const gen = this.#gen;
    const n = ++this.#reads;
    const [caps, skills] = await Promise.allSettled([a.tools ? this.#d.call({ kind: 'request.session.capabilities', payload: { hsid: s.hsid } }) : Promise.resolve(null), a.skills ? this.#d.call(skillsListRequest(s.hsid)) : Promise.resolve(null)]);
    if (gen !== this.#gen || n !== this.#reads || this.#s !== s) return;
    if (caps.status === 'fulfilled' && caps.value !== null) s.caps = capabilitiesOf(caps.value, s.hsid);
    if (skills.status === 'fulfilled' && skills.value !== null) {
      s.skills = skillsOf(skills.value, s.hsid);
      if (s.skills) this.#keepSkills(s.hsid, s.skills);
    }
    // a network failure says so; a refusal (not the owner, a session that ended) just leaves its group out
    s.phase = (caps.status === 'rejected' && !(caps.reason instanceof RpcError)) || (skills.status === 'rejected' && !(skills.reason instanceof RpcError)) ? 'unreachable' : 'loaded';
    this.#pickActive();
    this.#say();
    this.#d.repaint();
  }

  setQuery(q: string): void {
    const s = this.#s;
    if (!s || s.args) return;
    s.query = q.slice(0, 64);
    this.#pickActive();
    this.#say();
    this.#d.repaint();
  }

  /** ↑/↓: the active row moves (wrapping); it is the listbox's aria-activedescendant. */
  move(delta: number): void {
    const s = this.#s;
    if (!s || s.args) return;
    const items = this.items();
    if (!items.length) return;
    const at = items.findIndex((i) => i.key === s.active);
    const to = at < 0 ? (delta > 0 ? 0 : items.length - 1) : (at + delta + items.length) % items.length;
    s.active = items[to]!.key;
    this.#moved = true;
    this.#d.repaint();
  }

  /** A row was pressed (a click), or Enter on the active row. */
  press(key: string | null, trusted: boolean): void {
    const s = this.#s;
    if (!trusted || !s) return; // G-GUI-04
    const it = this.items().find((i) => i.key === (key ?? s.active));
    if (!it) return;
    s.active = it.key;
    if (it.disabled) {
      this.#d.live(`${it.name}: ${it.note}`); // aria-disabled: nothing is sent, its reason is said again
      return this.#d.repaint();
    }
    if (it.kind === 'command') {
      this.close();
      this.#d.done();
      return this.#d.command(it.command!, trusted);
    }
    if (it.kind === 'see-tools') {
      const hsid = s.hsid;
      this.close();
      this.#d.done();
      return this.#d.openTools(hsid, trusted);
    }
    if (it.kind === 'start') return void this.start(trusted);
    if (runsOnEnter(it)) return void this.#runTool(it, {});
    s.args = it.key;
    s.values = {};
    s.errors = {};
    s.result = null;
    this.#focus = 'panel';
    this.#d.repaint();
  }

  /** The args panel's field changed (no repaint: the field shows its own value). */
  setValue(name: string, value: string): void {
    const s = this.#s;
    if (!s?.args) return;
    s.values[name] = value;
    if (s.errors[name]) {
      delete s.errors[name];
      this.#d.repaint();
    }
  }

  /** A seg choice (enum, boolean): its index, or '' to unset. */
  choose(name: string, index: string): void {
    const s = this.#s;
    if (!s?.args) return;
    s.values[name] = s.values[name] === index ? '' : index;
    delete s.errors[name];
    this.#d.repaint();
  }

  fields(): ArgField[] {
    const it = this.item(this.#s?.args ?? null);
    return it ? argFieldsOf(it) : [];
  }

  /** Run from the args panel, once per trusted press. */
  async runArgs(trusted: boolean): Promise<void> {
    const s = this.#s;
    if (!trusted || !s?.args || s.busy) return;
    const it = this.item(s.args);
    if (!it || it.disabled) return;
    if (it.kind === 'skill') {
      const args = (s.values.args ?? '').trim();
      const bad = skillArgsProblem(args);
      if (bad) {
        s.result = bad;
        this.#d.live(bad);
        this.#focus = 'panel';
        return this.#d.repaint();
      }
      return this.#runSkill(it.skill!, args);
    }
    const out = argsOf(argFieldsOf(it), s.values);
    if ('errors' in out) {
      s.errors = out.errors;
      this.#d.live(`${Object.keys(out.errors).length} argument${Object.keys(out.errors).length === 1 ? '' : 's'} to fix`);
      this.#focus = 'panel';
      return this.#d.repaint();
    }
    await this.#runTool(it, out.args);
  }

  /** Tier 0: start the session's servers for "/" (once; the model is offered nothing). */
  async start(trusted: boolean): Promise<void> {
    const s = this.#s;
    if (!trusted || !s || s.starting || !this.#d.access(s.hsid)?.tools) return;
    s.starting = true;
    s.startError = null;
    this.#d.live(SLASH_COPY.starting);
    this.#d.repaint();
    const gen = this.#gen;
    try {
      await this.#d.call(toolsStartRequest(s.hsid));
    } catch (err) {
      if (gen !== this.#gen || this.#s !== s) return;
      s.starting = false;
      s.startError = startFailWords(reasonOf(err));
      this.#d.live(s.startError);
      return this.#d.repaint();
    }
    if (gen !== this.#gen || this.#s !== s) return;
    await this.read();
    if (gen !== this.#gen || this.#s !== s) return;
    s.starting = false;
    const n = s.caps?.tools.length ?? 0;
    this.#d.live(`Servers started: ${n} tool${n === 1 ? '' : 's'} for /; the model still gets none`);
    this.#d.repaint();
  }

  /** A live row: the open session's servers or selection moved (re-read); a carded run of ours settled (read once). */
  row(r: RowLike): void {
    const p = r.payload && typeof r.payload === 'object' ? (r.payload as Record<string, unknown>) : null;
    if (!p) return;
    if (r.kind === 'tool.brokered' && p.author === 'human' && typeof p.cardId === 'string') {
      for (const v of this.#runs.values()) {
        if (v.phase !== 'carded' || v.cardId !== p.cardId || v.hsid !== p.hsid) continue;
        const d = settledDecisionOf(r, v.cardId);
        if (d === null) continue;
        this.#apply(v.key, { type: 'settled', decision: d });
        if (d === 'ran' || d === 'approved') void this.#readOnce(v.key);
      }
      return;
    }
    const s = this.#s;
    if (s && p.hsid === s.hsid && !s.starting && (r.kind === 'session.mcp' || r.kind === 'tool.selection')) void this.read();
  }

  /** A run row's data fold. */
  fold(key: string, open: boolean): void {
    if (this.#runs.has(key)) this.#apply(key, { type: 'fold', open });
  }

  /**
   * C6'b2-2: the first-use question — Always send (request.session.tools.policy{policy:'send'}: its latest result goes
   * with the next message, `queued` said in the live line) or Keep to me (ask: Send this one appears). One trusted
   * press; every row of the same tool takes the new policy, the latest ran one the kernel's `queued`.
   */
  async choosePolicy(key: string, policy: 'send' | 'ask', trusted: boolean): Promise<void> {
    const v = this.#runs.get(key);
    if (!trusted || !v || !askedOf(v) || v.choosing !== null || !this.#d.access(v.hsid)?.tools) return; // G-GUI-04
    this.#apply(key, { type: 'choosing', policy });
    let out: unknown;
    try {
      out = await this.#d.call(toolsPolicyRequest(v.hsid, v.toolId, policy));
    } catch (err) {
      const r = this.#apply(key, { type: 'choose-failed', reason: reasonOf(err)?.reason ?? null, network: !(err instanceof RpcError) });
      if (r?.chooseNote) this.#d.live(`${r.tool}: ${r.chooseNote}`);
      return;
    }
    const o = out && typeof out === 'object' ? (out as Record<string, unknown>) : {};
    const set = o.policy === 'send' || o.policy === 'ask' ? o.policy : policy;
    const queued = set === 'send' && o.queued === true;
    // the kernel queues the tool's LATEST "/" result of this session: the last ran row of it on this page
    const same = [...this.#runs.values()].filter((x) => x.hsid === v.hsid && x.toolId === v.toolId);
    const latest = [...same].reverse().find((x) => x.phase === 'ran')?.key ?? null;
    for (const x of same) this.#apply(x.key, { type: 'policy', policy: set, ...(queued && x.key === latest ? { queued: true } : {}) });
    this.#d.live(set === 'send' ? ASK_COPY.liveSend(v.tool, queued) : ASK_COPY.liveAsk(v.tool));
  }

  /**
   * C6'b2-2: Send this one — request.session.tools.send{hsid, runId}, ONE trusted press while the row offers it (a
   * press while it is in flight, or on a row that does not offer it, sends nothing). The tool's policy stays ask.
   */
  async sendOne(key: string, trusted: boolean): Promise<void> {
    const v = this.#runs.get(key);
    if (!trusted || !v || !canSend(v) || !this.#d.access(v.hsid)?.tools) return; // G-GUI-04
    const runId = v.runId!;
    this.#apply(key, { type: 'sending' });
    let out: unknown;
    try {
      out = await this.#d.call(toolsSendRequest(v.hsid, runId));
    } catch (err) {
      const r = this.#apply(key, { type: 'send-failed', reason: reasonOf(err)?.reason ?? null, network: !(err instanceof RpcError) });
      if (r) this.#d.live(`${r.tool}: ${runWords(r).sendNote ?? ''}`);
      return;
    }
    const r = this.#apply(key, { type: 'sent', v: out });
    if (r) this.#d.live(r.send === 'sent' ? SEND_COPY.live(r.tool) : `${r.tool}: ${runWords(r).sendNote ?? ''}`);
  }

  /* ── runs ── */

  #apply(key: string, e: RunEvent): RunView | null {
    const v = this.#runs.get(key);
    if (!v) return null;
    const next = runReducer(v, e);
    if (next === v) return v;
    this.#runs.set(key, next);
    this.#d.runChanged(next);
    return next;
  }

  async #runTool(it: SlashItem, args: Record<string, unknown>): Promise<void> {
    const s = this.#s;
    const t = it.tool;
    if (!s || !t || !t.run.runnable) return;
    const hsid = s.hsid;
    const now = this.#d.now();
    const presses = (this.#presses.get(hsid) ?? []).filter((x) => now - x < 60_000);
    presses.push(now);
    this.#presses.set(hsid, presses);
    const key = `lr-${++this.#n}`;
    const v = startRun({ key, hsid, tool: t.name, server: t.server, toolId: t.id, cls: t.class, policy: t.policy, at: new Date(now).toISOString() });
    this.#runs.set(key, v);
    // the row is in the transcript at once; the menu closes and the textarea keeps the focus
    this.close();
    this.#d.done();
    this.#d.runAdded(v);
    this.#d.live(`${RUN_COPY.head(t.name, t.server)} · ${RUN_COPY.running}`);
    let out: unknown;
    try {
      out = await this.#d.call(toolsRunRequest(hsid, t, args));
    } catch (err) {
      const r = this.#apply(key, { type: 'failed', reason: reasonOf(err)?.reason ?? null, network: !(err instanceof RpcError) });
      if (r) this.#d.live(`${r.tool}: ${runWords(r).state}`);
      return;
    }
    const r = this.#apply(key, { type: 'reply', v: out, waitSecs: rateWaitSecs(this.#presses.get(hsid) ?? [], this.#d.now()) });
    if (r) this.#d.live(`${r.tool}: ${runWords(r).state}`);
  }

  /** request.session.tools.result, read once (a pending reply consumed nothing and is asked again, bounded). */
  async #readOnce(key: string): Promise<void> {
    const v = this.#apply(key, { type: 'read' });
    if (!v || v.phase !== 'reading' || !v.runId) return;
    const runId = v.runId;
    for (let ask = 0; ask < PENDING_ASKS; ask++) {
      let out: unknown;
      try {
        out = await this.#d.call(toolsResultRequest(v.hsid, runId));
      } catch (err) {
        const r = this.#apply(key, { type: 'result-failed', reason: reasonOf(err)?.reason ?? null, network: !(err instanceof RpcError) });
        if (r) this.#d.live(`${r.tool}: ${runWords(r).state}`);
        return;
      }
      const r = this.#apply(key, { type: 'result', v: out });
      if (r && r.phase !== 'reading') return void this.#d.live(`${r.tool}: ${runWords(r).state}`);
      await new Promise<void>((res) => (this.#d.timer ?? ((fn, ms) => void setTimeout(fn, ms)))(res, PENDING_GAP_MS));
    }
    // still pending after PENDING_ASKS: say so, never loop
    const left = this.#apply(key, { type: 'result-failed', reason: 'pending', network: false });
    if (left) this.#d.live(`${left.tool}: ${runWords(left).state}`);
  }

  async #runSkill(sk: SkillListing, args: string): Promise<void> {
    const s = this.#s!;
    s.busy = true;
    s.result = null;
    this.#d.repaint();
    const gen = this.#gen;
    let out: unknown;
    try {
      out = await this.#d.call(skillRunRequest(s.hsid, sk.name, args));
    } catch (err) {
      if (gen !== this.#gen || this.#s !== s) return;
      s.busy = false;
      const r = reasonOf(err);
      s.result = r === null ? 'Not known whether it ran: the connection dropped · next: look in the conversation, then run it again' : r.reason === 'not-found' ? 'this session isn’t running any more · next: open a new session' : r.reason === 'matrix' ? 'only the person who opened this session can run its skills' : 'the kernel refused it · next: run it again';
      this.#d.live(s.result);
      this.#focus = 'panel';
      return this.#d.repaint();
    }
    if (gen !== this.#gen || this.#s !== s) return;
    const v = out && typeof out === 'object' ? (out as Record<string, unknown>) : null;
    s.busy = false;
    if (v?.status === 'ran') {
      const hsid = s.hsid;
      this.close();
      this.#d.done();
      this.#d.skillRan(hsid, sk.name, args, typeof v.turn === 'string' ? v.turn : null);
      this.#d.live(SKILL_COPY.ran(sk.name, args));
      return;
    }
    s.result = skillRefusalWords(v);
    this.#d.live(s.result);
    this.#focus = 'panel';
    this.#d.repaint();
  }

  /* ── the active row ── */

  #pickActive(): void {
    const s = this.#s;
    if (!s) return;
    const items = this.items();
    // Mika C6'b2-1 #3: until the human moves (↑/↓), the active row is the first enabled row on every refresh (skills
    // arrive after the commands: "/" + Enter acts on the top row, never a row the first paint happened to pick)
    if (!this.#moved || !items.some((i) => i.key === s.active)) s.active = (items.find((i) => !i.disabled) ?? items[0])?.key ?? null;
  }

  #say(): void {
    const s = this.#s;
    if (!s || s.args) return;
    const n = this.items().length;
    this.#d.live(s.phase === 'reading' ? SLASH_COPY.reading : n ? `${n} result${n === 1 ? '' : 's'}` : SLASH_COPY.noMatch);
  }
}

/* ── the run row (exported for the transcript and for tests over a fake document) ───────────────────────────────── */

/** "3s", "1m 04s" */
export const runClock = (since: string, now: number): string => {
  const s = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};

/** One run row: the head, the state (with a spinner and clock while it runs), next:, its key, the data fold, the policy word. */
export function renderRunRow(doc: MiniDoc, w: RunWords, o: { key: string | null; at: string; now: number }): MiniEl {
  const k = o.key;
  const state = h(
    doc,
    'div',
    { class: 'run-state' },
    w.live ? h(doc, 'span', { class: 'spin', 'aria-hidden': 'true' }) : null,
    w.state,
    w.live ? h(doc, 'span', { class: 'run-clock', 'data-run-clock': o.at }, ` · ${runClock(o.at, o.now)}`) : null,
  );
  const data = w.data
    ? h(
        doc,
        'div',
        { class: 'agent-claimed run-data', role: 'group', 'aria-label': 'data: what the tool returned' },
        h(doc, 'span', { class: 'ac-tag' }, RUN_COPY.dataTag),
        h(doc, 'pre', { class: 'run-data-text', tabindex: '0' }, w.data.lines.join('\n')),
        w.data.key && k ? h(doc, 'button', { class: 'key quiet run-fold', type: 'button', 'data-run-act': w.data.folded ? 'unfold' : 'fold', 'data-run-key': k, 'aria-expanded': String(!w.data.folded) }, w.data.key) : null,
      )
    : null;
  return h(
    doc,
    'div',
    { class: `trow role-run${w.tone === 'fail' ? ' fail' : w.tone === 'quiet' ? ' quiet' : ''}`, ...(k ? { 'data-run': k } : {}) },
    h(doc, 'div', { class: 'who' }, h(doc, 'span', { class: 'run-head' }, w.head), h(doc, 'span', { class: 't' }, o.at.slice(11, 16))),
    state,
    w.next ? h(doc, 'div', { class: 'run-next' }, `next: ${w.next}`) : null,
    w.key === 'decide' && k ? h(doc, 'div', { class: 'run-keys' }, h(doc, 'button', { class: 'key quiet', type: 'button', 'data-run-act': 'decide', 'data-run-key': k }, RUN_COPY.decide)) : null,
    data,
    // C6'b2-2: the policy line (tabindex -1: where focus lands when its key goes) and, under ask, Send this one
    w.policy
      ? h(
          doc,
          'div',
          { class: 'run-policy', tabindex: '-1' },
          h(doc, 'span', { class: 'run-policy-word' }, w.policy),
          w.sendKey && k ? h(doc, 'button', { class: 'key quiet run-send', type: 'button', 'data-run-act': 'send', 'data-run-key': k, ...(w.sendKey === 'busy' ? { 'aria-busy': 'true', 'aria-disabled': 'true' } : {}) }, w.sendKey === 'busy' ? SEND_COPY.sending : SEND_COPY.key) : null,
        )
      : null,
    w.sendNote ? h(doc, 'div', { class: 'run-send-note' }, w.sendNote) : null,
    // C6'b2-2 (founder: inline, not a stack card): the first-use question, two quiet keys; Always send names what it does
    w.question && k
      ? h(
          doc,
          'div',
          { class: 'run-ask', role: 'group', 'aria-label': w.question.text },
          h(doc, 'span', { class: 'run-ask-q' }, w.question.text),
          h(
            doc,
            'span',
            { class: 'run-ask-keys' },
            h(doc, 'button', { class: 'key quiet', type: 'button', 'data-run-act': 'always-send', 'data-run-key': k, 'aria-label': `${ASK_COPY.always}: ${ASK_COPY.alwaysNote}`, ...(w.question.busy ? { 'aria-disabled': 'true', ...(w.question.busy === 'send' ? { 'aria-busy': 'true' } : {}) } : {}) }, w.question.busy === 'send' ? ASK_COPY.saving : ASK_COPY.always),
            h(doc, 'span', { class: 'run-ask-note' }, ASK_COPY.alwaysNote),
            h(doc, 'button', { class: 'key quiet', type: 'button', 'data-run-act': 'keep', 'data-run-key': k, ...(w.question.busy ? { 'aria-disabled': 'true', ...(w.question.busy === 'ask' ? { 'aria-busy': 'true' } : {}) } : {}) }, w.question.busy === 'ask' ? ASK_COPY.saving : ASK_COPY.keep),
          ),
          w.questionNote ? h(doc, 'span', { class: 'run-send-note' }, w.questionNote) : null,
        )
      : null,
  );
}

/* ── the DOM ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

interface Caller {
  call<T = unknown>(method: string, params?: unknown): Promise<T>;
}
export interface SlashMenuDeps extends Omit<SlashFlowDeps, 'call' | 'repaint' | 'live' | 'done'> {
  client: () => Caller | null;
  textarea: HTMLTextAreaElement;
  /** where the menu hangs (the composer form) */
  host: HTMLElement;
}
export interface SlashMenu {
  readonly flow: SlashFlow;
  /** the composer's text changed (typing): open, filter or close the menu */
  input(text: string, hsid: string | null, trusted: boolean): void;
  /** a composer keydown: true when the menu took it (the caller does nothing more) */
  key(e: KeyboardEvent): boolean;
  /** "Open / menu" (a host slip, the palette): a trusted press */
  openFor(hsid: string | null, trusted: boolean): boolean;
  close(): void;
  isOpen(): boolean;
}

const setId = (el: MiniEl, id: string): MiniEl => (el.setAttribute('id', id), el);

/** The listbox's rows (exported for tests over a fake document). */
export function listEls(doc: MiniDoc, items: readonly SlashItem[], active: string | null, phase: SlashUi['phase']): MiniEl[] {
  const out: MiniEl[] = [];
  let g: { label: string; el: MiniEl } | null = null;
  let n = 0;
  for (const it of items) {
    const label = it.groupLabel;
    if (!g || g.label !== `${it.group}\u0000${label}`) {
      const hid = `slash-g-${n++}`;
      const el = h(doc, 'div', { class: 'slash-group', role: 'group', 'aria-labelledby': hid }, setId(h(doc, 'div', { class: 'menu-h slash-h', role: 'presentation' }, it.group === 'tools' && label !== SLASH_COPY.group.tools ? `${SLASH_COPY.group.tools} · ${label}` : label), hid));
      out.push(el);
      g = { label: `${it.group}\u0000${label}`, el };
    }
    const on = it.key === active;
    g.el.appendChild(
      setId(
        h(
          doc,
          'div',
          { class: `slash-opt${on ? ' active' : ''}${it.disabled ? ' off' : ''}`, role: 'option', 'aria-selected': String(on), 'data-slash-key': it.key, ...(it.disabled ? { 'aria-disabled': 'true' } : {}) },
          h(doc, 'span', { class: 'slash-name' }, it.name),
          h(doc, 'span', { class: 'slash-note' }, it.note),
          it.why ? h(doc, 'span', { class: 'slash-why' }, it.why) : null,
        ),
        it.id,
      ),
    );
  }
  if (!items.length) out.push(h(doc, 'p', { class: 'slash-empty', role: 'presentation' }, phase === 'reading' ? SLASH_COPY.reading : SLASH_COPY.noMatch));
  else if (phase === 'unreachable') out.push(h(doc, 'p', { class: 'slash-empty fail', role: 'presentation' }, SLASH_COPY.unreachable));
  return out;
}

export function mountSlashMenu(doc: Document, d: SlashMenuDeps): SlashMenu {
  const mini = doc as unknown as MiniDoc;
  const ta = d.textarea;
  const wrap = doc.createElement('div');
  wrap.id = 'slash-menu';
  wrap.className = 'slash-menu';
  wrap.hidden = true;
  // one persistent live line from mount (a region must exist before its text changes to be announced)
  const say = doc.createElement('p');
  say.id = 'slash-say';
  say.className = 'sr-only';
  say.setAttribute('role', 'status');
  say.setAttribute('aria-live', 'polite');
  const list = doc.createElement('div');
  list.id = 'slash-list';
  list.className = 'slash-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', SLASH_COPY.label);
  const foot = doc.createElement('p');
  foot.className = 'slash-foot';
  foot.textContent = '↑ ↓ move · Enter opens · Esc closes the menu';
  const panel = doc.createElement('div');
  panel.id = 'slash-args';
  panel.className = 'slash-args';
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-labelledby', 'slash-args-h');
  panel.hidden = true;
  wrap.append(list, foot, panel);
  d.host.prepend(wrap);
  d.host.appendChild(say);
  ta.setAttribute('aria-controls', 'slash-list');

  const call = async (req: SlashRequest): Promise<unknown> => {
    const c = d.client();
    if (!c) throw new Error('not connected');
    return c.call('log.append', req);
  };
  let clockTimer: ReturnType<typeof setInterval> | null = null;
  const flow = new SlashFlow({
    ...d,
    call,
    repaint: () => paint(),
    live: (t) => void (say.textContent = t),
    done: () => {
      if (/^\/\S*$/.test(ta.value)) ta.value = '';
      ta.dispatchEvent(new Event('input')); // the composer refits (an untrusted input opens nothing)
      ta.focus();
    },
    runAdded: (v) => {
      d.runAdded(v);
      ticks();
    },
    runChanged: (v) => {
      d.runChanged(v);
      ticks();
    },
  });
  /** one interval while a run row shows a clock (running, reading): it rewrites the mounted clocks only, and stops itself */
  const ticks = (): void => {
    if (clockTimer) return;
    clockTimer = setInterval(() => {
      const els = doc.querySelectorAll<HTMLElement>('[data-run-clock]');
      if (!els.length && clockTimer) {
        clearInterval(clockTimer);
        clockTimer = null;
      }
      for (const el of els) el.textContent = ` · ${runClock(el.dataset.runClock!, Date.now())}`;
    }, 1000);
  };

  const fieldEl = (f: ArgField, n: number, s: SlashUi): HTMLElement => {
    const err = s.errors[f.name];
    const fid = `slash-f-${n}`;
    const eid = `slash-e-${n}`;
    const row = doc.createElement('div');
    row.className = 'slash-field';
    const lab = h(mini, 'label', { class: 'sf-label' }, f.label, f.required ? h(mini, 'small', { class: 'slash-req' }, ` · ${SLASH_COPY.needed}`) : null) as unknown as HTMLElement;
    if (f.kind === 'bool' || f.kind === 'enum') lab.id = `${fid}-l`;
    else lab.setAttribute('for', fid);
    row.appendChild(lab);
    const v = s.values[f.name] ?? '';
    let ctl: HTMLElement;
    if (f.kind === 'bool' || f.kind === 'enum') {
      ctl = h(mini, 'span', { class: 'seg slash-seg', role: 'radiogroup', 'aria-labelledby': `${fid}-l` }) as unknown as HTMLElement;
      f.options.forEach((o, i) => {
        const on = v === String(i);
        ctl.appendChild(h(mini, 'button', { class: `key quiet seg-key${on ? ' current' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(on), 'data-slash-seg': f.name, 'data-slash-value': String(i), tabindex: on || (v === '' && i === 0) ? '0' : '-1' }, o.label) as unknown as Node);
      });
    } else if (f.kind === 'json') {
      const t = doc.createElement('textarea');
      t.className = 'field slash-json';
      t.rows = 3;
      t.value = v;
      t.placeholder = f.placeholder;
      t.spellcheck = false;
      ctl = t;
    } else {
      const i = doc.createElement('input');
      i.className = 'field';
      i.type = 'text';
      i.value = v;
      i.placeholder = f.placeholder;
      i.autocomplete = 'off';
      i.spellcheck = false;
      if (f.kind === 'number') i.inputMode = 'decimal';
      if (f.name === 'args') i.maxLength = 4096;
      ctl = i;
    }
    if (f.kind !== 'bool' && f.kind !== 'enum') {
      ctl.id = fid;
      ctl.dataset.slashField = f.name;
      if (f.required) ctl.setAttribute('aria-required', 'true');
    }
    if (err) {
      ctl.setAttribute('aria-invalid', 'true');
      ctl.setAttribute('aria-describedby', eid);
    }
    row.appendChild(ctl);
    if (f.description) row.appendChild(h(mini, 'span', { class: 'slash-why' }, f.description) as unknown as Node);
    if (err) row.appendChild(setId(h(mini, 'span', { class: 'slash-err' }, err), eid) as unknown as Node);
    return row;
  };

  const paintPanel = (s: SlashUi, it: SlashItem): void => {
    const head = h(mini, 'p', { class: 'slash-args-h' }, it.name, it.kind === 'tool' ? h(mini, 'span', { class: 'slash-note' }, ` on ${it.tool!.server}`) : null);
    head.setAttribute('id', 'slash-args-h');
    const els: Node[] = [head as unknown as Node];
    if (it.why) els.push(h(mini, 'p', { class: 'slash-why' }, it.why) as unknown as Node);
    const fields = argFieldsOf(it);
    fields.forEach((f, n) => els.push(fieldEl(f, n, s)));
    if (s.result) els.push(h(mini, 'p', { class: 'sf-result fail', role: 'alert' }, s.result) as unknown as Node);
    const runKey = h(mini, 'button', { class: 'key pri', type: 'button', 'data-slash-act': 'run', ...(s.busy ? { 'aria-busy': 'true', 'aria-disabled': 'true' } : {}) }, runKeyLabel(it)) as unknown as Node;
    const close = h(mini, 'button', { class: 'key quiet', type: 'button', 'data-slash-act': 'close', title: SLASH_COPY.close }, 'close') as unknown as Node;
    els.push(h(mini, 'div', { class: 'sf-keys' }, runKey as unknown as MiniEl, close as unknown as MiniEl) as unknown as Node);
    panel.replaceChildren(...els);
  };

  const paint = (): void => {
    const s = flow.state();
    const f = flow.takeFocus();
    if (!s) {
      // Mika C6'b2-1 #2: focus inside the menu (a field, Run, close) returns to the textarea on any close, read BEFORE
      // the panel's fields are removed (removing them drops focus to the body)
      const inside = wrap.contains(doc.activeElement);
      wrap.hidden = true;
      panel.hidden = true;
      panel.replaceChildren();
      list.replaceChildren();
      ta.removeAttribute('aria-activedescendant');
      ta.removeAttribute('aria-expanded');
      if (inside || (f === 'textarea' && doc.activeElement === doc.body)) ta.focus();
      return;
    }
    wrap.hidden = false;
    const argsIt = flow.item(s.args);
    if (argsIt) {
      // a repaint keeps focus (and the caret) on the same field
      const a = doc.activeElement as HTMLElement | null;
      const keep = a && panel.contains(a) ? (a.dataset.slashField !== undefined ? `[data-slash-field="${CSS.escape(a.dataset.slashField)}"]` : a.dataset.slashSeg !== undefined ? `[data-slash-seg="${CSS.escape(a.dataset.slashSeg)}"][data-slash-value="${CSS.escape(a.dataset.slashValue ?? '')}"]` : a.dataset.slashAct ? `[data-slash-act="${a.dataset.slashAct}"]` : null) : null;
      const caret = a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement ? [a.selectionStart, a.selectionEnd] : null;
      list.hidden = true;
      foot.hidden = true;
      panel.hidden = false;
      ta.removeAttribute('aria-activedescendant');
      paintPanel(s, argsIt);
      const firstErr = Object.keys(s.errors)[0];
      const to = f === 'panel'
        ? ((firstErr ? panel.querySelector(`[data-slash-field="${CSS.escape(firstErr)}"], [data-slash-seg="${CSS.escape(firstErr)}"]`) : null) ?? (s.result ? panel.querySelector('[data-slash-act="run"]') : null) ?? panel.querySelector('[data-slash-field], .seg-key[tabindex="0"], [data-slash-act="run"]'))
        : keep ? panel.querySelector(keep) : null;
      if (to) {
        (to as HTMLElement).focus({ preventScroll: true });
        if (caret && (to instanceof HTMLInputElement || to instanceof HTMLTextAreaElement) && caret[0] !== null) to.setSelectionRange(caret[0], caret[1]);
      }
      return;
    }
    panel.hidden = true;
    panel.replaceChildren();
    list.hidden = false;
    foot.hidden = false;
    const items = flow.items();
    list.replaceChildren(...(listEls(mini, items, s.active, s.phase) as unknown as Node[]));
    const act = items.find((i) => i.key === s.active);
    if (act) {
      ta.setAttribute('aria-activedescendant', act.id);
      (doc.getElementById(act.id) as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest' });
    } else ta.removeAttribute('aria-activedescendant');
    if (f === 'textarea' || wrap.contains(doc.activeElement)) ta.focus({ preventScroll: true });
  };

  // a press on a row keeps the textarea's focus (mousedown would take it) and acts on the click
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const o = (e.target as HTMLElement).closest('[data-slash-key]') as HTMLElement | null;
    if (o) flow.press(o.dataset.slashKey!, e.isTrusted);
  });
  panel.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const seg = t.closest('[data-slash-seg]') as HTMLElement | null;
    if (seg) return flow.choose(seg.dataset.slashSeg!, seg.dataset.slashValue ?? '');
    const k = t.closest('[data-slash-act]') as HTMLElement | null;
    if (!k) return;
    if (k.dataset.slashAct === 'close') return void flow.close();
    if (k.getAttribute('aria-disabled') === 'true') return;
    if (k.dataset.slashAct === 'run') void flow.runArgs(e.isTrusted);
  });
  panel.addEventListener('input', (e) => {
    const f = e.target as HTMLInputElement;
    if (f.dataset?.slashField !== undefined) flow.setValue(f.dataset.slashField, f.value);
  });
  panel.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // Esc closes only the menu
      flow.close();
      return;
    }
    if (e.key === 'Tab') return trapTab(panel, e);
    // a seg: the arrows move and choose (one tab stop)
    if (t.dataset.slashSeg !== undefined && (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const keys = [...panel.querySelectorAll<HTMLElement>(`[data-slash-seg="${CSS.escape(t.dataset.slashSeg)}"]`)];
      const at = keys.indexOf(t);
      const to = keys[(at + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : keys.length - 1)) % keys.length]!;
      flow.choose(to.dataset.slashSeg!, to.dataset.slashValue ?? '');
      (panel.querySelector(`[data-slash-seg="${CSS.escape(to.dataset.slashSeg!)}"][data-slash-value="${CSS.escape(to.dataset.slashValue ?? '')}"]`) as HTMLElement | null)?.focus();
      return;
    }
    // Enter in a one-line field runs (the JSON field keeps Enter for a newline; ⌘Enter runs from it)
    if (e.key === 'Enter' && !e.shiftKey && (t instanceof HTMLInputElement || (t instanceof HTMLTextAreaElement && (e.metaKey || e.ctrlKey)))) {
      e.preventDefault();
      void flow.runArgs(e.isTrusted);
    }
  });

  return {
    flow,
    input(text, hsid, trusted) {
      const q = hsid ? (/^\/([^\s/]{0,64})$/.exec(text)?.[1] ?? null) : null;
      if (q === null) {
        if (flow.isOpen() && !flow.state()!.args) flow.close();
        return;
      }
      if (flow.isOpen() && flow.state()!.hsid === hsid) flow.setQuery(q);
      else flow.open(hsid!, q, trusted);
    },
    key(e) {
      const s = flow.state();
      if (!s || s.args) return false;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        flow.move(e.key === 'ArrowDown' ? 1 : -1);
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // Esc closes only the menu (never a sheet, the speech or a draft under it)
        flow.close();
        return true;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        if (!flow.items().length) {
          flow.close(); // nothing matches: Enter sends the text as a message
          return false;
        }
        e.preventDefault();
        flow.press(null, e.isTrusted);
        return true;
      }
      return false;
    },
    openFor(hsid, trusted) {
      if (!trusted || !hsid) return false;
      if (!ta.value) {
        ta.value = '/';
        ta.dispatchEvent(new Event('input'));
      }
      ta.focus();
      return flow.open(hsid, '', trusted);
    },
    close: () => void flow.close(),
    isOpen: () => flow.isOpen(),
  };
}
