/**
 * @symbol #gui-slash-runs
 *
 * #gui-slash-runs (8.0:local-lane slice C6'b2-1; Mika's design, TD-2026-10-28-956 and -969; spec G-GUI-20). PURE: a
 * "/" run's transcript row — "you ran {tool} on {server}" — through its states, and its words. The press paths are
 * ui/slash-menu.ts (SlashFlow); the menu is core/slash-menu.ts (#gui-slash-menu).
 *
 *   running   added at the press, before the kernel answers: a spinner and a clock.
 *   ran       the result in a data fold (model-text-control's dashed edge, the label "data", mono, folded past
 *             DATA_FOLD_AT lines, text nodes only); an isError result adds "✕ the tool returned an error". The policy
 *             word: send "goes with your next message" · ask or not chosen "kept here; not sent". C6'b2-2: under ask a
 *             Send this one key (request.session.tools.send{hsid, runId}) sends THIS result once, the tool staying ask;
 *             then the word reads "sent with your next message". Its refusals in words: already sent, held 10 min and
 *             gone (not-found), the binding changed, the tool already sends.
 *   asked     C6'b2-2 (founder: inline, not a stack card): after a result of a tool whose policy is not chosen, the row
 *             adds "Send {tool}'s results to the model? · [Always send] [Keep to me]". Always send (its note: "sends
 *             this result now") is request.session.tools.policy{policy:'send'}, a trusted press; the reply's `queued`
 *             is said in the polite live line. Keep to me sets ask, and Send this one appears.
 *   refused   plain words and next:, never the code. The human limit is said here only: "10 runs a minute from /; try
 *             again in Ns".
 *   carded    "waiting for your card", its key Decide in the stack (it focuses the card, never its Allow). When the
 *             card's run settles (its tool.brokered{author:'human', cardId} row): allowed, request.session.tools.result
 *             is read ONCE (reading); a result already gone is "held 10 min; it's gone · run it again"; denied is "you
 *             denied it; nothing ran".
 *   The result text is held in this page's memory only: a reload shows the kernel's tool.brokered{author:'human'} row
 *   (runRowOf) and never reads a result again.
 */
import { displayText } from './render.js';
import { RUNS_PER_MINUTE } from './slash-menu.js';
import type { ToolClass } from './tools-drawer.js';

/** A result folds past this many lines (its fold key shows the rest). */
export const DATA_FOLD_AT = 12;
/** At most this much of a result is held and shown (the kernel caps what it sends; this guards the page). */
export const DATA_MAX_CHARS = 64 * 1024;
/** The kernel's RUN_RESULT_TTL_MS: a carded run's result is held this long. */
export const RESULT_HELD_MIN = 10;

export type RunPhase = 'running' | 'ran' | 'refused' | 'carded' | 'reading' | 'denied' | 'gone';

export interface RunView {
  /** this page's key for the row (before the kernel names the run) */
  key: string;
  hsid: string;
  tool: string;
  server: string;
  /** the capability id it ran */
  toolId: string;
  cls: ToolClass;
  /** the tool's "/" result policy when it ran (null: not chosen) */
  policy: 'send' | 'ask' | null;
  /** when it was pressed (ISO) */
  at: string;
  phase: RunPhase;
  runId: string | null;
  cardId: string | null;
  /** the result text (memory only), or the refused tool's own text */
  content: string | null;
  isError: boolean;
  refusal: { text: string; next: string | null } | null;
  /** the one tools.result read went out */
  read: boolean;
  /** the data fold is open */
  open: boolean;
  /** C6'b2-2: this result goes (or went) with the next message: it ran under send, or Always send queued it */
  goes: boolean;
  /** C6'b2-2: Send this one (request.session.tools.send): idle, in flight, sent, or refused (sendNote) */
  send: 'idle' | 'sending' | 'sent' | 'refused';
  /** C6'b2-2: a refused send in words; `retry`: pressing again may work (the connection dropped) */
  sendNote: { text: string; next: string | null; retry: boolean } | null;
  /** C6'b2-2: the first-use question's press in flight (Always send / Keep to me) */
  choosing: 'send' | 'ask' | null;
  /** C6'b2-2: the first-use choice was refused, in words */
  chooseNote: string | null;
}

