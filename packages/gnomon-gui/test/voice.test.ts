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
import { canAttach, cardNoticeStep, idleNoteOf, isVoiceWidenCard, pillOf, planVoice, speakerName, voiceRefusalNote, voiceRequest, voiceStatusOf, VOICE_ACTIVITY_KINDS } from '../src/core/voice.js';
import { ladderEntries } from '../src/core/voice-ladder.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
const B = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZB';
const VS = 'vs:01HZZZZZZZZZZZZZZZZZZZZZZV';
const voiceClient = { connId: 'c2', principal: 'voice:app', principalKind: 'voice', surface: 'voice' };
const human = (voice: unknown, extra: Record<string, unknown> = {}) => ({ principalKind: 'human', voice, clients: [{ connId: 'c1', principal: 'human:m', principalKind: 'human', surface: 'gui' }, voiceClient], ...extra });
const v1Attached = (mode: string) => human({ attached: { voiceSessionId: VS, hsid: A, mode, turns: 2 }, echoTailMs: 750 });
// V2a (feat/gnomon-voice-v2a @ f40a0abc): no `mode`; `ceiling` is what the attachment may hear now
const v2aAttached = (ceiling: string, more: Record<string, unknown> = {}) => human({ attached: true, voiceSessionId: VS, hsid: A, ceiling, since: '2026-10-19T10:00:00Z', idleAt: '2026-10-19T10:10:00Z', turns: { n: 3 }, echoTailMs: 750, ambientIdleMs: 600_000, clientConnected: true, ...more });
const off = (more: Record<string, unknown> = {}) => human({ attached: null, ...more });

