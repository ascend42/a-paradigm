/**
 * #gui-dictation (TD-2026-10-20-262, T-2026-10-19-026): the pure reducer (core/dictation.ts), the store's dictation
 * transcript states, and the page wiring read from the source.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { armed, dictationNote, dictationStatusOf, initialDictation, insertableText, liveLine, parseDelay, reduceDictation, ringFraction, ringRemaining, sendRequest, serializeDelay, type DictationEvent, type DictationState } from '../src/core/dictation.js';
import { chatItems, type Row } from '../src/core/store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
const B = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZB';
const fwd = (text: string, more: Record<string, unknown> = {}) => ({ text, turnId: `t-${text}`, speakerId: 'spk:me/Matt', forwardable: true, ...more });

/** A started dictation attached to and focused on A, at t=0. */
function ready(delayMs: number | null = 5000): DictationState {
  let s = initialDictation(delayMs);
  s = reduceDictation(s, { type: 'start', sinceSeq: 10, now: 0 });
  return reduceDictation(s, { type: 'context', attached: A, focused: A, now: 0 });
}
const run = (s: DictationState, ...es: DictationEvent[]): DictationState => es.reduce(reduceDictation, s);
const turn = (seq: number, text: string, now: number, more: Record<string, unknown> = {}, hsid = A): DictationEvent => ({ type: 'turnRow', seq, hsid, payload: fwd(text, more), now });

describe('dictation: the composer takes forwardable live turns', () => {
  it('consecutive turns append with one space, each once by seq', () => {
    const s = run(ready(), turn(11, 'open the file', 0), turn(12, ' and  fix it ', 100), turn(12, 'and fix it', 200));
    expect(s.text).toBe('open the file and fix it');
    expect(s.parts).toEqual([{ seq: 11, text: 'open the file' }, { seq: 12, text: 'and fix it' }]);
  });
  it('backlog rows (at or before the start seq) are never inserted; nothing before start', () => {
    expect(run(ready(), turn(9, 'old', 0), turn(10, 'older', 0)).text).toBe('');
    const pre = reduceDictation(reduceDictation(initialDictation(), { type: 'context', attached: A, focused: A, now: 0 }), turn(50, 'x', 0));
    expect(pre.text).toBe('');
  });
  it('refused, intercepted, partial, empty and non-forwardable rows are never inserted', () => {
    const s = run(
      ready(),
      { type: 'turnRow', seq: 11, hsid: A, payload: { text: 'a', forwardable: false }, now: 0 },
      { type: 'turnRow', seq: 12, hsid: A, payload: { text: 'b' }, now: 0 },
      turn(13, 'approve it', 0, { intercepted: 'decision' }),
      turn(14, 'c', 0, { refusal: { reason: 'voice-off' } }),
      turn(15, 'd', 0, { partial: true }),
      turn(16, '   ', 0),
      turn(17, 'other session', 0, {}, B),
    );
    expect(s.text).toBe('');
    expect(insertableText({ text: 'ok', forwardable: true })).toBe('ok');
  });
});

describe('dictation: the countdown ring', () => {
  it('silence starts the ring at the full delay; it sends when the ring completes', () => {
    let s = run(ready(5000), turn(11, 'hello', 1000));
    expect(armed(s)).toBe(true);
    expect(ringRemaining(s, 1000)).toBe(5000);
    expect(ringFraction(s, 3500)).toBeCloseTo(0.5);
    expect(liveLine(s, 2100)).toBe('sending in 4 s');
    s = reduceDictation(s, { type: 'tick', now: 5999 });
    expect(s.sending).toBe(false);
    s = reduceDictation(s, { type: 'tick', now: 6000 });
    expect(s.sending).toBe(true);
    expect(liveLine(s, 6000)).toBe('sending');
  });
  it('new speech, transcription, a new turn or streaming resets the ring to the full delay', () => {
    let s = run(ready(5000), turn(11, 'hello', 0));
    s = run(s, { type: 'activity', activity: 'speaking', now: 4000 });
    expect(ringRemaining(s, 4000)).toBeNull();
    s = run(s, { type: 'activity', activity: 'transcribing', now: 4500 }, { type: 'activity', activity: 'idle', now: 4800 });
    expect(ringRemaining(s, 4800)).toBe(5000);
    s = run(s, turn(12, 'more', 7000));
    expect(ringRemaining(s, 7000)).toBe(5000);
    s = run(s, { type: 'busy', busy: true, now: 9000 });
    expect(ringRemaining(s, 9000)).toBeNull();
    expect(run(s, { type: 'tick', now: 99_000 }).sending).toBe(false);
    s = run(s, { type: 'busy', busy: false, now: 10_000 });
    expect(ringRemaining(s, 10_000)).toBe(5000);
  });
  it('delay off never auto-sends; a delay set later starts a full ring', () => {
    let s = run(ready(null), turn(11, 'hello', 0), { type: 'tick', now: 1e9 });
    expect(s.sending).toBe(false);
    expect(ringRemaining(s, 1e9)).toBeNull();
    expect(dictationNote(s)).toBe('draft · auto-send off');
    s = run(s, { type: 'setDelay', delayMs: 3000, now: 100 });
    expect(ringRemaining(s, 100)).toBe(3000);
  });
  it('an unfocused session waits ("draft waiting"); focusing it starts a full ring', () => {
    let s = run(ready(), { type: 'context', attached: A, focused: B, now: 0 }, turn(11, 'hello', 0), { type: 'tick', now: 60_000 });
    expect(s.sending).toBe(false);
    expect(dictationNote(s)).toBe('draft waiting');
    expect(liveLine(s, 60_000)).toBe('draft waiting');
    s = run(s, { type: 'context', attached: A, focused: A, now: 61_000 });
    expect(ringRemaining(s, 61_000)).toBe(5000);
  });
});

