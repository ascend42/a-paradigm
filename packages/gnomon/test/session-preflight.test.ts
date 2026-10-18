/**
 * #session-runner preflight (spec §3.3, §3.4 law 7; M1.7 slice 1; T-009 /
 * Aegis C5): G-SUB-01 — every API-billing key in every layer the child
 * `claude` reads for a spawn's cwd is a hit; binary resolution by explicit
 * path or the platform registry's known locations, never PATH (G-RUN-06,
 * builder reading). Platform-independent: file reads and a fake platform row.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { law7Layers, law7Scan, PreflightRefusal, resolveClaudeBinary, compareVersions } from '../src/kernel/runner/preflight.js';
import { CLAUDE_CODE_PLATFORMS, claudeCodePlatform, type ClaudeCodePlatformRow } from '../src/platform/claude-code.js';

const tmps: string[] = [];
afterEach(() => {
  for (const t of tmps.splice(0)) fs.rmSync(t, { recursive: true, force: true });
});

function world() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-law7-')));
  tmps.push(root);
  const uh = path.join(root, 'userhome');
  const cwd = path.join(root, 'repo');
  const wt = path.join(root, 'wt');
  const managedDir = path.join(root, 'managed');
  for (const d of [path.join(uh, '.claude'), path.join(cwd, '.claude'), path.join(wt, '.claude'), path.join(managedDir, 'managed-settings.d')]) fs.mkdirSync(d, { recursive: true });
  const row: ClaudeCodePlatformRow = { knownBinaries: [], managedSettings: [path.join(managedDir, 'managed-settings.json')], managedSettingsDirs: [path.join(managedDir, 'managed-settings.d')], managedUnscannable: [], userClaudeDir: '.claude' };
  const input = { row, cwd, worktree: wt, userClaudeDir: path.join(uh, '.claude'), userClaudeJson: path.join(uh, '.claude.json'), policyPath: path.join(root, 'policy.json'), mcpConfigPath: path.join(root, 'mcp.json') };
  return { root, uh, cwd, wt, managedDir, row, input };
}

const W = (p: string, v: unknown): void => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v));
};

type World = ReturnType<typeof world>;
const SETTINGS_LAYERS: Array<[string, (w: World) => string]> = [
  ['managed file', (w) => path.join(w.managedDir, 'managed-settings.json')],
  ['managed-settings.d', (w) => path.join(w.managedDir, 'managed-settings.d', '10-x.json')],
  ['user settings.json', (w) => path.join(w.uh, '.claude', 'settings.json')],
  ['user settings.local.json', (w) => path.join(w.uh, '.claude', 'settings.local.json')],
  ['project .claude/settings.json', (w) => path.join(w.cwd, '.claude', 'settings.json')],
  ['project .claude/settings.local.json', (w) => path.join(w.cwd, '.claude', 'settings.local.json')],
  ['worktree .claude/settings.json', (w) => path.join(w.wt, '.claude', 'settings.json')],
  ['session policy.json', (w) => w.input.policyPath],
];
const KEYS: Array<[string, string]> = [
  ['ANTHROPIC_API_KEY', 'sk'],
  ['ANTHROPIC_AUTH_TOKEN', 't'],
  ['ANTHROPIC_BASE_URL', 'https://x'],
  ['OTHER_BASE_URL', 'http://127.0.0.1:8080'], // the loopback override (the former local-endpoint case, D37)
  ['CLAUDE_CODE_USE_BEDROCK', '1'],
  ['CLAUDE_CODE_USE_VERTEX', '1'],
  ['CLAUDE_CODE_USE_FOUNDRY', '1'],
];

describe('G-SUB-01 law 7 per spawn: every key in every layer ⇒ api_billing_refused', () => {
  it('a clean world scans clean', () => {
    const w = world();
    expect(law7Scan({ HOME: w.uh }, law7Layers(w.input))).toEqual([]);
  });
  for (const [layer, at] of SETTINGS_LAYERS) {
    it.each(KEYS)(`${layer}: env.%s`, (k, v) => {
      const w = world();
      W(at(w), { env: { [k]: v } });
      const hits = law7Scan({}, law7Layers(w.input));
      expect(hits.map((h) => h.key)).toEqual([k]);
    });
    it(`${layer}: apiKeyHelper`, () => {
      const w = world();
      W(at(w), { apiKeyHelper: '/bin/echo k' });
      expect(law7Scan({}, law7Layers(w.input)).map((h) => h.key)).toEqual(['apiKeyHelper']);
    });
    it(`${layer}: unreadable JSON is a hit (fail closed)`, () => {
      const w = world();
      W(at(w), '{not json');
      expect(law7Scan({}, law7Layers(w.input)).map((h) => h.key)).toEqual(['(unreadable)']);
    });
  }
  const MCP_LAYERS: Array<[string, (w: World) => [string, unknown]]> = [
    ['project .mcp.json', (w) => [path.join(w.cwd, '.mcp.json'), { mcpServers: { s: { command: 'x', env: { ANTHROPIC_API_KEY: 'k' } } } }]],
    ['worktree .mcp.json', (w) => [path.join(w.wt, '.mcp.json'), { mcpServers: { s: { command: 'x', env: { ANTHROPIC_API_KEY: 'k' } } } }]],
    ['session mcp.json', (w) => [w.input.mcpConfigPath, { mcpServers: { s: { command: 'x', env: { ANTHROPIC_API_KEY: 'k' } } } }]],
    ['~/.claude.json mcpServers', (w) => [w.input.userClaudeJson, { mcpServers: { s: { command: 'x', env: { ANTHROPIC_API_KEY: 'k' } } } }]],
    ['~/.claude.json projects.<cwd>.mcpServers', (w) => [w.input.userClaudeJson, { projects: { [w.cwd]: { mcpServers: { s: { command: 'x', env: { ANTHROPIC_API_KEY: 'k' } } } } } }]],
    ['~/.claude.json projects.<worktree>.mcpServers', (w) => [w.input.userClaudeJson, { projects: { [w.wt]: { mcpServers: { s: { command: 'x', env: { ANTHROPIC_BASE_URL: 'http://localhost:1' } } } } } }]],
  ];
  it.each(MCP_LAYERS)('mcp env block: %s', (_l, f) => {
    const w = world();
    const [p, v] = f(w);
    W(p, v);
    expect(law7Scan({}, law7Layers(w.input)).length).toBe(1);
  });
  it('another project in ~/.claude.json is not this spawn\'s layer', () => {
    const w = world();
    W(w.input.userClaudeJson, { projects: { '/elsewhere': { mcpServers: { s: { env: { ANTHROPIC_API_KEY: 'k' } } } } } });
    expect(law7Scan({}, law7Layers(w.input))).toEqual([]);
  });
  it.each(KEYS)('the child env: %s', (k, v) => {
    const w = world();
    expect(law7Scan({ [k]: v }, law7Layers(w.input)).map((h) => h.where)).toEqual(['env']);
  });
  it('a managed source the kernel cannot read on this OS (Windows policy keys) is a hit', () => {
    const w = world();
    expect(law7Scan({}, law7Layers({ ...w.input, row: { ...w.row, managedUnscannable: ['HKLM\\SOFTWARE\\Policies\\ClaudeCode'] } })).map((h) => h.key)).toEqual(['(unreadable)']);
  });
  it('the platform registry names managed sources for every OS (no platform branch)', () => {
    for (const p of ['darwin', 'win32', 'linux'] as const) expect(CLAUDE_CODE_PLATFORMS[p].managedSettings.length).toBeGreaterThan(0);
    expect(claudeCodePlatform('aix')).toBeNull();
  });
});

describe('G-RUN-06 (builder reading) the claude binary: explicit path, else known locations — never PATH', () => {
  it('finds a known location under the user home, realpaths and hashes it', () => {
    const w = world();
    const bin = path.join(w.uh, '.local', 'bin', 'claude');
    W(path.join(w.uh, 'versions', '2.1.302'), '#!/bin/sh\n');
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.symlinkSync(path.join(w.uh, 'versions', '2.1.302'), bin);
    const r = resolveClaudeBinary({ row: { ...w.row, knownBinaries: ['~/.local/bin/claude'] }, home: w.uh });
    expect(r.real).toBe(path.join(w.uh, 'versions', '2.1.302'));
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('a claude only on PATH is never found; a bare explicit name is refused', () => {
    const w = world();
    W(path.join(w.root, 'pathdir', 'claude'), '#!/bin/sh\n');
    const prev = process.env.PATH;
    process.env.PATH = `${path.join(w.root, 'pathdir')}${path.delimiter}${prev ?? ''}`;
    try {
      expect(() => resolveClaudeBinary({ row: { ...w.row, knownBinaries: [] }, home: w.uh })).toThrow(PreflightRefusal);
      expect(() => resolveClaudeBinary({ explicit: 'claude', row: w.row, home: w.uh })).toThrow(PreflightRefusal);
    } finally {
      process.env.PATH = prev;
    }
  });
  it('a respawn whose binary changed is refused claude_binary_changed', () => {
    const w = world();
    const bin = path.join(w.root, 'claude');
    W(bin, 'v1');
    const first = resolveClaudeBinary({ explicit: bin, row: w.row, home: w.uh });
    W(bin, 'v2');
    try {
      resolveClaudeBinary({ explicit: bin, row: w.row, home: w.uh, previousSha256: first.sha256 });
      expect.unreachable();
    } catch (e) {
      expect((e as PreflightRefusal).code).toBe('claude_binary_changed');
    }
  });
  it('version floor compare', () => {
    expect(compareVersions('2.1.302', '2.1.288')).toBeGreaterThan(0);
    expect(compareVersions('2.1.100', '2.1.288')).toBeLessThan(0);
  });
});
