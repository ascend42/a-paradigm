/**
 * @symbol #shell-readonly
 *
 * #shell-readonly (spec §3.4 "Run modes (D87)", TD-2026-10-20-294 part 1):
 * Is this Bash command PROVABLY read-only? (No side effects; it READS the
 * filesystem — realpath and readdir — to check symlinks and expand globs.) Under `auto-edits` a command
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
 * PROVE (classifyReadOnly) — read-only ONLY if ALL hold (TD-2026-10-20-294
 * as re-checked by Aegis: C1 C2 H1–H4 M1–M3 and the Low item are closed here):
 *   - no backgrounding (`&`), no `!` negation, no env assignment (`X=1 cmd`
 *     or a bare `X=1`: env changes what a command does — GIT_*, PAGER, LD_*);
 *   - redirections: only `>/dev/null`, `>>/dev/null`, `&>/dev/null`,
 *     `&>>/dev/null` (fd 1 or 2), the dups `2>&1` / `1>&2` / `>&2`, `< FILE`
 *     (one literal path, checked) and `<<<WORD` (data), and heredocs (an
 *     unquoted delimiter's body may hold no `$` or backtick);
 *   - every substitution (`$(…)`, backticks, `<(…)`) is itself read-only;
 *   - C1 NO DYNAMIC PATHS: a word holding `$(…)` or a backtick may be an
 *     argument only of `echo`, of `printf` after its literal format, or a
 *     `<<<` word — its output is TEXT, never a path. A `for` loop iterates only
 *     LITERAL words and literal globs (expanded now); every value must be one
 *     safe token (`[A-Za-z0-9._+,:@%=/-]`, not starting with `-`), so `$f`
 *     neither splits nor globs again. `$NAME` names only an enclosing loop's
 *     variable and is substituted with each of its values (cartesian, at most
 *     200), so every path that reaches a reader is CONCRETE and checked.
 *     `<(…)` is a whole-word pipe argument of a reader (its content comes from
 *     a proven read-only command);
 *   - K1 ANCHORED CWD (TD-2026-10-20-086): with ctx.cwd (the realpath of a session root the caller anchors the run
 *     in, anchorCommand) the cwd is known from the start; a cd is any whole top-level item (absolute, or relative to
 *     an existing in-root directory; no `..`); the top-level list tracks the SET of possible cwds and walks each item
 *     once per member; git only while the cwd is a session root. Brace expansion, `case` and tainted locals: see
 *     the parser and walkList. Without ctx.cwd the old rule below holds;
 *   - M2 KNOWN CWD: the cwd is known only after a first command `cd ABS` (an
 *     absolute literal path or `~/…`, inside a session root, at its realpath;
 *     H3: a relative cd is refused) and only along an unbroken `&&` chain from
 *     it (after `;`, a newline or `||` the cd may have failed). With an
 *     unknown cwd every relative path, relative glob, implicit-cwd read (`ls`,
 *     `du`, `find` with no operand) and every `git` command raises the card;
 *     all-absolute paths still pass. Every operand of a path-taking command is
 *     treated as a path, patterns included (`grep x` needs a known cwd);
 *   - H4 READABLE ROOTS (an allowlist): every path, as given and at its
 *     realpath (or, when it does not exist, its deepest existing ancestor's
 *     realpath plus the rest), lies inside a session root or a system read
 *     root (`/usr`, `/opt/homebrew`, `/etc`, `/tmp`, `/private/tmp`,
 *     `/private/etc`; posix only). On top, the deny stays: no device path
 *     (/dev/…, /proc/…, `\\…` on win32), nothing inside — or an ANCESTOR of —
 *     a protected root (the Gnomon home, ~/.ssh, ~/.aws, ~/.config/gh,
 *     ~/.config/gcloud, ~/.azure, ~/.kube, ~/.docker, ~/.gnupg, ~/.netrc,
 *     ~/.npmrc, ~/.git-credentials, ~/.pypirc, ~/Library/Keychains,
 *     /Library/Keychains). Repo-local files (a repo's own `.env`) stay readable;
 *   - H2 GLOBS AND SYMLINKS: an unquoted glob is expanded NOW against the
 *     filesystem with a superset matcher (any case, dotfiles, `.`/`..` for a
 *     `.`-led segment, every bracket class as one char; `**` refused) and every
 *     match is checked at its realpath; more than 200 matches, or a match
 *     starting with `-` (a planted `-r`), is refused; no match passes the
 *     pattern literally. No reader flag that recurses or follows symlinks:
 *     grep -r -R -S -O -d -D --recursive --dereference-recursive
 *     --directories --devices (and every abbreviation), ls -L -R, du -L, stat
 *     -L, diff -r, find -L/-follow; `rg` is gone (it recurses by default) —
 *     RW below re-admits grep -r and rg in an anchored run only;
 *     `diff` takes no directory operand (`diff DIR DIR` / `diff FILE DIR` read
 *     files inside the directory that are never operands);
 *   - zsh EQUALS: a word starting with an unquoted `=` (`=cmd` is the full
 *     path of cmd from $PATH) is refused; bash's unary `test -a FILE` is a
 *     file test (its operand is path-checked);
 *   - the command name is a literal word in the allowlist below.
 *
 * ALLOWLIST:
 *   Readers (any flag but the denied ones; every operand path-checked; a
 *   short flag's attached FILE value — grep -fF, diff/du -XF, file -mF — too):
 *   cat head tail wc(no --files0-from) ls grep egrep fgrep stat du(no
 *   --files0-from) df cut diff cmp realpath.
 *   Text (no path; C2 tight flags): echo (-n -e -E only), printf (NO flag:
 *   `printf -v HOME …` assigns; the format is literal and never starts with
 *   `-`), basename (-a -z -s), dirname (-z), tr (-c -d -s -C -u), which (-a
 *   -s), pwd (-L -P, no operand), true, false; test / [ (only the POSIX
 *   operators; the operand of a file test is path-checked).
 *   Restricted (literal arguments only): sort (no -o/--output/-T/
 *   --compress-program, allowlisted flags), uniq (at most one operand: a
 *   second is an OUTPUT file), file (no -C, no -f), date (M1: display only —
 *   `+FORMAT`, -u -R -j -I, -v ADJUST; never -f -r -d -s), jq (no
 *   -f/--from-file, -L; the filter has no env/$ENV/import/include;
 *   --rawfile/--slurpfile paths checked), find (allowlisted predicates only:
 *   never -exec -execdir -ok -okdir -delete -fprint* -fls -L -follow), awk
 *   (H1: only -F, and ONE program of the shape `[PATTERN] { print ITEMS }`
 *   where ITEMS are $N $NF NF NR or plain strings — no ARGV, ARGC, FILENAME,
 *   ENVIRON, getline, system, redirection), sed (only -n -E -r and scripts
 *   `Np`, `N,Mp`, `$p`, `/re/p`), git (a known cwd; no global option at all —
 *   no -c, -C, --exec-path, --git-dir; subcommands status log diff show blame
 *   rev-parse ls-files describe show-ref ls-tree rev-list shortlog merge-base
 *   for-each-ref, `worktree list`, `stash list`, `reflog show`, `cat-file -t|-s|-p OBJ`, `tag -l/--list` (listing
 *   flags only), never with --output*, --ext-diff,
 *   --textconv, -O/--open-files-in-pager; `branch` with only listing flags
 *   and a pattern only after the long --list (Low: `-l NAME` created NAME in
 *   older git); `remote` bare only (M3: `-v` prints URLs that may hold
 *   credentials); `config` only --get/--get-all with one key that names no
 *   remote/credential/http/url/token/password/secret/auth/header/key).
 *   RESIDUAL (documented, accepted): git runs programs the repo's OWN git
 *   config names (core.fsmonitor, diff.external, textconv drivers); `.git/**`
 *   and (C2) `.gitconfig`, `.git-credentials`, `.netrc` and the other
 *   tool-steering files are gate-class, so a session cannot set them unseen.
 *
 * RW — THE READ-ONLY WIDENING (founder decision 2026-10-20: auto-edits never
 * prompts more than native Claude Code in the same mode). In an ANCHORED posix
 * run only (ctx.cwd set; win32 and unanchored callers keep the rules above):
 *   grep/egrep/fgrep -r / --recursive (no symlink below an operand is followed;
 *   -R -S -O -d -D stay refused; the walked cwd is checked); rg (no -L/--follow,
 *   -z/--search-zip, --pre, --pre-glob, --hostname-bin; RIPGREP_CONFIG_PATH is
 *   unset by the anchor); fd (no -x/--exec, -X/--exec-batch, -l/--list-details,
 *   -L/--follow); tree (no -o, -R, -l, --fromfile, --fromtabfile, --output);
 *   `git remote -v`; and the project CLIs' read verbs, each an exact grammar:
 *   `paradigm status|st`, `doctor [--context] [--explain]`, `ripple SYMBOL
 *   [PATH] …`, `purpose validate [PATH]`, `task ls [STATUS] …`, `task show REF`,
 *   `lore list|ls …`, `lore show ID` (the cwd at a session root; the CLI's
 *   declared read-only commands, proven to write nothing); `gnomon desk stats`,
 *   `daemon status`, `mod list`, `mod status [NAME]`, `rules list`, `trace
 *   status`, `replay [--json] [--expect H]` (default home only).
 *   RESIDUAL (RW): the paradigm and gnomon binaries are found on $PATH (as git
 *   is) and read their own config and, for gnomon, the Gnomon home (the verbs
 *   print counts, names, hashes and state); the paradigm verbs are read-only
 *   from @a-company/paradigm 7.15.2 (an older CLI on $PATH writes its one-time
 *   notice marker under .paradigm/ and moves legacy lore entries on lore reads);
 *   rg, fd and grep -r read every file below an in-root operand, the repo's
 *   `.git/**` and `.env` included.
 *   A glob is expanded at classification time: a file planted between the
 *   check and the run (by a concurrent process) is not seen. A planted file
 *   NAME inside a session root can still steer which in-root file a literal
 *   glob reaches. The user's own shell aliases, functions and options (zsh
 *   EXTENDED_GLOB / KSH_GLOB patterns such as `^x` or `a~b`, which this
 *   matcher does not model) are trusted. `du` and `find` walk a directory
 *   (names and sizes, never contents) without following symlinks.
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
  | { t: 'var'; name: string; quoted: boolean }
  | { t: 'brace'; vals: string[] }
  | { t: 'sub'; list: List; kind: '$(' | '`' | '<(' };
export interface Word { parts: Part[] }
export interface Redir { fd: number | null; op: string; target: Word | null; heredoc?: { delim: string; quoted: boolean; strip: boolean; body: string | null } }
export type Cmd =
  | { t: 'simple'; assigns: Word[]; words: Word[]; redirs: Redir[] }
  | { t: 'subshell'; body: List; redirs: Redir[] }
  | { t: 'for'; name: string; items: Word[]; body: List; redirs: Redir[] }
  | { t: 'case'; subject: Word; clauses: Array<{ pats: Word[]; body: List }>; redirs: Redir[] };
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
    for (const op of ['&>>', '&>', '&&', '||', ';;&', ';;', ';&', '|&', '<<<', '<<-', '<<', '<>', '<&', '>>', '>&', '>|']) {
      if (at(op)) {
        // `;;` is a token here; the parser accepts it only as a case clause's end. Fall-through `;&` / `;;&`: refused
        if (op === ';;&' || op === ';&' || op === '|&') parseFail(`operator ${op}`);
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
      } else if (c === '{') {
        if (parts.at(-1)?.t === 'var') parseFail('brace after a parameter'); // bash expands `$f{a,b}` to `$fa $fb`
        parts.push(this.#brace());
      } else if (c === '}') {
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

  /**
   * Brace expansion, the safe subset: `{a,b,c}` (two or more safe literal items, no nesting, no `$`, quote, glob or
   * space inside) or `{N..M}` (non-negative integers, no step, at most MAX_EXPANSIONS values). Anything else is refused.
   */
  #brace(): Part {
    const s = this.s;
    const end = s.indexOf('}', this.pos + 1);
    if (end < 0) parseFail('unquoted brace');
    const body = s.slice(this.pos + 1, end);
    if (body.includes('{')) parseFail('brace: nesting');
    let vals: string[];
    const r = /^(0|[1-9]\d{0,5})\.\.(0|[1-9]\d{0,5})$/.exec(body);
    if (r) {
      const a = Number(r[1]);
      const b = Number(r[2]);
      if (Math.abs(a - b) + 1 > MAX_EXPANSIONS) parseFail('brace: a range of more than 200 values');
      vals = [];
      for (let i = a; a <= b ? i <= b : i >= b; i += a <= b ? 1 : -1) vals.push(String(i));
    } else {
      vals = body.split(',');
      // a safe token: no `=` (zsh EQUALS), `~` (tilde), quote, `$`, glob char, space or backslash; never empty
      if (vals.length < 2 || !vals.every((v) => BRACE_ITEM.test(v))) parseFail('brace: only a list of safe literal items or a numeric range');
    }
    this.pos = end + 1;
    return { t: 'brace', vals };
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
      parts.push({ t: 'var', name: m![2]!, quoted });
      this.pos += m![0].length;
      return;
    }
    if (!quoted && (n === "'" || n === '"')) parseFail(`$${n}…${n} quoting`);
    const m = /^\$([A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])/.exec(s.slice(this.pos));
    if (m) {
      parts.push({ t: 'var', name: m[1]!, quoted });
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
        // Aegis C1: in an UNQUOTED heredoc bash and zsh join backslash-newline before matching the delimiter, so
        // `EO\⏎F` ends the body there and the rest RUNS. Refuse any such line (an odd run of trailing backslashes)
        if (!h.quoted && /(^|[^\\])(\\\\)*\\$/.test(raw)) parseFail('heredoc: a line ending in a backslash');
        if (line === h.delim) break;
        lines.push(line);
      }
      h.body = lines.join('\n');
    }
  }
}