describe('dictation: hold', () => {
  it('[Hold] stops auto-send; [Resume] restarts a full ring', () => {
    let s = run(ready(), turn(11, 'hello', 0), { type: 'hold', hold: true, now: 1000 }, { type: 'tick', now: 60_000 });
    expect(s.sending).toBe(false);
    expect(dictationNote(s)).toBe('draft held');
    s = run(s, { type: 'hold', hold: false, now: 61_000 });
    expect(ringRemaining(s, 61_000)).toBe(5000);
  });
  it('⌃⌥H presses apply by parity since the last value seen (the first value is a baseline)', () => {
    let s = run(ready(), turn(11, 'hello', 0), { type: 'holdToggle', count: 4, now: 0 });
    expect(s.hold).toBe(false);
    s = run(s, { type: 'holdToggle', count: 5, now: 0 });
    expect(s.hold).toBe(true);
    s = run(s, { type: 'holdToggle', count: 7, now: 0 });
    expect(s.hold).toBe(true);
    s = run(s, { type: 'holdToggle', count: 8, now: 0 });
    expect(s.hold).toBe(false);
    s = run(s, { type: 'holdToggle', count: 0, now: 0 }); // a kernel restart: new baseline
    expect(s.hold).toBe(false);
  });
  it('typing in the composer sets hold and marks the draft edited; clicking into a draft sets hold', () => {
    const typed = run(ready(), turn(11, 'hello', 0), { type: 'userEdit', text: 'hello world', now: 10 });
    expect(typed).toMatchObject({ hold: true, edited: true, text: 'hello world' });
    expect(run(typed, { type: 'tick', now: 1e9 }).sending).toBe(false);
    expect(run(ready(), turn(11, 'hello', 0), { type: 'focusComposer', now: 10 }).hold).toBe(true);
    expect(run(ready(), { type: 'focusComposer', now: 10 }).hold).toBe(false); // nothing to edit yet
  });
  it('[Send] sends now whatever the hold, and clears hold and the draft', () => {
    let s = run(ready(), turn(11, 'hello', 0), { type: 'hold', hold: true, now: 0 }, { type: 'sendNow', now: 0 });
    expect(s.sending).toBe(true);
    s = run(s, { type: 'sent', now: 1 });
    expect(s).toMatchObject({ hold: false, text: '', parts: [], edited: false, sending: false });
  });
  it('a failed send holds the draft (never loops)', () => {
    const s = run(ready(), turn(11, 'hello', 0), { type: 'sendNow', now: 0 }, { type: 'sendFailed', now: 1 });
    expect(s).toMatchObject({ sending: false, hold: true, text: 'hello' });
  });
});

describe('dictation: the send', () => {
  it('unedited: one content part per turn, in order, source voice', () => {
    const s = run(ready(), turn(11, 'one', 0), turn(12, 'two', 0));
    expect(sendRequest(s)).toEqual({ hsid: A, content: [{ text: 'one' }, { text: 'two' }], source: 'voice' });
  });
  it('edited: the composer text as ONE part, source voice', () => {
    const s = run(ready(), turn(11, 'one', 0), turn(12, 'two', 0), { type: 'userEdit', text: 'one, two!', now: 0 });
    expect(sendRequest(s)).toEqual({ hsid: A, content: [{ text: 'one, two!' }], source: 'voice' });
  });
  it('turns spoken after an edit still append to the composer', () => {
    const s = run(ready(), turn(11, 'one', 0), { type: 'userEdit', text: 'one,', now: 0 }, turn(12, 'two', 0));
    expect(s.text).toBe('one, two');
    expect(sendRequest(s)!.content).toEqual([{ text: 'one, two' }]);
  });
  it('the draft keeps its session when the attachment moves', () => {
    const s = run(ready(), turn(11, 'one', 0), { type: 'context', attached: B, focused: B, now: 0 }, turn(12, 'for b', 0, {}, B));
    expect(sendRequest(s)).toMatchObject({ hsid: A, content: [{ text: 'one' }] });
    expect(dictationNote(s)).toBe('draft waiting');
  });
});

