/**
 * @symbol #shell-readonly
 *
 * #shell-readonly (spec §3.4 "Run modes (D87)", TD-2026-10-20-294 part 1):
 * PURE — is this Bash command PROVABLY read-only? Under `auto-edits` a command
 * this classifier accepts passes with no card, after
 * `approval.auto{modeRef:'mode:auto-edits:read-only'}`. It FAILS CLOSED:
 * anything it cannot parse, or parses but cannot prove, is `{ok:false}` and
 * the card is raised as in `ask`.
 *
 * PARSE (parseShell): a real POSIX/bash tokenizer for a SUBSET — words with
 * '…', "…", backslash escapes and line continuations; `$NAME`, `${NAME}`,
 * `${#NAME}`, `$(…)`, backticks and `<(…)` (each parsed recursively); unquoted
 * globs `* ? [`; `~` / `~/…`; comments; the operators ; && || | & and
 * newlines; subshells `( … )`; `for NAME in WORDS; do LIST; done`;
 * redirections (an IO number, then > >> >| < <> <& >& &> &>> << <<- <<<) and
 * heredocs (bodies read at the next newline). REFUSED at parse: `$((…))`,
 * `$'…'`, `$"…"`, `>(…)`, `|&`, `;;`, unquoted `{ }`, `~user`, other
 * `${…}` forms, and every other compound (if, while, until, case, function,
 * select, `{ …; }`, `[[ ]]`, `for ((…))`, `for` without `in`).
 *
 * PROVE (classifyReadOnly) — read-only ONLY if ALL hold:
 *   - no backgrounding (`&`), no `!` negation, no env assignment (`X=1 cmd`
 *     or a bare `X=1`: env changes what a command does — GIT_*, PAGER, LD_*);
 *   - redirections: only `>/dev/null`, `>>/dev/null`, `&>/dev/null`,
 *     `&>>/dev/null` (fd 1 or 2), the dups `2>&1` / `1>&2` / `>&2`, `< FILE`
 *     and `<<<WORD` (the file / word checked like an argument), and heredocs
 *     (an unquoted delimiter's body may hold no `$` or backtick);
 *   - every substitution (`$(…)`, backticks, `<(…)`) is itself read-only;
 *   - `$NAME` only names an enclosing `for` loop's variable (never $HOME, $1,
 *     $@, …), so a dynamic value always comes from a checked word list;
 *   - the command name is a literal word in the allowlist below, each with
 *     its flag rules; `cd` is allowed ONLY as the first command of the
 *     top-level list, alone in its pipeline, with one literal path inside a
 *     session root (cwd / worktree);
 *   - PATHS: every literal operand of a reader (and every value after `=` or
 *     a path-looking attached flag value) is resolved (tilde, cwd, realpath
 *     when it exists) and refused when it is a device path (/dev/…, /proc/…,
 *     `\\…` on win32) or lies inside — or is an ANCESTOR of (a recursive read
 *     would reach it) — a protected root: the Gnomon home, ~/.ssh, ~/.aws,
 *     ~/.config/gh, ~/.config/gcloud, ~/.azure, ~/.kube, ~/.docker,
 *     ~/.gnupg, ~/.netrc, ~/.npmrc, ~/.git-credentials, ~/.pypirc,
 *     ~/Library/Keychains, /Library/Keychains. A glob is checked at its
 *     literal directory prefix. Relative paths with `..` are refused until a
 *     `cd` to an absolute path makes the cwd known (Claude's Bash keeps its
 *     cwd between calls; the kernel knows only that it is inside a root);
 *   - DYNAMIC words (holding a loop variable or a substitution) are allowed
 *     only for commands with no writing or executing flag (FLAG_SAFE), and
 *     only when their literal text has no `..` segment and does not start
 *     with `/` or `~`. RESIDUAL (documented, accepted): a dynamic value comes
 *     from a read-only command's output, so a planted file NAME inside the
 *     repo can steer which file a reader reads.
 *
 * ALLOWLIST:
 *   FLAG_SAFE readers (no flag of theirs writes or executes, GNU or BSD; any
 *   flag): cat head tail wc ls grep egrep fgrep stat du df cut diff cmp
 *   realpath; and with no path check: echo printf basename dirname tr which
 *   test [ true false pwd.
 *   Restricted (literal arguments only): sort (no -o/--output/-T/
 *   --compress-program, allowlisted flags), uniq (at most one operand: a
 *   second is an OUTPUT file), file (no -C/--compile), date (display only:
 *   `+FORMAT` and -u -R -j -I… -r/-d/-v VALUE), rg (no --pre*, -z /
 *   --search-zip, --hostname-bin), jq (no -f/--from-file, -L; the filter has
 *   no env/$ENV/import/include; --rawfile/--slurpfile paths checked), find
 *   (allowlisted predicates only: never -exec -execdir -ok -okdir -delete
 *   -fprint* -fls), awk (only -F / -v; one literal program with none of
 *   system getline close fflush ENVIRON PROCINFO | > @), sed (only -n -E -r
 *   and scripts `Np`, `N,Mp`, `$p`, `/re/p`), git (no global option at all —
 *   no -c, -C, --exec-path, --git-dir; subcommands status log diff show
 *   blame rev-parse ls-files describe, never with --output*, --ext-diff,
 *   --textconv, -O/--open-files-in-pager; `branch` with only listing flags
 *   and operands only after --list; `remote` bare or `-v`; `config` only
 *   --get/--get-all with one key). RESIDUAL (documented): git runs programs
 *   the repo's OWN git config names (core.fsmonitor, diff.external, textconv
 *   drivers); `.git/**` is gate-class, so a session cannot set them unseen.
 *
 * simpleArgv: for prefix `always` rules (#always-rules) — the argv of a
 * command that is ONE simple command with only literal words (no ; && || |
 * & newline, substitution, expansion, glob, redirection or assignment), else
 * null.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/* ── AST ──────────────────────────────────────────────────────────────────── */

