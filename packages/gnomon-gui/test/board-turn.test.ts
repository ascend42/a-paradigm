/**
 * #gui-board-turn (boards S1.3 P4b-2 item 1): the turn strip under an open board. CI-run: the latest turn from the
 * chat's own items (core/board-turn.ts), the room rule and the drop order, a text-only renderer (ui/board-turn.ts over
 * a fake document), and source fences on the Esc branch, the dock's trust checks and the strip's place in the page.
 * The real-input behaviour (a real Esc, a real press, the focus walk) is driven in test/board-app.test.ts (local Chrome).
 */
// the fixtures' times are UTC; the strip says local time (Mika 1): this file reads them in UTC unless a test says otherwise
process.env.TZ = 'UTC';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { endWordsOf, escFoldsFromComposer, latestTurn, partsAt, refusalBrief, rowText, TURN_COPY, TURN_ROOM_TWO, turnRowsFor, turnStripRows, type LatestTurn } from '../src/core/board-turn.js';
import { liveChoiceKey } from '../src/core/choices.js';
import { chatItems, foldActivity, GuiStore, wireRowOf, type FoldedItem, type Row } from '../src/core/store.js';
import type { MiniDoc } from '../src/core/render.js';
import { renderTurnRow, stripSig, stripWorkingEl } from '../src/ui/board-turn.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(path.join(ROOT, 'src/ui/app.ts'), 'utf8');
const DOCK = readFileSync(path.join(ROOT, 'src/ui/board-dock.ts'), 'utf8');
const HTML = readFileSync(path.join(ROOT, 'static/index.html'), 'utf8');
const CSS = readFileSync(path.join(ROOT, 'static/styles.css'), 'utf8');

