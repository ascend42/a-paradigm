// @gnomon-platform: darwin, linux
/**
 * #local-config-request (TD-2026-10-22-769, $local-config-flow): a REAL home's local-model config. The real
 * ApprovalBroker over the counting fake helper (helper 1.9.0 decision.sign with the TS row table, so the batch rules
 * the Swift helper enforces run here) and the real HardwareRootAuthority (the helper's root key); tmp dirs only.
 *
 *   - the ONE input check refuses LAN (lands in 8.1), public, a cloud compat, no model, a claude runner, a relative
 *     runner, a runner without cli.js and the kernel's own web port;
 *   - the card's detail.rootRows equal the rows the allow signs (createdAt dropped); allow writes a file the loader
 *     accepts with the same root; deny writes nothing; a stale version and a changed runner tree are refused;
 *   - a set edits ONE endpoint by id and keeps the others ("unchanged" on the card);
 *   - hot apply: the loop model port's configured() lists the endpoint with no restart; a live session keeps its config;
 *   - remove is notify-and-proceed; a dev-home file copied into a real home is not applied;
 *   - request.local.probe: read-only, loopback only, human only, rate-limited;
 *   - a helper older than 1.9.0 refuses the card at raise; the bundled runner pin verifies (dist);
 *   - end to end: a loop with a model node refused no-local-model (a start refusal for its alert), then the card is
 *     allowed and the same loop reaches its model node.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ApprovalBroker } from '../src/kernel/broker/index.js';
import { HardwareRootAuthority, HelperApprovalsKey } from '../src/kernel/identity/index.js';
import { DEV_TEST_ROOT_ACK, DevTestRootAuthority } from '../src/kernel/identity/root-authority.js';
import { intentOf } from '../src/kernel/identity/decision-batch.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { LOCAL_CONFIG_FILE, LOCAL_SEEN_FILE, loadLocalConfig, localChainHighWater, localChainRemoved, nextLocalVersion, validateLocalEndpoints, writeHomeFileAtomic, writeSignedLocalConfig, type LocalLaneConfig } from '../src/kernel/local/config.js';
import { localStatusFor } from '../src/kernel/socket/dispatch.js';
import { CHANGED_WHILE_OPEN, LocalConfigCards, validateLocalConfigInput, type LocalAsker, type LocalProbeSink } from '../src/kernel/local/config-request.js';
import { compiledLocalRunnerPin, defaultLocalRunner } from '../src/kernel/local/bundled-runner.js';
import { pinOf, treeHash } from '../src/kernel/local/runner-pin.js';
import { compileLoop, loopFileJson } from '../src/loops/index.js';
import { readShebang } from '../src/kernel/loops/hash.js';
import { LoopLedger } from '../src/kernel/loops/ledger.js';
import { loopRunRefInfo, LoopRegistry } from '../src/kernel/loops/registry.js';
import { LoopRunner } from '../src/kernel/loops/runner.js';
import type { LoopModelPort } from '../src/kernel/loops/model-node.js';
import type { CheckResult } from '../src/kernel/loops/check-exec.js';
import { repoKeyOf } from '../src/kernel/supervisor/repo-hooks.js';
import { CountingFakeHelper } from './helper-fake.js';
import { PKG_ROOT } from './helpers.js';

const KERNEL = 'p:abcdefgh/kernel';
const HUMAN = 'p:abcdefgh/matt';
const GEN = 'test0001';
const DEV = 'dev:01HZZZZZZZZZZZZZZZZZZZZZZD';
const gui = (): LocalAsker & { surface: string; deviceId: string } => ({ connId: 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA', principal: HUMAN, principalClass: 'human', surface: 'browser', credential: 'gui', deviceId: DEV });

const tmps: string[] = [];
function tmp(prefix: string): string {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) removeTree(tmps.pop()!);
});

function runnerDir(text = '// a stand-in gnomon-local (gnomon-local-runner:v1)\n'): string {
  const d = tmp('gnomon-runner-');
  fs.writeFileSync(path.join(d, 'cli.js'), text);
  return d;
}

async function refusal(p: Promise<unknown> | (() => unknown)): Promise<{ code: string; reason: unknown; data: Record<string, unknown>; message: string }> {
  let e: unknown;
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (x) {
    e = x;
  }
  const ref = (e as { refusal?: { code: string; data?: Record<string, unknown> } }).refusal;
  expect(ref, String(e)).toBeDefined();
  return { code: ref!.code, reason: ref!.data?.reason, data: ref!.data ?? {}, message: (e as Error).message };
}

/** A helper-held approvals key whose helper never says its version (Aegis L2). */
class UnknownVersionKey extends HelperApprovalsKey {
  override async helperVersion(): Promise<string | null> {
    return null;
  }
}

