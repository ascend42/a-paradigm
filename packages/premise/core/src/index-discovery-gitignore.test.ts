/**
 * T-2026-10-27-003 — the symbol index never reads gitignored build/release
 * output. A packages/gnomon/release/Gnomon.app copy of a .purpose sits deeper
 * than the original, so under depth-ordered last-wins it used to WIN
 * duplicate-symbol resolution.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { aggregateFromDirectory } from './aggregator.js';
import { getLiveIndex, invalidateLiveIndex } from './live-index.js';

const hasGit = spawnSync('git', ['--version']).status === 0;
let tmpDir: string;

function write(rel: string, content: string): void {
  const abs = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

const REAL = 'components:\n  mods-host:\n    description: The real definition.\n';
const COPY = 'components:\n  mods-host:\n    description: A stale release copy.\n';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'premise-gitignore-'));
  write('pkg/mods/.purpose', REAL);
  write('pkg/release/App.app/Contents/Resources/mods/.purpose', COPY);
  write('.gitignore', 'pkg/release/\n');
  if (hasGit) spawnSync('git', ['init', '-q'], { cwd: tmpDir });
});

afterEach(() => {
  invalidateLiveIndex(tmpDir);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function rel(files: string[]): string[] {
  return files.map(f => path.relative(tmpDir, f).split(path.sep).join('/'));
}

describe('index discovery skips gitignored release output', () => {
  it('aggregateFromDirectory never reads the release copy', async () => {
    if (!hasGit) return;
    const result = await aggregateFromDirectory(tmpDir);
    expect(rel(result.purposeFiles)).toEqual(['pkg/mods/.purpose']);
    const sym = result.symbols.find(s => s.symbol === '#mods-host');
    expect(sym?.description).toBe('The real definition.');
    expect(result.duplicateSymbols ?? []).toEqual([]);
  });

  it('the live index never reads the release copy', async () => {
    if (!hasGit) return;
    const live = await getLiveIndex(tmpDir);
    expect(rel(live.result.purposeFiles)).toEqual(['pkg/mods/.purpose']);
    expect(live.result.symbols.find(s => s.symbol === '#mods-host')?.description).toBe('The real definition.');
  });
});
