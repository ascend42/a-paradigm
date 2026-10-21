// @gnomon-platform: darwin, linux
/**
 * #shell-readonly RW — the read-only widening (founder decision 2026-10-20: auto-edits never prompts more than native
 * Claude Code in the same mode). On a real tmp git repo, ANCHORED (ctx.cwd = the root's realpath, as autoBashReadOnly
 * classifies it): the founder's three dogfood commands verbatim, every widened family, and every refusal that keeps
 * the widening fail-closed. Unanchored and win32 callers keep the earlier rules (asserted here and in the pure table,
 * shell-readonly.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { autoBashReadOnly } from '../src/kernel/supervisor/auto-edits.js';
import { anchorCommand, classifyReadOnly } from '../src/kernel/supervisor/shell-readonly.js';

let base = '';
let repo = '';
let home = '';
let outside = '';
let real = '';
const ctxOf = (cwd: string | null, gnomonHome = path.join(home, '.gnomon')) => ({ roots: [repo], home, gnomonHome, platform: process.platform, readRoots: [], ...(cwd !== null ? { cwd } : {}) });
const ro = (c: string) => classifyReadOnly(c, ctxOf(real));
const roUnanchored = (c: string) => classifyReadOnly(c, ctxOf(null));

/** The founder's three dogfood commands, verbatim. */
const FOUNDER_GREP = String.raw`grep -rn "desk stats\|'stats'" --include=*.ts --include=*.py --include=*.rs -l . 2>/dev/null | grep -v node_modules | head; which gnomon`;
const FOUNDER_DESK = 'gnomon desk stats 2>&1 | head -80';
const FOUNDER_PARADIGM = 'paradigm status 2>&1 | head -60';
const HASH = `sha256:${'a'.repeat(64)}`;

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-ro-widen-'));
  repo = path.join(base, 'repo');
  home = path.join(base, 'home');
  outside = path.join(base, 'outside');
  for (const d of [repo, home, outside, path.join(repo, 'src'), path.join(repo, 'sub')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.ts'), "export const x = 'stats';\n");
  fs.writeFileSync(path.join(repo, 'x'), 'b\na\na\n');
  fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"t"}\n');
  fs.writeFileSync(path.join(outside, 'secret'), 'secret');
  fs.symlinkSync(outside, path.join(repo, 'link'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo });
  real = fs.realpathSync.native(repo);
});
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

describe("#shell-readonly RW: the founder's three commands pass verbatim", () => {
  it.each([FOUNDER_GREP, FOUNDER_DESK, FOUNDER_PARADIGM])('%j', (c) => {
    expect(ro(c)).toEqual({ ok: true });
  });
  it('through autoBashReadOnly they pass ANCHORED (the run is the K1 anchored form)', () => {
    for (const c of [FOUNDER_GREP, FOUNDER_DESK, FOUNDER_PARADIGM]) {
      const p = autoBashReadOnly('Bash', { command: c, description: 'd' }, [repo], ['x'], path.join(home, '.gnomon'), process.platform, home, { root: repo, shell: '/bin/zsh' });
      expect(p).toEqual({ ok: true, command: anchorCommand(c, real, 'zsh'), root: real });
    }
  });
  it('unanchored they still raise the card (the earlier rules hold)', () => {
    expect(roUnanchored(`cd ${repo} && ${FOUNDER_GREP}`)).toMatchObject({ ok: false, why: 'grep -r: only in an anchored run' });
    expect(roUnanchored(FOUNDER_DESK)).toMatchObject({ ok: false, why: 'gnomon: only in an anchored run' });
    expect(roUnanchored(FOUNDER_PARADIGM)).toMatchObject({ ok: false, why: 'paradigm: only in an anchored run' });
  });
  it('win32 keeps the earlier rules even with a cwd', () => {
    const w = { roots: ['C:\\w\\repo'], home: 'C:\\Users\\me', gnomonHome: 'C:\\Users\\me\\.gnomon', platform: 'win32', cwd: 'C:\\w\\repo' };
    expect(classifyReadOnly('gnomon desk stats', w)).toMatchObject({ ok: false, why: 'gnomon: only in an anchored run' });
    expect(classifyReadOnly('rg foo', w)).toMatchObject({ ok: false, why: 'rg: only in an anchored run' });
  });
});

