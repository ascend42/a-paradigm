/**
 * @symbol #gnomon-voice
 * @flow $voice-turn
 *
 * The voice client loop (spec §14.1–14.7; voice slice V2c, TD-2026-10-19-298).
 *
 * $voice-turn, user side: AudioIO frames → (PTT: the span the hotkey is held | AMBIENT: Silero VAD segments) →
 *   gate (attached? mode allowed by the human's ceiling? outside every playback window + 750 ms tail?) →
 *   Parakeet STT → speaker verify (CAM++ vs the enrolled prints) →
 *   `log.append voice.turn.user{turnId, speakerId, speakerEnrolled, forwarded, mode, aec, t0, t1, text}` →
 *   `session.send{hsid, content: [{text}]}` (enrolled speakers only). A refusal is shown and never retried.
 *   DICTATION (TD-2026-10-20-262, the default `delivery: 'composer'`): the client NEVER calls session.send. It appends
 *   voice.turn.user{forwarded: false}; the kernel stamps `forwardable` and the GUI puts the text into its composer and
 *   sends it after a countdown (the human's send, attributed by the kernel). `delivery: 'direct'` keeps the old
 *   forward for headless use (`gnomon-voice run --delivery direct`) for PUSH-TO-TALK turns only: TD-2026-10-20-125
 *   (founder ruling), ambient speech NEVER sends itself, so an ambient turn is dictated (composer) under either
 *   delivery, the GUI never auto-sends it (a key press does), and the kernel refuses a direct send of a non-ptt
 *   turn voice-off{cause: 'composer'}. Activity edges go to the kernel as
 *   `request.voice.report{dictation: {activity: speaking | transcribing | idle, holdToggles}}` (edges only); the
 *   ⌃⌥H hold-toggle hotkey increments holdToggles (the GUI holds or releases its countdown).
 *   CAPTURE (T-2026-10-20-005 A1, TD-2026-10-20-086): every segment runs `idle → hearing → transcribing → captured |
 *   dropped{reason}` (PTT: key-down is hearing; AMBIENT: VAD start is hearing), reason from the closed
 *   CAPTURE_DROP_REASONS, set at each drop site. Voice drops fix (2026-10-20): the kernel's append verdict is read; a
 *   turn it refused at receipt (log.append → {refused, refusedCause}) ends DROPPED (reason 'refused' with
 *   {refusal, cause}, or not-enrolled / not-attached for voice-speaker / voice-target), never captured. Reported as `request.voice.report{capture: {state, segId, reason?,
 *   level?}}` on the same serialized #reports chain: non-terminal reports ≤ 5 Hz (CAPTURE_REPORT_MIN_MS, the latest
 *   wins), terminal ones always sent. `level` (0..1, from the binary's level events) rides hearing reports only. No
 *   words in A1: the later partial text (B) gets its own field, projected by the kernel to the gui credential only.
 * $voice-turn, agent side: `log.read follow` on the attached session → the KERNEL's speakable rows
 *   (`voice.turn.agent{source:'kernel-speakable', turnSeq, items}`; never turn.event) → Kokoro per sentence → AudioIO.play →
 *   `log.append voice.turn.agent{turnId, t0, t1, textPlanned, textSpoken}` per played chunk (the windows the
 *   kernel's voice-echo guard checks).
 *
 * Speaking (T-2026-10-19-026): sentences are PIPELINED — sentence n+1 is synthesized while sentence n plays (TTS
 * calls are serialized; an optional warm-up synthesis runs at start). The spoken-reply state is reported as
 * `request.voice.report{playback: {playing}}` edges (status.voice.playback; the GUI shows ⏹ Stop speaking). Speech
 * stops ONLY on: an explicit stop (⌃⌥. hotkey → control 'stop-speaking', the GUI's ⏹ / Esc → the human's
 * request.voice.client{op:'stop-speaking'} → a changed status.voice.stopSpeakingSeq on the next status re-read),
 * a barge-in, a detach (a successful status read with no or another attachment) or close. A status re-read, a
 * transient status failure or a follow end never stops it (founder dogfood 2026-10-20: "scrolling stopped it").
 *
 * Half-duplex: no utterance that STARTS while TTS plays or within the 750 ms tail is forwarded. Barge-in: VAD
 * speech ≥ 300 ms during playback (or the PTT hotkey pressed) stops playback and drops the rest of the reply; the
 * speech that barged in is not forwarded — only a full utterance that starts after playback + tail is.
 *
 * Modes: OFF / PTT / AMBIENT. The human's attachment mode (status.voice.attached.mode) is the CEILING; the client
 * may narrow locally (setMode), never widen. Unknown speakers: the row carries no text (textWithheld: true; the
 * kernel stores no text for spk:unknown-N under V2a) and nothing is sent — except Dictate (G-VOX-06 exception, spec
 * §14.7): an AMBIENT turn under an ambient ceiling whose send ceiling is 'key' (status.voice.send) carries its text,
 * and when the kernel answers draftOnly it ends captured (the GUI shows it in the draft marked "unverified voice"; only
 * the human's Enter sends it; it never becomes the draft speaker). A refused unverified turn the kernel marks
 * cause 'too-short' ends dropped as refused{voice-speaker, too-short} ("too short to check it's you"). No audio is ever written to disk
 * (G-VOX-05): segments live in memory only for the STT and embedding calls.
 */
import { isSendWord, SEND_WORD_SHORT_MS, trialTakeText, type SendWord } from '@a-company/gnomon-contracts';
import { kernelSpeakable, sentences } from './speakable.js';
import { gatedSpeechMsOf, SpeakerVerifier, speakerScoreBucket, type VoicePrint } from './speaker.js';
import { withEarcon } from './earcon.js';
import { capPartial, LiveAgreement, PARTIAL_ANCHOR_MARGIN_MS, PARTIAL_FULL_WINDOW_MS, PARTIAL_GATE_MS, PARTIAL_MAX_SEGMENT_MS, PARTIAL_MAX_WINDOW_MS, PARTIAL_PREROLL_MS, PARTIAL_TAIL_WINDOW_MS, PARTIAL_TICK_MS, type PartialText } from './partials.js';
import type { AppendResult, AudioIO, PlaybackResult, KernelLink, KernelRefusal, PcmFrame, VadSegment, VoiceAttachment, VoiceEngines, VoiceLogger } from './types.js';
import { silentLogger } from './types.js';

export type ClientMode = 'off' | 'ptt' | 'ambient';
/** TD-2026-10-20-262: where a dictated turn goes — the GUI composer (default) or straight to the session. */
export type Delivery = 'composer' | 'direct';
export type DictationActivity = 'speaking' | 'transcribing' | 'idle';
/** T-2026-10-20-005 A1: the per-segment capture states (status.voice.capture.state). Closed. */
export const CAPTURE_STATES = ['idle', 'hearing', 'transcribing', 'captured', 'dropped'] as const;
export type CaptureState = (typeof CAPTURE_STATES)[number];
/** Why a segment was not captured (status.voice.capture.reason). Closed; the kernel refuses any other value. */
export const CAPTURE_DROP_REASONS = ['too-short', 'echo', 'not-attached', 'no-words', 'not-enrolled', 'barge-in', 'refused', 'mic-off'] as const;
export type CaptureDropReason = (typeof CAPTURE_DROP_REASONS)[number];
/** voice drops fix: on reason 'refused', the kernel's verdict (a voice-* refusal reason) and its V2a cause */
export interface CaptureRefusal {
  refusal?: string;
  cause?: string;
}
const VOICE_REFUSAL = /^voice-[a-z-]{1,40}$/;
const REFUSAL_CAUSE = /^[a-z][a-z-]{0,31}$/;
/** The kernel's refusal as capture fields (only well-formed names; anything else is left out, never invented). */
export function captureRefusalOf(reason: unknown, cause?: unknown): CaptureRefusal {
  if (typeof reason !== 'string' || !VOICE_REFUSAL.test(reason)) return {};
  return { refusal: reason, ...(typeof cause === 'string' && REFUSAL_CAUSE.test(cause) ? { cause } : {}) };
}
export interface CaptureReport extends CaptureRefusal {
  state: CaptureState;
  segId: string;
  reason?: CaptureDropReason;
  /** mic level 0..1, hearing reports only (A2) */
  level?: number;
  /**
   * B1 live words: hearing / transcribing reports only, and only after a provisional speaker match (V1). Display
   * only: the kernel keeps it in memory for the gui credential; it is never a row, a turn or a send.
   */
  text?: PartialText;
}

/** B1 counters (tests and the bench): decodes run, ticks skipped because a decode was in flight, gate verdicts. */
export interface PartialStats {
  decodes: number;
  skipped: number;
  gatedIn: number;
  gatedOut: number;
}

