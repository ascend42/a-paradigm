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
import { isLoopCardKind } from './loops.js';
import { sentLabel } from './voice-presets.js';
import { StepTracker, type StepNow, type TurnStep } from './turn-steps.js';
import { projectHue, sha256Tagged, validateKindPayload } from '@a-company/gnomon-contracts';
import { MODE_ROW_KINDS } from './modes.js';
import { rootRowsOf, rowsDigestCheck } from './render.js';
import { idleNoteOf, speakerName, startRungName, VOICE_ACTIVITY_KINDS, VOICE_ROW_KINDS } from './voice.js';
import { isClientRow, type EnrolState } from './voice-client.js';
import { refusalPhrase } from './capture.js';
import { foldOffers, OFFER_ROW_KINDS, stripOfferBlocks, type OfferBook } from './offers.js';

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
  /** dictation (TD-2026-10-20-262): this page's composer echo of an edited voice draft (🎙✎) */
  mark?: 'voice-edited';
  /** review M1: this page's composer echo, stamped with the turn id session.send returned (pairs with turn.sent{turn}) */
  turn?: string;
  /** review M1: this page's composer echo whose send was refused or failed on the network: it is not a turn */
  unsent?: boolean;
}

export interface StackCard {
  cardId: string;
  kind: string;
  repo: string | null;
  hsid: string | null;
  card: Record<string, unknown>;
  flags: string[];
  arrivedSeq: number;
  /** S3: the approval.request row's at ("raised HH:MM · waiting Nm"). */
  raisedAt?: string | null;
  /** fidelity 2: the kernel's STRUCTURED tool fields of the approval.request row (broker.ts logs `tool`, `tool_input`);
   * the permission card's one-line title is composed from these (permissionTitleOf), never from display text */
  tool?: string | null;
  toolInput?: Record<string, unknown> | null;
}

export interface SessionRow {
  hsid: string;
  repo: string | null;
  state: string;
  backend: string | null;
  openedSeq: number;
  lastSeq: number;
  /** The kernel boot (count of daemon.start rows read) this session was last opened in. */
  boot: number;
  /** S2: the session.open cwd (the key of the one project hue, projectHue) and its at (the chat header's "started"). */
  cwd?: string | null;
  openedAt?: string | null;
  /** S2: the first user message (the session's derived name, sessionTitle); null until one is seen. */
  firstUser?: string | null;
  /** 8.0:session-rename: the name the human gave it (the kernel's last session.renamed); null = the derived title. */
  name?: string | null;
}

/** Session states that mean the session is gone (it can only come back through a session.open of a resume). */
export const TERMINAL: ReadonlySet<string> = new Set(['ended', 'failed', 'orphaned', 'refused', 'stopped']);

/**
 * S2: a session.exited that was not asked for and did not end clean is a failure ("failed", vermilion), not "ended":
 * the payload says reason 'error', or (no stop reason) a non-zero exit code or a signal.
 */