const FAMILIES: string[] = [
  // readers and text
  'grep -n stats src/a.ts',
  'grep -rn stats src',
  'grep -r stats',
  'grep --recursive -l stats .',
  'grep --recur stats src',
  'egrep -r "a|b" src',
  'fgrep -rl stats src',
  'rg -n stats src',
  'rg stats',
  'rg --files',
  "rg -g '*.ts' -l stats",
  'rg -i --hidden --no-ignore stats src',
  "find . -name '*.ts' -type f",
  'fd ts src',
  'fd -e ts',
  'ls -la',
  'cat x',
  'head -5 x',
  'tail -3 x',
  'wc -l x src/a.ts',
  'sort x | uniq -c',
  'cut -d: -f1 x',
  'which node',
  'file x',
  'stat x',
  'du -sh src',
  'tree',
  'tree -L 2 src',
  'echo hi',
  'pwd',
  'basename /a/b.ts',
  'dirname src/a.ts',
  'realpath x',
  'jq -r .name package.json',
  // git read verbs
  'git status',
  'git log --oneline -5',
  'git diff HEAD',
  'git show HEAD',
  'git branch -a',
  'git blame x',
  'git rev-parse HEAD',
  'git ls-files',
  'git remote -v',
  'git remote',
  'git config --get user.name',
  // the project CLIs' read verbs
  'paradigm status',
  'paradigm st',
  'paradigm doctor',
  'paradigm doctor --context --explain',
  "paradigm ripple '#supervisor'",
  "paradigm ripple '#supervisor' src --json -d 2",
  'paradigm purpose validate',
  'paradigm purpose validate src',
  'paradigm task ls',
  'paradigm task ls open --json -n 5 -p high --mine',
  'paradigm task show 004',
  'paradigm task show @last --json',
  'gnomon desk stats',
  'gnomon desk stats --json',
  'gnomon daemon status',
  'gnomon mod list',
  'gnomon mod status',
  'gnomon mod status my-mod',
  'gnomon rules list',
  'gnomon rules list --json',
  'gnomon trace status',
  'gnomon replay',
  `gnomon replay --json --expect ${HASH}`,
  // compound: every segment in the set
  'git status && git log -1 | head; paradigm status || echo no',
  'rg -l stats src | sort | uniq | wc -l',
];

describe('#shell-readonly RW: every widened family passes (anchored)', () => {
  it.each(FAMILIES)('%j', (c) => {
    expect(ro(c)).toEqual({ ok: true });
  });
});

