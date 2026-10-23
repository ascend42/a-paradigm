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
import { enabledState, MCP_DISABLE_REQUEST, MCP_ENABLE_REQUEST, mcpServersPath, McpServers, readMcpServersStore, writeMcpServersStore } from '../src/kernel/desk/mcp-server-cards.js';
import { NEVER_STANDING_KINDS, standingTupleOf } from '../src/kernel/broker/standing-grant.js';
import { buildClaudeArgv } from '../src/adapters/claude-code/adapter.js';

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

describe('#mcp-servers discovery', () => {
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

describe('#mcp-servers rows: names, never values (Aegis: secret handling)', () => {
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

describe('#mcp-servers problems (Aegis: law 7, env names, shell wrappers, remote URLs)', () => {
  const c = { source: 'user' as const, owner: '', pathDirs: ['/usr/bin', '/bin'], platform: 'darwin' };
  const codes = (name: string, raw: unknown) => declOf(name, raw, c).problems.map((p) => p.code);
  it('law-7 and hazard env names are refused (the session would otherwise refuse, or run injected code)', () => {
    expect(codes('a', { command: '/bin/x', env: { ANTHROPIC_API_KEY: 'k' } })).toContain('law-7');
    expect(codes('a', { command: '/bin/x', env: { OPENAI_BASE_URL: 'u' } })).toContain('law-7');
    expect(codes('a', { command: '/bin/x', env: { NODE_OPTIONS: '--require x' } })).toContain('law-7'); // scrubbed
    expect(codes('a', { command: '/bin/x', env: { DYLD_INSERT_LIBRARIES: 'x' } })).toContain('env-name');
    expect(codes('a', { command: '/bin/x', env: { PATH: '/x' } })).toContain('env-name');
    expect(codes('a', { command: '/bin/x', args: ['${GNOMON_KEY}'] })).toContain('env-name');
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

describe('#mcp-servers composing a session (Aegis: untrusted repo .mcp.json, env injection, --strict-mcp-config)', () => {
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

describe('#mcp-servers first party resolution', () => {
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

describe('#mcp-servers the enable card and requests', () => {
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
    expect(text).toContain('nothing is allowed automatically');
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
