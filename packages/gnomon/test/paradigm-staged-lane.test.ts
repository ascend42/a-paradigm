/**
 * TD-2026-10-27-833: the first-party Paradigm MCP in LOCAL sessions from its staged, hashed copy.
 *   - #mcp-servers: an npm-global install auto-stages and is offered as first-party; a linked checkout is refused
 *     pin-mismatch until the human's request.mcp.paradigm.stage; a tampered copy is pin-mismatch (event + status).
 *   - lane e2e with the REAL single-file bundle (packages/paradigm/dist/mcp-bundle, `npm run build:mcp-bundle`): a
 *     local session lists Paradigm's narrow tools, a read op runs with no card, a mutate op raises one card; the
 *     server runs under its own profile (staged dir + per-session global dir readable, ~/.paradigm read-denied) with
 *     HOME at the per-session dir and the neutral cwd.
 */
// @gnomon-platform: darwin, linux
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeOpenAI, type FakeServer } from '../../gnomon-local/test/fake-openai.js';
import { McpServers, MCP_PARADIGM_STAGE_REQUEST } from '../src/kernel/desk/mcp-server-cards.js';
import { LocalLane } from '../src/kernel/supervisor/local-session.js';
import { pinOf } from '../src/kernel/local/runner-pin.js';
import { stageRoot } from '../src/kernel/local/paradigm-stage.js';
import { appendLedger, EDIT_LEDGER_FILE, LEDGER_MAX_BYTES, localWritesUnder } from '../src/kernel/local/edit-ledger.js';
import { BudgetFuse } from '../src/kernel/budget/fuse.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { DaemonChildren } from '../src/kernel/lifecycle/children.js';
import { processControlFor } from '../src/kernel/lifecycle/process-control.js';
import { PKG_ROOT } from './helpers.js';
import { waitFor } from './session-helpers.js';

const HUMAN = 'p:abcdefgh/founder';
const human = { connId: 'c1', principal: HUMAN, principalClass: 'human', credential: 'gui' };
const CLI = path.join(PKG_ROOT, '..', 'gnomon-local', 'dist', 'cli.js');
const BUNDLE = path.join(PKG_ROOT, '..', 'paradigm', 'dist', 'mcp-bundle');
const KEY = Buffer.alloc(32, 7);

let roots: string[] = [];
let srv: FakeServer | null = null;
afterEach(async () => {
  await srv?.close();
  srv = null;
  for (const r of roots.splice(0)) {
    const walk = (d: string): void => {
      try {
        fs.chmodSync(d, 0o700);
        for (const n of fs.readdirSync(d)) if (fs.lstatSync(path.join(d, n)).isDirectory()) walk(path.join(d, n));
      } catch {
        /* gone */
      }
    };
    walk(r);
    fs.rmSync(r, { recursive: true, force: true });
  }
});

