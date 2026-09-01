import { describe, it, expect } from 'vitest';
import { mcpServerEnv } from './mcp-env.js';
import { claudeAdapter } from './claude.js';
import { cursorAdapter } from './cursor.js';
import { generateMCPConfig, type AIClient } from '../../commands/mcp/setup.js';

describe('mcpServerEnv', () => {
  it('posix append form preserves the inherited PATH (starts with ${PATH})', () => {
    const env = mcpServerEnv(true, 'darwin');
    expect(env).toBeDefined();
    // Append/expansion form — proves we prepend the inherited PATH, not clobber it.
    expect(env!.PATH.startsWith('${PATH}:')).toBe(true);
    expect(env!.PATH).toContain('/opt/homebrew/bin');
  });

  it('posix static form is self-contained (no ${VAR}) and keeps system dirs', () => {
    const env = mcpServerEnv(false, 'linux');
    expect(env).toBeDefined();
    expect(env!.PATH).not.toContain('${');
    expect(env!.PATH).toContain('/opt/homebrew/bin');
    expect(env!.PATH).toContain('/usr/bin');
  });

  it('win32 append form preserves %PATH% via ${PATH};', () => {
    const env = mcpServerEnv(true, 'win32');
    expect(env).toBeDefined();
    expect(env!.PATH.startsWith('${PATH};')).toBe(true);
  });

  it('win32 static call omits env entirely', () => {
    expect(mcpServerEnv(false, 'win32')).toBeUndefined();
  });
});

describe('adapter generateMcpConfig env', () => {
  it('Claude Code adapter emits append/expansion PATH (starts with ${PATH})', () => {
    const cfg = claudeAdapter.generateMcpConfig('/some/root');
    const env = cfg.mcpServers.paradigm.env;
    // Only meaningful on posix; win32 CI would use the ; form — still ${PATH}-prefixed.
    if (process.platform === 'win32') {
      expect(env!.PATH.startsWith('${PATH};')).toBe(true);
    } else {
      expect(env!.PATH.startsWith('${PATH}:')).toBe(true);
    }
    // command/args/cwd left exactly as-is.
    expect(cfg.mcpServers.paradigm.command).toBe('paradigm-mcp');
    expect(cfg.mcpServers.paradigm.args).toEqual(['.']);
    expect(cfg.mcpServers.paradigm.cwd).toBe('/some/root');
  });

  it('Cursor adapter emits NO env (${VAR} expansion unconfirmed → bare command)', () => {
    const cfg = cursorAdapter.generateMcpConfig('/some/root');
    expect(cfg.mcpServers.paradigm.env).toBeUndefined();
  });
});

describe('setup generateMCPConfig env', () => {
  const mkClient = (id: string): AIClient => ({
    name: id,
    id,
    detected: true,
    configPath: `/tmp/${id}.json`,
    configType: 'project',
    instructions: '',
  });

  it('Claude Code (confirmed expander) gets the append env', () => {
    const cfg = generateMCPConfig(mkClient('claude-code'), '/proj', 'proj');
    const server = cfg.mcpServers!['proj'];
    if (process.platform === 'win32') {
      expect(server.env!.PATH.startsWith('${PATH};')).toBe(true);
    } else {
      expect(server.env!.PATH.startsWith('${PATH}:')).toBe(true);
    }
  });

  it('Claude Desktop gets NO env (GUI app, ${VAR} unconfirmed → bare command)', () => {
    const cfg = generateMCPConfig(mkClient('claude-desktop'), '/proj', 'proj');
    expect(cfg.mcpServers!['proj'].env).toBeUndefined();
  });

  it('Cline gets NO env (${VAR} expansion unconfirmed → bare command, no regression)', () => {
    const cfg = generateMCPConfig(mkClient('cline'), '/proj', 'proj');
    expect(cfg.mcpServers!['proj'].env).toBeUndefined();
  });

  it('Continue transport gets NO env (${VAR} expansion unconfirmed)', () => {
    const cfg = generateMCPConfig(mkClient('continue'), '/proj', 'proj');
    const transport = cfg.experimental!.modelContextProtocolServers![0].transport;
    expect(transport.command).toBe('paradigm-mcp');
    expect(transport.env).toBeUndefined();
  });
});
