// @gnomon-platform: darwin
/**
 * Regression (founder report 2026-10-20, build 3b5c7139): in AMBIENT the enrolled speaker was dropped as "not
 * enrolled", turns arrived ~60 s late, and a stranger (a video) was accepted after a re-enrol. This runs the REAL
 * VoiceClient pipeline (FakeAudioIO, the real Silero / Parakeet / CAM++ engines) against a print enrolled through
 * the real recordEnrolment path into a TEMP home. Models are read-only from $GNOMON_HOME (or ~/.gnomon); skipped
 * when the models or sherpa-onnx-node are absent (CI, fresh checkouts). Never downloads; never writes audio.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadManifest, modelFor, verifiedModelPaths } from '../src/manifest.js';
import { createSherpaEngines, loadSherpa } from '../src/engines/sherpa.js';
import { decodeWav, FakeAudioIO } from '../src/fake-audio-io.js';
import { recordEnrolment } from '../src/enrol.js';
import { readPrints, SPEAKER_FRONT_END } from '../src/speaker.js';
import { VoiceClient } from '../src/voice-client.js';
import type { VoiceEngines } from '../src/types.js';
import { FakeLink, StubTts } from './stubs.js';

const home = process.env.GNOMON_HOME && path.isAbsolute(process.env.GNOMON_HOME) ? process.env.GNOMON_HOME : path.join(os.homedir(), '.gnomon');

async function ready(): Promise<boolean> {
  try {
    const m = loadManifest();
    for (const e of m.models) verifiedModelPaths(home, e);
    await loadSherpa();
    return true;
  } catch {
    return false;
  }
}
const available = await ready();

/** 24 kHz Kokoro → 16 kHz (a 3-tap low-pass, then nearest sample), in memory */
function to16k(a: { samples: Float32Array; sampleRate: number }): Float32Array {
  if (a.sampleRate === 16_000) return a.samples;
  const r = a.sampleRate / 16_000;
  const out = new Float32Array(Math.floor(a.samples.length / r));
  for (let i = 0; i < out.length; i++) {
    const j = Math.floor(i * r);
    out[i] = ((a.samples[j - 1] ?? 0) + 2 * a.samples[j]! + (a.samples[j + 1] ?? 0)) / 4;
  }
  return out;
}

/** low-level noise at `dbfs` (VPIO's suppressed pauses, a quiet room): the quiet a stranger's segment carries */
function quiet(ms: number, dbfs: number): Float32Array {
  const a = Math.pow(10, dbfs / 20) * Math.sqrt(3);
  let seed = 7;
  const out = new Float32Array((16 * ms) | 0);
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    out[i] = (seed / 2147483648 - 0.5) * 2 * a;
  }
  return out;
}
const cat = (...xs: Float32Array[]): Float32Array => {
  const out = new Float32Array(xs.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of xs) {
    out.set(x, o);
    o += x.length;
  }
  return out;
};

