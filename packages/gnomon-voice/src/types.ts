/**
 * @symbol #gnomon-voice
 *
 * The seams of the voice client core (voice slice V2c, TD-2026-10-19-298). Everything the loop touches is an
 * injected interface so the pipeline is tested with FakeAudioIO and stub engines (no models, no audio, no network):
 *   - AudioIO       — capture + playback; V2b's `gnomon-voice-io` Swift binary satisfies it (audio-io.ts adapter)
 *   - VadEngine     — Silero VAD (segmentation + "is speech now" for barge-in)
 *   - SttEngine     — Parakeet TDT 0.6B v2 int8, offline on a VAD segment
 *   - TtsEngine     — Kokoro-82M, one sentence at a time
 *   - SpeakerEngine — CAM++ (3D-Speaker) embeddings for enrolment and verification
 *   - KernelLink    — the authenticated voice-principal connection (status, log.append, session.send, log.read follow)
 *
 * Audio is Float32 mono PCM in [-1, 1] at `sampleRate` (16 kHz capture). Times are wall-clock ms (t0/t1 on the
 * voice.turn.* rows the kernel's echo check compares).
 */

import type { PartialWord } from './partials.js';

/** One captured PCM frame. */
export interface PcmFrame {
  samples: Float32Array;
  sampleRate: number;
  /** wall ms of the first sample */
  t0: number;
}

export interface RouteInfo {
  /** e.g. 'built-in', 'headphones', 'bluetooth' (V2b reports it) */
  route: string;
  /** true when the capture path runs voice-processing AEC (or the route cannot echo, e.g. wired headphones) */
  aec: boolean;
  /** the binary's AEC kind (gnomon-voice-io:v1 route/mic `aec`): vpio | headphones | none */
  aecKind?: 'vpio' | 'headphones' | 'none';
  /** output transport (e.g. built-in, bluetooth, usb) from the mic/route event */
  transport?: string;
}

export interface PlaybackResult {
  /** wall ms playback started / ended (the voice.turn.agent window) */
  t0: number;
  t1: number;
  /** false when stopped early (barge-in or stopPlayback) */
  completed: boolean;
}

/** The local control hotkeys the controller acts on (key down only). */
export type ControlAction = 'mic-toggle' | 'mode-toggle' | 'hold-toggle' | 'stop-speaking';

export interface AudioIOEvents {
  frame(f: PcmFrame): void;
  /** the push-to-talk hotkey */
  hotkey(down: boolean, atMs: number): void;
  /** a local control hotkey: ⌃⌥M mic-toggle, ⌃⌥A mode-toggle, ⌃⌥H hold-toggle, ⌃⌥. stop-speaking (gnomon-voice-io default bindings) */
  control(action: ControlAction, atMs: number): void;
  /** the human muted or unmuted the mic (hardware/menu) */
  mic(muted: boolean): void;
  route(r: RouteInfo): void;
  /** input level meter, dBFS */
  level(db: number): void;
  /** the binary exited or the device went away */
  closed(reason: string): void;
}

/**
 * Capture and playback. V2b's binary implements it over framed stdio (audio-io.ts); FakeAudioIO plays WAV
 * fixtures. Nothing here ever writes audio to disk (G-VOX-05).
 */
export interface AudioIO {
  readonly captureSampleRate: number;
  start(): Promise<void>;
  close(): Promise<void>;
  on<E extends keyof AudioIOEvents>(event: E, cb: AudioIOEvents[E]): () => void;
  /** Play one chunk; resolves when it ends or is stopped. One chunk at a time. */
  play(chunk: { id: string; samples: Float32Array; sampleRate: number }): Promise<PlaybackResult>;
  /** Stop the chunk now playing (barge-in); its play() resolves with completed: false. */
  stopPlayback(): void;
  routeInfo(): RouteInfo;
  /** Turn capture on/off locally (gnomon-voice-io mic.on / mic.off). */
  setMic(on: boolean): Promise<void>;
  readonly micOn: boolean;
}

export interface VadSegment {
  samples: Float32Array;
  sampleRate: number;
  t0: number;
  t1: number;
}

export interface VadEngine {
  readonly sampleRate: number;
  /** Feed one frame; returns finished segments (zero or more). */
  accept(f: PcmFrame): VadSegment[];
  /** Whether the last fed audio is speech (barge-in detection). */
  speaking(): boolean;
  /** Drop any partial segment (after barge-in, on mode change). */
  reset(): void;
  /** End of input: return the open segment, if any. */
  flush(): VadSegment[];
}

