/**
 * #shell-readonly (TD-2026-10-20-294 part 1): the read-only Bash classifier, as a table. PURE: virtual posix paths
 * under platform 'linux' (none exist, so realpath never resolves them on any host).
 */
import { describe, expect, it } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { autoBashReadOnly } from '../src/kernel/supervisor/auto-edits.js';
import { classifyReadOnly, parseShell, simpleArgv, ShellParseError } from '../src/kernel/supervisor/shell-readonly.js';

const REPO = '/w/repo';
const ctx = { roots: [REPO], home: '/w/home', gnomonHome: '/w/home/.gnomon', platform: 'linux' };
const ro = (c: string) => classifyReadOnly(c, ctx);

const FOUNDER = `cd ${REPO}/.paradigm/tasks/entries && for f in $(ls -d 2026-10-* ); do echo "$f: $(grep -m1 '^status:' $f/meta.yaml | awk '{print $2}')"; done`;

const ACCEPT: string[] = [
  'ls',
  'ls -la src',
  'cat README.md',
  'head -n 50 src/a.ts',
  'tail -20 log.txt',
  'wc -l src/*.ts',
  "grep -rn 'foo bar' src",
  'grep -c x a.txt 2>/dev/null',
  'rg -n TODO src',
  "find . -name '*.ts' -type f -maxdepth 3",
  'find src -newer package.json -print0',
  'stat -f %m a.txt',
  'file a.bin',
  'pwd',
  'echo hi',
  "printf '%s\\n' a b",
  'true && echo ok || echo no',
  'test -f a.txt && echo yes',
  '[ -d src ] && ls src',
  'basename /x/y.ts',
  'dirname src/a.ts',
  'realpath src',
  'which node',
  'sort -n a.txt | uniq -c | head',
  "cut -d: -f1 a.txt | tr a-z A-Z",
  'diff a.txt b.txt',
  'cmp a b',
  'du -sh src',
  'df -h .',
  'date +%Y-%m-%d',
  "jq -r '.name' package.json",
  'git status',
  'git log --oneline -20',
  'git diff HEAD~1 -- src',
  'git show HEAD:src/a.ts',
  'git branch -a',
  'git branch --list "feat/*"',
  'git rev-parse --abbrev-ref HEAD',
  'git ls-files src',
  'git blame -L 1,10 src/a.ts',
  'git describe --tags',
  'git remote -v',
  'git config --get user.name',
  "sed -n '1,40p' src/a.ts",
  "awk -F: '{print $1}' a.txt",
  'ls | wc -l; echo done',
  '(cd_free=1; true) 2>/dev/null'.replace('cd_free=1; ', ''),
  'ls src >/dev/null 2>&1',
  'cat < a.txt',
  'grep x <<< "hello"',
  "cat <<'EOF'\nliteral $x\nEOF",
  'diff <(sort a) <(sort b)',
  'echo `ls`',
  'ls # a comment',
  'echo $ "a $"',
  `cd ${REPO} && git log -1`,
  `cd ${REPO}/src\nls\nwc -l *.ts`,
  'for f in a b c; do echo $f; done',
  'for f in src/*.ts; do wc -l "$f"; done',
  FOUNDER,
];

