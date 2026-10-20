/**
 * #manifest-loader, the Desk (TD-2026-10-20-812): provides.offers (offer-spec:v1, at most six, reach through the
 * mod's MCP server) is validated and is a widening field; a provides.mcp entry may declare a closed per-user override
 * surface (`config`), and validateMcpUserConfig admits only what it declares. Install cards show both.
 */
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEV_TEST_ROOT_ACK, DevTestRootAuthority } from '../src/kernel/identity/root-authority.js';
import { blockFor } from '../src/kernel/manifest/install.js';
import {
  detectWidening,
  MCP_ENV_DENY,
  MCP_ENV_DENY_PREFIXES,
  MANIFEST_FILE,
  ManifestRefusal,
  removeTree,
  resolveMcpLaunch,
  stageInstall,
  validateManifest,
  validateMcpUserConfig,
  WIDENING_FIELDS,
  type ManifestMcp,
  type ManifestV1,
} from '../src/kernel/manifest/index.js';

const tmps: string[] = [];
afterEach(() => {
  while (tmps.length) removeTree(tmps.pop()!);
});
const tmp = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-offers-'));
  tmps.push(d);
  return d;
};

const OFFER = {
  kind: 'map-the-idea',
  phase: 'diverge',
  title: 'Map it on the board',
  summary: 'Lays the ideas of this conversation out as a constellation.',
  contextIn: ['recent-messages'],
  resultOut: 'board',
  reach: 'mcp',
  handoffTool: 'constellation_open',
  related: [],
  restraint: 'Not while the human is debugging.',
} as const;
const MCP: ManifestMcp = { name: 'constellation', command: 'node', args: ['server.js'], config: { args: true, env: ['STARBOARD_HOME'] } };

function mod(over: Partial<NonNullable<ManifestV1['provides']>> = {}): ManifestV1 {
  return { manifest: 1, kind: 'mod', name: 'starboard', version: '1.0.0', abi: 'mod-abi:v1', provides: { mcp: [MCP], offers: [{ ...OFFER, contextIn: [...OFFER.contextIn], related: [] }], ...over } } as ManifestV1;
}
const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ManifestRefusal) return e.manifestCode;
    throw e;
  }
  return 'none';
};
const v = (m: unknown) => validateManifest(m, { tier: 'local' });

