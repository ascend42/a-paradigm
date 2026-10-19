/**
 * @symbol #gui
 *
 * #gui state (spec §11.4 left sidebar, decision stack, panes). PURE reducers
 * over `log.read` rows (event:v1 as projected for this principal, §9.3): the
 * GUI repaints only on events or input (motion-on-events, `G-GUI-02`).
 *
 *   - Sessions: grouped by project (`scope.repo`, else "unscoped"); a row per
 *     hsid with its state and pending-card count `{n, of}` (D44).
 *   - Transcript: every row whose `session` (or payload.hsid) is that hsid, in
 *     seq order; a stubbed (sensitive) row stays a stub — the GUI never
 *     guesses what the projection withheld.
 *   - Decision stack (D43, `G-GUI-09`): cards keyed by cardId in arrival
 *     order; a decision or expiry removes THAT card only, so deciding a later
 *     card leaves earlier ones pending and untouched; per-project filtering
 *     uses the request row's `scope.repo`; the global inbox shows all.
 *   - Wire rows (contracts `LogRow`): the kernel sends `{seq, view:'full',
 *     event}`, `{seq, view:'stub', stub:{kind, hsid?, at}}` or `{seq,
 *     view:'oversize', kind, bytes}`; `rowOf` flattens each into a `Row`
 *     BEFORE the reducers read `kind`/`session`/`payload` (a nested row read
 *     flat has no kind and no session: no session list, no transcript — the
 *     dogfood bug this closes). An already-flat row passes through.
 *   - Read position (journal.cursor, P8-D98, §5): `logId` + `position` form
 *     the `{logId, seq}` cursor the next log.read resumes from. A seq means
 *     something only inside one log, so `reset()` drops everything when the
 *     kernel answers `cursor-epoch` (or a page names another log) and the GUI
 *     re-reads from the start.
 */

export interface Row {
  seq: number;
  kind: string;
  at?: string;
  session?: string;
  connId?: string;
  principal?: string;
  scope?: { repo?: string } & Record<string, unknown>;
  payload?: unknown;
  view?: string;
  hash?: string;
}

export interface StackCard {
  cardId: string;
  kind: string;
  repo: string | null;
  hsid: string | null;
  card: Record<string, unknown>;
  flags: string[];
  arrivedSeq: number;
}

export interface SessionRow {
  hsid: string;
  repo: string | null;
  state: string;
  backend: string | null;
  openedSeq: number;
  lastSeq: number;
}

export const UNSCOPED = '(unscoped)';

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/**
 * One `log.read` row (page row or subscription `event.row`) as the store's flat `Row`, or null when it carries no
 * seq. `full` → the projected event's envelope fields; `stub` → kind, session (the stub's hsid) and at, no payload
 * (rendered as withheld); `oversize` → kind only; an unknown view stays an opaque row of kind `unknown`.
 */
export function rowOf(w: unknown): Row | null {
  if (!w || typeof w !== 'object' || Array.isArray(w)) return null;
  const o = w as Record<string, unknown>;
  if (typeof o.seq !== 'number') return null;
  const seq = o.seq;
  if (o.view === 'full' && o.event && typeof o.event === 'object' && !Array.isArray(o.event)) {
    const e = o.event as Record<string, unknown>;
    const scope = e.scope && typeof e.scope === 'object' && !Array.isArray(e.scope) ? (e.scope as Row['scope']) : undefined;
    return {
      seq,
      kind: str(e.kind) ?? 'unknown',
      view: 'full',
      ...(str(e.at) !== undefined ? { at: str(e.at) } : {}),
      ...(str(e.session) !== undefined ? { session: str(e.session) } : {}),
      ...(str(e.connId) !== undefined ? { connId: str(e.connId) } : {}),
      ...(str(e.principal) !== undefined ? { principal: str(e.principal) } : {}),
      ...(scope ? { scope } : {}),
      ...(Object.hasOwn(e, 'payload') ? { payload: e.payload } : {}),
      ...(str(e.hash) !== undefined ? { hash: str(e.hash) } : {}),
    };
  }
  if (o.view === 'stub' && o.stub && typeof o.stub === 'object' && !Array.isArray(o.stub)) {
    const st = o.stub as Record<string, unknown>;
    return { seq, kind: str(st.kind) ?? 'unknown', view: 'stub', ...(str(st.hsid) !== undefined ? { session: str(st.hsid) } : {}), ...(str(st.at) !== undefined ? { at: str(st.at) } : {}) };
  }
  if (o.view === 'oversize') return { seq, kind: str(o.kind) ?? 'unknown', view: 'oversize' };
  if (o.view === undefined && typeof o.kind === 'string') return o as unknown as Row; // already flat (the page's own lines, tests)
  return { seq, kind: 'unknown', view: str(o.view) ?? 'unknown' };
}

