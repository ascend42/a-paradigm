/**
 * #local-runner M1.8 slice 2 (spec §13.1–§13.3, §2.4 "backend binaries come
 * from root-signed config"): the ROOT-SIGNED local lane config, the runner's
 * sha256 pin, per-task endpoint choice, roots inside the Gnomon home, the
 * daemon-start probe, and the steer param at the socket port. Against FAKE
 * in-process OpenAI-compatible servers; never a real model, never claude.
 * Platform-independent: nothing here reaches a spawn (the routes refuse, or
 * the run stops at the launch plan / intend seam).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RefusedError } from '@a-company/gnomon-contracts';
import { fakeOpenAI, type FakeServer } from '../../gnomon-local/test/fake-openai.js';
import { loadLocalConfig, LOCAL_CONFIG_FILE, parseLocalLaneConfig, writeSignedLocalConfig } from '../src/kernel/local/config.js';
import { LocalLane } from '../src/kernel/supervisor/local-session.js';
import { createSessionPort } from '../src/kernel/supervisor/port.js';
import type { SessionSupervisor } from '../src/kernel/supervisor/supervisor.js';
import { BudgetFuse } from '../src/kernel/budget/fuse.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { DEV_TEST_ROOT_ACK, DevTestRootAuthority } from '../src/kernel/identity/root-authority.js';
import { parseLocalLine } from '../src/adapters/local/runner.js';
import { pinOf, prepareRunner, sha256File, type LocalRunnerPin } from '../src/kernel/local/runner-pin.js';
import { buildSessionPolicy, localRunnerDenies } from '../src/kernel/manifest/policy.js';
const pinOfNode = (node: string): Pick<LocalRunnerPin, 'node' | 'nodeSha256'> => ({ node, nodeSha256: sha256File(node) });
import type { SessionLaunchInput } from '../src/kernel/sandbox/session.js';

const RUNNER_SRC = "import './lib.js';\n";
/** A tiny runner tree (entry + a sibling module) and its pin as it is on disk. */
function runnerTree(dir: string): LocalRunnerPin {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'cli.js'), RUNNER_SRC);
  fs.writeFileSync(path.join(dir, 'lib.js'), 'export const ok = 1;\n');
  return pinOf(dir, 'cli.js');
}

