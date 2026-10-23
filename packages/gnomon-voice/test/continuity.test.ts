/**
 * Speaker continuity, client half (founder ruling 2026-10-23: natural, fast speech is never cut; the rule is contracts
 * VOICE_CONTINUITY_*, and the kernel re-checks it in packages/gnomon/test/voice-continuity.test.ts). A clip too short
 * to verify alone inherits the verified stretch it belongs to (speakerBasis 'continuity'); a silence past the gap,
 * agent speech, a mic off, a device restart or another enrolled voice breaks the stretch. Also: a mic fault from
 * gnomon-voice-io turns capture off and is reported in plain words (status.voice.mic.fault).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { VOICE_CONTINUITY_CLIP_MS, VOICE_CONTINUITY_GAP_MS, VOICE_CONTINUITY_MAX_TURNS, VOICE_CONTINUITY_STRETCH_MS } from '@a-company/gnomon-contracts';
import { FakeAudioIO } from '../src/fake-audio-io.js';
import { PRINT_SCHEMA, type VoicePrint } from '../src/speaker.js';
import { micFaultText, VoiceClient } from '../src/voice-client.js';
import { FakeLink, stubEngines, StubSpeaker, toneWav } from './stubs.js';

/** a stub engine that measures gated speech like the real one: every sample of the tone is speech */
class GatedStubSpeaker extends StubSpeaker {
  speechMs(samples: Float32Array, sampleRate: number): number {
    return (samples.length / sampleRate) * 1000;
  }
}

const MATT: VoicePrint = { schemaVersion: PRINT_SCHEMA, name: 'matt', model: 'stub', dim: 2, phrases: 3, embedding: [1, 0], createdAt: '2026-10-19T00:00:00Z' };
const OTHER: VoicePrint = { ...MATT, name: 'other', embedding: [0, 1] };
let clients: VoiceClient[] = [];
afterEach(async () => {
  for (const c of clients) await c.close();
  clients = [];
});

async function setup(texts: string[], prints: VoicePrint[] = [MATT]) {
  const audio = new FakeAudioIO();
  const link = new FakeLink();
  const notices: string[] = [];
  const engines = { ...stubEngines(texts), speaker: new GatedStubSpeaker() };
  const client = new VoiceClient({ audio, engines, link, ns: 'abcd1234', prints: () => prints, mode: 'ptt', delivery: 'composer', now: () => audio.clock, notice: (n) => notices.push(n.text) });
  clients.push(client);
  await client.start();
  return { audio, link, client, notices };
}
/** amp 0.5 is the enrolled voice in the stub; a long clip (2 s) verifies alone, a short one (600 ms) cannot */
const say = (audio: FakeAudioIO, ms: number, amp = 0.5, gapMs = 100): void => {
  audio.hotkey(true);
  audio.captureWav(toneWav(ms, amp));
  audio.hotkey(false);
  audio.silence(gapMs);
};
const turns = (link: FakeLink) => link.appends.filter((a) => a.kind === 'voice.turn.user').map((a) => a.payload);

