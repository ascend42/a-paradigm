/**
 * #gui-dictation (TD-2026-10-20-262, T-2026-10-19-026): the pure reducer (core/dictation.ts), the store's dictation
 * transcript states, and the page wiring read from the source.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AMBIENT_DRAFT_NOTE, ambientDraft, armed, DRAFT_CONTROLS, dictationNote, draftControls, draftState, dictationStatusOf, initialDictation, insertableText, liveLine, parseDelay, reduceDictation, ringFraction, ringRemaining, sendRequest, serializeDelay, type DictationEvent, type DictationState } from '../src/core/dictation.js';
import { chatItems, type Row } from '../src/core/store.js';
import { canAttach } from '../src/core/voice.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
const B = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZB';
const fwd = (text: string, more: Record<string, unknown> = {}) => ({ text, turnId: `t-${text}`, speakerId: 'spk:me/Matt', forwardable: true, mode: 'ptt', ...more });

/** A started dictation attached to and focused on A, at t=0. */
function ready(delayMs: number | null = 5000): DictationState {
  let s = initialDictation(delayMs);
  s = reduceDictation(s, { type: 'start', sinceSeq: 10, now: 0 });
  return reduceDictation(s, { type: 'context', attached: A, focused: A, now: 0 });
}
const run = (s: DictationState, ...es: DictationEvent[]): DictationState => es.reduce(reduceDictation, s);
const turn = (seq: number, text: string, now: number, more: Record<string, unknown> = {}, hsid = A): DictationEvent => ({ type: 'turnRow', seq, hsid, payload: fwd(text, more), now });

describe('TD-2026-10-20-125: ambient speech fills the composer and NEVER auto-sends', () => {
  it('an ambient (or unlabelled) turn fills the composer, never arms the ring, and only a key press sends it', () => {
    for (const mode of ['conversation', 'ambient', undefined, 'PTT']) {
      const more = mode === undefined ? { mode: undefined } : { mode };
      let s = run(ready(3000), turn(11, 'delete the branch', 0, more));
      expect(s.text, String(mode)).toBe('delete the branch');
      expect(ambientDraft(s)).toBe(true);
      expect(armed(s)).toBe(false);
      s = run(s, { type: 'tick', now: 60_000 });
      expect(s.sending, String(mode)).toBe(false);
      expect(ringRemaining(s, 60_000)).toBeNull();
      expect(dictationNote(s)).toBe(AMBIENT_DRAFT_NOTE);
      expect(liveLine(s, 60_000)).toBe(AMBIENT_DRAFT_NOTE);
      s = run(s, { type: 'sendNow', now: 60_001 }); // [Send] / Enter
      expect(s.sending).toBe(true);
      expect(sendRequest(s)).toEqual({ hsid: A, content: [{ text: 'delete the branch' }], source: 'voice' });
    }
  });
  it('one ambient part makes the whole draft wait; after the send a PTT-only draft rings again', () => {
    let s = run(ready(3000), turn(11, 'open the file', 0), turn(12, 'and push it', 100, { mode: 'conversation' }));
    expect(armed(s)).toBe(false);
    expect(run(s, { type: 'tick', now: 10_000 }).sending).toBe(false);
    s = run(s, { type: 'sendNow', now: 10_000 }, { type: 'sent', now: 10_100 }, turn(13, 'run the tests', 10_200));
    expect(ambientDraft(s)).toBe(false);
    expect(armed(s)).toBe(true);
    expect(run(s, { type: 'tick', now: 13_300 }).sending).toBe(true); // PTT keeps the ring as specified
  });
});