const HUMAN = 'p:abcdefgh/founder';
const FAKE_PIN = { node: process.execPath, nodeSha256: '0'.repeat(64), dir: '/x/gnomon-local/dist', treeSha256: '0'.repeat(64), entry: 'cli.js' };
const servers: FakeServer[] = [];
let tmp: string | null = null;
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});
const scratch = (): string => (tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-lcfg-'))));
const fake = async (o: Parameters<typeof fakeOpenAI>[0]): Promise<FakeServer> => {
  const s = await fakeOpenAI(o);
  servers.push(s);
  return s;
};

function lane(home: string, config: ConstructorParameters<typeof LocalLane>[0]['config'], onPlan?: (i: SessionLaunchInput) => void, intend?: () => Promise<unknown>) {
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => void rows.push({ kind, payload });
  const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
  const cards: Array<Record<string, unknown>> = [];
  const sessionCfgs: Array<Record<string, unknown>> = [];
  const broker = { raise: async (i: Record<string, unknown>) => (cards.push(i), { cardId: `card:01HZZZZZZZZZZZZZZZZZZZZZZ${cards.length}` }) };
  const children = { intend: intend ?? (async () => { throw new Error('intend reached (test stop)'); }), track: async () => undefined, stop: async () => false };
  const l = new LocalLane({
    log, children: children as never, fuse, broker: broker as never, home, userHome: path.join(home, '..', 'userhome'), kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(home, 'k.sock'),
    // the test-rig launch seam: never a real sandbox here, and the run stops at intend
    launchPlan: (i) => {
      onPlan?.(i);
      sessionCfgs.push(JSON.parse(fs.readFileSync(i.argv[i.argv.indexOf('--config') + 1]!, 'utf8')) as Record<string, unknown>);
      return { command: i.binaryReal, args: i.argv, sandbox: 'partial', profile: 'test', profileHash: 'sha256:test' };
    },
    ...(config ? { config } : {}),
  });
  return { l, rows, cards, sessionCfgs };
}

describe('root-signed local.signed.json (only a root-verified row is applied; anything else is NO config, logged)', () => {
  const local = { endpoints: [{ id: 'llama', base: 'http://127.0.0.1:8080', model: 'qwen', compat: 'llama.cpp' }], runner: FAKE_PIN, contextTarget: 4096 };

  it('signed ⇒ applied, logged with file + version; the sidecar records the version', () => {
    const home = scratch();
    const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    writeSignedLocalConfig(home, root, local, 3);
    const ev: Array<[string, Record<string, unknown>]> = [];
    const r = loadLocalConfig(home, root, (k, p) => ev.push([k, p]));
    expect(r).toMatchObject({ signed: true, fellBack: false, version: 3, config: { endpoints: [{ id: 'llama' }], contextTarget: 4096 } });
    expect(ev).toEqual([['config.loaded', expect.objectContaining({ file: LOCAL_CONFIG_FILE, signed: true, version: 3, endpoints: ['llama'], runner: { node: process.execPath, dir: '/x/gnomon-local/dist', treeSha256: '0'.repeat(64) } })]]);
    expect(JSON.parse(fs.readFileSync(path.join(home, 'local.seen.json'), 'utf8'))).toEqual({ version: 3 });
  });

  it('another root, a tampered row, unparseable bytes ⇒ no config + config.unsigned', () => {
    const home = scratch();
    const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    writeSignedLocalConfig(home, new DevTestRootAuthority(DEV_TEST_ROOT_ACK), local);
    const ev: string[] = [];
    expect(loadLocalConfig(home, root, (k, p) => ev.push(`${k}:${String(p.why)}`)).config).toBeUndefined();
    writeSignedLocalConfig(home, root, local);
    const doc = JSON.parse(fs.readFileSync(path.join(home, LOCAL_CONFIG_FILE), 'utf8')) as { row: { local: { endpoints: Array<{ base: string }> } } };
    doc.row.local.endpoints[0]!.base = 'http://10.0.0.9:8080';
    fs.writeFileSync(path.join(home, LOCAL_CONFIG_FILE), JSON.stringify(doc));
    expect(loadLocalConfig(home, root, (k, p) => ev.push(`${k}:${String(p.why)}`)).config).toBeUndefined();
    fs.writeFileSync(path.join(home, LOCAL_CONFIG_FILE), '{not json');
    expect(loadLocalConfig(home, root, (k, p) => ev.push(`${k}:${String(p.why)}`)).config).toBeUndefined();
    expect(ev).toEqual(['config.unsigned:signature', 'config.unsigned:signature', 'config.unsigned:unparseable']);
  });

  it('rollback: a signed row older than the chain high-water mark (or the sidecar) is NOT applied', () => {
    const home = scratch();
    const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    writeSignedLocalConfig(home, root, local, 2);
    const ev: Array<Record<string, unknown>> = [];
    expect(loadLocalConfig(home, root, (_k, p) => ev.push(p), { chainHighWater: 5 }).config).toBeUndefined();
    expect(ev[0]).toMatchObject({ file: LOCAL_CONFIG_FILE, signed: true, fallback: 'none', why: 'older', version: 2, highWater: 5 });
    fs.writeFileSync(path.join(home, 'local.seen.json'), '{"version":9}');
    expect(loadLocalConfig(home, root).config).toBeUndefined();
    // a missing file after a signed one is logged, not silent
    fs.rmSync(path.join(home, LOCAL_CONFIG_FILE));
    const ev2: Array<Record<string, unknown>> = [];
    loadLocalConfig(home, root, (_k, p) => ev2.push(p));
    expect(ev2[0]).toMatchObject({ why: 'missing', fallback: 'none' });
  });

  it('structurally invalid ⇒ no config (unknown key, relative runner, bad pin, duplicate id, extra endpoint key)', () => {
    for (const bad of [
      { ...local, apiKey: 'x' },
      { ...local, runner: { command: 'node' } },
      { ...local, runner: { node: process.execPath, dir: '/x/dist', entry: 'cli.js' } },
      { ...local, runner: { ...FAKE_PIN, treeSha256: undefined } },
      { ...local, runner: { ...FAKE_PIN, nodeSha256: 'abc' } },
      { ...local, runner: { ...FAKE_PIN, entry: '../cli.js' } },
      { ...local, runner: { ...FAKE_PIN, dir: 'relative/dist' } },
      { endpoints: [local.endpoints[0], local.endpoints[0]] },
      { endpoints: [{ ...local.endpoints[0], headers: { authorization: 'Bearer x' } }] },
      { endpoints: 'llama' },
    ]) expect(parseLocalLaneConfig(bad), JSON.stringify(bad)).toBeNull();
    expect(parseLocalLaneConfig({ endpoints: [] })).toEqual({ endpoints: [] });
    expect(parseLocalLaneConfig({ endpoints: [], contextTarget: 2048, maxTokens: 1800 })).toBeNull(); // round 3: no room under 0.85 x target
    expect(parseLocalLaneConfig({ endpoints: [], contextTarget: 2048, maxTokens: 512 })).toMatchObject({ contextTarget: 2048, maxTokens: 512 });
  });

  it('G-SUB-06 through the signed config: a signed public endpoint is applied and then refuses every local open BILLING_REFUSED', async () => {
    const home = scratch();
    const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    writeSignedLocalConfig(home, root, { endpoints: [{ id: 'cloud', base: 'https://api.anthropic.com', model: 'x', compat: 'llama.cpp' }] });
    const cfg = loadLocalConfig(home, root).config!;
    expect(cfg.endpoints).toHaveLength(1);
    const { l, rows } = lane(home, cfg);
    const e = (await l.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd: home, model: 'local' }, async () => null).catch((x: unknown) => x)) as RefusedError;
    expect(e.refusal.code).toBe('BILLING_REFUSED');
    expect(rows.map((r) => r.kind)).toEqual(['session.refused']);
    expect(await l.probeAll()).toEqual([]); // the start probe never dials a refused endpoint
  });
});

