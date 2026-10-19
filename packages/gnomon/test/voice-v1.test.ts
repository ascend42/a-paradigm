/**
 * #gnomon-voice slice V1 (T-2026-10-19-026, talk-only): the forwarding guards (§14.7), attachment by human gesture,
 * voice.* shape validation, interrupt-only stop, the voice read projection. Falsifiers G-VOX-06 and the voice column
 * of G-ABI-02 (approve voice-off in every form: test/approval-broker.test.ts + socket-abi.test.ts). Pure: no keys, no paths.
 */
import { describe, expect, it } from 'vitest';
import { RefusedError } from '@a-company/gnomon-contracts';
import { VoiceControl, VOICE_ECHO_TAIL_MS_DEFAULT, VOICE_TURN_MAX_AGE_MS, turnIdAfter, type VoiceAppendRow } from '../src/kernel/voice/voice-control.js';
import { SubscriptionHub } from '../src/kernel/socket/log-read.js';
import { projectForReader } from '../src/kernel/log/redaction.js';

const HUMAN = 'p:abcdefgh/founder';
const VOICE = 'p:abcdefgh/voice';
const SPK = 'spk:abcdefgh/founder';
const HSID = 'hs:01JAAAAAAAAAAAAAAAAAAAAAAA';

function rig(o: { enrolled?: string[]; conns?: string[] } = {}) {
  const clock = { t: 10_000 }; // kernel clock (ms); client t0/t1 below share its scale
  let changes = 0;
  const rows: VoiceAppendRow[] = [];
  const sends: Array<{ owner: string; p: unknown }> = [];
  const stops: Array<{ owner: string; p: unknown }> = [];
  const owners = new Map<string, string>([[HSID, HUMAN], ['hs:other', 'p:abcdefgh/someone']]);
  const enrolled = new Set(o.enrolled ?? [SPK]);
  const v = new VoiceControl({
    sessions: {
      ownerOf: (h) => owners.get(h),
      send: async (owner, p) => (sends.push({ owner, p }), { turn: `turn:${HSID}/1` }),
      stop: async (owner, p) => (stops.push({ owner, p }), { signals: ['control_request:interrupt'], exited: false }),
    },
    append: async (row) => (rows.push(row), { seq: rows.length, hash: `h${rows.length}` }),
    enrolled: () => enrolled,
    voiceConnections: () => o.conns ?? ['conn:V'],
    now: () => clock.t,
    onAttachmentChange: () => void changes++,
  });
  const human = { connId: 'conn:H', principal: HUMAN, principalClass: 'human', credential: 'gui' };
  const vc = { connId: 'conn:V', principal: VOICE };
  const attach = (mode?: string) => v.humanAppend(human, 'voice.session.start', { hsid: HSID, ...(mode ? { mode } : {}) });
  let n = 0;
  const userTurn = (p: Record<string, unknown> = {}) =>
    v.voiceAppend(vc, { kind: 'voice.turn.user', payload: { turnId: String(++n), speakerId: SPK, speakerEnrolled: true, forwarded: true, t0: 10_000, t1: 11_000, text: 'run the tests', asrModel: 'parakeet', confidence: 0.97, mode: 'ptt', ...p } });
  const agentTurn = (t0: number, t1: number) =>
    v.voiceAppend(vc, { kind: 'voice.turn.agent', payload: { turnId: String(++n), hsid: HSID, textPlanned: 'ok', textSpoken: 'ok', interruptedAtMs: null, ttsVoice: 'kokoro', t0, t1, source: 'claude' } });
  const send = (text = 'run the tests', extra: Record<string, unknown> = {}) => v.send(vc, { hsid: HSID, content: [{ text }], ...extra });
  return { v, rows, sends, stops, human, vc, attach, userTurn, agentTurn, send, enrolled, clock, changes: () => changes };
}

async function refusal(p: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await p;
  } catch (e) {
    if (e instanceof RefusedError) return { code: e.refusal.code, gate: e.refusal.gate, ...(e.refusal.data as Record<string, unknown>) };
    throw e;
  }
  throw new Error('expected a refusal');
}

