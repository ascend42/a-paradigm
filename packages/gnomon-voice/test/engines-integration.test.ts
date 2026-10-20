// @gnomon-platform: darwin
/**
 * OPTIONAL integration: the real sherpa-onnx engines, run only when sherpa-onnx-node is installed AND every model
 * in the manifest is fetched and verifies under $GNOMON_HOME (or ~/.gnomon). Skipped otherwise (CI, fresh
 * checkouts). Fetch first with `gnomon-voice models fetch`. Never downloads; never writes audio.
 */
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadManifest, verifiedModelPaths } from '../src/manifest.js';
import { createSherpaEngines, loadSherpa } from '../src/engines/sherpa.js';
import { cosine } from '../src/speaker.js';

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

describe.skipIf(!available)('real engines (models present)', () => {
  it('Kokoro speaks a sentence, Parakeet hears it back, CAM++ embeds it, Silero segments it', async () => {
    const e = await createSherpaEngines(home);
    const said = await e.tts!.synthesize('Run the tests please.');
    expect(said.samples.length).toBeGreaterThan(said.sampleRate / 2);
    // resample to 16 kHz (Kokoro is 24 kHz) by linear interpolation, in memory
    const ratio = said.sampleRate / 16_000;
    const pcm = new Float32Array(Math.floor(said.samples.length / ratio));
    for (let i = 0; i < pcm.length; i++) pcm[i] = said.samples[Math.floor(i * ratio)]!;
    const text = await e.stt!.transcribe(pcm, 16_000);
    expect(text.toLowerCase()).toContain('test');
    const a = await e.speaker!.embed(pcm, 16_000);
    const b = await e.speaker!.embed(pcm.subarray(0, Math.floor(pcm.length * 0.8)), 16_000);
    expect(cosine(a, b)).toBeGreaterThan(0.5);
    const segs = [...e.vad!.accept({ samples: pcm, sampleRate: 16_000, t0: 0 }), ...e.vad!.accept({ samples: new Float32Array(16_000), sampleRate: 16_000, t0: 0 }), ...e.vad!.flush()];
    expect(segs.length).toBeGreaterThan(0);
  }, 120_000);
});