describe('the runner pin (round 2, Aegis H1): mandatory, the whole tree + node, and only the verified HOME COPY runs', () => {
  it('an unpinned runner makes the config invalid (no local config)', () => {
    expect(parseLocalLaneConfig({ endpoints: [], runner: { node: process.execPath, dir: '/x/dist', entry: 'cli.js' } })).toBeNull();
    expect(parseLocalLaneConfig({ endpoints: [], runner: { command: process.execPath, args: ['/x/cli.js'], sha256: '0'.repeat(64) } })).toBeNull();
    expect(parseLocalLaneConfig({ endpoints: [], runner: FAKE_PIN })).toMatchObject({ runner: FAKE_PIN });
  });

  it('a swapped sibling module, a swapped node, a symlink in the tree each refuse PERMIT_REQUIRED{runner-pin-mismatch}; nothing staged', () => {
    const home = scratch();
    const pin = runnerTree(path.join(home, 'src-rt'));
    const gh = path.join(home, 'gh');
    fs.writeFileSync(path.join(pin.dir, 'lib.js'), 'export const evil = 1;\n'); // a sibling the entry imports
    const why = (p: typeof pin): unknown => {
      try {
        prepareRunner(gh, p);
        return 'ok';
      } catch (err) {
        return (err as RefusedError).refusal;
      }
    };
    expect(why(pin)).toMatchObject({ code: 'PERMIT_REQUIRED', data: { why: 'runner-pin-mismatch', part: 'tree' } });
    expect(fs.readdirSync(path.join(gh, 'runners'))).toEqual([]);
    fs.writeFileSync(path.join(pin.dir, 'lib.js'), 'export const ok = 1;\n');
    fs.symlinkSync(path.join(pin.dir, 'cli.js'), path.join(pin.dir, 'alias.js'));
    expect(why(pin)).toMatchObject({ data: { part: 'tree' } });
    fs.rmSync(path.join(pin.dir, 'alias.js'));
    expect(why({ ...pin, nodeSha256: 'f'.repeat(64) })).toMatchObject({ data: { part: 'node' } });
    expect(why(pin)).toBe('ok');
    // once staged, the COPY is what runs: a later swap in the source does not reach it
    fs.writeFileSync(path.join(pin.dir, 'lib.js'), 'export const evil = 2;\n');
    expect(why(pin)).toBe('ok');
    expect(fs.readFileSync(path.join(gh, 'runners', pin.treeSha256, 'lib.js'), 'utf8')).toBe('export const ok = 1;\n');
  });

  it('the exec path is the home copy: binaryReal is the realpath of node, argv[0] the realpath of the COPIED entry; editing the source after staging changes nothing', async () => {
    const home = scratch();
    const cwd = path.join(home, 'repo');
    fs.mkdirSync(cwd);
    const srv = await fake({ tools: true });
    const pin = runnerTree(path.join(home, 'src-rt'));
    const gh = path.join(home, 'gh');
    const plans: SessionLaunchInput[] = [];
    const { l } = lane(gh, { endpoints: [{ id: 'f', base: srv.base, model: 'm', compat: 'llama.cpp' }], runner: pin }, (i) => plans.push(i));
    await l.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd, model: 'local' }, async () => null).catch(() => undefined);
    const copy = fs.realpathSync.native(path.join(gh, 'runners', pin.treeSha256));
    expect(plans).toHaveLength(1);
    expect(plans[0]!.binaryReal).toBe(fs.realpathSync.native(process.execPath));
    expect(plans[0]!.argv[0]).toBe(path.join(copy, 'cli.js'));
    expect(fs.readFileSync(plans[0]!.argv[0]!, 'utf8')).toBe(RUNNER_SRC);
    // a session rewrites the SOURCE runner: the next open refuses (the copy is re-verified against the pin, the source re-staged only if it matches)
    fs.writeFileSync(path.join(pin.dir, 'cli.js'), 'process.exit(0)\n');
    fs.rmSync(copy, { recursive: true, force: true });
    await expect(l.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd, model: 'local' }, async () => null)).rejects.toMatchObject({ refusal: { code: 'PERMIT_REQUIRED' } });
  });

  it('a mismatched pin refuses before any permit or session row', async () => {
    const home = scratch();
    const cwd = path.join(home, 'repo');
    fs.mkdirSync(cwd);
    const srv = await fake({ tools: true });
    const { l, rows } = lane(path.join(home, 'gh'), { endpoints: [{ id: 'f', base: srv.base, model: 'm', compat: 'llama.cpp' }], runner: { ...runnerTree(path.join(home, 'rt')), treeSha256: '0'.repeat(64) } });
    await expect(l.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd, model: 'local' }, async () => null)).rejects.toMatchObject({ refusal: { code: 'PERMIT_REQUIRED' } });
    expect(rows.some((r) => r.kind.startsWith('permit.') || r.kind === 'session.open')).toBe(false);
  });
});