export function failedExit(p: Record<string, unknown>): boolean {
  if (p.reason === 'error') return true;
  if (typeof p.reason === 'string') return false;
  return (typeof p.code === 'number' && p.code !== 0) || typeof p.signal === 'string';
}
/** Live = opened and not ended. `seen` (rows with no session.open) is not live: nothing says a process runs. */
export function isLiveState(state: string): boolean {
  return state !== 'seen' && !TERMINAL.has(state);
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
  /** Aegis L1: final voice-turn texts by seq, until a turn.sent cites them (bounded). */
  readonly #voiceTexts = new Map<number, string>();
  /** Rows with no session, kept for the kernel feed. */
  readonly kernelFeed: Row[] = [];
  readonly cards = new Map<string, StackCard>();
  /** TD-2026-10-24-447: true while loops are off in this build; loop-trust / loop-choice cards held from an 8.0.0 install are then not shown or counted. The page sets it from status.loops. */
  loopCardsHidden: () => boolean = () => false;
  /** Cards the human can see: every card, less the stale loop cards while loops are off. The one source for the stack, the inbox badge, the empty-state count and a session's pending count. */
  visibleCards(): StackCard[] {
    const hide = this.loopCardsHidden();
    return [...this.cards.values()].filter((c) => !(hide && isLoopCardKind(c.kind)));
  }
  visibleCardCount(): number {
    return this.visibleCards().length;
  }
  /** #gui-loops: the kernel's loop.notified{as:'card'} rows by cardId (which loop run raised a loop-choice card; newest 256) */
  readonly loopCards = new Map<string, { loopId: string; runId?: string; nodeId?: string; text?: string }>();
  /** Aegis C1e: root decisions logged with a rowsDigest that is not the shown rows' digest (newest 16), shown red */
  readonly rootMismatches: Array<{ cardId: string; decision: string; shown: string; logged: string | null }> = [];
  #cardSeq = 0;
  head = 0;
  rowsSeen = 0;
  /** daemon.start rows read: each one is a new kernel boot. */
  boot = 0;
  /** The log these rows came from (a page's / subscription's `logId`); null before the first read. */
  logId: string | null = null;
  /** V2d: the kernel's ambient idle auto-off (status.voice.ambientIdleMs), set by the page; names the note's minutes */
  voiceIdleMs: number | null = null;
  /** V2e: the "Teach Gnomon your voice" flow while its dialog is open (the page opens it; status.voice.enrolment folds into it). */
  enrol: EnrolState | null = null;
  /**
   * The next warn toast (core/toasts.ts TOAST_WARN_MS; it leaves by itself), until the page shows it: the voice
   * app's notice (A5: status.voice.notice, set by the page) or, board header-5b, the kernel's idle auto-off ("Dictate
   * turned off after 10 min idle", `idle`; a voice.session.start drops one not yet shown).
   */
  voiceToast: { text: string; at: string | null; idle?: true } | null = null;
  /** The rung the latest voice.session.start named (startRungName), for the idle toast's words. */
  #voiceRung: string | null = null;
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

  /** #gui-offer-slip: the conversation's margin slips, folded ONLY from its kernel offer rows (core/offers.ts). */
  offers(hsid: string): OfferBook {
    return foldOffers(this.transcript(hsid), hsid);
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
    this.boot = 0;
    this.position = 0;
    this.logId = null;
    this.voiceToast = null;
    this.#voiceRung = null;
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
    if (r.kind === 'loop.notified' && p.as === 'card' && typeof p.cardId === 'string' && typeof p.loopId === 'string') {
      this.loopCards.set(p.cardId, { loopId: p.loopId, ...(typeof p.runId === 'string' ? { runId: p.runId } : {}), ...(typeof p.nodeId === 'string' ? { nodeId: p.nodeId } : {}), ...(typeof p.text === 'string' ? { text: p.text } : {}) });
      if (this.loopCards.size > 256) this.loopCards.delete(this.loopCards.keys().next().value!);
      what.add('cards');
    }
    const repo = typeof r.scope?.repo === 'string' ? r.scope.repo : null;
    if (hsid) {
      let t = this.#transcripts.get(hsid);
      if (!t) this.#transcripts.set(hsid, (t = []));
      t.push(r);
      what.add(`transcript:${hsid}`);
      let s = this.sessions.get(hsid);
      if (!s) {
        s = { hsid, repo, state: 'seen', backend: null, openedSeq: r.seq, lastSeq: r.seq, boot: this.boot };
        this.sessions.set(hsid, s);
      }
      s.lastSeq = r.seq;
      if (repo && !s.repo) s.repo = repo;
      if (r.kind === 'session.open') {
        // a fresh open, or a resume in this boot (§2.4 rule 11): live again whatever the old kernel left
        s.state = typeof p.state === 'string' && !TERMINAL.has(p.state) ? p.state : 'open';
        s.boot = this.boot;
        if (typeof p.backend === 'string') s.backend = p.backend;
        if (typeof p.cwd === 'string') s.cwd = p.cwd;
        if (!s.openedAt && typeof r.at === 'string') s.openedAt = r.at;
      } else if (r.kind === 'session.refused') s.state = 'refused';
      else if (r.kind === 'session.orphaned') s.state = 'orphaned'; // the new kernel's boot sweep (§2.4 rule 4)
      else if (r.kind === 'session.exited' && failedExit(p)) s.state = 'failed';
      else if (r.kind === 'session.exited' || r.kind === 'session.stop' || r.kind === 'session.exit' || r.kind === 'session.end') s.state = 'ended';
      else if (isLiveState(s.state) && r.kind === 'turn.partial') s.state = 'streaming';
      else if (isLiveState(s.state) && r.kind === 'turn.result') s.state = 'idle';
      // 8.0:session-rename: the kernel's session.renamed (normalised display text; '' = back to the derived title)
      if (r.kind === 'session.renamed' && r.view === 'full' && validateKindPayload('session.renamed', p).length === 0 && p.hsid === hsid) s.name = (p.name as string) || null;
      if (!s.firstUser) {
        // S2 session names: the first thing the human said (claude's replay of it, or a sent voice turn)
        if (r.kind === 'turn.event' && r.view === 'full' && typeof p.line === 'string') s.firstUser = lineItems(p.line).find((it) => it.role === 'user' && it.text.trim())?.text ?? null;
        else if (r.kind === 'turn.sent' && p.source === 'voice') {
          // Aegis L1: a voice turn names the session only once the kernel says it was SENT (turn.sent cites its seq)
          const cited = (Array.isArray(p.voiceTurnSeqs) ? p.voiceTurnSeqs : [p.voiceTurnSeq]).filter((n): n is number => typeof n === 'number');
          const t = cited.map((n) => this.#voiceTexts.get(n)).filter((x): x is string => !!x).join(' ');
          if (t.trim()) s.firstUser = t;
        }
      }
      if (r.kind === 'voice.turn.user' && p.partial !== true && p.trialTake !== true && typeof p.text === 'string' && p.text.trim()) {
        this.#voiceTexts.set(r.seq, p.text);
        if (this.#voiceTexts.size > 256) this.#voiceTexts.delete(this.#voiceTexts.keys().next().value!);
      }
      what.add('sessions');
    } else {
      this.kernelFeed.push(r);
      what.add('feed');
    }
    // P8-D87: rows that change status.runModes — the page re-reads status on them (motion-on-events, no polling)
    if (MODE_ROW_KINDS.has(r.kind)) what.add('modes');
    // #gui-offer-slip: an offer row (shown / decided / kept) changes that conversation's slips
    if (hsid && OFFER_ROW_KINDS.has(r.kind)) what.add(`offers:${hsid}`);
    // V2d: an attachment row changes status.voice (the pill re-reads it); a turn row kicks the level meter. Board
    // header-5b: the kernel's idle auto-off is a warn toast in the ladder's words (it leaves by itself), never a
    // note left in the header
    if (VOICE_ROW_KINDS.has(r.kind)) {
      what.add('voice');
      if (r.kind === 'voice.session.start') {
        this.#voiceRung = startRungName(r.payload) ?? this.#voiceRung;
        if (this.voiceToast?.idle) this.voiceToast = null;
      } else if (r.kind === 'voice.session.end') {
        const text = idleNoteOf(r.kind, r.payload, this.voiceIdleMs, this.#voiceRung);
        if (text) {
          this.voiceToast = { text, at: r.at ?? null, idle: true };
          what.add('voice-toast');
        }
      }
    }
    if (VOICE_ACTIVITY_KINDS.has(r.kind)) what.add('voice-activity');
    // V2e: the voice app's lifecycle, the enrolled list, enrolment progress and the app's notices are all
    // status.voice (A1/A3/A5): the page re-reads status on these rows (and polls lightly while enrolling)
    if (isClientRow(r.kind)) what.add('voice');
    if (r.kind === 'daemon.start') {
      // a kernel (re)start: a session the old kernel neither exited nor drained into a resume is gone with it (a
      // Ctrl-C leaves no session.exited, and the sweep only logs the spawns it found). A resume in this boot logs its
      // own session.open AFTER this row and makes the session live again.
      this.boot++;
      for (const s of this.sessions.values())
        if (s.boot < this.boot && isLiveState(s.state)) {
          s.state = 'ended';
          what.add('sessions');
        }
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
          raisedAt: typeof r.at === 'string' ? r.at : null,
          tool: typeof p.tool === 'string' ? p.tool : null,
          toolInput: p.tool_input && typeof p.tool_input === 'object' && !Array.isArray(p.tool_input) ? (p.tool_input as Record<string, unknown>) : null,
        });
        what.add('cards');
        what.add(`card-in:${card.cardId}`);
      }
    } else if (r.kind === 'approval.decide' || r.kind === 'approval.expire') {
      // Aegis C1e: a root decision's logged rowsDigest must be the digest of the rows its card SHOWED
      const was = typeof p.cardId === 'string' ? this.cards.get(p.cardId) : undefined;
      const rr = was && r.kind === 'approval.decide' && typeof p.decision === 'string' ? rootRowsOf(was.card as Record<string, unknown>) : null;
      if (rr && rowsDigestCheck(rr, String(p.decision), p.rowsDigest) === 'mismatch') {
        this.rootMismatches.push({ cardId: String(p.cardId), decision: String(p.decision), shown: rr.rowsDigest, logged: typeof p.rowsDigest === 'string' ? p.rowsDigest : null });
        if (this.rootMismatches.length > 16) this.rootMismatches.shift();
        what.add('root-mismatch');
      }
      if (typeof p.cardId === 'string' && this.cards.delete(p.cardId)) {
        what.add('cards');
        what.add(`card-out:${p.cardId}`);
      }
      // the outcome, for a page waiting on that card (core/folder-field.ts RepinReturn: the New session sheet's way back)
      if (typeof p.cardId === 'string' && p.cardId) what.add(`card-outcome:${r.kind === 'approval.expire' ? 'expire' : typeof p.decision === 'string' ? p.decision : '?'}:${p.cardId}`);
    }
  }

  /** The stack, arrival order; inside a session only that project's cards (`repo` given), else all (global inbox). */
  stack(repo?: string | null): StackCard[] {
    const all = this.visibleCards().sort((a, b) => a.arrivedSeq - b.arrivedSeq);
    return repo === undefined ? all : all.filter((c) => c.repo === repo);
  }

  /** Sessions grouped by project, projects sorted, sessions newest first. */
  groups(): Array<{ repo: string; sessions: Array<SessionRow & { pending: number }> }> {
    const by = new Map<string, Array<SessionRow & { pending: number }>>();
    for (const s of this.sessions.values()) {
      const k = s.repo ?? UNSCOPED;
      const pending = this.visibleCards().filter((c) => c.hsid === s.hsid).length;
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push({ ...s, pending });
    }
    return [...by.entries()]
      .sort(([a], [b]) => (a === UNSCOPED ? 1 : b === UNSCOPED ? -1 : a.localeCompare(b)))
      .map(([repo, sessions]) => ({ repo, sessions: sessions.sort((a, b) => b.lastSeq - a.lastSeq) }));
  }

  /** Sessions the log says are running now (the Shuttle's "live" count). */
  liveCount(): number {
    let n = 0;
    for (const s of this.sessions.values()) if (isLiveState(s.state)) n++;
    return n;
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
const RAW_FIELD_MAX = 120;
const RAW_DETAIL_MAX = 20_000;

const word = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** one field of a raw line, one line, capped */
const field = (v: unknown, n = RAW_FIELD_MAX): string | null => {
  const s = typeof v === 'number' || typeof v === 'boolean' ? String(v) : word(v);
  return s === null ? null : cap(oneLine(s), n);
};
/** "125 chars" / "3.4k chars": how much a field holds, never what (hook output can carry project context) */
const sizeOf = (v: unknown): string | null => {
  const n = typeof v === 'string' ? v.length : 0;
  return n ? `${n < 1000 ? n : `${(n / 1000).toFixed(1)}k`} chars` : null;
};
/** a uuid-ish id's short form, so identical rows (five SessionStart hooks) tell apart */
const shortId = (v: unknown): string | null => {
  const s = word(v);
  return s ? (s.startsWith('toolu_') ? s.slice(-8) : s.slice(0, 8)) : null;
};
const join = (...parts: Array<string | null | undefined | false>): string => parts.filter((x): x is string => !!x).join(' · ');
/** the fields every stream line carries, which say nothing about this line */
const ROUTINE = new Set(['type', 'subtype', 'session_id', 'uuid', 'parent_tool_use_id', 'timestamp', 'request_id', 'api_message_id']);
/** the first few short scalar fields of an unknown line ("key value") */
const scalars = (o: Record<string, unknown>, max = 4): string[] => {
  const out: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (ROUTINE.has(k)) continue;
    const s = typeof v === 'number' || typeof v === 'boolean' ? String(v) : typeof v === 'string' && v.length <= 60 ? oneLine(v) : null;
    if (s) out.push(`${k} ${s}`);
    if (out.length >= max) break;
  }
  return out;
};
const hhmmUtc = (epochSec: number): string | null => {
  const d = new Date(epochSec * 1000);
  return Number.isNaN(d.getTime()) ? null : `${d.toISOString().slice(11, 16)} UTC`;
};

/** a claude-code `system` line: its subtype and the fields that say which one it is */
function systemSummary(m: Record<string, unknown>): string {
  const sub = word(m.subtype) ?? 'system';
  if (sub === 'hook_started' || sub === 'hook_response') {
    const ev = field(m.hook_event ?? m.hook_event_name, 40);
    const name = field(m.hook_name, 60);
    // "SessionStart:startup" already names its event; the id tells identical hooks apart
    const which = name && ev && name.startsWith(`${ev}:`) ? name : join(ev, name);
    const id = shortId(m.hook_id);
    if (sub === 'hook_started') return join('system', 'hook started', which, id && `id ${id}`);
    const code = num(m.exit_code);
    const outcome = field(m.outcome, 30);
    const res = join(outcome, code !== null && (code !== 0 || outcome !== 'success') ? `exit ${code}` : null);
    // how much it printed, never what (the fold shows it): `output` is stdout and stderr together
    const out = sizeOf(m.stdout);
    const err = sizeOf(m.stderr);
    const all = !out && !err ? sizeOf(m.output) : null;
    return join('system', 'hook response', which, id && `id ${id}`, res, out && `stdout ${out}`, err && `stderr ${err}`, all && `output ${all}`);
  }
  if (sub === 'init') {
    const tools = Array.isArray(m.tools) ? m.tools.length : null;
    const mcp = Array.isArray(m.mcp_servers) ? m.mcp_servers.length : null;
    return join('system', 'init', field(m.model, 60) && `model ${field(m.model, 60)}`, field(m.cwd) && `cwd ${field(m.cwd)}`, field(m.permissionMode, 30) && `mode ${field(m.permissionMode, 30)}`, tools !== null && `${tools} tools`, mcp ? `${mcp} MCP server${mcp === 1 ? '' : 's'}` : null, field(m.claude_code_version, 20) && `claude-code ${field(m.claude_code_version, 20)}`);
  }
  if (sub === 'status') return join('system', 'status', field(m.status, 60) ?? 'cleared');
  if (sub === 'thinking_tokens') {
    const n = num(m.estimated_tokens);
    const d = num(m.estimated_tokens_delta);
    return join('system', 'thinking', n !== null && `~${n} tokens${d ? ` (+${d})` : ''}`);
  }
  if (sub === 'compact_boundary') {
    const meta = objOf(m.compact_metadata);
    return join('system', 'compacted', field(meta?.trigger, 20), num(meta?.pre_tokens) !== null && `${num(meta?.pre_tokens)} tokens before`);
  }
  return join('system', sub, ...scalars(m));
}

/** a claude-code `user` line: the human's words (a replay) or the tool results going back to the model */
function userSummary(m: Record<string, unknown>): string {
  const msg = objOf(m.message);
  const c = msg?.content;
  if (typeof c === 'string') return join('user', m.isReplay === true ? 'message (replay)' : 'message', field(c, 140));
  const parts = Array.isArray(c) ? c.map(objOf).filter((x): x is Record<string, unknown> => !!x) : [];
  const results = parts.filter((x) => x.type === 'tool_result');
  if (results.length) {
    return join('user', results.length === 1 ? 'tool result' : `${results.length} tool results`, ...results.slice(0, 3).map((r) => {
      const body = typeof r.content === 'string' ? r.content : Array.isArray(r.content) ? r.content.map((y) => word(objOf(y)?.text) ?? '').join('') : '';
      return join(shortId(r.tool_use_id) && `for ${shortId(r.tool_use_id)}`, r.is_error === true ? 'error' : 'ok', sizeOf(body));
    }));
  }
  const text = parts.map((x) => (x.type === 'text' ? word(x.text) ?? '' : '')).join(' ');
  return join('user', m.isReplay === true ? 'message (replay)' : 'message', field(text, 140));
}

/** a claude-code `stream_event` partial: which part of the message it is, with a short look at a text delta */
function streamSummary(m: Record<string, unknown>): string | null {
  const ev = objOf(m.event);
  const et = word(ev?.type);
  if (!ev || !et) return null;
  const idx = num(ev.index);
  const block = idx !== null ? `block ${idx}` : null;
  if (et === 'content_block_delta') {
    const d = objOf(ev.delta);
    const dt = word(d?.type);
    if (dt === 'text_delta') return join('stream', block, 'text', `“${field(d?.text, 80) ?? ''}”`);
    if (dt === 'input_json_delta') return join('stream', block, 'tool input', field(d?.partial_json, 80));
    if (dt === 'thinking_delta') return join('stream', block, 'thinking', num(d?.estimated_tokens) !== null ? `~${num(d?.estimated_tokens)} tokens` : sizeOf(d?.thinking));
    if (dt === 'signature_delta') return join('stream', block, 'signature');
    return join('stream', block, dt ?? 'delta');
  }
  if (et === 'content_block_start') {
    const cb = objOf(ev.content_block);
    return join('stream', block, 'start', field(cb?.type, 30), field(cb?.name, 60));
  }
  if (et === 'content_block_stop') return join('stream', block, 'stop');
  if (et === 'message_start') return join('stream', 'message start', field(objOf(ev.message)?.model, 60));
  if (et === 'message_delta') {
    const d = objOf(ev.delta);
    const out = num(objOf(ev.usage)?.output_tokens);
    return join('stream', 'message delta', field(d?.stop_reason, 30) && `stop ${field(d?.stop_reason, 30)}`, out !== null && `${out} tokens out`);
  }
  if (et === 'message_stop') return 'stream · message stop';
  return join('stream', et);
}

/**
 * A backend stream line (turn.event `line`, claude-code stream-json) as one transcript line that says what the line is:
 * the assistant's text and tools; a system line's subtype and identifying fields (hooks by event, name, short id and
 * outcome; init by model and cwd); tool results by id, outcome and size; rate limits; stream partials; control
 * messages; the result. Hook output and tool output stay out of the line (they can carry project context): the raw
 * row's fold shows the whole line. Never throws on a line it cannot parse (an opaque `turn.event · <type>`); the text
 * still reaches the DOM only through the sanitizer.
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
    let thinking = false;
    for (const c of parts) {
      const x = (c && typeof c === 'object' ? c : {}) as { type?: unknown; text?: unknown; name?: unknown };
      if (x.type === 'text' && typeof x.text === 'string' && x.text.trim()) text.push(x.text);
      else if (x.type === 'tool_use') tools.push(typeof x.name === 'string' ? x.name : '?');
      else if (x.type === 'thinking' || x.type === 'redacted_thinking') thinking = true;
    }
    const out = [text.length ? text.join('\n') : '', tools.length ? `tool ${tools.join(', ')}` : ''].filter(Boolean).join(' · ');
    if (!out) return thinking ? 'assistant · thinking' : 'assistant';
    return `assistant · ${out.length > TURN_TEXT_MAX ? `${out.slice(0, TURN_TEXT_MAX - 1)}…` : out}`;
  }
  if (m && t === 'result') {
    const turns = num(m.num_turns);
    const ms = num(m.duration_ms);
    const cost = num(m.total_cost_usd);
    return join('result', typeof m.subtype === 'string' ? m.subtype : m.is_error === true ? 'error' : 'done', turns !== null && `${turns} turn${turns === 1 ? '' : 's'}`, ms !== null && `${Math.round(ms / 1000)}s`, cost !== null && `$${cost.toFixed(2)}`);
  }
  if (m && t === 'system') return systemSummary(m);
  if (m && t === 'user') return userSummary(m);
  if (m && t === 'rate_limit_event') {
    const i = objOf(m.rate_limit_info) ?? {};
    const at = num(i.resetsAt);
    return join('rate limit', field(i.status, 30), field(i.rateLimitType, 30), at !== null && hhmmUtc(at) && `resets ${hhmmUtc(at)}`, i.isUsingOverage === true && 'using overage');
  }
  if (m && t === 'stream_event') {
    const s = streamSummary(m);
    if (s) return s;
  }
  if (m && (t === 'control_request' || t === 'control_response')) {
    const r = objOf(m.request) ?? objOf(m.response);
    const inner = objOf(r?.response);
    const word = t === 'control_request' ? 'control request' : 'control response';
    const queued = Array.isArray(inner?.still_queued) ? `${inner.still_queued.length} still queued` : null;
    return join(word, field(r?.subtype, 40), field(r?.tool_name, 60), field(inner?.behavior, 20), field(inner?.message), queued, field(r?.error));
  }
  if (m && t !== 'line') {
    const rest = scalars(m);
    if (rest.length) return join(t, field(m.subtype, 40), ...rest);
  }
  return `turn.event · ${type ?? t}`;
}

/**
 * The whole of a raw row for its fold: a turn.event's backend line pretty-printed (or as it came when it isn't JSON),
 * any other row's payload. Null when the view withheld, redacted or oversized it: the fold never shows more than the
 * summary was allowed to. Nested `{redacted: true}` values stay `⟨redacted⟩`; capped; the renderer sanitizes it.
 */
export function rowDetail(r: Row): string | null {
  if (r.view === 'oversize') return null;
  const p = r.payload;
  if (p === undefined || p === null) return null;
  const o = objOf(p);
  if (o?.redacted === true) return null;
  const redact = (_k: string, v: unknown): unknown => (objOf(v)?.redacted === true ? '⟨redacted⟩' : v);
  let out: string;
  if (r.kind === 'turn.event' && typeof o?.line === 'string') {
    try {
      out = JSON.stringify(JSON.parse(o.line), redact, 2);
    } catch {
      out = o.line;
    }
  } else if (o) {
    out = JSON.stringify(o, redact, 2);
  } else {
    out = String(p);
  }
  return out.length > RAW_DETAIL_MAX ? `${out.slice(0, RAW_DETAIL_MAX - 1)}…\n(${out.length - RAW_DETAIL_MAX + 1} more characters not shown)` : out;
}

/* ── chat transcript (dogfood 2026-10-19: the focused session showed 16 rows of hook noise, not the conversation) ── */

/** How one transcript item reads: the user's message, the assistant's text, a tool call, a card, the turn result, a lifecycle note, an error, or a raw row. */
/**
 * V2d voice roles: `user` with `speaker` set is a voice turn sent to the session (🎙 <speaker>); `voice-heard` a turn heard but not sent (handled as a decision/control,
 * or not addressed to the session); `voice-refused` a voice turn the kernel refused (its reason, subtle); `spoken`
 * the 🔊 marker under a reply the voice app spoke aloud.
 */
export type ChatRole = 'user' | 'assistant' | 'activity' | 'tool' | 'card' | 'auto' | 'result' | 'system' | 'error' | 'raw' | 'raw-detail' | 'voice-heard' | 'voice-refused' | 'spoken' | 'working' | 'hook' | 'claude-note';

/**
 * T-2026-10-21-007: the clock of a turn still running. `since` is when the turn (or, on an activity line, its first
 * step) began; `progress` is the latest tool_progress heartbeat (or task_started, secs 0) of the step running now.
 * The page derives the ticking text from it (core/live-turn.ts); the item text itself never changes per tick.
 */
export interface LiveClock {
  since: string;
  progress?: { at: string; secs: number; tool?: string };
  /** #gui-turn-steps: on the working key: what the turn is doing now and when that began (its clock counts from it) */
  now?: StepNow;
}

export interface ChatItem {
  /** Stable per row (and part): `seq` or `seq.part`. */
  key: string;
  seq: number;
  role: ChatRole;
  /** Raw text: the renderer passes it through the contracts sanitizer, never as markup. */
  text: string;
  at?: string;
  /** V2d: the voice turn's speaker (the item gets a 🎙 tag) */
  speaker?: string;
  /** dictation: the kernel's attribution of a sent message (turn.sent source): 🎙 voice or 🎙✎ voice-edited */
  voice?: 'voice' | 'voice-edited';
  /** TD-2026-10-21-514: how the kernel says the message was sent (turn.sent origin/sentBy); a record only (TD-2026-10-23-939) */
  sentLabel?: string;
  /** table talk (TD-2026-10-20-294): an assistant reply's speak block, shown as the "said aloud" line (the body omits it) */
  said?: string;
  /** Aegis L3: 'kernel' = the words come from the kernel's speakable row (from:'block'); 'reply' = this GUI's own parse (no kernel row) */
  saidBy?: 'kernel' | 'reply';
  /** T-2026-10-21-007: on the `working` row of the running turn and its live activity line only */
  live?: LiveClock;
  /** raw rows: the whole row (rowDetail), shown by the row's fold */
  detail?: string;
  /** #gui-turn-steps: the hook-result line draws attention (a hook blocked, failed or timed out) */
  tone?: 'warn';
  /** #gui-turn-steps: the working key's steps so far, and whether its list is unfolded (the page sets it) */
  steps?: TurnStep[];
  open?: boolean;
  /** Mika Delta 11: an approval.decide line's card (the page may say what it answered there) */
  cardId?: string;
}

const CHAT_TEXT_MAX = 20_000;
const TOOL_SUMMARY_MAX = 140;
const cap = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();
const objOf = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** The input field that says what a tool call does (Bash command, a file path, a pattern, a URL, …). */
const TOOL_KEYS = ['command', 'file_path', 'notebook_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt', 'skill', 'subject'];
export function toolSummary(name: string, input: unknown): string {
  const o = objOf(input);
  let what = '';
  if (o) for (const k of TOOL_KEYS) if (typeof o[k] === 'string' && (o[k] as string).trim()) {
    what = oneLine(o[k] as string);
    break;
  }
  return what ? `${name} · ${cap(what, TOOL_SUMMARY_MAX)}` : name;
}

/** Text parts of a stream-json message content (a string, or an array of {type:'text', text}); tool results and thinking are not text. */
/** #gui-model-picker: the transcript line of a session.model row (the kernel's record of a switch), per outcome. */
export function sessionModelLine(p: Record<string, unknown>): string {
  const lbl = (v: unknown): string => (v === 'claude' || v === 'default' ? 'default' : String(v));
  switch (p.outcome) {
    case 'switched':
      return `model switched · ${lbl(p.from)} → ${lbl(p.to)} · the conversation continues; the prompt cache restarts`;
    case 'backend-refused':
      return `model switch refused by Claude Code · stays ${lbl(p.from)}`;
    case 'permit-refused':
      return `model switch refused by the budget · stays ${lbl(p.from)}`;
    case 'timeout':
      return `model: switching… (unconfirmed) · Claude did not answer; the next reply shows whether ${lbl(p.to)} answered`;
    case 'reconciled':
      return p.to === p.from ? `model confirmed · the switch did not take · stays ${lbl(p.from)}` : `model confirmed · ${lbl(p.from)} → ${lbl(p.to)} · the conversation continues`;
    default:
      return `model · ${lbl(p.to)}`;
  }
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const out: string[] = [];
  for (const c of content) {
    const x = objOf(c);
    if (x?.type === 'text' && typeof x.text === 'string' && x.text.trim()) out.push(x.text);
  }
  return out.join('\n');
}

/* ── table talk (TD-2026-10-20-294; mirrors the kernel's speakable.ts speakBlock) ── */

const SPEAK_MAX = 300;
function speakWords(s: string): string {
  const t = s
    .replace(/\bhttps?:\/\/\S+/gi, '')
    .replace(/\bwww\.\S+/gi, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_)(\S[^*_]*?)\1/g, '$2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\b[0-9a-f]{12,}\b/gi, (w) => (/[0-9]/.test(w) ? '' : w))
    .replace(/\d[\d,._:-]*\d/g, (w) => (w.replace(/\D/g, '').length >= 5 ? '' : w))
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length <= SPEAK_MAX) return t;
  const cut = t.slice(0, SPEAK_MAX);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '), /[.?!]$/.test(cut) ? cut.length - 1 : -1);
  if (end > 0) return cut.slice(0, end + 1);
  const sp = cut.lastIndexOf(' ', SPEAK_MAX - 1);
  return `${(sp > 0 ? cut.slice(0, sp) : cut.slice(0, SPEAK_MAX - 1)).trimEnd()}…`;
}

