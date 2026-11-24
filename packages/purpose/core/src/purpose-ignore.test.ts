/**
 * What .purpose discovery ignores. The glob list and the path predicate are two
 * forms of one policy and must agree on every path.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  findPurposeFiles,
  isPurposePathIgnored,
  DEFAULT_PURPOSE_IGNORE,
  PURPOSE_IGNORE_DIR_NAMES,
  PURPOSE_IGNORE_ROOT_DIRS,
} from './aggregator.js';

let tmpDir: string;

function write(rel: string): void {
  const abs = path.join(tmpDir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'description: x\n');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'purpose-ignore-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const KEPT = [
  '.purpose',
  '.github/actions/.purpose',
  '.github/workflows/.purpose',
  '.paradigm/agents/.purpose',
  'packages/api/.purpose',
  // only the listed .paradigm record directories are skipped
  '.paradigm/specs/.purpose',
  // a root-relative rule does not apply deeper in the tree
  'packages/api/.claude/.purpose',
];

const IGNORED = [
  '.paradigm/lore/entries/2026-11-24/.purpose',
  '.paradigm/events/.purpose',
  '.paradigm/history/.purpose',
  '.paradigm/work-log/.purpose',
  '.paradigm/research/some-study/.purpose',
  '.claude/worktrees/agent-1/packages/api/.purpose',
  '.warpline/states/.purpose',
  'packages/api/.warpline/.purpose',
  'packages/api/.loom/.purpose',
  '.venv/lib/.purpose',
  'tools/.cache/.purpose',
  'packages/site/.next/standalone/.purpose',
  'packages/site/.turbo/.purpose',
  'packages/api/dist/.purpose',
  'packages/api/build/.purpose',
  'packages/swift/.build/.purpose',
  'packages/api/node_modules/dep/.purpose',
  'packages/api/coverage/.purpose',
  '.worktrees/x/.purpose',
];

describe('.purpose discovery ignore policy', () => {
  it('pins the two lists the globs are derived from', () => {
    expect([...PURPOSE_IGNORE_DIR_NAMES]).toEqual([
      'node_modules', 'dist', '.git', '.worktrees', '.warpline', '.loom', 'build', '.build',
      'coverage', '.next', '.turbo', '.venv', '.cache', 'Pods', 'DerivedData',
    ]);
    expect([...PURPOSE_IGNORE_ROOT_DIRS]).toEqual([
      '.claude', '.paradigm/lore', '.paradigm/events', '.paradigm/history', '.paradigm/work-log', '.paradigm/research',
    ]);
    expect(DEFAULT_PURPOSE_IGNORE).toContain('**/.warpline/**');
    expect(DEFAULT_PURPOSE_IGNORE).toContain('.paradigm/lore/**');
    expect(DEFAULT_PURPOSE_IGNORE).toHaveLength(PURPOSE_IGNORE_DIR_NAMES.length + PURPOSE_IGNORE_ROOT_DIRS.length);
  });

  it('finds .purpose files under tracked dot-directories and skips records, tool state and copies', async () => {
    for (const rel of [...KEPT, ...IGNORED]) write(rel);
    const found = (await findPurposeFiles(tmpDir))
      .map((abs) => path.relative(tmpDir, abs).split(path.sep).join('/'))
      .sort();
    expect(found).toEqual([...KEPT].sort());
  });

  it('the path predicate agrees with the glob on every path', () => {
    for (const rel of KEPT) expect(isPurposePathIgnored(rel), rel).toBe(false);
    for (const rel of IGNORED) expect(isPurposePathIgnored(rel), rel).toBe(true);
  });

  it('a file merely named like an ignored directory is not ignored', () => {
    // the last segment is the file, never a directory
    expect(isPurposePathIgnored('packages/build')).toBe(false);
    expect(isPurposePathIgnored('src/builder/.purpose')).toBe(false);
  });
});
