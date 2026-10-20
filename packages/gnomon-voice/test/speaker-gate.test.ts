/**
 * Founder regression 2026-10-20 (ambient: the enrolled founder rejected, a nearby video accepted). Unit tests, no
 * models: the speech gate (speechOnly) makes the embedding independent of surrounding quiet; prints from another
 * front end are never compared and are reported as stale (the GUI's "Re-teach Gnomon your voice"); too little gated
 * speech never verifies (fail closed); a final STT decode never queues behind a live-words partial.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { SherpaStt } from '../src/engines/sherpa.js';
import { FakeAudioIO } from '../src/fake-audio-io.js';
import {
  GATE_FRAME_MS,
  MIN_VERIFY_SPEECH_MS,
  PRINT_SCHEMA,
  SPEAKER_FRONT_END,
  SpeakerVerifier,
  speechMsOf,
  speechOnly,
  staleNames,
  VERIFY_THRESHOLD,
  type VoicePrint,
} from '../src/speaker.js';
import type { SpeakerEngine } from '../src/types.js';
import { STALE_DROP_NOTICE, STALE_PRINT_NOTICE, VoiceClient, type Notice } from '../src/voice-client.js';
import { FakeLink, SR, stubEngines, tone, toneWav } from './stubs.js';

const F = (SR * GATE_FRAME_MS) / 1000;
const cat = (...xs: Float32Array[]): Float32Array => {
  const out = new Float32Array(xs.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of xs) {
    out.set(x, o);
    o += x.length;
  }
  return out;
};
const zeros = (ms: number): Float32Array => new Float32Array((SR * ms) / 1000);

/**
 * A CAM++-like fake: its "embedding" is the input's statistics over the WHOLE input (rms, quiet-sample share), so
 * quiet padding moves it, as feature normalisation moves CAM++'s. `gated` runs the real speech gate first.
 */
class StatsEngine implements SpeakerEngine {
  readonly dim = 2;
  constructor(readonly gated: boolean) {}
  get frontEnd(): string | undefined {
    return this.gated ? SPEAKER_FRONT_END : undefined;
  }
  speechMs(s: Float32Array, sr: number): number {
    return speechMsOf(s, sr);
  }
  async embed(samples: Float32Array, sr: number): Promise<Float32Array> {
    const x = this.gated ? speechOnly(samples, sr) : samples;
    let e = 0;
    let quiet = 0;
    for (const v of x) {
      e += v * v;
      if (Math.abs(v) < 1e-3) quiet++;
    }
    return Float32Array.from([Math.sqrt(e / Math.max(1, x.length)), quiet / Math.max(1, x.length)]);
  }
}

const print = (name: string, embedding: number[], frontEnd?: string): VoicePrint => ({ schemaVersion: PRINT_SCHEMA, name, model: 'stub', dim: embedding.length, phrases: 3, embedding, createdAt: '2026-10-20T00:00:00Z', ...(frontEnd ? { frontEnd } : {}) });

describe('speechOnly: the speaker front end ignores surrounding quiet', () => {
  const speech = cat(tone(600, 0.3), tone(60, 0.003), tone(600, 0.3)); // a 60 ms dip (a consonant) inside speech

  it('the same embedding with and without zero padding (and the ungated one moves)', async () => {
    const padded = cat(zeros(500), speech, zeros(700));
    expect(Array.from(speechOnly(padded, SR))).toEqual(Array.from(speechOnly(speech, SR)));
    const g = new StatsEngine(true);
    expect(Array.from(await g.embed(padded, SR))).toEqual(Array.from(await g.embed(speech, SR)));
    const raw = new StatsEngine(false);
    const [a, b] = [await raw.embed(speech, SR), await raw.embed(padded, SR)];
    expect(Math.abs(a[1]! - b[1]!)).toBeGreaterThan(0.3); // the ungated statistics are dominated by the quiet
  });

  it('cuts an inner pause (≥ 200 ms) but for one frame each side; keeps a short dip', () => {
    const paused = cat(tone(600, 0.3), zeros(400), tone(600, 0.3));
    expect(speechOnly(paused, SR).length).toBe(2 * ((SR * 0.6) / F) * F + 2 * F);
    expect(speechOnly(speech, SR).length).toBe(speech.length); // the 60 ms dip stays: speech stays continuous
    expect(speechOnly(zeros(500), SR).length).toBe(0);
    expect(speechOnly(new Float32Array(10), SR).length).toBe(0);
  });
});

