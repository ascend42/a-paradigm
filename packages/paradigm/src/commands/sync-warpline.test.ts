/**
 * `paradigm sync` and the Warpline block (T-2026-11-12-001): generated
 * CLAUDE.md / AGENTS.md / Cursor rules tell agents how to work in a Warpline
 * project, only when the project is versioned by Warpline.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { syncCommand } from './sync.js';
import { ClaudeAdapter } from '../core/ide-adapters/claude.js';
import { WARPLINE_BLOCK_BEGIN, WARPLINE_BLOCK_END } from '../core/ide-adapters/types.js';
import { measureAlwaysOn } from '../core/always-on-budget.js';
import { createTempProject } from '../test-utils.js';

let cleanup: (() => void) | undefined;
const realHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
let fakeHome = '';
let rootDir = '';

beforeEach(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-wl-home-'));
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
  const p = createTempProject();
  rootDir = p.rootDir;
  cleanup = p.cleanup;
  vi.spyOn(process, 'cwd').mockReturnValue(rootDir);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
  vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as typeof process.stderr.write);
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

// Each case runs up to six real syncs; give them room on a loaded machine.
vi.setConfig({ testTimeout: 30000 });

const RULE = path.join('.cursor', 'rules', 'paradigm-warpline.mdc');
const read = (f: string) => fs.readFileSync(path.join(rootDir, f), 'utf8');

async function syncAll(): Promise<void> {
  for (const ide of ['claude', 'agents', 'cursor']) {
    await syncCommand(ide, { mcp: false, quiet: true });
  }
}

/** Every file paradigm sync wrote for claude/agents/cursor. */
function generatedFiles(): string[] {
  const out = ['CLAUDE.md', 'AGENTS.md'];
  const rules = path.join(rootDir, '.cursor', 'rules');
  for (const f of fs.readdirSync(rules)) out.push(path.join('.cursor', 'rules', f));
  return out;
}

describe('sync with Warpline', () => {
  it('(1) a .warpline project gets the block in CLAUDE.md and AGENTS.md and a Cursor rule', async () => {
    fs.mkdirSync(path.join(rootDir, '.warpline'));
    await syncAll();
    for (const f of ['CLAUDE.md', 'AGENTS.md']) {
      expect(read(f)).toContain(WARPLINE_BLOCK_BEGIN);
      expect(read(f)).toContain('`warpline orient`');
      expect(read(f).split(WARPLINE_BLOCK_BEGIN)).toHaveLength(2);
    }
    expect(read(RULE)).toContain('alwaysApply: true');
    expect(read(RULE)).toContain('`warpline orient`');
  });

  it('(2) without Warpline no generated file mentions it and there is no Cursor rule', async () => {
    await syncAll();
    await syncCommand('copilot', { mcp: false, quiet: true });
    await syncCommand('windsurf', { mcp: false, quiet: true });
    const files = [...generatedFiles(), '.windsurfrules', path.join('.github', 'copilot-instructions.md')];
    for (const f of fs.readdirSync(path.join(rootDir, '.github', 'instructions'))) files.push(path.join('.github', 'instructions', f));
    for (const f of files) {
      expect(read(f).toLowerCase(), f).not.toContain('warpline');
    }
    expect(fs.existsSync(path.join(rootDir, RULE))).toBe(false);
  });

  it('(3) a block already in CLAUDE.md (e.g. from warpline init) survives sync byte-identical', async () => {
    fs.mkdirSync(path.join(rootDir, '.warpline'));
    const custom = `${WARPLINE_BLOCK_BEGIN}\n## Version control: Warpline\nHouse rules: ask Ana before admit.\n${WARPLINE_BLOCK_END}`;
    fs.writeFileSync(path.join(rootDir, 'CLAUDE.md'), `# mine\n\n${custom}\n`, 'utf8');
    await syncCommand('claude', { mcp: false, quiet: true });
    const doc = read('CLAUDE.md');
    expect(doc).toContain(custom);
    expect(doc.split(WARPLINE_BLOCK_BEGIN)).toHaveLength(2);
    expect(ClaudeAdapter.headOf(doc)).toContain(custom);
  });

  it('(4) removing .warpline drops the block and deletes the Cursor rule on the next sync', async () => {
    fs.mkdirSync(path.join(rootDir, '.warpline'));
    await syncAll();
    expect(fs.existsSync(path.join(rootDir, RULE))).toBe(true);
    fs.rmSync(path.join(rootDir, '.warpline'), { recursive: true });
    await syncAll();
    expect(read('CLAUDE.md')).not.toContain(WARPLINE_BLOCK_BEGIN);
    expect(read('AGENTS.md')).not.toContain(WARPLINE_BLOCK_BEGIN);
    expect(fs.existsSync(path.join(rootDir, RULE))).toBe(false);
  });

  it('any sync (not only cursor) deletes a stale Cursor rule once Warpline is gone', async () => {
    fs.mkdirSync(path.join(rootDir, '.warpline'));
    await syncCommand('cursor', { mcp: false, quiet: true });
    expect(fs.existsSync(path.join(rootDir, RULE))).toBe(true);
    fs.rmSync(path.join(rootDir, '.warpline'), { recursive: true });
    await syncCommand('claude', { mcp: false, quiet: true });
    expect(fs.existsSync(path.join(rootDir, RULE))).toBe(false);
  });

  it('the guidance opt-out behaves like no Warpline', async () => {
    fs.mkdirSync(path.join(rootDir, '.warpline'));
    fs.appendFileSync(path.join(rootDir, '.paradigm', 'config.yaml'), '\nintegrations:\n  warpline:\n    guidance: off\n', 'utf8');
    await syncAll();
    expect(read('CLAUDE.md')).not.toContain(WARPLINE_BLOCK_BEGIN);
    expect(fs.existsSync(path.join(rootDir, RULE))).toBe(false);
  });

  it('(5) the always-on text stays under the default cap with the block', async () => {
    fs.mkdirSync(path.join(rootDir, '.warpline'));
    await syncAll();
    const budget = measureAlwaysOn(rootDir, { homeDir: fakeHome });
    expect(budget.surfaces.length).toBeGreaterThan(0);
    // Judge item 7: at least 500 chars of headroom on every surface (the block itself is Warpline-owned census).
    for (const s of budget.surfaces) expect(budget.cap - s.chars, `${s.surface} ${s.chars}`).toBeGreaterThanOrEqual(500);
    expect(budget.census.some((e) => e.label === 'AGENTS.md Warpline block (Warpline-owned)')).toBe(true);
  });

  it('two syncs give byte-identical CLAUDE.md heads with the block (#cache-aligner)', async () => {
    fs.mkdirSync(path.join(rootDir, '.warpline'));
    fs.mkdirSync(path.join(rootDir, '.git'));
    await syncCommand('claude', { mcp: false, quiet: true });
    const first = ClaudeAdapter.headOf(read('CLAUDE.md'));
    await syncCommand('claude', { mcp: false, quiet: true, force: true });
    expect(first).toContain(WARPLINE_BLOCK_BEGIN);
    expect(ClaudeAdapter.headOf(read('CLAUDE.md'))).toBe(first);
  });
});
