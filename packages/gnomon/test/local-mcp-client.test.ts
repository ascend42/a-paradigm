/**
 * #local-mcp-client (TD-2026-10-27-833 slice C2'): the kernel's stdio MCP client and the per-session pool, over a fake
 * server (test/fixtures/fake-mcp-server.mjs, spawned via process.execPath: never a shebang). List, call,
 * list_changed, timeout, abort, a crash, an oversized message, op-annotations from a resource, remote refusal, lazy
 * spawn through the cache and reap on close.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { remoteProxyOf } from '../src/kernel/desk/mcp-server-cards.js';
import { launchCheck, launchKey, LocalMcpPool, McpListCache, McpStdioClient, serverEnv, serverLabel, type LocalMcpServer } from '../src/kernel/local/mcp-client.js';
import { bindingOf, type PoolTrust } from '../src/kernel/local/trust-book.js';

/** slice C5'a1: a TrustBook stand-in; `trustNewest` trusts the newest listing of an id (what a human commit does). */
const LAUNCH = `hmac-sha256:${'1'.repeat(64)}`;
const stubTrust = (): PoolTrust & { m: Map<string, { binding: string; launchHash: string; toolsHash: string; label: string }>; drops: string[]; trustNewest: (cache: McpListCache, id: string) => void } => {
  const m = new Map<string, { binding: string; launchHash: string; toolsHash: string; label: string }>();
  const drops: string[] = [];
  return {
    m,
    drops,
    of: (id) => m.get(id) ?? null,
    drop: (id, why) => {
      if (m.delete(id)) drops.push(`${id}:${why}`);
    },
    trustNewest: (cache, id) => {
      const n = cache.newest(id)!;
      m.set(id, { binding: bindingOf({ id, launchHash: n.launchHash, pluginVersion: n.pluginVersion, toolsHash: n.toolsHash }), launchHash: n.launchHash, toolsHash: n.toolsHash, label: n.label });
    },
  };
};

const FAKE = path.join(__dirname, 'fixtures', 'fake-mcp-server.mjs');
const dirs: string[] = [];
const kids: ChildProcess[] = [];
const tmp = (): string => {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-client-')));
  dirs.push(d);
  return d;
};
const spawnFake = (pidfile?: string): ChildProcess => {
  const c = spawn(process.execPath, [FAKE, ...(pidfile ? [pidfile] : [])], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  kids.push(c);
  return c;
};
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const waitFor = async (f: () => boolean, ms = 10_000): Promise<void> => {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 25));
  }
};

