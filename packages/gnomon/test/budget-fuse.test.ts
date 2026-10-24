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
  parseSessionsSection,
  parseSessionPath,
  SESSION_PATH_MAX_ENTRIES,
  SESSION_PATH_MAX_ENTRY,
  type BillingScanSource,
  type FuseRow,
  type ReserveRequest,
} from '../src/kernel/budget/index.js';
import { KeyRing, SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { DEV_TEST_ROOT_ACK, DevTestRootAuthority } from '../src/kernel/identity/root-authority.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { settingSourcesFor } from '../src/adapters/claude-code/adapter.js';

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


describe('Aegis L1: law 7 for every claude-code permit kind except tool.permission', () => {
  for (const kind of ['session.spawn', 'turn', 'tend.llm', 'oracle.reviewer', 'teacher.draft', 'mod.spend']) {
    it(`${kind} on claude-code with an API key in env ⇒ BILLING_REFUSED`, async () => {
      const r = rig({ billing: { env: () => ({ ANTHROPIC_API_KEY: 'sk' }), layers: () => [] } });
      expect((await refusal(r.fuse.reserve(spawn({ kind })))).code).toBe('BILLING_REFUSED');
      expect(r.kinds('billing.api.refused')).toHaveLength(1);
    });
  }
  it('tool.permission starts no process: granted without a scan', async () => {
    const r = rig({ billing: { env: () => ({ ANTHROPIC_API_KEY: 'sk' }), layers: () => [] } });
    await expect(r.fuse.reserve(spawn({ kind: 'tool.permission' }))).resolves.toMatchObject({ decision: 'allow' });
  });
});

describe('law 7 under an api-token', () => {
  it('a HUMAN permit.reserve naming the api-token hsid in scope.session WITHOUT kernelSpawn bills the subscription (never api credits)', async () => {
    const HS = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ';
    const tokens = { billingForKernelSpawn: (h: string, p: string) => (h === HS && p === HUMAN ? 'api-token:card:01HZZZZZZZZZZZZZZZZZZZZZZZ' : null), onTurn: async () => undefined };
    const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:x', log: async () => undefined, billing: clean, apiTokens: tokens });
    await expect(fuse.reserve({ principal: HUMAN, principalClass: 'human', attended: true, kind: 'session.spawn', scope: { user: HUMAN, session: HS }, backend: 'claude-code' })).resolves.toMatchObject({ billing: 'subscription' });
    await expect(fuse.reserve({ principal: HUMAN, principalClass: 'human', attended: true, kind: 'session.spawn', scope: { user: HUMAN, session: HS }, backend: 'claude-code', kernelSpawn: { hsid: HS } })).resolves.toMatchObject({ billing: 'api-token:card:01HZZZZZZZZZZZZZZZZZZZZZZZ' });
  });

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

  it('T-2026-10-18-010 L4: config.sessions.hooks — default audited (P8-D94); user-only / none / all applied when signed; invalid or rollback ⇒ none (fail closed); unsigned first run ⇒ audited', () => {
    const home = tmp();
    const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    const rows: Array<Record<string, unknown>> = [];
    const emit = (_k: string, p: Record<string, unknown>) => void rows.push(p);
    expect(loadFuseConfig(home, root).sessions).toEqual({ hooks: 'audited', path: null }); // no config ever: the founder's default (P8-D94)
    fs.writeFileSync(path.join(home, ROOT_CONFIG_FILE), JSON.stringify({ row: { schemaVersion: 'gnomon-root-config:v1', config: { sessions: { hooks: 'none' } } }, signer: 'x', sig: 'y' }));
    expect(loadFuseConfig(home, root).sessions).toEqual({ hooks: 'audited', path: null }); // unsigned on a first run: defaults, never applied
    writeSignedConfig(home, root, { sessions: { hooks: 'user-only' } }, 1);
    expect(loadFuseConfig(home, root, emit).sessions).toEqual({ hooks: 'user-only', path: null });
    expect(rows.at(-1)).toMatchObject({ signed: true, sessions: { hooks: 'user-only' } });
    writeSignedConfig(home, root, { sessions: { hooks: 'none' } }, 2);
    expect(loadFuseConfig(home, root).sessions).toEqual({ hooks: 'none', path: null });
    for (const bad of [{ hooks: 'project' }, { hooks: true }, { hooks: 'all', extra: 1 }, 'all', null]) {
      writeSignedConfig(home, root, { sessions: bad }, 3);
      expect(loadFuseConfig(home, root, emit).sessions, JSON.stringify(bad)).toEqual({ hooks: 'none', path: null });
      expect(rows.at(-1)).toMatchObject({ why: 'invalid', sessions: { hooks: 'none' } });
    }
    // Aegis low: an invalid FUSE section beside a valid sessions section ⇒ none too
    writeSignedConfig(home, root, { fuse: { breakerMs: 1 }, sessions: { hooks: 'all' } }, 4);
    expect(loadFuseConfig(home, root, emit).sessions).toEqual({ hooks: 'none', path: null });
    expect(rows.at(-1)).toMatchObject({ why: 'invalid', sessions: { hooks: 'none' } });
    writeSignedConfig(home, root, { sessions: { hooks: 'all' } }, 0); // older than the high-water mark
    expect(loadFuseConfig(home, root).sessions).toEqual({ hooks: 'none', path: null });
    fs.rmSync(path.join(home, ROOT_CONFIG_FILE));
    expect(loadFuseConfig(home, root).sessions).toEqual({ hooks: 'none', path: null }); // missing after a signed one
  });
  it('TD-2026-10-21-077: config.sessions.path — applied when signed and valid; invalid ⇒ the default (null) with a logged config.loaded{why:invalid}', () => {
    const home = tmp();
    const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    const rows: Array<Record<string, unknown>> = [];
    const emit = (_k: string, p: Record<string, unknown>) => void rows.push(p);
    writeSignedConfig(home, root, { sessions: { path: ['/opt/tools/bin', '/usr/bin'] } }, 1);
    expect(loadFuseConfig(home, root, emit).sessions).toEqual({ hooks: 'audited', path: ['/opt/tools/bin', '/usr/bin'] });
    expect(rows.at(-1)).toMatchObject({ signed: true, sessions: { path: ['/opt/tools/bin', '/usr/bin'] } });
    const long = `/${'a'.repeat(SESSION_PATH_MAX_ENTRY)}`;
    const many = Array.from({ length: SESSION_PATH_MAX_ENTRIES + 1 }, (_, i) => `/d${i}`);
    const joined = [`/a${path.delimiter}/b`]; // the host PATH delimiter (':' POSIX, ';' win32)
    for (const bad of [[], ['relative/bin'], [''], joined, ['/a\n'], [long], many, '/usr/bin', [1]]) {
      writeSignedConfig(home, root, { sessions: { path: bad } }, 2);
      expect(loadFuseConfig(home, root, emit).sessions.path, JSON.stringify(bad).slice(0, 60)).toBeNull();
      expect(rows.at(-1)).toMatchObject({ why: 'invalid', fallback: 'defaults' });
    }
    expect(parseSessionPath(['C:\\tools\\bin'], 'win32')).toEqual(['C:\\tools\\bin']);
    expect(parseSessionPath(['C:\\a;D:\\b'], 'win32')).toBeUndefined();
    expect(parseSessionPath(['/usr/bin'], 'linux')).toEqual(['/usr/bin']);
    expect(parseSessionPath(null)).toBeNull();
  });
  it('T-2026-10-18-010 L4: parseSessionsSection + settingSourcesFor map the four modes', () => {
    expect(parseSessionsSection(undefined)).toEqual({ hooks: 'audited', path: null });
    expect(parseSessionsSection({})).toEqual({ hooks: 'audited', path: null });
    expect(parseSessionsSection({ hooks: 'all' })).toEqual({ hooks: 'all', path: null });
    expect(settingSourcesFor('audited')).toEqual(['user']); // repo layers only through the kernel's audited extract
    expect(settingSourcesFor('all')).toEqual(['user', 'project', 'local']);
    expect(settingSourcesFor('user-only')).toEqual(['user']);
    expect(settingSourcesFor('none')).toEqual([]);
    expect(() => settingSourcesFor('project' as never)).toThrow(TypeError);
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

  it.todo('subscription window shape learned from turn.usage/turn.result and rate-limit headers — M1.7 (#claude-adapter)');
});

describe('the meter survives a restart (M1.6 slice 2: restore from the chain, S-L2)', () => {
  const DAY = Date.UTC(2026, 9, 18, 0, 0, 0);
  /** A fuse whose rows carry the chain time `at` = t.now; the day and window follow `t.last` (the chain's last event time). */
  const KP = 'p:abcdefgh/kernel';
  const KEY = 'ed25519:kernelkey';
  const TRUST = { principals: [KP], isKernelKey: (k: string) => k === KEY };
  function timed(t: { now: number; last: number; wall?: number }, config?: typeof DEFAULT_FUSE, skews: unknown[] = []) {
    const rows: FuseRow[] = [];
    const fuse = new BudgetFuse({
      kernel: SoftwareEd25519Signer.generate('kernel'),
      logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ',
      // the rig's log stamps the row with chain time t.now and returns it, like the daemon's
      log: async (kind, payload) => {
        const at = new Date(t.now).toISOString();
        rows.push({ kind, at, principal: KP, keyId: KEY, payload: JSON.parse(JSON.stringify(payload)) as Record<string, unknown> });
        return { at };
      },
      ...(config ? { config } : {}),
      billing: clean,
      clock: () => t.wall ?? t.now,
      lastEventTime: () => t.last,
      onClockSkew: (d) => void skews.push(d),
    });
    return { fuse, rows };
  }
  const human = (over: Partial<ReserveRequest> = {}): ReserveRequest => ({ principal: HUMAN, principalClass: 'human', attended: true, kind: 'session.spawn', scope: { user: HUMAN, repo: 'repo:a', loop: 'loop:1', session: 'hs:1' }, backend: 'claude-code', model: 'opus', ...over });

  it('today’s spend on every axis (incl. loop, from the joined permit.grant), the window and the local sessions come back after a restart', async () => {
    const t = { now: DAY + 10 * 3_600_000, last: DAY + 10 * 3_600_000 };
    const a = timed(t);
    const p1 = await a.fuse.reserve(human());
    await a.fuse.recordStreamUsage({ source: 'turn.usage', permitId: p1.permitId, tokens: 120, usd: 0.5 });
    const p2 = await a.fuse.reserve(human({ backend: 'local', model: 'qwen', scope: { user: HUMAN, repo: 'repo:b', session: 'hs:2' } }));
    await a.fuse.recordStreamUsage({ source: 'turn.result', permitId: p2.permitId, tokens: 30 });
    const before = a.fuse.status();
    const b = timed(t);
    expect(b.fuse.restore(a.rows, TRUST)).toEqual({ usage: 2, ladder: 0, untrusted: 0 });
    const after = b.fuse.status();
    expect(after.spend).toEqual(before.spend);
    expect(after.local).toEqual(before.local);
    expect(after.subscriptionWindow).toEqual(before.subscriptionWindow);
    expect(b.fuse.spent('loop', 'loop:1')).toBe(120);
    expect(b.fuse.spent('user', HUMAN, 'usd')).toBe(0.5);
    // tracking continues on top of the restored day
    const p3 = await b.fuse.reserve(human());
    await b.fuse.recordStreamUsage({ source: 'turn.usage', permitId: p3.permitId, tokens: 5 });
    expect(b.fuse.spent('user', HUMAN)).toBe(155);
  });

  it('yesterday counts in the rolling window but not in today; “today” is the chain’s last event time, never the wall clock', async () => {
    const t = { now: DAY - 3_600_000, last: DAY - 3_600_000 }; // 23:00 yesterday
    const a = timed(t);
    const p = await a.fuse.reserve(human());
    await a.fuse.recordStreamUsage({ source: 'turn.usage', permitId: p.permitId, tokens: 40 });
    t.now = t.last = DAY + 3_600_000; // 01:00 today
    await a.fuse.recordStreamUsage({ source: 'turn.usage', permitId: p.permitId, tokens: 2 });
    const b = timed({ now: DAY + 3 * 86_400_000, last: DAY + 3_600_000 }); // wall clock days later; chain says 01:00 today
    expect(b.fuse.restore(a.rows, TRUST).usage).toBe(1);
    expect(b.fuse.spent('user', HUMAN)).toBe(2);
    expect((b.fuse.status().subscriptionWindow as { used: { n: number } }).used.n).toBe(42); // the 5 h window spans midnight
  });

  it('a rung announced before the restart is not announced again the same day; malformed, over-permit and grant-less usage rows count nothing', async () => {
    const t = { now: DAY + 3_600_000, last: DAY + 3_600_000 };
    const cfg = structuredClone(DEFAULT_FUSE);
    cfg.tokens.user = 100;
    const a = timed(t, cfg);
    const p = await a.fuse.reserve(human({ limits: { tokens: 10 } }));
    await a.fuse.recordStreamUsage({ source: 'turn.usage', permitId: p.permitId, tokens: 60 }); // 50 % rung + over-permit row
    await a.fuse.recordStreamUsage({ source: 'turn.usage', permitId: 'permit:01HZZZZZZZZZZZZZZZZZZZZZZZ', tokens: 9 }); // malformed (unknown permit)
    expect(a.rows.filter((r) => r.kind === 'budget.ladder')).toHaveLength(1);
    const forged: FuseRow[] = [
      { kind: 'budget.usage', at: new Date(t.now).toISOString(), principal: KP, keyId: KEY, payload: { permitId: 'permit:01HZZZZZZZZZZZZZZZZZZZZZZY', source: 'turn.usage', tokens: 1_000_000, user: HUMAN } }, // no grant on the chain
      { kind: 'budget.usage', at: new Date(t.now).toISOString(), principal: KP, keyId: KEY, payload: { permitId: p.permitId, source: 'stdin', tokens: 1_000_000, user: HUMAN } }, // not a stream event
      { kind: 'budget.usage', at: 'not a time', principal: KP, keyId: KEY, payload: { permitId: p.permitId, source: 'turn.usage', tokens: 1_000_000, user: HUMAN } },
      { kind: 'budget.usage', at: new Date(t.now).toISOString(), principal: KP, keyId: KEY, payload: { permitId: p.permitId, source: 'turn.usage', tokens: 1_000_000, user: 'p:abcdefgh/someone-else' } }, // user is not the grant's
    ];
    const b = timed(t, cfg);
    expect(b.fuse.restore([...a.rows, ...forged], TRUST)).toEqual({ usage: 1, ladder: 1, untrusted: 0 });
    expect(b.fuse.spent('user', HUMAN)).toBe(60);
    const before = b.rows.length;
    const q = await b.fuse.reserve(human());
    await b.fuse.recordStreamUsage({ source: 'turn.usage', permitId: q.permitId, tokens: 1 });
    expect(b.rows.slice(before).filter((r) => r.kind === 'budget.ladder')).toHaveLength(0); // 61 % — the 50 % rung was already said today
    await b.fuse.recordStreamUsage({ source: 'turn.usage', permitId: q.permitId, tokens: 15 });
    expect(b.rows.slice(before).filter((r) => r.kind === 'budget.ladder').map((r) => r.payload.rung)).toEqual([0.75]);
  });
});

describe('restore trusts only the kernel (Aegis C1) and a future-dated chain never moves the day (Aegis low)', () => {
  const KP = 'p:abcdefgh/kernel';
  const KEY = 'ed25519:kernelkey';
  const TRUST = { principals: [KP], isKernelKey: (k: string) => k === KEY };
  const T = Date.UTC(2026, 9, 18, 10);
  const at = new Date(T).toISOString();
  const grant = (principal: string, keyId: string | undefined, permitId: string, user: string): FuseRow => ({
    kind: 'permit.grant', at, principal, ...(keyId ? { keyId } : {}),
    payload: { permit: { permitId, scope: { org: null, team: null, user, repo: 'repo:a', loop: null, session: null, machine: null }, backend: 'claude-code', model: 'opus', hsid: null } },
  });
  const usage = (principal: string, keyId: string | undefined, permitId: string, user: string, tokens: number): FuseRow => ({ kind: 'budget.usage', at, principal, ...(keyId ? { keyId } : {}), payload: { permitId, source: 'turn.usage', tokens, user } });
  const fuse = (clock = T) => new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log: async () => undefined, billing: clean, clock: () => clock, lastEventTime: () => T });

  it('a forged grant/usage pair under a non-kernel principal, an unsigned row, or a non-kernel key counts nothing', () => {
    const f = fuse();
    const P1 = 'permit:01HZZZZZZZZZZZZZZZZZZZZZZ1', P2 = 'permit:01HZZZZZZZZZZZZZZZZZZZZZZ2', P3 = 'permit:01HZZZZZZZZZZZZZZZZZZZZZZ3';
    const out = f.restore(
      [
        grant(AGENT, KEY, P1, HUMAN), usage(AGENT, KEY, P1, HUMAN, 1_000), // a non-kernel principal, even with a kernel keyId
        grant(KP, undefined, P2, HUMAN), usage(KP, undefined, P2, HUMAN, 1_000), // the kernel's name, unsigned
        grant(KP, 'ed25519:other', P3, HUMAN), usage(KP, 'ed25519:other', P3, HUMAN, 1_000), // the kernel's name, another key
        usage(KP, KEY, P1, HUMAN, 1_000), // a genuine usage row pointing at the forged grant
      ],
      TRUST,
    );
    expect(out).toEqual({ usage: 0, ladder: 0, untrusted: 6 });
    expect(f.spent('user', HUMAN)).toBe(0);
    const g = fuse();
    expect(g.restore([grant(KP, KEY, P1, HUMAN), usage(KP, KEY, P1, HUMAN, 7)], TRUST)).toEqual({ usage: 1, ladder: 0, untrusted: 0 });
    expect(g.spent('user', HUMAN)).toBe(7);
  });

  it('a chain time beyond wall + 5 min is clamped to the wall clock and reported once', async () => {
    const skews: unknown[] = [];
    const wall = Date.UTC(2026, 9, 18, 23, 0);
    const t = { now: wall, last: wall + 2 * 86_400_000 }; // the chain claims two days ahead
    const f = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log: async () => ({ at: new Date(t.last).toISOString() }), billing: clean, clock: () => t.now, lastEventTime: () => t.last, onClockSkew: (d) => void skews.push(d) });
    const p = await f.reserve({ principal: HUMAN, principalClass: 'human', attended: true, kind: 'session.spawn', scope: { user: HUMAN }, backend: 'claude-code' });
    await f.recordStreamUsage({ source: 'turn.usage', permitId: p.permitId, tokens: 3 });
    expect((f.status() as { day: string }).day).toBe('2026-10-18');
    expect(f.spent('user', HUMAN)).toBe(3);
    expect(skews).toEqual([{ chainAt: t.last, wall }]);
    // within the allowance: trusted as is
    const ok: unknown[] = [];
    const g = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log: async () => undefined, billing: clean, clock: () => wall, lastEventTime: () => wall + 4 * 60_000, onClockSkew: (d) => void ok.push(d) });
    expect((g.status() as { day: string }).day).toBe('2026-10-18');
    expect(ok).toEqual([]);
  });

  it('runtime and restore count a turn under the usage row’s own time, not the last event time', async () => {
    const t = { now: Date.UTC(2026, 9, 17, 23, 59), last: Date.UTC(2026, 9, 18, 0, 1) }; // row written 23:59, a later row at 00:01
    const rows: FuseRow[] = [];
    const f = new BudgetFuse({
      kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', billing: clean, clock: () => t.last, lastEventTime: () => t.last,
      log: async (kind, payload) => { const a = new Date(t.now).toISOString(); rows.push({ kind, at: a, principal: KP, keyId: KEY, payload: JSON.parse(JSON.stringify(payload)) as Record<string, unknown> }); return { at: a }; },
    });
    const p = await f.reserve({ principal: HUMAN, principalClass: 'human', attended: true, kind: 'session.spawn', scope: { user: HUMAN }, backend: 'claude-code' });
    await f.recordStreamUsage({ source: 'turn.usage', permitId: p.permitId, tokens: 9 });
    expect(f.spent('user', HUMAN)).toBe(0); // counted under 2026-10-17 (the row's day); today (last event) is the 18th
    const g = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log: async () => undefined, billing: clean, clock: () => t.last, lastEventTime: () => t.last });
    expect(g.restore(rows, TRUST).usage).toBe(0); // restore agrees: not today's
    expect((f.status() as { subscriptionWindow: { used: { n: number } } }).subscriptionWindow.used.n).toBe(9);
    expect((g.status() as { subscriptionWindow: { used: { n: number } } }).subscriptionWindow.used.n).toBe(9);
  });
});