export class GuiStore {
  readonly sessions = new Map<string, SessionRow>();
  /** hsid → row seqs (indices into `rows`) in seq order. */
  readonly #transcripts = new Map<string, Row[]>();
  /** Rows with no session, kept for the kernel feed. */
  readonly kernelFeed: Row[] = [];
  readonly cards = new Map<string, StackCard>();
  #cardSeq = 0;
  head = 0;
  rowsSeen = 0;
  /** The log these rows came from (a page's / subscription's `logId`); null before the first read. */
  logId: string | null = null;
  /** The highest seq read or scanned (a page's `next` can pass the last visible row). */
  position = 0;
  readonly #listeners = new Set<(what: Set<string>) => void>();

  onChange(fn: (what: Set<string>) => void): () => void {
    this.#listeners.add(fn);
    return () => void this.#listeners.delete(fn);
  }

  #emit(what: Set<string>): void {
    if (what.size) for (const fn of this.#listeners) fn(what);
  }

  transcript(hsid: string): readonly Row[] {
    return this.#transcripts.get(hsid) ?? [];
  }

  /** The resume cursor `{logId, seq}`, or undefined (read from the start). */
  cursor(): { logId: string; seq: number } | undefined {
    const seq = Math.max(this.position, this.head);
    return this.logId !== null && seq > 0 ? { logId: this.logId, seq } : undefined;
  }

  /** Record a page's `next` (rows scanned past the last visible one). */
  advance(next: number): void {
    if (Number.isSafeInteger(next) && next > this.position) this.position = next;
  }

  /** The kernel named the log it read from; another log than ours ⇒ our seqs mean nothing there: start over. */
  adopt(logId: string): void {
    if (this.logId !== null && this.logId !== logId) this.reset();
    this.logId = logId;
  }

  /** Drop every row-derived state (cursor-epoch): the GUI re-reads from the start of the current log. */
  reset(): void {
    this.sessions.clear();
    this.#transcripts.clear();
    this.kernelFeed.length = 0;
    this.cards.clear();
    this.#cardSeq = 0;
    this.head = 0;
    this.rowsSeen = 0;
    this.position = 0;
    this.logId = null;
    this.#emit(new Set(['reset', 'sessions', 'cards', 'feed']));
  }

  /** Apply a batch of rows (backlog page or one live event); notifies once. */
  apply(rows: readonly unknown[]): Set<string> {
    const what = new Set<string>();
    for (const w of rows) {
      const r = rowOf(w);
      if (r) this.#applyOne(r, what);
    }
    this.#emit(what);
    return what;
  }

  #applyOne(r: Row, what: Set<string>): void {
    if (typeof r.seq !== 'number' || r.seq <= this.head) return; // at-most-once per seq (re-subscribe overlap)
    this.head = r.seq;
    this.rowsSeen++;
    const p = (r.payload && typeof r.payload === 'object' ? r.payload : {}) as Record<string, unknown>;
    const hsid = typeof r.session === 'string' ? r.session : typeof p.hsid === 'string' ? p.hsid : null;
    const repo = typeof r.scope?.repo === 'string' ? r.scope.repo : null;
    if (hsid) {
      let t = this.#transcripts.get(hsid);
      if (!t) this.#transcripts.set(hsid, (t = []));
      t.push(r);
      what.add(`transcript:${hsid}`);
      let s = this.sessions.get(hsid);
      if (!s) {
        s = { hsid, repo, state: 'seen', backend: null, openedSeq: r.seq, lastSeq: r.seq };
        this.sessions.set(hsid, s);
      }
      s.lastSeq = r.seq;
      if (repo && !s.repo) s.repo = repo;
      if (r.kind === 'session.open') {
        s.state = typeof p.state === 'string' ? p.state : 'open';
        if (typeof p.backend === 'string') s.backend = p.backend;
      } else if (r.kind === 'session.refused') s.state = 'refused';
      else if (r.kind === 'session.stop' || r.kind === 'session.exit' || r.kind === 'session.end') s.state = 'stopped';
      else if (r.kind === 'turn.partial') s.state = 'streaming';
      else if (r.kind === 'turn.result') s.state = 'idle';
      what.add('sessions');
    } else {
      this.kernelFeed.push(r);
      what.add('feed');
    }
    if (r.kind === 'daemon.start') {
      // §2.4 rule 11 (T-2026-10-19-014 B2): a kernel (re)started; every card raised before it belonged to the old
      // process (its broker is gone, an old card id is refused), so none stays clickable
      if (this.cards.size) {
        for (const id of this.cards.keys()) what.add(`card-out:${id}`);
        this.cards.clear();
        what.add('cards');
      }
    } else if (r.kind === 'approval.request') {
      const card = (p.card && typeof p.card === 'object' ? p.card : null) as Record<string, unknown> | null;
      if (card && typeof card.cardId === 'string') {
        this.cards.set(card.cardId, {
          cardId: card.cardId,
          kind: typeof card.kind === 'string' ? card.kind : 'unknown',
          repo,
          hsid: typeof card.hsid === 'string' ? card.hsid : hsid,
          card,
          flags: Array.isArray(p.flags) ? p.flags.filter((f): f is string => typeof f === 'string') : Array.isArray(card.flags) ? (card.flags as unknown[]).filter((f): f is string => typeof f === 'string') : [],
          arrivedSeq: ++this.#cardSeq,
        });
        what.add('cards');
        what.add(`card-in:${card.cardId}`);
      }
    } else if (r.kind === 'approval.decide' || r.kind === 'approval.expire') {
      if (typeof p.cardId === 'string' && this.cards.delete(p.cardId)) {
        what.add('cards');
        what.add(`card-out:${p.cardId}`);
      }
    }
  }

  /** The stack, arrival order; inside a session only that project's cards (`repo` given), else all (global inbox). */
  stack(repo?: string | null): StackCard[] {
    const all = [...this.cards.values()].sort((a, b) => a.arrivedSeq - b.arrivedSeq);
    return repo === undefined ? all : all.filter((c) => c.repo === repo);
  }

  /** Sessions grouped by project, projects sorted, sessions newest first. */
  groups(): Array<{ repo: string; sessions: Array<SessionRow & { pending: number }> }> {
    const by = new Map<string, Array<SessionRow & { pending: number }>>();
    for (const s of this.sessions.values()) {
      const k = s.repo ?? UNSCOPED;
      const pending = [...this.cards.values()].filter((c) => c.hsid === s.hsid).length;
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push({ ...s, pending });
    }
    return [...by.entries()]
      .sort(([a], [b]) => (a === UNSCOPED ? 1 : b === UNSCOPED ? -1 : a.localeCompare(b)))
      .map(([repo, sessions]) => ({ repo, sessions: sessions.sort((a, b) => b.lastSeq - a.lastSeq) }));
  }

  /** Inbox pending by kind (Shuttle view). */
  pendingByKind(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const c of this.cards.values()) out[c.kind] = (out[c.kind] ?? 0) + 1;
    return out;
  }
}

