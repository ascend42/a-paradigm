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
 *             word: send "goes with your next message" · ask or not chosen "kept here; not sent".
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
}

export function startRun(o: { key: string; hsid: string; tool: string; server: string; toolId: string; cls: ToolClass; policy: 'send' | 'ask' | null; at: string }): RunView {
  return { ...o, phase: 'running', runId: null, cardId: null, content: null, isError: false, refusal: null, read: false, open: false };
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
  | { type: 'fold'; open: boolean };

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
    case 'result-failed':
      if (r.phase !== 'reading') return r;
      if (!e.network && e.reason === 'not-found') return { ...r, phase: 'gone' };
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

/** The policy word under a ran row (b2-1: the word only; the first-use question and Send this one are b2-2). */
export function policyWord(policy: 'send' | 'ask' | null): string {
  return policy === 'send' ? 'goes with your next message' : 'kept here; not sent';
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
  const base = { head, next: null, key: null, tone: null, live: false, data: null, policy: null } as const;
  switch (r.phase) {
    case 'running':
      return { ...base, state: RUN_COPY.running, live: true };
    case 'reading':
      return { ...base, state: RUN_COPY.reading, live: true };
    case 'carded':
      return { ...base, state: RUN_COPY.carded, key: 'decide' };
    case 'ran':
      return { ...base, state: r.isError ? RUN_COPY.error : RUN_COPY.ran, tone: r.isError ? 'fail' : null, data: dataFoldOf(r.content ?? '', r.open), policy: policyWord(r.policy) };
    case 'denied':
      return { ...base, state: RUN_COPY.denied, tone: 'quiet' };
    case 'gone':
      return { ...base, state: RUN_COPY.gone, next: RUN_COPY.goneNext, tone: 'quiet' };
    default:
      return { ...base, state: `not run: ${r.refusal?.text ?? 'Gnomon refused it'}`, next: r.refusal?.next ?? null, tone: 'fail', data: r.content ? dataFoldOf(r.content, r.open) : null };
  }
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
  const base = { head, next: null, key: null, live: false, data: null, policy: null } as const;
  if (d === 'ran' || d === 'approved') return { tool, server, words: { ...base, state: p.isError === true ? `${RUN_COPY.error} · ${RUN_COPY.history}` : `${RUN_COPY.ran} · ${RUN_COPY.history}`, tone: p.isError === true ? 'fail' : null } };
  if (d === 'denied') return { tool, server, words: { ...base, state: RUN_COPY.denied, tone: 'quiet' } };
  // a busy row carries no text: the history cannot tell the minute limit from a waiting card, so it says neither
  const w = d === 'busy' ? { text: 'too many at once', next: null } : runRefusalWords(d, { server });
  return { tool, server, words: { ...base, state: `not run: ${w.text}`, next: w.next, tone: 'fail' } };
}