describe('round 3 (Aegis H1, node half): every session profile denies writes to node, its prefix and the runner source; node is re-hashed right before spawn', () => {
  it('buildSessionPolicy with a local runner denies node (literal), its install prefix and the source dir; a prefix at or above the user home narrows to node\'s dir', () => {
    const home = scratch();
    const prefix = path.join(home, 'nodeinst');
    fs.mkdirSync(path.join(prefix, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(prefix, 'lib'));
    const node = path.join(prefix, 'bin', 'node');
    fs.writeFileSync(node, 'fake node');
    const dir = path.join(home, 'src-rt');
    fs.mkdirSync(dir);
    const base = { home: path.join(home, 'gh'), cwd: home, userClaudeDir: path.join(home, 'uh', '.claude'), userHome: path.join(home, 'uh'), managedSettingsPaths: [], linkedFolders: [], endpointPort: null };
    const pol = buildSessionPolicy({ ...base, localRunner: { node, dir } });
    expect(pol.denyWrite).toEqual(expect.arrayContaining([
      { path: fs.realpathSync.native(node), match: 'literal', class: 'binary' },
      { path: fs.realpathSync.native(prefix), match: 'subpath', class: 'binary' },
      { path: fs.realpathSync.native(dir), match: 'subpath', class: 'binary' },
    ]));
    expect(buildSessionPolicy(base).denyWrite.some((d) => d.path === fs.realpathSync.native(prefix))).toBe(false);
    // node in ~/bin: the prefix would be the user home — narrowed to ~/bin
    const uh = path.join(home, 'uh');
    fs.mkdirSync(path.join(uh, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(uh, 'bin', 'node'), 'x');
    const narrowed = localRunnerDenies({ node: path.join(uh, 'bin', 'node'), dir }, uh).map((d) => d.path);
    expect(narrowed).toContain(fs.realpathSync.native(path.join(uh, 'bin')));
    expect(narrowed).not.toContain(fs.realpathSync.native(uh));
  });
  it('Homebrew: a Cellar node denies the whole Homebrew prefix (the parent of Cellar) as a subpath', () => {
    const brew = scratch();
    const node = path.join(brew, 'Cellar', 'node', '22.0.0', 'bin', 'node');
    fs.mkdirSync(path.dirname(node), { recursive: true });
    fs.writeFileSync(node, 'x');
    const d = localRunnerDenies({ node, dir: path.join(brew, 'src') }, path.join(path.dirname(brew), 'not-under-brew-uh'));
    expect(d).toContainEqual({ path: fs.realpathSync.native(brew), match: 'subpath', class: 'binary' });
    expect(d.some((x) => x.path === fs.realpathSync.native(path.join(brew, 'Cellar', 'node', '22.0.0')))).toBe(false);
  });

  it('the local lane\'s profile (built with the loaded config) carries those denies', async () => {
    const home = scratch();
    const cwd = path.join(home, 'repo');
    fs.mkdirSync(cwd);
    const srv = await fake({ tools: true });
    const pin = runnerTree(path.join(home, 'src-rt'));
    const plans: SessionLaunchInput[] = [];
    const { l } = lane(path.join(home, 'gh'), { endpoints: [{ id: 'f', base: srv.base, model: 'm', compat: 'llama.cpp' }], runner: pin }, (i) => plans.push(i));
    await l.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd, model: 'local' }, async () => null).catch(() => undefined);
    const nodeReal = fs.realpathSync.native(process.execPath);
    const denies = plans[0]!.policy.denyWrite.map((d) => d.path);
    expect(denies).toContain(nodeReal);
    const cellar = nodeReal.split(path.sep).lastIndexOf('Cellar');
    expect(denies).toContain(cellar > 0 ? nodeReal.split(path.sep).slice(0, cellar).join(path.sep) : path.dirname(path.dirname(nodeReal)));
    expect(denies).toContain(fs.realpathSync.native(pin.dir));
  });

  it('a node binary swapped after staging and before spawn makes the open refuse PERMIT_REQUIRED{part:node}', async () => {
    const home = scratch();
    const cwd = path.join(home, 'repo');
    fs.mkdirSync(cwd);
    const fakeNode = path.join(home, 'nodeinst', 'bin', 'node');
    fs.mkdirSync(path.dirname(fakeNode), { recursive: true });
    fs.writeFileSync(fakeNode, 'pinned bytes');
    const srv = await fake({ tools: true });
    const pin = { ...runnerTree(path.join(home, 'src-rt')), ...pinOfNode(fakeNode) };
    const { l, rows } = lane(path.join(home, 'gh'), { endpoints: [{ id: 'f', base: srv.base, model: 'm', compat: 'llama.cpp' }], runner: pin }, () => {
      fs.writeFileSync(fakeNode, 'swapped bytes'); // after prepareRunner verified it
    }, async () => 'intent');
    const e = (await l.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd, model: 'local' }, async () => null).catch((x: unknown) => x)) as RefusedError;
    expect(e.refusal).toMatchObject({ code: 'PERMIT_REQUIRED', data: { why: 'runner-pin-mismatch', part: 'node' } });
    expect(rows.some((r) => r.kind === 'session.refused' && r.payload.code === 'spawn_failed')).toBe(true);
  });
});

