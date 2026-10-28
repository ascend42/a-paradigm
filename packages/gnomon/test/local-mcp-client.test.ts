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
import { launchCheck, LocalMcpPool, McpListCache, McpStdioClient, serverEnv, serverLabel, type LocalMcpServer } from '../src/kernel/local/mcp-client.js';

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

const server = (over: Partial<LocalMcpServer> = {}): LocalMcpServer => ({ id: 'user::fake', name: 'fake', transport: 'stdio', command: process.execPath, args: [FAKE], trust: 'trusted', ...over });

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

  it('index narrows with trust and the resource annotations; a cache hit spawns nothing until first call; reap on close', async () => {
    const d = tmp();
    const cache = new McpListCache();
    let spawned = 0;
    const pids: string[] = [];
    const mk = (): LocalMcpPool =>
      new LocalMcpPool({
        servers: [server()],
        repo: d,
        cache,
        spawn: () => {
          spawned++;
          const pf = path.join(d, `pid${spawned}`);
          pids.push(pf);
          return spawnFake(pf);
        },
      });
    const a = mk();
    const ix = await a.index();
    expect(spawned).toBe(1);
    const cls = Object.fromEntries(ix.entries.map((e) => [e.name, e.class]));
    expect(cls).toMatchObject({ echo: 'read', poke: 'mutate', 'fam.get': 'read', 'fam.set': 'mutate' });
    expect(ix.entries[0]!.id).toMatch(/^fake\/echo@[0-9a-f]{8}$/);
    await a.closeAll();
    const pid1 = Number(fs.readFileSync(pids[0]!, 'utf8'));
    await waitFor(() => !alive(pid1));

    // a second session in the same repo: the cached list, no spawn until a call
    const b = mk();
    await b.index();
    expect(spawned).toBe(1);
    const t = b.target('fake')!;
    let running = 0;
    const r = await t.call('echo', { text: 'x' }, { signal: new AbortController().signal, deadline: Date.now() + 10_000, onRunning: () => running++ });
    expect(r).toEqual({ text: 'echo:{"text":"x"}:1', isError: false });
    expect(spawned).toBe(2);
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
    const pool = new LocalMcpPool({ servers: [server({ id: 'a', name: 'Gnomon' }), server({ id: 'b', name: 'kernel' }), server({ id: 'c', name: 'paradigm', trust: 'trusted' }), server({ id: 'd', name: 'paradigm', trust: 'first-party' })], spawn: () => spawnFake(), repo: '/r' });
    expect(pool.refused.map((r) => [r.id, r.fit])).toEqual([['a', 'label-reserved'], ['b', 'label-reserved'], ['c', 'label-reserved']]);
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
