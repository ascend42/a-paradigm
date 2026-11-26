/**
 * @symbol #gui-board-turn
 *
 * The turn strip under an open board (boards S1.3 pass P4b-2 item 1; design component board-leaf.turn_strip, a
 * `turn-strip` variant of transcript-row; Luna's rulings of 2026-11-24 and her final rulings on Mika's review). PURE.
 *
 * The open board covers the chat, so the latest turn is said here, in at most TWO one-line rows between the leaf's tab
 * and the pinned cards: the you row (24px) and the turn row (28px: the working key while the turn runs, the reply
 * line once it ends, a refused send's line, or `nothing sent yet`; `show chat` sits at its right end).
 *
 * RULES.
 *  - Never a stale reply: everything the turn row says comes from items AFTER the latest message.
 *  - Live choices, offer slips, host slips and run rows are never copied; the turn row says ` · needs you` (a live
 *    choice waits on the person) or ` · more in the chat` instead.
 *  - The end words are the result line's own (store.ts STOP_LABEL / CLAUDE_RESULT_LABEL), never tokens or cost.
 *  - A refused send shows `refusal.message` (never the wire code), on the turn row, alone.
 *  - Two rows when the board's room measured WITHOUT the strip is 300px or more, else the turn row alone (the you
 *    row goes first). Measured without the strip, so the switch cannot flicker.
 *  - A tight turn row drops the reply (with its separator), then the agent's name, then ` · more in the chat`, then
 *    ` on the board` of the drew tail, then `stopped: ` of the limit words; the end words' own limit, the count, a
 *    failed end and ` · needs you` are never dropped (the UI measures; this module orders).
 *  - S1.4 P4b (design turn_strip.luna_s14.drew): once the turn has ended, ` · drew <n> on the board` when tool rows on
 *    the boards name this turn in their causes, n counted FROM THE ROWS (core/dim-store.ts turnMarks), never from
 *    the reply; ` · changed <n> on the board` when it added nothing. Order: the end words, drew, needs you or more.
 */
import { replyChoices } from './choices.js';
import { hhmm } from './loops.js';
import { CLAUDE_RESULT_LABEL, STOP_LABEL, type ChatItem, type FoldedItem } from './store.js';

/** Every word the strip says (one wording per fact: the chat's, the Workshop's, KEEP_COPY's). */
export const TURN_COPY = Object.freeze({
  region: 'Latest turn',
  you: 'you',
  sep: ' · ',
  waiting: 'waiting',
  claude: 'Claude',
  local: 'local model',
  noAnswer: 'no answer',
  needs: 'needs you',
  more: 'more in the chat',
  nothingYet: 'nothing sent yet',
  showChat: 'show chat',
  showChatTitle: 'Show the chat · folds the board; ⌥B reopens it',
  /** KEEP_COPY.wordsHeld's fact, one wording (Luna final 4) */
  keptTitle: 'Kept open · your words are kept on this page only',
  /** a refusal is led by ✕ (Luna final 3: only a refusal) */
  refusedMark: '✕',
  /** the chat's own words for a send the kernel never answered: not known to have failed, so no ✕ */
  notSent: 'may not have been sent: the connection to the kernel failed',
  /** the strip's working key never unfolds here: its name says where its steps open (Mika 3) */
  workName: (what: string): string => `${what} · show its steps in the chat`,
  /** S1.4 P4b: the drew tail; ' on the board' is its own drop level (luna_s14.drew_tight) */
  drew: (n: number): string => `drew ${n}`,
  changed: (n: number): string => `changed ${n}`,
  onBoard: ' on the board',
  stopped: 'stopped: ',
});

/** Two rows at this much board room or more, measured without the strip. */
export const TURN_ROOM_TWO = 300;

export type TurnEndTone = 'warn' | 'fail' | 'quiet';

export interface LatestTurn {
  /** no message in this transcript yet: the turn row reads `nothing sent yet` */
  none: boolean;
  /** the latest message (one line), its hh:mm, and whether it waits behind a running turn */
  you: { text: string; at: string; waiting: boolean } | null;
  /** the strip's line of a refused send (refusal.message led by ✕, or the not-sent words): the strip is that one row */
  refused: string | null;
  /** the running turn's working item (also while the latest message waits behind it) */
  working: FoldedItem | null;
  /** the turn's latest assistant line (one line), or null */
  reply: string | null;
  /** the turn ended: its how-it-ended words (null for a normal end) and their tone */
  ended: { words: string | null; tone: TurnEndTone } | null;
  /** what the turn holds that the strip never copies */
  more: 'needs' | 'more' | null;
  /** S1.4 P4b: what the latest ended turn did on the boards, from rows (DimSessions.drewFor), or null */
  drew?: { added: number; changed: number; removed: number } | null;
}

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();
const END_WORDS: ReadonlySet<string> = new Set([...Object.values(STOP_LABEL), ...Object.values(CLAUDE_RESULT_LABEL)]);

