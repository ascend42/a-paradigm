// @gnomon-platform: darwin
/**
 * #git-verbs under the REAL session profile (sandbox-exec, the kernel-generated SBPL): the founder's fresh-folder case
 * (git init refused in the sandbox, the kernel's git.init works, then the session commits) and kernel worktrees
 * (Claude Code's own `.claude/worktrees` flow and `git worktree add` refused; gnomon_worktree_add works; the session
 * edits and commits there but cannot write the worktree's steering, .git pointer, .mcp.json or git-dir pointers,
 * nor remove or rename the worktree; the kernel removes it).
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { darwinFloor, sessionLaunchPlan } from '../src/kernel/sandbox/session.js';
import { buildSessionPolicy } from '../src/kernel/manifest/policy.js';
import { GitVerbs, type VerbSession } from '../src/kernel/git/kernel-verbs.js';
import { composePermission } from '../src/kernel/supervisor/permission.js';
import { autoEditPass } from '../src/kernel/supervisor/auto-edits.js';
import { kernelWorktreeDirs } from '../src/kernel/git/verbs.js';
import { sessionWorld, type SessionWorld } from './session-helpers.js';

const OK = darwinFloor().ok;
const GENV = { PATH: '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x', HOME: '/nonexistent' };
let w: SessionWorld | null = null;
afterEach(() => {
  w?.cleanup();
  w = null;
});

function policyFor(x: SessionWorld) {
  return buildSessionPolicy({ home: x.home, cwd: x.cwd, userClaudeDir: path.join(x.userHome, '.claude'), userHome: x.userHome, managedSettingsPaths: [], linkedFolders: [x.linked], endpointPort: null, memorySubtree: x.cwd, kernelWorktrees: true });
}
function inSandbox(x: SessionWorld, policy: ReturnType<typeof policyFor>, body: string): Record<string, string> {
  const script = path.join(x.root, `s-${Date.now()}.sh`);
  fs.writeFileSync(script, `#!/bin/bash\ncd "${x.cwd}"\nexport GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@x GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@x\n${body}\n`, { mode: 0o755 });
  const plan = sessionLaunchPlan({ policy, binaryReal: '/bin/bash', argv: [script], extras: { uid: process.getuid!(), tmpdir: os.tmpdir(), home: x.userHome, roots: [x.cwd] } }, 'darwin');
  const r = spawnSync(plan.command, plan.args, { encoding: 'utf8', env: { HOME: x.userHome, PATH: '/usr/bin:/bin' }, timeout: 60_000 });
  return Object.fromEntries(r.stdout.split('\n').filter((l) => /^[a-z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
}
const t = (name: string, cmd: string): string => `(${cmd}) >/dev/null 2>&1 && echo "${name}=allowed" || echo "${name}=blocked"`;
function verbsFor(x: SessionWorld) {
  return new GitVerbs({ log: async () => undefined, broker: { raise: async () => ({ cardId: 'card:01JAAAAAAAAAAAAAAAAAAAAAAA' }) as never, decisionOf: async () => 'allow', auto: async () => undefined } as never, gnomonHome: x.home, userHome: () => x.userHome });
}
const sess = (x: SessionWorld): VerbSession => ({ hsid: 'hsid:v1:01JAAAAAAAAAAAAAAAAAAAAAAA', principalId: 'p:abcdefgh/s-x', cwd: x.cwd, repoKey: 'sha256:00', mode: 'auto-edits', planApproved: false, loop: false, worktreesGuarded: true });

describe.runIf(OK)('git verbs under the session profile', () => {
  it('a fresh folder: git init is refused in the sandbox; the kernel makes the repo; the session commits; config and hooks stay denied', async () => {
    w = sessionWorld();
    fs.rmSync(path.join(w.cwd, '.git'), { recursive: true });
    const policy = policyFor(w);
    // Aegis H1: no repo yet — the session can neither run git init nor plant a `.git` gitfile or dir at the root
    expect(inSandbox(w, policy, [t('sandbox_init', 'git init -q -b main'), t('plant_gitfile', 'echo "gitdir: /tmp/evil" > .git'), t('plant_gitdir', 'mkdir .git')].join('\n'))).toMatchObject({ sandbox_init: 'blocked', plant_gitfile: 'blocked', plant_gitdir: 'blocked' });
    const res = await verbsFor(w).call('gnomon_git_init', {}, sess(w));
    expect(res.ok, res.text).toBe(true);
    const out = inSandbox(w, policy, [
      t('commit', 'echo a > a.txt && git add a.txt && git commit -qm one'),
      t('write_config', 'echo x >> .git/config'),
      t('write_hook', 'echo x > .git/hooks/pre-commit'),
      t('write_info', 'echo x > .git/info/attributes'),
      t('mv_dotgit', 'mv .git .git2'),
      t('commondir', 'echo /tmp/evil > .git/commondir'),
      t('remotes', 'mkdir -p .git/remotes && echo "URL: https://evil.example/r" > .git/remotes/origin'),
      t('branches', 'mkdir -p .git/branches && echo https://evil.example/r > .git/branches/origin'),
      t('nested_gitfile', 'mkdir -p sub && echo "gitdir: /tmp/evil" > sub/.git'),
    ].join('\n'));
    // a nested `.git` below the root stays an ordinary file the session may write (git in the ROOT never reads it)
    expect(out).toEqual({ commit: 'allowed', write_config: 'blocked', write_hook: 'blocked', write_info: 'blocked', mv_dotgit: 'blocked', commondir: 'blocked', remotes: 'blocked', branches: 'blocked', nested_gitfile: 'allowed' });
  });

  it('worktrees: Claude Code\'s own flow is refused; the kernel worktree is editable and its steering and pointers are not', async () => {
    w = sessionWorld();
    fs.rmSync(path.join(w.cwd, '.git'), { recursive: true });
    fs.rmSync(path.join(w.cwd, '.claude'), { recursive: true });
    for (const a of [['init', '-q', '-b', 'main'], ['commit', '-q', '--allow-empty', '-m', 'one']]) spawnSync('git', a, { cwd: w.cwd, env: GENV });
    fs.writeFileSync(path.join(w.cwd, 'CLAUDE.md'), 'steering\n');
    fs.writeFileSync(path.join(w.cwd, 'b.txt'), 'b\n');
    for (const a of [['add', '.'], ['commit', '-qm', 'two']]) spawnSync('git', a, { cwd: w.cwd, env: GENV });
    const policy = policyFor(w);
    const before = inSandbox(w, policy, [t('cc_worktree', 'git worktree add .claude/worktrees/wt0 -b wt0'), t('mkdir_kernel_wt', 'mkdir -p .gnomon/worktrees/evil')].join('\n'));
    expect(before).toEqual({ cc_worktree: 'blocked', mkdir_kernel_wt: 'blocked' });
    const v = verbsFor(w);
    const add = await v.call('gnomon_worktree_add', { name: 'wt1' }, sess(w));
    expect(add.ok, add.text).toBe(true);
    const wt = path.join(w.cwd, '.gnomon', 'worktrees', 'wt1');
    const gd = path.join(w.cwd, '.git', 'worktrees', 'wt1');
    const out = inSandbox(w, policy, [
      t('edit', `echo c > "${wt}/b.txt"`),
      t('new_file', `mkdir -p "${wt}/src" && echo d > "${wt}/src/d.ts"`),
      t('commit', `cd "${wt}" && git add -A && git commit -qm three`),
      t('claude_md', `echo x >> "${wt}/CLAUDE.md"`),
      t('settings', `mkdir -p "${wt}/.claude" && echo x > "${wt}/.claude/settings.json"`),
      t('mcp_json', `echo x > "${wt}/.mcp.json"`),
      t('pointer', `echo "gitdir: /tmp/evil" > "${wt}/.git"`),
      t('commondir', `echo /tmp/evil > "${gd}/commondir"`),
      t('config_worktree', `echo x > "${gd}/config.worktree"`),
      t('main_config', 'echo x >> .git/config'),
      t('rm_worktree', `rm -rf "${wt}"`),
      t('rename_gnomon', 'mv .gnomon .gnomon2'),
    ].join('\n'));
    expect(out).toEqual({ edit: 'allowed', new_file: 'allowed', commit: 'allowed', claude_md: 'blocked', settings: 'blocked', mcp_json: 'blocked', pointer: 'blocked', commondir: 'blocked', config_worktree: 'blocked', main_config: 'blocked', rm_worktree: 'blocked', rename_gnomon: 'blocked' });
    // rm -rf empties the files (edits, allowed) but the worktree entry and its .git pointer stay
    expect(fs.lstatSync(path.join(wt, '.git')).isFile()).toBe(true);
    // the session's own view: an edit there is a plain edit of that worktree (not a .claude/.gnomon gate-class card), its steering is not
    const roots = [...kernelWorktreeDirs(w.cwd), w.cwd];
    expect(autoEditPass('Write', { file_path: path.join(wt, 'src', 'e.ts'), content: 'x' }, roots, ['x'], 'darwin', w.userHome)).toMatchObject({ ok: true });
    expect(autoEditPass('Write', { file_path: path.join(wt, 'CLAUDE.md'), content: 'x' }, roots, ['x'], 'darwin', w.userHome)).toMatchObject({ ok: false, why: 'gate-class' });
    expect(composePermission({ requestId: 'r', toolName: 'Write', toolUseId: null, input: { file_path: path.join(wt, '.git'), content: 'x' } }, { repo: w.cwd, denyWrite: policy.denyWrite }, 'darwin').kind).toBe('auto-deny');
    expect(composePermission({ requestId: 'r', toolName: 'Write', toolUseId: null, input: { file_path: path.join(wt, 'src', 'e.ts'), content: 'x' } }, { repo: w.cwd, denyWrite: policy.denyWrite }, 'darwin').kind).toBe('card');
    // the rm above left deletions: git refuses a plain remove; force takes its own card (allowed by this rig)
    expect((await v.call('gnomon_worktree_remove', { name: 'wt1' }, sess(w))).why).toBe('command-failed');
    const rm = await v.call('gnomon_worktree_remove', { name: 'wt1', force: true }, sess(w));
    expect(rm.ok, rm.text).toBe(true);
    expect(fs.existsSync(wt)).toBe(false);
  });
});
