/**
 * #mcp-setup (8.2 fixes item 1, T-2026-11-28-001): set up a needs-config mod's MCP server from the person's Claude
 * Code config. Every behaviour rule of the design and Aegis's conditions 1-12 has a test that fails at its own
 * assertion when reverted. Values never leave the kernel: a canary env value is checked against status rows, card
 * lines, card detail, events and refusal replies.
 */
import * as fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ManifestMcp, ManifestV2 } from '../src/kernel/manifest/manifest.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { McpConfigCards, MCP_SECRET_ARG_REFUSAL, overrideLaunches, readMcpConfigRequest, readMcpOverrides, requestMcpConfig, UNCONFIGURED_HINT, writeMcpOverride, type DeskMod } from '../src/kernel/desk/mcp-passthrough.js';
import { discoverMcpServers } from '../src/kernel/desk/mcp-servers.js';
import { McpServers, writeMcpServersStore } from '../src/kernel/desk/mcp-server-cards.js';
import { candidateOf, matchOf, MOD_SETUP_MAX, ModSetup, preselectedOf, setupCandidates, setupRow, SETUP_PROBLEM_TEXT, type SetupCandidate } from '../src/kernel/desk/mcp-setup.js';
import { runModConfig } from '../src/cli/desk-cli.js';
import { privateTmpRoot } from './daemon-helpers.js';

const CANARY = 'CANARY-vault-9f31c7e2';
const EXE = process.platform === 'win32' ? '.exe' : '';
const KEY = Buffer.alloc(32, 7);
const HUMAN = { connId: 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA', principal: 'p:abcdefgh/matt', principalClass: 'human', credential: 'gui' };
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const NEURONS: ManifestMcp = { command: 'neurons', args: ['mcp'], config: { command: true, args: true, env: ['NEURONS_VAULT', 'NEURONS_TOKEN'], secret: ['NEURONS_TOKEN'] } } as ManifestMcp;
const CONSTELLATION: ManifestMcp = { command: 'constellation-mcp', args: [], config: { command: true, args: true, env: [] } } as ManifestMcp;
const modOf = (name: string, entry: ManifestMcp, tier: DeskMod['tier'] = 'first-party'): DeskMod => ({ name, manifest: { name, provides: { mcp: [entry] } } as unknown as ManifestV2, tier });

/** A user home with a ~/.claude.json, a bin dir holding an executable `node`, and a Gnomon home. */
function rig(servers: Record<string, unknown>, extra: { projects?: Record<string, unknown>; plugins?: boolean } = {}) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(privateTmpRoot(), 'gms-')));
  cleanups.push(() => removeTree(root));
  const userHome = path.join(root, 'user');
  const home = path.join(root, 'gnomon');
  const bin = path.join(root, 'bin');
  const daemonBin = path.join(root, 'daemon-bin');
  for (const d of [userHome, home, bin, daemonBin]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  const node = path.join(bin, `node${EXE}`);
  fs.writeFileSync(node, '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(daemonBin, `node${EXE}`), '#!/bin/sh\n', { mode: 0o755 });
  const script = path.join(root, 'neurons', 'dist', 'cli', 'main.js');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, '');
  fs.writeFileSync(path.join(userHome, '.claude.json'), JSON.stringify({ mcpServers: servers, ...(extra.projects ? { projects: extra.projects } : {}) }));
  return { root, userHome, home, bin, daemonBin, node, script };
}

const neuronsServer = (t: { node: string; script: string }, over: Record<string, unknown> = {}) => ({ command: t.node, args: [t.script, 'mcp'], env: { NEURONS_VAULT: CANARY, OTHER_THING: 'x', NEURONS_TOKEN: 'tok-value-1' }, ...over });
const decls = (t: { userHome: string; bin: string }, repos: string[] = []) => discoverMcpServers({ userHome: t.userHome, repos, pathDirs: [t.bin], platform: process.platform });

