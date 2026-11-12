/**
 * agent-guide-init.test — `warpline init` ships the agent guide
 * (#warpline-agent-guide, T-2026-11-12-001).
 *
 * The defect: init printed its agent hints to the terminal only, so an agent's
 * NEXT session opened a project with no .git and no word about Warpline. These
 * pin the fix: the block lands in AGENTS.md (created) and CLAUDE.md (only when it
 * exists), before genesis so `status` right after init is clean; re-running never
 * duplicates; text outside the markers is never touched; --no-agent-guide writes
 * nothing; git mode renders the git text.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { initWarpline } from '../src/fabric/init.js';
import { nativeStatus } from '../src/native-status.js';
import {
  renderAgentGuide,
  ensureAgentGuide,
  AGENT_GUIDE_BEGIN,
  AGENT_GUIDE_END,
  agentGuideId,
  agentGuideModeOf,
} from '../src/fabric/agent-guide.js';
import { F4Tracer, f4TracePathOf } from '../src/daemon/f4-trace.js';
import { loadWarpignore } from '../src/warp/warpignore.js';
import * as pkg from '../src/index.js';
import { seedWorld } from '../src/f4/seed.js';

const distCli = path.resolve(fileURLToPath(new URL('../dist/cli.js', import.meta.url)));

function write(dir: string, rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}
const read = (dir: string, rel: string): string => fs.readFileSync(path.join(dir, rel), 'utf8');
const count = (hay: string, needle: string): number => hay.split(needle).length - 1;

describe('renderAgentGuide — the exact block (parity contract with Paradigm)', () => {
  it('native: markers, heading, the cycle commands, no trailing newline', () => {
    const t = renderAgentGuide('native');
    expect(t.startsWith(AGENT_GUIDE_BEGIN + '\n## Version control: Warpline\n')).toBe(true);
    expect(t.endsWith('\n' + AGENT_GUIDE_END)).toBe(true);
    expect(t).toContain('`warpline orient`');
    expect(t).toContain('`warpline propose --agent <you> --native -m "<why>"`');
    expect(t).toContain('`warpline admit <you> --native`');
    expect(t).toContain('Only a human runs `warpline resolve`.');
    expect(t.split('\n')).toHaveLength(8);
  });

  it('git: same markers and heading, the git paragraph', () => {
    const t = renderAgentGuide('git');
    expect(t.split('\n')).toEqual([
      AGENT_GUIDE_BEGIN,
      '## Version control: Warpline',
      expect.stringContaining('This project uses git plus Warpline'),
      AGENT_GUIDE_END,
    ]);
    expect(t).toContain('`warpline mirror status`');
    expect(t).not.toContain('warpline fork');
  });

  it('is exported from the package entry', () => {
    expect(pkg.renderAgentGuide('native')).toBe(renderAgentGuide('native'));
    expect(typeof pkg.ensureAgentGuide).toBe('function');
    expect(typeof pkg.orient).toBe('function');
  });
});

describe('initWarpline writes the agent guide', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-guide-'));
    write(root, 'src/mod.ts', 'export function foo() { return 1; }\n');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('native: creates AGENTS.md with the block, skips an absent CLAUDE.md, and status right after init is clean', async () => {
    const r = await initWarpline(root);
    expect(r.agentGuide).toEqual({ mode: 'native', agentsMd: 'created', claudeMd: 'skipped', notes: [] });
    expect(read(root, 'AGENTS.md')).toBe(renderAgentGuide('native') + '\n');
    expect(fs.existsSync(path.join(root, 'CLAUDE.md'))).toBe(false);

    const st = await nativeStatus(root);
    expect(st.changedCount).toBe(0);
    expect(st.onDisk?.filesChanged).toBe(0);
    expect(fs.existsSync(path.join(root, '.git'))).toBe(false);
  });

  it('existing AGENTS.md and CLAUDE.md each get exactly one block; outside text untouched; re-run does not duplicate', async () => {
    const agentsBefore = '# Agents\n\nHouse rules here.\n';
    const claudeBefore = '# Claude\n\nKeep it short.';
    write(root, 'AGENTS.md', agentsBefore);
    write(root, 'CLAUDE.md', claudeBefore);

    const r1 = await initWarpline(root);
    expect(r1.agentGuide?.agentsMd).toBe('updated');
    expect(r1.agentGuide?.claudeMd).toBe('updated');
    const agents1 = read(root, 'AGENTS.md');
    const claude1 = read(root, 'CLAUDE.md');
    expect(agents1.startsWith(agentsBefore)).toBe(true);
    expect(claude1.startsWith(claudeBefore)).toBe(true);
    expect(count(agents1, AGENT_GUIDE_BEGIN)).toBe(1);
    expect(count(claude1, AGENT_GUIDE_BEGIN)).toBe(1);

    const r2 = await initWarpline(root);
    expect(r2.alreadyInitialized).toBe(true);
    expect(r2.agentGuide?.agentsMd).toBe('unchanged');
    expect(r2.agentGuide?.claudeMd).toBe('unchanged');
    expect(read(root, 'AGENTS.md')).toBe(agents1);
    expect(read(root, 'CLAUDE.md')).toBe(claude1);
  });

  it('replaces only the text between the markers, byte-preserving everything around it', () => {
    const before = 'top line\n\n';
    const after = '\n\n## Mine\nbottom line\n';
    write(root, 'AGENTS.md', `${before}${AGENT_GUIDE_BEGIN}\nstale words\n${AGENT_GUIDE_END}${after}`);
    const r = ensureAgentGuide(root, 'native');
    expect(r.agentsMd).toBe('updated');
    expect(read(root, 'AGENTS.md')).toBe(before + renderAgentGuide('native') + after);
    expect(ensureAgentGuide(root, 'native').agentsMd).toBe('unchanged');
  });

  it('agentGuide:false (CLI --no-agent-guide) writes nothing', async () => {
    write(root, 'CLAUDE.md', 'untouched\n');
    const r = await initWarpline(root, { agentGuide: false });
    expect(r.agentGuide).toBeNull();
    expect(fs.existsSync(path.join(root, 'AGENTS.md'))).toBe(false);
    expect(read(root, 'CLAUDE.md')).toBe('untouched\n');
  });

  it('git mode (a .git present) renders the git text', async () => {
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    const r = await initWarpline(root);
    expect(r.agentGuide?.mode).toBe('git');
    expect(read(root, 'AGENTS.md')).toBe(renderAgentGuide('git') + '\n');
  });

  it('a begin marker with no end is left alone and reported', () => {
    const text = `keep\n${AGENT_GUIDE_BEGIN}\nhalf a block, user text below\nmore user text\n`;
    write(root, 'AGENTS.md', text);
    const r = ensureAgentGuide(root, 'native');
    expect(r.agentsMd).toBe('skipped');
    expect(r.notes.join(' ')).toContain('AGENTS.md');
    expect(read(root, 'AGENTS.md')).toBe(text);
  });

  it('a CRLF file gets a CRLF block, and re-running is unchanged', () => {
    write(root, 'CLAUDE.md', '# Claude\r\nrules\r\n');
    expect(ensureAgentGuide(root, 'native').claudeMd).toBe('updated');
    const t = read(root, 'CLAUDE.md');
    expect(t).toBe('# Claude\r\nrules\r\n\r\n' + renderAgentGuide('native').replace(/\n/g, '\r\n') + '\r\n');
    expect(t.replace(/\r\n/g, '').includes('\n')).toBe(false);
    expect(ensureAgentGuide(root, 'native').claudeMd).toBe('unchanged');
  });
});

describe('`warpline init` over the real binary — agent guide line and --no-agent-guide', () => {
  const haveDist = fs.existsSync(distCli);
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-guide-bin-'));
    write(root, 'src/mod.ts', 'export function foo() { return 1; }\n');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const cli = async (...args: string[]): Promise<{ code: number; stdout: string }> => {
    try {
      const { stdout } = await promisify(execFile)('node', [distCli, '--root', root, ...args], { cwd: root, encoding: 'utf8' });
      return { code: 0, stdout };
    } catch (e) {
      const err = e as { code?: number; stdout?: string };
      return { code: err.code ?? 1, stdout: err.stdout ?? '' };
    }
  };

  it.runIf(haveDist)('init reports the guide and points agents at orient', async () => {
    const r = await cli('init');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('agent guide  AGENTS.md created');
    expect(r.stdout).toContain('warpline orient');
    expect(r.stdout).not.toContain('it is the manual');
    // the KNOT line prints the resolve form that works for the native cycle (same as orient)
    expect(r.stdout).toContain('warpline resolve <agent> --native -m "<decision>"');
    expect(fs.existsSync(path.join(root, 'AGENTS.md'))).toBe(true);
  }, 120_000);

  it.runIf(haveDist)('init --no-agent-guide writes no AGENTS.md', async () => {
    const r = await cli('init', '--no-agent-guide', '--json');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).agentGuide).toBeNull();
    expect(fs.existsSync(path.join(root, 'AGENTS.md'))).toBe(false);
  }, 120_000);
});

describe('F4 seedWorld ships exactly what init ships (D2: cold = what init ships)', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-guide-seed-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('a seeded native world has AGENTS.md with the block, sealed into genesis', async () => {
    await seedWorld({ root });
    expect(read(root, 'AGENTS.md')).toBe(renderAgentGuide('native') + '\n');
    // built THROUGH init: the starter .warpignore is there too
    expect(read(root, '.warpignore')).toContain('# dist/');
    expect(fs.existsSync(path.join(root, 'CLAUDE.md'))).toBe(false);
    const st = await nativeStatus(root);
    expect(st.changedCount).toBe(0);
    expect(st.onDisk?.filesChanged).toBe(0);
  });

  it('a seeded world with a CLAUDE.md gets the block there too', async () => {
    write(root, 'CLAUDE.md', '# rules\n');
    await seedWorld({ root });
    expect(count(read(root, 'CLAUDE.md'), AGENT_GUIDE_BEGIN)).toBe(1);
  });
});

describe('agent guide — marker safety (whole lines, outside fences)', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-guide-mark-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  const block = renderAgentGuide('native');

  it('an inline mention of the begin marker before the real block is not a marker', () => {
    const prefix = 'Paradigm keeps text between `<!-- warpline:begin -->` and the end marker.\n\nkeep me\n\n';
    write(root, 'AGENTS.md', `${prefix}${AGENT_GUIDE_BEGIN}\nold words\n${AGENT_GUIDE_END}\ntail\n`);
    expect(ensureAgentGuide(root, 'native').agentsMd).toBe('updated');
    expect(read(root, 'AGENTS.md')).toBe(`${prefix}${block}\ntail\n`);
  });

  it('markers inside a code fence are an example, not a block — a real block is appended', () => {
    const fenced = '# Setup\n\n```md\n' + AGENT_GUIDE_BEGIN + '\nexample\n' + AGENT_GUIDE_END + '\n```\n';
    write(root, 'AGENTS.md', fenced);
    expect(ensureAgentGuide(root, 'native').agentsMd).toBe('updated');
    expect(read(root, 'AGENTS.md')).toBe(fenced + '\n' + block + '\n');
    expect(ensureAgentGuide(root, 'native').agentsMd).toBe('unchanged');
  });

  it('a ~~~ example nested in a ``` fence is never overwritten; the real block after it is', () => {
    const example = '```md\n~~~\n' + AGENT_GUIDE_BEGIN + '\nexample stays\n' + AGENT_GUIDE_END + '\n~~~\n```\n';
    write(root, 'AGENTS.md', `${example}${AGENT_GUIDE_BEGIN}\nold\n${AGENT_GUIDE_END}\n`);
    expect(ensureAgentGuide(root, 'native').agentsMd).toBe('updated');
    expect(read(root, 'AGENTS.md')).toBe(`${example}${block}\n`);
  });

  it('a file ending inside an unclosed fence is skipped — never appended into the fence, run after run', () => {
    const text = '# Notes\n\n```\nsome code, never closed\n';
    write(root, 'AGENTS.md', text);
    for (let i = 0; i < 2; i++) {
      const r = ensureAgentGuide(root, 'native');
      expect(r.agentsMd).toBe('skipped');
      expect(r.notes.join(' ')).toContain('unclosed');
      expect(read(root, 'AGENTS.md')).toBe(text);
    }
  });

  it('indented / trailing-space markers count (trimmed, like Paradigm); the whitespace around stays', () => {
    write(root, 'AGENTS.md', `top\n  ${AGENT_GUIDE_BEGIN}  \nold\n${AGENT_GUIDE_END}   \nbottom\n`);
    expect(ensureAgentGuide(root, 'native').agentsMd).toBe('updated');
    expect(read(root, 'AGENTS.md')).toBe(`top\n  ${block}   \nbottom\n`);
    expect(ensureAgentGuide(root, 'native').agentsMd).toBe('unchanged');
  });

  it('an end marker with no begin is skipped, not appended after', () => {
    const text = `x\n${AGENT_GUIDE_END}\n`;
    write(root, 'AGENTS.md', text);
    expect(ensureAgentGuide(root, 'native').agentsMd).toBe('skipped');
    expect(read(root, 'AGENTS.md')).toBe(text);
  });

  it('an interrupted write\'s temp file is a built-in skip, so it is never sealed', async () => {
    await initWarpline(root);
    expect(loadWarpignore(root).isIgnored('.AGENTS.md.warpline-tmp.123.0')).toBe(true);
    expect(loadWarpignore(root).isIgnored('docs/.CLAUDE.md.warpline-tmp.9.4')).toBe(true);
    expect(loadWarpignore(root).isIgnored('AGENTS.md')).toBe(false);
    write(root, '.AGENTS.md.warpline-tmp.123.0', 'half written');
    const st = await nativeStatus(root);
    expect(st.onDisk?.filesChanged).toBe(0);
  });

  it('two blocks: the file is skipped with a note and left byte-identical', () => {
    const two = `${AGENT_GUIDE_BEGIN}\na\n${AGENT_GUIDE_END}\nmine\n${AGENT_GUIDE_BEGIN}\nb\n${AGENT_GUIDE_END}\n`;
    write(root, 'AGENTS.md', two);
    const r = ensureAgentGuide(root, 'native');
    expect(r.agentsMd).toBe('skipped');
    expect(r.notes.join(' ')).toMatch(/AGENTS\.md has 2 /);
    expect(read(root, 'AGENTS.md')).toBe(two);
  });

  it('a UTF-8 BOM is preserved, with or without an existing block', () => {
    write(root, 'AGENTS.md', '\uFEFF# Agents\n');
    ensureAgentGuide(root, 'native');
    expect(read(root, 'AGENTS.md')).toBe('\uFEFF# Agents\n\n' + block + '\n');
    write(root, 'CLAUDE.md', `\uFEFF${AGENT_GUIDE_BEGIN}\nold\n${AGENT_GUIDE_END}\n`);
    expect(ensureAgentGuide(root, 'native').claudeMd).toBe('updated');
    expect(read(root, 'CLAUDE.md')).toBe('\uFEFF' + block + '\n');
    expect(ensureAgentGuide(root, 'native')).toMatchObject({ agentsMd: 'unchanged', claudeMd: 'unchanged' });
  });

  it('an empty file gets just the block', () => {
    write(root, 'AGENTS.md', '');
    expect(ensureAgentGuide(root, 'native').agentsMd).toBe('updated');
    expect(read(root, 'AGENTS.md')).toBe(block + '\n');
  });

  it('CLAUDE.md symlinked to AGENTS.md is one file: written once, the link survives', () => {
    try {
      fs.symlinkSync('AGENTS.md', path.join(root, 'CLAUDE.md'));
    } catch {
      return; // no symlink privilege (Windows without developer mode) — nothing to test
    }
    write(root, 'AGENTS.md', '# shared\n');
    const r = ensureAgentGuide(root, 'native');
    expect(r.agentsMd).toBe('updated');
    expect(r.claudeMd).toBe('unchanged');
    expect(fs.lstatSync(path.join(root, 'CLAUDE.md')).isSymbolicLink()).toBe(true);
    expect(count(read(root, 'AGENTS.md'), AGENT_GUIDE_BEGIN)).toBe(1);
  });

  it('writes atomically — no temp file is left behind', () => {
    write(root, 'AGENTS.md', '# a\n');
    ensureAgentGuide(root, 'native');
    expect(fs.readdirSync(root).filter((n) => n.includes('warpline-tmp'))).toEqual([]);
  });

  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  it.skipIf(isRoot)('a read-only CLAUDE.md is skipped with a note; init still succeeds and still guards .gitignore', async () => {
    fs.mkdirSync(path.join(root, '.git'));
    write(root, 'CLAUDE.md', '# locked\n');
    fs.chmodSync(path.join(root, 'CLAUDE.md'), 0o444);
    try {
      const r = await initWarpline(root);
      expect(r.agentGuide?.claudeMd).toBe('skipped');
      expect(r.agentGuide?.notes.join(' ')).toContain('CLAUDE.md is not writable');
      expect(read(root, 'CLAUDE.md')).toBe('# locked\n');
      fs.rmSync(path.join(root, '.gitignore'));
      const again = await initWarpline(root);
      expect(again.gitignore.action).toBe('created');
    } finally {
      fs.chmodSync(path.join(root, 'CLAUDE.md'), 0o644);
    }
  });

  it('a subdirectory of a git work tree is git mode', () => {
    fs.mkdirSync(path.join(root, '.git'));
    fs.mkdirSync(path.join(root, 'pkg', 'inner'), { recursive: true });
    expect(agentGuideModeOf(path.join(root, 'pkg', 'inner'))).toBe('git');
  });
});

describe('F4 rows stamp the agent-guide epoch', () => {
  it('every emitted row carries agentGuideId', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-guide-f4-'));
    try {
      new F4Tracer(root, 'cli', 'subject').emit({ verb: 'fork', target: null, ok: true });
      const rows = fs.readFileSync(f4TracePathOf(root), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      expect(rows).toHaveLength(1);
      expect(rows[0].agentGuideId).toBe(agentGuideId());
      expect(agentGuideId()).toMatch(/^agentGuide:v1:[0-9a-f]{64}$/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