function rig(o: { version?: string; unknownVersion?: boolean; runner?: string; fetch?: (u: string, i: RequestInit) => Promise<Response>; lane?: LocalProbeSink } = {}) {
  const home = tmp('gnomon-home-');
  const helper = new CountingFakeHelper(GEN, { version: o.version ?? '1.9.0', bounds: { idleSeconds: 12 * 3600, absoluteSeconds: 12 * 3600, maxSignatures: 512 } });
  const approvals = new (o.unknownVersion ? UnknownVersionKey : HelperApprovalsKey)({ gen: GEN, approvalsPublicKeyPem: helper.publicPem('approvals') }, HUMAN, helper);
  const root = new HardwareRootAuthority({ gen: GEN, rootPublicKeyPem: helper.publicPem('root') }, { helper, once: () => { throw new Error('never the once seam'); } });
  const logged: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const broker = new ApprovalBroker({ kernel: SoftwareEd25519Signer.generate('kernel'), kernelPrincipal: KERNEL, log: async (kind, payload) => void logged.push({ kind, payload }), approvals, root });
  const events: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const state = { cfg: loadLocalConfig(home, root) };
  const applied: string[] = [];
  const runner = o.runner ?? runnerDir();
  const cards = new LocalConfigCards({
    home,
    broker,
    forbiddenPorts: () => [7531],
    chainHighWater: () => localChainHighWater(events.map((e) => e.payload)),
    current: () => state.cfg.config,
    // the daemon's reloadLocalConfig, minus the supervisor
    onApplied: (why, removedVersion) => {
      applied.push(why);
      state.cfg = loadLocalConfig(home, root, (kind, payload) => void events.push({ kind, payload }), { chainHighWater: localChainHighWater(events.map((e) => e.payload)), chainRemoved: localChainRemoved(events.map((e) => e.payload)), ...(why === 'removed' ? { missing: 'removed' as const, ...(removedVersion !== undefined ? { removedVersion } : {}) } : {}) });
    },
    defaultRunner: () => ({ ok: true, dir: runner, source: 'bundled', treeSha256: treeHash(runner) }),
    bundledPin: () => treeHash(runner),
    verify: root,
    platform: 'darwin',
    probeGapMs: 50,
    ...(o.fetch ? { probeFetch: o.fetch } : {}),
    ...(o.lane ? { lane: o.lane } : {}),
  });
  return { home, helper, broker, root, logged, events, state, applied, runner, cards };
}

const setEp = (endpoint: Record<string, unknown>, runner?: string) => ({ op: 'set', endpoint, ...(runner ? { runner } : {}) });

describe('#local-config-request: the ONE input check (shared with gnomon dev local)', () => {
  const dir = (): string => runnerDir();
  const ok = (input: Record<string, unknown>) => validateLocalConfigInput({ runner: dir(), ...input }, { forbiddenPorts: [7531] });
  it('defaults: Ollama on this Mac; loops only when asked', () => {
    expect(ok({ model: 'qwen3.5:9b' }).endpoint).toEqual({ id: 'ollama', base: 'http://127.0.0.1:11434', model: 'qwen3.5:9b', compat: 'ollama' });
    // localhost is canonicalized to 127.0.0.1 (one spelling on the card and in the signed row)
    expect(ok({ model: 'm', base: 'http://localhost:8080', compat: 'llama.cpp', id: 'coder', loops: true }).endpoint).toEqual({ id: 'coder', base: 'http://127.0.0.1:8080', model: 'm', compat: 'llama.cpp', loops: true });
    expect(ok({ model: 'm', base: 'http://[::1]:1234/', compat: 'lm-studio' }).endpoint.base).toBe('http://[::1]:1234');
  });
  it('refuses LAN (lands in 8.1), public, a cloud compat, no model, the kernel port', async () => {
    for (const base of ['http://192.168.1.20:11434', 'http://10.0.0.5:8080', 'http://[fd00::1]:8080']) {
      const r = await refusal(() => ok({ model: 'm', base }));
      expect(r).toMatchObject({ code: 'ENGINE', reason: 'not-implemented', data: { milestone: '8.1', why: 'lan-endpoint' } });
      expect(r.message).toMatch(/LAN endpoints are not supported yet/);
    }
    for (const base of ['https://api.anthropic.com', 'http://8.8.8.8:80', 'http://169.254.169.254', 'http://example.com:11434']) expect((await refusal(() => ok({ model: 'm', base }))).code).toBe('BILLING_REFUSED');
    expect((await refusal(() => ok({ model: 'm', base: 'http://127.0.0.1:7531' }))).data).toMatchObject({ why: 'port' });
    expect((await refusal(() => ok({ model: 'm', compat: 'openai' }))).data).toMatchObject({ field: 'compat' });
    expect((await refusal(() => ok({}))).data).toMatchObject({ field: 'model' });
    expect((await refusal(() => ok({ model: 'x'.repeat(129) }))).data).toMatchObject({ field: 'model' });
    expect((await refusal(() => ok({ model: 'm', id: '../x' }))).data).toMatchObject({ field: 'id' });
    expect((await refusal(() => ok({ model: 'm', surprise: 1 }))).data).toMatchObject({ field: 'surprise' });
    // Aegis L1: no path, query or fragment in 8.0
    for (const base of ['http://127.0.0.1:11434/v1', 'http://127.0.0.1:11434/api?x=1', 'http://127.0.0.1:11434/#a']) expect((await refusal(() => ok({ model: 'm', base }))).data, base).toMatchObject({ field: 'base', why: 'base-path' });
  });
  it('refuses a relative runner, a runner without cli.js and a claude runner', async () => {
    expect((await refusal(() => validateLocalConfigInput({ model: 'm', runner: 'gnomon-local/dist' }))).data).toMatchObject({ field: 'runner' });
    expect((await refusal(() => validateLocalConfigInput({ model: 'm', runner: tmp('empty-') }))).data).toMatchObject({ field: 'runner', why: 'no-runner' });
    const claude = path.join(tmp('cc-'), 'node_modules', '@anthropic-ai', 'claude-code');
    fs.mkdirSync(claude, { recursive: true });
    fs.writeFileSync(path.join(claude, 'cli.js'), '// not gnomon-local\n');
    expect((await refusal(() => validateLocalConfigInput({ model: 'm', runner: claude }))).code).toBe('PERMIT_REQUIRED');
  });
});

