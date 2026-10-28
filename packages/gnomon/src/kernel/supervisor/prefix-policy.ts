/**
 * @symbol #prefix-policy
 *
 * #prefix-policy (TD-2026-10-20-294, Aegis H1/M3 on prefix-scoped always rules, and the second Aegis BLOCK). A
 * prefix rule auto-allows every later Bash command whose argv starts with the prefix, so a prefix that names a
 * program able to run arbitrary code (a shell, an interpreter, a runner, a package manager or build tool, a git
 * subcommand that runs configured programs) IS arbitrary code execution and is never a rule.
 *
 * One policy, applied in FOUR places (the GUI offer is advisory only; the kernel enforces):
 *   1. offer   — permission.ts offers only prefixes `prefixRefusal` passes;
 *   2. accept  — the broker refuses approve{always, scope:{kind:'prefix'}} whose prefix fails it;
 *   3. fold    — RuleBook forms no rule from a refused prefix (an older chain row learned under a looser policy);
 *   4. match   — `prefixMatchRefusal` re-checks the prefix and every later argv word at match time; manual mode
 *                never matches a prefix rule (rules.ts).
 *
 * The policy (default deny, fail closed):
 *   - 2 or 3 words; never a single word (`git` = every git command; `ls` today, an alias tomorrow).
 *   - every word is printable ASCII (0x21–0x7e): no homoglyph or invisible character can make two
 *     prefixes look alike; argv0 has no `/` or `\` (no path to a program the session can write).
 *   - argv0 is not an interpreter, shell or runner (INTERPRETER_DENYLIST, plus python*).
 *   - argv0 is not a destructive program (DESTRUCTIVE_ARGV0: rm, mv, dd, truncate, shred, chmod, chown, rsync …;
 *     Aegis C6'a2-2 M1): its later arguments decide what it destroys, so no match-time check can bound it.
 *   - every argv0 check uses ONE normalised form (normalArgv0: lowercased, `.exe` dropped; Aegis C6'a2-2 R1), as
 *     APFS and NTFS resolve `Env`, `GIT` or `bash.exe`; a git or build-tool subcommand is lowercased too.
 *   - package managers / build tools (BUILD_TOOLS): NONE is ever a prefix rule. BUILD_TOOL_PREFIX_ALLOW is EMPTY
 *     (Aegis second BLOCK, H2–H4/M1/M2): even a "read-only" subcommand runs or routes code the repo controls —
 *     `.yarnrc.yml` yarnPath swaps the yarn binary, `.cargo/config.toml` rustc-wrapper / build.rustc runs a program
 *     on `cargo tree`, `go env -w` (GOFLAGS=-toolexec) persists a program for every later go command, `.pnpmfile.cjs`
 *     hooks run on `pnpm ls`, and `npm view --registry=https://x` sends package names (and `.npmrc` auth) to any
 *     host. A future entry MUST land with a malicious-project-config falsifier for that tool. ALLOW_NPM_TEST_PREFIX
 *     stays the founder's switch for `npm test` (runs scripts the session can edit), default OFF.
 *   - git: exactly two words, the subcommand in GIT_SUBCOMMAND_ALLOW (read-ish; never push, commit, fetch,
 *     config, submodule, hook …). At match time git's option PARSING is modelled, not its spelling (Aegis second
 *     BLOCK, H1): git accepts any unambiguous ABBREVIATION of a long option (`--outp=f` is `--output=f`, `--ext-d`
 *     is `--ext-diff`, `--open=sh` is `--open-files-in-pager=sh`), so a `--name` (before `=`) that is a prefix of
 *     ANY refused long option (GIT_REFUSED_LONG) refuses the match; and git BUNDLES short options (`-iOsh` carries
 *     `-O sh`), so a short-option word containing a refused letter (GIT_REFUSED_SHORT: O c C p u) ANYWHERE refuses
 *     it. shell-readonly's gitOptBad (the read-only auto-pass rule) is applied as well. `git branch` only with
 *     listing options (a bare name would create a branch, -D deletes one). A per-subcommand option ALLOWLIST was
 *     weighed and not taken: log/diff/show accept several hundred options; the prefix-of-refused rule covers every
 *     abbreviation of every refused option, which is the gap Aegis found.
 *   - no prefix word or later argument names a path outside the session roots: a `..` segment, a `~`
 *     word, a `\` or an absolute path outside the roots (also after `=` in `--opt=/x`) refuses the match;
 *     `-C`-style directory options (CHDIR_OPTIONS) refuse it outright.
 *   - no later argument names a GATE-CLASS path (manifest/layers gateClassPathRule: `.git/**`, `.claude/**`,
 *     package.json, CI files …): a prefix-ruled command never touches repo git config, hooks or steering files
 *     without a card (`cp x .git/config` under a `cp x` rule is refused).
 *
 * Residual (documented, spec §3.4): Claude's Bash tool keeps a persistent cwd across calls. The kernel
 * does not know it, so a relative path is resolved against an unknown directory; refusing `..` and
 * out-of-root absolute paths bounds the reach only while that cwd is inside the roots (a `cd` elsewhere
 * is itself a carded command). Symlinks inside the roots that point outside them are not modelled. Repo-local
 * git config (core.fsmonitor, core.pager, diff.external, core.hooksPath) IS the program a `git <sub>` rule runs:
 * `.git/**` is gate-class (an Edit/Write to it always takes a card) and no prefix-ruled argument may name it, but
 * a config written before the rule existed, or by a carded command the human approved, is trusted by git.
 */