describe('§2.4 rule 11 permit carry-over (founder ruling; T-2026-10-19-014 B2, Aegis M2/L3)', () => {
  const HS = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ';
  const LOG = 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ';
  const DRAINED = 'ev:01HZZZZZZZZZZZZZZZZZZZZZZZ';
  const TTL = 60 * 60_000;
  const mk = (now: { t: number }) => {
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: LOG, log: async (kind, payload) => void rows.push({ kind, payload: payload as Record<string, unknown> }), billing: clean, clock: () => now.t, permitTtlMs: TTL });
    return { fuse, rows };
  };
  const grant = async (t0: number) => {
    const old = mk({ t: t0 });
    return old.fuse.reserve({ principal: HUMAN, principalClass: 'human', attended: true, kind: 'session.spawn', scope: { user: HUMAN, session: HS }, backend: 'claude-code' });
  };
  const permitRows = (rows: Array<{ kind: string }>) => rows.filter((r) => r.kind.startsWith('permit.'));

  it('a permit live at the drain but older than the TTL at resume is re-attributed with a fresh window; nothing minted', async () => {
    const t0 = Date.parse('2026-10-19T10:00:00.000Z');
    const permit = await grant(t0);
    const drainedAt = new Date(t0 + TTL - 1000).toISOString(); // live at the drain
    const now = { t: t0 + 3 * TTL }; // the resume runs long after the old expiry
    const fresh = mk(now);
    const out = await fresh.fuse.reattribute(permit, { hsid: HS, principal: HUMAN, drainedEventId: DRAINED, drainedAt });
    expect(out.permitId).toBe(permit.permitId);
    expect(out.expiresAt).toBe(new Date(now.t + TTL).toISOString());
    expect(fresh.fuse.permit(permit.permitId)).toEqual(out);
    expect(permitRows(fresh.rows)).toEqual([{ kind: 'permit.reattributed', payload: { permitId: permit.permitId, hsid: HS, drainedEventId: DRAINED, renewedByDrain: true, expiresAt: out.expiresAt } }]);
    // the drain instant equal to the expiry is still "live at the drain"
    const again = mk({ t: now.t });
    await expect(again.fuse.reattribute(permit, { hsid: HS, principal: HUMAN, drainedEventId: DRAINED, drainedAt: permit.expiresAt })).resolves.toMatchObject({ permitId: permit.permitId });
  });

  it('a permit that expired BEFORE the drain is refused; nothing is minted or held', async () => {
    const t0 = Date.parse('2026-10-19T10:00:00.000Z');
    const permit = await grant(t0);
    const fresh = mk({ t: t0 + 2 * TTL });
    const e = await fresh.fuse.reattribute(permit, { hsid: HS, principal: HUMAN, drainedEventId: DRAINED, drainedAt: new Date(t0 + TTL + 1).toISOString() }).then(() => undefined, (x: unknown) => x);
    expect(e).toBeInstanceOf(RefusedError);
    expect((e as RefusedError).refusal).toMatchObject({ code: 'PERMIT_REQUIRED', data: { cause: 'expired-before-drain' } });
    expect(permitRows(fresh.rows)).toEqual([]);
    expect(fresh.fuse.permit(permit.permitId)).toBeUndefined();
    // a missing drain time is not "live at the drain"
    const e2 = await fresh.fuse.reattribute(permit, { hsid: HS, principal: HUMAN, drainedEventId: DRAINED, drainedAt: '' }).then(() => undefined, (x: unknown) => x);
    expect((e2 as RefusedError).refusal.data).toMatchObject({ cause: 'expired-before-drain' });
  });

  it('L3: a permit held by another principal is refused (assertClaudePermit does not check the principal)', async () => {
    const t0 = Date.parse('2026-10-19T10:00:00.000Z');
    const permit = await grant(t0);
    const fresh = mk({ t: t0 + 1000 });
    const e = await fresh.fuse.reattribute(permit, { hsid: HS, principal: 'p:abcdefgh/mallory', drainedEventId: DRAINED, drainedAt: new Date(t0 + 500).toISOString() }).then(() => undefined, (x: unknown) => x);
    expect((e as RefusedError).refusal).toMatchObject({ code: 'PERMIT_REQUIRED', data: { cause: 'not-this-principal' } });
    expect(permitRows(fresh.rows)).toEqual([]);
  });
});
