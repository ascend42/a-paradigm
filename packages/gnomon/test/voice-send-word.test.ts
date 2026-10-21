/**
 * $send-by-word / $send-by-pieces (TD-2026-10-21-514, spec §14.7 "Voice submodes"): the kernel side of the send word and
 * pieces — the held word, request.voice.send.claim (check, consume, bind), the origin of the next human voice send,
 * the fail-closed backstop, short words by adjacency and the pieces ceiling. G-VOX-20, G-VOX-20b, G-VOX-21. Pure (no
 * daemon); the send-word file store is exercised against a temp dir.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RefusedError, VOICE_LIABILITY_ACK_HASH } from '@a-company/gnomon-contracts';
import { VoiceControl, type VoiceAppendRow, type VoicePresenceRequest } from '../src/kernel/voice/voice-control.js';
import { createSessionPort } from '../src/kernel/supervisor/port.js';
import { cachedSendWordSource, parseSendWordRequest, readSendWord, sendWordPath, writeSendWord } from '../src/kernel/voice/send-word-store.js';
import { voiceStatusFor } from '../src/kernel/voice/voice-requests.js';

const HUMAN = 'p:abcdefgh/founder';
const VOICE = 'p:abcdefgh/voice';
const SPK = 'spk:abcdefgh/founder';
const HSID = 'hs:01JAAAAAAAAAAAAAAAAAAAAAAA';

function rig(o: { level?: string | null } = {}) {
  const clock = { t: 100_000 };
  const rows: VoiceAppendRow[] = [];
  const presence: VoicePresenceRequest[] = [];
  const v = new VoiceControl({
    sessions: { ownerOf: (h) => (h === HSID ? HUMAN : undefined), send: async () => ({}), stop: async () => ({}) },
    append: async (row) => (rows.push(row), { seq: rows.length, hash: `h${rows.length}` }),
    enrolled: () => new Set([SPK]),
    voiceConnections: () => ['conn:V'],
    now: () => clock.t,
    presence: async (req) => {
      presence.push(req);
      await req.onAllow();
      return { cardId: `card:01HZZZZZZZZZZZZZZZZZZZZZ${presence.length}0` };
    },
    strictnessLevel: () => o.level ?? null,
  });
  v.setSendWord({ text: 'over and out', variants: ['over an out'] });
  const supSends: Array<Record<string, unknown>> = [];
  const sup = { resumed: () => false, send: async (_p: string, p: Record<string, unknown>) => (supSends.push(p), { turn: `t${supSends.length}` }) };
  const port = createSessionPort(sup as never, undefined, v);
  const human = (connId = 'conn:H1') => ({ connId, principal: HUMAN, principalClass: 'human', credential: 'gui' });
  const vc = { connId: 'conn:V', principal: VOICE };
  const attach = (send: 'key' | 'word' | 'pieces' = 'word', connId = 'conn:H1') => v.humanAppend(human(connId), 'voice.session.start', { hsid: HSID, mode: 'conversation', send, ...(send !== 'key' ? { liabilityAck: VOICE_LIABILITY_ACK_HASH } : {}) });
  let n = 0;
  const turn = async (text: string, p: Record<string, unknown> = {}) => {
    const r = (await v.voiceAppend(vc, { kind: 'voice.turn.user', payload: { turnId: String(++n), speakerId: SPK, speakerEnrolled: true, forwarded: false, t0: clock.t - 2000, t1: clock.t, text, mode: 'conversation', aec: 'vpio', ...p } })) as Record<string, unknown>;
    clock.t += 100;
    return r;
  };
  const claim = (payload: Record<string, unknown>, connId = 'conn:H1') => v.claimSend(human(connId), { hsid: HSID, ...payload });
  const send = (parts: string[], connId = 'conn:H1') => port.send({ principal: HUMAN, principalClass: 'human', connId, credential: 'gui' }, { hsid: HSID, content: parts.map((text) => ({ text })), source: 'voice' });
  return { v, rows, presence, supSends, port, attach, turn, claim, send, clock };
}

const refusal = async (p: Promise<unknown> | (() => unknown)): Promise<Record<string, unknown>> => {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (e) {
    if (e instanceof RefusedError) return { code: e.refusal.code, ...(e.refusal.data as Record<string, unknown>) };
    throw e;
  }
  throw new Error('expected a refusal');
};

describe('G-VOX-20 send word: claim, consume, bind, origin', () => {
  it('the word after the draft is claimed and the next voice send is origin voice / sent by word', async () => {
    const r = rig();
    await r.attach('word');
    await r.turn('fix the failing test');
    const w = (await r.turn('Over and out.')) as { seq: number };
    expect(r.claim({ by: 'word', turnSeq: w.seq })).toMatchObject({ claimed: true, by: 'word' });
    await r.send(['fix the failing test']);
    expect(r.supSends.at(-1)).toMatchObject({ voiceOrigin: { sentBy: 'word' }, voiceAttribution: { source: 'voice' } });
    // the word was consumed: a second claim on it is stale
    expect(await refusal(() => r.claim({ by: 'word', turnSeq: w.seq }))).toMatchObject({ reason: 'voice-stale-utterance' });
    // Aegis M-2: an unclaimed ambient draft sent under a word ceiling is still voice-origin (a piece), never hand
    await r.turn('and the docs');
    await r.send(['and the docs']);
    expect(r.supSends.at(-1)).toMatchObject({ voiceOrigin: { sentBy: 'piece' } });
    // a typed send with no voice turns in it is hand
    await r.port.send({ principal: HUMAN, principalClass: 'human', connId: 'conn:H1', credential: 'gui' }, { hsid: HSID, content: [{ text: 'typed by hand' }] });
    expect(r.supSends.at(-1)).not.toHaveProperty('voiceOrigin');
  });

  it('Aegis H-1: an emptied draft + typed text + the send word comes out voice-origin (no source hint needed)', async () => {
    const r = rig();
    await r.attach('word');
    await r.turn('a dictated draft the human then deleted');
    const w = (await r.turn('over and out')) as { seq: number };
    r.claim({ by: 'word', turnSeq: w.seq });
    await r.port.send({ principal: HUMAN, principalClass: 'human', connId: 'conn:H1', credential: 'gui' }, { hsid: HSID, content: [{ text: 'typed instead' }] });
    expect(r.supSends.at(-1)).toMatchObject({ voiceOrigin: { sentBy: 'word' } });
  });

  it('refused: not the word, older than 30 s, before a pending draft turn, over the send ceiling', async () => {
    const r = rig();
    await r.attach('key');
    await r.turn('draft one');
    const w0 = (await r.turn('over and out')) as { seq: number };
    expect(await refusal(() => r.claim({ by: 'word', turnSeq: w0.seq }))).toMatchObject({ reason: 'voice-off', cause: 'send-ceiling' });
    await r.attach('word');
    const d = (await r.turn('draft two')) as { seq: number };
    expect(await refusal(() => r.claim({ by: 'word', turnSeq: d.seq }))).toMatchObject({ reason: 'voice-stale-utterance', cause: 'not-send-word' });
    const w = (await r.turn('over and out')) as { seq: number };
    await r.turn('one more thing'); // a draft turn after the word
    expect(await refusal(() => r.claim({ by: 'word', turnSeq: w.seq }))).toMatchObject({ reason: 'voice-stale-utterance', cause: 'order' });
    const w2 = (await r.turn('over an out')) as { seq: number }; // an enrolled variant
    r.clock.t += 31_000;
    expect(await refusal(() => r.claim({ by: 'word', turnSeq: w2.seq }))).toMatchObject({ reason: 'voice-stale-utterance', maxAgeMs: 30_000 });
    expect(await refusal(() => r.claim({ by: 'shout', turnSeq: 1 }))).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('Aegis M-1: an expired or wrong-session claim still stamps voice (never hand); the backstop stamps voice while an unclaimed word is pending', async () => {
    const r = rig();
    await r.attach('word');
    await r.turn('rename the module');
    const w = (await r.turn('over and out')) as { seq: number };
    r.claim({ by: 'word', turnSeq: w.seq });
    r.clock.t += 6_000;
    await r.send(['rename the module']);
    expect(r.supSends.at(-1)).toMatchObject({ voiceOrigin: { sentBy: 'word' } }); // expired: fail closed, never hand
    // backstop: the GUI sends with an unclaimed word pending ⇒ origin voice anyway, and the word is consumed
    await r.turn('then push it');
    await r.turn('over and out');
    await r.send(['then push it']);
    expect(r.supSends.at(-1)).toMatchObject({ voiceOrigin: { sentBy: 'word' } });
    // a claim naming another session also stamps voice on this send
    await r.turn('third thing');
    const w3 = (await r.turn('over and out')) as { seq: number };
    r.claim({ by: 'word', turnSeq: w3.seq });
    await r.port.send({ principal: HUMAN, principalClass: 'human', connId: 'conn:H1', credential: 'gui' }, { hsid: 'hs:other', content: [{ text: 'elsewhere' }] }).catch(() => undefined);
    expect(r.supSends.at(-1)).toMatchObject({ hsid: 'hs:other', voiceOrigin: { sentBy: 'word' } });
  });

  it('short words by adjacency: accepted only under 1500 ms, matching, and adjacent to (or pending with) the draft speaker', async () => {
    const r = rig();
    await r.attach('word');
    await r.turn('add a changelog entry');
    const ok = await r.turn('over and out', { speakerBasis: 'adjacent', t0: r.clock.t - 900, t1: r.clock.t });
    expect(ok.forwardable).toBe(true);
    expect(r.rows.at(-1)!.payload).toMatchObject({ speakerBasis: 'adjacent', forwardable: true });
    const long = await r.turn('over and out', { speakerBasis: 'adjacent', t0: r.clock.t - 1600, t1: r.clock.t });
    expect(long).toMatchObject({ forwardable: false, refused: 'voice-speaker' });
    expect(r.rows.at(-1)!.payload).not.toHaveProperty('text');
    const notWord = await r.turn('ship', { speakerBasis: 'adjacent', t0: r.clock.t - 500, t1: r.clock.t });
    expect(notWord).toMatchObject({ refused: 'voice-speaker' });
    expect(await refusal(r.turn('x', { speakerBasis: 'verified' }))).toMatchObject({ code: 'BAD_REQUEST' });
    // Aegis L-1: a short send word WITHOUT speakerBasis is held to the same rule (no draft nearby ⇒ refused)
    const r3 = rig();
    await r3.attach('word');
    expect(await r3.turn('over and out', { t0: r3.clock.t - 800, t1: r3.clock.t })).toMatchObject({ refused: 'voice-speaker' });
    await r3.turn('a draft sentence long enough');
    expect((await r3.turn('over and out', { t0: r3.clock.t - 800, t1: r3.clock.t })).forwardable).toBe(true);
    // no draft pending and nothing within 2 s ⇒ refused
    const r2 = rig();
    await r2.attach('word');
    const d = (await r2.turn('draft')) as { seq: number };
    const w = (await r2.turn('over and out')) as { seq: number };
    r2.claim({ by: 'word', turnSeq: w.seq });
    await r2.send(['draft']);
    expect(d.seq).toBeGreaterThan(0);
    r2.clock.t += 5_000;
    expect(await r2.turn('over and out', { speakerBasis: 'adjacent', t0: r2.clock.t - 500, t1: r2.clock.t })).toMatchObject({ refused: 'voice-speaker' });
  });

  it('a word being taught (trial) is accepted by adjacency but is never a send word, and expires', async () => {
    const r = rig();
    r.v.setSendWord(null);
    await r.attach('word');
    await r.turn('I am teaching my send word now');
    r.v.setTrialWord({ text: 'ship it' }, 10_000);
    const take = await r.turn('ship it', { speakerBasis: 'adjacent', t0: r.clock.t - 700, t1: r.clock.t });
    expect(take.forwardable).toBe(true);
    expect(await refusal(() => r.claim({ by: 'word', turnSeq: (take as { seq: number }).seq }))).toMatchObject({ cause: 'not-send-word' });
    r.clock.t += 11_000;
    expect(await r.turn('ship it', { speakerBasis: 'adjacent', t0: r.clock.t - 700, t1: r.clock.t })).toMatchObject({ refused: 'voice-speaker' });
  });

  it('the held word is shown to the human class only', async () => {
    const r = rig();
    const st = r.v.status();
    expect(st.sendWord).toEqual({ text: 'over and out', variants: ['over an out'] });
    expect(voiceStatusFor(st, 'gui', 'human')).toHaveProperty('sendWord');
    expect(voiceStatusFor(st, undefined, 'voice')).not.toHaveProperty('sendWord');
    expect(() => r.v.setSendWord({ text: 'approve' })).toThrow(RefusedError);
  });
});

describe('G-VOX-20b two tabs, one word: exactly one send', () => {
  it('the second tab is refused voice-stale-utterance and its send stays hand', async () => {
    const r = rig();
    await r.attach('word');
    await r.turn('refactor the parser');
    const w = (await r.turn('over and out')) as { seq: number };
    const results = await Promise.allSettled([Promise.resolve().then(() => r.claim({ by: 'word', turnSeq: w.seq }, 'conn:H1')), Promise.resolve().then(() => r.claim({ by: 'word', turnSeq: w.seq }, 'conn:H2'))]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect((rejected.reason as RefusedError).refusal.data).toMatchObject({ reason: 'voice-stale-utterance' });
    await r.send(['refactor the parser'], 'conn:H1');
    await r.send(['refactor the parser'], 'conn:H2');
    expect(r.supSends.filter((s) => s.voiceOrigin !== undefined)).toHaveLength(1);
  });
});

describe('G-VOX-21 pieces', () => {
  it('needs the pieces ceiling, granted by one fresh presence card (voice.widen, send pieces) per login', async () => {
    const r = rig();
    await r.attach('word');
    const a = (await r.turn('so the idea is')) as { seq: number };
    expect(await refusal(() => r.claim({ by: 'piece', turnSeqs: [a.seq] }))).toMatchObject({ reason: 'voice-off', cause: 'send-ceiling' });
    await r.attach('pieces');
    expect(r.presence.map((p) => p.send ?? null)).toEqual([null, 'pieces']);
    const b = (await r.turn('we split the module')) as { seq: number };
    const c = (await r.turn('in two')) as { seq: number };
    expect(r.claim({ by: 'piece', turnSeqs: [b.seq, c.seq] })).toMatchObject({ claimed: true, by: 'piece' });
    // a second claim citing a claimed turn is stale
    expect(await refusal(() => r.claim({ by: 'piece', turnSeqs: [c.seq] }, 'conn:H1'))).toMatchObject({ reason: 'voice-stale-utterance' });
    await r.send(['we split the module', 'in two']);
    expect(r.supSends.at(-1)).toMatchObject({ voiceOrigin: { sentBy: 'piece' }, voiceAttribution: { source: 'voice' } });
    // the same login re-attaching at pieces takes no new card
    await r.attach('pieces');
    expect(r.presence).toHaveLength(2);
  });

  it('is refused at strictness L2 or above (voice-strictness)', async () => {
    const r = rig({ level: 'L2' });
    expect(await refusal(r.attach('pieces'))).toMatchObject({ reason: 'voice-strictness', send: 'pieces', level: 'L2' });
    const r1 = rig({ level: 'L1' });
    await r1.attach('pieces');
    expect(r1.v.status().send).toBe('pieces');
  });

  it('Aegis M-4: send word and pieces need the liability acknowledgement, recorded in the kernel-written start row', async () => {
    const r = rig();
    const h = { connId: 'conn:H1', principal: HUMAN, principalClass: 'human', credential: 'gui' };
    for (const send of ['word', 'pieces']) {
      expect(await refusal(r.v.humanAppend(h, 'voice.session.start', { hsid: HSID, mode: 'conversation', send }))).toMatchObject({ reason: 'voice-off', cause: 'liability-ack' });
      expect(await refusal(r.v.humanAppend(h, 'voice.session.start', { hsid: HSID, mode: 'conversation', send, liabilityAck: 'sha256:' + '0'.repeat(64) }))).toMatchObject({ cause: 'liability-ack' });
    }
    await r.attach('word');
    expect(r.rows.find((x) => x.kind === 'voice.session.start')!.payload).toMatchObject({ send: 'word', liabilityAck: { principal: HUMAN, ackHash: VOICE_LIABILITY_ACK_HASH } });
    expect(await refusal(r.v.humanAppend(h, 'voice.session.start', { hsid: HSID, mode: 'conversation', liabilityAck: VOICE_LIABILITY_ACK_HASH }))).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('send word and pieces need ambient capture', async () => {
    const r = rig();
    expect(await refusal(r.v.humanAppend({ connId: 'conn:H1', principal: HUMAN, principalClass: 'human', credential: 'gui' }, 'voice.session.start', { hsid: HSID, mode: 'ptt', send: 'word' }))).toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('TD-2026-10-21-514 relayed mic controls (VoiceReports, never rows)', () => {
  it('the in-app mic key bumps micToggleSeq; the Mic key switch sets micKeyBare; both ride status', async () => {
    const { VoiceReports } = await import('../src/kernel/voice/voice-requests.js');
    const vr = new VoiceReports();
    expect(vr.status()).toMatchObject({ micToggleSeq: 0, micKeyBare: false, micWanted: null });
    expect(vr.micToggle()).toEqual({ micToggleSeq: 1 });
    expect(vr.micKey(true)).toEqual({ micKeyBare: true });
    expect(vr.status()).toMatchObject({ micToggleSeq: 1, micKeyBare: true });
  });
});

describe('the held send word file (<home>/voice/send-word.json, 0600)', () => {
  it('writes canonically with mode 0600, reads back, clears; a broken file holds no word', () => {
    const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-sw-')));
    try {
      const src = cachedSendWordSource(home);
      expect(src()).toBeNull();
      writeSendWord(home, { text: 'Ship it!', variants: ['shipped'] });
      expect(readSendWord(home)).toEqual({ text: 'ship it', variants: ['shipped'] });
      expect(src()).toEqual({ text: 'ship it', variants: ['shipped'] });
      expect(() => writeSendWord(home, { text: 'deny' })).toThrow(TypeError);
      fs.writeFileSync(sendWordPath(home), '{"format":"gnomon-send-word:v1","text":"allow"}\n');
      expect(readSendWord(home)).toBeNull();
      writeSendWord(home, null);
      expect(fs.existsSync(sendWordPath(home))).toBe(false);
      expect(src()).toBeNull();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
  it('gnomon voice send-word set|clear: canonical word, refuses an approval phrase and a kernel-spawned shell', async () => {
    const { runVoiceCommand } = await import('../src/cli/voice-cli.js');
    const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-swc-')));
    const sink = () => ({ text: '', write(s: string) { this.text += s; return true; } });
    const io = { stdout: sink() as never, stderr: sink() as never };
    try {
      expect(await runVoiceCommand(['send-word', 'set', 'Ship', 'it', '--variant', 'ship at', '--home', home], io, { env: {} })).toBe(0);
      expect(readSendWord(home)).toEqual({ text: 'ship it', variants: ['ship at'] });
      expect(await runVoiceCommand(['send-word', 'set', 'approve', '--home', home], io, { env: {} })).toBe(1);
      expect(await runVoiceCommand(['send-word', 'clear', '--home', home], io, { env: { GNOMON_HSID: 'hs:x' } })).toBe(1);
      expect(await runVoiceCommand(['send-word', 'clear', '--home', home], io, { env: {} })).toBe(0);
      expect(readSendWord(home)).toBeNull();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
  it('the request shape is strict', () => {
    expect(parseSendWordRequest({ op: 'clear' })).toEqual({ op: 'clear' });
    expect(parseSendWordRequest({ op: 'start', word: 'over' })).toEqual({ op: 'start', text: 'over', variants: [], trial: false });
    expect(parseSendWordRequest({ op: 'start', word: 'over', trial: true })).toMatchObject({ trial: true });
    for (const bad of [null, { op: 'set' }, { op: 'clear', word: 'x' }, { op: 'start' }, { op: 'start', word: 'x', extra: 1 }]) expect(() => parseSendWordRequest(bad)).toThrow(TypeError);
  });
});
