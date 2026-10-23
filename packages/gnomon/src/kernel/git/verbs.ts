/**
 * @symbol #git-verbs
 *
 * #git-verbs (T-2026-10-23-002; spec §6.6) — the PURE half of the kernel-run git verbs: what the kernel reads, checks
 * and shows before it runs `git init`, `git push` or `gh repo create` OUTSIDE the session sandbox.
 *
 * Why the kernel runs them: the session profile denies writes to `.git/config`, `.git/hooks` and `.git/info`
 * (a hook or config the agent wrote would later run unsandboxed under the human's own git), and a session has no
 * keychain or credential access. So a session asks; the kernel checks, shows a card when the verb needs one, and runs
 * the verb with a config and an argv it composed itself.
 *
 *   initConfigText    the ONE config `git.init` leaves: [core] keys only, nothing executable (no hooksPath,
 *                     fsmonitor, sshCommand, credential helper, filters, include or includeIf), branch main.
 *   initRefusal       the folder must be a session root, not the home folder, a system folder or the Gnomon home,
 *                     and neither it nor a folder above it may already be in a repo (`.git` of any kind). A `.git`
 *                     left by a failed sandboxed `git init` (a real folder with no config, no files beyond
 *                     HEAD/description, no symlink) is a remnant the kernel may clear (dotGitOf 'remnant').
 *   dotGitOf          lstat only, never followed: none | dir | link | file (a gitfile pointer) | remnant.
 *   configProblems    push/create run only on a repo whose `.git/config` holds plain keys (CONFIG_ALLOW): any other
 *                     key (core.hooksPath, core.fsmonitor, core.sshCommand, credential.*, include.*, includeIf.*,
 *                     filter.*, url.*.insteadOf, remote.*.receivepack, remote.*.mirror, extensions.worktreeConfig, …)
 *                     refuses `unsafe-config` with the key named.
 *   parseRemote       https://host[:port]/owner/repo(.git) or ssh (ssh://git@host/… and git@host:owner/repo) only;
 *                     userinfo with a password, file:, ext::, git://, http:, a local path, a leading '-' or a control
 *                     character refuse `bad-remote`. The host is lowercased and shown plainly.
 *   hostWarning       a punycode label (xn--), a non-ASCII host, or a near miss of a well-known forge host
 *                     (edit distance ≤ 2, the forge name inside another domain, a hyphen for the dot) is FLAGGED: the
 *                     card takes the claim-mismatch flag, focuses Deny and offers no Always.
 *   validRepoName / validOwner / validBranch / validRemoteName   the argument rules (argument injection: never a
 *                     leading '-', never '..', never a control character; the kernel also passes `--` before them).
 *   pushCard / createCard / initCard   the kernel-composed card lines and detail; line 1 is the title the GUI shows.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GitVerb } from '@a-company/gnomon-contracts';

/** The kernel's own MCP server name (an SDK server served over the session's stdio control channel). */
export const KERNEL_MCP_SERVER = 'gnomon';
/** The kernel MCP tools and the verb each runs. */
export const GIT_VERB_TOOLS: Readonly<Record<string, GitVerb>> = Object.freeze({ gnomon_git_init: 'git.init', gnomon_git_push: 'git.push', gnomon_repo_create: 'repo.create', gnomon_worktree_add: 'git.worktree.add', gnomon_worktree_remove: 'git.worktree.remove' });
/** Kernel worktrees live at `<root>/<WORKTREES_REL>/<name>` (manifest/policy.ts KERNEL_WORKTREES_REL; the session profile guards them). */
export const WORKTREES_REL = '.gnomon/worktrees';
/** A worktree name: ≤ 64 of letters, digits, '.', '_', '-', never a leading '.' or '-'. */
export function validWorktreeName(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/.test(v);
}

/**
 * The kernel worktrees under a session root that exist now: `<root>/.gnomon/worktrees/<name>` real folders (never a
 * link at `.gnomon`, W or the entry) holding a `.git` pointer FILE. Bounded (64). Used as extra edit roots.
 */