/** The open segment's audio for live words (memory only, G-VOX-05) and its agreement state. */
interface LiveSeg {
  segId: string;
  buf: Float32Array;
  n: number;
  sr: number;
  sinceTickMs: number;
  /** V1: no words until a provisional speaker match; 'reject' ⇒ no words for the whole segment */
  gate: 'pending' | 'match' | 'reject';
  agree: LiveAgreement;
  /** the window head (a sample index into buf), moved only to a committed word boundary */
  anchor: number;
  text: PartialText | null;
  /** the segment left hearing: no more decodes; a decode still in flight is discarded */
  closed: boolean;
}
/** non-terminal capture reports are sent at most this often (≤ 5 Hz); terminal ones always */
export const CAPTURE_REPORT_MIN_MS = 200;
/** a hearing segment re-reports at least this often so the kernel's short capture TTL never expires a live one */
export const CAPTURE_KEEPALIVE_MS = 1_000;
/** dBFS → 0..1: -60 dBFS (and quieter) is 0, 0 dBFS is 1, two decimals */
export function levelOf(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.round(Math.min(1, Math.max(0, (db + 60) / 60)) * 100) / 100;
}
const isTerminal = (s: CaptureState): boolean => s === 'captured' || s === 'dropped' || s === 'idle';
const RANK: Record<ClientMode, number> = { off: 0, ptt: 1, ambient: 2 };

export const ECHO_TAIL_MS = 750;
export const BARGE_IN_MS = 300;
/**
 * A barge-in frame must be LOUD as well as VAD speech: the VAD's latched state (min-speech/min-silence hangover) can
 * stay "speech" across transient noise (clicks, a trackpad, residual echo), so a quieter frame resets the run.
 */
export const BARGE_IN_MIN_DBFS = -42;
/** while a reply is being spoken the status re-read (the GUI ⏹ path) runs at this cadence (run.ts) */
export const SPEAKING_POLL_MS = 300;

/** Per-reply latency (ms from the kernel row's receipt), the first sentence only. */
export interface SpeechLatency {
  /** row received → its first sentence's synthesis started (queueing behind an earlier reply or the warm-up) */
  queuedMs: number;
  /** first-sentence synthesis */
  synthMs: number;
  /** play() called → audible (the binary's playback.start audibleAt) */
  toAudibleMs: number;
  /** row received → audible */
  totalMs: number;
  /** sentences played for this reply */
  sentences: number;
}

type Audio = { samples: Float32Array; sampleRate: number };
/** Who speaks a queued sentence (table talk S4): the model's words, or the kernel's own in the system voice. */
type SpeakVoice = 'model' | 'system';
interface SpeakItem {
  sentence: string;
  voice: SpeakVoice;
  /** play the system earcon right before this sentence (the first sentence of a system item) */
  earcon: boolean;
}
interface SynthJob {
  sentence: string;
  audio: Promise<Audio>;
  t0: number;
  t1?: number;
}

function frameDbfs(f: PcmFrame): number {
  let sum = 0;
  for (let i = 0; i < f.samples.length; i++) sum += f.samples[i]! * f.samples[i]!;
  const rms = Math.sqrt(sum / Math.max(1, f.samples.length));
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}
const hr = (): number => Number(process.hrtime.bigint()) / 1e6;
export const MIN_UTTERANCE_MS = 250;
const WINDOW_KEEP = 64;
/** dictation activity: an open VAD utterance with no speech for this long is treated as ended */
const VAD_OPEN_MAX_SILENCE_MS = 2_000;

/** The kernel's mode names: V1 calls continuous listening 'conversation'; V2a may add 'ambient'. */
export interface WireModes {
  ptt: string;
  ambient: string;
}
export const V1_WIRE_MODES: WireModes = { ptt: 'ptt', ambient: 'conversation' };

/** The human's ceiling as a client mode (unknown names fail closed to off). */
export function ceilingOf(a: VoiceAttachment | null): ClientMode {
  if (!a) return 'off';
  if (a.mode === 'ptt') return 'ptt';
  if (a.mode === 'conversation' || a.mode === 'ambient') return 'ambient';
  return 'off';
}

export interface Notice {
  level: 'info' | 'warn';
  text: string;
  refusal?: KernelRefusal;
}

export interface VoiceClientOptions {
  audio: AudioIO;
  engines: VoiceEngines;
  link: KernelLink;
  /** the voice principal's namespace (`p:<ns>/voice` → ns): speakerIds are `spk:<ns>/<name>` */
  ns: string;
  prints: () => readonly VoicePrint[];
  mode?: ClientMode;
  wireModes?: WireModes;
  echoTailMs?: number;
  log?: VoiceLogger;
  notice?: (n: Notice) => void;
  now?: () => number;
  verifyThreshold?: number;
  /** TD-2026-10-20-262: default 'composer' (never session.send); 'direct' forwards each enrolled turn itself */
  delivery?: Delivery;
  /** B1 live words (default on when the STT engine has transcribeWords) */
  partials?: boolean;
  /**
   * TD-2026-10-21-514 capture kind: 'toggle' = the mic key turns ambient capture on and off, and the mic STARTS OFF
   * unless the kernel holds micWanted:true (unknown ⇒ off). 'ptt' / 'open' (default) keep the mic on at start.
   */
  capture?: 'ptt' | 'open' | 'toggle';
  /** TD-2026-10-21-514: the held send word (run.ts: <home>/voice/send-word.json); absent ⇒ no adjacency */
  sendWord?: () => SendWord | null;
  /** the word being taught (run.ts: <home>/voice/send-word-trial.json while live): each segment's short text is a take */
  sendWordTrial?: () => SendWord | null;
}

/** The one notice for a print from an older speaker front end (it is ignored until the speaker enrols again). */
export const STALE_PRINT_NOTICE = 'Re-teach Gnomon your voice (the voice check was upgraded)';
/** The drop notice when the speaker went unrecognised while a stale print exists (distinct from the plain "not enrolled"). */
export const STALE_DROP_NOTICE = 'Nothing was sent: your voice print is from the older voice check. Re-teach Gnomon your voice.';

export function toRefusal(err: unknown): KernelRefusal {
  const e = err as { code?: unknown; reason?: unknown; message?: unknown; refusal?: { code?: unknown; data?: { reason?: unknown } }; data?: { reason?: unknown } };
  const code = typeof e?.refusal?.code === 'string' ? e.refusal.code : typeof e?.code === 'string' ? e.code : 'ERROR';
  const reason = typeof e?.refusal?.data?.reason === 'string' ? e.refusal.data.reason : typeof e?.data?.reason === 'string' ? e.data.reason : typeof e?.reason === 'string' ? e.reason : 'unknown';
  return { code, reason, message: typeof e?.message === 'string' ? e.message : String(err) };
}

const FRIENDLY: Record<string, string> = {
  'voice-target': 'Voice is not attached to that session. Attach it from Gnomon first.',
  'voice-conn': 'Another voice client is already connected.',
  'voice-stale-utterance': 'That utterance was too old or already sent; say it again.',
  'voice-speaker': 'Only enrolled speakers are sent to the session.',
  'voice-grammar': 'That sounded like a decision or a command; voice never approves anything.',
  'voice-echo': 'That started while I was speaking, so it was not sent.',
  'voice-off': 'This attachment does not allow that mode.',
  'voice-busy': 'The session is busy; wait for it to finish.',
};

function turnStamp(prefix: string, ms: number, n: number): string {
  return `${prefix}${String(Math.max(0, Math.floor(ms))).padStart(13, '0')}-${String(n % 10_000).padStart(4, '0')}`;
}

