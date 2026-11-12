/**
 * warpline-orient.test — `warpline orient` (#warpline-orient, T-2026-11-12-001).
 *
 * Pins: native and git mode; the agent's next legal verbs follow the SAME rule
 * table the daemon's status uses, as it moves through fork → propose; the
 * uninitialized and no-agent answers; the --json shape over the real binary; and
 * the read-only contract — the whole project tree (fabric included) is byte
 * identical before and after, from the library AND the binary.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { orient, ORIENT_SCHEMA } from '../src/orient.js';
import { initWarpline } from '../src/fabric/init.js';
import { forkNative, proposeNative } from '../src/fabric/native.js';
import { NEXT_LEGAL_VERBS } from '../src/daemon/descriptors.js';

const distCli = path.resolve(fileURLToPath(new URL('../dist/cli.js', import.meta.url)));

function write(dir: string, rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

/** A digest of every file under `dir` (relative path + bytes), and the file set. */
function treeDigest(dir: string): string {
  const h = createHash('sha256');
  const walk = (d: string): void => {
    for (const name of fs.readdirSync(d).sort()) {
      const full = path.join(d, name);
      const rel = path.relative(dir, full).split(path.sep).join('/');
      const st = fs.lstatSync(full);
      if (st.isDirectory()) {
        h.update(`d:${rel}\0`);
        walk(full);
      } else {
        h.update(`f:${rel}\0`);
        h.update(fs.readFileSync(full));
        h.update('\0');
      }
    }
  };
  walk(dir);
  return h.digest('hex');
}

const NO_ENV: NodeJS.ProcessEnv = {};

describe('orient — native mode, git absent', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-orient-'));
    write(root, 'src/mod.ts', 'export function foo(): number { return 1; }\n');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('before init: not initialized, the next step is `warpline init`', () => {
    const r = orient(root, { env: NO_ENV });
    expect(r.schema).toBe(ORIENT_SCHEMA);
    expect(r.mode).toBe('native');
    expect(r.initialized).toBe(false);
    expect(r.next).toEqual([{ verb: 'init', command: 'warpline init' }]);
    expect(r.agentGuide).toEqual({ agentsMd: false, claudeMd: null });
  });

  it('after init with no agent id: the no-scratch rule, with a placeholder and a hint', async () => {
    await initWarpline(root);
    const r = orient(root, { env: NO_ENV });
    expect(r.initialized).toBe(true);
    expect(r.selvage).toMatch(/^pick:/);
    expect(r.agentGuide.agentsMd).toBe(true);
    expect(r.agent).toEqual({ id: null, source: null });
    expect(r.position).toBeNull();
    expect(r.next.map((s) => s.verb)).toEqual(NEXT_LEGAL_VERBS.find((x) => x.when.scratchPresent === false)!.verbs);
    expect(r.next[0].command).toBe('warpline fork <you>');
    expect(r.nextBecause).toContain('WARPLINE_AGENT_ID');
    expect(r.daemon).toEqual({ state: 'stopped', mcpConfigured: false, mcpTokens: 0 });
    expect(r.humanOnly.map((s) => s.verb)).toEqual(expect.arrayContaining(['resolve', 'admit --accept-breach']));
    expect(r.limits.join(' ')).toMatch(/KNOT needs a human/);
    expect(fs.existsSync(path.join(root, '.git'))).toBe(false);
  });

  it('follows the agent through fork → propose (same rule table as the daemon)', async () => {
    await initWarpline(root);
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-orient-wt-'));
    try {
      expect(orient(root, { agentId: 'ada', env: NO_ENV }).next[0].command).toBe('warpline fork ada');

      await forkNative(root, 'ada', { into: wt });
      const forked = orient(root, { agentId: 'ada', env: NO_ENV });
      expect(forked.agent).toEqual({ id: 'ada', source: 'flag' });
      expect(forked.position).toMatchObject({ scratchPresent: true, proposalSealed: false });
      expect(forked.next).toEqual([{ verb: 'propose', command: 'warpline propose --agent ada --native -m "<why>"' }]);

      write(wt, 'src/mod.ts', 'export function foo(): number { return 2; }\n');
      await proposeNative(root, { worktree: wt, agentId: 'ada', intent: 'change foo' });
      const sealed = orient(root, { env: { WARPLINE_AGENT_ID: 'ada' } });
      expect(sealed.agent).toEqual({ id: 'ada', source: 'env' });
      expect(sealed.position).toMatchObject({ proposalSealed: true, knotOpen: false });
      expect(sealed.next.map((s) => s.command)).toEqual(['warpline admit ada --native', 'warpline abandon ada']);
    } finally {
      fs.rmSync(wt, { recursive: true, force: true });
    }
  });

  it('never writes: the whole project tree is byte identical', async () => {
    await initWarpline(root);
    const before = treeDigest(root);
    orient(root, { env: NO_ENV });
    orient(root, { agentId: 'nobody-yet', env: NO_ENV });
    expect(treeDigest(root)).toBe(before);
  });

  it('reports an MCP entry only when it actually runs warpline with `mcp`', async () => {
    await initWarpline(root);
    const mcp = (servers: Record<string, unknown>): boolean => {
      write(root, '.mcp.json', JSON.stringify({ mcpServers: servers }));
      return orient(root, { env: NO_ENV }).daemon.mcpConfigured;
    };
    expect(mcp({ warpline: { command: 'warpline', args: ['mcp'] } })).toBe(true);
    expect(mcp({ x: { command: 'npx', args: ['-y', '@a-company/warpline', 'mcp'] } })).toBe(true);
    expect(mcp({ x: { command: 'node', args: ['/opt/w/packages/warpline/dist/cli.js', 'mcp', '--operator'] } })).toBe(true);
    expect(mcp({ x: { command: 'C:\\tools\\warpline.cmd', args: ['mcp'] } })).toBe(true);
    // false positives the substring check used to accept
    expect(mcp({ warpline: { command: 'node', args: ['server.js'] } })).toBe(false);
    expect(mcp({ x: { command: 'warpline', args: ['daemon', 'start'], env: { MODE: 'mcp' } } })).toBe(false);
    expect(mcp({ x: { command: 'other-mcp', args: ['--dir', '/home/me/warpline'] } })).toBe(false);
    expect(mcp({ x: { command: 'mcp', args: ['warpline'] } })).toBe(false);
  });

  it('counts DISTINCT MCP tokens (the legacy file is usually also in the keyed map)', async () => {
    await initWarpline(root);
    write(root, '.warpline/daemon/mcp-tokens.json', JSON.stringify({ ada: 'tok-1' }));
    write(root, '.warpline/daemon/mcp.token', 'tok-1\n');
    expect(orient(root, { env: NO_ENV }).daemon.mcpTokens).toBe(1);
    write(root, '.warpline/daemon/mcp.token', 'tok-2\n');
    expect(orient(root, { env: NO_ENV }).daemon.mcpTokens).toBe(2);
  });

  it('only a WHOLE-LINE block counts as the agent guide (an inline mention does not)', async () => {
    await initWarpline(root);
    write(root, 'CLAUDE.md', 'we keep `<!-- warpline:begin -->` ... `<!-- warpline:end -->` here\n');
    expect(orient(root, { env: NO_ENV }).agentGuide.claudeMd).toBe(false);
  });

  it('in a subdirectory of the project: points at the enclosing root, never at init', async () => {
    await initWarpline(root);
    const sub = path.join(root, 'src', 'deep');
    fs.mkdirSync(sub, { recursive: true });
    const before = treeDigest(root);
    const r = orient(sub, { env: NO_ENV });
    expect(r.initialized).toBe(false);
    expect(r.enclosingRoot).toBe(path.resolve(root));
    expect(r.next).toHaveLength(1);
    expect(r.next[0].command).toContain('--root');
    expect(r.next[0].command).not.toContain('init');
    expect(r.nextBecause).toContain(path.resolve(root));
    expect(treeDigest(root)).toBe(before);
  });
});