/** One of the result line's own labels (step limit with its number included), not a reason carried from the run. */
export const knownEnd = (words: string): boolean => END_WORDS.has(words) || /^stopped: step limit( \d+)?$/.test(words);

/** A result line's how-it-ended words (its first part), or null when the run ended normally. */
export function endWordsOf(result: Pick<ChatItem, 'text' | 'tone'>): { words: string | null; tone: TurnEndTone } {
  const first = result.text.split(' · ')[0] ?? '';
  const words = END_WORDS.has(first) || /^stopped: /.test(first) ? first : null;
  return { words, tone: result.tone === 'fail' ? 'fail' : result.tone === 'warn' ? 'warn' : 'quiet' };
}

/**
 * The strip's line of a refused send, from what the chat row was built from: a voice refusal's first line (it leads
 * with ✕ already), else `✕ <refusal.message>` (never the code), else the not-sent words of a send never answered.
 */
export function refusalBrief(o: { voice: string | null; message: string | null }): string {
  if (o.voice) return oneLine(o.voice.split('\n')[0] ?? '');
  if (o.message !== null) {
    const m = oneLine(o.message.split('\n')[0] ?? '');
    return m.startsWith(TURN_COPY.refusedMark) ? m : `${TURN_COPY.refusedMark} ${m}`;
  }
  return TURN_COPY.notSent;
}

/**
 * The latest turn of the focused transcript (the chat's NON-raw items, folded as the chat folds them).
 * `liveChoice`: the item key of the reply whose choices are live (core/choices.ts liveChoiceKey);
 * `slipped`: the item keys that carry an offer slip or a host slip.
 */
export function latestTurn(items: readonly FoldedItem[], o: { liveChoice?: string | null; slipped?: ReadonlySet<string> } = {}): LatestTurn {
  let u = -1;
  for (let i = items.length - 1; i >= 0; i--)
    if (items[i]!.role === 'user') {
      u = i;
      break;
    }
  const w = items.findIndex((x) => x.role === 'working');
  const working = w >= 0 ? items[w]! : null;
  const out: LatestTurn = { none: false, you: null, refused: null, working, reply: null, ended: null, more: null };
  if (u < 0) return { ...out, none: working === null };
  const msg = items[u]!;
  const after = items.slice(u + 1);
  // a refused send is no turn: the refusal is the strip's one row (review M1: its line follows its echo)
  const ref = after.find((x) => x.role === 'error' && x.brief !== undefined);
  if (ref) return { ...out, working: null, refused: ref.brief! };
  // Mika 1 (review of PR #120): local time, as the chat rows say it (never the UTC slice)
  out.you = { text: oneLine(msg.text), at: hhmm(msg.at), waiting: working !== null && w < u };
  if (out.you.waiting) return out;
  let reply: FoldedItem | null = null;
  let result: FoldedItem | null = null;
  for (const it of after) {
    if (it.role === 'assistant') reply = it;
    if (it.role === 'result') result = it;
  }
  // a reply's choices are never copied: the strip reads the reply without its option lines (core/choices.ts)
  out.reply = reply ? oneLine(replyChoices(reply.text, reply.said ?? null)?.body ?? reply.text) || null : null;
  if (result) out.ended = endWordsOf(result);
  if (o.liveChoice && after.some((x) => x.key === o.liveChoice && x.role === 'assistant')) out.more = 'needs';
  else if (after.some((x) => x.role === 'run' || (o.slipped?.has(x.key) ?? false))) out.more = 'more';
  return out;
}

/**
 * One span of a strip row. `drop`: the tight-row level that hides it (1 reply, 2 name, 3 more); none is never
 * dropped. `sub`: a part of a tail's own words with a later level of its own (4 ' on the board', 5 'stopped: ',
 * which leads the tail's words).
 */
export interface TurnPart {
  cls: 'who' | 'sep' | 'said' | 't' | 'tail' | 'none';
  text: string;
  /** dir=auto (an isolate) on the person's and the model's words */
  bidi?: boolean;
  tone?: 'warn' | 'fail' | 'quiet' | 'needs' | 'more' | 'drew';
  /** the tail's own leading ' · ' (hidden with the name when the name drops) */
  lead?: boolean;
  /** the first tail of the row */
  first?: boolean;
  drop?: 1 | 2 | 3;
  sub?: { text: string; drop: 4 | 5; lead: boolean };
}

export interface TurnStripRow {
  kind: 'you' | 'turn';
  /** the you row: a refusal; the turn row: the refused line in --fail */
  refused?: boolean;
  parts: TurnPart[];
  /** the turn row while a turn runs: the working key (its words and clock are the page's, ticked) */
  working?: FoldedItem;
}

/** How many rows the board's room (measured without the strip) leaves: 2 at TURN_ROOM_TWO or more, else 1. */
export const turnRowsFor = (room: number): 1 | 2 => (room >= TURN_ROOM_TWO ? 2 : 1);