describe('speaker continuity (client)', () => {
  it('a short clip right after a verified one inherits its speaker, marked continuity; chained clips too', async () => {
    const { audio, link, client } = await setup(['I do not get why this is', 'yes', 'and that']);
    say(audio, 2000);
    say(audio, 600, 0.2);
    say(audio, 500, 0.2);
    await client.idle();
    const ts = turns(link);
    expect(ts[0]).toMatchObject({ speakerId: 'spk:abcd1234/matt', speakerEnrolled: true });
    expect(ts[0]).not.toHaveProperty('speakerBasis');
    expect(ts[1]).toMatchObject({ speakerId: 'spk:abcd1234/matt', speakerEnrolled: true, speakerBasis: 'continuity', text: 'yes' });
    expect(ts[2]).toMatchObject({ speakerBasis: 'continuity', text: 'and that' });
  });

  it('no verified anchor yet: a short clip stays unverified', async () => {
    const { audio, link, client } = await setup(['yes']);
    say(audio, 600, 0.2);
    await client.idle();
    expect(turns(link)[0]).toMatchObject({ speakerEnrolled: false });
    expect(turns(link)[0]).not.toHaveProperty('speakerBasis');
  });

  it(`a silence longer than ${VOICE_CONTINUITY_GAP_MS} ms, or a stretch older than ${VOICE_CONTINUITY_STRETCH_MS / 1000} s, breaks it`, async () => {
    const a = await setup(['a long sentence', 'yes']);
    say(a.audio, 2000, 0.5, VOICE_CONTINUITY_GAP_MS + 500);
    say(a.audio, 600, 0.2);
    await a.client.idle();
    expect(turns(a.link)[1]).toMatchObject({ speakerEnrolled: false });
    const b = await setup(['a long sentence', ...Array.from({ length: 20 }, (_, i) => `w${i}`)]);
    say(b.audio, 2000);
    for (let i = 0; i < 20; i++) say(b.audio, 600, 0.2, 2000);
    await b.client.idle();
    const ts = turns(b.link);
    const firstBroken = ts.findIndex((t, i) => i > 0 && t.speakerEnrolled === false);
    expect(firstBroken).toBeGreaterThan(1);
    // every clip that kept continuity ended within the stretch window of the anchor
    for (const t of ts.slice(1, firstBroken)) expect((t.t1 as number) - (ts[0]!.t1 as number)).toBeLessThanOrEqual(VOICE_CONTINUITY_STRETCH_MS);
  });

  it('a refused or unverified turn between, a mic off and on, a device restart, or another enrolled voice breaks it', async () => {
    const a = await setup(['a long sentence', 'someone else', 'yes']);
    say(a.audio, 2000);
    say(a.audio, 2000, 0.2); // a long clip that fails verification: another voice
    say(a.audio, 600, 0.2);
    await a.client.idle();
    expect(turns(a.link)[2]).toMatchObject({ speakerEnrolled: false });
    const b = await setup(['a long sentence', 'yes']);
    say(b.audio, 2000);
    await b.client.idle();
    await b.client.setMicWanted(false);
    await b.client.setMicWanted(true);
    say(b.audio, 600, 0.2);
    await b.client.idle();
    expect(turns(b.link)[1]).toMatchObject({ speakerEnrolled: false });
    const c = await setup(['a long sentence', 'yes']);
    say(c.audio, 2000);
    await c.client.idle();
    c.audio.emitRestarted();
    say(c.audio, 600, 0.2);
    await c.client.idle();
    expect(turns(c.link)[1]).toMatchObject({ speakerEnrolled: false });
    // the short clip matches ANOTHER enrolled print over the threshold (stub: OTHER is [0, 1], the quiet voice)
    const d = await setup(['a long sentence', 'yes'], [MATT, OTHER]);
    say(d.audio, 2000);
    say(d.audio, 600, 0.2);
    await d.client.idle();
    expect(turns(d.link)[1]).toMatchObject({ speakerEnrolled: false });
    // the kernel refused the anchor: no stretch
    const e = await setup(['a long sentence', 'yes']);
    e.link.turnVerdict = { refused: 'voice-off' };
    say(e.audio, 2000);
    await e.client.idle();
    e.link.turnVerdict = undefined;
    say(e.audio, 600, 0.2);
    await e.client.idle();
    expect(turns(e.link)[1]).toMatchObject({ speakerEnrolled: false });
  });
});

describe('Aegis H-1 / M-1 / L-1 (client): inheritance is bounded; the send word and long clips never inherit', () => {
  it(`at most ${VOICE_CONTINUITY_MAX_TURNS} inherited turns per anchor, at most 3 s of them, no clip over ${VOICE_CONTINUITY_CLIP_MS} ms`, async () => {
    const a = await setup(['a long sentence', 'one', 'two', 'three']);
    say(a.audio, 2000);
    for (let i = 0; i < 3; i++) say(a.audio, 500, 0.2);
    await a.client.idle();
    expect(turns(a.link).map((t) => t.speakerBasis ?? null)).toEqual([null, 'continuity', 'continuity', null]);
    expect(turns(a.link)[3]).toMatchObject({ speakerEnrolled: false });
    const b = await setup(['a long sentence', 'one', 'two']);
    say(b.audio, 2000);
    say(b.audio, 2000, 0.2, 100); // gated 2 s ⇒ long enough to verify alone: it failed, so it breaks the stretch
    await b.client.idle();
    expect(turns(b.link)[1]).toMatchObject({ speakerEnrolled: false });
  });

  it('a short clip that is the send word but not adjacent is unverified, never continuity', async () => {
    const audio = new FakeAudioIO();
    const link = new FakeLink();
    const engines = { ...stubEngines(['a long sentence', 'over and out']), speaker: new GatedStubSpeaker() };
    const client = new VoiceClient({ audio, engines, link, ns: 'abcd1234', prints: () => [MATT], mode: 'ptt', delivery: 'composer', now: () => audio.clock, sendWord: () => ({ text: 'over and out', variants: [] }) });
    clients.push(client);
    await client.start();
    link.turnVerdict = { refused: 'voice-off' }; // the anchor is refused: no draft speaker, so no adjacency either
    say(audio, 2000);
    await client.idle();
    link.turnVerdict = undefined;
    say(audio, 600, 0.2);
    await client.idle();
    expect(turns(link)[1]).not.toHaveProperty('speakerBasis');
    expect(turns(link)[1]).toMatchObject({ speakerEnrolled: false });
  });

  it('Talk (narrow): a short unverifiable push-to-talk clip sends its words for the draft; a long one stays withheld', async () => {
    const { audio, link, client } = await setup(['yes', 'a long unknown sentence']);
    link.att = { ...link.att!, send: 'key' };
    await client.refresh();
    link.turnVerdict = { draftOnly: true };
    say(audio, 600, 0.2);
    await client.idle();
    expect(turns(link)[0]).toMatchObject({ speakerEnrolled: false, text: 'yes' });
    link.turnVerdict = undefined;
    say(audio, 2000, 0.2);
    await client.idle();
    expect(turns(link)[1]).toMatchObject({ speakerEnrolled: false, text: '', textWithheld: true });
  });
});