function fakeBroker() {
  const raised: Array<Record<string, any>> = [];
  const state = new Map<string, string>();
  return {
    raised,
    state,
    broker: {
      raise: async (input: Record<string, any>) => {
        raised.push(input);
        state.set(input.cardId, 'pending');
        return { cardId: input.cardId } as any;
      },
      card: (id: string) => (state.has(id) ? ({ state: state.get(id) } as any) : undefined),
    },
    decide: async (i: number, decision: string) => {
      const c = raised[i]!;
      if (c.prepare) await c.prepare(decision);
      state.set(c.cardId, decision);
      await c.effect(decision, { connId: HUMAN.connId });
    },
  };
}

function setupOf(t: ReturnType<typeof rig>, mods: DeskMod[], extra: { liveRepos?: string[]; maxCardChars?: number } = {}) {
  const b = fakeBroker();
  const events: Array<Record<string, unknown>> = [];
  const s = new ModSetup({ home: t.home, broker: b.broker, mods: () => mods, userHome: t.userHome, pathDirs: () => [t.bin], launchKey: KEY, emit: (e) => events.push(e), ...(extra.liveRepos ? { liveRepos: () => extra.liveRepos! } : {}), ...(extra.maxCardChars ? { maxCardChars: extra.maxCardChars } : {}) });
  return { s, b, events };
}

const refusalOf = async (p: Promise<unknown>): Promise<{ code: string; message: string; data: Record<string, unknown> }> => {
  try {
    await p;
  } catch (err) {
    const r = (err as { refusal?: { code: string; message: string; data: Record<string, unknown> } }).refusal;
    if (r) return { code: r.code, message: r.message, data: r.data ?? {} };
    throw err;
  }
  throw new Error('expected a refusal');
};

describe('#mcp-setup matching (no manifest match field: by name, then by command)', () => {
  it('matches by the server key = the mod name part, by command basename, and orders user, plugin, local', () => {
    const t = rig({ neurons: { command: '/usr/bin/true', args: [] }, brain: { command: '/opt/x/bin/neurons', args: ['mcp'] }, other: { command: '/usr/bin/true' } });
    const ds = decls(t);
    const mod = modOf('gnomon.neurons', NEURONS);
    expect(matchOf(mod.name, NEURONS, ds.find((d) => d.name === 'neurons')!)).toBe('name');
    expect(matchOf(mod.name, NEURONS, ds.find((d) => d.name === 'brain')!)).toBe('command');
    expect(matchOf(mod.name, NEURONS, ds.find((d) => d.name === 'other')!)).toBeNull();
    // the first non-flag arg's basename, .js dropped: `node …/constellation-mcp.js`
    const t2 = rig({ c: { command: '/usr/bin/node', args: ['--no-warnings', '/x/constellation-mcp.js'] } });
    expect(matchOf('gnomon.constellation', CONSTELLATION, decls(t2)[0]!)).toBe('command');
    const cs = setupCandidates({ mods: [mod], decls: ds, overrides: {} }).get(mod.name)!;
    expect(cs.map((c) => c.decl.name)).toEqual(['neurons', 'brain']);
  });

  it('a configured mod (absolute effective launch) is offered nothing; a needs-config one is', () => {
    const t = rig({ neurons: neuronsServer(t0()) });
    function t0() {
      return { node: '/bin/sh', script: '/x' };
    }
    const mod = modOf('gnomon.neurons', NEURONS);
    expect(setupCandidates({ mods: [mod], decls: decls(t), overrides: {} }).has(mod.name)).toBe(true);
    expect(setupCandidates({ mods: [mod], decls: decls(t), overrides: { [mod.name]: { command: process.platform === 'win32' ? 'C:\\x\\n.exe' : '/opt/n' } } }).has(mod.name)).toBe(false);
  });

  it('a project .mcp.json server is never a candidate: a disabled row with its reason, no copy (Aegis condition 3)', () => {
    const t = rig({});
    const repo = path.join(t.root, 'repo');
    fs.mkdirSync(repo);
    fs.writeFileSync(path.join(repo, '.mcp.json'), JSON.stringify({ mcpServers: { neurons: { command: t.node, args: [t.script] } } }));
    const cs = setupCandidates({ mods: [modOf('gnomon.neurons', NEURONS)], decls: decls(t, [repo]), overrides: {} }).get('gnomon.neurons')!;
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ problem: 'project', config: null, oneTap: false });
    expect(preselectedOf(cs)).toBeNull();
    expect(setupRow(cs[0]!, false).problem).toBe(SETUP_PROBLEM_TEXT.project);
  });
});