/** A global-looking install of @a-company/paradigm whose dist/mcp-bundle is the real bundle (or a stub). */
function world(o: { real?: boolean } = {}): { root: string; home: string; userHome: string; repo: string; pkg: string } {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-pgl-')));
  roots.push(root);
  const pkg = path.join(root, 'prefix', 'lib', 'node_modules', '@a-company', 'paradigm');
  fs.mkdirSync(path.join(pkg, 'dist', 'mcp-bundle'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@a-company/paradigm', version: '9.9.9', bin: { 'paradigm-mcp': './dist/mcp.js' } }));
  fs.writeFileSync(path.join(pkg, 'dist', 'mcp.js'), '');
  if (o.real) {
    for (const n of fs.readdirSync(BUNDLE)) fs.copyFileSync(path.join(BUNDLE, n), path.join(pkg, 'dist', 'mcp-bundle', n));
  } else {
    fs.writeFileSync(path.join(pkg, 'dist', 'mcp-bundle', 'paradigm-mcp.mjs'), 'export {}\n');
    fs.writeFileSync(path.join(pkg, 'dist', 'mcp-bundle', 'manifest.json'), JSON.stringify({ schema: 'paradigm-mcp-bundle:v1', entry: 'paradigm-mcp.mjs', files: [{ relativePath: 'paradigm-mcp.mjs' }] }));
  }
  const home = path.join(root, 'gnomon-home');
  const userHome = path.join(root, 'user');
  const repo = path.join(root, 'repo');
  for (const d of [home, userHome, repo, path.join(repo, '.paradigm')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(repo, '.paradigm', 'config.yaml'), 'version: "2.0"\nproject: staged\n');
  return { root, home, userHome, repo, pkg };
}

function servers(w: ReturnType<typeof world>, linked: boolean, events: Array<Record<string, unknown>>): McpServers {
  return new McpServers({
    home: w.home,
    broker: { raise: async () => ({ cardId: 'card:x' }) as never, card: () => undefined } as never,
    userHome: w.userHome,
    pathDirs: () => [],
    launchKey: KEY,
    firstParty: () => ({ available: true, node: process.execPath, dir: w.pkg, entry: path.join(w.pkg, 'dist', 'mcp.js'), version: '9.9.9', linked }),
    liveRepos: () => [],
    emit: (e) => events.push(e),
  });
}

describe('TD-2026-10-27-833: #mcp-servers stages and verifies the first-party Paradigm MCP', () => {
  it('npm-global: auto-staged and offered first-party from the staged copy; status names the pin', () => {
    const w = world();
    const events: Array<Record<string, unknown>> = [];
    const m = servers(w, false, events);
    const [fp] = m.composeLocal({ hsid: 'h1', cwd: w.repo });
    expect(fp).toMatchObject({ id: 'first-party:paradigm', trust: 'first-party', args: [expect.stringContaining(stageRoot(w.home)), w.repo] });
    expect(fp!.refused).toBeUndefined();
    expect(fp!.staged?.dir.startsWith(fs.realpathSync.native(stageRoot(w.home)))).toBe(true);
    expect(events.some((e) => e.event === 'mcp.first-party.staged' && e.by === 'auto')).toBe(true);
    const st = (m.status() as { firstParty: Record<string, unknown> }).firstParty;
    expect(st).toMatchObject({ staged: { version: '9.9.9', sourceKind: 'npm-global', source: w.pkg, layout: 'bundle' }, pinMismatch: null });
  });

  it('a tampered staged file is pin-mismatch: not offered, never first-party, logged and in status', () => {
    const w = world();
    const events: Array<Record<string, unknown>> = [];
    const m = servers(w, false, events);
    const [fp] = m.composeLocal({ hsid: 'h1', cwd: w.repo });
    const f = path.join(fp!.staged!.dir, 'paradigm-mcp.mjs');
    fs.chmodSync(f, 0o600);
    fs.appendFileSync(f, '// planted\n');
    fs.chmodSync(f, 0o400);
    const [again] = m.composeLocal({ hsid: 'h2', cwd: w.repo });
    expect(again).toMatchObject({ trust: 'first-party', refused: { fit: 'pin-mismatch' } });
    expect(again!.staged).toBeUndefined();
    expect(again!.command).toBeUndefined();
    expect(events.some((e) => e.event === 'mcp.first-party.pin-mismatch' && e.hsid === 'h2')).toBe(true);
    expect((m.status() as { firstParty: { pinMismatch: string } }).firstParty.pinMismatch).toMatch(/changed/);
  });

  it('a linked checkout never auto-stages; the human request stages it and names source, version and dirty state', async () => {
    const w = world();
    const events: Array<Record<string, unknown>> = [];
    const m = servers(w, true, events);
    expect(m.composeLocal({ hsid: 'h1', cwd: w.repo })[0]).toMatchObject({ refused: { fit: 'pin-mismatch', why: expect.stringMatching(/not staged/) } });
    expect(fs.existsSync(stageRoot(w.home))).toBe(false);
    // only the human on a gui/device connection
    await expect(m.request({ ...human, principalClass: 'agent' }, MCP_PARADIGM_STAGE_REQUEST, {})).rejects.toThrow(/human/);
    const preview = (await m.request(human, MCP_PARADIGM_STAGE_REQUEST, { preview: true })) as Record<string, unknown>;
    expect(preview).toMatchObject({ source: w.pkg, version: '9.9.9', sourceKind: 'linked-checkout', staged: false, dirty: null });
    expect(fs.existsSync(stageRoot(w.home))).toBe(false);
    const r = (await m.request(human, MCP_PARADIGM_STAGE_REQUEST, {})) as Record<string, unknown>;
    expect(r).toMatchObject({ source: w.pkg, version: '9.9.9', sourceKind: 'linked-checkout', staged: true, verified: true, dirty: null, treeSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(m.composeLocal({ hsid: 'h2', cwd: w.repo })[0]).toMatchObject({ trust: 'first-party', staged: expect.any(Object) });
    await expect(m.request(human, MCP_PARADIGM_STAGE_REQUEST, { bogus: 1 })).rejects.toThrow(/unknown field/);
  });
});

describe('Aegis H3: staging a linked checkout a local session could have written', () => {
  it('reports ignored/untracked files and the build vs HEAD time; a local edit under the source since the build refuses unless forced', async () => {
    const w = world();
    const git = (...a: string[]) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: w.pkg });
    git('init', '-q');
    fs.writeFileSync(path.join(w.pkg, '.gitignore'), 'dist/mcp-bundle/\n');
    git('add', 'package.json', '.gitignore', 'dist/mcp.js');
    git('commit', '-qm', 'init');
    const events: Array<Record<string, unknown>> = [];
    const m = servers(w, true, events);
    const preview = (await m.request(human, MCP_PARADIGM_STAGE_REQUEST, { preview: true })) as { dirty: boolean; git: { entries: string[] }; builtAt: string; headCommitAt: string; builtAfterHead: boolean | null };
    // the gitignored bundle shows as ignored (`!!`): a plain dirty check would call this clean
    expect(preview.dirty).toBe(true);
    expect(preview.git.entries.some((e) => e.startsWith('!! ') && e.includes('mcp-bundle'))).toBe(true);
    expect(typeof preview.builtAt).toBe('string');
    expect(typeof preview.headCommitAt).toBe('string');
    // a local session edited a file under the source after the build
    appendLedger(w.home, { kind: 'edit', hsid: 'hsid:v1:x', at: Date.now() + 1000, path: path.join(w.pkg, 'dist', 'mcp-bundle', 'paradigm-mcp.mjs') });
    await expect(m.request(human, MCP_PARADIGM_STAGE_REQUEST, {})).rejects.toMatchObject({ message: expect.stringMatching(/force: true/) });
    expect(fs.existsSync(stageRoot(w.home))).toBe(false);
    const r = (await m.request(human, MCP_PARADIGM_STAGE_REQUEST, { force: true })) as Record<string, unknown>;
    expect(r).toMatchObject({ staged: true, forced: true, localWrites: { edits: [expect.objectContaining({ hsid: 'hsid:v1:x' })] } });
  });

  it('a live local session whose root contains the source counts, even with no edit row', async () => {
    const w = world();
    const m = servers(w, true, []);
    appendLedger(w.home, { kind: 'open', hsid: 'hsid:v1:y', at: 1, roots: [path.dirname(w.pkg)] });
    await expect(m.request(human, MCP_PARADIGM_STAGE_REQUEST, {})).rejects.toThrow(/force/);
    appendLedger(w.home, { kind: 'close', hsid: 'hsid:v1:y', at: 2 });
    expect(await m.request(human, MCP_PARADIGM_STAGE_REQUEST, {})).toMatchObject({ staged: true, forced: false });
  });

  it('a ledger read only from its tail is incomplete inside the window and counts as local writes', async () => {
    const w = world();
    const now = Date.now();
    // unrelated rows newer than the build, enough to push the window's start out of the readable tail
    for (let i = 0; i < 40; i++) appendLedger(w.home, { kind: 'edit', hsid: `hsid:v1:f${i}`, at: now + 1000 + i, path: path.join(w.root, 'elsewhere', `${i}.ts`) });
    const small = localWritesUnder(w.home, w.pkg, now - 1000, { maxBytes: 512 });
    expect(small.incomplete).not.toBeNull();
    expect(small.edits).toEqual([]);
    // a horizon older than the window is complete
    expect(localWritesUnder(w.home, w.pkg, now + 10_000, { maxBytes: 512 }).incomplete).toBeNull();
    expect(localWritesUnder(w.home, w.pkg, now - 1000).incomplete).toBeNull();
    // over LEDGER_MAX_BYTES, the stage request refuses (force overrides)
    const filler = `${JSON.stringify({ kind: 'edit', hsid: 'hsid:v1:pad', at: now + 5000, path: path.join(w.root, 'elsewhere', 'x'.repeat(200)) })}\n`;
    fs.appendFileSync(path.join(w.home, EDIT_LEDGER_FILE), filler.repeat(Math.ceil((LEDGER_MAX_BYTES + 4096) / filler.length)));
    const m = servers(w, true, []);
    await expect(m.request(human, MCP_PARADIGM_STAGE_REQUEST, {})).rejects.toMatchObject({ message: expect.stringMatching(/force/) });
    expect(await m.request(human, MCP_PARADIGM_STAGE_REQUEST, { force: true })).toMatchObject({ staged: true, forced: true, localWrites: { incompleteSince: expect.any(String) } });
  });

  it('informational: local edits under the source in the last 7 days are listed whatever the build time', async () => {
    const w = world();
    const day = 86_400_000;
    appendLedger(w.home, { kind: 'edit', hsid: 'hsid:v1:old', at: Date.now() - 3 * day, path: path.join(w.pkg, 'dist', 'mcp.js') });
    appendLedger(w.home, { kind: 'edit', hsid: 'hsid:v1:ancient', at: Date.now() - 9 * day, path: path.join(w.pkg, 'dist', 'mcp.js') });
    const m = servers(w, true, []);
    // both edits predate the build, so they do not block; the 3-day-old one is still shown
    const r = (await m.request(human, MCP_PARADIGM_STAGE_REQUEST, {})) as { staged: boolean; recentLocalEdits: Array<{ hsid: string }> };
    expect(r.staged).toBe(true);
    expect(r.recentLocalEdits.map((e) => e.hsid)).toEqual(['hsid:v1:old']);
  });
});

describe('Aegis should-fix: a local session whose ledger open row cannot be written is refused', () => {
  it('refuses the open before any spawn', async () => {
    expect(fs.existsSync(CLI), 'run `npm run build:gnomon` (builds gnomon-local)').toBe(true);
    const w = world();
    fs.mkdirSync(path.join(w.home, EDIT_LEDGER_FILE)); // a directory where the ledger file goes: every append fails
    srv = await fakeOpenAI({ tools: true, script: [{ content: 'x' }] });
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => void rows.push({ kind, payload });
    const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
    const children = new DaemonChildren({ append: log, control: processControlFor(process.platform), boot: 'boot-test', graceMs: 500 });
    let spawned = 0;
    const lane = new LocalLane({
      sessionPath: null, pathDenies: [], log, children, fuse, home: w.home, userHome: w.userHome, kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(w.root, 'k.sock'),
      config: { endpoints: [{ id: 'fake', base: srv.base, model: 'fake-qwen-7b-q4', compat: 'llama.cpp', surface: 'full' }], runner: pinOf(path.dirname(CLI), 'cli.js') },
      launchPlan: (i) => (spawned++, { command: i.binaryReal, args: i.argv, sandbox: 'partial', profile: 'test-unsandboxed', profileHash: 'sha256:test' }),
    });
    await expect(lane.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd: w.repo, model: 'local' }, async () => null)).rejects.toThrow(/edit ledger/);
    expect(rows.some((r) => r.kind === 'session.refused')).toBe(true);
    expect(rows.some((r) => r.kind === 'session.sandbox')).toBe(false);
    void spawned;
  }, 30_000);
});

describe('TD-2026-10-27-833: a local session runs the REAL staged Paradigm bundle', () => {
  it('lists narrow Paradigm tools; a read op runs with no card; a mutate op raises one card; own profile, HOME, neutral cwd', async () => {
    expect(fs.existsSync(CLI), 'run `npm run build:gnomon` (builds gnomon-local)').toBe(true);
    expect(fs.existsSync(path.join(BUNDLE, 'manifest.json')), 'run `npm run build:mcp-bundle` in packages/paradigm').toBe(true);
    const w = world({ real: true });
    const events: Array<Record<string, unknown>> = [];
    const m = servers(w, false, events);
    srv = await fakeOpenAI({
      tools: true,
      script: [
        { toolCalls: [{ name: 'paradigm_lore.calibration', arguments: '{}' }] },
        { toolCalls: [{ name: 'paradigm_lore.assess', arguments: '{"notes":"from the local model"}' }] },
        { content: 'Done.' },
      ],
    });
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => void rows.push({ kind, payload });
    const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
    const children = new DaemonChildren({ append: log, control: processControlFor(process.platform), boot: 'boot-test', graceMs: 500 });
    const cards: Array<Record<string, unknown>> = [];
    const plans: Array<{ binaryReal: string; argv: readonly string[]; policy: { allowRead: Array<{ path: string }>; denyRead: Array<{ path: string }>; allowWrite: Array<{ path: string }> } }> = [];
    const lane = new LocalLane({
      sessionPath: null, pathDenies: [], log, children, fuse, home: w.home, userHome: w.userHome, kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(w.root, 'k.sock'),
      broker: { raise: async (i) => (cards.push(i as never), { cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ' } as never), decisionOf: async () => 'allow', expire: async () => true },
      config: { endpoints: [{ id: 'fake', base: srv.base, model: 'fake-qwen-7b-q4', compat: 'llama.cpp', surface: 'full' }], runner: pinOf(path.dirname(CLI), 'cli.js') },
      launchPlan: (i) => (plans.push(i as never), { command: i.binaryReal, args: i.argv, sandbox: 'partial', profile: 'test-unsandboxed', profileHash: 'sha256:test' }),
      localMcp: (ctx) => m.composeLocal(ctx),
    });
    const s = (await lane.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd: w.repo, model: 'local' }, async () => null))!;
    const offered = rows.find((r) => r.kind === 'session.sandbox' && r.payload.hsid === s.hsid)!.payload.brokeredTools as string[];
    // C2' slot rule (offerWithin): Paradigm's first narrow tools in index order while they fit the tools slot
    expect(offered.filter((n) => n.startsWith('paradigm_')).length).toBeGreaterThan(5);
    expect(offered).toEqual(expect.arrayContaining(['paradigm_status', 'paradigm_lore.calibration', 'paradigm_lore.assess']));
    await lane.send(HUMAN, { hsid: s.hsid, text: 'go' });
    expect(await waitFor(() => rows.some((r) => r.kind === 'turn.result'), 30_000)).toBe(true);
    const brokered = rows.filter((r) => r.kind === 'tool.brokered').map((r) => [r.payload.server, r.payload.tool, r.payload.class, r.payload.decision]);
    expect(brokered).toEqual([
      ['paradigm', 'paradigm_lore.calibration', 'read', 'ran'],
      // carded and allowed; Paradigm itself answers the call (an assess with no lore id is its own error)
      ['paradigm', 'paradigm_lore.assess', 'mutate', expect.stringMatching(/^(approved|refused)$/)],
    ]);
    expect(rows.filter((r) => r.kind === 'tool.brokered')[1]!.payload.cardId).toBe('card:01HZZZZZZZZZZZZZZZZZZZZZZZ');
    expect(cards).toHaveLength(1);
    // the card shows the reassembled call: the family tool with the kernel-fixed op
    expect(cards[0]!.tool).toBe('mcp:paradigm/paradigm_lore');
    expect(cards[0]!.toolInput).toMatchObject({ op: 'assess', notes: 'from the local model' });
    // the server's own profile: its staged dir and its per-session global dir; never the user's ~/.paradigm
    const fpPlan = plans.find((p) => p.argv[0]?.startsWith(fs.realpathSync.native(stageRoot(w.home))))!;
    expect(fpPlan.binaryReal).toBe(fs.realpathSync.native(process.execPath));
    expect(fpPlan.argv[1]).toBe(w.repo);
    const stateDir = fpPlan.policy.allowWrite.find((a) => a.path.endsWith('-pg'))!.path;
    expect(fpPlan.policy.allowRead.map((a) => a.path)).toEqual(expect.arrayContaining([path.dirname(fpPlan.argv[0]!), stateDir]));
    expect(fpPlan.policy.denyRead.map((d) => d.path)).toContain(path.join(w.userHome, '.paradigm'));
    // HOME pointed at the per-session dir: the server made its global dir there, not in the user's home
    expect(fs.existsSync(path.join(stateDir, '.paradigm'))).toBe(true);
    expect(fs.existsSync(path.join(w.userHome, '.paradigm'))).toBe(false);
    // the third-party profile (runner) never gets the staged dir
    const runnerPlan = plans.find((p) => p.argv[0]?.endsWith('cli.js'))!;
    expect(runnerPlan.policy.allowRead.some((a) => a.path.startsWith(fs.realpathSync.native(stageRoot(w.home))))).toBe(false);
    expect(lane.mcpReport(s.hsid)!.firstParty).toMatchObject({ staged: true, version: '9.9.9', sourceKind: 'npm-global', source: w.pkg });
    await lane.stop(HUMAN, { hsid: s.hsid });
    expect(await waitFor(() => lane.stateOf(s.hsid) === 'exited', 5_000)).toBe(true);
    expect(await waitFor(() => !fs.existsSync(stateDir), 5_000)).toBe(true);
  }, 60_000);
});

describe('TD-2026-10-27-833: the mcpStateDir carve-back is strict', () => {
  it('withheld unless it is exactly <home>/sessions/<x>-pg', async () => {
    const { buildSessionPolicy } = await import('../src/kernel/manifest/policy.js');
    const w = world();
    const base = { home: w.home, cwd: w.repo, userClaudeDir: path.join(w.userHome, '.claude'), managedSettingsPaths: [], linkedFolders: [], endpointPort: null, userHome: w.userHome };
    const good = path.join(w.home, 'sessions', 'abc123-pg');
    fs.mkdirSync(good, { recursive: true });
    const p = buildSessionPolicy({ ...base, mcpStateDir: good });
    expect(p.mcpStateRefused).toBeUndefined();
    expect(p.allowWrite.map((a) => a.path)).toContain(fs.realpathSync.native(good));
    for (const bad of [path.join(w.home, 'sessions', 'abc123'), path.join(w.home, 'keys', 'x-pg'), path.join(w.repo, 'x-pg')]) {
      const q = buildSessionPolicy({ ...base, mcpStateDir: bad });
      expect(q.mcpStateRefused, bad).toBeDefined();
      expect(q.allowWrite.some((a) => a.path.endsWith(path.basename(bad)))).toBe(false);
    }
  });
});

describe('Aegis lows: the readable mcp/ path is exact; Windows refuses the staged server', () => {
  it('homeReadable under mcp/ must be mcp/first-party/paradigm/<version>-<sha12>', async () => {
    const { buildSessionPolicy } = await import('../src/kernel/manifest/policy.js');
    const w = world();
    const base = { home: w.home, cwd: w.repo, userClaudeDir: path.join(w.userHome, '.claude'), managedSettingsPaths: [], linkedFolders: [], endpointPort: null };
    expect(() => buildSessionPolicy({ ...base, homeReadable: [{ path: path.join(w.home, 'mcp', 'first-party', 'paradigm', '9.9.9-0123456789ab'), match: 'subpath' }] })).not.toThrow();
    for (const bad of [path.join(w.home, 'mcp', 'other'), path.join(w.home, 'mcp', 'first-party', 'paradigm'), path.join(w.home, 'mcp', 'first-party', 'paradigm', 'pin.json'), path.join(w.home, 'mcp', 'first-party', 'evil', '9.9.9-0123456789ab')]) {
      expect(() => buildSessionPolicy({ ...base, homeReadable: [{ path: bad, match: 'subpath' }] }), bad).toThrow(TypeError);
    }
  });

  it('composeLocal refuses the first-party server on win32', () => {
    const w = world();
    const m = new McpServers({ home: w.home, broker: { raise: async () => ({ cardId: 'card:x' }) as never, card: () => undefined } as never, userHome: w.userHome, pathDirs: () => [], launchKey: KEY, platform: 'win32', firstParty: () => ({ available: true, node: process.execPath, dir: w.pkg, entry: path.join(w.pkg, 'dist', 'mcp.js'), version: '9.9.9', linked: false }), liveRepos: () => [] });
    expect(m.composeLocal({ hsid: 'h1', cwd: w.repo })[0]).toMatchObject({ refused: { fit: 'pin-mismatch', why: expect.stringMatching(/Windows/) } });
    expect(fs.existsSync(stageRoot(w.home))).toBe(false);
  });
});

describe('Aegis M3: the staged Paradigm env hardens git', () => {
  it('carries the anchor git config plus no lazy fetch, no system/global config or attributes, no prompt', async () => {
    const { stagedParadigmEnv } = await import('../src/kernel/supervisor/local-session.js');
    const { ANCHOR_GIT_CONFIG } = await import('../src/kernel/supervisor/shell-readonly.js');
    for (const [platform, nul] of [['darwin', '/dev/null'], ['win32', 'NUL']] as const) {
      const env = stagedParadigmEnv('/h/s-pg', platform);
      expect(env).toMatchObject({ HOME: '/h/s-pg', PARADIGM_GNOMON_STAGED: '1', GIT_NO_LAZY_FETCH: '1', GIT_ATTR_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: nul, GIT_CONFIG_COUNT: String(ANCHOR_GIT_CONFIG.length) });
      const pairs = Array.from({ length: ANCHOR_GIT_CONFIG.length }, (_, i) => [env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]]);
      expect(pairs).toEqual(ANCHOR_GIT_CONFIG.map(([k, v]) => [k, k === 'core.hooksPath' ? nul : v]));
      if (platform === 'win32') expect(env.USERPROFILE).toBe('/h/s-pg');
    }
  });
});
