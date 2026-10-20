/**
 * #mcp-passthrough (TD-2026-10-20-812 A2, S1, Aegis D2): namespacing, never shadowing a repo server, repo-muted
 * skip, and the per-user launch override honoured only when the author declared it, through a human card, kept in
 * kernel state only.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  McpConfigCards,
  checkMcpOverride,
  deskLaunchKey,
  isAbsoluteCommand,
  isReservedDeskName,
  repoServersOnly,
  launchCardLines,
  launchHashOf,
  mcpOverridesPath,
  mergeDeskMcp,
  readMcpConfigRequest,
  readMcpOverrides,
  requestMcpConfig,
  serverNameOf,
  writeMcpOverride,
} from '../src/kernel/desk/mcp-passthrough.js';
import { deskMod } from './desk-fixtures.js';

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) fs.rmSync(h, { recursive: true, force: true });
});
function tmpHome(): string {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-desk-'));
  homes.push(h);
  return h;
}
const ABS = '/opt/node/bin/node';
const KEY = Buffer.alloc(32, 7);

describe('#mcp-passthrough: merge', () => {
  it('namespaces gnomon-<mod> (and gnomon-<mod>-<entry> for extra entries); repo servers come first', () => {
    const r = mergeDeskMcp({ github: { command: 'gh-mcp' } }, [deskMod('neurons'), deskMod('constellation', { entries: ['constellation', 'board'] })]);
    expect(Object.keys(r.servers)).toEqual(['github', 'gnomon-constellation', 'gnomon-constellation-board', 'gnomon-neurons']);
    expect(r.servers['gnomon-neurons']).toEqual({ type: 'stdio', command: '/usr/local/bin/npx', args: ['neurons-server'] });
    expect(serverNameOf('solo', { command: 'x' })).toBe('gnomon-solo-other');
    expect(serverNameOf('neurons', { command: 'x' })).toBe('gnomon-neurons-brain');
    expect(serverNameOf('constellation', { command: 'x' })).toBe('gnomon-constellation');
  });

  it('H1a: a repo server using a reserved desk prefix (gnomon-, gm_, gx_) is dropped; the mod\'s own server is added', () => {
    const repo = { 'gnomon-neurons': { command: 'repo-owned' }, gm_x_y: { command: 'a' }, gx_z: { command: 'b' }, github: { command: 'gh' } };
    const r = mergeDeskMcp(repo, [deskMod('neurons')]);
    expect(r.dropped).toEqual(['gnomon-neurons', 'gm_x_y', 'gx_z']);
    expect(Object.keys(r.servers)).toEqual(['github', 'gnomon-neurons']);
    expect(r.servers['gnomon-neurons']).toMatchObject({ command: '/usr/local/bin/npx' });
    expect(repoServersOnly(repo)).toEqual({ servers: { github: { command: 'gh' } }, dropped: ['gnomon-neurons', 'gm_x_y', 'gx_z'] });
    for (const n of ['gnomon-a', 'gm_a', 'gx_a']) expect(isReservedDeskName(n)).toBe(true);
    expect(isReservedDeskName('github')).toBe(false);
    // two mods deriving the same name: the later is skipped, never overriding
    const a = deskMod('a', { entries: ['b-x'] });
    const b = deskMod('a-b', { entries: ['x'] });
    expect(mergeDeskMcp({}, [a, b]).skipped).toEqual([{ mod: 'a-b', server: 'gnomon-a-b-x', why: 'name-taken' }]);
  });

  it('fails closed on a non-absolute resolved command (needs-config); an absolute override makes it launch', () => {
    const m = deskMod('constellation', { entries: ['gnomon-constellation'], config: { command: true, args: true } });
    m.manifest.provides!.mcp![0]!.command = 'constellation-mcp';
    const r = mergeDeskMcp({}, [m]);
    expect(r.servers).toEqual({});
    expect(r.skipped).toEqual([{ mod: 'constellation', server: 'gnomon-constellation', why: 'needs-config' }]);
    const ok = mergeDeskMcp({}, [m], { overrides: { constellation: { 'gnomon-constellation': { command: ABS, args: ['/src/a-constellation/mcp.js'] } } } });
    expect(ok.servers['gnomon-constellation']).toEqual({ type: 'stdio', command: ABS, args: ['/src/a-constellation/mcp.js'] });
    expect(mergeDeskMcp({}, [m], { overrides: { constellation: { 'gnomon-constellation': { command: 'node' } } } }).servers).toEqual({});
    for (const c of ['/usr/bin/node', 'C:\\Program Files\\node.exe', 'D:/node.exe']) expect(isAbsoluteCommand(c), c).toBe(true);
    for (const c of ['node', 'neurons', '//host/share/x', '\\\\host\\share\\x', './x', 'C:node']) expect(isAbsoluteCommand(c), c).toBe(false);
  });

  it('skips a repo-muted mod', () => {
    const r = mergeDeskMcp({}, [deskMod('neurons'), deskMod('constellation')], { repoMuted: (m) => m === 'neurons' });
    expect(Object.keys(r.servers)).toEqual(['gnomon-constellation']);
    expect(r.skipped).toEqual([{ mod: 'neurons', why: 'repo-muted' }]);
  });

  it('the override is honoured only for what the author declared, and an overridden command must be absolute', () => {
    const declared = deskMod('neurons', { config: { command: true, args: true, env: ['NEURONS_VAULT'] } });
    const plain = deskMod('constellation');
    const overrides = { neurons: { neurons: { command: ABS, args: ['/src/a-neurons/dist/mcp.js'], env: { NEURONS_VAULT: '/v' } } }, constellation: { constellation: { command: ABS } } };
    const r = mergeDeskMcp({}, [declared, plain], { overrides });
    expect(r.servers['gnomon-neurons']).toEqual({ type: 'stdio', command: ABS, args: ['/src/a-neurons/dist/mcp.js'], env: { NEURONS_VAULT: '/v' } });
    expect(r.servers['gnomon-constellation']).toEqual({ type: 'stdio', command: '/usr/local/bin/npx', args: ['constellation-server'] }); // undeclared ⇒ ignored
    expect(r.added.find((a) => a.mod === 'neurons')!.overridden).toBe(true);
    expect(r.added.find((a) => a.mod === 'constellation')!.overridden).toBe(false);
    const entry = declared.manifest.provides!.mcp![0]!;
    expect(() => checkMcpOverride(entry, { command: 'node' })).toThrow(/absolute/);
    expect(() => checkMcpOverride(entry, { env: { PATH: '/x' } })).toThrow();
    expect(() => checkMcpOverride(entry, { env: { OTHER: '1' } })).toThrow();
    // a relative command in the store is ignored (fail closed to the manifest's launch)
    const rel = mergeDeskMcp({}, [declared], { overrides: { neurons: { neurons: { command: 'node' } } } });
    expect(rel.servers['gnomon-neurons']).toMatchObject({ command: '/usr/local/bin/npx' });
  });
});

describe('#mcp-passthrough: Aegis S1 M2 / L6', () => {
  it('the launch hash is an HMAC under the kernel key (another key, another hash)', () => {
    const l = { command: ABS, args: [], env: { A_TOKEN: 'v' } };
    expect(launchHashOf(l, KEY)).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
    expect(launchHashOf(l, Buffer.alloc(32, 8))).not.toBe(launchHashOf(l, KEY));
    const home = tmpHome();
    expect(deskLaunchKey(home).equals(deskLaunchKey(home))).toBe(true);
  });

  it('refuses a secret-marked env name, a non-.exe command on win32, and args the card would truncate', () => {
    const m = deskMod('neurons', { config: { command: true, args: true, env: ['NEURONS_TOKEN', 'NEURONS_VAULT'] } });
    const entry = m.manifest.provides!.mcp![0]!;
    (entry.config as { secret?: string[] }).secret = ['NEURONS_TOKEN'];
    expect(() => checkMcpOverride(entry, { env: { NEURONS_TOKEN: 'x' } })).toThrow(/secret/);
    expect(checkMcpOverride(entry, { env: { NEURONS_VAULT: '/v' } })).toEqual({ env: { NEURONS_VAULT: '/v' } });
    expect(() => checkMcpOverride(entry, { command: 'C:\\tools\\node.cmd' }, 'win32')).toThrow(/\.exe/);
    expect(checkMcpOverride(entry, { command: 'C:\\tools\\node.exe' }, 'win32')).toEqual({ command: 'C:\\tools\\node.exe' });
    expect(() => checkMcpOverride(entry, { args: ['x'.repeat(301)] })).toThrow(/card/);
    expect(launchCardLines('neurons', 'gnomon-neurons', { command: ABS, args: ['a'], env: {} }, KEY).join('\n')).not.toContain('…');
  });
});

describe('#mcp-passthrough: the override store (kernel state, human card)', () => {
  it('lives under the Gnomon home only, 0600; a malformed store reads as empty', () => {
    const home = tmpHome();
    expect(readMcpOverrides(home)).toEqual({});
    writeMcpOverride(home, 'neurons', 'neurons', { command: ABS });
    expect(mcpOverridesPath(home).startsWith(home)).toBe(true);
    expect(readMcpOverrides(home)).toEqual({ neurons: { neurons: { command: ABS } } });
    writeMcpOverride(home, 'neurons', 'neurons', null);
    expect(readMcpOverrides(home)).toEqual({});
    fs.writeFileSync(mcpOverridesPath(home), '{"schema":"other","mods":{}}');
    expect(readMcpOverrides(home)).toEqual({});
  });

  it('a request raises a grant card with command, args and env NAMES (never values) and the launch hash; only allow writes', async () => {
    const home = tmpHome();
    const mod = deskMod('neurons', { config: { command: true, args: true, env: ['NEURONS_TOKEN'] } });
    expect(() => requestMcpConfig(home, deskMod('constellation'), 'constellation', { command: ABS })).toThrow();
    requestMcpConfig(home, mod, 'neurons', { command: ABS, args: ['/src/mcp.js'], env: { NEURONS_TOKEN: 's3cret-value' } });
    expect(readMcpConfigRequest(home, 'neurons')).toMatchObject({ server: 'neurons' });
    const raised: Array<{ lines: string[]; kind: string; effect: (d: string) => Promise<void> }> = [];
    const broker = {
      raise: async (input: { lines: string[]; kind: string; effect: (d: string) => Promise<void> }) => {
        raised.push(input);
        return { cardId: 'card:x', state: 'pending' } as never;
      },
      card: () => ({ state: 'pending' }) as never,
    };
    const cards = new McpConfigCards({ home, broker: broker as never, mods: () => [mod], requestedBy: 'p:abcdefgh/cli', launchKey: KEY });
    await cards.scan();
    await cards.scan(); // not raised twice
    expect(raised).toHaveLength(1);
    expect(raised[0]!.kind).toBe('grant');
    const text = raised[0]!.lines.join('\n');
    expect(text).toContain(`command ${ABS}`);
    expect(text).toContain('args /src/mcp.js');
    expect(text).toContain('env names NEURONS_TOKEN');
    expect(text).not.toContain('s3cret-value');
    expect(text).toContain(launchHashOf({ command: ABS, args: ['/src/mcp.js'], env: { NEURONS_TOKEN: 's3cret-value' } }, KEY));
    expect(text).toContain("env values are written to this session's mcp.json and readable by the session");
    expect(text).toContain('requested by: a request file under the Gnomon home');
    expect(readMcpOverrides(home)).toEqual({});
    await raised[0]!.effect('allow');
    expect(readMcpOverrides(home)).toEqual({ neurons: { neurons: { command: ABS, args: ['/src/mcp.js'], env: { NEURONS_TOKEN: 's3cret-value' } } } });
    expect(readMcpConfigRequest(home, 'neurons')).toBeNull();
  });

  it('deny drops the request and writes nothing; a request the manifest no longer allows is dropped without a card', async () => {
    const home = tmpHome();
    const mod = deskMod('neurons', { config: { command: true } });
    requestMcpConfig(home, mod, 'neurons', { command: ABS });
    const raised: Array<{ effect: (d: string) => Promise<void> }> = [];
    const broker = { raise: async (i: { effect: (d: string) => Promise<void> }) => (raised.push(i), { cardId: 'card:y' } as never), card: () => undefined };
    await new McpConfigCards({ home, broker: broker as never, mods: () => [mod], requestedBy: 'p:abcdefgh/cli', launchKey: KEY }).scan();
    await raised[0]!.effect('deny');
    expect(readMcpOverrides(home)).toEqual({});
    requestMcpConfig(home, mod, 'neurons', { command: ABS });
    const narrowed = deskMod('neurons');
    await new McpConfigCards({ home, broker: broker as never, mods: () => [narrowed], requestedBy: 'p:abcdefgh/cli', launchKey: KEY }).scan();
    expect(raised).toHaveLength(1);
    expect(readMcpConfigRequest(home, 'neurons')).toBeNull();
  });
});
