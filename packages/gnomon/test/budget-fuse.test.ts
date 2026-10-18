/**
 * #budget-fuse (spec §3.4, §4.8, §10 laws 1 and 7; §19.1 M1.6): G-LAW-01,
 * G-LAW-01b, G-BUD-01..03, G-SUB-04 and law 7 inside the broker.
 * Falsifier: the fuse or law 7 bypassed by any setting for kernel-spawned
 * sessions. Platform-independent: in-process, temp dirs only.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, RefusedError, validateRefusalV1 } from '@a-company/gnomon-contracts';
import {
  BudgetFuse,
  DEFAULT_FUSE,
  fileLayers,
  ignoredProjectKeys,
  loadFuseConfig,
  parseReserveParams,
  ROOT_CONFIG_FILE,
  scanApiBilling,
  writeSignedConfig,
  type BillingScanSource,
  type ReserveRequest,
} from '../src/kernel/budget/index.js';
import { ApprovalBroker } from '../src/kernel/broker/index.js';
import { KeyRing, SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { DEV_TEST_ROOT_ACK, DevTestRootAuthority } from '../src/kernel/identity/root-authority.js';
import { removeTree } from '../src/kernel/manifest/index.js';

const HUMAN = 'p:abcdefgh/matt';
const AGENT = 'p:abcdefgh/builder';
const tmps: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-fuse-'));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) removeTree(tmps.pop()!);
});

const clean: BillingScanSource = { env: () => ({ PATH: '/usr/bin', HOME: '/home/x' }), layers: () => [] };

function rig(o: { config?: typeof DEFAULT_FUSE; corrupt?: boolean; billing?: BillingScanSource; onBreach?: (b: unknown) => void; withBroker?: boolean } = {}) {
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const log = async (kind: string, payload: Record<string, unknown>) => void rows.push({ kind, payload });
  const kernel = SoftwareEd25519Signer.generate('kernel');
  const broker = o.withBroker ? new ApprovalBroker({ kernel, kernelPrincipal: 'p:abcdefgh/kernel', log }) : undefined;
  const fuse = new BudgetFuse({
    kernel,
    logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ',
    log,
    ...(o.config ? { config: o.config } : {}),
    ...(o.corrupt ? { corrupt: true } : {}),
    billing: o.billing ?? clean,
    ...(broker ? { broker } : {}),
    ...(o.onBreach ? { onBreach: o.onBreach as never } : {}),
  });
  return { fuse, rows, kernel, broker, kinds: (k: string) => rows.filter((r) => r.kind === k) };
}

const spawn = (over: Partial<ReserveRequest> = {}): ReserveRequest => ({ principal: AGENT, principalClass: 'agent', attended: false, kind: 'session.spawn', scope: { user: 'p:abcdefgh/*', repo: 'repo:a' }, backend: 'claude-code', ...over });

async function refusal(p: Promise<unknown>) {
  const e = await p.then(
    () => undefined,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RefusedError);
  const r = (e as RefusedError).refusal;
  expect(validateRefusalV1(r)).toEqual([]);
  return r;
}

describe('G-LAW-01 no spawn without a permit', () => {
  it('5-session fan-out with user limit 3 ⇒ 3 permit.grant, 2 permit.deny; permits are kernel-signed permit:v1', async () => {
    const cfg = structuredClone(DEFAULT_FUSE);
    cfg.concurrent.user = 3;
    const r = rig({ config: cfg });
    const out = await Promise.allSettled([1, 2, 3, 4, 5].map(() => r.fuse.reserve(spawn())));
    expect(out.filter((x) => x.status === 'fulfilled')).toHaveLength(3);
    expect(r.kinds('permit.grant')).toHaveLength(3);
    expect(r.kinds('permit.deny')).toHaveLength(2);
    const denied = out.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect((denied.reason as RefusedError).refusal).toMatchObject({ code: 'BUDGET_DENIED', data: { dimension: 'concurrent', scope: 'user' } });
    const permit = (out[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof r.fuse.reserve>>>).value;
    expect(permit).toMatchObject({ schemaVersion: 'permit:v1', decision: 'allow', billing: 'subscription', kind: 'session.spawn' });
    expect(permit.permitId).toMatch(/^permit:v1:[0-9A-HJKMNP-TV-Z]{26}$/);
    const ring = new KeyRing();
    ring.addEd25519(r.kernel.publicKeyPem);
    const { sig, ...unsigned } = permit;
    expect(ring.verify(r.kernel.keyId, 'permit', canonicalJson(unsigned), Buffer.from(sig, 'base64'))).toBe('ok');
    await r.fuse.release(permit.permitId, AGENT);
    await expect(r.fuse.reserve(spawn())).resolves.toMatchObject({ decision: 'allow' });
  });
});

describe('G-LAW-01b no setting disables the fuse or law 7 for kernel-spawned sessions', () => {
  it('env names (fuzzed), an unsigned config, another root’s config and project.yaml keys change nothing', async () => {
    const home = tmp();
    const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    const saved = { ...process.env };
    try {
      for (const n of ['GNOMON_FUSE', 'GNOMON_FUSE_OFF', 'GNOMON_BUDGET_DISABLE', 'GNOMON_NO_FUSE', 'GNOMON_LAW7', 'GNOMON_ALLOW_API', 'FUSE_LIMIT_TOKENS', 'GNOMON_CONCURRENT_USER']) process.env[n] = '0';
      process.env.GNOMON_CONCURRENT_USER = '999';
      fs.writeFileSync(path.join(home, ROOT_CONFIG_FILE), JSON.stringify({ row: { schemaVersion: 'gnomon-root-config:v1', config: { fuse: { concurrent: { user: 999 } } } }, signer: 'x', sig: 'y' }));
      const unsigned = loadFuseConfig(home, root);
      expect(unsigned).toMatchObject({ signed: false, corrupt: false });
      expect(unsigned.config).toEqual(DEFAULT_FUSE);
      const other = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
      writeSignedConfig(home, other, { fuse: { concurrent: { user: 999 } } });
      expect(loadFuseConfig(home, root).config).toEqual(DEFAULT_FUSE);
      // the fuse and the law-7 scan read no env var of their own: an API key anywhere still refuses
      const r = rig({ config: loadFuseConfig(home, root).config });
      for (let i = 0; i < DEFAULT_FUSE.concurrent.user; i++) await r.fuse.reserve(spawn({ scope: { user: 'p:abcdefgh/*', repo: `repo:${i}` } }));
      expect((await refusal(r.fuse.reserve(spawn({ scope: { user: 'p:abcdefgh/*', repo: 'repo:x' } })))).code).toBe('BUDGET_DENIED');
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
    const repo = tmp();
    fs.mkdirSync(path.join(repo, '.gnomon'));
    fs.writeFileSync(path.join(repo, '.gnomon', 'project.yaml'), 'name: x\nfuse:\n  concurrent: 99\nbudget: off\nstrictness:\n  baseline: L0\n');
    const ignored: Array<Record<string, unknown>> = [];
    expect(ignoredProjectKeys(repo, (_k, p) => void ignored.push(p))).toEqual(['fuse', 'budget', 'strictness']);
    expect(ignored).toEqual([{ field: 'fuse', source: 'project.yaml' }, { field: 'budget', source: 'project.yaml' }, { field: 'strictness', source: 'project.yaml' }]);
  });

  it('only a config signed by THIS root applies; a signed invalid value makes the fuse corrupt (deny), never looser', async () => {
    const home = tmp();
    const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    writeSignedConfig(home, root, { fuse: { concurrent: { user: 1 } } });
    expect(loadFuseConfig(home, root)).toMatchObject({ signed: true, corrupt: false, config: { concurrent: { user: 1 } } });
    for (const bad of [{ concurrent: { user: -1 } }, { concurrent: { user: 'inf' } }, { off: true }, { subscription: { humanReserve: 0 } }]) {
      writeSignedConfig(home, root, { fuse: bad });
      const l = loadFuseConfig(home, root);
      expect(l.corrupt).toBe(true);
      const r = rig({ config: l.config, corrupt: l.corrupt });
      expect((await refusal(r.fuse.reserve(spawn()))).data).toMatchObject({ dimension: 'corrupt-state' });
    }
  });
});

describe('law 7 inside the broker (BILLING_REFUSED)', () => {
  const layer = (where: string, json: unknown, kind: 'settings' | 'mcp' = 'settings') => ({ env: () => ({}), layers: () => [{ where, json, kind }] });
  it('each API-billing path in env or a layer refuses session.spawn and turn for claude-code; the key is named, never the value', async () => {
    const cases: BillingScanSource[] = [
      { env: () => ({ ANTHROPIC_API_KEY: 'sk-secret' }), layers: () => [] },
      { env: () => ({ ANTHROPIC_AUTH_TOKEN: 't' }), layers: () => [] },
      { env: () => ({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:8080' }), layers: () => [] }, // loopback override (D37)
      { env: () => ({ OTHER_BASE_URL: 'http://x' }), layers: () => [] },
      { env: () => ({ CLAUDE_CODE_USE_BEDROCK: '1' }), layers: () => [] },
      layer('user-settings', { env: { ANTHROPIC_API_KEY: 'sk-secret' } }),
      layer('user-settings', { apiKeyHelper: '/bin/key' }),
      layer('mcp:/repo/.mcp.json', { mcpServers: { s: { env: { CLAUDE_CODE_USE_VERTEX: '1' } } } }, 'mcp'),
      layer('managed:x', undefined),
    ];
    for (const c of cases) {
      for (const kind of ['session.spawn', 'turn']) {
        const r = rig({ billing: c });
        const x = await refusal(r.fuse.reserve(spawn({ kind })));
        expect(x).toMatchObject({ code: 'BILLING_REFUSED', gate: 'billing' });
        expect(JSON.stringify(x)).not.toContain('sk-secret');
        expect(r.kinds('billing.api.refused')).toHaveLength(1);
      }
    }
    // a local backend and non-spawn kinds are not law-7 cells
    const r = rig({ billing: cases[0]! });
    await expect(r.fuse.reserve(spawn({ backend: 'local', scope: { user: 'p:abcdefgh/*', machine: 'dev:abcdefgh/mac' } }))).resolves.toMatchObject({ billing: 'local' });
  });

  it('fileLayers: missing files are skipped, unreadable or corrupt ones are hits', () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'bad.json'), '{not json');
    fs.writeFileSync(path.join(d, 'ok.json'), JSON.stringify({ env: { FOO: '1' } }));
    const layers = fileLayers([
      { where: 'missing', path: path.join(d, 'nope.json'), kind: 'settings' },
      { where: 'bad', path: path.join(d, 'bad.json'), kind: 'settings' },
      { where: 'ok', path: path.join(d, 'ok.json'), kind: 'settings' },
    ]);
    expect(scanApiBilling({ env: () => ({}), layers: () => layers })).toEqual([{ where: 'bad', key: '(unreadable)' }]);
  });
});

describe('G-BUD-01..03', () => {
  it('G-BUD-01: usage only from stream events — permit.reserve params carry no usage; a non-stream source is refused as corrupt', async () => {
    for (const k of ['usage', 'spent', 'tokensUsed']) expect(() => parseReserveParams(AGENT, 'agent', { kind: 'turn', [k]: 0 })).toThrow(RefusedError);
    expect(() => parseReserveParams(AGENT, 'agent', { kind: 'turn', scope: { user: HUMAN } })).toThrow(RefusedError); // the user rung is the caller's
    expect(parseReserveParams(HUMAN, 'human', { kind: 'turn', scope: { repo: 'repo:a' } })).toMatchObject({ op: 'reserve', req: { attended: true, scope: { user: HUMAN, repo: 'repo:a' } } });
    const r = rig();
    const p = await r.fuse.reserve(spawn());
    await r.fuse.recordStreamUsage({ source: 'turn.usage', permitId: p.permitId, tokens: 100 });
    expect(r.kinds('budget.usage')).toHaveLength(1);
    expect(r.fuse.corrupt).toBe(false);
    await r.fuse.recordStreamUsage({ source: 'client-claim' as never, permitId: p.permitId, tokens: 0 });
    expect(r.fuse.corrupt).toBe(true);
  });

  it('G-BUD-02: corrupt state ⇒ deny (malformed usage: NaN, negative, unknown permit)', async () => {
    for (const ev of [{ tokens: Number.NaN }, { tokens: -1 }, { tokens: 1, usd: Number.POSITIVE_INFINITY }, { tokens: 1, permitId: 'permit:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ' }]) {
      const r = rig();
      const p = await r.fuse.reserve(spawn());
      await r.fuse.recordStreamUsage({ source: 'turn.usage', permitId: p.permitId, ...ev } as never);
      expect((await refusal(r.fuse.reserve(spawn({ scope: { user: 'p:abcdefgh/*', repo: 'repo:b' } })))).data).toMatchObject({ dimension: 'corrupt-state' });
    }
  });

  it('G-BUD-03: a mid-turn breach pauses the session and calls onBreach once (the supervisor kills the pgid, M1.7); ladder rungs announced once per scope per day', async () => {
    const breaches: unknown[] = [];
    const r = rig({ onBreach: (b) => breaches.push(b) });
    const p = await r.fuse.reserve(spawn({ scope: { user: 'p:abcdefgh/*', repo: 'repo:a', session: 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ' }, limits: { tokens: 1000 } }));
    await r.fuse.recordStreamUsage({ source: 'turn.usage', permitId: p.permitId, tokens: 900 });
    expect(breaches).toEqual([]);
    await r.fuse.recordStreamUsage({ source: 'turn.result', permitId: p.permitId, tokens: 200 });
    await r.fuse.recordStreamUsage({ source: 'turn.result', permitId: p.permitId, tokens: 200 });
    expect(breaches).toEqual([{ permitId: p.permitId, hsid: 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ', dimension: 'tokens' }]);
    expect(r.kinds('budget.pause').map((x) => x.payload.reason)).toEqual(['breach']);
    const sessionRungs = r.kinds('budget.ladder').filter((x) => x.payload.scope === 'session' && x.payload.dimension === 'tokens').map((x) => x.payload.rung);
    expect(sessionRungs).toEqual([]); // 1 300 of the 400 000 session day budget: below the first rung
  });

  it.todo('G-BUD-03 the breach kills the session’s process group (job object on Windows) within the turn — M1.7 (#supervisor)');
});

describe('G-SUB-04 subscription windows: the armada pauses at the threshold, the human keeps a permit', () => {
  it('70 % of the window used ⇒ agent/unattended denied with ONE budget card; an attended human still gets a permit; resume unpauses', async () => {
    const cfg = structuredClone(DEFAULT_FUSE);
    cfg.subscription.windowTokens = 1000;
    const r = rig({ config: cfg, withBroker: true });
    const p = await r.fuse.reserve(spawn({ kind: 'turn' }));
    await r.fuse.recordStreamUsage({ source: 'turn.usage', permitId: p.permitId, tokens: 700 });
    const x = await refusal(r.fuse.reserve(spawn({ kind: 'turn' })));
    expect(x).toMatchObject({ code: 'BUDGET_DENIED', data: { dimension: 'subscription-window', reservedForHuman: 0.3 } });
    await refusal(r.fuse.reserve(spawn({ kind: 'turn', principal: HUMAN, principalClass: 'human', attended: false }))); // unattended human work is armada
    await expect(r.fuse.reserve({ principal: HUMAN, principalClass: 'human', attended: true, kind: 'turn', scope: { user: HUMAN }, backend: 'claude-code' })).resolves.toMatchObject({ decision: 'allow' });
    expect(r.broker!.cards().filter((c) => c.kind === 'budget')).toHaveLength(1);
    expect(r.kinds('budget.pause').map((y) => y.payload.scope)).toEqual(['armada']);
    await r.fuse.resume(HUMAN);
    await expect(r.fuse.reserve(spawn({ kind: 'turn' }))).resolves.toMatchObject({ decision: 'allow' });
  });

  it('quota.error opens the breaker for 60 min (or a human resume)', async () => {
    const r = rig();
    await r.fuse.quotaError(null);
    expect((await refusal(r.fuse.reserve(spawn()))).data).toMatchObject({ dimension: 'breaker' });
    await r.fuse.resume(HUMAN);
    await expect(r.fuse.reserve(spawn())).resolves.toMatchObject({ decision: 'allow' });
    expect(r.kinds('budget.breaker.close')).toHaveLength(1);
  });

  it.todo('subscription window shape learned from turn.usage/turn.result and rate-limit headers / quota.error — M1.7 (#claude-adapter)');
  it.todo('compute dimension: CPU seconds per hour and wall time per local turn enforced on local sessions — M1.8 (#local-runner, G-LAW-01c)');
  it.todo('day windows from the chain’s last event time (S-L2) wired to #kernel-log head time — next M1.6 slice (the daemon passes the wall clock today)');
});