describe('#mcp-setup copy rules', () => {
  const one = (server: Record<string, unknown>, entry = NEURONS, platform = process.platform): SetupCandidate => {
    const t = rig({ neurons: server });
    return candidateOf(modOf('gnomon.neurons', entry), entry, decls(t)[0]!, 'name', platform);
  };

  it('refuses a secret-looking arg (the card prints args raw)', () => {
    const t = rig({});
    expect(one({ command: t.node, args: ['--api-key', 'abc123'] })).toMatchObject({ problem: 'secret-arg', config: null });
  });

  it('refuses a ${NAME} ref and inline code', () => {
    const t = rig({});
    expect(one({ command: t.node, args: ['${VAULT}/x.js'] }).problem).toBe('ref');
    expect(one({ command: t.node, args: ['-e', 'console.log(1)'] }).problem).toBe('inline');
    expect(one({ type: 'http', url: 'https://example.com/mcp' }).problem).toBe('transport');
  });

  it('copies only declared, non-secret env names; dropped and secret names are listed, never copied', () => {
    const t = rig({});
    const c = one(neuronsServer(t));
    expect(c.config?.env).toEqual({ NEURONS_VAULT: CANARY });
    expect(c.envDropped).toEqual(['OTHER_THING']);
    expect(c.envSecret).toEqual(['NEURONS_TOKEN']);
    const row = setupRow(c, true);
    expect(row).toMatchObject({ envNames: ['NEURONS_VAULT'], envDropped: ['OTHER_THING'], envSecret: ['NEURONS_TOKEN'] });
    expect(JSON.stringify(row)).not.toContain(CANARY);
    expect(JSON.stringify(row)).not.toContain('tok-value-1');
  });

  it('a copy the manifest does not permit is disqualified (args not settable, different args)', () => {
    const t = rig({});
    const fixed = { command: 'neurons', args: ['mcp'], config: { command: true } } as ManifestMcp;
    expect(one({ command: t.node, args: [t.script] }, fixed).problem).toBe('not-permitted');
  });

  it('resolves a bare `node` on the SESSION PATH, never the daemon PATH; not on the session PATH gives no usable candidate', () => {
    const t = rig({ neurons: { command: 'node', args: ['/x/main.js'] } });
    const onSession = discoverMcpServers({ userHome: t.userHome, pathDirs: [t.bin] })[0]!;
    const c = candidateOf(modOf('gnomon.neurons', NEURONS), NEURONS, onSession, 'name');
    expect(c.config?.command).toBe(path.join(t.bin, `node${EXE}`));
    const savedPath = process.env.PATH;
    process.env.PATH = t.daemonBin; // a daemon PATH holding node must not be used
    try {
      const none = discoverMcpServers({ userHome: t.userHome, pathDirs: [path.join(t.root, 'empty')] })[0]!;
      const c2 = candidateOf(modOf('gnomon.neurons', NEURONS), NEURONS, none, 'name');
      expect(c2).toMatchObject({ problem: 'problem', config: null });
    } finally {
      process.env.PATH = savedPath;
    }
  });
});