export function startRun(o: { key: string; hsid: string; tool: string; server: string; toolId: string; cls: ToolClass; policy: 'send' | 'ask' | null; at: string }): RunView {
  return { ...o, phase: 'running', runId: null, cardId: null, content: null, isError: false, refusal: null, read: false, open: false, goes: o.policy === 'send', send: 'idle', sendNote: null, choosing: null, chooseNote: null };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const RUN_ID = /^run-[0-9a-f]{24}$/;
const held = (v: unknown): string | null => (typeof v === 'string' ? v.slice(0, DATA_MAX_CHARS) : null);

/** How many seconds until the oldest of the last RUNS_PER_MINUTE presses leaves the minute (at least 1). */
export function rateWaitSecs(times: readonly number[], now: number): number {
  const recent = times.filter((t) => now - t < 60_000).sort((a, b) => a - b);
  const oldest = recent.length >= RUNS_PER_MINUTE ? recent[recent.length - RUNS_PER_MINUTE]! : recent[0];
  if (oldest === undefined) return 1;
  return Math.max(1, Math.ceil((oldest + 60_000 - now) / 1000));
}

/** A refused run's why (the kernel's tools.run reply or tool.brokered decision) as words and next:, never the code. */
export function runRefusalWords(why: string | null, ctx: { server: string; content?: string | null; waitSecs?: number }): { text: string; next: string | null } {
  switch (why) {
    case 'servers-off':
      return { text: 'servers are off in this session', next: 'see Tools' };
    case 'unknown-tool':
      return { text: 'this tool isn’t in this session any more', next: 'open / again' };
    case 'untrusted':
      return { text: `${ctx.server} isn’t trusted`, next: 'trust it in Settings › MCP servers' };
    case 'bad-args':
      return { text: 'its arguments don’t fit the tool', next: 'fix them and run it again' };
    case 'busy':
      return typeof ctx.content === 'string' && ctx.content.startsWith('At most')
        ? { text: `${RUNS_PER_MINUTE} runs a minute from /; try again in ${ctx.waitSecs ?? 60}s`, next: null }
        : { text: 'another call is waiting for you', next: 'decide its card in the stack first' };
    case 'expired':
      return { text: 'its card expired; nothing ran', next: 'run it again' };
    case 'cancelled':
    case 'allowed-cancelled':
      return { text: 'it was stopped before it ran', next: 'run it again' };
    case 'no-approval-surface':
      return { text: 'no card could be shown; nothing ran', next: 'run it again' };
    case 'not-running':
      return { text: 'this session isn’t running any more', next: 'open a new session' };
    case 'loop-session':
      return { text: 'a loop session never runs tools from /', next: null };
    case 'refused':
      return { text: 'the tool refused it', next: 'run it again' };
    default:
      return { text: 'Gnomon refused it', next: 'run it again' };
  }
}

/** A refusal of the request itself (an RpcError's reason, or null: the connection dropped) in words. */
export function runRequestFailWords(reason: string | null, network: boolean): { text: string; next: string | null } {
  if (network) return { text: 'not known whether it ran: the connection dropped', next: 'look in Tools, or run it again once Gnomon is connected' };
  if (reason === 'not-found') return { text: 'this session isn’t running any more', next: 'open a new session' };
  if (reason === 'matrix') return { text: 'only the person who opened this session can run its tools from /', next: null };
  return { text: 'the kernel refused it', next: 'run it again' };
}

export type RunEvent =
  /** the tools.run reply (`waitSecs`: the page's own minute count, for a busy reply) */
  | { type: 'reply'; v: unknown; waitSecs?: number }
  /** the tools.run request failed: an RpcError's reason, or the network */
  | { type: 'failed'; reason: string | null; network: boolean }
  /** the carded run settled: its tool.brokered{author:'human', cardId} row's decision */
  | { type: 'settled'; decision: string }
  /** the one tools.result read is going out */
  | { type: 'read' }
  /** the tools.result reply */
  | { type: 'result'; v: unknown }
  /** the tools.result request failed */
  | { type: 'result-failed'; reason: string | null; network: boolean }
  | { type: 'fold'; open: boolean }
  /** C6'b2-2: Send this one is going out */
  | { type: 'sending' }
  /** C6'b2-2: the tools.send reply */
  | { type: 'sent'; v: unknown }
  /** C6'b2-2: the tools.send request failed: an RpcError's reason, or the network */
  | { type: 'send-failed'; reason: string | null; network: boolean }
  /** C6'b2-2: the tool's policy moved (`queued`: the kernel queued THIS row's result as it moved to send) */
  | { type: 'policy'; policy: 'send' | 'ask'; queued?: boolean }
  /** C6'b2-2: the first-use question was answered (its tools.policy request is going out) */
  | { type: 'choosing'; policy: 'send' | 'ask' }
  /** C6'b2-2: the tools.policy request failed: an RpcError's reason, or the network */
  | { type: 'choose-failed'; reason: string | null; network: boolean };

/** The ran / refused outcome of a reply body ({status, content, isError, why}). */
function outcome(r: RunView, v: Record<string, unknown>, waitSecs?: number): RunView {
  if (v.status === 'ran') return { ...r, phase: 'ran', content: held(v.content) ?? '', isError: v.isError === true, refusal: null };
  const why = typeof v.why === 'string' ? v.why : null;
  if (why === 'denied') return { ...r, phase: 'denied', content: null };
  // a refused tool's own text (bad-args, refused) is server or validator text: it stays behind the data edge
  const own = why === 'bad-args' || why === 'refused' ? held(v.content) : null;
  return { ...r, phase: 'refused', content: own, isError: true, refusal: runRefusalWords(why, { server: r.server, content: typeof v.content === 'string' ? v.content : null, ...(waitSecs !== undefined ? { waitSecs } : {}) }) };
}

/** THE reducer of a run row. An event that does not fit the phase leaves the row as it is. */
export function runReducer(r: RunView, e: RunEvent): RunView {
  switch (e.type) {
    case 'fold':
      return { ...r, open: e.open };
    case 'reply': {
      if (r.phase !== 'running') return r;
      const v = isObj(e.v) ? e.v : null;
      if (!v) return { ...r, phase: 'refused', refusal: { text: 'the kernel’s answer was not one this page reads', next: 'look in Tools' } };
      const runId = typeof v.runId === 'string' && RUN_ID.test(v.runId) ? v.runId : null;
      const cardId = typeof v.cardId === 'string' ? v.cardId : null;
      if (v.status === 'carded') return { ...r, runId, cardId, phase: runId && cardId ? 'carded' : 'refused', ...(runId && cardId ? {} : { refusal: { text: 'the kernel’s answer was not one this page reads', next: 'look in Tools' } }) };
      return outcome({ ...r, runId, cardId }, v, e.waitSecs);
    }
    case 'failed':
      return r.phase === 'running' ? { ...r, phase: 'refused', refusal: runRequestFailWords(e.reason, e.network) } : r;
    case 'settled': {
      if (r.phase !== 'carded') return r;
      if (e.decision === 'ran' || e.decision === 'approved') return r; // the flow reads the result once (event 'read')
      if (e.decision === 'denied') return { ...r, phase: 'denied' };
      return { ...r, phase: 'refused', refusal: runRefusalWords(e.decision, { server: r.server }) };
    }
    case 'read':
      return r.phase === 'carded' && !r.read ? { ...r, phase: 'reading', read: true } : r;
    case 'result': {
      if (r.phase !== 'reading') return r;
      const v = isObj(e.v) ? e.v : null;
      if (!v) return { ...r, phase: 'refused', refusal: { text: 'the kernel’s answer was not one this page reads', next: 'look in Tools' } };
      if (v.status === 'carded') return r; // still pending: not consumed (the flow may ask once more)
      return outcome(r, v);
    }
    case 'sending':
      return canSend(r) ? { ...r, send: 'sending', sendNote: null } : r;
    case 'sent': {
      if (r.send !== 'sending') return r;
      const v = isObj(e.v) ? e.v : null;
      if (v?.queued === true) return { ...r, send: 'sent', sendNote: null };
      return { ...r, send: 'refused', sendNote: { text: 'the kernel’s answer was not one this page reads', next: 'look in Tools', retry: false } };
    }
    case 'send-failed':
      return r.send === 'sending' ? { ...r, send: 'refused', sendNote: sendRefusalWords(e.reason, e.network, r.tool) } : r;
    case 'policy':
      return { ...r, policy: e.policy, choosing: null, chooseNote: null, ...(e.queued && r.phase === 'ran' && r.send !== 'sent' ? { goes: true } : {}) };
    case 'choosing':
      return askedOf(r) && r.choosing === null ? { ...r, choosing: e.policy, chooseNote: null } : r;
    case 'choose-failed':
      return r.choosing !== null ? { ...r, choosing: null, chooseNote: chooseRefusalWords(e.reason, e.network, r.server) } : r;
    case 'result-failed':
      if (r.phase !== 'reading') return r;
      if (!e.network && e.reason === 'not-found') return { ...r, phase: 'gone' };
      // still pending after the bounded asks: nothing was consumed, and the page does not ask again
      if (!e.network && e.reason === 'pending') return { ...r, phase: 'refused', refusal: { text: 'the result wasn’t ready to read', next: 'run it again' } };
      return { ...r, phase: 'refused', refusal: e.network ? { text: 'the result could not be read: the connection dropped', next: 'run it again' } : { text: 'the kernel refused to give the result', next: 'run it again' } };
  }
}

/** Is this live row the settling of one of our carded runs? Its decision, or null. */
export function settledDecisionOf(row: { kind: string; payload?: unknown }, cardId: string): string | null {
  const p = isObj(row.payload) ? row.payload : null;
  if (row.kind !== 'tool.brokered' || !p || p.author !== 'human' || p.cardId !== cardId || typeof p.decision !== 'string') return null;
  return p.decision;
}

/* ── words ───────────────────────────────────────────────────────────────────────────────────────────────────────── */

/** The policy word of a tool's policy alone (a row's own line is policyLine: it knows whether THIS result went). */
export function policyWord(policy: 'send' | 'ask' | null): string {
  return policy === 'send' ? SEND_COPY.goes : SEND_COPY.kept;
}

/** C6'b2-2 (Mika): the run row's send words. */
export const SEND_COPY = Object.freeze({
  goes: 'goes with your next message',
  kept: 'kept here; not sent',
  sent: 'sent with your next message',
  key: 'Send this one',
  sending: 'Sending…',
  live: (tool: string): string => `${tool}: this result goes with your next message`,
});

/** C6'b2-2: the row's policy line: whether THIS result went, goes, or stays. */
export function policyLine(r: Pick<RunView, 'goes' | 'send'>): string {
  if (r.send === 'sent') return SEND_COPY.sent;
  return r.goes ? SEND_COPY.goes : SEND_COPY.kept;
}

/**
 * C6'b2-2: Send this one is offered on a ran row with a run id whose result did not go, while its tool is ask (the
 * kernel refuses it under send: already-sending), and not after a refusal that cannot change (a dropped connection
 * may be pressed again: the kernel's already-sent keeps it once).
 */
export function canSend(r: RunView): boolean {
  return r.phase === 'ran' && r.runId !== null && !r.goes && r.policy === 'ask' && (r.send === 'idle' || (r.send === 'refused' && r.sendNote?.retry === true));
}

/** C6'b2-2: the first-use question (Mika): its words and keys. */
export const ASK_COPY = Object.freeze({
  question: (tool: string): string => `Send ${tool}’s results to the model?`,
  always: 'Always send',
  alwaysNote: 'sends this result now',
  keep: 'Keep to me',
  saving: 'Saving…',
  liveSend: (tool: string, queued: boolean): string => `${tool}’s results go to the model from now on; ${queued ? 'this result goes with your next message' : `this result is past ${RESULT_HELD_MIN} min and stays here`}`,
  liveAsk: (tool: string): string => `${tool}’s results stay here; Send this one sends one`,
});

/** C6'b2-2: the row asks the first-use question: a ran row of a tool whose policy is not chosen, whose result did not go. */
export function askedOf(r: RunView): boolean {
  return r.phase === 'ran' && r.policy === null && !r.goes && r.send !== 'sent';
}

/** C6'b2-2: a refused request.session.tools.policy in words, never the code. */
export function chooseRefusalWords(reason: string | null, network: boolean, server: string): string {
  if (network) return 'not known whether your choice was saved: the connection dropped · next: choose again once Gnomon is connected';
  if (reason === 'untrusted') return `${server} isn’t trusted, so its results are never sent · next: trust it in Settings › MCP servers`;
  if (reason === 'not-found') return 'this tool isn’t in this session any more · next: open / again';
  if (reason === 'matrix') return 'only the person who opened this session can choose where its results go';
  return 'Gnomon didn’t save your choice · next: choose again';
}

/** C6'b2-2: a refused request.session.tools.send in words, never the code. */
export function sendRefusalWords(reason: string | null, network: boolean, tool: string): { text: string; next: string | null; retry: boolean } {
  if (network) return { text: 'not known whether it was sent: the connection dropped', next: 'press Send this one again once Gnomon is connected', retry: true };
  switch (reason) {
    case 'already-sent':
      return { text: 'this result was already sent', next: null, retry: false };
    case 'not-found':
      return { text: `held ${RESULT_HELD_MIN} min; it’s gone`, next: 'run it again', retry: false };
    case 'changed':
      return { text: 'the tool or its server’s trust changed since it ran, so it isn’t sent', next: 'run it again', retry: false };
    case 'already-sending':
      return { text: `${tool} already sends its results; this one ran before that`, next: 'run it again to send it', retry: false };
    case 'matrix':
      return { text: 'only the person who opened this session can send its results', next: null, retry: false };
    default:
      return { text: 'the kernel didn’t send it', next: 'run it again', retry: false };
  }
}

export interface DataFold {
  /** the lines shown */
  lines: string[];
  total: number;
  folded: boolean;
  /** the fold key's label, or null (12 lines or fewer) */
  key: string | null;
}

/** A result as the data fold shows it: folded past DATA_FOLD_AT lines unless open. Text only (the caller draws text nodes). */
export function dataFoldOf(content: string, open: boolean): DataFold {
  const all = displayText(content).split('\n');
  const total = all.length;
  if (total <= DATA_FOLD_AT) return { lines: all, total, folded: false, key: null };
  if (open) return { lines: all, total, folded: false, key: 'fold it' };
  return { lines: all.slice(0, DATA_FOLD_AT), total, folded: true, key: `show all ${total} lines` };
}

export interface RunWords {
  head: string;
  /** the state line */
  state: string;
  next: string | null;
  /** the row's key: Decide in the stack (carded) */
  key: 'decide' | null;
  tone: 'fail' | 'quiet' | null;
  /** the spinner and clock */
  live: boolean;
  /** the data fold (ran, or a refused tool's own text) */
  data: DataFold | null;
  /** the policy word (ran only) */
  policy: string | null;
  /** C6'b2-2: the Send this one key: shown, in flight, or absent */
  sendKey: 'idle' | 'busy' | null;
  /** C6'b2-2: a refused send: "not sent: … · next: …" */
  sendNote: string | null;
  /** C6'b2-2: the first-use question (busy: the press in flight), and a refused choice in words */
  question: { text: string; busy: 'send' | 'ask' | null } | null;
  questionNote: string | null;
}

export const RUN_COPY = Object.freeze({
  head: (tool: string, server: string): string => `you ran ${tool} on ${server}`,
  running: 'running…',
  ran: 'ran',
  error: '✕ the tool returned an error',
  carded: 'waiting for your card',
  decide: 'Decide in the stack',
  reading: 'allowed · reading the result…',
  denied: 'you denied it; nothing ran',
  gone: `held ${RESULT_HELD_MIN} min; it’s gone`,
  goneNext: 'run it again',
  dataTag: 'data',
  history: 'its result is shown only when it runs on this page',
});

/** A run row in words. */
export function runWords(r: RunView): RunWords {
  const head = RUN_COPY.head(r.tool, r.server);
  const base = { head, next: null, key: null, tone: null, live: false, data: null, policy: null, sendKey: null, sendNote: null, question: null, questionNote: null } as const;
  switch (r.phase) {
    case 'running':
      return { ...base, state: RUN_COPY.running, live: true };
    case 'reading':
      return { ...base, state: RUN_COPY.reading, live: true };
    case 'carded':
      return { ...base, state: RUN_COPY.carded, key: 'decide' };
    case 'ran':
      return {
        ...base,
        state: r.isError ? RUN_COPY.error : RUN_COPY.ran,
        tone: r.isError ? 'fail' : null,
        data: dataFoldOf(r.content ?? '', r.open),
        policy: policyLine(r),
        sendKey: r.send === 'sending' ? 'busy' : canSend(r) ? 'idle' : null,
        sendNote: r.send === 'refused' && r.sendNote ? `not sent: ${r.sendNote.text}${r.sendNote.next ? ` · next: ${r.sendNote.next}` : ''}` : null,
        question: askedOf(r) ? { text: ASK_COPY.question(r.tool), busy: r.choosing } : null,
        questionNote: askedOf(r) ? r.chooseNote : null,
      };
    case 'denied':
      return { ...base, state: RUN_COPY.denied, tone: 'quiet' };
    case 'gone':
      return { ...base, state: RUN_COPY.gone, next: RUN_COPY.goneNext, tone: 'quiet' };
    default:
      return { ...base, state: `not run: ${r.refusal?.text ?? 'Gnomon refused it'}`, next: r.refusal?.next ?? null, tone: 'fail', data: r.content ? dataFoldOf(r.content, r.open) : null };
  }
}

/* ── taint (C6'b2-2, founder: the drawer and one transcript note, not the header) ─────────────────────────────────── */

/**
 * The injection pause in words (Mika): the session took in a sent tool result or skill text, so a destructive Always rule
 * no longer passes a MODEL call (it takes the card); the human's "/" runs are not affected. One transcript system row
 * where it first happened (the session's first kernel tool.result.sent or skill.run{decision:'ran'} row), and the
 * Tools drawer's line (capabilities.tainted).
 */
export const TAINT_LINE = 'Always rules for tools that can’t be undone are paused for the model in this session: it has read tool results or skill text. Your / runs are not affected.';

/** Is this kernel row the kind that taints its session (a sent tool result, a skill's text)? */
export function taintsSession(row: { kind: string; payload?: unknown; principal?: string }): boolean {
  if (typeof row.principal !== 'string' || !/^p:[0-9a-z]{8}\/kernel$/.test(row.principal)) return false;
  if (row.kind === 'tool.result.sent') return true;
  return row.kind === 'skill.run' && isObj(row.payload) && row.payload.decision === 'ran';
}

/* ── history: the kernel's row of a run this page did not start (or before a reload) ─────────────────────────────── */

/** A tool.brokered{author:'human'} row as a run row's words (no result: it is never kept), or null for any other row. */
export function runRowOf(row: { kind: string; payload?: unknown }): { tool: string | null; server: string; words: RunWords } | null {
  const p = isObj(row.payload) ? row.payload : null;
  if (row.kind !== 'tool.brokered' || !p || p.author !== 'human' || typeof p.server !== 'string') return null;
  const tool = typeof p.tool === 'string' ? displayText(p.tool).slice(0, 64) : null;
  const server = displayText(p.server).slice(0, 64);
  const d = typeof p.decision === 'string' ? p.decision : null;
  const head = RUN_COPY.head(tool ?? 'a tool', server);
  const base = { head, next: null, key: null, live: false, data: null, policy: null, sendKey: null, sendNote: null, question: null, questionNote: null } as const;
  if (d === 'ran' || d === 'approved') return { tool, server, words: { ...base, state: p.isError === true ? `${RUN_COPY.error} · ${RUN_COPY.history}` : `${RUN_COPY.ran} · ${RUN_COPY.history}`, tone: p.isError === true ? 'fail' : null } };
  if (d === 'denied') return { tool, server, words: { ...base, state: RUN_COPY.denied, tone: 'quiet' } };
  // a busy row carries no text: the history cannot tell the minute limit from a waiting card, so it says neither
  const w = d === 'busy' ? { text: 'too many at once', next: null } : runRefusalWords(d, { server });
  return { tool, server, words: { ...base, state: `not run: ${w.text}`, next: w.next, tone: 'fail' } };
}

/* ── a skill run's replay ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The skill a replayed human message is, when it is a "/" skill run's text (the kernel's template, which starts "The
 * human ran repo skill <name> (from .claude/skills/…", or a Claude session's native "/project:<name> …"), else null.
 * The transcript shows it as "you ran skill /<name>" (Mika: a run posts as your turn), never the skill's body.
 */
export function skillReplayName(text: string): string | null {
  const m = /^The human ran repo skill ([a-z0-9][a-z0-9-]{0,63}) \(from \.claude\/skills\//.exec(text) ?? /^\/project:([a-z0-9][a-z0-9-]{0,63})(?:\s|$)/.exec(text);
  return m ? m[1]! : null;
}
