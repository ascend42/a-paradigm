/**
 * Scoped learning S2: `paradigm internal learn-path` and the hooks' cached
 * `_pm_learn_path` helper (paradigm-resolve.sh).
 * - the CLI resolves machine stores outside the repo, overrides in the repo
 * - without HOME it falls back to the passwd home, never a relative path
 * - the shell cache answers repeat calls without the CLI, and is invalidated
 *   when the repo moves; the helper needs no HOME
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { resolveLearnPath } from '../src/commands/internal/learn-path.js';
import { resetLearningStoreCaches } from '../../paradigm-mcp/src/utils/learning-stores.js';
import { SH, SYS_PATH, baseEnv, pathValue, shellPath, tempDir } from '../src/test-shell-utils.js';

const RESOLVE = path.resolve(__dirname, '..', 'src', 'commands', 'hooks', 'scripts', 'paradigm-resolve.sh');
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  resetLearningStoreCaches();
});

function project(): string {
  const root = tempDir('paradigm-learnpath-');
  dirs.push(root);
  fs.mkdirSync(path.join(root, '.paradigm'), { recursive: true });
  return root;
}

describe('resolveLearnPath (paradigm internal learn-path)', () => {
  it('machine stores resolve outside the repo; overrides stay in the repo; unknown artifacts throw', () => {
    const root = project();
    const funnel = resolveLearnPath('team-funnel', { root });
    expect(path.isAbsolute(funnel)).toBe(true);
    expect(funnel.startsWith(root)).toBe(false);
    expect(funnel.endsWith(path.join('events', 'team-funnel.jsonl'))).toBe(true);
    expect(resolveLearnPath('overrides', { root })).toBe(path.join(root, '.paradigm', 'events', 'overrides.jsonl'));
    expect(() => resolveLearnPath('nope', { root })).toThrow();
    expect(() => resolveLearnPath('team-funnel', { root, home: 'repo' })).not.toThrow();
  });

  it('without HOME or PARADIGM_LEARNING_HOME it falls back safely (absolute, outside the repo)', () => {
    const root = project();
    const prevHome = process.env.HOME;
    const prevLh = process.env.PARADIGM_LEARNING_HOME;
    delete process.env.HOME;
    delete process.env.PARADIGM_LEARNING_HOME;
    try {
      let p: string | null = null;
      try {
        p = resolveLearnPath('hook-timings', { root });
      } catch {
        p = null; // refusing is also safe: the hook then skips its write
      }
      if (p !== null) {
        expect(path.isAbsolute(p)).toBe(true);
        expect(p.startsWith(root)).toBe(false);
      }
    } finally {
      if (prevHome !== undefined) process.env.HOME = prevHome;
      if (prevLh !== undefined) process.env.PARADIGM_LEARNING_HOME = prevLh;
    }
  });
});

describe('_pm_learn_path (hook helper)', () => {
  function stubBin(): { bin: string; calls: string } {
    const bin = tempDir('paradigm-learnpath-bin-');
    dirs.push(bin);
    const calls = path.join(bin, 'calls.log');
    // answers like the CLI: <state>/<repo basename>/<artifact>.jsonl, logging each call
    fs.writeFileSync(path.join(bin, 'paradigm'),
      `#!/bin/sh\necho "$*" >> '${shellPath(calls)}'\nprintf '%s/state/%s/%s.jsonl\\n' '${shellPath(bin)}' "\${5##*/}" "$3"\n`, { mode: 0o755 });
    return { bin, calls };
  }
  // no HOME in the helper's environment
  const helper = (bin: string, root: string, artifact: string) =>
    spawnSync(SH, ['-c', `. '${shellPath(RESOLVE)}'; _pm_learn_path ${artifact} '${shellPath(root)}'`], {
      env: { ...baseEnv(), PATH: pathValue([bin, ...SYS_PATH]) },
      encoding: 'utf8',
    });
  const callCount = (calls: string) => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').length : 0);

  it('caches per root, needs no HOME, and a moved repo misses the cache', () => {
    const { bin, calls } = stubBin();
    const root = project();
    const first = helper(bin, root, 'team-funnel');
    expect(first.status).toBe(0);
    expect(first.stdout.trim()).toBe(`${shellPath(bin)}/state/${path.basename(root)}/team-funnel.jsonl`);
    expect(helper(bin, root, 'team-funnel').stdout).toBe(first.stdout);
    expect(callCount(calls)).toBe(1); // second answer came from .paradigm/.sessions/learn-paths

    const moved = `${root}-moved`;
    fs.renameSync(root, moved);
    dirs.push(moved);
    const after = helper(bin, moved, 'team-funnel');
    expect(after.stdout.trim()).toBe(`${shellPath(bin)}/state/${path.basename(moved)}/team-funnel.jsonl`);
    expect(callCount(calls)).toBe(2);
    const cache = fs.readFileSync(path.join(moved, '.paradigm', '.sessions', 'learn-paths'), 'utf8');
    expect(cache).not.toContain(`${root}\t`); // the stale root's line is dropped
  });

  it('fails (status 1, no output) outside a Paradigm project or when the CLI gives no absolute path', () => {
    const { bin } = stubBin();
    const bare = tempDir('paradigm-learnpath-bare-');
    dirs.push(bare);
    const r = helper(bin, bare, 'team-funnel');
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    const root = project();
    fs.writeFileSync(path.join(bin, 'paradigm'), '#!/bin/sh\necho "[]"\n', { mode: 0o755 });
    const r2 = helper(bin, root, 'team-funnel');
    expect(r2.status).toBe(1);
    expect(r2.stdout).toBe('');
  });
});