describe('dictation: adapters', () => {
  it('reads status.voice.dictation; an older kernel reads idle with no toggles', () => {
    expect(dictationStatusOf({ voice: { dictation: { activity: 'speaking', holdToggles: 3, at: 'x' } } })).toEqual({ activity: 'speaking', holdToggles: 3 });
    expect(dictationStatusOf({ voice: {} })).toEqual({ activity: 'idle', holdToggles: null });
    expect(dictationStatusOf(null)).toEqual({ activity: 'idle', holdToggles: null });
  });
  it('the delay is stored per machine as 3000/5000/8000/15000/off; anything else is the 5 s default', () => {
    expect(parseDelay(null)).toBe(5000);
    expect(parseDelay('off')).toBeNull();
    expect(parseDelay('8000')).toBe(8000);
    expect(parseDelay('1234')).toBe(5000);
    expect(serializeDelay(null)).toBe('off');
    expect(serializeDelay(15000)).toBe('15000');
  });
});

describe('dictation: transcript states (store)', () => {
  const u = (seq: number, text: string, more: Record<string, unknown> = {}): Row => ({ seq, kind: 'voice.turn.user', view: 'full', session: A, payload: fwd(text, more) });
  it('a forwardable turn not yet sent reads "in composer", never "voice app says: not sent"', () => {
    const { items } = chatItems([u(1, 'hello')]);
    expect(items[0]).toMatchObject({ role: 'voice-heard' });
    expect(items[0]!.text).toContain('in composer');
    expect(items[0]!.text).not.toContain('voice app says');
  });
  it('turn.sent{source voice, voiceTurnSeqs} makes each cited turn the user message with the 🎙 tag', () => {
    const rows: Row[] = [u(1, 'one'), u(2, 'two'), { seq: 3, kind: 'turn.sent', view: 'full', session: A, payload: { source: 'voice', voiceTurnSeqs: [1, 2] } }];
    const { items } = chatItems(rows);
    expect(items.map((i) => [i.role, i.text, i.voice])).toEqual([['user', 'one', 'voice'], ['user', 'two', 'voice']]);
  });
  it('claude\'s replay of the joined parts shows once', () => {
    const replay = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] } });
    const rows: Row[] = [u(1, 'one'), u(2, 'two'), { seq: 3, kind: 'turn.sent', view: 'full', session: A, payload: { source: 'voice', voiceTurnSeqs: [1, 2] } }, { seq: 4, kind: 'turn.event', view: 'full', session: A, payload: { line: replay } }];
    expect(chatItems(rows).items.filter((i) => i.role === 'user')).toHaveLength(2);
  });
  it('the older single voiceTurnSeq still marks its turn sent', () => {
    const { items } = chatItems([u(1, 'one'), { seq: 2, kind: 'turn.sent', view: 'full', session: A, payload: { source: 'voice', voiceTurnSeq: 1 } }]);
    expect(items[0]).toMatchObject({ role: 'user', voice: 'voice' });
  });
  it('voice-edited: the heard turns read "edited before sending"; the sent message carries 🎙✎', () => {
    const replay = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'one, two!' }] } });
    const rows: Row[] = [u(1, 'one'), u(2, 'two'), { seq: 3, kind: 'turn.sent', view: 'full', session: A, payload: { source: 'voice-edited', voiceTurnSeqs: [1, 2] } }, { seq: 4, kind: 'turn.event', view: 'full', session: A, payload: { line: replay } }];
    const { items } = chatItems(rows);
    expect(items.slice(0, 2).every((i) => i.role === 'voice-heard' && i.text.includes('edited before sending'))).toBe(true);
    expect(items[2]).toMatchObject({ role: 'user', text: 'one, two!', voice: 'voice-edited' });
  });
});

describe('dictation: page wiring (read from the source)', () => {
  const app = readFileSync(path.join(ROOT, 'src/ui/app.ts'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'static/index.html'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'static/styles.css'), 'utf8');
  it('a voice connection never gets the dictation controls (gated on canAttach)', () => {
    expect(app).toMatch(/function dictationOn\(\)[^]*?canAttach\(status\)/);
    expect(html).toMatch(/id="dictation"[^>]*hidden/);
  });
  it('the ring, [Hold]/[Resume], [Send], an aria-live countdown and the delay picks are wired', () => {
    expect(html).toContain('id="dictation-ring"');
    expect(html).toContain('id="dictation-hold"');
    expect(html).toContain('id="dictation-send"');
    expect(html).toMatch(/id="dictation-live"[^>]*aria-live="polite"/);
    expect(app).toContain('DELAY_CHOICES');
    expect(app).toContain('DELAY_KEY');
  });
  it('reduced motion shows a text countdown instead of the draining ring', () => {
    expect(css).toMatch(/prefers-reduced-motion[^]*dictation-ring/);
  });
  it('only live event rows feed the composer (never the backlog page)', () => {
    expect(app).toMatch(/if \(p\.row\) \{[^]*?dictationRow\(/);
  });
});
