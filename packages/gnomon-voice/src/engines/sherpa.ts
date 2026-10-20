/**
 * @symbol #gnomon-voice
 *
 * The real engines over sherpa-onnx-node 1.13.8 (an OPTIONAL native dependency, loaded by dynamic import only here):
 *   - Silero VAD          (silero_vad.onnx, 644 KB)
 *   - Parakeet TDT 0.6B v2 int8 offline transducer (482 MB archive), `modelType: 'nemo_transducer'`
 *   - Kokoro-82M int8 en v0.19 (103 MB archive), one sentence per generate()
 *   - 3D-Speaker CAM++ VoxCeleb English 16 kHz speaker embeddings (29.6 MB)
 * Every model path comes from manifest.verifiedModelPaths (re-hashed just before load). sherpa-onnx loads by path,
 * so bytes cannot be handed over directly; see manifest.ts for the residual window. Audio stays in memory.
 * API shapes are sherpa-onnx's documented Node API; UNVERIFIED here until the integration test runs with models.
 */
import { loadManifest, modelFor, verifiedModelPaths, type ModelManifest } from '../manifest.js';
import { wordsOfResult, type PartialWord } from '../partials.js';
import { SPEAKER_FRONT_END, speechMsOf, speechOnly } from '../speaker.js';
import { silentLogger, type ComponentLog } from '../types.js';
import type { PcmFrame, SpeakerEngine, SttEngine, TtsEngine, VadEngine, VadSegment, VoiceEngines } from '../types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sherpa = any;
/** the offline recognizer's result JSON (verified 2026-10-20: text, tokens with a leading space per word, timestamps in s) */
type SherpaResult = { text?: unknown; tokens?: unknown; timestamps?: unknown };

export const SHERPA_PACKAGE = 'sherpa-onnx-node';

export async function loadSherpa(): Promise<Sherpa> {
  const spec = SHERPA_PACKAGE; // a variable keeps typecheck independent of the optional dep
  try {
    const m = (await import(spec)) as { default?: Sherpa };
    return m.default ?? m;
  } catch (e) {
    throw new Error(`#gnomon-voice: ${SHERPA_PACKAGE} is not installed for ${process.platform}-${process.arch} (${e instanceof Error ? e.message : String(e)})`);
  }
}

const SR = 16_000;
const VAD_WINDOW = 512;

export class SherpaVad implements VadEngine {
  readonly sampleRate = SR;
  readonly #vad: Sherpa;
  #pending = new Float32Array(0);
  #fed = 0;
  #anchor = { fed: 0, t0: 0 };
  #speaking = false;

  constructor(sherpa: Sherpa, model: string) {
    this.#vad = new sherpa.Vad({ sileroVad: { model, threshold: 0.5, minSpeechDuration: 0.25, minSilenceDuration: 0.5, windowSize: VAD_WINDOW }, sampleRate: SR, debug: false, numThreads: 1 }, 60);
  }

