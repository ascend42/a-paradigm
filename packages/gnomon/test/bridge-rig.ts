/**
 * S1.4 P5: the real-kernel rig of the bridge e2e (test/dimension-bridge-e2e.test.ts) and Probe's attack regressions
 * (test/bridge-attacks.test.ts): a dev kernel with the fake claude and NO modBridge seam unless a test passes one, the
 * bundled dimension tree installed before the session opens, one agent turn's steps written per send, the answers
 * read off the fake's trace, and the G-MOD-22 receipt checker (verifyLog under the kernel keys). Everything a test
 * opens is pushed onto `cleanups`, which the importing file drains in its afterEach.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { expect } from 'vitest';
import type { DimOp } from '@a-company/gnomon-contracts';
import { loadDevHome } from '../src/cli/dev-home.js';
import { runDevCommand, startDevKernel, type DevCliIo, type DevKernel } from '../src/cli/dev-cli.js';
import { KERNEL_PUB_FILE } from '../src/kernel/identity/kernel-pub.js';
import { verifyLog } from '../src/kernel/log/kernel-log.js';
import { KeyRing } from '../src/kernel/log/signer.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { startDaemonForTest } from '../src/kernel/testing.js';
import { tempHome } from './daemon-helpers.js';
import { installDimension, ulid } from './dimension-helpers.js';
import { E2E_SUPERVISOR_SEAMS, sessionWorld, setMode, trace, waitFor, type SessionWorld } from './session-helpers.js';

export const cleanups: Array<() => unknown> = [];
export const quiet = (): DevCliIo => ({ stdin: new PassThrough(), stdout: { write: () => true }, stderr: { write: () => true } });
export const line = (id: string, message: unknown) => ({ line: { type: 'control_request', request_id: id, request: { subtype: 'mcp_message', server_name: 'gnomon-mods', message } } });
export type McpAnswer = { id: string; mcp: { result?: { content?: Array<{ text: string }>; isError?: boolean; tools?: Array<{ name: string }> }; error?: { code: number } } | null };
export const answer = (w: SessionWorld, id: string): McpAnswer | undefined => (trace(w).filter((t) => t.t === 'mcp-answer') as unknown as McpAnswer[]).find((a) => a.id === id);
export const mcpJsonText = (w: SessionWorld): string => {
  const argv = trace(w).filter((t) => t.t === 'argv').at(-1)!.args as string[];
  return fs.readFileSync(argv[argv.indexOf('--mcp-config') + 1]!, 'utf8');
};

export type LoopOriginFor = (req: { cwd: string }) => { loopId: string; runId: string; authoredBy: string } | undefined;
export async function kernel(w: SessionWorld, devHome: string, userHome: string, modBridge?: { allow: Record<string, string[]>; currentPin: () => boolean }, loopOriginFor?: LoopOriginFor): Promise<DevKernel> {
  const k = await startDevKernel(devHome, {
    userHome,
    start: (o) =>
      startDaemonForTest(o, {
        supervisor: { claudePath: w.claude, allowScripts: true, ...E2E_SUPERVISOR_SEAMS, userHome: w.userHome, env: () => ({ HOME: w.userHome, PATH: '/usr/bin:/bin' }), ...(loopOriginFor ? { loopOriginFor } : {}) },
        billing: { env: () => ({}), layers: () => [] },
        ...(modBridge ? { modBridge } : {}),
      }),
  });
  cleanups.push(() => k.stop());
  return k;
}


export const press = (type = 'pointerup'): Event => ({ isTrusted: true, type }) as unknown as Event;
export const H = (n: number): string => ulid(n);
export const rectAt = (n: number, more: Record<string, unknown> = {}): DimOp => ({ type: 'add', node: { id: ulid(n), kind: 'rect', x: n, y: n, z: 'V', w: 10, h: 10, ...more } }) as unknown as DimOp;
export const agentAdd = (i: number): Record<string, unknown> => ({ type: 'add', node: { kind: 'rect', x: 200 + i, y: 200, w: 8, h: 8 } });

export async function boardRig(tag: string) {
  const w = sessionWorld();
  cleanups.push(() => w.cleanup());
  const t = tempHome(tag);
  cleanups.push(() => removeTree(path.dirname(t.home)));
  const userHome = path.dirname(t.home);
  const devHome = path.join(userHome, 'devhome');
  expect(await runDevCommand(['init', '--home', devHome], quiet(), { userHome, host: 'mac-1' })).toBe(0);
  const dev = loadDevHome(devHome, { userHome });
  // trap: installed (and unpaused) BEFORE session.open: mcp.json is written at spawn, tools/list read once
  installDimension({ root: userHome, home: dev.home, auth: dev.root as never, events: [], cleanup: async () => undefined });
  setMode(w, { reloadPerTurn: true });
  const k = await kernel(w, devHome, userHome); // NO modBridge seam: the production allowlist and isCurrentFirstPartyPin
  const ns = k.handle.kernelPrincipal.slice(2, 10);
  let rpc = 0;
  /** one agent tool call: its can_use_tool, then the tools/call naming the same toolUseId */
  const tool = (id: string, name: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}) => [
    { request: { id: `p-${id}`, tool: `mcp__gnomon-mods__${name}`, input: args, toolUseId: `toolu_${id}` } },
    line(`m-${id}`, { jsonrpc: '2.0', id: ++rpc, method: 'tools/call', params: { name, arguments: args, ...extra, _meta: { ...((extra._meta as object) ?? {}), 'claudecode/toolUseId': `toolu_${id}` } } }),
  ];
  const list = (id: string) => [line(`m-${id}`, { jsonrpc: '2.0', id: ++rpc, method: 'tools/list' })];
  /**
   * Judge I2: every session's fake reads ONE mode.json, so a send waits until a fake traced `turn-start` for it (it
   * took the message and read the mode) before the next mode can be written
   */
  const send = async (hsid: string) => {
    const before = trace(w).filter((x) => x.t === 'turn-start').length;
    await k.client.call('session.send', { hsid, content: [{ text: 'go' }] });
    expect(await waitFor(() => trace(w).filter((x) => x.t === 'turn-start').length > before, 15_000)).toBe(true);
  };
  /** a turn: the steps one call at a time (the bridge's in-flight cap and rate), awaited by id */
  const turn = async (hsid: string, steps: unknown[][], o: { hold?: boolean } = {}) => {
    setMode(w, { reloadPerTurn: true, permissionAsk: { hold: o.hold ?? false, awaitMcp: true, serial: true, gapMs: 300, steps: steps.flat() } });
    await send(hsid);
  };
  const answered = (ids: string[], ms = 60_000) => waitFor(() => ids.every((id) => !!answer(w, `m-${id}`)), ms);
  const raw = (id: string): string => answer(w, `m-${id}`)!.mcp!.result!.content![0]!.text;
  const body = <T = Record<string, unknown>>(id: string): T => JSON.parse(raw(id).split('\n').slice(2, -1).join('\n')) as T;
  type Row = { seq: number; event: { kind: string; principal: string; keyId?: string; session?: string; causes?: string[]; payload: Record<string, unknown> }; hash?: string; sig?: string };
  const rows = (kinds: string[]): Row[] => [...k.handle.log.read({ reader: { class: 'human' }, kinds })] as unknown as Row[];
  /** G-MOD-22 checker (Aegis 5, A2): only rows under p:<ns>/mods-mcp whose signature verifies under the KERNEL key */
  const ring = new KeyRing();
  const kernelKeyIds = fs.readFileSync(path.join(dev.home, 'keys', KERNEL_PUB_FILE), 'utf8').split('\n').filter(Boolean).map((l) => ring.addEd25519((JSON.parse(l) as { publicKeyPem: string }).publicKeyPem));
  const receipts = async (): Promise<Row[]> => {
    // the bytes verifyLog checked under a ring holding the KERNEL keys only; a row whose signature does not verify
    // (or that names another key) is a failure and is never counted
    const seen = new Map<number, { kind: string; principal: string; keyId?: string; payload: Record<string, unknown> }>();
    const report = verifyLog(dev.home, { keyRing: ring, kernelPrincipal: k.handle.kernelPrincipal, kernelKeyIds, onRow: (v) => { if (v.kind === 'inject.receipt') seen.set(v.seq, JSON.parse(v.envelope) as never); } });
    const bad = new Set(report.failures.map((f) => (f as { seq?: number }).seq));
    // Aegis N-1: no receipt is among verify's failures (a failing receipt would be dropped silently otherwise)
    expect([...bad].filter((q) => q !== undefined && seen.has(q))).toEqual([]);
    return [...seen.entries()].filter(([seq, e]) => !bad.has(seq) && e.principal === `p:${ns}/mods-mcp` && kernelKeyIds.includes(e.keyId ?? '')).map(([seq, e]) => ({ seq, event: e }) as Row);
  };
  return { w, k, dev, ns, tool, list, turn, send, answered, raw, body, rows, receipts, kernelKeyIds, nextId: () => ++rpc };
}

