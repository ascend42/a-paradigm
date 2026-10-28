/**
 * Scoped learning S2: the pre-commit learning guard (#learning-commit-guard,
 * `paradigm internal learning-guard --staged`) and init's visibility setting.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { learningGuardViolations, learningGuardOverridden, isGuardedPath } from '../../paradigm-mcp/src/utils/learning-commit-guard.js';
import { learningGuardCommand, runLearningGuard, stagedGuardFiles } from '../src/commands/internal/learning-guard.js';
import { setLearningVisibility } from '../src/commands/init.js';

const hasGit = spawnSync('git', ['--version']).status === 0;
let root: string;
const git = (...args: string[]) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: root, encoding: 'utf8' });
const stage = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
  git('add', rel);
};

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'learning-guard-')));
  fs.mkdirSync(path.join(root, '.paradigm'), { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('learningGuardViolations (pure)', () => {
  it('blocks a home:user row and a home:machine entry; a repo row passes', () => {
    const v = learningGuardViolations([
      { path: '.paradigm/events/verdicts.jsonl', content: '{"id":1,"home":"repo"}\n{"id":2,"home":"user"}\n' },
      { path: '.paradigm/notebooks/a.yaml', content: 'id: a\nhome: machine\n' },
    ]);
    expect(v.map(x => [x.path, x.line, x.rule])).toEqual([
      ['.paradigm/events/verdicts.jsonl', 2, 'home-not-repo'],
      ['.paradigm/notebooks/a.yaml', undefined, 'home-not-repo'],
    ]);
  });

  it('blocks human_feedback without home: repo when public (the default), not when private', () => {
    const file = { path: '.paradigm/notebooks/n.yaml', content: 'entries:\n  - id: e1\n    trigger: human_feedback\n' };
    expect(learningGuardViolations([file]).map(x => x.rule)).toEqual(['human-feedback-public']);
    expect(learningGuardViolations([file], { visibility: 'private' })).toEqual([]);
    const explicit = { ...file, content: 'entries:\n  - id: e1\n    trigger: human_feedback\n    home: repo\n' };
    expect(learningGuardViolations([explicit])).toEqual([]);
  });

  it('blocks machine paths; source and docs are never read', () => {
    expect(learningGuardViolations([{ path: '.paradigm/events/x.jsonl', content: '{"f":"/Users/jane/repo/a.ts"}\n' }])[0].rule).toBe('machine-path');
    expect(learningGuardViolations([{ path: '.paradigm/learned/t.json', content: '{"p":"C:\\\\Users\\\\jane\\\\x"}' }])[0].rule).toBe('machine-path');
    expect(learningGuardViolations([{ path: '.paradigm/a.yaml', content: 'p: /opt/x/y\n' }], { localPaths: ['/opt/x'] })[0].rule).toBe('machine-path');
    expect(isGuardedPath('src/a.ts')).toBe(false);
    expect(isGuardedPath('.paradigm/docs/a.md')).toBe(false);
    expect(isGuardedPath('packages/x/.paradigm/events/v.jsonl')).toBe(true);
    expect(learningGuardOverridden('rmd-1, learning-guard')).toBe(true);
    expect(learningGuardOverridden(undefined)).toBe(false);
  });
});

describe.skipIf(!hasGit)('learning-guard on staged files (git)', () => {
  beforeEach(() => {
    git('init', '-q');
  });

  it('refuses a staged home:user row and a public human_feedback entry; private config allows the latter', async () => {
    stage('.paradigm/events/verdicts.jsonl', '{"id":"v1","home":"user"}\n');
    stage('.paradigm/notebooks/n.yaml', 'id: n\ntrigger: human_feedback\n');
    stage('src/a.ts', 'const home = "user";\n');
    expect(stagedGuardFiles(root).map(f => f.path).sort()).toEqual(['.paradigm/events/verdicts.jsonl', '.paradigm/notebooks/n.yaml']);
    expect(runLearningGuard(root, stagedGuardFiles(root)).map(v => v.rule).sort()).toEqual(['home-not-repo', 'human-feedback-public']);
    fs.writeFileSync(path.join(root, '.paradigm', 'config.yaml'), 'learning:\n  visibility: private\n');
    expect(runLearningGuard(root, stagedGuardFiles(root)).map(v => v.rule)).toEqual(['home-not-repo']);
  });

  it('exits 1 on a violation; PARADIGM_OVERRIDE=learning-guard lets it through and logs an override row', async () => {
    stage('.paradigm/events/verdicts.jsonl', '{"id":"v1","home":"user"}\n');
    const cwd = process.cwd();
    const prevOverride = process.env.PARADIGM_OVERRIDE;
    const prevAssume = process.env.PARADIGM_LEARNING_ASSUME_REPO;
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
      if (prevAssume !== undefined) process.env.PARADIGM_LEARNING_ASSUME_REPO = prevAssume;
    }
  });
});

describe('init: learning.visibility is set once', () => {
  it('writes visibility into config.yaml, never twice', () => {
    const dir = path.join(root, '.paradigm');
    fs.writeFileSync(path.join(dir, 'config.yaml'), 'version: "1.0"\n');
    expect(setLearningVisibility(dir, 'private')).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8')).toContain('learning:\n  visibility: private');
    expect(setLearningVisibility(dir, 'public')).toBe(false);
    fs.writeFileSync(path.join(dir, 'config.yaml'), 'learning:\n  default_home:\n    verdicts: user\n');
    expect(setLearningVisibility(dir, 'public')).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8')).toBe('learning:\n  visibility: public\n  default_home:\n    verdicts: user\n');
  });
});
