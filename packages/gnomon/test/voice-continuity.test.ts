/**
 * Speaker continuity (founder ruling 2026-10-23: natural, fast speech is never cut; contracts VOICE_CONTINUITY_*).
 * A clip too short to verify alone may inherit the speaker of the stretch it belongs to (speakerBasis 'continuity'),
 * re-checked by the kernel at receipt: the turn right before it is an accepted turn of the same enrolled speaker on the
 * same connection, the silence between is at most VOICE_CONTINUITY_GAP_MS, the clip ends within
 * VOICE_CONTINUITY_STRETCH_MS of the last turn verified alone, no agent speech lies between, and it is not intercepted.
 * Anything else makes it an unverified turn (draft only under a conversation ceiling). Pure (no daemon).
 */
import { describe, expect, it } from 'vitest';
import { RefusedError, VOICE_CONTINUITY_CLIP_MS, VOICE_CONTINUITY_GAP_MS, VOICE_CONTINUITY_MAX_TURNS, VOICE_CONTINUITY_STRETCH_MS, VOICE_LIABILITY_ACK_HASH, VOICE_MIN_VERIFY_SPEECH_MS } from '@a-company/gnomon-contracts';
import { VoiceControl, type VoiceAppendRow, type VoicePresenceRequest } from '../src/kernel/voice/voice-control.js';
import { createSessionPort } from '../src/kernel/supervisor/port.js';

const HUMAN = 'p:abcdefgh/founder';
const VOICE = 'p:abcdefgh/voice';
const SPK = 'spk:abcdefgh/founder';
const HSID = 'hs:01JAAAAAAAAAAAAAAAAAAAAAAA';
/** the founder's evidence rows (kernel.db 2026-10-21T19:56:28Z / 19:57:13Z): unenrolled, lt0.5, 1140 and 1060 ms */
const UNVERIFIED = { speakerId: 'spk:unknown-1', speakerEnrolled: false, speakerScore: 'lt0.5', gatedSpeechMs: 1140 };

let busy: { streaming: boolean; endedAt: number | null } = { streaming: false, endedAt: null };
function rig() {
  busy = { streaming: false, endedAt: null };
  const clock = { t: 100_000 };
  const owner = { of: HUMAN };
  const rows: VoiceAppendRow[] = [];
  const presence: VoicePresenceRequest[] = [];
  const direct: unknown[] = [];
  const v = new VoiceControl({
    sessions: { ownerOf: (h) => (h === HSID ? owner.of : undefined), send: async (_o, p) => (direct.push(p), {}), stop: async () => ({}), busy: () => busy },
    append: async (row) => (rows.push(row), { seq: rows.length, hash: `h${rows.length}` }),
    enrolled: () => new Set([SPK]),
    voiceConnections: () => ['conn:V'],
    now: () => clock.t,
    presence: async (req) => {
      presence.push(req);
      await req.onAllow();
      return { cardId: `card:01HZZZZZZZZZZZZZZZZZZZZZ${presence.length}0` };
    },
    strictnessLevel: () => null,
    sendNowPress: () => null,
  });
  v.setSendWord({ text: 'over and out', variants: [] });
  const supSends: Array<Record<string, unknown>> = [];
  const sup = { resumed: () => false, send: async (_p: string, p: Record<string, unknown>) => (supSends.push(p), { turn: `t${supSends.length}` }) };
  const port = createSessionPort(sup as never, undefined, v);
  const human = { connId: 'conn:H1', principal: HUMAN, principalClass: 'human', credential: 'gui' };
  const vc = { connId: 'conn:V', principal: VOICE };
  /** Dictate = conversation × key; Send word = conversation × word; Pieces = conversation × pieces; Talk = ptt */
  const attach = async (rung: 'talk' | 'dictate' | 'word' | 'pieces') => {
    const r =
      rung === 'talk'
        ? await v.humanAppend(human, 'voice.session.start', { hsid: HSID })
        : await v.humanAppend(human, 'voice.session.start', { hsid: HSID, mode: 'conversation', ...(rung === 'dictate' ? {} : { send: rung, liabilityAck: VOICE_LIABILITY_ACK_HASH }) });
    clock.t += 5000; // turns start after the attachment
    return r;
  };
  let n = 0;
  const turn = async (text: string, p: Record<string, unknown> = {}) => {
    const r = (await v.voiceAppend(vc, { kind: 'voice.turn.user', payload: { turnId: String(++n), speakerId: SPK, speakerEnrolled: true, forwarded: false, t0: clock.t - 1200, t1: clock.t, text, mode: 'conversation', aec: 'vpio', ...p } })) as Record<string, unknown>;
    clock.t += 100;
    return r;
  };
  const enter = (parts: string[], hint = true) => port.send({ principal: HUMAN, principalClass: 'human', connId: 'conn:H1', credential: 'gui' }, { hsid: HSID, content: parts.map((text) => ({ text })), ...(hint ? { source: 'voice' } : {}) });
  /** status.voice.unverified as the human class sees it: seq → words */
  const words = () => new Map(v.unverifiedFor(HUMAN).map((u) => [u.seq, u.text]));
  return { v, rows, direct, supSends, attach, turn, enter, words, vc, human, clock, owner };
}