export interface SttEngine {
  readonly model: string;
  transcribe(samples: Float32Array, sampleRate: number): Promise<string>;
  /**
   * B1 live words (T-2026-10-20-005): decode a partial window into words with their start times (seconds from the
   * window's first sample). Optional: an engine without it gets no live words (the final transcript is unaffected).
   * Must not block the event loop (sherpa: decodeAsync).
   */
  transcribeWords?(samples: Float32Array, sampleRate: number): Promise<PartialWord[]>;
}

export interface TtsEngine {
  readonly voice: string;
  /** `voice: 'system'` = the kernel's own words (table talk S4): a different speaker than model replies */
  synthesize(sentence: string, o?: { voice?: 'model' | 'system' }): Promise<{ samples: Float32Array; sampleRate: number }>;
  /** one silent synthesis at client start so the first spoken reply does not pay the cold start (optional) */
  warmUp?(): Promise<void>;
}

export interface SpeakerEngine {
  readonly dim: number;
  /**
   * The front end's id (sherpa: speech-gate:v1, speaker.ts speechOnly). Stored in each print it makes; a print made
   * by another front end is never compared (its embeddings live in a different space). Absent: no check (stubs).
   */
  readonly frontEnd?: string;
  /** ms of speech the front end keeps from `samples` (below MIN_VERIFY_SPEECH_MS nothing is verified). Optional. */
  speechMs?(samples: Float32Array, sampleRate: number): number;
  embed(samples: Float32Array, sampleRate: number): Promise<Float32Array>;
}

export interface VoiceEngines {
  vad: VadEngine;
  stt: SttEngine;
  tts: TtsEngine;
  speaker: SpeakerEngine;
}

/** The kernel refusal the client shows (never retried blindly). */
export interface KernelRefusal {
  code: string;
  reason: string;
  message: string;
}

export interface VoiceAttachment {
  voiceSessionId: string;
  hsid: string;
  /** the human's ceiling, as the kernel names it ('ptt' | 'conversation' in V1; V2a may add 'ambient') */
  mode: string;
}

export interface KernelRow {
  seq: number;
  kind: string;
  session?: string;
  /** the row's principal (Aegis L1: a kernel-speakable row is spoken only when it is p:<ns>/kernel) */
  principal?: string;
  payload: Record<string, unknown>;
}

/** The voice principal's kernel connection (kernel-link.ts wraps the #gnomon-ts-client GnomonClient). */
/**
 * What log.append returns. For voice.turn.user the kernel adds its verdict: `forwardable`, and for a turn it refused at
 * receipt (stored hash-only) `refused` (the voice-* reason, e.g. voice-playback) and `refusedCause` (its V2a cause).
 */
export interface AppendResult {
  seq: number;
  forwardable?: boolean;
  refused?: string;
  refusedCause?: string;
}

export interface KernelLink {
  /** status → voice.attached (null when nothing is attached) */
  attachment(): Promise<VoiceAttachment | null>;
  /**
   * status.voice.stopSpeakingSeq from the LAST attachment() read (the human's ⏹ Stop speaking count; the client stops
   * playback when it changes). null when the kernel does not report it. Optional for stubs.
   */
  stopSpeakingSeq?(): number | null;
  append(kind: string, payload: Record<string, unknown>): Promise<AppendResult>;
  send(hsid: string, text: string): Promise<unknown>;
  /** session.stop{interrupt: true} — the only stop voice may make */
  interrupt(hsid: string): Promise<unknown>;
  /** log.read follow on the attached session (voice projection). Returns an unsubscribe. */
  follow(hsid: string, row: (r: KernelRow) => void, end: (reason: string) => void): Promise<() => void>;
  /** The link closed (fd EOF): the client exits. Optional for stubs. */
  onClose?(cb: (reason: string) => void): void;
  close(): Promise<void>;
}

/** A Paradigm-logger-shaped port: `log.component('#gnomon-voice').info(…)`. Omitted ⇒ silent. */
export interface ComponentLog {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
}
export interface VoiceLogger {
  component(id: string): ComponentLog;
  flow(id: string): ComponentLog;
}

const SILENT: ComponentLog = { info: () => undefined, warn: () => undefined };
export const silentLogger: VoiceLogger = { component: () => SILENT, flow: () => SILENT };
