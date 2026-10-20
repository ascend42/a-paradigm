/**
 * @symbol #gnomon-voice
 *
 * Kernel-decided enrolment, client side (spec §14.4; V2e, T-2026-10-19-026). The GUI asks the kernel
 * (`request.voice.enrol{name, consent}`); the human allows the strictness card with Touch ID; the card's effect
 * writes the root-signed enrolment row and sets `status.voice.enrolment = {name, phase: 'requested', at}`. This
 * watcher polls status while the client runs and, on a `requested` it has not handled yet, records ENROL_PHRASES
 * through AudioIO, embeds them and stores the print (speaker.ts writePrint: 0700 dir, 0600 file). It relays
 * progress with `request.voice.report{enrolment}` (kept in memory by the kernel, never logged):
 *
 *   ready → recording{phrase: i, of: 3} → recorded{phrase: i, of: 3} … → done   (phrase is 0-based)
 *   failed{error} on a mic that is off and cannot be turned on, no speech, or an embedding error.
 *
 * The kernel's report has no `phrases` field, so the phrases are the SHARED constant ENROL_PHRASES (enrol.ts); the
 * GUI's built-in list (packages/gnomon-gui/src/core/voice-client.ts ENROL_PHRASES) is the same three, pinned by
 * test/enrol-watch.test.ts. While recording, the voice loop is paused (no turn is sent from the phrases).
 */
import { ENROL_PHRASES, recordEnrolment } from './enrol.js';
import type { AudioIO, KernelLink, SpeakerEngine, VadEngine, VoiceLogger } from './types.js';
import { silentLogger } from './types.js';

export const VOICE_REPORT_REQUEST = 'request.voice.report' as const;
/** status poll cadence while the client runs (ms) */
export const ENROL_POLL_MS = 1500;

export interface RequestedEnrolment {
  name: string;
  at: string;
}

/** status.voice.enrolment when the kernel asks for a recording, else null. */
export function requestedEnrolment(status: unknown): RequestedEnrolment | null {
  const e = (status as { voice?: { enrolment?: unknown } } | undefined)?.voice?.enrolment as Record<string, unknown> | null | undefined;
  if (!e || typeof e !== 'object' || e.phase !== 'requested' || typeof e.name !== 'string') return null;
  return { name: e.name, at: typeof e.at === 'string' ? e.at : '' };
}

export interface EnrolWatchOptions {
  link: KernelLink & { status(): Promise<unknown> };
  audio: AudioIO;
  vad: VadEngine;
  speaker: SpeakerEngine;
  /** the speaker model id stored in the print */
  model: string;
  home: string;
  /** pause / resume the voice loop around a recording */
  pause?: (on: boolean) => void;
  pollMs?: number;
  /** per-phrase timeout (ms) */
  timeoutMs?: number;
  log?: VoiceLogger;
}

export class EnrolWatch {
  readonly #o: EnrolWatchOptions;
  readonly #log;
  #timer: ReturnType<typeof setInterval> | undefined;
  #handled = new Set<string>();
  #busy: Promise<void> | null = null;
  #stopped = false;

  constructor(o: EnrolWatchOptions) {
    this.#o = o;
    this.#log = (o.log ?? silentLogger).component('#gnomon-voice');
  }

  start(): void {
    if (this.#timer || this.#stopped) return;
    this.#timer = setInterval(() => void this.poll(), this.#o.pollMs ?? ENROL_POLL_MS);
    this.#timer.unref?.();
    void this.poll();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    await this.#busy?.catch(() => undefined);
  }

  /** One status read; starts a recording for a new `requested`. Resolves when that recording (if any) ends. */
  async poll(): Promise<void> {
    if (this.#busy || this.#stopped) return this.#busy ?? undefined;
    let req: RequestedEnrolment | null;
    try {
      req = requestedEnrolment(await this.#o.link.status());
    } catch {
      return;
    }
    if (!req) return;
    const key = `${req.name}@${req.at}`;
    if (this.#handled.has(key)) return;
    this.#handled.add(key);
    this.#busy = this.#record(req.name).finally(() => (this.#busy = null));
    return this.#busy;
  }

  async #report(enrolment: Record<string, unknown>): Promise<void> {
    try {
      await this.#o.link.append(VOICE_REPORT_REQUEST, { enrolment });
    } catch (err) {
      this.#log.warn('enrolment report refused', { phase: String(enrolment.phase), error: err instanceof Error ? err.message : String(err) });
    }
  }

  async #record(name: string): Promise<void> {
    const of = ENROL_PHRASES.length;
    const a = this.#o.audio;
    const wasOn = a.micOn;
    this.#log.info('enrolment recording requested', { name });
    if (!wasOn) {
      try {
        await a.setMic(true);
      } catch (err) {
        await this.#report({ name, phase: 'failed', error: `the mic is off and could not be turned on: ${err instanceof Error ? err.message : String(err)}` });
        return;
      }
    }
    this.#o.pause?.(true);
    try {
      await this.#report({ name, phase: 'ready', phrase: 0, of });
      await recordEnrolment({
        audio: a, vad: this.#o.vad, speaker: this.#o.speaker, model: this.#o.model, home: this.#o.home, name, phrases: ENROL_PHRASES,
        ...(this.#o.timeoutMs !== undefined ? { timeoutMs: this.#o.timeoutMs } : {}),
        prompt: (_p, i) => this.#report({ name, phase: 'recording', phrase: i - 1, of }),
        recorded: (i) => this.#report({ name, phase: 'recorded', phrase: i - 1, of }),
      });
      await this.#report({ name, phase: 'done', phrase: of - 1, of });
      this.#log.info('enrolment recorded', { name, phrases: of });
    } catch (err) {
      await this.#report({ name, phase: 'failed', error: err instanceof Error ? err.message : String(err) });
      this.#log.warn('enrolment recording failed', { name });
    } finally {
      this.#o.pause?.(false);
      if (!wasOn) await a.setMic(false).catch(() => undefined);
    }
  }
}