const refusal = async (p: Promise<unknown> | (() => unknown)): Promise<Record<string, unknown>> => {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (e) {
    if (e instanceof RefusedError) return { code: e.refusal.code, gate: e.refusal.gate, ...(e.refusal.data as Record<string, unknown>) };
    throw e;
  }
  throw new Error('expected a refusal');
};



/** a short clip claiming continuity, spoken right after the last turn (the evidence rows of 2026-10-23: 400 to 1320 ms gated) */
const SHORT = (r: ReturnType<typeof rig>, ms = 600) => {
  r.clock.t += ms;
  return { speakerBasis: 'continuity', speakerScore: 'lt0.5', gatedSpeechMs: 440, t0: r.clock.t - ms, t1: r.clock.t };
};
/** a turn verified on its own (long enough, over the threshold) */
const LONG = { speakerScore: 'ge0.8', gatedSpeechMs: 2320 };
let agentN = 0;
const agent = (r: ReturnType<typeof rig>) =>
  r.v.voiceAppend(r.vc, { kind: 'voice.turn.agent', payload: { turnId: `a${++agentN}`, t0: r.clock.t - 800, t1: r.clock.t - 100, textPlanned: 'ok', textSpoken: 'ok' } });
let bargeN = 0;
const bargein = (r: ReturnType<typeof rig>) => r.v.voiceAppend(r.vc, { kind: 'voice.bargein', payload: { turnId: `b${++bargeN}`, atMs: r.clock.t, heardText: 'x' } });
const inherited = (got: Record<string, unknown>) => {
  expect(got).toMatchObject({ forwardable: true });
  expect(got).not.toHaveProperty('draftOnly');
};

