/**
 * #shell-readonly (TD-2026-10-20-294 part 1, Aegis C1–C2 H1–H4 M1–M3 re-check): the read-only Bash classifier, as a
 * table. PURE: virtual posix paths under platform 'linux' (none exist, so realpath never resolves them and a glob
 * matches nothing on any host). The filesystem half (symlinks, glob expansion, the founder's loop) is
 * shell-readonly-fs.test.ts.
 */
import { describe, expect, it } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { autoBashReadOnly } from '../src/kernel/supervisor/auto-edits.js';
import { classifyReadOnly, parseShell, simpleArgv, ShellParseError } from '../src/kernel/supervisor/shell-readonly.js';

const REPO = '/w/repo';
const ctx = { roots: [REPO], home: '/w/home', gnomonHome: '/w/home/.gnomon', platform: 'linux' };
const ro = (c: string) => classifyReadOnly(c, ctx);
/** M2: a known cwd — an absolute cd into the root, then an unbroken && chain */
const C = `cd ${REPO} && `;

/** The founder's real loop: REFUSED now (C1: `$(ls -d …)` is a substitution feeding the loop's paths). */
const FOUNDER = `cd ${REPO}/.paradigm/tasks/entries && for f in $(ls -d 2026-10-* ); do echo "$f: $(grep -m1 '^status:' $f/meta.yaml | awk '{print $2}')"; done`;
/** Its closest safe equivalent: a literal glob loop (accepted when the glob matches; see shell-readonly-fs.test.ts). */
const FOUNDER_SAFE = (dir: string) => `cd ${dir} && for f in 2026-10-*; do echo "$f: $(grep -m1 '^status:' $f/meta.yaml | awk '{print $2}')"; done`;

