/**
 * `paradigm purpose coverage` — the shared coverage rule (#purpose-coverage)
 * as the Stop hook consumes it: one tab-separated line per directory.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { purposeCoverageCommand, computePurposeCoverage } from '../src/commands/purpose/coverage.js';

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

  it('reports placeholders in the JSON records', () => {
    const [core] = computePurposeCoverage(root, ['pkg/core']);
    expect(core.covered).toBe(false);
    expect(core.placeholders).toEqual(['pkg/core/.purpose']);
  });
});
