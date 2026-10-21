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
  CLIENT_POLL_MS,
  clientPillOf,
  clientPollWanted,
  PILL_ERROR_MAX,
  clientRequest,
  consentText,
  devBannerOf,
  enrolAllowed,
  enrolNudgeOf,
  enrolLine,
  ENROL_POLL_MS,
  enrolRequest,
  enrolSent,
  enrolStart,
  ENROL_PHRASES,
  forgetRequest,
  isClientRow,
  isEnrolCard,
  needsStart,
  noticeOf,
  reduceEnrolStatus,
  REENROL_LABEL,
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
  it('2026-10-20: every enrolled name with only a stale print nudges "Re-teach Gnomon your voice (the voice check was upgraded)"', () => {
    const stale = (enrolled: string[], names: unknown) => st({ phase: 'running' }, { enrolled, prints: { stale: names } });
    expect(pill(stale(['matt'], ['matt']))).toMatchObject({ label: REENROL_LABEL, action: 'enrol', actionLabel: 'Re-teach' });
    expect(pill(stale(['matt', 'dana'], ['matt'])).label).toBeNull(); // dana is still recognised
    expect(pill(stale([], ['matt'])).label).toBe('Teach Gnomon your voice first'); // not enrolled with the kernel at all
    expect(pill(stale(['matt'], 'garbage')).label).toBeNull(); // a malformed report never nudges
    expect(clientOf(stale(['matt'], ['spk:m/matt', 'matt'])).stale).toEqual(['matt']);
    expect(enrolNudgeOf(clientOf(st({ phase: 'running' }, { prints: { stale: ['matt'] } })))).toBeNull(); // list unknown
    const a = human({ attached: true, hsid: A, ceiling: 'conversation', voiceSessionId: 'vs:x', clientConnected: true, client: { phase: 'running' }, enrolled: ['matt'], prints: { stale: ['matt'] } });
    expect(pill(a)).toMatchObject({ label: null, tail: ' · re-teach Gnomon your voice (the voice check was upgraded)', action: 'enrol' });
    expect(clientMenuEntries(clientOf(stale(['matt'], ['matt'])), true).find((e) => e.id === 'voice.enrol')!.note).toMatch(/upgraded/);
  });
  it('an attached live mic always keeps its louder V2d state (never under-reports)', () => {
    const s = human({ attached: true, hsid: A, ceiling: 'conversation', voiceSessionId: 'vs:x', clientConnected: false, client: { phase: 'crashed' } });
    expect(pill(s).label).toBeNull();
    expect(pillOf(voiceStatusOf(s), pill(s).tail).label).toMatch(/^Listening/);
  });
  it('unknown phases and stale claims fail toward "not running"', () => {
    expect(clientOf(st({ phase: 'warp-drive' })).phase).toBe('idle');
    // the kernel's own phase words (voice-child.ts VoiceChildPhase)
    const k = (phase: string, more: Record<string, unknown> = {}) => clientOf(human({ clientConnected: false, client: { phase, ...more } }));
    expect(['stopped', 'preparing', 'installing', 'downloading-models', 'starting', 'backoff', 'failed'].map((p) => k(p).phase)).toEqual(['idle', 'installing', 'installing', 'downloading', 'starting', 'crashed', 'crashed']);
    expect(k('unavailable', { unavailable: 'the installed voice client changed since the kernel copied it' })).toMatchObject({ phase: 'unavailable', unavailable: expect.stringMatching(/changed/) });
    expect(k('failed', { unavailable: 'voice runs on macOS only for now' }).phase).toBe('unavailable');
    expect(clientPillOf(k('downloading-models', { downloadMb: 412 }), false, true).label).toBe('Downloading voice models (412 MB)…');
    expect(clientOf(human({ clientConnected: false, client: { phase: 'running' } })).phase).toBe('idle');
    expect(clientOf(human({ clientConnected: true, client: { phase: 'idle' } })).phase).toBe('running');
    expect(clientOf(human({ attached: null })).known).toBe(false); // an older kernel: no lifecycle UI at all
    expect(pill(human({ attached: null })).label).toBeNull();
  });
});