describe('SpeakerVerifier: front end, speech minimum, stale prints', () => {
  it('compares only prints from the same front end; an old print is stale (unless a fresh one exists)', async () => {
    const e = new StatsEngine(true);
    const emb = Array.from(await e.embed(tone(2000, 0.3), SR));
    const old = print('matt', emb); // made before the speech gate (no frontEnd)
    let prints: VoicePrint[] = [old];
    const v = new SpeakerVerifier(e, () => prints);
    expect((await v.identify(tone(2000, 0.3), SR)).name).toBeUndefined(); // the old print is never compared
    expect(v.stalePrints()).toEqual(['matt']);
    prints = [old, print('matt', emb, SPEAKER_FRONT_END)];
    expect(v.stalePrints()).toEqual([]);
    expect(await v.identify(tone(2000, 0.3), SR)).toMatchObject({ name: 'matt' });
    // an engine without a front end (stubs) compares every print and reports none stale
    expect(staleNames([old, print('dana', emb, 'other:v9')], undefined)).toEqual([]);
    expect(staleNames([old, print('dana', emb, 'other:v9'), print('dana', emb, 'other:v9')], SPEAKER_FRONT_END)).toEqual(['dana', 'matt']);
  });

  it(`fails closed below ${MIN_VERIFY_SPEECH_MS} ms of gated speech, whatever the padding`, async () => {
    const e = new StatsEngine(true);
    const emb = Array.from(await e.embed(tone(2000, 0.3), SR));
    const v = new SpeakerVerifier(e, () => [print('matt', emb, SPEAKER_FRONT_END)]);
    const short = cat(zeros(1500), tone(MIN_VERIFY_SPEECH_MS - 100, 0.3), zeros(1500)); // a long segment, little speech
    const r = await v.identify(short, SR);
    expect(r.name).toBeUndefined();
    expect(r.score).toBeGreaterThanOrEqual(VERIFY_THRESHOLD); // it WOULD have matched: the minimum is what refuses it
    expect((await v.identify(tone(MIN_VERIFY_SPEECH_MS + 100, 0.3), SR)).name).toBe('matt');
  });
});

