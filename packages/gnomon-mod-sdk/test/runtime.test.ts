/**
 * #gnomon-mod-sdk runtime (spec §12.3): framing, init echo of modAbiId,
 * unknown method ⇒ -32601, and `cancel{cancelToken}` aborting the handler.
 */
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { MOD_ABI_ID } from '@a-company/gnomon-contracts';
import { serveMod, type ModDefinition } from '../src/runtime.js';

function serve(def: ModDefinition) {
  const input = new PassThrough();
  const lines: Array<Record<string, unknown>> = [];
  let buf = '';
  const output = { write: (s: string) => ((buf += s), buf.split('\n').slice(0, -1).forEach((l) => lines.push(JSON.parse(l))), (buf = buf.slice(buf.lastIndexOf('\n') + 1)), true) };
  serveMod(def, { input, output, error: { write: () => true }, env: {} });
  const send = (m: Record<string, unknown>) => input.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
  const reply = async (id: number) => {
    for (let i = 0; i < 100; i++) {
      const r = lines.find((l) => l.id === id);
      if (r) return r;
      await new Promise((res) => setTimeout(res, 5));
    }
    throw new Error(`no reply ${id}`);
  };
  return { send, reply };
}

describe('serveMod', () => {
  it('init echoes mod-abi:v1 and MOD_ABI_ID; unknown methods answer -32601', async () => {
    const m = serve({});
    m.send({ id: 1, method: 'init', params: { abi: 'mod-abi:v1', features: ['cancel'] } });
    expect((await m.reply(1)).result).toEqual({ abi: 'mod-abi:v1', features: [], modAbiId: MOD_ABI_ID });
    m.send({ id: 2, method: 'nope', params: {} });
    expect((await m.reply(2)).error).toMatchObject({ code: -32601 });
  });

  it('cancel{cancelToken} aborts the in-flight handler', async () => {
    const m = serve({ tools: { slow: (_i, ctx) => new Promise((res) => ctx.signal.addEventListener('abort', () => res('aborted'))) } });
    m.send({ id: 3, method: 'tool.call', params: { name: 'slow', input: null, cancelToken: 't1' } });
    m.send({ method: 'cancel', params: { cancelToken: 't1' } });
    expect((await m.reply(3)).result).toEqual({ result: 'aborted' });
  });
});