export class VoiceClient {
  readonly #o: VoiceClientOptions;
  readonly #log;
  readonly #flow;
  readonly #now: () => number;
  readonly #tail: number;
  readonly #wire: WireModes;
  readonly #verifier: SpeakerVerifier;
  #spokenTurns = new Set<string>();
  #requested: ClientMode;
  #attachment: VoiceAttachment | null = null;
  #unfollow: (() => void) | undefined;
  #offs: Array<() => void> = [];
  // capture state
  #pttHeld = false;
  #pttFrames: PcmFrame[] = [];
  #pttT0 = 0;
  // playback state
  #playing: { t0: number } | null = null;
  /** playback windows; `barged`: the human cut this chunk off (a capture drop inside it is 'barge-in', not 'echo') */
  #windows: Array<{ t0: number; t1: number; barged?: boolean }> = [];
  #speechRunMs = 0;
  #bargedIn = false;
  #speakQueue: SpeakItem[] = [];
  #speaking: Promise<void> = Promise.resolve();
  /** bumped by every stop: a synthesis or prefetch of an older generation is dropped, never played */
  #speechGen = 0;
  /** TTS calls are serialized (one model handle; the warm-up first) */
  #ttsChain: Promise<unknown> = Promise.resolve();
  #speechOn = false;
  #stopSeq: number | null = null;
  #lastLatency: SpeechLatency | null = null;
  #stops = 0;
  #following = false;
  // serial utterance processing
  #work: Promise<void> = Promise.resolve();
  #turnN = 0;
  #lastTurnMs = 0;
  /** TD-2026-10-21-514: the last enrolled speaker whose turn the kernel accepted (the draft speaker for adjacency) */
  #draftSpeaker: string | null = null;
  #agentN = 0;
  #lastAgentMs = 0;
  #closed = false;
  #refreshed = false;
  #paused = false;
  // dictation (TD-2026-10-20-262)
  readonly #delivery: Delivery;
  #activity: DictationActivity = 'idle';
  #holdToggles = 0;
  /** TD-2026-10-21-514: send-now hotkey presses (⌃⌥Return; the GUI sends its draft on a change: a hand origin) */
  #sendNows = 0;
  /** bumped on every mic off: a segment captured under an older epoch is discarded (in-flight audio) */
  #micEpoch = 0;
  /** the stale-print names last reported (JSON; null before the first report) */
  #staleReported: string | null = null;
  #staleNoticed = false;
  #pending = 0;
  #vadSpeaking = false;
  #vadLastSpeech = 0;
  #reports: Promise<void> = Promise.resolve();
  // capture (T-2026-10-20-005 A1): the live (hearing) segment, the last level, the ≤ 5 Hz throttle
  #capN = 0;
  #cap: { segId: string; state: CaptureState } | null = null;
  #lastCapture: CaptureReport | null = null;
  #level = 0;
  #capLastSent = -Infinity;
  #capPending: CaptureReport | null = null;
  #capTimer: ReturnType<typeof setTimeout> | undefined;
  /** Aegis L4: capture reports waiting on the #reports chain; a waiting non-terminal one is replaced, never queued behind */
  #capQueue: CaptureReport[] = [];
  // B1 live words (T-2026-10-20-005): pre-roll ring, the open segment, ONE decode in flight (a busy tick is skipped)
  #preroll: PcmFrame[] = [];
  #prerollMs = 0;
  #live: LiveSeg | null = null;
  #partialBusy = false;
  #partialJob: Promise<void> = Promise.resolve();
  /** final transcriptions running: a partial tick never competes with one */
  #sttBusy = 0;
  #partialStats: PartialStats = { decodes: 0, skipped: 0, gatedIn: 0, gatedOut: 0 };

  constructor(o: VoiceClientOptions) {
    this.#o = o;
    this.#log = (o.log ?? silentLogger).component('#gnomon-voice');
    this.#flow = (o.log ?? silentLogger).flow('$voice-turn');
    this.#now = o.now ?? Date.now;
    this.#tail = o.echoTailMs ?? ECHO_TAIL_MS;
    this.#wire = o.wireModes ?? V1_WIRE_MODES;
    this.#requested = o.mode ?? 'ptt';
    this.#verifier = new SpeakerVerifier(o.engines.speaker, o.prints, o.verifyThreshold);
    this.#delivery = o.delivery ?? 'composer';
  }

  get delivery(): Delivery {
    return this.#delivery;
  }
  /** the dictation activity last reported (an edge is reported only when it changes) */
  get activity(): DictationActivity {
    return this.#activity;
  }
  get holdToggles(): number {
    return this.#holdToggles;
  }

  /** ⌃⌥H: one more hold toggle, reported to the kernel (status.voice.dictation.holdToggles; the GUI acts on a change). */
  /** ⌃⌥Return send-now: counted and reported like holdToggles; the GUI sends the composer draft (hand origin). */
  sendNow(): number {
    this.#sendNows++;
    this.#flow.info('send now', { sendNows: this.#sendNows });
    this.#report();
    return this.#sendNows;
  }

  holdToggle(): number {
    this.#holdToggles++;
    this.#flow.info('hold toggled', { holdToggles: this.#holdToggles });
    this.#report();
    return this.#holdToggles;
  }

  /** Recompute the activity from the capture state; report on an edge only. */
  #recompute(): void {
    const speaking = !this.#paused && this.mode !== 'off' && (this.#pttHeld || (this.mode === 'ambient' && this.#vadSpeaking));
    const next: DictationActivity = speaking ? 'speaking' : this.#pending > 0 ? 'transcribing' : 'idle';
    if (next === this.#activity) return;
    this.#activity = next;
    this.#report();
  }

  /** the capture report last sent (null before the first segment) */
  get capture(): CaptureReport | null {
    return this.#lastCapture;
  }

  /** A new live segment is being heard (PTT key-down, AMBIENT VAD start). Returns its segId. */
  #beginHearing(): string {
    if (this.#cap?.state === 'hearing') return this.#cap.segId;
    const segId = `s${++this.#capN}`;
    this.#cap = { segId, state: 'hearing' };
    this.#openLive(segId);
    this.#capture({ state: 'hearing', segId });
    return segId;
  }

  /** The live segment's id when it is being heard (and clears it); a segment arriving with none gets a fresh id. */
  #takeLive(): string {
    const live = this.#cap?.state === 'hearing' ? this.#cap.segId : `s${++this.#capN}`;
    this.#cap = null;
    if (this.#live) this.#live.closed = true; // no more partial decodes; its last words ride the transcribing report
    return live;
  }

  /** End a segment: dropped{reason}, captured, or idle (abandoned by a mode change or pause). Always sent. */
  #endCapture(segId: string, state: 'captured' | 'dropped' | 'idle', reason?: CaptureDropReason, why: CaptureRefusal = {}): void {
    if (this.#cap?.segId === segId) this.#cap = null;
    if (this.#live?.segId === segId) this.#live = null; // the segment's audio and words go with it
    const refusal = state === 'dropped' && reason === 'refused' ? why : {};
    if (state === 'dropped') this.#flow.info('capture dropped', { segId, reason, ...refusal });
    this.#capture({ state, segId, ...(state === 'dropped' && reason ? { reason } : {}), ...refusal });
  }

  /** Abandon a live hearing segment: dropped{reason} (a detach, a barge-in) or idle (a mode change, a pause). */
  #abandonLive(reason?: CaptureDropReason): void {
    const live = this.#cap;
    if (!live || live.state !== 'hearing') return;
    this.#endCapture(live.segId, reason ? 'dropped' : 'idle', reason);
  }