const H = 'hsid:v1:01M5E2G1TRBTMST63ZAY9V0W7D';
const at = (hms: string): string => `2026-11-24T${hms}Z`;
const ev = (seq: number, hms: string, line: Record<string, unknown>, type: string): Row => ({ seq, kind: 'turn.event', view: 'full', at: at(hms), session: H, payload: { hsid: H, type, seq, line: JSON.stringify(line) } });
const row = (seq: number, kind: string, hms: string, payload: Record<string, unknown> = {}): Row => ({ seq, kind, view: 'full', at: at(hms), session: H, payload: { hsid: H, ...payload } });
const echo = (seq: number, hms: string, text: string, more: Partial<Row> = {}): Row => ({ seq, kind: 'composer', connId: 'local', session: H, payload: text, at: at(hms), ...more });
const say = (text: string) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const replay = (text: string) => ({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
const done = (seq: number, hms: string, p: Record<string, unknown> = { cost: 0.01, isError: false, subtype: 'success', usage: { tokens: 8 } }): Row => row(seq, 'turn.result', hms, p);
const items = (rows: Row[], o: { live?: boolean; raw?: boolean } = {}): FoldedItem[] => {
  const base = chatItems(rows, { live: o.live ?? true, raw: o.raw ?? false }).items;
  return o.raw ? base : foldActivity(base);
};
const turnOf = (rows: Row[], o: { live?: boolean; slipped?: Set<string> } = {}): LatestTurn => {
  const its = items(rows, o);
  return latestTurn(its, { liveChoice: liveChoiceKey(its), ...(o.slipped ? { slipped: o.slipped } : {}) });
};

/** One complete turn, then the start of the next. */
const MSG = 'Totals are off by a cent on 3-line orders. Find out why and fix it, with a test.';
const firstTurn = (): Row[] => [
  echo(10.5, '14:05:00', MSG),
  row(11, 'turn.sent', '14:05:00.100', { turn: `turn:${H}/1` }),
  ev(12, '14:05:02', replay(MSG), 'user'),
  ev(13, '14:05:30', say('Rounding ran per line before the sum.\nI moved it to the order total.'), 'assistant'),
  done(14, '14:05:31'),
];

describe('#gui-board-turn latestTurn: the latest turn from the chat’s own items', () => {
  it('nothing sent yet: an empty transcript, and one with only bookkeeping', () => {
    expect(latestTurn([])).toMatchObject({ none: true, you: null, working: null, reply: null, ended: null, more: null, refused: null });
    expect(turnOf([row(1, 'session.open', '14:00:00', { cwd: '/r' })])).toMatchObject({ none: true, you: null });
  });

  it('no user row: a reply with no message above it is never shown (nothing sent yet), a running turn is', () => {
    const its: FoldedItem[] = [{ key: '5', seq: 5, role: 'assistant', text: 'hello from an earlier page', at: at('13:00:00') }];
    expect(latestTurn(its)).toMatchObject({ none: true, reply: null, you: null });
    const w: FoldedItem = { key: 'work:6', seq: 6, role: 'working', text: 'working…', at: at('13:00:01'), live: { since: at('13:00:01') } };
    expect(latestTurn([...its, w])).toMatchObject({ none: false, working: w, reply: null });
  });

  it('sent: the message, one line, with its hh:mm; nothing back yet', () => {
    const t = turnOf([echo(10.5, '14:05:00', 'line one\n\n  line two')]);
    expect(t).toMatchObject({ none: false, you: { text: 'line one line two', at: '14:05', waiting: false }, working: null, reply: null, ended: null });
    // Mika 2: between the send and turn.sent the turn row says waiting, quiet, beside show chat
    expect(turnStripRows(t, 'Claude', 485).map((r) => rowText(r.parts))).toEqual(['you · line one line two · 14:05', 'waiting']);
    expect(turnStripRows(t, 'Claude', 485)[1]!.parts).toEqual([{ cls: 'none', text: 'waiting' }]);
  });

  it('running: the working item, and a reply that arrived mid-turn is kept but the turn has not ended', () => {
    const rows = [...firstTurn().slice(0, 3), ev(13, '14:05:30', say('Looking at totals.ts first.'), 'assistant')];
    const t = turnOf(rows);
    expect(t.working?.role).toBe('working');
    expect(t.reply).toBe('Looking at totals.ts first.');
    expect(t.ended).toBeNull();
    expect(t.you).toMatchObject({ text: MSG, waiting: false });
    // the strip shows the working key while the turn runs, never the half-written reply
    const rs = turnStripRows(t, 'Claude', 485);
    expect(rs.map((r) => r.kind)).toEqual(['you', 'turn']);
    expect(rs[1]!.working).toBe(t.working);
    expect(rs[1]!.parts).toEqual([]);
  });

  it('waiting: a second message queued behind the running turn says waiting; the turn row is the running turn', () => {
    const rows = [
      echo(10.5, '14:05:00', MSG),
      row(11, 'turn.sent', '14:05:00.100', { turn: `turn:${H}/1` }),
      ev(12, '14:05:02', replay(MSG), 'user'),
      echo(15.5, '14:06:00', 'Also check the refund path'),
      row(16, 'turn.sent', '14:06:00.100', { turn: `turn:${H}/2` }),
    ];
    const t = turnOf(rows);
    expect(t.you).toMatchObject({ text: 'Also check the refund path', waiting: true });
    expect(t.working?.role).toBe('working');
    const you = turnStripRows(t, 'Claude', 485)[0]!;
    expect(rowText(you.parts)).toBe('you · Also check the refund path · waiting');
  });

  it('ended done: the latest assistant line of THIS turn, one line; a normal end adds nothing', () => {
    const t = turnOf(firstTurn());
    expect(t).toMatchObject({ reply: 'Rounding ran per line before the sum. I moved it to the order total.', ended: { words: null }, working: null, more: null });
    const turn = turnStripRows(t, 'Claude', 485)[1]!;
    expect(rowText(turn.parts)).toBe('Claude · Rounding ran per line before the sum. I moved it to the order total.');
  });

  it('no stale reply: after a new message the turn row never shows the turn before it', () => {
    const t = turnOf([...firstTurn(), echo(20.5, '14:07:00', 'and the refunds?')], { live: false });
    expect(t).toMatchObject({ you: { text: 'and the refunds?' }, reply: null, ended: null, working: null });
    // sent, nothing back: the turn row says waiting (Mika 2), never the turn before
    expect(turnStripRows(t, 'Claude', 485)[1]!.parts).toEqual([{ cls: 'none', text: 'waiting' }]);
  });

  it('every end word, from the result line’s own labels, in its tone; tokens and cost never', () => {
    const cases: Array<[Record<string, unknown>, string | null, string]> = [
      [{ subtype: 'error_max_turns', is_error: true }, 'stopped: turn limit', 'warn'],
      [{ subtype: 'error_max_budget_usd', is_error: true }, 'stopped: budget limit', 'warn'],
      [{ subtype: 'error_during_execution', is_error: true }, 'error', 'fail'],
      [{ subtype: 'error_something_new' }, 'error', 'fail'],
      [{ stopReason: 'max_steps', maxSteps: 20, replyBytes: 10, runUsage: { tokens: 5 } }, 'stopped: step limit 20', 'warn'],
      [{ stopReason: 'max_steps', replyBytes: 10 }, 'stopped: step limit', 'warn'],
      [{ stopReason: 'aborted', replyBytes: 0 }, 'aborted', 'quiet'],
      [{ stopReason: 'error', isError: true, error: 'boom' }, 'error', 'fail'],
      [{ stopReason: 'length', replyBytes: 3 }, 'stopped: length', 'quiet'],
      [{ subtype: 'success', cost: 0.5, usage: { tokens: 100 } }, null, 'quiet'],
      [{ stopReason: 'stop', replyBytes: 12, runUsage: { tokens: 9 } }, null, 'quiet'],
    ];
    for (const [p, words, tone] of cases) {
      const t = turnOf([...firstTurn().slice(0, 4), done(14, '14:05:31', p)]);
      expect(t.ended, JSON.stringify(p)).toEqual({ words, tone });
      const text = rowText(turnStripRows(t, 'Claude', 485)[1]!.parts);
      expect(text).not.toMatch(/\$|tokens/);
      if (words) expect(text.endsWith(` · ${words}`), text).toBe(true);
      else expect(text).toBe('Claude · Rounding ran per line before the sum. I moved it to the order total.');
    }
    expect(endWordsOf({ text: 'done · $0.0100 · 8 tokens', tone: undefined })).toEqual({ words: null, tone: 'quiet' });
  });

  it('an empty reply reads "<agent> · no answer" with its end words', () => {
    const t = turnOf([...firstTurn().slice(0, 3), done(14, '14:05:31', { subtype: 'error_during_execution', is_error: true })]);
    expect(rowText(turnStripRows(t, 'local model', 485)[1]!.parts)).toBe('local model · no answer · error');
  });

  it('refused: refusal.message led by ✕ on the turn row alone (no you row, no empty row, no code); a send never answered has no ✕', () => {
    const brief = refusalBrief({ voice: null, message: 'the session is not running\n(more)' });
    expect(brief).toBe('✕ the session is not running');
    const rows = [...firstTurn(), echo(20.5, '14:07:00', 'again?', { unsent: true }), { seq: 20.6, kind: 'send.refused', connId: 'local', session: H, payload: 'FORBIDDEN not-running  the session is not running\n  next: open it', brief }];
    const t = turnOf(rows);
    expect(t).toMatchObject({ refused: '✕ the session is not running', working: null, reply: null });
    const rs = turnStripRows(t, 'Claude', 485);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ kind: 'turn', refused: true });
    expect(rowText(rs[0]!.parts)).toBe('✕ the session is not running');
    expect(rowText(rs[0]!.parts)).not.toMatch(/FORBIDDEN|next:/);
    expect(refusalBrief({ voice: null, message: null })).toBe(TURN_COPY.notSent);
    expect(TURN_COPY.notSent.startsWith('✕')).toBe(false);
    expect(refusalBrief({ voice: '✕ not sent by voice · these words were not checked as you\n  next: press Enter to send it', message: 'x' })).toBe('✕ not sent by voice · these words were not checked as you');
    expect(refusalBrief({ voice: null, message: '✕ already marked' })).toBe('✕ already marked');
  });

  it('a refusal while an earlier turn runs: the strip is the refusal', () => {
    const rows = [...firstTurn().slice(0, 3), echo(20.5, '14:07:00', 'again?', { unsent: true }), { seq: 20.6, kind: 'send.refused', connId: 'local', session: H, payload: 'x', brief: '✕ busy' }];
    expect(turnOf(rows)).toMatchObject({ refused: '✕ busy', working: null });
  });

  it('needs you: the turn’s reply holds live choices; more: a run row or a slipped reply; never copied', () => {
    const ask = [...firstTurn().slice(0, 3), ev(13, '14:05:30', say('Which rounding should totals use?\n\nA  Banker’s rounding\nB  Half up'), 'assistant'), done(14, '14:05:31')];
    const t = turnOf(ask);
    expect(t.more).toBe('needs');
    const text = rowText(turnStripRows(t, 'Claude', 485)[1]!.parts);
    expect(text.endsWith(' · needs you')).toBe(true);
    expect(text).not.toMatch(/Half up|Banker/);
    expect(text).toBe('Claude · Which rounding should totals use? · needs you');
    const slipped = turnOf(firstTurn(), { slipped: new Set(['13']) });
    expect(slipped.more).toBe('more');
    expect(rowText(turnStripRows(slipped, 'Claude', 485)[1]!.parts).endsWith(' · more in the chat')).toBe(true);
    // a slip on an EARLIER turn's reply is not this turn's
    expect(turnOf([...firstTurn(), echo(20.5, '14:07:00', 'next')], { live: false, slipped: new Set(['13']) }).more).toBeNull();
    const run = [...firstTurn(), { seq: 15.5, kind: 'slash-run', connId: 'local', session: H, payload: { key: 'k', server: 's', tool: 't' }, at: at('14:06:00') } as Row];
    expect(turnOf(run).more).toBe('more');
  });

  it('raw mode: the strip reads the chat’s own items, never the raw rows (raw rows hold no turn)', () => {
    const raw = items(firstTurn(), { raw: true });
    // the raw view keeps this page's own echo as a message, and every kernel row as a raw line: no reply, no end
    expect(raw.filter((x) => x.role !== 'raw').map((x) => x.role)).toEqual(['user']);
    expect(latestTurn(raw)).toMatchObject({ reply: null, ended: null });
    expect(turnOf(firstTurn())).toMatchObject({ reply: expect.stringMatching(/^Rounding/), ended: { words: null } });
    // the page computes the strip from currentItems(false) while the raw view is on (memoized apart)
    expect(APP).toMatch(/const its: FoldedItem\[\] = rawMode \? currentItems\(false\)\.items : items;/);
    expect(APP).toMatch(/const m = own \? memo : chatMemo;/);
  });
});

