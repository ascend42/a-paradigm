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
import { chooseRung, clientFactOf, crashCauseOf, dropFact, ladderAria, ladderEntries, ladderFoot, ladderTargetLine, PIECES_TIMING, presetOfRung, rungOf, sendOfRung, sheetRows, stateOfRung, voicePillOf, type PillInput } from '../src/core/voice-ladder.js';
import { COMPOSER_LINES, COMPOSER_TALL_LINES, composerFit, fitTallRoom, lineCountLabel, lineCountShown, parseTall, serializeTall, TALL_FEED_MIN_PX } from '../src/core/composer.js';
import { initialTeach, reduceTeach, type TeachEvent, type TeachState } from '../src/core/send-word-teach.js';
import { enrolStart } from '../src/core/voice-client.js';
import { ACK_TEXT, CARD_VOICE_LINE, cardVoiceOrigin, CLAMP_CHIP, sentLabel } from '../src/core/voice-presets.js';
import { renderCard, type MiniDoc, type MiniEl } from '../src/core/render.js';
import { ladderEls, sheetEls, sheetKey, trapNext, type SheetView } from '../src/ui/voice-settings.js';
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
    // Luna #7: the crash fact is just "voice crashed"; the cause rides the title and the accessible name
    expect(clientFactOf(null, ' · voice crashed: boom')).toBe('voice crashed');
    expect(clientFactOf('Voice crashed', null)).toBe('voice crashed');
    expect(crashCauseOf({ phase: 'crashed', lastError: 'boom\nmore' }, (e) => e.replace(/\s+/g, ' '))).toBe('boom more');
    expect(crashCauseOf({ phase: 'running', lastError: 'boom' }, (e) => e)).toBeNull();
    const crashed = pill({ rung: 'dictate', attached: true, clientFact: 'voice crashed', clientCause: 'the input device went away', clientTitle: 'The voice app stopped: the input device went away.' });
    expect(crashed.fact).toBe('voice crashed');
    expect(crashed.aria).toContain('voice crashed (the input device went away)');
    expect(crashed.title).toContain('the input device went away');
    // a fact that is not the client's carries no cause
    expect(pill({ rung: 'dictate', attached: true, clamped: true, clientFact: 'voice crashed', clientCause: 'x' }).aria).not.toContain('(x)');
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
    // Luna #5: Pieces names its cost while not ready too
    expect(e.find((x) => x.rung === 'pieces')).toMatchObject({ tag: 'set up · Touch ID', tagKind: 'setup', needs: 'risk' });
  });
  it('the rung target (Luna #6): focused ≠ attached reads "applies to <B> · voice is on <A>", in the ladder and its name', () => {
    const name = (h: string) => h.slice(-4);
    expect(ladderTargetLine('hs:BBBB', 'hs:AAAA', name)).toBe('applies to BBBB · voice is on AAAA');
    expect(ladderTargetLine('hs:AAAA', 'hs:AAAA', name)).toBeNull();
    expect(ladderTargetLine('hs:BBBB', null, name)).toBeNull();
    expect(ladderTargetLine(null, 'hs:AAAA', name)).toBeNull();
    expect(ladderAria('applies to BBBB · voice is on AAAA')).toBe('Voice: the trust ladder · applies to BBBB · voice is on AAAA');
    expect(ladderAria(null)).toBe('Voice: the trust ladder');
    const r = root(ladderEls(fdoc, L(), 'foot', 'applies to BBBB · voice is on AAAA'));
    expect(r.all((e) => e.className.includes('ladder-target'))[0]!.text).toBe('applies to BBBB · voice is on AAAA');
    expect(root(ladderEls(fdoc, L(), 'foot')).all((e) => e.className.includes('ladder-target'))).toHaveLength(0);
    expect(APP).toContain("menu.setAttribute('aria-label', ladderAria(target));");
    expect(APP).toContain('ladderEls(doc, entries, foot, target)');
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
    // Luna #11: aria-modal is kept true, so Tab is trapped inside the drawer and focus returns on close
    const VS = readFileSync(path.join(ROOT, 'src', 'ui', 'voice-settings.ts'), 'utf8');
    expect(VS).toMatch(/document\.addEventListener\('keydown', \(e\) => \{\s*if \(e\.key !== 'Tab' \|\| overlay\.hidden/);
    expect(VS).toMatch(/const to = trapNext\(items, a && card\.contains\(a\) \? a : null, e\.shiftKey\);\s*if \(to\) \{\s*e\.preventDefault\(\);\s*to\.focus\(\);/);
    expect(VS).toMatch(/d\.onClose\(\);\s*back\?\.focus\(\);/);
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
  it('ok reads by its mark and weight (board gnomon-status-colour): an ok value carries ✓, warn and plain do not', () => {
    const r = root(sheetEls(fdoc, view()));
    const vals = r.all((e) => /\bvs-v\b/.test(e.className));
    expect(vals.find((e) => e.className === 'vs-v ok')!.text).toBe('✓ taught · matt');
    for (const e of vals.filter((x) => x.className !== 'vs-v ok')) expect(e.text).not.toContain('✓');
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
    // Luna #4: by night the chosen segment is [bracketed] and glows (not just the ink edge every key has)
    expect(CSS).toMatch(/\[data-theme="night"\] \.seg-key\[aria-checked="true"\]::before[^{]*\{ content: "\["/);
    expect(CSS).toMatch(/\[data-theme="night"\] \.seg-key\[aria-checked="true"\]::after[^{]*\{ content: "\]"/);
    expect(CSS).toMatch(/\[data-theme="night"\] \.seg-key\[aria-pressed="true"\] \{ text-shadow: var\(--wm-glow\)/);
  });
  it('the open mic is ink (board gnomon-status-colour) for the dot and the meter; --live and --stamp are retired', () => {
    expect(CSS).not.toMatch(/--(live|stamp)\b/);
    expect(CSS).toMatch(/\.voice-pill\.live \.voice-dot \{ background: var\(--ink\)/);
    expect(CSS).toMatch(/\.voice-meter i \{[^}]*background: var\(--ink\)/);
    expect(APP).not.toContain('mic-live');
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
    expect(r.text).toContain('heard so far: “sand it”');
    expect(r.all((e) => e.attrs.has('data-vs-variant'))).toHaveLength(0); // the choice is made at save
    s = run(s, trialStatus(takes('send it', 'sand it', 'send it')));
    r = paint();
    expect(r.text).toContain('I heard: “send it” ✓');
    expect(r.text).toContain('I understand a misheard or other voice can send for me; edits will still ask.');
    // Aegis R-1: each collected mishearing is an UNTICKED opt-in box with its consequence in words
    const box = r.all((e) => e.attrs.get('data-vs-variant') === 'sand it')[0]!;
    expect(box.tag).toBe('input');
    expect(box.attrs.get('type')).toBe('checkbox');
    expect(box.attrs.has('checked')).toBe(false);
    expect(r.text).toContain('Saying “sand it” on its own will also send. You said “send it”; I heard “sand it”.');
    s = run(s, { type: 'keepVariant', variant: 'sand it', on: true });
    expect(paint().all((e) => e.attrs.get('data-vs-variant') === 'sand it')[0]!.attrs.has('checked')).toBe(true);
    s = run(s, { type: 'keepVariant', variant: 'sand it', on: false });
    r = paint();
    const save = r.all((e) => e.attrs.get('data-vs-teach') === 'save')[0]!;
    expect(save.text).toBe('save “send it”');
    expect(save.attrs.has('disabled')).toBe(true); // the box first
    s = run(s, { type: 'ack', on: true });
    expect(paint().all((e) => e.attrs.get('data-vs-teach') === 'save')[0]!.attrs.has('disabled')).toBe(false);
    // never ASKS the user to say the product name (the risk paragraph names it as the sender, the render's sentence);
    // takes never reach the transcript (send-word-teach.test.ts)
    const said = paint().all((e) => e.className.includes('vs-prompt') || e.className.includes('vs-heard') || e.className.includes('vs-counter') || e.attrs.has('data-vs-pick'));
    for (const e of said) expect(e.text).not.toMatch(/gnomon/i);
  });
  it('the risk check (Luna #3): the render’s sentence with the word, the box labelled ACK_TEXT; an earlier acknowledgement shows its date, not a ticked box', () => {
    const done = run(initialTeach(), { type: 'pick', text: 'over' }, trialStatus(takes('over', 'over')));
    let r = root(sheetEls(fdoc, view({ flow: { kind: 'teach', s: done, attached: true } })));
    const para = r.all((e) => e.className === 'vs-risk-text')[0]!;
    expect(para.text).toBe('When you say “over”, Gnomon sends what you dictated. Another voice or a video could be taken for yours, so any edit Claude tries in a voice-sent turn asks you first.');
    const box = r.all((e) => e.attrs.get('data-vs-ack') === 'teach')[0]!;
    expect(box.attrs.has('checked')).toBe(false);
    expect(r.all((e) => e.className === 'vs-check')[0]!.text.trim()).toBe(ACK_TEXT);
    expect(r.text).not.toContain('I understandI understand');
    // already acknowledged: no pre-ticked box, the date instead; the save is open
    const today = new Date().toISOString();
    const prior = run(initialTeach(true, today), { type: 'pick', text: 'over' }, trialStatus(takes('over', 'over')));
    r = root(sheetEls(fdoc, view({ flow: { kind: 'teach', s: prior, attached: true } })));
    expect(r.all((e) => e.attrs.has('data-vs-ack'))).toHaveLength(0);
    expect(r.all((e) => e.className.includes('vs-acked'))[0]!.text).toBe('acknowledged · today');
    expect(r.all((e) => e.attrs.get('data-vs-teach') === 'save')[0]!.attrs.has('disabled')).toBe(false);
    // the Pieces risk row names the pause; with a held word, a review names the word
    const pieces = root(sheetEls(fdoc, view({ flow: { kind: 'risk', rung: 'pieces', ack: false, word: 'over' } })));
    expect(pieces.all((e) => e.className === 'vs-risk-text')[0]!.text).toMatch(/^When you pause, Gnomon sends what you dictated\./);
    const review = root(sheetEls(fdoc, view({ flow: { kind: 'risk', rung: null, ack: false, word: 'over' } })));
    expect(review.all((e) => e.className === 'vs-risk-text')[0]!.text).toMatch(/^When you say “over”/);
    // the risk row says when
    expect(rows({ acked: true, ackedAt: '2026-10-21T09:00:00.000Z', now: new Date('2026-10-21T15:00:00.000Z') })[5]!.value).toBe('acknowledged · today');
    expect(rows({ acked: true, ackedAt: '2026-10-01T09:00:00.000Z', now: new Date('2026-10-21T15:00:00.000Z') })[5]!.value).toMatch(/^acknowledged · .*2026/);
    expect(rows({ acked: true })[5]!.value).toBe('acknowledged');
  });
  it('the page drives the kernel trial: start{word, trial}, save, clear{trial}; the sheet closing ends it', () => {
    expect(APP).toContain("payload: { op: 'start', word, trial: true }");
    expect(APP).toContain("{ kind: 'request.voice.sendword', payload: commit }");
    expect(APP).toContain("payload: { op: 'clear', trial: true }");
    expect(APP).toMatch(/onClose: \(\) => \{\s*pendingRung = null;\s*setFlow\(null\);/);
    expect(APP).toMatch(/if \(vsFlow === 'teach' && f !== 'teach'\) void endTeach\(\);/);
    // only a LISTENING trial counts a turn as a take; with the row open nothing heard becomes a draft
    expect(APP).toMatch(/if \(r\.kind === 'voice\.turn\.user' && teachOpen\(\)\) \{\s*if \(r\.seq > dict\.lastSeq\) dict = \{ \.\.\.dict, lastSeq: r\.seq \};\s*if \(teach\?\.step === 'takes'\) teachHeard\(\);\s*return;/);
    expect(APP).toContain("if (teach) teach = reduceTeach(teach, { type: 'keepVariant', variant: value.slice(2), on: value.startsWith('1:') });");
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
    // founder report 2026-10-23: at 1 line the count says nothing; from 2 lines up it shows
    expect(lineCountShown(0)).toBe(false);
    expect(lineCountShown(1)).toBe(false);
    expect(lineCountShown(2)).toBe(true);
    expect(APP).toMatch(/lines\.hidden = !lineCountShown\(f\.lines\);/);
  });
  it('empty is one line whatever the placeholder; the tall view gives back room it would take (Mika 2026-10-23)', () => {
    // a long "Reply to <title>…" wrapped at 1024 and made the empty composer two lines with a "2 lines" count
    expect(APP).toMatch(/const content = ta\.value === '' \? px\(cs\.lineHeight\) \+ edge :/);
    expect(CSS).toMatch(/\.composer-main > textarea:placeholder-shown \{ white-space: nowrap;/);
    const lh = 21.6;
    const tall = composerFit(lh * 30 + 4, lh, 4, true);
    expect(fitTallRoom(tall, lh, 4, 0)).toBe(tall); // room enough: unchanged
    expect(fitTallRoom(tall, lh, 4, lh * 5)).toMatchObject({ heightPx: Math.round(lh * 19 + 4), lines: 30, scrolls: true, cap: 19 });
    expect(fitTallRoom(tall, lh, 4, 10_000)).toMatchObject({ cap: COMPOSER_LINES, heightPx: Math.round(lh * 12 + 4) }); // never below the normal cap
    const short = composerFit(lh * 8 + 4, lh, 4, true);
    expect(fitTallRoom(short, lh, 4, 500)).toBe(short); // 12 lines or fewer: the tall view takes nothing extra
    expect(TALL_FEED_MIN_PX).toBe(120);
    expect(APP).toMatch(/f = fitTallRoom\(f, px\(cs\.lineHeight\), edge, TALL_FEED_MIN_PX - /);
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
    // one row at the bottom right, in the order line count, ⤢, send (founder report 2026-10-23); the count starts hidden
    expect(composer).toMatch(/<div class="composer-ctrls"><span id="composer-lines" class="meta composer-lines" hidden><\/span><button id="composer-tall"[^]*?<button id="composer-send"/);
    expect(CSS).toMatch(/\.composer-ctrls \{ display: flex; flex-direction: row; align-items: center; gap: 8px; \}/);
    expect(CSS).not.toMatch(/\.composer-ctrls \{[^}]*flex-direction: column/);
    expect(CSS).not.toMatch(/\.composer textarea \{[^}]*max-height: 40vh/);
    // Luna #4: the tall view has a pressed state in both themes; #8: the send key on the 2px grid (a key's 4px 10px)
    expect(CSS).toMatch(/\.composer-tall\[aria-pressed="true"\] \{ background: var\(--ink\); color: var\(--on-ink\)/);
    expect(CSS).toMatch(/\[data-theme="night"\] \.composer-tall\[aria-pressed="true"\]::before \{ content: "\["/);
    expect(CSS).toMatch(/\.composer-ctrls \.key\.pri \{ min-height: var\(--key-h\); padding: 0 10px; font-size: var\(--fs-control\);/); // migration key-height
  });
});

describe('labels: spoken · sent by …, edits ask first, the chip and the card line', () => {
  it('every way a spoken turn is sent has its words', () => {
    expect(sentLabel({ origin: 'hand', source: 'voice' })!.label).toBe('spoken · sent by you');
    expect(sentLabel({ origin: 'hand', source: 'voice', sentBy: 'release' })!.label).toBe('spoken · sent on release');
    expect(sentLabel({ origin: 'voice', sentBy: 'word' })).toEqual({ label: 'spoken · sent by send word', asksFirst: true });
    expect(sentLabel({ origin: 'voice', sentBy: 'piece' })).toEqual({ label: 'spoken · sent as a piece', asksFirst: true });
    expect(sentLabel({ origin: 'voice', sentBy: 'hotkey' })).toEqual({ label: 'spoken · sent by send-now', asksFirst: true });
    expect(APP).toContain("`${spoken ? spoken.sent : it.sentLabel}${it.asksFirst ? ' · edits ask first' : ''}`");
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

describe('the Voice settings drawer traps Tab (Luna #11)', () => {
  it('wraps at either end, enters from outside, and leaves the middle to the browser', () => {
    const items = ['close', 'teach', 'save'];
    expect(trapNext(items, 'save', false)).toBe('close'); // Tab off the last wraps to the first
    expect(trapNext(items, 'close', true)).toBe('save'); // ⇧Tab off the first wraps to the last
    expect(trapNext(items, 'teach', false)).toBeNull();
    expect(trapNext(items, 'teach', true)).toBeNull();
    expect(trapNext(items, null, false)).toBe('close'); // focus outside the drawer comes back in
    expect(trapNext(items, 'elsewhere', true)).toBe('save');
    expect(trapNext([], null, false)).toBeNull();
  });
});