/**
 * A reply's first speak block (the words the voice said) and the body without it. An unclosed fence runs to its
 * first blank line. No block (a heuristic reply) ⇒ said null and the body unchanged: no "said aloud" highlight.
 */
export function splitSpeak(text: string): { said: string | null; body: string } {
  const open = /(?:^|\n)[ \t]*```speak[ \t]*(?:\r?\n|$)/.exec(text);
  if (!open) return { said: null, body: text };
  const before = text.slice(0, open.index);
  const rest = text.slice(open.index + open[0].length);
  const close = /(?:^|\n)[ \t]*```[ \t]*(?:\r?\n|$)/.exec(rest);
  const para = close ? null : /\n\s*\n/.exec(rest);
  const block = close ? rest.slice(0, close.index) : para ? rest.slice(0, para.index) : rest;
  const after = close ? rest.slice(close.index + close[0].length) : para ? rest.slice(para.index) : '';
  const said = speakWords(block);
  if (!said || !/[A-Za-z]/.test(said)) return { said: null, body: text };
  return { said, body: `${before.trimEnd()}${before.trim() && after.trim() ? '\n\n' : ''}${after.replace(/^\s*\n/, '')}`.trim() };
}

/** One line of a reply body: a LABELLED line (bold letter / number / name at line start) or plain text. */
export type ReplyPart = { label: string; text: string } | { text: string };

