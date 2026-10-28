/**
 * #prefix-policy falsifiers (Aegis H1/M1/M2/M3 on TD-2026-10-20-294). A prefix that equals arbitrary code
 * execution is never offered, never folded into a rule and never matched; a match is bound to the session roots
 * and is skipped in manual mode. Pure tests (no POSIX fixtures).
 */
import { describe, expect, it } from 'vitest';
import { ALLOW_NPM_TEST_PREFIX, BUILD_TOOL_PREFIX_ALLOW, BUILD_TOOLS, GIT_SUBCOMMAND_ALLOW, gitPrefixOptBad, prefixMatchRefusal, prefixRefusal, shownPrefixWords } from '../src/kernel/supervisor/prefix-policy.js';
import { gateClassPathRule } from '../src/kernel/manifest/layers.js';
import { inputHash } from '../src/kernel/supervisor/permission.js';
import { RuleBook, type RuleRow } from '../src/kernel/supervisor/rules.js';

const K = 'p:abcdefgh/kernel';
const KEY = 'kernel-key';
const REPO = `sha256:${'a'.repeat(64)}`;
const ROOT = '/work/repo';
const CTX = { prefixRules: true, roots: [ROOT] };
const card = (n: number) => `card:01J${String(n).padStart(23, '0')}`;

function rows(cardId: string, prefix: string[], command: string, extra: Partial<RuleRow> = {}): RuleRow[] {
  const by = { principal: K, keyId: KEY, ...extra };
  return [
    { ...by, kind: 'approval.request', payload: { card: { cardId, kind: 'permission' }, tool: 'Bash', tool_input: { command } } },
    { ...by, kind: 'approval.decide', payload: { cardId, decision: 'always', scope: { kind: 'prefix', prefix } } },
    { ...by, kind: 'approval.rule.learned', payload: { cardId, tool: 'Bash', match: 'prefix', prefix, presence: 'fresh', repoKey: REPO } },
  ];
}
const book = (rs: RuleRow[]) => {
  const b = new RuleBook({ principal: K, isKernelKey: (k) => k === KEY });
  for (const r of rs) b.fold(r);
  return b;
};
const m = (b: RuleBook, command: string, ctx: { prefixRules: boolean; roots: readonly string[] } | undefined = CTX) => {
  const input = { command };
  return b.match(REPO, 'Bash', inputHash(input), input, ctx);
};

