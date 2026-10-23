/**
 * TD-2026-10-23-496 (founder): once the human set up a send word and accepted at attach that anyone near the mic can
 * send with it (the liability acknowledgement a send-word or pieces attach carries), the send word sends the WHOLE draft,
 * verified parts or not, and the word itself counts whoever said it. What stays: every such send is clamped
 * voice-unverified (edits and tools ask first), voice never approves anything, pieces and Talk auto-send and the voice
 * principal's direct send keep their rules. Field evidence 2026-10-23 11:47 (aec vpio): "How's it going?" (320 ms gated,
 * unverified), two long verified sentences, "Mm. Mm." 10 s later (unverified), then the word three times (unverified).
 */
import { describe, expect, it } from 'vitest';
import { RefusedError, VOICE_LIABILITY_ACK_HASH, VOICE_LIABILITY_ACK_TEXT } from '@a-company/gnomon-contracts';
import { VoiceControl, type VoiceAppendRow, type VoicePresenceRequest } from '../src/kernel/voice/voice-control.js';
import { createSessionPort, lateVoicePort } from '../src/kernel/supervisor/port.js';

const HUMAN = 'p:abcdefgh/founder';
const VOICE = 'p:abcdefgh/voice';
const SPK = 'spk:abcdefgh/founder';
const HSID = 'hs:01JAAAAAAAAAAAAAAAAAAAAAAA';
/** the founder's evidence rows (kernel.db 2026-10-21T19:56:28Z / 19:57:13Z): unenrolled, lt0.5, 1140 and 1060 ms */
const UNVERIFIED = { speakerId: 'spk:unknown-1', speakerEnrolled: false, speakerScore: 'lt0.5', gatedSpeechMs: 1140 };

