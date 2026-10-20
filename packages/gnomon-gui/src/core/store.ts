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
import { projectHue, sha256Tagged } from '@a-company/gnomon-contracts';
import { MODE_ROW_KINDS } from './modes.js';
import { idleNoteOf, speakerName, VOICE_ACTIVITY_KINDS, VOICE_ROW_KINDS } from './voice.js';
import { isClientRow, type EnrolState } from './voice-client.js';

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
  /** The kernel boot (count of daemon.start rows read) this session was last opened in. */
  boot: number;
  /** S2: the session.open cwd (the key of the one project hue, projectHue) and its at (the chat header's "started"). */
  cwd?: string | null;
  openedAt?: string | null;
  /** S2: the first user message (the session's human name, sessionTitle); null until one is seen. */
  firstUser?: string | null;
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
  /** Rows with no session, kept for the kernel feed. */
  readonly kernelFeed: Row[] = [];
  readonly cards = new Map<string, StackCard>();
  #cardSeq = 0;
  head = 0;
  rowsSeen = 0;
  /** daemon.start rows read: each one is a new kernel boot. */
  boot = 0;
  /** The log these rows came from (a page's / subscription's `logId`); null before the first read. */
  logId: string | null = null;
  /** V2d: "Ambient turned off after N min idle" from the kernel's idle auto-off, until the next voice.session.start. */
  voiceNote: string | null = null;
  /** V2d: the kernel's ambient idle auto-off (status.voice.ambientIdleMs), set by the page; names the note's minutes */
  voiceIdleMs: number | null = null;
  /** V2e: the "Teach Gnomon your voice" flow while its dialog is open (the page opens it; status.voice.enrolment folds into it). */
  enrol: EnrolState | null = null;
  /** V2e: the latest quiet notice from the voice app (A5: status.voice.notice, set by the page), until it is shown. */
  voiceToast: { text: string; at: string | null } | null = null;
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
    this.boot = 0;
    this.position = 0;
    this.logId = null;
    this.voiceNote = null;
    this.voiceToast = null;
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
      if (!s.firstUser) {
        // S2 session names: the first thing the human said (claude's replay of it, or a sent voice turn)
        if (r.kind === 'turn.event' && r.view === 'full' && typeof p.line === 'string') s.firstUser = lineItems(p.line).find((it) => it.role === 'user' && it.text.trim())?.text ?? null;
        else if (r.kind === 'voice.turn.user' && p.partial !== true && typeof p.text === 'string' && p.text.trim()) s.firstUser = p.text;
      }
      what.add('sessions');
    } else {
      this.kernelFeed.push(r);
      what.add('feed');
    }
    // P8-D87: rows that change status.runModes — the page re-reads status on them (motion-on-events, no polling)
    if (MODE_ROW_KINDS.has(r.kind)) what.add('modes');
    // V2d: an attachment row changes status.voice (the pill re-reads it); a turn row kicks the level meter; the
    // kernel's idle auto-off leaves a quiet note until the next attachment
    if (VOICE_ROW_KINDS.has(r.kind)) {
      what.add('voice');
      if (r.kind === 'voice.session.start') this.voiceNote = null;
      else if (r.kind === 'voice.session.end') this.voiceNote = idleNoteOf(r.kind, r.payload, this.voiceIdleMs);
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

/* ── chat transcript (dogfood 2026-10-19: the focused session showed 16 rows of hook noise, not the conversation) ── */

/** How one transcript item reads: the user's message, the assistant's text, a tool call, a card, the turn result, a lifecycle note, an error, or a raw row. */
/**
 * V2d voice roles: `user` with `speaker` set is a voice turn sent to the session (🎙 <speaker>); `voice-heard` a turn heard but not sent (handled as a decision/control,
 * or not addressed to the session); `voice-refused` a voice turn the kernel refused (its reason, subtle); `spoken`
 * the 🔊 marker under a reply the voice app spoke aloud.
 */
export type ChatRole = 'user' | 'assistant' | 'activity' | 'tool' | 'card' | 'auto' | 'result' | 'system' | 'error' | 'raw' | 'voice-heard' | 'voice-refused' | 'spoken';

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
  /** table talk (TD-2026-10-20-294): an assistant reply's speak block, shown as the "said aloud" line (the body omits it) */
  said?: string;
  /** Aegis L3: 'kernel' = the words come from the kernel's speakable row (from:'block'); 'reply' = this GUI's own parse (no kernel row) */
  saidBy?: 'kernel' | 'reply';
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
  // the user's own message as claude replays it (--replay-user-messages): the only row that carries its text
  // (session.inject / turn.sent log a hash and a byte count, never the text — G-LOG-03)
  if (m.type === 'user' && msg) {
    const text = humanTextOf(msg.content, guidanceHash);
    return text.trim() ? [{ role: 'user', text: cap(text, CHAT_TEXT_MAX) }] : [];
  }
  return [];
}