describe('speaker continuity: a short clip inherits the stretch it belongs to, bounded (Aegis H-1)', () => {
  it('right after a verified turn: accepted as the same speaker, the row says continuity; no anchor ⇒ unverified draft', async () => {
    const r = rig();
    await r.attach('dictate');
    expect(await r.turn('hmm', SHORT(r))).toMatchObject({ forwardable: true, draftOnly: true });
    const r2 = rig();
    await r2.attach('dictate');
    await r2.turn("I don't get why this is", LONG);
    inherited(await r2.turn('yes', SHORT(r2)));
    expect(r2.rows.at(-1)!.payload).toMatchObject({ speakerBasis: 'continuity', speakerEnrolled: true, text: 'yes' });
  });

  it(`at most ${VOICE_CONTINUITY_MAX_TURNS} inherited turns or 3 s of inherited speech per anchor; a clip over ${VOICE_CONTINUITY_CLIP_MS} ms never inherits`, async () => {
    const r = rig();
    await r.attach('dictate');
    await r.turn('a long verified sentence', LONG);
    inherited(await r.turn('one', SHORT(r)));
    inherited(await r.turn('two', SHORT(r)));
    expect(await r.turn('three', SHORT(r))).toMatchObject({ draftOnly: true });
    const r2 = rig();
    await r2.attach('dictate');
    await r2.turn('a long verified sentence', LONG);
    inherited(await r2.turn('one', SHORT(r2, 2000)));
    expect(await r2.turn('two', SHORT(r2, 1100))).toMatchObject({ draftOnly: true }); // 3.1 s inherited
    const r3 = rig();
    await r3.attach('dictate');
    await r3.turn('a long verified sentence', LONG);
    expect(await r3.turn('a slow short clip', SHORT(r3, VOICE_CONTINUITY_CLIP_MS + 10))).toMatchObject({ draftOnly: true });
    // a fresh verification re-anchors
    await r.enter(['flush the unverified draft']);
    await r.turn('another long verified sentence', LONG);
    inherited(await r.turn('ok', SHORT(r)));
  });

  it(`a silence longer than ${VOICE_CONTINUITY_GAP_MS} ms (client or kernel clock), an overlap, or an anchor older than ${VOICE_CONTINUITY_STRETCH_MS / 1000} s breaks it`, async () => {
    const r = rig();
    await r.attach('dictate');
    await r.turn('a long verified sentence', LONG);
    r.clock.t += VOICE_CONTINUITY_GAP_MS + 100;
    expect(await r.turn('yes', SHORT(r))).toMatchObject({ draftOnly: true });
    // the client claims no gap, but the kernel received it long after the anchor (Aegis M-2)
    const r2 = rig();
    await r2.attach('dictate');
    await r2.turn('a long verified sentence', LONG);
    const t1 = r2.clock.t;
    r2.clock.t += 20_000;
    expect(await r2.turn('yes', { ...SHORT(r2), t0: t1 + 100, t1: t1 + 700 })).toMatchObject({ draftOnly: true });
    // a clip that starts before the previous turn ended
    const r3 = rig();
    await r3.attach('dictate');
    await r3.turn('a long verified sentence', LONG);
    expect(await r3.turn('yes', { ...SHORT(r3), t0: r3.clock.t - 3000 })).toMatchObject({ draftOnly: true });
  });

  it('another voice, agent speech, a barge-in or the model streaming between breaks it', async () => {
    const r = rig();
    await r.attach('dictate');
    await r.turn('a long verified sentence', LONG);
    await r.turn('someone else talking', { speakerId: 'spk:unknown-1', speakerEnrolled: false, gatedSpeechMs: 2000 });
    expect(await r.turn('send it', SHORT(r))).toMatchObject({ draftOnly: true });
    const r2 = rig();
    await r2.attach('dictate');
    await r2.turn('a long verified sentence', LONG);
    r2.clock.t += 1000;
    await agent(r2);
    r2.clock.t += 1500; // past the echo tail on both clocks, still inside the gap
    expect(await r2.turn('yes', SHORT(r2))).toMatchObject({ draftOnly: true });
    const r3 = rig();
    await r3.attach('dictate');
    await r3.turn('a long verified sentence', LONG);
    await bargein(r3);
    expect(await r3.turn('yes', SHORT(r3))).toMatchObject({ draftOnly: true });
    const r4 = rig();
    await r4.attach('dictate');
    await r4.turn('a long verified sentence', LONG);
    busy = { streaming: false, endedAt: r4.clock.t + 1 }; // a reply streamed after the anchor
    r4.clock.t += 1500; // past the kernel's busy tail
    expect(await r4.turn('yes', SHORT(r4))).toMatchObject({ draftOnly: true });
    // the same timing with none of these continues the stretch
    const r5 = rig();
    await r5.attach('dictate');
    await r5.turn('a long verified sentence', LONG);
    r5.clock.t += 1500;
    inherited(await r5.turn('yes', SHORT(r5)));
  });

  it('a long clip, an intercepted phrase, the send word, or a claim without gated speech never inherits', async () => {
    const r = rig();
    await r.attach('dictate');
    await r.turn('a long verified sentence', LONG);
    expect(await r.turn('a long sentence that failed its own check', { ...SHORT(r), gatedSpeechMs: VOICE_MIN_VERIFY_SPEECH_MS })).toMatchObject({ draftOnly: true });
    const r2 = rig();
    await r2.attach('dictate');
    await r2.turn('a long verified sentence', LONG);
    expect(await r2.turn('allow', { ...SHORT(r2), intercepted: 'decision' })).toMatchObject({ refused: 'voice-speaker' });
    // Aegis L-1: the send word claimed by continuity is unverified (adjacency is its only basis)
    const r3 = rig();
    await r3.attach('dictate');
    await r3.turn('a long verified sentence', LONG);
    expect(await r3.turn('over and out', SHORT(r3))).toMatchObject({ draftOnly: true });
    const r4 = rig();
    await r4.attach('dictate');
    await r4.turn('a long verified sentence', LONG);
    const { gatedSpeechMs: _g, ...noGate } = SHORT(r4);
    expect(await r4.turn('yes', noGate)).toMatchObject({ draftOnly: true });
    expect(await refusal(r4.turn('x', { speakerBasis: 'verified' }))).toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('Aegis H-1: an inherited turn carries no speaker evidence', () => {
  it('Dictate: Enter sends it, clamped voice-unverified (attributed or a voice-hinted edit)', async () => {
    const r = rig();
    await r.attach('dictate');
    await r.turn('please fix the flaky test', LONG);
    await r.turn('and the docs', SHORT(r));
    await r.enter(['please fix the flaky test', 'and the docs']);
    expect(r.supSends.at(-1)).toMatchObject({ voiceOrigin: { sentBy: 'unverified' } });
    const r2 = rig();
    await r2.attach('dictate');
    await r2.turn('please fix the flaky test', LONG);
    await r2.turn('and the docs', SHORT(r2));
    await r2.enter(['please fix the flaky test and the docs, edited']);
    expect(r2.supSends.at(-1)).toMatchObject({ voiceOrigin: { sentBy: 'unverified' } });
    // consumed: the next verified send is a hand send
    await r2.turn('a new verified sentence', LONG);
    await r2.enter(['a new verified sentence']);
    expect(r2.supSends.at(-1)).not.toHaveProperty('voiceOrigin');
    // a verified-only draft is unchanged (hand)
    const r3 = rig();
    await r3.attach('dictate');
    await r3.turn('please fix the flaky test', LONG);
    await r3.enter(['please fix the flaky test']);
    expect(r3.supSends.at(-1)).not.toHaveProperty('voiceOrigin');
  });

  it('Send word: the word sends a draft with an inherited turn, clamped; an inherited turn never anchors adjacency', async () => {
    const r = rig();
    await r.attach('word');
    await r.turn('please fix the flaky test', LONG);
    await r.turn('and the docs', SHORT(r));
    const w = (await r.turn('over and out', { speakerBasis: 'adjacent', t0: r.clock.t - 500, t1: r.clock.t })) as { seq: number; forwardable: boolean };
    expect(w.forwardable).toBe(true); // adjacent to the verified turn (pending dictation)
    expect(r.v.claimSend(r.human, { hsid: HSID, by: 'word', turnSeq: w.seq })).toMatchObject({ claimed: true });
    await r.enter(['please fix the flaky test', 'and the docs']);
    expect(r.supSends.at(-1)).toMatchObject({ voiceOrigin: { sentBy: 'unverified' } });
  });

  it('a piece claim needs one turn verified alone; the voice principal never sends an inherited turn directly', async () => {
    const r = rig();
    await r.attach('pieces');
    const a = (await r.turn('please fix the flaky test', LONG)) as { seq: number };
    const b = (await r.turn('and the docs', SHORT(r))) as { seq: number };
    expect(await refusal(() => r.v.claimSend(r.human, { hsid: HSID, by: 'piece', turnSeqs: [b.seq] }))).toMatchObject({ reason: 'voice-speaker', cause: 'inherited-only' });
    expect(r.v.claimSend(r.human, { hsid: HSID, by: 'piece', turnSeqs: [a.seq, b.seq] })).toMatchObject({ claimed: true });
    const r2 = rig();
    await r2.attach('talk');
    await r2.turn('please fix the flaky test', { ...LONG, mode: 'ptt' });
    await r2.turn('and the docs', { ...SHORT(r2), mode: 'ptt' });
    expect(await refusal(r2.v.send(r2.vc, { hsid: HSID, content: [{ text: 'and the docs' }] }))).toMatchObject({ reason: 'voice-speaker', cause: 'inherited' });
    expect(r2.direct).toHaveLength(0);
  });
});

describe('Talk, narrow (Aegis 2026-10-23): a short unverifiable push-to-talk clip fills the draft, clamped; a long one keeps the gate', () => {
  it('short ⇒ draftOnly and an Enter send is voice-unverified; long and unrecognised ⇒ refused', async () => {
    const r = rig();
    await r.attach('talk');
    const got = (await r.turn('yes', { speakerId: 'spk:unknown-1', speakerEnrolled: false, gatedSpeechMs: 600, mode: 'ptt' })) as { seq: number };
    expect(got).toMatchObject({ forwardable: true, draftOnly: true });
    expect(await refusal(r.v.send(r.vc, { hsid: HSID, content: [{ text: 'yes' }] }))).toMatchObject({ reason: 'voice-speaker', cause: 'draft-only' });
    await r.enter(['yes']);
    expect(r.supSends.at(-1)).toMatchObject({ voiceOrigin: { sentBy: 'unverified' } });
    expect(await r.turn('a long unrecognised sentence', { speakerId: 'spk:unknown-1', speakerEnrolled: false, gatedSpeechMs: VOICE_MIN_VERIFY_SPEECH_MS, mode: 'ptt' })).toMatchObject({ refused: 'voice-speaker' });
  });
});