describe('#local-config-request: the root card', () => {
  it('raises ONE grant card (local.config, root class, hand only); rootRows are the prepared rows minus createdAt; allow writes a file the loader accepts', async () => {
    const r = rig();
    const res = (await r.cards.request(gui(), setEp({ model: 'qwen3.5:9b', loops: true }))) as { pending: boolean; cardId: string; version: number; previous: number | null };
    expect(res).toMatchObject({ pending: true, version: 1, previous: null });
    const card = r.broker.card(res.cardId)!;
    expect(card.kind).toBe('grant');
    const text = JSON.stringify(card.block);
    for (const want of ['Set up the local model', 'asked from Settings · ', 'applies at once, no restart', 'This decision signs:', 'local model config v1 · new', 'endpoint ollama · an Ollama server at http://127.0.0.1:11434', 'model qwen3.5:9b · loops may use it', 'runner gnomon-local', 'bundled · tree ', 'Loopback only; LAN endpoints are not supported yet', 'Allow takes the root key and your presence (Touch ID or your Mac password)']) expect(text).toContain(want);
    expect(text).not.toContain('Not on Windows');
    const rootRows = (card.block as { children: Array<{ type: string; detail?: { rootRows: unknown[]; action: string } }> }).children.find((c) => c.type === 'root-rows')!.detail!;
    expect(rootRows.action).toBe('local.config');
    // voice and `always` never decide it
    expect((await refusal(r.broker.approve({ ...gui(), principalClass: 'voice' }, { cardId: res.cardId, decision: 'allow' }))).code).toBe('FORBIDDEN');
    expect((await refusal(r.broker.approve(gui(), { cardId: res.cardId, decision: 'always' }))).code).toBe('BAD_REQUEST');
    const d = await r.broker.approve(gui(), { cardId: res.cardId, decision: 'allow' });
    expect(d.presence).toBe('fresh');
    expect(r.helper.evaluations).toBe(1);
    expect(r.helper.shown.at(-1)).toContain('ONE presence signs allow on local.config');
    expect(r.helper.shown.at(-1)).toContain('local model config v1: endpoint ollama http://127.0.0.1:11434 model qwen3.5:9b (ollama) loops: yes');
    expect(r.logged.find((x) => x.kind === 'approval.decide')!.payload).toMatchObject({ rootKind: 'local.config', presence: 'fresh' });
    // the file: the signed row is the prepared row; minus createdAt it is exactly what the card showed
    const doc = JSON.parse(fs.readFileSync(path.join(r.home, LOCAL_CONFIG_FILE), 'utf8')) as { row: Record<string, unknown>; signer: string };
    expect(typeof doc.row.createdAt).toBe('string');
    expect(intentOf(doc.row)).toEqual(rootRows.rootRows[0]);
    expect((fs.statSync(path.join(r.home, LOCAL_CONFIG_FILE)).mode & 0o777).toString(8)).toBe('600');
    // the hot apply ran and the loader accepts it with the SAME root
    expect(r.applied).toEqual(['set']);
    expect(r.state.cfg).toMatchObject({ signed: true, version: 1, signer: doc.signer });
    expect(r.state.cfg.config?.endpoints).toEqual([{ id: 'ollama', base: 'http://127.0.0.1:11434', model: 'qwen3.5:9b', compat: 'ollama', loops: true }]);
    expect(r.state.cfg.config?.runner).toMatchObject({ dir: r.runner, entry: 'cli.js', treeSha256: treeHash(r.runner) });
  });

  it('deny writes nothing; a second set takes the next version and says "replaces"', async () => {
    const r = rig();
    const a = (await r.cards.request(gui(), setEp({ model: 'm1' }))) as { cardId: string };
    await r.broker.approve(gui(), { cardId: a.cardId, decision: 'deny' });
    expect(fs.existsSync(path.join(r.home, LOCAL_CONFIG_FILE))).toBe(false);
    expect(r.applied).toEqual([]);
    const b = (await r.cards.request(gui(), setEp({ model: 'm1' }))) as { cardId: string };
    await r.broker.approve(gui(), { cardId: b.cardId, decision: 'allow' });
    const c = (await r.cards.request({ ...gui(), credential: 'device' }, setEp({ model: 'm2' }))) as { cardId: string; version: number; previous: number };
    expect(c).toMatchObject({ version: 2, previous: 1 });
    const text = JSON.stringify(r.broker.card(c.cardId)!.block);
    expect(text).toContain('Change the local model');
    expect(text).toContain('asked from the terminal');
    expect(text).toContain('local model config v1 → v2');
    expect(text).toContain('changes: model m1 → m2');
  });

  it('TOCTOU: a newer config written while the card is open (stale version), or a changed runner tree, is refused: ask again', async () => {
    const r = rig();
    const a = (await r.cards.request(gui(), setEp({ model: 'm' }))) as { cardId: string };
    fs.writeFileSync(path.join(r.home, LOCAL_SEEN_FILE), JSON.stringify({ version: 5 }));
    const e1 = await refusal(r.broker.approve(gui(), { cardId: a.cardId, decision: 'allow' }));
    expect(e1.message).toContain(CHANGED_WHILE_OPEN);
    fs.rmSync(path.join(r.home, LOCAL_SEEN_FILE));
    const b = (await r.cards.request(gui(), setEp({ model: 'm' }))) as { cardId: string };
    fs.writeFileSync(path.join(r.runner, 'cli.js'), '// swapped\n');
    expect((await refusal(r.broker.approve(gui(), { cardId: b.cardId, decision: 'allow' }))).message).toContain(CHANGED_WHILE_OPEN);
    expect(fs.existsSync(path.join(r.home, LOCAL_CONFIG_FILE))).toBe(false);
    expect(r.helper.evaluations).toBe(0); // refused before any prompt
  });

  it('a set edits ONE endpoint by id and keeps the others; the card lists them unchanged', async () => {
    const r = rig();
    const allow = async (p: unknown) => {
      const x = (await r.cards.request(gui(), p)) as { cardId: string };
      await r.broker.approve(gui(), { cardId: x.cardId, decision: 'allow' });
      return x.cardId;
    };
    await allow(setEp({ model: 'small', id: 'fast', base: 'http://127.0.0.1:11434' }));
    await allow(setEp({ model: 'big', id: 'coder', base: 'http://127.0.0.1:8080', compat: 'llama.cpp', loops: true }));
    expect(r.state.cfg.config?.endpoints.map((e) => e.id)).toEqual(['fast', 'coder']);
    const third = (await r.cards.request(gui(), setEp({ model: 'smaller', id: 'fast', base: 'http://127.0.0.1:11434' }))) as { cardId: string; unchanged: string[]; change: string };
    expect(third).toMatchObject({ unchanged: ['coder'], change: 'edit' });
    const text = JSON.stringify(r.broker.card(third.cardId)!.block);
    expect(text).toContain('endpoint coder · unchanged (http://127.0.0.1:8080 · big)');
    expect(text).toContain('changes: model small → smaller');
    await r.broker.approve(gui(), { cardId: third.cardId, decision: 'allow' });
    expect(r.state.cfg.config?.endpoints).toEqual([
      { id: 'fast', base: 'http://127.0.0.1:11434', model: 'smaller', compat: 'ollama' },
      { id: 'coder', base: 'http://127.0.0.1:8080', model: 'big', compat: 'llama.cpp', loops: true },
    ]);
  });

  it('only the human on a gui or device connection asks; remove is notify-and-proceed (no card) and logs why removed', async () => {
    const r = rig();
    for (const asker of [{ ...gui(), principalClass: 'agent' }, { ...gui(), principalClass: 'voice' }, { ...gui(), principalClass: 'session' }, { ...gui(), credential: 'read-token' }]) {
      expect(await refusal(r.cards.request(asker, setEp({ model: 'm' })))).toMatchObject({ code: 'FORBIDDEN', reason: 'matrix' });
      expect(await refusal(r.cards.request(asker, { op: 'remove' }))).toMatchObject({ code: 'FORBIDDEN', reason: 'matrix' });
      expect(await refusal(r.cards.probe(asker, { model: 'm' }))).toMatchObject({ code: 'FORBIDDEN', reason: 'matrix' });
    }
    const a = (await r.cards.request(gui(), setEp({ model: 'm' }))) as { cardId: string };
    await r.broker.approve(gui(), { cardId: a.cardId, decision: 'allow' });
    const prompts = r.helper.evaluations;
    const cardsBefore = r.logged.filter((x) => x.kind === 'approval.request').length;
    expect(await r.cards.request(gui(), { op: 'remove' })).toMatchObject({ removed: true, existed: true, now: expect.stringContaining('model: any sessions go to Claude') });
    expect(r.helper.evaluations).toBe(prompts);
    expect(r.logged.filter((x) => x.kind === 'approval.request').length).toBe(cardsBefore);
    expect(fs.existsSync(path.join(r.home, LOCAL_CONFIG_FILE))).toBe(false);
    expect(r.state.cfg.config).toBeUndefined();
    expect(r.events.at(-1)).toMatchObject({ kind: 'config.loaded', payload: { file: LOCAL_CONFIG_FILE, fallback: 'none', why: 'removed' } });
    // the old signed file copied back is refused as older than the high-water mark (the sidecar is kept)
    expect(await r.cards.request(gui(), { op: 'remove' })).toMatchObject({ removed: true, existed: false });
  });

  it('a dev-home file copied into a real home is not applied (the dev root is not this root)', () => {
    const r = rig();
    writeSignedLocalConfig(r.home, new DevTestRootAuthority(DEV_TEST_ROOT_ACK), { endpoints: [{ id: 'ollama', base: 'http://127.0.0.1:11434', model: 'm', compat: 'ollama', loops: true }], runner: pinOf(r.runner, 'cli.js') }, 9);
    const ev: string[] = [];
    const loaded = loadLocalConfig(r.home, r.root, (k, p) => void ev.push(`${k}:${String(p.why)}`));
    expect(loaded.config).toBeUndefined();
    expect(ev).toEqual(['config.unsigned:signature']);
  });

  it('a helper older than 1.9.0 refuses the card when it is raised: update the Gnomon app (nothing is logged or prompted)', async () => {
    const r = rig({ version: '1.8.0' });
    const e = await refusal(r.cards.request(gui(), setEp({ model: 'm' })));
    expect(e).toMatchObject({ code: 'UNSUPPORTED', reason: 'presence', data: { why: 'helper-too-old', minVersion: '1.9.0' } });
    expect(e.message).toMatch(/update the Gnomon app/);
    expect(r.logged).toEqual([]);
    expect(r.cards.pendingCardId()).toBeNull();
  });

  it('Windows says so in words on the card (a click key refuses root at decide)', async () => {
    const r = rig();
    const cards = new LocalConfigCards({ home: r.home, broker: r.broker, forbiddenPorts: () => [], chainHighWater: () => 0, onApplied: () => undefined, defaultRunner: () => ({ ok: true, dir: r.runner, source: 'bundled', treeSha256: treeHash(r.runner) }), bundledPin: () => treeHash(r.runner), platform: 'win32' });
    const a = (await cards.request(gui(), setEp({ model: 'm' }))) as { cardId: string };
    expect(JSON.stringify(r.broker.card(a.cardId)!.block)).toContain('Not on Windows in 8.0: a root-class decision needs the Windows root key');
  });
});