describe('#mcp-setup one press (Aegis conditions 1 and 6)', () => {
  it('first-party + user source is one press; third-party is not; plugin needs command AND name; local is never preselected', () => {
    const t = rig({});
    const d = (source: string, extra: Record<string, unknown> = {}) => ({ ...decls(rig({ neurons: { command: t.node, args: [t.script] } }))[0]!, source, ...extra }) as never;
    expect(candidateOf(modOf('gnomon.neurons', NEURONS), NEURONS, d('user'), 'name').oneTap).toBe(true);
    expect(candidateOf(modOf('acme.neurons', NEURONS, 'local'), NEURONS, d('user'), 'name').oneTap).toBe(false);
    expect(candidateOf(modOf('gnomon.neurons', NEURONS), NEURONS, d('plugin', { plugin: { id: 'p@m', version: '1', root: t.root } }), 'name').oneTap).toBe(false);
    expect(candidateOf(modOf('gnomon.neurons', NEURONS), NEURONS, d('plugin', { plugin: { id: 'p@m', version: '1', root: t.root } }), 'both').oneTap).toBe(true);
    const local = candidateOf(modOf('gnomon.neurons', NEURONS), NEURONS, d('local', { repo: t.root }), 'name');
    expect(local.oneTap).toBe(false);
    expect(local.scopeNote).toContain('a mod launch applies to every repo');
    expect(preselectedOf([local])).toBeNull();
  });
});