export function kernelWorktreeDirs(root: string): string[] {
  const out: string[] = [];
  const isDir = (p: string): boolean => {
    try {
      const st = fs.lstatSync(p);
      return st.isDirectory() && !st.isSymbolicLink();
    } catch {
      return false;
    }
  };
  const gn = path.join(root, '.gnomon');
  const w = path.join(root, ...WORKTREES_REL.split('/'));
  if (!isDir(gn) || !isDir(w)) return out;
  let names: string[] = [];
  try {
    names = fs.readdirSync(w).sort();
  } catch {
    return out;
  }
  for (const n of names) {
    if (out.length >= 64) break;
    const d = path.join(w, n);
    if (!validWorktreeName(n) || !isDir(d)) continue;
    try {
      if (fs.lstatSync(path.join(d, '.git')).isFile()) out.push(d);
    } catch {
      /* not a worktree */
    }
  }
  return out;
}
/** The fully qualified tool name Claude Code uses for a kernel MCP tool (`mcp__gnomon__<tool>`). */
export const kernelToolName = (tool: string): string => `mcp__${KERNEL_MCP_SERVER}__${tool}`;
/** The default branch a kernel-made repo starts on. */
export const INIT_BRANCH = 'main';
/** The forge hosts a lookalike is measured against (a near miss of one is flagged on the card). */
export const KNOWN_FORGE_HOSTS: readonly string[] = Object.freeze(['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org', 'sr.ht', 'git.sr.ht']);

/** The system prompt line every kernel-verb session carries (the sandbox's own error for plain git init/push stays unchanged). */
export const GIT_VERBS_GUIDANCE = [
  'Gnomon runs git verbs that need to write repo config or use the human\'s credentials for you: the sandbox refuses `git init`, `git push` and `gh repo create` in Bash ("Operation not permitted" on .git/config, no credentials).',
  'Use the gnomon MCP tools instead: gnomon_git_init (make this folder a repo), gnomon_git_push (push the current branch; the human approves a card), gnomon_repo_create (create a GitHub repo, private by default, add it as a remote and push).',
  'Worktrees: Claude Code\'s own worktree isolation (EnterWorktree, an Agent with isolation "worktree") and `git worktree add` are refused by the sandbox here. Use gnomon_worktree_add (it returns the worktree\'s absolute path under .gnomon/worktrees; work and point subagents there) and gnomon_worktree_remove when done.',
].join(' ');

/* ── the init config ────────────────────────────────────────────────────── */

/** The [core] keys a kernel-made config may carry (booleans / the format version only; nothing executable). */
export const INIT_CORE_KEYS: readonly string[] = Object.freeze(['repositoryformatversion', 'filemode', 'bare', 'logallrefupdates', 'ignorecase', 'precomposeunicode', 'symlinks']);

/**
 * The config git.init leaves. `probed` is what `git init` itself wrote for the filesystem-probed keys (filemode,
 * ignorecase, precomposeunicode, symlinks): only booleans are kept, only INIT_CORE_KEYS; the rest is fixed.
 */
export function initConfigText(probed: Readonly<Record<string, string>> = {}): string {
  const fixed: Array<[string, string]> = [['repositoryformatversion', '0'], ['filemode', 'true'], ['bare', 'false'], ['logallrefupdates', 'true']];
  const out = new Map<string, string>(fixed);
  for (const k of ['filemode', 'ignorecase', 'precomposeunicode', 'symlinks']) {
    const v = probed[k];
    if (v === 'true' || v === 'false') out.set(k, v);
  }
  return `[core]\n${[...out].map(([k, v]) => `\t${k} = ${v}\n`).join('')}`;
}