describe('#gui-board-turn the room rule and the drop order', () => {
  it('two rows at 300px of board room measured without the strip, else the turn row alone (the you row goes first)', () => {
    expect(TURN_ROOM_TWO).toBe(300);
    expect(turnRowsFor(300)).toBe(2);
    expect(turnRowsFor(299)).toBe(1);
    const t = turnOf(firstTurn());
    expect(turnStripRows(t, 'Claude', 485).map((r) => r.kind)).toEqual(['you', 'turn']);
    expect(turnStripRows(t, 'Claude', 299).map((r) => r.kind)).toEqual(['turn']);
    // the strip never hides: nothing sent yet is a turn row too, at any room
    expect(turnStripRows(latestTurn([]), 'Claude', 0).map((r) => rowText(r.parts))).toEqual(['nothing sent yet']);
    expect(turnStripRows(latestTurn([]), 'Claude', 900).map((r) => r.kind)).toEqual(['turn']);
  });

  it('a tight row drops the reply (with its separator), then the name, then more; the end words and needs you never', () => {
    const worst: LatestTurn = { none: false, you: { text: MSG, at: '14:05', waiting: false }, refused: null, working: null, reply: 'Which rounding mode should the totals use?', ended: { words: 'stopped: step limit 20', tone: 'warn' }, more: 'needs' };
    const parts = turnStripRows(worst, 'local model', 485)[1]!.parts;
    expect([0, 1, 2, 3].map((l) => rowText(parts, l as 0 | 1 | 2 | 3))).toEqual([
      'local model · Which rounding mode should the totals use? · stopped: step limit 20 · needs you',
      'local model · stopped: step limit 20 · needs you',
      'stopped: step limit 20 · needs you',
      'stopped: step limit 20 · needs you',
    ]);
    const more = turnStripRows({ ...worst, ended: { words: null, tone: 'quiet' }, more: 'more' }, 'Claude', 485)[1]!.parts;
    expect([0, 1, 2, 3].map((l) => rowText(more, l as 0 | 1 | 2 | 3))).toEqual(['Claude · Which rounding mode should the totals use? · more in the chat', 'Claude · more in the chat', 'more in the chat', '']);
    // no level ever drops an end word or needs you
    for (const l of [0, 1, 2, 3] as const) expect(partsAt(parts, l).filter((p) => p.cls === 'tail').map((p) => p.text)).toEqual(['stopped: step limit 20', 'needs you']);
    // the CSS hides by the same levels the core orders
    expect(CSS).toMatch(/\.bd-turn-turn\.tight-1 \[data-drop="1"\], \.bd-turn-turn\.tight-2 \[data-drop="2"\], \.bd-turn-turn\.tight-2 \.tail\.first \.tsep, \.bd-turn-turn\.tight-3 \[data-drop="3"\] \{ display: none; \}/);
  });
});