describe('orient — git mode', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-orient-git-'));
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    write(root, 'src/mod.ts', 'export function foo(): number { return 1; }\n');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('a subdirectory of a git work tree reports git mode', () => {
    const sub = path.join(root, 'src');
    expect(orient(sub, { env: NO_ENV }).mode).toBe('git');
  });

  it('reports git mode and the git guide, and still writes nothing', async () => {
    await initWarpline(root);
    const before = treeDigest(root);
    const r = orient(root, { env: NO_ENV });
    expect(r.mode).toBe('git');
    expect(r.initialized).toBe(true);
    expect(r.agentGuide.agentsMd).toBe(true);
    expect(treeDigest(root)).toBe(before);
  });
});

describe('`warpline orient` over the real binary', () => {
  const haveDist = fs.existsSync(distCli);
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-orient-bin-'));
    write(root, 'src/mod.ts', 'export function foo(): number { return 1; }\n');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const cli = async (...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> => {
    const env = { ...process.env };
    delete env.WARPLINE_AGENT_ID;
    try {
      const { stdout, stderr } = await promisify(execFile)('node', [distCli, '--root', root, ...args], {
        cwd: root,
        encoding: 'utf8',
        env,
      });
      return { code: 0, stdout, stderr };
    } catch (e) {
      const err = e as { code?: number; stdout?: string; stderr?: string };
      return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
    }
  };

  it.runIf(haveDist)('--json shape, human output, and no writes (fabric bytes unchanged)', async () => {
    expect((await cli('init')).code).toBe(0);
    const before = treeDigest(root);

    const j = await cli('orient', '--agent', 'ada', '--json');
    expect(j.code).toBe(0);
    const r = JSON.parse(j.stdout);
    expect(Object.keys(r).sort()).toEqual(
      ['agent', 'agentGuide', 'daemon', 'enclosingRoot', 'humanOnly', 'initialized', 'limits', 'mode', 'next', 'nextBecause', 'position', 'root', 'schema', 'selvage'].sort(),
    );
    expect(r.schema).toBe('orient:v1');
    expect(r.mode).toBe('native');
    expect(r.next[0]).toEqual({ verb: 'fork', command: 'warpline fork ada' });

    const h = await cli('orient');
    expect(h.code).toBe(0);
    expect(h.stdout).toContain('WARPLINE ORIENT');
    expect(h.stdout).toContain('native');
    expect(h.stderr).not.toMatch(/not a git repository/i);

    expect(treeDigest(root)).toBe(before);
  }, 120_000);
});
