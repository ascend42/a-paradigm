// @gnomon-platform: darwin, linux
/**
 * #shell-readonly with an ANCHORED cwd (K1, TD-2026-10-20-086): the classifier starts in the realpath of the session
 * root (ctx.cwd) because the kernel runs the command there (anchorCommand). On a real tmp git repo: the founder's
 * four commands verbatim, a relative cd, the cwd SET after `;` / `||`, git only at the root, tainted locals, case and
 * brace expansion — and the refusals that keep each of them fail-closed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { classifyReadOnly } from '../src/kernel/supervisor/shell-readonly.js';

let base = '';
let repo = '';
let home = '';
let outside = '';
let entries = '';
const ro = (c: string, cwd: string | null = fs.realpathSync(repo)) => classifyReadOnly(c, { roots: [repo], home, gnomonHome: path.join(home, '.gnomon'), platform: process.platform, readRoots: [], ...(cwd !== null ? { cwd } : {}) });

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-ro-cwd-'));
  repo = path.join(base, 'repo');
  home = path.join(base, 'home');
  outside = path.join(base, 'outside');
  entries = path.join(repo, '.paradigm', 'tasks', 'entries');
  for (const d of [repo, home, outside, path.join(repo, 'sub'), entries]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(outside, 'x'), 'secret');
  fs.writeFileSync(path.join(repo, 'sub', 'f.txt'), 'f');
  fs.writeFileSync(path.join(repo, 'x'), 'x');
  for (let d = 13; d <= 20; d++) {
    const dir = path.join(entries, `2026-10-${d}`);
    fs.mkdirSync(dir);
    for (const n of ['001', '002', '003', '005', '020', '023', '028']) fs.writeFileSync(path.join(dir, `T-2026-10-${d}-${n}.yaml`), `status: ${n === '001' ? 'done' : 'open'}\nassignee: builder\n`);
  }
  fs.symlinkSync(outside, path.join(repo, 'link'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo });
});
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

describe("#shell-readonly anchored cwd: the founder's four commands pass verbatim", () => {
  it('1: git log, git worktree list and ls|head from the root', () => {
    expect(ro('git log --oneline -15 && git worktree list && ls -t .paradigm/tasks 2>/dev/null | head -20')).toEqual({ ok: true });
  });
  it('2: ls|head; grep -l over a relative glob', () => {
    expect(ro(String.raw`ls -t .paradigm/tasks/entries | head -30; grep -l "status: \(open\|todo\|in_progress\|in-progress\)" .paradigm/tasks/entries/*2026-10-* 2>/dev/null | head -40`)).toEqual({ ok: true });
  });
  it('3: cd ABS && a for loop with s=$(grep|awk) and a case over $s', () => {
    expect(ro(`cd ${repo}/.paradigm/tasks/entries && for f in 2026-10-1[3-9]/* 2026-10-20/*; do s=$(grep -m1 '^status:' $f | awk '{print $2}'); case $s in done|cancelled|completed) ;; *) echo "== $f [$s]";; esac; done`)).toEqual({ ok: true });
  });
  it('4: a for loop over a bracket glob and a brace list (from a cd into a known dir, absolute and relative)', () => {
    const loop = `for f in 2026-10-20/T-2026-10-20-00[1235].yaml 2026-10-19/T-2026-10-19-0{05,20,23,28}.yaml; do echo "== $f"; grep -m1 -E '^(assignee|owner|claimed_by):' $f; done`;
    expect(ro(`cd ${entries} && ${loop}`)).toEqual({ ok: true });
    expect(ro(`cd .paradigm/tasks/entries && ${loop}`)).toEqual({ ok: true });
  });
});

describe('#shell-readonly anchored cwd: relative cd and the cwd set', () => {
  it('a relative cd into an existing in-root directory, then reads relative to it', () => {
    expect(ro('cd sub && cat f.txt')).toEqual({ ok: true });
    expect(ro('cat x; cd sub && cat f.txt')).toEqual({ ok: true });
  });
  it('after ; or || every possible cwd is checked (a path outside from either one cards)', () => {
    // from the root `../outside/x` is out of the roots; from sub it is repo/outside/x (missing, inside): still refused
    expect(ro('cd sub; cat ../outside/x')).toMatchObject({ ok: false, why: 'outside the readable roots' });
    expect(ro('cd sub || cat ../outside/x')).toMatchObject({ ok: false, why: 'outside the readable roots' });
    expect(ro('cd sub && cat ../x')).toEqual({ ok: true });
  });
  it('without an anchor the old rule holds: a relative path needs an absolute cd first', () => {
    expect(ro('cat x', null)).toMatchObject({ ok: false, why: 'a relative path with an unknown cwd' });
    expect(ro('cd sub && cat f.txt', null)).toMatchObject({ ok: false, why: 'cd: a relative path (the cwd is unknown)' });
    expect(ro(`cd ${repo} && cat x`, null)).toEqual({ ok: true });
  });
});

describe('#shell-readonly anchored cwd: refusals', () => {
  it.each([
    ['cd .. && cat x', /cd: outside the session roots/],
    ['cd sub; git log', /git: only with the cwd at a session root/],
    ['cd sub && git status', /git: only with the cwd at a session root/],
    ['cat link/x', /outside the readable roots/],
    ['cd link && cat x', /cd: outside the session roots/],
    ['cd sub/../sub && cat f.txt', /cd: a \.\. segment/],
    ['cd missing && ls', /not an existing directory/],
    ['cd +1 && ls', /cd: one literal path/],
    ['cd =ls && ls', /cd: one literal path/],
    ['PATH=$(echo /tmp) && ls', /env assignment/],
    ['path=x; ls', /env assignment/],
    ['s=$(echo x); cat $s', /unquoted tainted \$s/],
    ['s=$(echo x); cat "$s"', /substitution in a path argument/],
    ['s=$(echo x); echo $s', /unquoted tainted \$s/],
    ['s=$(echo x); $s', /command name not literal/],
    ['s=$(echo x); for f in "$s"; do echo $f; done', /for: a substitution/],
    ['true && s=$(echo x); echo "$s"', /parameter \$s/],
    ['echo "$s"; s=$(echo x)', /parameter \$s/],
    ['s=$(rm x); echo "$s"', /not allowlisted: rm/],
    ['s=*; echo "$s"', /assignment: a glob/],
    ['X=1 ls', /env assignment/],
    ['for f in a; do f=x; done', /assignment: a loop variable/],
    ['s=x | cat', /env assignment/],
    ['echo $((x=1))', /arithmetic/],
    ['case $(rm x) in x) echo a;; esac', /not allowlisted: rm/],
    ['echo {a,$(rm x)}', /brace/],
    ['case x in x) echo a;& y) echo b;; esac', /operator ;&/],
    ['echo a;; echo b', /unparsed/],
  ])('refuses %s', (c, why) => {
    const v = ro(c);
    expect(v.ok).toBe(false);
    expect((v as { why: string }).why).toMatch(why);
  });
  it('a tainted local is text where a substitution may be: echo, printf, <<<, the case subject', () => {
    expect(ro('s=$(cat x); echo "got $s"')).toEqual({ ok: true });
    expect(ro('s=$(cat x); printf "%s\\n" "$s"')).toEqual({ ok: true });
    expect(ro('s=$(cat x); grep -c x <<< "$s"')).toEqual({ ok: true });
    expect(ro('s=lit; case $s in lit) echo yes;; *) echo no;; esac')).toEqual({ ok: true });
  });
  it('brace lists and ranges expand to concrete, checked paths', () => {
    expect(ro('cat sub/{f.txt,g.txt}')).toEqual({ ok: true });
    expect(ro('cat {sub,link}/x')).toMatchObject({ ok: false, why: 'outside the readable roots' });
    expect(ro('echo {1..3}')).toEqual({ ok: true });
  });
});

describe('#shell-readonly RC3: git read-only subcommands (at the root, after the GIT_BAD checks)', () => {
  it.each([
    'git worktree list', 'git worktree list --porcelain', 'git stash list', 'git stash list --oneline', 'git show-ref --heads', 'git ls-tree HEAD',
    'git cat-file -t HEAD', 'git cat-file -s HEAD', 'git cat-file -p HEAD', 'git rev-list --count HEAD', 'git shortlog -sn HEAD',
    'git merge-base HEAD HEAD', "git for-each-ref --format='%(refname)' refs/heads", 'git tag -l', 'git tag --list "v*"', 'git tag -l -n3 --sort=-v:refname', 'git reflog show -5',
  ])('passes %s', (c) => {
    expect(ro(c)).toEqual({ ok: true });
  });
  it.each([
    ['git worktree add x', /only list/],
    ['git worktree list --expire now', /worktree list/],
    ['git stash', /only list/],
    ['git stash list stash@{0}', /brace|stash list/],
    ['git stash pop', /only list/],
    ['git reflog expire --all', /only show/],
    ['git reflog', /only show/],
    ['git cat-file --batch', /cat-file/],
    ['git cat-file -p HEAD --textconv', /cat-file|--textconv/],
    ['git cat-file --textconv HEAD:a', /--textconv|cat-file/],
    ['git tag v1', /only -l/],
    ['git tag -l -d v1', /git tag: -d/],
    ['git tag -a v1 -l', /git tag: -a/],
    ['git rev-list --output=x HEAD', /--output/],
    ['git for-each-ref --outp=x', /--outp/],
    ['git ls-tree -O HEAD', /git: -O/],
    ['cd sub && git ls-tree HEAD', /only with the cwd at a session root/],
  ])('refuses %s', (c, why) => {
    const v = ro(c);
    expect(v.ok).toBe(false);
    expect((v as { why: string }).why).toMatch(why);
  });
});
