/**
 * #gnomon-voice dictation (TD-2026-10-20-262, T-2026-10-19-026; spec §14.7 "Dictation"): the kernel-stamped
 * `forwardable` verdict on voice.turn.user (K1), the attribution of a human send{source:'voice'} (K2, through the
 * #supervisor session port) and the request.voice.report{dictation} relay (K3). Pure: no keys, no paths.
 */
import { describe, expect, it } from 'vitest';
import { RefusedError } from '@a-company/gnomon-contracts';
import { VoiceControl, dictationTag, voicePrincipalOf, voiceTag, type VoiceAppendRow } from '../src/kernel/voice/voice-control.js';
import { createSessionPort } from '../src/kernel/supervisor/port.js';
import { VoiceReports, VOICE_REPORT_TTL_MS } from '../src/kernel/voice/voice-requests.js';

const HUMAN = 'p:abcdefgh/founder';
const VOICE = 'p:abcdefgh/voice';
const SPK = 'spk:abcdefgh/founder';
const HSID = 'hs:01JAAAAAAAAAAAAAAAAAAAAAAA';

function rig(o: { failSend?: boolean } = {}) {
  const clock = { t: 10_000 };
  const rows: VoiceAppendRow[] = [];
  const direct: unknown[] = [];
  const owners = new Map<string, string>([[HSID, HUMAN], ['hs:other', 'p:abcdefgh/someone']]);
  const v = new VoiceControl({
    sessions: {
      ownerOf: (h) => owners.get(h),
      send: async (_owner, p) => (direct.push(p), { turn: `turn:${HSID}/1` }),
      stop: async () => ({ signals: [], exited: false }),
    },
    append: async (row) => (rows.push(row), { seq: rows.length, hash: `h${rows.length}` }),
    enrolled: () => new Set([SPK]),
    voiceConnections: () => ['conn:V'],
    now: () => clock.t,
  });
  const supSends: Array<{ principal: string; p: Record<string, unknown> }> = [];
  const sup = {
    resumed: () => false,
    send: async (principal: string, p: Record<string, unknown>) => {
      if (o.failSend) throw new Error('no permit');
      supSends.push({ principal, p });
      return { turn: `turn:${HSID}/${supSends.length}` };
    },
  };
  const port = createSessionPort(sup as never, undefined, v);
  const human = { connId: 'conn:H', principal: HUMAN, principalClass: 'human', credential: 'gui' };
  const ctx = { principal: HUMAN, principalClass: 'human', connId: 'conn:H', credential: 'gui' };
  const vc = { connId: 'conn:V', principal: VOICE };
  const attach = () => v.humanAppend(human, 'voice.session.start', { hsid: HSID });
  let n = 0;
  const userTurn = (text: string, p: Record<string, unknown> = {}) =>
    v.voiceAppend(vc, { kind: 'voice.turn.user', payload: { turnId: String(++n), speakerId: SPK, speakerEnrolled: true, forwarded: false, t0: clock.t, t1: clock.t + 500, text, mode: 'ptt', ...p } }) as Promise<Record<string, unknown>>;
  const humanSend = (parts: string[], extra: Record<string, unknown> = { source: 'voice' }) => port.send(ctx, { hsid: HSID, content: parts.map((text) => ({ text })), ...extra });
  return { v, rows, direct, supSends, port, ctx, vc, attach, userTurn, humanSend, clock };
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

describe('#gnomon-voice dictation K1: the kernel stamps forwardable', () => {
  it('an accepted turn row carries forwardable:true; intercepted carries false; a refused row stays hash-only', async () => {
    const r = rig();
    await r.attach();
    const ok = await r.userTurn('run the tests');
    expect(ok.forwardable).toBe(true);
    expect(r.rows.at(-1)!.payload).toMatchObject({ forwardable: true, text: 'run the tests', forwarded: false });
    await r.userTurn('allow', { intercepted: 'decision' });
    expect(r.rows.at(-1)!.payload).toMatchObject({ forwardable: false });
    const ref = await r.userTurn('who', { speakerId: 'spk:unknown-1', speakerEnrolled: false });
    expect(ref).toMatchObject({ forwardable: false, refused: 'voice-speaker' });
    expect(r.rows.at(-1)!.payload).not.toHaveProperty('forwardable');
    expect(r.rows.at(-1)!.payload).not.toHaveProperty('text');
  });
  it('a client-sent forwardable is BAD_REQUEST (like receivedAt)', async () => {
    const r = rig();
    await r.attach();
    expect(await refusal(r.userTurn('x', { forwardable: true }))).toMatchObject({ code: 'BAD_REQUEST', reason: 'bad-params' });
    expect(await refusal(r.userTurn('x', { forwardable: false }))).toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('#gnomon-voice dictation K2: attribution at the human send', () => {
  it('every part matches in order ⇒ source voice, voiceTurnSeqs + voiceTurnSeq, parts joined with a space', async () => {
    const r = rig();
    await r.attach();
    const a = (await r.userTurn('run the tests')) as { seq: number };
    const b = (await r.userTurn('then commit')) as { seq: number };
    r.clock.t += 120_000; // the 30 s freshness binds the direct path only (the countdown can be held)
    await r.humanSend(['run the tests', 'then commit']);
    const sent = r.supSends[0]!;
    expect(sent.principal).toBe(HUMAN);
    expect(sent.p.text).toBe('run the tests then commit');
    expect(sent.p.voiceAttribution).toMatchObject({ source: 'voice', turnSeqs: [a.seq, b.seq] });
    expect(voiceTag(sent.p as never)).toEqual({ source: 'voice', voiceSessionId: expect.stringMatching(/^vs:/), voiceTurnSeqs: [a.seq, b.seq], voiceTurnSeq: b.seq });
    // the matched turns are forwarded: a later direct send of the same turn is refused
    r.clock.t -= 120_000;
    expect(await refusal(r.v.send(r.vc, { hsid: HSID, content: [{ text: 'then commit' }] }))).toMatchObject({ reason: 'voice-stale-utterance' });
    // and a second human send of the same text is no longer attributed
    await r.humanSend(['run the tests', 'then commit']);
    expect(r.supSends[1]!.p).not.toHaveProperty('voiceAttribution');
    expect(r.supSends[1]!.p.text).toBe('run the tests\nthen commit');
  });
  it('an edited composer ⇒ voice-edited with the matched seqs only; nothing matched ⇒ no voice tag', async () => {
    const r = rig();
    await r.attach();
    await r.userTurn('run the tests');
    const b = (await r.userTurn('then commit')) as { seq: number };
    await r.humanSend(['run all the tests', 'then commit']);
    expect(r.supSends[0]!.p.voiceAttribution).toMatchObject({ source: 'voice-edited', turnSeqs: [b.seq] });
    expect(r.supSends[0]!.p.text).toBe('run all the tests\nthen commit');
    expect(dictationTag(r.supSends[0]!.p.voiceAttribution as never)).toEqual({ source: 'voice-edited', voiceSessionId: expect.any(String), voiceTurnSeqs: [b.seq] });
    await r.humanSend(['something typed']);
    expect(r.supSends[1]!.p).not.toHaveProperty('voiceAttribution');
  });
  it('order matters: parts out of order match only the in-order prefix (voice-edited)', async () => {
    const r = rig();
    await r.attach();
    const a = (await r.userTurn('one')) as { seq: number };
    await r.userTurn('two');
    await r.humanSend(['two', 'one']);
    expect(r.supSends[0]!.p.voiceAttribution).toMatchObject({ source: 'voice-edited' });
    expect((r.supSends[0]!.p.voiceAttribution as { turnSeqs: number[] }).turnSeqs).toHaveLength(1);
    expect((r.supSends[0]!.p.voiceAttribution as { turnSeqs: number[] }).turnSeqs[0]).not.toBe(a.seq);
  });
  it('refused, intercepted, pre-attachment and other-attachment turns never match', async () => {
    const r = rig();
    await r.userTurn('before'); // no attachment: refused at receipt
    await r.attach();
    await r.userTurn('allow', { intercepted: 'decision' });
    await r.userTurn('stranger', { speakerId: 'spk:unknown-1', speakerEnrolled: false });
    await r.humanSend(['before', 'allow', 'stranger']);
    expect(r.supSends[0]!.p).not.toHaveProperty('voiceAttribution');
    await r.userTurn('old attachment');
    await r.attach(); // a re-attach: a new voiceSessionId
    await r.humanSend(['old attachment']);
    expect(r.supSends[1]!.p).not.toHaveProperty('voiceAttribution');
  });
  it('only the human owning the attachment, on its hsid, gets attribution; another ns voice principal does not count', async () => {
    const r = rig();
    await r.attach();
    await r.userTurn('run the tests');
    expect(r.v.attributeHumanSend('p:abcdefgh/someone', HSID, ['run the tests'])).toBeNull();
    expect(r.v.attributeHumanSend(HUMAN, 'hs:other', ['run the tests'])).toBeNull();
    expect(r.v.attributeHumanSend('p:zzzzzzzz/founder', HSID, ['run the tests'])).toBeNull();
    expect(voicePrincipalOf(HUMAN)).toBe(VOICE);
    expect(voicePrincipalOf('kernel')).toBeUndefined();
    expect(r.v.attributeHumanSend(HUMAN, HSID, ['run the tests'])).toMatchObject({ source: 'voice' });
  });
  it('attribution never refuses; a failed human send releases the matched turns', async () => {
    const r = rig({ failSend: true });
    await r.attach();
    await r.userTurn('run the tests');
    await expect(r.humanSend(['run the tests'])).rejects.toThrow('no permit');
    // released: the direct path may still forward it
    await r.v.send(r.vc, { hsid: HSID, content: [{ text: 'run the tests' }] });
    expect(r.direct).toHaveLength(1);
  });
  it('source is accepted only as voice, only from a human; absent source is untouched', async () => {
    const r = rig();
    await r.attach();
    await r.userTurn('run the tests');
    expect(await refusal(r.humanSend(['run the tests'], { source: 'agent' }))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(await refusal(r.port.send({ ...r.ctx, principalClass: 'agent' }, { hsid: HSID, content: [{ text: 'x' }], source: 'voice' }))).toMatchObject({ code: 'BAD_REQUEST' });
    await r.humanSend(['run the tests'], {});
    expect(r.supSends[0]!.p).not.toHaveProperty('voiceAttribution');
    // without the hint the turn stays pending
    await r.humanSend(['run the tests']);
    expect(r.supSends[1]!.p.voiceAttribution).toMatchObject({ source: 'voice' });
  });
});

describe('#gnomon-voice dictation K3: request.voice.report{dictation}', () => {
  it('relays {activity, holdToggles, at}; validates the shape; holdToggles is monotone per connection', () => {
    let t = 1_000_000;
    const rep = new VoiceReports(() => t);
    expect(rep.status().dictation).toBeNull();
    rep.report({ dictation: { activity: 'speaking', holdToggles: 0 } }, 'conn:V');
    expect(rep.status().dictation).toEqual({ activity: 'speaking', holdToggles: 0, at: new Date(t).toISOString() });
    rep.report({ dictation: { activity: 'idle', holdToggles: 2 } }, 'conn:V');
    expect(rep.status().dictation).toMatchObject({ activity: 'idle', holdToggles: 2 });
    expect(() => rep.report({ dictation: { activity: 'idle', holdToggles: 1 } }, 'conn:V')).toThrow(/monotone/);
    expect(() => rep.report({ dictation: { activity: 'shouting', holdToggles: 3 } }, 'conn:V')).toThrow(TypeError);
    expect(() => rep.report({ dictation: { activity: 'idle', holdToggles: -1 } }, 'conn:V')).toThrow(TypeError);
    expect(() => rep.report({ dictation: { activity: 'idle', holdToggles: 1.5 } }, 'conn:V')).toThrow(TypeError);
    expect(() => rep.report({ dictation: { activity: 'idle', holdToggles: 3, extra: 1 } }, 'conn:V')).toThrow(TypeError);
    expect(() => rep.report({ dictation: null }, 'conn:V')).toThrow(TypeError);
    // a new voice connection (a restarted client) starts its own count
    rep.report({ dictation: { activity: 'idle', holdToggles: 0 } }, 'conn:V2');
    expect(rep.status().dictation).toMatchObject({ holdToggles: 0 });
    t += VOICE_REPORT_TTL_MS + 1;
    expect(rep.status().dictation).toBeNull();
  });
});