/**
 * The labels the agent chose (no fixed scheme: A/B/C, 1/2/3, short names): a line that starts with a bold label,
 * optionally after a list marker, becomes a labelled part; consecutive plain lines stay one text part. No labelled
 * line ⇒ one text part (the body as is).
 */
export function replyParts(body: string): ReplyPart[] {
  const out: ReplyPart[] = [];
  let plain: string[] = [];
  const flush = (): void => {
    if (plain.length) out.push({ text: plain.join('\n') });
    plain = [];
  };
  for (const ln of body.split('\n')) {
    const m = /^\s*(?:[-*+]\s+|\d+[.)]\s+)?\*\*([^*\n]{1,40}?)\*\*\s*[.):\-–—]?\s*(.*)$/.exec(ln);
    if (m && m[1]!.trim()) {
      flush();
      out.push({ label: m[1]!.trim().replace(/[.):]$/, ''), text: m[2]!.trim() });
    } else plain.push(ln);
  }
  flush();
  return out;
}

/** sha256 of the kernel's frozen table-talk guidance block (kernel/voice/table-talk.ts; a GUI test pins it to the kernel's). */
export const TABLE_TALK_GUIDANCE_HASH = 'sha256:eb3b660651dab20c94cbc00e432d6b13d94f7ce007024ff6d53be3ab363a9f5a';

/**
 * The human's own text of a replayed user message (Aegis M1). content[0] is ALWAYS kept. A text block at index 1 or
 * later is dropped only when its bytes are the kernel's guidance (its sha256 is TABLE_TALK_GUIDANCE_HASH) or match the
 * guidanceHash of the turn.sent it answers; anything else (a human-typed `<gnomon-voice>` too) stays visible.
 */
export function humanTextOf(content: unknown, guidanceHash: string | null = null): string {
  if (!Array.isArray(content)) return textOf(content);
  return textOf(
    content.filter((c, i) => {
      if (i === 0) return true;
      const x = objOf(c);
      if (x?.type !== 'text' || typeof x.text !== 'string') return true;
      const h = sha256Tagged(x.text);
      return h !== TABLE_TALK_GUIDANCE_HASH && h !== guidanceHash;
    }),
  );
}

/**
 * Aegis L3: the said-aloud line of a reply comes from the kernel's speakable row when there is one: from:'block' ⇒ the
 * kernel's words (saidBy 'kernel'); from:'heuristic' ⇒ no highlight. No kernel row ⇒ this GUI's parse (saidBy 'reply').
 */
function withKernelSaid<T extends Pick<ChatItem, 'role' | 'text' | 'said'>>(it: T, k: { text: string; from: string } | undefined): T & { saidBy?: ChatItem['saidBy'] } {
  if (!k) return it.said !== undefined ? { ...it, saidBy: 'reply' as const } : it;
  const { said: _drop, ...rest } = it;
  return k.from === 'block' ? { ...(rest as T), said: k.text, saidBy: 'kernel' as const } : (rest as T);
}

/** One turn.event line as chat items (none = noise: hooks, partials, rate limits, status, control frames, tool results). */
function lineItems(line: string, guidanceHash: string | null = null): Array<Pick<ChatItem, 'role' | 'text' | 'said'>> {
  let m: Record<string, unknown> | null = null;
  try {
    m = objOf(JSON.parse(line));
  } catch {
    return [];
  }
  if (!m) return [];
  const msg = objOf(m.message);
  if (m.type === 'assistant' && msg) {
    const out: Array<Pick<ChatItem, 'role' | 'text' | 'said'>> = [];
    const text = textOf(msg.content);
    if (text.trim()) {
      const { said, body } = splitSpeak(text);
      out.push({ role: 'assistant', text: cap(body, CHAT_TEXT_MAX), ...(said !== null ? { said } : {}) });
    }
    if (Array.isArray(msg.content))
      for (const c of msg.content) {
        const x = objOf(c);
        if (x?.type === 'tool_use') out.push({ role: 'tool', text: toolSummary(typeof x.name === 'string' ? x.name : '?', x.input) });
      }
    return out;
  }
  // gnomon-local (#local-runner, pi rpc shape): a finished assistant message carries its whole text (the streamed
  // message_update deltas before it are noise here, like claude's partials); each tool call is shown as it starts,
  // with its arguments (the message_end only names it)
  if (m.type === 'message_end' && msg && msg.role === 'assistant') {
    const text = textOf(msg.content);
    if (!text.trim()) return [];
    const { said, body } = splitSpeak(text);
    return [{ role: 'assistant', text: cap(body, CHAT_TEXT_MAX), ...(said !== null ? { said } : {}) }];
  }
  if (m.type === 'tool_execution_start' && typeof m.toolName === 'string') return [{ role: 'tool', text: toolSummary(m.toolName, m.args) }];
  // the user's own message as claude replays it (--replay-user-messages): the only row that carries its text
  // (session.inject / turn.sent log a hash and a byte count, never the text — G-LOG-03)
  if (m.type === 'user' && msg) {
    // #gui-turn-steps: a synthetic user line is Claude's, never the human's ("Stop hook feedback: …" is the hook's
    // reason fed back to the model): a hook's feedback folds into the turn's hook-result line, any other is a quiet note
    // Aegis M1: never role 'system' (that is the kernel's own notes: run mode, session ended), so a repo hook cannot
    // forge one; it is Claude's note, said as Claude's ("Claude · <text>")
    if (m.isSynthetic === true) {
      const t = textOf(msg.content);
      return !t.trim() || /^[\w:]+ hook feedback:/.test(t) ? [] : [{ role: 'claude-note', text: `Claude · ${cap(oneLine(t), TOOL_SUMMARY_MAX)}` }];
    }
    const text = humanTextOf(msg.content, guidanceHash);
    return text.trim() ? [{ role: 'user', text: cap(text, CHAT_TEXT_MAX) }] : [];
  }
  return [];
}

/**
 * T-2026-10-26-003: how a local run ended, said honestly (the kernel's turn.result{stopReason}). A normal 'stop' reads
 * as before; anything else names itself — never "done" for a run that hit the step limit.
 */
export const STOP_LABEL: Readonly<Record<string, string>> = Object.freeze({ max_steps: 'stopped: step limit', aborted: 'aborted', error: 'error' });

const n = (v: number): string => v.toLocaleString('en-US');

/**
 * The turn's result line. A local run (turn.result{stopReason, runUsage, replyBytes}, T-2026-10-26-003) reads its end
 * state from stopReason, says "no answer" when the final reply was empty, and its tokens from runUsage — the run's whole
 * agent_end usage, input + output (usage.tokens on that row is only the meter's uncharged remainder). `warn` marks a
 * run that did not end normally with an answer (the amber warning tone, DESIGN rule 1).
 */
export function resultLine(p: Record<string, unknown>): { text: string; warn: boolean } {
  const reason = typeof p.stopReason === 'string' ? p.stopReason : null;
  const abnormal = reason !== null && reason !== 'stop';
  const parts = [p.isError === true ? 'error' : abnormal ? (STOP_LABEL[reason] ?? `stopped: ${reason}`) : typeof p.subtype === 'string' ? p.subtype : 'done'];
  const noAnswer = reason !== null && reason !== 'aborted' && p.replyBytes === 0;
  if (noAnswer) parts.push('no answer');
  if (typeof p.cost === 'number') parts.push(`$${p.cost.toFixed(4)}`);
  const run = objOf(p.runUsage);
  const tokens = objOf(p.usage)?.tokens;
  if (run && typeof run.tokens === 'number') {
    parts.push(typeof run.input === 'number' && typeof run.output === 'number' ? `${n(run.tokens)} tokens (in ${n(run.input)} + out ${n(run.output)})` : `${n(run.tokens)} tokens (in + out)`);
  } else if (typeof tokens === 'number') parts.push(`${n(tokens)} tokens`);
  if (typeof p.permission_denials === 'number' && p.permission_denials > 0) parts.push(`${p.permission_denials} denied`);
  if (abnormal && typeof p.error === 'string' && p.error.trim()) parts.push(cap(oneLine(p.error), TOOL_SUMMARY_MAX));
  return { text: parts.join(' · '), warn: reason === 'max_steps' || noAnswer };
}

