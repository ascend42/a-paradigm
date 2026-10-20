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
import type { PcmFrame, SpeakerEngine, SttEngine, TtsEngine, VadEngine, VadSegment, VoiceEngines } from '../types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sherpa = any;

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
  reset(): void {
    this.#vad.reset?.();
    this.#vad.clear?.();
    this.#pending = new Float32Array(0);
    this.#speaking = false;
  }
  flush(): VadSegment[] {
    this.#vad.flush();
    return this.#drain();
  }
}

export class SherpaStt implements SttEngine {
  readonly model = 'parakeet-tdt-0.6b-v2-int8';
  readonly #rec: Sherpa;
  constructor(sherpa: Sherpa, p: Record<string, string>) {
    this.#rec = new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: SR, featureDim: 80 },
      modelConfig: { transducer: { encoder: p.encoder, decoder: p.decoder, joiner: p.joiner }, tokens: p.tokens, numThreads: 2, provider: 'cpu', debug: 0, modelType: 'nemo_transducer' },
    });
  }
  async transcribe(samples: Float32Array, sampleRate: number): Promise<string> {
    const s = this.#rec.createStream();
    s.acceptWaveform({ sampleRate, samples });
    this.#rec.decode(s);
    return String(this.#rec.getResult(s).text ?? '');
  }
}

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
  readonly #systemSid: number;
  constructor(sherpa: Sherpa, p: Record<string, string>, o: { sid?: number; voice?: string; systemSid?: number } = {}) {
    this.#tts = new sherpa.OfflineTts({ model: { kokoro: { model: p.model, voices: p.voices, tokens: p.tokens, dataDir: p.dataDir }, numThreads: 2, provider: 'cpu', debug: false }, maxNumSentences: 1 });
    this.#sid = o.sid ?? 0;
    this.#systemSid = systemSidFor(this.#sid, o.systemSid);
    this.voice = o.voice ?? `kokoro-en-v0_19:${this.#sid}`;
  }
  async synthesize(sentence: string, o: { voice?: 'model' | 'system' } = {}): Promise<{ samples: Float32Array; sampleRate: number }> {
    const sid = o.voice === 'system' ? this.#systemSid : this.#sid;
    const a = this.#tts.generate({ text: sentence, sid, speed: 1.0 }) as { samples: Float32Array; sampleRate: number };
    return { samples: a.samples, sampleRate: a.sampleRate };
  }
}

export class SherpaSpeaker implements SpeakerEngine {
  readonly #ex: Sherpa;
  readonly dim: number;
  constructor(sherpa: Sherpa, model: string) {
    this.#ex = new sherpa.SpeakerEmbeddingExtractor({ model, numThreads: 1, debug: false });
    this.dim = Number(this.#ex.dim);
  }
  async embed(samples: Float32Array, sampleRate: number): Promise<Float32Array> {
    const s = this.#ex.createStream();
    s.acceptWaveform({ sampleRate, samples });
    s.inputFinished?.();
    return Float32Array.from(this.#ex.compute(s) as Float32Array);
  }
}

/** Build all four engines from VERIFIED model files (throws ModelVerifyError if any model is absent or altered). */
export async function createSherpaEngines(home: string, o: { manifest?: ModelManifest; sherpa?: Sherpa; roles?: Array<keyof VoiceEngines> } = {}): Promise<Partial<VoiceEngines>> {
  const m = o.manifest ?? loadManifest();
  const roles = o.roles ?? ['vad', 'stt', 'tts', 'speaker'];
  // verify every requested model BEFORE loading the native module or any model
  const paths = Object.fromEntries(roles.map((r) => [r, verifiedModelPaths(home, modelFor(m, r))])) as Record<string, Record<string, string>>;
  const sherpa = o.sherpa ?? (await loadSherpa());
  const out: Partial<VoiceEngines> = {};
  if (paths.vad) out.vad = new SherpaVad(sherpa, paths.vad.model!);
  if (paths.stt) out.stt = new SherpaStt(sherpa, paths.stt);
  if (paths.tts) out.tts = new SherpaTts(sherpa, paths.tts);
  if (paths.speaker) out.speaker = new SherpaSpeaker(sherpa, paths.speaker.model!);
  return out;
}
