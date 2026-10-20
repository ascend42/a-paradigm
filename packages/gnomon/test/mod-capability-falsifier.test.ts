/**
 * HOST-LEVEL FALSIFIERS (T-2026-10-20-008 (1); K1/K3 #paradigm-context-mod).
 * Real stub mod children under a real ModHost, so a refactor of host.ts feed()
 * or composeRelayedInput cannot pass by unit tests of the projections alone.
 *   - log.read vs log.read + log.read:usage: every usage kind plus a
 *     turn.result carrying split and cost is fed; the log.read-only mod
 *     receives NO usage kind and turn.result EXACTLY {hsid}.
 *   - paradigm.read:summary: a mod without it never receives the slice (not
 *     on a relayed render focused on a live session, not with a forged
 *     `paradigm` key, not through the feed); the mod with it does.
 */
import * as fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { unsandboxedModLauncher } from '../src/kernel/testing.js';
import { FEED_USAGE_KINDS } from '../src/kernel/modhost/index.js';
import { host, installStub, rig } from './mod-helpers.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});
const H = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
const HUMAN = { principal: 'p:abcdefgh/matt', connId: 'c1', principalClass: 'human' };
type Seen = { seen: Array<{ kind: string; payload: Record<string, unknown> }>; last: Record<string, unknown> | null };

/** Every usage kind, with the payload shapes the real emitters write. */
const USAGE_ROWS: Array<{ kind: string; payload: Record<string, unknown> }> = [
  { kind: 'turn.usage', payload: { hsid: H, usage: { tokens: 1200 } } },
  { kind: 'session.compacted', payload: { hsid: H, tokensBefore: 190_000, tokensAfter: 41_000 } },
  { kind: 'budget.usage', payload: { hsid: H, tokens: 1200, usd: 0.0123 } },
  { kind: 'budget.ladder', payload: { dimension: 'tokens', scope: 'user', rung: 0.8 } },
  { kind: 'budget.pause', payload: { dimension: 'usd' } },
  { kind: 'budget.resume', payload: { dimension: 'usd' } },
  { kind: 'budget.breaker.open', payload: { dimension: 'tokens' } },
  { kind: 'budget.breaker.close', payload: { dimension: 'tokens' } },
  { kind: 'permit.deny', payload: { why: 'api-billing-path' } },
];

