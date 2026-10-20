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
  it('S0b: one server per mod, gm_<pub>_<name> (≤ 28) else gx_<name[0..13]>_<hash10>; repo servers come first', () => {
    const r = mergeDeskMcp({ github: { command: 'gh-mcp' } }, [deskMod('neurons'), deskMod('constellation')]);
    expect(Object.keys(r.servers)).toEqual(['github', 'gm_acme_constellation', 'gm_acme_neurons']);
    expect(r.servers['gm_acme_neurons']).toEqual({ type: 'stdio', command: '/usr/local/bin/npx', args: ['neurons-server'] });
    expect(serverNameOf('gnomon.neurons')).toBe('gm_gnomon_neurons');
    expect(serverNameOf('gnomon.constellation')).toBe('gm_gnomon_constellation');
    // '-' is never turned into '_'
    expect(serverNameOf('my-co.diff-lens')).toBe('gm_my-co_diff-lens');
    // exactly 28 stays gm_; 29 falls back to gx_ with a 10-char lowercase base32 hash of the id
    const at28 = `acme.${'n'.repeat(28 - 'gm_acme_'.length)}`;
    expect(serverNameOf(at28)).toHaveLength(28);
    expect(serverNameOf(at28).startsWith('gm_')).toBe(true);
    const long = `acme.${'n'.repeat(29 - 'gm_acme_'.length)}`;
    expect(serverNameOf(long)).toMatch(/^gx_n{13}_[a-z2-7]{10}$/);
    // the fallback is stable, and two ids sharing the 13-char name prefix still differ by the hash
    expect(serverNameOf(long)).toBe(serverNameOf(long));
    expect(serverNameOf(`acme.${'n'.repeat(22)}`)).not.toBe(serverNameOf(`acmf.${'n'.repeat(22)}`));
  });

  it('H1a: a repo server using a reserved desk prefix (gnomon-, gm_, gx_) is dropped; the mod\'s own server is added', () => {
    const repo = { 'gnomon-neurons': { command: 'repo-owned' }, gm_acme_neurons: { command: 'a' }, gx_z: { command: 'b' }, github: { command: 'gh' } };
    const r = mergeDeskMcp(repo, [deskMod('neurons')]);
    expect(r.dropped).toEqual(['gnomon-neurons', 'gm_acme_neurons', 'gx_z']);
    expect(Object.keys(r.servers)).toEqual(['github', 'gm_acme_neurons']);
    expect(r.servers['gm_acme_neurons']).toMatchObject({ command: '/usr/local/bin/npx' });
    expect(repoServersOnly(repo)).toEqual({ servers: { github: { command: 'gh' } }, dropped: ['gnomon-neurons', 'gm_acme_neurons', 'gx_z'] });
    for (const n of ['gnomon-a', 'gm_a', 'gx_a']) expect(isReservedDeskName(n)).toBe(true);
    expect(isReservedDeskName('github')).toBe(false);
    // two mods deriving the same name: the later is skipped, never overriding
    expect(mergeDeskMcp({}, [deskMod('a'), deskMod('a')]).skipped).toEqual([{ mod: 'acme.a', server: 'gm_acme_a', why: 'name-taken' }]);
  });

  it('S0b regression: the verified generated distro server (gm_<pub>_<distro>) reaches the session; reserved repo names are still dropped; a mod still wins its own name', () => {
    // the session base is the kernel-generated, record-verified .gnomon/generated/.mcp.json (supervisor.ts), whose
    // server is named mcpServerName(`${publisher}.${name}`) by renderGenerated: e.g. gm_gnomon_paradigm-distro
    const distro = { 'gm_gnomon_paradigm-distro': { command: 'paradigm-mcp', args: ['.'] } };
    const r = mergeDeskMcp({}, [deskMod('neurons')], { distro });
    expect(r.servers['gm_gnomon_paradigm-distro']).toEqual({ command: 'paradigm-mcp', args: ['.'] });
    expect(r.dropped).toEqual([]);
    expect(r.added.map((a) => a.server)).toEqual(['gm_acme_neurons']); // a distro server never counts as a desk server (H1b)
    expect(repoServersOnly({}, distro).servers).toEqual(distro);
    // H1 kept: a repo-authored reserved name is dropped even when a distro is present
    const repo = { gm_acme_neurons: { command: 'planted' }, github: { command: 'gh' } };
    const r2 = mergeDeskMcp(repo, [deskMod('neurons')], { distro });
    expect(r2.dropped).toEqual(['gm_acme_neurons']);
    expect(r2.servers['gm_acme_neurons']).toMatchObject({ command: '/usr/local/bin/npx' });
    // a distro entry that would take an installed mod's server name is displaced by the mod (never the reverse)
    const r3 = mergeDeskMcp({}, [deskMod('neurons')], { distro: { gm_acme_neurons: { command: 'distro-claims-it' } } });
    expect(r3.servers['gm_acme_neurons']).toMatchObject({ command: '/usr/local/bin/npx' });
    expect(r3.shadowed).toEqual(['gm_acme_neurons']);
    expect(r3.added.map((a) => a.server)).toEqual(['gm_acme_neurons']);
  });

  it('fails closed on a non-absolute resolved command (needs-config); an absolute override makes it launch', () => {
    const m = deskMod('constellation', { config: { command: true, args: true } });
    m.manifest.provides!.mcp![0]!.command = 'constellation-mcp';
    const r = mergeDeskMcp({}, [m]);
    expect(r.servers).toEqual({});
    expect(r.skipped).toEqual([{ mod: 'acme.constellation', server: 'gm_acme_constellation', why: 'needs-config' }]);
    const ok = mergeDeskMcp({}, [m], { overrides: { 'acme.constellation': { command: ABS, args: ['/src/a-constellation/mcp.js'] } } });
    expect(ok.servers['gm_acme_constellation']).toEqual({ type: 'stdio', command: ABS, args: ['/src/a-constellation/mcp.js'] });
    expect(mergeDeskMcp({}, [m], { overrides: { 'acme.constellation': { command: 'node' } } }).servers).toEqual({});
    for (const c of ['/usr/bin/node', 'C:\\Program Files\\node.exe', 'D:/node.exe']) expect(isAbsoluteCommand(c), c).toBe(true);
    for (const c of ['node', 'neurons', '//host/share/x', '\\\\host\\share\\x', './x', 'C:node']) expect(isAbsoluteCommand(c), c).toBe(false);
  });

  it('skips a repo-muted mod', () => {
    const r = mergeDeskMcp({}, [deskMod('neurons'), deskMod('constellation')], { repoMuted: (m) => m === 'acme.neurons' });
    expect(Object.keys(r.servers)).toEqual(['gm_acme_constellation']);
    expect(r.skipped).toEqual([{ mod: 'acme.neurons', why: 'repo-muted' }]);
  });

  it('the override is honoured only for what the author declared, and an overridden command must be absolute', () => {
    const declared = deskMod('neurons', { config: { command: true, args: true, env: ['NEURONS_VAULT'] } });
    const plain = deskMod('constellation');
    const overrides = { 'acme.neurons': { command: ABS, args: ['/src/a-neurons/dist/mcp.js'], env: { NEURONS_VAULT: '/v' } }, 'acme.constellation': { command: ABS } };
    const r = mergeDeskMcp({}, [declared, plain], { overrides });
    expect(r.servers['gm_acme_neurons']).toEqual({ type: 'stdio', command: ABS, args: ['/src/a-neurons/dist/mcp.js'], env: { NEURONS_VAULT: '/v' } });
    expect(r.servers['gm_acme_constellation']).toEqual({ type: 'stdio', command: '/usr/local/bin/npx', args: ['constellation-server'] }); // undeclared ⇒ ignored
    expect(r.added.find((a) => a.mod === 'acme.neurons')!.overridden).toBe(true);
    expect(r.added.find((a) => a.mod === 'acme.constellation')!.overridden).toBe(false);
    const entry = declared.manifest.provides!.mcp![0]!;
    expect(() => checkMcpOverride(entry, { command: 'node' })).toThrow(/absolute/);
    expect(() => checkMcpOverride(entry, { env: { PATH: '/x' } })).toThrow();
    expect(() => checkMcpOverride(entry, { env: { OTHER: '1' } })).toThrow();
    // a relative command in the store is ignored (fail closed to the manifest's launch)
    const rel = mergeDeskMcp({}, [declared], { overrides: { 'acme.neurons': { command: 'node' } } });
    expect(rel.servers['gm_acme_neurons']).toMatchObject({ command: '/usr/local/bin/npx' });
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
    expect(launchCardLines('acme.neurons', 'gm_acme_neurons', { command: ABS, args: ['a'], env: {} }, KEY).join('\n')).not.toContain('…');
  });
});