/**
 * T-2026-10-20-005: there is no partial-text row. voice.turn.partial is not a registered kind and the kernel stores no
 * partial voice.turn.user; live words (phase B) come through status.voice.capture to the gui credential only
 * (core/capture.ts), never through the log. A row claiming to be partial is hidden.
 */
function isPartial(r: Row, p: Record<string, unknown> | null): boolean {
  return r.kind === 'voice.turn.partial' || (r.kind === 'voice.turn.user' && p?.partial === true);
}

/**
 * The KERNEL's refusal at receipt on a voice.turn.user row (voice-control.ts writes `refusedReason` and, for V2a,
 * `refusedCause` on the hash-only row), or null. Voice drops fix: this is the kernel's fact, never the app's claim.
 */
function kernelRefusalOf(p: Record<string, unknown>): { reason: string; cause: string | null } | null {
  if (typeof p.refusedReason !== 'string' || !p.refusedReason) return null;
  return { reason: p.refusedReason, cause: typeof p.refusedCause === 'string' ? p.refusedCause : null };
}
/** A refused turn's length, e.g. "4.8 s" (durationMs on the hash-only row, else t1 - t0), or null. */
function voiceSecondsOf(p: Record<string, unknown>): string | null {
  const ms = typeof p.durationMs === 'number' ? p.durationMs : typeof p.t0 === 'number' && typeof p.t1 === 'number' ? p.t1 - p.t0 : null;
  return ms !== null && Number.isFinite(ms) && ms >= 0 ? `${(ms / 1000).toFixed(1)} s` : null;
}

/** A refusal reason a voice row carries (`refusal: {reason} | string`, or `reason`), or null. */
function voiceReasonOf(p: Record<string, unknown>): string | null {
  const ref = p.refusal ?? p.refused;
  if (typeof ref === 'string') return ref;
  const o = objOf(ref);
  if (o && typeof o.reason === 'string') return o.reason;
  if (o && typeof objOf(o.data)?.reason === 'string') return String(objOf(o.data)!.reason);
  return null;
}
/** The reason plus its V2a cause (`voice-off · aec`). */
function reasonWithCause(p: Record<string, unknown>, reason: string): string {
  const ref = objOf(p.refusal ?? p.refused);
  const cause = objOf(ref?.data)?.cause ?? objOf(p.data)?.cause ?? p.cause;
  return typeof cause === 'string' ? `${reason} · ${cause}` : reason;
}

/**
 * The chat item of a voice row (V2d): undefined = not a voice row (the kernel reducer decides), null = hidden noise.
 * A sent voice turn is the user's message with a 🎙 <speaker> tag; turn.sent{source:'voice'} adds one only when the
 * page cannot see the voice.turn.user row it cites (a stub view); a refusal shows its reason inline.
 */
/** The voice turn seqs a turn.sent cites: `voiceTurnSeqs[]` (dictation), else the older single `voiceTurnSeq`. */
function citedSeqs(p: Record<string, unknown> | null): number[] {
  if (!p) return [];
  if (Array.isArray(p.voiceTurnSeqs)) return p.voiceTurnSeqs.filter((n): n is number => typeof n === 'number');
  return typeof p.voiceTurnSeq === 'number' ? [p.voiceTurnSeq] : [];
}

type VoiceCtx = { shownVoiceSeqs: Set<number>; sentSeqs: Set<number>; editedSeqs: Set<number> };
function voiceItem(r: Row, p: Record<string, unknown> | null, ctx: VoiceCtx): (Pick<ChatItem, 'role' | 'text'> & { speaker?: string; part?: number; voice?: ChatItem['voice'] }) | null | undefined {
  const isVoiceRefusal = r.kind.endsWith('.refused') && !!p && (p.source === 'voice' || p.gate === 'voice' || (typeof p.reason === 'string' && p.reason.startsWith('voice-')) || (typeof voiceReasonOf(p) === 'string' && voiceReasonOf(p)!.startsWith('voice-')));
  if (isVoiceRefusal) return { role: 'voice-refused', text: `voice turn not sent · ${reasonWithCause(p!, voiceReasonOf(p!) ?? String(p!.reason))}` };
  if (r.kind === 'turn.sent') {
    if (p?.source === 'voice-edited') return null; // the words are the human's edit: the composer echo / claude's replay shows them (🎙✎)
    if (p?.source !== 'voice') return undefined;
    const cited = citedSeqs(p);
    if (cited.length && cited.every((n) => ctx.shownVoiceSeqs.has(n))) return null;
    return { role: 'user', text: '(voice turn; its words are in the voice log)', speaker: 'voice', voice: 'voice' };
  }
  if (!r.kind.startsWith('voice.')) return undefined;
  if (r.view === 'stub' || r.view === 'oversize' || !p) return null;
  const text = typeof p.text === 'string' ? p.text : '';
  const speaker = speakerName(p.speakerId);
  if (isPartial(r, p)) return null;
  switch (r.kind) {
    case 'voice.turn.user': {
      // a take of the send word being taught (the attended trial, spec §14.7) belongs to its dialog: never a chat line
      if (p.trialTake === true) return null;
      // voice drops fix: a turn the kernel refused at receipt is stored hash-only (no text), so it is checked BEFORE
      // the empty-text rule: "voice not sent · Claude was still finishing · 4.8 s" (the reason in words, never text)
      const k = kernelRefusalOf(p);
      if (k) {
        const secs = voiceSecondsOf(p);
        return { role: 'voice-refused', text: `voice not sent · ${refusalPhrase(k.reason, k.cause)}${secs ? ` · ${secs}` : ''}` };
      }
      // Dictate (Aegis 2026-10-21 privacy): an unverified voice's row is hash-only; its words live in the draft only. Sent,
      // claude's replay shows the message; unsent, the line says it waits, without the words
      // Mika: no speaker label (the founder's own short phrases read "unknown speaker 1"); one wording in both rows
      if (p.draftOnly === true && !text.trim()) return ctx.sentSeqs.has(r.seq) ? null : { role: 'voice-heard', text: 'voice · in composer · unverified voice', speaker: 'voice', part: 1 };
      if (!text.trim()) return null;
      // sent: the kernel's turn.sent cites this row ⇒ the user's message (one line: spoken text has no layout)
      if (ctx.sentSeqs.has(r.seq)) return { role: 'user', text: cap(oneLine(text), CHAT_TEXT_MAX), speaker, voice: 'voice' };
      // dictation: the human edited the draft before sending; the sent message is the edit (🎙✎), this is what was heard
      if (ctx.editedSeqs.has(r.seq)) return { role: 'voice-heard', text: `${speaker}: “${cap(oneLine(text), TOOL_SUMMARY_MAX)}” · edited before sending`, speaker, part: 2 };
      // not (yet) sent: refusal / intercepted / forwarded are the voice app's claims, shown attributed (a distinct key,
      // so the row repaints as the user's message once the kernel's turn.sent arrives)
      const why = voiceReasonOf(p);
      const claim = why
        ? `voice app says: not sent · ${reasonWithCause(p, why)}`
        : p.intercepted === 'decision' || p.intercepted === 'control'
          ? `voice app says: handled as a ${p.intercepted}`
          : p.forwardable === true
            ? p.draftOnly === true
              ? 'in composer · unverified voice' // Dictate (G-VOX-06 exception): the kernel let an unverified voice into the draft only
              : p.speakerBasis === 'continuity'
                ? 'in composer · not checked as you' // Aegis H-1: inherited from the verified turn before it, never checked itself
                : 'in composer' // dictation: the kernel stamped it forwardable; it waits in the composer until sent
            : p.forwarded === false
              ? 'voice app says: not sent'
              : 'not sent to the session';
      const who = p.draftOnly === true ? 'voice' : speaker; // Mika: an unverified voice carries no speaker label
      return { role: 'voice-heard', text: `${who}: “${cap(oneLine(text), TOOL_SUMMARY_MAX)}” · ${claim}`, speaker: who, part: 1 };
    }
    case 'voice.session.start':
      return { role: 'system', text: `voice attached · ${startRungName(p) ?? 'Talk'}` };
    case 'voice.session.end': {
      const note = idleNoteOf(r.kind, p);
      return { role: 'system', text: note ?? 'voice detached' };
    }
    default:
      return null;
  }
}

/**
 * One 🔊 marker per spoken reply (founder bug 2026-10-20). Pipelined TTS logs one playback row per sentence
 * (voice.turn.agent{t0, t1, textPlanned, textSpoken, interrupted?}), after the kernel's one speakable row
 * (source kernel-speakable). The kernel row opens the marker; every later playback row and a voice.bargein fold into
 * it (played seconds, `stopped` when any chunk was cut off) until the next reply. A playback row with no open marker
 * (an older kernel with no speakable row) opens one itself; a barge-in with none is the lone `interrupted` line.
 */
interface SpokenGroup {
  item: ChatItem;
  ms: number;
  stopped: boolean;
  /** the lone `interrupted` line: never folds anything */
  solo?: boolean;
}