export type Part =
  | { t: 'lit'; v: string; quoted: boolean }
  | { t: 'glob'; v: string }
  | { t: 'tilde' }
  | { t: 'var'; name: string }
  | { t: 'sub'; list: List; kind: '$(' | '`' | '<(' };
export interface Word { parts: Part[] }
export interface Redir { fd: number | null; op: string; target: Word | null; heredoc?: { delim: string; quoted: boolean; strip: boolean; body: string | null } }
export type Cmd =
  | { t: 'simple'; assigns: Word[]; words: Word[]; redirs: Redir[] }
  | { t: 'subshell'; body: List; redirs: Redir[] }
  | { t: 'for'; name: string; items: Word[]; body: List; redirs: Redir[] };
export interface Pipeline { cmds: Cmd[]; bang: boolean }
export interface List { items: Array<{ pipe: Pipeline; sep: string | null }> }

export class ShellParseError extends Error {}
const parseFail = (why: string): never => {
  throw new ShellParseError(why);
};

type Tok = { t: 'word'; w: Word; plain: string | null } | { t: 'op'; v: string } | { t: 'io'; n: number } | { t: 'eof' };

const META = ' \t\n;&|<>()';
const MAX_DEPTH = 32;
const MAX_LEN = 64 * 1024;

class Lexer {
  pos = 0;
  readonly heredocs: Redir[] = [];
  #peeked: Tok | null = null;
  constructor(readonly s: string, readonly depth: number) {}

  peek(): Tok {
    if (!this.#peeked) this.#peeked = this.#next();
    return this.#peeked;
  }
  take(): Tok {
    const t = this.peek();
    this.#peeked = null;
    return t;
  }

  #next(): Tok {
    const s = this.s;
    for (;;) {
      const c = s[this.pos];
      if (c === ' ' || c === '\t') this.pos++;
      else if (c === '\\' && s[this.pos + 1] === '\n') this.pos += 2;
      else if (c === '#') while (this.pos < s.length && s[this.pos] !== '\n') this.pos++;
      else break;
    }
    if (this.pos >= s.length) return { t: 'eof' };
    const c = s[this.pos]!;
    const at = (str: string) => s.startsWith(str, this.pos);
    if (c === '\n') {
      this.pos++;
      this.#readHeredocs();
      return { t: 'op', v: '\n' };
    }
    for (const op of ['&>>', '&>', '&&', '||', ';;', '|&', '<<<', '<<-', '<<', '<>', '<&', '>>', '>&', '>|']) {
      if (at(op)) {
        if (op === ';;' || op === '|&') parseFail(`operator ${op}`);
        this.pos += op.length;
        return { t: 'op', v: op };
      }
    }
    if (c === '<' && s[this.pos + 1] === '(') {
      this.pos += 2;
      const list = this.#nested();
      return { t: 'word', w: { parts: [{ t: 'sub', list, kind: '<(' }] }, plain: null };
    }
    if (c === '>' && s[this.pos + 1] === '(') parseFail('process substitution >(…)');
    if (';&|<>()'.includes(c)) {
      this.pos++;
      return { t: 'op', v: c };
    }
    const w = this.#word();
    const plain = w.parts.every((p) => p.t === 'lit' && !p.quoted) ? w.parts.map((p) => (p as { v: string }).v).join('') : null;
    if (plain !== null && /^\d+$/.test(plain) && (s[this.pos] === '<' || s[this.pos] === '>') && s[this.pos + 1] !== '(') return { t: 'io', n: Number(plain) };
    return { t: 'word', w, plain };
  }

