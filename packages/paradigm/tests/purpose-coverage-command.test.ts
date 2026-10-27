/**
 * `paradigm purpose coverage` — the shared coverage rule (#purpose-coverage)
 * as the Stop hook consumes it: one tab-separated line per directory.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { purposeCoverageCommand, computePurposeCoverage } from '../src/commands/purpose/coverage.js';
import { loadTasks } from '../../paradigm-mcp/src/utils/task-loader.js';
import { PURPOSE_COVERAGE_TASK_TAG } from '../../paradigm-mcp/src/utils/purpose-coverage-queue.js';

let root: string;

function write(rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-purpose-coverage-'));
  write('pkg/.purpose', 'description: The pkg package.\ncomponents:\n  pkg-cli:\n    description: CLI in src/cli/a.ts.\n');
  write('pkg/src/cli/a.ts', '');
  write('pkg/scripts/b.ts', '');
  write('pkg/core/.purpose', '# Auto-generated .purpose stub — update with real descriptions\ncomponents:\n  core:\n    description: "TODO: describe this component"\n');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('paradigm purpose coverage', () => {
  it('prints <dir>\\t(covered|uncovered)\\t<file|-> per directory, deduped', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((c: unknown) => {
      lines.push(...String(c).split('\n').filter(Boolean));
      return true;
    }) as never);
    try {
      await purposeCoverageCommand(['pkg/src/cli', 'pkg/scripts', 'pkg/core', 'pkg/src/cli/'], { root });
    } finally {
      spy.mockRestore();
    }
    expect(lines).toEqual([
      'pkg/src/cli\tcovered\tpkg/.purpose',
      'pkg/scripts\tuncovered\t-',
      'pkg/core\tuncovered\t-',
    ]);
  });

  it('--queue files uncovered dirs as one deduped purpose-coverage task and writes no .purpose', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((c: unknown) => {
      lines.push(...String(c).split('\n').filter(Boolean));
      return true;
    }) as never);
    try {
      await purposeCoverageCommand(['pkg/src/cli', 'pkg/scripts'], { root, queue: true, source: 'stop-hook' });
      await purposeCoverageCommand(['pkg/scripts'], { root, queue: true, source: 'stop-hook' });
    } finally {
      spy.mockRestore();
    }
    const queued = lines.filter(l => l.startsWith('#queued\t'));
    expect(queued).toHaveLength(1); // second call: already queued
    const tasks = await loadTasks(root, { status: 'all', tag: PURPOSE_COVERAGE_TASK_TAG });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].blurb).toContain('pkg/scripts');
    expect(tasks[0].blurb).not.toContain('pkg/src/cli');
    expect(fs.existsSync(path.join(root, 'pkg/scripts/.purpose'))).toBe(false);
  });

  it('--require-own: an ancestor-documented dir is uncovered', () => {
    const [cli] = computePurposeCoverage(root, ['pkg/src/cli'], { requireOwn: true });
    expect(cli.covered).toBe(false);
  });

  it('reports placeholders in the JSON records', () => {
    const [core] = computePurposeCoverage(root, ['pkg/core']);
    expect(core.covered).toBe(false);
    expect(core.placeholders).toEqual(['pkg/core/.purpose']);
  });
});