function resultText(p: Record<string, unknown>): string {
  const parts = [p.isError === true ? 'error' : typeof p.subtype === 'string' ? p.subtype : 'done'];
  if (typeof p.cost === 'number') parts.push(`$${p.cost.toFixed(4)}`);
  const tokens = objOf(p.usage)?.tokens;
  if (typeof tokens === 'number') parts.push(`${tokens.toLocaleString('en-US')} tokens`);
  if (typeof p.permission_denials === 'number' && p.permission_denials > 0) parts.push(`${p.permission_denials} denied`);
  return parts.join(' · ');
}

/**
 * T-2026-10-20-005: there is no partial-text row. voice.turn.partial is not a registered kind and the kernel stores no
 * partial voice.turn.user; live words (phase B) come through status.voice.capture to the gui credential only
 * (core/capture.ts), never through the log. A row claiming to be partial is hidden.
 */
function isPartial(r: Row, p: Record<string, unknown> | null): boolean {
  return r.kind === 'voice.turn.partial' || (r.kind === 'voice.turn.user' && p?.partial === true);
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

type VoiceCtx = { shownVoiceSeqs: Set<number>; sentSeqs: Set<number>; editedSeqs: Set<number>; speakable: { n: number } };
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
            ? 'in composer' // dictation: the kernel stamped it forwardable; it waits in the composer until sent
            : p.forwarded === false
              ? 'voice app says: not sent'
              : 'not sent to the session';
      return { role: 'voice-heard', text: `${speaker}: “${cap(oneLine(text), TOOL_SUMMARY_MAX)}” · ${claim}`, speaker, part: 1 };
    }
    case 'voice.turn.agent': {
      // V2e: the kernel's own speakable reply (source kernel-speakable, items) carries the 🔊; the voice app's playback
      // row for that same reply then shows nothing more (never shown twice). A playback row with no kernel row before
      // it (an older kernel) keeps the V2d marker.
      if (p.source === 'kernel-speakable') {
        if (!Array.isArray(p.items) || !p.items.length) return null;
        ctx.speakable.n++;
        return { role: 'spoken', text: '🔊 spoken aloud' };
      }
      if (ctx.speakable.n > 0) {
        ctx.speakable.n--;
        return null;
      }
      const spoken = typeof p.textSpoken === 'string' ? p.textSpoken : '';
      const planned = typeof p.textPlanned === 'string' ? p.textPlanned : '';
      if (!spoken.trim()) return null;
      return { role: 'spoken', text: `🔊 spoken aloud${planned && spoken.length < planned.length ? ' (in part)' : ''}` };
    }
    case 'voice.bargein':
      return { role: 'spoken', text: '🔊 interrupted' };
    case 'voice.session.start':
      return { role: 'system', text: `voice attached · ${p.mode === 'ptt' ? 'push-to-talk' : 'ambient'}` };
    case 'voice.session.end': {
      const note = idleNoteOf(r.kind, p);
      return { role: 'system', text: note ?? 'voice detached' };
    }
    default:
      return null;
  }
}

