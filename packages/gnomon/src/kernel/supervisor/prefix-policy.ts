/**
 * @symbol #prefix-policy
 *
 * #prefix-policy (TD-2026-10-20-294, Aegis H1/M3 on prefix-scoped always rules). A prefix rule
 * auto-allows every later Bash command whose argv starts with the prefix, so a prefix that names a
 * program able to run arbitrary code (a shell, an interpreter, a runner, a package-manager script, a
 * git subcommand that runs configured programs) IS arbitrary code execution and is never a rule.
 *
 * One policy, applied in THREE places (the GUI offer is advisory only; the kernel enforces):
 *   1. offer   — permission.ts offers only prefixes `prefixRefusal` passes;
 *   2. accept  — the broker refuses approve{always, scope:{kind:'prefix'}} whose prefix fails it;
 *   3. fold + match — RuleBook forms no rule from a refused prefix (an older chain row learned under a
 *      looser policy never matches) and `prefixMatchRefusal` re-checks every later argv at match time.
 *
 * The policy (default deny, fail closed):
 *   - 2 or 3 words; never a single word (`git` = every git command; `ls` today, an alias tomorrow).
 *   - every word is printable ASCII (0x21–0x7e): no homoglyph or invisible character can make two
 *     prefixes look alike; argv0 has no `/` or `\` (no path to a program the session can write).
 *   - argv0 is not an interpreter, shell or runner (INTERPRETER_DENYLIST, plus python*).
 *   - package managers / build tools (BUILD_TOOLS): only an allowlisted read-only subcommand that runs no
 *     project-defined code (BUILD_TOOL_ALLOW). `npm test` is NOT allowed: it runs scripts the session can
 *     edit; ALLOW_NPM_TEST_PREFIX is the founder's switch for that decision, default OFF.
 *   - git: exactly two words, the subcommand in GIT_SUBCOMMAND_ALLOW (read-ish; never push, commit, fetch,
 *     config, submodule, hook …). At match time GIT_REFUSED_OPTIONS (`-c`, `-C`, `--exec-path`,
 *     `--ext-diff`, `--textconv`, `--output`, `--upload-pack` …) refuse the match; `git branch` only with
 *     listing options (a bare name would create a branch, -D deletes one).
 *   - no prefix word or later argument names a path outside the session roots: a `..` segment, a `~`
 *     word, a `\` or an absolute path outside the roots (also after `=` in `--opt=/x`) refuses the match;
 *     `-C`-style directory options (CHDIR_OPTIONS) refuse it outright.
 *
 * Residual (documented, spec §3.4): Claude's Bash tool keeps a persistent cwd across calls. The kernel
 * does not know it, so a relative path is resolved against an unknown directory; refusing `..` and
 * out-of-root absolute paths bounds the reach only while that cwd is inside the roots (a `cd` elsewhere
 * is itself a carded command). Symlinks inside the roots that point outside them, and repo-local git
 * config the session can write (core.fsmonitor, core.pager, diff.external) are not modelled here.
 */
import path from 'node:path';

/** Founder's decision point: `npm test` (and pnpm/yarn test) as a prefix rule. It runs scripts the session can edit. Default OFF. */
export const ALLOW_NPM_TEST_PREFIX = false;

export const INTERPRETER_DENYLIST: ReadonlySet<string> = new Set([
  'sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'csh', 'tcsh', 'env', 'exec', 'command', 'builtin', 'eval', 'source', '.', 'xargs', 'find', 'nice', 'nohup', 'timeout',
  'sudo', 'doas', 'su', 'time', 'watch', 'node', 'deno', 'bun', 'python', 'python3', 'ruby', 'perl', 'php', 'lua', 'npx', 'pnpx', 'bunx', 'osascript', 'open',
]);

/** Package managers and build tools: default deny, only BUILD_TOOL_ALLOW subcommands. */
export const BUILD_TOOLS: ReadonlySet<string> = new Set(['npm', 'pnpm', 'yarn', 'bun', 'make', 'gmake', 'cargo', 'go', 'gradle', 'gradlew', 'mvn', 'mvnw']);