/** The marker's text, in words (gnomon cli-voice: no emoji): `spoken aloud · 6s · stopped`. */
export function spokenText(g: Pick<SpokenGroup, 'ms' | 'stopped' | 'solo'>): string {
  if (g.solo) return 'interrupted';
  const s = Math.round(g.ms / 1000);
  return `spoken aloud${s >= 1 ? ` · ${s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`}` : ''}${g.stopped ? ' · stopped' : ''}`;
}

/** Fold one voice.turn.agent / voice.bargein row: 'folded' into the open marker, a new group to show, or null (hidden). */
function spokenFold(r: Row, p: Record<string, unknown> | null, open: SpokenGroup | null): SpokenGroup | 'folded' | null {
  if (r.view === 'stub' || r.view === 'oversize' || !p) return null;
  const blank = null as unknown as ChatItem; // set by the caller once the item is pushed
  if (r.kind === 'voice.bargein') {
    if (open) {
      open.stopped = true;
      return 'folded';
    }
    return { item: blank, ms: 0, stopped: true, solo: true };
  }
  if (p.source === 'kernel-speakable') return Array.isArray(p.items) && p.items.length ? { item: blank, ms: 0, stopped: false } : null;
  const said = typeof p.textSpoken === 'string' ? p.textSpoken : '';
  const planned = typeof p.textPlanned === 'string' ? p.textPlanned : '';
  const cut = p.interrupted === true || (!!planned && said.length < planned.length);
  const ms = typeof p.t0 === 'number' && typeof p.t1 === 'number' && p.t1 > p.t0 ? Math.min(p.t1 - p.t0, 600_000) : 0;
  if (open) {
    open.ms += ms;
    if (cut) open.stopped = true;
    return 'folded';
  }
  if (!said.trim()) return null;
  return { item: blank, ms, stopped: cut };
}

/** A kernel row's chat item, or null when it is noise in the chat view. */
function kernelItem(r: Row): (Pick<ChatItem, 'role' | 'text'> & { cardId?: string; tone?: ChatItem['tone'] }) | null {
  if (r.view === 'stub' || r.view === 'oversize' || r.payload === undefined) return null;
  const p = objOf(r.payload) ?? {};
  switch (r.kind) {
    case 'session.open':
      return { role: 'system', text: `${objOf(p.resume) ? 'session resumed' : 'session opened'}${typeof p.model === 'string' ? ` · ${p.model}` : ''}${typeof p.cwd === 'string' ? ` · ${p.cwd}` : ''}` };
    case 'session.model': // #gui-model-picker: the kernel's record of a mid-session switch
      return { role: 'system', text: sessionModelLine(p) };
    case 'session.renamed': // #gui-session-rename: the kernel's record of a rename
      return { role: 'system', text: typeof p.name === 'string' && p.name ? `renamed · ${p.name}` : 'name cleared · the title is the first message again' };
    case 'session.exited':
      return { role: 'system', text: `session ended${typeof p.reason === 'string' ? ` · ${p.reason}` : ''}${typeof p.code === 'number' ? ` · exit ${p.code}` : ''}${typeof p.signal === 'string' ? ` · ${p.signal}` : ''}` };
    case 'session.orphaned':
      return { role: 'system', text: 'session ended with the old kernel (orphaned at the next boot)' };
    case 'session.drained':
      return { role: 'system', text: 'session drained for a kernel restart' };
    case 'turn.result': {
      const line = resultLine(p);
      return { role: 'result', text: line.text, ...(line.warn ? { tone: 'warn' as const } : {}) };
    }
    case 'approval.request': {
      const card = objOf(p.card) ?? {};
      return { role: 'card', text: `needs you · ${typeof card.kind === 'string' ? card.kind : 'card'} (decide it in the stack)` };
    }
    case 'approval.decide':
      return { role: 'card', text: `decided · ${typeof p.decision === 'string' ? p.decision : '?'}`, ...(typeof p.cardId === 'string' ? { cardId: p.cardId } : {}) };
    case 'approval.expire':
      return { role: 'card', text: 'card expired' };
    case 'approval.auto': {
      // P8-D87: a request the kernel answered allow with NO card — show what went through
      const where = typeof p.path === 'string' ? p.path : typeof p.tool === 'string' ? p.tool : '?';
      const ref = typeof p.modeRef === 'string' ? p.modeRef : '';
      return { role: 'auto', text: ref.startsWith('rule:') ? `auto-approved · ${typeof p.tool === 'string' ? p.tool : '?'} (always rule)` : `auto-approved edit · ${where}` };
    }
    case 'approval.mode.set': {
      const sc = objOf(p.scope) ?? {};
      return { role: 'system', text: `run mode ${String(p.from ?? '?')} → ${String(p.to ?? '?')}${typeof sc.hsid === 'string' ? '' : ' (repo)'}${p.presence === 'fresh' ? ' · Touch ID' : ''}` };
    }
    case 'turn.event': {
      if (typeof p.line === 'string') return null; // handled by lineItems
      if (p.type === 'assistant' && typeof p.bytes === 'number') return { role: 'system', text: `a long assistant message (${p.bytes} bytes) is in the log by hash only` };
      return null;
    }
    default:
      return r.kind.endsWith('.refused') ? { role: 'error', text: rowSummary(r) } : null;
  }
}

/** T-2026-10-21-007: a message sent while an earlier turn runs: its item indices, and whether its turn.sent arrived. */
interface WaitingTurn {
  idx: number[];
  sent: boolean;
  /** review M1: its turn id (the composer stamp from session.send, or the turn.sent it paired with) */
  turn?: string;
}
/** Where chatItems puts an item: 'turn' the running turn's output; 'message' / 'voice-message' a user message (it
 * waits while a turn runs); 'tail' appended as is. */
type Place = 'turn' | 'message' | 'voice-message' | 'tail';

/** The running step's clock from a tool_progress line (`elapsed_time_seconds`, `tool_name`), or a task start (0 s). */
function progressOf(line: unknown, at: string | undefined, started: boolean): LiveClock['progress'] | undefined {
  if (!at) return undefined;
  if (started) return { at, secs: 0 };
  if (typeof line !== 'string') return undefined;
  let m: Record<string, unknown> | null = null;
  try {
    m = objOf(JSON.parse(line));
  } catch {
    return undefined;
  }
  const secs = m?.elapsed_time_seconds;
  if (typeof secs !== 'number' || !Number.isFinite(secs) || secs < 0) return undefined;
  const tool = typeof m?.tool_name === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(m.tool_name) ? m.tool_name : undefined;
  return { at, secs, ...(tool ? { tool } : {}) };
}

/**
 * The focused session's rows as a chat: the user's messages (this page's composer echo, else claude's replay), the
 * assistant's text, one compact line per tool call, cards, the turn result (cost and tokens) and lifecycle notes.
 * Everything else (hook started/response, stream_event partials, rate limits, status, control frames, tool results,
 * turn.partial / turn.usage / session.inject / turn.sent bookkeeping) is hidden and counted; `raw: true` shows every
 * row as its one-line summary instead. A composer echo (`connId: 'local'`) hides the replay of the same text that
 * follows it, so a sent message shows once and the list only ever grows at the end.
 */
export function chatItems(rows: readonly Row[], opts: { raw?: boolean; live?: boolean } = {}): { items: ChatItem[]; hidden: number } {
  const items: ChatItem[] = [];
  let hidden = 0;
  const echoes: string[] = []; // composer texts not yet matched by claude's replay
  /*
   * T-2026-10-21-007 turn anchoring. The backend answers turns in the order they were sent (turn.sent carries the
   * turn id; turn.result carries none, so the pairing is that FIFO order). A message sent while an earlier turn is
   * still running waits in `waiting` (its item indices) and starts when the earlier turn's result lands; everything
   * the RUNNING turn says (its reply, tools, cards, its result) is placed before the first waiting message, so a
   * result shows under its own turn, never under the next turn's message. With nothing waiting this is a plain
   * append (the list only grows at the end).
   */
  const echoTurn: Array<WaitingTurn | null> = []; // parallel to `echoes`: the waiting message each echo opened
  const waiting: WaitingTurn[] = [];
  const openTurns: string[] = []; // review M2: the turn ids of turn.sent rows with no turn.result yet, in send order
  let activeUnsent = false; // the running turn's message is shown but its turn.sent has not arrived yet
  let activeTurn: string | undefined; // review M1: that message's stamped turn id, when session.send has returned it
  let turnSince: string | undefined;
  let turnKey = '';
  let progress: LiveClock['progress'] | undefined;
  // #gui-turn-steps: the running turn's steps (the working key names the current one; the result gets the summary)
  const steps = new StepTracker();
  const insertAt = (): number => (waiting.length ? waiting[0]!.idx[0]! : items.length);
  let placedTurn: string | undefined; // review M1: the stamp of the composer echo being placed
  const place = (item: ChatItem, how: Place): void => {
    if (opts.raw || how === 'tail' || (how === 'turn' && !waiting.length)) {
      items.push(item);
      return;
    }
    if (how === 'turn') {
      const at = insertAt();
      items.splice(at, 0, item);
      for (const w of waiting) for (let i = 0; i < w.idx.length; i++) if (w.idx[i]! >= at) w.idx[i] = w.idx[i]! + 1;
      return;
    }
    const last = waiting[waiting.length - 1];
    items.push(item);
    // a multi-part voice message is ONE turn (one turn.sent cites every part)
    if (how === 'voice-message' && last && !last.sent) last.idx.push(items.length - 1);
    else if (how === 'voice-message' && activeUnsent && !waiting.length) return;
    else if (openTurns.length > 0 || waiting.length || activeUnsent) waiting.push({ idx: [items.length - 1], sent: false, ...(placedTurn !== undefined ? { turn: placedTurn } : {}) });
    else {
      activeUnsent = true;
      activeTurn = placedTurn;
    }
  };
  /** The waiting message the item just pushed belongs to (null: it is the running turn's). */
  const lastWaiting = (): WaitingTurn | null => {
    const w = waiting[waiting.length - 1];
    return w && w.idx.includes(items.length - 1) ? w : null;
  };
  /** The oldest waiting message's turn starts (the turn before it ended). */
  const startNext = (): void => {
    const w = waiting.shift();
    if (w) {
      activeUnsent = !w.sent;
      activeTurn = w.turn;
    }
  };
  /** A session boundary (exit, drain, orphan, open / resume): no turn runs and nothing waits any more. */
  const settle = (): void => {
    waiting.length = 0;
    openTurns.length = 0;
    activeUnsent = false;
    activeTurn = undefined;
    progress = undefined;
    steps.reset();
  };
  const push = (r: Row, part: number, it: Pick<ChatItem, 'role' | 'text'> & { speaker?: string; voice?: ChatItem['voice']; said?: string; saidBy?: ChatItem['saidBy']; sentLabel?: string; cardId?: string }, how: Place = 'turn'): ChatItem => {
    if (it.role === 'assistant') spoken = null; // a new reply closes the previous reply's 🔊 marker
    const item: ChatItem = { key: part ? `${r.seq}.${part}` : String(r.seq), seq: r.seq, role: it.role, text: it.text, ...(r.at ? { at: r.at } : {}), ...(it.speaker !== undefined ? { speaker: it.speaker } : {}), ...(it.voice !== undefined ? { voice: it.voice } : {}), ...(it.said !== undefined ? { said: it.said, saidBy: it.saidBy ?? 'reply' } : {}), ...(it.sentLabel !== undefined ? { sentLabel: it.sentLabel } : {}), ...(it.cardId !== undefined ? { cardId: it.cardId } : {}) };
    place(item, how);
    return item;
  };
  // dictation: claude replays a multi-part voice message as its parts joined; the shown turns' echoes are folded into one
  const voiceEcho = new Map<number, string>();
  let editedReplays = 0; // turn.sent{voice-edited} not yet matched by the message's replay (it gets the 🎙✎ mark)
  const shownVoiceSeqs = new Set<number>();
  // Aegis M (V2d): "sent" is the kernel's word (turn.sent{source:'voice', voiceTurnSeq}), never the voice app's claim
  const sentSeqs = new Set<number>();
  const editedSeqs = new Set<number>();
  // TD-2026-10-21-514: the sent label (from the kernel's turn.sent) on the LAST voice turn each message cites
  const sentLabels = new Map<number, { label: string }>();
  // one 🔊 marker per spoken reply (founder bug 2026-10-20: pipelined TTS logs one playback row per sentence)
  let spoken: SpokenGroup | null = null;
  // Aegis L3: the kernel's speakable reply per source row (turnSeq): the said-aloud line is the kernel's words
  const kernelReply = new Map<number, { text: string; from: string }>();
  let turnGuidance: string | null = null; // Aegis M1: the guidanceHash of the latest turn.sent
  for (const r of rows) {
    const p = objOf(r.payload);
    if (r.kind === 'voice.turn.agent' && p?.source === 'kernel-speakable' && typeof r.principal === 'string' && /^p:[0-9a-z]{8}\/kernel$/.test(r.principal) && typeof p.turnSeq === 'number' && Array.isArray(p.items)) {
      const it = p.items.map(objOf).find((x) => x?.kind === 'reply' && typeof x.text === 'string');
      if (it) kernelReply.set(p.turnSeq, { text: String(it.text), from: typeof it.from === 'string' ? it.from : '' });
    }
    if (r.kind === 'turn.sent' && p?.source === 'voice') {
      const cs = citedSeqs(p);
      for (const n of cs) sentSeqs.add(n);
      const lab = sentLabel(p);
      if (lab && cs.length) sentLabels.set(cs[cs.length - 1]!, lab);
    }
    if (r.kind === 'turn.sent' && p?.source === 'voice-edited') for (const n of citedSeqs(p)) editedSeqs.add(n);
  }
  for (const r of rows) {
    if (r.connId === 'local') {
      if (r.kind === 'composer') {
        const t = String(r.payload ?? '');
        const voice = r.mark === 'voice-edited' ? { voice: 'voice-edited' as const } : {};
        if (r.unsent) {
          // review M1: a refused (or network-failed) send is no turn: it never waits, never runs, and claude never replays it
          push(r, 0, { role: 'user', text: t, ...voice }, 'tail');
          continue;
        }
        echoes.push(oneLine(t));
        placedTurn = typeof r.turn === 'string' ? r.turn : undefined;
        push(r, 0, { role: 'user', text: t, ...voice }, 'message');
        placedTurn = undefined;
        echoTurn.push(lastWaiting());
        if (r.mark === 'voice-edited' && editedReplays > 0) editedReplays--;
      } else {
        // a refused send stays with the message it refused
        const last = waiting[waiting.length - 1];
        push(r, 0, { role: 'error', text: String(r.payload ?? '') }, 'tail');
        if (last && last.idx[last.idx.length - 1] === items.length - 2) last.idx.push(items.length - 1);
      }
      continue;
    }
    if (opts.raw) {
      const raw = push(r, 0, { role: 'raw', text: rowSummary(r) });
      const detail = rowDetail(r);
      if (detail !== null) raw.detail = detail;
      continue;
    }
    const p = objOf(r.payload);
    if (r.kind === 'turn.sent') {
      turnGuidance = typeof p?.guidanceHash === 'string' ? p.guidanceHash : null;
      openTurns.push(typeof p?.turn === 'string' ? p.turn : `seq:${r.seq}`);
      // review M1: a stamped message pairs with ITS turn.sent exactly; an unstamped one (session.send still in flight)
      // pairs in send order with the first turn.sent no stamp claims
      const id = typeof p?.turn === 'string' ? p.turn : undefined;
      const exact = id !== undefined ? waiting.find((x) => !x.sent && x.turn === id) : undefined;
      if (exact) exact.sent = true;
      else if (activeUnsent && (activeTurn === undefined || activeTurn === id)) activeUnsent = false;
      else {
        const w = waiting.find((x) => !x.sent && x.turn === undefined);
        if (w) {
          w.sent = true;
          if (id !== undefined) w.turn = id;
        }
      }
      if (openTurns.length === 1 && waiting.length === 0) {
        turnSince = r.at;
        turnKey = String(r.seq);
        progress = undefined;
        steps.reset();
      }
    }
    if (r.kind === 'session.exited' || r.kind === 'session.orphaned' || r.kind === 'session.drained' || r.kind === 'session.open') settle();
    if (r.kind === 'turn.result') {
      // review M2: turn.result{turn} names the LATEST turn it closes; every open turn up to it closes too (a queued
      // message Claude Code folded into the running turn). A row without it (older logs) closes the oldest (FIFO).
      // Re-review M-1, probe p-replay-order (claude 2.1.305): the echo is written on consumption, never on receipt,
      // so the turns the kernel names as closed really were folded into this result.
      const at = typeof p?.turn === 'string' ? openTurns.indexOf(p.turn) : -1;
      const closed = openTurns.splice(0, at >= 0 ? at + 1 : Math.min(1, openTurns.length));
      progress = undefined;
      // #gui-turn-steps: the turn's one quiet summary under its reply (hooks that blocked, failed, timed out or were
      // slow; failed tool calls), before its result line
      const sum = steps.summary();
      if (sum) {
        const line = push(r, 1, { role: 'hook', text: sum.text });
        if (sum.warn) line.tone = 'warn';
      }
      steps.reset();
      const it = kernelItem(r);
      if (it) {
        const line = push(r, 0, it);
        // T-2026-10-26-003: a run stopped at the step limit, or with no answer, reads in the warning tone
        if (it.tone) line.tone = it.tone;
      } else hidden++;
      // a folded turn's message no longer waits (its replay normally already started it)
      for (let i = waiting.length - 1; i >= 0; i--) if (waiting[i]!.turn !== undefined && closed.includes(waiting[i]!.turn!)) waiting.splice(i, 1);
      // the next waiting message starts, unless it is stamped for a later turn while another turn runs first
      const next = waiting[0];
      if (next && (next.turn === undefined || openTurns.length === 0 || openTurns[0] === next.turn)) startNext();
      if (openTurns.length > 0) {
        turnSince = r.at;
        turnKey = String(r.seq);
      }
      continue;
    }
    if (r.kind === 'turn.event' && r.view === 'full' && p) {
      // the running step's clock: a tool_progress heartbeat (its elapsed seconds) or a task start; a new message ends it
      if (p.type === 'tool_progress' || p.type === 'system.task_started') progress = progressOf(p.line, r.at, p.type === 'system.task_started') ?? progress;
      else if (p.type === 'assistant' || p.type === 'user') progress = undefined;
      // Aegis M2: the kernel's hook facts (from the FULL line) end a hook step even when the line is stored by hash
      const facts = p.hook !== undefined && (r.principal === undefined || /^p:[0-9a-z]{8}\/kernel$/.test(r.principal)) ? p.hook : undefined;
      if (typeof p.line === 'string' || facts !== undefined) steps.push(r.seq, r.at, typeof p.line === 'string' ? p.line : null, facts, typeof p.type === 'string' ? p.type : undefined);
    }
    if (r.kind === 'turn.event' && r.view === 'full' && p && typeof p.line === 'string') {
      const its = lineItems(p.line, turnGuidance).map((it) => (it.role === 'assistant' ? withKernelSaid(it, kernelReply.get(r.seq)) : it)).filter((it) => {
        if (it.role !== 'user') return true;
        const i = echoes.indexOf(oneLine(it.text));
        if (i < 0) return true;
        // claude replays a message when its turn STARTS: that message (and any before it) no longer waits
        const w = echoTurn[i];
        echoes.splice(i, 1);
        echoTurn.splice(i, 1);
        if (w) {
          const at = waiting.indexOf(w);
          if (at >= 0) {
            activeUnsent = !w.sent;
            activeTurn = w.turn;
            waiting.splice(0, at + 1);
          }
        }
        if (editedReplays > 0) editedReplays--;
        return false;
      });
      if (!its.length) hidden++;
      its.forEach((it, i) => {
        if (it.role === 'user' && editedReplays > 0) {
          editedReplays--;
          push(r, i, { ...it, voice: 'voice-edited' });
        } else push(r, i, it);
      });
      continue;
    }
    if (r.kind === 'turn.sent' && p?.source === 'voice-edited') editedReplays++;
    if (r.kind === 'turn.sent' && p?.source === 'voice') {
      const cited = citedSeqs(p).filter((n) => voiceEcho.has(n));
      if (cited.length > 1) {
        let w: WaitingTurn | null = null;
        for (const n of cited) {
          const i = echoes.indexOf(voiceEcho.get(n)!);
          if (i >= 0) {
            w ??= echoTurn[i] ?? null;
            echoes.splice(i, 1);
            echoTurn.splice(i, 1);
          }
        }
        echoes.push(oneLine(cited.map((n) => voiceEcho.get(n)!).join(' ')));
        echoTurn.push(w);
      }
    }
    if ((r.kind === 'voice.turn.agent' || r.kind === 'voice.bargein') && !isPartial(r, p)) {
      const f = spokenFold(r, p, spoken);
      if (f === 'folded' || f === null) hidden++;
      else {
        f.item = push(r, 0, { role: 'spoken', text: spokenText(f) });
        spoken = f.solo ? null : f;
      }
      if (spoken) spoken.item.text = spokenText(spoken);
      continue;
    }
    // fidelity 2: the chat (the comp) opens with the conversation: "session opened · claude · /path" and "voice
    // attached · …" are quiet bookkeeping, counted as raw hidden (the raw view and the kernel feed still show them)
    if ((r.kind === 'session.open' && !objOf(p?.resume)) || r.kind === 'voice.session.start') {
      hidden++;
      continue;
    }
    const v0 = voiceItem(r, p, { shownVoiceSeqs, sentSeqs, editedSeqs });
    const lab = v0 && v0.role === 'user' ? (r.kind === 'turn.sent' ? sentLabel(p) : sentLabels.get(r.seq)) : undefined;
    const v = v0 && lab ? { ...v0, sentLabel: lab.label } : v0;
    if (v !== undefined) {
      if (v === null) hidden++;
      else {
        if (v.role === 'user') {
          echoes.push(oneLine(v.text)); // claude's replay of the same words shows once
          voiceEcho.set(r.seq, oneLine(v.text));
          shownVoiceSeqs.add(r.seq);
          // the turn.sent fallback line IS its own turn's message (that turn.sent is already in `openTurns`)
          const own = r.kind === 'turn.sent';
          const ownTurn = own ? openTurns.pop() : undefined;
          push(r, v.part ?? 0, v, 'voice-message');
          if (ownTurn !== undefined) openTurns.push(ownTurn);
          const w = lastWaiting();
          if (own && w) w.sent = true;
          else if (own) activeUnsent = false;
          echoTurn.push(w);
        } else push(r, v.part ?? 0, v, 'tail');
      }
      continue;
    }
    const it = kernelItem(r);
    if (it) push(r, 0, it);
    else hidden++;
  }
  // T-2026-10-21-007: the running turn shows a `working` row under its output until its turn.result (live sessions only)
  if (opts.live && !opts.raw && openTurns.length > 0 && turnSince) {
    const last = rows[rows.length - 1];
    const now = steps.now();
    place({ key: `work:${turnKey}`, seq: last ? last.seq : 0, role: 'working', text: 'working…', at: turnSince, live: { since: turnSince, ...(progress ? { progress } : {}), ...(now ? { now } : {}) }, steps: steps.steps.map((x) => ({ ...x, seqs: [...x.seqs], ...(x.hook ? { hook: { ...x.hook } } : {}) })) }, 'turn');
  }
  // #gui-offer-slip: a reply's ```offer block is hidden only under a kernel offer.shown row for that reply
  return { items: opts.raw ? items : stripOfferBlocks(items, rows), hidden };
}