afterEach(() => {
  for (const k of kids.splice(0)) if (k.exitCode === null && k.signalCode === null) k.kill('SIGKILL');
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const server = (over: Partial<LocalMcpServer> = {}): LocalMcpServer => ({ id: 'user::fake', name: 'fake', transport: 'stdio', command: process.execPath, args: [FAKE], trust: 'enabled', launchHash: LAUNCH, ...over });
/** slice C6'a1: a server process that exits before it answers initialize. */
const spawnDead = (): ChildProcess => {
  const c = spawn(process.execPath, ['-e', 'process.exit(4)'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  kids.push(c);
  return c;
};

describe("slice C6'a1: the pool's state report and its onState (session.mcp)", () => {
  it('a start, a runtime crash (once), a respawn; the pool\'s own kills say nothing; report() follows', async () => {
    const states: string[] = [];
    const pool = new LocalMcpPool({ servers: [server()], repo: '/r', spawn: () => spawnFake(), onState: (l, st, err) => states.push(`${l}:${st}${err ? `:${err}` : ''}`) });
    expect(pool.report()).toEqual([{ label: 'fake', id: 'user::fake', state: 'not-started', error: null, starts: 0, trust: 'enabled' }]);
    await pool.index();
    expect(states).toEqual(['fake:started']);
    expect(pool.report()[0]).toMatchObject({ state: 'running', starts: 1, error: null });
    const t = pool.target('fake')!;
    await t.call('crash', {}, { signal: new AbortController().signal, deadline: Date.now() + 10_000 });
    await waitFor(() => states.length === 2);
    expect(states[1]).toMatch(/^fake:failed:/);
    expect(pool.report()[0]).toMatchObject({ state: 'failed', starts: 1, error: expect.any(String) });
    expect((await t.call('echo', {}, { signal: new AbortController().signal, deadline: Date.now() + 10_000 })).isError).toBe(false);
    expect(states.slice(2)).toEqual(['fake:started']);
    expect(pool.report()[0]).toMatchObject({ state: 'running', starts: 2 });
    await pool.closeAll();
    await new Promise((r) => setTimeout(r, 100));
    expect(states).toHaveLength(3);
  }, 30_000);

  it('restart: resets the starts counter after MAX_STARTS failures, starts and lists again; one at a time', async () => {
    const states: string[] = [];
    let good = false;
    const changed: string[][] = [];
    const cache = new McpListCache();
    const pool = new LocalMcpPool({ servers: [server()], repo: '/r', cache, spawn: () => (good ? spawnFake() : spawnDead()), onState: (l, st) => states.push(`${l}:${st}`), onChanged: (_l, es) => changed.push(es.map((e) => e.name)) });
    await pool.index();
    const t = pool.target('fake')!;
    for (let i = 0; i < 2; i++) await t.call('echo', {}, { signal: new AbortController().signal, deadline: Date.now() + 10_000 });
    expect(pool.report()[0]).toMatchObject({ state: 'failed', starts: 3 });
    // past MAX_STARTS nothing starts (and nothing new is said)
    expect((await t.call('echo', {}, { signal: new AbortController().signal, deadline: Date.now() + 10_000 })).text).toMatch(/not restarted after 3 starts/);
    expect(states).toEqual(['fake:failed', 'fake:failed', 'fake:failed']);
    expect(cache.failure(launchKey(server(), '/r'))).toBeDefined();
    good = true;
    const [a, b] = await Promise.allSettled([pool.restart('fake'), pool.restart('fake')]);
    expect(a).toMatchObject({ status: 'fulfilled', value: { error: null } });
    expect(b).toMatchObject({ status: 'rejected', reason: { code: 'busy' } });
    expect(pool.report()[0]).toMatchObject({ state: 'running', starts: 1, error: null });
    expect(states.at(-1)).toBe('fake:started');
    expect(changed.at(-1)).toContain('echo');
    expect(cache.failure(launchKey(server(), '/r'))).toBeUndefined();
    expect(pool.busy('fake')).toBe(false);
    await expect(pool.restart('nope')).rejects.toThrow(/no server/);
    await pool.closeAll();
  }, 30_000);

  it('trustHolds: true until a server narrowed trusted loses that trust or the book holds another binding', async () => {
    const cache = new McpListCache();
    const trust = stubTrust();
    const pool = new LocalMcpPool({ servers: [server()], repo: '/r', cache, trust, spawn: () => spawnFake() });
    await pool.index();
    expect(pool.trustHolds('fake')).toBe(true); // enabled, never trusted
    trust.trustNewest(cache, 'user::fake');
    pool.renarrow('fake');
    expect(pool.trustLive('fake')).toBe('trusted');
    expect(pool.trustHolds('fake')).toBe(true);
    trust.m.get('user::fake')!.binding = `sha256:${'9'.repeat(64)}`;
    expect(pool.trustHolds('fake')).toBe(false);
    trust.m.delete('user::fake');
    expect(pool.trustHolds('fake')).toBe(false); // it was trusted in this session and is not now
    await pool.closeAll();
  }, 30_000);

  it('a start that fails says failed once; a remote server is the pool\'s refusal', async () => {
    const states: string[] = [];
    const pool = new LocalMcpPool({ servers: [server(), server({ id: 'user::far', name: 'far', transport: 'http', command: undefined })], repo: '/r', spawn: () => spawnDead(), onState: (l, st) => states.push(`${l}:${st}`) });
    expect(pool.refused).toEqual([{ id: 'user::far', name: 'far', fit: 'remote-refused' }]);
    const ix = await pool.index();
    expect(ix.failed).toHaveLength(1);
    expect(states).toEqual(['fake:failed']);
    expect(pool.report()[0]).toMatchObject({ state: 'failed', starts: 1 });
    await pool.closeAll();
  }, 30_000);
});

describe('McpStdioClient', () => {
  it('initialize, tools/list, tools/call; a server request is answered not-supported', async () => {
    const c = new McpStdioClient(spawnFake());
    await c.initialize();
    const tools = await c.listTools();
    expect(tools.map((t) => t.name)).toContain('echo');
    expect(await c.callTool('echo', { text: 'hi' }, { deadline: Date.now() + 10_000 })).toEqual({ text: 'echo:{"text":"hi"}:1', isError: false });
    c.kill();
  }, 20_000);

  it('a call times out at its deadline and sends notifications/cancelled', async () => {
    const d = tmp();
    const pf = path.join(d, 'pid');
    const c = new McpStdioClient(spawnFake(pf));
    await c.initialize();
    await expect(c.callTool('slow', {}, { deadline: Date.now() + 300 })).rejects.toMatchObject({ code: 'timeout' });
    await waitFor(() => fs.existsSync(`${pf}.cancelled`));
    c.kill();
  }, 20_000);

  it('the broker signal aborts a call (cancelled sent)', async () => {
    const d = tmp();
    const pf = path.join(d, 'pid');
    const c = new McpStdioClient(spawnFake(pf));
    await c.initialize();
    const ctl = new AbortController();
    const p = c.callTool('slow', {}, { signal: ctl.signal, deadline: Date.now() + 30_000 });
    setTimeout(() => ctl.abort(), 100);
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
    await waitFor(() => fs.existsSync(`${pf}.cancelled`));
    c.kill();
  }, 20_000);

  it('a crash rejects the call in flight; an oversized message kills the server', async () => {
    const c = new McpStdioClient(spawnFake());
    await c.initialize();
    await expect(c.callTool('crash', {}, { deadline: Date.now() + 10_000 })).rejects.toMatchObject({ code: 'exited' });
    expect(c.dead).toMatch(/exited/);
    const b = new McpStdioClient(spawnFake(), { maxMessageBytes: 64 * 1024 });
    await b.initialize();
    await expect(b.callTool('big', {}, { deadline: Date.now() + 10_000 })).rejects.toMatchObject({ code: 'exited' });
    expect(b.dead).toMatch(/over 65536 bytes/);
    await b.exited;
  }, 20_000);

  it('finds the op-annotations resource by its /tool-annotations URI', async () => {
    const c = new McpStdioClient(spawnFake());
    await c.initialize();
    expect(await c.readOpAnnotations()).toEqual({ schema: 'io.gnomon/op-annotations:v1', tools: { fam: { get: { readOnlyHint: true, openWorldHint: false } } } });
    c.kill();
  }, 20_000);
});

describe('LocalMcpPool', () => {
  it('refuses remote http/sse servers with fit remote-refused', () => {
    const pool = new LocalMcpPool({ servers: [server({ id: 'user::r', name: 'Remote.X', transport: 'http', command: undefined }), server({ name: 'sse', transport: 'sse' })], spawn: () => spawnFake(), repo: '/r' });
    expect(pool.refused).toEqual([{ id: 'user::r', name: 'Remote.X', fit: 'remote-refused' }, { id: 'user::fake', name: 'sse', fit: 'remote-refused' }]);
    expect(pool.labels).toEqual([]);
    expect(serverLabel('Remote.X')).toBe('remote-x');
  });

  it('index narrows with the TrustBook trust (no resource for a trusted server); a cache hit spawns nothing until first call; reap on close', async () => {
    const d = tmp();
    const cache = new McpListCache();
    const trust = stubTrust();
    let spawned = 0;
    const pids: string[] = [];
    const mk = (): LocalMcpPool =>
      new LocalMcpPool({
        servers: [server()],
        repo: d,
        cache,
        trust,
        spawn: () => {
          spawned++;
          const pf = path.join(d, `pid${spawned}`);
          pids.push(pf);
          return spawnFake(pf);
        },
      });
    const a = mk();
    const ix0 = await a.index();
    expect(spawned).toBe(1);
    // slice C5'a1: not trusted yet: every tool mutate
    expect(new Set(ix0.entries.map((e) => e.class))).toEqual(new Set(['mutate']));
    expect(a.trustLive('fake')).toBe('enabled');
    trust.trustNewest(cache, 'user::fake');
    const ix = { entries: a.renarrow('fake')! };
    const cls = Object.fromEntries(ix.entries.map((e) => [e.name, e.class]));
    // a trusted server's tools/list labels count; its op-annotations RESOURCE is never read (fam.get stays mutate)
    expect(cls).toMatchObject({ echo: 'read', poke: 'mutate', 'fam.get': 'mutate', 'fam.set': 'mutate' });
    expect(a.trustLive('fake')).toBe('trusted');
    expect(ix.entries[0]!.id).toMatch(/^fake\/echo@[0-9a-f]{8}$/);
    await a.closeAll();
    const pid1 = Number(fs.readFileSync(pids[0]!, 'utf8'));
    await waitFor(() => !alive(pid1));

    // a second session in the same repo: the cached list, no spawn until a call
    const b = mk();
    expect(Object.fromEntries((await b.index()).entries.map((e) => [e.name, e.class]))).toMatchObject({ echo: 'read' });
    expect(spawned).toBe(1);
    const t = b.target('fake')!;
    let running = 0;
    const r = await t.call('echo', { text: 'x' }, { signal: new AbortController().signal, deadline: Date.now() + 10_000, onRunning: () => running++ });
    expect(r).toEqual({ text: 'echo:{"text":"x"}:1', isError: false });
    expect(spawned).toBe(2);
    // the first spawn re-listed once (same tools): still trusted, nothing dropped
    expect(b.trustLive('fake')).toBe('trusted');
    expect(trust.drops).toEqual([]);
    expect(running).toBe(1);
    expect(b.live).toBe(1);
    await b.closeAll();
    const pid2 = Number(fs.readFileSync(pids[1]!, 'utf8'));
    await waitFor(() => !alive(pid2));
    // closed: later uses refuse, nothing respawns
    expect((await t.call('echo', {}, { signal: new AbortController().signal, deadline: Date.now() + 5_000 })).isError).toBe(true);
    expect(spawned).toBe(2);
  }, 30_000);

  it('an `enabled` server: annotations ignored (all mutate) and no resource read', async () => {
    const pool = new LocalMcpPool({ servers: [server({ trust: 'enabled' })], repo: '/r', spawn: () => spawnFake() });
    const ix = await pool.index();
    expect(new Set(ix.entries.map((e) => e.class))).toEqual(new Set(['mutate']));
    await pool.closeAll();
  }, 20_000);

  it('notifications/tools/list_changed re-lists (and re-reads annotations) and reports the new entries', async () => {
    const changes: string[][] = [];
    const pool = new LocalMcpPool({ servers: [server()], repo: '/r', spawn: () => spawnFake(), onChanged: (_l, es) => changes.push(es.map((e) => e.name)) });
    await pool.index();
    const t = pool.target('fake')!;
    await t.call('change', {}, { signal: new AbortController().signal, deadline: Date.now() + 10_000 });
    await waitFor(() => changes.length > 0);
    expect(changes[0]).toContain('later');
    expect(changes[0]).toContain('fam.get');
    await pool.closeAll();
  }, 20_000);

  it('a target call: abort → cancelled, deadline → timed out, crash → a failed result (the next call respawns)', async () => {
    let spawned = 0;
    const pool = new LocalMcpPool({ servers: [server()], repo: '/r', spawn: () => (spawned++, spawnFake()) });
    const t = pool.target('fake')!;
    const ctl = new AbortController();
    const p = t.call('slow', {}, { signal: ctl.signal, deadline: Date.now() + 30_000 });
    setTimeout(() => ctl.abort(), 150);
    expect(await p).toMatchObject({ why: 'cancelled', isError: true });
    expect(await t.call('slow', {}, { signal: new AbortController().signal, deadline: Date.now() + 300 })).toMatchObject({ isError: true, text: expect.stringMatching(/timed out/) });
    expect(await t.call('crash', {}, { signal: new AbortController().signal, deadline: Date.now() + 10_000 })).toMatchObject({ isError: true, text: expect.stringMatching(/server failed/) });
    expect((await t.call('echo', {}, { signal: new AbortController().signal, deadline: Date.now() + 10_000 })).isError).toBe(false);
    expect(spawned).toBe(2);
    await pool.closeAll();
  }, 30_000);
});

describe('Aegis H1/H2: launch check and server env', () => {
  it('refused launch-writable when the command, an arg, an env path segment or a PATH entry is in a root; case-folded on darwin', () => {
    const d = tmp();
    const repo = path.join(d, 'repo');
    const neutral = path.join(d, 'gnomon-home', 'mcp-cwd', 'x');
    fs.mkdirSync(path.join(repo, 'bin'), { recursive: true });
    fs.mkdirSync(neutral, { recursive: true });
    const chk = (s: LocalMcpServer, o: { sessionPath?: string; platform?: string; cwd?: string } = {}) => launchCheck([s], { roots: [repo], cwd: o.cwd ?? neutral, sessionPath: o.sessionPath ?? '/usr/bin', ...(o.platform ? { platform: o.platform } : {}) });
    expect(chk(server()).servers).toHaveLength(1);
    expect(chk(server({ command: path.join(repo, 'bin', 'srv') })).refused[0]).toMatchObject({ fit: 'launch-writable', why: expect.stringMatching(/command/) });
    expect(chk(server({ args: [path.join(repo, 'tools', 'mcp.js')] })).refused[0]!.why).toMatch(/argument/);
    expect(chk(server({ env: { PYTHONPATH: `/opt/x${path.delimiter}${path.join(repo, 'src')}` } })).refused[0]!.why).toMatch(/env PYTHONPATH/);
    expect(chk(server(), { sessionPath: `/usr/bin${path.delimiter}${path.join(repo, 'bin')}` }).refused[0]!.why).toMatch(/PATH entry/);
    expect(chk(server({ env: { PATH: path.join(repo, 'bin') } })).refused[0]!.why).toMatch(/PATH entry/);
    // a case-variant of the root (APFS folds case): still inside
    expect(chk(server({ args: [path.join(repo.toUpperCase(), '.NPMRC')] }), { platform: 'darwin' }).refused).toHaveLength(1);
    // `python -m pkg` / `go run .`: no path-like arg, and the neutral cwd keeps repo code out of reach
    expect(chk(server({ command: '/usr/bin/python3', args: ['-m', 'pkg'] })).servers).toHaveLength(1);
    // a neutral dir inside a root refuses every server
    expect(chk(server(), { cwd: path.join(repo, 'n') }).refused[0]!.why).toMatch(/neutral/);
  });

  it('the server env never carries GNOMON_* or the loop-dropped names', () => {
    const env = serverEnv({ PATH: '/bin', GNOMON_SOCK: 's', GNOMON_SESSION_KEY: 'k', GNOMON_HSID: 'h', GNOMON_X: 'x' }, { TOKEN: 't', GNOMON_Y: 'y' }, ['GNOMON_SOCK', 'GNOMON_SESSION_KEY', 'GNOMON_HSID']);
    expect(env).toEqual({ PATH: '/bin', TOKEN: 't' });
  });
});

describe('Aegis M4/M5: list_changed storms and open-time failures', () => {
  it('ten list_changed at once give one relist now and one pending (at least 2 s apart), never ten', async () => {
    let n = 0;
    const pool = new LocalMcpPool({ servers: [server()], repo: '/r', spawn: () => spawnFake(), onChanged: () => void n++ });
    await pool.index();
    await pool.target('fake')!.call('storm', {}, { signal: new AbortController().signal, deadline: Date.now() + 10_000 });
    await waitFor(() => n >= 1);
    await new Promise((r) => setTimeout(r, 500));
    expect(n).toBe(1);
    await waitFor(() => n >= 2, 6_000);
    await new Promise((r) => setTimeout(r, 2_500));
    expect(n).toBe(2);
    await pool.closeAll();
  }, 30_000);

  it('a server that fails at open is not retried by the next session for a while (failure cached)', async () => {
    const cache = new McpListCache();
    let spawned = 0;
    const mk = (): LocalMcpPool => new LocalMcpPool({ servers: [server()], repo: '/r', cache, spawn: () => (spawned++, spawn(process.execPath, ['-e', 'process.exit(2)'], { stdio: ['pipe', 'pipe', 'ignore'] })) });
    const a = await mk().index();
    expect(a.failed).toHaveLength(1);
    const b = await mk().index();
    expect(b.failed[0]!.error).toMatch(/failed recently/);
    expect(spawned).toBe(1);
  }, 20_000);
});

describe('Aegis L3 / Q7', () => {
  it('L3: gnomon, kernel and (unless first-party) paradigm labels are refused label-reserved', () => {
    const staged = { dir: '/s', snapshot: { files: [] }, repo: '/r' };
    const pool = new LocalMcpPool({ servers: [server({ id: 'a', name: 'Gnomon' }), server({ id: 'b', name: 'kernel' }), server({ id: 'c', name: 'paradigm', trust: 'trusted' }), server({ id: 'e', name: 'paradigm', trust: 'first-party' }), server({ id: 'd', name: 'paradigm', trust: 'first-party', staged })], spawn: () => spawnFake(), repo: '/r' });
    // TD-2026-10-27-833: first-party trust only with a verified staged pin
    expect(pool.refused.map((r) => [r.id, r.fit])).toEqual([['a', 'label-reserved'], ['b', 'label-reserved'], ['c', 'label-reserved'], ['e', 'pin-mismatch']]);
    expect(pool.labels).toEqual(['paradigm']);
  });

  it('Q7: known proxy packages read as a remote server on the enable card', () => {
    expect(remoteProxyOf(['-y', 'mcp-remote@0.1.2', 'https://x'])).toBe('mcp-remote');
    expect(remoteProxyOf(['@acme/mcp-proxy'])).toBe('mcp-proxy');
    expect(remoteProxyOf(['supergateway'])).toBe('supergateway');
    expect(remoteProxyOf(['my-server'])).toBeNull();
  });
});

describe('Aegis M3 (re-check): pid-reuse-safe reaping', () => {
  it('a group is killed once, when its leader closes; a closed group is never signalled again', async () => {
    const kills: number[] = [];
    const c = new McpStdioClient(spawnFake(), { killGroup: (pid) => void kills.push(pid) });
    await c.initialize();
    const pid = c.pid!;
    await expect(c.callTool('crash', {}, { deadline: Date.now() + 10_000 })).rejects.toMatchObject({ code: 'exited' });
    await c.exited;
    await waitFor(() => kills.length === 1);
    expect(kills).toEqual([pid]);
    expect(c.closed).toBe(true);
    expect(c.pid).toBeUndefined();
    c.kill();
    c.kill();
    expect(kills).toEqual([pid]);
  }, 20_000);

  it('closeAll signals only live leaders; a restarted server never re-kills the old group', async () => {
    let spawned = 0;
    const pool = new LocalMcpPool({ servers: [server()], repo: '/r', spawn: () => (spawned++, spawnFake()) });
    const t = pool.target('fake')!;
    await t.call('crash', {}, { signal: new AbortController().signal, deadline: Date.now() + 10_000 });
    expect((await t.call('echo', {}, { signal: new AbortController().signal, deadline: Date.now() + 10_000 })).isError).toBe(false);
    expect(spawned).toBe(2);
    await pool.closeAll();
    expect(pool.live).toBe(0);
  }, 20_000);
});

describe('Aegis final H1: flag, URL, home, inline and not-yet-existing forms', () => {
  const setup = () => {
    const d = tmp();
    const home = path.join(d, 'home');
    const repo = path.join(home, 'code', 'repo');
    const neutral = path.join(d, 'gnomon-home', 'sessions', 'x-mcp');
    fs.mkdirSync(repo, { recursive: true });
    fs.mkdirSync(neutral, { recursive: true });
    const chk = (s: Partial<LocalMcpServer>) => launchCheck([server(s)], { roots: [repo], cwd: neutral, sessionPath: '/usr/bin', home });
    return { d, home, repo, chk };
  };

  it('TD-2026-10-27-833: only a staged first-party server may name exactly the repo root as its last positional', () => {
    const { d, repo, chk } = setup();
    const sdir = path.join(d, 'gnomon-home', 'mcp', 'first-party', 'paradigm', '9.9.9-abc');
    fs.mkdirSync(sdir, { recursive: true });
    const entry = path.join(sdir, 'paradigm-mcp.mjs');
    fs.writeFileSync(entry, '');
    const staged = { dir: sdir, snapshot: { files: [] }, repo };
    const fp = { id: 'first-party:paradigm', name: 'paradigm', trust: 'first-party' as const, staged };
    expect(chk({ ...fp, args: [entry, repo] }).refused).toEqual([]);
    // the same launch from any other trust is refused (the repo arg is launch material for them)
    expect(chk({ args: [entry, repo] }).refused).toHaveLength(1);
    expect(chk({ ...fp, trust: 'trusted', args: [entry, repo] }).refused).toHaveLength(1);
    // a subdir of the repo, an extra arg, or an entry outside the staged dir is refused
    expect(chk({ ...fp, args: [entry, path.join(repo, 'sub')] }).refused).toHaveLength(1);
    expect(chk({ ...fp, args: [entry, repo, `--x=${repo}`] }).refused).toHaveLength(1);
    expect(chk({ ...fp, args: [path.join(repo, 'evil.mjs'), repo] }).refused).toHaveLength(1);
    // a server already refused (pin-mismatch) is listed and never launched
    expect(chk({ ...fp, refused: { fit: 'pin-mismatch', why: 'no pin' } })).toMatchObject({ servers: [], refused: [{ fit: 'pin-mismatch' }] });
  });

  it('MF1/MF2: --config=, -I<repo>, file://, ~/, $HOME/ and RUBYOPT=-r<repo> are each refused', () => {
    const { repo, chk } = setup();
    for (const args of [[`--config=${repo}/x`], [`-I${repo}`], [`file://${repo}/x`], ['~/code/repo/x'], ['$HOME/code/repo/x'], ['${HOME}/code/repo/x'], [`-javaagent:${repo}/a.jar`]]) {
      expect(chk({ args }).refused, JSON.stringify(args)).toHaveLength(1);
    }
    expect(chk({ env: { RUBYOPT: `-r${repo}/x` } }).refused[0]!.why).toMatch(/env RUBYOPT/);
    expect(chk({ env: { PERL5OPT: `-I${repo}` } }).refused).toHaveLength(1);
    expect(chk({ args: ['--port=8080', '-v'] }).servers).toHaveLength(1);
  });

  it('MF3: sh -c and node -e are refused (Gnomon cannot see what they load)', () => {
    const { chk } = setup();
    expect(chk({ command: '/bin/sh', args: ['-c', 'exec x'] }).refused[0]!.why).toMatch(/cannot see what it loads/);
    expect(chk({ command: process.execPath, args: ['-e', 'require("x")'] }).refused[0]!.why).toMatch(/inline code/);
  });

  it('MF4: a path through a symlink to the repo whose file does not exist yet is refused', () => {
    const { d, repo, chk } = setup();
    const link = path.join(d, 'link');
    fs.symlinkSync(repo, link, 'junction'); // a junction needs no privilege on Windows; posix ignores the type
    expect(chk({ args: [path.join(link, 'not-yet', 'server.js')] }).refused).toHaveLength(1);
  });

  it('backstop: a quoted form the parser misses is caught by the root text at a path boundary', () => {
    const { repo, chk } = setup();
    expect(chk({ args: [`--opts={"root":"${repo}"}`] }).refused).toHaveLength(1);
    expect(chk({ env: { CFG: `x;load=${repo}/y` } }).refused).toHaveLength(1);
    // a sibling whose name merely starts with the root's text is not inside it
    expect(chk({ args: [`${repo}-other/x`] }).servers).toHaveLength(1);
  });
});