/** A tiny, strict reader of a git config file: [section] / [section "sub"] headers and `key = value` lines. */
export function readConfigEntries(text: string): Array<{ key: string; value: string }> | null {
  const out: Array<{ key: string; value: string }> = [];
  let section: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    const h = /^\[([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\]$/.exec(line);
    if (h) {
      section = h[2] !== undefined ? `${h[1]!.toLowerCase()}.${h[2]}` : h[1]!.toLowerCase();
      continue;
    }
    const kv = /^([A-Za-z][A-Za-z0-9-]*)\s*(?:=\s*(.*))?$/.exec(line);
    if (!kv || section === null) return null; // anything this reader cannot place is refused (fail closed)
    out.push({ key: `${section}.${kv[1]!.toLowerCase()}`, value: (kv[2] ?? 'true').trim() });
  }
  return out;
}

/* ── folders ────────────────────────────────────────────────────────────── */

export type DotGit = 'none' | 'dir' | 'link' | 'file' | 'remnant';

/** Files a failed sandboxed `git init` may leave in `.git` (beyond empty folders); anything else is a real repo. */
const REMNANT_FILES = new Set(['HEAD', 'description']);
const REMNANT_FILE_MAX = 1024;

/** What `<dir>/.git` is, by lstat only (never followed). */
export function dotGitOf(dir: string): DotGit {
  const p = path.join(dir, '.git');
  let st: fs.Stats;
  try {
    st = fs.lstatSync(p);
  } catch {
    return 'none';
  }
  if (st.isSymbolicLink()) return 'link';
  if (!st.isDirectory()) return 'file';
  return isRemnant(p) ? 'remnant' : 'dir';
}

/** A `.git` folder with no config and nothing but empty folders, HEAD and description (small regular files), no links. */
function isRemnant(gitDir: string): boolean {
  if (fs.existsSync(path.join(gitDir, 'config'))) return false;
  let seen = 0;
  const walk = (d: string, depth: number): boolean => {
    if (depth > 6) return false;
    let names: string[];
    try {
      names = fs.readdirSync(d);
    } catch {
      return false;
    }
    for (const n of names) {
      if (++seen > 256) return false;
      const p = path.join(d, n);
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) return false;
      if (st.isDirectory()) {
        if (!walk(p, depth + 1)) return false;
      } else if (!st.isFile() || d !== gitDir || !REMNANT_FILES.has(n) || st.size > REMNANT_FILE_MAX) return false;
    }
    return true;
  };
  return walk(gitDir, 0);
}

/** The nearest folder at or above `dir` holding a `.git` entry of any kind (a remnant at `dir` itself excepted), or null. */
export function repoAbove(dir: string): string | null {
  let d = path.resolve(dir);
  for (let i = 0; i < 256; i++) {
    const g = dotGitOf(d);
    if (g !== 'none' && !(g === 'remnant' && d === path.resolve(dir))) return d;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
  return null;
}

const SYSTEM_DIRS_POSIX: readonly string[] = Object.freeze(['/', '/System', '/Library', '/Applications', '/bin', '/sbin', '/usr', '/etc', '/opt', '/dev', '/cores', '/Volumes', '/private', '/private/etc', '/private/var', '/var', '/tmp', '/private/tmp', '/Users', '/home', '/root']);
/** System trees refused at any depth (the folder or anything inside them). */
const SYSTEM_TREES_POSIX: readonly string[] = Object.freeze(['/System', '/Library', '/bin', '/sbin', '/usr', '/etc', '/private/etc', '/dev', '/Applications', '/opt/homebrew', '/private/var/db']);

const inside = (p: string, root: string): boolean => p === root || p.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`);

export interface FolderContext {
  /** the session roots (cwd, worktree), realpath'd */
  roots: readonly string[];
  userHome: string;
  /** the Gnomon home */
  gnomonHome: string;
}

/** Why `target` may not become a repo (protected-folder / not-a-root / in-repo), or null. */
export function initRefusal(target: string, ctx: FolderContext): { why: 'not-a-root' | 'protected-folder' | 'in-repo' | 'dotgit-link'; detail: string } | null {
  const t = path.resolve(target);
  if (!ctx.roots.map((r) => path.resolve(r)).includes(t)) return { why: 'not-a-root', detail: `${t} is not this session's folder` };
  const home = path.resolve(ctx.userHome);
  if (t === home) return { why: 'protected-folder', detail: 'the home folder never becomes a repo' };
  if (inside(t, path.resolve(ctx.gnomonHome))) return { why: 'protected-folder', detail: 'the Gnomon home never becomes a repo' };
  if (SYSTEM_DIRS_POSIX.includes(t) || SYSTEM_TREES_POSIX.some((r) => inside(t, r))) return { why: 'protected-folder', detail: `${t} is a system folder` };
  if (/^[A-Za-z]:\\(Windows|Program Files( \(x86\))?|ProgramData)(\\|$)/i.test(t) || /^[A-Za-z]:\\?$/.test(t)) return { why: 'protected-folder', detail: `${t} is a system folder` };
  const own = dotGitOf(t);
  if (own === 'link' || own === 'file') return { why: 'dotgit-link', detail: `${t}/.git is ${own === 'link' ? 'a symlink' : 'a gitfile pointer'}` };
  if (own === 'dir') return { why: 'in-repo', detail: `${t} is already a repo` };
  const above = repoAbove(path.dirname(t) === t ? t : path.dirname(t));
  if (above) return { why: 'in-repo', detail: `${t} is inside the repo at ${above}` };
  return null;
}

