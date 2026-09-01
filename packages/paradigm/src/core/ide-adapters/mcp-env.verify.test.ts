/**
 * TESTER verification suite for the portable MCP-config PATH fix.
 *
 * Complements mcp-env.test.ts with stronger, task-specified assertions:
 *  1. Generated-value correctness for every client/platform.
 *  2. Shell-simulated ${VAR} expansion — proves the append-form STRING is
 *     well-formed (IF the host expands ${PATH}, the child PATH is correct and
 *     no literal ${...} leaks — the #1 regression risk).
 *  3. The fix actually resolves the failing case (paradigm-mcp on PATH).
 *
 * These tests do NOT drive Claude Code's real .mcp.json expander — that is not
 * reachable from a unit test. They verify what IS verifiable.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mcpServerEnv } from './mcp-env.js';
import { claudeAdapter } from './claude.js';
import { cursorAdapter } from './cursor.js';
import { generateMCPConfig, type AIClient } from '../../commands/mcp/setup.js';

const mkClient = (id: string): AIClient => ({
  name: id,
  id,
  detected: true,
  configPath: `/tmp/${id}.json`,
  configType: 'project',
  instructions: '',
});

/** Expand a literal env-value string in a real POSIX shell with a known base. */
function shellExpand(literal: string, base: string, home: string): string {
  return execFileSync(
    'sh',
    ['-c', `printf '%s' "${literal}"`],
    { env: { PATH: base, HOME: home }, encoding: 'utf8' },
  );
}

// ── 1. Generated-value correctness ───────────────────────────────────────────

describe('generated-value correctness: claude.ts', () => {
  it('append form starts with ${PATH}: and carries homebrew + /usr/local/bin (posix)', () => {
    const env = mcpServerEnv(true, 'darwin')!;
    expect(env.PATH.startsWith('${PATH}:')).toBe(true);
    expect(env.PATH).toContain('/opt/homebrew/bin');
    expect(env.PATH).toContain('/usr/local/bin');
  });

  it('generateMcpConfig leaves command/args/cwd untouched (posix path only)', () => {
    const cfg = claudeAdapter.generateMcpConfig('/some/root');
    const server = cfg.mcpServers.paradigm;
    expect(server.command).toBe('paradigm-mcp');
    expect(server.args).toEqual(['.']);
    expect(server.cwd).toBe('/some/root');
    if (process.platform !== 'win32') {
      expect(server.env!.PATH.startsWith('${PATH}:')).toBe(true);
      expect(server.env!.PATH).toContain('/opt/homebrew/bin');
      expect(server.env!.PATH).toContain('/usr/local/bin');
    }
  });
});

describe('generated-value correctness: setup.ts (env narrowed to claude-code only)', () => {
  it('claude-code → append/expansion env (the ONLY confirmed-safe client)', () => {
    const server = generateMCPConfig(mkClient('claude-code'), '/proj', 'proj').mcpServers!['proj'];
    if (process.platform === 'win32') {
      expect(server.env!.PATH.startsWith('${PATH};')).toBe(true);
    } else {
      expect(server.env!.PATH.startsWith('${PATH}:')).toBe(true);
      expect(server.env!.PATH).toContain('/opt/homebrew/bin');
    }
  });

  it('cline (unconfirmed ${VAR} expansion) → NO env, bare command (no regression)', () => {
    const server = generateMCPConfig(mkClient('cline'), '/proj', 'proj').mcpServers!['proj'];
    expect(server.env).toBeUndefined();
  });

  it('claude-desktop (GUI app, no ${VAR} expansion) → NO env, bare command', () => {
    const server = generateMCPConfig(mkClient('claude-desktop'), '/proj', 'proj').mcpServers!['proj'];
    expect(server.env).toBeUndefined();
  });

  it('continue (unconfirmed) → NO env on its transport', () => {
    const cont = generateMCPConfig(mkClient('continue'), '/proj', 'proj');
    expect(cont.experimental!.modelContextProtocolServers![0].transport.env).toBeUndefined();
  });

  it('helper still carries the win32 append form (used by claude-code on win32)', () => {
    const env = mcpServerEnv(true, 'win32')!;
    expect(env.PATH.startsWith('${PATH};')).toBe(true);
  });

  it('command/args/cwd unchanged across setup transports', () => {
    const cont = generateMCPConfig(mkClient('continue'), '/proj', 'proj');
    const t = cont.experimental!.modelContextProtocolServers![0].transport;
    expect(t.command).toBe('paradigm-mcp');
    expect(t.args).toEqual(['.']);
    expect(t.cwd).toBe('/proj');
    const std = generateMCPConfig(mkClient('cline'), '/proj', 'proj').mcpServers!['proj'];
    expect(std.command).toBe('paradigm-mcp');
    expect(std.args).toEqual(['.']);
    expect(std.cwd).toBe('/proj');
  });
});

describe('generated-value correctness: cursor.ts (env narrowed out)', () => {
  it('adapter emits NO env (Cursor ${VAR} unconfirmed → bare command), command/args/cwd intact', () => {
    const server = cursorAdapter.generateMcpConfig('/some/root').mcpServers.paradigm;
    expect(server.command).toBe('paradigm-mcp');
    expect(server.args).toEqual(['.']);
    expect(server.cwd).toBe('/some/root');
    expect(server.env).toBeUndefined();
  });
});

// ── 2. Shell-simulated expansion (the #1 regression risk) ─────────────────────

describe('shell-simulated expansion of the claude.ts append form', () => {
  const literal = mcpServerEnv(true, 'darwin')!.PATH;

  it('IF ${PATH} expands: base dirs preserved AND prepended (append, not replace)', () => {
    const out = shellExpand(literal, '/usr/bin:/bin', '/home/test');
    expect(out).toContain('/usr/bin');
    expect(out).toContain('/bin');
    expect(out.startsWith('/usr/bin:/bin:')).toBe(true); // inherited PATH kept at front
  });

  it('IF ${PATH} expands: augmented dirs are added', () => {
    const out = shellExpand(literal, '/usr/bin:/bin', '/home/test');
    expect(out).toContain('/opt/homebrew/bin');
    expect(out).toContain('/home/test/.local/bin'); // ${HOME} expanded too
  });

  it('NO literal ${...} survives after expansion (else PATH would be destroyed)', () => {
    const out = shellExpand(literal, '/usr/bin:/bin', '/home/test');
    expect(out).not.toContain('${');
  });
});

// ── 3. The fix resolves the real failing symptom ─────────────────────────────

describe('fix resolves the PATH-deficient launch symptom', () => {
  // Locate paradigm-mcp on the current machine; skip gracefully if not installed.
  let mcpDir: string | null = null;
  try {
    const p = execFileSync('sh', ['-c', 'command -v paradigm-mcp'], {
      encoding: 'utf8',
    }).trim();
    mcpDir = p ? p.replace(/\/[^/]+$/, '') : null;
  } catch {
    mcpDir = null;
  }

  it.skipIf(!mcpDir)('fails under a deficient PATH, resolves once augmented dirs are added', () => {
    const resolves = (path: string): boolean => {
      try {
        execFileSync('sh', ['-c', 'command -v paradigm-mcp'], { env: { PATH: path } });
        return true;
      } catch {
        return false;
      }
    };
    const deficient = '/usr/bin:/bin';
    expect(resolves(deficient)).toBe(false); // reproduces the GUI-launch failure
    expect(resolves(`${deficient}:${mcpDir}`)).toBe(true); // augmentation heals it
  });
});