  /** `$(` … `)` / `<(` … `)`: a nested list on this lexer, up to its `)`. */
  #nested(): List {
    if (this.depth >= MAX_DEPTH) parseFail('nesting too deep');
    const p = new Parser(this, this.depth + 1);
    const list = p.list(new Set([')']));
    const t = this.take();
    if (!(t.t === 'op' && t.v === ')')) parseFail('unterminated substitution');
    return list;
  }

  #word(): Word {
    const s = this.s;
    const parts: Part[] = [];
    const lit = (v: string, quoted: boolean) => {
      const last = parts.at(-1);
      if (last && last.t === 'lit' && last.quoted === quoted) last.v += v;
      else parts.push({ t: 'lit', v, quoted });
    };
    while (this.pos < s.length) {
      const c = s[this.pos]!;
      if (META.includes(c)) break;
      if (c === '\\') {
        const n = s[this.pos + 1];
        if (n === undefined) parseFail('trailing backslash');
        this.pos += 2;
        if (n !== '\n') lit(n!, true);
      } else if (c === "'") {
        const end = s.indexOf("'", this.pos + 1);
        if (end < 0) parseFail("unterminated '");
        lit(s.slice(this.pos + 1, end), true);
        this.pos = end + 1;
      } else if (c === '"') {
        this.pos++;
        this.#double(parts, lit);
      } else if (c === '`') {
        parts.push(this.#backtick());
      } else if (c === '$') {
        this.#dollar(parts, lit, false);
      } else if (c === '*' || c === '?' || c === '[') {
        parts.push({ t: 'glob', v: c });
        this.pos++;
      } else if (c === '{' || c === '}') {
        parseFail('unquoted brace');
      } else if (c === '~' && parts.length === 0) {
        const n = s[this.pos + 1];
        if (n !== undefined && n !== '/' && !META.includes(n)) parseFail('~user');
        parts.push({ t: 'tilde' });
        this.pos++;
      } else {
        lit(c, false);
        this.pos++;
      }
    }
    if (parts.length === 0) parseFail('empty word');
    return { parts };
  }

  #double(parts: Part[], lit: (v: string, q: boolean) => void): void {
    const s = this.s;
    for (;;) {
      if (this.pos >= s.length) parseFail('unterminated "');
      const c = s[this.pos]!;
      if (c === '"') {
        this.pos++;
        if (parts.length === 0) lit('', true);
        return;
      }
      if (c === '\\') {
        const n = s[this.pos + 1];
        if (n === undefined) parseFail('unterminated "');
        this.pos += 2;
        if (n === '\n') continue;
        lit('$`"\\'.includes(n!) ? n! : `\\${n}`, true);
      } else if (c === '`') parts.push(this.#backtick());
      else if (c === '$') this.#dollar(parts, lit, true);
      else {
        lit(c, true);
        this.pos++;
      }
    }
  }

  #dollar(parts: Part[], lit: (v: string, q: boolean) => void, quoted: boolean): void {
    const s = this.s;
    const n = s[this.pos + 1];
    if (n === '(') {
      if (s[this.pos + 2] === '(') parseFail('arithmetic $((…))');
      this.pos += 2;
      parts.push({ t: 'sub', list: this.#nested(), kind: '$(' });
      return;
    }
    if (n === '{') {
      const m = /^\$\{(#?)([A-Za-z_][A-Za-z0-9_]*)\}/.exec(s.slice(this.pos));
      if (!m) parseFail('parameter expansion form');
      parts.push({ t: 'var', name: m![2]! });
      this.pos += m![0].length;
      return;
    }
    if (!quoted && (n === "'" || n === '"')) parseFail(`$${n}…${n} quoting`);
    const m = /^\$([A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])/.exec(s.slice(this.pos));
    if (m) {
      parts.push({ t: 'var', name: m[1]! });
      this.pos += m[0].length;
      return;
    }
    // a bare `$` only before whitespace, the end or a closing quote; zsh reads `$=x`, `$~x`, `$^x`, `$+x` as expansions
    if (n !== undefined && !' \t\n'.includes(n) && !(quoted && n === '"')) parseFail(`$${n} expansion`);
    lit('$', quoted);
    this.pos++;
  }

  #backtick(): Part {
    const s = this.s;
    let i = this.pos + 1;
    let inner = '';
    for (;;) {
      if (i >= s.length) parseFail('unterminated `');
      const c = s[i]!;
      if (c === '`') break;
      if (c === '\\' && (s[i + 1] === '`' || s[i + 1] === '\\' || s[i + 1] === '$')) {
        inner += s[i + 1];
        i += 2;
      } else {
        inner += c;
        i++;
      }
    }
    this.pos = i + 1;
    if (this.depth >= MAX_DEPTH) parseFail('nesting too deep');
    return { t: 'sub', list: parseWith(inner, this.depth + 1), kind: '`' };
  }

  #readHeredocs(): void {
    while (this.heredocs.length) {
      const r = this.heredocs.shift()!;
      const h = r.heredoc!;
      const lines: string[] = [];
      for (;;) {
        if (this.pos >= this.s.length) parseFail('unterminated heredoc');
        const nl = this.s.indexOf('\n', this.pos);
        const raw = nl < 0 ? this.s.slice(this.pos) : this.s.slice(this.pos, nl);
        this.pos = nl < 0 ? this.s.length : nl + 1;
        const line = h.strip ? raw.replace(/^\t+/, '') : raw;
        if (line === h.delim) break;
        lines.push(line);
      }
      h.body = lines.join('\n');
    }
  }
}

const RESERVED = new Set(['if', 'then', 'else', 'elif', 'fi', 'while', 'until', 'case', 'esac', 'function', 'select', '{', '}', '[[', ']]', 'do', 'done', 'in', 'time', 'coproc']);
/** zsh/bash parameters with a lowercase name that change the shell's behaviour when assigned (zsh/parameter included). */
export const LOOP_VAR_DENY: ReadonlySet<string> = new Set(['path', 'cdpath', 'fpath', 'manpath', 'module_path', 'mailpath', 'fignore', 'psvar', 'watch', 'prompt', 'histchars', 'argv', 'status', 'pipestatus', 'signals', 'commands', 'functions', 'aliases', 'options', 'parameters', 'dirstack', 'history', 'historywords', 'jobstates', 'jobtexts', 'jobdirs', 'modules', 'nameddirs', 'userdirs', 'reswords', 'builtins', 'termcap', 'terminfo', 'widgets', 'funcstack', 'funcfiletrace', 'funcsourcetrace', 'functrace', 'saliases', 'galiases', 'dis_aliases', 'dis_functions', 'dis_builtins', 'dis_reswords', 'dis_galiases', 'dis_saliases', 'dis_patchars', 'patchars', 'zsh_eval_context', 'zsh_scheduled_events', 'match', 'mbegin', 'mend', 'reply', 'keymaps', 'sysparams', 'errnos']);
const SEPS = new Set([';', '&', '&&', '||', '\n']);
const REDIR_OPS = new Set(['>', '>>', '>|', '<', '<>', '<&', '>&', '&>', '&>>', '<<', '<<-', '<<<']);

class Parser {
  constructor(readonly lx: Lexer, readonly depth: number) {}

  list(terms: Set<string>): List {
    const items: List['items'] = [];
    let lastSep: string | null = ';';
    for (;;) {
      this.#skipNewlines();
      const t = this.lx.peek();
      const atTerm = (t.t === 'eof' && terms.has('eof')) || (t.t === 'op' && terms.has(t.v)) || (t.t === 'word' && t.plain !== null && terms.has(t.plain));
      if (atTerm) {
        if (lastSep === '&&' || lastSep === '||') parseFail(`nothing after ${lastSep}`);
        return { items };
      }
      if (t.t === 'eof') parseFail('unexpected end');
      if (lastSep === null) parseFail('missing separator');
      const pipe = this.#pipeline();
      const n = this.lx.peek();
      const sep = n.t === 'op' && SEPS.has(n.v) ? n.v : null;
      if (sep) this.lx.take();
      items.push({ pipe, sep });
      lastSep = sep;
    }
  }