  /** Throttled report: terminal states go now; others ≤ 5 Hz, the latest pending one wins. */
  #capture(r: CaptureReport): void {
    if (this.#closed) return;
    if (isTerminal(r.state)) {
      this.#capPending = null;
      if (this.#capTimer) clearTimeout(this.#capTimer);
      this.#capTimer = undefined;
      this.#sendCapture(r);
      // a later segment is still being heard: put it back in the slot (throttled)
      const live = this.#cap;
      if (live?.state === 'hearing' && live.segId !== r.segId) this.#capture({ state: 'hearing', segId: live.segId });
      return;
    }
    const since = this.#now() - this.#capLastSent;
    if (since >= CAPTURE_REPORT_MIN_MS) {
      this.#capPending = null;
      if (this.#capTimer) clearTimeout(this.#capTimer);
      this.#capTimer = undefined;
      this.#sendCapture(r);
      return;
    }
    this.#capPending = r;
    this.#capTimer ??= setTimeout(() => this.#flushCapture(), Math.max(0, Math.min(CAPTURE_REPORT_MIN_MS, CAPTURE_REPORT_MIN_MS - since)));
  }

  #flushCapture(): void {
    if (this.#capTimer) clearTimeout(this.#capTimer);
    this.#capTimer = undefined;
    const p = this.#capPending;
    this.#capPending = null;
    if (p && !this.#closed) this.#sendCapture(p);
  }

  /** request.voice.report{capture}, on the serialized #reports chain. A hearing report carries the latest level. */
  #sendCapture(r: CaptureReport): void {
    this.#capLastSent = this.#now();
    // B1: the live words ride hearing / transcribing reports only, and only once the speaker provisionally matched (V1)
    const text = r.state === 'hearing' || r.state === 'transcribing' ? this.#textFor(r.segId) : null;
    const capture: CaptureReport = r.state === 'hearing' ? { state: r.state, segId: r.segId, level: this.#level, ...(text ? { text } : {}) } : r.state === 'transcribing' ? { state: r.state, segId: r.segId, ...(text ? { text } : {}) } : { state: r.state, segId: r.segId, ...(r.reason ? { reason: r.reason } : {}), ...(r.refusal ? { refusal: r.refusal, ...(r.cause ? { cause: r.cause } : {}) } : {}) };
    this.#lastCapture = capture;
    // Aegis L4: a slow kernel never builds a backlog: the newest report replaces a waiting one of the same segment and
    // state (a level update or keepalive). A state change is queued, so every edge, and every terminal state, still
    // reaches the kernel in order; the queue is bounded by the segment's few edges.
    const q = this.#capQueue;
    const last = q[q.length - 1];
    if (last && !isTerminal(last.state) && last.state === capture.state && last.segId === capture.segId) {
      q[q.length - 1] = capture;
      return;
    }
    q.push(capture);
    this.#reports = this.#reports.then(async () => {
      const next = this.#capQueue.shift();
      if (!next) return;
      try {
        await this.#o.link.append('request.voice.report', { capture: next });
      } catch (err) {
        this.#log.warn('capture report not relayed', { reason: toRefusal(err).reason });
      }
    });
  }

  /** The binary's level event (dBFS, ~15 Hz): kept, and reported only while a segment is being heard (A2). */
  #onLevel(db: number): void {
    this.#level = levelOf(db);
    const live = this.#cap;
    if (live?.state === 'hearing' && !this.#paused && this.mode !== 'off') this.#capture({ state: 'hearing', segId: live.segId });
  }

  // ---- B1 live words (T-2026-10-20-005; V1–V5 in TD-2026-10-20-086; partials.ts) ---------------------------------

  /** decodes run, busy ticks skipped, gate verdicts */
  get partialStats(): PartialStats {
    return { ...this.#partialStats };
  }

  #partialsOn(): boolean {
    return this.#o.partials !== false && typeof this.#o.engines.stt.transcribeWords === 'function';
  }

  /** A segment opened: its buffer starts with the pre-roll ring (the VAD's start latency). */
  #openLive(segId: string): void {
    this.#live = null;
    if (!this.#partialsOn()) return;
    const sr = this.#preroll[0]?.sampleRate ?? this.#o.audio.captureSampleRate;
    const pre = this.#preroll.filter((f) => f.sampleRate === sr);
    const n = pre.reduce((s, f) => s + f.samples.length, 0);
    const buf = new Float32Array(Math.max(n, sr * 4));
    let off = 0;
    for (const f of pre) (buf.set(f.samples, off), (off += f.samples.length));
    this.#live = { segId, buf, n, sr, sinceTickMs: 0, gate: 'pending', agree: new LiveAgreement(), anchor: 0, text: null, closed: false };
  }

  /** Keep the last PARTIAL_PREROLL_MS of frames (memory only). */
  #keepPreroll(f: PcmFrame): void {
    if (!this.#partialsOn()) return;
    this.#preroll.push(f);
    this.#prerollMs += (f.samples.length / f.sampleRate) * 1000;
    while (this.#preroll.length > 1 && this.#prerollMs - (this.#preroll[0]!.samples.length / this.#preroll[0]!.sampleRate) * 1000 >= PARTIAL_PREROLL_MS) {
      const old = this.#preroll.shift()!;
      this.#prerollMs -= (old.samples.length / old.sampleRate) * 1000;
    }
  }

  /** A frame of the open segment: buffer it; every PARTIAL_TICK_MS of heard audio, one tick. */
  #feedLive(f: PcmFrame): void {
    const p = this.#live;
    if (!p || p.closed || this.#cap?.segId !== p.segId || this.#cap.state !== 'hearing') return;
    if (f.sampleRate !== p.sr || p.n + f.samples.length > (p.sr * PARTIAL_MAX_SEGMENT_MS) / 1000) {
      p.closed = true; // a route change or a very long segment: no more live words (the final decode is unaffected)
      return;
    }
    if (p.n + f.samples.length > p.buf.length) {
      const grown = new Float32Array(Math.max(p.buf.length * 2, p.n + f.samples.length));
      grown.set(p.buf.subarray(0, p.n));
      p.buf = grown;
    }
    p.buf.set(f.samples, p.n);
    p.n += f.samples.length;
    p.sinceTickMs += (f.samples.length / f.sampleRate) * 1000;
    if (p.sinceTickMs < PARTIAL_TICK_MS) return;
    p.sinceTickMs -= PARTIAL_TICK_MS;
    this.#partialTick(p);
  }

  /** ONE decode in flight: a tick that finds one running (or a final transcription) is skipped, never queued. */
  #partialTick(p: LiveSeg): void {
    if (p.gate === 'reject') return;
    if (this.#partialBusy || this.#sttBusy > 0) {
      this.#partialStats.skipped++;
      return;
    }
    this.#partialBusy = true;
    this.#partialJob = this.#runPartial(p)
      .catch((err) => this.#log.warn('live words failed', { error: err instanceof Error ? err.message : String(err) }))
      .finally(() => {
        this.#partialBusy = false;
      });
  }

  async #runPartial(p: LiveSeg): Promise<void> {
    const stt = this.#o.engines.stt;
    if (!stt.transcribeWords) return;
    const ms = (x: number): number => Math.round((p.sr * x) / 1000);
    if (p.gate === 'pending') {
      if (p.n < ms(PARTIAL_GATE_MS)) return;
      // V1: a provisional CAM++ match on the first 1.5 s; a non-match means no words for this whole segment (PTT too)
      const ok = await this.#verifier.provisional(p.buf.slice(0, ms(PARTIAL_GATE_MS)), p.sr);
      if (this.#live !== p) return;
      p.gate = ok ? 'match' : 'reject';
      this.#partialStats[ok ? 'gatedIn' : 'gatedOut']++;
      this.#flow.info('live words gate', { segId: p.segId, match: ok });
      if (!ok || p.closed) return;
    }
    const total = p.n;
    if (!(p.anchor === 0 && total <= ms(PARTIAL_FULL_WINDOW_MS)) && total - p.anchor > ms(PARTIAL_TAIL_WINDOW_MS)) {
      // move the head to a committed word boundary: the smallest that leaves ≤ the tail window, else the latest one
      const cands = p.agree.boundaries().map((b) => ({ b, at: Math.max(p.anchor, p.anchor + Math.floor(b.start * p.sr) - ms(PARTIAL_ANCHOR_MARGIN_MS)) }));
      const pick = cands.find((c) => total - c.at <= ms(PARTIAL_TAIL_WINDOW_MS)) ?? cands[cands.length - 1];
      if (pick && pick.at > p.anchor) {
        p.agree.reanchor(pick.b);
        p.anchor = pick.at;
      }
    }
    if (total - p.anchor > ms(PARTIAL_MAX_WINDOW_MS)) return; // no boundary to anchor at: the line stays as it is
    this.#partialStats.decodes++;
    const words = await stt.transcribeWords(p.buf.slice(p.anchor, total), p.sr);
    if (this.#live !== p || p.closed) return; // the segment ended under us: discarded
    p.text = capPartial(p.agree.push(words));
    if (this.#cap?.segId === p.segId && this.#cap.state === 'hearing') this.#capture({ state: 'hearing', segId: p.segId });
  }

  /** V1/V4: the words for a report of `segId` — only for the open segment, only after a provisional match. */
  #textFor(segId: string): PartialText | null {
    const p = this.#live;
    if (!p || p.segId !== segId || p.gate !== 'match' || !p.text || (!p.text.committed && !p.text.tail)) return null;
    return { committed: p.text.committed, tail: p.text.tail };
  }

  /** request.voice.report{dictation}, serialized so holdToggles reaches the kernel in order (monotone). */
  #report(): void {
    const dictation = { activity: this.#activity, holdToggles: this.#holdToggles, sendNows: this.#sendNows, micWanted: this.#o.audio.micOn };
    this.#reports = this.#reports.then(async () => {
      try {
        await this.#o.link.append('request.voice.report', { dictation });
      } catch (err) {
        this.#log.warn('dictation report not relayed', { reason: toRefusal(err).reason });
      }
    });
  }

