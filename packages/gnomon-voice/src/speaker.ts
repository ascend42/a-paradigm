/**
 * @symbol #gnomon-voice
 *
 * Voiceprints and speaker verification (spec §14.4; V2c). A print is the mean CAM++ embedding of the enrolment
 * phrases, stored as `<home>/voice/prints/<name>/print.json` (dir 0700, file 0600) — the directory V1's root-signed
 * `gnomon voice forget <name>` deletes. A print is an embedding, never audio (G-VOX-05). Speaker recognition is
 * NOT authentication: the kernel forwards only speakers whose root-signed enrolment row it verifies; a print here
 * only lets the client label a turn. An utterance whose best cosine score is below the threshold is
 * `spk:unknown-N` (N numbers distinct unknown voices this run, by clustering against earlier unknowns).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { VOICE_MIN_VERIFY_SPEECH_MS } from '@a-company/gnomon-contracts';
import type { SpeakerEngine } from './types.js';

export const PRINT_SCHEMA = 'voicePrint:v1' as const;
/**
 * CAM++ / VoxCeleb cosine threshold, on speech-gated embeddings (speechOnly). Raised 0.6 → 0.65 by the 2026-10-20
 * calibration (a small sample, two human speakers): with MIN_VERIFY_SPEECH_MS it was the lowest threshold with no
 * human impostor accepted (0/284 trials); it costs same-speaker acceptance on short utterances (fail closed).
 */
export const VERIFY_THRESHOLD = 0.65;
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export interface VoicePrint {
  schemaVersion: typeof PRINT_SCHEMA;
  name: string;
  model: string;
  dim: number;
  phrases: number;
  embedding: number[];
  createdAt: string;
  /** the speaker front end that made it (SPEAKER_FRONT_END); absent on prints made before 2026-10-20 */
  frontEnd?: string;
}

export function printsDir(home: string): string {
  return path.join(home, 'voice', 'prints');
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return -1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : -1;
}

/** the speaker front end's id, stored in every print it made (a print from another front end is not compared) */
export const SPEAKER_FRONT_END = 'speech-gate:v1' as const;
/** speech-gate frame (ms) */
export const GATE_FRAME_MS = 20;
/** a frame is quiet below max(GATE_FLOOR_DBFS, loudest frame − GATE_REL_DB) */
export const GATE_REL_DB = 25;
export const GATE_FLOOR_DBFS = -55;
/** an inner quiet run this long or longer is a pause and is cut (shorter dips are consonants and stay) */
export const GATE_PAUSE_MS = 200;
/** frames kept at each side of a cut pause (the word's own decay and onset) */
export const GATE_KEEP_FRAMES = 1;
/** below this much gated speech an utterance is not verified (fail closed: unknown; calibration 2026-10-20). The
 * kernel shares it (contracts VOICE_MIN_VERIFY_SPEECH_MS) to word a short turn's refusal "too short to check it's you". */
export const MIN_VERIFY_SPEECH_MS = VOICE_MIN_VERIFY_SPEECH_MS;
/** the live-words provisional match (display only, never forwarding) needs this much gated speech */
export const MIN_PROVISIONAL_SPEECH_MS = 750;
/** an enrolment phrase with less gated speech than this is not used (the recorder keeps listening) */
export const MIN_ENROL_SPEECH_MS = 1200;

/**
 * The speech gate (founder regression 2026-10-20). CAM++ normalizes its features over the whole input, so quiet
 * frames (VPIO's suppressed pauses, VAD edges) dominate an ungated embedding: measured with the real model, padding a
 * stranger's speech with 0.5 s of quiet moved its score against an enrolled print from 0.52 to 0.82, and a print
 * enrolled from quiet-heavy phrases matched any quiet-heavy segment (a video was accepted as the founder).
 *
 * In 20 ms frames, a frame is QUIET below max(GATE_FLOOR_DBFS, loudest − GATE_REL_DB). Leading and trailing quiet is
 * cut entirely; an inner quiet run of GATE_PAUSE_MS or longer (a pause) is cut but for GATE_KEEP_FRAMES at each side; shorter
 * dips (stops, fricatives) stay, so the speech stays continuous. The first version cut every quiet frame; that
 * chopped consonants and RAISED impostor scores on plain speech (calibration 2026-10-20: 11/68 human impostor trials
 * ≥ 0.6 against 0/68 with this pause-only cut). Gated, the embedding no longer depends on how much quiet surrounds
 * the speech (cosine 1.000 with and without 0.5 s of −65 dBFS padding; 0.94–0.99 with 300 ms inner gaps).
 */