/* ── S2 desk structure: pure helpers (critique 2026-10-20 §2 S2) ─────────────────────────────────────────────── */

/** S2.1: the project hue of a session group, from the ONE function the kernel's Workshop feed uses (projectHue of the
 * session.open cwd); a group with no cwd seen yet falls back to its repo name through the same function. */
export function groupHue(repo: string, sessions: ReadonlyArray<Pick<SessionRow, 'cwd'>>): number {
  const cwd = sessions.find((s) => typeof s.cwd === 'string' && s.cwd)?.cwd;
  return projectHue(cwd ?? repo);
}

export const TITLE_MAX = 28;
const baseName = (p: string): string => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

type TitleOf = Pick<SessionRow, 'hsid' | 'repo' | 'cwd' | 'firstUser'> & { name?: string | null };
/** A title cut to TITLE_MAX code points (never inside a surrogate pair), with … when cut. */
function cutTitle(t: string): string {
  const cps = [...t];
  return cps.length > TITLE_MAX ? `${cps.slice(0, TITLE_MAX - 1).join('').trimEnd()}…` : t;
}
/** S2.2: the derived name, in full: the first user message on one line, else `<repo basename> · <hsid tail 4>`. */
export function derivedTitle(s: TitleOf): string {
  const first = s.firstUser ? oneLine(s.firstUser) : '';
  if (first) return first;
  const where = s.repo && s.repo !== UNSCOPED ? s.repo : s.cwd ? s.cwd : 'session';
  return `${baseName(where)} · ${s.hsid.slice(-4)}`;
}
/** 8.0:session-rename: the full title (the tooltip): the human's name when one is set, else the derived one. */
export function sessionFullTitle(s: TitleOf): string {
  return s.name || derivedTitle(s);
}
/** S2.2: a session's display name: the human's name (session.renamed) or its first user message, cut to 28 chars, else
 * `<repo basename> · <hsid tail 4>`. A name is display text only: the GUI never routes or matches by it. */