describe('#prefix-policy H1: prefixes that equal code execution', () => {
  it('refuses single words, paths, non-printable-ASCII and interpreters/shells/runners', () => {
    for (const p of [['git'], ['ls'], ['rg'], ['./x', 'y'], ['/usr/bin/git', 'log'], ['bin\\git', 'log'], ['gіt', 'log'], ['git​', 'log'], ['git', 'loɡ'], ['a\tb', 'c']]) {
      expect(prefixRefusal(p), JSON.stringify(p)).not.toBeNull();
    }
    for (const a0 of ['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'env', 'exec', 'command', 'builtin', 'eval', 'xargs', 'find', 'nice', 'nohup', 'timeout', 'sudo', 'doas', 'su', 'time', 'watch', 'node', 'deno', 'bun', 'python', 'python3', 'python3.12', 'pythonw', 'ruby', 'perl', 'php', 'lua', 'npx', 'pnpx', 'bunx', 'osascript', 'open']) {
      expect(prefixRefusal([a0, 'x']), a0).not.toBeNull();
    }
  });

  it('package managers and build tools: the allowlist is EMPTY (second BLOCK H2–H4/M1/M2); npm test stays off', () => {
    for (const p of [['npm', 'run'], ['npm', 'exec'], ['npm', 'x'], ['npm', 'test'], ['npm', 'start'], ['npm', 'install'], ['npm', 'i'], ['npm', 'ci'], ['npm', 'build'], ['pnpm', 'dlx'], ['pnpm', 'add'], ['yarn', 'test'], ['yarn', 'build'], ['bun', 'ls'], ['cargo', 'build'], ['cargo', 'run'], ['cargo', 'test'], ['go', 'run'], ['go', 'test'], ['go', 'generate'], ['go', 'build'], ['make', 'all'], ['make', 'test'], ['gradle', 'tasks'], ['mvn', 'dependency:tree'],
      // the former "read-only" allowlist: each runs or routes repo-controlled code (yarnPath, rustc-wrapper, go env -w, .pnpmfile, npm view --registry)
      ['npm', 'ls'], ['npm', 'list'], ['npm', 'view'], ['npm', 'outdated'], ['npm', 'explain'], ['pnpm', 'ls'], ['pnpm', 'why'], ['yarn', 'why'], ['yarn', 'info'], ['yarn', 'list'], ['cargo', 'tree'], ['go', 'list'], ['go', 'env'], ['go', 'version'],
      ['npm', 'ls', 'x'], ['swift', 'build'], ['pip', 'list'], ['uv', 'tree'], ['tsc', 'x'], ['vitest', 'run'], ['corepack', 'yarn'], ['gmake', 'x'], ['mvnw', 'x'], ['gradlew', 'x']]) {
      expect(prefixRefusal(p), p.join(' ')).not.toBeNull();
    }
    expect(BUILD_TOOL_PREFIX_ALLOW).toEqual({});
    for (const t of BUILD_TOOLS) expect(prefixRefusal([t, 'ls']), t).not.toBeNull();
    expect(ALLOW_NPM_TEST_PREFIX).toBe(false);
  });

  it('git: exactly two words, a read-ish subcommand only', () => {
    for (const p of [['git', 'log', 'x'], ['git', '-c', 'x'], ['git', '-C'], ['git', '--exec-path=/x'], ...['push', 'commit', 'rebase', 'merge', 'reset', 'clean', 'checkout', 'switch', 'restore', 'am', 'apply', 'filter-branch', 'gc', 'config', 'submodule', 'worktree', 'hook', 'fetch', 'pull', 'clone', 'difftool', 'mergetool', 'bisect', 'stash'].map((s) => ['git', s])]) {
      expect(prefixRefusal(p), p.join(' ')).not.toBeNull();
    }
    for (const s of ['status', 'log', 'diff', 'show', 'branch', 'blame', 'rev-parse', 'ls-files', 'grep']) expect(prefixRefusal(['git', s]), s).toBeNull();
    expect(prefixRefusal(['rg', 'TODO'])).toBeNull();
    expect(prefixRefusal(['ls', '-la'])).not.toBeNull(); // the second word is a subcommand, never an option
  });

  it('a chain row learned under a looser policy forms no rule (fold re-checks)', () => {
    expect(book(rows(card(1), ['npm', 'test'], 'npm test')).list()).toEqual([]);
    expect(book(rows(card(2), ['bash', 'x.sh'], 'bash x.sh')).list()).toEqual([]);
    expect(book(rows(card(3), ['git'], 'git log')).list()).toEqual([]);
    expect(book(rows(card(4), ['gіt', 'log'], 'gіt log')).list()).toEqual([]); // a homoglyph argv0
    // second BLOCK: a build-tool row learned while the "read-only" allowlist existed forms no rule
    for (const [i, p] of [['npm', 'ls'], ['npm', 'view'], ['cargo', 'tree'], ['go', 'env'], ['pnpm', 'ls'], ['yarn', 'why']].entries()) {
      expect(book(rows(card(20 + i), p, `${p.join(' ')} x`)).list(), p.join(' ')).toEqual([]);
    }
    expect(book(rows(card(5), ['git', 'log'], 'git log -n 5')).list()).toHaveLength(1);
  });
});

describe('#prefix-policy match time: git options, location (M3), manual mode (M2)', () => {
  const b = book(rows(card(10), ['git', 'log'], 'git log -n 5'));

  it('refuses `git -c … log` and every later git option that runs a program or redirects git', () => {
    expect(m(b, 'git log --oneline -n 3')).toMatchObject({ ruleId: card(10) });
    for (const c of [
      'git -c core.pager=sh log',
      'git -C /tmp log',
      'git log -c core.pager=sh',
      'git log -ccore.pager=sh',
      'git log -C /tmp',
      'git log --exec-path=/tmp',
      'git log --git-dir=.x',
      'git log --work-tree=.',
      'git log --config-env=a=b',
      'git log --namespace=x',
      'git log -p',
      'git log --paginate',
      'git log --ext-diff',
      'git log --textconv',
      'git log --output=out.txt',
      'git log --upload-pack=x',
      'git log -u',
      'git log -O order',
    ]) expect(m(b, c), c).toBeNull();
  });

  it('second BLOCK H1: git long-option ABBREVIATIONS and short-option BUNDLES are refused under every [git, <sub>] rule', () => {
    const bad = [
      'grep --open=sh x', 'log --outp=f', 'diff --ext-d', "grep -iOsh -c x y", 'show --textc', 'log --o=f', 'diff --ext', 'show --tex',
      'log --exec-p=/x', 'log --git=x', 'log --work=x', 'log --upload=x', 'log --pag', 'grep --open-files', 'blame --cont=x', 'log --conf=a',
      'grep -Osh x', 'grep -inO x', 'log -nc', 'log -ic', 'log -iC', 'log -vp', 'diff -wu', 'grep -iOless x',
    ];
    for (const sub of GIT_SUBCOMMAND_ALLOW) {
      const r = book(rows(card(30), ['git', sub], `git ${sub}`));
      for (const tail of bad) {
        const c = `git ${sub} ${tail.split(' ').slice(1).join(' ')}`;
        expect(m(r, c), c).toBeNull();
      }
    }
    // the exact Aegis repros, through simpleArgv (quoting) and the rule book
    const g = book(rows(card(31), ['git', 'grep'], 'git grep x'));
    expect(m(g, "git grep -iO'sh -c x' y")).toBeNull();
    expect(m(g, 'git grep --open=sh x')).toBeNull();
    expect(m(g, 'git grep -n TODO')).not.toBeNull();
    expect(m(b, 'git log --outp=f')).toBeNull();
    expect(m(book(rows(card(32), ['git', 'diff'], 'git diff')), 'git diff --ext-d')).toBeNull();
    expect(m(book(rows(card(33), ['git', 'show'], 'git show')), 'git show --textc')).toBeNull();
    // harmless options and negations still match
    for (const c of ['git log --oneline', 'git log --no-ext-diff', 'git log --stat -n 5', 'git log --output-indicator-new=+', 'git log -- src']) expect(m(b, c), c).not.toBeNull();
    // 'git log --pretty=format:%h' and 'git log HEAD~3': win-alias on win32 only, test/prefix-policy-alias-{posix,win32}.test.ts
    for (const a of ['--', '-n', '--stat', '--no-textconv']) expect(gitPrefixOptBad(a), a).toBe(false);
  });

  it('a prefix-ruled argument never names a gate-class path (.git/** needs a card)', () => {
    expect(gateClassPathRule('.git/config')).not.toBeNull();
    expect(gateClassPathRule('.git/hooks/pre-commit')).not.toBeNull();
    const cp = book(rows(card(34), ['cp', 'a.txt'], 'cp a.txt b.txt'));
    expect(m(cp, 'cp a.txt b.txt')).not.toBeNull();
    for (const c of ['cp a.txt .git/config', `cp a.txt ${ROOT}/.git/hooks/pre-commit`, 'cp a.txt package.json', 'cp a.txt .claude/settings.json', 'cp a.txt sub/.git/config', 'cp a.txt --target=.git']) expect(m(cp, c), c).toBeNull();
    expect(m(b, 'git log -- .git/config')).toBeNull();
  });

  it('binds the match to the session roots: .., ~, \\ and absolute paths outside the roots refuse it', () => {
    expect(m(b, `git log -- ${ROOT}/src`)).not.toBeNull();
    expect(m(b, 'git log -- src/a.ts')).not.toBeNull();
    for (const c of ['git log -- /etc/passwd', 'git log -- ../other', 'git log -- src/../../x', 'git log --format=/etc/x', `git log -- ${ROOT}-evil/x`, 'git log -- ..']) expect(m(b, c), c).toBeNull();
    expect(prefixMatchRefusal(['rg', 'x', '--directory=/'], ['rg', 'x'], [ROOT])).not.toBeNull();
    expect(prefixMatchRefusal(['npm', 'ls', '--prefix', ROOT], ['npm', 'ls'], [ROOT])).not.toBeNull(); // -C-style options refuse outright
    // no roots / no context ⇒ no prefix match (fail closed)
    expect(m(b, 'git log', { prefixRules: true, roots: [] })).toBeNull();
    expect(b.match(REPO, 'Bash', inputHash({ command: 'git log' }), { command: 'git log' })).toBeNull();
  });

  it('git branch only lists under a prefix rule', () => {
    const br = book(rows(card(11), ['git', 'branch'], 'git branch -a'));
    expect(m(br, 'git branch -a')).not.toBeNull();
    expect(m(br, 'git branch --show-current')).not.toBeNull();
    for (const c of ['git branch -D main', 'git branch new-one', 'git branch -m a b', 'git branch -f main HEAD~3', 'git branch --set-upstream-to=x']) expect(m(br, c), c).toBeNull();
  });

  it('M2: a prefix rule never matches in manual mode; an exact rule still does', () => {
    expect(m(b, 'git log --oneline', { prefixRules: false, roots: [ROOT] })).toBeNull();
    expect(m(b, 'git log --oneline', CTX)).not.toBeNull();
    const ex = book([
      { principal: K, keyId: KEY, kind: 'approval.request', payload: { card: { cardId: card(12), kind: 'permission' }, tool: 'Bash', tool_input: { command: 'git log' } } },
      { principal: K, keyId: KEY, kind: 'approval.decide', payload: { cardId: card(12), decision: 'always' } },
      { principal: K, keyId: KEY, kind: 'approval.rule.learned', payload: { cardId: card(12), tool: 'Bash', matchExact: true, presence: 'fresh', repoKey: REPO } },
    ]);
    expect(m(ex, 'git log', { prefixRules: false, roots: [ROOT] })).toMatchObject({ ruleId: card(12), match: 'exact' });
  });
});

describe('#prefix-policy M1: display', () => {
  it("each word quoted, non-ASCII escaped: 'git log' x is not git log x, and a homoglyph is visible", () => {
    expect(shownPrefixWords(['git log', 'x'])).toBe("'git log' 'x'");
    expect(shownPrefixWords(['git', 'log', 'x'])).toBe("'git' 'log' 'x'");
    // G-BRK-09 (Aegis C6'a2-2 M1): a destructive argv0, in any case, with .exe, mkfs.* — refused at prefix and match
    for (const a0 of ['rm', 'RM', 'Rm.EXE', 'rmdir', 'unlink', 'mv', 'dd', 'truncate', 'shred', 'chmod', 'chown', 'chgrp', 'rsync', 'ln', 'kill', 'mkfs.ext4', 'newfs_apfs']) {
      expect(prefixRefusal([a0, 'build/x']), a0).toMatch(/delete or overwrite/);
      expect(prefixMatchRefusal([a0, 'build/x', '-rf', 'src'], [a0, 'build/x'], ['/work/repo']), a0).not.toBeNull();
    }
    expect(shownPrefixWords(['gіt', 'log'])).toBe("'g\\u0456t' 'log'");
    expect(shownPrefixWords(['a‮b', 'c'])).toBe("'a\\u202eb' 'c'");
  });
});
