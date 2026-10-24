/**
 * Dictate, the G-VOX-06 exception (founder bug 2026-10-21: "the point of dictate is that it should take everything
 * said"; spec §14.7). Under a conversation ceiling with send ceiling 'key' (the Dictate rung) an UNVERIFIED speaker's
 * ambient turn fills the draft (kernel-stamped draftOnly:true, speakerVerified:false; the row is hash-only and the words
 * reach the human class through status.voice.unverified only) and only the human's Enter sends it, clamped as origin
 * 'voice-unverified'. The voice principal's direct send, and word, piece and send-now claims over it (from any
 * attachment of the session: a preset switch re-attaches) are refused. Since 2026-10-23 (founder ruling: short speech
 * is never thrown away) Send word and Pieces fill the draft the same way; Talk keeps the speaker gate, and a short
 * unverified turn there is refused with cause 'too-short'. Pure (no daemon).
 */
import { describe, expect, it } from 'vitest';
import { RefusedError, VOICE_LIABILITY_ACK_HASH, VOICE_MIN_VERIFY_SPEECH_MS } from '@a-company/gnomon-contracts';
import { voiceStatusFor } from '../src/kernel/voice/voice-requests.js';
import { UNVERIFIED_TEXT_TTL_MS, VoiceControl, type VoiceAppendRow, type VoicePresenceRequest } from '../src/kernel/voice/voice-control.js';
import { createSessionPort } from '../src/kernel/supervisor/port.js';

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