describe.skipIf(!available)('ambient speaker identification, real engines (founder regression 2026-10-20)', () => {
  let tmp: string;
  let engines: VoiceEngines;
  /**
   * The enrolled voice is a HUMAN recording (the Parakeet archive's test_wavs/0.wav, the only human speech the model
   * archives ship): its two VAD segments are the enrolment phrases. 7 s is all there is, so no held-out segment of
   * this speaker is long enough to verify at the threshold (0.33–0.49 measured): the "enrolled" case replays the first
   * segment inside different surrounding quiet and after a long warm-up (the pipeline, the gate's padding invariance
   * and t0, not the model's accuracy; the calibration lives outside the repo). The strangers are Kokoro voices (not human, but certainly not
   * this speaker), with and without the quiet a recording carries.
   */
  let human: Float32Array[] = [];
  const strangers: Float32Array[] = [];

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-voice-repro-'));
    engines = (await createSherpaEngines(home)) as VoiceEngines;
    const w = decodeWav(fs.readFileSync(path.join(verifiedModelPaths(home, modelFor(loadManifest(), 'stt')).tokens!, '..', 'test_wavs', '0.wav')));
    expect(w.sampleRate).toBe(16_000);
    engines.vad.reset();
    const segs: Float32Array[] = [];
    for (const c of [new Float32Array(8000), w.samples, new Float32Array(16000)]) for (let i = 0; i < c.length; i += 512) segs.push(...engines.vad.accept({ samples: c.subarray(i, i + 512), sampleRate: 16_000, t0: 0 }).map((s) => s.samples));
    segs.push(...engines.vad.flush().map((s) => s.samples));
    expect(segs.length).toBe(2);
    human = segs;
    // both segments are the enrolment phrases (measured 2026-10-20: splitting the first in half for three phrases
    // gave a print the first segment's own replay scored only 0.60 against, under the 0.65 threshold: 7 s of speech is
    // too little for a stable print, and this test pins the pipeline, not the model's accuracy)
    const phrases = [segs[0]!, segs[1]!];
    for (const t of ['Please run the whole test suite for me now.', 'Open the voice client file and read it to me.']) strangers.push(to16k(await engines.tts.synthesize(t)));
    // enrol through the REAL path (VAD segments → speech gate → CAM++ → mean print) into the temp home
    const audio = new FakeAudioIO();
    await recordEnrolment({
      audio, vad: engines.vad, speaker: engines.speaker, model: 'campplus-sv-en-voxceleb-16k', home: tmp, name: 'matt', timeoutMs: 5_000, phrases: ['one', 'two'],
      prompt: (_p, i) => {
        // the phrase is "spoken" right after the prompt (the recording is already listening)
        setImmediate(() => {
          audio.silence(300);
          audio.capture(phrases[i - 1]!);
          audio.silence(800);
        });
      },
    });
    expect(readPrints(tmp).map((p) => [p.name, p.frontEnd])).toEqual([['matt', SPEAKER_FRONT_END]]);
  }, 180_000);

  afterAll(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  async function ambient() {
    const audio = new FakeAudioIO();
    const link = new FakeLink();
    link.att = { ...link.att!, mode: 'conversation' };
    engines.vad.reset();
    const client = new VoiceClient({ audio, engines: { ...engines, tts: new StubTts() }, link, ns: 'abcd1234', prints: () => readPrints(tmp), mode: 'ambient', delivery: 'composer', now: () => audio.clock });
    await client.start();
    return { audio, link, client };
  }
  const turns = (link: FakeLink) => link.appends.filter((a) => a.kind === 'voice.turn.user').map((a) => a.payload);

  it('the enrolled voice in AMBIENT is identified as enrolled, with words, promptly, and with its own t0', async () => {
    const { audio, link, client } = await ambient();
    try {
      // a long warm-up of room audio first: the founder's client had been running for minutes
      audio.silence(20_000);
      const t0 = audio.clock;
      audio.capture(cat(quiet(400, -65), human[0]!, quiet(600, -65)));
      audio.silence(1_200);
      const wall = Date.now();
      await client.idle();
      expect(Date.now() - wall).toBeLessThan(15_000);
      const ts = turns(link);
      expect(ts).toHaveLength(1);
      expect(ts[0]).toMatchObject({ speakerEnrolled: true, speakerId: 'spk:abcd1234/matt' });
      expect(String(ts[0]!.text).length).toBeGreaterThan(0);
      // the segment's t0 is when the speech was heard (not shifted by the audio fed earlier)
      expect(Math.abs((ts[0]!.t0 as number) - t0)).toBeLessThan(1_000);
    } finally {
      await client.close();
    }
  }, 120_000);

  it('a VAD reset (a pause, a barge-in) does not shift later segments into the past', async () => {
    const { audio, link, client } = await ambient();
    try {
      audio.silence(30_000);
      client.pause(true); // an enrolment recording: resets the VAD
      client.pause(false);
      audio.silence(500);
      const t0 = audio.clock;
      audio.capture(human[0]!);
      audio.silence(1_200);
      await client.idle();
      const ts = turns(link);
      expect(ts).toHaveLength(1);
      expect(Math.abs((ts[0]!.t0 as number) - t0)).toBeLessThan(1_000);
    } finally {
      await client.close();
    }
  }, 120_000);

  it('a different speaker is NOT accepted, plain or carrying a recording\'s quiet (the "video accepted" case)', async () => {
    const { audio, link, client } = await ambient();
    try {
      for (const x of strangers) {
        audio.silence(500);
        audio.capture(x);
        audio.silence(1_200);
        audio.capture(cat(quiet(700, -65), x, quiet(900, -60)));
        audio.silence(1_200);
      }
      await client.idle();
      const ts = turns(link);
      expect(ts.length).toBeGreaterThanOrEqual(strangers.length);
      for (const t of ts) expect(t).toMatchObject({ speakerEnrolled: false, text: '' });
    } finally {
      await client.close();
    }
  }, 120_000);
});