describe('provides.offers (offer-spec:v1)', () => {
  it('a mod with an MCP server and offers validates', () => {
    expect(v(mod()).provides?.offers?.[0]?.kind).toBe('map-the-idea');
  });
  it('refuses a malformed offer, a duplicate kind, more than six, and offers with no MCP server', () => {
    expect(code(() => v(mod({ offers: [{ ...OFFER, phase: 'later' } as never] })))).toBe('SCHEMA');
    expect(code(() => v(mod({ offers: [{ ...OFFER, prompt: 'x' } as never] })))).toBe('SCHEMA');
    expect(code(() => v(mod({ offers: [OFFER, OFFER] as never })))).toBe('SCHEMA');
    const seven = Array.from({ length: 7 }, (_, i) => ({ ...OFFER, kind: `o${i}` }));
    expect(code(() => v(mod({ offers: seven as never })))).toBe('SCHEMA');
    expect(code(() => v(mod({ mcp: [] })))).toBe('SCHEMA');
    expect(code(() => v(mod({ offers: 'all' as never })))).toBe('SCHEMA');
    expect(code(() => v(mod({ offers: [{ ...OFFER, contextIn: ['secrets'] }] as never })))).toBe('SCHEMA');
  });
  it.each(['kernel', 'gnomon', 'system', 'paradigm', 'claude', 'anthropic', 'desk', 'mod', 'mods', 'mcp', 'core', 'builtin', 'admin', 'root', 'human', 'user', 'local', 'first-party'])('the mod name %s is reserved at every tier (NAME)', (name) => {
    expect(code(() => v({ ...mod(), name }))).toBe('NAME');
    expect(code(() => validateManifest({ ...mod(), name }, { tier: 'first-party' }))).toBe('NAME');
  });
  it.each(['neurons', 'constellation', 'paradigm-context', 'workshop', 'ledger', 'gnomon-x', 'paradigm-x', 'claude-x', 'anthropic-x'])('L5: %s is first-party only', (name) => {
    const m = { ...mod({ mcp: [{ name: 'srv', command: 'node' }] }), name };
    expect(code(() => v(m))).toBe('NAME');
    // 'neurons' is also a §9.1 userland namespace (neurons.event), so KERNEL_NAMESPACE_TOKENS refuses it at every tier
    expect(code(() => validateManifest(m, { tier: 'first-party' }))).toBe(name === 'neurons' ? 'NAME' : 'none');
  });
  it('offers is a widening field: a new offer, or a changed handoff, is an addition', () => {
    expect(WIDENING_FIELDS).toContain('offers');
    const a = mod();
    expect(detectWidening(a, a)).toEqual([]);
    const b = mod({ offers: [OFFER, { ...OFFER, kind: 'cluster-themes', phase: 'synthesize' }] as never });
    expect(detectWidening(a, b)).toEqual([{ field: 'offers', added: ['cluster-themes:in:recent-messages', 'cluster-themes@synthesize→constellation_open'] }]);
    const c = mod({ offers: [{ ...OFFER, handoffTool: 'constellation_write' }] as never });
    expect(detectWidening(a, c).map((w) => w.field)).toEqual(['offers']);
    // M2: adding a contextIn source widens (a data-flow grant)
    expect(detectWidening(a, mod({ offers: [{ ...OFFER, contextIn: ['recent-messages', 'selection'] }] as never }))).toEqual([{ field: 'offers', added: ['map-the-idea:in:selection'] }]);
    // a text-only change (title) is not a widening
    expect(detectWidening(a, mod({ offers: [{ ...OFFER, title: 'Map it' }] as never }))).toEqual([]);
  });
  it('the install card shows one line per offer and the mcp override surface', () => {
    const home = tmp();
    const src = path.join(tmp(), 'starboard');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, MANIFEST_FILE), JSON.stringify(mod()));
    fs.writeFileSync(path.join(src, 'server.js'), '// server\n');
    const st = stageInstall({ home, source: src, via: 'package', requestedBy: 'p:abcdefgh/matt', trust: new DevTestRootAuthority(DEV_TEST_ROOT_ACK) });
    if (st.state !== 'staged') throw new Error('expected staged');
    expect(st.record.detail.offers).toEqual(['map-the-idea (diverge) → constellation_open: Map it on the board · takes: recent-messages']);
    expect(st.record.detail.mcp).toEqual(["constellation: node server.js · user may set: args; env STARBOARD_HOME · env values are written to this session's mcp.json and readable by the session"]);
    const lines = (blockFor(st.record.detail).block.children as Array<{ text: string }>).map((c) => c.text);
    expect(lines).toContain('offer: map-the-idea (diverge) → constellation_open: Map it on the board · takes: recent-messages');
    // the long line may wrap on the card (INSTALL_CONTINUATION); its start and the env note both show
    expect(lines.some((l) => l.startsWith('mcp: constellation: node server.js · user may set: args; env STARBOARD_HOME'))).toBe(true);
    expect(lines.join(' ')).toContain('readable by the session');
  });
  it('a manifest without offers has no offers detail (pre-812 cards hash the same)', () => {
    const home = tmp();
    const src = path.join(tmp(), 'plain');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, MANIFEST_FILE), JSON.stringify({ manifest: 1, kind: 'mod', name: 'plain', version: '1.0.0', abi: 'mod-abi:v1', provides: { mcp: [{ name: 'p', command: 'node', args: ['p.js'] }] } }));
    const st = stageInstall({ home, source: src, via: 'package', requestedBy: 'p:abcdefgh/matt', trust: new DevTestRootAuthority(DEV_TEST_ROOT_ACK) });
    if (st.state !== 'staged') throw new Error('expected staged');
    expect('offers' in st.record.detail).toBe(false);
    expect(st.record.detail.mcp).toEqual(['p: node p.js']);
  });
});

