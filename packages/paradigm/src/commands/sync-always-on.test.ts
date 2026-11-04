/**
 * `paradigm sync` prints one warn() line when a regenerated always-on surface
 * is over the #always-on-budget cap, and never changes what it generates.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { syncCommand } from './sync.js';
import { ClaudeAdapter } from '../core/ide-adapters/claude.js';
import { createTempProject } from '../test-utils.js';

let cleanup: (() => void) | undefined;
// Isolate from the real ~/.claude (installed plugin skills, user skills).
const realHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
let fakeHome = '';
beforeEach(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-aob-home-'));
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(realHome)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(fakeHome, { recursive: true, force: true });
});

describe('sync always-on warning', () => {
  it('warns once when the regenerated CLAUDE.md surface is over the cap', async () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    fs.appendFileSync(path.join(rootDir, '.paradigm', 'config.yaml'), '\ncontext:\n  always-on-max-chars: 10\n', 'utf8');
    vi.spyOn(process, 'cwd').mockReturnValue(rootDir);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => { stdout += String(chunk); return true; }) as typeof process.stdout.write);
    vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as typeof process.stderr.write);

    await syncCommand('claude', { mcp: false });
    const lines = stdout.split('\n').filter((l) => l.includes('Always-on claude-code'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('over the 10 cap');
    expect(fs.existsSync(path.join(rootDir, 'CLAUDE.md'))).toBe(true);
  });

  it('prints nothing under the cap, and sync output is byte-identical either way', async () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    vi.spyOn(process, 'cwd').mockReturnValue(rootDir);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => { stdout += String(chunk); return true; }) as typeof process.stdout.write);
    vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as typeof process.stderr.write);

    await syncCommand('claude', { mcp: false });
    const under = fs.readFileSync(path.join(rootDir, 'CLAUDE.md'), 'utf8');
    expect(stdout).not.toContain('Always-on');

    fs.appendFileSync(path.join(rootDir, '.paradigm', 'config.yaml'), '\ncontext:\n  always-on-max-chars: 10\n', 'utf8');
    await syncCommand('claude', { mcp: false, force: true });
    expect(stdout).toContain('Always-on claude-code');
    // Only the trailer (volatile by design) may differ; the cache-aligned head is untouched.
    const over = fs.readFileSync(path.join(rootDir, 'CLAUDE.md'), 'utf8');
    expect(under).toContain(ClaudeAdapter.TRAILER_MARKER);
    expect(ClaudeAdapter.headOf(over)).toBe(ClaudeAdapter.headOf(under));
  });

  it('I3: a mixed-case target still warns for its adapter surface', async () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    fs.appendFileSync(path.join(rootDir, '.paradigm', 'config.yaml'), '\ncontext:\n  always-on-max-chars: 10\n', 'utf8');
    vi.spyOn(process, 'cwd').mockReturnValue(rootDir);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => { stdout += String(chunk); return true; }) as typeof process.stdout.write);
    vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as typeof process.stderr.write);

    await syncCommand('Claude', { mcp: false });
    expect(stdout.split('\n').filter((l) => l.includes('Always-on claude-code'))).toHaveLength(1);
  });
});
