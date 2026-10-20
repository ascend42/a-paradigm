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
 *   forward for headless use (`gnomon-voice run --delivery direct`). Activity edges go to the kernel as
 *   `request.voice.report{dictation: {activity: speaking | transcribing | idle, holdToggles}}` (edges only); the
 *   ⌃⌥H hold-toggle hotkey increments holdToggles (the GUI holds or releases its countdown).
 * $voice-turn, agent side: `log.read follow` on the attached session → the KERNEL's speakable rows
 *   (`voice.turn.agent{source:'kernel-speakable', turnSeq, items}`; never turn.event) → Kokoro per sentence → AudioIO.play →
 *   `log.append voice.turn.agent{turnId, t0, t1, textPlanned, textSpoken}` per played chunk (the windows the
 *   kernel's voice-echo guard checks).
 *
 * Half-duplex: no utterance that STARTS while TTS plays or within the 750 ms tail is forwarded. Barge-in: VAD
 * speech ≥ 300 ms during playback (or the PTT hotkey pressed) stops playback and drops the rest of the reply; the
 * speech that barged in is not forwarded — only a full utterance that starts after playback + tail is.
 *
 * Modes: OFF / PTT / AMBIENT. The human's attachment mode (status.voice.attached.mode) is the CEILING; the client
 * may narrow locally (setMode), never widen. Unknown speakers: the row carries no text (textWithheld: true; the
 * kernel stores no text for spk:unknown-N under V2a) and nothing is sent. No audio is ever written to disk
 * (G-VOX-05): segments live in memory only for the STT and embedding calls.
 */
import { kernelSpeakable, sentences } from './speakable.js';
import { SpeakerVerifier, type VoicePrint } from './speaker.js';
import type { AudioIO, PlaybackResult, KernelLink, KernelRefusal, PcmFrame, VadSegment, VoiceAttachment, VoiceEngines, VoiceLogger } from './types.js';
import { silentLogger } from './types.js';

export type ClientMode = 'off' | 'ptt' | 'ambient';
/** TD-2026-10-20-262: where a dictated turn goes — the GUI composer (default) or straight to the session. */
export type Delivery = 'composer' | 'direct';
export type DictationActivity = 'speaking' | 'transcribing' | 'idle';
const RANK: Record<ClientMode, number> = { off: 0, ptt: 1, ambient: 2 };

export const ECHO_TAIL_MS = 750;
export const BARGE_IN_MS = 300;
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
}

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
  #windows: Array<{ t0: number; t1: number }> = [];
  #speechRunMs = 0;
  #bargedIn = false;
  #speakQueue: string[] = [];
  #speaking: Promise<void> = Promise.resolve();
  // serial utterance processing
  #work: Promise<void> = Promise.resolve();
  #turnN = 0;
  #lastTurnMs = 0;
  #agentN = 0;
  #lastAgentMs = 0;
  #closed = false;
  #refreshed = false;
  #paused = false;
  // dictation (TD-2026-10-20-262)
  readonly #delivery: Delivery;
  #activity: DictationActivity = 'idle';
  #holdToggles = 0;
  #pending = 0;
  #vadSpeaking = false;
  #vadLastSpeech = 0;
  #reports: Promise<void> = Promise.resolve();

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

  /** request.voice.report{dictation}, serialized so holdToggles reaches the kernel in order (monotone). */
  #report(): void {
    const dictation = { activity: this.#activity, holdToggles: this.#holdToggles };
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
      a.on('closed', (reason) => this.#notice('warn', `Audio stopped: ${reason}`)),
      a.on('control', (action) => void (action === 'mic-toggle' ? this.toggleMic() : action === 'hold-toggle' ? this.holdToggle() : this.toggleAmbient())),
    );
    await a.start();
    await this.refresh();
  }

  /** Re-read the attachment from status and (re)follow its session. */
  async refresh(): Promise<void> {
    let next: VoiceAttachment | null;
    try {
      next = await this.#o.link.attachment();
    } catch (err) {
      this.#refused(err, 'status');
      next = null;
    }
    const changed = !this.#refreshed || next?.voiceSessionId !== this.#attachment?.voiceSessionId;
    this.#refreshed = true;
    this.#attachment = next;
    if (!changed) return;
    this.#unfollow?.();
    this.#unfollow = undefined;
    this.#o.engines.vad.reset();
    if (!next) {
      this.#notice('info', 'Voice is not attached to a session. Attach it from Gnomon to talk.');
      return;
    }
    // the human's choice in Gnomon (the attachment's mode) is the mode in force for a new attachment; the
    // ⌃⌥A hotkey can still narrow it locally afterwards (founder dogfood 2026-10-19: ambient sat in ptt)
    this.#requested = ceilingOf(next);
    this.#notice('info', `Attached to ${next.hsid} (up to ${ceilingOf(next) === 'ambient' ? 'ambient' : 'push-to-talk'}). Mode: ${this.mode}.`);
    try {
      this.#unfollow = await this.#o.link.follow(next.hsid, (r) => this.#onRow(r.kind, r.payload), (reason) => {
        this.#log.info('follow ended', { reason });
        this.#unfollow = undefined;
        if (!this.#closed) void this.refresh();
      });
    } catch (err) {
      this.#refused(err, 'log.read');
    }
  }

  /** Local mode switch. Asking above the human's ceiling narrows to the ceiling (never widens). */
  setMode(m: ClientMode): ClientMode {
    this.#requested = m;
    this.#pttHeld = false;
    this.#pttFrames = [];
    this.#o.engines.vad.reset();
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
    const on = !this.#o.audio.micOn;
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
    }
    this.#flow.info('mic toggled', { on });
    const said = on ? 'Mic on.' : 'Mic off. Press ⌃⌥M to turn it back on.';
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

  /** V2e: pause the voice loop (an enrolment is recording: its phrases are never turns). */
  pause(on: boolean): void {
    this.#paused = on;
    this.#pttHeld = false;
    this.#pttFrames = [];
    this.#o.engines.vad.reset();
    this.#vadSpeaking = false;
    this.#recompute();
  }

  /** Wait until queued utterances and speech are done (tests, shutdown). */
  async idle(): Promise<void> {
    let w: Promise<void> | undefined;
    let s: Promise<void> | undefined;
    let r: Promise<void> | undefined;
    while (w !== this.#work || s !== this.#speaking || r !== this.#reports) {
      w = this.#work;
      s = this.#speaking;
      r = this.#reports;
      await Promise.all([w, s, r]);
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#unfollow?.();
    for (const off of this.#offs) off();
    this.#o.audio.stopPlayback();
    await this.idle().catch(() => undefined);
    await this.#o.audio.close();
  }

  // ---- capture -------------------------------------------------------------------------------------------------

  #onHotkey(down: boolean, at: number): void {
    if (this.mode === 'off' || this.#paused) return;
    if (down) {
      if (this.#playing) this.#bargeIn('hotkey');
      this.#pttHeld = true;
      this.#pttFrames = [];
      this.#pttT0 = at;
      this.#recompute();
      return;
    }
    if (!this.#pttHeld) return;
    this.#pttHeld = false;
    const frames = this.#pttFrames;
    this.#pttFrames = [];
    if (this.mode !== 'ptt' || !frames.length) return this.#recompute();
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
    // VAD runs in AMBIENT (segmentation) and during playback in any mode (barge-in)
    if (mode !== 'ambient' && !this.#playing) return;
    const segs = this.#o.engines.vad.accept(f);
    if (this.#playing && !this.#bargedIn) {
      const ms = (f.samples.length / f.sampleRate) * 1000;
      this.#speechRunMs = this.#o.engines.vad.speaking() ? this.#speechRunMs + ms : 0;
      if (this.#speechRunMs >= BARGE_IN_MS) this.#bargeIn('speech');
    }
    if (mode === 'ambient') {
      for (const s of segs) this.#segment(s);
      // speaking from VAD start until its segment closes (the hangover silence is still the utterance), bounded
      // by VAD_OPEN_MAX_SILENCE_MS in case the VAD drops a segment without emitting it
      if (this.#o.engines.vad.speaking()) {
        this.#vadSpeaking = true;
        this.#vadLastSpeech = f.t0;
      } else if (segs.length || f.t0 - this.#vadLastSpeech > VAD_OPEN_MAX_SILENCE_MS) this.#vadSpeaking = false;
      this.#recompute();
    }
  }

  /** Inside our playback or its tail (the client mirror of the kernel's voice-echo guard). */
  #inEcho(t: number): boolean {
    if (this.#playing && t >= this.#playing.t0) return true;
    return this.#windows.some((w) => t >= w.t0 && t <= w.t1 + this.#tail);
  }

  #segment(seg: VadSegment, pressedAt?: number): void {
    const dur = seg.t1 - seg.t0;
    if (dur < MIN_UTTERANCE_MS) return;
    const startedAt = pressedAt ?? seg.t0;
    if (this.#inEcho(startedAt) || this.#inEcho(seg.t0)) {
      this.#flow.info('utterance dropped (playback or echo tail)', { t0: seg.t0, ms: Math.round(dur) });
      return;
    }
    const a = this.#attachment;
    const mode = this.mode;
    if (!a || mode === 'off') {
      this.#flow.info('utterance dropped (not attached)', { ms: Math.round(dur) });
      return;
    }
    this.#pending++;
    this.#recompute();
    this.#work = this.#work
      .then(() => this.#utterance(seg, a, mode as 'ptt' | 'ambient'))
      .catch((err) => this.#log.warn('utterance failed', { error: err instanceof Error ? err.message : String(err) }))
      .finally(() => {
        // idle after the append (or the drop): the edge is reported once nothing is pending
        this.#pending--;
        this.#recompute();
      });
  }

  async #utterance(seg: VadSegment, a: VoiceAttachment, mode: 'ptt' | 'ambient'): Promise<void> {
    const text = (await this.#o.engines.stt.transcribe(seg.samples, seg.sampleRate)).trim();
    if (!text) return;
    const who = await this.#verifier.identify(seg.samples, seg.sampleRate);
    // the samples are not kept past this point (G-VOX-05)
    if (this.#closed || this.#attachment?.voiceSessionId !== a.voiceSessionId) return; // attachment moved under us
    const enrolled = who.name !== undefined;
    const speakerId = enrolled ? `spk:${this.#o.ns}/${who.name}` : `spk:${who.unknownLabel}`;
    const ms = Math.max(this.#now(), this.#lastTurnMs);
    this.#lastTurnMs = ms;
    const turnId = turnStamp('u', ms, ++this.#turnN);
    const ri = this.#o.audio.routeInfo();
    // the aec claim from the binary's route/mic event (kind when known), plus its transport (V2b Aegis duty 4)
    const aec = ri.aecKind ?? ri.aec;
    // composer delivery: the client never forwards; the kernel stamps forwardable (TD-2026-10-20-262)
    const direct = this.#delivery === 'direct';
    const payload: Record<string, unknown> = { turnId, speakerId, speakerEnrolled: enrolled, forwarded: direct && enrolled, mode: this.#wireMode(mode, a), aec, ...(ri.transport ? { aecTransport: ri.transport } : {}), t0: Math.round(seg.t0), t1: Math.round(seg.t1), text: enrolled ? text : '', ...(enrolled ? {} : { textWithheld: true }) };
    try {
      await this.#o.link.append('voice.turn.user', payload);
    } catch (err) {
      this.#refused(err, 'log.append');
      return;
    }
    this.#flow.info('turn logged', { turnId, speakerEnrolled: enrolled, mode: payload.mode });
    if (!enrolled) {
      this.#notice('info', 'I heard someone who is not enrolled; nothing was sent.');
      return;
    }
    if (!direct) {
      this.#flow.info('turn dictated (composer)', { turnId });
      return;
    }
    try {
      await this.#o.link.send(a.hsid, text);
      this.#flow.info('turn sent', { turnId });
      this.#notice('info', `Sent: ${text}`);
    } catch (err) {
      this.#refused(err, 'session.send'); // never retried blindly
    }
  }

  /** The turn's mode claim in the kernel's vocabulary: V2a names continuous listening 'ambient', V1 'conversation'. */
  #wireMode(mode: 'ptt' | 'ambient', a: VoiceAttachment): string {
    if (mode === 'ptt') return this.#wire.ptt;
    return a.mode === 'ambient' || a.mode === 'conversation' ? a.mode : this.#wire.ambient;
  }

  // ---- speaking ------------------------------------------------------------------------------------------------

  #onRow(kind: string, payload: Record<string, unknown>): void {
    const items = kernelSpeakable(kind, payload);
    if (!items.length) return;
    // a kernel-speakable row is said once per turnSeq (a re-follow after an attachment change replays rows)
    const key = typeof payload.turnSeq === 'number' || typeof payload.turnSeq === 'string' ? String(payload.turnSeq) : undefined;
    if (key !== undefined) {
      if (this.#spokenTurns.has(key)) return;
      this.#spokenTurns.add(key);
      if (this.#spokenTurns.size > 256) this.#spokenTurns.delete(this.#spokenTurns.values().next().value!);
    }
    for (const it of items) this.say(it.text);
  }

  /** Queue text to speak, one sentence per TTS chunk. */
  say(text: string): void {
    for (const s of sentences(text)) this.#speakQueue.push(s);
    this.#speaking = this.#speaking.then(() => this.#drain()).catch((err) => this.#log.warn('speech failed', { error: err instanceof Error ? err.message : String(err) }));
  }

  async #drain(): Promise<void> {
    while (this.#speakQueue.length && !this.#closed) {
      const sentence = this.#speakQueue.shift()!;
      const audio = await this.#o.engines.tts.synthesize(sentence);
      if (this.#closed) return;
      this.#bargedIn = false;
      this.#speechRunMs = 0;
      const id = turnStamp('a', Math.max(this.#now(), this.#lastAgentMs), ++this.#agentN);
      this.#playing = { t0: this.#now() };
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
      if (!r) {
        this.#speakQueue = [];
        return;
      }
      this.#lastAgentMs = Math.max(this.#lastAgentMs, r.t0);
      this.#windows.push({ t0: r.t0, t1: r.t1 });
      if (this.#windows.length > WINDOW_KEEP) this.#windows.splice(0, this.#windows.length - WINDOW_KEEP);
      try {
        await this.#o.link.append('voice.turn.agent', { turnId: id, t0: Math.round(r.t0), t1: Math.round(r.t1), textPlanned: sentence, textSpoken: r.completed ? sentence : '', ...(r.completed ? {} : { interrupted: true }) });
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
    this.#speakQueue = [];
    this.#o.audio.stopPlayback();
    this.#o.engines.vad.reset(); // the barge-in speech is not forwarded
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