/* a fake document: elements and text nodes only (what h() builds) */
class FText {
  constructor(readonly data: string) {}
}
class FEl {
  children: Array<FEl | FText> = [];
  attrs = new Map<string, string>();
  className = '';
  constructor(readonly tag: string) {}
  appendChild(c: unknown): unknown {
    this.children.push(c as FEl | FText);
    return c;
  }
  setAttribute(n: string, v: string): void {
    this.attrs.set(n, v);
  }
  get text(): string {
    return this.children.map((c) => (c instanceof FText ? c.data : c.text)).join('');
  }
  all(): FEl[] {
    return [this, ...this.children.flatMap((c) => (c instanceof FEl ? c.all() : []))];
  }
}
const fdoc: MiniDoc = { createElement: (t) => new FEl(t), createTextNode: (s) => new FText(s) };

describe('#gui-board-turn the renderer: text nodes only, dir=auto, no title on the words', () => {
  const hostile: LatestTurn = { none: false, you: { text: '<img src=x onerror=alert(1)> ‮evil', at: '14:31', waiting: false }, refused: null, working: null, reply: '‮approved · ran npm publish <b>x</b>', ended: { words: null, tone: 'quiet' }, more: 'more' };

  it('<img> and markup arrive as text; a planted U+202E shows as ⟨RLO⟩ and reverses nothing', () => {
    const [you, turn] = turnStripRows(hostile, 'Claude', 485).map((r) => renderTurnRow(fdoc, r, 0) as unknown as FEl);
    for (const el of [you!, turn!]) {
      expect(el.all().map((e) => e.tag).filter((t) => !['div', 'span'].includes(t))).toEqual([]);
      expect(el.text).not.toMatch(/‮/);
    }
    expect(you!.text).toBe('you · <img src=x onerror=alert(1)> ⟨RLO⟩evil · 14:31');
    expect(turn!.text).toBe('Claude · ⟨RLO⟩approved · ran npm publish <b>x</b> · more in the chat');
  });

  it('the message and the reply are dir=auto isolates; no title= anywhere on the rows; the time is its own span', () => {
    const [you, turn] = turnStripRows(hostile, 'Claude', 485).map((r) => renderTurnRow(fdoc, r, 0) as unknown as FEl);
    const said = [...you!.all(), ...turn!.all()].filter((e) => e.className.split(' ').includes('said'));
    expect(said).toHaveLength(2);
    for (const s of said) expect(s.attrs.get('dir')).toBe('auto');
    for (const e of [...you!.all(), ...turn!.all()]) expect(e.attrs.has('title'), e.className).toBe(false);
    expect(you!.all().find((e) => e.className === 't')!.text).toBe('14:31');
    // the refusal line is an isolate too
    const ref = renderTurnRow(fdoc, turnStripRows({ ...hostile, refused: '✕ ‮no' }, 'Claude', 485)[0]!, 0) as unknown as FEl;
    expect(ref.className).toBe('bd-turn-r bd-turn-turn refused');
    expect(ref.all().find((e) => e.className === 'said')!.attrs.get('dir')).toBe('auto');
    expect(ref.text).toBe('✕ ⟨RLO⟩no');
  });

  it('bidi: an RTL message keeps its words whole in the isolate (the order is the browser’s, the text is not changed)', () => {
    const rtl = 'תקן את העיגול בהזמנות של שלוש שורות';
    const you = renderTurnRow(fdoc, turnStripRows({ ...hostile, you: { text: rtl, at: '14:31', waiting: false } }, 'Claude', 485)[0]!, 0) as unknown as FEl;
    expect(you.text).toBe(`you · ${rtl} · 14:31`);
  });

  it('Probe A: a new step repaints the working key at once: rows that differ only in live.now give different signatures', () => {
    const w = (label: string, since = at('14:05:01')): FoldedItem => ({ key: 'work:9', seq: 9, role: 'working', text: 'working…', at: at('14:05:00'), live: { since: at('14:05:00'), now: { label, since, aria: label } } });
    const rows = (it: FoldedItem) => [{ kind: 'turn' as const, parts: [], working: it }];
    expect(stripSig(rows(w('Read · a.ts')))).not.toBe(stripSig(rows(w('Bash · npm test')))); 
    expect(stripSig(rows(w('Bash · npm test', at('14:05:01'))))).not.toBe(stripSig(rows(w('Bash · npm test', at('14:05:09')))));
    expect(stripSig(rows(w('Bash · npm test')))).toBe(stripSig(rows(w('Bash · npm test'))));
  });

  it('the strip’s working key: no caret, no aria-expanded; named "<what> · show its steps in the chat"', () => {
    const w: FoldedItem = { key: 'work:9', seq: 9, role: 'working', text: 'working…', at: at('14:05:00'), live: { since: at('14:05:00') } };
    const el = stripWorkingEl(fdoc, w, Date.parse(at('14:05:12'))) as unknown as FEl;
    expect(el.className).toBe('trow role-working');
    const key = el.all().find((e) => e.className === 'work-key')!;
    expect(key.attrs.has('aria-expanded')).toBe(false);
    expect(el.all().some((e) => e.className.includes('caret'))).toBe(false);
    expect(key.attrs.get('aria-label')).toBe('working… · show its steps in the chat');
    expect(key.attrs.get('title')).toBe('working…');
    expect(key.attrs.get('data-strip-work')).toBe('work:9');
    expect(el.text).toBe('working… · 12s');
  });
});

