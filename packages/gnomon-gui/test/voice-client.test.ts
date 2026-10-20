/**
 * #gui voice app lifecycle, dev banner, enrolment and notices (V2e GUI, T-2026-10-19-026): the pure adapter
 * (core/voice-client.ts), the store's folding of enrolment / notice / kernel-speakable rows, the palette, and the
 * page wiring read from the source (the app is browser glue; its decisions are the pure functions tested here).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BLOCK_SAFE_COMMANDS, paletteEntries } from '../src/core/commands.js';
import { chatItems, GuiStore, type Row } from '../src/core/store.js';
import { canAttach, pillOf, voiceStatusOf } from '../src/core/voice.js';
import {
  clientMenuEntries,
  clientOf,
  clientPillOf,
  clientRequest,
  consentText,
  devBannerOf,
  enrolLine,
  enrolRequest,
  enrolSent,
  enrolStart,
  ENROL_PHRASES,
  forgetRequest,
  isClientRow,
  isEnrolCard,
  needsStart,
  noticeOf,
  reduceEnrol,
  toastFresh,
} from '../src/core/voice-client.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(path.join(ROOT, 'src/ui/app.ts'), 'utf8');
const HTML = readFileSync(path.join(ROOT, 'static/index.html'), 'utf8');
const A = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
const human = (voice: unknown) => ({ principalKind: 'human', voice });
const voiceConn = (voice: unknown) => ({ principalKind: 'voice', voice });
const st = (client: Record<string, unknown> | null, more: Record<string, unknown> = {}) => human({ attached: false, hsid: null, ceiling: null, clientConnected: client?.phase === 'running', ...(client ? { client } : {}), ...more });
const pill = (status: unknown) => clientPillOf(clientOf(status), voiceStatusOf(status).state !== 'off', canAttach(status));

describe('the pill shows every voice-app phase while nothing is attached', () => {
  it('idle: "Voice app not running" with [Start voice]', () => {
    expect(pill(st({ phase: 'idle' }))).toMatchObject({ label: 'Voice app not running', action: 'start', actionLabel: 'Start voice', progress: null });
    // the kernel's connection word alone (no client block) reads the same
    expect(pill(human({ attached: null, clientConnected: false }))).toMatchObject({ label: 'Voice app not running', action: 'start' });
  });
  it('installing: "Setting up voice…", no action', () => {
    expect(pill(st({ phase: 'installing' }))).toMatchObject({ label: 'Setting up voice…', action: null });
  });
  it('downloading: "Downloading voice models · N of M MB" with a progress fraction', () => {
    const p = pill(st({ phase: 'downloading', downloadMb: { n: 120, of: 480 } }));
    expect(p).toMatchObject({ label: 'Downloading voice models · 120 of 480 MB', action: null });
    expect(p.progress).toBeCloseTo(0.25);
    expect(pill(st({ phase: 'downloading', downloadMb: { n: 12.34, of: 48 } })).label).toBe('Downloading voice models · 12.3 of 48 MB');
    expect(pill(st({ phase: 'downloading' }))).toMatchObject({ label: 'Downloading voice models…', progress: null });
    expect(pill(st({ phase: 'downloading', downloadMb: { n: 900, of: 480 } })).progress).toBe(1); // clamped
  });
  it('starting: "Starting…"', () => {
    expect(pill(st({ phase: 'starting' }))).toMatchObject({ label: 'Starting…', action: null });
  });
  it('crashed: "Voice crashed" with [Restart] and the last error in the title', () => {
    expect(pill(st({ phase: 'crashed', lastError: 'exit 6' }))).toMatchObject({ label: 'Voice crashed', action: 'restart', actionLabel: 'Restart', title: expect.stringContaining('exit 6') });
  });
  it('unavailable: names why, offers nothing', () => {
    expect(pill(st({ phase: 'unavailable', unavailable: 'needs Apple silicon' }))).toMatchObject({ label: 'Voice unavailable · needs Apple silicon', action: null });
  });
  it('running with no enrolled voice nudges "Teach Gnomon your voice first"; enrolled or unknown list: the V2d pill stands', () => {
    expect(pill(st({ phase: 'running' }, { enrolled: [] }))).toMatchObject({ label: 'Teach Gnomon your voice first', action: 'enrol' });
    expect(pill(st({ phase: 'running' }, { enrolled: ['spk:m/matt'] })).label).toBeNull();
    expect(pill(st({ phase: 'running' })).label).toBeNull(); // A1: no list ⇒ never a false nudge
  });
  it('an attached live mic always keeps its louder V2d state (never under-reports)', () => {
    const s = human({ attached: true, hsid: A, ceiling: 'conversation', voiceSessionId: 'vs:x', clientConnected: false, client: { phase: 'crashed' } });
    expect(pill(s).label).toBeNull();
    expect(pillOf(voiceStatusOf(s)).label).toContain('Listening');
  });
  it('unknown phases and stale claims fail toward "not running"', () => {
    expect(clientOf(st({ phase: 'warp-drive' })).phase).toBe('idle');
    expect(clientOf(human({ clientConnected: false, client: { phase: 'running' } })).phase).toBe('idle');
    expect(clientOf(human({ clientConnected: true, client: { phase: 'idle' } })).phase).toBe('running');
    expect(clientOf(human({ attached: null })).known).toBe(false); // an older kernel: no lifecycle UI at all
    expect(pill(human({ attached: null })).label).toBeNull();
  });
});

describe('start / stop / auto-start send the right appends', () => {
  it('request.voice.client{op}', () => {
    expect(clientRequest('start')).toEqual({ kind: 'request.voice.client', payload: { op: 'start' } });
    expect(clientRequest('stop')).toEqual({ kind: 'request.voice.client', payload: { op: 'stop' } });
  });
  it('the pill menu offers Stop while the app is up (or coming up), Start/Restart otherwise, and the enrol entry', () => {
    const ids = (s: unknown) => clientMenuEntries(clientOf(s), canAttach(s)).map((e) => `${e.id}:${e.label}`);
    expect(ids(st({ phase: 'running' }))).toEqual(['voice.client.stop:Stop voice', 'voice.enrol:Teach Gnomon your voice…']);
    expect(ids(st({ phase: 'downloading' }))[0]).toBe('voice.client.stop:Stop voice');
    expect(ids(st({ phase: 'idle' }))[0]).toBe('voice.client.start:Start voice');
    expect(ids(st({ phase: 'crashed' }))[0]).toBe('voice.client.start:Restart voice');
    expect(ids(st({ phase: 'unavailable' }))).toEqual(['voice.enrol:Teach Gnomon your voice…']);
  });
  it('auto-start applies only when the app is idle or crashed', () => {
    expect(needsStart(clientOf(st({ phase: 'idle' })))).toBe(true);
    expect(needsStart(clientOf(st({ phase: 'crashed' })))).toBe(true);
    for (const phase of ['installing', 'downloading', 'starting', 'running', 'unavailable']) expect(needsStart(clientOf(st({ phase })))).toBe(false);
    expect(needsStart(clientOf(human({ attached: null })))).toBe(false); // unknown: do not send requests an older kernel cannot read
  });
  it('the page: attach / Ambient start the app in the same gesture, before the voice.session.start append', () => {
    const fn = APP.slice(APP.indexOf('async function setVoice('), APP.indexOf('/* ── voice app lifecycle'));
    const auto = fn.indexOf("to !== 'off' && needsStart(clientOf(status))");
    expect(auto).toBeGreaterThan(0);
    expect(fn.indexOf("clientRequest('start')")).toBeGreaterThan(auto);
    expect(fn.indexOf("client.call<Record<string, unknown>>('log.append', req)")).toBeGreaterThan(fn.indexOf("clientRequest('start')"));
  });
  it('the page: Start / Stop are trusted gestures from a human connection only; the pill action and menu route to them', () => {
    const fn = APP.slice(APP.indexOf('async function voiceClientOp('), APP.indexOf('function openEnrol('));
    expect(fn).toMatch(/if \(!trusted\) return;/);
    expect(fn).toMatch(/if \(!canAttach\(status\)\) return notice/);
    expect(fn).toContain("client.call('log.append', clientRequest(op))");
    expect(APP).toContain("void voiceClientOp(id === 'voice.client.stop' ? 'stop' : 'start', e.isTrusted)");
    expect(APP).toContain("if (a === 'start' || a === 'restart') void voiceClientOp('start', e.isTrusted)");
  });
  it('palette: voice.client.start / stop / enrol exist and are never block-safe', () => {
    const ids = paletteEntries(null).map((c) => c.id);
    for (const id of ['voice.client.start', 'voice.client.stop', 'voice.enrol']) {
      expect(ids).toContain(id);
      expect(BLOCK_SAFE_COMMANDS.has(id)).toBe(false);
    }
  });
});

describe('the dev-unsigned banner', () => {
  it('is loud when status.voice.client.devUnsigned is set, absent otherwise', () => {
    expect(devBannerOf(clientOf(st({ phase: 'running', devUnsigned: true })))).toBe('Voice is running an unsigned development build');
    expect(devBannerOf(clientOf(st({ phase: 'running', devUnsigned: 'yes' })))).toBeNull(); // only an explicit true
    expect(devBannerOf(clientOf(st({ phase: 'running' })))).toBeNull();
  });
  it('the page: a role=alert, kernel-owned banner painted from status', () => {
    expect(HTML).toMatch(/id="voice-dev" class="notice voice-dev kernel-owned" role="alert" hidden/);
    expect(APP).toContain("$('voice-dev').hidden = dev === null;");
  });
});

describe('"Teach Gnomon your voice"', () => {
  it('validates the name (the kernel rule) and the consent, then builds request.voice.enrol{name, consent}', () => {
    expect(enrolRequest('', true)).toMatchObject({ ok: false });
    expect(enrolRequest('matt', false)).toEqual({ ok: false, reason: 'tick the consent box to continue' });
    const r = enrolRequest('  Matt C ', true);
    expect(r).toEqual({ ok: true, req: { kind: 'request.voice.enrol', payload: { name: 'matt-c', consent: consentText('matt-c') } } });
    expect(consentText('matt')).toMatch(/three short phrases.*stays on this Mac.*forget it at any time/);
    expect(forgetRequest('matt')).toEqual({ kind: 'request.voice.forget', payload: { name: 'matt' } });
  });
  it('form → waiting → three phrases with a recording indicator → confirm (Touch ID) → done', () => {
    let s = enrolStart();
    expect(s.step).toBe('form');
    expect(reduceEnrol(s, 'voice.enrol.progress', { phase: 'recording' })).toBe(s); // nothing sent yet
    s = enrolSent(s, 'matt', 'card:1');
    expect(s).toMatchObject({ step: 'waiting', name: 'matt', cardId: 'card:1' });
    expect(enrolLine(s)).toContain('Waiting for the voice app');
    s = reduceEnrol(s, 'voice.enrol.ready', { name: 'matt', phrase: 0 });
    expect(s).toMatchObject({ step: 'phrase', index: 0, recording: false });
    expect(s.phrases).toBe(ENROL_PHRASES);
    s = reduceEnrol(s, 'voice.enrol.progress', { name: 'matt', phase: 'recording', phrase: 0 });
    expect(s).toMatchObject({ step: 'phrase', index: 0, recording: true });
    expect(enrolLine(s)).toBe('Phrase 1 of 3: recording, read it aloud');
    s = reduceEnrol(s, 'voice.enrol.progress', { name: 'matt', phase: 'recorded', phrase: 0 });
    expect(s).toMatchObject({ step: 'phrase', index: 1, recorded: 1, recording: false });
    s = reduceEnrol(s, 'voice.enrol.recorded', { name: 'matt', phrase: 1 });
    expect(s).toMatchObject({ index: 2, recorded: 2 });
    s = reduceEnrol(s, 'voice.enrol.recording', { phrase: 2 });
    expect(s.recording).toBe(true);
    s = reduceEnrol(s, 'voice.enrol.recorded', { phrase: 2 });
    expect(s).toMatchObject({ step: 'confirm', recorded: 3 });
    expect(enrolLine(s)).toBe('All phrases recorded. Finish with Touch ID.');
    s = reduceEnrol(s, 'voice.enrol', { speakerId: 'spk:m/matt', consent: 'x' });
    expect(s.step).toBe('done');
  });
  it('the client may name its own phrases; another name and unrelated rows change nothing; a failure says why', () => {
    const s = enrolSent(enrolStart(), 'matt', null);
    const named = reduceEnrol(s, 'voice.enrolment.ready', { phrases: ['one', 'two'], phrase: 0 });
    expect(named).toMatchObject({ step: 'phrase', phrases: ['one', 'two'] });
    expect(reduceEnrol(s, 'voice.enrol.ready', { name: 'dana' })).toBe(s);
    expect(reduceEnrol(s, 'voice.turn.user', { name: 'matt' })).toBe(s);
    expect(reduceEnrol(s, 'voice.enrol.failed', { error: 'too quiet' })).toMatchObject({ step: 'failed', error: 'too quiet' });
    expect(enrolLine(reduceEnrol(s, 'voice.enrol.cancelled', {}))).toBe('Not enrolled: the voice app cancelled the recording');
  });
  it('the store folds enrolment rows into the open flow only', () => {
    const store = new GuiStore();
    const seen: string[] = [];
    store.onChange((w) => seen.push(...w));
    store.apply([{ seq: 1, kind: 'voice.enrol.ready', connId: 'v', payload: { name: 'matt' } }]);
    expect(store.enrol).toBeNull();
    store.enrol = enrolSent(enrolStart(), 'matt', 'card:1');
    store.apply([{ seq: 2, kind: 'voice.enrol.progress', connId: 'v', payload: { name: 'matt', phase: 'recording', phrase: 0 } }]);
    expect(store.enrol).toMatchObject({ step: 'phrase', recording: true });
    expect(seen).toContain('voice-enrol');
  });
  it('the Touch ID card is recognised by its op and name (A4)', () => {
    const card = (detail: unknown) => ({ kind: 'strictness', card: { detail } });
    expect(isEnrolCard(card({ op: 'voice.enrol', name: 'matt' }), 'matt')).toBe(true);
    expect(isEnrolCard(card({ op: 'voice.enrol', speakerId: 'spk:m/dana' }), 'matt')).toBe(false);
    expect(isEnrolCard(card({ op: 'voice.widen' }), 'matt')).toBe(false);
  });
  it('the page: send / finish / forget are trusted gestures; finish approves allow; close denies a card in flight', () => {
    const submit = APP.slice(APP.indexOf('async function submitEnrol('), APP.indexOf('async function closeEnrol('));
    expect(submit).toMatch(/if \(!trusted \|\| !s\) return;/);
    expect(submit).toContain("client.call<Record<string, unknown>>('log.append', v.req)");
    expect(submit).toContain("client.call('approve', { cardId, decision: 'allow' })");
    const close = APP.slice(APP.indexOf('async function closeEnrol('), APP.indexOf('let forgetArmed'));
    expect(close).toContain("decision: 'deny'");
    const forget = APP.slice(APP.indexOf('async function forgetVoice('), APP.indexOf('let toastTimer'));
    expect(forget).toMatch(/if \(!trusted \|\| !client \|\| !canAttach\(status\)\) return;/);
    expect(forget).toContain('forgetRequest(name)');
    expect(HTML).toContain('id="enrol-dialog"');
  });
});

describe('client notices are quiet toasts', () => {
  it('voice.notice / voice.client.notice text, or any voice.* row with a notice; capped and one line', () => {
    expect(noticeOf('voice.notice', { text: 'open Gnomon to turn on ambient' })).toBe('open Gnomon to turn on ambient');
    expect(noticeOf('voice.client.notice', { message: 'mic\n busy' })).toBe('mic busy');
    expect(noticeOf('voice.deck', { notice: 'hotkey ignored' })).toBe('hotkey ignored');
    expect(noticeOf('voice.deck', { text: 'not a notice' })).toBeNull();
    expect(noticeOf('session.open', { notice: 'x' })).toBeNull();
    expect(noticeOf('voice.notice', { text: 'x'.repeat(500) })!.length).toBe(140);
  });
  it('the store keeps the latest one; a stale backlog notice is not toasted', () => {
    const store = new GuiStore();
    store.apply([{ seq: 1, kind: 'voice.notice', connId: 'v', payload: { text: 'open Gnomon to turn on ambient' }, at: '2026-10-19T10:00:00Z' }]);
    expect(store.voiceToast).toEqual({ text: 'open Gnomon to turn on ambient', at: '2026-10-19T10:00:00Z' });
    expect(toastFresh('2026-10-19T10:00:00Z', Date.parse('2026-10-19T10:00:10Z'))).toBe(true);
    expect(toastFresh('2026-10-19T10:00:00Z', Date.parse('2026-10-19T10:05:00Z'))).toBe(false);
  });
  it('lifecycle rows make the page re-read status', () => {
    for (const k of ['voice.client.start', 'request.voice.client', 'voice.enrol', 'voice.forget']) expect(isClientRow(k)).toBe(true);
    expect(isClientRow('voice.turn.user')).toBe(false);
    const store = new GuiStore();
    const seen: string[] = [];
    store.onChange((w) => seen.push(...w));
    store.apply([{ seq: 1, kind: 'voice.client.crashed', connId: 'k', payload: {} }]);
    expect(seen).toContain('voice');
  });
});

describe('spoken replies: the kernel row carries 🔊, the voice app playback is not shown twice', () => {
  const row = (seq: number, kind: string, payload: unknown): Row => ({ seq, kind, connId: 'k', session: A, payload, view: 'full' } as Row);
  it('kernel-speakable shows 🔊 and swallows the matching playback row', () => {
    const { items } = chatItems([row(1, 'voice.turn.agent', { source: 'kernel-speakable', items: [{ text: 'Done.' }] }), row(2, 'voice.turn.agent', { textSpoken: 'Done.', textPlanned: 'Done.' })]);
    expect(items.filter((i) => i.role === 'spoken').map((i) => i.text)).toEqual(['🔊 spoken aloud']);
  });
  it('an older kernel (playback only) keeps the V2d marker; an empty speakable shows nothing', () => {
    expect(chatItems([row(1, 'voice.turn.agent', { textSpoken: 'Hi', textPlanned: 'Hi there' })]).items.map((i) => i.text)).toEqual(['🔊 spoken aloud (in part)']);
    expect(chatItems([row(1, 'voice.turn.agent', { source: 'kernel-speakable', items: [] })]).items).toEqual([]);
  });
});

describe('a voice connection never gets these controls', () => {
  it('no pill action, no menu items', () => {
    for (const phase of ['idle', 'crashed', 'running']) {
      const s = voiceConn({ attached: null, clientConnected: phase === 'running', client: { phase }, enrolled: [] });
      expect(canAttach(s)).toBe(false);
      expect(pill(s).action).toBeNull();
      expect(clientMenuEntries(clientOf(s), canAttach(s))).toEqual([]);
    }
  });
  it('the page refuses enrol / start from a non-human connection', () => {
    expect(APP.slice(APP.indexOf('function openEnrol('), APP.indexOf('function paintEnrol(')).match(/canAttach\(status\)/)).not.toBeNull();
    expect(APP.slice(APP.indexOf('async function submitEnrol('), APP.indexOf('async function closeEnrol(')).match(/canAttach\(status\)/)).not.toBeNull();
  });
});