describe('per-task endpoint choice: the first endpoint in signed order that is capable for the task floor', () => {
  it('an incapable first endpoint is passed over for a capable second one (no fallback card); both are probed and recorded', async () => {
    const home = scratch();
    const cwd = path.join(home, 'repo');
    fs.mkdirSync(cwd);
    const a = await fake({ tools: false });
    const b = await fake({ tools: true, nCtx: 16384 });
    const { l, rows, cards, sessionCfgs } = lane(path.join(home, 'gh'), { endpoints: [{ id: 'a', base: a.base, model: 'm', compat: 'llama.cpp' }, { id: 'b', base: b.base, model: 'm', compat: 'ollama' }], runner: runnerTree(path.join(home, 'rt')) });
    await l.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd, model: 'local' }, async () => null).catch(() => undefined);
    expect(cards).toEqual([]);
    expect(rows.filter((r) => r.kind === 'model.probe').map((r) => r.payload.endpoint)).toEqual(['a', 'b']);
    expect(rows.find((r) => r.kind === 'session.open')!.payload).toMatchObject({ endpoint: 'b', backend: 'local' });
    expect(rows.find((r) => r.kind === 'permit.grant')!.payload.permit).toMatchObject({ backend: 'local', billing: 'local', model: 'fake-qwen-7b-q4' });
    // the per-session config handed to the child: endpoint b, its compat, the compaction target min(~8k, n_ctx)
    expect(sessionCfgs).toEqual([expect.objectContaining({ endpoint: { base: b.base, model: 'fake-qwen-7b-q4', compat: 'ollama' }, contextTarget: 8192, capabilities: { tools: true, nCtx: 16384 } })]);
    const dir = fs.readdirSync(path.join(home, 'gh', 'sessions'));
    expect(dir).toEqual([]); // intend refused ⇒ the session dir is removed (nothing left behind)
  });

  it('no capable endpoint ⇒ the FIRST endpoint\'s reason on the fallback card', async () => {
    const home = scratch();
    const a = await fake({ tools: false });
    const b = await fake({ tools: true, nCtx: 2048 });
    const { l, cards } = lane(path.join(home, 'gh'), { endpoints: [{ id: 'a', base: a.base, model: 'm', compat: 'llama.cpp' }, { id: 'b', base: b.base, model: 'm', compat: 'llama.cpp' }], runner: FAKE_PIN });
    await expect(l.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd: home, model: 'local' }, async () => null)).rejects.toMatchObject({ refusal: { code: 'MODEL_UNAVAILABLE', data: { why: 'no-tools' } } });
    expect(cards).toHaveLength(1);
  });

  it('probeAll (daemon start) records model.probe + model.capabilities for every configured endpoint and caches them', async () => {
    const home = scratch();
    const a = await fake({ tools: true });
    const { l, rows } = lane(home, { endpoints: [{ id: 'a', base: a.base, model: 'm', compat: 'llama.cpp' }, { id: 'dead', base: 'http://127.0.0.1:9', model: 'm', compat: 'llama.cpp' }] });
    expect(await l.probeAll()).toEqual([{ endpoint: 'a', ok: true }, { endpoint: 'dead', ok: false }]);
    expect(rows.map((r) => `${r.kind}:${String(r.payload.endpoint)}`)).toEqual(['model.probe:a', 'model.capabilities:a', 'model.probe:dead']);
    const n = a.requests.length;
    await l.probeAll();
    expect(a.requests.length).toBe(n); // cached (probeTtlMs)
  });
});