export function speechOnly(samples: Float32Array, sampleRate: number): Float32Array {
  const F = Math.max(1, Math.round((sampleRate * GATE_FRAME_MS) / 1000));
  const n = Math.floor(samples.length / F);
  if (n === 0) return new Float32Array(0);
  const db = new Float64Array(n);
  let top = -Infinity;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * F; j < (i + 1) * F; j++) s += samples[j]! * samples[j]!;
    db[i] = 10 * Math.log10(s / F + 1e-12);
    if (db[i]! > top) top = db[i]!;
  }
  const thr = Math.max(GATE_FLOOR_DBFS, top - GATE_REL_DB);
  const minRun = Math.max(1, Math.round(GATE_PAUSE_MS / GATE_FRAME_MS));
  const keep = new Uint8Array(n).fill(1);
  for (let i = 0; i < n; ) {
    if (db[i]! >= thr) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && db[j]! < thr) j++;
    const lead = i === 0;
    const trail = j === n;
    // edge quiet goes entirely (so padding never changes the result); an inner pause keeps its edge frames
    if (lead || trail) for (let k = i; k < j; k++) keep[k] = 0;
    else if (j - i >= minRun) for (let k = i + GATE_KEEP_FRAMES; k < j - GATE_KEEP_FRAMES; k++) keep[k] = 0;
    i = j;
  }
  let m = 0;
  for (let i = 0; i < n; i++) m += keep[i]!;
  const out = new Float32Array(m * F);
  for (let i = 0, o = 0; i < n; i++) if (keep[i]) out.set(samples.subarray(i * F, (i + 1) * F), F * o++);
  return out;
}

/** ms of speech the gate keeps */
export function speechMsOf(samples: Float32Array, sampleRate: number): number {
  return (speechOnly(samples, sampleRate).length / sampleRate) * 1000;
}

export function meanEmbedding(es: readonly Float32Array[]): Float32Array {
  if (!es.length) throw new TypeError('#gnomon-voice: no embeddings to average');
  const out = new Float32Array(es[0]!.length);
  for (const e of es) for (let i = 0; i < out.length; i++) out[i]! += e[i]! / es.length;
  return out;
}

export function writePrint(home: string, p: VoicePrint): string {
  if (!NAME.test(p.name)) throw new TypeError('#gnomon-voice: a speaker name is [a-z0-9][a-z0-9._-]{0,63}');
  const dir = path.join(printsDir(home), p.name);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(printsDir(home), 0o700);
  fs.chmodSync(dir, 0o700);
  const file = path.join(dir, 'print.json');
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(p)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  return file;
}

/** Every readable, well-formed print. A malformed one is skipped (never guessed). */
export function readPrints(home: string): VoicePrint[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(printsDir(home));
  } catch {
    return [];
  }
  const out: VoicePrint[] = [];
  for (const n of names) {
    if (!NAME.test(n)) continue;
    try {
      const p = JSON.parse(fs.readFileSync(path.join(printsDir(home), n, 'print.json'), 'utf8')) as VoicePrint;
      if (p.schemaVersion === PRINT_SCHEMA && p.name === n && Array.isArray(p.embedding) && p.embedding.length === p.dim) out.push(p);
    } catch {
      // unreadable / malformed: not a print
    }
  }
  return out;
}

/** The names among `prints` with no print from front end `fe` (an engine without a front end: none). */
export function staleNames(prints: readonly VoicePrint[], fe: string | undefined): string[] {
  if (fe === undefined) return [];
  const fresh = new Set(prints.filter((p) => p.frontEnd === fe).map((p) => p.name));
  return [...new Set(prints.filter((p) => p.frontEnd !== fe && !fresh.has(p.name)).map((p) => p.name))].sort();
}

export interface SpeakerVerdict {
  /** the enrolled name, or undefined for an unknown voice */
  name?: string;
  /** 'unknown-N' label when not matched */
  unknownLabel?: string;
  score: number;
  /** the speech that survived the speech gate (ms), when the engine measures it (calibration, never audio) */
  speechMs?: number;
  /** the best-scoring enrolled print on an UNKNOWN verdict (continuity uses it to see another enrolled voice) */
  bestName?: string;
}

