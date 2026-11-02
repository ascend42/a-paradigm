/**
 * MCP config portability (2x-engineers report, 2026-11-01): Paradigm wrote `cwd: <this Mac's folder>` into the
 * committed .mcp.json / .cursor/mcp.json, so on a teammate's clone the server failed to start and the agent quietly
 * lost the Paradigm tools. The writers no longer do; `paradigm sync` heals an old file; doctor flags any left.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { auditMcpPortability } from './mcp-portability-audit.js';
import { writeMcpConfig } from '../../core/ide-adapters/index.js';

const dirs: string[] = [];
const tmp = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-portable-'));
  dirs.push(d);
  return d;
};
const write = (root: string, rel: string, v: unknown): void => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), JSON.stringify(v, null, 2));
};
const read = (root: string, rel: string): { mcpServers: Record<string, Record<string, unknown>>; permissions?: unknown } => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('sync heals a pre-fix project MCP config', () => {
  it('.mcp.json and .cursor/mcp.json: the paradigm entry loses its absolute cwd; other servers and keys are kept', () => {
    const root = tmp();
    const old = { command: 'paradigm-mcp', args: ['.'], cwd: '/Users/someone/Documents/GitHub/project' };
    write(root, '.mcp.json', { mcpServers: { paradigm: old, other: { command: 'x', cwd: '/opt/x' } }, permissions: { allow: ['Bash(paradigm *)'] } });
    write(root, '.cursor/mcp.json', { mcpServers: { paradigm: old } });
    expect(writeMcpConfig(root, 'claude').success).toBe(true);
    expect(writeMcpConfig(root, 'cursor').success).toBe(true);
    const claude = read(root, '.mcp.json');
    expect(claude.mcpServers.paradigm.cwd).toBeUndefined();
    expect(JSON.stringify(claude.mcpServers.paradigm)).not.toContain(root);
    expect(claude.mcpServers.other).toEqual({ command: 'x', cwd: '/opt/x' }); // not ours: untouched (doctor names it)
    expect(claude.permissions).toEqual({ allow: ['Bash(paradigm *)'] });
    const cursor = read(root, '.cursor/mcp.json');
    expect(cursor.mcpServers.paradigm).toEqual({ command: 'paradigm-mcp', args: ['.'], env: { PARADIGM_PROJECT_DIR: '${workspaceFolder}' } });
    // what is left is only the other server's own path
    expect(auditMcpPortability(root).map((h) => `${h.file}:${h.server}.${h.field}`)).toEqual(['.mcp.json:other.cwd']);
  });
});

describe('doctor: auditMcpPortability', () => {
  it('names an absolute cwd or args path in any project MCP config; placeholders and relative paths pass', () => {
    const root = tmp();
    write(root, '.mcp.json', { mcpServers: { paradigm: { command: 'paradigm-mcp', args: ['.'], cwd: '/Users/a/proj' } } });
    write(root, '.cursor/mcp.json', { mcpServers: { tool: { command: 'node', args: ['/Users/a/proj/server.js', '--flag'] }, ok: { command: 'x', args: ['.'], cwd: '${workspaceFolder}' } } });
    write(root, '.cline/mcp.json', { mcpServers: { win: { command: 'x', cwd: 'C:\\Users\\a\\proj' } } });
    expect(auditMcpPortability(root)).toEqual([
      { file: '.mcp.json', server: 'paradigm', field: 'cwd', value: '/Users/a/proj' },
      { file: path.join('.cursor', 'mcp.json'), server: 'tool', field: 'args[0]', value: '/Users/a/proj/server.js' },
      { file: path.join('.cline', 'mcp.json'), server: 'win', field: 'cwd', value: 'C:\\Users\\a\\proj' },
    ]);
  });

  it('no configs, unparseable configs and portable configs: no hits', () => {
    const root = tmp();
    expect(auditMcpPortability(root)).toEqual([]);
    fs.writeFileSync(path.join(root, '.mcp.json'), '{ not json');
    expect(auditMcpPortability(root)).toEqual([]);
    writeMcpConfig(root, 'cursor');
    expect(auditMcpPortability(root)).toEqual([]);
  });
});