describe('round 3 R2, widened in slice 2: a root INSIDE the Gnomon home is refused too', () => {
  it('cwd or worktree under the Gnomon home ⇒ BAD_REQUEST before any permit', async () => {
    const home = scratch();
    fs.mkdirSync(path.join(home, 'keys'));
    const srv = await fake({ tools: true });
    const { l, rows } = lane(home, { endpoints: [{ id: 'f', base: srv.base, model: 'm', compat: 'llama.cpp' }], runner: FAKE_PIN });
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-lcfg-out-'));
    try {
      for (const over of [{ cwd: path.join(home, 'keys') }, { cwd: outside, worktree: path.join(home, 'keys') }]) {
        await expect(l.open({ principal: HUMAN, principalClass: 'human', attended: true, model: 'local', ...over }, async () => null), JSON.stringify(over)).rejects.toMatchObject({ refusal: { code: 'BAD_REQUEST' } });
      }
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
    expect(rows.some((r) => r.kind.startsWith('permit.'))).toBe(false);
  });
});

describe('round 2 (M3): roots are resolved once; a symlink swapped after the check never moves the policy root', () => {
  it('policy, child config, darwin extras and cwd use the resolved root; a swap before spawn refuses', async () => {
    const home = scratch();
    const a = path.join(home, 'repo-a');
    const b = path.join(home, 'repo-b');
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    const link = path.join(home, 'link');
    fs.symlinkSync(a, link);
    const srv = await fake({ tools: true });
    const plans: SessionLaunchInput[] = [];
    let cfgRoots: unknown = null;
    const { l, rows } = lane(path.join(home, 'gh'), { endpoints: [{ id: 'f', base: srv.base, model: 'm', compat: 'llama.cpp' }], runner: runnerTree(path.join(home, 'rt')) }, (i) => {
      plans.push(i);
      cfgRoots = (JSON.parse(fs.readFileSync(i.argv[i.argv.indexOf('--config') + 1]!, 'utf8')) as { roots: unknown }).roots;
      // the attacker swaps the symlink after the check
      fs.rmSync(link);
      fs.symlinkSync(b, link);
    }, async () => 'intent');
    const e = await l.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd: link, model: 'local' }, async () => null).catch((x: unknown) => x);
    expect((e as RefusedError).refusal).toMatchObject({ code: 'BAD_REQUEST' });
    expect(String((e as Error).message)).toMatch(/moved between the check and the spawn/);
    const ra = fs.realpathSync.native(a);
    expect(cfgRoots).toEqual([ra]);
    expect(JSON.stringify(plans[0]!.policy)).toContain(path.join(ra, '.git'));
    expect(JSON.stringify(plans[0]!.policy)).not.toContain(fs.realpathSync.native(b));
    expect(plans[0]!.extras.roots).toEqual([ra]);
    expect(rows.find((r) => r.kind === 'session.open')!.payload.roots).toEqual([ra]);
    expect(rows.some((r) => r.kind === 'session.refused' && r.payload.code === 'spawn_failed')).toBe(true);
  });
  it('a root that cannot be resolved refuses (fail closed, never path.resolve)', async () => {
    const home = scratch();
    const dangling = path.join(home, 'dangling');
    fs.mkdirSync(path.join(home, 'gone'));
    fs.symlinkSync(path.join(home, 'gone'), dangling);
    const srv = await fake({ tools: true });
    const { l } = lane(path.join(home, 'gh'), { endpoints: [{ id: 'f', base: srv.base, model: 'm', compat: 'llama.cpp' }], runner: FAKE_PIN });
    fs.rmSync(path.join(home, 'gone'), { recursive: true });
    await expect(l.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd: dangling, model: 'local' }, async () => null)).rejects.toMatchObject({ refusal: { code: 'BAD_REQUEST' } });
  });
});

