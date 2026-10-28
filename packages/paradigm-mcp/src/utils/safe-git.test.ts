/**
 * #safe-git / #aspect-graph — anchor paths and commit ids are repo content and
 * never reach a shell. A file named with `$(…)` and backticks, anchored in a
 * .purpose aspect, goes through drift without running anything, and the diff
 * still maps the shifted lines.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import type { SymbolEntry } from '@a-company/premise-core';
import { parseAnchorString } from '@a-company/premise-core';
import { openAspectGraph, closeAspectGraph, materializeAspects, checkDrift, computeLineShift } from './aspect-graph.js';
import { detectFileRename } from './aspect-fingerprint.js';
import { gitDiffSinceCommit, isCommitSha } from './safe-git.js';

const MARKERS = ['PWNED_SUBSHELL', 'PWNED_BACKTICK', 'PWNED_RENAME'];
// A file name that runs two commands if it is ever spliced into a shell string.
const EVIL = 'evil$(touch PWNED_SUBSHELL)`touch PWNED_BACKTICK`.ts';
const BODY = Array.from({ length: 10 }, (_, i) => `const line${i + 1} = ${i + 1};`).join('\n') + '\n';

let root: string;
const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const head = (): string => git('rev-parse', 'HEAD').trim();
const noMarkers = (): void => {
  for (const m of MARKERS) {
    expect(fs.existsSync(path.join(root, m)), `${m} in fixture`).toBe(false);
    expect(fs.existsSync(path.join(process.cwd(), m)), `${m} in cwd`).toBe(false);
  }
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-git-'));
  git('init', '--quiet');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  git('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(root, EVIL), BODY);
  git('add', '-A');
  git('commit', '--quiet', '-m', 'init');
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

function aspect(anchors: string[]): SymbolEntry {
  return {
    id: 'purpose-aspect-evil', symbol: '~evil-rule', type: 'aspect', source: 'purpose',
    filePath: path.join(root, '.purpose'), data: {}, description: 'rule', references: [], referencedBy: [],
    anchors: anchors.map((a) => parseAnchorString(a)),
  } as SymbolEntry;
}

describe('aspect drift with a hostile anchor path', () => {
  it('runs no command and still maps the shifted lines through git diff', async () => {
    fs.writeFileSync(path.join(root, '.purpose'), `aspects:\n  ~evil-rule:\n    anchors:\n      - "${EVIL}:3-5"\n`);
    const db = await openAspectGraph(root);
    materializeAspects(db, [aspect([`${EVIL}:3-5`])], root);
    // The first check stores the baseline hashes.
    expect(checkDrift(db, root, undefined, false).map((d) => d.status)).toEqual(['clean']);

    // Two lines inserted above the anchor, committed, so the diff has a hunk.
    fs.writeFileSync(path.join(root, EVIL), '// one\n// two\n' + BODY);
    git('commit', '--quiet', '-am', 'shift');

    const drift = checkDrift(db, root, undefined, false);
    closeAspectGraph(db);

    noMarkers();
    expect(drift).toHaveLength(1);
    expect(drift[0].status).toBe('shifted');
    expect(drift[0].resolvedBy).toBe('git-line-mapping');
    expect(drift[0].suggestedStart).toBe(5);
    expect(drift[0].suggestedEnd).toBe(7);
  });

  it('computeLineShift diffs the hostile path directly', () => {
    const from = head();
    fs.writeFileSync(path.join(root, EVIL), '// one\n' + BODY);
    git('commit', '--quiet', '-am', 'shift');
    expect(computeLineShift(root, EVIL, from, 3, 5)).toEqual({ originalStart: 3, originalEnd: 5, currentStart: 4, currentEnd: 6 });
    noMarkers();
  });

  it('detectFileRename runs git log on a hostile path without running anything', () => {
    // git log --follow walks back from the path it is given, so the rename row
    // is found when following the hostile (current) name.
    const hostile = 'new$(touch PWNED_RENAME)`touch PWNED_BACKTICK`.ts';
    fs.writeFileSync(path.join(root, 'plain.ts'), BODY + '// unique\n');
    git('add', '-A');
    git('commit', '--quiet', '-m', 'add plain');
    git('mv', '--', 'plain.ts', hostile);
    git('commit', '--quiet', '-m', 'rename');
    expect(detectFileRename(root, hostile)).toBe(hostile);
    expect(detectFileRename(root, 'never-existed$(touch PWNED_RENAME).ts')).toBeNull();
    noMarkers();
  });
});

describe('commit ids are validated before use', () => {
  it('accepts hex object names only', () => {
    expect(isCommitSha('a1b2c3d')).toBe(true);
    expect(isCommitSha('0123456789abcdef0123456789abcdef01234567')).toBe(true);
    for (const bad of ['HEAD', 'HEAD~1', 'main', 'abc12', 'A1B2C3D', '--output=/tmp/x', 'a1b2c3d;touch x', 'a1b2c3d..HEAD', '', null, 42]) {
      expect(isCommitSha(bad), String(bad)).toBe(false);
    }
  });

  it('refuses a non-hex fromCommit: no git call, no diff, no mapping', () => {
    const marker = path.join(root, 'PWNED_REF');
    expect(gitDiffSinceCommit(root, `HEAD; touch ${marker}`, EVIL)).toBeNull();
    expect(gitDiffSinceCommit(root, '--output=' + marker, EVIL)).toBeNull();
    expect(gitDiffSinceCommit(root, 'HEAD', EVIL)).toBeNull();
    expect(computeLineShift(root, EVIL, '$(touch PWNED_REF)', 3, 5)).toBeNull();
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('a leading-dash anchor path is a path, not an option (no --output file)', () => {
    const from = head();
    const out = path.join(root, 'PWNED_OUTPUT');
    expect(gitDiffSinceCommit(root, from, `--output=${out}`)).toBe('');
    expect(gitDiffSinceCommit(root, from, '--output=/tmp/paradigm-safe-git-PWNED')).toBe('');
    expect(fs.existsSync(out)).toBe(false);
    expect(fs.existsSync('/tmp/paradigm-safe-git-PWNED')).toBe(false);
  });

  it('pathspec magic in an anchor path stays literal', () => {
    const from = head();
    fs.writeFileSync(path.join(root, 'other.ts'), 'x\n');
    git('add', '-A');
    git('commit', '--quiet', '-m', 'other');
    // As a glob pathspec, these would match other.ts and EVIL; literally, no such file exists.
    expect(gitDiffSinceCommit(root, from, ':(glob)**')).toBe('');
    expect(gitDiffSinceCommit(root, from, '*.ts')).toBe('');
    // A real file whose name looks like magic diffs as itself.
    const magic = ':(glob)*.ts';
    fs.writeFileSync(path.join(root, magic), 'm\n');
    git('--literal-pathspecs', 'add', '--', magic);
    git('commit', '--quiet', '-m', 'magic');
    const d = gitDiffSinceCommit(root, from, magic) ?? '';
    expect(d).toContain('+m');
    expect(d).not.toContain('other.ts');
  });

  it('a valid sha still diffs', () => {
    const from = head();
    fs.writeFileSync(path.join(root, EVIL), BODY + '// tail\n');
    git('commit', '--quiet', '-am', 'tail');
    expect(gitDiffSinceCommit(root, from, EVIL)).toContain('+// tail');
    expect(gitDiffSinceCommit(root, from.slice(0, 7), EVIL)).toContain('+// tail');
  });
});
