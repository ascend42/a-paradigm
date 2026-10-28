/**
 * Scoped learning S2: the pre-commit learning guard (#learning-commit-guard,
 * `paradigm internal learning-guard --staged`), the git pre-commit hook that
 * runs it, the doctor lines, and init's visibility setting.
 * Scope (review): learning stores only, added content only, this machine's
 * own paths only; the hook fails open on anything but a real refusal.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  guardedLearningRels,
  isGuardedPath,
  learningGuardOverridden,
  learningGuardViolations,
} from '../../paradigm-mcp/src/utils/learning-commit-guard.js';
import { safeHomeDir } from '../../paradigm-mcp/src/utils/learning-stores.js';
import { learningGuardCommand, runLearningGuard, stagedGuardFiles } from '../src/commands/internal/learning-guard.js';
import { setLearningVisibility } from '../src/commands/init.js';
import { PRE_COMMIT_HOOK } from '../src/commands/hooks/index.js';
import { learningGuardChecks, learnPathSkipChecks } from '../src/commands/doctor/hook-health.js';

const hasGit = spawnSync('git', ['--version']).status === 0;
const HOME = safeHomeDir();
let root: string;
const dirs: string[] = [];
const git = (...args: string[]) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: root, encoding: 'utf8' });
const write = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
};
const stage = (rel: string, content: string) => {
  write(rel, content);
  git('add', rel);
};

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'learning-guard-')));
  dirs.push(root);
  fs.mkdirSync(path.join(root, '.paradigm'), { recursive: true });
});
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('guard scope (registry learning stores only)', () => {
  it('guards learning stores; never decisions, lore, specs, docs, config, remediations, research, graphs or indexes', () => {
    for (const p of [
      '.paradigm/events/verdicts.jsonl', '.paradigm/events/overrides.jsonl', '.paradigm/events/nominations.jsonl',
      '.paradigm/events/team-funnel.jsonl', '.paradigm/events/settlement-liveness.jsonl', '.paradigm/notebooks/a/b.yaml',
      '.paradigm/wisdom/antipatterns.yaml', '.paradigm/agent-state/x.json', '.paradigm/learned/token-estimates.json',
      'packages/x/.paradigm/events/debates.jsonl',
    ]) expect(isGuardedPath(p), p).toBe(true);
    for (const p of [
      '.paradigm/decisions/TD-1.yaml', '.paradigm/lore/entries/2026-01-01/L-1.yaml', '.paradigm/specs/a.yaml',
      '.paradigm/docs/a.yaml', '.paradigm/config.yaml', '.paradigm/remediations/r.yaml', '.paradigm/research/r.json',
      '.paradigm/graphs/g.json', '.paradigm/scan-index.json', '.paradigm/events/stream.jsonl', '.paradigm/notebooks/a.md',
      'src/a.ts',
    ]) expect(isGuardedPath(p), p).toBe(false);
    expect(guardedLearningRels()).not.toContain('decisions');
  });
});

describe('learningGuardViolations (pure)', () => {
  it('blocks an added home:user / home:machine row or entry; a repo row passes', () => {
    const v = learningGuardViolations([
      { path: '.paradigm/events/verdicts.jsonl', content: '', added: ['{"id":1,"home":"repo"}', '{"id":2,"home":"user"}'] },
      { path: '.paradigm/notebooks/a.yaml', content: 'id: a\nhome: machine\n' },
    ]);
    expect(v.map(x => [x.path, x.line, x.rule])).toEqual([
      ['.paradigm/events/verdicts.jsonl', 2, 'home-not-repo'],
      ['.paradigm/notebooks/a.yaml', undefined, 'home-not-repo'],
    ]);
  });

  it('YAML: only changed entries are judged; an unchanged legacy entry is never re-judged', () => {
    const previous = 'entries:\n  - id: old\n    home: user\n';
    const content = 'entries:\n  - id: old\n    home: user\n  - id: new\n    home: repo\n';
    expect(learningGuardViolations([{ path: '.paradigm/notebooks/n.yaml', content, previous }])).toEqual([]);
    const bad = `${content}  - id: newer\n    home: user\n`;
    expect(learningGuardViolations([{ path: '.paradigm/notebooks/n.yaml', content: bad, previous }]).map(v => v.rule)).toEqual(['home-not-repo']);
  });

  it('blocks human_feedback without home: repo when public (the default), not when private', () => {
    const file = { path: '.paradigm/notebooks/n.yaml', content: 'entries:\n  - id: e1\n    trigger: human_feedback\n' };
    expect(learningGuardViolations([file]).map(x => x.rule)).toEqual(['human-feedback-public']);
    expect(learningGuardViolations([file], { visibility: 'private' })).toEqual([]);
  });

  it("machine paths: only this machine's own paths; a generic /Users/x/ path passes", () => {
    const f = (s: string) => ({ path: '.paradigm/events/nominations.jsonl', content: '', added: [s] });
    expect(learningGuardViolations([f('{"f":"/Users/jane/repo/a.ts"}')], { localPaths: ['/home/me'] })).toEqual([]);
    expect(learningGuardViolations([f('{"f":"/home/me/repo/a.ts"}')], { localPaths: ['/home/me'] })[0].rule).toBe('machine-path');
    expect(learningGuardOverridden('rmd-1, learning-guard')).toBe(true);
    expect(learningGuardOverridden(undefined)).toBe(false);
  });
});

describe.skipIf(!hasGit)('learning-guard on staged files (git)', () => {
  beforeEach(() => {
    git('init', '-q');
  });

  it('staging lore, decision and graph files that hold /Users/ (and this machine\'s) paths passes', () => {
    stage('.paradigm/lore/entries/2026-10-28/L-1.yaml', `id: L-1\nfiles: [/Users/jane/x.ts, ${HOME}/y.ts]\nhome: user\n`);
    stage('.paradigm/decisions/TD-1.yaml', `id: TD-1\nnote: ${HOME}/notes\n`);
    stage('.paradigm/graphs/g.json', JSON.stringify({ p: `${HOME}/a`, home: 'machine' }));
    expect(stagedGuardFiles(root)).toEqual([]);
    expect(runLearningGuard(root, stagedGuardFiles(root))).toEqual([]);
  });

  it('a legacy JSONL holding an old path passes when an unrelated line is added', () => {
    stage('.paradigm/events/verdicts.jsonl', `{"id":"v0","file":"${HOME}/old.ts","home":"user"}\n`);
    git('commit', '-qm', 'legacy');
    fs.appendFileSync(path.join(root, '.paradigm/events/verdicts.jsonl'), '{"id":"v1","home":"repo"}\n');
    git('add', '.paradigm/events/verdicts.jsonl');
    const files = stagedGuardFiles(root);
    expect(files[0].added).toEqual(['{"id":"v1","home":"repo"}']);
    expect(runLearningGuard(root, files)).toEqual([]);
  });

  it('a new home:user row in nominations is blocked; a public human_feedback entry is blocked', () => {
    stage('.paradigm/events/nominations.jsonl', '{"id":"n1","home":"user"}\n');
    stage('.paradigm/notebooks/n.yaml', 'id: n\ntrigger: human_feedback\n');
    expect(runLearningGuard(root, stagedGuardFiles(root)).map(v => v.rule).sort()).toEqual(['home-not-repo', 'human-feedback-public']);
    fs.writeFileSync(path.join(root, '.paradigm', 'config.yaml'), 'learning:\n  visibility: private\n');
    expect(runLearningGuard(root, stagedGuardFiles(root)).map(v => v.rule)).toEqual(['home-not-repo']);
  });

  it('the CLI exits 1 on a violation; PARADIGM_OVERRIDE=learning-guard lets it through and is logged', async () => {
    stage('.paradigm/events/nominations.jsonl', '{"id":"n1","home":"user"}\n');
    const cwd = process.cwd();
    const prevOverride = process.env.PARADIGM_OVERRIDE;
    process.chdir(root);
    try {
      process.exitCode = undefined;
      await learningGuardCommand({ staged: true });
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
      process.env.PARADIGM_OVERRIDE = 'learning-guard';
      await learningGuardCommand({ staged: true });
      expect(process.exitCode).toBeUndefined();
      const log = fs.readFileSync(path.join(root, '.paradigm', 'events', 'overrides.jsonl'), 'utf8');
      expect(JSON.parse(log.trim())).toMatchObject({ remediation_id: 'learning-guard', mechanism: 'env', violations: 1, home: 'repo' });
    } finally {
      process.chdir(cwd);
      process.exitCode = undefined;
      if (prevOverride === undefined) delete process.env.PARADIGM_OVERRIDE;
      else process.env.PARADIGM_OVERRIDE = prevOverride;
    }
  });

  describe('the git pre-commit hook', () => {
    function installWithStub(stub: string): string {
      const bin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'learning-guard-bin-')));
      dirs.push(bin);
      fs.writeFileSync(path.join(bin, 'paradigm'), `#!/bin/sh\n${stub}\n`, { mode: 0o755 });
      fs.writeFileSync(path.join(root, '.git', 'hooks', 'pre-commit'), PRE_COMMIT_HOOK, { mode: 0o755 });
      return bin;
    }
    const commit = (bin: string) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
    });

    it.skipIf(process.platform === 'win32')('a crashing CLI (or an older one) lets the commit through', () => {
      stage('a.txt', 'a\n');
      const bin = installWithStub('echo "TypeError: boom" >&2; exit 1');
      const r = commit(bin);
      expect(r.status).toBe(0);
      expect(r.stderr).toContain('did not run cleanly');
    });

    it.skipIf(process.platform === 'win32')('a real refusal blocks the commit', () => {
      stage('a.txt', 'a\n');
      const bin = installWithStub('echo "[paradigm] commit refused: staged learning data must stay repo-home" >&2; exit 1');
      const r = commit(bin);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('commit refused');
    });
  });

  it('doctor: learning guard installed / not installed / foreign, and the skipped-write count', () => {
    expect(learningGuardChecks(root)[0].message).toBe('learning guard: not installed (no git pre-commit hook)');
    fs.writeFileSync(path.join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nhusky\n');
    expect(learningGuardChecks(root)[0].message).toMatch(/foreign pre-commit hook/);
    fs.writeFileSync(path.join(root, '.git', 'hooks', 'pre-commit'), PRE_COMMIT_HOOK);
    expect(learningGuardChecks(root)[0]).toMatchObject({ status: 'ok', message: 'learning guard: installed' });
    expect(learnPathSkipChecks(root)).toEqual([]);
    write('.paradigm/.sessions/learn-path-skips', 't\tteam-funnel\nt\tteam-funnel\nt\thook-timings\n');
    expect(learnPathSkipChecks(root)[0].message).toMatch(/^3 hook write\(s\) skipped .*hook-timings: 1, team-funnel: 2/);
  });
});

describe('init: learning.visibility is set once', () => {
  it('writes visibility into config.yaml, never twice', () => {
    const dir = path.join(root, '.paradigm');
    fs.writeFileSync(path.join(dir, 'config.yaml'), 'version: "1.0"\n');
    expect(setLearningVisibility(dir, 'private')).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8')).toContain('learning:\n  visibility: private');
    expect(setLearningVisibility(dir, 'public')).toBe(false);
  });
});