import path from 'node:path';
import { gateClassPathRule } from '../manifest/layers.js';
import { gitOptBad } from './shell-readonly.js';

/** Founder's decision point: `npm test` (and pnpm/yarn test) as a prefix rule. It runs scripts the session can edit. Default OFF. */
export const ALLOW_NPM_TEST_PREFIX = false;

export const INTERPRETER_DENYLIST: ReadonlySet<string> = new Set([
  'sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'csh', 'tcsh', 'env', 'exec', 'command', 'builtin', 'eval', 'source', '.', 'xargs', 'find', 'nice', 'nohup', 'timeout',
  'sudo', 'doas', 'su', 'time', 'watch', 'node', 'deno', 'bun', 'python', 'python3', 'ruby', 'perl', 'php', 'lua', 'npx', 'pnpx', 'bunx', 'osascript', 'open',
  'awk', 'gawk', 'mawk', 'nawk', 'sed', 'ssh', 'docker', 'podman', 'kubectl', 'uvx', 'pipx',
  // Aegis LP1 review (gnomon-loops §3.1): Windows script hosts and exec wrappers that run another program
  'cmd', 'powershell', 'pwsh', 'wscript', 'cscript', 'mshta', 'arch', 'script', 'stdbuf', 'setsid', 'chroot', 'sandbox-exec', 'busybox',
]);

/**
 * Aegis C6'a2-2 M1 (G-BRK-09): programs that delete, overwrite, move, re-own or re-permission data (or kill
 * processes). Their damage is in their ARGUMENTS (`rm build/x -rf src` under an `rm build/x` rule), which no
 * path check can bound, so none is EVER a prefix rule: refused at offer, accept, fold and match (prefixRefusal).
 * Compared case-insensitively with any `.exe` dropped (APFS and NTFS resolve `RM` and `rm.exe` to rm). find
 * (-delete, -exec) and xargs are already INTERPRETER_DENYLIST; git clean / reset / checkout / restore / rm /
 * stash are outside GIT_SUBCOMMAND_ALLOW; rsync (--delete) is here.
 */
export const DESTRUCTIVE_ARGV0: ReadonlySet<string> = new Set([
  'rm', 'rmdir', 'unlink', 'srm', 'shred', 'wipe', 'trash', 'mv', 'dd', 'truncate', 'ln', 'install', 'rsync',
  'chmod', 'chown', 'chgrp', 'chflags', 'chattr', 'setfacl', 'xattr', 'mkfs', 'newfs', 'fdisk', 'diskutil', 'wipefs', 'mkswap',
  'kill', 'pkill', 'killall', 'del', 'erase', 'rd', 'move', 'ren', 'rename', 'remove-item',
  // Aegis C6'a2-2 R2: they overwrite or extract files where their later arguments say
  'cp', 'tee', 'tar', 'unzip', 'ditto', 'patch', 'split', 'scp', 'curl', 'wget', 'copy', 'xcopy', 'robocopy',
]);

/** Aegis C6'a2-2 M1: argv0 names a destructive program (case-insensitive, `.exe` dropped, mkfs.* / newfs_* too). */
/**
 * Aegis C6'a2-2 R1: argv0 as the filesystem resolves it. APFS and NTFS are case-insensitive and Windows adds `.exe`,
 * so `Env`, `GIT` and `bash.exe` are env, git and bash: EVERY argv0 check (interpreter, python, git, build tool,
 * destructive) uses this one form, at offer, accept, fold and match.
 */
export function normalArgv0(a0: string): string {
  return a0.toLowerCase().replace(/\.exe$/, '');
}

export function destructiveArgv0(a0: string): boolean {
  const n = normalArgv0(a0);
  return DESTRUCTIVE_ARGV0.has(n) || /^(mkfs|newfs)[._]/.test(n);
}

/**
 * Package managers and build tools: NEVER a prefix rule (BUILD_TOOL_PREFIX_ALLOW is empty; see the header). Listed
 * so a `<tool> <subcommand>` pair can never slip through the generic two-word path.
 */