  #skipNewlines(): void {
    for (let t = this.lx.peek(); t.t === 'op' && t.v === '\n'; t = this.lx.peek()) this.lx.take();
  }

  #pipeline(): Pipeline {
    let bang = false;
    const t = this.lx.peek();
    if (t.t === 'word' && t.plain === '!') {
      this.lx.take();
      bang = true;
    }
    const cmds = [this.#command()];
    for (let n = this.lx.peek(); n.t === 'op' && n.v === '|'; n = this.lx.peek()) {
      this.lx.take();
      this.#skipNewlines();
      cmds.push(this.#command());
    }
    return { cmds, bang };
  }

  #command(): Cmd {
    const t = this.lx.peek();
    if (t.t === 'op' && t.v === '(') {
      this.lx.take();
      if (this.depth >= MAX_DEPTH) parseFail('nesting too deep');
      const body = new Parser(this.lx, this.depth + 1).list(new Set([')']));
      this.#expectOp(')');
      return { t: 'subshell', body, redirs: this.#redirs([]) };
    }
    if (t.t === 'word' && t.plain === 'for') return this.#for();
    if (t.t === 'word' && t.plain !== null && RESERVED.has(t.plain)) parseFail(`unsupported compound ${t.plain}`);
    return this.#simple();
  }

  #expectOp(v: string): void {
    const t = this.lx.take();
    if (!(t.t === 'op' && t.v === v)) parseFail(`expected ${v}`);
  }
  #expectWord(v: string): void {
    const t = this.lx.take();
    if (!(t.t === 'word' && t.plain === v)) parseFail(`expected ${v}`);
  }

  #for(): Cmd {
    this.lx.take();
    const n = this.lx.take();
    // a lowercase name that is no special parameter of bash or zsh (zsh ties `path` to PATH: `for path in x` would steer lookup)
    if (n.t !== 'word' || n.plain === null || !/^[a-z][a-z0-9_]{0,15}$/.test(n.plain) || LOOP_VAR_DENY.has(n.plain)) parseFail('for: a plain lowercase variable name');
    this.#skipNewlines();
    this.#expectWord('in'); // `for x; do` iterates "$@": refused
    const items: Word[] = [];
    for (let t = this.lx.peek(); t.t === 'word'; t = this.lx.peek()) items.push((this.lx.take() as { w: Word }).w);
    const sep = this.lx.take();
    if (!(sep.t === 'op' && (sep.v === ';' || sep.v === '\n'))) parseFail('for: ; or newline after the word list');
    this.#skipNewlines();
    this.#expectWord('do');
    if (this.depth >= MAX_DEPTH) parseFail('nesting too deep');
    const body = new Parser(this.lx, this.depth + 1).list(new Set(['done']));
    if (body.items.length === 0) parseFail('for: empty body');
    this.#expectWord('done');
    return { t: 'for', name: (n as { plain: string }).plain, items, body, redirs: this.#redirs([]) };
  }

  #simple(): Cmd {
    const assigns: Word[] = [];
    const words: Word[] = [];
    const redirs: Redir[] = [];
    for (;;) {
      const t = this.lx.peek();
      if (t.t === 'word') {
        this.lx.take();
        const first = t.w.parts[0];
        if (words.length === 0 && first?.t === 'lit' && !first.quoted && /^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(first.v)) assigns.push(t.w);
        else words.push(t.w);
      } else if (t.t === 'io' || (t.t === 'op' && REDIR_OPS.has(t.v))) {
        this.#redir(redirs);
      } else break;
    }
    if (!assigns.length && !words.length && !redirs.length) {
      const t = this.lx.peek();
      parseFail(`unexpected ${t.t === 'op' ? JSON.stringify(t.v) : t.t}`);
    }
    return { t: 'simple', assigns, words, redirs };
  }

  #redirs(acc: Redir[]): Redir[] {
    for (let t = this.lx.peek(); t.t === 'io' || (t.t === 'op' && REDIR_OPS.has(t.v)); t = this.lx.peek()) this.#redir(acc);
    return acc;
  }

  #redir(acc: Redir[]): void {
    let fd: number | null = null;
    let t = this.lx.take();
    if (t.t === 'io') {
      fd = t.n;
      t = this.lx.take();
    }
    if (t.t !== 'op' || !REDIR_OPS.has(t.v)) parseFail('redirection');
    const op = (t as { v: string }).v;
    const target = this.lx.take();
    if (target.t !== 'word') parseFail('redirection target');
    const w = (target as { w: Word }).w;
    if (op === '<<' || op === '<<-') {
      if (!w.parts.every((p) => p.t === 'lit')) parseFail('heredoc delimiter');
      const delim = w.parts.map((p) => (p as { v: string }).v).join('');
      const r: Redir = { fd, op, target: null, heredoc: { delim, quoted: w.parts.some((p) => p.t === 'lit' && p.quoted), strip: op === '<<-', body: null } };
      this.lx.heredocs.push(r);
      acc.push(r);
      return;
    }
    acc.push({ fd, op, target: w });
  }
}

function parseWith(src: string, depth: number): List {
  const lx = new Lexer(src, depth);
  const list = new Parser(lx, depth).list(new Set(['eof']));
  if (lx.heredocs.length) parseFail('unterminated heredoc');
  return list;
}

