/**
 * @symbol #gui-voice-capture
 * @flow $voice-turn
 *
 * Live capture feedback (T-2026-10-20-005 A1, founder rulings TD-2026-10-20-086 V3/V4). PURE.
 *
 * The voice app reports each speech segment's state (request.voice.report{capture}); the kernel relays it as
 * `status.voice.capture{state, segId, reason?, level?, at}` with a 5 s TTL. This module is the one adapter over that
 * shape and the one place its words live:
 *
 *   idle         "Listening" (calm; the meter is still)          (PTT keeps "Hold … to talk")
 *   hearing      "Hearing you…" (pulsing; the meter is the REAL level, 0..1)
 *   transcribing "Catching that…"
 *   captured     "Got it" (a CAPTURED_FLASH_MS flash)
 *   dropped      the reason only (V4: no text, no count), in words a person can act on (dropLabelOf): a refused
 *                turn names the kernel's verdict ("Not sent: Claude was still finishing its reply"), the client's
 *                own drops say what happened ("Too short to catch…", "Not sent: it overlapped my spoken reply").
 *                Voice drops fix (2026-10-20): a drop, and a captured claim the kernel did not confirm, STAY on the
 *                pill until the next capture starts or the human dismisses it (opening the voice menu), never a
 *                1.2 s flash (captureStep keeps it across the kernel's 5 s capture TTL).
 *
 * V3 (no push relay, the ids do not move): status is polled while voice is attached and the voice app is connected,
 * about 1 s at rest and CAPTURE_FAST_POLL_MS while hearing or transcribing; never when off (capturePollMs).
 * B1 live words (T-2026-10-20-005, V1/V2): `capture.text{committed, tail}`, which the kernel projects to the gui
 * credential only (voice-requests.ts voiceStatusFor) and only after the voice app's provisional speaker match. The
 * ghost line (#composer-ghost, its own element, NEVER the textarea, so a send can never carry non-final words) shows
 * the committed words solid and the tail dim, and "…" while there are none; it clears on captured / dropped.
 */

export const CAPTURE_STATES = ['idle', 'hearing', 'transcribing', 'captured', 'dropped'] as const;
export type CaptureState = (typeof CAPTURE_STATES)[number];
export const CAPTURE_DROP_REASONS = ['too-short', 'echo', 'not-attached', 'no-words', 'not-enrolled', 'barge-in', 'refused', 'mic-off'] as const;
export type CaptureDropReason = (typeof CAPTURE_DROP_REASONS)[number];

export const CAPTURED_FLASH_MS = 1_200;
export const CAPTURE_IDLE_POLL_MS = 1_000;
export const CAPTURE_FAST_POLL_MS = 175;
/** Aegis L2: a capture read longer ago than the kernel's TTL is never shown (the page keeps its last status on a failed read) */
export const CAPTURE_STALE_MS = 5_000;

export interface CaptureView {
  state: CaptureState;
  segId: string;
  reason: CaptureDropReason | null;
  /** voice drops fix: reason 'refused' only, the kernel's voice-* verdict (e.g. voice-playback) and its V2a cause */
  refusal: string | null;
  cause: string | null;
  /** 0..1 while hearing, else null */
  level: number | null;
  /** Aegis M1: the kernel's cross-check of a captured claim ('accepted' | 'unconfirmed'), or null */
  kernel: 'accepted' | 'unconfirmed' | null;
  /** B1: the live words (hearing / transcribing only), or null */
  text: GhostText | null;
}

/** B1: the ghost line's words: committed (solid) and the unfixed tail (dim). */
export interface GhostText {
  committed: string;
  tail: string;
}
/** the ghost line never shows more than this many characters (the kernel caps at 600 too) */
export const GHOST_TEXT_MAX = 600;
const ghostWords = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
/** capture.text → GhostText (strings only, whitespace collapsed, capped keeping the newest words), or null */
export function ghostTextOf(v: unknown): GhostText | null {
  const t = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  if (!t) return null;
  let committed = ghostWords(t.committed);
  const tail = [...ghostWords(t.tail)].slice(0, GHOST_TEXT_MAX).join('');
  const room = GHOST_TEXT_MAX - [...tail].length;
  if ([...committed].length > room) committed = [...committed].slice(-Math.max(0, room)).join('');
  return committed || tail ? { committed, tail } : null;
}

/** V4: the reason only, never words or a count. */
export const DROP_LABEL: Readonly<Record<CaptureDropReason, string>> = Object.freeze({
  'too-short': 'Too short to catch. Hold a little longer, or say it again',
  echo: 'Not sent: it overlapped my spoken reply',
  'barge-in': 'Not sent: you talked over my reply, so I stopped',
  'no-words': 'Heard sound, but no words',
  'not-enrolled': 'Not sent: speaker not recognised',
  'not-attached': 'Not sent: voice is not attached to this session',
  refused: 'Not sent: the kernel refused it',
  // TD-2026-10-21-514: the mic went off (key, screen lock, sleep): the audio in flight was discarded
  'mic-off': 'Mic off · ⌃` to listen',
});