/**
 * The strip's rows. `agent`: who answers in this session (`Claude` or `local model`). `room`: the board's room in
 * px measured without the strip. The turn row is always there (the strip never hides); the you row only with room
 * for two, a message to show, and no refusal.
 */
export function turnStripRows(t: LatestTurn, agent: 'Claude' | 'local model', room: number): TurnStripRow[] {
  const C = TURN_COPY;
  if (t.refused !== null) return [{ kind: 'turn', refused: true, parts: [{ cls: 'said', text: t.refused, bidi: true }] }];
  const rows: TurnStripRow[] = [];
  if (t.you && turnRowsFor(room) === 2) {
    const time = t.you.waiting ? C.waiting : t.you.at;
    rows.push({ kind: 'you', parts: [{ cls: 'who', text: C.you }, { cls: 'sep', text: C.sep }, { cls: 'said', text: t.you.text, bidi: true }, ...(time ? [{ cls: 'sep' as const, text: C.sep }, { cls: 't' as const, text: time }] : [])] });
  }
  if (t.none) return [...rows, { kind: 'turn', parts: [{ cls: 'none', text: C.nothingYet }] }];
  if (t.working) return [...rows, { kind: 'turn', parts: [], working: t.working }];
  // sent and nothing back yet (the turn has not started): 'waiting' (Mika 2, review of PR #120: Luna's word for a
  // message with no answer yet; her confirmation is pending), quiet, left of show chat
  if (!t.ended && t.reply === null) return [...rows, { kind: 'turn', parts: [{ cls: 'none', text: C.waiting }] }];
  const parts: TurnPart[] = [{ cls: 'who', text: agent, drop: 2 }, { cls: 'sep', text: C.sep, drop: 1 }, { cls: 'said', text: t.reply ?? C.noAnswer, bidi: t.reply !== null, drop: 1 }];
  const tails: TurnPart[] = [];
  if (t.ended?.words) {
    const w = t.ended.words;
    // the fifth level takes 'stopped: ' off a limit's words; the tone and the limit's own words still say it ended
    const cut = w.startsWith(C.stopped) && knownEnd(w);
    tails.push({ cls: 'tail', text: cut ? w.slice(C.stopped.length) : w, tone: t.ended.tone, ...(cut ? { sub: { text: C.stopped, drop: 5 as const, lead: true } } : {}), ...(knownEnd(w) ? {} : { bidi: true }) });
  }
  const d = t.ended ? t.drew : null;
  if (d && (d.added > 0 || d.changed + d.removed > 0)) tails.push({ cls: 'tail', text: d.added > 0 ? C.drew(d.added) : C.changed(d.changed + d.removed), tone: 'drew', sub: { text: C.onBoard, drop: 4, lead: false } });
  if (t.more === 'needs') tails.push({ cls: 'tail', text: C.needs, tone: 'needs' });
  else if (t.more === 'more') tails.push({ cls: 'tail', text: C.more, tone: 'more', drop: 3 });
  tails.forEach((x, i) => {
    x.lead = true;
    if (i === 0) x.first = true;
  });
  return [...rows, { kind: 'turn', parts: [...parts, ...tails] }];
}

/** The parts a tight row still shows at a drop level (0 shows all). The name's going also takes the first tail's lead. */
export function partsAt(parts: readonly TurnPart[], level: 0 | 1 | 2 | 3 | 4 | 5): Array<TurnPart & { noLead?: boolean }> {
  const kept = parts.filter((p) => p.drop === undefined || p.drop > level).map((p) => (p.sub && p.sub.drop <= level ? (({ sub: _s, ...rest }) => rest)(p) : p));
  const named = kept.some((p) => p.cls === 'who');
  return kept.map((p, i) => (p.cls === 'tail' && p.lead && !named && kept.findIndex((x) => x.cls === 'tail') === i ? { ...p, noLead: true } : p));
}

/** The plain text a row reads at a drop level (tests and the accessible check). */
export function rowText(parts: readonly TurnPart[], level: 0 | 1 | 2 | 3 | 4 | 5 = 0): string {
  return partsAt(parts, level)
    .map((p) => (p.cls === 'tail' ? `${p.lead && !p.noLead ? TURN_COPY.sep : ''}${p.sub?.lead ? p.sub.text : ''}${p.text}${p.sub && !p.sub.lead ? p.sub.text : ''}` : p.text))
    .join('');
}

/**
 * Esc in the composer folds an open board (Luna ruling 4), after the slash menu, dictation grace and stop-speaking:
 * never on a held key, an IME composition, an Esc someone already took, a modifier, or a focused card.
 */
export function escFoldsFromComposer(e: { key: string; repeat: boolean; isComposing: boolean; defaultPrevented: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }, o: { inComposer: boolean; cardFocused: boolean }): boolean {
  return e.key === 'Escape' && o.inComposer && !o.cardFocused && !e.repeat && !e.isComposing && !e.defaultPrevented && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
}