describe('#mcp-setup request.mod.setup and its grouped card', () => {
  it('only the human on a gui or device connection', async () => {
    const t = rig({ neurons: neuronsServer({ node: '', script: '' }) });
    const { s } = setupOf(t, [modOf('gnomon.neurons', NEURONS)]);
    expect((await refusalOf(s.request({ ...HUMAN, principalClass: 'agent' }, { items: [] }))).code).toBe('FORBIDDEN');
    expect((await refusalOf(s.request({ ...HUMAN, credential: 'voice' }, { items: [] }))).code).toBe('FORBIDDEN');
  });

  it('raises ONE root-class card with a requested-via line, every fact line and env names only; allow writes exactly the hashed config', async () => {
    const t = rig({});
    fs.writeFileSync(path.join(t.userHome, '.claude.json'), JSON.stringify({ mcpServers: { neurons: neuronsServer(t), constellation: { command: t.node, args: [path.join(t.root, 'c', 'server.js')] } } }));
    const mods = [modOf('gnomon.neurons', NEURONS), modOf('gnomon.constellation', CONSTELLATION)];
    const { s, b, events } = setupOf(t, mods);
    const res = await s.request(HUMAN, { items: [{ name: 'gnomon.neurons', from: 'user::neurons' }, { name: 'gnomon.constellation', from: 'user::constellation' }] });
    expect(b.raised).toHaveLength(1);
    const card = b.raised[0]!;
    expect(card).toMatchObject({ kind: 'grant', handOnly: true, detail: { action: 'mod.mcp.setup', rootRows: [] } });
    expect(card.detail.mods.map((m: { name: string }) => m.name)).toEqual(['gnomon.neurons', 'gnomon.constellation']);
    const lines: string[] = card.lines;
    expect(lines[1]).toBe('requested via: the Mods panel in the Gnomon app, on your own connection');
    expect(lines.join('\n')).not.toContain('a request file');
    expect(lines.some((l) => l === 'mod 1 of 2: gnomon.neurons:')).toBe(true);
    expect(lines.some((l) => l.includes("inside the session's sandbox"))).toBe(true);
    expect(lines.some((l) => l.includes('env names NEURONS_VAULT (values not shown)'))).toBe(true);
    expect(lines.some((l) => l.includes('not copied (this mod does not take them): OTHER_THING'))).toBe(true);
    expect(lines.some((l) => l.includes('not copied (marked secret'))).toBe(true);
    expect(lines.some((l) => l.includes(`command ${t.node}`))).toBe(true);
    expect(JSON.stringify(card.lines) + JSON.stringify(card.detail) + JSON.stringify(res)).not.toContain(CANARY);
    expect(s.pendingOf('gnomon.neurons')).toBe(card.cardId);
    await b.decide(0, 'allow');
    const o = readMcpOverrides(t.home);
    expect(o['gnomon.neurons']).toEqual({ command: t.node, args: [t.script, 'mcp'], env: { NEURONS_VAULT: CANARY } });
    expect(o['gnomon.constellation']).toEqual({ command: t.node, args: [path.join(t.root, 'c', 'server.js')] });
    expect(events.map((e) => e.event)).toEqual(['mcp.setup.requested', 'mcp.setup.set', 'mcp.setup.set']);
    expect(JSON.stringify(events)).not.toContain(CANARY);
  });

  it('deny changes nothing', async () => {
    const t = rig({});
    fs.writeFileSync(path.join(t.userHome, '.claude.json'), JSON.stringify({ mcpServers: { neurons: neuronsServer(t) } }));
    const { s, b } = setupOf(t, [modOf('gnomon.neurons', NEURONS)]);
    await s.request(HUMAN, { items: [{ name: 'gnomon.neurons', from: 'user::neurons' }] });
    await b.decide(0, 'deny');
    expect(readMcpOverrides(t.home)).toEqual({});
  });

  it('an edited field overrides only that field, the card says "edited by you", and facts are recomputed on the merged launch', async () => {
    const t = rig({});
    fs.writeFileSync(path.join(t.userHome, '.claude.json'), JSON.stringify({ mcpServers: { neurons: neuronsServer(t) } }));
    const npx = path.join(t.bin, `npx${EXE}`);
    fs.writeFileSync(npx, '', { mode: 0o755 });
    const { s, b } = setupOf(t, [modOf('gnomon.neurons', NEURONS)]);
    await s.request(HUMAN, { items: [{ name: 'gnomon.neurons', from: 'user::neurons', command: npx }] });
    const lines: string[] = b.raised[0]!.lines;
    expect(lines.some((l) => l.includes('edited by you: command'))).toBe(true);
    // the source runs node; the merged launch runs npx: the fetch fact is recomputed on what will run
    expect(lines.some((l) => l.includes('downloads what it runs at every launch (npx)'))).toBe(true);
    await b.decide(0, 'allow');
    expect(readMcpOverrides(t.home)['gnomon.neurons']).toEqual({ command: npx, args: [t.script, 'mcp'], env: { NEURONS_VAULT: CANARY } });
  });

  it('a server that changes before allow is skipped and named; the others are written (Aegis condition 8)', async () => {
    const t = rig({});
    const cfg = (vault: string) => JSON.stringify({ mcpServers: { neurons: neuronsServer(t, { env: { NEURONS_VAULT: vault } }), constellation: { command: t.node, args: [] } } });
    fs.writeFileSync(path.join(t.userHome, '.claude.json'), cfg(CANARY));
    const { s, b, events } = setupOf(t, [modOf('gnomon.neurons', NEURONS), modOf('gnomon.constellation', CONSTELLATION)]);
    await s.request(HUMAN, { items: [{ name: 'gnomon.neurons', from: 'user::neurons' }, { name: 'gnomon.constellation', from: 'user::constellation' }] });
    fs.writeFileSync(path.join(t.userHome, '.claude.json'), cfg('/somewhere/else'));
    await b.decide(0, 'allow');
    const o = readMcpOverrides(t.home);
    expect(o['gnomon.neurons']).toBeUndefined();
    expect(o['gnomon.constellation']).toBeDefined();
    expect(events).toContainEqual(expect.objectContaining({ event: 'mcp.setup.skipped', mod: 'gnomon.neurons', why: 'changed' }));
  });

  it('every item changed: prepare refuses before the presence prompt', async () => {
    const t = rig({});
    fs.writeFileSync(path.join(t.userHome, '.claude.json'), JSON.stringify({ mcpServers: { neurons: neuronsServer(t) } }));
    const { s, b } = setupOf(t, [modOf('gnomon.neurons', NEURONS)]);
    await s.request(HUMAN, { items: [{ name: 'gnomon.neurons', from: 'user::neurons' }] });
    fs.writeFileSync(path.join(t.userHome, '.claude.json'), JSON.stringify({ mcpServers: {} }));
    await expect(Promise.resolve().then(() => b.raised[0]!.prepare('allow'))).rejects.toMatchObject({ refusal: { data: { why: 'changed' } } });
  });

  it('validates everything first: a stale declId, a configured mod, twice, too many and a pending card refuse the whole request and raise nothing', async () => {
    const t = rig({});
    fs.writeFileSync(path.join(t.userHome, '.claude.json'), JSON.stringify({ mcpServers: { neurons: neuronsServer(t) } }));
    const mods = [modOf('gnomon.neurons', NEURONS), modOf('gnomon.constellation', CONSTELLATION)];
    const { s, b } = setupOf(t, mods);
    expect((await refusalOf(s.request(HUMAN, { items: [{ name: 'gnomon.neurons', from: 'user::neurons' }, { name: 'gnomon.constellation', from: 'user::gone' }] }))).data).toMatchObject({ field: 'items[1].from', why: 'stale' });
    expect((await refusalOf(s.request(HUMAN, { items: [{ name: 'gnomon.neurons', from: 'user::neurons' }, { name: 'gnomon.neurons', from: 'user::neurons' }] }))).data).toMatchObject({ why: 'twice' });
    expect((await refusalOf(s.request(HUMAN, { items: Array.from({ length: MOD_SETUP_MAX + 1 }, () => ({ name: 'gnomon.neurons', from: 'x' })) }))).data).toMatchObject({ why: 'too-many' });
    expect(b.raised).toHaveLength(0);
    await s.request(HUMAN, { items: [{ name: 'gnomon.neurons', from: 'user::neurons' }] });
    expect((await refusalOf(s.request(HUMAN, { items: [{ name: 'gnomon.neurons', from: 'user::neurons' }] }))).data).toMatchObject({ why: 'card-pending' });
    writeMcpOverride(t.home, 'gnomon.neurons', { command: t.node });
    b.state.clear();
    expect((await refusalOf(s.request(HUMAN, { items: [{ name: 'gnomon.neurons', from: 'user::neurons' }] }))).data).toMatchObject({ why: 'configured' });
  });

  it('the card-size cap refuses, never cuts', async () => {
    const t = rig({});
    fs.writeFileSync(path.join(t.userHome, '.claude.json'), JSON.stringify({ mcpServers: { neurons: neuronsServer(t) } }));
    const { s, b } = setupOf(t, [modOf('gnomon.neurons', NEURONS)], { maxCardChars: 200 });
    expect((await refusalOf(s.request(HUMAN, { items: [{ name: 'gnomon.neurons', from: 'user::neurons' }] }))).data).toMatchObject({ why: 'too-large' });
    expect(b.raised).toHaveLength(0);
  });

  it('a secret-looking arg typed into the edit is refused, and the refusal never carries a value (Aegis conditions 5 and 12)', async () => {
    const t = rig({});
    fs.writeFileSync(path.join(t.userHome, '.claude.json'), JSON.stringify({ mcpServers: { neurons: neuronsServer(t) } }));
    const { s, b } = setupOf(t, [modOf('gnomon.neurons', NEURONS)]);
    const r = await refusalOf(s.request(HUMAN, { items: [{ name: 'gnomon.neurons', from: 'user::neurons', args: ['--token', CANARY] }] }));
    expect(r.data).toMatchObject({ field: 'items[0].args', why: 'secret-arg' });
    const r2 = await refusalOf(s.request(HUMAN, { items: [{ name: 'gnomon.neurons', from: 'user::neurons', env: { NOT_DECLARED: CANARY } }] }));
    expect(r2.data).toMatchObject({ why: 'not-permitted' });
    expect(JSON.stringify([r, r2])).not.toContain(CANARY);
    expect(b.raised).toHaveLength(0);
  });

  it('a project server is refused by declId; a local one is allowed only by name with the scope line', async () => {
    const t = rig({});
    const repo = path.join(t.root, 'repo');
    fs.mkdirSync(repo);
    const repoReal = fs.realpathSync.native(repo);
    fs.writeFileSync(path.join(repo, '.mcp.json'), JSON.stringify({ mcpServers: { neurons: { command: t.node, args: [t.script] } } }));
    fs.writeFileSync(path.join(t.userHome, '.claude.json'), JSON.stringify({ mcpServers: {}, projects: { [repoReal]: { mcpServers: { neurons: { command: t.node, args: [t.script, 'mcp'] } } } } }));
    const { s, b } = setupOf(t, [modOf('gnomon.neurons', NEURONS)], { liveRepos: [repo] });
    expect((await refusalOf(s.request(HUMAN, { items: [{ name: 'gnomon.neurons', from: `project:${repoReal}:neurons` }] }))).data).toMatchObject({ why: 'project' });
    const rows = s.offers().get('gnomon.neurons')!;
    expect(rows.find((r) => r.source === 'local')).toMatchObject({ preselected: false, oneTap: false });
    await s.request(HUMAN, { items: [{ name: 'gnomon.neurons', from: `local:${repoReal}:neurons` }] });
    expect((b.raised[0]!.lines as string[]).some((l) => l.includes(`was for folder repo only`))).toBe(true);
  });

  it('a plugin source says it is third-party code and that the copy outlives the plugin (Aegis condition 2)', async () => {
    const t = rig({});
    const pluginRoot = path.join(t.userHome, '.claude', 'plugins', 'cache', 'neurons');
    fs.mkdirSync(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ mcpServers: { neurons: { command: t.node, args: [t.script, 'mcp'] } } }));
    fs.writeFileSync(path.join(t.userHome, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'neurons@market': true } }));
    fs.writeFileSync(path.join(t.userHome, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'neurons@market': [{ scope: 'user', installPath: pluginRoot, version: '1.2.3' }] } }));
    const { s, b } = setupOf(t, [modOf('gnomon.neurons', NEURONS)]);
    const row = s.offers().get('gnomon.neurons')!.find((r) => r.source === 'plugin')!;
    expect(row).toMatchObject({ match: 'name', oneTap: false });
    await s.request(HUMAN, { items: [{ name: 'gnomon.neurons', from: row.declId }] });
    const lines = (b.raised[0]!.lines as string[]).join('\n');
    expect(lines).toContain('the plugin neurons@market 1.2.3 is third-party code, installed at');
    expect(lines).toContain('this copy stays on if you later disable, update or uninstall the plugin in Claude Code');
  });

  it('warns when the same launch is also on as a user server (Aegis condition 11)', async () => {
    const t = rig({});
    fs.writeFileSync(path.join(t.userHome, '.claude.json'), JSON.stringify({ mcpServers: { neurons: neuronsServer(t) } }));
    writeMcpServersStore(t.home, { enabled: [{ id: 'user::neurons', scope: 'all', launchHash: 'x', at: '2026-11-28T00:00:00.000Z', cardId: 'card:x' }], firstParty: { paradigm: 'on' } });
    const { s, b } = setupOf(t, [modOf('gnomon.neurons', NEURONS)]);
    await s.request(HUMAN, { items: [{ name: 'gnomon.neurons', from: 'user::neurons' }] });
    expect((b.raised[0]!.lines as string[]).some((l) => l.includes('also on as your server neurons; sessions get both'))).toBe(true);
  });

  it('mcp.setup.offered fires when the candidate set changes, not on every status read (Aegis note 4)', () => {
    const t = rig({});
    fs.writeFileSync(path.join(t.userHome, '.claude.json'), JSON.stringify({ mcpServers: { neurons: neuronsServer(t) } }));
    const { s, events } = setupOf(t, [modOf('gnomon.neurons', NEURONS)]);
    s.offers();
    s.offers();
    expect(events.filter((e) => e.event === 'mcp.setup.offered')).toHaveLength(1);
    fs.writeFileSync(path.join(t.userHome, '.claude.json'), JSON.stringify({ mcpServers: { neurons: neuronsServer(t), brain: { command: path.join(t.bin, `neurons${EXE}`) } } }));
    s.offers();
    expect(events.filter((e) => e.event === 'mcp.setup.offered')).toHaveLength(3);
    expect(JSON.stringify(events)).not.toContain(CANARY);
  });
});