/* ── repo config allowlist (push / create) ─────────────────────────────── */

/** Plain keys a repo config may carry for the kernel to push from it (lowercased; <x> is any subsection). */
export const CONFIG_ALLOW: readonly RegExp[] = Object.freeze([
  /^core\.(repositoryformatversion|filemode|bare|logallrefupdates|ignorecase|precomposeunicode|symlinks|autocrlf|eol|safecrlf|quotepath|trustctime|checkstat)$/,
  /^remote\.[^\n]+\.(url|pushurl|fetch|tagopt|prune)$/,
  /^branch\.[^\n]+\.(remote|merge|rebase|pushremote|description)$/,
  /^user\.(name|email)$/,
  /^init\.defaultbranch$/,
  /^pull\.(rebase|ff)$/,
  /^push\.(default|autosetupremote)$/,
  /^fetch\.prune$/,
  /^extensions\.objectformat$/,
]);

/** The keys of a repo config outside CONFIG_ALLOW (names only), or ['<unreadable>'] when it cannot be read strictly. */
export function configProblems(text: string): string[] {
  const entries = readConfigEntries(text);
  if (!entries) return ['<unreadable>'];
  return [...new Set(entries.map((e) => e.key).filter((k) => !CONFIG_ALLOW.some((re) => re.test(k.toLowerCase()))))];
}

/* ── arguments ──────────────────────────────────────────────────────────── */

const CTRL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** A GitHub repo name: letters, digits, '.', '_', '-'; no leading '-' or '.', not '.'/'..', no '.git' tail, ≤ 100. */
export function validRepoName(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/.test(v) && !/\.git$/i.test(v) && v !== '.' && v !== '..';
}

/** A GitHub owner (user or org): alphanumerics and single inner hyphens, ≤ 39. */
export function validOwner(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(v);
}

/** A remote name: ≤ 64 of letters, digits, '.', '_', '-', never a leading '-' or '.'. */
export function validRemoteName(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/.test(v);
}

/**
 * A branch name the kernel will push (stricter than git check-ref-format --branch): ≤ 200 of letters, digits and
 * `._/-`, never a leading '-' or '/', never '..', '//', '@{', a trailing '/', '.' or '.lock', no control character.
 */
export function validBranch(v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 200 || CTRL.test(v)) return false;
  if (!/^[A-Za-z0-9_][A-Za-z0-9._/-]*$/.test(v)) return false;
  if (v.includes('..') || v.includes('//') || v.includes('@{') || v.endsWith('/') || v.endsWith('.') || /\.lock(\/|$)/.test(v) || v.split('/').some((c) => c.startsWith('.'))) return false;
  return v !== 'HEAD';
}

/* ── remotes ────────────────────────────────────────────────────────────── */

export interface RemoteInfo {
  scheme: 'https' | 'ssh';
  host: string;
  port: number | null;
  owner: string;
  repo: string;
  /** the URL as git resolved it (userinfo with a password refused; never redacted further) */
  url: string;
  /** host/owner/repo, the plain name shown on the card and the Always rule */
  slug: string;
}

const HOST_CHARS = /^[A-Za-z0-9.-]{1,253}$/;

function ownerRepo(p: string): { owner: string; repo: string } | null {
  const parts = p.replace(/^\/+/, '').replace(/\/+$/, '').split('/');
  if (parts.length !== 2) return null;
  const [owner, rawRepo] = parts as [string, string];
  const repo = rawRepo.replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || owner.startsWith('-') || owner.startsWith('.')) return null;
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(repo) || repo.startsWith('-') || repo === '.' || repo === '..') return null;
  return { owner, repo };
}

