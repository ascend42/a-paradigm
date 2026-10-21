/**
 * @symbol #gnomon-voice
 *
 * `gnomon-voice enrol <name>` (spec §14.4; V2c): record ENROL_PHRASES phrases through AudioIO (VAD segments),
 * embed each with the speaker engine, average, and store the print (speaker.ts). The audio of each phrase lives
 * in memory only for the embedding call (G-VOX-05). The print alone enrols NOBODY: the kernel forwards a speaker
 * only after the ROOT-SIGNED enrolment row, which is the separate human step
 * `gnomon voice enrol <name> --consent "<text>"` (V1, Touch ID) — the CLI prints it as the next step.
 */
import { meanEmbedding, MIN_ENROL_SPEECH_MS, PRINT_SCHEMA, writePrint, type VoicePrint } from './speaker.js';
import type { AudioIO, SpeakerEngine, VadEngine, VadSegment } from './types.js';

/**
 * The three enrolment phrases (short, varied; none sounds like a decision, which voice never makes). SHARED with the
 * GUI's enrol dialog (packages/gnomon-gui/src/core/voice-client.ts ENROL_PHRASES; the kernel's report carries no
 * phrase text) — test/enrol-watch.test.ts pins the two lists equal.
 */
export const ENROL_PHRASES: readonly string[] = Object.freeze([
  'The quick brown fox jumps over the lazy dog.',
  'Please run the tests and tell me what failed.',
  'I enrol my voice on this computer, and it stays here.',
]);
const MIN_PHRASE_MS = 1200;

export interface EnrolOptions {
  audio: AudioIO;
  vad: VadEngine;
  speaker: SpeakerEngine;
  model: string;
  home: string;
  name: string;
  phrases?: readonly string[];
  /** shows the phrase to read; resolves when the human is ready */
  prompt: (phrase: string, i: number, n: number) => Promise<void> | void;
  /** called after phrase i (1-based) of n was captured and embedded */
  recorded?: (i: number, n: number) => Promise<void> | void;
  /** per-phrase timeout (ms) */
  timeoutMs?: number;
}

/**
 * Capture one VAD segment of at least MIN_PHRASE_MS, and (an engine with a speech gate) at least MIN_ENROL_SPEECH_MS of
 * gated speech: a mostly-quiet phrase would make a print that matches any quiet-heavy segment (founder regression
 * 2026-10-20), so it is skipped and the recorder keeps listening.
 */
function nextSegment(audio: AudioIO, vad: VadEngine, speaker: SpeakerEngine, timeoutMs: number): Promise<VadSegment> {
  vad.reset();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => (off(), reject(new Error('no speech heard; try again closer to the mic'))), timeoutMs);
    const off = audio.on('frame', (f) => {
      for (const s of vad.accept(f)) {
        if (s.t1 - s.t0 < MIN_PHRASE_MS) continue;
        if (speaker.speechMs && speaker.speechMs(s.samples, s.sampleRate) < MIN_ENROL_SPEECH_MS) continue;
        clearTimeout(t);
        off();
        resolve(s);
        return;
      }
    });
  });
}

export async function recordEnrolment(o: EnrolOptions): Promise<{ file: string; print: VoicePrint }> {
  const phrases = o.phrases ?? ENROL_PHRASES;
  const es: Float32Array[] = [];
  for (let i = 0; i < phrases.length; i++) {
    const seg = nextSegment(o.audio, o.vad, o.speaker, o.timeoutMs ?? 30_000);
    await o.prompt(phrases[i]!, i + 1, phrases.length);
    const s = await seg;
    es.push(await o.speaker.embed(s.samples, s.sampleRate));
    await o.recorded?.(i + 1, phrases.length);
  }
  const mean = meanEmbedding(es);
  const print: VoicePrint = { schemaVersion: PRINT_SCHEMA, name: o.name, model: o.model, dim: mean.length, phrases: es.length, embedding: Array.from(mean), createdAt: new Date().toISOString(), ...(o.speaker.frontEnd ? { frontEnd: o.speaker.frontEnd } : {}) };
  return { file: writePrint(o.home, print), print };
}
