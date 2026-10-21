/**
 * #gui-voice-ladder, #gui-voice-settings, #gui-composer (Atelier 2026-10-21-gnomon-voice, direction.html): the trust
 * ladder replacing the old pill menu, the pill's one live fact, a not-ready rung opening the sheet, the inline teaching
 * in the sheet, the growing composer and its one send control, the transcript labels. Pure models plus the DOM builders
 * over a fake document; the page wiring is read from the source.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { recordTrialTake, startSendWordTrial, trialTakeNumber, type SendWordTrialState } from '@a-company/gnomon-contracts';
import { chooseRung, clientFactOf, dropFact, ladderEntries, ladderFoot, PIECES_TIMING, presetOfRung, rungOf, sendOfRung, sheetRows, stateOfRung, voicePillOf, type PillInput } from '../src/core/voice-ladder.js';
import { COMPOSER_LINES, COMPOSER_TALL_LINES, composerFit, lineCountLabel, parseTall, serializeTall } from '../src/core/composer.js';
import { initialTeach, reduceTeach, type TeachEvent, type TeachState } from '../src/core/send-word-teach.js';
import { enrolStart } from '../src/core/voice-client.js';
import { CARD_VOICE_LINE, cardVoiceOrigin, CLAMP_CHIP, sentLabel } from '../src/core/voice-presets.js';
import { renderCard, type MiniDoc, type MiniEl } from '../src/core/render.js';
import { ladderEls, sheetEls, sheetKey, type SheetView } from '../src/ui/voice-settings.js';
import { voiceStatusOf } from '../src/core/voice.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
const HTML = readFileSync(path.join(ROOT, 'static', 'index.html'), 'utf8');
const CSS = readFileSync(path.join(ROOT, 'static', 'styles.css'), 'utf8');

class FText {
  constructor(readonly data: string) {}
}
class FEl implements MiniEl {
  className = '';
  readonly attrs = new Map<string, string>();
  readonly children: Array<FEl | FText> = [];
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
  all(pred: (e: FEl) => boolean): FEl[] {
    const out: FEl[] = pred(this) ? [this] : [];
    for (const c of this.children) if (c instanceof FEl) out.push(...c.all(pred));
    return out;
  }
}
const fdoc: MiniDoc = { createElement: (t) => new FEl(t), createTextNode: (s) => new FText(s) };
const root = (els: MiniEl[]): FEl => {
  const r = new FEl('div');
  for (const e of els) r.appendChild(e);
  return r;
};

const base: PillInput = { rung: 'off', hotkey: '⌃⌥Space', sendWord: null, attached: false, target: '', clientConnected: true, clientFact: null, capture: null, clamped: false, micClosed: false, micKeyBare: false, heardAgoS: null };
const pill = (o: Partial<PillInput>) => voicePillOf({ ...base, ...o });
const display = (state: 'idle' | 'hearing' | 'transcribing' | 'captured' | 'dropped', className = `capture-${state}`) => ({ state, label: state === 'idle' ? null : 'x', className, meter: 0, ghost: false, ghostText: null, caption: '', flashLeftMs: null });

describe('the pill: rung name + ONE live fact (design-system gnomon.voice.pill)', () => {
  it('at rest per rung: Voice off, hold ⌃⌥Space, listening, say “send”, mic off · ⌃`, heard Ns ago', () => {
    expect(pill({})).toMatchObject({ name: 'Voice off', fact: '', live: false, tone: 'plain' });
    expect(pill({ rung: 'talk', attached: true })).toMatchObject({ name: 'Talk', fact: 'hold ⌃⌥Space', live: false });
    expect(pill({ rung: 'dictate', attached: true })).toMatchObject({ name: 'Dictate', fact: 'listening', live: true });
    expect(pill({ rung: 'word', attached: true, sendWord: 'send' })).toMatchObject({ name: 'Send word', fact: 'say “send”', live: true });
    expect(pill({ rung: 'pieces', attached: true })).toMatchObject({ name: 'Pieces', fact: 'listening', live: true });
    expect(pill({ rung: 'dictate', attached: true, micClosed: true })).toMatchObject({ fact: 'mic off · ⌃`', live: false });
    expect(pill({ rung: 'dictate', attached: true, micClosed: true, micKeyBare: true }).fact).toBe('mic off · `');
    expect(pill({ rung: 'dictate', attached: true, heardAgoS: 4.2 }).fact).toBe('heard 4s ago');
    expect(pill({ rung: 'dictate', attached: true, heardAgoS: 61 }).fact).toBe('listening'); // gone after a minute
    expect(pill({ rung: 'word', attached: true, sendWord: 'over', heardAgoS: 3 }).fact).toBe('say “over”'); // the word is the instruction
  });
  it('never only a glyph; the accessible name carries the mic state', () => {
    for (const r of ['off', 'talk', 'dictate', 'word', 'pieces'] as const) expect(pill({ rung: r, attached: r !== 'off' }).name.length).toBeGreaterThan(2);
    expect(pill({ rung: 'dictate', attached: true }).aria).toBe('Voice: Dictate, mic open, listening');
    expect(pill({ rung: 'talk', attached: true }).aria).toBe('Voice: Talk, mic closed, hold ⌃⌥Space');
  });
  it('a clamped voice-origin turn: the amber edge and "edits ask first"; the edge stays under a louder fact', () => {
    expect(pill({ rung: 'word', attached: true, sendWord: 'send', clamped: true })).toMatchObject({ fact: 'edits ask first', tone: 'clamp', clamped: true });
    const drop = pill({ rung: 'word', attached: true, clamped: true, capture: { display: display('dropped'), cap: { reason: 'refused', refusal: 'voice-playback', cause: null } } });
    expect(drop).toMatchObject({ fact: 'not sent · Claude was still finishing', tone: 'fail', clamped: true });
  });
  it('speech not sent: vermilion, the reason in words; a mic-off drop is just the mic key', () => {
    expect(dropFact({ reason: 'too-short', refusal: null, cause: null })).toBe('not sent · too short to catch');
    expect(dropFact({ reason: 'refused', refusal: 'voice-speaker', cause: null })).toBe('not sent · speaker not recognised');
    expect(pill({ rung: 'dictate', attached: true, capture: { display: display('dropped'), cap: { reason: 'mic-off', refusal: null, cause: null } } })).toMatchObject({ fact: 'mic off · ⌃`', tone: 'plain' });
  });
  it('capture and the voice app: hearing you…, catching that…, got it; the app’s condition as one lowercase fact', () => {
    expect(pill({ rung: 'talk', attached: true, capture: { display: display('hearing'), cap: null } })).toMatchObject({ fact: 'hearing you…', live: true });
    expect(pill({ rung: 'dictate', attached: true, capture: { display: display('transcribing'), cap: null } }).fact).toBe('catching that…');
    expect(pill({ rung: 'dictate', attached: true, capture: { display: display('captured'), cap: null } }).fact).toBe('got it');
    expect(clientFactOf('Voice app not running', null)).toBe('voice app not running');
    expect(clientFactOf(null, ' · voice crashed: boom')).toBe('voice crashed: boom');
    expect(pill({ clientFact: 'voice app not running' })).toMatchObject({ name: 'Voice off', fact: 'voice app not running' });
    // a disconnected voice app never reads as an open mic
    expect(pill({ rung: 'dictate', attached: true, clientConnected: false }).live).toBe(false);
  });
});

describe('the ladder replaces the pill menu (design-system gnomon.voice.model)', () => {
  const L = (o: Partial<Parameters<typeof ladderEntries>[0]> = {}) => ladderEntries({ rung: 'dictate', hotkey: '⌃⌥Space', attachable: true, target: 'hs:A', ceiling: 'ambient', acked: false, sendWord: null, ...o });
  it('five rungs in trust order, one line each, cost tags', () => {
    const e = L();
    expect(e.map((x) => x.name)).toEqual(['Off', 'Talk', 'Dictate', 'Send word', 'Pieces']);
    expect(e.map((x) => x.line)).toEqual(['the mic is closed', 'hold to speak; sends after release', 'open mic fills the box; you press Enter', 'say your word to send · edits ask first', 'each pause sends · edits ask first']);
    expect(e.find((x) => x.rung === 'talk')).toMatchObject({ tag: '⌃⌥Space', tagKind: 'key' });
    expect(e.find((x) => x.rung === 'word')).toMatchObject({ tag: 'set up', tagKind: 'setup', needs: 'sendword' });
    expect(e.find((x) => x.rung === 'dictate')?.current).toBe(true);
    const ready = L({ acked: true, sendWord: { text: 'over', variants: [] } });
    expect(ready.find((x) => x.rung === 'word')).toMatchObject({ tag: '“over”', needs: null });
    expect(ready.find((x) => x.rung === 'pieces')).toMatchObject({ tag: 'Touch ID', tagKind: 'cost', needs: null });
  });
  it('rungs map onto the existing mode × preset machinery', () => {
    expect(['off', 'talk', 'dictate', 'word', 'pieces'].map((r) => [stateOfRung(r as never), presetOfRung(r as never), sendOfRung(r as never)])).toEqual([
      ['off', null, null],
      ['ptt', 'talk', null],
      ['ambient', 'dictate', null],
      ['ambient', 'send-word', 'word'],
      ['ambient', 'pieces', 'pieces'],
    ]);
    // the kernel's send ceiling wins over the page's preset; ambient is never Talk
    const amb = (send: unknown) => voiceStatusOf({ voice: { attached: true, hsid: 'hs:A', ceiling: 'conversation', send } });
    expect(rungOf(amb('word'), 'dictate')).toBe('word');
    expect(rungOf(amb('key'), 'send-word')).toBe('dictate');
    expect(rungOf(amb(undefined), 'pieces')).toBe('pieces');
    expect(rungOf(amb(undefined), 'talk')).toBe('dictate');
    expect(rungOf(voiceStatusOf({ voice: { attached: true, hsid: 'hs:A', ceiling: 'ptt' } }), 'dictate')).toBe('talk');
    expect(rungOf(voiceStatusOf({ voice: { attached: false } }), 'pieces')).toBe('off');
  });
  it('a rung that is not ready opens the sheet at that section instead of failing', () => {
    expect(chooseRung('word', { acked: true, sendWord: null })).toEqual({ kind: 'setup', section: 'sendword' });
    expect(chooseRung('word', { acked: false, sendWord: { text: 'over', variants: [] } })).toEqual({ kind: 'setup', section: 'sendword' });
    expect(chooseRung('pieces', { acked: false, sendWord: null })).toEqual({ kind: 'setup', section: 'risk' });
    expect(chooseRung('pieces', { acked: true, sendWord: null })).toEqual({ kind: 'apply' });
    expect(chooseRung('dictate', { acked: false, sendWord: null })).toEqual({ kind: 'apply' });
    // the page: a setup rung closes the ladder and opens Voice settings at the section, the rung waiting
    const fn = APP.slice(APP.indexOf('async function chooseRungUi('), APP.indexOf('/** Open the Voice settings sheet'));
    expect(fn).toMatch(/if \(!trusted\) return;/);
    expect(fn).toMatch(/if \(c\.kind === 'setup'\) \{\s*closeVoiceMenu\(false\);\s*return openVoiceSettings\(c\.section, r\);/);
    expect(fn).toContain('await setVoice(to, voiceTargetFor(to), true, sendOfRung(r));');
  });
  it('without a session only Off is offered; a ceiling says why in words', () => {
    const e = L({ target: null });
    expect(e.filter((x) => !x.disabled).map((x) => x.rung)).toEqual(['off']);
    expect(e[1]!.why).toBe('open a session first');
    expect(L({ ceiling: 'ptt' }).find((x) => x.rung === 'dictate')).toMatchObject({ disabled: true, why: "this session's voice ceiling is Talk" });
  });
  it('the DOM: menuitemradio rungs, the foot (mic key · listen) and "voice settings…"; the old items are gone', () => {
    const r = root(ladderEls(fdoc, L(), ladderFoot({ micKeyBare: false, capture: 'open' })));
    const rungs = r.all((e) => e.attrs.get('role') === 'menuitemradio');
    expect(rungs.map((b) => b.attrs.get('data-rung'))).toEqual(['off', 'talk', 'dictate', 'word', 'pieces']);
    expect(rungs.find((b) => b.attrs.get('data-rung') === 'dictate')!.attrs.get('aria-checked')).toBe('true');
    expect(rungs.find((b) => b.attrs.get('data-rung') === 'word')!.attrs.get('data-needs')).toBe('sendword');
    expect(r.text).toContain('mic key ⌃` · listen: always');
    expect(r.all((e) => e.attrs.has('data-vs-open'))[0]!.text).toBe('voice settings…');
    expect(ladderFoot({ micKeyBare: true, capture: 'toggle' })).toBe('mic key ` · listen: mic key');
    for (const old of ['Push-to-talk', 'Ambient', 'auto-send after', 'Listening:', 'Mic key:', 'Teach Gnomon your send word', 'Change your send word', 'Start voice', 'Attach to', 'hotkeys (voice app)']) expect(r.text).not.toContain(old);
    // nor in the page: the stacked delay buttons, the Send preset buttons and the Off/PTT/Ambient list left the menu
    for (const old of ['data-dictation-delay', 'data-voice-preset', 'data-voice-sendword', 'data-mic-key', 'data-capture', "'data-voice'", 'data-voice-client', 'Push-to-talk auto-send after']) expect(APP).not.toContain(old);
    expect(HTML).toMatch(/<div id="voice-menu" class="voice-ladder" role="menu"[^>]*hidden><\/div>/);
  });
  it('a11y: the pill controls the menu, ↓ opens it, arrows move, Esc returns to the pill; the sheet is a dialog', () => {
    expect(HTML).toMatch(/<button id="voice-pill"[^>]*aria-haspopup="menu" aria-expanded="false" aria-controls="voice-menu"/);
    expect(APP).toMatch(/e\.key === 'ArrowDown' && \$\('voice-menu'\)\.hidden/);
    expect(APP).toMatch(/if \(e\.key === 'ArrowDown'\) go\(at \+ 1\);\s*else if \(e\.key === 'ArrowUp'\) go\(at - 1\);/);
    expect(APP).toMatch(/e\.key === 'Escape' && !\$\('voice-menu'\)\.hidden\) \{\s*closeVoiceMenu\(true\);/);
    expect(APP).toMatch(/e\.key === 'Escape' && voiceSheet\.isOpen\(\)\) \{\s*voiceSheet\.close\(\);/);
    expect(HTML).toMatch(/<div id="voice-settings" class="overlay vs-drawer" hidden>\s*<div class="sheet-card settings-card voice-sheet" role="dialog" aria-modal="true" aria-labelledby="voice-settings-title">/);
    expect(CSS).toMatch(/\.rung:focus-visible \{ outline: 2px solid var\(--key-edge\)/);
    expect(CSS).toMatch(/\.link:focus-visible \{ outline: 2px solid var\(--key-edge\)/);
    // kernel-owned: no layout preset can hide the pill
    expect(HTML).toMatch(/<button id="voice-pill" class="voice-pill kernel-owned/);
    // the old teach / acknowledgement / enrolment dialogs are gone (teaching is inline in the sheet)
    for (const id of ['sendword-dialog', 'ack-dialog', 'enrol-dialog']) expect(HTML).not.toContain(`id="${id}"`);
  });
});

/* ── the Voice settings sheet ───────────────────────────────────────── */
const trialStatus = (t: SendWordTrialState | null): TeachEvent => ({ type: 'status', status: { voice: { sendWordTrial: t ? { word: t.word, state: t.state, take: trialTakeNumber(t), takes: t.takes, maxTakes: t.maxTakes, correct: t.correct, variants: t.variants, last: t.last, until: '2026-10-21T00:02:00.000Z' } : null } } });
const takes = (word: string, ...heard: string[]): SendWordTrialState => heard.reduce(recordTrialTake, startSendWordTrial(word)!);
const run = (s: TeachState, ...es: TeachEvent[]): TeachState => es.reduce(reduceTeach, s);
const rows = (o: Partial<Parameters<typeof sheetRows>[0]> = {}) => sheetRows({ acked: false, sendWord: null, enrolled: ['matt'], reteach: false, micKeyBare: false, capture: 'open', delayMs: 3000, hotkey: '⌃⌥Space', attachable: true, ...o });
const view = (o: Partial<SheetView> = {}): SheetView => ({ rows: rows(), flow: null, delayMs: 3000, attachable: true, ...o });

