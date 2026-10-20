/**
 * @symbol #gnomon-voice
 *
 * The SYSTEM EARCON (table talk S4, TD-2026-10-20-294): a short generated two-note tone (no audio file) played
 * right before the system voice says the kernel's own words (a question waiting, "Edited N files", errors), so the
 * human can always tell the system from the model. Model text never gets it.
 */

/** Seconds of tone, then of silence before the words. */
const NOTE_S = 0.07;
const GAP_S = 0.12;
const NOTES_HZ = [880, 1320];
const GAIN = 0.18;

/** The earcon at a sample rate: two short sine notes with a smooth envelope, then a short silence. */
export function earcon(sampleRate: number): Float32Array {
  const note = Math.round(NOTE_S * sampleRate);
  const gap = Math.round(GAP_S * sampleRate);
  const out = new Float32Array(note * NOTES_HZ.length + gap);
  NOTES_HZ.forEach((hz, n) => {
    for (let i = 0; i < note; i++) {
      const env = Math.sin((Math.PI * i) / note); // no clicks at either end
      out[n * note + i] = GAIN * env * Math.sin((2 * Math.PI * hz * i) / sampleRate);
    }
  });
  return out;
}

/** The earcon prepended to synthesized speech when `on`; the audio unchanged otherwise. */
export function withEarcon(a: { samples: Float32Array; sampleRate: number }, on: boolean): { samples: Float32Array; sampleRate: number } {
  if (!on) return a;
  const e = earcon(a.sampleRate);
  const samples = new Float32Array(e.length + a.samples.length);
  samples.set(e, 0);
  samples.set(a.samples, e.length);
  return { samples, sampleRate: a.sampleRate };
}