export function sessionTitle(s: TitleOf): string {
  return s.name || s.firstUser ? cutTitle(sessionFullTitle(s)) : derivedTitle(s);
}

export type NoteTone = 'need' | 'fail' | 'plain';
/** S2.2: the right-aligned state note of a rail row: KNOT (warn ink), failed (vermilion; it outranks its own cards),
 * N card(s) (warn ink), else the state. */
export function sessionNote(s: Pick<SessionRow, 'state'> & { pending: number; knot?: boolean }): { text: string; tone: NoteTone } {
  if (s.knot) return { text: 'KNOT', tone: 'need' };
  if (s.state === 'failed') return { text: 'failed', tone: 'fail' };
  if (s.pending) return { text: `${s.pending} card${s.pending === 1 ? '' : 's'}`, tone: 'need' };
  return { text: s.state, tone: 'plain' };
}

/** S2.2: Active (live, and FAILED: a failure still needs the human, so it stays in Active as "failed" until it is
 * dismissed) and Past (ended | refused | orphaned | seen) sessions. */
export function splitActivePast<T extends Pick<SessionRow, 'state'>>(ss: readonly T[]): { active: T[]; past: T[] } {
  const active: T[] = [];
  const past: T[] = [];
  for (const s of ss) (isLiveState(s.state) || s.state === 'failed' ? active : past).push(s);
  return { active, past };
}

const secsBetween = (a?: string, b?: string): number | null => {
  const x = a ? Date.parse(a) : NaN;
  const y = b ? Date.parse(b) : NaN;
  return Number.isFinite(x) && Number.isFinite(y) && y >= x ? Math.round((y - x) / 1000) : null;
};

/** S2.5: the activity line's summary of folded tool rows: `HH:MM–HH:MM · read N files · ran N commands · Ns of work`. */
export function activitySummary(children: readonly ChatItem[], from?: string, to?: string): string {
  let read = 0;
  let ran = 0;
  let edited = 0;
  let other = 0;
  for (const c of children) {
    if (c.role !== 'tool') continue;
    const name = c.text.split(' · ')[0] ?? '';
    if (/^(Read|Glob|Grep|LS|NotebookRead)$/.test(name)) read++;
    else if (/^(Bash|BashOutput)$/.test(name)) ran++;
    else if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(name)) edited++;
    else other++;
  }
  const auto = children.filter((c) => c.role === 'auto').length;
  const hm = (at?: string): string => (at ? at.slice(11, 16) : '');
  const start = hm(from ?? children[0]?.at);
  const end = hm(to ?? children[children.length - 1]?.at);
  const parts = [start && end && start !== end ? `${start}–${end}` : start || end];
  if (read) parts.push(`read ${read} file${read === 1 ? '' : 's'}`);
  if (edited) parts.push(`edited ${edited} file${edited === 1 ? '' : 's'}`);
  if (ran) parts.push(`ran ${ran} command${ran === 1 ? '' : 's'}`);
  if (other) parts.push(`${other} other tool${other === 1 ? '' : 's'}`);
  if (auto) parts.push(`${auto} auto-approved`);
  const work = secsBetween(from, to);
  if (work !== null) parts.push(`${durationText(work)} of work`);
  return parts.filter(Boolean).join(' · ');
}

/** S2.5: "41s", "7m 55s", "1h 4m" (the activity line's "of work" and a reply's "took"). */
export function durationText(secs: number): string {
  if (secs < 90) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

export interface FoldedItem extends ChatItem {
  /** S2.5 activity: the folded tool / auto rows (shown when expanded). */
  children?: ChatItem[];
  /** S2.5: seconds from the user's message to this reply ("took Ns"). */
  took?: number;
}

/** The fold key of a raw row (the activity fold's expanded set holds it). */
export const rawFoldKey = (it: Pick<ChatItem, 'key'>): string => `raw:${it.key}`;
/**
 * Raw view (PURE): a raw row with a detail folds like the activity line; an expanded one is followed by one
 * `raw-detail` item, its whole row pretty-printed (key = its key + `:detail`).
 */
export function foldRaw(items: readonly ChatItem[], expanded: ReadonlySet<string> = new Set()): ChatItem[] {
  const out: ChatItem[] = [];
  for (const it of items) {
    out.push(it);
    if (it.role === 'raw' && it.detail !== undefined && expanded.has(rawFoldKey(it))) out.push({ key: `${it.key}:detail`, seq: it.seq, role: 'raw-detail', text: it.detail });
  }
  return out;
}

/**
 * S2.5 (PURE): consecutive tool and auto rows fold into ONE `activity` item (collapsed by default; key = `act:` + its
 * first child's key, so expanding it is stable) whose text is activitySummary (from the user's message to the reply
 * that ends the run); a reply after a user message gets `took` seconds. `expanded` activity keys show their children
 * inline after the line. Raw mode never folds (the caller skips this).
 */
export function foldActivity(items: readonly ChatItem[], expanded: ReadonlySet<string> = new Set()): FoldedItem[] {
  const out: FoldedItem[] = [];
  let lastUserAt: string | undefined;
  let run: ChatItem[] = [];
  // T-2026-10-21-007: the latest activity line since the last message / reply / result, and where its clock starts
  let seg: { i: number; from: string | undefined } | null = null;
  /** A reply or a result closes the turn's segment: its latest activity line reads the work up to that moment (a card
   * between the tools and the reply no longer freezes it at the last tool row). */
  const close = (endAt: string | undefined): void => {
    const s0 = seg as { i: number; from: string | undefined } | null;
    const act = s0 ? out[s0.i] : undefined;
    if (s0 && act && endAt) out[s0.i] = { ...act, text: activitySummary(act.children ?? [], s0.from, endAt) };
    seg = null;
  };
  const flush = (nextAt?: string): void => {
    if (!run.length) return;
    const first = run[0]!;
    const key = `act:${first.key}`;
    const from = lastUserAt ?? first.at;
    seg = { i: out.length, from };
    out.push({ key, seq: first.seq, role: 'activity', text: activitySummary(run, from, nextAt ?? run[run.length - 1]!.at), ...(first.at ? { at: first.at } : {}), children: run });
    if (expanded.has(key)) out.push(...run);
    run = [];
  };
  for (const it of items) {
    if (it.role === 'tool' || it.role === 'auto') {
      run.push(it);
      continue;
    }
    if (it.role === 'assistant') {
      flush(it.at);
      close(it.at);
      const took = lastUserAt !== undefined ? secsBetween(lastUserAt, it.at) : null;
      out.push(took !== null ? { ...it, took } : it);
      lastUserAt = undefined;
      continue;
    }
    if (it.role === 'working') {
      // the running turn: its latest activity line counts live (no "of work" yet; the page ticks the clock)
      flush();
      const s0 = seg as { i: number; from: string | undefined } | null;
      const act = s0 ? out[s0.i] : undefined;
      if (s0 && act && it.live) {
        const since = s0.from ?? act.at ?? it.live.since;
        out[s0.i] = { ...act, text: activitySummary(act.children ?? [], since), live: { since, ...(it.live.progress ? { progress: it.live.progress } : {}) } };
      }
      out.push(it);
      continue;
    }
    // a turn's result freezes a trailing activity line at the turn's real end
    flush(it.role === 'result' ? it.at : undefined);
    if (it.role === 'result') close(it.at);
    else if (it.role === 'user') seg = null;
    if (it.role === 'user') lastUserAt = it.at;
    out.push(it);
  }
  flush();
  return out;
}