/** A one-line, sanitizable summary of a row for the transcript (never markup). */
export function rowSummary(r: Row): string {
  if (r.view === 'oversize') return `${r.kind} · oversize row withheld from this view`;
  const p = r.payload;
  if (p === undefined) return `${r.kind} · withheld by this view's projection (§9.3)`;
  if (p && typeof p === 'object') {
    const o = p as Record<string, unknown>;
    if (o.redacted === true) return `${r.kind} · redacted`;
    if (r.kind === 'turn.event' && typeof o.line === 'string') return turnEventSummary(o.line, typeof o.type === 'string' ? o.type : null);
    const parts: string[] = [];
    for (const [k, v] of Object.entries(o)) {
      if (k === 'hsid' || k === 'card') continue;
      const val = v && typeof v === 'object' ? ((v as { redacted?: unknown }).redacted === true ? '⟨redacted⟩' : JSON.stringify(v)) : String(v);
      parts.push(`${k} ${val.length > 120 ? `${val.slice(0, 117)}…` : val}`);
      if (parts.length >= 6) break;
    }
    return parts.length ? `${r.kind} · ${parts.join(' · ')}` : r.kind;
  }
  return `${r.kind} · ${String(p)}`;
}

const TURN_TEXT_MAX = 4000;

/**
 * A backend stream line (turn.event `line`, claude-code stream-json) as one transcript line: the assistant's text,
 * the tools it called, the result's subtype; every other line is its type only. Never throws on a line it cannot
 * parse (an opaque `turn.event · <type>`); the text still reaches the DOM only through the sanitizer.
 */
export function turnEventSummary(line: string, type: string | null): string {
  let m: Record<string, unknown> | null = null;
  try {
    const v = JSON.parse(line) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) m = v as Record<string, unknown>;
  } catch {
    m = null;
  }
  const t = typeof m?.type === 'string' ? m.type : type ?? 'line';
  if (m && t === 'assistant') {
    const msg = (m.message && typeof m.message === 'object' ? m.message : {}) as { content?: unknown };
    const parts = Array.isArray(msg.content) ? msg.content : [];
    const text: string[] = [];
    const tools: string[] = [];
    for (const c of parts) {
      const x = (c && typeof c === 'object' ? c : {}) as { type?: unknown; text?: unknown; name?: unknown };
      if (x.type === 'text' && typeof x.text === 'string' && x.text.trim()) text.push(x.text);
      else if (x.type === 'tool_use') tools.push(typeof x.name === 'string' ? x.name : '?');
    }
    const out = [text.length ? text.join('\n') : '', tools.length ? `tool ${tools.join(', ')}` : ''].filter(Boolean).join(' · ');
    if (!out) return 'assistant';
    return `assistant · ${out.length > TURN_TEXT_MAX ? `${out.slice(0, TURN_TEXT_MAX - 1)}…` : out}`;
  }
  if (m && t === 'result') return `result · ${typeof m.subtype === 'string' ? m.subtype : m.is_error === true ? 'error' : 'done'}`;
  return `turn.event · ${type ?? t}`;
}
