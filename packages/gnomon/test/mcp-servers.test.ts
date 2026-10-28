// @gnomon-platform: darwin, linux
/**
 * #mcp-servers (T-2026-10-23-003): the human's own MCP servers in Gnomon sessions. Discovery (user, local, project,
 * plugin), what a row may say (names, never values), the Aegis list (secrets, network per server, shell wrappers and
 * remote URLs, untrusted repo .mcp.json, plugin paths, the sandbox, --strict-mcp-config), the first-party Paradigm
 * MCP on by default, the enable card (grant, root class, never standing) and the composed session set.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  allowRuleWords,
  autoAllowRules,
  checkRemoteUrl,
  inlineOf,
  readRepoMcpJson,
  composeSessionMcp,
  declHash,
  declOf,
  discoverMcpServers,
  expandRefs,
  fetchesOf,
  FIRST_PARTY_PARADIGM,
  HIDDEN_ARG,
  mcpServerRow,
  resolveFirstPartyParadigm,
  shellOf,
  shownArgs,
  type McpServerDecl,
} from '../src/kernel/desk/mcp-servers.js';
import { enabledState, MCP_DISABLE_REQUEST, MCP_ENABLE_MAX, MCP_ENABLE_REQUEST, MCP_SKIPS_KEPT, mcpServersPath, McpServers, readMcpServersStore, writeMcpServersStore } from '../src/kernel/desk/mcp-server-cards.js';
import { NEVER_STANDING_KINDS, standingTupleOf } from '../src/kernel/broker/standing-grant.js';
import { buildClaudeArgv } from '../src/adapters/claude-code/adapter.js';
import { fieldLines } from '../src/kernel/supervisor/permission.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function tmp(prefix: string): string {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(d);
  return d;
}
const KEY = Buffer.alloc(32, 9);
const SECRET = 's3cret-VALUE-never-shown';
const write = (p: string, v: unknown): void => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v));
};

/** A fake user home with a bin dir on the "session PATH", user/local/plugin servers, and a repo with .mcp.json. */
function world() {
  const userHome = tmp('mcp-user-');
  const repo = tmp('mcp-repo-');
  const bin = path.join(userHome, 'bin');
  for (const b of ['node', 'npx', 'bash']) {
    write(path.join(bin, b), '#!/bin/sh\n');
    fs.chmodSync(path.join(bin, b), 0o755);
  }
  const pluginRoot = path.join(userHome, '.claude', 'plugins', 'cache', 'mk', 'lens', '1.0.0');
  write(path.join(pluginRoot, '.mcp.json'), { mcpServers: { lens: { command: '${CLAUDE_PLUGIN_ROOT}/server.js', args: ['--x'] } } });
  write(path.join(pluginRoot, 'server.js'), '');
  const pRoot = path.join(userHome, '.claude', 'plugins', 'cache', 'a-paradigm', 'paradigm', '7.15.2');
  write(path.join(pRoot, '.mcp.json'), { mcpServers: { paradigm: { type: 'stdio', command: 'npx', args: ['--package=@a-company/paradigm', '-y', 'paradigm-mcp', '${CLAUDE_PROJECT_DIR}'] } } });
  write(path.join(userHome, '.claude', 'settings.json'), { enabledPlugins: { 'lens@mk': true, 'paradigm@a-paradigm': true, 'off@mk': false } });
  write(path.join(userHome, '.claude', 'plugins', 'installed_plugins.json'), {
    version: 2,
    plugins: { 'lens@mk': [{ scope: 'user', installPath: pluginRoot, version: '1.0.0' }], 'paradigm@a-paradigm': [{ scope: 'user', installPath: pRoot, version: '7.15.2' }] },
  });
  write(path.join(userHome, '.claude.json'), {
    mcpServers: {
      neurons: { type: 'stdio', command: 'node', args: ['/x/main.js', 'mcp', `--api-key=${SECRET}`], env: { NEURONS_VAULT: '/vault', NEURONS_TOKEN: SECRET } },
      linear: { type: 'http', url: 'https://mcp.linear.app/mcp?token=abc', headers: { Authorization: `Bearer ${SECRET}` } },
      keyed: { command: 'node', args: ['/k.js'], env: { KEYED_TOKEN: '${KEYED_TOKEN}' } },
    },
    projects: { [repo]: { mcpServers: { localone: { command: 'node', args: ['/l.js'] } } } },
  });
  write(path.join(repo, '.mcp.json'), { mcpServers: { repotool: { command: 'npx', args: ['-y', 'repo-tool'] } } });
  return { userHome, repo, bin, pluginRoot, pathDirs: [bin] };
}
const byName = (ds: McpServerDecl[], n: string): McpServerDecl => ds.find((d) => d.name === n)!;

describe('G-MCP-01 #mcp-servers discovery', () => {
  it('finds user, local, project and enabled plugin servers; plugin servers are named plugin_<plugin>_<server>', () => {
    const w = world();
    const ds = discoverMcpServers({ userHome: w.userHome, repos: [w.repo], pathDirs: w.pathDirs, platform: 'darwin' });
    expect(ds.map((d) => `${d.source}:${d.sessionName}`).sort()).toEqual(['local:localone', 'plugin:plugin_lens_lens', 'plugin:plugin_paradigm_paradigm', 'project:repotool', 'user:keyed', 'user:linear', 'user:neurons'].sort());
    expect(byName(ds, 'neurons').resolved).toBe(path.join(w.bin, 'node')); // a bare command resolves on the SESSION PATH
    expect(byName(ds, 'lens').resolved).toBe(path.join(w.pluginRoot, 'server.js')); // ${CLAUDE_PLUGIN_ROOT}
    // without the repo, no local or project server
    expect(discoverMcpServers({ userHome: w.userHome, pathDirs: w.pathDirs }).some((d) => d.source === 'project' || d.source === 'local')).toBe(false);
  });

  it('Aegis plugin paths: an install outside ~/.claude/plugins, or an MCP file outside the plugin, is a problem, never launched', () => {
    const w = world();
    const outside = tmp('mcp-outside-');
    write(path.join(outside, '.mcp.json'), { mcpServers: { evil: { command: '/bin/echo' } } });
    const esc = path.join(w.userHome, '.claude', 'plugins', 'cache', 'mk', 'esc', '1');
    write(path.join(esc, '.claude-plugin', 'plugin.json'), { name: 'esc', mcpServers: '../../../../../../escape.json' });
    write(path.join(w.userHome, '.claude', 'settings.json'), { enabledPlugins: { 'out@mk': true, 'esc@mk': true } });
    write(path.join(w.userHome, '.claude', 'plugins', 'installed_plugins.json'), { plugins: { 'out@mk': [{ scope: 'user', installPath: outside }], 'esc@mk': [{ scope: 'user', installPath: esc }] } });
    const ds = discoverMcpServers({ userHome: w.userHome, pathDirs: w.pathDirs }).filter((d) => d.source === 'plugin');
    expect(ds).toHaveLength(2);
    for (const d of ds) expect(d.problems.map((p) => p.code)).toContain('plugin-path');
    expect(ds.some((d) => d.name === 'evil')).toBe(false);
  });

  it("the Paradigm plugin's own server is covered by the first-party one (problem first-party)", () => {
    const w = world();
    const d = discoverMcpServers({ userHome: w.userHome, pathDirs: w.pathDirs }).find((x) => x.sessionName === 'plugin_paradigm_paradigm')!;
    expect(d.problems.map((p) => p.code)).toContain('first-party');
  });
});