describe('attached: the live state stands and the real voice-app condition is appended (T-2026-10-20-002)', () => {
  const att = (ceiling: string, client: Record<string, unknown> | null, more: Record<string, unknown> = {}) => human({ attached: true, hsid: A, ceiling, voiceSessionId: 'vs:x', ...(client ? { client } : {}), ...more });
  const shown = (s: unknown) => {
    const cp = pill(s);
    return { cp, p: pillOf(voiceStatusOf(s), cp.tail) };
  };
  it('crashed (failed): "Listening · voice crashed: <lastError>" with [Restart], ambient class and meter kept', () => {
    const { cp, p } = shown(att('conversation', { phase: 'failed', lastError: 'the voice app stopped (exit 1): -10875' }, { clientConnected: false }));
    expect(cp).toMatchObject({ label: null, tail: ' · voice crashed: the voice app stopped (exit 1): -10875', action: 'restart', actionLabel: 'Restart', className: expect.stringContaining('voice-crashed') });
    expect(p).toMatchObject({ state: 'ambient', label: 'Listening · voice crashed: the voice app stopped (exit 1): -10875', className: expect.stringContaining('voice-ambient') });
    expect(cp.title).toMatch(/stopped: the voice app stopped/);
  });
  it('backoff (a crash loop) reads as crashed even while clientConnected flaps true', () => {
    const { cp, p } = shown(att('ptt', { phase: 'backoff', lastError: '-10875' }, { clientConnected: true }));
    expect(p.label).toBe('Hold ⌃⌥Space to talk · voice crashed: -10875');
    expect(p.state).toBe('ptt');
    expect(cp.title).toContain('crashed and is restarting');
    expect(shown(att('conversation', { phase: 'backoff' }, { clientConnected: false })).p.label).toBe('Listening · voice crashed');
  });
  it('a long or multi-line lastError is one line, capped in the label (full, still capped, in the title)', () => {
    const { cp } = shown(att('conversation', { phase: 'backoff', lastError: `boom\n${'x'.repeat(400)}` }, { clientConnected: false }));
    expect(cp.tail).not.toContain('\n');
    expect(cp.tail!.length).toBeLessThanOrEqual(' · voice crashed: '.length + PILL_ERROR_MAX);
    expect(cp.tail!.endsWith('…')).toBe(true);
  });
  it('not connected: "· voice app not connected" with [Start voice] (stopped, or a stale running claim)', () => {
    for (const phase of ['stopped', 'running']) {
      const { cp, p } = shown(att('conversation', { phase }, { clientConnected: false }));
      expect(p.label).toBe('Listening · voice app not connected');
      expect(cp).toMatchObject({ action: 'start', actionLabel: 'Start voice' });
    }
    // an older kernel (no client block): pillOf's own V2d tail stands
    expect(shown(att('conversation', null, { clientConnected: false })).p.label).toBe('Listening · voice app not connected');
  });
  it('the setup phases are appended, the live state kept', () => {
    expect(shown(att('conversation', { phase: 'starting' }, { clientConnected: false })).p.label).toBe('Listening · voice starting…');
    expect(shown(att('ptt', { phase: 'preparing' }, { clientConnected: false })).p.label).toBe('Hold ⌃⌥Space to talk · setting up voice…');
    expect(shown(att('conversation', { phase: 'downloading-models', downloadMb: 412 }, { clientConnected: false })).p.label).toBe('Listening · downloading voice models…');
  });
  it('enrolled []: "Listening · teach Gnomon your voice first" with [Teach]; null (unknown) or a voice: no nudge', () => {
    const { cp, p } = shown(att('conversation', { phase: 'running' }, { clientConnected: true, enrolled: [] }));
    expect(p).toMatchObject({ state: 'ambient', label: 'Listening · teach Gnomon your voice first', className: expect.stringContaining('voice-ambient') });
    expect(cp).toMatchObject({ action: 'enrol', actionLabel: 'Teach', className: 'voice-nudge' });
    expect(shown(att('ptt', { phase: 'running' }, { clientConnected: true, enrolled: [] })).p.label).toBe('Hold ⌃⌥Space to talk · teach Gnomon your voice first');
    const unknown = shown(att('conversation', { phase: 'running' }, { clientConnected: true }));
    expect(unknown.cp.tail).toBeNull();
    expect(unknown.p.label).toBe('Listening');
    expect(shown(att('conversation', { phase: 'running' }, { clientConnected: true, enrolled: ['spk:m/matt'] })).p.label).toBe('Listening');
  });
  it('a voice connection sees the condition but no action', () => {
    const s = voiceConn({ attached: true, hsid: A, ceiling: 'conversation', voiceSessionId: 'vs:x', clientConnected: false, client: { phase: 'backoff', lastError: 'x' } });
    expect(pill(s)).toMatchObject({ tail: ' · voice crashed: x', action: null, actionLabel: '' });
  });
  it('the page re-reads status lightly while attached or in a transient phase (the kernel logs no phase row)', () => {
    const want = (s: unknown) => clientPollWanted(clientOf(s), voiceStatusOf(s).state !== 'off', canAttach(s));
    expect(want(att('conversation', { phase: 'running' }, { clientConnected: true }))).toBe(true);
    expect(want(st({ phase: 'starting' }))).toBe(true);
    expect(want(st({ phase: 'backoff' }))).toBe(true);
    expect(want(st({ phase: 'running' }))).toBe(false);
    expect(want(st({ phase: 'failed' }))).toBe(false);
    expect(want(st({ phase: 'idle' }))).toBe(false);
    expect(want(human({ attached: null }))).toBe(false); // an older kernel
    expect(want(voiceConn({ attached: true, hsid: A, ceiling: 'conversation', voiceSessionId: 'vs:x', client: { phase: 'running' } }))).toBe(false);
    expect(CLIENT_POLL_MS).toBeGreaterThanOrEqual(1000);
    // T-2026-10-20-005 V3: the same poll runs at the capture cadence while attached with the app connected (re-armed on a change)
    expect(APP).toMatch(/function syncClientPoll\(\)[\s\S]{0,200}clientPollWanted\([\s\S]{0,300}capturePollMs\([\s\S]{0,200}\?\? CLIENT_POLL_MS\) : null;[\s\S]{0,120}clearInterval\(clientPoll\)[\s\S]{0,200}setInterval\(\(\) => void pollStatusOnce\(\), ms\)/);
  });
  it('the page appends the tail to the live pill and shows the tail\'s action', () => {
    // #gui-voice-ladder: the live rung stands; the voice app's condition is the pill's ONE fact (board header-5b: the
    // words carry it, one edge style in the row: no dashed edge)
    const css = readFileSync(path.join(ROOT, 'static/styles.css'), 'utf8');
    expect(css).not.toMatch(/\.voice-pill\.voice-trouble \{ border-style: dashed; \}/);
    const fn = APP.slice(APP.indexOf('function paintVoice('), APP.indexOf('function paintCapture('));
    expect(fn).toContain('clientFact: clientFactOf(cp.label, cp.tail),');
    expect(fn.indexOf('clientPillOf(')).toBeLessThan(fn.indexOf('voicePillOf('));
    // board header-5b: no separate action key; attached, the action is the ladder's first row
    expect(APP).not.toContain("$('voice-action')");
    expect(APP).toContain("const act = v.state !== 'off' && cp.action !== null ? { action: cp.action, label: cp.actionLabel, fact: clientFactOf(cp.label, cp.tail) ?? '' } : null;");
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
    expect(fn.indexOf("clientRequest('start', currentCapture())")).toBeGreaterThan(auto);
    expect(fn.indexOf("client.call<Record<string, unknown>>('log.append', req)")).toBeGreaterThan(fn.indexOf("clientRequest('start', currentCapture())"));
  });
  it('the page: Start / Stop are trusted gestures from a human connection only; the pill action and menu route to them', () => {
    const fn = APP.slice(APP.indexOf('async function voiceClientOp('), APP.indexOf('function openEnrolFlow('));
    expect(fn).toMatch(/if \(!trusted\) return;/);
    expect(fn).toMatch(/if \(!canAttach\(status\)\) return notice/);
    expect(fn).toContain("client.call('log.append', op === 'start' ? clientRequest('start', currentCapture()) : clientRequest(op))"); // TD-2026-10-21-514: the start carries the capture kind
    // the ladder holds rungs only (#gui-voice-ladder): Start / Stop are the pill's own action, Settings and the palette
    expect(APP).toContain("else if (id === 'voice.client.start') void voiceClientOp('start', trusted);");
    expect(APP).toContain("if (a === 'start' || a === 'restart') void voiceClientOp('start', trusted);");
    expect(APP).toMatch(/const a = \$\('voice-pill'\)\.dataset\.action;\s*if \(a\) return voiceAct\(a, e\.isTrusted\);/);
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
  it('form → confirm (Touch ID) → waiting → three phrases with a recording indicator → done (A3: status.voice.enrolment)', () => {
    const T = Date.parse('2026-10-19T10:00:00Z');
    const at = (sec: number) => new Date(T + sec * 1000).toISOString();
    const en = (e: Record<string, unknown>) => ({ voice: { enrolment: e } });
    let s = enrolStart();
    expect(s.step).toBe('form');
    expect(reduceEnrolStatus(s, en({ name: 'matt', phase: 'recording', at: at(1) }))).toBe(s); // nothing sent yet
    s = enrolSent(s, 'matt', 'card:1');
    expect(s).toMatchObject({ step: 'confirm', name: 'matt', cardId: 'card:1' });
    expect(enrolLine(s)).toBe('Confirm with Touch ID, then read three short phrases aloud.');
    expect(reduceEnrolStatus(s, en({ name: 'matt', phase: 'ready', at: at(1) }))).toBe(s); // not allowed yet
    s = enrolAllowed(s, T);
    expect(s).toMatchObject({ step: 'waiting', since: T });
    expect(enrolLine(s)).toContain('Waiting for the voice app');
    expect(reduceEnrolStatus(s, en({ name: 'matt', phase: 'requested', at: at(0) }))).toBe(s);
    s = reduceEnrolStatus(s, en({ name: 'matt', phase: 'ready', phrase: 0, of: 3, at: at(1) }));
    expect(s).toMatchObject({ step: 'phrase', index: 0, recording: false });
    expect(s.phrases).toBe(ENROL_PHRASES);
    s = reduceEnrolStatus(s, en({ name: 'matt', phase: 'recording', phrase: 0, of: 3, at: at(2) }));
    expect(s).toMatchObject({ step: 'phrase', index: 0, recording: true });
    expect(enrolLine(s)).toBe('Recording matt: only matt should speak. Phrase 1 of 3: recording, read it aloud');
    s = reduceEnrolStatus(s, en({ name: 'matt', phase: 'recorded', phrase: 0, of: 3, at: at(3) }));
    expect(s).toMatchObject({ step: 'phrase', index: 1, recorded: 1, recording: false });
    s = reduceEnrolStatus(s, en({ name: 'matt', phase: 'recorded', phrase: 1, of: 3, at: at(4) }));
    expect(s).toMatchObject({ index: 2, recorded: 2 });
    s = reduceEnrolStatus(s, en({ name: 'matt', phase: 'recording', phrase: 2, of: 3, at: at(5) }));
    expect(s.recording).toBe(true);
    // Aegis L3: the client's "done" alone is not done: the kernel's registry must list the name
    const notYet = reduceEnrolStatus(s, en({ name: 'matt', phase: 'done', phrase: 2, of: 3, at: at(6) }));
    expect(notYet).toMatchObject({ step: 'phrase', recorded: 3 });
    expect(reduceEnrolStatus(s, { voice: { enrolled: ['dana'], enrolment: { name: 'matt', phase: 'done', of: 3, at: at(6) } } }).step).toBe('phrase');
    s = reduceEnrolStatus(s, { voice: { enrolled: ['matt'], enrolment: { name: 'matt', phase: 'done', phrase: 2, of: 3, at: at(6) } } });
    expect(s).toMatchObject({ step: 'done', recorded: 3 });
    expect(enrolLine(s)).toBe("Gnomon knows matt's voice now.");
  });
  it('another name, a previous attempt (stamped before the allow) and no enrolment change nothing; a failure says why', () => {
    const T = Date.parse('2026-10-19T10:00:00Z');
    const s = enrolAllowed(enrolSent(enrolStart(), 'matt', null), T);
    const en = (e: Record<string, unknown>) => ({ voice: { enrolment: e } });
    expect(reduceEnrolStatus(s, en({ name: 'dana', phase: 'ready', at: '2026-10-19T10:00:01Z' }))).toBe(s);
    expect(reduceEnrolStatus(s, en({ name: 'matt', phase: 'done', at: '2026-10-19T09:00:00Z' }))).toBe(s);
    expect(reduceEnrolStatus(s, { voice: { enrolment: null } })).toBe(s);
    expect(reduceEnrolStatus(s, null)).toBe(s);
    expect(reduceEnrolStatus(s, en({ name: 'matt', phase: 'failed', error: 'the mic is off', at: '2026-10-19T10:00:02Z' }))).toMatchObject({ step: 'failed', error: 'the mic is off' });
    expect(enrolLine(reduceEnrolStatus(s, en({ name: 'matt', phase: 'cancelled', at: '2026-10-19T10:00:02Z' })))).toBe('Not enrolled: the voice app cancelled the recording');
  });
  it('the store no longer folds enrolment or notice rows (they are status.voice, A3/A5)', () => {
    const store = new GuiStore();
    store.enrol = enrolAllowed(enrolSent(enrolStart(), 'matt', 'card:1'), Date.now());
    const before = store.enrol;
    store.apply([{ seq: 1, kind: 'voice.enrol.progress', connId: 'v', payload: { name: 'matt', phase: 'recording', phrase: 0 } }]);
    store.apply([{ seq: 2, kind: 'voice.client.notice', connId: 'v', payload: { text: 'old' } }]);
    expect(store.enrol).toBe(before);
    expect(store.voiceToast).toBeNull();
  });
  it('the page folds status.voice on every status read and polls lightly only while the dialog waits', () => {
    expect(APP).toContain('function foldVoiceReports(');
    expect(APP).toMatch(/foldVoiceReports\(\);\n\s*syncSpeakPoll\(\);\n\s*syncClientPoll\(\);\n\}/);
    const poll = APP.slice(APP.indexOf('function syncEnrolPoll('), APP.indexOf('function syncEnrolPoll(') + 600);
    expect(poll).toContain("s.step === 'confirm' || s.step === 'waiting' || s.step === 'phrase'");
    expect(poll).toContain('ENROL_POLL_MS');
    expect(ENROL_POLL_MS).toBeGreaterThanOrEqual(500);
  });
  it('the Touch ID card is recognised by its op and name (A4)', () => {
    const card = (detail: unknown) => ({ kind: 'strictness', card: { detail } });
    expect(isEnrolCard(card({ op: 'voice.enrol', name: 'matt' }), 'matt')).toBe(true);
    expect(isEnrolCard(card({ op: 'voice.enrol', speakerId: 'spk:m/dana' }), 'matt')).toBe(false);
    expect(isEnrolCard(card({ op: 'voice.widen' }), 'matt')).toBe(false);
    // Aegis L4: a nameless card is never taken for this voice; the legacy op is not accepted
    expect(isEnrolCard(card({ op: 'voice.enrol' }), 'matt')).toBe(false);
    expect(isEnrolCard(card({ op: 'request.voice.enrol', name: 'matt' }), 'matt')).toBe(false);
  });
  it('the page: send / confirm / forget are trusted gestures; confirm approves allow; close denies a card still pending', () => {
    const submit = APP.slice(APP.indexOf('async function submitEnrol('), APP.indexOf('async function closeEnrol('));
    expect(submit).toMatch(/if \(!trusted \|\| !s\) return;/);
    expect(submit).toContain("client.call<Record<string, unknown>>('log.append', v.req)");
    expect(submit).toContain("client.call('approve', { cardId, decision: 'allow' })");
    expect(submit).toContain('enrolAllowed(');
    const close = APP.slice(APP.indexOf('async function closeEnrol('), APP.indexOf('let forgetArmed'));
    expect(close).toContain("decision: 'deny'");
    expect(close).toContain("s.step === 'confirm'");
    const forget = APP.slice(APP.indexOf('async function forgetVoice('), APP.indexOf('let toastTimer'));
    expect(forget).toMatch(/if \(!trusted \|\| !client \|\| !canAttach\(status\)\) return;/);
    expect(forget).toContain('forgetRequest(name)');
    // the enrolment is inline under "your voice" in the Voice settings sheet (no dialog of its own)
    expect(HTML).toContain('id="voice-settings"');
    expect(HTML).not.toContain('id="enrol-dialog"');
    // Aegis L2: the dev-unsigned banner is persistent (an alert repainted from status, never a timed toast)
    expect(HTML).toMatch(/id="voice-dev"[^>]*role="alert"/);
    expect(APP).toContain("$('voice-dev').hidden = dev === null;");
    expect(APP).not.toMatch(/setTimeout\([^)]*voice-dev/);
  });
});

describe('client notices are quiet toasts', () => {
  it('status.voice.notice is the toast (A5): text and at, capped and one line; absent is null', () => {
    // Aegis L6: attributed to the voice app, always
    expect(noticeOf({ voice: { notice: { text: 'open Gnomon to turn on ambient', code: 'ambient-above-ceiling', at: '2026-10-19T10:00:00Z' } } })).toEqual({ text: 'Voice app: open Gnomon to turn on ambient', at: '2026-10-19T10:00:00Z' });
    expect(noticeOf({ voice: { notice: { text: 'mic\n busy' } } })).toEqual({ text: 'Voice app: mic busy', at: null });
    expect(noticeOf({ voice: { notice: null } })).toBeNull();
    expect(noticeOf({ voice: {} })).toBeNull();
    expect(noticeOf(null)).toBeNull();
    expect(noticeOf({ voice: { notice: { text: 'x'.repeat(500) } } })!.text.length).toBe(140);
  });
  it('a stale notice is not toasted', () => {
    expect(toastFresh('2026-10-19T10:00:00Z', Date.parse('2026-10-19T10:00:10Z'))).toBe(true);
    expect(toastFresh('2026-10-19T10:00:00Z', Date.parse('2026-10-19T10:05:00Z'))).toBe(false);
  });
  it('lifecycle rows make the page re-read status', () => {
    for (const k of ['voice.client.start', 'voice.enrol', 'voice.forget']) expect(isClientRow(k)).toBe(true);
    // request.voice.* are dispatcher-only (never a row under their own name)
    for (const k of ['voice.turn.user', 'request.voice.client']) expect(isClientRow(k)).toBe(false);
    const store = new GuiStore();
    const seen: string[] = [];
    store.onChange((w) => seen.push(...w));
    store.apply([{ seq: 1, kind: 'voice.client.crashed', connId: 'k', payload: {} }]);
    expect(seen).toContain('voice');
  });
});

describe('spoken replies: the kernel row carries a spoken-aloud marker, the voice app playback is not shown twice', () => {
  const row = (seq: number, kind: string, payload: unknown): Row => ({ seq, kind, connId: 'k', session: A, payload, view: 'full' } as Row);
  it('kernel-speakable shows spoken aloud and swallows the matching playback row', () => {
    const { items } = chatItems([row(1, 'voice.turn.agent', { source: 'kernel-speakable', items: [{ text: 'Done.' }] }), row(2, 'voice.turn.agent', { textSpoken: 'Done.', textPlanned: 'Done.' })]);
    expect(items.filter((i) => i.role === 'spoken').map((i) => i.text)).toEqual(['spoken aloud']);
  });
  it('founder bug: a reply spoken sentence by sentence (pipelined TTS) shows ONE marker, with its seconds', () => {
    const play = (seq: number, t0: number, ms: number, text: string, cut = false) => row(seq, 'voice.turn.agent', { turnId: `a${seq}`, t0, t1: t0 + ms, textPlanned: text, textSpoken: cut ? '' : text, ...(cut ? { interrupted: true } : {}) });
    const reply = (seq: number, text: string) => row(seq, 'turn.event', { type: 'assistant', line: JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }) });
    const kern = (seq: number) => row(seq, 'voice.turn.agent', { source: 'kernel-speakable', items: [{ text: 'One. Two. Three.' }] });
    const spoken = (rows: Row[]) => chatItems(rows).items.filter((i) => i.role === 'spoken').map((i) => i.text);
    expect(spoken([reply(1, 'One. Two. Three.'), kern(2), play(3, 0, 1500, 'One.'), play(4, 1500, 1500, 'Two.'), play(5, 3000, 1600, 'Three.')])).toEqual(['spoken aloud · 5s']);
    // an older kernel (no speakable row): the first playback row opens the marker, the rest fold into it
    expect(spoken([reply(1, 'One. Two.'), play(2, 0, 1200, 'One.'), play(3, 1200, 1200, 'Two.')])).toEqual(['spoken aloud · 2s']);
    // the next reply gets its own marker
    expect(spoken([reply(1, 'One.'), kern(2), play(3, 0, 1000, 'One.'), reply(4, 'Two.'), kern(5), play(6, 0, 2000, 'Two.')])).toEqual(['spoken aloud · 1s', 'spoken aloud · 2s']);
  });
  it('a chunk cut off (barge-in or stop) keeps the one marker and marks it stopped; a lone barge-in still says interrupted', () => {
    const play = (seq: number, t0: number, ms: number, text: string, cut = false) => row(seq, 'voice.turn.agent', { turnId: `a${seq}`, t0, t1: t0 + ms, textPlanned: text, textSpoken: cut ? '' : text, ...(cut ? { interrupted: true } : {}) });
    const kern = (seq: number) => row(seq, 'voice.turn.agent', { source: 'kernel-speakable', items: [{ text: 'One. Two. Three.' }] });
    const rows = [kern(1), play(2, 0, 1500, 'One.'), play(3, 1500, 1500, 'Two.'), row(4, 'voice.bargein', { turnId: 'a5', atMs: 3500, heardText: 'wait' }), play(5, 3000, 500, 'Three.', true)];
    const { items } = chatItems(rows);
    expect(items.filter((i) => i.role === 'spoken').map((i) => i.text)).toEqual(['spoken aloud · 4s · stopped']);
    expect(items.find((i) => i.role === 'spoken')?.key).toBe('1');
    // stopped without a barge-in row (⏹ Stop speaking): the interrupted chunk alone marks it
    expect(chatItems([kern(1), play(2, 0, 1000, 'One.'), play(3, 1000, 400, 'Two.', true)]).items.map((i) => i.text)).toEqual(['spoken aloud · 1s · stopped']);
    expect(chatItems([row(1, 'voice.bargein', { turnId: 'a1', atMs: 1, heardText: 'wait' })]).items.map((i) => i.text)).toEqual(['interrupted']);
  });
  it('an older kernel (playback only) keeps the V2d marker; an empty speakable shows nothing', () => {
    expect(chatItems([row(1, 'voice.turn.agent', { textSpoken: 'Hi', textPlanned: 'Hi there' })]).items.map((i) => i.text)).toEqual(['spoken aloud · stopped']);
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
    expect(APP.slice(APP.indexOf('function openEnrolFlow('), APP.indexOf('function openEnrol(')).match(/canAttach\(status\)/)).not.toBeNull();
    expect(APP.slice(APP.indexOf('async function submitEnrol('), APP.indexOf('async function closeEnrol(')).match(/canAttach\(status\)/)).not.toBeNull();
  });
});
