/**
 * #gui-dictation (TD-2026-10-20-262, T-2026-10-19-026): the pure reducer (core/dictation.ts), the store's dictation
 * transcript states, and the page wiring read from the source.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HOTKEY_UNVERIFIED_NOTE, INHERITED_DRAFT_NOTE, uncheckedWords, inheritedDraft, inheritedQuote, UNVERIFIED_DRAFT_NOTE, UNVERIFIED_QUOTE_MAX, unverifiedQuote, UNVERIFIED_WAIT_MS, pieceDue, releaseTurnRows, unverifiedDraft, unverifiedTextsOf, sendClaim, wordReady } from '../src/core/dictation.js';
import { clampedFrom, sentLabel } from '../src/core/voice-presets.js';
import { refusalPhrase, dropLabelOf } from '../src/core/capture.js';
import { dropFact } from '../src/core/voice-ladder.js';
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
    expect(dictationStatusOf({ voice: { dictation: { activity: 'speaking', holdToggles: 3, at: 'x' } } })).toEqual({ activity: 'speaking', holdToggles: 3, sendNows: null, epoch: null });
    expect(dictationStatusOf({ voice: {} })).toEqual({ activity: 'idle', holdToggles: null, sendNows: null, epoch: null });
    expect(dictationStatusOf(null)).toEqual({ activity: 'idle', holdToggles: null, sendNows: null, epoch: null });
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
    // [Hold] (countdown only), the ⤢ tall-view key (#gui-composer) and the ONE send
    expect(composer.match(/<button/g)?.length).toBe(3);
    expect(composer.match(/<button id="composer-tall"[^>]*type="button"/g)?.length).toBe(1);
    expect(composer.match(/type="submit"/g)?.length).toBe(1);
    expect(composer.match(/>\s*send\s*</gi)?.length).toBe(1);
    expect(app).toMatch(/hold\.hidden = controls\.hold === null/);
    expect(html).toMatch(/id="dictation-live"[^>]*aria-live="polite"/);
    // the delay picks moved from the pill menu to the Voice settings sheet's timing row (#gui-voice-settings)
    expect(readFileSync(path.join(ROOT, 'src', 'ui', 'voice-settings.ts'), 'utf8')).toContain('DELAY_CHOICES');
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
    for (const c of Object.values(DRAFT_CONTROLS)) for (const k of Object.keys(c)) expect(['hold', 'ring', 'grace', 'pieceRing']).toContain(k); // never a send key
  });
});

describe('composer: one container, not a box inside a box (founder report 2026-10-20)', () => {
  const css = readFileSync(path.join(ROOT, 'static/styles.css'), 'utf8').replace(/\/\*[^]*?\*\//g, '');
  const rules = (sel: RegExp): string[] => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => sel.test(m[1]!.trim())).map((m) => m[2]!);
  it('the composer carries the border; the textarea draws no border, outline or shadow of its own', () => {
    expect(rules(/^\.composer$/).some((b) => /border:\s*1px solid var\(--sec\)/.test(b))).toBe(true); // the field edge (board gnomon-field-border)
    const ta = rules(/^\.composer textarea\.field$/).join(';');
    expect(ta).toMatch(/border:\s*0/);
    expect(ta).toMatch(/outline:\s*none/);
    expect(ta).toMatch(/box-shadow:\s*none/);
    expect(rules(/\.composer textarea\.field:focus-visible/).join(';')).toMatch(/outline:\s*none/);
  });
  it('keyboard focus stays visible: the ring moves to the one container, on the shared focus token', () => {
    expect(rules(/^\.composer:has\(textarea\.field:focus-visible\)$/).join(';')).toMatch(/outline:\s*2px solid var\(--key-edge\)/);
  });
  it('no theme or state rule gives the composer textarea a border back', () => {
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/(composer-text|\.composer[^,]*textarea)/.test(m[1]!)) expect(m[2]!).not.toMatch(/border(-\w+)?:\s*(?!0)[1-9]/);
    }
  });
});

describe('Dictate, the G-VOX-06 exception (founder bug 2026-10-21): an unverified voice fills the draft, marked', () => {
  // the kernel's row for the founder's short turn: unverified, draft-only, ambient
  const unv = { mode: 'conversation', speakerId: 'spk:unknown-1', speakerEnrolled: false, draftOnly: true, speakerVerified: false };
  const dictate = (): DictationState => run(ready(5000), { type: 'setPolicy', policy: 'key', sendWord: null, now: 0 });
  it('a draftOnly row fills the draft, marked unverified; the pill says so; it never auto-sends; Enter sends it', () => {
    let s = run(dictate(), turn(11, 'fix the flaky test', 0, unv));
    expect(s.text).toBe('fix the flaky test');
    expect(s.parts[0]).toMatchObject({ unverified: true, ambient: true });
    expect(unverifiedDraft(s)).toBe(true);
    expect(dictationNote(s)).toBe(UNVERIFIED_DRAFT_NOTE);
    expect(liveLine(s, 1)).toBe(UNVERIFIED_DRAFT_NOTE);
    expect(run(s, { type: 'tick', now: 60_000 }).sending).toBe(false);
    s = run(s, { type: 'sendNow', now: 60_001 }); // Enter / [send]
    expect(s.sending).toBe(true);
    expect(sendClaim(s)).toBeNull(); // a hand send
    expect(sendRequest(s)).toEqual({ hsid: A, content: [{ text: 'fix the flaky test' }], source: 'voice' });
    // a verified turn is unmarked
    expect(run(dictate(), turn(11, 'hello', 0, { mode: 'conversation' })).parts[0]).not.toHaveProperty('unverified');
  });
  it('the send-now key never sends an unverified draft: it is held for Enter', () => {
    const s = run(dictate(), turn(11, 'delete the branch', 0, unv), { type: 'sendNowKey', now: 100 });
    expect(s.sending).toBe(false);
    expect(s.hotkeyHeld).toBe(true);
    expect(dictationNote(s)).toBe(HOTKEY_UNVERIFIED_NOTE);
  });
  it('the transcript row reads "in composer · unverified voice"', () => {
    const { items } = chatItems([{ seq: 1, kind: 'voice.turn.user', view: 'full', session: A, payload: fwd('fix it', unv) }]);
    expect(items[0]!.text).toContain('in composer · unverified voice');
    expect(items[0]!.text).toMatch(/^voice: “fix it”/); // Mika: no "unknown speaker 1" label
    expect(items[0]!.text).not.toContain('unknown');
  });
  it("a short refused turn says \"too short to check it's you\", never \"speaker not recognised\"", () => {
    expect(refusalPhrase('voice-speaker', 'too-short')).toBe("too short to check it's you · say a few more words, or type it");
    expect(dropLabelOf({ reason: 'refused', refusal: 'voice-speaker', cause: 'too-short' })).toBe("Not sent: too short to check it's you · say a few more words, or type it");
    expect(dropFact({ reason: 'refused', refusal: 'voice-speaker', cause: 'too-short' })).toBe("not sent · too short to check it's you · say a few more words, or type it");
    const { items } = chatItems([{ seq: 1, kind: 'voice.turn.user', view: 'full', session: A, payload: { turnId: 't1', speakerId: 'spk:unknown-1', speakerEnrolled: false, forwarded: false, refusedReason: 'voice-speaker', refusedCause: 'too-short', durationMs: 1200, textHash: 'hmac-sha256:00' } }]);
    expect(items[0]).toMatchObject({ role: 'voice-refused' });
    expect(items[0]!.text).toContain("too short to check it's you");
    expect(refusalPhrase('voice-speaker')).toBe('speaker not recognised');
  });
});

describe('Dictate, Aegis review 2026-10-21: an unverified voice never leaves by piece or countdown (the send word: TD-2026-10-23-496); its words never come from the log', () => {
  const unv = { mode: 'conversation', speakerId: 'spk:unknown-1', speakerEnrolled: false, draftOnly: true, speakerVerified: false };
  const WORD = { text: 'over and out', variants: [] };
  it('TD-2026-10-23-496 (supersedes [high] 2026-10-21 on this path): Dictate → Send word: the word sends the whole draft; the unchecked words are only noted', () => {
    let s = run(ready(5000), { type: 'setPolicy', policy: 'key', sendWord: null, now: 0 }, turn(11, 'drop the database', 0, unv));
    s = run(s, { type: 'setPolicy', policy: 'word', sendWord: WORD, now: 10 });
    expect(s.hold).toBe(false);
    s = run(s, { type: 'painted', now: 20 }, turn(12, 'and the tests', 30, { mode: 'conversation' }), { type: 'painted', now: 40 });
    expect(wordReady(s, 5_000)).toBe(true);
    expect(dictationNote(s)).toBe("draft · some words not checked as you · say 'over and out' or press Enter");
    s = run(s, turn(13, 'over and out', 5_000, { mode: 'conversation' }));
    expect(s.grace).not.toBeNull();
    s = run(s, { type: 'tick', now: 7_000 });
    expect(s.sending).toBe(true);
    expect(sendClaim(s)).toMatchObject({ by: 'word', turnSeq: 13 });
    expect(sendRequest(s)!.content.map((c) => c.text).join(' ')).toContain('drop the database');
    // still: send-now (the voice app's key) never sends an unverified draft, it is held for Enter
    const h = run(ready(5000), { type: 'setPolicy', policy: 'word', sendWord: WORD, now: 0 }, turn(11, 'drop it', 0, unv), { type: 'sendNowKey', now: 100 });
    expect(h.sending).toBe(false);
  });
  it('[high] Pieces never sends an unverified part; [low] the countdown never arms over one, even a push-to-talk one', () => {
    let s = run(ready(5000), { type: 'setPolicy', policy: 'pieces', sendWord: null, now: 0 }, turn(11, 'drop it', 0, unv));
    expect(pieceDue(s, 60_000)).toBe(false);
    expect(run(s, { type: 'tick', now: 60_000 }).sending).toBe(false);
    s = run(ready(3000), turn(11, 'drop it', 0, { ...unv, mode: 'ptt' }));
    expect(ambientDraft(s)).toBe(false);
    expect(armed(s)).toBe(false);
    expect(run(s, { type: 'tick', now: 60_000 }).sending).toBe(false);
  });
  it('privacy: a hash-only draftOnly row waits for its words from status.voice.unverified, in order; wordless after the wait', () => {
    const q = [
      { seq: 11, hsid: A, payload: { mode: 'conversation', forwardable: true, draftOnly: true, textHash: 'hmac-sha256:00' }, at: 0 },
      { seq: 12, hsid: A, payload: fwd('and the tests', { mode: 'conversation' }), at: 10 },
    ];
    const none = releaseTurnRows(q, new Map(), 100);
    expect(none.ready).toEqual([]); // the verified row behind it waits too: the draft keeps the order
    expect(none.rest).toHaveLength(2);
    const texts = unverifiedTextsOf({ voice: { unverified: [{ seq: 11, hsid: A, text: 'drop the database' }, { seq: 'x', text: 'junk' }] } });
    expect([...texts]).toEqual([[11, 'drop the database']]);
    const got = releaseTurnRows(q, texts, 200);
    expect(got.rest).toEqual([]);
    const s = got.ready.reduce((st, r) => reduceDictation(st, { type: 'turnRow', seq: r.seq, hsid: r.hsid, payload: r.payload, now: 300 }), ready());
    expect(s.text).toBe('drop the database and the tests');
    expect(s.parts.map((p) => !!p.unverified)).toEqual([true, false]);
    // never delivered: after the wait it goes on wordless and never becomes a draft part
    const late = releaseTurnRows(q, new Map(), UNVERIFIED_WAIT_MS);
    const s2 = late.ready.reduce((st, r) => reduceDictation(st, { type: 'turnRow', seq: r.seq, hsid: r.hsid, payload: r.payload, now: 300 }), ready());
    expect(s2.text).toBe('and the tests');
    expect(unverifiedDraft(s2)).toBe(false);
  });
  it('the transcript: a hash-only unverified row reads "voice · in composer · unverified voice" (no words, no speaker); sent, it hides', () => {
    const row: Row = { seq: 1, kind: 'voice.turn.user', view: 'full', session: A, payload: { turnId: 't1', speakerId: 'spk:unknown-1', speakerEnrolled: false, forwardable: true, draftOnly: true, mode: 'conversation', textHash: 'hmac-sha256:00' } };
    expect(chatItems([row]).items[0]!.text).toBe('voice · in composer · unverified voice');
    const sent: Row = { seq: 2, kind: 'turn.sent', view: 'full', session: A, payload: { source: 'voice', voiceTurnSeqs: [1], origin: 'voice-unverified', sentBy: 'unverified' } };
    expect(chatItems([row, sent]).items.some((i) => i.text.includes('in composer'))).toBe(false);
  });
  it('clamp display: a voice-unverified turn.sent asks first and lights the clamp chip until its result', () => {
    expect(sentLabel({ source: 'voice', origin: 'voice-unverified', sentBy: 'unverified' })).toEqual({ label: 'spoken · unverified voice · sent by you', asksFirst: true });
    expect(sentLabel({ origin: 'voice-unverified', sentBy: 'unverified' })).toMatchObject({ asksFirst: true });
    const rows = [{ kind: 'turn.sent', session: A, payload: { origin: 'voice-unverified' } }];
    expect(clampedFrom(rows, A)).toBe(true);
    expect(clampedFrom([...rows, { kind: 'turn.result', session: A, payload: {} }], A)).toBe(false);
  });
});

describe('Mika 2026-10-21: a mixed draft names its unverified words', () => {
  const unv = { mode: 'conversation', speakerId: 'spk:unknown-1', speakerEnrolled: false, draftOnly: true };
  const dictate = (): DictationState => run(ready(5000), { type: 'setPolicy', policy: 'key', sendWord: null, now: 0 });
  it('quotes the unverified words in a mixed draft; an all-unverified draft keeps the plain note', () => {
    const mixed = run(dictate(), turn(11, 'open the ledger', 0, { mode: 'conversation' }), turn(12, 'and run the billing tests', 10, unv));
    expect(dictationNote(mixed)).toBe('draft · unverified voice: “and run the billing tests” · read it, then Enter sends');
    expect(unverifiedQuote(mixed)).toEqual({ short: 'and run the billing tests', full: 'and run the billing tests' });
    expect(dictationNote(run(dictate(), turn(11, 'only me', 0, unv)))).toBe(UNVERIFIED_DRAFT_NOTE);
  });
  it('a long quote is cut with …; the full words stay for the title', () => {
    const long = 'please run every single billing and invoicing test in the repository now';
    const s = run(dictate(), turn(11, 'ok', 0, { mode: 'conversation' }), turn(12, long, 10, unv));
    const q = unverifiedQuote(s)!;
    expect(q.full).toBe(long);
    expect(q.short.endsWith('…')).toBe(true);
    expect([...q.short].length).toBeLessThanOrEqual(UNVERIFIED_QUOTE_MAX);
    expect(dictationNote(s)).toBe(`draft · unverified voice: “${q.short}” · read it, then Enter sends`);
  });
});

describe('Aegis H-1 (2026-10-23): words that inherited their speaker are marked "not checked as you"', () => {
  const inh = { mode: 'conversation', speakerBasis: 'continuity' };
  const ver = { mode: 'conversation' };
  it('the draft note, the transcript row and the pieces rule', () => {
    let s = run(ready(5000), { type: 'setPolicy', policy: 'key', sendWord: null, now: 0 }, turn(11, 'please fix the flaky test', 0, ver), turn(12, 'and the docs', 100, inh));
    expect(s.parts[1]).toMatchObject({ inherited: true });
    expect(s.parts[0]).not.toHaveProperty('inherited');
    expect(inheritedDraft(s)).toBe(true);
    expect(dictationNote(s)).toBe('draft · “and the docs” not checked as you, so edits ask first');
    expect(inheritedQuote(s)).toEqual({ short: 'and the docs', full: 'and the docs' });
    s = run(ready(5000), { type: 'setPolicy', policy: 'key', sendWord: null, now: 0 }, turn(11, 'yes', 0, inh));
    expect(dictationNote(s)).toBe(INHERITED_DRAFT_NOTE);
    const w = run(ready(5000), { type: 'setPolicy', policy: 'word', sendWord: { text: 'over and out', variants: [] }, now: 0 }, turn(11, 'ship it', 0, ver), turn(12, 'now', 100, inh));
    expect(dictationNote(w)).toBe("draft · some words not checked as you · say 'over and out' or press Enter"); // TD-2026-10-23-496
    expect(uncheckedWords(w)).toBe('now'); // the note's title names them
    // Mika: a wholly unchecked draft is not 'some words'
    const wa = run(ready(5000), { type: 'setPolicy', policy: 'word', sendWord: { text: 'over and out', variants: [] }, now: 0 }, turn(11, 'yes', 0, inh));
    expect(dictationNote(wa)).toBe("draft · not checked as you · say 'over and out' or press Enter");
    expect(uncheckedWords(wa)).toBeNull();
    // a piece needs a part checked as the human
    const p = run(ready(5000), { type: 'setPolicy', policy: 'pieces', sendWord: null, now: 0 }, turn(11, 'yes', 0, inh));
    expect(pieceDue(p, 60_000)).toBe(false);
    expect(dictationNote(p)).toBe('draft · not checked as you · Enter sends it'); // Mika: the piece waits, so say what sends it
    const p2 = run(ready(5000), { type: 'setPolicy', policy: 'pieces', sendWord: null, now: 0 }, turn(11, 'please fix it', 0, ver), turn(12, 'yes', 100, inh));
    expect(pieceDue(p2, 60_000)).toBe(true);
    expect(dictationNote(p2)).toBe('draft · “yes” not checked as you · sending in pieces');
    const { items } = chatItems([{ seq: 1, kind: 'voice.turn.user', view: 'full', session: A, payload: fwd('and the docs', inh) }]);
    expect(items[0]!.text).toContain('in composer · not checked as you');
    expect(items[0]!.text).toMatch(/^Matt: “and the docs”/);
  });

  it('Talk (narrow): a short unverified push-to-talk turn stops the countdown; only Enter sends it', () => {
    const unvPtt = { mode: 'ptt', speakerId: 'spk:unknown-1', speakerEnrolled: false, draftOnly: true, speakerVerified: false };
    let s = run(ready(3000), turn(11, 'yes', 0, unvPtt));
    expect(s.parts[0]).toMatchObject({ unverified: true });
    expect(armed(s)).toBe(false);
    s = run(s, { type: 'tick', now: 60_000 });
    expect(s.sending).toBe(false);
    expect(dictationNote(s)).toBe(UNVERIFIED_DRAFT_NOTE);
    expect(run(s, { type: 'sendNow', now: 60_001 }).sending).toBe(true);
  });
});