describe('Aegis review fixes (merge after fixes)', () => {
  it('M3: a remove is durable: the tombstone outranks the removed file, which never applies again, and the chain row says removed', async () => {
    const r = rig();
    const a = (await r.cards.request(gui(), setEp({ model: 'm' }))) as { cardId: string };
    await r.broker.approve(gui(), { cardId: a.cardId, decision: 'allow' });
    const saved = fs.readFileSync(path.join(r.home, LOCAL_CONFIG_FILE), 'utf8');
    const res = (await r.cards.request(gui(), { op: 'remove' })) as { version: number };
    expect(res.version).toBe(2);
    expect(JSON.parse(fs.readFileSync(path.join(r.home, LOCAL_SEEN_FILE), 'utf8'))).toEqual({ version: 2, removed: true });
    expect(r.events.at(-1)).toMatchObject({ kind: 'config.loaded', payload: { removed: true, version: 2, fallback: 'none', why: 'removed' } });
    // replaying the removed (validly signed) file: refused, by the tombstone sidecar AND by the chain alone
    fs.writeFileSync(path.join(r.home, LOCAL_CONFIG_FILE), saved);
    const ev: string[] = [];
    expect(loadLocalConfig(r.home, r.root, (k, p) => void ev.push(String(p.why))).config).toBeUndefined();
    expect(ev).toEqual(['older']);
    fs.rmSync(path.join(r.home, LOCAL_SEEN_FILE));
    expect(loadLocalConfig(r.home, r.root, () => undefined, { chainRemoved: localChainRemoved(r.events.map((e) => e.payload)) }).config).toBeUndefined();
    // a new set after the remove takes the next version and applies
    const b = (await r.cards.request(gui(), setEp({ model: 'm' }))) as { cardId: string; version: number };
    expect(b.version).toBe(3);
  });

  it('M3: Allow after Remove is refused (the open card is stale); a remove waits for no prompt and is serialized with root decisions', async () => {
    const r = rig();
    const a = (await r.cards.request(gui(), setEp({ model: 'm' }))) as { cardId: string };
    await r.cards.request(gui(), { op: 'remove' });
    expect((await refusal(r.broker.approve(gui(), { cardId: a.cardId, decision: 'allow' }))).message).toContain(CHANGED_WHILE_OPEN);
    expect(fs.existsSync(path.join(r.home, LOCAL_CONFIG_FILE))).toBe(false);
    // while a root decision is in flight on this home, a remove is refused busy (never interleaved)
    const { beginRootDecision } = await import('../src/kernel/manifest/grant-lock.js');
    const release = beginRootDecision(r.home);
    try {
      await expect(r.cards.request(gui(), { op: 'remove' })).rejects.toThrow();
    } finally {
      release();
    }
  });

  it('M2: status.local in full for the human only', () => {
    const full = { configured: true, offered: true, loopbackOnly: true, endpoints: [{ id: 'ollama', base: 'http://127.0.0.1:11434' }], runner: { dir: '/x' }, lastFallback: { cwd: '/secret' } };
    expect(localStatusFor('human', full)).toBe(full);
    for (const cls of ['agent', 'session', 'mod', 'voice', 'readToken', 'peer']) expect(localStatusFor(cls, full)).toEqual({ configured: true, loopbackOnly: true, offered: true });
  });

  it('L2: an unknown helper version on a hardware root counts as too old', async () => {
    const r = rig({ unknownVersion: true });
    expect(await refusal(r.cards.request(gui(), setEp({ model: 'm' })))).toMatchObject({ code: 'UNSUPPORTED', data: { why: 'helper-too-old', helperVersion: null } });
  });

  it('L3: the lane refuses a LAN endpoint at every open in 8.0, whoever signed it (why lan-8.1)', async () => {
    expect((await refusal(() => validateLocalEndpoints({ endpoints: [{ id: 'lan', base: 'http://192.168.1.20:11434', model: 'm', compat: 'ollama' }] }, []))).data).toMatchObject({ why: 'lan-8.1' });
    expect(validateLocalEndpoints({ endpoints: [{ id: 'lo', base: 'http://127.0.0.1:11434', model: 'm', compat: 'ollama' }] }, [])).toHaveLength(1);
  });

  it('L5: a runner called bundled must hash to the compiled pin', async () => {
    const r = rig();
    const cards = new LocalConfigCards({ home: r.home, broker: r.broker, forbiddenPorts: () => [], chainHighWater: () => 0, onApplied: () => undefined, defaultRunner: () => ({ ok: true, dir: r.runner, source: 'bundled', treeSha256: treeHash(r.runner) }), bundledPin: () => 'f'.repeat(64) });
    expect((await refusal(cards.request(gui(), setEp({ model: 'm' })))).data).toMatchObject({ why: 'bundled-pin' });
  });

  it('L6: an override runner must be gnomon-local (package.json or marker); the signed row and the helper line say override', async () => {
    const r = rig();
    const plain = tmp('plain-');
    fs.writeFileSync(path.join(plain, 'cli.js'), '// some script\n');
    expect((await refusal(r.cards.request(gui(), setEp({ model: 'm' }, plain)))).data).toMatchObject({ why: 'not-gnomon-local' });
    const pkg = tmp('pkg-');
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@a-company/gnomon-local', version: '8.0.0' }));
    fs.mkdirSync(path.join(pkg, 'dist'));
    fs.writeFileSync(path.join(pkg, 'dist', 'cli.js'), '// built\n');
    const a = (await r.cards.request(gui(), setEp({ model: 'm' }, path.join(pkg, 'dist')))) as { cardId: string };
    await r.broker.approve(gui(), { cardId: a.cardId, decision: 'allow' });
    expect(r.helper.shown.at(-1)).toContain(`OVERRIDE runner ${path.join(pkg, 'dist')}/cli.js`);
    expect(JSON.parse(fs.readFileSync(path.join(r.home, LOCAL_CONFIG_FILE), 'utf8')).row.runnerSource).toBe('override');
  });

  it('L8: an unsigned file does not push the next version; the sidecar is never written through a symlink', () => {
    const r = rig();
    fs.writeFileSync(path.join(r.home, LOCAL_CONFIG_FILE), JSON.stringify({ row: { schemaVersion: 'gnomon-root-local:v1', version: 999, local: {} }, signer: 'x', sig: 'y' }));
    expect(nextLocalVersion(r.home, 0, r.root).version).toBe(1);
    expect(nextLocalVersion(r.home, 0).version).toBe(1000); // without a root (old behaviour), it would
    fs.rmSync(path.join(r.home, LOCAL_CONFIG_FILE));
    const target = path.join(tmp('elsewhere-'), 'x.json');
    fs.writeFileSync(target, '{}');
    fs.symlinkSync(target, path.join(r.home, LOCAL_SEEN_FILE));
    expect(() => writeHomeFileAtomic(r.home, LOCAL_SEEN_FILE, '{"version":1}\n')).toThrow(/symlink/);
    expect(fs.readFileSync(target, 'utf8')).toBe('{}');
  });
});