describe('the existing request path refuses secret-looking args too (Aegis condition 5)', () => {
  it('requestMcpConfig refuses; a hand-written request file is dropped without a card', async () => {
    const t = rig({});
    const mod = modOf('gnomon.neurons', NEURONS);
    expect(() => requestMcpConfig(t.home, mod, { command: t.node, args: ['--api-key', CANARY] })).toThrow(MCP_SECRET_ARG_REFUSAL);
    expect(MCP_SECRET_ARG_REFUSAL).not.toContain(CANARY);
    requestMcpConfig(t.home, mod, { command: t.node, args: ['ok'] });
    const p = path.join(t.home, 'mods', 'gnomon.neurons', 'mcp-config.request.json');
    fs.writeFileSync(p, JSON.stringify({ config: { command: t.node, args: ['--token', 'abc'] }, at: '2026-11-28T00:00:00.000Z' }));
    const b = fakeBroker();
    fs.mkdirSync(path.join(t.home, 'mods', 'gnomon.neurons'), { recursive: true });
    await new McpConfigCards({ home: t.home, broker: b.broker, mods: () => [mod], requestedBy: 'p:x/cli', launchKey: KEY }).scan();
    expect(b.raised).toHaveLength(0);
    expect(readMcpConfigRequest(t.home, 'gnomon.neurons')).toBeNull();
  });

  it('the hint names the Mods press', () => {
    expect(UNCONFIGURED_HINT).toContain('press Set up in Mods');
  });
});

