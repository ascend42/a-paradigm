/**
 * #gnomon-voice slice V2a (TD-2026-10-19-298, T-2026-10-19-026): the attachment mode is a CEILING; widening to
 * conversation takes one fresh presence per GUI login; ambient guards (aec, enrolled speaker, kernel-side busy);
 * idle auto-off; privacy of refused / unknown-speaker turns; status.voice for the live-mic indicator.
 * Pure: no keys, no paths, no daemon home.
 */
import { describe, expect, it } from 'vitest';
import { CLIENT_API_ID, RefusedError } from '@a-company/gnomon-contracts';
import { VoiceControl, VOICE_AMBIENT_IDLE_MS_DEFAULT, VOICE_AMBIENT_IDLE_MAX_MS, ambientIdleMsOf, type VoiceAppendRow, type VoicePresenceRequest } from '../src/kernel/voice/voice-control.js';
import { checkStatusNumbers } from '../src/kernel/socket/status-numbers.js';
import { ABI_ID } from '../src/kernel/socket/dispatch.js';

const HUMAN = 'p:abcdefgh/founder';
const VOICE = 'p:abcdefgh/voice';
const KERNEL = 'p:abcdefgh/kernel';
const SPK = 'spk:abcdefgh/founder';
const HSID = 'hs:01JAAAAAAAAAAAAAAAAAAAAAAA';

function rig(o: { ambientIdleMs?: number } = {}) {
  const clock = { t: 10_000 };
  let changes = 0;
  const rows: VoiceAppendRow[] = [];
  const sends: Array<{ owner: string; p: unknown }> = [];
  const cards: VoicePresenceRequest[] = [];
  const busy = { streaming: false, endedAt: null as number | null };
  const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
  const cardState = new Map<string, string>();
  const fail = { append: false };
  const v = new VoiceControl({
    sessions: {
      ownerOf: (h) => (h === HSID ? HUMAN : undefined),
      send: async (owner, p) => (sends.push({ owner, p }), { turn: `turn:${HSID}/1` }),
      stop: async () => ({}),
      busy: () => ({ ...busy }),
    },
    append: async (row) => {
      if (fail.append) throw new Error('log write failed');
      rows.push(row);
      return { seq: rows.length, hash: `h${rows.length}` };
    },
    presenceState: (id) => cardState.get(id) ?? 'pending',
    enrolled: () => new Set([SPK]),
    voiceConnections: () => ['conn:V'],
    now: () => clock.t,
    onAttachmentChange: () => void changes++,
    presence: async (req) => (cards.push(req), { cardId: `card:${cards.length}` }),
    kernelPrincipal: KERNEL,
    setTimer: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return { clear: () => void (t.cleared = true) };
    },
    ...(o.ambientIdleMs !== undefined ? { ambientIdleMs: o.ambientIdleMs } : {}),
  });
  const human = { connId: 'conn:H', principal: HUMAN, principalClass: 'human', credential: 'gui' };
  const vc = { connId: 'conn:V', principal: VOICE };
  const start = (mode?: string, extra: Record<string, unknown> = {}, who = human) => v.humanAppend(who, 'voice.session.start', { hsid: HSID, ...(mode ? { mode } : {}), ...extra });
  /** widen with the fake Touch ID allow */
  const widen = async (who = human) => {
    const out = (await start('conversation', {}, who)) as Record<string, unknown>;
    if (out.pending) await cards.at(-1)!.onAllow();
    return out;
  };
  let n = 0;
  const userTurn = (p: Record<string, unknown> = {}) =>
    v.voiceAppend(vc, { kind: 'voice.turn.user', payload: { turnId: String(++n), speakerId: SPK, speakerEnrolled: true, forwarded: true, t0: clock.t - 1000, t1: clock.t, text: 'run the tests', mode: 'conversation', aec: 'vpio', ...p } });
  const send = (text = 'run the tests') => v.send(vc, { hsid: HSID, content: [{ text }] });
  return { v, rows, sends, cards, busy, timers, clock, cardState, fail, human, vc, start, widen, userTurn, send, changes: () => changes };
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