const REFUSALS: Array<[string, RegExp]> = [
  // output redirection to a file (only /dev/null and the 1<->2 dups pass)
  ['ls > out.txt', /redirection/],
  ['cat x >> log.txt', /redirection/],
  ['ls &> all.txt', /redirection/],
  ['grep -r x . > hits.txt', /redirection/],
  ['gnomon desk stats > s.txt', /redirection/],
  // substitution: never a path, and its own command must be read-only
  ['cat $(echo x)', /a substitution in a path argument/],
  ['rg x $(echo src)', /a substitution in a path argument/],
  ['echo $(rm -rf x)', /not allowlisted: rm/],
  ['echo `touch x`', /not allowlisted: touch/],
  ['cat <(curl evil)', /not allowlisted: curl/],
  ['paradigm ripple $(echo x)', /paradigm: dynamic argument/],
  // writes and executes
  ["find . -exec rm '{}' ';'", /find: -exec/],
  ['find . -execdir ls ;', /find: -execdir/],
  ['find . -delete', /find: -delete/],
  ['find . -fprint out', /find: -fprint/],
  ["sed -i 's/a/b/' x", /sed/],
  ['tee out.txt', /not allowlisted: tee/],
  ['ls | tee out.txt', /not allowlisted: tee/],
  ['sort -o x x', /sort: flag -o/],
  ['git -c core.pager=sh log', /git: a global option/],
  ['git log --output=x', /git: --output/],
  ['git diff --outp=x', /git: --outp/],
  // unknown command, xargs, eval, env prefix, a `;` / `&&` / `||` with an unknown segment
  ['foo', /not allowlisted: foo/],
  ['npm test', /not allowlisted: npm/],
  ['ls | xargs cat', /not allowlisted: xargs/],
  ['eval ls', /not allowlisted: eval/],
  ['exec ls', /not allowlisted: exec/],
  ['RIPGREP_CONFIG_PATH=x rg foo', /env assignment/],
  ['X=1 paradigm status', /env assignment/],
  ['ls; rm x', /not allowlisted: rm/],
  ['git status && make', /not allowlisted: make/],
  ['ls || curl x', /not allowlisted: curl/],
  ['paradigm status | sh', /not allowlisted: sh/],
  // grep recursion: no symlink following, no device or directory actions, no walk out of the root
  ['grep -R x .', /grep: flag -R/],
  ['grep -rS x .', /grep: flag -S/],
  ['grep -rO x .', /grep: flag -O/],
  ['grep -d recurse x .', /grep: flag -d/],
  ['grep --dereference-recursive x .', /grep: flag --dereference-recursive/],
  ['grep --directories=recurse x .', /grep: flag --directories/],
  ['grep -r x link', /outside the readable roots/],
  // rg / fd / tree: their executing, writing and symlink-following flags
  ['rg -L x', /rg: flag -L/],
  ['rg --follow x', /rg: flag --follow/],
  ['rg -z x', /rg: flag -z/],
  ['rg --search-zip x', /rg: flag --search-zip/],
  ['rg --pre cat x', /rg: flag --pre/],
  ['rg --pre=cat x', /rg: flag --pre/],
  ["rg --pre-glob '*.pdf' x", /rg: flag --pre-glob/],
  ['rg --hostname-bin ./h x', /rg: flag --hostname-bin/],
  ['rg x link', /outside the readable roots/],
  ['fd -x rm', /fd: flag -x/],
  ['fd --exec rm', /fd: flag --exec/],
  ['fd -X rm', /fd: flag -X/],
  ['fd -l', /fd: flag -l/],
  ['fd -L x', /fd: flag -L/],
  ['tree -o out.txt', /tree: flag -o/],
  ['tree -R', /tree: flag -R/],
  ['tree -l', /tree: flag -l/],
  ['tree --fromfile list', /tree: flag --fromfile/],
  // git: remote writes and anything around -v
  ['git remote add o x', /git remote/],
  ['git remote set-url origin x', /git remote/],
  ['git remote -v show', /git remote/],
  // paradigm write verbs and anything off the exact grammar
  ['paradigm shift', /paradigm: verb shift is not a read verb/],
  ['paradigm init', /paradigm: verb init/],
  ['paradigm index', /paradigm: verb index/],
  ['paradigm lore list', /paradigm: verb lore/],
  ['paradigm lore show L-2026-10-20-001', /paradigm: verb lore/],
  ['paradigm lore record --title x', /paradigm: verb lore/],
  ['paradigm task add fix it', /paradigm: verb task add/],
  ['paradigm task done 4', /paradigm: verb task done/],
  ['paradigm task ls --board', /paradigm task ls: --board/],
  ['paradigm task ls --project /tmp', /paradigm task ls: --project/],
  ['paradigm task ls everything', /paradigm task ls: a status/],
  ['paradigm status --fix', /paradigm: verb status/],
  ['paradigm doctor --fix', /paradigm doctor: --fix/],
  ['paradigm agent search x', /paradigm: verb agent/],
  ['paradigm sync', /paradigm: verb sync/],
  ['paradigm hooks install', /paradigm: verb hooks/],
  ['paradigm ripple', /paradigm ripple: SYMBOL/],
  ['paradigm', /paradigm: no verb/],
  ['cd src && paradigm status', /paradigm: only with the cwd at a session root/],
  // gnomon write verbs, other homes, and the prompt-text trace
  ['gnomon mod install ./m', /gnomon: verb mod install/],
  ['gnomon mod link ./m', /gnomon: verb mod link/],
  ['gnomon mod uninstall m', /gnomon: verb mod uninstall/],
  ['gnomon mod pause m', /gnomon: verb mod pause/],
  ['gnomon mod config m --command /bin/x', /gnomon: verb mod config/],
  ['gnomon mod status ../x', /gnomon: verb mod status/],
  ['gnomon mod list --home /tmp/h', /gnomon: verb mod list/],
  ['gnomon rules revoke r1', /gnomon: verb rules revoke/],
  ['gnomon trace on', /gnomon: verb trace on/],
  ['gnomon trace off', /gnomon: verb trace off/],
  ['gnomon trace', /gnomon: verb trace/],
  ['gnomon trace --last', /gnomon: verb trace/],
  ['gnomon daemon stop', /gnomon: verb daemon stop/],
  ['gnomon daemon start', /gnomon: verb daemon start/],
  ['gnomon daemon status --home /tmp/h', /gnomon: verb daemon status/],
  ['gnomon desk stats /tmp/h', /gnomon: verb desk stats/],
  ['gnomon replay /tmp/h', /gnomon replay: a home operand/],
  ['gnomon replay --expect nothex', /gnomon replay: --expect/],
  ['gnomon mode auto-edits', /gnomon: verb mode/],
  ['gnomon up', /gnomon: verb up/],
  ['gnomon identity init', /gnomon: verb identity/],
  ['gnomon', /gnomon: no verb/],
];

