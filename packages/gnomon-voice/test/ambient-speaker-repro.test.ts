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
import { readPrints } from '../src/speaker.js';
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

describe.skipIf(!available)('ambient speaker identification, real engines (founder regression 2026-10-20)', () => {
  let tmp: string;
  let engines: VoiceEngines;
  /** the enrolled voice (Kokoro model voice) saying fresh sentences, and a stranger (the Parakeet test wav) */
  const enrolled: Float32Array[] = [];
  let stranger: Float32Array;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-voice-repro-'));
    engines = (await createSherpaEngines(home)) as VoiceEngines;
    for (const t of ['Please run the whole test suite for me now.', 'Show me what changed in the last commit.', 'I would like to understand the plan first.', 'Open the voice client file and read it to me.'])
      enrolled.push(to16k(await engines.tts.synthesize(t)));
    const w = decodeWav(fs.readFileSync(path.join(verifiedModelPaths(home, modelFor(loadManifest(), 'stt')).tokens!, '..', 'test_wavs', '0.wav')));
    expect(w.sampleRate).toBe(16_000);
    stranger = w.samples;
    // enrol through the REAL path (VAD segments → CAM++ → mean print) into the temp home
    const audio = new FakeAudioIO();
    await recordEnrolment({
      audio, vad: engines.vad, speaker: engines.speaker, model: 'campplus-sv-en-voxceleb-16k', home: tmp, name: 'matt', timeoutMs: 5_000,
      prompt: (_p, i) => {
        // the phrase is "spoken" right after the prompt (the recording is already listening)
        setImmediate(() => {
          audio.silence(300);
          audio.capture(enrolled[i - 1]!);
          audio.silence(800);
        });
      },
    });
    expect(readPrints(tmp).map((p) => p.name)).toEqual(['matt']);
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
      audio.capture(enrolled[3]!);
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
      audio.capture(enrolled[3]!);
      audio.silence(1_200);
      await client.idle();
      const ts = turns(link);
      expect(ts).toHaveLength(1);
      expect(Math.abs((ts[0]!.t0 as number) - t0)).toBeLessThan(1_000);
    } finally {
      await client.close();
    }
  }, 120_000);

  it('a different speaker is NOT accepted against the print (no forwarded text)', async () => {
    const { audio, link, client } = await ambient();
    try {
      audio.silence(500);
      audio.capture(stranger);
      audio.silence(1_200);
      await client.idle();
      const ts = turns(link);
      expect(ts.length).toBeGreaterThan(0);
      for (const t of ts) expect(t).toMatchObject({ speakerEnrolled: false, text: '' });
    } finally {
      await client.close();
    }
  }, 120_000);
});
