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
import type { SpeakerEngine } from './types.js';

export const PRINT_SCHEMA = 'voicePrint:v1' as const;
/** CAM++ / VoxCeleb cosine threshold (EER region ≈ 0.5–0.6 on clean speech; tuned conservative). Unverified on-device. */
export const VERIFY_THRESHOLD = 0.6;
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
/** speech-gate frame (ms), the gate below the loudest frame (dB) and the absolute floor (dBFS) */
export const GATE_FRAME_MS = 20;
export const GATE_REL_DB = 30;
export const GATE_FLOOR_DBFS = -55;
/** below this much gated speech an utterance is not verified (fail closed: unknown) */
export const MIN_VERIFY_SPEECH_MS = 500;

/**
 * The speech gate (founder regression 2026-10-20): keep only the 20 ms frames within GATE_REL_DB of the segment's
 * loudest frame and above GATE_FLOOR_DBFS (plus one frame either side), concatenated. CAM++ normalizes its features
 * over the whole input, so near-silent frames (VPIO's suppressed pauses, VAD edges) dominate an ungated embedding:
 * measured with the real model, padding a stranger's speech with 0.5 s of quiet moved its score against an enrolled
 * print from 0.52 to 0.82, and a print enrolled from quiet-heavy phrases matched any quiet-heavy segment (a video
 * was accepted as the founder). Gated, the embedding no longer depends on how much silence the segment carries.
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
  const keep: number[] = [];
  for (let i = 0; i < n; i++) if (db[i]! >= thr || (i > 0 && db[i - 1]! >= thr) || (i + 1 < n && db[i + 1]! >= thr)) keep.push(i);
  const out = new Float32Array(keep.length * F);
  keep.forEach((k, m) => out.set(samples.subarray(k * F, (k + 1) * F), m * F));
  return out;
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

export interface SpeakerVerdict {
  /** the enrolled name, or undefined for an unknown voice */
  name?: string;
  /** 'unknown-N' label when not matched */
  unknownLabel?: string;
  score: number;
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

  /** Names of prints made by another (older) front end: never compared, so those speakers must enrol again. */
  stalePrints(): string[] {
    const fe = this.#engine.frontEnd;
    return fe === undefined ? [] : this.#prints().filter((p) => p.frontEnd !== fe).map((p) => p.name);
  }

  /** Too little speech to verify (fail closed: such an utterance never matches a print). */
  #tooShort(samples: Float32Array, sampleRate: number): boolean {
    return this.#engine.speechMs !== undefined && this.#engine.speechMs(samples, sampleRate) < MIN_VERIFY_SPEECH_MS;
  }

  /**
   * B1 V1: a PROVISIONAL match on the first ~1.5 s of an open segment (live words only). Read-only: an unknown voice
   * is not numbered here (identify on the full segment does that). True only for an enrolled print over the threshold.
   */
  async provisional(samples: Float32Array, sampleRate: number): Promise<boolean> {
    const prints = this.#usable();
    if (!prints.length || this.#tooShort(samples, sampleRate)) return false;
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
    if (best && best.score >= this.#threshold && !this.#tooShort(samples, sampleRate)) return { name: best.name, score: best.score };
    let idx = this.#unknowns.findIndex((u) => cosine(u, e) >= this.#threshold);
    if (idx < 0) {
      this.#unknowns.push(e);
      idx = this.#unknowns.length - 1;
    }
    return { unknownLabel: `unknown-${Math.min(idx + 1, 999_999)}`, score: best?.score ?? -1 };
  }
}
