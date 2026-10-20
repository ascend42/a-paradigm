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
 *   dropped      the reason only (V4: no text, no count), a DROPPED_FLASH_MS flash:
 *                "Too short, say it again" · "Not sent: I was speaking" · "Heard no words" ·
 *                "Ignored a voice that isn't enrolled" · …
 *
 * V3 (no push relay, the ids do not move): status is polled while voice is attached and the voice app is connected,
 * about 1 s at rest and CAPTURE_FAST_POLL_MS while hearing or transcribing; never when off (capturePollMs).
 * Phase B (live words) slots in as `capture.text`, which the kernel projects to the gui credential only
 * (voice-requests.ts voiceStatusFor): captureStatusOf would read it and the ghost line would show it; A1 shows "…".
 */

export const CAPTURE_STATES = ['idle', 'hearing', 'transcribing', 'captured', 'dropped'] as const;
export type CaptureState = (typeof CAPTURE_STATES)[number];
export const CAPTURE_DROP_REASONS = ['too-short', 'echo', 'not-attached', 'no-words', 'not-enrolled', 'barge-in', 'refused'] as const;
export type CaptureDropReason = (typeof CAPTURE_DROP_REASONS)[number];

export const CAPTURED_FLASH_MS = 1_200;
export const DROPPED_FLASH_MS = 2_500;
export const CAPTURE_IDLE_POLL_MS = 1_000;
export const CAPTURE_FAST_POLL_MS = 175;

export interface CaptureView {
  state: CaptureState;
  segId: string;
  reason: CaptureDropReason | null;
  /** 0..1 while hearing, else null */
  level: number | null;
}

/** V4: the reason only, never words or a count. */
export const DROP_LABEL: Readonly<Record<CaptureDropReason, string>> = Object.freeze({
  'too-short': 'Too short, say it again',
  echo: 'Not sent: I was speaking',
  'barge-in': 'Not sent: I was speaking',
  'no-words': 'Heard no words',
  'not-enrolled': "Ignored a voice that isn't enrolled",
  'not-attached': 'Not sent: voice is not attached',
  refused: 'Not sent: the kernel refused it',
});

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** The capture from a `status` result, or null (none, stale, or a shape this page does not know). */
export function captureStatusOf(status: unknown): CaptureView | null {
  const c = obj(obj(obj(status)?.voice)?.capture);
  if (!c || !(CAPTURE_STATES as readonly unknown[]).includes(c.state) || typeof c.segId !== 'string') return null;
  const state = c.state as CaptureState;
  const reason = state === 'dropped' && (CAPTURE_DROP_REASONS as readonly unknown[]).includes(c.reason) ? (c.reason as CaptureDropReason) : null;
  if (state === 'dropped' && reason === null) return null;
  const level = state === 'hearing' && typeof c.level === 'number' && Number.isFinite(c.level) ? Math.max(0, Math.min(1, c.level)) : state === 'hearing' ? 0 : null;
  return { state, segId: c.segId, reason, level };
}

/** What the page has seen: the capture and when this page first saw it (flashes are timed on the page's clock). */
export interface CaptureTrack {
  cap: CaptureView | null;
  since: number;
}

const keyOf = (c: CaptureView | null): string => (c ? `${c.segId}:${c.state}:${c.reason ?? ''}` : '');

/** Fold a fresh status read in: a new segment/state restarts the clock; the same one (a level update) keeps it. */
export function captureStep(prev: CaptureTrack | null, cap: CaptureView | null, now: number): CaptureTrack {
  if (prev && keyOf(prev.cap) === keyOf(cap)) return { cap, since: prev.since };
  return { cap, since: now };
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
  /** the composer ghost line "…" while hearing or transcribing */
  ghost: boolean;
  /** the polite screen-reader caption ('' at rest) */
  caption: string;
  /** ms until the flash ends (repaint then), or null */
  flashLeftMs: number | null;
}

/** The pill overlay for an attached voice with the voice app connected; anything else shows nothing. */
export function captureDisplayOf(t: CaptureTrack | null, now: number, live: boolean): CaptureDisplay {
  const rest: CaptureDisplay = { state: 'idle', label: null, className: 'capture-idle', meter: 0, ghost: false, caption: '', flashLeftMs: null };
  const c = t?.cap;
  if (!live || !c || !t) return rest;
  const age = Math.max(0, now - t.since);
  switch (c.state) {
    case 'hearing':
      return { state: 'hearing', label: 'Hearing you…', className: 'capture-hearing', meter: c.level ?? 0, ghost: true, caption: 'Hearing you', flashLeftMs: null };
    case 'transcribing':
      return { state: 'transcribing', label: 'Catching that…', className: 'capture-transcribing', meter: 0, ghost: true, caption: 'Catching that', flashLeftMs: null };
    case 'captured':
      return age < CAPTURED_FLASH_MS ? { state: 'captured', label: 'Got it', className: 'capture-captured', meter: 0, ghost: false, caption: 'Got it', flashLeftMs: CAPTURED_FLASH_MS - age } : rest;
    case 'dropped': {
      const label = DROP_LABEL[c.reason!];
      return age < DROPPED_FLASH_MS ? { state: 'dropped', label, className: 'capture-dropped', meter: 0, ghost: false, caption: label, flashLeftMs: DROPPED_FLASH_MS - age } : rest;
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