describe('session.send{steer} at the socket port', () => {
  const sup = (calls: unknown[]) => ({ send: async (_p: string, x: unknown) => (calls.push(x), { turn: 't' }) }) as unknown as SessionSupervisor;
  it('steer: true is passed through; a non-boolean steer is BAD_REQUEST; steer false is a plain send', async () => {
    const calls: unknown[] = [];
    const port = createSessionPort(sup(calls));
    const ctx = { principal: HUMAN, principalClass: 'human' };
    await port.send(ctx, { hsid: 'h', content: [{ text: 'be brief' }], steer: true });
    await port.send(ctx, { hsid: 'h', content: [{ text: 'x' }], steer: false });
    await expect(port.send(ctx, { hsid: 'h', content: [{ text: 'x' }], steer: 'yes' })).rejects.toMatchObject({ refusal: { code: 'BAD_REQUEST' } });
    expect(calls).toEqual([{ hsid: 'h', text: 'be brief', steer: true }, { hsid: 'h', text: 'x' }]);
  });
  it('the driver reads the child\'s compaction events (logged, never acted on)', () => {
    const h = `sha256:${'a'.repeat(64)}`;
    expect(parseLocalLine(`{"type":"compaction_end","reason":"threshold","tokensBefore":9000,"tokensAfter":700,"kept":2,"summaryHash":"${h}","summaryBytes":812}`)).toEqual({ kind: 'compaction', type: 'compaction_end', phase: 'end', reason: 'threshold', tokensBefore: 9000, tokensAfter: 700, summaryHash: h, summaryBytes: 812, error: null });
    expect(parseLocalLine('{"type":"compaction_end","summaryHash":"not-a-hash"}')).toMatchObject({ summaryHash: null });
  });
});