describe('provides.mcp per-user config override', () => {
  it('the manifest config is closed: true-only flags, safe env names, no launch-critical name', () => {
    expect(code(() => v(mod({ mcp: [{ ...MCP, config: { command: 'yes' } as never }] })))).toBe('SCHEMA');
    expect(code(() => v(mod({ mcp: [{ ...MCP, config: { cwd: true } as never }] })))).toBe('SCHEMA');
    for (const bad of ['PATH', 'NODE_OPTIONS', 'DYLD_INSERT_LIBRARIES', 'ANTHROPIC_API_KEY', 'lower', 'GNOMON_HOME']) {
      expect(code(() => v(mod({ mcp: [{ ...MCP, config: { env: [bad] } }] }))), bad).toBe('SCHEMA');
    }
  });
  it('M1: every denylisted exact name and every prefix family is refused, even at the first-party tier', () => {
    const fp = (env: string[]) => code(() => validateManifest(mod({ mcp: [{ ...MCP, config: { env } }] }), { tier: 'first-party' }));
    expect(fp(['OTHER_HOME'])).toBe('none');
    for (const n of MCP_ENV_DENY) expect(fp([n]), n).toBe('SCHEMA');
    for (const p of MCP_ENV_DENY_PREFIXES) expect(fp([`${p}X`.replace(/__+/g, '_')]), p).toBe('SCHEMA');
    for (const n of ['GOPROXY', 'GOFLAGS', 'HTTPS_PROXY', 'NO_PROXY', 'PYTHONPATH', 'RUSTFLAGS', 'BASH_ENV', 'NODE_OPTIONS', 'SSL_CERT_FILE', 'XDG_CONFIG_HOME', 'PATHEXT', 'COMSPEC']) expect(fp([n]), n).toBe('SCHEMA');
    expect(fp(['GOOGLE_API_KEY'])).toBe('none'); // no bare GO prefix
  });
  it('M1: below first-party a declared name is the mod own prefix or a credential', () => {
    const local = (env: string[]) => code(() => v(mod({ mcp: [{ ...MCP, config: { env } }] })));
    expect(local(['STARBOARD_HOME', 'OPENAI_API_KEY', 'NOTION_TOKEN'])).toBe('none');
    expect(local(['OTHER_HOME'])).toBe('SCHEMA');
    expect(local(['STARBOARDX'])).toBe('SCHEMA');
    expect(code(() => v(mod({ mcp: [{ ...MCP, config: { env: ['A', 'A'] } }] })))).toBe('SCHEMA');
  });
  it('a config change is a widening of mcp; an entry without config keeps its old key', () => {
    const plain = mod({ mcp: [{ name: 'constellation', command: 'node', args: ['server.js'] }] });
    expect(detectWidening(plain, mod()).map((w) => w.field)).toEqual(['mcp']);
    expect(detectWidening(plain, plain)).toEqual([]);
  });
  it('the user override admits only what the entry declares', () => {
    expect(validateMcpUserConfig(MCP, { args: ['/Users/me/constellation/dist/server.js'], env: { STARBOARD_HOME: '/Users/me/.starboard' } })).toEqual({
      args: ['/Users/me/constellation/dist/server.js'],
      env: { STARBOARD_HOME: '/Users/me/.starboard' },
    });
    // L4: a user-set command is an absolute path only
    const withCmd = { ...MCP, config: { command: true as const } };
    expect(validateMcpUserConfig(withCmd, { command: '/opt/homebrew/bin/node' })).toEqual({ command: '/opt/homebrew/bin/node' });
    expect(validateMcpUserConfig(withCmd, { command: 'C:\\Program Files\\nodejs\\node.exe' }).command).toBe('C:\\Program Files\\nodejs\\node.exe');
    for (const c of ['node', './node', '//host/node', 'bin/node']) expect(code(() => validateMcpUserConfig(withCmd, { command: c })), c).toBe('SCHEMA');
    expect(code(() => validateMcpUserConfig(MCP, { command: '/usr/bin/env' }))).toBe('SCHEMA'); // command not declared
    expect(code(() => validateMcpUserConfig(MCP, { env: { PATH: '/tmp' } }))).toBe('SCHEMA');
    expect(code(() => validateMcpUserConfig(MCP, { env: { OTHER: 'x' } }))).toBe('SCHEMA');
    expect(code(() => validateMcpUserConfig(MCP, { args: ['a\nb'] }))).toBe('SCHEMA');
    expect(code(() => validateMcpUserConfig(MCP, { args: ['ok'], cwd: '/' }))).toBe('SCHEMA');
    expect(code(() => validateMcpUserConfig({ ...MCP, config: { command: true } }, { command: 'node‮' }))).toBe('SCHEMA');
  });
  it('resolveMcpLaunch applies the override over the manifest launch', () => {
    expect(resolveMcpLaunch(MCP)).toEqual({ command: 'node', args: ['server.js'], env: {} });
    expect(resolveMcpLaunch({ ...MCP, config: { command: true, args: true } }, { command: '/opt/homebrew/bin/node', args: ['/abs/server.js'] })).toEqual({ command: '/opt/homebrew/bin/node', args: ['/abs/server.js'], env: {} });
  });
});