const RESERVED = new Set(['if', 'then', 'else', 'elif', 'fi', 'while', 'until', 'case', 'esac', 'function', 'select', '{', '}', '[[', ']]', 'do', 'done', 'in', 'time', 'coproc']);
/** zsh/bash parameters with a lowercase name that change the shell's behaviour when assigned (zsh/parameter included). */
export const LOOP_VAR_DENY: ReadonlySet<string> = new Set(['path', 'cdpath', 'fpath', 'manpath', 'module_path', 'mailpath', 'fignore', 'psvar', 'watch', 'prompt', 'histchars', 'argv', 'status', 'pipestatus', 'signals', 'commands', 'functions', 'aliases', 'options', 'parameters', 'dirstack', 'history', 'historywords', 'jobstates', 'jobtexts', 'jobdirs', 'modules', 'nameddirs', 'userdirs', 'reswords', 'builtins', 'termcap', 'terminfo', 'widgets', 'funcstack', 'funcfiletrace', 'funcsourcetrace', 'functrace', 'saliases', 'galiases', 'dis_aliases', 'dis_functions', 'dis_builtins', 'dis_reswords', 'dis_galiases', 'dis_saliases', 'dis_patchars', 'patchars', 'zsh_eval_context', 'zsh_scheduled_events', 'match', 'mbegin', 'mend', 'reply', 'keymaps', 'sysparams', 'errnos',
  // Aegis L2: zsh/mapfile (assigning writes a file) and the lowercase proxy variables curl/git/wget honour
  'mapfile', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'ftp_proxy']);
/** Aegis L2: a name denied as a loop variable or tainted local — LOOP_VAR_DENY, or any zsh hook array `*_functions`. */
export const deniedVarName = (n: string): boolean => LOOP_VAR_DENY.has(n) || n.endsWith('_functions');
/** A brace-list item: a safe literal token (see #brace). */
const BRACE_ITEM = /^[A-Za-z0-9._+:@%/-]+$/;
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
    if (t.t === 'word' && t.plain === 'case') return this.#case();
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
    if (n.t !== 'word' || n.plain === null || !/^[a-z][a-z0-9_]{0,15}$/.test(n.plain) || deniedVarName(n.plain)) parseFail('for: a plain lowercase variable name');
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

  /**
   * `case WORD in [(]PAT[|PAT]…) LIST ;; … esac`: a pattern is string-only (literal and glob characters, no `$`,
   * substitution, tilde or brace); `;;` ends a clause (the last may omit it); `;&` and `;;&` are refused by the lexer.
   */
  #case(): Cmd {
    this.lx.take();
    const subj = this.lx.take();
    if (subj.t !== 'word') parseFail('case: a subject word');
    this.#skipNewlines();
    this.#expectWord('in');
    const clauses: Array<{ pats: Word[]; body: List }> = [];
    for (;;) {
      this.#skipNewlines();
      const t = this.lx.peek();
      if (t.t === 'word' && t.plain === 'esac') {
        this.lx.take();
        break;
      }
      if (t.t === 'op' && t.v === '(') this.lx.take();
      const pats: Word[] = [];
      for (;;) {
        const p = this.lx.take();
        if (p.t !== 'word' || !p.w.parts.every((x) => x.t === 'lit' || x.t === 'glob')) parseFail('case: a pattern is literal and glob characters only');
        pats.push((p as { w: Word }).w);
        const n = this.lx.take();
        if (n.t === 'op' && n.v === ')') break;
        if (!(n.t === 'op' && n.v === '|')) parseFail('case: ) after the patterns');
      }
      if (this.depth >= MAX_DEPTH) parseFail('nesting too deep');
      const body = new Parser(this.lx, this.depth + 1).list(new Set([';;', 'esac']));
      clauses.push({ pats, body });
      const e = this.lx.peek();
      if (e.t === 'op' && e.v === ';;') this.lx.take();
      else if (!(e.t === 'word' && e.plain === 'esac')) parseFail('case: ;; or esac after a clause');
    }
    if (clauses.length === 0) parseFail('case: no clause');
    return { t: 'case', subject: (subj as { w: Word }).w, clauses, redirs: this.#redirs([]) };
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
  /** the session roots (cwd, worktree): reads stay inside one (or a system read root); an absolute `cd` must land in one */
  roots: readonly string[];
  home: string;
  /** the Gnomon home (never read by an auto-passed command) */
  gnomonHome: string;
  platform?: string;
  /** the system read roots (posix); default SYSTEM_READ_ROOTS. Only ever NARROWED (tests run where /tmp is the tmpdir). */
  readRoots?: readonly string[];
  /**
   * K1 (anchored cwd): the directory the command is KNOWN to start in — the realpath of a session root. Set only when
   * the caller runs the command through anchorCommand (which cds there first and unsets CDPATH); absent ⇒ the cwd is
   * unknown until an absolute `cd`.
   */
  cwd?: string;
}
export type ReadOnlyVerdict = { ok: true } | { ok: false; why: string };

class Refuse extends Error {}
const no = (why: string): never => {
  throw new Refuse(why);
};

/** Protected roots relative to the home (credentials, keys, the Gnomon home is added by the caller). */
export const PROTECTED_HOME_PATHS = Object.freeze(['.ssh', '.aws', '.config/gh', '.config/gcloud', '.azure', '.kube', '.docker', '.gnupg', '.netrc', '.npmrc', '.git-credentials', '.pypirc', 'Library/Keychains', '.gnomon']);
export const PROTECTED_ABS_PATHS = Object.freeze(['/Library/Keychains']);
/** Aegis H4: besides the session roots, the only places a read may reach (posix; compared after realpath). */
export const SYSTEM_READ_ROOTS = Object.freeze(['/usr', '/opt/homebrew', '/etc', '/tmp', '/private/tmp', '/private/etc']);
/** Aegis H2: a glob (or a loop's value list, or a word's expansions) that yields more is refused. */
export const MAX_EXPANSIONS = 200;
/** Aegis C1: a `for` value is one safe file-name-ish token: no space, glob, quote, `$` or backslash (so `$f` never splits or globs again). */
const LOOP_VALUE = /^[A-Za-z0-9._+,:@%=/-]+$/;

/**
 * An argument after expansion: `lit` its concrete argv string, or null for a word holding a command substitution
 * (`sub`) or that IS one process substitution (`proc`, a pipe path). `exp` marks a value produced by a loop variable
 * or a glob match.
 */
interface Arg { lit: string | null; sub: boolean; proc: boolean; exp: boolean }
/**
 * `cwd`: the one directory this walk assumes (a top-level list walks each item once per POSSIBLE cwd, cwdSet).
 * `taint`: local variables assigned (`name=$(…)` / `name=lit`) earlier in an enclosing list — TEXT, never a path.
 */
