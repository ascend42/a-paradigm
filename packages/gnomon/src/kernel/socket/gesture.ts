/**
 * @symbol #socket
 *
 * The GESTURE STAMP a GUI connection carries on `mod.command` (spec §11.5, §12.3; S1.3, Aegis A1; G-MOD-16).
 *
 * WHAT IT IS NOT. It proves nothing about a human. It fails closed against a GUI code path that forgot the gate,
 * and against replay on one connection. Any holder of the GUI credential or any script in the page can mint it.
 * It is therefore never stored in a row, never passed to a mod, never read by a fold or a `by`, never cited as
 * evidence that a human acted, and never reused for `approve`, grants or permits.
 *
 * SHAPE. The stamp rides INSIDE the relay's opaque `args` as `args.gesture = {n, kind}` (a top-level relay param
 * would move `modAbiId` and `clientApiId`). `n` is a safe integer of at least 1, minted by the page's one sender
 * per trusted event; `kind` is one of GESTURE_KINDS.
 *
 * RULE, per connection (`conn.gesture`, two numbers, so the state cannot grow):
 *   - `n` above the last one seen starts a new gesture (its use count becomes 1);
 *   - `n` equal to the last one seen is the same gesture fanning out, allowed while it has been used fewer than
 *     GESTURE_FANOUT times (one press may open and attach: two commands);
 *   - `n` below the last one seen is a replay and is refused.
 * Anything else (a caller that is not human class, args that are not a plain object, a missing or malformed
 * stamp, an unknown kind, an extra key) is refused FORBIDDEN `gesture`, and a refused stamp changes no state.
 *
 * takeGesture RETURNS the args WITHOUT the `gesture` key, on a null-prototype object and without prototype keys,
 * so the mod host is never handed it (the host strips the key again for every caller, modhost/host.ts
 * HOST_ARG_KEYS). The dispatcher calls it for the GUI credential, where it refused `mod.command` outright before.
 */
import type { PrincipalKind } from '@a-company/gnomon-contracts';
import { RpcRefusal } from './rpc.js';

/** One gesture may be spent on this many `mod.command` calls (attach and open is 2). */
export const GESTURE_FANOUT = 4;
/** The closed list of gesture kinds. */
export const GESTURE_KINDS = Object.freeze(['pointer', 'key', 'paste', 'menu'] as const);
export type GestureKind = (typeof GESTURE_KINDS)[number];

/** The per-connection state: the last `n` seen and how many commands it has been spent on. */
export interface GestureState {
  n: number;
  used: number;
}

/** What takeGesture reads of a connection (ConnAuthState): who it is, and its gesture state. */
export interface GestureConn {
  credential?: string | undefined;
  principalKind?: PrincipalKind | undefined;
  gesture?: GestureState | undefined;
}

const refuse = (why: string): RpcRefusal => new RpcRefusal('FORBIDDEN', 'gesture', `mod.command from the GUI needs a gesture stamp (§11.5): ${why}`, { verb: 'mod.command', why });
const PROTOTYPE_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

/**
 * Check and spend the gesture stamp in `args` for this connection; return the args without it. Throws
 * RpcRefusal FORBIDDEN `gesture` (data.why: not-human | args | missing | malformed | kind | replayed | spent).
 */
export function takeGesture(conn: GestureConn, args: unknown): Record<string, unknown> {
  // the class is read from the authenticated connection, never from params; a read token is never human class
  if (conn.principalKind !== 'human' || conn.credential === 'read-token') throw refuse('not-human');
  if (args === null || typeof args !== 'object' || Array.isArray(args)) throw refuse('args');
  const proto = Object.getPrototypeOf(args) as unknown;
  if (proto !== Object.prototype && proto !== null) throw refuse('args');
  const a = args as Record<string, unknown>;
  if (!Object.hasOwn(a, 'gesture')) throw refuse('missing');
  const g = a.gesture;
  if (g === null || typeof g !== 'object' || Array.isArray(g)) throw refuse('malformed');
  const keys = Object.keys(g);
  if (keys.length !== 2 || !Object.hasOwn(g, 'n') || !Object.hasOwn(g, 'kind')) throw refuse('malformed');
  const { n, kind } = g as { n: unknown; kind: unknown };
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1) throw refuse('malformed');
  if (typeof kind !== 'string' || !(GESTURE_KINDS as readonly string[]).includes(kind)) throw refuse('kind');
  const last = conn.gesture;
  if (last && n < last.n) throw refuse('replayed');
  if (last && n === last.n) {
    if (last.used >= GESTURE_FANOUT) throw refuse('spent');
    last.used += 1;
  } else conn.gesture = { n, used: 1 };
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const k of Object.keys(a)) if (k !== 'gesture' && !PROTOTYPE_KEYS.includes(k)) out[k] = a[k];
  return out;
}