/** Parse a command (the supported subset). Throws ShellParseError for anything outside it. */
export function parseShell(src: string): List {
  if (src.length > MAX_LEN) parseFail('too long');
  if (src.includes('\0')) parseFail('NUL');
  return parseWith(src, 0);
}

/* ── classify ─────────────────────────────────────────────────────────────── */

export interface ReadOnlyContext {
  /** the session roots (cwd, worktree): `cd` must stay inside one; relative paths resolve against the first */
  roots: readonly string[];
  home: string;
  /** the Gnomon home (never read by an auto-passed command) */
  gnomonHome: string;
  platform?: string;
}
export type ReadOnlyVerdict = { ok: true } | { ok: false; why: string };

class Refuse extends Error {}
const no = (why: string): never => {
  throw new Refuse(why);
};

/** Protected roots relative to the home (credentials, keys, the Gnomon home is added by the caller). */
export const PROTECTED_HOME_PATHS = Object.freeze(['.ssh', '.aws', '.config/gh', '.config/gcloud', '.azure', '.kube', '.docker', '.gnupg', '.netrc', '.npmrc', '.git-credentials', '.pypirc', 'Library/Keychains', '.gnomon']);
export const PROTECTED_ABS_PATHS = Object.freeze(['/Library/Keychains']);

interface Arg { lit: string | null; glob: boolean; tilde: boolean; word: Word }
interface Env { ctx: ReadOnlyContext; cwd: string | null; vars: ReadonlySet<string>; prot: string[]; fold: (s: string) => string; pp: typeof path }

const realOr = (p: string): string | null => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
};

export function classifyReadOnly(command: string, ctx: ReadOnlyContext): ReadOnlyVerdict {
  let list: List;
  try {
    list = parseShell(command);
  } catch (e) {
    return { ok: false, why: e instanceof ShellParseError ? `unparsed: ${e.message}` : 'unparsed' };
  }
  if (list.items.length === 0) return { ok: false, why: 'empty' };
  const platform = ctx.platform ?? process.platform;
  const pp = platform === 'win32' ? path.win32 : path.posix;
  const fold = platform === 'darwin' || platform === 'win32' ? (s: string) => s.toLowerCase() : (s: string) => s;
  const prot = [...PROTECTED_HOME_PATHS.map((p) => pp.join(ctx.home, ...p.split('/'))), ...(platform === 'win32' ? [] : PROTECTED_ABS_PATHS), pp.resolve(ctx.gnomonHome)];
  for (const p of [...prot]) {
    const r = realOr(p);
    if (r && !prot.includes(r)) prot.push(r);
  }
  if (ctx.roots.length === 0) return { ok: false, why: 'no-root' };
  const env: Env = { ctx, cwd: null, vars: new Set(), prot, fold, pp };
  try {
    walkList(list, env, true);
    return { ok: true };
  } catch (e) {
    if (e instanceof Refuse) return { ok: false, why: e.message };
    return { ok: false, why: 'error' };
  }
}

function walkList(list: List, env: Env, top: boolean): void {
  for (const [i, it] of list.items.entries()) {
    if (it.sep === '&') no('background');
    if (it.pipe.bang) no('negation');
    if (top && i === 0 && it.pipe.cmds.length === 1 && isCd(it.pipe.cmds[0]!)) {
      cdTo(it.pipe.cmds[0] as Extract<Cmd, { t: 'simple' }>, env);
      continue;
    }
    for (const c of it.pipe.cmds) walkCmd(c, env);
  }
}

const isCd = (c: Cmd): boolean => c.t === 'simple' && c.words.length > 0 && wordLit(c.words[0]!) === 'cd';

function cdTo(c: Extract<Cmd, { t: 'simple' }>, env: Env): void {
  if (c.assigns.length || c.redirs.length || c.words.length !== 2) no('cd: one literal path');
  const a = argOf(c.words[1]!, env);
  if (a.lit === null || a.glob || a.lit === '-' || a.lit.startsWith('-') || a.lit === '') no('cd: one literal path');
  const { pp, ctx, fold } = env;
  const raw = a.tilde ? pp.join(ctx.home, a.lit!) : a.lit!;
  if (!pp.isAbsolute(raw) && raw.split(/[\\/]+/).includes('..')) no('cd: a relative path with ..');
  const bases = pp.isAbsolute(raw) ? [raw] : ctx.roots.map((r) => pp.resolve(r, raw));
  for (const b of bases) {
    const target = pp.resolve(b);
    const forms = [target, realOr(target)].filter((x): x is string => x !== null);
    const inside = forms.every((f) => ctx.roots.some((r) => [pp.resolve(r), realOr(r)].some((rr) => rr !== null && within(fold(f), fold(rr), pp, true))));
    if (!inside) no('cd: outside the session roots');
  }
  if (pp.isAbsolute(raw)) env.cwd = pp.resolve(raw);
}

function within(p: string, root: string, pp: typeof path, orEqual: boolean): boolean {
  if (p === root) return orEqual;
  const r = root.endsWith(pp.sep) ? root : root + pp.sep;
  return p.startsWith(r);
}

function walkCmd(c: Cmd, env: Env): void {
  checkRedirs(c.redirs, env);
  if (c.t === 'subshell') return walkList(c.body, env, false);
  if (c.t === 'for') {
    for (const w of c.items) {
      const a = argOf(w, env);
      if (a.lit !== null) checkPath(a, env);
      else checkDynamic(a);
    }
    return walkList(c.body, { ...env, vars: new Set([...env.vars, c.name]) }, false);
  }
  if (c.assigns.length) no('env assignment');
  if (c.words.length === 0) no('no command');
  const w0 = c.words[0]!;
  const p0 = w0.parts[0]!;
  const name = w0.parts.length === 1 && p0.t === 'glob' && p0.v === '[' ? '[' : wordLit(w0);
  if (name === null || name === '') no('command name not literal');
  if (name === 'cd') no('cd: only as the first command');
  const args = c.words.slice(1).map((w) => argOf(w, env));
  const rule = COMMANDS[name!];
  if (!rule) no(`not allowlisted: ${name}`);
  rule!(args, env, name!);
}