/** The remote URL git resolved, parsed — or why it is refused (bad-remote). */
export function parseRemote(url: string): RemoteInfo | { error: string } {
  const u = url.trim();
  if (u.length === 0 || u.length > 2048 || CTRL.test(u) || /\s/.test(u)) return { error: 'the remote URL is empty, too long or has a control or space character' };
  if (u.startsWith('-')) return { error: 'the remote URL starts with "-"' };
  if (/^ext::/i.test(u) || /^[a-z][a-z0-9+.-]*::/i.test(u)) return { error: 'a remote helper URL (<transport>::) runs a program: never pushed to' };
  const scp = /^([A-Za-z0-9._-]+)@([^:/]+):(?!\/)(.+)$/.exec(u);
  if (scp) {
    const host = scp[2]!.toLowerCase();
    if (!HOST_CHARS.test(scp[2]!) && !/[^\x00-\x7f]/.test(scp[2]!)) return { error: 'the remote host is not a plain host name' };
    const or = ownerRepo(scp[3]!);
    if (!or) return { error: 'the remote path is not <owner>/<repo>' };
    return { scheme: 'ssh', host, port: null, ...or, url: u, slug: `${host}/${or.owner}/${or.repo}` };
  }
  let p: URL;
  try {
    p = new URL(u);
  } catch {
    return { error: 'the remote is not a URL git can push to over https or ssh (a local path or an unknown form)' };
  }
  if (p.protocol !== 'https:' && p.protocol !== 'ssh:') return { error: `the remote uses ${p.protocol.replace(/:$/, '')}: only https and ssh are pushed to` };
  if (p.password) return { error: 'the remote URL carries a password: remove it (git keeps it in plain text)' };
  if (p.protocol === 'https:' && p.username) return { error: 'the remote URL carries a user name: remove it, the credential helper supplies it' };
  if (p.search || p.hash) return { error: 'the remote URL has a query or a fragment' };
  const rawHost = u.replace(/^[a-z]+:\/\/(?:[^@/]*@)?/i, '').split(/[/:]/)[0] ?? '';
  const host = (/[^\x00-\x7f]/.test(rawHost) ? rawHost : p.hostname).toLowerCase();
  if (host === '' || (!HOST_CHARS.test(host) && !/[^\x00-\x7f]/.test(host))) return { error: 'the remote host is not a plain host name' };
  const or = ownerRepo(decodeURIComponent(p.pathname));
  if (!or) return { error: 'the remote path is not <owner>/<repo>' };
  return { scheme: p.protocol === 'https:' ? 'https' : 'ssh', host, port: p.port ? Number(p.port) : null, ...or, url: u, slug: `${host}/${or.owner}/${or.repo}` };
}

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}

/** Why the host must be flagged on the card (punycode, non-ASCII, a near miss of a forge host), or null. */
export function hostWarning(host: string): string | null {
  const h = host.toLowerCase();
  if (/[^\x00-\x7f]/.test(h)) return `the host ${h} has non-ASCII characters (it can imitate another host)`;
  if (h.split('.').some((l) => l.startsWith('xn--'))) return `the host ${h} is punycode (xn--): it can imitate another host`;
  if (KNOWN_FORGE_HOSTS.some((k) => h === k || h.endsWith(`.${k}`))) return null;
  // Aegis L1: a forge's name as a whole label of another domain (github.evil.io, a.gitlab.example) is flagged too
  for (const k of KNOWN_FORGE_HOSTS) {
    const name = k.split('.')[0]!;
    if (name.length >= 6 && h.split('.').includes(name)) return `the host ${h} uses the name ${name} but is not ${k}`;
  }
  for (const k of KNOWN_FORGE_HOSTS) {
    const name = k.split('.')[0]!;
    if (editDistance(h, k) <= 2) return `the host ${h} looks like ${k} but is a different host`;
    if (`.${h.replace(/-/g, '.')}.`.includes(`.${k}.`) || h.startsWith(`${k}.`) || h.startsWith(`${k}-`) || (name.length >= 6 && h.split('.').some((l) => l !== name && editDistance(l, name) <= 1))) return `the host ${h} looks like ${k} but is a different host`;
  }
  return null;
}

/* ── cards ──────────────────────────────────────────────────────────────── */

