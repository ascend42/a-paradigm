// @gnomon-platform: darwin, linux
/**
 * #mod-tool-bridge, Aegis A2: the receipt principal `p:<ns>/mods-mcp` cannot be held by a read token.
 * The mint is refused, and a mint row someone signed by hand for the name is rejected by the reader.
 *
 * Split from test/mods-bridge.test.ts (which keeps the registry and append-gate halves on every platform):
 * minting writes the token file into a home whose key directory must be owner-only by POSIX mode, as in the
 * other read-token suites (test/socket-abi.test.ts).
 */
import * as fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { mintReadToken, readTokensPath, resolveReadTokensText } from '../src/kernel/identity/read-token.js';
import { rig } from './mod-helpers.js';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

describe('#mod-tool-bridge: the receipt principal is reserved for read tokens (Aegis A2)', () => {
  it('the mint for p:<ns>/mods-mcp throws, and a hand-signed mint row for it is rejected while the same row for another name resolves', () => {
    const r = rig();
    cleanups.push(r.cleanup);
    const ns = r.auth.ns;
    const lineOf = (row: unknown): string => JSON.stringify({ row, ...r.auth.signRow(row as never) });
    expect(() => mintReadToken(r.home, r.auth, { principalId: `p:${ns}/mods-mcp` })).toThrow(TypeError);
    expect(fs.existsSync(readTokensPath(r.home))).toBe(false);
    const minted = mintReadToken(r.home, r.auth, { principalId: `p:${ns}/founder` });
    const goodRow = (JSON.parse(fs.readFileSync(readTokensPath(r.home), 'utf8').trim()) as { row: Record<string, unknown> }).row;
    expect(goodRow.principalId).toBe(minted.principalId);
    const forgedToken = { ...goodRow, tokenId: 'rtk:01HZZZZZZZZZZZZZZZZZZZZZZZ', principalId: `p:${ns}/mods-mcp` };
    const tokens = resolveReadTokensText(`${lineOf(goodRow)}\n${lineOf(forgedToken)}\n`, r.auth);
    expect([...tokens.tokens.values()].map((t) => t.principalId)).toEqual([`p:${ns}/founder`]);
    expect(tokens.rejected).toEqual([{ line: 2, reason: 'principal' }]);
  });
});
