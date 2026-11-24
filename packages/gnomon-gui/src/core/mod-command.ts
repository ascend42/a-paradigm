/**
 * @symbol #gui-mod-command
 *
 * The ONE sender of the `mod.command` relay in the GUI (boards S1.3, draft point 2; Aegis A1 and B1; §11.5
 * G-GUI-04). The relay's name is written in this file and nowhere else under src/ but the preview's fake kernel
 * (test/mod-command.test.ts scans for it), so no code path can send a mod command without passing here.
 *
 * It sends NOTHING and rejects with a `ModCommandRefusal` when the mod is not on the closed list (the kernel does
 * not hold that list; this is its only guard), when the caller's args are not a plain object or carry a key the
 * host composes (`hsid`, `repo`) or the stamp's own key, or when the gesture stamp is missing, older than
 * GESTURE_MAX_AGE_MS, already used GESTURE_FANOUT times, or numbered below a stamp sent since. Otherwise it sends
 * `{name, commandId, args: {...args, gesture: {n, kind}}}` (exactly those two keys: the kernel refuses a third).
 * A session is named with `args.focus = {hsid}`; the host composes `hsid` and `repo` itself.
 */
import { DIM_MOD_ID } from '@a-company/gnomon-contracts';
import { RpcError, type GnomonClient } from './client.js';
import { takeGesture, type Gesture } from './gesture.js';

/** The mods the GUI may send a command to. Closed: a new one is added here, in review. */
export const MOD_COMMAND_MODS: readonly string[] = Object.freeze([DIM_MOD_ID]);
/** Arg keys a caller may not set: the host composes the first two and the sender writes the third. */
export const MOD_COMMAND_RESERVED_ARGS: readonly string[] = Object.freeze(['hsid', 'repo', 'gesture']);

export type ModCommandRefusalWhy = 'mod-not-listed' | 'command-id' | 'args' | 'gesture-missing' | 'gesture-expired' | 'gesture-spent' | 'gesture-superseded';

/** The sender refused before anything was sent. The message is fixed per `why` and never carries input. */
export class ModCommandRefusal extends Error {
  constructor(readonly why: ModCommandRefusalWhy) {
    super(`mod command not sent: ${why}`);
    this.name = 'ModCommandRefusal';
  }
}

const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

/**
 * Send one mod command on a gesture stamp. `now` is injected for tests (default: the clock). Resolves with the
 * relay's result; rejects with `ModCommandRefusal` (nothing was sent) or with the client's `RpcError`.
 */
export function sendModCommand(c: Pick<GnomonClient, 'call'>, g: Gesture | null, name: string, commandId: string, args: Record<string, unknown>, now: number = Date.now()): Promise<unknown> {
  if (typeof name !== 'string' || !MOD_COMMAND_MODS.includes(name)) return Promise.reject(new ModCommandRefusal('mod-not-listed'));
  if (typeof commandId !== 'string' || commandId.length === 0) return Promise.reject(new ModCommandRefusal('command-id'));
  if (!plain(args) || MOD_COMMAND_RESERVED_ARGS.some((k) => Object.prototype.hasOwnProperty.call(args, k))) return Promise.reject(new ModCommandRefusal('args'));
  const problem = takeGesture(g, now);
  if (problem !== null) return Promise.reject(new ModCommandRefusal(`gesture-${problem}`));
  const stamp = { n: (g as Gesture).n, kind: (g as Gesture).kind };
  return c.call('mod.command', { name, commandId, args: { ...args, gesture: stamp } });
}

/** Why a send failed, in the words a notice is built from. `code` is from a closed list; `why` is the kernel's own short word, when it gave one. */
export interface ModCommandFailure {
  code: 'not-sent' | 'gesture-refused' | 'read-only' | 'link-down' | 'no-answer' | 'refused';
  why: string | null;
}

const GESTURE_WHYS: readonly string[] = ['not-human', 'args', 'missing', 'malformed', 'kind', 'replayed', 'spent'];

/**
 * Read a rejected send. The kernel's gesture refusal is `FORBIDDEN` with `data.needs: 'gesture'` and a `why` from
 * its closed list; a host-refused write is `FORBIDDEN` with `modCode: 'EFFECT'` and `cap: 'command-read'`. Anything
 * else keeps its refusal code as `why` when it is a short plain word, and is otherwise just `refused`.
 */
export function modCommandFailure(err: unknown): ModCommandFailure {
  if (err instanceof ModCommandRefusal) return { code: 'not-sent', why: err.why };
  if (!(err instanceof RpcError)) return { code: 'refused', why: null };
  const { code, data } = err.refusal;
  if (code === 'CLOSED') return { code: 'link-down', why: null };
  if (code === 'TIMEOUT') return { code: 'no-answer', why: null };
  if (code === 'FORBIDDEN' && data && data.needs === 'gesture') return { code: 'gesture-refused', why: typeof data.why === 'string' && GESTURE_WHYS.includes(data.why) ? data.why : null };
  if (code === 'FORBIDDEN' && data && data.modCode === 'EFFECT' && data.cap === 'command-read') return { code: 'read-only', why: 'command-read' };
  return { code: 'refused', why: /^[A-Za-z][A-Za-z0-9_ -]{0,31}$/.test(code) ? code : null };
}