export const BUILD_TOOLS: ReadonlySet<string> = new Set([
  'npm', 'pnpm', 'yarn', 'bun', 'make', 'gmake', 'cargo', 'go', 'gradle', 'gradlew', 'mvn', 'mvnw',
  'rustc', 'rustup', 'pip', 'pip3', 'uv', 'poetry', 'pdm', 'hatch', 'bundle', 'bundler', 'rake', 'gem', 'composer', 'dotnet', 'swift', 'xcodebuild',
  'cmake', 'ninja', 'bazel', 'bazelisk', 'buck', 'meson', 'just', 'task', 'ant', 'sbt', 'lein', 'mix', 'tsc', 'vitest', 'jest', 'pytest', 'tox', 'nox', 'corepack',
]);

/**
 * EMPTY on purpose (TD-2026-10-20-294, Aegis second BLOCK H2–H4/M1/M2). Every package manager / build tool reads
 * project config that can run or route code on ANY subcommand: `.yarnrc.yml` yarnPath, `.cargo/config.toml`
 * rustc-wrapper, `go env -w` (GOFLAGS=-toolexec), `.pnpmfile.cjs`, and `npm view --registry` exfiltrates to any
 * host. An entry added here must ship with a malicious-project-config falsifier for that tool. Only the founder's
 * ALLOW_NPM_TEST_PREFIX switch (default OFF) would add `<pm> test`.
 */
const NPM_TEST_ALLOW: Record<string, readonly string[]> = { npm: ['test'], pnpm: ['test'], yarn: ['test'] };
export const BUILD_TOOL_PREFIX_ALLOW: Readonly<Record<string, readonly string[]>> = Object.freeze(ALLOW_NPM_TEST_PREFIX ? NPM_TEST_ALLOW : {});

export const GIT_SUBCOMMAND_ALLOW: ReadonlySet<string> = new Set(['status', 'log', 'diff', 'show', 'branch', 'blame', 'shortlog', 'describe', 'rev-parse', 'ls-files', 'ls-tree', 'grep']);

/**
 * git long options (name without `--`) that run a program, write a file, read a file by name or redirect git. ANY
 * `--name` (before `=`) that is a prefix of one of these refuses the match: git resolves unambiguous abbreviations.
 */
export const GIT_REFUSED_LONG: readonly string[] = [
  'exec-path', 'git-dir', 'work-tree', 'config', 'config-env', 'namespace', 'paginate', 'upload-pack', 'receive-pack', 'super-prefix',
  'ext-diff', 'textconv', 'output', 'output-directory', 'open-files-in-pager', 'filters', 'exec', 'contents', 'ignore-revs-file', 'exclude-from', 'pager',
];
/** git short-option letters refused ANYWHERE in a short-option word (git bundles `-abc` and attaches values `-Osh`). */
export const GIT_REFUSED_SHORT: ReadonlySet<string> = new Set(['O', 'c', 'C', 'p', 'u']);

/** true when `arg` is a git option a prefix rule must not pass (Aegis second BLOCK, H1). */
export function gitPrefixOptBad(arg: string): boolean {
  if (gitOptBad(arg)) return true;
  if (arg.startsWith('--')) {
    const name = arg.slice(2).split('=')[0]!;
    if (!name) return false; // `--` ends the options
    return GIT_REFUSED_LONG.some((bad) => bad.startsWith(name));
  }
  if (!/^-[^-]/.test(arg)) return false;
  return Array.from(arg.slice(1)).some((ch) => GIT_REFUSED_SHORT.has(ch));
}

/** `git branch` listing options (anything else — a name, -d/-D/-m/-f/--set-upstream — refuses the match). */
const GIT_BRANCH_LIST = new Set(['-a', '-r', '-v', '-vv', '-l', '--list', '--all', '--remotes', '--verbose', '--show-current', '--no-color', '--color', '--merged', '--no-merged', '--contains', '--no-contains']);

/** Directory-changing / config-redirecting options of any tool: refuse the match outright. */
export const CHDIR_OPTIONS: readonly string[] = ['-C', '--directory', '--dir', '--cwd', '--prefix', '--manifest-path', '--userconfig', '--globalconfig', '--script-shell', '--node-options', '-toolexec', '--toolexec', '-exec', '-overlay', '-modfile'];

const PRINTABLE = /^[\x21-\x7e]+$/;