  get attachment(): VoiceAttachment | null {
    return this.#attachment;
  }
  get playing(): boolean {
    return this.#playing !== null;
  }
  /** a reply is being spoken (synthesizing or playing, until its queue drains or is stopped) */
  get speaking(): boolean {
    return this.#speechOn;
  }
  get lastLatency(): SpeechLatency | null {
    return this.#lastLatency;
  }
  /** explicit stops made by the human (hotkey, GUI request) */
  get stops(): number {
    return this.#stops;
  }
  /** The mode in force: the requested mode narrowed to the human's ceiling. */
  get mode(): ClientMode {
    const c = ceilingOf(this.#attachment);
    return RANK[this.#requested] <= RANK[c] ? this.#requested : c;
  }
  get ceiling(): ClientMode {
    return ceilingOf(this.#attachment);
  }

  async start(): Promise<void> {
    const a = this.#o.audio;
    this.#offs.push(
      a.on('frame', (f) => this.#onFrame(f)),
      a.on('hotkey', (down, at) => this.#onHotkey(down, at)),
      a.on('level', (db) => this.#onLevel(db)),
      a.on('closed', (reason) => this.#notice('warn', `Audio stopped: ${reason}`)),
      a.on('control', (action) => void (action === 'mic-toggle' ? this.toggleMic() : action === 'mic-off' ? this.setMicWanted(false) : action === 'send-now' ? this.sendNow() : action === 'hold-toggle' ? this.holdToggle() : action === 'stop-speaking' ? this.stopSpeaking('hotkey') : this.toggleAmbient())),
    );
    await a.start();
    // toggle capture starts off (no report: the kernel's micWanted, read below, may turn it back on)
    if (this.#o.capture === 'toggle' && a.micOn) {
      this.#micEpoch++;
      await a.setMic(false).catch(() => undefined);
    }
    await this.#reportPrints();
    // warm the TTS once (off the critical path; the first reply's synthesis queues behind it, never in parallel)
    const tts = this.#o.engines.tts;
    if (tts.warmUp) {
      const t0 = hr();
      void this.#serialTts(() => tts.warmUp!()).then(
        () => this.#log.info('tts warm', { ms: Math.round(hr() - t0) }),
        (err) => this.#log.warn('tts warm-up failed', { error: err instanceof Error ? err.message : String(err) }),
      );
    }
    await this.refresh();
  }

  /** Re-read the attachment from status and (re)follow its session. */
  async refresh(): Promise<void> {
    let next: VoiceAttachment | null;
    let readFailed = false;
    try {
      next = await this.#o.link.attachment();
    } catch (err) {
      this.#refused(err, 'status');
      next = null;
      readFailed = true;
    }
    const changed = !this.#refreshed || next?.voiceSessionId !== this.#attachment?.voiceSessionId;
    this.#refreshed = true;
    const prev = this.#attachment;
    this.#attachment = next;
    if (!readFailed) {
      this.#checkStopSeq();
      this.#restoreMic();
      this.#checkMicSeq();
      void this.#applyMicKey();
    }
    // a detach (a SUCCESSFUL read with no or another attachment) stops speech; a failed read never does
    if (changed && prev && !readFailed) this.stopSpeaking('detach');
    // the same attachment whose follow ended (the kernel ends voice readers on any attachment change): follow again
    if (!changed) {
      if (next && !this.#unfollow && !this.#following && !this.#closed) await this.#follow(next);
      return;
    }
    this.#unfollow?.();
    this.#unfollow = undefined;
    this.#o.engines.vad.reset();
    if (!readFailed) this.#abandonLive('not-attached');
    if (!next) {
      this.#notice('info', 'Voice is not attached to a session. Attach it from Gnomon to talk.');
      return;
    }
    // the human's choice in Gnomon (the attachment's mode) is the mode in force for a new attachment; the
    // ⌃⌥A hotkey can still narrow it locally afterwards (founder dogfood 2026-10-19: ambient sat in ptt)
    this.#requested = ceilingOf(next);
    this.#notice('info', `Attached to ${next.hsid} (up to ${ceilingOf(next) === 'ambient' ? 'ambient' : 'push-to-talk'}). Mode: ${this.mode}.`);
    await this.#follow(next);
  }

  async #follow(a: VoiceAttachment): Promise<void> {
    this.#following = true;
    try {
      let off: (() => void) | undefined;
      off = await this.#o.link.follow(a.hsid, (r) => this.#onRow(r.kind, r.payload, r.principal), (reason) => {
        this.#log.info('follow ended', { reason });
        if (off === undefined || this.#unfollow === off) this.#unfollow = undefined;
        off = undefined;
        if (!this.#closed) void this.refresh();
      });
      this.#unfollow = off;
    } catch (err) {
      this.#refused(err, 'log.read');
    } finally {
      this.#following = false;
    }
  }

  /** TD-2026-10-21-514: the GUI's in-app ` shows up as a changed status count: toggle the mic. */
  #micSeq: number | null = null;
  #checkMicSeq(): void {
    const seq = this.#o.link.micToggleSeq?.() ?? null;
    if (seq === null) return;
    const before = this.#micSeq;
    this.#micSeq = seq;
    if (before !== null && seq !== before) void this.toggleMic();
  }

  /** The Mic key switch: bare ` (opt-in) or ⌃` for mic-toggle, re-bound on gnomon-voice-io when it changes. */
  #micKeyApplied: boolean | null = null;
  async #applyMicKey(): Promise<void> {
    const bare = this.#o.link.micKeyBare?.() ?? null;
    if (bare === null || bare === this.#micKeyApplied || !this.#o.audio.setHotkeys) return;
    this.#micKeyApplied = bare;
    try {
      await this.#o.audio.setHotkeys({ 'mic-toggle': bare ? '`' : 'ctrl+`' }, bare);
      if (bare) this.#notice('info', 'While Gnomon voice runs, ` will not type in any app.');
    } catch (err) {
      this.#micKeyApplied = null;
      this.#notice('warn', `The mic key was not changed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** TD-2026-10-21-514: once per client, a kernel-held micWanted:false keeps the mic off across a restart. */
  #micRestored = false;
  #restoreMic(): void {
    if (this.#micRestored) return;
    const w = this.#o.link.micWanted?.() ?? null;
    if (w === null) {
      if (this.#o.capture === 'toggle') this.#micRestored = true; // unknown ⇒ toggle capture stays off
      return;
    }
    this.#micRestored = true;
    if (w === false && this.#o.audio.micOn) void this.setMicWanted(false);
    if (w === true && !this.#o.audio.micOn && this.#o.capture === 'toggle') void this.setMicWanted(true);
  }

  /** The human's ⏹ (GUI button / Esc → request.voice.client{op:'stop-speaking'}) shows up as a changed status count. */
  #checkStopSeq(): void {
    const seq = this.#o.link.stopSpeakingSeq?.() ?? null;
    if (seq === null) return;
    const before = this.#stopSeq;
    this.#stopSeq = seq;
    if (before !== null && seq !== before) this.stopSpeaking('gui');
  }

  /**
   * Stop speaking NOW: the chunk playing stops (play.stop flushes the binary's queue), the rest of the reply and any
   * prefetched sentence are dropped. Returns whether anything was being said. Never touches capture or the kernel.
   */
  stopSpeaking(by: 'hotkey' | 'gui' | 'detach' | 'api' = 'api'): boolean {
    if (!this.#speechOn && !this.#playing && !this.#speakQueue.length) return false;
    this.#speechGen++;
    this.#speakQueue = [];
    if (by === 'hotkey' || by === 'gui') this.#stops++;
    this.#o.audio.stopPlayback();
    this.#flow.info('stopped speaking', { by });
    return true;
  }

  /** Local mode switch. Asking above the human's ceiling narrows to the ceiling (never widens). */
  setMode(m: ClientMode): ClientMode {
    this.#requested = m;
    this.#pttHeld = false;
    this.#pttFrames = [];
    this.#o.engines.vad.reset();
    this.#abandonLive();
    const eff = this.mode;
    if (RANK[m] > RANK[eff]) this.#notice('info', `The human allows up to ${eff === 'off' ? 'nothing (not attached)' : eff} here; using ${eff}.`);
    this.#vadSpeaking = false;
    this.#recompute();
    return eff;
  }

  /**
   * ⌃⌥M: toggle capture locally (mic.on / mic.off on gnomon-voice-io) with a status note. Never touches the
   * kernel: the attachment and its ceiling are the human's.
   */
  async toggleMic(): Promise<boolean> {
    return this.setMicWanted(!this.#o.audio.micOn);
  }

  /**
   * TD-2026-10-21-514: the mic on or off. Off tears capture down and DISCARDS in-flight audio (an open segment ends
   * dropped 'mic-off'); the wanted state is reported to the kernel (request.voice.report{dictation.micWanted}), which
   * holds it across client restarts (status.voice.micWanted; restored at start).
   */
  async setMicWanted(on: boolean): Promise<boolean> {
    if (on === this.#o.audio.micOn) return on;
    if (!on) this.#micEpoch++; // first, so a segment already in the STT is discarded too
    try {
      await this.#o.audio.setMic(on);
    } catch (err) {
      this.#notice('warn', `Could not turn the mic ${on ? 'on' : 'off'}: ${err instanceof Error ? err.message : String(err)}`);
      return this.#o.audio.micOn;
    }
    if (!on) {
      this.#pttHeld = false;
      this.#pttFrames = [];
      this.#o.engines.vad.reset();
      // in-flight audio is discarded: an open (hearing) segment ends dropped mic-off, its audio and words with it
      const seg = this.#cap?.state === 'hearing' ? this.#cap.segId : this.#live?.segId;
      if (seg !== undefined) this.#endCapture(seg, 'dropped', 'mic-off');
      this.#live = null;
    }
    this.#flow.info('mic toggled', { on });
    this.#report();
    const said = on ? 'Mic on.' : 'Mic off · ⌃` to listen';
    this.#notice('info', said);
    await this.relayNotice(said, on ? 'mic-on' : 'mic-off');
    return on;
  }

  /**
   * ⌃⌥A: ambient ↔ push-to-talk, LOCAL and only within the human's ceiling. Ambient → ptt narrows; ptt → ambient
   * re-widens only when the ceiling is ambient. The voice principal cannot change the attachment mode (the kernel
   * refuses it), so above the ceiling this does nothing but say so and relay a notice the GUI can show.
   */
  async toggleAmbient(): Promise<ClientMode> {
    const eff = this.mode;
    const ceiling = this.ceiling;
    if (eff === 'ambient') return this.setMode('ptt');
    if (eff === 'ptt' && ceiling === 'ambient') return this.setMode('ambient');
    const text = ceiling === 'off' ? 'Voice is not attached. Open Gnomon to attach it.' : 'Ambient listening is off for this session. Open Gnomon to turn on ambient.';
    this.#notice('info', text);
    await this.relayNotice(text, 'ambient-above-ceiling');
    return eff;
  }

  /**
   * V2e: a notice for the GUI's quiet toast, relayed with `request.voice.report{notice: {text, code}}` (the kernel
   * holds it in memory as status.voice.notice; never a log row). A refusal is logged here and otherwise ignored.
   */
  async relayNotice(text: string, code: string): Promise<void> {
    try {
      await this.#o.link.append('request.voice.report', { notice: { text, code } });
    } catch (err) {
      this.#log.warn('client notice not relayed', { code, reason: toRefusal(err).reason });
    }
  }

  /**
   * Stale prints (founder regression 2026-10-20): a print made before the speech gate (no or another frontEnd) is never
   * compared, so its speaker counts as NOT enrolled until they enrol again. The names go to the kernel as
   * `request.voice.report{prints: {stale}}` when the list changes (status.voice.prints; the GUI nudges "Re-teach Gnomon
   * your voice"), and ONE notice says so per run. Returns the current stale names.
   */
  async #reportPrints(): Promise<string[]> {
    let stale: string[];
    try {
      stale = this.#verifier.stalePrints();
    } catch {
      return [];
    }
    const key = JSON.stringify(stale);
    if (key !== this.#staleReported) {
      this.#staleReported = key;
      try {
        await this.#o.link.append('request.voice.report', { prints: { stale } });
      } catch (err) {
        // not retried until the list changes (an older kernel refuses the key; the notice below still shows)
        this.#log.warn('prints report not relayed', { reason: toRefusal(err).reason });
      }
    }
    if (stale.length && !this.#staleNoticed) {
      this.#staleNoticed = true;
      this.#log.info('stale voice prints', { names: stale.length });
      this.#notice('warn', STALE_PRINT_NOTICE);
      await this.relayNotice(STALE_PRINT_NOTICE, 'voice.print-stale');
    }
    return stale;
  }

  /** V2e: pause the voice loop (an enrolment is recording: its phrases are never turns). */
  pause(on: boolean): void {
    this.#paused = on;
    if (on) this.#abandonLive();
    else void this.#reportPrints(); // an enrolment just ended: a fresh print may replace a stale one
    this.#pttHeld = false;
    this.#pttFrames = [];
    this.#o.engines.vad.reset();
    this.#vadSpeaking = false;
    this.#recompute();
  }

  /** Wait until queued utterances and speech are done (tests, shutdown). */
  async idle(): Promise<void> {
    this.#flushCapture();
    let w: Promise<void> | undefined;
    let s: Promise<void> | undefined;
    let r: Promise<void> | undefined;
    let p: Promise<void> | undefined;
    while (w !== this.#work || s !== this.#speaking || r !== this.#reports || p !== this.#partialJob) {
      w = this.#work;
      s = this.#speaking;
      r = this.#reports;
      p = this.#partialJob;
      await Promise.all([w, s, r, p]);
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    if (this.#capTimer) clearTimeout(this.#capTimer);
    this.#capTimer = undefined;
    this.#capPending = null;
    this.#unfollow?.();
    for (const off of this.#offs) off();
    this.#o.audio.stopPlayback();
    await this.idle().catch(() => undefined);
    await this.#o.audio.close();
  }

  // ---- capture -------------------------------------------------------------------------------------------------

  #onHotkey(down: boolean, at: number): void {
    if (this.mode === 'off' || this.#paused) {
      // released after a detach: the held segment is not sent
      if (!down && this.mode === 'off') this.#abandonLive('not-attached');
      return;
    }
    if (down) {
      if (this.#playing) this.#bargeIn('hotkey');
      this.#pttHeld = true;
      this.#pttFrames = [];
      this.#pttT0 = at;
      if (this.mode === 'ptt') this.#beginHearing(); // PTT: key-down is hearing
      this.#recompute();
      return;
    }
    if (!this.#pttHeld) return;
    this.#pttHeld = false;
    const frames = this.#pttFrames;
    this.#pttFrames = [];
    if (this.mode !== 'ptt') return this.#recompute();
    if (!frames.length) {
      this.#endCapture(this.#takeLive(), 'dropped', 'too-short');
      return this.#recompute();
    }
    const sr = frames[0]!.sampleRate;
    const n = frames.reduce((s, f) => s + f.samples.length, 0);
    const samples = new Float32Array(n);
    let off = 0;
    for (const f of frames) {
      samples.set(f.samples, off);
      off += f.samples.length;
    }
    const t0 = frames[0]!.t0;
    this.#segment({ samples, sampleRate: sr, t0, t1: t0 + (n / sr) * 1000 }, this.#pttT0);
    this.#recompute();
  }

  #onFrame(f: PcmFrame): void {
    const mode = this.mode;
    if (mode === 'off' || this.#paused) return;
    if (mode === 'ptt' && this.#pttHeld) this.#pttFrames.push(f);
    // B1: the pre-roll ring, then the open segment's buffer (a segment opened by THIS frame already has it in its pre-roll)
    this.#keepPreroll(f);
    this.#feedLive(f);
    // keep a long live segment fresh in the kernel (its capture TTL is short)
    const live = this.#cap;
    if (live?.state === 'hearing' && this.#now() - this.#capLastSent >= CAPTURE_KEEPALIVE_MS) this.#capture({ state: 'hearing', segId: live.segId });
    // VAD runs in AMBIENT (segmentation) and during playback in any mode (barge-in)
    if (mode !== 'ambient' && !this.#playing) return;
    const segs = this.#o.engines.vad.accept(f);
    if (this.#playing && !this.#bargedIn) {
      const ms = (f.samples.length / f.sampleRate) * 1000;
      // only LOUD VAD speech counts; a quieter frame resets the run (transient noise is not a barge-in)
      this.#speechRunMs = this.#o.engines.vad.speaking() && frameDbfs(f) >= BARGE_IN_MIN_DBFS ? this.#speechRunMs + ms : 0;
      if (this.#speechRunMs >= BARGE_IN_MS) this.#bargeIn('speech');
    }
    if (mode === 'ambient') {
      for (const s of segs) this.#segment(s);
      // speaking from VAD start until its segment closes (the hangover silence is still the utterance), bounded
      // by VAD_OPEN_MAX_SILENCE_MS in case the VAD drops a segment without emitting it
      if (this.#o.engines.vad.speaking()) {
        this.#vadSpeaking = true;
        this.#vadLastSpeech = f.t0;
      } else if (segs.length || f.t0 - this.#vadLastSpeech > VAD_OPEN_MAX_SILENCE_MS) {
        this.#vadSpeaking = false;
        // the VAD lost an open utterance without emitting it: nothing is being heard any more
        if (!segs.length) this.#abandonLive();
      }
      // AMBIENT: VAD start is hearing (also the speech that follows a barge-in drop)
      if (this.#o.engines.vad.speaking() && this.#cap?.state !== 'hearing') this.#beginHearing();
      this.#recompute();
    }
  }

  /** Inside our playback or its tail (the client mirror of the kernel's voice-echo guard). */
  /** Which echo guard `t` falls in: 'barge-in' when it is the reply the human cut off, 'echo' otherwise, or null. */
  #echoOf(t: number): 'echo' | 'barge-in' | null {
    if (this.#playing && t >= this.#playing.t0) return this.#bargedIn ? 'barge-in' : 'echo';
    const w = this.#windows.find((x) => t >= x.t0 && t <= x.t1 + this.#tail);
    return w ? (w.barged ? 'barge-in' : 'echo') : null;
  }

  #segment(seg: VadSegment, pressedAt?: number): void {
    const segId = this.#takeLive();
    const dur = seg.t1 - seg.t0;
    // the echo guard first: a fragment inside our playback (or the reply the human cut off) says why, not its length
    const startedAt = pressedAt ?? seg.t0;
    const echo = this.#echoOf(startedAt) ?? this.#echoOf(seg.t0);
    if (echo) {
      this.#flow.info('utterance dropped (playback or echo tail)', { t0: seg.t0, ms: Math.round(dur) });
      return this.#endCapture(segId, 'dropped', echo);
    }
    if (dur < MIN_UTTERANCE_MS) return this.#endCapture(segId, 'dropped', 'too-short');
    const a = this.#attachment;
    const mode = this.mode;
    if (!a || mode === 'off') {
      this.#flow.info('utterance dropped (not attached)', { ms: Math.round(dur) });
      return this.#endCapture(segId, 'dropped', 'not-attached');
    }
    this.#capture({ state: 'transcribing', segId });
    let ended = false;
    const end = (state: 'captured' | 'dropped', reason?: CaptureDropReason, why?: CaptureRefusal): void => {
      if (ended) return;
      ended = true;
      this.#endCapture(segId, state, reason, why);
    };
    this.#pending++;
    this.#recompute();
    const epoch = this.#micEpoch; // TD-2026-10-21-514: a mic-off while this segment is in flight discards it
    this.#work = this.#work
      .then(() => (this.#micEpoch !== epoch ? end('dropped', 'mic-off') : this.#utterance(seg, a, mode as 'ptt' | 'ambient', end, epoch)))
      .catch((err) => {
        this.#log.warn('utterance failed', { error: err instanceof Error ? err.message : String(err) });
        end('dropped', 'no-words'); // the STT or the verifier failed: no words came out of it
      })
      .finally(() => {
        // idle after the append (or the drop): the edge is reported once nothing is pending
        this.#pending--;
        this.#recompute();
      });
  }

  async #utterance(seg: VadSegment, a: VoiceAttachment, mode: 'ptt' | 'ambient', end: (state: 'captured' | 'dropped', reason?: CaptureDropReason, why?: CaptureRefusal) => void, epoch = this.#micEpoch): Promise<void> {
    // the final transcript is always the FULL-segment decode (never the live words)
    this.#sttBusy++;
    let text: string;
    try {
      text = (await this.#o.engines.stt.transcribe(seg.samples, seg.sampleRate)).trim();
    } finally {
      this.#sttBusy--;
    }
    if (!text) return end('dropped', 'no-words');
    if (this.#micEpoch !== epoch) return end('dropped', 'mic-off'); // the mic went off during the STT: discarded
    const who = await this.#verifier.identify(seg.samples, seg.sampleRate);
    // the stale list is re-read after every identify (reported only when it changed)
    const stale = await this.#reportPrints();
    // the samples are not kept past this point (G-VOX-05)
    if (this.#closed || this.#attachment?.voiceSessionId !== a.voiceSessionId) return end('dropped', 'not-attached'); // attachment moved under us
    // TD-2026-10-21-514 short words by adjacency: a segment too short to verify (an unknown speaker, never one
    // attributed to someone else) that IS the send word goes to the draft speaker; the kernel re-checks all of it
    const word = this.#o.sendWord?.() ?? null;
    // the attended trial ("Teach your send word", spec §14.7 trial semantics): no adjacency, whoever spoke; a take's
    // short text is sent so the kernel can count it (a take is never forwardable and never sends anything)
    const trial = (this.#o.sendWordTrial?.() ?? null) !== null;
    const adjacent = !trial && who.name === undefined && this.#draftSpeaker !== null && seg.t1 - seg.t0 < SEND_WORD_SHORT_MS && isSendWord(text, word);
    if (adjacent) text = word!.text;
    const enrolled = who.name !== undefined || adjacent;
    const takeText = trial && !enrolled ? trialTakeText(text) : null;
    // Dictate (G-VOX-06 exception, spec §14.7): an ambient turn under an ambient ceiling with send ceiling 'key' may fill
    // the draft unverified (a human's Enter sends it), so its words go to the kernel, which decides (draftOnly)
    const draftable = !enrolled && !trial && mode === 'ambient' && a.send === 'key' && a.mode !== 'ptt';
    const speakerId = adjacent ? this.#draftSpeaker! : enrolled ? `spk:${this.#o.ns}/${who.name}` : `spk:${who.unknownLabel}`;
    const ms = Math.max(this.#now(), this.#lastTurnMs);
    this.#lastTurnMs = ms;
    const turnId = turnStamp('u', ms, ++this.#turnN);
    const ri = this.#o.audio.routeInfo();
    // the aec claim from the binary's route/mic event (kind when known), plus its transport (V2b Aegis duty 4)
    const aec = ri.aecKind ?? ri.aec;
    // composer delivery: the client never forwards; the kernel stamps forwardable (TD-2026-10-20-262). TD-2026-10-20-125:
    // an ambient turn is never sent by the client, whatever the delivery (it fills the composer; a human sends it)
    const direct = this.#delivery === 'direct' && mode === 'ptt';
    // calibration (voice drops fix): the speaker score as a coarse bucket and the gated speech, numbers only
    const gatedMs = gatedSpeechMsOf(who.speechMs);
    const calib = { speakerScore: speakerScoreBucket(who.score), ...(gatedMs !== undefined ? { gatedSpeechMs: gatedMs } : {}) };
    const payload: Record<string, unknown> = { turnId, speakerId, speakerEnrolled: enrolled, forwarded: direct && enrolled, mode: this.#wireMode(mode, a), aec, ...(ri.transport ? { aecTransport: ri.transport } : {}), t0: Math.round(seg.t0), t1: Math.round(seg.t1), text: enrolled || draftable ? text : (takeText ?? ''), ...(enrolled || draftable || takeText !== null ? {} : { textWithheld: true }), ...(adjacent ? { speakerBasis: 'adjacent' } : {}), ...calib };
    let verdict: AppendResult;
    try {
      verdict = await this.#o.link.append('voice.turn.user', payload);
    } catch (err) {
      this.#refused(err, 'log.append');
      return end('dropped', 'refused', captureRefusalOf(toRefusal(err).reason));
    }
    this.#flow.info('turn logged', { turnId, speakerEnrolled: enrolled, mode: payload.mode, ...calib });
    // a take of the word being taught: the dialog shows it; nothing is sent and the draft speaker is unchanged
    if (verdict?.trialTake === true) {
      this.#flow.info('trial take counted', { turnId });
      return end('captured');
    }
    if (!enrolled && verdict?.draftOnly === true && verdict.refused === undefined) {
      // Dictate: in the draft, marked unverified; never the draft speaker (no adjacency anchor), never sent from here
      this.#flow.info('turn dictated unverified (composer)', { turnId });
      return end('captured');
    }
    if (!enrolled) {
      // too little gated speech to check the speaker: say so, never "not recognised" (the kernel's cause 'too-short')
      if (verdict?.refused === 'voice-speaker' && verdict.refusedCause === 'too-short') {
        this.#notice('info', "Too short to check it's you; nothing was sent.");
        return end('dropped', 'refused', captureRefusalOf(verdict.refused, verdict.refusedCause));
      }
      this.#notice('info', stale.length ? STALE_DROP_NOTICE : 'I heard someone who is not enrolled; nothing was sent.');
      return end('dropped', 'not-enrolled');
    }
    // voice drops fix: the kernel refused the turn at receipt (stored hash-only, never forwardable). The capture ends
    // as dropped with the kernel's reason, never as captured: the GUI says why instead of "Heard, not confirmed".
    if (verdict?.refused !== undefined) {
      this.#flow.info('turn refused at receipt', { turnId, refused: verdict.refused, ...(verdict.refusedCause ? { cause: verdict.refusedCause } : {}) });
      // voice-speaker is the not-enrolled drop (its own words); every other verdict rides reason 'refused' + refusal,
      // so the kernel's local-drop tally never counts a kernel refusal as a client-local drop
      return end('dropped', verdict.refused === 'voice-speaker' ? 'not-enrolled' : 'refused', captureRefusalOf(verdict.refused, verdict.refusedCause));
    }
    if (!adjacent) this.#draftSpeaker = speakerId; // a verified, accepted turn: its speaker is the draft speaker
    if (!direct) {
      this.#flow.info('turn dictated (composer)', { turnId });
      return end('captured');
    }
    try {
      await this.#o.link.send(a.hsid, text);
      this.#flow.info('turn sent', { turnId });
      this.#notice('info', `Sent: ${text}`);
      end('captured');
    } catch (err) {
      this.#refused(err, 'session.send'); // never retried blindly
      end('dropped', 'refused', captureRefusalOf(toRefusal(err).reason));
    }
  }

  /** The turn's mode claim in the kernel's vocabulary: V2a names continuous listening 'ambient', V1 'conversation'. */
  #wireMode(mode: 'ptt' | 'ambient', a: VoiceAttachment): string {
    if (mode === 'ptt') return this.#wire.ptt;
    return a.mode === 'ambient' || a.mode === 'conversation' ? a.mode : this.#wire.ambient;
  }

  // ---- speaking ------------------------------------------------------------------------------------------------

  #onRow(kind: string, payload: Record<string, unknown>, principal?: string): void {
    const items = kernelSpeakable(kind, payload, principal, this.#o.ns);
    if (!items.length) return;
    // a kernel-speakable row is said once per turnSeq (a re-follow after an attachment change replays rows)
    const key = typeof payload.turnSeq === 'number' || typeof payload.turnSeq === 'string' ? String(payload.turnSeq) : undefined;
    if (key !== undefined) {
      if (this.#spokenTurns.has(key)) return;
      this.#spokenTurns.add(key);
      if (this.#spokenTurns.size > 256) this.#spokenTurns.delete(this.#spokenTurns.values().next().value!);
    }
    const at = hr();
    for (const it of items) this.say(it.text, it.voice, at);
  }

  /**
   * Queue text to speak, one sentence per TTS chunk (pipelined: the next is synthesized while one plays).
   * table talk S4: system speech starts with the earcon and uses the system speaker; model text never does.
   */
  say(text: string, voice: SpeakVoice = 'model', receivedAt = hr()): void {
    const parts = sentences(text);
    if (!parts.length) return;
    parts.forEach((sentence, i) => this.#speakQueue.push({ sentence, voice, earcon: voice === 'system' && i === 0 }));
    this.#setSpeech(true);
    this.#speaking = this.#speaking
      .then(() => this.#drain(receivedAt))
      .catch((err) => this.#log.warn('speech failed', { error: err instanceof Error ? err.message : String(err) }))
      .finally(() => {
        if (!this.#speakQueue.length && !this.#playing) this.#setSpeech(false);
      });
  }

  /** One TTS call at a time, in order (the warm-up first). */
  #serialTts<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.#ttsChain.then(fn);
    this.#ttsChain = p.catch(() => undefined);
    return p;
  }

  /** Synthesize one queued sentence in its voice; a system item's audio is prefixed with the earcon (same play call). */
  #synth(item: SpeakItem): SynthJob {
    const { sentence } = item;
    const job: SynthJob = { sentence, audio: Promise.resolve({ samples: new Float32Array(0), sampleRate: 16_000 }), t0: hr() };
    job.audio = this.#serialTts(() => {
      job.t0 = hr();
      return this.#o.engines.tts.synthesize(sentence, item.voice === 'system' ? { voice: 'system' } : undefined);
    }).then((a) => {
      job.t1 = hr();
      return withEarcon(a, item.earcon);
    });
    job.audio.catch(() => undefined); // a dropped prefetch never surfaces as an unhandled rejection
    return job;
  }

  /** request.voice.report{playback: {playing}} on an edge (status.voice.playback: the GUI's ⏹ Stop speaking). */
  #setSpeech(on: boolean): void {
    if (on === this.#speechOn) return;
    this.#speechOn = on;
    const playback = { playing: on };
    this.#reports = this.#reports.then(async () => {
      try {
        await this.#o.link.append('request.voice.report', { playback });
      } catch (err) {
        this.#log.warn('playback report not relayed', { reason: toRefusal(err).reason });
      }
    });
  }

  async #drain(receivedAt: number): Promise<void> {
    const gen = this.#speechGen;
    if (!this.#speakQueue.length || this.#closed) return;
    let job: SynthJob | undefined = this.#synth(this.#speakQueue.shift()!);
    let n = 0;
    while (job && !this.#closed && gen === this.#speechGen) {
      const cur: SynthJob = job;
      job = undefined;
      let audio: Audio;
      try {
        audio = await cur.audio;
      } catch (err) {
        this.#log.warn('synthesis failed', { error: err instanceof Error ? err.message : String(err) });
        if (this.#speakQueue.length && gen === this.#speechGen) job = this.#synth(this.#speakQueue.shift()!);
        continue;
      }
      if (this.#closed || gen !== this.#speechGen) return;
      // pipeline: the next sentence synthesizes while this one plays
      if (this.#speakQueue.length) job = this.#synth(this.#speakQueue.shift()!);
      this.#bargedIn = false;
      this.#speechRunMs = 0;
      const id = turnStamp('a', Math.max(this.#now(), this.#lastAgentMs), ++this.#agentN);
      const calledAt = this.#now();
      this.#playing = { t0: calledAt };
      let r: PlaybackResult | undefined;
      try {
        r = await this.#o.audio.play({ id, samples: audio.samples, sampleRate: audio.sampleRate });
      } catch (err) {
        this.#log.warn('playback failed', { error: err instanceof Error ? err.message : String(err) });
      } finally {
        const t0 = this.#playing?.t0 ?? this.#now();
        this.#playing = null;
        // L4: play threw ⇒ no result; keep a conservative echo window and drop the rest of the reply
        if (!r) this.#windows.push({ t0, t1: this.#now() });
      }
      n++;
      if (r && n === 1) {
        const synthMs = (cur.t1 ?? cur.t0) - cur.t0;
        const queuedMs = Math.max(0, cur.t0 - receivedAt);
        const toAudibleMs = Math.max(0, r.t0 - calledAt);
        this.#lastLatency = { queuedMs: Math.round(queuedMs), synthMs: Math.round(synthMs), toAudibleMs: Math.round(toAudibleMs), totalMs: Math.round(queuedMs + synthMs + toAudibleMs), sentences: 1 };
        this.#flow.info('speech latency', { ...this.#lastLatency });
      } else if (r && this.#lastLatency) this.#lastLatency.sentences = n;
      if (!r) {
        this.#speakQueue = [];
        return;
      }
      this.#lastAgentMs = Math.max(this.#lastAgentMs, r.t0);
      this.#windows.push({ t0: r.t0, t1: r.t1, ...(!r.completed && this.#bargedIn ? { barged: true } : {}) });
      if (this.#windows.length > WINDOW_KEEP) this.#windows.splice(0, this.#windows.length - WINDOW_KEEP);
      try {
        await this.#o.link.append('voice.turn.agent', { turnId: id, t0: Math.round(r.t0), t1: Math.round(r.t1), textPlanned: cur.sentence, textSpoken: r.completed ? cur.sentence : '', ...(r.completed ? {} : { interrupted: true }) });
      } catch (err) {
        this.#refused(err, 'log.append');
      }
      if (!r.completed) {
        this.#speakQueue = [];
        return;
      }
    }
  }

  #bargeIn(by: 'speech' | 'hotkey'): void {
    if (!this.#playing || this.#bargedIn) return;
    this.#bargedIn = true;
    this.#speechRunMs = 0;
    this.#speechGen++;
    this.#speakQueue = [];
    this.#o.audio.stopPlayback();
    this.#o.engines.vad.reset(); // the barge-in speech is not forwarded
    // AMBIENT: the speech that barged in is dropped now; PTT's held segment is dropped at release (it started inside
    // the barged window, so its reason is 'barge-in' too)
    if (by === 'speech') this.#abandonLive('barge-in');
    this.#flow.info('barge-in', { by });
  }

  // ---- notices -------------------------------------------------------------------------------------------------

  #notice(level: Notice['level'], text: string, refusal?: KernelRefusal): void {
    this.#o.notice?.({ level, text, ...(refusal ? { refusal } : {}) });
  }

  #refused(err: unknown, where: string): void {
    const r = toRefusal(err);
    this.#log.warn('refused', { where, code: r.code, reason: r.reason });
    this.#notice('warn', FRIENDLY[r.reason] ?? `The kernel refused ${where}: ${r.reason} (${r.message})`, r);
  }
}