describe('G-VOX-06 Dictate exception: an unverified turn fills the draft, marked', () => {
  it("the founder's short unenrolled turn is accepted into the draft; the row is hash-only, the words reach the human class only", async () => {
    const r = rig();
    await r.attach('dictate');
    const got = (await r.turn('fix the flaky test', UNVERIFIED)) as { seq: number };
    expect(got).toMatchObject({ forwardable: true, draftOnly: true });
    expect(got).not.toHaveProperty('refused');
    expect(r.rows.at(-1)).toMatchObject({ kind: 'voice.turn.user', session: HSID });
    // the log keeps the truth (not enrolled, not verified, the score bucket, the gated speech) but NEVER the words
    const row = r.rows.at(-1)!.payload;
    expect(row).toMatchObject({ forwardable: true, draftOnly: true, speakerVerified: false, speakerEnrolled: false, speakerId: 'spk:unknown-1', speakerScore: 'lt0.5', gatedSpeechMs: 1140, textHash: expect.stringMatching(/^hmac-sha256:/) });
    expect(row).not.toHaveProperty('text');
    expect(JSON.stringify(r.rows)).not.toContain('flaky');
    // the words live in kernel memory, per viewer: the owner of the session only (Aegis re-check), never in status()
    expect(r.words().get(got.seq)).toBe('fix the flaky test');
    expect(r.v.status()).not.toHaveProperty('unverified');
    expect(r.v.unverifiedFor('p:abcdefgh/someone-else')).toEqual([]);
    expect(r.v.unverifiedFor(undefined)).toEqual([]);
    r.owner.of = 'p:abcdefgh/someone-else'; // the session is no longer this human's: its words are no longer shown to them
    expect(r.v.unverifiedFor(HUMAN)).toEqual([]);
    r.owner.of = HUMAN;
    // the projection: a human on the gui credential only (never device, CLI, read token or another class)
    const st = { ...r.v.status(), unverified: r.v.unverifiedFor(HUMAN) };
    expect(voiceStatusFor(st, 'gui', 'human').unverified).toEqual([{ seq: got.seq, hsid: HSID, text: 'fix the flaky test' }]);
    for (const cred of ['device', 'cli', 'read-token', undefined]) expect(voiceStatusFor(st, cred, 'human'), String(cred)).not.toHaveProperty('unverified');
    for (const cls of ['voice', 'agent', undefined]) expect(voiceStatusFor(st, 'gui', cls)).not.toHaveProperty('unverified');
    // they expire (kernel clock) and are never kept past the TTL
    r.clock.t += UNVERIFIED_TEXT_TTL_MS + 1;
    expect(r.words().size).toBe(0);
    // a verified turn keeps its text on the row, unmarked
    await r.turn('and the docs');
    expect(r.rows.at(-1)!.payload).toMatchObject({ forwardable: true, speakerEnrolled: true, text: 'and the docs' });
    expect(r.rows.at(-1)!.payload).not.toHaveProperty('draftOnly');
  });

  it("it never reaches a session without the human's Enter; the Enter send is clamped as voice-unverified", async () => {
    const r = rig();
    await r.attach('dictate');
    const t = (await r.turn('delete the build folder', UNVERIFIED)) as { seq: number };
    expect(await refusal(r.v.send(r.vc, { hsid: HSID, content: [{ text: 'delete the build folder' }] }))).toMatchObject({ gate: 'voice', reason: 'voice-speaker', cause: 'draft-only' });
    expect(await refusal(() => r.v.claimSend(r.human, { hsid: HSID, by: 'hotkey' }))).toMatchObject({ reason: 'voice-speaker', cause: 'draft-only' });
    expect(await refusal(() => r.v.claimSend(r.human, { hsid: HSID, by: 'piece', turnSeqs: [t.seq] }))).toMatchObject({ reason: 'voice-off', cause: 'send-ceiling' });
    expect(r.direct).toHaveLength(0);
    expect(r.supSends).toHaveLength(0);
    // the human's Enter sends it: attributed (the dictated words) and clamped, origin voice-unverified (fail closed)
    await r.enter(['delete the build folder']);
    expect(r.supSends).toHaveLength(1);
    expect(r.supSends[0]).toMatchObject({ text: 'delete the build folder', voiceAttribution: { source: 'voice', turnSeqs: [t.seq] }, voiceOrigin: { sentBy: 'unverified' } });
    expect(r.words().size).toBe(0); // sent: the words leave kernel memory
    // nothing outstanding now: the next verified Enter is a hand send
    await r.turn('and the docs');
    await r.enter(['and the docs']);
    expect(r.supSends.at(-1)).not.toHaveProperty('voiceOrigin');
  });

  it('an EDITED draft holding an unverified turn (no part matches) is still clamped; a failed send hands the turn back', async () => {
    const r = rig();
    await r.attach('dictate');
    await r.turn('ship it', UNVERIFIED);
    await r.enter(['ship it now please']);
    expect(r.supSends.at(-1)).toMatchObject({ voiceOrigin: { sentBy: 'unverified' } });
    expect(r.supSends.at(-1)).not.toHaveProperty('voiceAttribution');
    // a failed send: the outstanding turn is handed back (it still blocks claims and clamps the next send)
    const r2 = rig();
    const port2 = createSessionPort({ resumed: () => false, send: async () => { throw new Error('no permit'); } } as never, undefined, r2.v);
    await r2.attach('dictate');
    await r2.turn('ship it', UNVERIFIED);
    await expect(port2.send({ principal: HUMAN, principalClass: 'human', connId: 'conn:H1', credential: 'gui' }, { hsid: HSID, content: [{ text: 'ship it' }], source: 'voice' })).rejects.toThrow();
    await r2.enter(['ship it']);
    expect(r2.supSends.at(-1)).toMatchObject({ voiceOrigin: { sentBy: 'unverified' } });
  });

  it('TD-2026-10-23-496: Dictate → Send word re-attaches; the word now sends the whole draft (clamped voice-unverified); send-now and pieces are still refused', async () => {
    const r = rig();
    await r.attach('dictate');
    await r.turn('drop the database', UNVERIFIED);
    await r.attach('word'); // the preset switch: a NEW attachment on the same session (its start row carries the liability acknowledgement)
    await r.turn('and the tests'); // a verified draft turn under the word ceiling
    expect(await refusal(() => r.v.claimSend(r.human, { hsid: HSID, by: 'hotkey' }))).toMatchObject({ reason: 'voice-speaker', cause: 'draft-only' });
    const w = (await r.turn('over and out')) as { seq: number };
    expect(r.v.claimSend(r.human, { hsid: HSID, by: 'word', turnSeq: w.seq })).toMatchObject({ claimed: true });
    await r.enter(['drop the database and the tests']);
    expect(r.supSends.at(-1)).toMatchObject({ voiceOrigin: { sentBy: 'unverified' } });
    // the same across Dictate → Pieces
    const r2 = rig();
    await r2.attach('dictate');
    await r2.turn('drop the database', UNVERIFIED);
    await r2.attach('pieces');
    const d = (await r2.turn('and the tests')) as { seq: number };
    expect(await refusal(() => r2.v.claimSend(r2.human, { hsid: HSID, by: 'piece', turnSeqs: [d.seq] }))).toMatchObject({ reason: 'voice-speaker', cause: 'draft-only', by: 'piece' });
    // the unverified turn was consumed with that send: a verified-only draft's word send is a plain word send again
    await r.turn('next thing');
    const w2 = (await r.turn('over and out')) as { seq: number };
    expect(r.v.claimSend(r.human, { hsid: HSID, by: 'word', turnSeq: w2.seq })).toMatchObject({ claimed: true });
  });

  it('a draft-only turn is never the send word nor an adjacency anchor; a client draftOnly / speakerVerified claim is BAD_REQUEST', async () => {
    const r = rig();
    await r.attach('dictate');
    await r.turn('ship it', UNVERIFIED);
    // an unverified short word claimed "adjacent" is just more (unverified) draft under Dictate: never a command
    const adj = await r.turn('over and out', { speakerId: 'spk:unknown-1', speakerBasis: 'adjacent', t0: r.clock.t - 400, t1: r.clock.t });
    expect(adj).toMatchObject({ forwardable: true, draftOnly: true });
    expect(await refusal(r.turn('x', { draftOnly: true }))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(await refusal(r.turn('x', { speakerVerified: true }))).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('every other receipt guard still runs, and decisions or controls from an unverified voice are still refused', async () => {
    const r = rig();
    await r.attach('dictate');
    expect(await r.turn('no aec here', { ...UNVERIFIED, aec: undefined })).toMatchObject({ refused: 'voice-off', refusedCause: 'aec' });
    expect(await r.turn('allow', { ...UNVERIFIED, intercepted: 'decision' })).toMatchObject({ refused: 'voice-speaker' });
    // a LONG push-to-talk clip that does not match keeps the speaker gate (Aegis 2026-10-23: only a short one may draft)
    expect(await r.turn('held key words', { ...UNVERIFIED, gatedSpeechMs: VOICE_MIN_VERIFY_SPEECH_MS, mode: 'ptt' })).toMatchObject({ refused: 'voice-speaker' });
    expect(r.rows.at(-1)!.payload).not.toHaveProperty('text');
    expect(r.words().size).toBe(0);
  });
});

describe('G-VOX-06 stays for every rung that sends without a key press', () => {
  it('talk: a LONG unverified turn is refused voice-speaker at receipt, stored hash-only', async () => {
    const r = rig();
    await r.attach('talk');
    const got = await r.turn('rm -rf build', { ...UNVERIFIED, gatedSpeechMs: VOICE_MIN_VERIFY_SPEECH_MS, mode: 'ptt' });
    expect(got).toMatchObject({ forwardable: false, refused: 'voice-speaker' });
    expect(r.rows.at(-1)!.payload).not.toHaveProperty('text');
    expect(r.rows.at(-1)!.payload).not.toHaveProperty('draftOnly');
    await r.enter(['rm -rf build']);
    expect(r.supSends.at(-1)).not.toHaveProperty('voiceAttribution');
  });

  // founder ruling 2026-10-23: short speech is never thrown away. Under Send word and Pieces an unverified turn fills the
  // draft like Dictate; the word, pieces and send-now are refused while it is there, so only the human's Enter sends it
  for (const rung of ['word', 'pieces'] as const) {
    it(`${rung}: an unverified turn fills the draft (hash-only row); ${rung === 'word' ? 'the word or Enter sends it' : 'only Enter sends it'}, clamped`, async () => {
      const r = rig();
      await r.attach(rung);
      const got = (await r.turn('rm -rf build', UNVERIFIED)) as { seq: number };
      expect(got).toMatchObject({ forwardable: true, draftOnly: true });
      expect(r.rows.at(-1)!.payload).not.toHaveProperty('text');
      const w = (await r.turn('over and out')) as { seq: number };
      // TD-2026-10-23-496: the word claim is accepted (the send it binds is clamped below); pieces keep their rule
      if (rung === 'word') expect(r.v.claimSend(r.human, { hsid: HSID, by: 'word', turnSeq: w.seq })).toMatchObject({ claimed: true });
      else expect(await refusal(() => r.v.claimSend(r.human, { hsid: HSID, by: 'piece', turnSeqs: [got.seq] }))).toMatchObject({ reason: 'voice-speaker', cause: 'draft-only' });
      if (rung === 'pieces') expect(await refusal(() => r.v.claimSend(r.human, { hsid: HSID, by: 'hotkey' }))).toMatchObject({ reason: 'voice-speaker', cause: 'draft-only' });
      expect(await refusal(r.v.send(r.vc, { hsid: HSID, content: [{ text: 'rm -rf build' }] }))).toMatchObject({ code: 'FORBIDDEN', gate: 'voice' });
      expect(r.supSends).toHaveLength(0);
      await r.enter(['rm -rf build']);
      expect(r.supSends.at(-1)).toMatchObject({ voiceOrigin: { sentBy: 'unverified' } });
    });
  }

  it(`Talk: a short turn (gated speech under ${VOICE_MIN_VERIFY_SPEECH_MS} ms) fills the draft unverified (Aegis 2026-10-23); a long unrecognised one is refused with no cause`, async () => {
    const r = rig();
    await r.attach('talk');
    expect(await r.turn('a', { ...UNVERIFIED, mode: 'ptt', gatedSpeechMs: VOICE_MIN_VERIFY_SPEECH_MS - 10 })).toMatchObject({ forwardable: true, draftOnly: true });
    expect(r.rows.at(-1)!.payload).toMatchObject({ draftOnly: true, speakerVerified: false });
    expect(r.rows.at(-1)!.payload).not.toHaveProperty('text');
    const long = await r.turn('b', { ...UNVERIFIED, mode: 'ptt', gatedSpeechMs: VOICE_MIN_VERIFY_SPEECH_MS });
    expect(long).toMatchObject({ refused: 'voice-speaker' });
    expect(long).not.toHaveProperty('refusedCause');
    const unknown = await r.turn('c', { speakerId: 'spk:unknown-1', speakerEnrolled: false, mode: 'ptt' });
    expect(unknown).not.toHaveProperty('refusedCause');
  });
});