describe('G-MCP-02 #mcp-servers rows: names, never values (Aegis: secret handling)', () => {
  it('a row carries env and header NAMES, hides secret-looking args, strips URL query; no value appears anywhere', () => {
    const w = world();
    const ds = discoverMcpServers({ userHome: w.userHome, repos: [w.repo], pathDirs: w.pathDirs });
    const rows = ds.map(mcpServerRow);
    const text = JSON.stringify(rows);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('token=abc');
    const n = rows.find((r) => r.name === 'neurons')!;
    expect(n.envNames).toEqual(['NEURONS_TOKEN', 'NEURONS_VAULT']);
    expect(n.args).toEqual(['/x/main.js', 'mcp', `--api-key=${HIDDEN_ARG}`]);
    const l = rows.find((r) => r.name === 'linear')!;
    expect(l).toMatchObject({ transport: 'http', url: 'https://mcp.linear.app/mcp', host: 'mcp.linear.app', headerNames: ['Authorization'] });
    expect(rows.find((r) => r.name === 'keyed')!.needs).toEqual(['KEYED_TOKEN']);
    expect(shownArgs(['--token', 'abc', '--name', 'x', 'ghp_abcdefghijklmnop'])).toEqual(['--token', HIDDEN_ARG, '--name', 'x', HIDDEN_ARG]);
  });

  it('the launch hash is an HMAC over the declared values: a changed env value changes it, a guess cannot be confirmed without the key', () => {
    const c = { source: 'user' as const, owner: '', pathDirs: ['/usr/bin'] };
    const a = declOf('s', { command: '/bin/x', env: { T: 'one' } }, c);
    const b = declOf('s', { command: '/bin/x', env: { T: 'two' } }, c);
    expect(declHash(a, KEY)).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
    expect(declHash(a, KEY)).not.toBe(declHash(b, KEY));
    expect(declHash(a, KEY)).not.toBe(declHash(a, Buffer.alloc(32, 1)));
  });
});

describe('G-MCP-03 #mcp-servers problems (Aegis: law 7, env names, shell wrappers, remote URLs)', () => {
  const c = { source: 'user' as const, owner: '', pathDirs: ['/usr/bin', '/bin'], platform: 'darwin' };
  const codes = (name: string, raw: unknown) => declOf(name, raw, c).problems.map((p) => p.code);
  it('law-7 and hazard env names are refused (the session would otherwise refuse, or run injected code)', () => {
    expect(codes('a', { command: '/bin/x', env: { ANTHROPIC_API_KEY: 'k' } })).toContain('law-7');
    expect(codes('a', { command: '/bin/x', env: { OPENAI_BASE_URL: 'u' } })).toContain('law-7');
    expect(codes('a', { command: '/bin/x', env: { NODE_OPTIONS: '--require x' } })).toContain('law-7'); // scrubbed
    expect(codes('a', { command: '/bin/x', env: { DYLD_INSERT_LIBRARIES: 'x' } })).toContain('env-name');
    expect(codes('a', { command: '/bin/x', env: { PATH: '/x' } })).toContain('env-name');
    expect(codes('a', { command: '/bin/x', args: ['${GNOMON_KEY}'] })).toContain('law-7'); // a scrubbed name
    expect(codes('a', { command: '/bin/x', args: ['${DYLD_LIBRARY_PATH}'] })).toContain('env-name');
    // Aegis M2: a REFERENCE to a law-7 name is refused like setting it
    expect(codes('a', { command: '/bin/x', env: { FOO: '${ANTHROPIC_API_KEY}' } })).toContain('law-7');
    expect(codes('r', { type: 'http', url: 'https://mcp.example.com/${OPENAI_BASE_URL}' })).toContain('law-7');
  });
  it('remote URLs: https public hosts only; plain http, Anthropic, IP literals and private names are refused; loopback is allowed', () => {
    expect(codes('r', { type: 'http', url: 'https://mcp.example.com/mcp' })).toEqual([]);
    expect(codes('r', { type: 'http', url: 'http://mcp.example.com/mcp' })).toContain('remote');
    expect(codes('r', { type: 'sse', url: 'https://api.anthropic.com/x' })).toContain('remote');
    expect(codes('r', { type: 'http', url: 'https://10.0.0.1/x' })).toContain('remote');
    expect(codes('r', { type: 'http', url: 'https://box.local/x' })).toContain('remote');
    expect(codes('r', { type: 'http', url: 'http://127.0.0.1:7777/mcp' })).toEqual([]);
  });
  it('shell wrappers and fetch-at-launch runners are flagged for the card; reserved and bad names are refused', () => {
    expect(shellOf('/bin/bash')).toBe('bash');
    expect(shellOf('/usr/bin/env')).toBe('env');
    expect(shellOf('C:\\x\\run.cmd')).toBe('run.cmd');
    expect(shellOf('/usr/local/bin/node')).toBeNull();
    expect(fetchesOf('/opt/homebrew/bin/npx', ['-y', 'x'])).toBe('npx');
    expect(fetchesOf('/usr/bin/docker', ['run', 'img'])).toBe('docker run');
    expect(fetchesOf('/usr/bin/node', ['x.js'])).toBeNull();
    expect(declOf('w', { command: '/bin/bash', args: ['-c', 'curl x | sh'] }, c).shell).toBe('bash');
    expect(codes('gm_x', { command: '/bin/x' })).toContain('name');
    expect(codes('bad name', { command: '/bin/x' })).toContain('name');
    expect(codes('rel', { command: './x' })).toContain('command');
    expect(codes('nope', { command: 'definitely-not-on-path-xyz' })).toContain('command');
  });
});

