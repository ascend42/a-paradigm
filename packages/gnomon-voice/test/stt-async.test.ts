/**
 * T-2026-10-20-005 B1 item 1: SherpaStt decodes with OfflineRecognizer.decodeAsync (the addon's worker thread), so a
 * final transcription never blocks the voice client's event loop. A fake sherpa module stands in for the addon.
 */
import { describe, expect, it } from 'vitest';
import { SherpaStt } from '../src/engines/sherpa.js';

const PATHS = { encoder: 'e', decoder: 'd', joiner: 'j', tokens: 't' };

function fakeSherpa(o: { async: boolean; ms?: number; text?: string }) {
  const calls = { sync: 0, async: 0, inFlight: 0, maxInFlight: 0 };
  class OfflineRecognizer {
    createStream() {
      return { acceptWaveform: () => undefined };
    }
    decode() {
      calls.sync++;
      const until = Date.now() + (o.ms ?? 0);
      while (Date.now() < until) {
        /* a sync decode holds the loop */
      }
    }
    getResult() {
      return { text: o.text ?? 'sync text' };
    }
  }
  if (o.async) {
    (OfflineRecognizer.prototype as unknown as { decodeAsync: () => Promise<unknown> }).decodeAsync = async () => {
      calls.async++;
      calls.inFlight++;
      calls.maxInFlight = Math.max(calls.maxInFlight, calls.inFlight);
      await new Promise((r) => setTimeout(r, o.ms ?? 0));
      calls.inFlight--;
      return { text: o.text ?? 'async text' };
    };
  }
  return { sherpa: { OfflineRecognizer }, calls };
}

describe('SherpaStt (decodeAsync)', () => {
  it('uses decodeAsync when the addon has it, never the sync decode', async () => {
    const { sherpa, calls } = fakeSherpa({ async: true, text: 'run the tests' });
    const stt = new SherpaStt(sherpa, PATHS);
    expect(await stt.transcribe(new Float32Array(160), 16_000)).toBe('run the tests');
    expect(calls).toMatchObject({ async: 1, sync: 0 });
  });

  it('keeps the event loop free during a decode (a timer fires while it runs)', async () => {
    const { sherpa } = fakeSherpa({ async: true, ms: 120 });
    const stt = new SherpaStt(sherpa, PATHS);
    let ticks = 0;
    const iv = setInterval(() => ticks++, 10);
    await stt.transcribe(new Float32Array(160), 16_000);
    clearInterval(iv);
    expect(ticks).toBeGreaterThanOrEqual(5);
  });

  it('serializes decodes on the one recognizer handle', async () => {
    const { sherpa, calls } = fakeSherpa({ async: true, ms: 20 });
    const stt = new SherpaStt(sherpa, PATHS);
    await Promise.all([stt.transcribe(new Float32Array(1), 16_000), stt.transcribe(new Float32Array(1), 16_000), stt.transcribe(new Float32Array(1), 16_000)]);
    expect(calls.async).toBe(3);
    expect(calls.maxInFlight).toBe(1);
  });

  it('falls back to the sync decode only for an addon without decodeAsync', async () => {
    const { sherpa, calls } = fakeSherpa({ async: false, text: 'old addon' });
    const stt = new SherpaStt(sherpa, PATHS);
    expect(await stt.transcribe(new Float32Array(1), 16_000)).toBe('old addon');
    expect(calls.sync).toBe(1);
  });
});