describe('#gnomon-voice V2a ceiling', () => {
  it('a ptt turn is forwarded under a conversation ceiling; a conversation turn above a ptt ceiling is refused voice-off{mode, ceiling}', async () => {
    const r = rig();
    await r.widen();
    r.clock.t += 2000;
    await r.userTurn({ mode: 'ptt' });
    await r.send();
    expect(r.sends).toHaveLength(1);
    await r.start('ptt'); // narrowing: no presence
    r.clock.t += 2000;
    await r.userTurn();
    expect(await refusal(r.send())).toMatchObject({ gate: 'voice', reason: 'voice-off', mode: 'conversation', ceiling: 'ptt' });
    expect(r.cards).toHaveLength(1);
  });
  it('a ptt forward is exactly the owner\'s send, no clamp and no extra field', async () => {
    const r = rig();
    await r.widen();
    r.clock.t += 2000;
    await r.userTurn({ mode: 'ptt' });
    await r.send();
    const vs = r.v.status().voiceSessionId as string;
    expect(r.sends).toEqual([{ owner: HUMAN, p: { hsid: HSID, text: 'run the tests', source: 'voice', voice: { voiceSessionId: vs, turnId: '1', turnSeq: 2 } } }]);
    // a forwarded turn keeps its full text (the kind default sensitivity applies in the log)
    expect(r.rows.at(-1)!.payload).toMatchObject({ text: 'run the tests' });
  });
  it('TD-2026-10-20-125: an ambient turn NEVER sends itself; it stays forwardable for the composer and only the human\'s send carries it', async () => {
    const r = rig();
    await r.widen();
    r.clock.t += 2000;
    const out = (await r.userTurn()) as Record<string, unknown>; // mode: conversation (ambient), enrolled, aec, not busy
    expect(out).toMatchObject({ forwardable: true });
    expect(await refusal(r.send())).toMatchObject({ code: 'FORBIDDEN', gate: 'voice', reason: 'voice-off', cause: 'composer', mode: 'conversation', ceiling: 'conversation' });
    expect(r.sends).toHaveLength(0);
    // the composer path: the human's own send (a key press in the GUI) is attributed to the turn
    expect(r.v.attributeHumanSend(HUMAN, HSID, ['run the tests'])).toMatchObject({ source: 'voice', turnSeqs: [2] });
    // a refused direct send never claimed the turn, and a claimed one cannot be sent again directly
    expect(await refusal(r.send())).toMatchObject({ reason: 'voice-stale-utterance' });
  });
});