describe('VoiceClient: a stale print reaches status.voice.prints and ONE notice', () => {
  let client: VoiceClient | undefined;
  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it('reports the stale names at start, notices once, and reports again when a fresh print replaces it', async () => {
    const audio = new FakeAudioIO();
    const link = new FakeLink();
    const notices: Notice[] = [];
    const e = new StatsEngine(true);
    const emb = Array.from(await e.embed(tone(2000, 0.3), SR));
    let prints: VoicePrint[] = [print('matt', emb)];
    client = new VoiceClient({ audio, engines: { ...stubEngines(), speaker: e }, link, ns: 'abcd1234', prints: () => prints, mode: 'ptt', delivery: 'composer', now: () => audio.clock, notice: (n) => notices.push(n) });
    await client.start();
    expect(link.prints).toEqual([{ stale: ['matt'] }]);
    expect(notices.filter((n) => n.text === STALE_PRINT_NOTICE)).toHaveLength(1);
    expect(link.appends.filter((a) => (a.payload.notice as { code?: string } | undefined)?.code === 'voice.print-stale')).toHaveLength(1);
    client.pause(true);
    client.pause(false); // an enrolment ended, no change yet: nothing new reported
    await new Promise((r) => setImmediate(r));
    expect(link.prints).toHaveLength(1);
    prints = [print('matt', emb, SPEAKER_FRONT_END)];
    client.pause(true);
    client.pause(false);
    await new Promise((r) => setImmediate(r));
    expect(link.prints).toEqual([{ stale: ['matt'] }, { stale: [] }]);
    expect(notices.filter((n) => n.text === STALE_PRINT_NOTICE)).toHaveLength(1); // ONE notice per run
  });

  it('after identify: a turn from a speaker whose print is stale is dropped with the distinct notice; a changed list is re-reported', async () => {
    const audio = new FakeAudioIO();
    const link = new FakeLink();
    const notices: Notice[] = [];
    const e = new StatsEngine(true);
    const emb = Array.from(await e.embed(tone(2000, 0.3), SR));
    let prints: VoicePrint[] = [print('matt', emb)];
    client = new VoiceClient({ audio, engines: { ...stubEngines(['hello there', 'and again']), speaker: e }, link, ns: 'abcd1234', prints: () => prints, mode: 'ptt', delivery: 'composer', now: () => audio.clock, notice: (n) => notices.push(n) });
    await client.start();
    audio.silence(100);
    audio.hotkey(true);
    audio.captureWav(toneWav(2000, 0.3));
    audio.hotkey(false);
    await client.idle();
    expect(link.appends.filter((a) => a.kind === 'voice.turn.user').map((a) => a.payload.speakerEnrolled)).toEqual([false]);
    expect(notices.some((n) => n.text === STALE_DROP_NOTICE)).toBe(true);
    expect(notices.some((n) => /not enrolled/.test(n.text))).toBe(false);
    expect(link.prints).toEqual([{ stale: ['matt'] }]); // unchanged: not re-sent
    // the print is replaced (another enrolment path) without a pause: the next identify re-reads and reports the change
    prints = [print('matt', emb, SPEAKER_FRONT_END)];
    audio.silence(100);
    audio.hotkey(true);
    audio.captureWav(toneWav(2000, 0.3));
    audio.hotkey(false);
    await client.idle();
    expect(link.appends.filter((a) => a.kind === 'voice.turn.user').map((a) => a.payload.speakerEnrolled)).toEqual([false, true]);
    expect(link.prints).toEqual([{ stale: ['matt'] }, { stale: [] }]);
  });

  it('an engine without a front end (no stale notion) reports an empty list once and never notices', async () => {
    const audio = new FakeAudioIO();
    const link = new FakeLink();
    const notices: Notice[] = [];
    client = new VoiceClient({ audio, engines: stubEngines(), link, ns: 'abcd1234', prints: () => [print('matt', [1, 0])], mode: 'ptt', delivery: 'composer', now: () => audio.clock, notice: (n) => notices.push(n) });
    await client.start();
    expect(link.prints).toEqual([{ stale: [] }]);
    expect(notices.some((n) => n.text === STALE_PRINT_NOTICE)).toBe(false);
  });
});

describe('SherpaStt decode priority: finals never queue behind partials', () => {
  function fake() {
    const calls: string[] = [];
    class OfflineRecognizer {
      createStream() {
        let n = 0;
        return { acceptWaveform: (a: { samples: Float32Array }) => void (n = a.samples.length), get n() { return n; } };
      }
      async decodeAsync(s: { n: number }) {
        calls.push(s.n === 1 ? 'final' : 'partial');
        await new Promise((r) => setTimeout(r, 15));
        return { text: 'x', tokens: [], timestamps: [] };
      }
    }
    return { sherpa: { OfflineRecognizer }, calls };
  }
  const P = new Float32Array(2);
  const FIN = new Float32Array(1);

  it('a partial not yet started while a final waits returns [] undecoded; otherwise it decodes', async () => {
    const { sherpa, calls } = fake();
    const stt = new SherpaStt(sherpa, { encoder: 'e', decoder: 'd', joiner: 'j', tokens: 't' });
    const first = stt.transcribe(FIN, SR); // in flight
    const skipped = stt.transcribeWords(P, SR); // queued behind it
    const final2 = stt.transcribe(FIN, SR); // a final waiting: the queued partial is skipped
    expect(await skipped).toEqual([]);
    await Promise.all([first, final2]);
    expect(calls).toEqual(['final', 'final']);
    await stt.transcribeWords(P, SR); // nothing waiting: decoded
    expect(calls).toEqual(['final', 'final', 'partial']);
  });
});