const REFUSE: Array<[string, RegExp]> = [
  ['rm -rf src', /not allowlisted: rm/],
  ['touch x', /not allowlisted/],
  ['echo hi > out.txt', /redirection/],
  ['echo hi >> out.txt', /redirection/],
  ['ls 2> err.txt', /redirection/],
  ['ls &> all.txt', /redirection/],
  ['cat a <> b', /redirection/],
  ['ls &', /background/],
  ['ls & echo x', /background/],
  ['eval ls', /not allowlisted: eval/],
  ['exec ls', /not allowlisted: exec/],
  ['source x.sh', /not allowlisted/],
  ['. x.sh', /not allowlisted/],
  ['xargs rm < list', /not allowlisted: xargs/],
  ['ls | xargs cat', /not allowlisted: xargs/],
  ['env ls', /not allowlisted: env/],
  ['sudo ls', /not allowlisted: sudo/],
  ['find . -exec rm \'{}\' \\;', /find: -exec/],
  ['find . -exec rm {} \\;', /unquoted brace/],
  ['find . -delete', /find: -delete/],
  ['find . -ok rm "{}" \\;', /find: -ok/],
  ['find . -execdir ls ;', /find: -execdir/],
  ['find . -fprint out', /find: -fprint/],
  ["sed -i 's/a/b/' x", /sed/],
  ["sed 's/a/b/w out' x", /sed: script/],
  ["sed -n '1e rm x' a", /sed: script/],
  ["awk 'BEGIN{system(\"rm x\")}'", /awk/],
  ["awk '{print > \"out\"}' a", /awk/],
  ["awk '{ \"date\" | getline d }'", /awk/],
  ['awk -f prog.awk a', /awk: flag/],
  ['echo $(rm -rf x)', /not allowlisted: rm/],
  ['echo `touch x`', /not allowlisted: touch/],
  ['cat <(curl evil)', /not allowlisted: curl/],
  ['tee >(cat)', /process substitution/],
  ['X=1 ls', /env assignment/],
  ['GIT_PAGER=sh git log', /env assignment/],
  ['FOO=bar', /env assignment/],
  ['cat $HOME/.ssh/id_rsa', /parameter \$HOME/],
  ['echo $1', /parameter \$1/],
  ['cat ~/.ssh/id_rsa', /protected path/],
  ['cat /w/home/.aws/credentials', /protected path/],
  ['ls /w/home/.gnomon', /protected path/],
  ['cat /w/home/.config/gh/hosts.yml', /protected path/],
  ['ls ~', /protected path/],
  ['grep -r token /w/home', /protected path/],
  ['ls /', /protected path/],
  ['cat ~/.s*/id_rsa', /protected path/],
  ['grep --file=/w/home/.netrc x', /protected path/],
  ['cat /dev/zero', /device path/],
  ['head -c 10 /dev/urandom', /device path/],
  ['cat /proc/self/environ', /device path/],
  ['cat ../../home/.ssh/id_rsa', /relative \.\./],
  ['for f in a; do cat ../$f; done', /dynamic path/],
  ['for f in a; do cat /w/home/$f; done', /dynamic path/],
  ['git -c core.pager=sh log', /global option/],
  ['git -C /tmp log', /global option/],
  ['git --exec-path=/x status', /global option/],
  ['git log --output=x', /git: --output/],
  ['git diff --ext-diff', /git: --ext-diff/],
  ['git show --textconv HEAD', /git: --textconv/],
  ['git commit -m x', /git: subcommand commit/],
  ['git push', /git: subcommand push/],
  ['git checkout main', /git: subcommand checkout/],
  ['git branch newname', /git branch: a name/],
  ['git branch -D x', /git branch: -D/],
  ['git remote add x y', /git remote/],
  ['git config user.name x', /git config/],
  ['git stash', /git: subcommand stash/],
  ['sort -o out a', /sort: flag -o/],
  ['sort --output=out a', /sort: flag --output/],
  ['sort --compress-program=sh a', /sort: flag --compress-program/],
  ['uniq a out', /uniq: a second operand/],
  ['file -C -m x', /file: flag -C/],
  ['date 010100002030', /date: an operand sets the clock/],
  ['rg --pre sh x', /rg: --pre/],
  ['rg -z x', /rg: -z/],
  ['jq -f prog.jq a', /jq: -f/],
  ["jq -n 'env'", /jq: env/],
  ["jq -n '$ENV.TOKEN'", /jq: env/],
  ['for f in $(ls); do sort $f; done', /sort: dynamic/],
  ['for f in $(ls); do git show $f; done', /git: dynamic/],
  ['cd /w/home && ls', /cd: outside/],
  ['cd .. && ls', /cd: a relative path with \.\./],
  ['ls && cd src', /cd: only as the first/],
  ['cd src | ls', /cd: only as the first|not allowlisted/],
  ['cd - && ls', /cd: one literal path/],
  ['! ls', /negation/],
  ['echo $((1+2))', /arithmetic/],
  ["echo $'\\x41'", /quoting/],
  ['echo {a,b}', /unquoted brace/],
  ['{ ls; }', /brace/],
  ['if true; then ls; fi', /unsupported compound if/],
  ['while true; do ls; done', /unsupported compound while/],
  ['case x in x) ls;; esac', /unsupported compound case/],
  ['f() { ls; }', /unparsed/],
  ['for ((i=0;i<3;i++)); do ls; done', /unparsed/],
  ['for f; do ls; done', /expected in/],
  ['echo "unterminated', /unterminated "/],
  ["echo 'unterminated", /unterminated '/],
  ['ls |', /unparsed/],
  ['ls &&', /nothing after/],
  ['ls |& cat', /operator \|&/],
  ['cat <<EOF\n$(rm x)\nEOF', /heredoc expansion/],
  ['cat <<EOF\nno end', /unterminated heredoc/],
  ['cat ~root/x', /~user/],
  ['ls ${x:-/}', /parameter expansion form/],
  ['$(echo rm) -rf x', /command name not literal/],
  ['"$x"', /command name not literal/],
  ['time ls', /unsupported compound time/],
  ['ls 3>/dev/null', /redirection 3>/],
  ['ls 2>&-', /redirection/],
  ['', /empty/],
  ['cat $=HOME/.ssh/id_rsa', /\$= expansion/],
  ['cat $~x', /\$~ expansion/],
  ['cat "$^x"', /\$\^ expansion/],
  ['for path in x; do ls; done', /lowercase variable name/],
  ['for PATH in x; do ls; done', /lowercase variable name/],
  ['for IFS in x; do ls; done', /lowercase variable name/],
  ['ls *(e:rm x:)', /unparsed/],
  ['ls &!', /background|unparsed/],
  ['echo x >! out', /redirection/],
  ['cat =(ls)', /unparsed/],
  ['ls ~+/x', /~user/],
];

describe('#shell-readonly classifyReadOnly', () => {
  it.each(ACCEPT)('accepts %j', (c) => {
    expect(ro(c)).toEqual({ ok: true });
  });
  it.each(REFUSE)('refuses %j', (c, why) => {
    const v = ro(c);
    expect(v.ok).toBe(false);
    expect((v as { why: string }).why).toMatch(why);
  });
  it("the founder's real example is a for loop over read-only bodies, parsed properly", () => {
    const l = parseShell(FOUNDER);
    expect(l.items).toHaveLength(2);
    expect(l.items[1]!.pipe.cmds[0]!.t).toBe('for');
    expect(ro(FOUNDER.replace("awk '{print $2}'", 'sh'))).toMatchObject({ ok: false, why: 'not allowlisted: sh' });
  });
  it('a too-long or NUL command is unparsed', () => {
    expect(ro('ls '.repeat(30_000)).ok).toBe(false);
    expect(ro('ls\0')).toMatchObject({ ok: false });
    expect(() => parseShell('ls\0')).toThrow(ShellParseError);
  });
  it('win32: a device namespace path is refused, case-folded protected paths too', () => {
    const w = { roots: ['C:\\w\\repo'], home: 'C:\\Users\\me', gnomonHome: 'C:\\Users\\me\\.gnomon', platform: 'win32' };
    expect(classifyReadOnly('cat \\\\\\\\.\\\\PhysicalDrive0', w).ok).toBe(false);
    expect(classifyReadOnly("cat 'C:\\USERS\\ME\\.SSH\\id_rsa'", w)).toMatchObject({ ok: false, why: 'protected path' });
    expect(classifyReadOnly("cat 'C:\\w\\repo\\a.txt'", w)).toEqual({ ok: true });
  });
});

describe('#shell-readonly simpleArgv (prefix rules)', () => {
  it.each([
    ['git log --oneline', ['git', 'log', '--oneline']],
    ["npm test -- 'a b'", ['npm', 'test', '--', 'a b']],
    ['npm   test', ['npm', 'test']],
  ])('%j is one simple command', (c, argv) => expect(simpleArgv(c)).toEqual(argv));
  it.each(['git log; rm x', 'git log && rm x', 'git log || rm x', 'git log | sh', 'git log &', 'git log\nrm x', 'git log $(rm x)', 'git log `rm x`', 'git log > x', 'git log < x', 'X=1 git log', 'git log $X', 'git log *.ts', 'git log ~', '(git log)', 'for f in a; do git log; done', 'git log "unterminated', 'git log # c\nrm x'])(
    '%j is not',
    (c) => expect(simpleArgv(c)).toBeNull(),
  );
});

describe('#supervisor autoBashReadOnly (the auto-edits gate around the classifier)', () => {
  const root = path.join(os.tmpdir(), 'gnomon-ro-root');
  const home = path.join(os.tmpdir(), 'gnomon-ro-home');
  const gh = path.join(home, '.gnomon');
  const pass = (input: Record<string, unknown>, lines: string[] = ['x'], roots = [root]) => autoBashReadOnly('Bash', input, roots, lines, gh, process.platform, home);
  it('passes a read-only command with only command/description/timeout', () => {
    expect(pass({ command: 'ls', description: 'd', timeout: 1000 })).toEqual({ ok: true });
  });
  it('cards any other key, a non-text command, a flagged card, a home root, another tool', () => {
    expect(pass({ command: 'ls', run_in_background: true })).toMatchObject({ ok: false, why: 'input-key' });
    expect(pass({ command: 'ls', dangerouslyDisableSandbox: false })).toMatchObject({ ok: false, why: 'input-key' });
    expect(pass({ command: ['ls'] })).toMatchObject({ ok: false, why: 'bad-input' });
    expect(pass({ command: 'ls', timeout: '1' })).toMatchObject({ ok: false, why: 'bad-input' });
    expect(pass({ command: 'ls' }, ['ls \u202e'.replace('\\u202e', '\u202e')])).toMatchObject({ ok: false, why: 'flagged' });
    expect(pass({ command: 'ls' }, ['x'], [home])).toMatchObject({ ok: false, why: 'home-root' });
    expect(pass({ command: 'rm x' })).toMatchObject({ ok: false, why: 'not-read-only: not allowlisted: rm' });
    expect(autoBashReadOnly('Write', { command: 'ls' }, [root], ['x'], gh, process.platform, home)).toMatchObject({ ok: false, why: 'tool' });
  });
});