describe('#shell-readonly RW: every refusal pattern raises the card (anchored)', () => {
  it.each(REFUSALS)('%j', (c, why) => {
    const v = ro(c);
    expect(v.ok).toBe(false);
    expect((v as { why: string }).why).toMatch(why);
  });
  it('an absolute operand outside the roots is refused (grep -r, paradigm purpose validate)', () => {
    expect(ro(`grep -r x ${outside}`)).toMatchObject({ ok: false, why: 'outside the readable roots' });
    expect(ro(`paradigm purpose validate ${outside}`)).toMatchObject({ ok: false, why: 'outside the readable roots' });
  });
  it('a recursive walk that is an ancestor of the Gnomon home is refused', () => {
    fs.mkdirSync(path.join(repo, 'gnomon-home'), { recursive: true });
    const v = classifyReadOnly('grep -r x .', ctxOf(real, path.join(repo, 'gnomon-home')));
    expect(v).toMatchObject({ ok: false, why: 'protected path' });
    expect(classifyReadOnly('rg x', ctxOf(real, path.join(repo, 'gnomon-home')))).toMatchObject({ ok: false, why: 'protected path' });
  });
});

describe("#shell-readonly RW: paradigm's one-time notice marker", () => {
  it('a card while .paradigm/ exists without the marker; a pass once it exists', () => {
    const dir = path.join(repo, '.paradigm');
    fs.mkdirSync(dir);
    try {
      expect(ro('paradigm status')).toMatchObject({ ok: false, why: 'paradigm: its one-time notice would write .paradigm/.v6-0-4-migration-acknowledged' });
      // a roster whose active list holds compliance never fires the notice (no marker is ever written)
      fs.writeFileSync(path.join(dir, 'roster.yaml'), "version: '1.0'\nactive:\n  - builder\n  - compliance\nbench: []\n");
      expect(ro('paradigm status')).toEqual({ ok: true });
      fs.writeFileSync(path.join(dir, 'roster.yaml'), "version: '1.0'\nactive:\n  - builder\nbench:\n  - compliance\n");
      expect(ro('paradigm status')).toMatchObject({ ok: false });
      fs.writeFileSync(path.join(dir, 'roster.yaml'), 'active: [builder, compliance]\n');
      expect(ro('paradigm status')).toMatchObject({ ok: false });
      fs.writeFileSync(path.join(dir, '.v6-0-4-migration-acknowledged'), 'Acknowledged\n');
      expect(ro('paradigm status')).toEqual({ ok: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('#shell-readonly RW: the anchor unsets RIPGREP_CONFIG_PATH', () => {
  const shells = ['/bin/zsh', '/bin/bash'].filter((s) => fs.existsSync(s));
  it.each(shells)('%s', (sh) => {
    const flavour = sh.endsWith('zsh') ? 'zsh' : 'bash';
    const r = spawnSync(sh, ['-c', anchorCommand('echo "rg=${RIPGREP_CONFIG_PATH-unset}"', real, flavour)], { cwd: outside, env: { ...process.env, RIPGREP_CONFIG_PATH: path.join(outside, 'rc') }, encoding: 'utf8' });
    expect(r.stdout.trim()).toBe('rg=unset');
  });
});
