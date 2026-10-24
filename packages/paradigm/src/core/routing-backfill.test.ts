import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';

import { writeRoutingBackfill, buildRoutingTable, ROUTING_FILE, parseLog, parseReverts, parseSymbolsTrailer } from './routing-backfill.js';

let root: string;

function git(...args: string[]): void {
  execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
    stdio: 'ignore',
  });
}
function commit(msg: string, file = 'f.txt'): void {
  fs.appendFileSync(path.join(root, file), 'x\n');
  git('add', '-A');
  git('commit', '-m', msg);
}
function head(): string {
  return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'routing-backfill-'));
  git('init', '-q');
  fs.mkdirSync(path.join(root, 'pkg', 'a'), { recursive: true });
  fs.writeFileSync(path.join(root, 'pkg', 'a', '.purpose'), 'version: 2.0.0\ncomponents:\n  alpha:\n    description: a\n');
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('routing backfill', () => {
  it('handles an empty history', () => {
    const t = buildRoutingTable(root);
    expect(t.builtFrom.headSha).toBeNull();
    expect(t.areas).toEqual({});
  });

  it('counts fixes and reverts per owning area, tolerating missing trailers', () => {
    commit('feat(#alpha): add\n\nSymbols: #alpha');
    commit('fix(#alpha): bug\r\n\r\nSymbols: #alpha, #ghost');
    commit('chore: no trailer');
    const first = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD~2'], { encoding: 'utf8' }).trim();
    commit(`Revert "feat"\n\nThis reverts commit ${first}.`);
    const { table, file } = writeRoutingBackfill(root);
    expect(file).toBe(path.join(root, ...ROUTING_FILE.split('/')));
    expect(table.builtFrom.headSha).toBe(head());
    expect(table.kind).toBe('history-only');
    expect(table.cutoffSha).toBe(head());
    expect(table.areas['pkg/a']).toMatchObject({ commits: 3, reworkOrRevert: 2, byType: { fix: 1, revert: 1 } });
    expect(table.areas['(unowned)']).toMatchObject({ commits: 1, reworkOrRevert: 1, byType: { fix: 1, revert: 0 }, unowned: true });
    expect(table.areas['pkg/a'].unowned).toBeUndefined();
    expect(table.coverage).toMatchObject({ commitsTotal: 4, commitsWithTrailer: 2, commitsSkippedNoTrailer: 2, commitsUnique: 3, purposeFilesSkipped: 0 });
    const text = fs.readFileSync(file, 'utf8');
    expect(text).not.toContain('bug');
    expect(text).not.toContain('\r');
  });

  it('writes an empty areas map when no commit has a trailer', () => {
    commit('feat: plain');
    expect(buildRoutingTable(root).areas).toEqual({});
  });

  it('is idempotent', () => {
    commit('fix(#alpha): x\n\nSymbols: #alpha');
    const a = writeRoutingBackfill(root).file;
    const one = fs.readFileSync(a, 'utf8');
    writeRoutingBackfill(root);
    expect(fs.readFileSync(a, 'utf8')).toBe(one);
  });

  it('parses multi-line records without splitting on newlines', () => {
    const cs = parseLog('abc\x012024-01-01T00:00:00Z\x01subj\n\nbody\nSymbols: #a\0def\x012024-01-02T00:00:00Z\x01two\r\n\r\nSymbols: #b\0');
    expect(cs.map((c) => [c.sha, c.subject, c.symbols])).toEqual([
      ['abc', 'subj', ['#a']],
      ['def', 'two', ['#b']],
    ]);
  });

  it('only honours trailers and reverts in the final block', () => {
    expect(parseSymbolsTrailer('subj\n\nSymbols: #a\n\nprose after')).toEqual([]);
    expect(parseSymbolsTrailer('Symbols: #a')).toEqual([]);
    expect(parseReverts('subj\n\nThe docs say "This reverts commit abcdef1" here')).toEqual([]);
    expect(parseReverts('subj\n\n> This reverts commit abcdef1\n\nmore')).toEqual([]);
    expect(parseReverts('subj\n\nThis reverts commit abcdef1.')).toEqual(['abcdef1']);
    expect(parseReverts('subj\n\nThis reverts commit abcdef1.\n\nSymbols: #a')).toEqual(['abcdef1']);
    expect(parseReverts('subj\n\nThis reverts commit abcdef1.\n\nplain prose\n\nlast')).toEqual([]);
  });

  it('skips oversized and non-regular .purpose files and counts them', () => {
    fs.mkdirSync(path.join(root, 'big'));
    fs.writeFileSync(path.join(root, 'big', '.purpose'), 'components:\n  big:\n    description: ' + 'x'.repeat(1024 * 1024 + 10) + '\n');
    fs.mkdirSync(path.join(root, 'dirlink'));
    try {
      fs.symlinkSync(path.join(root, 'pkg', 'a', '.purpose'), path.join(root, 'dirlink', '.purpose'));
    } catch {
      /* symlinks unavailable on this platform */
    }
    commit('feat(#big): x\n\nSymbols: #big');
    const t = buildRoutingTable(root);
    expect(t.coverage.purposeFilesSkipped).toBeGreaterThanOrEqual(1);
    expect(t.areas['(unowned)']).toBeDefined();
    expect(t.areas['big']).toBeUndefined();
  });

  it('reports dates and settle-lag censoring deterministically from commit data', () => {
    const dated = (msg: string, iso: string): void => {
      fs.appendFileSync(path.join(root, 'f.txt'), 'x\n');
      git('add', '-A');
      execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-m', msg], {
        stdio: 'ignore',
        env: { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso },
      });
    };
    dated('feat(#alpha): old\n\nSymbols: #alpha', '2023-12-20T00:00:00Z');
    dated('feat(#alpha): new\n\nSymbols: #alpha', '2024-01-10T00:00:00Z');
    const one = JSON.stringify(buildRoutingTable(root));
    const t = JSON.parse(one);
    expect(t.cutoffDate).toBe('2024-01-10T00:00:00.000Z');
    expect(t.areas['pkg/a']).toMatchObject({ commits: 2, lastCommitDate: '2024-01-10T00:00:00.000Z', settledCommits: 1 });
    expect(JSON.stringify(buildRoutingTable(root))).toBe(one);
  });
});