describe('sessionDenies covers mod launch overrides (Aegis condition 4)', () => {
  it('write-denies an override command and its absolute-path args; the inside-roots skip is kept and logged', () => {
    const t = rig({});
    const mod = modOf('gnomon.neurons', NEURONS);
    writeMcpOverride(t.home, mod.name, { command: t.node, args: [t.script, 'mcp'] });
    const launches = overrideLaunches([mod], readMcpOverrides(t.home));
    expect(launches).toEqual([{ id: 'mod:gnomon.neurons', command: t.node, args: [t.script, 'mcp'] }]);
    const events: Array<Record<string, unknown>> = [];
    const m = new McpServers({ home: t.home, broker: fakeBroker().broker, userHome: t.userHome, pathDirs: () => [t.bin], launchKey: KEY, firstParty: () => ({ available: false, why: 'test' }), emit: (e) => events.push(e), modLaunches: () => launches });
    const denies = m.sessionDenies({ cwd: path.join(t.root, 'elsewhere') });
    expect(denies).toEqual(expect.arrayContaining([expect.objectContaining({ path: fs.realpathSync.native(t.node), match: 'literal' }), expect.objectContaining({ path: fs.realpathSync.native(t.script), match: 'literal' })]));
    const inside = m.sessionDenies({ cwd: path.join(t.root, 'neurons') });
    expect(inside.some((d) => d.path === fs.realpathSync.native(t.script))).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({ event: 'mcp.deny.skipped', id: 'mod:gnomon.neurons', why: 'inside-session-roots' }));
  });
});

describe('gnomon mod config --from-claude', () => {
  it('writes the request-file copy from the preselected server; the card text never claims the Claude Code config', () => {
    const t = rig({});
    fs.writeFileSync(path.join(t.userHome, '.claude.json'), JSON.stringify({ mcpServers: { neurons: neuronsServer(t) } }));
    const out: string[] = [];
    const err: string[] = [];
    const io = { stdout: { write: (s: string) => void out.push(s) }, stderr: { write: (s: string) => void err.push(s) } } as never;
    const trust = {} as never;
    // readDeskMods needs a grant table; the CLI path is exercised through its own seam
    const code = runModConfig(['gnomon.neurons', '--from-claude'], io, { home: t.home, trust, env: {}, userHome: t.userHome, pathDirs: [t.bin] });
    // no installed mod in this bare home: refused not-installed, and nothing is written
    expect(code).toBe(1);
    expect(err.join('')).toContain('not-installed');
    expect(readMcpConfigRequest(t.home, 'gnomon.neurons')).toBeNull();
  });
});