/** A kernel row's chat item, or null when it is noise in the chat view. */
function kernelItem(r: Row): Pick<ChatItem, 'role' | 'text'> | null {
  if (r.view === 'stub' || r.view === 'oversize' || r.payload === undefined) return null;
  const p = objOf(r.payload) ?? {};
  switch (r.kind) {
    case 'session.open':
      return { role: 'system', text: `${objOf(p.resume) ? 'session resumed' : 'session opened'}${typeof p.model === 'string' ? ` · ${p.model}` : ''}${typeof p.cwd === 'string' ? ` · ${p.cwd}` : ''}` };
    case 'session.exited':
      return { role: 'system', text: `session ended${typeof p.reason === 'string' ? ` · ${p.reason}` : ''}${typeof p.code === 'number' ? ` · exit ${p.code}` : ''}${typeof p.signal === 'string' ? ` · ${p.signal}` : ''}` };
    case 'session.orphaned':
      return { role: 'system', text: 'session ended with the old kernel (orphaned at the next boot)' };
    case 'session.drained':
      return { role: 'system', text: 'session drained for a kernel restart' };
    case 'turn.result':
      return { role: 'result', text: resultText(p) };
    case 'approval.request': {
      const card = objOf(p.card) ?? {};
      return { role: 'card', text: `needs you · ${typeof card.kind === 'string' ? card.kind : 'card'} (decide it in the stack)` };
    }
    case 'approval.decide':
      return { role: 'card', text: `decided · ${typeof p.decision === 'string' ? p.decision : '?'}` };
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

/**
 * The focused session's rows as a chat: the user's messages (this page's composer echo, else claude's replay), the
 * assistant's text, one compact line per tool call, cards, the turn result (cost and tokens) and lifecycle notes.
 * Everything else (hook started/response, stream_event partials, rate limits, status, control frames, tool results,
 * turn.partial / turn.usage / session.inject / turn.sent bookkeeping) is hidden and counted; `raw: true` shows every
 * row as its one-line summary instead. A composer echo (`connId: 'local'`) hides the replay of the same text that
 * follows it, so a sent message shows once and the list only ever grows at the end.
 */
export function chatItems(rows: readonly Row[], opts: { raw?: boolean } = {}): { items: ChatItem[]; hidden: number } {
  const items: ChatItem[] = [];
  let hidden = 0;
  const echoes: string[] = []; // composer texts not yet matched by claude's replay
  const push = (r: Row, part: number, it: Pick<ChatItem, 'role' | 'text'> & { speaker?: string; voice?: ChatItem['voice']; said?: string; saidBy?: ChatItem['saidBy'] }): void => {
    items.push({ key: part ? `${r.seq}.${part}` : String(r.seq), seq: r.seq, role: it.role, text: it.text, ...(r.at ? { at: r.at } : {}), ...(it.speaker !== undefined ? { speaker: it.speaker } : {}), ...(it.voice !== undefined ? { voice: it.voice } : {}), ...(it.said !== undefined ? { said: it.said, saidBy: it.saidBy ?? 'reply' } : {}) });
  };
  // dictation: claude replays a multi-part voice message as its parts joined; the shown turns' echoes are folded into one
  const voiceEcho = new Map<number, string>();
  let editedReplays = 0; // turn.sent{voice-edited} not yet matched by the message's replay (it gets the 🎙✎ mark)
  const shownVoiceSeqs = new Set<number>();
  // Aegis M (V2d): "sent" is the kernel's word (turn.sent{source:'voice', voiceTurnSeq}), never the voice app's claim
  const sentSeqs = new Set<number>();
  const editedSeqs = new Set<number>();
  const speakable = { n: 0 }; // V2e: kernel-speakable replies not yet matched by the voice app's playback row
  // Aegis L3: the kernel's speakable reply per source row (turnSeq): the said-aloud line is the kernel's words
  const kernelReply = new Map<number, { text: string; from: string }>();
  let turnGuidance: string | null = null; // Aegis M1: the guidanceHash of the latest turn.sent
  for (const r of rows) {
    const p = objOf(r.payload);
    if (r.kind === 'voice.turn.agent' && p?.source === 'kernel-speakable' && typeof r.principal === 'string' && /^p:[0-9a-z]{8}\/kernel$/.test(r.principal) && typeof p.turnSeq === 'number' && Array.isArray(p.items)) {
      const it = p.items.map(objOf).find((x) => x?.kind === 'reply' && typeof x.text === 'string');
      if (it) kernelReply.set(p.turnSeq, { text: String(it.text), from: typeof it.from === 'string' ? it.from : '' });
    }
    if (r.kind === 'turn.sent' && p?.source === 'voice') for (const n of citedSeqs(p)) sentSeqs.add(n);
    if (r.kind === 'turn.sent' && p?.source === 'voice-edited') for (const n of citedSeqs(p)) editedSeqs.add(n);
  }
  for (const r of rows) {
    if (r.connId === 'local') {
      if (r.kind === 'composer') {
        const t = String(r.payload ?? '');
        echoes.push(oneLine(t));
        push(r, 0, { role: 'user', text: t, ...(r.mark === 'voice-edited' ? { voice: 'voice-edited' as const } : {}) });
        if (r.mark === 'voice-edited' && editedReplays > 0) editedReplays--;
      } else push(r, 0, { role: 'error', text: String(r.payload ?? '') });
      continue;
    }
    if (opts.raw) {
      push(r, 0, { role: 'raw', text: rowSummary(r) });
      continue;
    }
    const p = objOf(r.payload);
    if (r.kind === 'turn.sent') turnGuidance = typeof p?.guidanceHash === 'string' ? p.guidanceHash : null;
    if (r.kind === 'turn.event' && r.view === 'full' && p && typeof p.line === 'string') {
      const its = lineItems(p.line, turnGuidance).map((it) => (it.role === 'assistant' ? withKernelSaid(it, kernelReply.get(r.seq)) : it)).filter((it) => {
        if (it.role !== 'user') return true;
        const i = echoes.indexOf(oneLine(it.text));
        if (i < 0) return true;
        echoes.splice(i, 1);
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
        for (const n of cited) {
          const i = echoes.indexOf(voiceEcho.get(n)!);
          if (i >= 0) echoes.splice(i, 1);
        }
        echoes.push(oneLine(cited.map((n) => voiceEcho.get(n)!).join(' ')));
      }
    }
    const v = voiceItem(r, p, { shownVoiceSeqs, sentSeqs, editedSeqs, speakable });
    if (v !== undefined) {
      if (v === null) hidden++;
      else {
        if (v.role === 'user') {
          echoes.push(oneLine(v.text)); // claude's replay of the same words shows once
          voiceEcho.set(r.seq, oneLine(v.text));
          shownVoiceSeqs.add(r.seq);
        }
        push(r, v.part ?? 0, v);
      }
      continue;
    }
    const it = kernelItem(r);
    if (it) push(r, 0, it);
    else hidden++;
  }
  return { items, hidden };
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

/** S2.2: a session's human name: its first user message cut to 28 chars, else `<repo basename> · <hsid tail 4>`. */
export function sessionTitle(s: Pick<SessionRow, 'hsid' | 'repo' | 'cwd' | 'firstUser'>): string {
  const first = s.firstUser ? oneLine(s.firstUser) : '';
  if (first) return first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX - 1).trimEnd()}…` : first;
  const where = s.repo && s.repo !== UNSCOPED ? s.repo : s.cwd ? s.cwd : 'session';
  return `${baseName(where)} · ${s.hsid.slice(-4)}`;
}

export type NoteTone = 'need' | 'fail' | 'plain';
/** S2.2: the right-aligned state note of a rail row: cards / KNOT (warn ink), failed (vermilion), else the state. */
export function sessionNote(s: Pick<SessionRow, 'state'> & { pending: number; knot?: boolean }): { text: string; tone: NoteTone } {
  if (s.knot) return { text: 'KNOT', tone: 'need' };
  if (s.pending) return { text: `${s.pending} card${s.pending === 1 ? '' : 's'}`, tone: 'need' };
  if (s.state === 'failed') return { text: 'failed', tone: 'fail' };
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
  const flush = (nextAt?: string): void => {
    if (!run.length) return;
    const first = run[0]!;
    const key = `act:${first.key}`;
    out.push({ key, seq: first.seq, role: 'activity', text: activitySummary(run, lastUserAt ?? first.at, nextAt ?? run[run.length - 1]!.at), ...(first.at ? { at: first.at } : {}), children: run });
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
      const took = lastUserAt !== undefined ? secsBetween(lastUserAt, it.at) : null;
      out.push(took !== null ? { ...it, took } : it);
      lastUserAt = undefined;
      continue;
    }
    flush();
    if (it.role === 'user') lastUserAt = it.at;
    out.push(it);
  }
  flush();
  return out;
}