describe('request.local.probe: the read-only check before a card', () => {
  const server = (o: { models?: string[]; tools?: boolean; nCtx?: number; down?: boolean } = {}) => {
    const seen: string[] = [];
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
    const fetch = async (u: string): Promise<Response> => {
      seen.push(u);
      if (o.down) throw new Error('connect ECONNREFUSED');
      if (u.endsWith('/health')) return json({ status: 'ok' });
      if (u.endsWith('/slots')) return json([{ n_ctx: o.nCtx ?? 32768 }]);
      if (u.endsWith('/props')) return json({});
      if (u.endsWith('/v1/models')) return json({ data: (o.models ?? ['qwen3.5:9b']).map((id) => ({ id })) });
      if (u.endsWith('/v1/chat/completions')) return json({ choices: [{ message: { tool_calls: o.tools === false ? [] : [{ function: { name: 'get_time', arguments: '{"tz":"UTC"}' } }] } }] });
      return new Response('', { status: 404 });
    };
    return { fetch, seen };
  };
  it('answers ok, tools native and the context size; writes nothing and raises no card', async () => {
    const s = server();
    const r = rig({ fetch: s.fetch });
    expect(await r.cards.probe(gui(), { model: 'qwen3.5:9b', base: 'http://127.0.0.1:8080', compat: 'llama.cpp' })).toMatchObject({ ok: true, why: 'capable', toolsNative: true, contextSize: 32768, model: 'qwen3.5:9b', listed: true });
    expect(r.logged).toEqual([]);
    expect(fs.existsSync(path.join(r.home, LOCAL_CONFIG_FILE))).toBe(false);
    expect(s.seen.every((u) => u.startsWith('http://127.0.0.1:8080/'))).toBe(true);
  });
  it('says why: the model is missing, no tools, a small context, no answer', async () => {
    const cases: Array<[Parameters<typeof server>[0], string]> = [[{ models: ['other'] }, 'model-missing'], [{ tools: false }, 'no-tools'], [{ nCtx: 4096 }, 'ctx-below-floor'], [{ down: true }, 'probe-failed']];
    for (const [o, why] of cases) {
      const r = rig({ fetch: server(o).fetch });
      const got = await r.cards.probe(gui(), { model: 'qwen3.5:9b' });
      expect(got).toMatchObject({ ok: false, why, model: 'qwen3.5:9b' }); // Aegis L1: the configured model, never the server's ids[0]
      if (why === 'model-missing') expect(got.listed).toBe(false);
      if (why === 'probe-failed') expect(got.error).toBe('unreachable');
    }
  });
  it('never touches a non-loopback address, and is rate-limited', async () => {
    const s = server();
    const r = rig({ fetch: s.fetch });
    expect((await refusal(r.cards.probe(gui(), { model: 'm', base: 'http://192.168.1.20:11434' }))).data).toMatchObject({ why: 'lan-endpoint' });
    expect((await refusal(r.cards.probe(gui(), { model: 'm', base: 'https://api.anthropic.com' }))).code).toBe('BILLING_REFUSED');
    expect(s.seen).toEqual([]);
    await r.cards.probe(gui(), { model: 'qwen3.5:9b' });
    expect((await refusal(r.cards.probe(gui(), { model: 'qwen3.5:9b' }))).data).toMatchObject({ why: 'rate-limited' });
  });
  it('Check again on a CONFIGURED endpoint shows as probing, then refreshes lastProbe and the probe cache; an unsaved address does not', async () => {
    const { LocalLane } = await import('../src/kernel/supervisor/local-session.js');
    let laneFetches = 0;
    const lane = new LocalLane({ log: async () => undefined, children: { intend: () => undefined, track: () => undefined, stop: async () => false } as never, fuse: {} as never, home: tmp('h-'), kernelPrincipal: KERNEL, sock: '/tmp/x', sessionPath: null, pathDenies: [], identity: null, probeFetch: async () => { laneFetches++; throw new Error('the lane never probes here'); } });
    lane.setConfig({ endpoints: [{ id: 'llama', base: 'http://127.0.0.1:8080', model: 'qwen3.5:9b', compat: 'llama.cpp' }] });
    const s = server({ nCtx: 4096 });
    let seenProbing: unknown = 'never asked';
    const fetch = async (u: string, i: RequestInit): Promise<Response> => {
      if (seenProbing === 'never asked') seenProbing = lane.probing();
      return s.fetch(u);
    };
    const r = rig({ fetch, lane });
    expect(lane.probing()).toBeNull();
    // an unsaved address: no probing, no lastProbe
    await r.cards.probe(gui(), { model: 'other-model', base: 'http://127.0.0.1:8080', compat: 'llama.cpp' });
    expect(seenProbing).toBeNull();
    expect(lane.lastProbe()).toBeNull();
    await new Promise((res) => setTimeout(res, 60)); // the rig's 50 ms rate limit
    seenProbing = 'never asked';
    const got = await r.cards.probe(gui(), { model: 'qwen3.5:9b', base: 'http://127.0.0.1:8080/', compat: 'llama.cpp' });
    expect(got).toMatchObject({ ok: false, why: 'ctx-below-floor' });
    expect(seenProbing).toMatchObject({ endpoint: 'llama', since: expect.any(String) });
    expect(lane.probing()).toBeNull();
    expect(lane.lastProbe()).toMatchObject({ endpoint: 'llama', ok: false, why: 'ctx-below-floor', contextSize: 4096 });
    // slice C4'a: Check again also measured the tool skill in the background (through the lane's own fetch); settled
    await lane.tierSettled();
    laneFetches = 0;
    // the cache took it: probeAll within the TTL asks the server nothing (the fingerprint and the measurement too)
    expect(await lane.probeAll()).toEqual([{ endpoint: 'llama', ok: true }]);
    await lane.tierSettled();
    expect(laneFetches).toBe(0);
    // model-missing is said as such on the health row
    await new Promise((res) => setTimeout(res, 60));
    const r2 = rig({ fetch: server({ models: ['other'] }).fetch, lane });
    await r2.cards.probe(gui(), { model: 'qwen3.5:9b', base: 'http://127.0.0.1:8080', compat: 'llama.cpp' });
    expect(lane.lastProbe()).toMatchObject({ endpoint: 'llama', ok: false, why: 'model-missing' });
  });
  it('a check begun under an older config records nothing', async () => {
    const { LocalLane } = await import('../src/kernel/supervisor/local-session.js');
    const lane = new LocalLane({ log: async () => undefined, children: { intend: () => undefined, track: () => undefined, stop: async () => false } as never, fuse: {} as never, home: tmp('h-'), kernelPrincipal: KERNEL, sock: '/tmp/x', sessionPath: null, pathDenies: [], identity: null });
    const cfg: LocalLaneConfig = { endpoints: [{ id: 'llama', base: 'http://127.0.0.1:8080', model: 'qwen3.5:9b', compat: 'llama.cpp' }] };
    lane.setConfig(cfg);
    const fetch = async (u: string): Promise<Response> => {
      lane.setConfig(cfg); // a config applied while the check ran
      return server().fetch(u);
    };
    await rig({ fetch, lane }).cards.probe(gui(), { model: 'qwen3.5:9b', base: 'http://127.0.0.1:8080', compat: 'llama.cpp' });
    expect(lane.lastProbe()).toBeNull();
  });
});