/**
 * Voice drops fix: the kernel's voice refusal (voice.turn.user{refusedReason, refusedCause}, or a capture's
 * refusal/cause) as a short phrase. Shared by the pill (dropLabelOf) and the transcript row (store.ts). An unknown
 * reason is shown as its name (never dropped).
 */
export function refusalPhrase(reason: string, cause?: string | null): string {
  switch (reason) {
    case 'voice-playback':
      return 'Claude was still finishing';
    case 'voice-echo':
      return 'it overlapped my spoken reply';
    case 'voice-speaker':
      return 'speaker not recognised';
    case 'voice-target':
      return 'voice is not attached to this session';
    case 'voice-conn':
      return 'another voice app is connected';
    case 'voice-stale-utterance':
      return 'it was too old to send';
    case 'voice-grammar':
      return 'handled as a command';
    case 'voice-off':
      return cause === 'aec' ? 'no echo cancellation (use headphones or the built-in mic)' : cause === 'idle' ? 'ambient voice timed out' : cause === 'ceiling' ? 'above the attached voice mode' : cause === 'composer' ? 'ambient speech goes to the composer' : 'voice is off for this turn';
    default:
      return cause ? `${reason} · ${cause}` : reason;
  }
}

/** The pill's words for a drop: the kernel's verdict when the client relayed one, else the client's own reason. */
export function dropLabelOf(c: Pick<CaptureView, 'reason' | 'refusal' | 'cause'>): string {
  if (c.reason === 'refused' && c.refusal) {
    const phrase = refusalPhrase(c.refusal, c.cause);
    return c.refusal === 'voice-playback' ? 'Not sent: Claude was still finishing its reply. Say it again' : `Not sent: ${phrase}`;
  }
  return DROP_LABEL[c.reason ?? 'refused'];
}
const REFUSAL = /^voice-[a-z-]{1,40}$/;
const CAUSE = /^[a-z][a-z-]{0,31}$/;

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** The capture from a `status` result, or null (none, stale, or a shape this page does not know). */
export function captureStatusOf(status: unknown): CaptureView | null {
  const c = obj(obj(obj(status)?.voice)?.capture);
  if (!c || !(CAPTURE_STATES as readonly unknown[]).includes(c.state) || typeof c.segId !== 'string') return null;
  const state = c.state as CaptureState;
  const reason = state === 'dropped' && (CAPTURE_DROP_REASONS as readonly unknown[]).includes(c.reason) ? (c.reason as CaptureDropReason) : null;
  if (state === 'dropped' && reason === null) return null;
  const level = state === 'hearing' && typeof c.level === 'number' && Number.isFinite(c.level) ? Math.max(0, Math.min(1, c.level)) : state === 'hearing' ? 0 : null;
  const kernel = c.kernel === 'accepted' || c.kernel === 'unconfirmed' ? c.kernel : null;
  const text = state === 'hearing' || state === 'transcribing' ? ghostTextOf(c.text) : null;
  const refusal = reason === 'refused' && typeof c.refusal === 'string' && REFUSAL.test(c.refusal) ? c.refusal : null;
  const cause = refusal && typeof c.cause === 'string' && CAUSE.test(c.cause) ? c.cause : null;
  return { state, segId: c.segId, reason, refusal, cause, level, kernel, text };
}

/** Aegis L2: the capture only while the status it came from was received within CAPTURE_STALE_MS of `now` (page clock). */
export function freshCapture(cap: CaptureView | null, statusReceivedAt: number | null, now: number): CaptureView | null {
  if (!cap || statusReceivedAt === null || now - statusReceivedAt > CAPTURE_STALE_MS) return null;
  return cap;
}

/** What the page has seen: the capture and when this page first saw it (flashes are timed on the page's clock). */
export interface CaptureTrack {
  cap: CaptureView | null;
  since: number;
  /** voice drops fix: the key of a sticky outcome the human dismissed (a re-read of the same report stays hidden) */
  dismissed?: string;
}

const keyOf = (c: CaptureView | null): string => (c ? `${c.segId}:${c.state}:${c.reason ?? ''}:${c.refusal ?? ''}` : '');

/** Voice drops fix: an outcome the human must be able to read: a drop, or a captured claim the kernel did not confirm. */
export function isSticky(c: CaptureView | null): boolean {
  return !!c && (c.state === 'dropped' || (c.state === 'captured' && c.kernel === 'unconfirmed'));
}

