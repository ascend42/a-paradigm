/**
 * @symbol #gui-gesture
 *
 * The gesture stamp (boards S1.3, draft point 2; Aegis A1; §11.5 G-GUI-04). A stamp is minted from a trusted DOM
 * event and is the only thing the one mod-command sender (core/mod-command.ts) accepts.
 *
 * WHAT IT IS NOT. It proves nothing about a human. It fails closed against a GUI code path that forgot the gate,
 * and against replay on one connection. Any holder of the GUI credential or any script in the page can mint it.
 * It is never stored in a row, never passed to a mod, never read by the fold, and never reused for approvals,
 * grants or permits.
 *
 * Only `n` and `kind` are ever sent (the kernel refuses a third key); `at` stays in the page. `n` comes from a
 * module-private counter that goes up by exactly one per stamp that is SENT, across reconnects too: a stamp gets
 * its number at its first use, not when it is minted, so the many trusted events that send nothing never make the
 * number jump (the kernel refuses a jump far above the last one it saw). A stamp whose number is below the last
 * one sent is not sent again (the kernel would refuse it as replayed).
 * PURE apart from that counter: no DOM, no timer; the caller passes the event's two or three fields and the time.
 */

/** The closed list the kernel checks `kind` against. */
export const GESTURE_KINDS = ['pointer', 'key', 'paste', 'menu'] as const;
export type GestureKind = (typeof GESTURE_KINDS)[number];
/** How many commands one stamp may ride on (attach and open is 2; the kernel holds the same number). */
export const GESTURE_FANOUT = 4;
/** A stamp older than this is not sent. */
export const GESTURE_MAX_AGE_MS = 10_000;

export interface Gesture {
  /** 0 until the stamp is first sent; then a safe integer of at least 1, one above the stamp sent before it */
  readonly n: number;
  readonly kind: GestureKind;
  /** when it was minted (the caller's clock, milliseconds); never sent */
  readonly at: number;
}

const KIND_OF_TYPE: Readonly<Record<string, GestureKind>> = Object.freeze({ pointerup: 'pointer', keydown: 'key', paste: 'paste', click: 'menu' });

/** The number of the last stamp sent. Never reset, so it holds across reconnects. */
let counter = 0;
/** Number and uses per stamp. Keyed by the object `gestureOf` returned, so a look-alike built anywhere else has no entry. */
const minted = new WeakMap<Gesture, { n: number; used: number }>();

/**
 * A stamp for a trusted `pointerup`, `keydown`, `click` or `paste`; null for anything else, for a synthetic event
 * and for a key held down (a repeated keydown is not a gesture).
 */
export function gestureOf(e: { isTrusted: boolean; type: string; repeat?: boolean }, now: number): Gesture | null {
  if (!e || e.isTrusted !== true || e.repeat === true || !Number.isFinite(now)) return null;
  const kind = Object.prototype.hasOwnProperty.call(KIND_OF_TYPE, e.type) ? KIND_OF_TYPE[e.type] : undefined;
  if (!kind) return null;
  const record = { n: 0, used: 0 };
  const g: Gesture = Object.freeze({
    get n(): number {
      return record.n;
    },
    kind,
    at: now,
  });
  minted.set(g, record);
  return g;
}

/** `superseded`: a later stamp has been sent since this one was, so its number would go backwards. */
export type GestureProblem = 'missing' | 'expired' | 'spent' | 'superseded';

/** Why a stamp may not be sent now, or null. `missing`: null, or an object `gestureOf` did not mint. Takes nothing. */
export function gestureProblem(g: Gesture | null | undefined, now: number): GestureProblem | null {
  const record = g ? minted.get(g) : undefined;
  if (!g || !record) return 'missing';
  if (!(now - g.at <= GESTURE_MAX_AGE_MS) || now < g.at) return 'expired';
  if (record.used >= GESTURE_FANOUT) return 'spent';
  if (record.n !== 0 && record.n < counter) return 'superseded';
  return null;
}

/** Count one use of a stamp (numbering it at its first), or say why it may not be used. Only the sender calls this. */
export function takeGesture(g: Gesture | null | undefined, now: number): GestureProblem | null {
  const problem = gestureProblem(g, now);
  if (problem !== null) return problem;
  const record = minted.get(g as Gesture)!;
  if (record.n === 0) record.n = ++counter;
  record.used += 1;
  return null;
}

/** How many more commands a stamp may ride on now (0 for one that may not be sent). */
export function gestureUsesLeft(g: Gesture | null | undefined, now: number): number {
  return gestureProblem(g, now) === null ? GESTURE_FANOUT - minted.get(g as Gesture)!.used : 0;
}