describe('#gnomon-voice V1 attachment (human gesture only)', () => {
  it('the human attaches its own live session; the row is written before the attachment exists', async () => {
    const r = rig();
    const out = (await r.attach()) as Record<string, unknown>;
    expect(out).toMatchObject({ hsid: HSID, mode: 'ptt' });
    expect(r.rows[0]).toMatchObject({ kind: 'voice.session.start', principal: HUMAN, session: HSID, payload: { hsid: HSID, mode: 'ptt' } });
    expect(r.v.attachedHsid()).toBe(HSID);
  });
  it('another human\'s session, a non-first-party connection, and the voice child itself cannot attach', async () => {
    const r = rig();
    expect(await refusal(r.v.humanAppend(r.human, 'voice.session.start', { hsid: 'hs:other' }))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusal(r.v.humanAppend({ ...r.human, credential: 'device-x' }, 'voice.session.start', { hsid: HSID }))).toMatchObject({ code: 'FORBIDDEN', reason: 'kernel-owned' });
    expect(await refusal(r.v.voiceAppend(r.vc, { kind: 'voice.session.start', payload: { hsid: HSID } }))).toMatchObject({ code: 'FORBIDDEN', reason: 'ungranted' });
    expect(r.v.attachedHsid()).toBeNull();
  });
  it('an unattached session is refused voice-target (send and stop)', async () => {
    const r = rig();
    await r.userTurn();
    expect(await refusal(r.send())).toMatchObject({ code: 'FORBIDDEN', gate: 'voice', reason: 'voice-target' });
    await r.attach();
    expect(await refusal(r.v.send(r.vc, { hsid: 'hs:other', content: [{ text: 'x' }] }))).toMatchObject({ reason: 'voice-target' });
    expect(await refusal(r.v.stop(r.vc, { hsid: 'hs:other', interrupt: true }))).toMatchObject({ reason: 'voice-target' });
  });
});