const TEST = ALLOW_NPM_TEST_PREFIX ? ['test'] : [];
export const BUILD_TOOL_ALLOW: Readonly<Record<string, readonly string[]>> = Object.freeze({
  npm: ['ls', 'list', 'view', 'outdated', 'explain', ...TEST],
  pnpm: ['ls', 'list', 'outdated', 'why', ...TEST],
  yarn: ['why', 'info', 'list', ...TEST],
  cargo: ['tree'],
  go: ['list', 'env', 'version'],
});

export const GIT_SUBCOMMAND_ALLOW: ReadonlySet<string> = new Set(['status', 'log', 'diff', 'show', 'branch', 'blame', 'shortlog', 'describe', 'rev-parse', 'ls-files', 'ls-tree', 'grep']);

/** git options that refuse a prefix match wherever they appear after the prefix (`--x=value` and `-xVALUE` forms too). */
export const GIT_REFUSED_OPTIONS: readonly string[] = [
  '-c', '-C', '--exec-path', '--git-dir', '--work-tree', '--config-env', '--namespace', '-p', '--paginate', '--upload-pack', '--receive-pack', '-u',
  '--ext-diff', '--textconv', '--output', '-O', '--open-files-in-pager', '--filters', '--exec',
];

/** `git branch` listing options (anything else — a name, -d/-D/-m/-f/--set-upstream — refuses the match). */
const GIT_BRANCH_LIST = new Set(['-a', '-r', '-v', '-vv', '-l', '--list', '--all', '--remotes', '--verbose', '--show-current', '--no-color', '--color', '--merged', '--no-merged', '--contains', '--no-contains']);

/** Directory-changing / config-redirecting options of any tool: refuse the match outright. */
export const CHDIR_OPTIONS: readonly string[] = ['-C', '--directory', '--dir', '--cwd', '--prefix', '--manifest-path', '--userconfig', '--globalconfig', '--script-shell', '--node-options', '-toolexec', '--toolexec', '-exec', '-overlay', '-modfile'];

const PRINTABLE = /^[\x21-\x7e]+$/;

/** null when `prefix` may be a prefix rule, else why not (offer, accept and fold all use it). */
export function prefixRefusal(prefix: readonly string[]): string | null {
  if (prefix.length < 2 || prefix.length > 3) return 'a prefix rule is 2 or 3 words (a single word allows every command of the program)';
  if (!prefix.every((w) => typeof w === 'string' && w.length <= 128 && PRINTABLE.test(w))) return 'prefix words are printable ASCII only';
  const [a0, a1] = prefix as [string, string];
  if (a0.includes('/') || a0.includes('\\')) return 'the program is named by a path';
  if (INTERPRETER_DENYLIST.has(a0) || /^python/.test(a0)) return `${a0} runs arbitrary code: never a prefix rule`;
  if (prefix.some((w) => pathWordBad(w))) return 'a prefix word names a path';
  if (a0 === 'git') {
    if (prefix.length !== 2) return 'a git prefix is exactly two words: git <subcommand>';
    if (!GIT_SUBCOMMAND_ALLOW.has(a1)) return `git ${a1} can run configured programs or change the repo: never a prefix rule`;
    return null;
  }
  if (BUILD_TOOLS.has(a0)) {
    const allow = BUILD_TOOL_ALLOW[a0] ?? [];
    if (!allow.includes(a1)) return `${a0} ${a1} may run project-defined code (scripts, build scripts): never a prefix rule`;
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
    }
  }
  if (prefix[0] === 'git') {
    const later = argv.slice(2);
    for (const a of later) if (GIT_REFUSED_OPTIONS.some((o) => optHit(a, o))) return `git ${a}: an option that runs a program or redirects git`;
    if (prefix[1] === 'branch' && !later.every((a) => GIT_BRANCH_LIST.has(a) || /^--(sort|format)=/.test(a))) return 'git branch only lists under a prefix rule';
  }
  return null;
}

/** Display form of prefix words: each word quoted, non-printable-ASCII escaped as \uXXXX (Aegis M1). */
export function shownPrefixWords(prefix: readonly string[]): string {
  return prefix.map((w) => `'${Array.from(w).map((ch) => { const c = ch.codePointAt(0)!; return c >= 0x20 && c <= 0x7e && ch !== "'" && ch !== '\\' ? ch : c <= 0xffff ? `\\u${c.toString(16).padStart(4, '0')}` : `\\u{${c.toString(16)}}`; }).join('')}'`).join(' ');
}