describe('the bundled gnomon-local runner', () => {
  it('verifies against its pin: a matching tree is the default, a changed one is refused (reinstall)', () => {
    const d = tmp('dist-');
    fs.mkdirSync(path.join(d, 'gnomon-local'));
    fs.writeFileSync(path.join(d, 'gnomon-local', 'cli.js'), '// bundled\n');
    const pin = treeHash(path.join(d, 'gnomon-local'));
    expect(defaultLocalRunner(d, pin)).toMatchObject({ ok: true, source: 'bundled', treeSha256: pin });
    expect(defaultLocalRunner(path.join(d, 'cli'), pin)).toMatchObject({ ok: true, source: 'bundled' });
    fs.writeFileSync(path.join(d, 'gnomon-local', 'cli.js'), '// swapped\n');
    expect(defaultLocalRunner(d, pin)).toMatchObject({ ok: false, why: expect.stringMatching(/does not match this build's pin: reinstall Gnomon/) });
    expect(defaultLocalRunner(tmp('nothing-'), pin)).toMatchObject({ ok: false });
    expect(compiledLocalRunnerPin()).toBeNull(); // from src: no compiled pin (the clone's build is the dev default)
  });
  it('the built kernel (dist) carries gnomon-local and its compiled pin verifies at load', async () => {
    const index = path.join(PKG_ROOT, 'dist', 'index.js');
    if (!fs.existsSync(path.join(PKG_ROOT, 'dist', 'gnomon-local', 'cli.js'))) return; // no build in this checkout
    const m = (await import(index)) as { bundledRunner: { compiledLocalRunnerPin(): string | null; defaultLocalRunner(): { ok: boolean; source?: string; treeSha256?: string } } };
    const pin = m.bundledRunner.compiledLocalRunnerPin();
    expect(pin).toMatch(/^[0-9a-f]{64}$/);
    expect(m.bundledRunner.defaultLocalRunner()).toMatchObject({ ok: true, source: 'bundled', treeSha256: pin });
    expect(treeHash(path.join(PKG_ROOT, 'dist', 'gnomon-local'))).toBe(pin);
  });
});

describe('end to end: a loop with a model node waits on the card, then reaches its model node', () => {
  it('refused no-local-model (a start refusal per loop, cleared on apply), then allowed: the run opens its model step', async () => {
    const r = rig();
    // the daemon's model port: configured() reads the CURRENT config (hot apply, no restart)
    const opened: string[] = [];
    const port: LoopModelPort = {
      configured: () => ({ endpoints: (r.state.cfg.config?.endpoints ?? []).filter((e) => e.loops === true).map((e) => e.id), runner: r.state.cfg.config?.runner !== undefined, any: r.state.cfg.config?.endpoints.length ?? 0 }),
      openLoop: async (ref) => {
        opened.push(loopRunRefInfo(ref)!.nodeId);
        return { hsid: 'hs_01HZZZZZZZZZZZZZZZZZZZZZZZ', model: 'qwen3.5:9b', endpoint: 'ollama', permitId: 'permit:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ', ask: async () => ({ text: 'digest: all green', tokens: 10, stopReason: 'stop', error: null }), close: async () => undefined };
      },
    };
    const repo = tmp('gnomon-repo-');
    fs.mkdirSync(path.join(repo, '.git'));
    fs.mkdirSync(path.join(repo, 'bin'));
    fs.writeFileSync(path.join(repo, 'bin', 'check'), '#!/usr/bin/env node\nprocess.exit(0)\n');
    const def = { schema: 'loop:v2', id: 'tidy', triggers: [{ schedule: { daily: '18:30' } }], start: 'a', nodes: [{ id: 'a', type: 'check', run: ['bin/check', 'x'], on: { pass: 'digest', fail: 'digest' } }, { id: 'digest', type: 'model', role: 'summarize', model: { use: 'local' }, inputs: ['a.evidence'], on: { any: '@stop' } }] };
    const c = compileLoop(def, { scope: 'repo', readShebang: (a0) => (a0.includes('/') ? readShebang(path.join(repo, a0)) : null) });
    if (!c.compiled) throw new Error(JSON.stringify(c.errors));
    fs.mkdirSync(path.join(repo, '.paradigm', 'loops'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.paradigm', 'loops', 'tidy.loop.json'), loopFileJson(c.compiled));
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    let registry!: LoopRegistry;
    const ledger = new LoopLedger({ kernelPrincipal: KERNEL });
    const append = async (kind: string, payload: Record<string, unknown>): Promise<void> => {
      const row = { kind, principal: KERNEL, at: new Date().toISOString(), payload };
      rows.push({ kind, payload });
      registry.observe(row);
      ledger.observe(row);
    };
    registry = new LoopRegistry({ home: r.home, kernelPrincipal: KERNEL, append, watch: false, rescanMs: 0 });
    registry.addRepo(repo);
    registry.scan();
    const key = `repo/${repoKeyOf([repo])}/tidy`;
    const e = registry.verify(key)!;
    registry.observe({ kind: 'loop.trusted', principal: KERNEL, payload: { loopId: e.loopId, scope: e.scope, repoKey: e.repoKey, contentHash: e.hash!.contentHash, coreHash: e.hash!.coreHash, by: HUMAN } });
    const pass: CheckResult = { verdict: 'pass', exitCode: 0, signal: null, durationMs: 1, evidence: { stdoutTail: 'ok', stderrTail: '', stdoutTruncated: false, stderrTruncated: false, redactions: [], label: 'private', sensitive: true }, profileHash: null, envKeys: [], copy: { dir: '', files: 0, bytes: 0, kept: false } };
    const runner = new LoopRunner({ home: r.home, kernelPrincipal: KERNEL, registry, ledger, append, platform: 'darwin', broker: { raise: async (i: any) => ({ cardId: i.cardId }) as any }, check: async () => pass, model: port, caps: { modelBackoffMs: [1] } });
    // 0. never fired: refused right now from the config and its trust (count 0, trigger none), one per loop
    expect(runner.status().startRefused).toEqual([expect.objectContaining({ key, code: 'no-local-model', why: 'none', count: 0, trigger: 'none', modelNodes: ['digest'] })]);
    const firstSeen = (runner.status().startRefused as Array<{ since: string }>)[0]!.since;
    // 1. no config: the scheduled fire is refused before any step, recorded for the GUI's stack alert
    expect(() => runner.start(key, { type: 'schedule', dueAt: '2026-10-22T18:30:00.000Z' })).toThrow(/no local model is configured/);
    expect(() => runner.start(key, { type: 'schedule', dueAt: '2026-10-23T18:30:00.000Z' })).toThrow(/no-local-model|no local model/);
    expect((runner.status().startRefused as unknown[])).toEqual([expect.objectContaining({ key, loopId: 'tidy', code: 'no-local-model', why: 'none', count: 2, trigger: 'schedule', modelNodes: ['digest'], since: firstSeen })]);
    await Promise.resolve();
    expect(rows.filter((x) => x.kind === 'loop.trigger.fired').map((x) => x.payload.refused)).toEqual([{ code: 'no-local-model', why: 'none' }, { code: 'no-local-model', why: 'none' }]);
    // 2. a sessions-only config: still refused, why sessions-only
    const s1 = (await r.cards.request(gui(), setEp({ model: 'qwen3.5:9b' }))) as { cardId: string };
    await r.broker.approve(gui(), { cardId: s1.cardId, decision: 'allow' });
    runner.recheckStartRefusals();
    expect(() => runner.start(key, { type: 'schedule' })).toThrow();
    expect((runner.status().startRefused as Array<{ why: string }>)[0]!.why).toBe('sessions-only');
    // 3. the human allows a config whose endpoint loops may use: applied hot, the refusal clears, the loop runs
    const s2 = (await r.cards.request(gui(), setEp({ model: 'qwen3.5:9b', loops: true }))) as { cardId: string };
    await r.broker.approve(gui(), { cardId: s2.cardId, decision: 'allow' });
    runner.recheckStartRefusals();
    expect(runner.status().startRefused).toEqual([]);
    const started = runner.start(key, { type: 'manual', by: HUMAN });
    if (!('done' in started)) throw new Error('not started');
    await started.done;
    expect(opened).toEqual(['digest']);
  });
});

describe('LocalLane hot apply', () => {
  it('setConfig replaces what new opens use and clears the probe cache', async () => {
    const { LocalLane } = await import('../src/kernel/supervisor/local-session.js');
    const lane = new LocalLane({ log: async () => undefined, children: { intend: () => undefined, track: () => undefined, stop: async () => false } as never, fuse: {} as never, home: tmp('h-'), kernelPrincipal: KERNEL, sock: '/tmp/x', sessionPath: null, pathDenies: [], identity: null });
    expect(lane.config()).toBeUndefined();
    const cfg: LocalLaneConfig = { endpoints: [{ id: 'ollama', base: 'http://127.0.0.1:1', model: 'm', compat: 'ollama' }] };
    lane.setConfig(cfg);
    expect(lane.config()).toBe(cfg);
    lane.setConfig(undefined);
    expect(lane.config()).toBeUndefined();
    expect(lane.lastProbe()).toBeNull();
  });
  it('the automatic probe shows as probing (endpoint and since) while it runs, then lands in lastProbe', async () => {
    const { LocalLane } = await import('../src/kernel/supervisor/local-session.js');
    const during: unknown[] = [];
    const lane: InstanceType<typeof LocalLane> = new LocalLane({ log: async () => undefined, children: { intend: () => undefined, track: () => undefined, stop: async () => false } as never, fuse: {} as never, home: tmp('h-'), kernelPrincipal: KERNEL, sock: '/tmp/x', sessionPath: null, pathDenies: [], identity: null, probeFetch: async () => { during.push(lane.probing()); throw new Error('connect ECONNREFUSED'); } });
    lane.setConfig({ endpoints: [{ id: 'ollama', base: 'http://127.0.0.1:11434', model: 'm', compat: 'ollama' }] });
    const p = lane.probeAll();
    expect(lane.probing()).toMatchObject({ endpoint: 'ollama', since: expect.any(String) });
    await p;
    expect(during[0]).toMatchObject({ endpoint: 'ollama' });
    expect(lane.probing()).toBeNull();
    expect(lane.lastProbe()).toMatchObject({ endpoint: 'ollama', ok: false });
  });
});
