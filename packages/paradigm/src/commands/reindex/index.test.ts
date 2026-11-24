/**
 * `paradigm reindex` rebuilds the symbol index from the command line with the
 * same implementation as the MCP tool `paradigm_reindex`, and doctor names it
 * (not bare `paradigm scan`, which only prints usage) when the index is missing.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { reindexCommand } from './index.js';
import { rebuildStaticFiles, summarizeRebuild } from '../../../../paradigm-mcp/src/tools/reindex.js';
import { doctorCommand } from '../doctor/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));

let tmp: string | undefined;
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

/** A minimal Paradigm project with one declared component. */
function project(): string {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-reindex-'));
  fs.mkdirSync(path.join(tmp, '.paradigm'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.paradigm', 'config.yaml'), 'version: "2.0"\nproject: demo\n', 'utf8');
  fs.writeFileSync(
    path.join(tmp, '.purpose'),
    'version: 2.0.0\ndescription: Demo project\ncomponents:\n  ledger-writer:\n    description: Writes the ledger\n',
    'utf8',
  );
  return tmp;
}

/** Capture what the cli-output helpers write. */
function capture(): { stdout: () => string; stderr: () => string } {
  const o: string[] = [];
  const e: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => { o.push(String(c)); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation((c: unknown) => { e.push(String(c)); return true; });
  return { stdout: () => o.join(''), stderr: () => e.join('') };
}

describe('paradigm reindex', () => {
  it('writes .paradigm/scan-index.json containing the declared component', async () => {
    const root = project();
    const io = capture();
    const ok = await reindexCommand(root, {});
    expect(ok).toBe(true);
    const indexPath = path.join(root, '.paradigm', 'scan-index.json');
    expect(fs.existsSync(indexPath)).toBe(true);
    expect(fs.readFileSync(indexPath, 'utf8')).toContain('ledger-writer');
    expect(fs.existsSync(path.join(root, '.paradigm', 'navigator.yaml'))).toBe(true);
    expect(io.stdout()).toContain('Symbol index rebuilt');
    expect(io.stdout()).toContain('.paradigm/scan-index.json');
  });

  it('--json prints the same summary the MCP tool returns', async () => {
    const root = project();
    const io = capture();
    await reindexCommand(root, { json: true });
    const printed = JSON.parse(io.stdout()) as Record<string, unknown>;
    vi.restoreAllMocks();
    const expected = summarizeRebuild(await rebuildStaticFiles(root));
    expect(printed.success).toBe(true);
    expect(printed.symbolCount).toBe(expected.symbolCount);
    expect(printed.breakdown).toEqual(expected.breakdown);
    expect(Object.keys(printed).sort()).toEqual(Object.keys(expected).sort());
    expect(Number(printed.symbolCount)).toBeGreaterThan(0);
  });

  it('--quiet prints nothing on success', async () => {
    const root = project();
    const io = capture();
    expect(await reindexCommand(root, { quiet: true })).toBe(true);
    expect(io.stdout()).toBe('');
  });

  it('refuses to run outside a Paradigm project and creates nothing', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-reindex-empty-'));
    const io = capture();
    const ok = await reindexCommand(tmp, {});
    expect(ok).toBe(false);
    expect(process.exitCode).toBe(1);
    expect(io.stderr()).toContain('not a Paradigm project');
    expect(io.stdout()).toContain('paradigm shift');
    expect(fs.existsSync(path.join(tmp, '.paradigm'))).toBe(false);
  });

  it('is registered as a top-level command', () => {
    const src = fs.readFileSync(path.join(here, '..', '..', 'index.ts'), 'utf8');
    expect(src).toContain(".command('reindex [path]')");
    expect(src).toContain("import('./commands/reindex/index.js')");
  });
});

describe('doctor names the command that rebuilds the index', () => {
  it('a project with no scan-index.json is told to run `paradigm reindex`', async () => {
    const root = project();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-reindex-home-'));
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { lines.push(a.join(' ')); });
    try {
      await doctorCommand({ rootDir: root, homeDir: home });
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
    const text = lines.join('\n');
    expect(text).toMatch(/scan-index\.json[\s\S]*?Fix: paradigm reindex/);
    expect(text).not.toContain('Fix: paradigm index');
    expect(text).not.toContain('run paradigm scan first');
  });
});