export interface PushPlan {
  root: string;
  branch: string;
  remote: string;
  remoteInfo: RemoteInfo;
  force: boolean;
  /** set ⇒ the card is flagged claim-mismatch and offers no Always */
  warning: string | null;
  /** L3: a force push's explicit lease — the remote branch must still be at this sha (the last fetched), or absent (null) */
  lease?: string | null;
  /** M5: what the kernel's secret scan found in the pushed commits ({file, kinds}); any ⇒ a card even with an Always rule */
  secrets?: ReadonlyArray<{ file: string; kinds: readonly string[] }>;
  /** M5: the pushed diff was larger than the scan reads (the card says so) */
  scanIncomplete?: boolean;
}

/** Mika (Rules view): how a learned push rule reads, from its kernel-held input (the slug stays on the rule). */
export function pushRuleWords(input: unknown): string | null {
  const o = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : null;
  if (!o || o.verb !== 'git.push' || typeof o.host !== 'string' || typeof o.owner !== 'string' || typeof o.repo !== 'string') return null;
  return `pushes to ${o.host}/${o.owner}/${o.repo} from this repo (any branch, never a force push)`;
}

/** The input an Always rule is keyed by: the exact remote URL and host (and, through repoKey, this repo). Never the branch. */
export function pushRuleInput(r: RemoteInfo): Record<string, unknown> {
  return { verb: 'git.push', host: r.host, owner: r.owner, repo: r.repo, slug: r.slug, url: r.url };
}

export interface VerbCard {
  lines: string[];
  detail: Record<string, unknown>;
  /** the decisions the card offers */
  decisions: readonly ('allow' | 'deny' | 'always')[];
  flags: ('claim-mismatch' | 'irreversible')[];
}

export function pushCard(p: PushPlan): VerbCard {
  const r = p.remoteInfo;
  const lines = [
    ...(p.warning ? [`Warning: ${p.warning}. Deny unless you meant this host.`] : []),
    `Push ${p.branch} to ${r.slug}`,
    `url: ${r.url}`,
    `host: ${r.host}${r.port ? ` port ${r.port}` : ''}`,
    `remote: ${p.remote} → ${r.url} (the push URL git resolves for it: this repo's .git/config under Gnomon's own credential-only global config)`,
    `branch: ${p.branch} (refs/heads/${p.branch} → refs/heads/${p.branch})`,
    `repo: ${p.root}`,
    ...(p.secrets?.length ? [`Warning: the pushed commits add text that looks like a secret (${p.secrets.length} file${p.secrets.length === 1 ? '' : 's'}):`, ...p.secrets.slice(0, 12).map((x) => `  secret: ${x.file} (${x.kinds.join(', ')})`)] : []),
    ...(p.scanIncomplete ? ['Warning: the pushed diff is larger than Gnomon scans for secrets; only its start was scanned.'] : []),
    ...(p.force ? ['Warning: FORCE push: it can overwrite commits on the remote that your branch does not have.', p.lease ? `lease: only if the remote ${p.branch} is still at ${p.lease.slice(0, 12)} (your last fetch); else nothing is pushed` : `lease: only if the remote has no ${p.branch} yet (nothing fetched); else nothing is pushed`] : []),
    `Runs with your own git credentials, outside the session sandbox. Never tags, never a mirror${p.force ? '' : ', never a force push'}.`,
    ...(!p.force && !p.warning && !p.secrets?.length ? [`always: pushes to ${r.slug} from this repo with no card next time (any branch, never a force push).`] : []),
  ];
  const detail = { verb: 'git.push', tool: 'gnomon_git_push', host: r.host, owner: r.owner, repo: r.repo, slug: r.slug, url: r.url, remote: p.remote, branch: p.branch, force: p.force, root: p.root, ...(p.warning ? { hostWarning: p.warning } : {}), ...(p.force ? { lease: p.lease ?? null } : {}), ...(p.secrets?.length ? { secrets: p.secrets.map((x) => ({ file: x.file, kinds: [...x.kinds] })) } : {}) };
  const flags: VerbCard['flags'] = [...(p.warning ? (['claim-mismatch'] as const) : []), ...(p.force ? (['irreversible'] as const) : [])];
  return { lines, detail, decisions: p.force || p.warning || p.secrets?.length || p.scanIncomplete ? ['allow', 'deny'] : ['allow', 'deny', 'always'], flags };
}