describe('#gnomon-voice V2a widening (presence once per GUI login)', () => {
  it('widening raises one presence card; nothing attaches until allow; a second widening on the same login needs none', async () => {
    const r = rig();
    await r.start('ptt');
    const first = (await r.start('conversation')) as Record<string, unknown>;
    expect(first).toMatchObject({ pending: true, cardId: 'card:1' });
    expect(r.v.status()).toMatchObject({ ceiling: 'ptt' });
    // asking again while the card waits returns the same card, never a second one
    expect(await r.start('conversation')).toMatchObject({ cardId: 'card:1' });
    expect(r.cards).toHaveLength(1);
    expect(r.cards[0]).toMatchObject({ hsid: HSID, from: 'ptt', to: 'conversation' });
    await r.cards[0]!.onAllow();
    expect(r.v.status()).toMatchObject({ attached: true, ceiling: 'conversation' });
    await r.start('ptt');
    const again = (await r.start('conversation')) as Record<string, unknown>;
    expect(again.pending).toBeUndefined();
    expect(r.v.status()).toMatchObject({ ceiling: 'conversation' });
    expect(r.cards).toHaveLength(1);
  });
  it('a new login (another connection, or the same one after close) needs presence again', async () => {
    const r = rig();
    await r.widen();
    r.v.connectionClosed('conn:H');
    expect(await r.start('conversation')).toMatchObject({ pending: true });
    expect(await r.start('conversation', {}, { ...r.human, connId: 'conn:H2' })).toMatchObject({ pending: true });
    expect(r.cards).toHaveLength(3);
  });
  it('re-issuing start ends the old attachment; continues must name the human\'s own; old-attachment turns are stale', async () => {
    const r = rig();
    const a1 = (await r.start('ptt')) as { voiceSessionId: string };
    r.clock.t += 2000;
    await r.userTurn({ mode: 'ptt' });
    const a2 = (await r.start('ptt', { continues: a1.voiceSessionId })) as { voiceSessionId: string };
    expect(r.rows.map((x) => x.kind)).toEqual(['voice.session.start', 'voice.turn.user', 'voice.session.end', 'voice.session.start']);
    expect(r.rows[3]!.payload).toMatchObject({ continues: a1.voiceSessionId, voiceSessionId: a2.voiceSessionId });
    expect(await refusal(r.send())).toMatchObject({ reason: 'voice-stale-utterance' });
    expect(await refusal(r.start('ptt', { continues: 'vs:01JNOTMINEAAAAAAAAAAAAAAAA' }))).toMatchObject({ reason: 'voice-target' });
  });
  it('the voice principal can never set or change the mode', async () => {
    const r = rig();
    await r.start('ptt');
    expect(await refusal(r.v.voiceAppend(r.vc, { kind: 'voice.session.start', payload: { hsid: HSID, mode: 'conversation' } }))).toMatchObject({ code: 'FORBIDDEN', reason: 'ungranted' });
    expect(await refusal(r.v.humanAppend({ connId: 'conn:V', principal: VOICE, principalClass: 'voice', credential: 'device' }, 'voice.session.start', { hsid: HSID, mode: 'conversation' }))).toMatchObject({ code: 'FORBIDDEN', reason: 'kernel-owned' });
    const vs = r.v.status().voiceSessionId;
    expect(await refusal(r.v.voiceAppend(r.vc, { kind: 'voice.session.end', payload: { voiceSessionId: vs, mode: 'conversation' } }))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(r.v.status()).toMatchObject({ ceiling: 'ptt' });
    expect(r.cards).toHaveLength(0);
  });
});

describe('#gnomon-voice V2a ambient guards', () => {
  it('a conversation turn without an aec claim is refused voice-off{cause: aec}', async () => {
    const r = rig();
    await r.widen();
    r.clock.t += 2000;
    await r.userTurn({ aec: undefined });
    expect(await refusal(r.send())).toMatchObject({ reason: 'voice-off', cause: 'aec' });
    expect(await refusal(r.userTurn({ aec: 'speakers' }))).toMatchObject({ code: 'BAD_REQUEST' });
  });
  it('busy by the kernel clock: refused while the model streams and through the tail, even with no playback logged', async () => {
    const r = rig();
    await r.widen();
    r.clock.t += 2000;
    r.busy.streaming = true;
    await r.userTurn();
    expect(await refusal(r.send())).toMatchObject({ gate: 'voice', reason: 'voice-playback', clock: 'kernel' });
    // the turn closes; a turn that began inside the tail is still refused, one after it passes
    r.busy.streaming = false;
    r.busy.endedAt = r.clock.t;
    r.clock.t += 1200; // the next turn spans [t-1000, t]: it began 200 after the end, inside the 750 tail
    await r.userTurn();
    expect(await refusal(r.send())).toMatchObject({ reason: 'voice-playback', clock: 'kernel' });
    r.clock.t += 2000;
    await r.userTurn({ mode: 'ptt' }); // the busy guard binds every turn under a conversation ceiling; only ptt may send itself
    await r.send();
    expect(r.sends).toHaveLength(1);
    expect(r.rows.filter((x) => x.kind === 'voice.turn.agent')).toHaveLength(0);
  });
  it('voice drops fix: the reply ended at message_stop (its result still ~30 s away) ⇒ speech after the tail is accepted; TTS still playing refuses it', async () => {
    const r = rig();
    await r.widen();
    r.clock.t += 2000;
    // the supervisor saw the main-chain message_stop: not streaming, ended now (the result has not come)
    r.busy.streaming = false;
    r.busy.endedAt = r.clock.t;
    r.clock.t += 1000 + 750 + 1; // a 1 s turn that began just after the tail
    const ok = (await r.userTurn({ text: 'and the docs too' })) as Record<string, unknown>;
    expect(ok).toMatchObject({ forwardable: true });
    expect(ok).not.toHaveProperty('refused');
    expect(r.rows.at(-1)!.payload).not.toHaveProperty('refusedReason');
    // the client is still speaking the reply (a voice.turn.agent playback window): the echo guard refuses at receipt
    r.clock.t += 5000;
    await r.v.voiceAppend(r.vc, { kind: 'voice.turn.agent', payload: { turnId: 'a1', t0: r.clock.t - 3000, t1: r.clock.t, textPlanned: 'Done.', textSpoken: 'Done.' } });
    r.clock.t += 300;
    const echo = (await r.userTurn({ t0: r.clock.t - 200, t1: r.clock.t })) as Record<string, unknown>;
    expect(echo).toMatchObject({ forwardable: false, refused: 'voice-echo' });
  });
});

describe('#gnomon-voice V2a privacy', () => {
  it('an unknown speaker\'s turn is stored without text (hash + duration) and is never forwardable', async () => {
    const r = rig();
    await r.widen();
    r.clock.t += 2000;
    // a push-to-talk claim: the speaker gate holds (the Dictate draft exception, an AMBIENT turn under a key send
    // ceiling, keeps the text for the draft: voice-dictate-unverified.test.ts)
    const out = (await r.userTurn({ speakerId: 'spk:unknown-1', speakerEnrolled: false, text: 'my bank pin is zebra-quokka', note: 'smuggled', mode: 'ptt' })) as Record<string, unknown>;
    expect(out).toMatchObject({ forwardable: false, refused: 'voice-speaker' });
    const p = r.rows.at(-1)!.payload;
    // a secret with non-hex letters: the row's random-keyed hmac hex can never contain it by chance (it did: '…91234669')
    expect(JSON.stringify(p)).not.toContain('zebra-quokka');
    expect(p).not.toHaveProperty('text');
    expect(p).not.toHaveProperty('note');
    expect(p).toMatchObject({ textHash: expect.stringMatching(/^hmac-sha256:[0-9a-f]{64}$/), durationMs: 1000, refusedReason: 'voice-speaker', forwarded: false });
    expect(await refusal(r.send('my bank pin is zebra-quokka'))).toMatchObject({ reason: 'voice-speaker' });
  });
  it('a turn refused at receipt stores a hash plus the reason; it stays unforwardable after the cause clears', async () => {
    const r = rig();
    await r.widen();
    r.clock.t += 2000;
    r.busy.streaming = true;
    await r.userTurn({ text: 'delete the branch' });
    expect(r.rows.at(-1)!.payload).toMatchObject({ refusedReason: 'voice-playback' });
    expect(r.rows.at(-1)!.payload).not.toHaveProperty('text');
    r.busy.streaming = false;
    expect(await refusal(r.send('delete the branch'))).toMatchObject({ reason: 'voice-playback' });
    expect(r.sends).toHaveLength(0);
  });
});

describe('#gnomon-voice V2a idle auto-off and status', () => {
  it('a conversation ceiling with no forwarded turn for ambientIdleMs is ended by the kernel (reason idle)', async () => {
    const r = rig();
    await r.widen();
    expect(r.timers.at(-1)!.ms).toBe(VOICE_AMBIENT_IDLE_MS_DEFAULT + 1);
    r.clock.t += 60_000;
    expect(await r.v.checkIdle()).toBe(false);
    r.clock.t += VOICE_AMBIENT_IDLE_MS_DEFAULT;
    const before = r.changes();
    expect(await r.v.checkIdle()).toBe(true);
    expect(r.rows.at(-1)).toMatchObject({ kind: 'voice.session.end', principal: KERNEL, payload: { reason: 'idle' } });
    expect(r.rows.at(-1)!.connId).toBeUndefined();
    expect(r.changes()).toBe(before + 1);
    expect(r.v.status()).toMatchObject({ attached: false, hsid: null, ceiling: null, idleAt: null });
  });
  it('a forwarded turn resets the idle clock; ptt never idles out; the configured value is clamped, never unbounded', async () => {
    const r = rig({ ambientIdleMs: 60_000 });
    await r.widen();
    r.clock.t += 50_000;
    await r.userTurn({ mode: 'ptt' });
    await r.send();
    r.clock.t += 20_000;
    expect(await r.v.checkIdle()).toBe(false);
    await r.start('ptt');
    r.clock.t += 10 * VOICE_AMBIENT_IDLE_MAX_MS;
    expect(await r.v.checkIdle()).toBe(false);
    expect(ambientIdleMsOf(Infinity)).toBe(VOICE_AMBIENT_IDLE_MS_DEFAULT);
    expect(ambientIdleMsOf(1e12)).toBe(VOICE_AMBIENT_IDLE_MAX_MS);
    expect(ambientIdleMsOf(0)).toBe(VOICE_AMBIENT_IDLE_MS_DEFAULT);
  });
  it('status.voice is {attached, hsid, ceiling, since, idleAt} with no undeclared number (G-HON-03)', async () => {
    const r = rig();
    await r.widen();
    const s = r.v.status();
    expect(s).toMatchObject({ attached: true, hsid: HSID, ceiling: 'conversation', since: new Date(10_000).toISOString(), idleAt: new Date(10_000 + VOICE_AMBIENT_IDLE_MS_DEFAULT).toISOString() });
    expect(checkStatusNumbers({ voice: s })).toEqual([]);
    expect(checkStatusNumbers({ voice: rig().v.status() })).toEqual([]);
  });
  it('the voice goldens stay put', () => {
    expect(ABI_ID).toBe('sha256:f54aa03625d414234bce961059fb6584a9acc31ea8b97b3dc28b9afa0db26a35');
    // moved once by TD-2026-10-19-063 (gui.resume, merged before V2e; m1-1-reservations.test.ts records it), never by voice
    expect(CLIENT_API_ID).toBe('sha256:58e120257782b0da3327aecc4489571fb651ac5cb91e4003da51bd28e96de405');
  });
});

describe('#gnomon-voice V2a Aegis fixes', () => {
  it('M1: under a conversation ceiling a ptt claim does not skip the aec and busy guards; under a ptt ceiling it is unchanged', async () => {
    const r = rig();
    await r.widen();
    r.clock.t += 2000;
    await r.userTurn({ mode: 'ptt', aec: undefined });
    expect(await refusal(r.send())).toMatchObject({ reason: 'voice-off', cause: 'aec', mode: 'ptt', ceiling: 'conversation' });
    r.clock.t += 2000;
    r.busy.streaming = true;
    await r.userTurn({ mode: 'ptt' });
    expect(await refusal(r.send())).toMatchObject({ reason: 'voice-playback', clock: 'kernel' });
    await r.start('ptt');
    r.clock.t += 2000;
    await r.userTurn({ mode: 'ptt', aec: undefined });
    await r.send();
    expect(r.sends).toHaveLength(1);
  });
  it('M2: past idleAt send is refused voice-off{cause: idle} even before the end row lands', async () => {
    const r = rig({ ambientIdleMs: 60_000 });
    await r.widen();
    r.clock.t += 59_500;
    await r.userTurn();
    r.clock.t += 1000;
    expect(await refusal(r.send())).toMatchObject({ reason: 'voice-off', cause: 'idle' });
    expect(r.sends).toHaveLength(0);
  });
  it('M2: a failed idle end is counted and the timer re-armed, never swallowed; the retry ends it', async () => {
    const r = rig({ ambientIdleMs: 60_000 });
    await r.widen();
    r.clock.t += 61_000;
    r.fail.append = true;
    const armed = r.timers.length;
    expect(await r.v.checkIdle()).toBe(false);
    expect(r.timers.length).toBe(armed + 1);
    expect(r.v.status()).toMatchObject({ attached: true, idleEndFailures: { n: 1 } });
    r.fail.append = false;
    r.timers.at(-1)!.fn();
    await new Promise((res) => setImmediate(res));
    expect(r.v.status()).toMatchObject({ attached: false });
    expect(checkStatusNumbers({ voice: r.v.status() })).toEqual([]);
  });
  it('L1: a denied or expired widening card is dropped and a new one raised; the answer names the card\'s session', async () => {
    const r = rig();
    expect(await r.start('conversation')).toMatchObject({ cardId: 'card:1', hsid: HSID });
    r.cardState.set('card:1', 'denied');
    expect(await r.start('conversation')).toMatchObject({ pending: true, cardId: 'card:2', hsid: HSID });
    expect(r.cards).toHaveLength(2);
  });
  it('L3: asrModel and confidence are bounded on every row', async () => {
    const r = rig();
    await r.widen();
    expect(await refusal(r.userTurn({ asrModel: 'x'.repeat(65) }))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(await refusal(r.userTurn({ asrModel: 'bad model!' }))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(await refusal(r.userTurn({ confidence: 1.5 }))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(await refusal(r.userTurn({ confidence: '0.9' }))).toMatchObject({ code: 'BAD_REQUEST' });
    await r.userTurn({ speakerId: 'spk:unknown-1', speakerEnrolled: false, asrModel: 'parakeet-0.6b', confidence: 0.5 });
    expect(r.rows.at(-1)!.payload).toMatchObject({ asrModel: 'parakeet-0.6b', confidence: 0.5 });
  });
});