  accept(f: PcmFrame): VadSegment[] {
    if (f.sampleRate !== SR) throw new RangeError('#gnomon-voice: the VAD takes 16 kHz frames');
    this.#anchor = { fed: this.#fed + this.#pending.length, t0: f.t0 };
    const buf = new Float32Array(this.#pending.length + f.samples.length);
    buf.set(this.#pending);
    buf.set(f.samples, this.#pending.length);
    let off = 0;
    for (; off + VAD_WINDOW <= buf.length; off += VAD_WINDOW) {
      this.#vad.acceptWaveform(buf.subarray(off, off + VAD_WINDOW));
      this.#fed += VAD_WINDOW;
    }
    this.#pending = buf.slice(off);
    this.#speaking = Boolean(this.#vad.isDetected());
    return this.#drain();
  }

  #drain(): VadSegment[] {
    const out: VadSegment[] = [];
    while (!this.#vad.isEmpty()) {
      const seg = this.#vad.front() as { samples: Float32Array; start: number };
      this.#vad.pop();
      const t0 = this.#anchor.t0 - ((this.#anchor.fed - seg.start) / SR) * 1000;
      out.push({ samples: Float32Array.from(seg.samples), sampleRate: SR, t0, t1: t0 + (seg.samples.length / SR) * 1000 });
    }
    return out;
  }

  speaking(): boolean {
    return this.#speaking;
  }
  /**
   * sherpa's reset() restarts the detector's sample index (a segment's `start` counts from the reset), so the
   * fed-samples counter restarts with it. Before 2026-10-20 it did not: every reset (an enrolment phrase, a pause, a
   * barge-in, a mode change) shifted each later segment's t0 into the past by all the audio fed before it (the
   * founder's "turns arrive 60 s late" was this skew, not a backlog; test/ambient-speaker-repro.test.ts).
   */
  reset(): void {
    this.#vad.reset?.();
    this.#vad.clear?.();
    this.#pending = new Float32Array(0);
    this.#fed = 0;
    this.#anchor = { fed: 0, t0: 0 };
    this.#speaking = false;
  }
  flush(): VadSegment[] {
    this.#vad.flush();
    return this.#drain();
  }
}

export class SherpaStt implements SttEngine {
  readonly model = 'parakeet-tdt-0.6b-v2-int8';
  #rec: Sherpa;
  readonly #make: () => Sherpa;
  readonly #log: ComponentLog;
  readonly #watchdogMs: number;
  /** decodes on the one recognizer handle are serialized (the final and a live partial never overlap on it) */
  #chain: Promise<unknown> = Promise.resolve();
  /** finals queued on the chain and not yet started: a partial whose turn comes while one waits is skipped */
  #finalsWaiting = 0;
  constructor(sherpa: Sherpa, p: Record<string, string>, o: { log?: ComponentLog; watchdogMs?: number } = {}) {
    this.#make = () =>
      new sherpa.OfflineRecognizer({
        featConfig: { sampleRate: SR, featureDim: 80 },
        modelConfig: { transducer: { encoder: p.encoder, decoder: p.decoder, joiner: p.joiner }, tokens: p.tokens, numThreads: 2, provider: 'cpu', debug: 0, modelType: 'nemo_transducer' },
      });
    this.#rec = this.#make();
    this.#log = o.log ?? silentLogger.component('#gnomon-voice');
    this.#watchdogMs = o.watchdogMs ?? STT_DECODE_WATCHDOG_MS;
  }
  /**
   * T-2026-10-20-005 (B0, PROBES.md): decodeAsync runs on the addon's worker thread, so the event loop keeps serving
   * capture frames, level events and the stop hotkey (the sync decode() blocked it for the whole 200 to 400 ms
   * decode). Same text as the sync path (B0 `sameText`). The sync decode is only a fallback for an addon without it.
   */
  async transcribe(samples: Float32Array, sampleRate: number): Promise<string> {
    return String((await this.#decode(samples, sampleRate, 'final')).text ?? '');
  }
  /**
   * B1: a live-words window → words with start times (the result's `tokens` + `timestamps`). decodeAsync only.
   * Decode priority (2026-10-20): a partial that has not started when a final is waiting returns [] without decoding,
   * so a final never queues behind live words (the next window's partial catches up).
   */
  async transcribeWords(samples: Float32Array, sampleRate: number): Promise<PartialWord[]> {
    if (typeof this.#rec.decodeAsync !== 'function') return []; // never a sync decode for a partial
    const r = await this.#decode(samples, sampleRate, 'partial');
    return r === SKIPPED ? [] : wordsOfResult(r);
  }
  #decode(samples: Float32Array, sampleRate: number, kind: 'final' | 'partial'): Promise<SherpaResult> {
    if (kind === 'final') this.#finalsWaiting++;
    const run = async (): Promise<SherpaResult> => {
      if (kind === 'final') this.#finalsWaiting--;
      else if (this.#finalsWaiting > 0) return SKIPPED;
      const s = this.#rec.createStream();
      s.acceptWaveform({ sampleRate, samples });
      if (typeof this.#rec.decodeAsync === 'function') return (await this.#watchdog(this.#rec.decodeAsync(s) as Promise<SherpaResult>, samples.length / sampleRate)) ?? {};
      this.#rec.decode(s);
      return (this.#rec.getResult(s) as SherpaResult | undefined) ?? {};
    };
    const p = this.#chain.then(run);
    this.#chain = p.catch(() => undefined);
    return p;
  }
  /**
   * Aegis L2: a decodeAsync that never resolves would stall the serialized chain (every later final and partial). Past
   * the watchdog bound (STT_DECODE_WATCHDOG_MS plus the audio's own length) the call is rejected, the recognizer is
   * rebuilt from the same verified paths (the hung handle is abandoned, its late result ignored) and the event logged.
   */
  #watchdog(p: Promise<SherpaResult>, audioS: number): Promise<SherpaResult> {
    const bound = this.#watchdogMs + Math.ceil(audioS * 1000);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        this.#log.warn('stt decode watchdog fired; recognizer rebuilt', { boundMs: bound });
        try {
          this.#rec = this.#make();
        } catch (err) {
          this.#log.warn('stt recognizer rebuild failed', { error: err instanceof Error ? err.message : String(err) });
        }
        reject(new Error(`#gnomon-voice: the STT decode did not finish within the watchdog bound (${bound})`));
      }, bound);
    });
    p.catch(() => undefined);
    return Promise.race([p, late]).finally(() => clearTimeout(timer));
  }
}

/** a partial decode skipped for a waiting final (never decoded) */
const SKIPPED: SherpaResult = Object.freeze({});

/** Aegis L2: the decode watchdog bound, beyond the audio's own length (a design constant, not a measurement) */
export const STT_DECODE_WATCHDOG_MS = 15_000;

/** Kokoro threads (T-2026-10-19-026 bench, Apple M4, warm: RTF 0.71/0.69/0.68 at 2/4/6 threads, speed 1.0; see the spec §14.4.1 note) */
export const TTS_THREADS = 4;
/** Kokoro speed (1.0 = the voice's natural rate) */
export const TTS_SPEED = 1.0;

/** Kokoro v0.19 speaker 9 (bm_george) is the SYSTEM voice; never the model's own speaker (then 6, am_michael). */
export const SYSTEM_SID_DEFAULT = 9;
export function systemSidFor(modelSid: number, wanted: number = SYSTEM_SID_DEFAULT): number {
  if (wanted !== modelSid) return wanted;
  return modelSid === SYSTEM_SID_DEFAULT ? 6 : SYSTEM_SID_DEFAULT;
}

export class SherpaTts implements TtsEngine {
  readonly voice: string;
  readonly #tts: Sherpa;
  readonly #sid: number;
  readonly #speed: number;
  readonly #systemSid: number;
  constructor(sherpa: Sherpa, p: Record<string, string>, o: { sid?: number; voice?: string; numThreads?: number; speed?: number; systemSid?: number } = {}) {
    this.#tts = new sherpa.OfflineTts({ model: { kokoro: { model: p.model, voices: p.voices, tokens: p.tokens, dataDir: p.dataDir }, numThreads: o.numThreads ?? TTS_THREADS, provider: 'cpu', debug: false }, maxNumSentences: 1 });
    this.#sid = o.sid ?? 0;
    this.#speed = o.speed ?? TTS_SPEED;
    this.#systemSid = systemSidFor(this.#sid, o.systemSid);
    this.voice = o.voice ?? `kokoro-en-v0_19:${this.#sid}`;
  }
  /**
   * T-2026-10-19-026: generateAsync runs on the addon's worker thread, so the event loop keeps serving capture frames
   * and the stop hotkey while the next sentence synthesizes (the sync generate() blocked it for ~1 s per sentence).
   * `voice: 'system'` = the kernel's own words (table talk S4): a different speaker than model replies.
   */
  async synthesize(sentence: string, o: { voice?: 'model' | 'system' } = {}): Promise<{ samples: Float32Array; sampleRate: number }> {
    const sid = o.voice === 'system' ? this.#systemSid : this.#sid;
    const req = { text: sentence, sid, speed: this.#speed };
    const a = (typeof this.#tts.generateAsync === 'function' ? await this.#tts.generateAsync(req) : this.#tts.generate(req)) as { samples: Float32Array; sampleRate: number };
    return { samples: a.samples, sampleRate: a.sampleRate };
  }
  /** One discarded synthesis so the first reply does not pay the cold start (graph init, allocator warm-up). */
  async warmUp(): Promise<void> {
    await this.synthesize('Ready.');
  }
}

export class SherpaSpeaker implements SpeakerEngine {
  readonly #ex: Sherpa;
  readonly dim: number;
  /** every embedding goes through the speech gate (speaker.ts speechOnly; founder regression 2026-10-20) */
  readonly frontEnd = SPEAKER_FRONT_END;
  constructor(sherpa: Sherpa, model: string) {
    this.#ex = new sherpa.SpeakerEmbeddingExtractor({ model, numThreads: 1, debug: false });
    this.dim = Number(this.#ex.dim);
  }
  speechMs(samples: Float32Array, sampleRate: number): number {
    return speechMsOf(samples, sampleRate);
  }
  async embed(samples: Float32Array, sampleRate: number): Promise<Float32Array> {
    const gated = speechOnly(samples, sampleRate);
    const s = this.#ex.createStream();
    s.acceptWaveform({ sampleRate, samples: gated.length ? gated : samples });
    s.inputFinished?.();
    return Float32Array.from(this.#ex.compute(s) as Float32Array);
  }
}

/** Build all four engines from VERIFIED model files (throws ModelVerifyError if any model is absent or altered). */
export async function createSherpaEngines(home: string, o: { manifest?: ModelManifest; sherpa?: Sherpa; roles?: Array<keyof VoiceEngines>; log?: ComponentLog } = {}): Promise<Partial<VoiceEngines>> {
  const m = o.manifest ?? loadManifest();
  const roles = o.roles ?? ['vad', 'stt', 'tts', 'speaker'];
  // verify every requested model BEFORE loading the native module or any model
  const paths = Object.fromEntries(roles.map((r) => [r, verifiedModelPaths(home, modelFor(m, r))])) as Record<string, Record<string, string>>;
  const sherpa = o.sherpa ?? (await loadSherpa());
  const out: Partial<VoiceEngines> = {};
  if (paths.vad) out.vad = new SherpaVad(sherpa, paths.vad.model!);
  if (paths.stt) out.stt = new SherpaStt(sherpa, paths.stt, o.log ? { log: o.log } : {});
  if (paths.tts) out.tts = new SherpaTts(sherpa, paths.tts);
  if (paths.speaker) out.speaker = new SherpaSpeaker(sherpa, paths.speaker.model!);
  return out;
}