describe('#gnomon-voice V1 forwarding guards (§14.7)', () => {
  it('an enrolled PTT turn outside playback is forwarded to the attaching human\'s session, source forced to voice, no permit of its own', async () => {
    const r = rig();
    await r.attach();
    await r.userTurn();
    await r.send('run the tests', { source: 'typed-by-client' });
    // auto-edits (founder ruling): the send is exactly a typed send by the owner — no clamp, no extra mode param
    const vs = r.v.status() as { voiceSessionId: string };
    expect(r.sends).toEqual([{ owner: HUMAN, p: { hsid: HSID, text: 'run the tests', source: 'voice', voice: { voiceSessionId: vs.voiceSessionId, turnId: '1', turnSeq: 2 } } }]);
    // M1: the kernel stamps its receipt time; a client receivedAt is refused
    expect(r.rows[1]!.payload).toMatchObject({ receivedAt: 10_000 });
    expect(await refusal(r.userTurn({ receivedAt: 1 }))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(await refusal(r.send('run the tests', { permitId: 'pm:x' }))).toMatchObject({ code: 'BAD_REQUEST' });
  });
  it('G-VOX-06: an unenrolled turn is logged but refused voice-speaker', async () => {
    const r = rig();
    await r.attach();
    await r.userTurn({ speakerId: 'spk:unknown-2', speakerEnrolled: false });
    expect(r.rows.at(-1)).toMatchObject({ kind: 'voice.turn.user', session: HSID });
    expect(await refusal(r.send())).toMatchObject({ gate: 'voice', reason: 'voice-speaker' });
    // a claimed-enrolled speaker that was forgotten after the turn: refused too
    const r2 = rig();
    await r2.attach();
    await r2.userTurn();
    r2.enrolled.delete(SPK);
    expect(await refusal(r2.send())).toMatchObject({ reason: 'voice-speaker' });
    expect(r.sends.length + r2.sends.length).toBe(0);
  });
  it('V2a: a conversation ceiling is a widening (no presence path wired here ⇒ refused voice-off, nothing attached)', async () => {
    const r = rig();
    expect(await refusal(r.attach('conversation'))).toMatchObject({ gate: 'voice', reason: 'voice-off', mode: 'conversation', cause: 'presence' });
    expect(r.v.attachedHsid()).toBeNull();
  });
  it('M2 + V2a: the per-turn mode claim is required and may not exceed the attachment ceiling', async () => {
    const r = rig();
    await r.attach();
    expect(await refusal(r.userTurn({ mode: undefined }))).toMatchObject({ code: 'BAD_REQUEST' });
    await r.userTurn({ mode: 'conversation' });
    expect(await refusal(r.send())).toMatchObject({ reason: 'voice-off', mode: 'conversation', ceiling: 'ptt', cause: 'ceiling' });
  });
  it('M1: a turn older than the kernel max age is stale; a turn whose t0 precedes the attachment is stale', async () => {
    const r = rig();
    await r.attach();
    await r.userTurn();
    r.clock.t += VOICE_TURN_MAX_AGE_MS + 1;
    expect(await refusal(r.send())).toMatchObject({ reason: 'voice-stale-utterance', maxAgeMs: VOICE_TURN_MAX_AGE_MS });
    await r.userTurn({ t0: 100, t1: 200 }); // client says it began long before the attachment
    expect(await refusal(r.send())).toMatchObject({ reason: 'voice-stale-utterance' });
  });
  it('M1: the echo check also runs on kernel receipt times (a lying client t0 does not escape it)', async () => {
    const r = rig();
    await r.attach();
    r.clock.t = 20_000;
    await r.agentTurn(1_000, 3_000); // client times far in the past; kernel received it at 20 000 (2 s playback)
    r.clock.t = 20_500;
    await r.userTurn({ t0: 50_000, t1: 50_100 }); // client t0 outside every client window
    expect(await refusal(r.send())).toMatchObject({ reason: 'voice-echo', clock: 'kernel' });
  });
  it('M3: every attachment change is signalled, and the hub ends voice follow subscriptions only', () => {
    const log = { logId: 'log:x', releasedHead: () => 0, onCommit: () => () => undefined, onRelease: () => () => undefined, readPage: () => ({ head: 0, lastScanned: 0, caughtUp: true, withheld: 0 }) };
    const hub = new SubscriptionHub({ log } as never);
    const ctx = (connId: string) => ({ connId, afterReply: () => undefined, closed: false }) as never;
    const p = { since: 0, limit: 10, follow: true };
    hub.subscribe(ctx('conn:V'), { reader: { class: 'voice', hsid: HSID }, projection: 'voice' }, p);
    hub.subscribe(ctx('conn:H'), { reader: { class: 'human' }, projection: 'human' }, p);
    expect(hub.endReaderClass('voice')).toBe(1);
    expect(hub.count()).toBe(1);
  });
  it('M3/L4: attach, re-attach and detach each signal a change; a human cannot replace another human\'s attachment', async () => {
    const r = rig();
    await r.attach();
    await r.attach('ptt');
    await r.v.humanAppend(r.human, 'voice.session.end', {});
    expect(r.changes()).toBe(4); // start, end(old) + start(new), end
    await r.attach();
    expect(await refusal(r.v.humanAppend({ ...r.human, principal: 'p:abcdefgh/someone' }, 'voice.session.start', { hsid: 'hs:other' }))).toMatchObject({ reason: 'voice-target' });
  });
  it('a turn starting inside TTS playback + echoTailMs is refused voice-echo; just after the tail it passes', async () => {
    const r = rig();
    await r.attach();
    await r.agentTurn(9_000, 10_000 - VOICE_ECHO_TAIL_MS_DEFAULT); // tail ends exactly at t0 = 10 000
    await r.userTurn();
    expect(await refusal(r.send())).toMatchObject({ gate: 'voice', reason: 'voice-echo' });
    await r.userTurn({ t0: 10_001, t1: 10_500 });
    await expect(r.send()).resolves.toBeTruthy();
  });
  it('a stale, replayed, foreign or mismatched turn is refused voice-stale-utterance', async () => {
    const r = rig();
    await r.attach();
    expect(await refusal(r.send())).toMatchObject({ reason: 'voice-stale-utterance' }); // no turn at all
    await r.userTurn({ text: 'first' });
    await r.userTurn({ text: 'second' });
    expect(await refusal(r.send('first'))).toMatchObject({ reason: 'voice-stale-utterance' }); // not the latest
    expect(await refusal(r.send('something else'))).toMatchObject({ reason: 'voice-stale-utterance' }); // foreign text
    await r.send('second');
    expect(await refusal(r.send('second'))).toMatchObject({ reason: 'voice-stale-utterance' }); // replay
    // a turn logged before the attachment does not carry over
    const r2 = rig();
    await r2.userTurn();
    await r2.attach();
    expect(await refusal(r2.send())).toMatchObject({ reason: 'voice-stale-utterance' });
  });
  it('an intercepted decision utterance never reaches a model (voice-grammar); a second voice connection is voice-conn', async () => {
    const r = rig();
    await r.attach();
    await r.userTurn({ intercepted: 'decision', forwarded: false, text: 'claude admin approve ⟨handle⟩' });
    expect(await refusal(r.send('claude admin approve ⟨handle⟩'))).toMatchObject({ reason: 'voice-grammar' });
    const r2 = rig({ conns: ['conn:V', 'conn:V2'] });
    await r2.attach();
    await r2.userTurn();
    expect(await refusal(r2.send())).toMatchObject({ reason: 'voice-conn' });
  });
  it('session.stop is interrupt only', async () => {
    const r = rig();
    await r.attach();
    expect(await refusal(r.v.stop(r.vc, { hsid: HSID }))).toMatchObject({ code: 'BAD_REQUEST', reason: 'bad-params' });
    await r.v.stop(r.vc, { hsid: HSID, interrupt: true });
    expect(r.stops).toEqual([{ owner: HUMAN, p: { hsid: HSID, interrupt: true } }]);
  });
});

describe('#gnomon-voice V1 voice.* shape (§4.10, §14.4)', () => {
  it('speakerId known or unknown-N, monotone turn ids, text ≤ 16 KiB, t0 ≤ t1; enrol/forget/share are not the voice child\'s', async () => {
    const r = rig();
    await r.attach();
    expect(await refusal(r.userTurn({ speakerId: 'spk:abcdefgh/stranger' }))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(await refusal(r.userTurn({ speakerId: 'spk:unknown-3', speakerEnrolled: true }))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(await refusal(r.userTurn({ text: 'x'.repeat(16 * 1024 + 1) }))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(await refusal(r.userTurn({ t0: 5, t1: 4 }))).toMatchObject({ code: 'BAD_REQUEST' });
    await r.userTurn({ turnId: '50' });
    expect(await refusal(r.userTurn({ turnId: '49' }))).toMatchObject({ code: 'BAD_REQUEST' });
    for (const kind of ['voice.enrol', 'voice.forget', 'voice.share']) expect(await refusal(r.v.voiceAppend(r.vc, { kind, payload: {} }))).toMatchObject({ code: 'FORBIDDEN', reason: 'ungranted' });
    expect(await refusal(r.v.voiceAppend(r.vc, { kind: 'voice.focus', payload: { cardId: 'c' }, sensitivity: 'public' }))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(turnIdAfter('10', '9')).toBe(true);
    expect(turnIdAfter('01JB', '01JA')).toBe(true);
  });
});

describe('#gnomon-voice V1 read projection (own session + voice.*, redacted)', () => {
  const ev = (kind: string, session: string | undefined, sensitivity = 'normal') =>
    ({ seq: 1, kind, session, sensitivity, payload: { text: 'x' }, principal: VOICE, id: 'ev:1', ts: '2026-10-19T00:00:00Z', hash: 'h' }) as never;
  it('sees only the attached session rows (its voice.* included); never another session, never a secret row; sensitive voice turns are stubs', () => {
    const reader = { class: 'voice' as const, hsid: HSID };
    expect(projectForReader(ev('session.open', HSID), reader)?.view).toBe('full');
    expect(projectForReader(ev('session.open', 'hs:other'), reader)).toBeUndefined();
    expect(projectForReader(ev('voice.focus', HSID), reader)?.view).toBe('full');
    expect(projectForReader(ev('voice.focus', 'hs:other'), reader)).toBeUndefined(); // L3: another session's voice rows
    expect(projectForReader(ev('voice.focus', undefined), reader)).toBeUndefined();
    expect(projectForReader(ev('voice.focus', HSID), { class: 'voice', hsid: null })).toBeUndefined();
    expect(projectForReader(ev('voice.turn.user', HSID), reader)?.view).toBe('stub');
    expect(projectForReader(ev('voice.enrol', HSID), reader)).toBeUndefined();
  });
});