describe('dictation: the composer takes forwardable live turns', () => {
  it('consecutive turns append with one space, each once by seq', () => {
    const s = run(ready(), turn(11, 'open the file', 0), turn(12, ' and  fix it ', 100), turn(12, 'and fix it', 200));
    expect(s.text).toBe('open the file and fix it');
    // the shown text is collapsed; the send keeps the voice app's exact words (the kernel hash-matches them)
    expect(s.parts).toEqual([{ seq: 11, text: 'open the file' }, { seq: 12, text: 'and fix it', send: ' and  fix it ' }]);
    expect(sendRequest(s)!.content).toEqual([{ text: 'open the file' }, { text: ' and  fix it ' }]);
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
  it('turns heard while a send is in flight stay for the next draft', () => {
    const s = run(ready(), turn(11, 'one', 0), { type: 'sendNow', now: 0 }, turn(12, 'two', 1), { type: 'sent', now: 2 });
    expect(s).toMatchObject({ text: 'two', parts: [{ seq: 12, text: 'two' }], sending: false });
  });
  it('typed text with no dictated turn never arms the ring and sends with no voice source', () => {
    const s = run(ready(), { type: 'userEdit', text: 'typed', now: 0 }, { type: 'hold', hold: false, now: 0 }, { type: 'tick', now: 1e9 });
    expect(s.sending).toBe(false);
    expect(sendRequest(s)).toEqual({ hsid: A, content: [{ text: 'typed' }] });
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

describe('dictation: Aegis conditions', () => {
  it('M1: the voice hotkey sets hold and clears its own, never a GUI-set hold', () => {
    const base = run(ready(), turn(11, 'hello', 0), { type: 'holdToggle', count: 0, now: 0 });
    // voice sets, voice clears
    let s = run(base, { type: 'holdToggle', count: 1, now: 0 });
    expect(s).toMatchObject({ hold: true, holdBy: 'voice' });
    s = run(s, { type: 'holdToggle', count: 2, now: 0 });
    expect(s).toMatchObject({ hold: false, holdBy: null });
    // GUI-set (button, typing, click) stays through a voice toggle; [Resume] clears it
    for (const ev of [{ type: 'hold', hold: true, now: 0 }, { type: 'userEdit', text: 'hello!', now: 0 }, { type: 'focusComposer', now: 0 }] as DictationEvent[]) {
      let g = run(base, ev);
      expect(g.holdBy).toBe('gui');
      g = run(g, { type: 'holdToggle', count: 1, now: 0 }, { type: 'holdToggle', count: 3, now: 0 });
      expect(g).toMatchObject({ hold: true, holdBy: 'gui' });
      expect(run(g, { type: 'hold', hold: false, now: 0 }).hold).toBe(false);
    }
    // Send clears a GUI-set hold
    expect(run(base, { type: 'hold', hold: true, now: 0 }, { type: 'sendNow', now: 0 }, { type: 'sent', now: 0 }).hold).toBe(false);
  });
  it('M2: no live attachment (moved, ended, idle auto-off) ⇒ the draft is held "detached", never auto-sent', () => {
    for (const attached of [null, B]) {
      let s = run(ready(), turn(11, 'hello', 0), { type: 'context', attached, focused: A, now: 0 }, { type: 'tick', now: 1e9 });
      expect(s).toMatchObject({ sending: false, hold: true, holdBy: 'detached' });
      expect(armed(s)).toBe(false);
      expect(dictationNote(s)).toBe('draft held · voice detached');
      // a voice toggle never clears it; re-attaching does not resume it by itself
      s = run(s, { type: 'holdToggle', count: 0, now: 0 }, { type: 'holdToggle', count: 1, now: 0 }, { type: 'context', attached: A, focused: A, now: 0 }, { type: 'tick', now: 2e9 });
      expect(s).toMatchObject({ sending: false, hold: true, holdBy: 'detached' });
      expect(run(s, { type: 'hold', hold: false, now: 0 }, { type: 'tick', now: 3e9 }).sending).toBe(true); // [Resume], attached again
    }
    // armed() itself refuses a draft whose session is not the attachment, whatever the hold says
    const s = run(ready(), turn(11, 'hello', 0));
    expect(armed({ ...s, attached: null })).toBe(false);
  });
  it('M3: an edit while sending keeps hold and the edited text; turns heard in flight append to it', () => {
    let s = run(ready(), turn(11, 'one', 0), { type: 'sendNow', now: 0 }, { type: 'userEdit', text: 'one, and', now: 1 }, turn(12, 'two', 2), { type: 'sent', now: 3 });
    expect(s).toMatchObject({ text: 'one, and two', hold: true, holdBy: 'gui', edited: true, sending: false });
    // what is sent next is exactly what is shown
    expect(sendRequest(s)).toEqual({ hsid: A, content: [{ text: 'one, and two' }], source: 'voice' });
    // a failed send keeps the edit too
    s = run(ready(), turn(11, 'one', 0), { type: 'sendNow', now: 0 }, { type: 'userEdit', text: 'one!', now: 1 }, { type: 'sendFailed', now: 2 });
    expect(s).toMatchObject({ text: 'one!', hold: true });
  });
  it('L4: bidi controls never reach the composer invisibly, control characters go, and such a turn is sent as shown', () => {
    const t = insertableText({ forwardable: true, text: 'rm ‮txt.exe‬ a⁦b⁩ c\u0007d\te' })!;
    expect(t).not.toMatch(/[‪-‮⁦-⁩\u0000-\u0009\u000B-\u001F]/);
    expect(t).toContain('d e');
    const s = run(ready(), turn(11, 'x‮y', 0));
    expect(sendRequest(s)!.content[0]!.text).toBe(s.text); // never the hidden characters
  });
  it('L5: a holdToggles count from another voice connection is a new baseline (connEpoch, else client.restarts)', () => {
    expect(dictationStatusOf({ voice: { dictation: { activity: 'idle', holdToggles: 2, connEpoch: 'e7' } } }).epoch).toBe('c:e7');
    expect(dictationStatusOf({ voice: { dictation: { activity: 'idle', holdToggles: 2 }, client: { restarts: 3 } } }).epoch).toBe('r:3');
    let s = run(ready(), turn(11, 'hello', 0), { type: 'holdToggle', count: 5, epoch: 'r:0', now: 0 });
    s = run(s, { type: 'holdToggle', count: 6, epoch: 'r:1', now: 0 }); // the voice app restarted: baseline, no flip
    expect(s).toMatchObject({ hold: false, holdToggles: 6, holdEpoch: 'r:1' });
    s = run(s, { type: 'holdToggle', count: 7, epoch: 'r:1', now: 0 });
    expect(s.hold).toBe(true);
  });
  it('L1: an edited draft is echoed as a typed message (no 🎙✎ local mark)', () => {
    const app = readFileSync(path.join(ROOT, 'src/ui/app.ts'), 'utf8');
    expect(app).not.toContain("mark: 'voice-edited'");
  });
});

describe('dictation: adapters', () => {
  it('reads status.voice.dictation; an older kernel reads idle with no toggles', () => {
    expect(dictationStatusOf({ voice: { dictation: { activity: 'speaking', holdToggles: 3, at: 'x' } } })).toEqual({ activity: 'speaking', holdToggles: 3, epoch: null });
    expect(dictationStatusOf({ voice: {} })).toEqual({ activity: 'idle', holdToggles: null, epoch: null });
    expect(dictationStatusOf(null)).toEqual({ activity: 'idle', holdToggles: null, epoch: null });
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
    expect(canAttach({ principalKind: 'voice' })).toBe(false);
    expect(canAttach({ principalKind: 'human' })).toBe(true);
    expect(html).toMatch(/id="dictation"[^>]*hidden/);
  });
  it('the ring, [Hold]/[Resume], an aria-live countdown and the delay picks are wired; the composer send is the ONE send', () => {
    expect(html).toContain('id="dictation-ring"');
    expect(html).toMatch(/id="dictation-hold"[^>]*hidden/); // shown only beside a countdown
    expect(html).not.toContain('dictation-send');
    expect(app).not.toContain('dictation-send');
    const composer = /<form id="composer"[^]*?<\/form>/.exec(html)![0];
    expect(composer.match(/<button/g)?.length).toBe(2); // [Hold] (countdown only) and the one send
    expect(composer.match(/type="submit"/g)?.length).toBe(1);
    expect(composer.match(/>\s*send\s*</gi)?.length).toBe(1);
    expect(app).toMatch(/hold\.hidden = controls\.hold === null/);
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

describe('founder report 2026-10-20: one send control; Hold only beside a countdown (draftState / DRAFT_CONTROLS)', () => {
  it('idle: no draft, no controls', () => {
    const s = ready();
    expect(draftState(s)).toBe('idle');
    expect(draftControls(s)).toEqual({ hold: null, ring: false });
  });
  it('ambient draft: no countdown, so no Hold; the note says Enter sends', () => {
    let s = run(ready(), turn(11, 'hello there', 100, { mode: 'conversation' }));
    expect(draftState(s)).toBe('ambient');
    expect(draftControls(s).hold).toBeNull();
    expect(ringFraction(s, 200)).toBeNull();
    // clicking into it sets a GUI hold internally, yet nothing counts down: still no Hold/Resume, still the ambient note
    s = run(s, { type: 'focusComposer', now: 300 });
    expect(draftControls(s).hold).toBeNull();
    expect(dictationNote(s)).toBe(AMBIENT_DRAFT_NOTE);
    // a push-to-talk turn after an ambient one keeps the whole draft ambient
    s = run(s, turn(12, 'more', 400));
    expect(draftState(s)).toBe('ambient');
  });
  it('ptt countdown: Hold and the ring', () => {
    const s = run(ready(), turn(11, 'hello', 100));
    expect(draftState(s)).toBe('ptt-countdown');
    expect(draftControls(s)).toEqual({ hold: 'hold', ring: true });
    expect(ringFraction(s, 1100)).not.toBeNull();
  });
  it('ptt held (GUI, voice hotkey or detached): Resume, no ring', () => {
    const viaGui = run(ready(), turn(11, 'hello', 100), { type: 'hold', hold: true, now: 200 });
    expect(draftState(viaGui)).toBe('ptt-held');
    expect(draftControls(viaGui)).toEqual({ hold: 'resume', ring: false });
    expect(ringFraction(viaGui, 300)).toBeNull();
    const detached = run(ready(), turn(11, 'hello', 100), { type: 'context', attached: null, focused: A, now: 200 });
    expect(draftControls(detached).hold).toBe('resume');
    expect(draftState(run(viaGui, { type: 'hold', hold: false, now: 400 }))).toBe('ptt-countdown');
  });
  it('ptt with auto-send off: no countdown, no Hold', () => {
    const s = run(ready(null), turn(11, 'hello', 100));
    expect(draftState(s)).toBe('ptt-manual');
    expect(draftControls(s).hold).toBeNull();
  });
  it('no state carries a send control (the composer send is the only one)', () => {
    for (const c of Object.values(DRAFT_CONTROLS)) expect(Object.keys(c).sort()).toEqual(['hold', 'ring']);
  });
});

describe('composer: one container, not a box inside a box (founder report 2026-10-20)', () => {
  const css = readFileSync(path.join(ROOT, 'static/styles.css'), 'utf8').replace(/\/\*[^]*?\*\//g, '');
  const rules = (sel: RegExp): string[] => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => sel.test(m[1]!.trim())).map((m) => m[2]!);
  it('the composer carries the border; the textarea draws no border, outline or shadow of its own', () => {
    expect(rules(/^\.composer$/).some((b) => /border:\s*1px solid var\(--key-edge\)/.test(b))).toBe(true);
    const ta = rules(/^\.composer textarea\.field$/).join(';');
    expect(ta).toMatch(/border:\s*0/);
    expect(ta).toMatch(/outline:\s*none/);
    expect(ta).toMatch(/box-shadow:\s*none/);
    expect(rules(/\.composer textarea\.field:focus-visible/).join(';')).toMatch(/outline:\s*none/);
  });
  it('keyboard focus stays visible: the ring moves to the one container, on the shared focus token', () => {
    expect(rules(/^\.composer:has\(> textarea\.field:focus-visible\)$/).join(';')).toMatch(/outline:\s*2px solid var\(--key-edge\)/);
  });
  it('no theme or state rule gives the composer textarea a border back', () => {
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/(composer-text|\.composer[^,]*textarea)/.test(m[1]!)) expect(m[2]!).not.toMatch(/border(-\w+)?:\s*(?!0)[1-9]/);
    }
  });
});