function rig() {
  const clock = { t: 100_000 };
  const owner = { of: HUMAN };
  const rows: VoiceAppendRow[] = [];
  const presence: VoicePresenceRequest[] = [];
  const direct: unknown[] = [];
  const v = new VoiceControl({
    sessions: { ownerOf: (h) => (h === HSID ? owner.of : undefined), send: async (_o, p) => (direct.push(p), {}), stop: async () => ({}) },
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
  // Aegis M-1: the daemon's own binding (lateVoicePort), never the VoiceControl handed in directly
  let failNext = false;
  const supFail = { resumed: () => false, send: async (p2: string, p: Record<string, unknown>) => { if (failNext) { failNext = false; throw new Error('no permit'); } return sup.send(p2, p); } };
  const port = createSessionPort(supFail as never, undefined, lateVoicePort(() => v));
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
  return { v, rows, direct, supSends, attach, turn, enter, words, vc, human, clock, owner, failNext: () => void (failNext = true) };
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


const SHORT_UNV = { speakerId: 'spk:unknown-1', speakerEnrolled: false, speakerScore: 'lt0.5', gatedSpeechMs: 320 };
const LONG = { speakerScore: 'ge0.8', gatedSpeechMs: 2600 };
/** the founder's field sequence; returns the last word turn */
async function field(r: ReturnType<typeof rig>): Promise<{ seq: number }> {
  await r.turn("How's it going?", SHORT_UNV);
  await r.turn('please look at the failing voice test and tell me why', LONG);
  await r.turn('then fix it and run the suite', LONG);
  r.clock.t += 10_000;
  await r.turn('Mm. Mm.', SHORT_UNV);
  let w: { seq: number } = { seq: 0 };
  for (let i = 0; i < 3; i++) w = (await r.turn('over and out', { ...SHORT_UNV, speakerBasis: 'adjacent', t0: r.clock.t - 400, t1: r.clock.t })) as { seq: number };
  return w;
}

describe('TD-2026-10-23-496: the send word sends the whole draft once the human accepted it', () => {
  it('the field sequence: the word sends the draft, clamped voice-unverified; the word rows say unverified', async () => {
    const r = rig();
    await r.attach('word');
    const w = await field(r);
    expect(r.rows.at(-1)!.payload).toMatchObject({ forwardable: true, speakerEnrolled: false, speakerVerified: false });
    expect(r.rows.at(-1)!.payload).not.toHaveProperty('draftOnly');
    expect(r.v.claimSend(r.human, { hsid: HSID, by: 'word', turnSeq: w.seq })).toMatchObject({ claimed: true });
    await r.enter(["How's it going? please look at the failing voice test and tell me why then fix it and run the suite Mm. Mm."]);
    expect(r.supSends.at(-1)).toMatchObject({ voiceOrigin: { sentBy: 'unverified' } });
    // a verified-only draft sent by the word after that is a word send (still voice-origin, clamped by its own rule)
    await r.turn('one more verified sentence', LONG);
    const w2 = (await r.turn('over and out', { speakerBasis: 'adjacent', t0: r.clock.t - 400, t1: r.clock.t })) as { seq: number };
    expect(r.v.claimSend(r.human, { hsid: HSID, by: 'word', turnSeq: w2.seq })).toMatchObject({ claimed: true });
    await r.enter(['one more verified sentence']);
    expect(r.supSends.at(-1)).toMatchObject({ voiceOrigin: { sentBy: 'word' } });
  });

  it('a lone word from an unknown voice counts too (the human owns the room)', async () => {
    const r = rig();
    await r.attach('word');
    await r.turn('fix the flaky test', LONG);
    const w = (await r.turn('over and out', { ...SHORT_UNV })) as { seq: number };
    expect(r.v.claimSend(r.human, { hsid: HSID, by: 'word', turnSeq: w.seq })).toMatchObject({ claimed: true });
    await r.enter(['fix the flaky test']);
    expect(r.supSends.at(-1)).toMatchObject({ voiceOrigin: { sentBy: 'unverified' } });
  });

  it('without the acceptance (Dictate: send ceiling key, no liability acknowledgement) the word does not send', async () => {
    const r = rig();
    await r.attach('dictate');
    const w = await field(r);
    expect(r.rows.at(-1)!.payload).toMatchObject({ draftOnly: true });
    expect(await refusal(() => r.v.claimSend(r.human, { hsid: HSID, by: 'word', turnSeq: w.seq }))).toMatchObject({ code: 'FORBIDDEN' });
    // and a send-word attach without the acknowledgement is refused at attach
    expect(await refusal(r.v.humanAppend(r.human, 'voice.session.start', { hsid: HSID, mode: 'conversation', send: 'word' }))).toMatchObject({ reason: 'voice-off', cause: 'liability-ack' });
    expect(VOICE_LIABILITY_ACK_HASH).toMatch(/^sha256:/);
  });

  it('unchanged: pieces and send-now stay refused over an unverified turn; the direct send never carries it; voice never approves', async () => {
    const r = rig();
    await r.attach('pieces');
    const u = (await r.turn('rm -rf build', SHORT_UNV)) as { seq: number };
    expect(await refusal(() => r.v.claimSend(r.human, { hsid: HSID, by: 'piece', turnSeqs: [u.seq] }))).toMatchObject({ reason: 'voice-speaker', cause: 'draft-only' });
    expect(await refusal(() => r.v.claimSend(r.human, { hsid: HSID, by: 'hotkey' }))).toMatchObject({ reason: 'voice-speaker', cause: 'draft-only' });
    expect(await refusal(r.v.send(r.vc, { hsid: HSID, content: [{ text: 'rm -rf build' }] }))).toMatchObject({ code: 'FORBIDDEN', gate: 'voice' });
    expect(r.direct).toHaveLength(0);
    // a decision or control phrase from an unverified voice is refused, word ceiling or not (voice never approves)
    const r2 = rig();
    await r2.attach('word');
    expect(await r2.turn('allow', { ...SHORT_UNV, intercepted: 'decision' })).toMatchObject({ refused: 'voice-speaker' });
    expect(await r2.turn('over and out', { ...SHORT_UNV, intercepted: 'control' })).toMatchObject({ refused: 'voice-speaker' });
  });
});

describe('Aegis M-1 / L-1 / L-2 on TD-2026-10-23-496 (through the daemon wiring, lateVoicePort)', () => {
  it('a VERIFIED adjacent word over a draft with an unverified part, sent as joined text, is voice-unverified; pieces are claimable after', async () => {
    const r = rig();
    await r.attach('pieces'); // pieces ⊇ word: the word sends, and a piece claim needs no unverified turn outstanding
    await r.turn("How's it going?", SHORT_UNV);
    await r.turn('please look at the failing voice test', LONG);
    const w = (await r.turn('over and out', { speakerBasis: 'adjacent', t0: r.clock.t - 400, t1: r.clock.t })) as { seq: number };
    expect(r.rows.at(-1)!.payload).toMatchObject({ speakerEnrolled: true });
    expect(r.v.claimSend(r.human, { hsid: HSID, by: 'word', turnSeq: w.seq })).toMatchObject({ claimed: true });
    await r.enter(["How's it going? please look at the failing voice test"]); // joined: matches no single part
    expect(r.supSends.at(-1)).toMatchObject({ voiceOrigin: { sentBy: 'unverified' } });
    // the unverified turn was consumed by that send: a verified piece is claimable again
    const d = (await r.turn('and then run the suite', LONG)) as { seq: number };
    expect(r.v.claimSend(r.human, { hsid: HSID, by: 'piece', turnSeqs: [d.seq] })).toMatchObject({ claimed: true });
  });

  it('a failed word send hands the unverified turns back: the retry (an edited Enter) is never hand', async () => {
    const r = rig();
    await r.attach('word');
    await r.turn("How's it going?", SHORT_UNV);
    await r.turn('please look at the failing voice test', LONG);
    const w = (await r.turn('over and out', { speakerBasis: 'adjacent', t0: r.clock.t - 400, t1: r.clock.t })) as { seq: number };
    r.v.claimSend(r.human, { hsid: HSID, by: 'word', turnSeq: w.seq });
    r.failNext();
    await expect(r.enter(["How's it going? please look at the failing voice test"])).rejects.toThrow();
    await r.enter(["How's it going? please look at the failing voice test, edited"]);
    expect(r.supSends.at(-1)).toMatchObject({ voiceOrigin: { sentBy: 'unverified' } });
  });

  it('L-2: the any-voice word row is hash-only, with the kernel\'s isWord verdict; a client isWord claim is BAD_REQUEST', async () => {
    const r = rig();
    await r.attach('word');
    await r.turn('fix it', LONG);
    await r.turn('over and out', SHORT_UNV);
    const row = r.rows.at(-1)!.payload;
    expect(row).toMatchObject({ isWord: true, speakerEnrolled: false, speakerVerified: false, forwardable: true, textHash: expect.stringMatching(/^hmac-sha256:/) });
    expect(row).not.toHaveProperty('text');
    expect(await refusal(r.turn('x', { isWord: true }))).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('L-1: the acknowledgement names the new scope; an attach with the OLD hash is refused with the hash to accept', async () => {
    const r = rig();
    const oldHash = 'sha256:' + 'ab'.repeat(32);
    expect(await refusal(r.v.humanAppend(r.human, 'voice.session.start', { hsid: HSID, mode: 'conversation', send: 'word', liabilityAck: oldHash }))).toMatchObject({ reason: 'voice-off', cause: 'liability-ack', ackHash: VOICE_LIABILITY_ACK_HASH });
    expect(VOICE_LIABILITY_ACK_TEXT).toBe('Anyone near my mic can send for me: the send word sends my whole draft. Edits will still ask.');
  });
});