describe('the Voice settings sheet: one place for everything voice configures', () => {
  it('six rows: your voice, send word, keys, listen, timing, risk', () => {
    const r = rows();
    expect(r.map((x) => x.label)).toEqual(['your voice', 'send word', 'keys', 'listen', 'timing', 'risk']);
    expect(r[0]).toMatchObject({ value: 'taught · matt', tone: 'ok', action: { label: 'retrain', act: 'enrol' } });
    expect(r[1]).toMatchObject({ value: 'not set', tone: 'warn', action: { label: 'set up' } });
    expect(rows({ sendWord: { text: 'over', variants: ['ova', 'oh ver'] } })[1]).toMatchObject({ value: '“over” · 2 variants', action: { label: 'change' } });
    expect(r[2]!.value).toBe('talk ⌃⌥Space · mic ⌃` · send now ⌃⌥Return');
    expect(r[3]).toMatchObject({ value: 'always on (open-mic rungs)', action: { label: 'use mic key', act: 'listen.toggle' } });
    expect(PIECES_TIMING).toBe('pieces pause 1.5 s, up to 8 s');
    expect(r[5]).toMatchObject({ value: 'not acknowledged', tone: 'warn' });
    expect(rows({ acked: true })[5]).toMatchObject({ value: 'acknowledged', tone: 'ok', action: null });
    expect(rows({ enrolled: [] })[0]).toMatchObject({ tone: 'warn', action: { label: 'teach' } });
  });
  it('timing: the Talk delay 3/5/8/15/off is a segmented control with a selected state', () => {
    const r = root(sheetEls(fdoc, view({ delayMs: 8000, rows: rows({ delayMs: 8000 }) })));
    const keys = r.all((e) => e.attrs.has('data-vs-delay'));
    expect(keys.map((k) => k.text)).toEqual(['3 s', '5 s', '8 s', '15 s', 'off']);
    expect(keys.map((k) => k.attrs.get('aria-checked'))).toEqual(['false', 'false', 'true', 'false', 'false']);
    expect(keys.every((k) => k.attrs.get('role') === 'radio')).toBe(true);
    expect(r.all((e) => e.attrs.get('role') === 'radiogroup')[0]!.attrs.get('aria-label')).toBe('Talk sends after');
    expect(r.text).toContain('talk sends after 8 s · pieces pause 1.5 s, up to 8 s');
    expect(rows({ delayMs: null })[4]!.value).toBe('talk sends after you press Enter · pieces pause 1.5 s, up to 8 s');
  });
  it('the send word teaches INLINE under its row: pick, say once, I heard, one counter, risk check, save', () => {
    let s = initialTeach();
    const paint = () => root(sheetEls(fdoc, view({ flow: { kind: 'teach', s, attached: true } })));
    let r = paint();
    const sec = r.all((e) => e.attrs.get('data-vs-section') === 'sendword')[0]!;
    expect(sec.className).toContain('open');
    expect(sec.all((e) => e.className === 'vs-flow').length).toBe(1); // under ITS row
    expect(sec.all((e) => e.attrs.has('data-vs-pick')).map((b) => b.text)).toEqual(['send', 'send it', 'over']);
    expect(sec.all((e) => e.attrs.has('data-vs-custom'))[0]!.attrs.get('placeholder')).toBe('your own…');
    s = run(s, { type: 'pick', text: 'send it' });
    r = paint();
    expect(r.text).toContain('Say “send it” once, on its own.');
    expect(r.text).toContain('take 1 of up to 4');
    expect(r.text.match(/take \d of up to/g)).toHaveLength(1); // ONE counter
    s = run(s, trialStatus(takes('send it')), trialStatus(takes('send it', 'sand it')));
    r = paint();
    expect(r.text).toContain('I heard “sand it”. Say it again.');
    expect(r.text).toContain('take 2 of up to 4');
    expect(r.text).toContain('kept as a variant: “sand it”');
    const rm = r.all((e) => e.attrs.get('data-vs-variant') === 'sand it')[0]!;
    expect(rm.text).toBe('remove'); // a remove control per collected variant
    s = run(s, { type: 'dropVariant', variant: 'sand it' });
    expect(paint().all((e) => e.attrs.get('data-vs-variant') === 'sand it')[0]!.text).toBe('keep');
    s = run(s, { type: 'dropVariant', variant: 'sand it' });
    s = run(s, trialStatus(takes('send it', 'sand it', 'send it')));
    r = paint();
    expect(r.text).toContain('I heard: “send it” ✓');
    expect(r.text).toContain('I understand a misheard or other voice can send for me; edits will still ask.');
    const save = r.all((e) => e.attrs.get('data-vs-teach') === 'save')[0]!;
    expect(save.text).toBe('save “send it”');
    expect(save.attrs.has('disabled')).toBe(true); // the box first
    s = run(s, { type: 'ack', on: true });
    expect(paint().all((e) => e.attrs.get('data-vs-teach') === 'save')[0]!.attrs.has('disabled')).toBe(false);
    // never the product name; takes never reach the transcript (send-word-teach.test.ts)
    expect(paint().text).not.toMatch(/gnomon/i);
  });
  it('the page drives the kernel trial: start{word, trial}, save, clear{trial}; the sheet closing ends it', () => {
    expect(APP).toContain("payload: { op: 'start', word, trial: true }");
    expect(APP).toContain("{ kind: 'request.voice.sendword', payload: commit }");
    expect(APP).toContain("payload: { op: 'clear', trial: true }");
    expect(APP).toMatch(/onClose: \(\) => \{\s*pendingRung = null;\s*setFlow\(null\);/);
    expect(APP).toMatch(/if \(vsFlow === 'teach' && f !== 'teach'\) void endTeach\(\);/);
    // only a LISTENING trial counts a turn as a take; with the row open nothing heard becomes a draft
    expect(APP).toMatch(/if \(r\.kind === 'voice\.turn\.user' && teachOpen\(\)\) \{\s*if \(r\.seq > dict\.lastSeq\) dict = \{ \.\.\.dict, lastSeq: r\.seq \};\s*if \(teach\?\.step === 'takes'\) teachHeard\(\);\s*return;/);
    expect(APP).toContain("if (teach) teach = reduceTeach(teach, { type: 'dropVariant', variant: value });");
    // the risk check right before save IS the acknowledgement
    expect(APP).toMatch(/payload: commit \}\);\s*if \(me\) recordAck\(localStorage, me\);/);
  });
  it('Pieces waits on the risk row: the exact text, "I understand", then "turn on Pieces"', () => {
    const r = root(sheetEls(fdoc, view({ flow: { kind: 'risk', rung: 'pieces', ack: false } })));
    const sec = r.all((e) => e.attrs.get('data-vs-section') === 'risk')[0]!;
    expect(sec.text).toContain('I understand a misheard or other voice can send for me; edits will still ask.');
    const go = sec.all((e) => e.attrs.get('data-vs-risk') === 'go')[0]!;
    expect(go.text).toBe('turn on Pieces');
    expect(go.attrs.has('disabled')).toBe(true);
    expect(root(sheetEls(fdoc, view({ flow: { kind: 'risk', rung: 'pieces', ack: true } }))).all((e) => e.attrs.get('data-vs-risk') === 'go')[0]!.attrs.has('disabled')).toBe(false);
  });
  it('your voice: phrase N of 3 with the phrase shown and a level meter, inline', () => {
    const s = { ...enrolStart(), step: 'phrase' as const, name: 'matt', index: 1, recording: true, since: 0 };
    const r = root(sheetEls(fdoc, view({ flow: { kind: 'enrol', s, name: 'matt', agreed: true, enrolled: ['matt'], forgetArmed: null, level: 0.4 } })));
    const sec = r.all((e) => e.attrs.get('data-vs-section') === 'voice')[0]!;
    expect(sec.text).toContain('phrase 2 of 3 · recording');
    expect(sec.text).toContain('“Please run the tests and tell me what failed.”');
    expect(sec.all((e) => e.attrs.has('data-vs-meter'))).toHaveLength(1);
    // the live level never forces a repaint (set on the meter directly)
    const a = view({ flow: { kind: 'enrol', s, name: 'matt', agreed: true, enrolled: ['matt'], forgetArmed: null, level: 0.1 } });
    const b = view({ flow: { kind: 'enrol', s, name: 'matt', agreed: true, enrolled: ['matt'], forgetArmed: null, level: 0.9 } });
    expect(sheetKey(a)).toBe(sheetKey(b));
  });
  it('keys: change the mic key through the existing mic-key op; the bare ` opt-in carries its warning', () => {
    const r = root(sheetEls(fdoc, view({ flow: { kind: 'keys', bare: false } })));
    expect(r.all((e) => e.attrs.has('data-vs-mickey')).map((b) => [b.attrs.get('data-vs-mickey'), b.attrs.get('aria-checked')])).toEqual([['ctrl', 'true'], ['bare', 'false']]);
    expect(r.text).toContain('while Gnomon voice runs, ` will not type in any app');
    expect(APP).toContain("else if (action === 'mickey') void setMicKey(value === 'bare', true);");
    expect(APP).toContain("payload: { op: 'mic-key', bare }");
  });
  it('every sheet press is a trusted gesture; the palette and Settings open the same sheet', () => {
    expect(APP).toMatch(/function sheetAct\(action: string, value: string, trusted: boolean\): void \{\s*if \(!trusted\) return;/);
    expect(APP).toContain("else if (id === 'voice.settings.open') openVoiceSettings();");
  });
});

describe('the composer grows, caps, and has a tall view; ONE send control (gnomon.voice.composer)', () => {
  it('grows with its text to 12 lines, then scrolls; the tall view raises the cap to 24', () => {
    const lh = 21.6;
    expect(composerFit(lh * 1 + 4, lh, 4, false)).toEqual({ heightPx: Math.round(lh + 4), lines: 1, scrolls: false, cap: COMPOSER_LINES });
    expect(composerFit(lh * 7 + 4, lh, 4, false)).toMatchObject({ heightPx: Math.round(lh * 7 + 4), lines: 7, scrolls: false });
    expect(composerFit(lh * 12 + 4, lh, 4, false)).toMatchObject({ lines: 12, scrolls: false });
    expect(composerFit(lh * 30 + 4, lh, 4, false)).toMatchObject({ heightPx: Math.round(lh * 12 + 4), lines: 30, scrolls: true });
    expect(composerFit(lh * 30 + 4, lh, 4, true)).toMatchObject({ heightPx: Math.round(lh * COMPOSER_TALL_LINES + 4), lines: 30, scrolls: true, cap: 24 });
    expect(composerFit(lh * 18 + 4, lh, 4, true)).toMatchObject({ lines: 18, scrolls: false });
    expect(composerFit(0, lh, 4, false).lines).toBe(1); // empty still shows one line
    expect(lineCountLabel(1)).toBe('1 line');
    expect(lineCountLabel(14)).toBe('14 lines');
  });
  it('the tall view persists per viewer', () => {
    expect(parseTall(serializeTall(true))).toBe(true);
    expect(parseTall(serializeTall(false))).toBe(false);
    expect(parseTall(null)).toBe(false);
    expect(APP).toMatch(/let composerTall = parseTall\(localStorage\.getItem\(TALL_KEY\)\);/);
    expect(APP).toContain('localStorage.setItem(TALL_KEY, serializeTall(composerTall));');
    expect(APP).toMatch(/\$\('composer-text'\)\.addEventListener\('input', \(\) => \{\s*fitComposer\(\);/);
  });
  it('the composer region has exactly one send control, the ⤢ key and the line count beside it', () => {
    const composer = /<form id="composer"[^]*?<\/form>/.exec(HTML)![0];
    expect(composer.match(/type="submit"/g)).toHaveLength(1);
    expect(composer.match(/>\s*send\s*</gi)).toHaveLength(1);
    expect(composer).toMatch(/<button id="composer-tall" class="key quiet composer-tall" type="button" aria-pressed="false" aria-controls="composer-text"[^>]*>⤢<\/button>/);
    expect(composer).toContain('<span id="composer-lines" class="meta composer-lines">1 line</span>');
    expect(CSS).not.toMatch(/\.composer textarea \{[^}]*max-height: 40vh/);
  });
});

describe('labels: spoken · sent by …, edits ask first, the chip and the card line', () => {
  it('every way a spoken turn is sent has its words', () => {
    expect(sentLabel({ origin: 'hand', source: 'voice' })!.label).toBe('spoken · sent by you');
    expect(sentLabel({ origin: 'hand', source: 'voice', sentBy: 'release' })!.label).toBe('spoken · sent on release');
    expect(sentLabel({ origin: 'voice', sentBy: 'word' })).toEqual({ label: 'spoken · sent by send word', asksFirst: true });
    expect(sentLabel({ origin: 'voice', sentBy: 'piece' })).toEqual({ label: 'spoken · sent as a piece', asksFirst: true });
    expect(sentLabel({ origin: 'voice', sentBy: 'hotkey' })).toEqual({ label: 'spoken · sent by send-now', asksFirst: true });
    expect(APP).toContain("`${it.sentLabel}${it.asksFirst ? ' · edits ask first' : ''}`");
  });
  it('the session header chip while clamped, and the card asked during a voice-sent turn', () => {
    expect(CLAMP_CHIP).toBe('voice turn · edits ask first');
    expect(CARD_VOICE_LINE).toBe('asked during a voice-sent turn · check this was you');
    expect(cardVoiceOrigin({ detail: { origin: 'voice', sentBy: 'word' } })).toBe(true);
    expect(cardVoiceOrigin({ detail: { origin: 'hand' } })).toBe(false);
    expect(cardVoiceOrigin({})).toBe(false);
    const v = { cardId: 'card:1', kind: 'permission', requestedBy: 'p:a/claude', hsid: null, repo: null, state: 'pending', contentHash: 'sha256:x', flags: [], decisions: ['allow', 'deny'], decidable: true, voiceOrigin: true };
    const el = renderCard({ doc: fdoc }, v, { kind: 'text', text: 'Edit app.ts' }) as unknown as FEl;
    expect(el.className).toContain('voice-origin');
    expect(el.all((e) => e.className.includes('card-voice-origin'))[0]!.text).toBe('asked during a voice-sent turn · check this was you');
    const plain = renderCard({ doc: fdoc }, { ...v, voiceOrigin: false }, { kind: 'text', text: 'Edit app.ts' }) as unknown as FEl;
    expect(plain.all((e) => e.className.includes('card-voice-origin'))).toHaveLength(0);
    expect(APP).toContain('voiceOrigin: cardVoiceOrigin(c.card),');
  });
  it('reduced motion: the meters only follow the real level and every transition is instant', () => {
    expect(CSS).toMatch(/\[data-motion="reduced"\] \*[\s\S]{0,120}transition: none !important/);
    expect(CSS).not.toMatch(/\.(rung|voice-ladder|vs-[a-z-]+)[^{]*\{[^}]*animation/);
  });
});