interface Env { ctx: ReadOnlyContext; cwd: string | null; vars: ReadonlyMap<string, readonly string[]>; taint: ReadonlySet<string>; prot: string[]; allow: string[]; fold: (s: string) => string; pp: typeof path; native: boolean }
/** A top-level list tracks at most this many possible cwds (after `;` / `||` a cd may or may not have happened). */
export const MAX_CWDS = 8;

const realOr = (p: string): string | null => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
};

/**
 * Aegis H2: the realpath of `p`, or — when it does not exist — the realpath of its deepest existing ancestor joined
 * with the rest (normalized: a `..` below a missing component lands where it would if that component were a plain
 * directory; the OS fails there today). Only on the host's own path flavour (`native`); null otherwise.
 */
function realDeep(p: string, env: Env): string | null {
  if (!env.native) return null;
  const { pp } = env;
  let cur = p;
  const rest: string[] = [];
  for (let i = 0; i < 4096; i++) {
    const r = realOr(cur);
    if (r !== null) {
      return rest.length ? pp.join(r, ...rest.reverse()) : r;
    }
    const parent = pp.dirname(cur);
    if (parent === cur) return null;
    rest.push(pp.basename(cur));
    cur = parent;
  }
  return null;
}

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
  const env: Env = { ctx, cwd: ctx.cwd ?? null, vars: new Map(), taint: new Set(), prot, allow: [], fold, pp, native: pp === (process.platform === 'win32' ? path.win32 : path.posix) };
  try {
    env.allow = rootForms(env);
    if (pp === path.posix) env.allow.push(...(ctx.readRoots ?? SYSTEM_READ_ROOTS).filter((r) => SYSTEM_READ_ROOTS.includes(r)));
    walkList(list, env, true);
    return { ok: true };
  } catch (e) {
    if (e instanceof Refuse) return { ok: false, why: e.message };
    return { ok: false, why: 'error' };
  }
}

/** Each session root as given and at its (deepest-ancestor) realpath. */
function rootForms(env: Env): string[] {
  const out: string[] = [];
  for (const r of env.ctx.roots) {
    out.push(env.pp.resolve(r));
    const real = realDeep(r, env);
    if (real !== null) out.push(real);
  }
  return out;
}

/**
 * Walk a list. Only a TOP-LEVEL list changes the cwd (a `cd` as one whole item); it tracks the SET of cwds each item
 * may start in and walks the item once per member: along an unbroken `&&` run from a cd only the cd's target is
 * possible, while after `;`, a newline or `||` (where a cd may have failed or been skipped) every cwd seen in the
 * run is. A local assignment item (`name=$(…)`, `name=lit`) that runs unconditionally (first, or after `;` or a
 * newline) makes `name` TAINTED text for the later items of this list (and the lists inside them).
 */
function walkList(list: List, env: Env, top: boolean): void {
  const taint = new Set(env.taint);
  const local: Env = { ...env, taint };
  const key = (c: string | null): string => (c === null ? '\0' : env.fold(c));
  const uniq = (xs: Array<string | null>): Array<string | null> => {
    const seen = new Set<string>();
    const out = xs.filter((x) => (seen.has(key(x)) ? false : (seen.add(key(x)), true)));
    if (out.length > MAX_CWDS) no('cd: too many possible directories');
    return out;
  };
  let cur: Array<string | null> = [env.cwd];
  let seen = [...cur];
  let pure = true;
  for (const [i, it] of list.items.entries()) {
    if (it.sep === '&') no('background');
    if (it.pipe.bang) no('negation');
    const prev = i > 0 ? list.items[i - 1]!.sep : null;
    if (top && i > 0) {
      if (prev === '||') {
        pure = false;
        cur = seen;
      } else if (prev !== '&&') {
        cur = seen;
        seen = [...cur];
        pure = true;
      }
    }
    const only = it.pipe.cmds.length === 1 ? it.pipe.cmds[0]! : null;
    if (top && only && isCd(only)) {
      const next = uniq(cur.map((c) => cdTo(only as Extract<Cmd, { t: 'simple' }>, { ...local, cwd: c })));
      cur = pure ? next : uniq([...cur, ...next]);
      seen = uniq([...seen, ...next]);
      continue;
    }
    const assign = only && only.t === 'simple' && only.assigns.length === 1 && only.words.length === 0 && only.redirs.length === 0 ? only.assigns[0]! : null;
    for (const c of top ? cur : [env.cwd]) {
      const e: Env = { ...local, cwd: c };
      if (assign) localAssign(assign, e);
      else for (const cmd of it.pipe.cmds) walkCmd(cmd, e);
    }
    // the value is text: usable later only when the assignment certainly ran (an item after `;` / newline always runs)
    if (assign && (i === 0 || prev === ';' || prev === '\n')) taint.add(assignName(assign)!);
  }
}

const isCd = (c: Cmd): boolean => c.t === 'simple' && c.words.length > 0 && wordLit(c.words[0]!) === 'cd';

/** A lowercase local name (never a special parameter of bash or zsh), else null. */
function assignName(w: Word): string | null {
  const p0 = w.parts[0];
  if (!p0 || p0.t !== 'lit' || p0.quoted) return null;
  const m = /^([a-z][a-z0-9_]{0,31})=/.exec(p0.v);
  return m && !deniedVarName(m[1]!) ? m[1]! : null;
}

/**
 * `name=VALUE` with no command word: `name` is lowercase and no special parameter (an uppercase or special name is an
 * env assignment: refused), not an enclosing loop variable; VALUE holds literal text, proven read-only `$(…)` and
 * known variables only (no glob, tilde or brace). `X=1 cmd` never reaches here (walkCmd refuses it).
 */
function localAssign(w: Word, env: Env): void {
  const name = assignName(w);
  if (name === null) no('env assignment');
  if (env.vars.has(name!)) no('assignment: a loop variable');
  for (const p of w.parts) {
    if (p.t === 'sub') walkList(p.list, { ...env }, false);
    else if (p.t === 'var') {
      if (!env.vars.has(p.name) && !env.taint.has(p.name)) no(`parameter $${p.name}`);
    } else if (p.t !== 'lit') no('assignment: a glob, tilde or brace in the value');
  }
}

/**
 * Aegis H3 + K1: `cd` takes one literal path (or `~/…`): absolute, or relative to the KNOWN cwd. No `..` segment
 * (the shell's logical `..` and the physical one differ under a symlink), never `-`/`+`/`=`-led (cd -, zsh's dir
 * stack, EQUALS). A relative target must be an existing directory (so bash/zsh `cdable_vars` never apply; CDPATH is
 * unset by anchorCommand). It must lie in a session root as given and at its realpath; the cwd becomes the realpath.
 */
function cdTo(c: Extract<Cmd, { t: 'simple' }>, env: Env): string {
  if (c.assigns.length || c.redirs.length || c.words.length !== 2) no('cd: one literal path');
  const w = c.words[1]!;
  if (!w.parts.every((p, i) => p.t === 'lit' || (p.t === 'tilde' && i === 0))) no('cd: one literal path');
  const { pp, ctx, fold } = env;
  const rest = w.parts.map((p) => (p.t === 'lit' ? p.v : '')).join('');
  const t = w.parts[0]!.t === 'tilde' ? pp.join(ctx.home, rest) : rest;
  if (t === '' || /^[-+=]/.test(t)) no('cd: one literal path');
  const rel = !pp.isAbsolute(t);
  if (rel && env.cwd === null) no('cd: a relative path (the cwd is unknown)');
  const lexical = rel ? pp.resolve(env.cwd!, t) : pp.resolve(t);
  const real = realDeep(lexical, env);
  const forms = [lexical, ...(real !== null ? [real] : [])];
  const roots = rootForms(env);
  if (!forms.every((f) => roots.some((r) => within(fold(f), fold(r), pp, true)))) no('cd: outside the session roots');
  if (t.split(/[\\/]+/).includes('..')) no('cd: a .. segment');
  if (rel) {
    let dir = false;
    try {
      dir = env.native && fs.statSync(lexical).isDirectory();
    } catch {
      dir = false;
    }
    if (!dir) no('cd: a relative path that is not an existing directory');
  }
  return real ?? lexical;
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
    // Aegis C1: a loop iterates only literal words and literal globs (expanded now, every match a safe token)
    const vals: string[] = [];
    for (const w of c.items) {
      for (const a of expand(w, env)) {
        if (a.lit === null) no('for: a substitution in the word list');
        if (!LOOP_VALUE.test(a.lit!) || a.lit!.startsWith('-')) no('for: an unsafe value (or a glob that matched nothing)');
        vals.push(a.lit!);
      }
    }
    if (vals.length > MAX_EXPANSIONS) no('for: too many values');
    return walkList(c.body, { ...env, vars: new Map([...env.vars, [c.name, vals]]) }, false);
  }
  if (c.t === 'case') {
    // the subject is TEXT matched against string patterns (no split, no glob): a proven read-only $(…), a loop
    // variable or a tainted local may appear in it, quoted or not; the patterns were checked at parse
    textWord(c.subject, env, true);
    for (const cl of c.clauses) walkList(cl.body, env, false);
    return;
  }
  if (c.assigns.length) no('env assignment');
  if (c.words.length === 0) no('no command');
  const w0 = c.words[0]!;
  const p0 = w0.parts[0]!;
  const name = w0.parts.length === 1 && p0.t === 'glob' && p0.v === '[' ? '[' : wordLit(w0);
  if (name === null || name === '') no('command name not literal');
  if (name === 'cd') no('cd: only as a whole top-level command');
  const rule = COMMANDS[name!];
  if (!rule) no(`not allowlisted: ${name}`);
  const args = c.words.slice(1).flatMap((w) => expand(w, env));
  if (args.length > MAX_EXPANSIONS) no('too many arguments after expansion');
  rule!(args, env, name!);
}

