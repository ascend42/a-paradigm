/**
 * @symbol #gui-mod-command
 *
 * The ONE sender of the `mod.command` relay in the GUI (boards S1.3, draft point 2; Aegis A1 and B1; §11.5
 * G-GUI-04). The relay's name is written in this file and nowhere else under src/ but the preview's fake kernel
 * (test/mod-command.test.ts scans for it), so no code path can send a mod command without passing here.
 *
 * It sends NOTHING and rejects with a `ModCommandRefusal` when the mod or the command id is not on the closed list
 * MOD_COMMANDS (the kernel does not hold that list; this is its only guard), when the caller's args are not a
 * plain object, carry a key the host composes (`hsid`, `repo`, `paradigm`) or the stamp's own key, carry an own
 * key `__proto__`, `constructor`, `prototype` or `toJSON` at any depth (refused, never stripped: what is sent is
 * what the caller wrote), or give `focus` as anything but `{hsid: <non-empty string>}`, or when the gesture stamp is missing, older than
 * GESTURE_MAX_AGE_MS, already used GESTURE_FANOUT times, or numbered below a stamp sent since. Otherwise it sends
 * `{name, commandId, args: {...args, gesture: {n, kind}}}` (exactly those two keys: the kernel refuses a third).
 * A session is named with `args.focus = {hsid}`; the host composes `hsid` and `repo` itself.
 *
 * The stamp's number is per connection and the connection is the client object passed in (one GnomonClient is one
 * socket; a reconnect makes a new one), so numbering starts again at 1 after a reconnect with nothing to wire.
 * There is NO retry here and callers must not add one: the kernel spends a use even when the command then fails,
 * is busy or is never answered. `spent` and `replayed` mean "a new gesture from the person", never "send again".
 */
import { DIM_MOD_ID } from '@a-company/gnomon-contracts';
import { RpcError, type GnomonClient } from './client.js';
import { takeGesture, type Gesture } from './gesture.js';

/** The mods the GUI may send a command to, and the commands of each. Closed: a new one is added here, in review. */
export const MOD_COMMANDS: ReadonlyMap<string, readonly string[]> = new Map([[DIM_MOD_ID as string, Object.freeze(['dim.open', 'dim.attach', 'dim.op', 'dim.close', 'dim.grant', 'dim.select', 'dim.check', 'dim.undo', 'dim.seen'])]]);
export const MOD_COMMAND_MODS: readonly string[] = Object.freeze([...MOD_COMMANDS.keys()]);
/** Top-level arg keys a caller may not set: the host composes the first three and the sender writes the fourth. */
export const MOD_COMMAND_RESERVED_ARGS: readonly string[] = Object.freeze(['hsid', 'repo', 'paradigm', 'gesture']);
/** Own keys refused at any depth of the args: they change what an object is or how it is serialised. */
export const MOD_COMMAND_FORBIDDEN_KEYS: readonly string[] = Object.freeze(['__proto__', 'constructor', 'prototype', 'toJSON']);
const ARGS_MAX_DEPTH = 32;
const ARGS_MAX_VALUES = 20_000;

export type ModCommandRefusalWhy = 'mod-not-listed' | 'command-id' | 'args' | 'gesture-missing' | 'gesture-expired' | 'gesture-spent' | 'gesture-superseded';

/** The sender refused before anything was sent. The message is fixed per `why` and never carries input. */
export class ModCommandRefusal extends Error {
  constructor(readonly why: ModCommandRefusalWhy) {
    super(`mod command not sent: ${why}`);
    this.name = 'ModCommandRefusal';
  }
}

const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** True when the args may be sent as they are. Iterative and bounded: too deep or too large is refused. */
function argsOk(args: unknown): args is Record<string, unknown> {
  if (!plain(args) || MOD_COMMAND_RESERVED_ARGS.some((k) => has(args, k))) return false;
  if (has(args, 'focus')) {
    const f = args.focus;
    if (!plain(f) || Object.keys(f).length !== 1 || typeof f.hsid !== 'string' || f.hsid.length === 0) return false;
  }
  let seen = 0;
  const stack: Array<{ v: unknown; depth: number }> = [{ v: args, depth: 0 }];
  while (stack.length > 0) {
    const { v, depth } = stack.pop()!;
    if (v === null || typeof v !== 'object') continue;
    if (depth > ARGS_MAX_DEPTH || ++seen > ARGS_MAX_VALUES) return false;
    if (Array.isArray(v)) {
      seen += v.length;
      for (const x of v) if (x !== null && typeof x === 'object') stack.push({ v: x, depth: depth + 1 });
      continue;
    }
    if (!plain(v) || MOD_COMMAND_FORBIDDEN_KEYS.some((k) => has(v, k))) return false;
    for (const k of Object.keys(v)) stack.push({ v: v[k], depth: depth + 1 });
  }
  return true;
}

/**
 * Send one mod command on a gesture stamp. `now` is injected for tests (default: the clock). Resolves with the
 * relay's result; rejects with `ModCommandRefusal` (nothing was sent) or with the client's `RpcError`.
 */
export function sendModCommand(c: Pick<GnomonClient, 'call'>, g: Gesture | null, name: string, commandId: string, args: Record<string, unknown>, now: number = Date.now()): Promise<unknown> {
  const commands = typeof name === 'string' ? MOD_COMMANDS.get(name) : undefined;
  if (!commands) return Promise.reject(new ModCommandRefusal('mod-not-listed'));
  if (typeof commandId !== 'string' || !commands.includes(commandId)) return Promise.reject(new ModCommandRefusal('command-id'));
  if (!argsOk(args)) return Promise.reject(new ModCommandRefusal('args'));
  // the client object IS the connection: the stamp is numbered per connection, from 1
  const problem = takeGesture(g, now, c);
  if (problem !== null) return Promise.reject(new ModCommandRefusal(`gesture-${problem}`));
  const stamp = { n: (g as Gesture).n, kind: (g as Gesture).kind };
  try {
    return c.call('mod.command', { name, commandId, args: { ...args, gesture: stamp } });
  } catch (err) {
    // a client that throws instead of rejecting (a transport that died mid-send): still one rejected promise
    return Promise.reject(err);
  }
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
  // sent and never answered (a timeout, or the socket closed first): the kernel may have acted, and the use is spent
  if (code === 'TIMEOUT' || code === 'DELIVERY_UNKNOWN') return { code: 'no-answer', why: null };
  if (code === 'FORBIDDEN' && data && data.needs === 'gesture') return { code: 'gesture-refused', why: typeof data.why === 'string' && GESTURE_WHYS.includes(data.why) ? data.why : null };
  if (code === 'FORBIDDEN' && data && data.modCode === 'EFFECT' && data.cap === 'command-read') return { code: 'read-only', why: 'command-read' };
  return { code: 'refused', why: /^[A-Za-z][A-Za-z0-9_ -]{0,31}$/.test(code) ? code : null };
}