async function until(f: () => Promise<boolean>, ms = 3000): Promise<void> {
  const t0 = Date.now();
  while (!(await f())) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('host-level falsifier: log.read vs log.read:usage (T-2026-10-20-008 (1))', () => {
  it('the log.read-only mod receives no usage kind and turn.result exactly {hsid}; the usage mod receives all of them', async () => {
    const r = rig();
    cleanups.push(r.cleanup);
    installStub(r, 'acme.basic', ['log.read']);
    installStub(r, 'acme.usage', ['log.read', 'log.read:usage']);
    installStub(r, 'acme.deaf', []);
    const { h } = host(r, { launcher: unsandboxedModLauncher });
    cleanups.push(() => h.stopAll());
    for (const n of ['acme.basic', 'acme.usage', 'acme.deaf']) await h.start(n);
    expect(FEED_USAGE_KINDS.slice().sort()).toEqual(USAGE_ROWS.map((x) => x.kind).sort()); // every usage kind is fed
    let seq = 1;
    const feed = (kind: string, payload: Record<string, unknown>): number => h.feed({ kind, seq: seq++, at: '2026-10-20T12:00:00.000Z', payload });
    feed('session.open', { hsid: H, backend: 'claude-code', cwd: '/Users/matt/code/x' });
    for (const u of USAGE_ROWS) feed(u.kind, u.payload);
    feed('turn.result', { hsid: H, usage: { tokens: 900 }, split: { in: 182_000, out: 9_000, cacheRead: 120_000, cacheWrite: 4_000 }, cost: 0.4213, text: 'the answer' });
    feed('session.exited', { hsid: H });
    const seen = async (n: string) => (await h.runCommand(n, `${n}.seen`, null)) as Seen;
    await until(async () => (await seen('acme.usage')).seen.length >= USAGE_ROWS.length + 3 && (await seen('acme.basic')).seen.length >= 3);
    const basic = (await seen('acme.basic')).seen;
    const usage = (await seen('acme.usage')).seen;
    expect(basic.map((e) => e.kind)).toEqual(['session.open', 'turn.result', 'session.exited']);
    for (const e of basic) expect(FEED_USAGE_KINDS).not.toContain(e.kind);
    expect(basic.find((e) => e.kind === 'turn.result')!.payload).toEqual({ hsid: H });
    expect(usage.map((e) => e.kind)).toEqual(['session.open', ...USAGE_ROWS.map((x) => x.kind), 'turn.result', 'session.exited']);
    expect(usage.find((e) => e.kind === 'turn.result')!.payload).toEqual({ hsid: H, tokens: 900, tokensIn: 182_000, tokensOut: 9_000, cacheRead: 120_000, cacheWrite: 4_000, costMicros: 421_300 });
    expect(JSON.stringify(usage)).not.toMatch(/the answer|\/Users/);
    expect((await seen('acme.deaf')).seen).toEqual([]); // no log.read: nothing at all
  });
});

describe('host-level falsifier: paradigm.read:summary (K1/K3)', () => {
  it('a mod without paradigm.read:summary never receives the slice; the mod with it does', async () => {
    const r = rig();
    cleanups.push(r.cleanup);
    const repo = path.join(r.root, 'repo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.paradigm', 'decisions'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.paradigm', 'decisions', 'TD-2026-10-20-001.yaml'), "id: TD-2026-10-20-001\ntimestamp: '2026-10-20T01:00:00.000Z'\ntitle: SLICE CONTENT\n");
    installStub(r, 'acme.ctx', ['paradigm.read:summary']);
    installStub(r, 'acme.reader', ['log.read', 'log.read:usage']);
    installStub(r, 'acme.bare', []);
    const { h } = host(r, { launcher: unsandboxedModLauncher }, { focusCwd: (hsid) => (hsid === H ? repo : null), userHome: path.join(r.root, 'nohome') });
    cleanups.push(() => h.stopAll());
    for (const n of ['acme.ctx', 'acme.reader', 'acme.bare']) await h.start(n);
    const forged = { v: 'paradigm-slice:v1', state: 'ok', decisions: { items: [{ id: 'X', title: 'FORGED' }] } };
    for (const n of ['acme.reader', 'acme.bare']) {
      for (const input of [{ focus: { hsid: H } }, { hsid: H }, { focus: { hsid: H }, paradigm: forged }]) {
        await h.relayView({ name: n, viewId: `${n}.echo`, input, ...HUMAN });
        const got = ((await h.runCommand(n, `${n}.seen`, null)) as Seen).last!;
        expect(got, `${n} ${JSON.stringify(input)}`).toEqual({ hsid: H });
        expect(JSON.stringify(got)).not.toMatch(/SLICE CONTENT|FORGED|paradigm-slice/);
      }
    }
    h.feed({ kind: 'session.open', seq: 1, at: '2026-10-20T12:00:00.000Z', payload: { hsid: H, cwd: repo } });
    await until(async () => ((await h.runCommand('acme.reader', 'acme.reader.seen', null)) as Seen).seen.length >= 1);
    expect(JSON.stringify(((await h.runCommand('acme.reader', 'acme.reader.seen', null)) as Seen).seen)).not.toMatch(/SLICE CONTENT|paradigm|repo/);
    await h.relayView({ name: 'acme.ctx', viewId: 'acme.ctx.echo', input: { focus: { hsid: H } }, ...HUMAN });
    const ctx = ((await h.runCommand('acme.ctx', 'acme.ctx.seen', null)) as Seen).last!;
    expect(JSON.stringify(ctx)).toContain('SLICE CONTENT');
    expect(JSON.stringify(ctx)).not.toContain(r.root);
  });
});