function checkRedirs(rs: readonly Redir[], env: Env): void {
  for (const r of rs) {
    if (r.heredoc) {
      if (r.heredoc.body === null) no('heredoc');
      if (!r.heredoc.quoted && /[$`]/.test(r.heredoc.body!)) no('heredoc expansion');
      continue;
    }
    if (r.op === '<<<') {
      expand(r.target!, env); // data on stdin, never a path: a substitution here is fine once proven read-only
      continue;
    }
    if (r.op === '<') {
      if (r.fd !== null && r.fd !== 0) no('input redirection fd');
      const v = expand(r.target!, env);
      if (v.length !== 1 || v[0]!.lit === null) no('input redirection: one literal path');
      checkPath(v[0]!.lit!, env);
      continue;
    }
    const t = wordLit(r.target!);
    if (r.op === '>&' && (r.fd === null || r.fd === 1 || r.fd === 2) && (t === '1' || t === '2')) continue;
    if (['>', '>>', '&>', '&>>'].includes(r.op) && (r.fd === null || r.fd === 1 || r.fd === 2) && t === '/dev/null') continue;
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

/* glob patterns: a quoted char is escaped with `\`; an unquoted glob char is bare */
const escQ = (v: string): string => v.replace(/[\\*?[\]]/g, '\\$&');
const unesc = (v: string): string => v.replace(/\\(.)/gsu, '$1');
const hasGlob = (seg: string): boolean => /(^|[^\\])(\\\\)*[*?[]/.test(seg);

/**
 * A word's argv strings: loop variables substituted (each value a safe token), then — when an unquoted glob char is
 * present — the pattern expanded against the filesystem NOW (Aegis H2), every match becoming its own argument; a
 * pattern that matches nothing is passed literally (bash) or not run (zsh). Every substitution is proven read-only
 * here; a word holding one has no static value (`sub`).
 */
function expand(w: Word, env: Env): Arg[] {
  const p0 = w.parts[0]!;
  if (w.parts.length === 1 && p0.t === 'sub' && p0.kind === '<(') {
    walkList(p0.list, { ...env }, false);
    return [{ lit: null, sub: false, proc: true, exp: false }];
  }
  // a substitution or a TAINTED local makes the word text with no static value (echo/printf/<<< only take it)
  if (w.parts.some((p) => p.t === 'sub' || (p.t === 'var' && !env.vars.has(p.name) && env.taint.has(p.name)))) {
    textWord(w, env, false);
    return [{ lit: null, sub: true, proc: false, exp: false }];
  }
  // zsh EQUALS (on by default): an unquoted leading `=cmd` expands to the command's full path, read from $PATH
  if (p0.t === 'lit' && !p0.quoted && p0.v.startsWith('=')) no('=command expansion');
  let pats = [''];
  let glob = false;
  let fromVar = false;
  for (const p of w.parts) {
    if (p.t === 'lit') pats = pats.map((s) => s + (p.quoted ? escQ(p.v) : p.v));
    else if (p.t === 'glob') {
      pats = pats.map((s) => s + p.v);
      glob = true;
    } else if (p.t === 'tilde') pats = pats.map((s) => s + escQ(env.ctx.home));
    else if (p.t === 'brace') {
      fromVar = true; // each value is a new word: a `-`-led one is refused below
      pats = pats.flatMap((s) => p.vals.map((v) => s + escQ(v)));
      if (pats.length > MAX_EXPANSIONS) no('too many expansions');
    }
    else if (p.t === 'var') {
      const vs = env.vars.get(p.name);
      if (!vs) no(`parameter $${p.name}`);
      fromVar = true;
      pats = pats.flatMap((s) => vs!.map((v) => s + escQ(v)));
      if (pats.length > MAX_EXPANSIONS) no('too many expansions');
    }
  }
  const out: Arg[] = [];
  for (const pt of pats) {
    const matches = glob && hasGlob(pt) ? globExpand(pt, env) : [];
    if (matches.length === 0) out.push({ lit: unesc(pt), sub: false, proc: false, exp: fromVar });
    else for (const m of matches) out.push({ lit: m, sub: false, proc: false, exp: true });
    if (out.length > MAX_EXPANSIONS) no(`glob: more than ${MAX_EXPANSIONS} matches`);
  }
  for (const a of out) if (a.exp && a.lit!.startsWith('-')) no('an expanded value starts with -');
  return out;
}

/**
 * A word used as TEXT (never a path): every substitution proven read-only; every variable a loop variable or a
 * tainted local. A tainted local must be double-quoted (`"$s"`: no split, no glob) unless `bare` (the case subject).
 */
function textWord(w: Word, env: Env, bare: boolean): void {
  for (const p of w.parts) {
    if (p.t === 'sub') walkList(p.list, { ...env }, false);
    else if (p.t === 'var') {
      if (env.vars.has(p.name)) continue;
      if (!env.taint.has(p.name)) no(`parameter $${p.name}`);
      if (!p.quoted && !bare) no(`an unquoted tainted $${p.name}`);
    }
  }
}

/** One glob segment as a regex that matches a SUPERSET of what bash or zsh would (any case, dotfiles too, every bracket class as one char). */
function segRegex(seg: string): RegExp {
  let r = '';
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i]!;
    if (c === '\\') {
      r += (seg[++i] ?? '').replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    } else if (c === '*') {
      if (seg[i + 1] === '*') no('glob: **');
      r += '[^/]*';
    } else if (c === '?') r += '[^/]';
    else if (c === '[') {
      let j = i + 1;
      if (seg[j] === '!' || seg[j] === '^') j++;
      if (seg[j] === ']') j++;
      const k = seg.indexOf(']', j);
      if (k < 0) {
        r += '\\[';
        continue;
      }
      const body = seg.slice(i + 1, k);
      if (/[[\\/]/.test(body)) no('glob: a bracket class with [ \\ or /');
      r += '[^/]';
      i = k;
    } else r += c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }
  return new RegExp(`^${r}$`, 'iu');
}

/** Expand a pattern against the filesystem (never more than MAX_EXPANSIONS); [] when nothing matches. */
function globExpand(pat: string, env: Env): string[] {
  const abs = pat.startsWith('/');
  if (!abs && env.cwd === null) no('a relative glob with an unknown cwd');
  if (!env.native) return []; // a foreign path flavour (tests): nothing exists to match
  const joinSh = (sh: string, s: string): string => (sh === '' ? s : sh.endsWith('/') && s !== '' ? sh + s : `${sh}/${s}`);
  const joinFs = (f: string, s: string): string => (f.endsWith('/') || f.endsWith('\\') ? f + s : `${f}/${s}`);
  let cur: Array<[string, string]> = [[abs ? '/' : '', abs ? '/' : env.cwd!]];
  const segs = pat.split('/');
  for (const [i, seg] of segs.entries()) {
    if (abs && i === 0) continue;
    if (!hasGlob(seg)) {
      const s = unesc(seg);
      cur = cur.map(([sh, f]) => [joinSh(sh, s), s === '' ? f : joinFs(f, s)]);
      continue;
    }
    const re = segRegex(seg);
    const next: Array<[string, string]> = [];
    for (const [sh, f] of cur) {
      let names: string[];
      try {
        names = fs.readdirSync(f);
      } catch {
        continue;
      }
      if (seg.startsWith('.') || seg.startsWith('\\.')) names.push('.', '..');
      for (const n of names) {
        if (!re.test(n)) continue;
        if (n.includes('\uFFFD')) no('glob: an undecodable file name');
        next.push([joinSh(sh, n), joinFs(f, n)]);
        if (next.length > MAX_EXPANSIONS) no(`glob: more than ${MAX_EXPANSIONS} matches`);
      }
    }
    cur = next;
  }
  return cur.map(([sh]) => sh);
}

/**
 * A path operand: resolved against the KNOWN cwd (Aegis M2: a relative path with an unknown cwd is refused), then,
 * as given and at its (deepest-ancestor) realpath: not a device path, not inside or an ancestor of a protected root,
 * and inside a session root or a system read root (Aegis H4 allowlist).
 */
function checkPath(t: string, env: Env): void {
  const { pp, fold } = env;
  if (t === '' || t === '-') return;
  if (pp === path.win32 && /^[\\/]{2}/.test(t)) no('device path');
  let raw: string;
  if (pp.isAbsolute(t)) raw = t;
  else if (env.cwd === null) return no('a relative path with an unknown cwd');
  else raw = env.cwd.endsWith(pp.sep) ? env.cwd + t : env.cwd + pp.sep + t;
  const real = realDeep(raw, env);
  for (const f of [pp.resolve(raw), ...(real !== null ? [real] : [])]) {
    const ff = fold(f);
    if (pp === path.posix && (within(ff, '/dev', pp, true) || within(ff, '/proc', pp, true))) no('device path');
    for (const p of env.prot) {
      const fp = fold(p);
      if (within(ff, fp, pp, true) || within(fp, ff, pp, false)) no('protected path');
    }
    if (!env.allow.some((a) => within(ff, fold(a), pp, true))) no('outside the readable roots');
  }
}

const needCwd = (env: Env, name: string): void => {
  if (env.cwd === null) no(`${name}: the cwd is unknown`);
};

/* ── the allowlist ────────────────────────────────────────────────────────── */

type Rule = (args: Arg[], env: Env, name: string) => void;

const isFlag = (a: Arg): boolean => a.lit !== null && a.lit.startsWith('-') && a.lit !== '-';

/** Aegis C1: every argument of a path-taking command is checked as a path (flag values after `=` or a `/` too); a substitution never reaches one. */
function pathArgs(args: readonly Arg[], env: Env, name: string): void {
  for (const a of args) {
    if (a.proc) continue; // `<(…)`: a pipe holding a proven read-only command's output
    if (a.lit === null) no(`${name}: a substitution in a path argument`);
    if (isFlag(a)) {
      const s = a.lit!;
      const eq = s.indexOf('=');
      if (eq > 0) checkPath(s.slice(eq + 1), env);
      else {
        const slash = s.search(/[\\/]/);
        if (slash > 0) checkPath(s.slice(slash), env);
      }
      continue;
    }
    checkPath(a.lit!, env);
  }
}

const staticOnly = (args: readonly Arg[], name: string): void => {
  if (args.some((a) => a.lit === null)) no(`${name}: dynamic argument`);
};

/**
 * Aegis H2: a reader whose flags never write or execute, minus its recursive / symlink-following / name-list flags
 * (`denyShort` letters in any cluster; `denyLong` names and every abbreviation of them). `implicitCwd`: with no
 * operand it reads the cwd, which must be known.
 */
function reader(denyShort = '', denyLong: readonly string[] = [], implicitCwd = false, fileShort = ''): Rule {
  return (args, env, name) => {
    for (const a of args) {
      if (!isFlag(a) || a.lit === '--') continue;
      const s = a.lit!;
      if (s.startsWith('--')) {
        const k = s.split('=')[0]!;
        if (denyLong.some((d) => d.startsWith(k))) no(`${name}: flag ${k}`);
        continue;
      }
      for (const ch of s.slice(1)) {
        if (fileShort.includes(ch)) break; // the rest of the word is that flag's FILE value (attachedFiles)
        if (denyShort.includes(ch)) no(`${name}: flag -${ch}`);
      }
    }
    attachedFiles(args, fileShort, env);
    if (implicitCwd && !args.some((a) => !isFlag(a))) checkPath('.', env);
    pathArgs(args, env, name);
  };
}

/**
 * A short flag that takes a FILE (`grep -f`, `diff -X`, `du -X`, `file -m`): its value attached in the same word
 * (`-fFILE`, `-nfFILE`) is checked as a path (a separate value is an operand, checked anyway).
 */
function attachedFiles(args: readonly Arg[], letters: string, env: Env): void {
  if (letters === '') return;
  for (const a of args) {
    if (!isFlag(a) || a.lit!.startsWith('--')) continue;
    const s = a.lit!;
    const i = [...letters].map((l) => s.indexOf(l, 1)).filter((x) => x > 0).sort((x, y) => x - y)[0];
    if (i !== undefined && i < s.length - 1) checkPath(s.slice(i + 1), env);
  }
}

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

/** Output-only commands. Aegis C2: echo takes only -n/-e/-E; printf no flag at all (`printf -v HOME …` assigns). */
const ECHO_FLAGS = new Set(['-n', '-e', '-E', '-ne', '-en', '-nE', '-En']);
const echoRule: Rule = (args) => {
  for (const a of args) if (a.lit !== null && /^-[A-Za-z]+$/.test(a.lit) && !ECHO_FLAGS.has(a.lit)) no(`echo: flag ${a.lit}`);
};
const printfRule: Rule = (args) => {
  const f = args[0];
  if (!f) no('printf: a format');
  if (f!.lit === null) no('printf: the format is not literal');
  if (f!.lit!.startsWith('-')) no('printf: a flag');
};
const textRule = (o: { short: string; shortValue?: string; long?: readonly string[]; longValue?: readonly string[] }, maxOperands = Infinity): Rule => (args, _env, name) => {
  staticOnly(args, name);
  if (flags(args, name, o).length > maxOperands) no(`${name}: an operand`);
};
const TEST_FILE_UNARY = new Set(['-e', '-f', '-d', '-s', '-r', '-w', '-x', '-L', '-h', '-b', '-c', '-p', '-S', '-O', '-G', '-N', '-k', '-u', '-g']);
const TEST_FILE_BINARY = new Set(['-nt', '-ot', '-ef']);
const TEST_OTHER = new Set(['-z', '-n', '-t', '-eq', '-ne', '-lt', '-le', '-gt', '-ge', '-a', '-o']);
const testRule: Rule = (args, env, name) => {
  staticOnly(args, name);
  let ops = args.map((a) => a.lit!);
  if (name === '[') {
    if (ops.at(-1) !== ']') no('[: a closing ]');
    ops = ops.slice(0, -1);
  }
  for (let i = 0; i < ops.length; i++) {
    const s = ops[i]!;
    // `-a FILE` is also bash's unary existence test (where a binary `-a` cannot stand): its operand is a path
    const unaryA = s === '-a' && (i === 0 || ['!', '(', '-a', '-o'].includes(ops[i - 1]!));
    if (TEST_FILE_UNARY.has(s) || unaryA) {
      if (ops[i + 1] !== undefined) checkPath(ops[++i]!, env);
    } else if (TEST_FILE_BINARY.has(s)) {
      if (ops[i - 1] !== undefined) checkPath(ops[i - 1]!, env);
      if (ops[i + 1] !== undefined) checkPath(ops[++i]!, env);
    } else if (/^-./.test(s) && !TEST_OTHER.has(s)) no(`${name}: flag ${s}`);
  }
};

const sortRule: Rule = (args, env, name) => {
  staticOnly(args, name);
  flags(args, name, { short: 'bdfghiMnrRsuVzc', shortValue: 'kt', long: ['--reverse', '--numeric-sort', '--unique', '--human-numeric-sort', '--version-sort', '--ignore-case', '--stable', '--general-numeric-sort', '--month-sort', '--dictionary-order', '--ignore-leading-blanks', '--check', '--zero-terminated'], longValue: ['--key', '--field-separator'] });
  pathArgs(args, env, name);
};
const uniqRule: Rule = (args, env, name) => {
  staticOnly(args, name);
  const ops = flags(args, name, { short: 'cdDuiz', shortValue: 'fsw', long: ['--count', '--repeated', '--unique', '--ignore-case'], longValue: ['--skip-fields', '--skip-chars', '--check-chars'] });
  if (ops.length > 1) no('uniq: a second operand is an output file');
  pathArgs(args, env, name);
};
const fileRule: Rule = (args, env, name) => {
  staticOnly(args, name);
  // no -f (a list of names read from a file), no -C (compile)
  attachedFiles(args, 'm', env);
  flags(args, name, { short: 'bihLNkzZ0p', shortValue: 'mFe', long: ['--brief', '--mime', '--mime-type', '--mime-encoding', '--dereference', '--no-dereference', '--keep-going'] });
  pathArgs(args, env, name);
};
/** Aegis M1: display only — `+FORMAT`, -u -R -j -I and -v ADJUST; never -f (read a file), -r (a file's time), -d, -s. */
const dateRule: Rule = (args, _env, name) => {
  staticOnly(args, name);
  const ops = flags(args, name, { short: 'uRjI', shortValue: 'v', long: ['--utc', '--universal', '--rfc-email', '--iso-8601', '--rfc-3339'] });
  if (ops.some((a) => !a.lit!.startsWith('+'))) no('date: an operand sets the clock');
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
  pathArgs(rest, env, name);
};
const FIND_PRED = new Set(['-name', '-iname', '-path', '-ipath', '-wholename', '-iwholename', '-regex', '-iregex', '-type', '-xtype', '-maxdepth', '-mindepth', '-newer', '-mtime', '-mmin', '-atime', '-amin', '-ctime', '-cmin', '-size', '-perm', '-user', '-group', '-links', '-uid', '-gid', '-inum', '-samefile', '-lname', '-ilname']);
/** Aegis H2: no -L / -follow (symlink following); -H follows only the roots, which are realpath-checked. */
const FIND_FLAG = new Set(['-print', '-print0', '-prune', '-o', '-or', '-a', '-and', '-not', '!', '(', ')', ',', '-empty', '-depth', '-d', '-xdev', '-mount', '-true', '-false', '-ls', '-readable', '-writable', '-executable', '-nouser', '-nogroup', '-quit', '-printf', '-H', '-P', '-E', '-X', '-s', '-x', '-noleaf', '-regextype']);
const findRule: Rule = (args, env, name) => {
  staticOnly(args, name);
  let i = 0;
  while (i < args.length && ['-H', '-P', '-E', '-X', '-s', '-x', '-d'].includes(args[i]!.lit!)) i++;
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
  if (roots.length === 0) checkPath('.', env);
  pathArgs(roots, env, name);
};
/**
 * Aegis H1: awk runs ONE print program of a strict shape — an optional pattern (`/re/`, `NR|NF|$N <op> number|"str"`,
 * `END`) and `{ print ITEMS }` where an item is `$N`, `$NF`, `NF`, `NR` or a plain string. Nothing else can appear, so
 * no ARGV/ARGC/FILENAME/ENVIRON/getline/system/close/redirection.
 */
const AWK_ITEM = String.raw`(?:\$(?:\d+|NF)|NF|NR|"[^"\\]*")`;
const AWK_PROG = new RegExp(String.raw`^\s*(?:(?:NR|NF|\$\d+)\s*(?:==|!=|<=|>=|<|>)\s*(?:\d+|"[^"\\]*")\s*|\/[^/\\\n]*\/\s*|END\s*)?\{\s*print(?:\s+${AWK_ITEM}(?:\s*,?\s*${AWK_ITEM})*)?\s*;?\s*\}\s*$`);
const awkRule: Rule = (args, env, name) => {
  staticOnly(args, name);
  let i = 0;
  for (; i < args.length && isFlag(args[i]!); i++) {
    const s = args[i]!.lit!;
    if (s === '--') {
      i++;
      break;
    }
    if (s === '-F') i++;
    else if (!/^-F./.test(s)) no(`awk: flag ${s}`);
  }
  const prog = args[i];
  if (!prog) no('awk: a program');
  if (!AWK_PROG.test(prog!.lit!)) no('awk: only a print program');
  pathArgs(args.slice(i + 1), env, name);
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
  pathArgs(ops, env, name);
};
const GIT_READ = new Set(['status', 'log', 'diff', 'show', 'blame', 'rev-parse', 'ls-files', 'describe']);
/** RC3: read-only plumbing/porcelain whose every option reads (any argument, after the GIT_BAD check). */
const GIT_READ_MORE = new Set(['show-ref', 'ls-tree', 'rev-list', 'shortlog', 'merge-base', 'for-each-ref']);
/**
 * Long options that write, run a program or redirect git. git accepts any unambiguous ABBREVIATION of a long option
 * (`--outp=f` is `--output=f`) and bundles short options (`-iOsh` carries `-O`), so a literal match is not enough
 * (Aegis re-check of the prefix rules, 2026-10-20): a `--name` that is a prefix of any of these is refused, and so is
 * any short bundle containing `O`.
 */
const GIT_BAD_LONG = ['output', 'output-directory', 'ext-diff', 'textconv', 'open-files-in-pager', 'exec', 'exec-path', 'upload-pack', 'receive-pack', 'paginate', 'git-dir', 'work-tree', 'config-env', 'namespace', 'filters'];
export function gitOptBad(s: string): boolean {
  if (s.startsWith('--')) {
    const name = s.slice(2).split('=')[0]!;
    if (!name) return false; // `--` (end of options)
    return GIT_BAD_LONG.some((bad) => bad.startsWith(name));
  }
  return /^-[^-]/.test(s) && s.slice(1).includes('O');
}
const GIT_BAD = { test: gitOptBad };
/** Aegis M3: config keys that may hold a credential (URLs carry user:token, headers carry bearer tokens). */
const GIT_SECRET_KEY = /^(remote|credential|http|https|url|sendemail)\.|url|token|password|passwd|secret|auth|header|cookie|proxy|key/i;
const gitRule: Rule = (args, env, name) => {
  staticOnly(args, name);
  needCwd(env, name); // git finds its repo (and that repo's config) from the cwd
  // K1: only while the cwd IS a session root — below it, a planted nested `.git` would choose the repo and its config
  if (!rootForms(env).some((r) => env.fold(r) === env.fold(env.cwd!))) no('git: only with the cwd at a session root');
  // Aegis H1: the repo's own config may name a program git runs on a read (fsmonitor, textconv, filters, …)
  if (env.native) {
    const bad = repoGitExecKey(env.cwd!, env.ctx.home);
    if (bad !== null) no(`git: the repo config names a program (${bad})`);
  }
  const sub = args[0]?.lit;
  if (!sub || sub.startsWith('-')) no('git: a global option');
  const rest = args.slice(1);
  for (const a of rest) if (GIT_BAD.test(a.lit!)) no(`git: ${a.lit!.split('=')[0]}`);
  if (GIT_READ.has(sub!)) return pathArgs(rest, env, name);
  if (sub === 'branch') {
    const names = rest.filter((a) => !isFlag(a));
    for (const a of rest) {
      const s = a.lit!;
      if (isFlag(a) && !/^(-[avr]+|-vv|--list|--all|--remotes|--verbose|--show-current|--merged|--no-merged|--contains|--no-contains|--sort=.*|--format=.*|--color|--no-color|--column|--no-column)$/.test(s)) no(`git branch: ${s}`);
    }
    // Low: `-l NAME` was --create-reflog in older git (it created NAME); a pattern only after the long --list
    if (names.length && !rest.some((a) => a.lit === '--list')) no('git branch: a name (only with --list)');
    return;
  }
  // RC3 (TD-2026-10-20-086): more read-only subcommands; every argument already passed GIT_BAD above
  if (GIT_READ_MORE.has(sub!)) return pathArgs(rest, env, name);
  const flagsOnly = (re: RegExp, what: string): void => {
    for (const a of rest.slice(1)) if (!re.test(a.lit!)) no(`git ${what}: ${a.lit}`);
  };
  if (sub === 'worktree') {
    if (rest[0]?.lit !== 'list') no('git worktree: only list');
    return flagsOnly(/^(--porcelain|-v|--verbose|-z)$/, 'worktree list');
  }
  if (sub === 'stash') {
    if (rest[0]?.lit !== 'list') no('git stash: only list');
    return flagsOnly(/^-/, 'stash list'); // log options only, no operand
  }
  if (sub === 'reflog') {
    if (rest[0]?.lit !== 'show') no('git reflog: only show');
    return pathArgs(rest.slice(1), env, name);
  }
  if (sub === 'cat-file') {
    if (rest.length === 2 && ['-t', '-s', '-p'].includes(rest[0]!.lit!) && !rest[1]!.lit!.startsWith('-')) return pathArgs(rest.slice(1), env, name);
    no('git cat-file: only -t, -s or -p OBJECT');
  }
  if (sub === 'tag') {
    // `git tag NAME` creates a tag: only the listing form, with -l/--list and listing flags
    if (!rest.some((a) => a.lit === '-l' || a.lit === '--list')) no('git tag: only -l/--list');
    for (const a of rest) {
      if (isFlag(a) && !/^(-l|-i|-n\d*|--list|--ignore-case|--sort=.*|--format=.*|--contains|--no-contains|--merged|--no-merged|--points-at|--column|--no-column|--color|--color=.*|--no-color)$/.test(a.lit!)) no(`git tag: ${a.lit}`);
    }
    return pathArgs(rest, env, name);
  }
  if (sub === 'remote') {
    if (rest.length === 0) return;
    // RW (read-only widening): `remote -v` / `remote get-url NAME` in an anchored run. Aegis M1: git may print a URL
    // that `cat .git/config` cannot show — rewritten by a global/system url.<base>.insteadOf / pushInsteadOf, or
    // carrying userinfo — so either form is a card when any config scope git reads names such a key or such a URL
    const verbose = rest.length === 1 && (rest[0]!.lit === '-v' || rest[0]!.lit === '--verbose');
    const getUrl = rest.length === 2 && rest[0]!.lit === 'get-url' && /^[A-Za-z0-9._-]+$/.test(rest[1]!.lit!) && !rest[1]!.lit!.startsWith('-');
    if (!(verbose || getUrl) || env.ctx.cwd === undefined || env.pp !== path.posix) no('git remote: only bare, or -v / get-url NAME in an anchored run');
    if (!env.native) no('git remote: a foreign path flavour');
    const risk = gitRemoteUrlRisk(env.cwd!, env.ctx.home);
    if (risk !== null) no(`git remote: a URL may hold a credential (${risk})`);
    return;
  }
  if (sub === 'config') {
    if (rest.length === 2 && ['--get', '--get-all'].includes(rest[0]!.lit!) && !rest[1]!.lit!.startsWith('-') && !GIT_SECRET_KEY.test(rest[1]!.lit!)) return;
    no('git config: only --get/--get-all KEY, never a key that may hold a credential');
  }
  no(`git: subcommand ${sub}`);
};

/* ── Aegis H1: exec-class keys in the repo's git config ───────────────────── */

/** The config keys (lowercased `section[.sub].key`) under which a READ-ONLY git command may run a program. */
function execKey(section: string, sub: string | null, key: string, value: string): boolean {
  switch (section) {
    case 'core':
      if (key === 'fsmonitor') return !/^(false|no|off|0|)$/i.test(value.trim());
      return ['pager', 'sshcommand', 'hookspath', 'alternaterefscommand', 'askpass', 'gitproxy'].includes(key);
    case 'diff':
      return sub === null ? key === 'external' : key === 'textconv' || key === 'command';
    case 'filter':
    case 'pager':
      return true;
    case 'remote':
      return key === 'uploadpack' || key === 'receivepack';
    case 'gpg':
      return key === 'program';
    case 'uploadpack':
      return key === 'packobjectshook';
    case 'credential':
      return key === 'helper';
    default:
      return false;
  }
}

/** A config value: quotes removed, an inline `#`/`;` comment outside quotes dropped (enough to read include paths). */
function configValue(v: string): string {
  let out = '';
  let q = false;
  for (let i = 0; i < v.length; i++) {
    const c = v[i]!;
    if (c === '"') q = !q;
    else if (c === '\\' && i + 1 < v.length) out += v[++i];
    else if (!q && (c === '#' || c === ';')) break;
    else out += c;
  }
  return out.trim();
}

/**
 * Scan one git config file (and every include / includeIf path, conditions ignored: a superset) for an exec-class
 * key. Returns the key, null when none, or a reason string when the file cannot be read as git config (fail closed).
 */
type ConfigHit = (section: string, sub: string | null, key: string, value: string) => boolean;
function scanGitConfig(file: string, home: string, depth: number, seen: Set<string>, hit: ConfigHit = execKey): string | null {
  if (depth > 10) return 'include depth';
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? null : `unreadable ${path.basename(file)}`; // git skips a missing include
  }
  const real = realOr(file) ?? file;
  if (seen.has(real)) return null;
  seen.add(real);
  const lines = text.replace(/\\\r?\n/g, '').split(/\r?\n/);
  let section = '';
  let sub: string | null = null;
  for (let raw of lines) {
    let l = raw.trim();
    if (l === '' || l.startsWith('#') || l.startsWith(';')) continue;
    if (l.startsWith('[')) {
      const m = /^\[\s*([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]/.exec(l);
      if (!m) return 'unparsed config section';
      const name = m[1]!.toLowerCase();
      const dot = name.indexOf('.');
      section = dot < 0 ? name : name.slice(0, dot);
      sub = m[2] !== undefined ? m[2] : dot < 0 ? null : name.slice(dot + 1);
      raw = l.slice(m[0].length);
      l = raw.trim();
      if (l === '' || l.startsWith('#') || l.startsWith(';')) continue;
    }
    const k = /^([A-Za-z][A-Za-z0-9-]*)\s*(?:=(.*))?$/.exec(l);
    if (!k) return 'unparsed config line';
    const key = k[1]!.toLowerCase();
    const value = configValue(k[2] ?? '');
    if (hit(section, sub, key, value)) return `${section}${sub !== null ? `.${sub}` : ''}.${key}`;
    if ((section === 'include' || section === 'includeif') && key === 'path' && value !== '') {
      const inc = value.startsWith('~/') ? path.join(home, value.slice(2)) : path.isAbsolute(value) ? value : path.join(path.dirname(file), value);
      const r = scanGitConfig(inc, home, depth + 1, seen, hit);
      if (r !== null) return r;
    }
  }
  return null;
}

/**
 * Aegis H1: the exec-class key the repo git would use from `cwd` names (its local config, a worktree's
 * config.worktree, the common dir's config, and their includes), or null. The repo is found as git finds it: the
 * nearest `.git` dir or `gitdir:` file at or above cwd. The user's global and system config are trusted.
 */
export function repoGitExecKey(cwd: string, home: string, hit: ConfigHit = execKey): string | null {
  let dir = cwd;
  for (let i = 0; i < 4096; i++) {
    const dotgit = path.join(dir, '.git');
    let st: fs.Stats | null = null;
    try {
      st = fs.statSync(dotgit);
    } catch {
      st = null;
    }
    if (st) {
      let gitdir = dotgit;
      if (st.isFile()) {
        const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotgit, 'utf8'));
        if (!m) return 'unparsed .git file';
        gitdir = path.resolve(dir, m[1]!);
      }
      const files = [path.join(gitdir, 'config'), path.join(gitdir, 'config.worktree')];
      try {
        const common = fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8').trim();
        if (common) files.push(path.join(path.resolve(gitdir, common), 'config'));
      } catch {
        // not a linked worktree
      }
      const seen = new Set<string>();
      for (const f of files) {
        const r = scanGitConfig(f, home, 0, seen, hit);
        if (r !== null) return r;
      }
      return null;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * Aegis M1: a key or value under which `git remote -v` / `get-url` may print a credential: any
 * url.<base>.insteadOf / pushInsteadOf (a rewrite can add userinfo), or any value holding a URL with userinfo
 * (`scheme://user[:pass]@…`).
 */
const credUrlHit: ConfigHit = (_section, _sub, key, value) => key === 'insteadof' || key === 'pushinsteadof' || /:\/\/[^/\s]*@/.test(value);

/**
 * Aegis M1: the first credential-risk key (credUrlHit) in any config scope git may read from `cwd` — the repo's (as
 * repoGitExecKey finds it), the global (GIT_CONFIG_GLOBAL as well as ~/.gitconfig and $XDG_CONFIG_HOME/git/config)
 * and the system (GIT_CONFIG_SYSTEM as well as /etc/gitconfig and the Homebrew prefixes), every include followed. A
 * SUPERSET of what git reads (the env named is the kernel's; the defaults are scanned too). A file that exists but
 * cannot be read or parsed is a risk (fail closed). Null when none.
 */
export function gitRemoteUrlRisk(cwd: string, home: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const r = repoGitExecKey(cwd, home, credUrlHit);
  if (r !== null) return r;
  const xdg = env.XDG_CONFIG_HOME ? env.XDG_CONFIG_HOME : path.join(home, '.config');
  const files = [
    ...(env.GIT_CONFIG_GLOBAL ? [env.GIT_CONFIG_GLOBAL] : []),
    path.join(home, '.gitconfig'),
    path.join(xdg, 'git', 'config'),
    path.join(home, '.config', 'git', 'config'),
    ...(env.GIT_CONFIG_SYSTEM ? [env.GIT_CONFIG_SYSTEM] : []),
    '/etc/gitconfig',
    '/opt/homebrew/etc/gitconfig',
    '/usr/local/etc/gitconfig',
  ];
  const seen = new Set<string>();
  for (const f of files) {
    const hit = scanGitConfig(f, home, 0, seen, credUrlHit);
    if (hit !== null) return hit;
  }
  return null;
}

/**
 * Aegis H2: `diff DIR DIR` compares the files inside both directories and `diff FILE DIR` reads DIR/FILE — paths that
 * are never operands, so never realpath-checked. A directory operand (at its realpath) is refused.
 */
const diffReader = reader('r', ['--recursive'], false, 'X');
const diffRule: Rule = (args, env, name) => {
  diffReader(args, env, name);
  for (const a of args) {
    if (a.proc || a.lit === null || isFlag(a) || !env.native) continue;
    const t = env.pp.isAbsolute(a.lit) ? a.lit : env.pp.join(env.cwd ?? '', a.lit);
    let dir = false;
    try {
      dir = fs.statSync(t).isDirectory();
    } catch {
      // missing: diff fails on it
    }
    if (dir) no('diff: a directory operand');
  }
};

/* ── RW: the read-only widening (founder decision 2026-10-20: never prompt more than native Claude Code) ── */

/**
 * RW: every family added by the widening passes only in an ANCHORED posix run — ctx.cwd is set (the kernel runs the
 * command through anchorCommand, which cds to the root's realpath and unsets CDPATH and RIPGREP_CONFIG_PATH). A win32
 * session and an unanchored caller keep the earlier rules unchanged.
 */
function anchoredOnly(env: Env, what: string): void {
  if (env.ctx.cwd === undefined || env.pp !== path.posix) no(`${what}: only in an anchored run`);
}

/** A walk from the cwd (or an operand): the cwd must be known and readable, so the walk starts inside a root. */
function walksCwd(env: Env, name: string): void {
  needCwd(env, name);
  checkPath('.', env);
}

/**
 * RW: grep recursion. `-r` / `--recursive` (any abbreviation, `--r` included) walks a directory WITHOUT following a
 * symlink found below it (GNU grep and ugrep: only a command-line symlink is followed, and an operand is checked at
 * its realpath; BSD grep: -p, no symlink at all, is the default). `-R`, `-S`, `-O`, `-d`, `-D`,
 * `--dereference-recursive`, `--directories` and `--devices` stay refused. Recursion is ANCHORED only, and the cwd it
 * may walk with no operand is checked. An `r` anywhere in a short cluster counts (an attached value with an `r` only
 * adds the checks).
 */
const GREP_DENY_SHORT = 'RSOdD';
const GREP_DENY_LONG: readonly string[] = ['--dereference-recursive', '--directories', '--devices'];
function grepRecursive(a: Arg): boolean {
  if (!isFlag(a) || a.lit === '--') return false;
  const s = a.lit!;
  if (s.startsWith('--')) {
    const k = s.split('=')[0]!;
    return k.length > 2 && '--recursive'.startsWith(k);
  }
  return s.slice(1).includes('r');
}
function grepRule(): Rule {
  const base = reader(GREP_DENY_SHORT, GREP_DENY_LONG, false, 'f');
  return (args, env, name) => {
    base(args, env, name);
    if (args.some(grepRecursive)) {
      anchoredOnly(env, `${name} -r`);
      walksCwd(env, name);
    }
  };
}

/**
 * RW: rg (recursive by default; never follows a symlink unless -L/--follow). Refused: -L --follow (symlinks),
 * -z --search-zip (runs decompressors), --pre --pre-glob (runs a preprocessor), --hostname-bin (runs a program).
 * Its config file (RIPGREP_CONFIG_PATH, which may add any flag) is unset by the anchor, so rg is anchored only.
 */
const rgReader = reader('Lz', ['--follow', '--pre', '--pre-glob', '--search-zip', '--hostname-bin'], false, 'f');
const rgRule: Rule = (args, env, name) => {
  anchoredOnly(env, name);
  rgReader(args, env, name);
  walksCwd(env, name);
};

/** RW: fd (recursive; no symlink unless -L). Refused: -x --exec, -X --exec-batch (run a command), -l --list-details (runs ls), -L --follow. */
const fdReader = reader('xXlL', ['--exec', '--exec-batch', '--list-details', '--follow']);
/**
 * Aegis L3: fd's FIRST positional is its PATTERN, not a path; every later positional is a search path. Only flags
 * that certainly take a separate value are modelled as consuming one (a value flag missed here only makes the real
 * pattern look like a path: a stricter check, never a looser one). Path-valued flags (--base-directory,
 * --search-path, --ignore-file) keep their value path-checked.
 */
const FD_VALUE_SHORT = 'dEetcjSo';
const FD_VALUE_LONG: readonly string[] = ['--max-depth', '--min-depth', '--exact-depth', '--exclude', '--extension', '--type', '--color', '--threads', '--size', '--changed-within', '--changed-before', '--owner', '--max-results', '--path-separator', '--format', '--batch-size'];
const FD_PATH_LONG: readonly string[] = ['--base-directory', '--search-path', '--ignore-file'];
const fdRule: Rule = (args, env, name) => {
  anchoredOnly(env, name);
  staticOnly(args, name);
  const checked: Arg[] = [];
  let pattern = false;
  let endOpts = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const s = a.lit!;
    if (!endOpts && s === '--') {
      endOpts = true;
      continue;
    }
    if (!endOpts && isFlag(a)) {
      checked.push(a);
      if (s.startsWith('--')) {
        if (!s.includes('=') && (FD_VALUE_LONG.includes(s) || FD_PATH_LONG.includes(s)) && args[i + 1] !== undefined) {
          i++;
          if (FD_PATH_LONG.includes(s)) checked.push(args[i]!);
        }
      } else {
        const j = [...s.slice(1)].findIndex((ch) => FD_VALUE_SHORT.includes(ch));
        if (j === s.length - 2 && args[i + 1] !== undefined) i++; // the value letter ends the cluster: the next word is its value
      }
      continue;
    }
    if (!pattern) {
      pattern = true; // the pattern: a regex or glob, never read as a path
      continue;
    }
    checked.push(endOpts && isFlag(a) ? { ...a, lit: `./${s}` } : a);
  }
  fdReader(checked, env, name);
  walksCwd(env, name);
};

/**
 * RW: tree (names only). Refused: -o (writes its output to a file), -R (re-runs, writing 00Tree.html), -l (follows
 * symlinks), --fromfile/--fromtabfile, --output. Aegis L3: tree reads a short cluster letter by letter and each of
 * P I (a pattern) and L H T (a value) takes the NEXT word; a -P/-I pattern is not a path, the other values stay checked.
 */
const treeReader = reader('olR', ['--fromfile', '--fromtabfile', '--output'], true);
const treeRule: Rule = (args, env, name) => {
  anchoredOnly(env, name);
  staticOnly(args, name);
  const checked: Arg[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    checked.push(a);
    if (!isFlag(a) || a.lit!.startsWith('--')) continue;
    for (const ch of a.lit!.slice(1)) {
      if (!'PILHT'.includes(ch) || args[i + 1] === undefined) continue;
      i++;
      if (!'PI'.includes(ch)) checked.push(args[i]!);
    }
  }
  treeReader(checked, env, name);
  walksCwd(env, name);
};

/**
 * RW: the project CLIs' read verbs, each checked read-only in its source (packages/paradigm/src, packages/gnomon/src/cli).
 * An exact grammar per verb: any other verb, flag or operand is a card. The paradigm verbs are the CLI's declared
 * read-only commands (paradigm src/core/command-policy.ts READ_ONLY_COMMANDS), each proven byte-identical on the
 * project tree and HOME by paradigm src/__tests__/readonly-commands.test.ts (@a-company/paradigm >= 7.15.2).
 */
const LORE_ID = /^L-[A-Za-z0-9_-]{1,160}$/;
const TASK_LS_STATUS = new Set(['active', 'open', 'done', 'shelved', 'all']);
/** `NAME VALUE` pairs and bare flags of one verb; returns the operands. A value never starts with `-`. */
function verbArgs(rest: readonly string[], what: string, bare: readonly string[], valued: readonly string[] = [], value: RegExp = /^[^-]/): string[] {
  const ops: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const s = rest[i]!;
    if (!s.startsWith('-')) ops.push(s);
    else if (bare.includes(s)) continue;
    else if (valued.includes(s) && rest[i + 1] !== undefined && value.test(rest[i + 1]!)) i++;
    else no(`${what}: ${s}`);
  }
  return ops;
}
/**
 * `paradigm` (the cwd must be a session root: the CLI reads the project from process.cwd()):
 *   status | st; doctor [--context] [--explain]; ripple SYMBOL [PATH] [-d|--depth N] [--json] [-q|--quiet];
 *   purpose validate [PATH]; task ls [active|open|done|shelved|all] [--json] [--mine] [-p|--priority V] [-t|--tag V]
 *   [-n|--limit N]; task show REF [--json]; lore list|ls [--author V] [--type V] [--symbol V] [--tags V] [--from V]
 *   [--to V] [-l|--limit N] [--json]; lore show ID [--json].
 * The CLI's one-time notice prints on these verbs (stderr) and writes nothing; lore list/show read legacy entries
 * without migrating them (7.15.2). NOT: index (writes probe-index.json), `task ls --board` / `--project` (another
 * root), and every other verb.
 */
const paradigmRule: Rule = (args, env, name) => {
  anchoredOnly(env, name);
  staticOnly(args, name);
  needCwd(env, name);
  if (!rootForms(env).some((r) => env.fold(r) === env.fold(env.cwd!))) no('paradigm: only with the cwd at a session root');
  if (!env.native) no('paradigm: a foreign path flavour');
  const [sub, ...rest] = args.map((a) => a.lit!);
  if ((sub === 'status' || sub === 'st') && rest.length === 0) return;
  if (sub === 'doctor') {
    if (verbArgs(rest, 'paradigm doctor', ['--context', '--explain']).length === 0) return;
    no('paradigm doctor: an operand');
  }
  if (sub === 'ripple') {
    const ops = verbArgs(rest, 'paradigm ripple', ['--json', '-q', '--quiet'], ['-d', '--depth'], /^\d{1,3}$/);
    if (ops.length < 1 || ops.length > 2) no('paradigm ripple: SYMBOL [PATH]');
    if (ops[1] !== undefined) checkPath(ops[1], env);
    return;
  }
  if (sub === 'purpose' && rest[0] === 'validate') {
    const ops = verbArgs(rest.slice(1), 'paradigm purpose validate', []);
    if (ops.length > 1) no('paradigm purpose validate: at most one PATH');
    if (ops[0] !== undefined) checkPath(ops[0], env);
    return;
  }
  if (sub === 'task' && rest[0] === 'ls') {
    const ops = verbArgs(rest.slice(1), 'paradigm task ls', ['--json', '--mine'], ['-p', '--priority', '-t', '--tag', '-n', '--limit']);
    if (ops.length > 1 || (ops[0] !== undefined && !TASK_LS_STATUS.has(ops[0]))) no('paradigm task ls: a status of active|open|done|shelved|all');
    return;
  }
  if (sub === 'task' && rest[0] === 'show') {
    const ops = verbArgs(rest.slice(1), 'paradigm task show', ['--json']);
    if (ops.length !== 1) no('paradigm task show: one REF');
    // The CLI joins a dated id into a file path: a separator could reach a .yaml outside the roots.
    if (/[/\\]/.test(ops[0]!)) no('paradigm task show: a path separator in REF');
    return;
  }
  if (sub === 'lore' && (rest[0] === 'list' || rest[0] === 'ls')) {
    const ops = verbArgs(rest.slice(1), 'paradigm lore list', ['--json'], ['--author', '--type', '--symbol', '--tags', '--from', '--to', '-l', '--limit']);
    if (ops.length === 0) return;
    no('paradigm lore list: an operand');
  }
  if (sub === 'lore' && rest[0] === 'show') {
    const ops = verbArgs(rest.slice(1), 'paradigm lore show', ['--json']);
    if (ops.length !== 1) no('paradigm lore show: one ID');
    // The CLI joins a dated id into a file path: only a plain lore id (no separator, no dot).
    if (!LORE_ID.test(ops[0]!)) no('paradigm lore show: an ID of L- and letters, digits, - or _');
    return;
  }
  no(`paradigm: ${sub === undefined ? 'no verb' : `verb ${[sub, ...rest.slice(0, 1)].join(' ')}`} is not a read verb`);
};

const GNOMON_MOD_NAME = /^[a-z][a-z0-9-]{0,63}$/;
/**
 * `gnomon` (default home only: a `<home>` operand or `--home` is a card): desk stats [--json]; daemon status;
 * mod list; mod status [NAME]; rules list [--json]; trace status; replay [--json] [--expect sha256:HEX].
 * Each reads the Gnomon home and prints counts, names, hashes or state, never a key or a log row's content (bare
 * `gnomon trace` prints prompt text: not here). NOT: every other verb (mod install/link/pause/start/uninstall/config,
 * rules revoke, trace on/off, daemon start/stop, mode, identity, up, setup, …).
 */
const gnomonRule: Rule = (args, env, name) => {
  anchoredOnly(env, name);
  staticOnly(args, name);
  const [sub, ...rest] = args.map((a) => a.lit!);
  const is = (...want: string[]): boolean => rest.length === want.length && want.every((w, i) => rest[i] === w);
  if (sub === 'desk' && (is('stats') || is('stats', '--json'))) return;
  if (sub === 'daemon' && is('status')) return;
  if (sub === 'mod' && (is('list') || is('status') || (rest.length === 2 && rest[0] === 'status' && GNOMON_MOD_NAME.test(rest[1]!)))) return;
  if (sub === 'rules' && (is('list') || is('list', '--json'))) return;
  if (sub === 'trace' && is('status')) return;
  if (sub === 'replay') {
    if (verbArgs(rest, 'gnomon replay', ['--json'], ['--expect'], /^sha256:[0-9a-f]{64}$/).length === 0) return;
    no('gnomon replay: a home operand');
  }
  no(`gnomon: ${sub === undefined ? 'no verb' : `verb ${[sub, ...rest.slice(0, 1)].join(' ')}`} is not a read verb`);
};

export const COMMANDS: Readonly<Record<string, Rule>> = Object.freeze({
  cat: reader(), head: reader(), tail: reader(), cut: reader(), cmp: reader(), realpath: reader(), df: reader(),
  wc: reader('', ['--files0-from']),
  ls: reader('LR', ['--dereference', '--recursive'], true),
  grep: grepRule(), egrep: grepRule(), fgrep: grepRule(),
  rg: rgRule, fd: fdRule, tree: treeRule, paradigm: paradigmRule, gnomon: gnomonRule,
  stat: reader('L', ['--dereference']),
  du: reader('L', ['--dereference', '--files0-from'], true, 'X'),
  diff: diffRule,
  echo: echoRule, printf: printfRule,
  basename: textRule({ short: 'az', shortValue: 's', long: ['--multiple', '--zero'], longValue: ['--suffix'] }),
  dirname: textRule({ short: 'z', long: ['--zero'] }),
  tr: textRule({ short: 'cdsCu' }),
  which: textRule({ short: 'as' }),
  pwd: textRule({ short: 'LP' }, 0),
  true: textRule({ short: '' }, Infinity), false: textRule({ short: '' }, Infinity),
  test: testRule, '[': testRule,
  sort: sortRule, uniq: uniqRule, file: fileRule, date: dateRule, jq: jqRule, find: findRule, awk: awkRule, sed: sedRule, git: gitRule,
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

/* ── K1: the anchored command ─────────────────────────────────────────────── */

/** The shell Claude Code runs Bash in, from the session env's SHELL: zsh, bash, or unknown (then a form for either). */
export type ShellFlavour = 'zsh' | 'bash' | 'unknown';
export function shellFlavour(shell: string | undefined): ShellFlavour {
  const b = (shell ?? '').split(/[\\/]/).pop() ?? '';
  return b === 'zsh' ? 'zsh' : b === 'bash' ? 'bash' : 'unknown';
}

/** A single-quoted shell word (`'` as `'\\''`). */
export const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * K1 (TD-2026-10-20-086): the command as the kernel lets it run after a read-only pass — in `root` (the realpath the
 * classifier assumed as ctx.cwd), with CDPATH unset (so a relative cd means the directory the classifier checked)
 * and RIPGREP_CONFIG_PATH and GREP_OPTIONS unset (RW: an rg config file may add any flag, --pre included; Aegis
 * L1: an older GNU grep reads extra flags, -R included, from GREP_OPTIONS),
 * the original text inside a brace group on its own lines (a heredoc's delimiter line and a trailing `# comment`
 * end before the closing `}`). zsh: `cd -q` (no chpwd hooks), then chpwd/cd functions removed, chpwd_functions
 * emptied and IGNORE_BRACES off (Aegis M2, L1); bash: no -q, a `cd` function removed, `set -B`; unknown: picked at
 * run time by ZSH_VERSION. `builtin` skips a function named cd/unset/set. If any step fails nothing runs.
 */
/**
 * Aegis H1 (a): command-scope git config (GIT_CONFIG_COUNT/KEY_n/VALUE_n outrank the repo's config) that turns off
 * the programs a read can start, plus GIT_NO_LAZY_FETCH (M1: a partial clone never fetches) and GIT_PAGER=cat.
 * Keys git cannot neutralize by value (diff.external, diff.*.textconv/command, filter.*) are refused by
 * repoGitExecKey instead.
 */
export const ANCHOR_GIT_CONFIG: ReadonlyArray<readonly [string, string]> = Object.freeze([
  ['core.fsmonitor', 'false'],
  ['core.pager', 'cat'],
  ['core.hooksPath', '/dev/null'],
  ['core.sshCommand', 'false'],
  ['log.showSignature', 'false'],
  ['gpg.program', 'false'],
  ['gpg.ssh.program', 'false'],
  ['gpg.x509.program', 'false'],
  ['credential.helper', ''],
] as const);
export function anchorGitEnv(): string {
  const kv = ANCHOR_GIT_CONFIG.flatMap(([k, v], i) => [`GIT_CONFIG_KEY_${i}=${shQuote(k)}`, `GIT_CONFIG_VALUE_${i}=${shQuote(v)}`]);
  return `builtin export GIT_CONFIG_COUNT=${ANCHOR_GIT_CONFIG.length} ${kv.join(' ')} GIT_NO_LAZY_FETCH=1 GIT_PAGER=cat`;
}

export function anchorCommand(command: string, root: string, flavour: ShellFlavour): string {
  const q = shQuote(root);
  // Aegis M2: no user function runs on a later cd in the command (zsh chpwd hooks, a `cd` function such as rvm's);
  // L1: brace expansion is on, as the classifier assumed (zsh IGNORE_BRACES off; bash -B)
  const zsh = `builtin cd -q -- ${q} && { builtin unfunction chpwd cd 2>/dev/null; chpwd_functions=(); builtin setopt no_ignore_braces; }`;
  const bash = `builtin cd -- ${q} && { builtin unset -f cd; builtin set -B; }`;
  const pre = flavour === 'zsh' ? zsh : flavour === 'bash' ? bash : `if [ -n "\${ZSH_VERSION-}" ]; then ${zsh}; else ${bash}; fi`;
  // L1 guard: brace expansion must really be on for this command (zsh may fix IGNORE_BRACES at parse time): else nothing runs
  return `${pre} && builtin set -- x{a,b} && builtin test "$#" -eq 2 && builtin unset CDPATH RIPGREP_CONFIG_PATH GREP_OPTIONS && ${anchorGitEnv()} && {\n${command}\n}`;
}