/**
 * Calibration (voice drops fix 2026-10-20): the verdict's score as a COARSE bucket for the log (never the number):
 * 'none' when no print was compared (score -1), else lt0.5 | 0.5-0.65 | 0.65-0.8 | ge0.8.
 */
export type SpeakerScoreBucket = 'none' | 'lt0.5' | '0.5-0.65' | '0.65-0.8' | 'ge0.8';
export function speakerScoreBucket(score: number): SpeakerScoreBucket {
  if (!Number.isFinite(score) || score < -0.999) return 'none';
  if (score < 0.5) return 'lt0.5';
  if (score < 0.65) return '0.5-0.65';
  if (score < 0.8) return '0.65-0.8';
  return 'ge0.8';
}
/** gated speech for the log: rounded to 10 ms, bounded (the kernel refuses anything else) */
export function gatedSpeechMsOf(ms: number | undefined): number | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined;
  return Math.min(600_000, Math.round(ms / 10) * 10);
}

/** Matches utterances against the enrolled prints; numbers unknown voices consistently within one run. */
export class SpeakerVerifier {
  readonly #engine: SpeakerEngine;
  readonly #prints: () => readonly VoicePrint[];
  readonly #threshold: number;
  readonly #unknowns: Float32Array[] = [];

  constructor(engine: SpeakerEngine, prints: () => readonly VoicePrint[], threshold = VERIFY_THRESHOLD) {
    this.#engine = engine;
    this.#prints = prints;
    this.#threshold = threshold;
  }

  /** The prints this engine can compare against: same front end (an engine without one compares every print). */
  #usable(): VoicePrint[] {
    const fe = this.#engine.frontEnd;
    return this.#prints().filter((p) => fe === undefined || p.frontEnd === fe);
  }

  /**
   * Names whose print was made by another (older) front end and who have no current one: never compared, so they
   * are not recognised until they enrol again (the GUI's "Re-teach Gnomon your voice"). Sorted, unique.
   */
  stalePrints(): string[] {
    return staleNames(this.#prints(), this.#engine.frontEnd);
  }

  /** Too little speech to verify (fail closed: such an utterance never matches a print). */
  #tooShort(samples: Float32Array, sampleRate: number, min: number): boolean {
    return this.#engine.speechMs !== undefined && this.#engine.speechMs(samples, sampleRate) < min;
  }

  /**
   * B1 V1: a PROVISIONAL match on the first ~1.5 s of an open segment (live words only). Read-only: an unknown voice
   * is not numbered here (identify on the full segment does that). True only for an enrolled print over the threshold.
   */
  async provisional(samples: Float32Array, sampleRate: number): Promise<boolean> {
    const prints = this.#usable();
    if (!prints.length || this.#tooShort(samples, sampleRate, MIN_PROVISIONAL_SPEECH_MS)) return false;
    const e = await this.#engine.embed(samples, sampleRate);
    return prints.some((p) => cosine(e, p.embedding) >= this.#threshold);
  }

  async identify(samples: Float32Array, sampleRate: number): Promise<SpeakerVerdict> {
    const e = await this.#engine.embed(samples, sampleRate);
    let best: { name: string; score: number } | undefined;
    for (const p of this.#usable()) {
      const s = cosine(e, p.embedding);
      if (!best || s > best.score) best = { name: p.name, score: s };
    }
    const speechMs = this.#engine.speechMs?.(samples, sampleRate);
    const gated = speechMs !== undefined ? { speechMs } : {};
    if (best && best.score >= this.#threshold && (speechMs === undefined || speechMs >= MIN_VERIFY_SPEECH_MS)) return { name: best.name, score: best.score, ...gated };
    let idx = this.#unknowns.findIndex((u) => cosine(u, e) >= this.#threshold);
    if (idx < 0) {
      this.#unknowns.push(e);
      idx = this.#unknowns.length - 1;
    }
    return { unknownLabel: `unknown-${Math.min(idx + 1, 999_999)}`, score: best?.score ?? -1, ...gated, ...(best ? { bestName: best.name } : {}) };
  }
}
