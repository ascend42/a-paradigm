// T-2026-10-21-007 (founder dogfood 2026-10-21, kernel log session hsid:v1:01M5E2G1TRBTMST63ZAY9V0W7D seq 4683-4791):
// a turn's result is anchored under ITS turn (not under the next turn's message), and the running turn shows a live
// working row and a live activity clock that freeze at the real duration when its turn.result lands.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { changedBefore, hasLive, itemSig, LiveTicker, liveSecs, liveText } from '../src/core/live-turn.js';
import { chatItems, foldActivity, type Row } from '../src/core/store.js';
import { HeightIndex } from '../src/core/virtual.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const H = 'hsid:v1:01M5E2G1TRBTMST63ZAY9V0W7D';
const at = (hms: string): string => `2026-10-21T${hms}Z`;
const ev = (seq: number, hms: string, line: Record<string, unknown>, type: string): Row => ({ seq, kind: 'turn.event', view: 'full', at: at(hms), session: H, payload: { hsid: H, type, seq, line: JSON.stringify(line) } });
const row = (seq: number, kind: string, hms: string, payload: Record<string, unknown> = {}): Row => ({ seq, kind, view: 'full', at: at(hms), session: H, payload: { hsid: H, ...payload } });
const echo = (seq: number, hms: string, text: string): Row => ({ seq, kind: 'composer', connId: 'local', session: H, payload: text, at: at(hms) });
const say = (text: string) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const replay = (text: string) => ({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
const result = (seq: number, hms: string, cost: number, tokens: number): Row => row(seq, 'turn.result', hms, { cost, isError: false, subtype: 'success', usage: { tokens } });

/** The founder's exact order: turn 2 replies, turn 3 is sent BEFORE turn 2's result lands, then turn 3 runs `paradigm doctor`. */
const founder = (): Row[] => [
  echo(4696.5, '01:57:09.200', 'hmm hi there'),
  row(4697, 'turn.sent', '01:57:09.298', { permitId: 'permit:v1:2', turn: `turn:${H}/2` }),
  ev(4700, '01:57:11.740', replay('hmm hi there'), 'user'),
  ev(4711, '01:57:12.476', say('Hi! What would you like to work on?'), 'assistant'),
  echo(4717.5, '01:57:20.800', 'maybe a quick paradigm symbols check?'),
  row(4721, 'turn.sent', '01:57:20.893', { permitId: 'permit:v1:3', turn: `turn:${H}/3` }),
  ev(4722, '01:57:42.522', { type: 'result', subtype: 'success' }, 'result'),
  result(4723, '01:57:42.523', 0.29725, 8),
  ev(4728, '01:57:48.891', replay('maybe a quick paradigm symbols check?'), 'user'),
  ev(4772, '01:57:50.322', { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu', name: 'Bash', input: { command: 'paradigm doctor 2>&1 | tail -40' } }] } }, 'assistant'),
  row(4780, 'approval.request', '01:57:50.364', { card: { cardId: 'card:1', kind: 'permission' } }),
  row(4781, 'approval.decide', '01:57:57.715', { cardId: 'card:1', decision: 'always' }),
  ev(4785, '01:58:00.731', { type: 'system', subtype: 'task_started', tool_use_id: 'tu' }, 'system.task_started'),
  ev(4786, '01:58:27.724', { type: 'tool_progress', tool_name: 'Bash', elapsed_time_seconds: 30, heartbeat: true }, 'tool_progress'),
  ev(4787, '01:58:57.725', { type: 'tool_progress', tool_name: 'Bash', elapsed_time_seconds: 60, heartbeat: true }, 'tool_progress'),
  ev(4788, '01:59:27.726', { type: 'tool_progress', tool_name: 'Bash', elapsed_time_seconds: 90, heartbeat: true }, 'tool_progress'),
];
const upTo = (seq: number): Row[] => founder().filter((r) => r.seq <= seq);
const view = (rows: Row[]) => foldActivity(chatItems(rows, { live: true }).items);
const roles = (xs: Array<{ role: string; text: string }>) => xs.map((x) => `${x.role}: ${x.text}`);

describe('T-2026-10-21-007 a turn result is anchored under its own turn', () => {
  it("the founder's order: turn 2's result lands under turn 2's reply, above turn 3's message; turn 3 shows running", () => {
    const f = view(upTo(4788));
    expect(roles(f)).toEqual([
      'user: hmm hi there',
      'assistant: Hi! What would you like to work on?',
      'result: success · $0.2973 · 8 tokens',
      'user: maybe a quick paradigm symbols check?',
      'activity: 01:57 · ran 1 command',
      'card: needs you · permission (decide it in the stack)',
      'card: decided · always',
      'working: working…',
    ]);
    // turn 3 is the running one: its activity line and its working row carry the live clock, turn 2's result does not
    const act = f.find((x) => x.role === 'activity')!;
    expect(act.live).toEqual({ since: at('01:57:20.800'), progress: { at: at('01:59:27.726'), secs: 90, tool: 'Bash' } });
    expect(f[f.length - 1]!.live?.since).toBe(at('01:57:42.523')); // turn 3 started when turn 2's result landed
    expect(f.filter((x) => x.live).map((x) => x.role)).toEqual(['activity', 'working']);
  });
  it('before turn 2 ends, the working row sits under turn 2 (above the waiting turn 3 message), and the result replaces it there', () => {
    const before = view(upTo(4721));
    expect(before.map((x) => x.role)).toEqual(['user', 'assistant', 'working', 'user']);
    expect(before[2]!.live?.since).toBe(at('01:57:09.298'));
    const after = view(upTo(4723));
    expect(after.map((x) => x.role)).toEqual(['user', 'assistant', 'result', 'user', 'working']);
  });
  it('the pairing is the send order (FIFO): two waiting messages start one by one as each earlier result lands', () => {
    const rows: Row[] = [
      echo(1.5, '10:00:00', 'one'),
      row(2, 'turn.sent', '10:00:00.1'),
      echo(2.5, '10:00:01', 'two'),
      row(3, 'turn.sent', '10:00:01.1'),
      echo(3.5, '10:00:02', 'three'),
      row(4, 'turn.sent', '10:00:02.1'),
      ev(5, '10:00:03', say('answer one'), 'assistant'),
      result(6, '10:00:04', 0.01, 1),
      ev(7, '10:00:05', say('answer two'), 'assistant'),
      result(8, '10:00:06', 0.02, 2),
    ];
    expect(roles(chatItems(rows, { live: true }).items)).toEqual([
      'user: one',
      'assistant: answer one',
      'result: success · $0.0100 · 1 tokens',
      'user: two',
      'assistant: answer two',
      'result: success · $0.0200 · 2 tokens',
      'user: three',
      'working: working…',
    ]);
  });
  it('a session with no outstanding turn shows no working row and nothing live; an ended session neither', () => {
    const done = [...upTo(4711), result(4712, '01:57:13', 0.1, 3)].filter((r) => r.seq < 4717);
    const f = view(done);
    expect(f.some((x) => x.role === 'working' || x.live)).toBe(false);
    expect(hasLive(f)).toBe(false);
    // a running turn in a session that is not live (the page passes live:false) has no spinner either
    expect(foldActivity(chatItems(upTo(4788), { live: false }).items).some((x) => x.role === 'working' || x.live)).toBe(false);
    // the session ends with the turn unanswered: nothing runs any more
    expect(view([...upTo(4788), row(4800, 'session.exited', '02:03:33', { code: 143 })]).some((x) => x.role === 'working' || x.live)).toBe(false);
  });
  it('with nothing waiting the list only grows at the end (the working row is last; raw mode never reorders)', () => {
    const rows = upTo(4711);
    expect(view(rows).map((x) => x.role)).toEqual(['user', 'assistant', 'working']);
    expect(chatItems(upTo(4723), { raw: true }).items.map((x) => x.seq)).toEqual(upTo(4723).map((r) => r.seq));
  });
});

describe('T-2026-10-21-007 the running clock ticks and freezes', () => {
  afterEach(() => vi.useRealTimers());
  it('the live elapsed time advances with fake timers (the turn clock, the tool heartbeat floor and the tool name)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(at('01:59:30')));
    const f = view(upTo(4788));
    const act = f.find((x) => x.role === 'activity')!;
    const work = f.find((x) => x.role === 'working')!;
    const texts: string[] = [];
    const ticker = new LiveTicker(() => texts.push(`${act.text}${liveText(act, Date.now())} | ${liveText(work, Date.now())}`));
    ticker.sync(hasLive(f));
    expect(ticker.running).toBe(true);
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(29_000);
    // 01:59:31: 2m 10s since turn 3's message (01:57:20.8), Bash 90s + 3s since its last heartbeat, 1m 48s since the turn began
    expect(texts[0]).toBe('01:57 · ran 1 command · running 2m 10s · Bash 1m 33s | working… · 1m 48s');
    expect(texts[texts.length - 1]).toBe('01:57 · ran 1 command · running 2m 39s · Bash 2m 2s | working… · 2m 17s');
    expect(texts).toHaveLength(30);
    // one interval only, however often the page re-syncs while the turn runs
    ticker.sync(true);
    ticker.sync(true);
    expect(vi.getTimerCount()).toBe(1);
    ticker.sync(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('a heartbeat is a floor: the clock never shows less than the tool has reported', () => {
    expect(liveSecs({ since: at('10:00:00'), progress: { at: at('10:00:10'), secs: 90 } }, Date.parse(at('10:00:10')))).toBe(90);
    expect(liveSecs({ since: at('10:00:00') }, Date.parse(at('10:00:42.9')))).toBe(42);
  });
  it('it freezes at the end: the result removes the live fields and the summary reads the real duration', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(at('01:59:47')));
    const running = view(upTo(4788));
    const ticker = new LiveTicker(() => undefined);
    ticker.sync(hasLive(running));
    expect(ticker.running).toBe(true);
    const ended = view([
      ...upTo(4788),
      ev(4790, '01:59:46.607', { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu', content: 'ok' }] } }, 'user'),
      result(4800, '01:59:50.000', 0.3, 20),
    ]);
    expect(hasLive(ended)).toBe(false);
    expect(ended.some((x) => x.role === 'working')).toBe(false);
    ticker.sync(hasLive(ended));
    expect(ticker.running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    // from turn 3's message (01:57:20.8) to its result (01:59:50): 2m 29s of work, frozen (time passing changes nothing);
    // the cards between the tool and the result no longer freeze it at the tool row (the founder's static "29s")
    const act = ended.find((x) => x.role === 'activity')!;
    expect(act.text).toBe('01:57–01:59 · ran 1 command · 2m 29s of work');
    vi.advanceTimersByTime(60_000);
    expect(view([...upTo(4788), result(4800, '01:59:50.000', 0.3, 20)]).find((x) => x.role === 'activity')!.text).toBe(act.text);
  });
});

describe('T-2026-10-21-007 the page wiring', () => {
  it('HeightIndex.truncate keeps the prefix measurements and drops the tail', () => {
    const h = new HeightIndex(10);
    h.push(4);
    h.set(0, 30);
    h.set(3, 50);
    h.truncate(2);
    expect(h.length).toBe(2);
    expect(h.total()).toBe(40);
    h.push(2);
    expect(h.total()).toBe(60);
    expect(h.offsetOf(3)).toBe(50);
  });
  it('the page passes the session liveness to chatItems, syncs one ticker per paint and rewrites only the clock spans', () => {
    const app = readFileSync(path.join(ROOT, 'src/ui/app.ts'), 'utf8');
    expect(app).toMatch(/chatItems\(rows, \{ raw, live \}\)/);
    expect(app).toMatch(/liveTicker\.sync\(hasLive\(items\)\)/);
    expect(app).toMatch(/querySelector\('\.live-clock'\)/);
    expect(app).not.toMatch(/setInterval\(\(\) => paintTranscript/);
    const css = readFileSync(path.join(ROOT, 'static/styles.css'), 'utf8');
    expect(css).toMatch(/\[data-motion="reduced"\] \.trow\.role-working \.spin \{ animation: none; \}/);
  });
});

describe('review H1: a kept item that changed in place is repainted (not only the changed tail)', () => {
  const keys = (xs: Array<{ key: string }>) => xs.map((x) => x.key);
  const lcpOf = (a: Array<{ key: string }>, b: Array<{ key: string }>): number => {
    let i = 0;
    while (i < Math.min(a.length, b.length) && a[i]!.key === b[i]!.key) i++;
    return i;
  };
  /** The page's repaint: the prefix stays mounted except the items changedBefore names; the tail is rebuilt. */
  const repaint = (prev: ReturnType<typeof view>, next: ReturnType<typeof view>): string[] => {
    const lcp = lcpOf(prev, next);
    const stale = new Set(changedBefore(prev, next, lcp));
    return next.map((it, i) => (i < lcp && !stale.has(i) ? itemSig(prev[i]!) : itemSig(it)));
  };
  it('tools → working → reply: the activity line keeps its key, is frozen and has no .live once the reply lands', () => {
    const running = [
      echo(1.5, '10:00:00', 'run it'),
      row(2, 'turn.sent', '10:00:00.1', { turn: `turn:${H}/1` }),
      ev(3, '10:00:01', { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu', name: 'Bash', input: { command: 'ls' } }] } }, 'assistant'),
      ev(4, '10:00:31', { type: 'tool_progress', tool_name: 'Bash', elapsed_time_seconds: 30 }, 'tool_progress'),
    ];
    const prev = view(running);
    expect(prev.map((x) => x.role)).toEqual(['user', 'activity', 'working']);
    expect(prev[1]!.live).toBeDefined();
    const next = view([...running, ev(5, '10:02:06', say('Done.'), 'assistant')]);
    expect(next.map((x) => x.role)).toEqual(['user', 'activity', 'assistant', 'working']);
    expect(keys(next).slice(0, 2)).toEqual(keys(prev).slice(0, 2));
    expect(next[1]!.live).toBeUndefined();
    expect(next[1]!.text).toBe('10:00–10:02 · ran 1 command · 2m 6s of work');
    // the activity line sits inside the kept prefix and is named for a remount
    expect(lcpOf(prev, next)).toBe(2);
    expect(changedBefore(prev, next, 2)).toEqual([1]);
    expect(repaint(prev, next)).toEqual(next.map(itemSig));
    // and its result: the working row goes, nothing stale is left
    const done = view([...running, ev(5, '10:02:06', say('Done.'), 'assistant'), result(6, '10:02:07', 0.1, 3)]);
    expect(repaint(next, done)).toEqual(done.map(itemSig));
    expect(hasLive(done)).toBe(false);
  });
  it('a card decided while a turn runs: every changed item of the kept prefix repaints, the rest stays mounted', () => {
    const base = [
      echo(1.5, '10:00:00', 'edit it'),
      row(2, 'turn.sent', '10:00:00.1', { turn: `turn:${H}/1` }),
      ev(3, '10:00:01', { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu', name: 'Edit', input: { file_path: '/a' } }] } }, 'assistant'),
      row(4, 'approval.request', '10:00:02', { card: { cardId: 'card:1', kind: 'permission' } }),
    ];
    const prev = view(base);
    const next = view([...base, row(5, 'approval.decide', '10:00:09', { cardId: 'card:1', decision: 'allow' })]);
    expect(next.map((x) => x.text).filter((t) => t.startsWith('decided'))).toEqual(['decided · allow']);
    expect(repaint(prev, next)).toEqual(next.map(itemSig));
    // the reply then freezes the activity line above both cards
    const replied = view([...base, row(5, 'approval.decide', '10:00:09', { cardId: 'card:1', decision: 'allow' }), ev(6, '10:00:20', say('Edited.'), 'assistant')]);
    expect(changedBefore(next, replied, lcpOf(next, replied))).toContain(next.findIndex((x) => x.role === 'activity'));
    expect(repaint(next, replied)).toEqual(replied.map(itemSig));
  });
  it('the page uses changedBefore in both repaint branches (no text-only check left in the append branch)', () => {
    const app = readFileSync(path.join(ROOT, 'src/ui/app.ts'), 'utf8');
    expect(app).toMatch(/const stale = new Set\(changedBefore\(items, next, lcp\)\);\n\s+for \(const \[i, el\] of mounted\)\n\s+if \(i >= lcp \|\| stale\.has\(i\)\)/);
    expect(app).not.toMatch(/items\[i\]!\.text !== next\[i\]!\.text/);
  });
});

describe('review M1: a refused or failed send is no turn; a stamped echo pairs with its own turn.sent', () => {
  const stamped = (seq: number, hms: string, text: string, k: number): Row => ({ ...echo(seq, hms, text), turn: `turn:${H}/${k}` });
  const unsent = (seq: number, hms: string, text: string): Row => ({ ...echo(seq, hms, text), unsent: true });
  const refused = (seq: number, why: string): Row => ({ seq, kind: 'send.refused', connId: 'local', session: H, payload: why });
  it('a refused send, then a normal send: the second message runs with its own clock and nothing waits', () => {
    const rows: Row[] = [
      unsent(10.5, '10:00:00', 'first try'),
      refused(10.6, 'refused: a turn permit is needed'),
      stamped(11.5, '10:00:05', 'second try', 1),
      row(12, 'turn.sent', '10:00:05.2', { turn: `turn:${H}/1` }),
      ev(13, '10:00:06', replay('second try'), 'user'),
    ];
    const f = view(rows);
    expect(roles(f)).toEqual(['user: first try', 'error: refused: a turn permit is needed', 'user: second try', 'working: working…']);
    expect(f[3]!.live?.since).toBe(at('10:00:05.2'));
    const done = view([...rows, ev(14, '10:00:07', say('ok'), 'assistant'), result(15, '10:00:08', 0.01, 1)]);
    expect(roles(done)).toEqual(['user: first try', 'error: refused: a turn permit is needed', 'user: second try', 'assistant: ok', 'result: success · $0.0100 · 1 tokens']);
    expect(hasLive(done)).toBe(false);
  });
  it('a refused send while a turn runs never waits: the next message starts at the running turn\'s result', () => {
    const rows: Row[] = [
      stamped(1.5, '10:00:00', 'one', 1),
      row(2, 'turn.sent', '10:00:00.1', { turn: `turn:${H}/1` }),
      unsent(2.5, '10:00:01', 'refused one'),
      refused(2.6, 'refused: busy'),
      stamped(3.5, '10:00:02', 'two', 2),
      row(4, 'turn.sent', '10:00:02.1', { turn: `turn:${H}/2` }),
      ev(5, '10:00:03', say('answer one'), 'assistant'),
      result(6, '10:00:04', 0.01, 1),
    ];
    const f = view(rows);
    // the refused message stays where it was typed (it is no turn); the running turn's output goes above the WAITING one
    expect(roles(f)).toEqual(['user: one', 'user: refused one', 'error: refused: busy', 'assistant: answer one', 'result: success · $0.0100 · 1 tokens', 'user: two', 'working: working…']);
    expect(f[f.length - 1]!.live?.since).toBe(at('10:00:04'));
  });
  it('a network error does the same (the echo is marked unsent and its reason shows under it)', () => {
    const rows: Row[] = [
      unsent(10.5, '10:00:00', 'lost'),
      refused(10.6, 'may not have been sent: the connection to the kernel failed'),
      stamped(11.5, '10:00:05', 'again', 1),
      row(12, 'turn.sent', '10:00:05.2', { turn: `turn:${H}/1` }),
    ];
    const f = view(rows);
    expect(roles(f)).toEqual(['user: lost', 'error: may not have been sent: the connection to the kernel failed', 'user: again', 'working: working…']);
    expect(f[3]!.live?.since).toBe(at('10:00:05.2'));
  });
  it('the stamp is exact: a turn.sent another client caused does not start this page\'s waiting message', () => {
    const rows: Row[] = [
      stamped(1.5, '10:00:00', 'one', 1),
      row(2, 'turn.sent', '10:00:00.1', { turn: `turn:${H}/1` }),
      stamped(2.5, '10:00:01', 'mine', 3),
      row(3, 'turn.sent', '10:00:01.1', { turn: `turn:${H}/2` }), // the kernel's open turn, or another device
      row(4, 'turn.sent', '10:00:01.2', { turn: `turn:${H}/3` }),
    ];
    const items = chatItems(rows, { live: true }).items;
    expect(roles(items)).toEqual(['user: one', 'working: working…', 'user: mine']);
  });
  it('the page stamps the echo from session.send and marks it unsent on a refusal or a network error', () => {
    const app = readFileSync(path.join(ROOT, 'src/ui/app.ts'), 'utf8');
    expect(app).toMatch(/stampEcho\(echo, await client\.call<\{ turn\?: unknown \}>\('session\.send'/);
    expect(app).toMatch(/unsentEcho\(echo, err\);/);
    expect(app).toMatch(/if \(echo\) echo\.unsent = true;/);
    expect(app).toMatch(/\$\{mine\.length\}\.\$\{localRev\}/);
  });
});

describe('review M2: a result pairs with the turn it names; a folded queued turn settles with it', () => {
  const stamped = (seq: number, hms: string, text: string, k: number): Row => ({ ...echo(seq, hms, text), turn: `turn:${H}/${k}` });
  const resultOf = (seq: number, hms: string, k: number): Row => row(seq, 'turn.result', hms, { cost: 0.01, isError: false, subtype: 'success', usage: { tokens: 1 }, turn: `turn:${H}/${k}` });
  it("the founder's fold (seq 4795-5146): turn 4 is replayed mid-turn-3, one result{turn 4} closes both, nothing keeps ticking", () => {
    const rows: Row[] = [
      stamped(4720.5, '01:57:20.800', 'maybe a quick paradigm symbols check?', 3),
      row(4721, 'turn.sent', '01:57:20.893', { turn: `turn:${H}/3` }),
      ev(4728, '01:57:48.891', replay('maybe a quick paradigm symbols check?'), 'user'),
      ev(4772, '01:57:50.322', { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu', name: 'Bash', input: { command: 'paradigm doctor' } }] } }, 'assistant'),
      stamped(4794.5, '01:59:48.400', 'so what happened?', 4),
      row(4795, 'turn.sent', '01:59:48.443', { turn: `turn:${H}/4` }),
      ev(4862, '02:01:45.045', { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu', content: 'ok' }] } }, 'user'),
      ev(4863, '02:01:45.179', replay('so what happened?'), 'user'),
      ev(5138, '02:01:55.934', say('The symbols themselves look fine.'), 'assistant'),
    ];
    const running = view(rows);
    expect(running[running.length - 1]!.role).toBe('working');
    const done = view([...rows, resultOf(5146, '02:02:25.922', 4)]);
    expect(done.some((x) => x.role === 'working')).toBe(false);
    expect(hasLive(done)).toBe(false);
    expect(done[done.length - 1]!.role).toBe('result');
  });
  it('without a turn id (an older log) the result still closes the oldest open turn (FIFO fallback)', () => {
    const rows: Row[] = [
      echo(1.5, '10:00:00', 'one'),
      row(2, 'turn.sent', '10:00:00.1', { turn: `turn:${H}/1` }),
      echo(2.5, '10:00:01', 'two'),
      row(3, 'turn.sent', '10:00:01.1', { turn: `turn:${H}/2` }),
      ev(4, '10:00:02', say('answer one'), 'assistant'),
      result(5, '10:00:03', 0.01, 1),
    ];
    expect(roles(view(rows))).toEqual(['user: one', 'assistant: answer one', 'result: success · $0.0100 · 1 tokens', 'user: two', 'working: working…']);
  });
  it('a result naming a later turn closes the earlier open ones too (no working row left for a folded turn)', () => {
    const rows: Row[] = [
      stamped(1.5, '10:00:00', 'one', 1),
      row(2, 'turn.sent', '10:00:00.1', { turn: `turn:${H}/1` }),
      stamped(2.5, '10:00:01', 'two', 2),
      row(3, 'turn.sent', '10:00:01.1', { turn: `turn:${H}/2` }),
      ev(4, '10:00:02', say('both answered'), 'assistant'),
      resultOf(5, '10:00:03', 2),
    ];
    const f = view(rows);
    expect(f.some((x) => x.role === 'working')).toBe(false);
    expect(f.filter((x) => x.role === 'user')).toHaveLength(2);
  });
});

describe('review a11y: the working row', () => {
  it('is a status labelled "Claude is working" (a local-model session: "The local model is working") and its clock span is aria-live off', () => {
    const app = readFileSync(path.join(ROOT, 'src/ui/app.ts'), 'utf8');
    expect(app).toMatch(/\{ class: 'trow role-working', role: 'status', 'aria-label': agentLabel\(\) === 'local model' \? 'The local model is working' : 'Claude is working' \}/);
    expect(app).toMatch(/b === 'local' \? 'local model'/);
    // Mika #4: a row drawn before the session's backend arrived is remounted when the speaker label changes
    expect(app).toMatch(/if \(agent !== mountedAgent\) \{\s*for \(const el of mounted\.values\(\)\) el\.remove\(\);\s*mounted\.clear\(\);/);
    expect(app).toMatch(/h\(doc, 'span', \{ class: 'live-clock', 'aria-live': 'off' \}, liveText\(it, Date\.now\(\)\)\)/);
  });
});