describe('#gui-board-turn Esc from the composer and the trust checks (source fences)', () => {
  it('escFoldsFromComposer: Escape in the composer only; never on repeat, IME composition, a taken Esc, a modifier or a focused card', () => {
    const base = { key: 'Escape', repeat: false, isComposing: false, defaultPrevented: false, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
    const o = { inComposer: true, cardFocused: false };
    expect(escFoldsFromComposer(base, o)).toBe(true);
    for (const k of ['repeat', 'isComposing', 'defaultPrevented', 'metaKey', 'ctrlKey', 'altKey', 'shiftKey'] as const) expect(escFoldsFromComposer({ ...base, [k]: true }, o), k).toBe(false);
    expect(escFoldsFromComposer({ ...base, key: 'Enter' }, o)).toBe(false);
    expect(escFoldsFromComposer(base, { inComposer: false, cardFocused: false })).toBe(false);
    expect(escFoldsFromComposer(base, { inComposer: true, cardFocused: true })).toBe(false);
  });

  it('the composer Esc branch comes after the slash menu, dictation grace and stop-speaking, and folds through the dock', () => {
    const doc = APP.slice(APP.indexOf("document.addEventListener('keydown', (e) => {"));
    const grace = doc.indexOf("} else if (e.key === 'Escape' && dict.grace) {");
    const speak = doc.indexOf('escStopsSpeaking({');
    const branch = doc.indexOf("} else if (escFoldsFromComposer(e, { inComposer: document.activeElement === $('composer-text'), cardFocused: cardHasFocus(document) }) && boardDock.escape(e)) {");
    const toast = doc.indexOf('toasts().dismissNewestFail()');
    expect(grace).toBeGreaterThan(0);
    expect(speak).toBeGreaterThan(grace);
    expect(branch).toBeGreaterThan(speak);
    expect(toast).toBeGreaterThan(branch);
    // the slash menu takes its Esc on the composer itself first (preventDefault + stopPropagation: defaultPrevented)
    expect(APP).toMatch(/\$\('composer-text'\)\.addEventListener\('keydown', \(e\) => \{\s*if \(slashMenu\?\.key\(e\)\) return;/);
    // the leaf's own Esc branch is unchanged: never from an editable field
    expect(doc).toMatch(/e\.key === 'Escape' && !editableFocus\(\) && !cardHasFocus\(document\) && \$\('palette'\)\.hidden && !e\.repeat && boardDock\.escape\(e\)/);
  });

  it('showChat and escape check isTrusted FIRST (before the held line is said); show chat has no palette or block-safe command', () => {
    const show = DOCK.slice(DOCK.indexOf('    showChat(event, then) {'));
    expect(show.indexOf("if (event.isTrusted !== true || !cur) return;")).toBeGreaterThan(0);
    expect(show.indexOf("if (event.isTrusted !== true || !cur) return;")).toBeLessThan(show.indexOf('sayHeld()'));
    const esc = DOCK.slice(DOCK.indexOf('    escape(event) {'));
    expect(esc.indexOf('if (event.isTrusted !== true) return true;')).toBeGreaterThan(0);
    expect(esc.indexOf('if (event.isTrusted !== true) return true;')).toBeLessThan(esc.indexOf('sayHeld()'));
    const commands = readFileSync(path.join(ROOT, 'src/core/commands.ts'), 'utf8');
    expect(commands).not.toMatch(/show[.-]?chat/i);
  });

  it('the strip sits between the feed and the pinned cards; it is no live region; its paint follows items = next', () => {
    const feed = HTML.indexOf('<div class="feed">');
    const jump = HTML.indexOf('<button id="jump-latest"');
    const strip = HTML.indexOf('<div id="board-turn" class="bd-turn" role="region" aria-label="Latest turn" hidden></div>');
    const pinned = HTML.indexOf('<div id="pinned"');
    const composer = HTML.indexOf('<form id="composer"');
    expect(feed).toBeGreaterThan(0);
    expect(strip).toBeGreaterThan(jump);
    expect(HTML.slice(jump, strip)).toMatch(/^<button[^\n]*\n<\/div>\n$/); // the feed closes right before it
    expect(pinned).toBeGreaterThan(strip);
    expect(composer).toBeGreaterThan(pinned);
    expect(HTML.slice(strip, pinned)).not.toMatch(/aria-live/);
    const paint = APP.slice(APP.indexOf('function paintTranscript(remeasure = false): void {'));
    expect(paint.indexOf('paintBoardTurn();')).toBeGreaterThan(paint.indexOf('items = next;'));
    // never overflow:hidden on the strip (show chat's focus ring sits outside the row)
    const rules = CSS.split('\n').filter((l) => /^\.bd-turn(-r|-you|-turn|-line)? \{/.test(l));
    expect(rules).toHaveLength(5);
    for (const r of rules) expect(r, r).not.toMatch(/overflow:\s*hidden/);
  });

  it('P4b-2 item 4: rows under an edge tab take the inset, and a tab class change re-lays the rows at the new row width', () => {
    expect(CSS).toMatch(/\.lp-tab-on, \.bd-tab-on \{ --edge-tab-inset: 14px; \}/);
    expect(CSS).toMatch(/\.lp-tab-on \.viewport > \.trow, \.bd-tab-on \.viewport > \.trow \{ right: var\(--edge-tab-inset\); \}/);
    expect(APP).toMatch(/new MutationObserver\(\(\) => \{[\s\S]{0,200}contains\('lp-tab-on'\)[\s\S]{0,80}contains\('bd-tab-on'\)[\s\S]{0,300}requestAnimationFrame\(relayout\);/);
    expect(APP).toMatch(/const relayout = \(\): void => \{\s*const w = rowWidth\(\);[\s\S]{0,400}paintTranscript\(true\);/);
  });

  it('Probe B: a refused send carries its strip line: refusalBrief over the voice line and refusal.message, on the send.refused local row', () => {
    expect(APP).toMatch(/const brief\s*=\s*refusalBrief\(\{\s*voice,\s*message:\s*err instanceof RpcError\s*\?\s*err\.refusal\.message\s*:\s*null\s*\}\);/);
    expect(APP).toMatch(/local\.push\(\{[^}]*\bkind:\s*'send\.refused'[^}]*\bpayload:\s*why\b[^}]*\bbrief\b[^}]*\}\)/);
    expect(APP).toMatch(/const voice\s*=\s*err instanceof RpcError\s*\?\s*voiceRefusalText\(err\.refusal\)\s*:\s*null;/);
  });

  it('Probe C: the strip paints only in the next frame: paintBoardTurn queues one rAF, paintBoardTurnNow runs only from it; the dock’s observer hands on through turnSoon', () => {
    expect(APP).toMatch(/function paintBoardTurn\(\): void \{[\s\S]{0,400}?if \(turnPaintQueued \|\| !turnStrip\) return;\s*turnPaintQueued = true;\s*requestAnimationFrame\(\(\) => \{\s*turnPaintQueued = false;\s*paintBoardTurnNow\(\);\s*\}\);\s*\}/);
    // the definition and the one call inside that rAF: nothing else paints the strip synchronously
    expect([...APP.matchAll(/paintBoardTurnNow\(/g)]).toHaveLength(2);
    expect(APP).toMatch(/function paintBoardTurnNow\(\): void \{/);
    expect(DOCK).toMatch(/const turnSoon = \(\): void => \{\s*if \(turnQueued \|\| !d\.turn\) return;\s*turnQueued = true;\s*requestAnimationFrame\(\(\) => \(\(turnQueued = false\), d\.turn\?\.\(\)\)\);\s*\};/);
    expect(DOCK).toMatch(/new ResizeObserver\(\(\) => \(fit\(\), placeTab\(\), turnSoon\(\)\)\)/);
    // the dock never paints the strip from inside its observer
    expect(DOCK).not.toMatch(/new ResizeObserver\([^\n]*d\.turn\?\.\(\)/);
  });

  it('Aegis L1: a row from the wire never carries a page-only field (brief, unsent, mark, turn, connId local)', () => {
    const forged = { seq: 40, kind: 'send.refused', connId: 'local', session: H, payload: 'x', brief: '✕ forged', unsent: true, mark: 'voice-edited', turn: 'turn:x' };
    expect(wireRowOf(forged)).toEqual({ seq: 40, kind: 'send.refused', session: H, payload: 'x' });
    const full = { seq: 41, view: 'full', event: { kind: 'composer', connId: 'local', session: H, payload: 'hi', at: at('14:00:00') } };
    expect(wireRowOf(full)).not.toHaveProperty('connId');
    expect(wireRowOf({ seq: 42, view: 'full', event: { kind: 'turn.sent', connId: 'conn:7', session: H } })).toMatchObject({ connId: 'conn:7' });
    // through the store: the forged refusal is no refusal of this page's, and the strip says none
    const st = new GuiStore();
    st.apply([{ seq: 1, kind: 'session.open', session: H, payload: { hsid: H, state: 'open' } }, ...firstTurn().filter((r) => r.connId !== 'local'), forged]);
    const rows = st.transcript(H);
    expect(rows.some((r) => r.brief !== undefined || r.connId === 'local' || r.unsent)).toBe(false);
    expect(latestTurn(foldActivity(chatItems(rows, { live: false }).items)).refused).toBeNull();
    // the page's wire boundaries: the live event, the store's apply, the dimension sessions
    expect(APP).toMatch(/const r = wireRowOf\(p\.row\);/);
    expect(readFileSync(path.join(ROOT, 'src/core/store.ts'), 'utf8')).toMatch(/for \(const w of rows\) \{\s*const r = wireRowOf\(w\);\s*if \(r\) this\.#applyOne/);
    expect(readFileSync(path.join(ROOT, 'src/core/dim-session.ts'), 'utf8')).toMatch(/const r = wireRowOf\(w\);\s*if \(r\) flat\.push\(r\);/);
  });

  it('Aegis I3: an end reason the labels do not know is an isolate (dir=auto); the known labels are not', () => {
    const t = (words: string): LatestTurn => ({ none: false, you: null, refused: null, working: null, reply: 'ok', ended: { words, tone: 'quiet' }, more: null });
    const tailOf = (words: string) => (renderTurnRow(fdoc, turnStripRows(t(words), 'Claude', 0)[0]!, 0) as unknown as FEl).all().find((e) => e.className.startsWith('tail'))!;
    expect(tailOf('stopped: אבג reason').attrs.get('dir')).toBe('auto');
    for (const w of ['stopped: turn limit', 'stopped: step limit 20', 'stopped: step limit', 'error', 'aborted', 'stopped: budget limit']) expect(tailOf(w).attrs.has('dir'), w).toBe(false);
  });

  it('Aegis L2: a second show-chat press while the first fold is on its way keeps the first one’s focus move', () => {
    const show = DOCK.slice(DOCK.indexOf('    showChat(event, then) {'));
    const trust = show.indexOf('if (event.isTrusted !== true || !cur) return;');
    const guard = show.indexOf('if (afterShow) return;');
    expect(trust).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(trust);
    expect(guard).toBeLessThan(show.indexOf('afterShow = then;'));
  });

  it('Mika 1: the you row and the chat rows say LOCAL time (hhmm), never the UTC slice', () => {
    const was = process.env.TZ;
    try {
      process.env.TZ = 'America/Los_Angeles';
      const t = turnOf([echo(10.5, '14:05:00', 'hello')]);
      expect(t.you?.at).toBe('06:05');
      process.env.TZ = 'Asia/Kolkata';
      expect(turnOf([echo(10.5, '14:05:00', 'hello')]).you?.at).toBe('19:35');
    } finally {
      process.env.TZ = was;
    }
    expect(APP).toMatch(/const at = hhmm\(it\.at\);/);
    expect(APP).not.toMatch(/const at = it\.at \? it\.at\.slice\(11, 16\)/);
  });

  it('Mika 4: the working key (the strip’s and the chat’s) pads 4px inside so its focus ring clears the spinner and the clock', () => {
    expect(CSS).toMatch(/^\.bd-turn \.work-key \{ padding: 0 4px; margin-left: -4px; \}$/m);
    expect(CSS).toMatch(/^\.trow\.role-working \.work-key \{[^}]*padding: 0 4px; margin-left: -4px; \}/m);
  });
});