describe('voice pill: state is the kernel status only', () => {
  it('Mic off (grey), push-to-talk (blue, names the hotkey), ambient (red, Listening); each names the attached session', () => {
    expect(pillOf(voiceStatusOf(off()))).toMatchObject({ state: 'off', label: 'Mic off', target: '', className: expect.stringContaining('voice-off') });
    expect(pillOf(voiceStatusOf(v1Attached('ptt')))).toMatchObject({ state: 'ptt', label: 'Hold ⌃⌥Space to talk', target: A.slice(-10), className: expect.stringContaining('voice-ptt') });
    expect(pillOf(voiceStatusOf(v1Attached('conversation')))).toMatchObject({ state: 'ambient', label: 'Listening', target: A.slice(-10), className: expect.stringContaining('voice-ambient') });
    expect(pillOf(voiceStatusOf(v1Attached('conversation'))).className).toContain('kernel-owned');
  });
  it('reads both the V1 nested shape and the V2a flat shape (attached: boolean, hsid, ceiling = the state, since, idleAt, ambientIdleMs)', () => {
    const v = voiceStatusOf(v2aAttached('ptt'));
    expect(v).toMatchObject({ known: true, state: 'ptt', hsid: A, voiceSessionId: VS, ceiling: 'ambient', since: '2026-10-19T10:00:00Z', idleAt: '2026-10-19T10:10:00Z', clientConnected: true, ambientIdleMs: 600_000 });
    expect(voiceStatusOf(v2aAttached('conversation')).state).toBe('ambient');
    expect(voiceStatusOf(human({ attached: false, hsid: null, ceiling: null })).state).toBe('off');
    // the V2a ceiling is the attachment's state, never a cap: push-to-talk may still widen (with Touch ID)
    expect(planVoice(voiceStatusOf(v2aAttached('ptt')), 'ambient', A, false)).toEqual({ kind: 'presence' });
    expect(voiceStatusOf(v1Attached('ptt'))).toMatchObject({ state: 'ptt', hsid: A, voiceSessionId: VS, clientConnected: null }); // no explicit field: unsure
  });
  it('fails toward the louder indicator: an attached session with an unknown mode reads as ambient; no status reads as off', () => {
    expect(voiceStatusOf(v1Attached('whisper')).state).toBe('ambient');
    expect(voiceStatusOf(null)).toMatchObject({ known: false, state: 'off' });
    expect(voiceStatusOf({ voice: { attached: { mode: 'ptt' } } }).state).toBe('off'); // no hsid: not an attachment
  });
  it('never under-reports a live mic: attached + voice app not connected keeps the state, class and meter, adding a note', () => {
    expect(pillOf(voiceStatusOf(v2aAttached('conversation', { clientConnected: false })))).toMatchObject({ state: 'ambient', label: 'Listening · voice app not connected', className: expect.stringContaining('voice-ambient') });
    expect(pillOf(voiceStatusOf(v2aAttached('ptt', { clientConnected: false })))).toMatchObject({ state: 'ptt', label: 'Hold ⌃⌥Space to talk · voice app not connected' });
    expect(pillOf(voiceStatusOf(off({ clientConnected: false })))).toMatchObject({ state: 'noclient', label: 'Voice app not running' });
  });
  it('clientConnected is null when unsure: no client-name heuristic ever decides false', () => {
    expect(voiceStatusOf({ principalKind: 'human', voice: { attached: null }, clients: [{ principalKind: 'human' }] }).clientConnected).toBeNull();
    expect(voiceStatusOf({ principalKind: 'human', voice: { attached: null } }).clientConnected).toBeNull();
    expect(pillOf(voiceStatusOf(off())).label).toBe('Mic off');
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
  it('only the voice-widen presence card for the same session is approved in the gesture (Aegis L)', () => {
    const card = (kind: string, detail: Record<string, unknown>, hsid: string | null = A) => ({ kind, hsid, card: { cardId: 'card:1', kind, detail } });
    expect(isVoiceWidenCard(card('strictness', { op: 'voice.widen', hsid: A }), A)).toBe(true);
    expect(isVoiceWidenCard(card('strictness', { op: 'voice.widen' }), A)).toBe(true); // the card's own hsid
    expect(isVoiceWidenCard(card('strictness', { op: 'voice.widen', hsid: B }), A)).toBe(false);
    expect(isVoiceWidenCard(card('strictness', { op: 'mode.loosen', hsid: A }), A)).toBe(false);
    expect(isVoiceWidenCard(card('tool', { op: 'voice.widen', hsid: A }), A)).toBe(false);
    expect(isVoiceWidenCard(undefined, A)).toBe(false); // not in the store yet: the stack decides
  });
  it('ambient needs Touch ID the first time in a GUI login, not after (or when the kernel already holds the presence)', () => {
    const ptt = voiceStatusOf(v1Attached('ptt'));
    expect(planVoice(ptt, 'ambient', A, false)).toEqual({ kind: 'presence' });
    expect(planVoice(ptt, 'ambient', A, true)).toEqual({ kind: 'free' });
    expect(planVoice(voiceStatusOf(off({ ambientConfirmed: true })), 'ambient', A, false)).toEqual({ kind: 'free' });
  });
  it('a ceiling blocks a louder state with its reason; nothing focused blocks an attach', () => {
    const capped = voiceStatusOf(v2aAttached('ptt', { maxMode: 'ptt' }));
    expect(planVoice(capped, 'ambient', A, true)).toEqual({ kind: 'blocked', reason: 'voice ceiling push-to-talk' });
    expect(planVoice(voiceStatusOf(off()), 'ptt', null, false)).toEqual({ kind: 'blocked', reason: 'no session focused' });
  });
});

describe('voice: a voice connection is never offered attach controls', () => {
  it('canAttach is the human class only', () => {
    expect(canAttach(off())).toBe(true);
    expect(canAttach({ principalKind: 'voice', voice: { attached: null } })).toBe(false);
    expect(canAttach({ principalKind: 'agent' })).toBe(false);
    expect(canAttach(null)).toBe(false);
  });
  it('a non-human connection sees the ladder but every rung disabled, with the reason in words', () => {
    const m = ladderEntries({ rung: 'talk', hotkey: '⌃⌥Space', attachable: false, target: B, ceiling: 'ambient', acked: true, sendWord: null });
    expect(m.every((e) => e.disabled)).toBe(true);
    expect(m.every((e) => e.why === 'only you, from this window, can attach voice')).toBe(true);
  });
  it('voice attaches from the header pill menu only (fidelity 2: no rail row), and setVoice refuses without canAttach', () => {
    const app = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
    expect(app).not.toMatch(/voiceRowEl|data-voice-row/);
    expect(app).toMatch(/ladderEntries\(\{ \.\.\.readiness\(\), rung: rungOf\(v, voicePreset\), hotkey: v\.hotkey, attachable: canAttach\(status\)/);
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
  it('the note names the kernel\'s own ambientIdleMs when the end row does not', () => {
    expect(idleNoteOf('voice.session.end', { reason: 'idle' }, 15 * 60_000)).toBe('Ambient turned off after 15 min idle');
    const s = new GuiStore();
    s.voiceIdleMs = 20 * 60_000;
    s.apply([{ seq: 1, view: 'full', event: { kind: 'voice.session.end', session: A, payload: { voiceSessionId: VS, reason: 'idle' } } }]);
    expect(s.voiceNote).toBe('Ambient turned off after 20 min idle');
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
  const sent = (seq: number, voiceTurnSeq: number): Row => ({ seq, kind: 'turn.sent', session: A, view: 'full', payload: { source: 'voice', voiceSessionId: VS, voiceTurnSeq } });
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
  it('T-2026-10-20-005: no partial-text row ever renders (voice.turn.partial is not a kind; live words never ride the log)', () => {
    const p1: Row = { seq: 1, kind: 'voice.turn.partial', session: A, view: 'full', payload: { turnId: '7', text: 'run the', speakerId: 'spk:home/matt' } };
    const p2: Row = { seq: 2, kind: 'voice.turn.user', session: A, view: 'full', payload: { turnId: '7', partial: true, text: 'run the tes', speakerId: 'spk:home/matt' } };
    expect(chatItems([p1, p2]).items).toEqual([]);
    expect(chatItems([p1, p2, user(3, '7', 'run the tests'), sent(4, 3)]).items.map((i) => [i.role, i.text])).toEqual([['user', 'run the tests']]);
    expect(VOICE_ACTIVITY_KINDS.has('voice.turn.partial')).toBe(false);
  });
  it('a reply the voice app spoke gets a 🔊 marker (· stopped when it stopped early)', () => {
    const agent = (spoken: string): Row => ({ seq: 9, kind: 'voice.turn.agent', session: A, view: 'full', payload: { turnId: '1', t0: 1, t1: 2, textPlanned: 'all tests pass', textSpoken: spoken } });
    expect(chatItems([agent('all tests pass')]).items.map((i) => [i.role, i.text])).toEqual([['spoken', '🔊 spoken aloud']]);
    expect(chatItems([agent('all')]).items[0]?.text).toBe('🔊 spoken aloud · stopped');
  });
  it('a refused voice turn shows the refusal reason inline, subtly: the kernel\'s refusal as fact, the app\'s as an attributed hint', () => {
    expect(chatItems([user(1, '1', 'deploy it', { forwarded: false, refusal: { reason: 'voice-stale-utterance' } })]).items[0]).toMatchObject({ role: 'voice-heard', text: 'matt: “deploy it” · voice app says: not sent · voice-stale-utterance' });
    expect(chatItems([{ seq: 2, kind: 'session.send.refused', session: A, view: 'full', payload: { source: 'voice', reason: 'voice-speaker' } }]).items[0]).toMatchObject({ role: 'voice-refused', text: 'voice turn not sent · voice-speaker' });
    // a non-voice refusal is still an error line
    expect(chatItems([{ seq: 3, kind: 'session.refused', session: A, view: 'full', payload: { reason: 'budget' } }]).items[0]?.role).toBe('error');
  });
  it('a V2a voice-off refusal names its cause; the busy voice-playback says the kernel is still speaking', () => {
    expect(chatItems([user(1, '1', 'go', { forwarded: false, refusal: { reason: 'voice-off', data: { cause: 'aec' } } })]).items[0]?.text).toContain('voice app says: not sent · voice-off · aec');
    expect(voiceRefusalNote('voice-off', { cause: 'aec' })).toContain('echo cancellation');
    expect(voiceRefusalNote('voice-off', { cause: 'ceiling' })).toContain('ceiling');
    expect(voiceRefusalNote('voice-off', { cause: 'presence' })).toContain('Touch ID');
    expect(voiceRefusalNote('voice-playback', { clock: 'kernel', streaming: true })).toBe('Claude is still finishing its reply; try again when it is done (voice-playback · streaming)');
    expect(voiceRefusalNote('budget', null)).toBeNull();
  });
  it('voice drops fix: a hash-only turn the kernel refused at receipt is a refused row with the reason in words and its length, never dropped', () => {
    const refusedRow = (seq: number, extra: Record<string, unknown>): Row => ({ seq, kind: 'voice.turn.user', session: A, view: 'full', payload: { turnId: String(seq), speakerId: 'spk:abcd1234/matt', speakerEnrolled: true, forwarded: false, mode: 'conversation', t0: 1000, t1: 5838, textHash: 'hmac-sha256:' + 'a'.repeat(64), durationMs: 4838, ...extra } });
    expect(chatItems([refusedRow(1, { refusedReason: 'voice-playback' })]).items).toEqual([expect.objectContaining({ role: 'voice-refused', text: 'voice not sent · Claude was still finishing · 4.8 s' })]);
    expect(chatItems([refusedRow(2, { refusedReason: 'voice-speaker', speakerId: 'spk:unknown-1', speakerEnrolled: false, durationMs: 2100 })]).items[0]).toMatchObject({ role: 'voice-refused', text: 'voice not sent · speaker not recognised · 2.1 s' });
    expect(chatItems([refusedRow(3, { refusedReason: 'voice-off', refusedCause: 'aec' })]).items[0]?.text).toContain('no echo cancellation');
    expect(chatItems([refusedRow(4, { refusedReason: 'voice-echo', durationMs: undefined })]).items[0]?.text).toBe('voice not sent · it overlapped my spoken reply · 4.8 s');
    // never a text leak: a row that somehow carries text and a refusal shows the refusal only
    expect(chatItems([refusedRow(5, { refusedReason: 'voice-playback', text: 'secret words' })]).items[0]?.text).not.toContain('secret');
    // an accepted empty-text row is still hidden noise
    expect(chatItems([refusedRow(6, { text: '' })]).items).toEqual([]);
  });
  it('the voice app\'s claims (forwarded, intercepted) never make a user message; only the kernel\'s turn.sent does', () => {
    expect(chatItems([user(1, '1', 'yes', { forwarded: false, intercepted: 'decision' })]).items[0]).toMatchObject({ role: 'voice-heard', text: 'matt: “yes” · voice app says: handled as a decision' });
    expect(chatItems([user(1, '1', 'hm', { forwarded: false })]).items[0]?.text).toBe('matt: “hm” · voice app says: not sent');
    // forwarded: true with no turn.sent is still not a sent message
    expect(chatItems([user(1, '1', 'run it')]).items[0]).toMatchObject({ role: 'voice-heard', text: 'matt: “run it” · not sent to the session' });
    // the kernel's turn.sent turns it into the user's message (a new key, so the row repaints)
    const both = chatItems([user(1, '1', 'run it'), sent(2, 1)]).items;
    expect(both).toEqual([expect.objectContaining({ role: 'user', text: 'run it', speaker: 'matt', key: '1' })]);
    expect(chatItems([user(1, '1', 'run it')]).items[0]?.key).toBe('1.1');
  });
  it('voice bubble text is one line (spoken text carries no layout); speaker names are capped at 32', () => {
    expect(chatItems([user(1, '1', 'line one\n\n   line two'), sent(2, 1)]).items[0]?.text).toBe('line one line two');
    expect(speakerName(`spk:home/${'x'.repeat(80)}`)).toHaveLength(32);
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
    expect(app).toMatch(/async function setVoice\(to: VoiceState, hsid: string \| null, trusted: boolean, send: 'word' \| 'pieces' \| null = attachSend\(voicePreset\)\): Promise<void> \{\s*if \(!trusted\) return;/);
    expect(app).toMatch(/client\.call<Record<string, unknown>>\('log\.append', req\);\s*if \(r\.pending === true && typeof r\.cardId === 'string'\) \{[\s\S]{0,200}if \(!isVoiceWidenCard\(store\.cards\.get\(r\.cardId\), hsid\)\) \{\s*focusCard\(r\.cardId\);[\s\S]{0,200}return;[\s\S]{0,300}client\.call\('approve', \{ cardId: r\.cardId, decision: 'allow' \}\)/);
    expect(app).toContain('voicePresenceDone = false; // ambient\'s Touch ID is once per GUI login');
    // an undecided widen card (strictness, detail.op voice.widen) is focused in the stack
    expect(app).toMatch(/catch \(err\) \{\s*\/\/ the widen card[^\n]*\n\s*focusCard\(r\.cardId\);/);
  });
  it('the pill is repainted from status on a voice row, never on a timer', () => {
    expect(app).toContain("if (w.has('modes') || w.has('voice')) void refreshStatus();");
    // the one timer is V2e's light status poll while the enrol dialog waits on the voice app (syncEnrolPoll), and the dictation tick + ~300 ms status poll while a draft exists (syncDictationTimer, TD-2026-10-20-262), and the ~300 ms status re-read while the voice app speaks (syncSpeakPoll, T-2026-10-19-026), and the 2 s re-read while voice is attached or the app is in a transient phase (syncClientPoll, T-2026-10-20-002)
    expect(app.replace(/function syncEnrolPoll\([\s\S]*?\n\}\n/, '').replace(/function syncDictationTimer\([\s\S]*?\n\}\n/, '').replace(/function syncSpeakPoll\([\s\S]*?\n\}\n/, '').replace(/function syncClientPoll\([\s\S]*?\n\}\n/, '')).not.toMatch(/setInterval\(/);
  });
  it('contrast and motion: the clamp uses the fixture warning pair, the pulse stops under reduced motion', () => {
    const fx = JSON.parse(readFileSync(path.join(ROOT, '..', '..', 'docs', 'specs', 'gnomon-fixtures', 'contrast.json'), 'utf8'));
    const pair = fx.themes.day.pairs.find((p: { what: string }) => p.what.startsWith('voice-armed'));
    expect(css).toContain(`--warn-ink: ${pair.fg};`);
    expect(css).toContain(`--warn-bg: ${pair.bg};`);
    // Atelier 2026-10-21 pill: a clamped voice-sent turn is the 2px amber edge with the fact in --warn-ink
    expect(css).toMatch(/\.voice-pill\.clamp \{ border: 2px solid var\(--warn-edge\);/);
    expect(css).toMatch(/\.voice-fact\.clamp \{ color: var\(--warn-ink\); \}/);
    expect(css).toContain(`--slate: ${fx.themes.day.text.slate};`);
    expect(css).toContain(`--slate: ${fx.themes.night.text.slate};`);
    expect(css).toMatch(/\[data-motion="reduced"\] \*[\s\S]{0,120}animation: none !important/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
  it('the pill (Atelier 2026-10-21): an open mic is a filled --stamp dot with a soft ring, static; amber only for the clamp, vermilion only for speech not sent', () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => /^\.voice-(pill|meter|fact|dot)/.test(l));
    expect(rules.find((l) => l.startsWith('.voice-pill.live .voice-dot'))).toMatch(/background: var\(--stamp\); border-color: var\(--stamp\); box-shadow: 0 0 0 3px/);
    for (const l of rules) {
      expect(l, l).not.toMatch(/infinite|voice-pulse|voice-ring|slate/);
      if (/--warn-/.test(l)) expect(l, l).toMatch(/clamp/);
      if (/--fail/.test(l)) expect(l, l).toMatch(/^\.voice-fact\.fail \{/);
    }
    expect(css).toMatch(/\.voice-meter i \{[^}]*background: var\(--stamp\); height: calc\(15% \+ 85% \* var\(--level\)\);/); // moves only with the real mic level
    expect(css).not.toMatch(/@keyframes voice-(pulse|ring|meter)/);
  });
});

describe('the "decide the pending card" notice clears once its card is decided (T-2026-10-20-002)', () => {
  const pending = (...ids: string[]) => new Set(ids);
  it('a card not seen yet keeps the notice; seen then gone clears it', () => {
    let t = cardNoticeStep({ cardId: 'card:1', seen: false }, pending()).next; // the answer beat the card row
    expect(t).toEqual({ cardId: 'card:1', seen: false });
    let s = cardNoticeStep(t, pending('card:1'));
    expect(s).toEqual({ next: { cardId: 'card:1', seen: true }, clear: false });
    t = s.next;
    s = cardNoticeStep(t, pending('card:2')); // another card still pending: ours was decided
    expect(s).toEqual({ next: null, clear: true });
    expect(cardNoticeStep({ cardId: 'card:1', seen: true }, pending())).toEqual({ next: null, clear: true }); // pending hit 0
    expect(cardNoticeStep(null, pending())).toEqual({ next: null, clear: false });
  });
  it('the store deletes a decided card (the step sees it gone), and the page wires the step', () => {
    const store = new GuiStore();
    let t = cardNoticeStep({ cardId: 'card:1', seen: false }, store.cards).next;
    store.apply([{ seq: 1, kind: 'approval.request', connId: 'k', payload: { card: { cardId: 'card:1', kind: 'strictness', hsid: A, detail: { op: 'other' } } } } as Row]);
    t = cardNoticeStep(t, store.cards).next;
    expect(t).toEqual({ cardId: 'card:1', seen: true });
    store.apply([{ seq: 2, kind: 'approval.decide', connId: 'k', payload: { cardId: 'card:1', decision: 'allow' } } as Row]);
    expect(cardNoticeStep(t, store.cards).clear).toBe(true);
    const app = readFileSync(path.join(ROOT, 'src/ui/app.ts'), 'utf8');
    expect(app).toMatch(/decide the pending card in the stack`\);\s*noticeCard = \{ cardId: r\.cardId, seen: store\.cards\.has\(r\.cardId\) \};/);
    expect(app).toMatch(/cardNoticeStep\(noticeCard, store\.cards\);\s*if \(step\.clear\) notice\(null\);/);
    expect(app).toMatch(/function notice\(msg: string \| null, fail = false\): void \{\s*noticeCard = null;/);
  });
});