describe('Aegis L-2 (client): the level is relayed only while the GUI meter is open', () => {
  it('no level in status.voice.mic until status.voice.micMeterOpen', async () => {
    const { audio, link, client } = await setup([]);
    audio.emitLevel(-20);
    audio.tick(300);
    audio.emitLevel(-10);
    await new Promise((r) => setImmediate(r));
    expect(link.mic.some((m) => 'level' in (m as object))).toBe(false);
    link.meterOpen = true;
    audio.tick(300);
    audio.emitLevel(-30);
    await new Promise((r) => setImmediate(r));
    expect(link.mic.at(-1)).toHaveProperty('level');
    void client;
  });
});

describe('mic fault (field bug 2026-10-23)', () => {
  it('engine failed: capture stops, the human is told in plain words, status.voice.mic carries the fault until the mic is on again', async () => {
    const { audio, link, client, notices } = await setup(['hello']);
    expect(link.mic.at(-1)).toMatchObject({ fault: null });
    audio.emitFault('restart-loop');
    await client.idle();
    await new Promise((r) => setImmediate(r));
    expect(link.mic.at(-1)).toMatchObject({ fault: { code: 'restart-loop', text: micFaultText('restart-loop') } });
    expect(notices).toContain(micFaultText('restart-loop'));
    expect(micFaultText('restart-loop')).not.toMatch(/restart-loop|#|G-VOX/);
    // no frames reach the VAD while the mic is off
    say(audio, 600);
    await client.idle();
    expect(turns(link)).toHaveLength(0);
    // the human turns the mic on again: the fault clears
    await client.setMicWanted(true);
    expect(link.mic.at(-1)).toMatchObject({ fault: null });
  });

  it('every fault code reads as plain words', () => {
    for (const code of ['restart-loop', 'no-input', 'engine-start', 'converter', 'something-new']) expect(micFaultText(code)).toMatch(/^[A-Za-z][^#]*\.$/);
  });
});

describe('input selection (founder request 2026-10-23)', () => {
  const BUILTIN = { id: 'BuiltInMicrophoneDevice', name: 'MacBook Pro Microphone', transport: 'built-in', sampleRate: 48000 };
  const AIRPODS = { id: '30-7A:input', name: 'AirPods Pro', transport: 'bluetooth', sampleRate: 24000 };
  it('the kernel-held choice is applied once per change; the mic report names the input in use, the inputs and a missing choice', async () => {
    const { audio, link, client } = await setup([]);
    audio.emitInputs({ inputs: [BUILTIN, AIRPODS], selected: null, current: AIRPODS, missing: false });
    await new Promise((r) => setImmediate(r));
    expect(link.mic.at(-1)).toMatchObject({ device: { name: 'AirPods Pro', transport: 'bluetooth', sampleRate: 24000 }, selected: null, missing: false, inputs: [{ id: BUILTIN.id }, { id: AIRPODS.id }] });
    link.inputChoiceVal = { id: BUILTIN.id };
    await client.refresh();
    await client.refresh();
    expect(audio.inputOps).toEqual([BUILTIN.id]);
    await new Promise((r) => setImmediate(r));
    expect(link.mic.at(-1)).toMatchObject({ device: { name: 'MacBook Pro Microphone' }, selected: BUILTIN.id, missing: false });
    // a chosen device that is not connected: still applied (used when it returns), reported missing
    link.inputChoiceVal = { id: 'usb-mic' };
    await client.refresh();
    await new Promise((r) => setImmediate(r));
    expect(audio.inputOps).toEqual([BUILTIN.id, 'usb-mic']);
    expect(link.mic.at(-1)).toMatchObject({ selected: 'usb-mic', missing: true });
  });

  it('switching the input breaks a speaker stretch (another device is another channel)', async () => {
    const { audio, link, client } = await setup(['a long sentence', 'yes']);
    audio.emitInputs({ inputs: [BUILTIN, AIRPODS], selected: null, current: AIRPODS, missing: false });
    say(audio, 2000);
    await client.idle();
    audio.emitInputs({ inputs: [BUILTIN, AIRPODS], selected: null, current: BUILTIN, missing: false });
    say(audio, 600, 0.2);
    await client.idle();
    expect(turns(link)[1]).toMatchObject({ speakerEnrolled: false });
  });
});

describe('Aegis L-3 (client): free-text log fields are cut before they reach the persisted voice log', () => {
  it('a long error field is cut to LOG_FIELD_MAX; short fields and numbers pass', async () => {
    const { logFields, LOG_FIELD_MAX } = await import('../src/cli.js');
    const j = JSON.parse(logFields({ error: 'x'.repeat(1000), code: 'ok', n: 5 })) as Record<string, unknown>;
    expect((j.error as string).length).toBe(LOG_FIELD_MAX);
    expect(j).toMatchObject({ code: 'ok', n: 5 });
  });
});