export interface CreatePlan {
  root: string;
  owner: string;
  name: string;
  visibility: 'private' | 'public';
  remote: string;
  branch: string;
  url: string;
  host: string;
}

export function createCard(p: CreatePlan): VerbCard {
  const slug = `${p.host}/${p.owner}/${p.name}`;
  const lines = [
    `Create ${slug} (${p.visibility}), then push ${p.branch} to it`,
    `host: ${p.host}`,
    `visibility: ${p.visibility} (${p.visibility === 'public' ? 'anyone can see this repo and its history' : 'only you and people you add can see it'})`,
    `remote: ${p.remote} → ${p.url} (added by Gnomon)`,
    `branch: ${p.branch} (refs/heads/${p.branch} → refs/heads/${p.branch}, tracked)`,
    `repo: ${p.root}`,
    'Runs gh with your own GitHub sign-in and git with your own credentials, outside the session sandbox. Never tags, never a mirror, never a force push.',
  ];
  return { lines, detail: { verb: 'repo.create', tool: 'gnomon_repo_create', host: p.host, owner: p.owner, repo: p.name, slug, url: p.url, remote: p.remote, branch: p.branch, visibility: p.visibility, root: p.root }, decisions: ['allow', 'deny'], flags: p.visibility === 'public' ? ['irreversible'] : [] };
}

/** Aegis M1: a path that steers Claude Code in a checkout (any case): any `.claude` component, a CLAUDE*.md file, `.mcp.json`. */
export function isSteeringPath(p: string): boolean {
  const parts = p.split('/').map((x) => x.toLowerCase());
  const last = parts.at(-1) ?? '';
  return parts.slice(0, -1).includes('.claude') || last === '.claude' || /^claude[^/]*\.md$/.test(last) || last === '.mcp.json';
}

export function worktreeCard(p: { root: string; name: string; dir: string; branch: string; base: string; remove: boolean; force: boolean; steeringDiff?: readonly string[] }): VerbCard {
  const lines = p.remove
    ? [
        `Remove the worktree ${p.name}`,
        `worktree: ${p.dir}`,
        `repo: ${p.root}`,
        ...(p.force ? ['Warning: FORCE remove: uncommitted changes in this worktree are lost.'] : ['Refused by git if the worktree has uncommitted changes. Its branch stays.']),
        'Runs git worktree remove outside the session sandbox.',
      ]
    : [
        `Make a worktree ${p.name} on a new branch ${p.branch}`,
        `worktree: ${p.dir}`,
        `branch: ${p.branch} from ${p.base}`,
        `repo: ${p.root}`,
        ...(p.steeringDiff?.length ? [`Warning: ${p.base} checks out ${p.steeringDiff.length} steering file(s) that differ from this checkout (Claude reads them in the worktree):`, ...p.steeringDiff.slice(0, 12).map((f) => `  steering: ${f}`), ...(p.steeringDiff.length > 12 ? [`  … and ${p.steeringDiff.length - 12} more`] : [])] : []),
        'Runs git worktree add outside the session sandbox (no hooks). The session can edit its files; its CLAUDE.md, .claude, .mcp.json and .git pointer stay as checked out.',
      ];
  return { lines, detail: { verb: p.remove ? 'git.worktree.remove' : 'git.worktree.add', tool: p.remove ? 'gnomon_worktree_remove' : 'gnomon_worktree_add', root: p.root, name: p.name, dir: p.dir, branch: p.branch, base: p.base, force: p.force, ...(p.steeringDiff?.length ? { steeringDiff: [...p.steeringDiff] } : {}) }, decisions: ['allow', 'deny'], flags: p.force ? ['irreversible'] : [] };
}

export function initCard(root: string, remnant: boolean): VerbCard {
  const lines = [
    `Make a git repo in ${root}`,
    `repo: ${root}`,
    `branch: ${INIT_BRANCH}; a minimal config (no hooks, no helpers, no includes) and an empty hooks folder`,
    ...(remnant ? ['An incomplete .git left by a failed git init is removed first (no config, no commits in it).'] : []),
    'Runs git init outside the session sandbox.',
  ];
  return { lines, detail: { verb: 'git.init', tool: 'gnomon_git_init', root, branch: INIT_BRANCH, remnant }, decisions: ['allow', 'deny'], flags: [] };
}
