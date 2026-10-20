// @gnomon-platform: darwin, linux
/**
 * #gnomon-voice V2e item 4: the kernel decides enrolment. speakerEnrolled:true counts only for a speakerId in the
 * root-signed consented registry (readEnrolled); anything else is an unknown speaker (hash-only, not forwardable).
 * GUI enrolment: request.voice.enrol raises a fresh-presence strictness card (detail.op 'voice.enrol') whose allow
 * effect writes the same root-signed row `gnomon voice enrol` writes; forget writes the forget row with no card.
 * Writes 0600 enrolment files (POSIX modes), like voice-enrolment.test.ts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DevTestRootAuthority, DEV_TEST_ROOT_ACK } from '../src/kernel/identity/root-authority.js';
import { readEnrolled, enrolSpeaker } from '../src/kernel/voice/enrolment.js';
import { VoiceEnrolCards } from '../src/kernel/voice/voice-requests.js';
import { VoiceControl, type VoiceAppendRow } from '../src/kernel/voice/voice-control.js';
import { KIND_DECISIONS } from '../src/kernel/broker/classes.js';
import { tempHome } from './daemon-helpers.js';

const homes: Array<() => void> = [];
afterEach(() => homes.splice(0).forEach((c) => c()));

function setup() {
  const { home, cleanup } = tempHome('gv2e-');
  homes.push(cleanup);
  const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
  const raised: Array<Record<string, unknown>> = [];
  const asked: string[] = [];
  const broker = { raise: async (input: Record<string, unknown>) => (raised.push(input), { cardId: `card:01J${String(raised.length).padStart(23, '0')}` } as never) };
  return { home, root, raised, cards: new VoiceEnrolCards({ home, root, broker, onEnrolled: (n) => void asked.push(n) }), asked };
}

describe('#gnomon-voice V2e: GUI enrolment (request.voice.enrol / forget)', () => {
  it('enrol raises one fresh-presence card; only its allow effect writes the root-signed row', async () => {
    const { home, root, raised, cards, asked } = setup();
    const out = await cards.enrol({ connId: 'conn:H', principal: `p:${root.ns}/founder` }, { name: 'founder', consent: 'I consent to local voice enrolment' });
    expect(out).toEqual({ pending: true, cardId: expect.stringMatching(/^card:/) });
    const c = raised[0]!;
    expect(c).toMatchObject({ kind: 'strictness', decisions: ['allow', 'deny'], attended: true, detail: { op: 'voice.enrol', name: 'founder', speakerId: `spk:${root.ns}/founder` } });
    expect(KIND_DECISIONS.strictness.allow).toBe('fresh');
    expect(readEnrolled(home, root).size).toBe(0); // nothing before the decision
    const effect = c.effect as (d: string) => Promise<void>;
    await effect('deny');
    expect(readEnrolled(home, root).size).toBe(0);
    expect(asked).toEqual([]);
    await effect('allow');
    expect([...readEnrolled(home, root)]).toEqual([`spk:${root.ns}/founder`]);
    expect(asked).toEqual(['founder']); // the daemon sets status.voice.enrolment{name, phase:'requested'} for the client
    // forget: no card, the root-signed forget row at once
    expect(await cards.forget({ name: 'founder' })).toEqual({ forgotten: true, speakerId: `spk:${root.ns}/founder` });
    expect(readEnrolled(home, root).size).toBe(0);
    expect(raised).toHaveLength(1);
  });
  it('refuses a bad name or empty consent before any card (TypeError ⇒ BAD_REQUEST at the dispatcher)', async () => {
    const { raised, cards } = setup();
    await expect(cards.enrol({ connId: 'c', principal: 'p' }, { name: 'Bad Name', consent: 'yes' })).rejects.toThrow(TypeError);
    await expect(cards.enrol({ connId: 'c', principal: 'p' }, { name: 'ok', consent: '  ' })).rejects.toThrow(TypeError);
    await expect(cards.forget({ name: '../x' })).rejects.toThrow(TypeError);
    expect(raised).toHaveLength(0);
  });
});

describe('#gnomon-voice V2e: speakerEnrolled is the kernel\'s call (readEnrolled)', () => {
  it('a claim the registry does not hold is unknown: no text stored, not forwardable; status.voice.enrolled lists names', async () => {
    const { home, root } = setup();
    const HSID = 'hs:01JAAAAAAAAAAAAAAAAAAAAAAA';
    const HUMAN = `p:${root.ns}/founder`;
    const rows: VoiceAppendRow[] = [];
    const sends: unknown[] = [];
    const v = new VoiceControl({
      sessions: { ownerOf: () => HUMAN, send: async (_o, p) => (sends.push(p), { turn: 't' }), stop: async () => ({}) },
      append: async (row) => (rows.push(row), { seq: rows.length, hash: 'h' }),
      enrolled: () => readEnrolled(home, root),
      voiceConnections: () => ['conn:V'],
      now: () => 10_000,
    });
    await v.humanAppend({ connId: 'conn:H', principal: HUMAN, principalClass: 'human', credential: 'gui' }, 'voice.session.start', { hsid: HSID });
    const vc = { connId: 'conn:V', principal: `p:${root.ns}/voice` };
    let n = 0;
    const turn = (speakerId: string) => v.voiceAppend(vc, { kind: 'voice.turn.user', payload: { turnId: String(++n), speakerId, speakerEnrolled: true, forwarded: true, t0: 9_000, t1: 9_500, text: 'delete everything', mode: 'ptt' } });
    // never enrolled
    expect(await turn(`spk:${root.ns}/founder`)).toMatchObject({ forwardable: false, refused: 'voice-speaker' });
    expect(rows.at(-1)!.payload).toMatchObject({ speakerEnrolled: false, forwarded: false, refusedReason: 'voice-speaker' });
    expect(rows.at(-1)!.payload).not.toHaveProperty('text');
    expect(v.status().enrolled).toEqual([]);
    // enrolled by the root: the same claim now counts
    await enrolSpeaker(home, root, { name: 'founder', consent: 'yes' });
    expect(v.status().enrolled).toEqual(['founder']);
    const ok = (await turn(`spk:${root.ns}/founder`)) as Record<string, unknown>;
    expect(ok.forwardable).toBeUndefined();
    expect(rows.at(-1)!.payload).toMatchObject({ speakerEnrolled: true, text: 'delete everything' });
    // an enrolment signed by another root never counts
    const other = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    await enrolSpeaker(home, other, { name: 'intruder', consent: 'x' });
    expect(await turn(`spk:${other.ns}/intruder`)).toMatchObject({ forwardable: false, refused: 'voice-speaker' });
    expect(v.status().enrolled).toEqual(['founder']);
  });
});