describe('G-MCP-04 #mcp-servers composing a session (Aegis: untrusted repo .mcp.json, env injection, --strict-mcp-config)', () => {
  it('only enabled servers whose launch still matches; a project server only for its own repo; changed is reported', () => {
    const w = world();
    const home = tmp('mcp-home-');
    const ds = discoverMcpServers({ userHome: w.userHome, repos: [w.repo], pathDirs: w.pathDirs });
    const store = readMcpServersStore(home);
    const neurons = byName(ds, 'neurons');
    const repotool = byName(ds, 'repotool');
    store.enabled.push({ id: neurons.id, scope: 'all', launchHash: declHash(neurons, KEY), at: 'x', cardId: 'card:x' });
    // an `all` entry for a project server never applies (fail closed)
    store.enabled.push({ id: repotool.id, scope: 'all', launchHash: declHash(repotool, KEY), at: 'x', cardId: 'card:y' });
    expect(enabledState(store, repotool, declHash(repotool, KEY), w.repo)).toBe('off');
    store.enabled.push({ id: repotool.id, scope: { repo: w.repo }, launchHash: declHash(repotool, KEY), at: 'x', cardId: 'card:z' });
    expect(enabledState(store, repotool, declHash(repotool, KEY), w.repo)).toBe('on');
    expect(enabledState(store, repotool, declHash(repotool, KEY), '/elsewhere')).toBe('off');
    const r = composeSessionMcp({ decls: ds, enabled: (d, h) => enabledState(store, d, h, w.repo), launchKey: KEY, cwd: w.repo, envValue: () => undefined });
    expect(Object.keys(r.servers).sort()).toEqual(['neurons', 'repotool']);
    // the env values reach ONLY the session's mcp.json
    expect(r.servers.neurons).toMatchObject({ type: 'stdio', command: path.join(w.bin, 'node'), env: { NEURONS_TOKEN: SECRET } });
    // the declaration changed after the enable: not launched, reported changed
    store.enabled[0]!.launchHash = 'hmac-sha256:old';
    const r2 = composeSessionMcp({ decls: ds, enabled: (d, h) => enabledState(store, d, h, w.repo), launchKey: KEY, cwd: w.repo, envValue: () => undefined });
    expect(r2.servers.neurons).toBeUndefined();
    expect(r2.skipped).toContainEqual({ id: neurons.id, server: 'neurons', why: 'changed' });
  });

  it('${NAME} takes the value from the env source; a missing one skips the server and names it (never a value)', () => {
    const w = world();
    const ds = discoverMcpServers({ userHome: w.userHome, pathDirs: w.pathDirs });
    const keyed = byName(ds, 'keyed');
    const on = (d: McpServerDecl) => (d.id === keyed.id ? 'on' : 'off') as 'on' | 'off';
    const miss = composeSessionMcp({ decls: ds, enabled: on, launchKey: KEY, cwd: w.repo, envValue: () => undefined });
    expect(miss.servers.keyed).toBeUndefined();
    expect(miss.skipped).toEqual([{ id: keyed.id, server: 'keyed', why: 'env-missing', names: ['KEYED_TOKEN'] }]);
    const got = composeSessionMcp({ decls: ds, enabled: on, launchKey: KEY, cwd: w.repo, envValue: (n) => (n === 'KEYED_TOKEN' ? SECRET : undefined) });
    expect(got.servers.keyed).toMatchObject({ env: { KEYED_TOKEN: SECRET } });
    const m = new Set<string>();
    expect(expandRefs('${A:-dflt}/${CLAUDE_PROJECT_DIR}', (n) => (n === 'CLAUDE_PROJECT_DIR' ? '/r' : undefined), m)).toBe('dflt//r');
    expect(m.size).toBe(0);
  });

  it('the first-party Paradigm MCP comes first, named paradigm, running `<node> <entry> <cwd>`', () => {
    const r = composeSessionMcp({ decls: [], enabled: () => 'off', launchKey: KEY, cwd: '/repo', envValue: () => undefined, firstParty: { available: true, node: '/n/node', dir: '/p', entry: '/p/dist/mcp.js', version: '8.0.0' } });
    expect(r.servers).toEqual({ paradigm: { type: 'stdio', command: '/n/node', args: ['/p/dist/mcp.js', '/repo'] } });
    expect(r.added[0]).toMatchObject({ id: FIRST_PARTY_PARADIGM, source: 'first-party' });
  });

  it('--strict-mcp-config stays in every session argv (nothing but the composed mcp.json loads)', () => {
    const argv = buildClaudeArgv({ uuid: '00000000-0000-4000-8000-000000000000', policyPath: '/s/policy.json', mcpConfigPath: '/s/mcp.json', settingSources: ['user'] });
    expect(argv).toContain('--strict-mcp-config');
    expect(argv[argv.indexOf('--mcp-config') + 1]).toBe('/s/mcp.json');
  });
});

describe('G-MCP-04 #mcp-servers first party resolution', () => {
  it('finds @a-company/paradigm by its package.json bin, inside the package only', () => {
    const root = tmp('mcp-np-');
    const pkg = path.join(root, '@a-company', 'paradigm');
    write(path.join(pkg, 'package.json'), { name: '@a-company/paradigm', version: '8.0.0', bin: { 'paradigm-mcp': './dist/mcp.js' } });
    write(path.join(pkg, 'dist', 'mcp.js'), '');
    const r = resolveFirstPartyParadigm({ execPath: process.execPath, userHome: root, candidates: [pkg] });
    expect(r).toMatchObject({ available: true, dir: pkg, entry: path.join(pkg, 'dist', 'mcp.js'), version: '8.0.0' });
    write(path.join(pkg, 'package.json'), { name: '@a-company/paradigm', bin: { 'paradigm-mcp': '../../../escape.js' } });
    expect(resolveFirstPartyParadigm({ execPath: process.execPath, userHome: root, candidates: [pkg] }).available).toBe(false);
    expect(resolveFirstPartyParadigm({ execPath: process.execPath, userHome: root, candidates: [] })).toMatchObject({ available: false });
  });
});