function checkRedirs(rs: readonly Redir[], env: Env): void {
  for (const r of rs) {
    if (r.heredoc) {
      if (r.heredoc.body === null) no('heredoc');
      if (!r.heredoc.quoted && /[$`]/.test(r.heredoc.body!)) no('heredoc expansion');
      continue;
    }
    const a = argOf(r.target!, env);
    if (r.op === '<<<') {
      if (a.lit === null) checkDynamic(a);
      continue;
    }
    if (r.op === '<') {
      if (r.fd !== null && r.fd !== 0) no('input redirection fd');
      if (a.lit === null) no('dynamic input redirection');
      checkPath(a, env);
      continue;
    }
    if ((r.op === '>&' && (r.fd === null || r.fd === 1 || r.fd === 2)) && (a.lit === '1' || a.lit === '2') && !a.tilde) continue;
    if (['>', '>>', '&>', '&>>'].includes(r.op) && (r.fd === null || r.fd === 1 || r.fd === 2) && a.lit === '/dev/null' && !a.tilde && !a.glob) continue;
    no(`redirection ${r.fd ?? ''}${r.op}`);
  }
}

function wordLit(w: Word): string | null {
  let s = '';
  for (const p of w.parts) {
    if (p.t === 'lit') s += p.v;
    else return null;
  }
  return s;
}

/** A word as an argument: its literal text when static (globs kept as text), else null — every substitution proven read-only. */
function argOf(w: Word, env: Env): Arg {
  let s = '';
  let dynamic = false;
  let glob = false;
  let tilde = false;
  for (const p of w.parts) {
    if (p.t === 'lit') s += p.v;
    else if (p.t === 'glob') {
      s += p.v;
      glob = true;
    } else if (p.t === 'tilde') tilde = true;
    else if (p.t === 'var') {
      if (!env.vars.has(p.name)) no(`parameter $${p.name}`);
      dynamic = true;
    } else {
      walkList(p.list, { ...env }, false);
      dynamic = true;
    }
  }
  return { lit: dynamic ? null : s, glob, tilde, word: w };
}

/** A dynamic word: no `..` segment in its literal text, and it does not start at `/` or `~`. */
function checkDynamic(a: Arg): void {
  const lits = a.word.parts.map((p) => (p.t === 'lit' ? p.v : p.t === 'glob' ? p.v : p.t === 'tilde' ? '~' : '\u0000')).join('');
  if (a.tilde || lits.startsWith('/') || lits.startsWith('\\') || lits.split(/[\\/\u0000]+/).includes('..')) no('dynamic path');
}

function checkPath(a: Arg, env: Env): void {
  const { pp, ctx, fold } = env;
  let t = a.lit!;
  if (a.tilde) t = pp.join(ctx.home, t);
  if (t === '') return;
  if (/^[\\/]{2}/.test(t) && env.pp === path.win32) no('device path');
  if (!pp.isAbsolute(t) && env.cwd === null && t.split(/[\\/]+/).includes('..')) no('relative .. with an unknown cwd');
  const bases = pp.isAbsolute(t) ? [t] : env.cwd !== null ? [pp.resolve(env.cwd, t)] : ctx.roots.map((r) => pp.resolve(r, t));
  for (let abs of bases) {
    abs = pp.resolve(abs);
    if (a.glob) {
      const gi = abs.search(/[*?[]/);
      const cut = abs.slice(0, gi);
      abs = cut.endsWith(pp.sep) ? cut.slice(0, -1) || pp.sep : pp.dirname(cut);
    }
    const forms = [abs, realOr(abs)].filter((x): x is string => x !== null);
    for (const f of forms) {
      const ff = fold(f);
      if (pp === path.posix && (ff === '/dev' || ff.startsWith('/dev/') || ff === '/proc' || ff.startsWith('/proc/'))) no('device path');
      for (const p of env.prot) {
        const fp = fold(p);
        if (within(ff, fp, pp, true) || within(fp, ff, pp, false)) no('protected path');
      }
    }
  }
}

/* ── the allowlist ────────────────────────────────────────────────────────── */

type Rule = (args: Arg[], env: Env, name: string) => void;

const isFlag = (a: Arg): boolean => a.lit !== null && a.lit.startsWith('-') && a.lit !== '-';

/** Check a reader's static arguments as paths (flag values after `=` too); dynamic ones by checkDynamic. */
function pathArgs(args: readonly Arg[], env: Env): void {
  for (const a of args) {
    if (a.lit === null) {
      checkDynamic(a);
      continue;
    }
    if (isFlag(a)) {
      const eq = a.lit.indexOf('=');
      if (eq > 0) checkPath({ ...a, lit: a.lit.slice(eq + 1), tilde: false }, env);
      else {
        const slash = a.lit.search(/[\\/]/);
        if (slash > 0) checkPath({ ...a, lit: a.lit.slice(slash), tilde: false }, env);
      }
      continue;
    }
    checkPath(a, env);
  }
}

const flagSafeReader: Rule = (args, env) => pathArgs(args, env);
const noPath: Rule = (args) => {
  for (const a of args) if (a.lit === null) checkDynamic(a);
};
const staticOnly = (args: readonly Arg[], name: string): void => {
  if (args.some((a) => a.lit === null)) no(`${name}: dynamic argument`);
};

/** A literal flag check: `short` letters (cluster ok), `withValue` letters/longs consuming the next arg, `long` names. */
function flags(args: readonly Arg[], name: string, o: { short: string; shortValue?: string; long?: readonly string[]; longValue?: readonly string[] }): Arg[] {
  const operands: Arg[] = [];
  let endOpts = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const s = a.lit!;
    if (endOpts || !isFlag(a)) {
      operands.push(a);
      continue;
    }
    if (s === '--') {
      endOpts = true;
      continue;
    }
    if (s.startsWith('--')) {
      const [k, v] = s.includes('=') ? [s.slice(0, s.indexOf('=')), true] : [s, false];
      if (o.long?.includes(k!) && !v) continue;
      if (o.longValue?.includes(k!)) {
        if (!v) i++;
        continue;
      }
      no(`${name}: flag ${k}`);
    }
    for (let j = 1; j < s.length; j++) {
      const ch = s[j]!;
      if (o.shortValue?.includes(ch)) {
        if (j === s.length - 1) i++;
        break;
      }
      if (!o.short.includes(ch)) no(`${name}: flag -${ch}`);
    }
  }
  return operands;
}

const sortRule: Rule = (args, env, name) => {
  staticOnly(args, name);
  flags(args, name, { short: 'bdfghiMnrRsuVzc', shortValue: 'kt', long: ['--reverse', '--numeric-sort', '--unique', '--human-numeric-sort', '--version-sort', '--ignore-case', '--stable', '--general-numeric-sort', '--month-sort', '--dictionary-order', '--ignore-leading-blanks', '--check', '--zero-terminated'], longValue: ['--key', '--field-separator'] });
  pathArgs(args, env);
};
const uniqRule: Rule = (args, env, name) => {
  staticOnly(args, name);
  const ops = flags(args, name, { short: 'cdDuiz', shortValue: 'fsw', long: ['--count', '--repeated', '--unique', '--ignore-case'], longValue: ['--skip-fields', '--skip-chars', '--check-chars'] });
  if (ops.length > 1) no('uniq: a second operand is an output file');
  pathArgs(args, env);
};
const fileRule: Rule = (args, env, name) => {
  staticOnly(args, name);
  flags(args, name, { short: 'bihLNkzZ0p', shortValue: 'mfFe', long: ['--brief', '--mime', '--mime-type', '--mime-encoding', '--dereference', '--no-dereference', '--keep-going'] });
  pathArgs(args, env);
};
const dateRule: Rule = (args, _env, name) => {
  staticOnly(args, name);
  const ops = flags(args, name, { short: 'uRjI', shortValue: 'rdvf', long: ['--utc', '--universal', '--rfc-email', '--iso-8601', '--rfc-3339'], longValue: ['--date', '--reference'] });
  if (ops.some((a) => !a.lit!.startsWith('+'))) no('date: an operand sets the clock');
};
const rgRule: Rule = (args, env, name) => {
  staticOnly(args, name);
  for (const a of args) {
    const s = a.lit!;
    if (/^--(pre|pre-glob|search-zip|hostname-bin)(=|$)/.test(s)) no(`rg: ${s.split('=')[0]}`);
    if (/^-[^-]*z/.test(s)) no('rg: -z');
  }
  pathArgs(args, env);
};
const jqRule: Rule = (args, env, name) => {
  staticOnly(args, name);
  let filter: Arg | null = null;
  const rest: Arg[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const s = a.lit!;
    if (isFlag(a)) {
      if (['-f', '--from-file', '-L'].includes(s) || /^-L|^--from-file=/.test(s)) no(`jq: ${s}`);
      if (s === '--arg' || s === '--argjson') {
        i += 2;
        continue;
      }
      if (s === '--rawfile' || s === '--slurpfile') {
        const f = args[i + 2];
        if (f) rest.push(f);
        i += 2;
        continue;
      }
      if (s === '--indent') {
        i++;
        continue;
      }
      if (!/^(-[rcnsejSaCMR]+|--(raw-output|compact-output|null-input|slurp|exit-status|join-output|sort-keys|ascii-output|color-output|monochrome-output|raw-input|tab|seq|stream|raw-output0))$/.test(s)) no(`jq: flag ${s}`);
      continue;
    }
    if (filter === null) filter = a;
    else rest.push(a);
  }
  if (filter && /env|ENV|import|include|input_filename|\$__loc__/.test(filter.lit!)) no('jq: env or module access in the filter');
  pathArgs(rest, env);
};
const FIND_PRED = new Set(['-name', '-iname', '-path', '-ipath', '-wholename', '-iwholename', '-regex', '-iregex', '-type', '-xtype', '-maxdepth', '-mindepth', '-newer', '-mtime', '-mmin', '-atime', '-amin', '-ctime', '-cmin', '-size', '-perm', '-user', '-group', '-links', '-uid', '-gid', '-inum', '-samefile', '-lname', '-ilname']);
const FIND_FLAG = new Set(['-print', '-print0', '-prune', '-o', '-or', '-a', '-and', '-not', '!', '(', ')', ',', '-empty', '-depth', '-d', '-follow', '-xdev', '-mount', '-true', '-false', '-ls', '-readable', '-writable', '-executable', '-nouser', '-nogroup', '-quit', '-printf', '-L', '-H', '-P', '-E', '-X', '-s', '-x', '-noleaf', '-regextype']);
const findRule: Rule = (args, env, name) => {
  staticOnly(args, name);
  let i = 0;
  while (i < args.length && ['-L', '-H', '-P', '-E', '-X', '-s', '-x', '-d'].includes(args[i]!.lit!)) i++;
  const roots: Arg[] = [];
  while (i < args.length && !args[i]!.lit!.startsWith('-') && !['!', '(', ')'].includes(args[i]!.lit!)) roots.push(args[i++]!);
  for (; i < args.length; i++) {
    const s = args[i]!.lit!;
    if (FIND_PRED.has(s) || s === '-printf' || s === '-regextype') {
      i++;
      if (s === '-newer' || s === '-samefile') roots.push(args[i] ?? no('find: a value'));
      continue;
    }
    if (FIND_FLAG.has(s)) continue;
    no(`find: ${s}`);
  }
  if (roots.length === 0) roots.push({ lit: '.', glob: false, tilde: false, word: { parts: [] } });
  pathArgs(roots, env);
};
const AWK_BAD = /system|getline|close|fflush|ENVIRON|PROCINFO|[|>@]/;
const awkRule: Rule = (args, env, name) => {
  staticOnly(args, name);
  let i = 0;
  for (; i < args.length && isFlag(args[i]!); i++) {
    const s = args[i]!.lit!;
    if (s === '--') {
      i++;
      break;
    }
    if (s === '-F' || s === '-v') i++;
    else if (!/^-F./.test(s) && !/^-v./.test(s)) no(`awk: flag ${s}`);
  }
  const prog = args[i];
  if (!prog) no('awk: a program');
  if (AWK_BAD.test(prog!.lit!)) no('awk: the program may write or run');
  pathArgs(args.slice(i + 1), env);
};
const SED_SCRIPT = /^\s*(?:(?:\d+|\$)(?:\s*,\s*(?:\d+|\$))?|\/[^/\\\n]*\/)\s*p\s*$/;
const sedRule: Rule = (args, env, name) => {
  staticOnly(args, name);
  let script = false;
  const ops: Arg[] = [];
  for (let i = 0; i < args.length; i++) {
    const s = args[i]!.lit!;
    if (s === '-e') {
      const v = args[++i];
      if (!v || !SED_SCRIPT.test(v.lit!)) no('sed: script');
      script = true;
    } else if (/^-[nEr]+$/.test(s)) continue;
    else if (isFlag(args[i]!)) no(`sed: flag ${s}`);
    else if (!script) {
      if (!SED_SCRIPT.test(s)) no('sed: script');
      script = true;
    } else ops.push(args[i]!);
  }
  if (!script) no('sed: script');
  pathArgs(ops, env);
};
const GIT_READ = new Set(['status', 'log', 'diff', 'show', 'blame', 'rev-parse', 'ls-files', 'describe']);
const GIT_BAD = /^(--output|--ext-diff|--textconv|--open-files-in-pager|-O|--exec|--upload-pack|--receive-pack|--paginate)(=|$)/;
const gitRule: Rule = (args, env, name) => {
  staticOnly(args, name);
  const sub = args[0]?.lit;
  if (!sub || sub.startsWith('-')) no('git: a global option');
  const rest = args.slice(1);
  for (const a of rest) if (GIT_BAD.test(a.lit!)) no(`git: ${a.lit!.split('=')[0]}`);
  if (GIT_READ.has(sub!)) return pathArgs(rest, env);
  if (sub === 'branch') {
    const list = rest.some((a) => a.lit === '--list' || a.lit === '-l');
    for (const a of rest) {
      const s = a.lit!;
      if (isFlag(a)) {
        if (!/^(-[avrl]+|-vv|--list|--all|--remotes|--verbose|--show-current|--merged|--no-merged|--contains|--no-contains|--sort=.*|--format=.*|--color|--no-color|--column|--no-column)$/.test(s)) no(`git branch: ${s}`);
      } else if (!list) no('git branch: a name (only with --list)');
    }
    return;
  }
  if (sub === 'remote') {
    if (rest.length === 0 || (rest.length === 1 && rest[0]!.lit === '-v')) return;
    no('git remote: only bare or -v');
  }
  if (sub === 'config') {
    if (rest.length === 2 && ['--get', '--get-all'].includes(rest[0]!.lit!) && !rest[1]!.lit!.startsWith('-')) return;
    no('git config: only --get/--get-all KEY');
  }
  no(`git: subcommand ${sub}`);
};

export const COMMANDS: Readonly<Record<string, Rule>> = Object.freeze({
  cat: flagSafeReader, head: flagSafeReader, tail: flagSafeReader, wc: flagSafeReader, ls: flagSafeReader, grep: flagSafeReader, egrep: flagSafeReader, fgrep: flagSafeReader,
  stat: flagSafeReader, du: flagSafeReader, df: flagSafeReader, cut: flagSafeReader, diff: flagSafeReader, cmp: flagSafeReader, realpath: flagSafeReader,
  echo: noPath, printf: noPath, basename: noPath, dirname: noPath, tr: noPath, which: noPath, test: noPath, '[': noPath, true: noPath, false: noPath, pwd: noPath,
  sort: sortRule, uniq: uniqRule, file: fileRule, date: dateRule, rg: rgRule, jq: jqRule, find: findRule, awk: awkRule, sed: sedRule, git: gitRule,
});

/* ── prefix rules ─────────────────────────────────────────────────────────── */

/**
 * The argv of a command that is exactly ONE simple command of literal words — no ; && || | & newline, no
 * substitution, parameter, glob or tilde, no redirection and no assignment — else null (#always-rules prefix match).
 */
export function simpleArgv(command: string): string[] | null {
  let list: List;
  try {
    list = parseShell(command);
  } catch {
    return null;
  }
  if (list.items.length !== 1) return null;
  const it = list.items[0]!;
  if (it.sep !== null || it.pipe.bang || it.pipe.cmds.length !== 1) return null;
  const c = it.pipe.cmds[0]!;
  if (c.t !== 'simple' || c.assigns.length || c.redirs.length || c.words.length === 0) return null;
  const argv: string[] = [];
  for (const w of c.words) {
    const s = wordLit(w);
    if (s === null) return null;
    argv.push(s);
  }
  return argv;
}