/**
 * Fold a fresh status read in: a new segment/state restarts the clock; the same one (a level update) keeps it.
 * Voice drops fix: a sticky outcome (isSticky) is KEPT while the reads show nothing new (the kernel's 5 s capture TTL
 * expired, or the client went idle); the next segment (hearing, transcribing, or another terminal state) replaces it.
 * A dismissed outcome stays hidden while the same report is re-read.
 */
export function captureStep(prev: CaptureTrack | null, cap: CaptureView | null, now: number): CaptureTrack {
  const dismissed = prev?.dismissed;
  if (cap && dismissed !== undefined && keyOf(cap) === dismissed) return { cap: null, since: now, dismissed };
  if (prev && keyOf(prev.cap) === keyOf(cap)) return { cap, since: prev.since, ...(dismissed !== undefined ? { dismissed } : {}) };
  if (prev && isSticky(prev.cap) && (cap === null || cap.state === 'idle')) return prev;
  return { cap, since: now, ...(dismissed !== undefined ? { dismissed } : {}) };
}

/** Voice drops fix: the human dismissed the shown outcome (opened the voice menu): hide it until something new comes. */
export function captureDismiss(t: CaptureTrack | null, now: number): CaptureTrack | null {
  if (!t || !isSticky(t.cap)) return t;
  return { cap: null, since: now, dismissed: keyOf(t.cap) };
}

export interface CaptureDisplay {
  /** the effective state shown (a flash that ran out shows idle) */
  state: CaptureState;
  /** the pill label, or null to keep the attached pill's own label (idle) */
  label: string | null;
  /** pill classes to add */
  className: string;
  /** the meter level to draw: the real level while hearing, else 0 (still) */
  meter: number;
  /** the composer ghost line while hearing or transcribing ("…" with no words yet) */
  ghost: boolean;
  /** B1: the words the ghost line shows (null: "…"); always null when the ghost is hidden */
  ghostText: GhostText | null;
  /** the polite screen-reader caption ('' at rest) */
  caption: string;
  /** ms until the flash ends (repaint then), or null */
  flashLeftMs: number | null;
}

/** Luna #9: the pill's level meter is shown ONLY while the capture state is `hearing` (never a still meter at rest). */
export const meterShownOf = (live: boolean, d: Pick<CaptureDisplay, 'state'>): boolean => live && d.state === 'hearing';

/** The pill overlay for an attached voice with the voice app connected; anything else shows nothing. */
export function captureDisplayOf(t: CaptureTrack | null, now: number, live: boolean): CaptureDisplay {
  const rest: CaptureDisplay = { state: 'idle', label: null, className: 'capture-idle', meter: 0, ghost: false, ghostText: null, caption: '', flashLeftMs: null };
  const c = t?.cap;
  if (!live || !c || !t) return rest;
  const age = Math.max(0, now - t.since);
  switch (c.state) {
    case 'hearing':
      return { state: 'hearing', label: 'Hearing you…', className: 'capture-hearing', meter: c.level ?? 0, ghost: true, ghostText: c.text, caption: 'Hearing you', flashLeftMs: null };
    case 'transcribing':
      return { state: 'transcribing', label: 'Catching that…', className: 'capture-transcribing', meter: 0, ghost: true, ghostText: c.text, caption: 'Catching that', flashLeftMs: null };
    case 'captured':
      // Aegis M1: a captured claim the kernel did not see a turn for is not "Got it". Voice drops fix: it stays until
      // the next capture or a dismiss, and says where to look
      if (c.kernel === 'unconfirmed') {
        const label = 'Heard, but not confirmed: check the transcript';
        return { state: 'captured', label, className: 'capture-dropped', meter: 0, ghost: false, ghostText: null, caption: label, flashLeftMs: null };
      }
      return age < CAPTURED_FLASH_MS ? { state: 'captured', label: 'Got it', className: 'capture-captured', meter: 0, ghost: false, ghostText: null, caption: 'Got it', flashLeftMs: CAPTURED_FLASH_MS - age } : rest;
    case 'dropped': {
      // voice drops fix: no flash: the reason stays until the next capture starts or the human dismisses it
      const label = dropLabelOf(c);
      return { state: 'dropped', label, className: 'capture-dropped', meter: 0, ghost: false, ghostText: null, caption: label, flashLeftMs: null };
    }
    default:
      return rest;
  }
}

/** V3: the status poll cadence: off ⇒ null; attached with the voice app connected ⇒ fast while hearing/transcribing, else ~1 s. */
export function capturePollMs(o: { attached: boolean; clientConnected: boolean | null; attachable: boolean; connected: boolean }, cap: CaptureView | null): number | null {
  if (!o.connected || !o.attachable || !o.attached || o.clientConnected !== true) return null;
  return cap && (cap.state === 'hearing' || cap.state === 'transcribing') ? CAPTURE_FAST_POLL_MS : CAPTURE_IDLE_POLL_MS;
}