describe('#mcp-passthrough: the override store (kernel state, human card)', () => {
  it('lives under the Gnomon home only, 0600; a malformed store reads as empty', () => {
    const home = tmpHome();
    expect(readMcpOverrides(home)).toEqual({});
    writeMcpOverride(home, 'acme.neurons', { command: ABS });
    expect(mcpOverridesPath(home).startsWith(home)).toBe(true);
    expect(readMcpOverrides(home)).toEqual({ 'acme.neurons': { command: ABS } });
    writeMcpOverride(home, 'acme.neurons', null);
    expect(readMcpOverrides(home)).toEqual({});
    fs.writeFileSync(mcpOverridesPath(home), '{"schema":"other","mods":{}}');
    expect(readMcpOverrides(home)).toEqual({});
  });

  it('a request raises a grant card with command, args and env NAMES (never values) and the launch hash; only allow writes', async () => {
    const home = tmpHome();
    const mod = deskMod('neurons', { config: { command: true, args: true, env: ['NEURONS_TOKEN'] } });
    expect(() => requestMcpConfig(home, deskMod('constellation'), { command: ABS })).toThrow();
    requestMcpConfig(home, mod, { command: ABS, args: ['/src/mcp.js'], env: { NEURONS_TOKEN: 's3cret-value' } });
    expect(readMcpConfigRequest(home, 'acme.neurons')).toMatchObject({ config: { command: ABS } });
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
    expect(readMcpOverrides(home)).toEqual({ 'acme.neurons': { command: ABS, args: ['/src/mcp.js'], env: { NEURONS_TOKEN: 's3cret-value' } } });
    expect(readMcpConfigRequest(home, 'acme.neurons')).toBeNull();
  });

  it('deny drops the request and writes nothing; a request the manifest no longer allows is dropped without a card', async () => {
    const home = tmpHome();
    const mod = deskMod('neurons', { config: { command: true } });
    requestMcpConfig(home, mod, { command: ABS });
    const raised: Array<{ effect: (d: string) => Promise<void> }> = [];
    const broker = { raise: async (i: { effect: (d: string) => Promise<void> }) => (raised.push(i), { cardId: 'card:y' } as never), card: () => undefined };
    await new McpConfigCards({ home, broker: broker as never, mods: () => [mod], requestedBy: 'p:abcdefgh/cli', launchKey: KEY }).scan();
    await raised[0]!.effect('deny');
    expect(readMcpOverrides(home)).toEqual({});
    requestMcpConfig(home, mod, { command: ABS });
    const narrowed = deskMod('neurons');
    await new McpConfigCards({ home, broker: broker as never, mods: () => [narrowed], requestedBy: 'p:abcdefgh/cli', launchKey: KEY }).scan();
    expect(raised).toHaveLength(1);
    expect(readMcpConfigRequest(home, 'acme.neurons')).toBeNull();
  });
});
