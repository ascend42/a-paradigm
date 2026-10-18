/**
 * #budget-fuse as a METER (spec §3.4, §4.8, §10 laws 1 and 7; §19.1 M1.6;
 * P8-D92 "track everything, enforce nothing"): G-LAW-01, G-LAW-01b,
 * G-BUD-01..03, G-SUB-04 and law 7 inside the broker. Falsifier: law 7
 * bypassed by any setting for kernel-spawned sessions. Platform-independent: in-process, temp dirs only.
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

function rig(o: { config?: typeof DEFAULT_FUSE; billing?: BillingScanSource } = {}) {
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const log = async (kind: string, payload: Record<string, unknown>) => void rows.push({ kind, payload });
  const kernel = SoftwareEd25519Signer.generate('kernel');
  const fuse = new BudgetFuse({
    kernel,
    logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ',
    log,
    ...(o.config ? { config: o.config } : {}),
    billing: o.billing ?? clean,
  });
  return { fuse, rows, kernel, kinds: (k: string) => rows.filter((r) => r.kind === k) };
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


describe('law 7 under an api-token', () => {
  it('under an api-token the law-7 scan still runs, ignoring only the injected key', async () => {
    const HS = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ';
    const tokens = { billingForKernelSpawn: (h: string, p: string) => (h === HS && p === HUMAN ? 'api-token:card:01HZZZZZZZZZZZZZZZZZZZZZZZ' : null) };
    const mk = (env: Record<string, string>) =>
      new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:x', log: async () => undefined, billing: { env: () => env, layers: () => [] }, apiTokens: tokens as never });
    const req = { principal: HUMAN, principalClass: 'human', attended: true, kind: 'session.spawn', scope: { user: HUMAN }, backend: 'claude-code' as const, kernelSpawn: { hsid: HS } };
    await expect(mk({ ANTHROPIC_API_KEY: 'sk' }).reserve(req)).resolves.toMatchObject({ billing: 'api-token:card:01HZZZZZZZZZZZZZZZZZZZZZZZ' });
    expect((await refusal(mk({ ANTHROPIC_BASE_URL: 'http://x' }).reserve(req))).code).toBe('BILLING_REFUSED');
  });

});

describe('G-LAW-01 no spawn without a permit — every reserve is granted and attributed (P8-D92)', () => {
  it('a 5-session fan-out ⇒ 5 kernel-signed permit.grant, 0 denies, each attributed to its user', async () => {
    const r = rig();
    const out = await Promise.all([1, 2, 3, 4, 5].map((i) => r.fuse.reserve(spawn({ scope: { user: HUMAN, repo: `repo:${i}` }, attributed: 'root-human' }))));
    expect(out.every((p) => p.decision === 'allow')).toBe(true);
    expect(r.kinds('permit.grant')).toHaveLength(5);
    expect(r.kinds('permit.deny')).toHaveLength(0);
    expect(r.kinds('permit.reserve').map((x) => [x.payload.user, x.payload.attributed, x.payload.armada])).toEqual(Array(5).fill([HUMAN, 'root-human', true]));
    const ring = new KeyRing();
    ring.addEd25519(r.kernel.publicKeyPem);
    const { sig, ...unsigned } = out[0]!;
    expect(out[0]!.permitId).toMatch(/^permit:v1:[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(ring.verify(r.kernel.keyId, 'permit', canonicalJson(unsigned), Buffer.from(sig, 'base64'))).toBe('ok');
  });

  it('nothing is rationed: past every reference amount, a quota error, an over-permit turn and a full window, reserves still grant; rungs are informational rows', async () => {
    const cfg = structuredClone(DEFAULT_FUSE);
    cfg.tokens.user = 1000;
    cfg.subscription.windowTokens = 1000;
    const r = rig({ config: cfg });
    const p = await r.fuse.reserve(spawn({ kind: 'turn', limits: { tokens: 100 } }));
    await r.fuse.recordStreamUsage({ source: 'turn.usage', permitId: p.permitId, tokens: 1500 });
    await r.fuse.quotaError(null);
    for (let i = 0; i < 20; i++) await expect(r.fuse.reserve(spawn({ kind: 'turn' }))).resolves.toMatchObject({ decision: 'allow' });
    expect(r.kinds('permit.deny')).toHaveLength(0);
    expect(r.kinds('budget.ladder').filter((x) => x.payload.scope === 'user' && x.payload.dimension === 'tokens').map((x) => x.payload.rung)).toEqual([0.5, 0.75, 0.9, 1]);
    expect(r.kinds('budget.ladder').every((x) => x.payload.informational === true)).toBe(true);
    expect(r.kinds('budget.usage').filter((x) => x.payload.overPermit)).toHaveLength(1); // G-BUD-03: informational
    expect(r.kinds('budget.window').map((x) => x.payload.quotaError)).toEqual([true]);
    for (const k of ['budget.pause', 'budget.breaker.open', 'approval.request']) expect(r.kinds(k)).toHaveLength(0); // no pause, no breaker, no budget card
  });
});

describe('G-LAW-01b no setting changes the meter or law 7', () => {
  it('fuzzed env names and project.yaml keys change nothing; an API key in env still refuses', async () => {
    const saved = { ...process.env };
    try {
      for (const n of ['GNOMON_FUSE_OFF', 'GNOMON_LAW7', 'GNOMON_ALLOW_API', 'GNOMON_BILLING', 'GNOMON_NO_LAW7']) process.env[n] = '1';
      const r = rig({ billing: { env: () => ({ ANTHROPIC_API_KEY: 'sk' }), layers: () => [] } });
      expect((await refusal(r.fuse.reserve(spawn()))).code).toBe('BILLING_REFUSED');
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
    const repo = tmp();
    fs.mkdirSync(path.join(repo, '.gnomon'));
    fs.writeFileSync(path.join(repo, '.gnomon', 'project.yaml'), 'name: x\nfuse:\n  off: true\nbudget: off\nstrictness:\n  baseline: L0\n');
    const ignored: Array<Record<string, unknown>> = [];
    expect(ignoredProjectKeys(repo, (_k, p) => void ignored.push(p))).toEqual(['fuse', 'budget', 'strictness']);
    expect(ignored).toEqual([{ field: 'fuse', source: 'project.yaml' }, { field: 'budget', source: 'project.yaml' }, { field: 'strictness', source: 'project.yaml' }]);
  });

  it('config: only THIS root’s signed rows apply; unsigned, another root, invalid, older or missing-after-signed fall back to defaults with a logged row; version + hash on every config.loaded', () => {
    const home = tmp();
    const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    const rows: Array<Record<string, unknown>> = [];
    const emit = (_k: string, p: Record<string, unknown>) => void rows.push(p);
    fs.writeFileSync(path.join(home, ROOT_CONFIG_FILE), JSON.stringify({ row: { schemaVersion: 'gnomon-root-config:v1', config: { fuse: { tokens: { user: 9 } } } }, signer: 'x', sig: 'y' }));
    expect(loadFuseConfig(home, root).config).toEqual(DEFAULT_FUSE);
    writeSignedConfig(home, new DevTestRootAuthority(DEV_TEST_ROOT_ACK), { fuse: { tokens: { user: 9 } } });
    expect(loadFuseConfig(home, root).config).toEqual(DEFAULT_FUSE);
    writeSignedConfig(home, root, { fuse: { tokens: { user: 9 } } }, 5);
    expect(loadFuseConfig(home, root, emit)).toMatchObject({ fellBack: false, config: { tokens: { user: 9 } } });
    expect(rows.at(-1)).toMatchObject({ signed: true, version: 5, hash: expect.stringMatching(/^sha256:/) });
    for (const bad of [{ concurrent: { user: 1 } }, { tokens: { user: -1 } }, { breakerMs: 1 }]) {
      writeSignedConfig(home, root, { fuse: bad }, 6);
      expect(loadFuseConfig(home, root, emit)).toMatchObject({ fellBack: true, config: DEFAULT_FUSE });
      expect(rows.at(-1)).toMatchObject({ fallback: 'defaults', why: 'invalid' });
    }
    writeSignedConfig(home, root, { fuse: { tokens: { user: 9 } } }, 4);
    expect(loadFuseConfig(home, root, emit)).toMatchObject({ fellBack: true });
    expect(rows.at(-1)).toMatchObject({ fallback: 'defaults', why: 'older' });
    fs.rmSync(path.join(home, 'config.seen.json'));
    expect(loadFuseConfig(home, root, emit, { chainHighWater: 7 })).toMatchObject({ fellBack: true }); // the chain's mark wins over a rewound sidecar
    fs.rmSync(path.join(home, ROOT_CONFIG_FILE));
    expect(loadFuseConfig(home, root, emit, { chainHighWater: 7 })).toMatchObject({ fellBack: true });
    expect(rows.at(-1)).toMatchObject({ why: 'missing' });
  });
});

describe('tracking (P8-D92)', () => {
  it('P8-D91: human and agent spend land in ONE user bucket; spend is broken down by repo, session, model and backend; local sessions record model + projects', async () => {
    const r = rig();
    const userOf = () => HUMAN;
    const h = parseReserveParams(HUMAN, 'human', { kind: 'turn', model: 'claude-opus', scope: { repo: 'repo:a' } }, userOf);
    const a = parseReserveParams(AGENT, 'agent', { kind: 'turn', model: 'claude-opus' }, userOf);
    if (h.op !== 'reserve' || a.op !== 'reserve') throw new Error('expected reserve');
    expect(a.req).toMatchObject({ scope: { user: HUMAN }, attributed: 'root-human' });
    const hp = await r.fuse.reserve(h.req);
    const ap = await r.fuse.reserve(a.req);
    await r.fuse.recordStreamUsage({ source: 'turn.usage', permitId: hp.permitId, tokens: 600, usd: 0.5 });
    await r.fuse.recordStreamUsage({ source: 'turn.result', permitId: ap.permitId, tokens: 400 });
    const HS = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ';
    const lp = await r.fuse.reserve({ principal: HUMAN, principalClass: 'human', attended: true, kind: 'session.spawn', backend: 'local', model: 'qwen3-8b', scope: { user: HUMAN, repo: 'repo:b', session: HS } });
    await r.fuse.recordStreamUsage({ source: 'turn.usage', permitId: lp.permitId, tokens: 50 });
    expect(r.fuse.spent('user', HUMAN)).toBe(1050);
    const st = r.fuse.status() as { mode: string; enforced: string[]; spend: Record<string, Record<string, { tokens: number }>>; local: unknown[]; subscriptionWindow: { used: { n: number } } };
    expect(st).toMatchObject({ mode: 'meter', enforced: ['law-7'] });
    expect(st.spend.byUser[HUMAN]!.tokens).toBe(1050);
    expect(st.spend.byRepo['repo:a']!.tokens).toBe(600);
    expect(st.spend.byModel['claude-opus']!.tokens).toBe(1000);
    expect(st.spend.byBackend).toMatchObject({ 'claude-code': { tokens: 1000 }, local: { tokens: 50 } });
    expect(st.spend.bySession[HS]!.tokens).toBe(50);
    expect(st.local).toEqual([{ session: HS, model: 'qwen3-8b', repos: ['repo:b'], tokens: 50 }]);
    expect(st.subscriptionWindow.used.n).toBe(1000); // G-SUB-04: measured and shown, never a reserve
  });

  it('G-BUD-01: usage only from stream events — reserve params carry no usage; a non-stream source is logged and dropped', async () => {
    for (const k of ['usage', 'spent', 'tokensUsed']) expect(() => parseReserveParams(AGENT, 'agent', { kind: 'turn', [k]: 0 }, () => HUMAN)).toThrow(RefusedError);
    for (const k of ['repo', 'loop', 'session', 'machine']) expect(() => parseReserveParams(AGENT, 'agent', { kind: 'turn', scope: { [k]: 'x' } }, () => HUMAN)).toThrow(RefusedError); // the kernel binds them
    expect(() => parseReserveParams(AGENT, 'agent', { kind: 'turn' })).toThrow(RefusedError); // no resolvable human
    const r = rig();
    const p = await r.fuse.reserve(spawn());
    await r.fuse.recordStreamUsage({ source: 'client-claim' as never, permitId: p.permitId, tokens: 99 });
    expect(r.fuse.spent('user', 'p:abcdefgh/*')).toBe(0);
  });

  it('G-BUD-02: malformed usage (NaN, negative, infinite USD, unknown permit) is logged and dropped; tracking continues and reserves still grant', async () => {
    const r = rig();
    const p = await r.fuse.reserve(spawn());
    for (const ev of [{ tokens: Number.NaN }, { tokens: -1 }, { tokens: 1, usd: Number.POSITIVE_INFINITY }, { tokens: 1, permitId: 'permit:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ' }]) {
      await r.fuse.recordStreamUsage({ source: 'turn.usage', permitId: p.permitId, ...ev } as never);
    }
    expect(r.kinds('budget.usage').filter((x) => x.payload.malformed)).toHaveLength(4);
    await r.fuse.recordStreamUsage({ source: 'turn.usage', permitId: p.permitId, tokens: 10 });
    expect(r.fuse.spent('user', 'p:abcdefgh/*')).toBe(10);
    await expect(r.fuse.reserve(spawn())).resolves.toMatchObject({ decision: 'allow' });
  });

  it('release twice concurrently: one release row', async () => {
    const r = rig();
    const p = await r.fuse.reserve(spawn());
    const out = await Promise.allSettled([r.fuse.release(p.permitId, AGENT), r.fuse.release(p.permitId, AGENT)]);
    expect(out.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(r.kinds('permit.release')).toHaveLength(1);
  });

  it.todo('rebuild the day and window counters from budget.usage rows at boot (today in memory; a restart forgets the day) — next slice, with S-L2 (the chain’s last event time)');
  it.todo('subscription window shape learned from turn.usage/turn.result and rate-limit headers — M1.7 (#claude-adapter)');
});