/** null when `prefix` may be a prefix rule, else why not (offer, accept, fold and match all use it). */
export function prefixRefusal(prefix: readonly string[]): string | null {
  if (prefix.length < 2 || prefix.length > 3) return 'a prefix rule is 2 or 3 words (a single word allows every command of the program)';
  if (!prefix.every((w) => typeof w === 'string' && w.length <= 128 && PRINTABLE.test(w))) return 'prefix words are printable ASCII only';
  const [raw0, raw1] = prefix as [string, string];
  if (raw0.includes('/') || raw0.includes('\\')) return 'the program is named by a path';
  // Aegis R1: one normalised argv0 (and git/build-tool subcommand) for every check below
  const a0 = normalArgv0(raw0);
  const a1 = raw1.toLowerCase();
  if (INTERPRETER_DENYLIST.has(a0) || /^python/.test(a0)) return `${raw0} runs arbitrary code: never a prefix rule`;
  if (destructiveArgv0(a0)) return `${a0} can delete or overwrite whatever its later arguments name: never a prefix rule`;
  if (prefix.some((w) => pathWordBad(w))) return 'a prefix word names a path';
  if (a0 === 'git') {
    if (prefix.length !== 2) return 'a git prefix is exactly two words: git <subcommand>';
    if (!GIT_SUBCOMMAND_ALLOW.has(a1)) return `git ${a1} can run configured programs or change the repo: never a prefix rule`;
    return null;
  }
  if (BUILD_TOOLS.has(a0)) {
    const allow = BUILD_TOOL_PREFIX_ALLOW[a0] ?? [];
    if (prefix.length !== 2 || !allow.includes(a1)) return `${a0} reads project config that can run or route code on any subcommand: never a prefix rule`;
    return null;
  }
  if (a1.startsWith('-')) return 'the second word of a prefix is a subcommand, not an option';
  return null;
}

/** A word that names a path: `..` segment, `~`, `\`, or absolute. */
function pathWordBad(w: string): boolean {
  return w.startsWith('/') || w.startsWith('~') || w.includes('\\') || w.split('/').includes('..');
}

const within = (p: string, roots: readonly string[]): boolean =>
  roots.some((r) => {
    const rel = path.relative(path.resolve(r), path.resolve(p));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });

const optHit = (arg: string, opt: string): boolean => arg === opt || arg.startsWith(`${opt}=`) || (/^-[A-Za-z]$/.test(opt) && arg.startsWith(opt) && !arg.startsWith('--'));

/** The gate-class rule a word names (relative, or absolute inside a root), else null. Win32 short-name aliases count only on win32 (`HEAD~3` is a rev). */
function gateClassOf(v: string, roots: readonly string[]): string | null {
  if (v === '' || v === '.' || v === './') return null;
  let rel = v;
  if (v.startsWith('/')) {
    const r = roots.find((x) => within(v, [x]));
    if (!r) return null; // refused by the out-of-root check
    rel = path.relative(path.resolve(r), path.resolve(v));
    if (rel === '') return null;
  }
  const why = gateClassPathRule(rel);
  if (why === null || why === 'outside-root') return null;
  if (why === 'win-alias' && process.platform !== 'win32') return null;
  return why;
}

/**
 * null when `argv` (already known to start with `prefix`, a single literal simple command) may be auto-allowed
 * by the prefix rule in a session whose roots are `roots`; else why not. Re-runs prefixRefusal (a rule folded
 * from an older chain row under a looser policy never matches).
 */
export function prefixMatchRefusal(argv: readonly string[], prefix: readonly string[], roots: readonly string[]): string | null {
  const why = prefixRefusal(prefix);
  if (why) return why;
  if (!roots.length) return 'no session roots';
  for (const a of argv.slice(prefix.length)) {
    if (CHDIR_OPTIONS.some((o) => optHit(a, o))) return `${a}: a directory/config option`;
    const vals = [a, ...(a.includes('=') ? [a.slice(a.indexOf('=') + 1)] : [])];
    for (const v of vals) {
      if (v.startsWith('~') || v.includes('\\') || v.split('/').includes('..')) return `${a}: a path that can leave the roots`;
      if (v.startsWith('/') && !within(v, roots)) return `${a}: an absolute path outside the session roots`;
      const gate = gateClassOf(v, roots);
      if (gate) return `${a}: a gate-class path (${gate})`;
    }
  }
  if (normalArgv0(prefix[0] ?? '') === 'git') {
    const later = argv.slice(2);
    for (const a of later) if (gitPrefixOptBad(a)) return `git ${a.split('=')[0]}: an option that runs a program or redirects git`;
    if ((prefix[1] ?? '').toLowerCase() === 'branch' && !later.every((a) => GIT_BRANCH_LIST.has(a) || /^--(sort|format)=/.test(a))) return 'git branch only lists under a prefix rule';
  }
  return null;
}

/** Display form of prefix words: each word quoted, non-printable-ASCII escaped as \uXXXX (Aegis M1). */
export function shownPrefixWords(prefix: readonly string[]): string {
  return prefix.map((w) => `'${Array.from(w).map((ch) => { const c = ch.codePointAt(0)!; return c >= 0x20 && c <= 0x7e && ch !== "'" && ch !== '\\' ? ch : c <= 0xffff ? `\\u${c.toString(16).padStart(4, '0')}` : `\\u{${c.toString(16)}}`; }).join('')}'`).join(' ');
}
