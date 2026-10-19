/**
 * #gui voice controls (V2d, TD-2026-10-19-298): the pure core (core/voice.ts), the store's voice flags, idle note and
 * transcript items, the palette entries, and the page wiring read from the source (the app is browser glue; its
 * decisions are the pure functions tested here).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BLOCK_SAFE_COMMANDS, paletteEntries } from '../src/core/commands.js';
import { chatItems, GuiStore, type Row } from '../src/core/store.js';
import { canAttach, idleNoteOf, pillOf, planVoice, speakerName, voiceMenuEntries, voiceRequest, voiceStatusOf } from '../src/core/voice.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
const B = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZB';
const VS = 'vs:01HZZZZZZZZZZZZZZZZZZZZZZV';
const voiceClient = { connId: 'c2', principal: 'voice:app', principalKind: 'voice', surface: 'voice' };
const human = (voice: unknown, extra: Record<string, unknown> = {}) => ({ principalKind: 'human', voice, clients: [{ connId: 'c1', principal: 'human:m', principalKind: 'human', surface: 'gui' }, voiceClient], ...extra });
const v1Attached = (mode: string) => human({ attached: { voiceSessionId: VS, hsid: A, mode, turns: 2 }, echoTailMs: 750 });
const v2aAttached = (mode: string, more: Record<string, unknown> = {}) => human({ attached: true, voiceSessionId: VS, hsid: A, mode, ceiling: 'conversation', since: '2026-10-19T10:00:00Z', idleAt: '2026-10-19T10:10:00Z', clientConnected: true, ...more });
const off = (more: Record<string, unknown> = {}) => human({ attached: null, ...more });

describe('voice pill: state is the kernel status only', () => {
  it('Mic off (grey), push-to-talk (blue, names the hotkey), ambient (red, Listening); each names the attached session', () => {
    expect(pillOf(voiceStatusOf(off()))).toMatchObject({ state: 'off', label: 'Mic off', target: '', className: expect.stringContaining('voice-off') });
    expect(pillOf(voiceStatusOf(v1Attached('ptt')))).toMatchObject({ state: 'ptt', label: 'Hold ⌃⌥Space to talk', target: A.slice(-10), className: expect.stringContaining('voice-ptt') });
    expect(pillOf(voiceStatusOf(v1Attached('conversation')))).toMatchObject({ state: 'ambient', label: 'Listening', target: A.slice(-10), className: expect.stringContaining('voice-ambient') });
    expect(pillOf(voiceStatusOf(v1Attached('conversation'))).className).toContain('kernel-owned');
  });
  it('reads both the V1 nested shape and the V2a flat shape (attached: true + hsid, ceiling, since, idleAt)', () => {
    const v = voiceStatusOf(v2aAttached('ptt'));
    expect(v).toMatchObject({ known: true, state: 'ptt', hsid: A, voiceSessionId: VS, ceiling: 'ambient', since: '2026-10-19T10:00:00Z', idleAt: '2026-10-19T10:10:00Z', clientConnected: true });
    expect(voiceStatusOf(v1Attached('ptt'))).toMatchObject({ state: 'ptt', hsid: A, voiceSessionId: VS, clientConnected: true });
  });
  it('fails toward the louder indicator: an attached session with an unknown mode reads as ambient; no status reads as off', () => {
    expect(voiceStatusOf(v1Attached('whisper')).state).toBe('ambient');
    expect(voiceStatusOf(null)).toMatchObject({ known: false, state: 'off' });
    expect(voiceStatusOf({ voice: { attached: { mode: 'ptt' } } }).state).toBe('off'); // no hsid: not an attachment
  });
  it('the voice app not connected ⇒ "Voice app not running" (from status.voice.clientConnected, else status.clients)', () => {
    expect(pillOf(voiceStatusOf(v2aAttached('ptt', { clientConnected: false })))).toMatchObject({ state: 'noclient', label: 'Voice app not running' });
    expect(pillOf(voiceStatusOf({ principalKind: 'human', voice: { attached: null }, clients: [{ principalKind: 'human' }] }))).toMatchObject({ label: 'Voice app not running' });
    expect(voiceStatusOf({ principalKind: 'human', voice: { attached: null } }).clientConnected).toBeNull(); // unknown: not claimed missing
  });
  it('the pill never takes a voice row (the client) as its state: only status moves it', () => {
    const s = new GuiStore();
    const what = s.apply([{ seq: 1, view: 'full', event: { kind: 'voice.turn.user', session: A, payload: { turnId: '1', mode: 'conversation', text: 'hi', speakerId: 'spk:home/matt', speakerEnrolled: true, forwarded: true } } }]);
    expect(what.has('voice')).toBe(false); // a client turn does not re-read status, let alone set it
    expect(what.has('voice-activity')).toBe(true); // it only kicks the meter
    expect(s.apply([{ seq: 2, view: 'full', event: { kind: 'voice.session.start', session: A, payload: { voiceSessionId: VS, hsid: A, mode: 'ptt' } } }]).has('voice')).toBe(true);
  });
});

describe('voice: attach and switch send the right appends', () => {
  it('attach from off sends voice.session.start{hsid, mode}; ambient is mode conversation on the wire', () => {
    expect(voiceRequest(voiceStatusOf(off()), 'ptt', A)).toEqual({ kind: 'voice.session.start', payload: { hsid: A, mode: 'ptt' } });
    expect(voiceRequest(voiceStatusOf(off()), 'ambient', A)).toEqual({ kind: 'voice.session.start', payload: { hsid: A, mode: 'conversation' } });
  });
  it('a switch on the same session continues its voice session; another session is a fresh attach; Off ends it', () => {
    const amb = voiceStatusOf(v1Attached('conversation'));
    expect(voiceRequest(amb, 'ptt', A)).toEqual({ kind: 'voice.session.start', payload: { hsid: A, mode: 'ptt', continues: VS } });
    expect(voiceRequest(amb, 'ptt', B)).toEqual({ kind: 'voice.session.start', payload: { hsid: B, mode: 'ptt' } });
    expect(voiceRequest(amb, 'off', A)).toEqual({ kind: 'voice.session.end', payload: { voiceSessionId: VS } });
    expect(voiceRequest(voiceStatusOf(off()), 'off', null)).toBeNull();
  });
  it('ambient → push-to-talk and Off are instant and free; the same choice is a no-op', () => {
    const amb = voiceStatusOf(v1Attached('conversation'));
    expect(planVoice(amb, 'ptt', A, false)).toEqual({ kind: 'free' });
    expect(planVoice(amb, 'off', A, false)).toEqual({ kind: 'free' });
    expect(planVoice(amb, 'ambient', A, false)).toEqual({ kind: 'same' });
  });
  it('ambient needs Touch ID the first time in a GUI login, not after (or when the kernel already holds the presence)', () => {
    const ptt = voiceStatusOf(v1Attached('ptt'));
    expect(planVoice(ptt, 'ambient', A, false)).toEqual({ kind: 'presence' });
    expect(planVoice(ptt, 'ambient', A, true)).toEqual({ kind: 'free' });
    expect(planVoice(voiceStatusOf(off({ ambientConfirmed: true })), 'ambient', A, false)).toEqual({ kind: 'free' });
    expect(voiceMenuEntries(ptt, A, true, false).find((e) => e.state === 'ambient')?.note).toContain('needs Touch ID');
    expect(voiceMenuEntries(ptt, A, true, false).find((e) => e.state === 'off')?.note).not.toContain('Touch ID');
  });
  it('a ceiling blocks a louder state with its reason; nothing focused blocks an attach', () => {
    const capped = voiceStatusOf(v2aAttached('ptt', { ceiling: 'ptt' }));
    expect(planVoice(capped, 'ambient', A, true)).toEqual({ kind: 'blocked', reason: 'voice ceiling push-to-talk' });
    expect(planVoice(voiceStatusOf(off()), 'ptt', null, false)).toEqual({ kind: 'blocked', reason: 'no session focused' });
  });
  it('the menu offers Off / Push-to-talk / Ambient, marks the current one, and "Attach to <focused>" when another session is focused', () => {
    const m = voiceMenuEntries(voiceStatusOf(v1Attached('ptt')), B, true, false);
    expect(m.map((e) => e.label)).toEqual(['Off', 'Push-to-talk', 'Ambient', `Attach to ${B.slice(-10)}`]);
    expect(m.find((e) => e.state === 'ptt')?.current).toBe(true);
    expect(voiceMenuEntries(voiceStatusOf(v1Attached('ptt')), A, true, false).some((e) => e.id === 'voice.attach')).toBe(false);
  });
});

describe('voice: a voice connection is never offered attach controls', () => {
  it('canAttach is the human class only', () => {
    expect(canAttach(off())).toBe(true);
    expect(canAttach({ principalKind: 'voice', voice: { attached: null } })).toBe(false);
    expect(canAttach({ principalKind: 'agent' })).toBe(false);
    expect(canAttach(null)).toBe(false);
  });
  it('a non-human connection sees the states but every one disabled, and no Attach entry', () => {
    const m = voiceMenuEntries(voiceStatusOf({ principalKind: 'voice', voice: { attached: { voiceSessionId: VS, hsid: A, mode: 'ptt' } } }), B, false, false);
    expect(m.every((e) => e.disabled)).toBe(true);
    expect(m.some((e) => e.id === 'voice.attach')).toBe(false);
  });
  it('the page renders [Voice ▾] only under canAttach, and setVoice refuses without it', () => {
    const app = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
    expect(app).toMatch(/isLiveState\(s\.state\) && canAttach\(status\)\) list\.appendChild\(voiceRowEl/);
    expect(app).toMatch(/if \(!canAttach\(status\)\) return notice\('only a human connection attaches voice', true\);/);
  });
});

describe('voice: the kernel idle auto-off', () => {
  it('a voice.session.end{reason: idle} reads "Ambient turned off after 10 min idle" (its own minutes when it gives them)', () => {
    expect(idleNoteOf('voice.session.end', { voiceSessionId: VS, reason: 'idle' })).toBe('Ambient turned off after 10 min idle');
    expect(idleNoteOf('voice.session.end', { reason: 'idle-timeout', idleMs: 300_000 })).toBe('Ambient turned off after 5 min idle');
    expect(idleNoteOf('voice.session.end', { voiceSessionId: VS })).toBeNull(); // a human Off is not an idle note
    expect(idleNoteOf('voice.session.start', { reason: 'idle' })).toBeNull();
  });
  it('the store holds the note (and re-reads status) until the next attachment; the transcript shows it as a system line', () => {
    const s = new GuiStore();
    const end = { seq: 3, view: 'full', event: { kind: 'voice.session.end', session: A, payload: { voiceSessionId: VS, reason: 'idle', turns: 4 } } };
    expect(s.apply([end]).has('voice')).toBe(true);
    expect(s.voiceNote).toBe('Ambient turned off after 10 min idle');
    expect(chatItems(s.transcript(A)).items.map((i) => i.text)).toContain('Ambient turned off after 10 min idle');
    s.apply([{ seq: 4, view: 'full', event: { kind: 'voice.session.start', session: A, payload: { voiceSessionId: 'vs:2', hsid: A, mode: 'ptt' } } }]);
    expect(s.voiceNote).toBeNull();
    // and the pill after it: status says not attached ⇒ Mic off
    expect(pillOf(voiceStatusOf(off())).label).toBe('Mic off');
  });
});

describe('voice in the transcript', () => {
  const user = (seq: number, turnId: string, text: string, more: Record<string, unknown> = {}): Row => ({ seq, kind: 'voice.turn.user', session: A, view: 'full', payload: { turnId, t0: 1, t1: 2, mode: 'ptt', text, speakerId: 'spk:home/matt', speakerEnrolled: true, forwarded: true, ...more } });
  const replay = (seq: number, text: string): Row => ({ seq, kind: 'turn.event', session: A, view: 'full', payload: { line: JSON.stringify({ type: 'user', message: { content: text } }) } });
  it('a sent voice turn is the user message with a 🎙 speaker tag; claude\'s replay of it shows once; turn.sent{source: voice} adds nothing more', () => {
    const rows: Row[] = [user(1, '1', 'run the tests'), { seq: 2, kind: 'turn.sent', session: A, view: 'full', payload: { source: 'voice', voiceSessionId: VS, voiceTurnId: '1', voiceTurnSeq: 1 } }, replay(3, 'run the tests')];
    const { items } = chatItems(rows);
    expect(items.map((i) => [i.role, i.text, i.speaker])).toEqual([['user', 'run the tests', 'matt']]);
  });
  it('a turn.sent{source: voice} whose voice row the page cannot read still shows as a 🎙 turn', () => {
    const { items } = chatItems([{ seq: 5, kind: 'turn.sent', session: A, view: 'full', payload: { source: 'voice', voiceTurnSeq: 4 } }]);
    expect(items[0]).toMatchObject({ role: 'user', speaker: 'voice' });
    expect(chatItems([{ seq: 6, kind: 'turn.sent', session: A, view: 'full', payload: { source: 'client' } }]).items).toEqual([]);
  });
  it('a partial shows grey only while it is the latest word on its turn', () => {
    const p1: Row = { seq: 1, kind: 'voice.turn.partial', session: A, view: 'full', payload: { turnId: '7', text: 'run the', speakerId: 'spk:home/matt' } };
    const p2: Row = { seq: 2, kind: 'voice.turn.user', session: A, view: 'full', payload: { turnId: '7', partial: true, text: 'run the tes', speakerId: 'spk:home/matt' } };
    expect(chatItems([p1, p2]).items.map((i) => [i.role, i.text])).toEqual([['voice-partial', 'run the tes']]);
    expect(chatItems([p1, p2, user(3, '7', 'run the tests')]).items.map((i) => i.role)).toEqual(['user']);
  });
  it('a reply the voice app spoke gets a 🔊 marker (in part when it stopped early)', () => {
    const agent = (spoken: string): Row => ({ seq: 9, kind: 'voice.turn.agent', session: A, view: 'full', payload: { turnId: '1', t0: 1, t1: 2, textPlanned: 'all tests pass', textSpoken: spoken } });
    expect(chatItems([agent('all tests pass')]).items.map((i) => [i.role, i.text])).toEqual([['spoken', '🔊 spoken aloud']]);
    expect(chatItems([agent('all')]).items[0]?.text).toBe('🔊 spoken aloud (in part)');
  });
  it('a refused voice turn shows the refusal reason inline, subtly', () => {
    expect(chatItems([user(1, '1', 'deploy it', { forwarded: false, refusal: { reason: 'voice-stale-utterance' } })]).items[0]).toMatchObject({ role: 'voice-refused', text: expect.stringContaining('not sent · voice-stale-utterance') });
    expect(chatItems([{ seq: 2, kind: 'session.send.refused', session: A, view: 'full', payload: { source: 'voice', reason: 'voice-speaker' } }]).items[0]).toMatchObject({ role: 'voice-refused', text: 'voice turn not sent · voice-speaker' });
    // a non-voice refusal is still an error line
    expect(chatItems([{ seq: 3, kind: 'session.refused', session: A, view: 'full', payload: { reason: 'budget' } }]).items[0]?.role).toBe('error');
  });
  it('heard-but-not-sent and intercepted turns are subtle lines, never the user message', () => {
    expect(chatItems([user(1, '1', 'yes', { forwarded: false, intercepted: 'decision' })]).items[0]).toMatchObject({ role: 'voice-heard', text: 'matt · handled as a decision: yes' });
    expect(chatItems([user(1, '1', 'hm', { forwarded: false })]).items[0]?.role).toBe('voice-heard');
  });
  it('speaker names: spk:<ns>/<name> → name, spk:unknown-N → unknown speaker N', () => {
    expect(speakerName('spk:home/matt')).toBe('matt');
    expect(speakerName('spk:unknown-2')).toBe('unknown speaker 2');
    expect(speakerName(undefined)).toBe('voice');
  });
});

describe('voice: palette, blocks and page wiring', () => {
  const app = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'static', 'index.html'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'static', 'styles.css'), 'utf8');
  it('the palette carries Voice: off / push-to-talk / ambient; no block button can change voice', () => {
    const ids = paletteEntries(null).map((c) => c.id);
    for (const id of ['voice.off', 'voice.ptt', 'voice.ambient']) expect(ids).toContain(id);
    for (const id of BLOCK_SAFE_COMMANDS) expect(id.startsWith('voice.')).toBe(false);
  });
  it('the header carries the kernel-owned pill, always visible (not hidden), with its menu and meter', () => {
    expect(html).toMatch(/<button id="voice-pill" class="voice-pill kernel-owned voice-off"(?![^>]*\shidden)[^>]*>/);
    expect(html).toContain('id="voice-menu"');
    expect(html).toContain('id="voice-meter"');
  });
  it('a choice is sent only on a trusted gesture; an ambient presence card is approved allow in the same gesture', () => {
    expect(app).toMatch(/async function setVoice\(to: VoiceState, hsid: string \| null, trusted: boolean\): Promise<void> \{\s*if \(!trusted\) return;/);
    expect(app).toMatch(/client\.call<Record<string, unknown>>\('log\.append', req\);\s*if \(r\.pending === true && typeof r\.cardId === 'string'\) \{\s*notice\(`Ambient[\s\S]{0,120}client\.call\('approve', \{ cardId: r\.cardId, decision: 'allow' \}\)/);
    expect(app).toContain('voicePresenceDone = false; // ambient\'s Touch ID is once per GUI login');
  });
  it('the pill is repainted from status on a voice row, never on a timer', () => {
    expect(app).toContain("if (w.has('modes') || w.has('voice')) void refreshStatus();");
    expect(app).not.toMatch(/setInterval\(/);
  });
  it('contrast and motion: ambient uses the fixture voice-armed pair, the pulse stops under reduced motion', () => {
    const fx = JSON.parse(readFileSync(path.join(ROOT, '..', '..', 'docs', 'specs', 'gnomon-fixtures', 'contrast.json'), 'utf8'));
    const pair = fx.themes.day.pairs.find((p: { what: string }) => p.what.startsWith('voice-armed'));
    expect(css).toContain(`--warn-ink: ${pair.fg};`);
    expect(css).toContain(`--warn-bg: ${pair.bg};`);
    expect(css).toMatch(/\.voice-pill\.voice-ambient \{ color: var\(--warn-ink\); background: var\(--warn-bg\);/);
    expect(css).toContain(`--slate: ${fx.themes.day.text.slate};`);
    expect(css).toContain(`--slate: ${fx.themes.night.text.slate};`);
    expect(css).toMatch(/\[data-motion="reduced"\] \*[\s\S]{0,120}animation: none !important/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
});