const ACCEPT: string[] = [
  // no path at all: the cwd need not be known
  'pwd',
  'echo hi',
  'echo -n hi',
  "printf '%s\\n' a b",
  'true && echo ok || echo no',
  'basename /x/y.ts',
  'dirname src/a.ts',
  'which node',
  'date +%Y-%m-%d',
  'date -u +%s',
  'echo `pwd`',
  'echo "now: $(date +%s)"',
  'echo $ "a $"',
  'echo "--- done"',
  'for f in a b c; do echo $f; done',
  `${C}grep x <<< "hello"`,
  "cat <<'EOF'\nliteral $x\nEOF",
  // absolute paths inside a readable root: the cwd need not be known
  `cat ${REPO}/README.md`,
  `ls -la ${REPO}/src`,
  'cat /etc/hosts',
  'ls /usr/local/bin',
  `cat < ${REPO}/a.txt`,
  // a known cwd (M2)
  `${C}ls`,
  `${C}ls -la src`,
  `${C}cat README.md`,
  `${C}head -n 50 src/a.ts`,
  `${C}tail -20 log.txt`,
  `${C}wc -l src/*.ts`,
  `${C}grep -n 'foo bar' src/a.ts`,
  `${C}grep -c x a.txt 2>/dev/null`,
  `${C}find . -name '*.ts' -type f -maxdepth 3`,
  `${C}find src -newer package.json -print0`,
  `${C}find -H src -type l`,
  `${C}stat -f %m a.txt`,
  `${C}file a.bin`,
  `${C}test -f a.txt && echo yes`,
  `${C}[ -d src ] && ls src`,
  `${C}realpath src`,
  `${C}sort -n a.txt | uniq -c | head`,
  `${C}cut -d: -f1 a.txt | tr a-z A-Z`,
  `${C}diff a.txt b.txt`,
  `${C}cmp a b`,
  `${C}du -sh src`,
  `${C}df -h .`,
  `${C}jq -r '.name' package.json`,
  `${C}git status`,
  `${C}git log --oneline -20`,
  `${C}git diff HEAD~1 -- src`,
  `${C}git show HEAD:src/a.ts`,
  `${C}git branch -a`,
  `${C}git branch --list "feat/*"`,
  `${C}git rev-parse --abbrev-ref HEAD`,
  `${C}git ls-files src`,
  `${C}git blame -L 1,10 src/a.ts`,
  `${C}git describe --tags`,
  `${C}git remote`,
  `${C}git config --get user.name`,
  `${C}sed -n '1,40p' src/a.ts`,
  `${C}awk -F: '{print $1}' a.txt`,
  `${C}awk '{print $2, NR}' a.txt`,
  `${C}awk 'NR>1 {print $NF}' a.txt`,
  `${C}awk '/^x/ {print}' a.txt`,
  `${C}ls | wc -l && echo done`,
  `${C}(ls; true) 2>/dev/null`,
  `${C}ls src >/dev/null 2>&1`,
  `${C}diff <(sort a) <(sort b)`,
  `${C}ls # a comment`,
  `${C}git log -1`,
  `cd ${REPO}/src && ls && wc -l a.ts`,
  `cd ~/../repo && ls`.replace('~/../repo', REPO),
  `${C}for f in a b c; do wc -l $f/x.ts; done`,
  `${C}for f in src/a.ts src/b.ts; do wc -l "$f"; done`,
  `${C}echo "$(grep -m1 '^status:' a/meta.yaml | awk '{print $2}')"`,
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
  [`${C}xargs rm < list`, /not allowlisted: xargs/],
  [`${C}ls | xargs cat`, /not allowlisted: xargs/],
  ['env ls', /not allowlisted: env/],
  ['sudo ls', /not allowlisted: sudo/],
  [`${C}find . -exec rm '{}' \\;`, /find: -exec/],
  ['find . -exec rm {} \\;', /brace/],
  [`${C}find . -delete`, /find: -delete/],
  [`${C}find . -ok rm "{}" \\;`, /find: -ok/],
  [`${C}find . -execdir ls ;`, /find: -execdir/],
  [`${C}find . -fprint out`, /find: -fprint/],
  [`${C}sed -i 's/a/b/' x`, /sed/],
  [`${C}sed 's/a/b/w out' x`, /sed: script/],
  [`${C}sed -n '1e rm x' a`, /sed: script/],
  ["awk 'BEGIN{system(\"rm x\")}'", /awk: only a print program/],
  [`${C}awk '{print > "out"}' a`, /awk: only a print program/],
  ["awk '{ \"date\" | getline d }'", /awk: only a print program/],
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
  ['ls /', /protected path/],
  ['cat ~/.s*/id_rsa', /outside the readable roots/],
  [`${C}grep --file=/w/home/.netrc x`, /protected path/],
  ['cat /dev/zero', /device path/],
  [`${C}head -c 10 /dev/urandom`, /device path/],
  ['cat /proc/self/environ', /device path/],
  [`${C}cat ../home/.ssh/id_rsa`, /protected path/],
  [`${C}for f in a; do cat ../$f; done`, /outside the readable roots/],
  [`${C}for f in a; do cat /w/home/$f; done`, /outside the readable roots/],
  [`${C}git -c core.pager=sh log`, /global option/],
  [`${C}git -C /tmp log`, /global option/],
  [`${C}git --exec-path=/x status`, /global option/],
  [`${C}git log --output=x`, /git: --output/],
  [`${C}git diff --ext-diff`, /git: --ext-diff/],
  // git accepts unambiguous abbreviations and bundled short options (Aegis re-check, 2026-10-20)
  [`${C}git log --outp=x`, /git: --outp/],
  [`${C}git log --out=/Users/u/.zshrc`, /git: --out/],
  [`${C}git diff --ext-d`, /git: --ext-d/],
  [`${C}git show --textc HEAD`, /git: --textc/],
  [`${C}git log -pOfoo`, /git: -pOfoo/],
  [`${C}git log --pag`, /git: --pag/],
  [`${C}git show --textconv HEAD`, /git: --textconv/],
  [`${C}git commit -m x`, /git: subcommand commit/],
  [`${C}git push`, /git: subcommand push/],
  [`${C}git checkout main`, /git: subcommand checkout/],
  [`${C}git branch newname`, /git branch: a name/],
  [`${C}git branch -D x`, /git branch: -D/],
  [`${C}git remote add x y`, /git remote/],
  [`${C}git config user.name x`, /git config/],
  [`${C}git stash`, /git stash: only list/],
  ['s=$(echo x); cat "$s"', /substitution in a path argument/],
  ['s=$(echo x); echo $s', /unquoted tainted/],
  ['PATH=$(echo x)', /env assignment/],
  [`${C}sort -o out a`, /sort: flag -o/],
  [`${C}sort --output=out a`, /sort: flag --output/],
  [`${C}sort --compress-program=sh a`, /sort: flag --compress-program/],
  [`${C}uniq a out`, /uniq: a second operand/],
  [`${C}file -C -m x`, /file: flag -C/],
  ['date 010100002030', /date: an operand sets the clock/],
  [`${C}jq -f prog.jq a`, /jq: -f/],
  [`${C}jq -n 'env'`, /jq: env/],
  [`${C}jq -n '$ENV.TOKEN'`, /jq: env/],
  ['cd /w/home && ls', /cd: outside/],
  ['cd .. && ls', /cd: a relative path/],
  [`${C}ls && cd src`, /cd: a relative path that is not an existing directory/],
  ['cd src | ls', /cd: only as a whole top-level command/],
  ['cd - && ls', /cd: one literal path/],
  ['! ls', /negation/],
  ['echo $((1+2))', /arithmetic/],
  ["echo $'\\x41'", /quoting/],
  ['echo {a,$(rm x)}', /brace/],
  ['echo {a,{b,c}}', /brace: nesting/],
  ['echo {a}', /brace/],
  ['echo {=ls,x}', /brace/],
  ['echo {~,x}', /brace/],
  ['echo {1..201}', /more than 200/],
  ['echo $f{a,b}', /brace after a parameter/],
  ['echo a}', /unquoted brace/],
  ['{ ls; }', /brace/],
  ['if true; then ls; fi', /unsupported compound if/],
  ['while true; do ls; done', /unsupported compound while/],
  ['case x in x) ls;; esac', /a relative path with an unknown cwd/],
  ['case x in x) echo a;& y) echo b;; esac', /operator ;&/],
  ['case x in x) echo a;;& y) echo b;; esac', /operator ;;&/],
  ['echo a;;', /missing separator|unexpected/],
  ['case $(rm x) in x) echo a;; esac', /not allowlisted: rm/],
  ['case x in $y) echo a;; esac', /case: a pattern/],
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
  [`${C}ls 3>/dev/null`, /redirection 3>/],
  [`${C}ls 2>&-`, /redirection/],
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
  // Aegis C1: a substitution never reaches a path argument; a loop iterates only literal items
  ['cat "$(echo ~/.ssh/id_rsa)"', /cat: a substitution in a path argument/],
  [`${C}cat "$(echo ~/.ssh/id_rsa)"`, /cat: a substitution in a path argument/],
  ['for f in $(printf %s ~/.aws/credentials); do cat $f; done', /for: a substitution in the word list/],
  ['cat $(dirname ~/.ssh/x)/id_rsa', /cat: a substitution in a path argument/],
  ['cat `echo ~/.ssh/id_rsa`', /cat: a substitution in a path argument/],
  [`${C}for f in $(ls); do sort $f; done`, /for: a substitution/],
  [`${C}for f in $(ls); do git show $f; done`, /for: a substitution/],
  [`${C}for f in "a b"; do cat $f; done`, /for: an unsafe value/],
  [`${C}for f in -r; do grep x $f; done`, /for: an unsafe value/],
  [`${C}for f in 2026-10-*; do cat $f; done`, /for: an unsafe value \(or a glob that matched nothing\)/],
  [`${C}for f in a; do for g in $(cat $f); do cat $g; done; done`, /for: a substitution/],
  [`${C}grep x <(cat ~/.ssh/id_rsa)`, /protected path/],
  [`${C}sort $(echo a)`, /sort: dynamic argument/],
  // the founder's original loop is refused under C1 (see FOUNDER_SAFE)
  [FOUNDER, /for: a substitution in the word list/],
  // Aegis C2: printf takes no flag; echo/test/pwd/which only a tight flag set
  ['printf -v HOME %s h; git status', /printf: a flag/],
  ['printf -v PATH %s /tmp/evil', /printf: a flag/],
  ['printf -- -v', /printf: a flag/],
  ['printf "$(echo %s)" x', /printf: the format is not literal/],
  ['echo -x hi', /echo: flag -x/],
  [`${C}test -v HOME`, /test: flag -v/],
  ['pwd -x', /pwd: flag -x/],
  ['pwd src', /pwd: an operand/],
  ['which -x node', /which: flag -x/],
  ['test -f ~/.ssh/id_rsa', /protected path/],
  // Aegis H1: awk is one print program, nothing else
  [`${C}awk '{print ARGV[1]}' a`, /awk: only a print program/],
  [`${C}awk 'BEGIN{while((getline l < ARGV[1])>0) print l}' a`, /awk: only a print program/],
  [`${C}awk '{print FILENAME}' a`, /awk: only a print program/],
  [`${C}awk '{print ENVIRON["HOME"]}' a`, /awk: only a print program/],
  [`${C}awk -v x=1 '{print $1}' a`, /awk: flag -v/],
  // Aegis H2: no recursive or symlink-following reader flags; RW re-admits grep -r and rg in an ANCHORED run only
  // (shell-readonly-widen.test.ts), so here, unanchored, they still raise the card
  [`${C}grep -rn 'foo bar' src`, /grep -r: only in an anchored run/],
  [`${C}grep -R x .`, /grep: flag -R/],
  [`${C}grep -S x a`, /grep: flag -S/],
  [`${C}grep --recursive x .`, /grep -r: only in an anchored run/],
  [`${C}grep --recur x .`, /grep -r: only in an anchored run/],
  [`${C}grep --dereference-recursive x .`, /grep: flag --dereference-recursive/],
  [`${C}grep -d recurse x .`, /grep: flag -d/],
  [`${C}egrep -r x .`, /egrep -r: only in an anchored run/],
  [`${C}rg -n TODO src`, /rg: only in an anchored run/],
  [`${C}fd ts`, /fd: only in an anchored run/],
  [`${C}tree`, /tree: only in an anchored run/],
  [`${C}paradigm status`, /paradigm: only in an anchored run/],
  ['gnomon desk stats', /gnomon: only in an anchored run/],
  [`${C}ls -L src`, /ls: flag -L/],
  [`${C}ls -lR src`, /ls: flag -R/],
  [`${C}ls --recursive`, /ls: flag --recursive/],
  [`${C}du -L src`, /du: flag -L/],
  [`${C}du --files0-from=-`, /du: flag --files0-from/],
  [`${C}wc --files0-from=list`, /wc: flag --files0-from/],
  [`${C}find -L src`, /find: -L|find: src/],
  [`${C}find src -follow`, /find: -follow/],
  [`${C}stat -L a`, /stat: flag -L/],
  [`${C}diff -r a b`, /diff: flag -r/],
  [`${C}file -f names`, /file: flag -f/],
  // an attached FILE value of a short flag is checked as a path
  [`${C}grep -f../home/.ssh/id_rsa x a`, /protected path/],
  [`${C}grep -nf../../etc/../w/home/.aws/credentials x a`, /protected path/],
  [`${C}diff -X../home/.netrc a b`, /protected path/],
  [`${C}file -m../home/.ssh/id_rsa a`, /protected path/],
  // Aegis H3: a relative cd is refused (the cwd it starts from is unknown); a cd outside a root too
  ['cd src && ls', /cd: a relative path/],
  [`cd ${REPO}/../home && ls`, /cd: outside/],
  // Aegis H4: reads only inside the session roots and the system read roots
  ['cat /Users/someone/notes.txt', /outside the readable roots/],
  ['cat /w/other/a.txt', /outside the readable roots/],
  ['ls /var/log', /outside the readable roots/],
  [`${C}cat ../other/x`, /outside the readable roots/],
  // Aegis M1: date displays only
  ['date -f dates.txt', /date: flag -f/],
  ['date -r 0', /date: flag -r/],
  ['date -s 12:00', /date: flag -s/],
  ['date -d yesterday', /date: flag -d/],
  // Aegis M2: a relative path, an implicit cwd or git needs a known cwd
  ['ls', /a relative path with an unknown cwd/],
  ['cat README.md', /a relative path with an unknown cwd/],
  ['git status', /git: the cwd is unknown/],
  ['find . -name x', /a relative path with an unknown cwd/],
  ['wc -l src/*.ts', /a relative glob with an unknown cwd/],
  [`cd ${REPO}; cat README.md`, /a relative path with an unknown cwd/],
  [`cd ${REPO}\nls`, /a relative path with an unknown cwd/],
  [`${C}true || cat README.md`, /a relative path with an unknown cwd/],
  [`${C}ls; cat README.md`, /a relative path with an unknown cwd/],
  // Aegis M3: no remote URLs, no credential-bearing config keys
  [`${C}git remote -v`, /git remote: only bare, or -v in an anchored run/],
  [`${C}git config --get remote.origin.url`, /git config/],
  [`${C}git config --get-all http.https://x.extraheader`, /git config/],
  [`${C}git config --get credential.helper`, /git config/],
  // Low: `git branch -l NAME` created NAME in older git
  [`${C}git branch -l newname`, /git branch: -l/],
  // follow-up hardening: a git order file attached to -O, bash's unary `-a FILE`, zsh's `=cmd` PATH expansion
  [`${C}git diff -Oorder.txt`, /git: -Oorder.txt/],
  ['test -a ~/.ssh/id_rsa', /protected path/],
  ['[ ! -a /w/home/.aws/credentials ]', /protected path/],
  ['cat =ls', /=command expansion/],
  [`${C}cat =python3`, /=command expansion/],
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
  it("the founder's real example still parses as a for loop over read-only bodies", () => {
    const l = parseShell(FOUNDER);
    expect(l.items).toHaveLength(2);
    expect(l.items[1]!.pipe.cmds[0]!.t).toBe('for');
    expect(ro(FOUNDER_SAFE(`${REPO}/.paradigm/tasks/entries`).replace("awk '{print $2}'", 'sh'))).toMatchObject({ ok: false });
  });
  it('a too-long or NUL command is unparsed', () => {
    expect(ro('ls '.repeat(30_000)).ok).toBe(false);
    expect(ro('ls\0')).toMatchObject({ ok: false });
    expect(() => parseShell('ls\0')).toThrow(ShellParseError);
  });
  it('win32: a device namespace path is refused, case-folded protected paths too, the system roots are posix-only', () => {
    const w = { roots: ['C:\\w\\repo'], home: 'C:\\Users\\me', gnomonHome: 'C:\\Users\\me\\.gnomon', platform: 'win32' };
    expect(classifyReadOnly('cat \\\\\\\\.\\\\PhysicalDrive0', w).ok).toBe(false);
    expect(classifyReadOnly("cat 'C:\\USERS\\ME\\.SSH\\id_rsa'", w)).toMatchObject({ ok: false, why: 'protected path' });
    expect(classifyReadOnly("cat 'C:\\w\\repo\\a.txt'", w)).toEqual({ ok: true });
    expect(classifyReadOnly("cat 'C:\\Windows\\win.ini'", w)).toMatchObject({ ok: false, why: 'outside the readable roots' });
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
    expect(pass({ command: 'pwd', description: 'd', timeout: 1000 })).toEqual({ ok: true, command: 'pwd', root: null });
  });
  it('cards any other key, a non-text command, a flagged card, a home root, another tool, an unknown cwd', () => {
    expect(pass({ command: 'pwd', run_in_background: true })).toMatchObject({ ok: false, why: 'input-key' });
    expect(pass({ command: 'pwd', dangerouslyDisableSandbox: false })).toMatchObject({ ok: false, why: 'input-key' });
    expect(pass({ command: ['ls'] })).toMatchObject({ ok: false, why: 'bad-input' });
    expect(pass({ command: 'pwd', timeout: '1' })).toMatchObject({ ok: false, why: 'bad-input' });
    expect(pass({ command: 'pwd' }, ['ls \u202e'])).toMatchObject({ ok: false, why: 'flagged' });
    expect(pass({ command: 'pwd' }, ['x'], [home])).toMatchObject({ ok: false, why: 'home-root' });
    expect(pass({ command: 'rm x' })).toMatchObject({ ok: false, why: 'not-read-only: not allowlisted: rm' });
    expect(pass({ command: 'ls' })).toMatchObject({ ok: false, why: 'not-read-only: a relative path with an unknown cwd' });
    expect(autoBashReadOnly('Write', { command: 'ls' }, [root], ['x'], gh, process.platform, home)).toMatchObject({ ok: false, why: 'tool' });
  });
});
