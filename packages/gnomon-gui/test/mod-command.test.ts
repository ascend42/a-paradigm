/**
 * #gui-mod-command (boards S1.3, draft point 2; Aegis A1, B1): the one sender of the mod.command relay.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CLIENT_RELAYS, DIM_MOD_ID } from '@a-company/gnomon-contracts';
import { RpcError } from '../src/core/client.js';
import { GESTURE_FANOUT, GESTURE_MAX_AGE_MS, gestureOf } from '../src/core/gesture.js';
import type { Gesture } from '../src/core/gesture.js';
import { MOD_COMMANDS, MOD_COMMAND_MODS, ModCommandRefusal, modCommandFailure, sendModCommand } from '../src/core/mod-command.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const press = (now = 0): Gesture => gestureOf({ isTrusted: true, type: 'pointerup' }, now)!;

function client(result: unknown = { seq: 7, refused: [] }): { calls: Array<{ method: string; params: unknown }>; call: <T>(method: string, params?: unknown) => Promise<T> } {
  const calls: Array<{ method: string; params: unknown }> = [];
  return { calls, call: <T>(method: string, params?: unknown) => (calls.push({ method, params }), Promise.resolve(result as T)) };
}
const whyOf = async (p: Promise<unknown>): Promise<string> => p.then(() => 'sent', (e: unknown) => (e instanceof ModCommandRefusal ? e.why : `other: ${String(e)}`));

describe('#gui-mod-command sendModCommand', () => {
  it('sends the relay with the contract params and a stamp of exactly n and kind', async () => {
    const c = client();
    const g = press(50);
    const args = { dim: 'dim:x', ops: [], focus: { hsid: 'hsid-1' } };
    await expect(sendModCommand(c, g, DIM_MOD_ID, 'dim.op', args, 60)).resolves.toEqual({ seq: 7, refused: [] });
    expect(c.calls).toEqual([{ method: 'mod.command', params: { name: 'gnomon.dimension', commandId: 'dim.op', args: { dim: 'dim:x', ops: [], focus: { hsid: 'hsid-1' }, gesture: { n: g.n, kind: 'pointer' } } } }]);
    expect(g.n).toBeGreaterThanOrEqual(1);
    const sent = c.calls[0]!.params as { args: { gesture: object } };
    expect(Object.keys(sent.args.gesture)).toEqual(['n', 'kind']);
    expect(Object.keys(sent)).toEqual([...CLIENT_RELAYS.find((r) => r.relay === 'mod.command')!.params]);
    // the caller's object is not changed
    expect(args).toEqual({ dim: 'dim:x', ops: [], focus: { hsid: 'hsid-1' } });
  });

  it('sends nothing without a gesture, with an old one, a spent one or a look-alike', async () => {
    const c = client();
    expect(await whyOf(sendModCommand(c, null, DIM_MOD_ID, 'dim.op', {}, 0))).toBe('gesture-missing');
    expect(await whyOf(sendModCommand(c, { n: 3, kind: 'pointer', at: 0 }, DIM_MOD_ID, 'dim.op', {}, 0))).toBe('gesture-missing');
    expect(await whyOf(sendModCommand(c, press(0), DIM_MOD_ID, 'dim.op', {}, GESTURE_MAX_AGE_MS + 1))).toBe('gesture-expired');
    expect(c.calls).toEqual([]);
    const g = press(0);
    for (let i = 0; i < GESTURE_FANOUT; i++) await sendModCommand(c, g, DIM_MOD_ID, 'dim.op', {}, 1);
    expect(await whyOf(sendModCommand(c, g, DIM_MOD_ID, 'dim.op', {}, 1))).toBe('gesture-spent');
    expect(c.calls).toHaveLength(GESTURE_FANOUT);
    expect(new Set(c.calls.map((x) => (x.params as { args: { gesture: { n: number } } }).args.gesture.n)).size).toBe(1);
  });

  it('takes a closed list of mods (only the dimension mod), and a refusal there spends nothing', async () => {
    expect(MOD_COMMAND_MODS).toEqual(['gnomon.dimension']);
    const c = client();
    const g = press(0);
    for (const name of ['gnomon.workshop', 'acme.dimension', 'gnomon.dimension ', '', 'toString', '__proto__']) expect(await whyOf(sendModCommand(c, g, name, 'dim.op', {}, 0))).toBe('mod-not-listed');
    expect(await whyOf(sendModCommand(c, g, DIM_MOD_ID, '', {}, 0))).toBe('command-id');
    expect(c.calls).toEqual([]);
    expect(g.n).toBe(0);
  });

  it('18. refuses args that are not a plain object or that carry a host-composed key, and spends nothing', async () => {
    const c = client();
    const g = press(0);
    for (const args of [{ hsid: 'h' }, { repo: 'repo:x' }, { paradigm: {} }, { gesture: { n: 1, kind: 'key' } }, [], null, 'x', new Map()]) expect(await whyOf(sendModCommand(c, g, DIM_MOD_ID, 'dim.op', args as never, 0))).toBe('args');
    expect(c.calls).toEqual([]);
    expect(g.n).toBe(0);
  });

  it('18. refuses (never strips) an own key __proto__, constructor, prototype or toJSON at any depth', async () => {
    const c = client();
    const g = press(0);
    const hostile: unknown[] = [
      JSON.parse('{"__proto__":{"gesture":1},"dim":"d"}'),
      JSON.parse('{"ops":[{"type":"add","node":{"__proto__":{"x":1}}}]}'),
      { constructor: 1 },
      { ops: [{ patch: { prototype: {} } }] },
      { toJSON: () => ({ hsid: 'smuggled' }) },
      { ops: [{ node: { toJSON: 'x' } }] },
      { when: new Date(0) },
      { ops: [new (class Op {})()] },
    ];
    for (const args of hostile) expect(await whyOf(sendModCommand(c, g, DIM_MOD_ID, 'dim.op', args as never, 0))).toBe('args');
    // too deep to walk is refused too
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 40; i++) deep = deep.a = {};
    expect(await whyOf(sendModCommand(c, g, DIM_MOD_ID, 'dim.op', root, 0))).toBe('args');
    expect(c.calls).toEqual([]);
    // ordinary nested args go out exactly as written
    const args = { dim: 'dim:x', ops: [{ type: 'add', node: { id: 'a', points: [0, 0, 1, 1], refs: ['sym:#x'] } }], focus: { hsid: 'hsid-1' } };
    await sendModCommand(c, g, DIM_MOD_ID, 'dim.op', args, 0);
    expect((c.calls[0]!.params as { args: unknown }).args).toEqual({ ...args, gesture: { n: g.n, kind: 'pointer' } });
  });

  it('18. focus is {hsid} and nothing else', async () => {
    const c = client();
    for (const focus of [null, 'hsid-1', {}, { hsid: '' }, { hsid: 7 }, { hsid: 'h', repo: 'repo:x' }, { hsid: 'h', hsid2: 'i' }, ['h']]) expect(await whyOf(sendModCommand(c, press(0), DIM_MOD_ID, 'dim.op', { focus } as never, 0))).toBe('args');
    expect(c.calls).toEqual([]);
    expect(await whyOf(sendModCommand(c, press(0), DIM_MOD_ID, 'dim.op', { focus: { hsid: 'h' } }, 0))).toBe('sent');
  });

  it('18. takes a closed list of command ids for the dimension mod', async () => {
    expect([...MOD_COMMANDS.entries()]).toEqual([['gnomon.dimension', ['dim.open', 'dim.attach', 'dim.op', 'dim.close', 'dim.grant', 'dim.select', 'dim.check', 'dim.undo', 'dim.seen']]]);
    const c = client();
    const g = press(0);
    for (const id of ['dim.delete', 'dim.op ', 'DIM.OP', 'tool.call', 'toString', '', 'dim-draw']) expect(await whyOf(sendModCommand(c, g, DIM_MOD_ID, id, {}, 0))).toBe('command-id');
    expect(c.calls).toEqual([]);
    expect(g.n).toBe(0);
    for (const id of ['dim.open', 'dim.attach', 'dim.op', 'dim.close']) expect(await whyOf(sendModCommand(c, press(0), DIM_MOD_ID, id, {}, 0))).toBe('sent');
  });

  it('18. a client that throws instead of rejecting still gives one rejected promise', async () => {
    const boom = new Error('socket gone');
    const throwing = { call: (): never => { throw boom; } };
    let p: Promise<unknown> | undefined;
    expect(() => (p = sendModCommand(throwing as never, press(0), DIM_MOD_ID, 'dim.op', {}, 0))).not.toThrow();
    await expect(p).rejects.toBe(boom);
    expect(modCommandFailure(boom)).toEqual({ code: 'refused', why: null });
  });

  it('reconnect: the stamp number is per client object, so a new connection starts again at 1 and steps by 1', async () => {
    const nOf = (c: ReturnType<typeof client>): number[] => c.calls.map((x) => (x.params as { args: { gesture: { n: number } } }).args.gesture.n);
    const old = client();
    for (let i = 0; i < 1100; i++) await sendModCommand(old, press(0), DIM_MOD_ID, 'dim.op', {}, 0);
    expect(nOf(old).slice(0, 3)).toEqual([1, 2, 3]);
    expect(nOf(old)[1099]).toBe(1100);
    // the page reconnected: a new GnomonClient
    const fresh = client();
    const g = press(0);
    await sendModCommand(fresh, g, DIM_MOD_ID, 'dim.attach', {}, 0);
    await sendModCommand(fresh, g, DIM_MOD_ID, 'dim.open', {}, 0);
    await sendModCommand(fresh, press(0), DIM_MOD_ID, 'dim.op', {}, 0);
    expect(nOf(fresh)).toEqual([1, 1, 2]);
  });

  it('a failed send is not retried, and its use stays spent', async () => {
    const calls: unknown[] = [];
    const failing = { call: <T>(_m: string, p?: unknown): Promise<T> => (calls.push(p), Promise.reject(new RpcError({ code: 'BUSY', reason: null, message: 'm', next: [], data: null }))) };
    const g = press(0);
    for (let i = 0; i < GESTURE_FANOUT; i++) await expect(sendModCommand(failing, g, DIM_MOD_ID, 'dim.op', {}, 0)).rejects.toBeInstanceOf(RpcError);
    expect(calls).toHaveLength(GESTURE_FANOUT);
    expect(await whyOf(sendModCommand(failing, g, DIM_MOD_ID, 'dim.op', {}, 0))).toBe('gesture-spent');
    // the send function itself has no loop and no second call
    const src = readFileSync(path.join(SRC, 'core', 'mod-command.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export function sendModCommand'), src.indexOf('/** Why a send failed'));
    expect(fn.length).toBeGreaterThan(200);
    expect(fn).not.toMatch(/retry\(|\.catch\(|\.then\(|for \(|while \(/);
    expect(fn.match(/c\.call\(/g)).toHaveLength(1);
  });

  it('reads a failed send into a closed list of codes', () => {
    const rpc = (code: string, data: Record<string, unknown> | null = null): RpcError => new RpcError({ code, reason: null, message: 'm', next: [], data });
    expect(modCommandFailure(new ModCommandRefusal('gesture-expired'))).toEqual({ code: 'not-sent', why: 'gesture-expired' });
    expect(modCommandFailure(rpc('FORBIDDEN', { reason: 'ungranted', needs: 'gesture', verb: 'mod.command', why: 'replayed' }))).toEqual({ code: 'gesture-refused', why: 'replayed' });
    expect(modCommandFailure(rpc('FORBIDDEN', { needs: 'gesture', why: '<b>anything</b>' }))).toEqual({ code: 'gesture-refused', why: null });
    expect(modCommandFailure(rpc('FORBIDDEN', { modCode: 'EFFECT', cap: 'command-read' }))).toEqual({ code: 'read-only', why: 'command-read' });
    expect(modCommandFailure(rpc('CLOSED'))).toEqual({ code: 'link-down', why: null });
    expect(modCommandFailure(rpc('TIMEOUT'))).toEqual({ code: 'no-answer', why: null });
    expect(modCommandFailure(rpc('DELIVERY_UNKNOWN'))).toEqual({ code: 'no-answer', why: null });
    expect(modCommandFailure(rpc('BUSY'))).toEqual({ code: 'refused', why: 'BUSY' });
    expect(modCommandFailure(rpc('NOT_FOUND'))).toEqual({ code: 'refused', why: 'NOT_FOUND' });
    expect(modCommandFailure(rpc('<img src=x>'))).toEqual({ code: 'refused', why: null });
    expect(modCommandFailure(new Error('x'))).toEqual({ code: 'refused', why: null });
  });
});

describe('#gui-mod-command is the one sender (G-GUI-04)', () => {
  const walk = (dir: string): string[] => readdirSync(dir).sort().flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : [path.join(dir, n)]));
  const rel = (abs: string): string => path.relative(SRC, abs).split(path.sep).join('/');

  it("the literal 'mod.command' occurs under src/ only in core/mod-command.ts (and the preview's fake kernel)", () => {
    const files = walk(SRC).filter((f) => /\.(ts|tsx|mjs|js|html)$/.test(f));
    expect(files.length).toBeGreaterThan(20);
    const holders = files.filter((f) => /mod\.command/.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders.filter((f) => f !== 'preview/fake-kernel.ts')).toEqual(['core/mod-command.ts']);
    // and no file builds the name from pieces next to a call
    const built = files.filter((f) => /['"`]mod\.['"`]\s*\+|['"`]mod['"`]\s*\+\s*['"`]\.command/.test(readFileSync(f, 'utf8'))).map(rel);
    expect(built).toEqual([]);
  });

  it('the sender itself sends through one call site', () => {
    const src = readFileSync(path.join(SRC, 'core', 'mod-command.ts'), 'utf8');
    expect(src.match(/\.call\(/g)).toHaveLength(2); // hasOwnProperty.call and the one send
    expect(src.match(/c\.call\('mod\.command'/g)).toHaveLength(1);
    expect(src).not.toMatch(/console\./);
  });
});