describe('G-MCP-05 #mcp-servers the enable card and requests', () => {
  const human = { connId: 'c1', principal: 'p:abcdefgh/founder', principalClass: 'human', credential: 'gui' };
  function setup(platform = 'darwin') {
    const w = world();
    const home = tmp('mcp-home-');
    const raised: Array<Record<string, unknown> & { lines: string[]; effect: (d: string) => Promise<void>; prepare: (d: string) => unknown; detail: Record<string, unknown> }> = [];
    const broker = { raise: async (i: never) => (raised.push(i), { cardId: (i as { cardId: string }).cardId }) as never, card: (id: string) => ({ state: raised.some((r) => r.cardId === id) ? 'pending' : 'gone' }) as never };
    const events: Array<Record<string, unknown>> = [];
    const m = new McpServers({ home, broker: broker as never, userHome: w.userHome, pathDirs: () => w.pathDirs, launchKey: KEY, firstParty: () => ({ available: true, node: '/n/node', dir: '/p', entry: '/p/mcp.js', version: '8.0.0' }), liveRepos: () => [{ cwd: w.repo, hsid: 'h1' }], platform, emit: (e) => events.push(e) });
    return { w, home, raised, m, events };
  }
  const idOf = (m: McpServers, name: string, repo = false): string => {
    const st = m.status() as { servers: Array<{ id: string; name: string }>; repos: Array<{ servers: Array<{ id: string; name: string }> }> };
    return (repo ? st.repos[0]!.servers : st.servers).find((s) => s.name === name)!.id;
  };

  it('enable raises ONE grant card (action mcp.enable, hand-only, never standing); lines show names, not values; allow writes the store', async () => {
    const { m, raised, home } = setup();
    const id = idOf(m, 'neurons');
    const r = (await m.request(human, MCP_ENABLE_REQUEST, { id, scope: 'all' })) as { pending: boolean; cardId: string };
    expect(r.pending).toBe(true);
    expect(await m.request(human, MCP_ENABLE_REQUEST, { id, scope: 'all' })).toMatchObject({ pending: true, cardId: r.cardId }); // one at a time
    expect(raised).toHaveLength(1);
    const c = raised[0]!;
    expect(c).toMatchObject({ kind: 'grant', handOnly: true, decisions: ['allow', 'deny'] });
    expect(c.detail).toMatchObject({ action: 'mcp.enable', scope: 'all', envNames: ['NEURONS_TOKEN', 'NEURONS_VAULT'], rootRows: [] });
    const text = c.lines.join('\n');
    expect(text).not.toContain(SECRET);
    expect(text).toContain('env names NEURONS_TOKEN, NEURONS_VAULT (values not shown)');
    expect(text).toContain('Gnomon adds no allow rule');
    expect(text).not.toContain('nothing is allowed automatically');
    expect(c.lines[1]).toMatch(/^asked from Settings · \d\d:\d\d · applies to new sessions$/);
    // never standing: grant is a never-standing kind and no tuple maps an mcp.enable card
    expect(NEVER_STANDING_KINDS.has('grant')).toBe(true);
    expect(standingTupleOf({ kind: 'grant' } as never, 'allow', c.detail, null)).toBeNull();
    expect(c.prepare('allow')).toBeNull();
    await c.effect('allow');
    expect(readMcpServersStore(home).enabled).toMatchObject([{ id, scope: 'all' }]);
    expect(fs.statSync(mcpServersPath(home)).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(mcpServersPath(home), 'utf8')).not.toContain(SECRET);
    // the session gets it now
    const comp = m.compose({ hsid: 'h1', cwd: (m.status() as { repos: Array<{ repo: string }> }).repos[0]!.repo });
    expect(Object.keys(comp.servers)).toEqual(['paradigm', 'neurons']);
  });

  it('slice C2\' + TD-2026-10-27-833: composeLocal gives user/plugin servers, and the first-party Paradigm only from a verified staged pin (none here: refused pin-mismatch); trust from the store', async () => {
    const { m, raised, w, home } = setup();
    const id = idOf(m, 'neurons');
    await m.request(human, MCP_ENABLE_REQUEST, { id, scope: 'all' });
    const c = raised[0]!;
    expect(c.prepare('allow')).toBeNull();
    await c.effect('allow');
    const repo = (m.status() as { repos: Array<{ repo: string }> }).repos[0]!.repo;
    expect(Object.keys(m.compose({ hsid: 'h1', cwd: repo }).servers)).toContain('paradigm');
    const local = m.composeLocal({ hsid: 'h1', cwd: repo });
    // the install at /p does not exist, so nothing is staged: Paradigm is listed refused, never launched
    expect(local.map((x) => [x.name, x.trust, x.refused?.fit ?? null])).toEqual([['paradigm', 'first-party', 'pin-mismatch'], ['neurons', 'enabled', null]]);
    expect(local[0]!.command).toBeUndefined();
    // a stored `trusted` is read; any other value falls back to enabled
    const st = readMcpServersStore(home);
    writeMcpServersStore(home, { ...st, enabled: st.enabled.map((e) => ({ ...e, trust: 'trusted' as const })) });
    expect(m.composeLocal({ hsid: 'h1', cwd: repo }).filter((x) => !x.refused).map((x) => x.trust)).toEqual(['trusted']);
    writeMcpServersStore(home, { ...st, enabled: st.enabled.map((e) => ({ ...e, trust: 'first-party' as never })) });
    expect(m.composeLocal({ hsid: 'h1', cwd: repo }).filter((x) => !x.refused).map((x) => x.trust)).toEqual(['enabled']);
    void w;
  });

  it('prepare refuses when the server changed while the card was open', async () => {
    const { m, raised, w } = setup();
    await m.request(human, MCP_ENABLE_REQUEST, { id: idOf(m, 'neurons'), scope: 'all' });
    const cfg = JSON.parse(fs.readFileSync(path.join(w.userHome, '.claude.json'), 'utf8'));
    cfg.mcpServers.neurons.args.push('--more');
    write(path.join(w.userHome, '.claude.json'), cfg);
    expect(() => raised[0]!.prepare('allow')).toThrow(/changed while the card was open/);
  });

  it("Aegis: a repo's .mcp.json server is never turned on for all; only for its own repo, by a card", async () => {
    const { m, raised, w } = setup();
    const id = idOf(m, 'repotool', true);
    await expect(m.request(human, MCP_ENABLE_REQUEST, { id, scope: 'all' })).rejects.toThrow(/that repo only/);
    const other = tmp('mcp-other-');
    await expect(m.request(human, MCP_ENABLE_REQUEST, { id, scope: 'repo', repo: other })).rejects.toThrow(/that repo only/);
    await m.request(human, MCP_ENABLE_REQUEST, { id, scope: 'repo', repo: w.repo });
    expect(raised[0]!.lines.join('\n')).toContain("allow only if you trust this repo");
    // nothing is on before the human allows
    expect(Object.keys(m.compose({ hsid: 'h', cwd: w.repo }).servers)).toEqual(['paradigm']);
  });

  it('a server with a problem cannot be turned on; only the human on gui or device may ask; Windows refuses enabling', async () => {
    const { m } = setup();
    await expect(m.request(human, MCP_ENABLE_REQUEST, { id: idOf(m, 'paradigm'), scope: 'all' })).rejects.toThrow(/cannot be turned on/);
    await expect(m.request({ ...human, principalClass: 'agent' }, MCP_ENABLE_REQUEST, { id: idOf(m, 'neurons'), scope: 'all' })).rejects.toThrow(/human's/);
    await expect(m.request({ ...human, credential: 'voice' }, MCP_ENABLE_REQUEST, { id: idOf(m, 'neurons'), scope: 'all' })).rejects.toThrow(/human's/);
    const win = setup('win32');
    await expect(win.m.request(human, MCP_ENABLE_REQUEST, { id: idOf(win.m, 'neurons'), scope: 'all' })).rejects.toThrow(/not on Windows yet/);
    expect(win.m.status()).toMatchObject({ unsupported: 'platform' });
  });

  it('disable needs no card; the first-party Paradigm MCP turns off and back on with no card; status shows names only', async () => {
    const { m, home, raised } = setup();
    const id = idOf(m, 'neurons');
    const s = readMcpServersStore(home);
    s.enabled.push({ id, scope: 'all', launchHash: 'h', at: 'x', cardId: 'card:x' });
    writeMcpServersStore(home, s);
    expect(await m.request(human, MCP_DISABLE_REQUEST, { id })).toMatchObject({ disabled: true, removed: 1 });
    expect(await m.request(human, MCP_DISABLE_REQUEST, { id: FIRST_PARTY_PARADIGM })).toMatchObject({ on: false });
    expect(m.sessionDenies()).toEqual([]);
    expect(Object.keys(m.compose({ hsid: 'h', cwd: '/tmp' }).servers)).toEqual([]);
    expect(await m.request(human, MCP_ENABLE_REQUEST, { id: FIRST_PARTY_PARADIGM })).toMatchObject({ on: true });
    expect(m.sessionDenies().map((d) => d.path)).toEqual(['/p', '/n/node']);
    // a linked dev install inside the session's own repo stays editable (the founder's npm link into a-paradigm)
    expect(m.sessionDenies({ cwd: '/p' }).map((d) => d.path)).toEqual(['/n/node']);
    expect(m.sessionDenies({ cwd: '/elsewhere', worktree: '/p/packages' }).map((d) => d.path)).toEqual(['/n/node']);
    expect(m.sessionDenies({ cwd: '/elsewhere' }).map((d) => d.path)).toEqual(['/p', '/n/node']);
    expect(raised).toHaveLength(0);
    expect(JSON.stringify(m.status())).not.toContain(SECRET);
  });
});

describe('G-MCP-02, G-MCP-03, G-MCP-04: Aegis review of #mcp-servers (TD-2026-10-23-361)', () => {
  const c = { source: 'user' as const, owner: '', pathDirs: ['/usr/bin', '/bin'], platform: 'darwin' };
  it('M1: ${NAME} only in the path and query; a loopback port placeholder works; rows show placeholders, never x', () => {
    for (const bad of ['https://${HOST}/mcp', 'https://mcp.example.com:${PORT}/mcp', 'https://${U}@mcp.example.com/', 'https://u:p@mcp.example.com/', '${SCHEME}://mcp.example.com/', 'http${S}://mcp.example.com/'])
      expect(checkRemoteUrl(bad).problem, bad).not.toBeNull();
    expect(checkRemoteUrl('https://mcp.example.com/${TENANT}/mcp?k=${KEY}')).toEqual({ problem: null, host: 'mcp.example.com', shown: 'https://mcp.example.com/${TENANT}/mcp' });
    expect(checkRemoteUrl('http://127.0.0.1:${PORT}/').problem).toBeNull();
    expect(checkRemoteUrl('http://127.0.0.1:${PORT:-7777}/mcp').shown).toBe('http://127.0.0.1:${PORT:-7777}/mcp');
    const d = declOf('r', { type: 'http', url: 'https://mcp.example.com/${TENANT}/mcp' }, c);
    expect(mcpServerRow(d).url).toBe('https://mcp.example.com/${TENANT}/mcp');
    // after expansion: a value can never move the host; the expanded URL is checked again
    expect(checkRemoteUrl('http://127.0.0.1:8080/', { expanded: true }).problem).toBeNull();
    expect(checkRemoteUrl('http://127.0.0.1:${PORT}/', { expanded: true }).problem).not.toBeNull();
    const loop = declOf('l', { type: 'http', url: 'http://127.0.0.1:${PORT}/mcp' }, c);
    const on = () => 'on' as const;
    expect(composeSessionMcp({ decls: [loop], enabled: on, launchKey: KEY, cwd: '/r', envValue: (n) => (n === 'PORT' ? '7777' : undefined) }).servers.l).toEqual({ type: 'http', url: 'http://127.0.0.1:7777/mcp' });
    // a port value that is not a port fails the expanded check: skipped, never launched
    const bad = composeSessionMcp({ decls: [loop], enabled: on, launchKey: KEY, cwd: '/r', envValue: () => '80@evil.example.com' });
    expect(bad.servers.l).toBeUndefined();
    expect(bad.skipped).toEqual([{ id: loop.id, server: 'l', why: 'remote' }]);
  });

  it('L1: a repo .mcp.json that is a symlink, a hard link or outside the repo is refused, shown as a row', () => {
    const repo = tmp('mcp-l1-');
    const other = tmp('mcp-l1o-');
    write(path.join(other, 'x.json'), { mcpServers: { evil: { command: '/bin/echo' } } });
    fs.symlinkSync(path.join(other, 'x.json'), path.join(repo, '.mcp.json'));
    expect(readRepoMcpJson(repo).problem).toMatch(/symlink/);
    fs.rmSync(path.join(repo, '.mcp.json'));
    fs.linkSync(path.join(other, 'x.json'), path.join(repo, '.mcp.json'));
    expect(readRepoMcpJson(repo).problem).toMatch(/hard link/);
    const ds = discoverMcpServers({ userHome: tmp('mcp-l1u-'), repos: [repo], pathDirs: [] });
    expect(ds).toHaveLength(1);
    expect(ds[0]!.problems).toEqual([{ code: 'repo-file', text: expect.stringMatching(/hard link/) }]);
    fs.rmSync(path.join(repo, '.mcp.json'));
    write(path.join(repo, '.mcp.json'), { mcpServers: { ok: { command: '/bin/echo' } } });
    expect(readRepoMcpJson(repo).problem).toBeNull();
  });

  it('L2: NAME=value and short-flag values that look secret are hidden; L3: inline code is flagged', () => {
    expect(shownArgs(['API_KEY=abc', 'MODE=fast', '-k', 'abc', '-v', 'x'])).toEqual([`API_KEY=${HIDDEN_ARG}`, 'MODE=fast', '-k', HIDDEN_ARG, '-v', 'x']);
    expect(inlineOf('/usr/bin/node', ['-e', 'require("x")'])).toBe('node -e');
    expect(inlineOf('/usr/bin/python3', ['-c', 'print(1)'])).toBe('python3 -c');
    expect(inlineOf('/opt/homebrew/bin/deno', ['eval', 'x'])).toBe('deno eval');
    expect(inlineOf('/usr/bin/node', ['/x.js'])).toBeNull();
    expect(declOf('i', { command: '/usr/bin/node', args: ['-e', 'x'] }, c).inline).toBe('node -e');
  });

  it("H1: the human's own Claude Code allow rules for a server are named, never overridden", () => {
    const u = tmp('mcp-h1-');
    write(path.join(u, '.claude', 'settings.json'), { permissions: { allow: ['mcp__github__*', 'mcp__neurons__search', 'Bash(ls)', 'mcp__githubx__a'] } });
    write(path.join(u, '.claude', 'settings.local.json'), { permissions: { allow: ['mcp__github'] } });
    expect(autoAllowRules(u, 'github')).toEqual(['mcp__github', 'mcp__github__*']);
    expect(autoAllowRules(u, 'neurons')).toEqual(['mcp__neurons__search']);
    expect(autoAllowRules(u, 'none')).toEqual([]);
    expect(allowRuleWords(['mcp__github__*', 'mcp__neurons__search', 'mcp__*'])).toBe('mcp__github__* (all tools), mcp__neurons__search, mcp__* (every MCP tool)');
  });
});

describe('G-MCP-05 Aegis review: the card, the denies and the events', () => {
  const human = { connId: 'c1', principal: 'p:abcdefgh/founder', principalClass: 'human', credential: 'gui' };
  it('H1 card line, M3 denies for enabled `all` servers (overlap exempt and logged), L5 added only after the merge, linked first party', async () => {
    const w = world();
    write(path.join(w.userHome, '.claude', 'settings.json'), { enabledPlugins: {}, permissions: { allow: ['mcp__neurons__*'] } });
    // neurons runs node with an absolute script path on disk
    const script = path.join(w.userHome, 'neurons', 'main.js');
    write(script, '');
    const cfg = JSON.parse(fs.readFileSync(path.join(w.userHome, '.claude.json'), 'utf8'));
    cfg.mcpServers.neurons.args = [script, 'mcp'];
    write(path.join(w.userHome, '.claude.json'), cfg);
    const home = tmp('mcp-home-');
    const raised: Array<{ lines: string[]; effect: (d: string) => Promise<void>; cardId: string }> = [];
    const events: Array<Record<string, unknown>> = [];
    const m = new McpServers({ home, broker: { raise: async (i: never) => (raised.push(i), { cardId: (i as { cardId: string }).cardId }) as never, card: () => ({ state: 'pending' }) as never } as never, userHome: w.userHome, pathDirs: () => w.pathDirs, launchKey: KEY, firstParty: () => ({ available: true, node: '/n/node', dir: '/p', entry: '/p/mcp.js', version: '8.0.0', linked: true }), liveRepos: () => [], emit: (e) => events.push(e) });
    const st = m.status() as { servers: Array<{ id: string; name: string; autoAllowed: string[] }>; firstParty: Record<string, unknown> };
    expect(st.firstParty).toMatchObject({ linked: true, dir: '/p', autoAllowed: [] });
    const n = st.servers.find((s) => s.name === 'neurons')!;
    expect(n.autoAllowed).toEqual(['mcp__neurons__*']);
    await m.request(human, MCP_ENABLE_REQUEST, { id: n.id, scope: 'all' });
    expect(raised[0]!.lines).toContain('your Claude Code settings auto-allow: mcp__neurons__* (all tools); those tools run with no card');
    await raised[0]!.effect('allow');
    const denies = m.sessionDenies({ cwd: w.repo }).map((d) => `${d.match}:${d.path}`);
    expect(denies).toEqual(['subpath:/p', 'literal:/n/node', `literal:${path.join(w.bin, 'node')}`, `literal:${script}`]);
    // a session inside the server's own folder keeps it editable; the skip is logged
    expect(m.sessionDenies({ cwd: path.dirname(script) }).map((d) => d.path)).not.toContain(script);
    expect(events).toContainEqual({ event: 'mcp.deny.skipped', id: n.id, path: script, why: 'inside-session-roots' });
    // L5: compose emits no added; noteMerged emits only what reached the final set
    events.length = 0;
    const r = m.compose({ hsid: 'h', cwd: w.repo });
    expect(events.filter((e) => e.event === 'mcp.user.added')).toEqual([]);
    m.noteMerged('h', r, { paradigm: r.servers.paradigm });
    expect(events.filter((e) => e.event === 'mcp.user.added').map((e) => e.server)).toEqual(['paradigm']);
  });
});

describe('G-MCP-07 #batch-card: several MCP servers on ONE card (founder 2026-10-23: one password)', () => {
  const human = { connId: 'c1', principal: 'p:abcdefgh/founder', principalClass: 'human', credential: 'gui' };
  function setup(maxCardChars?: number) {
    const w = world();
    const home = tmp('mcp-home-');
    const raised: Array<Record<string, unknown> & { cardId: string; lines: string[]; block?: { children: Array<{ text: string }> }; effect: (d: string, ctx?: { connId: string }) => Promise<void>; prepare: (d: string) => unknown; detail: Record<string, unknown> }> = [];
    const decided = new Set<string>();
    const broker = { raise: async (i: never) => (raised.push(i), { cardId: (i as { cardId: string }).cardId }) as never, card: (id: string) => ({ state: raised.some((r) => r.cardId === id) && !decided.has(id) ? 'pending' : 'gone' }) as never };
    const events: Array<Record<string, unknown>> = [];
    const m = new McpServers({ home, broker: broker as never, userHome: w.userHome, pathDirs: () => w.pathDirs, launchKey: KEY, firstParty: () => ({ available: true, node: '/n/node', dir: '/p', entry: '/p/mcp.js', version: '8.0.0' }), liveRepos: () => [{ cwd: w.repo, hsid: 'h1' }], emit: (e) => events.push(e), ...(maxCardChars ? { maxCardChars } : {}) });
    const st = m.status() as { servers: Array<{ id: string; name: string }>; repos: Array<{ servers: Array<{ id: string; name: string }> }> };
    const id = (name: string): string => [...st.servers, ...st.repos[0]!.servers].find((s) => s.name === name)!.id;
    const decide = async (c: (typeof raised)[number], d: string, connId = 'c1'): Promise<void> => {
      decided.add(c.cardId);
      await c.effect(d, { connId });
    };
    return { w, home, raised, m, events, id, decide };
  }

  it('raises ONE grant card for every server, each its own field block; one allow turns them all on', async () => {
    const { m, raised, home, id, w, decide } = setup();
    const r = (await m.request(human, MCP_ENABLE_REQUEST, { servers: [{ id: id('neurons'), scope: 'all' }, { id: id('linear'), scope: 'all' }, { id: id('repotool'), scope: 'repo', repo: w.repo }] })) as { pending: boolean; cardId: string; ids: string[] };
    expect(r).toMatchObject({ pending: true, ids: [id('neurons'), id('linear'), id('repotool')] });
    expect(raised).toHaveLength(1);
    const c = raised[0]!;
    expect(c).toMatchObject({ kind: 'grant', handOnly: true, decisions: ['allow', 'deny'] });
    expect(c.detail).toMatchObject({ action: 'mcp.enable', rootRows: [] });
    expect((c.detail.servers as Array<Record<string, unknown>>).map((s) => [s.name, s.scope])).toEqual([['neurons', 'all'], ['linear', 'all'], ['repotool', 'repo']]);
    expect(c.lines[0]).toBe('Turn on 3 MCP servers');
    expect(c.lines[1]).toMatch(/^asked from Settings · \d\d:\d\d · applies to new sessions$/);
    const text = c.lines.join('\n');
    expect(text).toContain('server 1 of 3: neurons for all your repos:');
    expect(text).toContain('  │ env names NEURONS_TOKEN, NEURONS_VAULT (values not shown)');
    expect(text).toContain('  │ connects to mcp.linear.app');
    expect(text).toContain(`server 3 of 3: repotool in ${path.basename(w.repo)}:`);
    expect(text).toContain('  └ end of server 3 of 3');
    expect(c.lines.at(-1)).toMatch(/^Allow takes the root key and your presence \(Touch ID or your Mac password\), once for all 3 · never standing, never by voice/);
    expect(text).not.toContain(SECRET);
    expect(c.block?.children.length).toBeGreaterThanOrEqual(c.lines.length); // wrapped, never cut
    // while it waits: status lists each server under the one card
    const pend = (m.status() as { pending: Array<{ cardId: string; id: string }> }).pending;
    expect(pend.map((p) => p.cardId)).toEqual([c.cardId, c.cardId, c.cardId]);
    expect(c.prepare('allow')).toBeNull();
    await decide(c, 'allow');
    expect(readMcpServersStore(home).enabled.map((e) => [e.id, e.cardId])).toEqual([[id('neurons'), c.cardId], [id('linear'), c.cardId], [id('repotool'), c.cardId]]);
    expect(Object.keys(m.compose({ hsid: 'h1', cwd: w.repo }).servers).sort()).toEqual(['linear', 'neurons', 'paradigm', 'repotool']);
  });

  it('at allow each launch hash is checked again: a changed server is skipped and reported, the rest turn on', async () => {
    const { m, raised, home, id, w, events, decide } = setup();
    await m.request(human, MCP_ENABLE_REQUEST, { servers: [{ id: id('neurons'), scope: 'all' }, { id: id('linear'), scope: 'all' }] });
    const cfg = JSON.parse(fs.readFileSync(path.join(w.userHome, '.claude.json'), 'utf8'));
    cfg.mcpServers.neurons.args.push('--more');
    write(path.join(w.userHome, '.claude.json'), cfg);
    expect(raised[0]!.prepare('allow')).toBeNull(); // one is still the same: the card goes on to the presence prompt
    await decide(raised[0]!, 'allow');
    expect(readMcpServersStore(home).enabled.map((e) => e.id)).toEqual([id('linear')]);
    expect((m.status() as { skipped?: unknown }).skipped).toMatchObject({ cardId: raised[0]!.cardId, ids: [id('neurons')], names: ['neurons'], on: [id('linear')], connId: 'c1' });
    expect(events).toContainEqual(expect.objectContaining({ event: 'mcp.user.skipped-changed', id: id('neurons') }));
  });

  it('when every server changed, prepare refuses before the presence prompt', async () => {
    const { m, raised, id, w } = setup();
    await m.request(human, MCP_ENABLE_REQUEST, { servers: [{ id: id('neurons'), scope: 'all' }, { id: id('keyed'), scope: 'all' }] });
    const cfg = JSON.parse(fs.readFileSync(path.join(w.userHome, '.claude.json'), 'utf8'));
    cfg.mcpServers.neurons.args.push('--more');
    cfg.mcpServers.keyed.args.push('--more');
    write(path.join(w.userHome, '.claude.json'), cfg);
    expect(() => raised[0]!.prepare('allow')).toThrow(/every server on the card changed/);
  });

  it('validates everything first: one bad server, too many, or a card too large refuses the batch and raises nothing', async () => {
    const { m, raised, home, id } = setup();
    await expect(m.request(human, MCP_ENABLE_REQUEST, { servers: [{ id: id('neurons'), scope: 'all' }, { id: id('repotool'), scope: 'all' }] })).rejects.toThrow(/servers\[1\]: repotool .*that repo only/);
    await expect(m.request(human, MCP_ENABLE_REQUEST, { servers: [{ id: id('neurons'), scope: 'all' }, { id: id('paradigm'), scope: 'all' }] })).rejects.toThrow(/servers\[1\]: paradigm cannot be turned on/);
    await expect(m.request(human, MCP_ENABLE_REQUEST, { servers: [{ id: id('neurons'), scope: 'all' }, { id: id('neurons'), scope: 'all' }] })).rejects.toThrow(/named twice/);
    await expect(m.request(human, MCP_ENABLE_REQUEST, { servers: [{ id: FIRST_PARTY_PARADIGM, scope: 'all' }] })).rejects.toThrow(/its own key/);
    await expect(m.request(human, MCP_ENABLE_REQUEST, { servers: [] })).rejects.toThrow(/non-empty/);
    await expect(m.request({ ...human, credential: 'voice' }, MCP_ENABLE_REQUEST, { servers: [{ id: id('neurons'), scope: 'all' }] })).rejects.toThrow(/human's/);
    const many = Array.from({ length: MCP_ENABLE_MAX + 1 }, () => ({ id: id('neurons'), scope: 'all' }));
    await expect(m.request(human, MCP_ENABLE_REQUEST, { servers: many })).rejects.toThrow(new RegExp(`at most ${MCP_ENABLE_MAX} servers`));
    const small = setup(600);
    await expect(small.m.request(human, MCP_ENABLE_REQUEST, { servers: [{ id: small.id('neurons'), scope: 'all' }, { id: small.id('linear'), scope: 'all' }] })).rejects.toThrow(/over the 600 a card shows in full/);
    expect(raised).toHaveLength(0);
    expect(small.raised).toHaveLength(0);
    expect(readMcpServersStore(home).enabled).toEqual([]);
  });

  it('the same batch again returns its card; a batch overlapping a waiting card is refused; the next batch may wait beside it', async () => {
    const { m, raised, id } = setup();
    const r1 = (await m.request(human, MCP_ENABLE_REQUEST, { servers: [{ id: id('neurons'), scope: 'all' }, { id: id('keyed'), scope: 'all' }] })) as { cardId: string };
    expect(await m.request(human, MCP_ENABLE_REQUEST, { servers: [{ id: id('neurons'), scope: 'all' }, { id: id('keyed'), scope: 'all' }] })).toMatchObject({ pending: true, cardId: r1.cardId });
    await expect(m.request(human, MCP_ENABLE_REQUEST, { servers: [{ id: id('keyed'), scope: 'all' }, { id: id('linear'), scope: 'all' }] })).rejects.toThrow(/already on a card that is waiting/);
    await m.request(human, MCP_ENABLE_REQUEST, { servers: [{ id: id('linear'), scope: 'all' }] });
    expect(raised).toHaveLength(2);
    expect(raised[1]!.lines[0]).toMatch(/^Turn on MCP server linear for all your repos$/); // a batch of one keeps the one-server card
  });

  it('turning servers off needs no card and applies at once, even while a batch card waits; a batch already on raises nothing', async () => {
    const { m, raised, home, id, decide } = setup();
    await m.request(human, MCP_ENABLE_REQUEST, { servers: [{ id: id('neurons'), scope: 'all' }, { id: id('linear'), scope: 'all' }] });
    await decide(raised[0]!, 'allow');
    await m.request(human, MCP_ENABLE_REQUEST, { servers: [{ id: id('keyed'), scope: 'all' }, { id: id('lens'), scope: 'all' }] });
    expect(await m.request(human, MCP_DISABLE_REQUEST, { id: id('neurons') })).toMatchObject({ disabled: true, removed: 1 });
    expect(readMcpServersStore(home).enabled.map((e) => e.id)).toEqual([id('linear')]);
    expect(raised).toHaveLength(2); // the off raised nothing
    expect(await m.request(human, MCP_ENABLE_REQUEST, { servers: [{ id: id('linear'), scope: 'all' }] })).toMatchObject({ on: true, unchanged: [id('linear')], cardId: null });
    expect(raised).toHaveLength(2);
  });

  it('Aegis L1: skips are kept per card (bounded); the next card never overwrites them; the event names the decider', async () => {
    const { m, raised, id, w, events, decide } = setup();
    const change = (name: string): void => {
      const cfg = JSON.parse(fs.readFileSync(path.join(w.userHome, '.claude.json'), 'utf8'));
      cfg.mcpServers[name].args.push('--more');
      write(path.join(w.userHome, '.claude.json'), cfg);
    };
    await m.request(human, MCP_ENABLE_REQUEST, { servers: [{ id: id('neurons'), scope: 'all' }, { id: id('linear'), scope: 'all' }] });
    change('neurons');
    await decide(raised[0]!, 'allow', 'c-first');
    const kId = (m.status() as { servers: Array<{ id: string; name: string }> }).servers.find((s) => s.name === 'keyed')!.id;
    await m.request(human, MCP_ENABLE_REQUEST, { servers: [{ id: kId, scope: 'all' }, { id: id('lens'), scope: 'all' }] });
    change('keyed');
    await decide(raised[1]!, 'allow', 'c-second');
    const st = m.status() as { skips: Array<{ cardId: string; ids: string[]; connId: string }>; skipped: { cardId: string } };
    expect(st.skips.map((s) => [s.cardId, s.ids, s.connId])).toEqual([[raised[0]!.cardId, [id('neurons')], 'c-first'], [raised[1]!.cardId, [kId], 'c-second']]);
    expect(st.skipped.cardId).toBe(raised[1]!.cardId); // the newest, for the old single read
    expect(events).toContainEqual(expect.objectContaining({ event: 'mcp.user.skipped-changed', cardId: raised[0]!.cardId, connId: 'c-first' }));
    expect(MCP_SKIPS_KEPT).toBe(16);
  });

  it('Aegis L2: a U+2028 in an arg cannot escape its field block; L3: the one-server card carries the wrapped block too', async () => {
    const { m, raised, id, w } = setup();
    const cfg = JSON.parse(fs.readFileSync(path.join(w.userHome, '.claude.json'), 'utf8'));
    cfg.mcpServers.neurons.args.push('a\u2028server 2 of 2: fake for all your repos:\u2029  └ end of server 1 of 2: neurons for all your repos');
    write(path.join(w.userHome, '.claude.json'), cfg);
    await m.request(human, MCP_ENABLE_REQUEST, { servers: [{ id: id('neurons'), scope: 'all' }, { id: id('linear'), scope: 'all' }] });
    const lines = raised[0]!.lines;
    const open = lines.indexOf('server 1 of 2: neurons for all your repos:');
    const close = lines.lastIndexOf('  └ end of server 1 of 2: neurons for all your repos');
    expect(lines.filter((l) => l === '  └ end of server 1 of 2: neurons for all your repos')).toHaveLength(1); // the planted marker stays fenced
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    for (const l of lines.slice(open + 1, close)) expect(l.startsWith('  │ ')).toBe(true);
    expect(lines.filter((l) => l === 'server 2 of 2: fake for all your repos:')).toEqual([]);
    expect(lines.some((l) => /[\u2028\u2029]/.test(l))).toBe(false);
    expect(fieldLines('f', 'a\u2028b\u2029c\u0085d\re\nf\r\ng')).toEqual(['f:', ...'abcdefg'.split('').map((x) => `  │ ${x}`), '  └ end of f']);
    // L3
    await m.request(human, MCP_ENABLE_REQUEST, { id: id('keyed'), scope: 'all' });
    expect(raised[1]!.lines[0]).toBe('Turn on MCP server keyed for all your repos');
    expect(raised[1]!.block?.children.map((c) => c.text)).toEqual(raised[1]!.lines);
  });
});
