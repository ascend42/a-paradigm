/**
 * @symbol #manifest-loader
 *
 * #manifest-loader per-session policy (spec §3.6, §6.1 step 6, §15.5 `session`
 * profile, §16 "Session denies"; D55, S16-1, S22-H2, P8-D79/D80).
 *
 * This module produces the platform-NEUTRAL policy DATA the `session` sandbox
 * profile is generated from. Generating the profile itself (SBPL on macOS, the
 * restricted token + ACEs + the S29-08 WFP mechanism on Windows) and spawning
 * under it is M1.7 (#session-runner / #supervisor); M1.7 consumes
 * `SessionPolicy` as its input and re-runs p10m against the generated profile.
 *
 * Every M1.5 deny is here, on EVERY mode:
 *   - home reads (M1.7 slice 2, T-2026-10-18-010): the WHOLE Gnomon home is
 *     read-denied — keys/ (device key, keystore files), the kernel log
 *     (`kernel.db*`, `log/**`, also denied by name), every other session's
 *     dir, the claude pin, generated plugins. `allowRead` carves back only
 *     `homeReadable` (the session's own dir, the exec'd `<home>/bin` copy,
 *     the pinned runner copy; each strictly inside HOME_READABLE_ROOTS, else
 *     the policy refuses), `allowReadMetadata` the literal ancestors realpath
 *     lstat's, and `denyReadAlways` re-denies keys + the kernel log after the
 *     allows;
 *   - keys (read + write): `<home>/keys/**` (link key pins included),
 *     `<home>/warpline/**`, `<home>/link/**`, `<home>/head`, and the Warpline
 *     token files of the cwd and the worktree (`.warpline/keys/**`,
 *     `.warpline/daemon-tokens.jsonl`, `.warpline/daemon/mcp-tokens.json`,
 *     `.warpline/daemon/mcp.token`), plus the browser-profile and wrapper
 *     WebView directories the caller's platform names (S29-K7);
 *   - settings (write): `<home>/**`, every Claude settings layer — the WHOLE
 *     user `~/.claude/**` (subpath; Aegis F2: skills, plugins, agents, commands
 *     and hooks there all steer Claude) and `~/.claude.json` (literal: its
 *     user-scope mcpServers run commands), the managed files, project and
 *     worktree `.claude/**` and `CLAUDE*.md` (prefix), and the same pair for
 *     every memory-chain dir (P8-D97, `memoryDirs`); every input layersHash
 *     reads is covered (test-proved);
 *     (#trace-capture keeps its captures in `<home>/trace/` (TD-2026-10-19-057),
 *     covered by the gnomon-home read and write denies above: no rule of its own,
 *     and nothing in the project tree is denied for it);
 *   - transcripts (write ALLOW, TD-2026-10-19-814 item 1, probe p-resume
 *     darwin): `<userClaudeDir>/projects/**` is carved back out of the
 *     `~/.claude` write deny for a Claude session (`claudeTranscripts`), so
 *     Claude Code saves transcripts and `--resume` works; the rest of
 *     `~/.claude` and `~/.claude.json` stay denied, any other deny inside the
 *     carve-back is re-denied after it (`denyWriteAlways`), and the allow is
 *     withheld (`allowWriteRefused`) if the dir links elsewhere;
 *   - session-env (write ALLOW, same pattern, Aegis H1/M1): ONLY this
 *     session's `<userClaudeDir>/session-env/<uuid>/**` (`claudeSessionEnv` =
 *     the backend session uuid, strict format). Claude Code mkdirs
 *     `session-env/<session-id>` before running any command hook; denied,
 *     every SessionStart/Stop/... hook failed with EPERM. Never the whole
 *     `session-env`: another session's CLAUDE_ENV_FILE there is sourced as
 *     shell by that session (the user's unsandboxed Claude Code included).
 *     `session-env` and `session-env/<uuid>` are literal re-denied (neither can
 *     be removed or swapped for a link); siblings stay under the `~/.claude`
 *     deny; withheld (`sessionEnvRefused`) if either links elsewhere;
 *   - git (write, Aegis F9; a spec amendment to §15.5): `.git/hooks/**`,
 *     `.git/config`, `.git/info/**` of the cwd and worktree (and the common
 *     git dir of a linked worktree) — the gitHash inputs;
 *   - linked mod folders (write), the list regenerated at each spawn;
 *   - the web endpoint's port (outbound loopback), when the endpoint is up;
 *   - process information on other processes;
 *   - the platform-neutral DENY CLASSES §15.5 names beyond paths (Aegis F9):
 *     terminal-multiplexer sockets (tmux, screen), the helper's IPC service
 *     and the process-table service (sysmond), automation (AppleEvents),
 *     the service manager (launchctl / schtasks), media devices (TCC mic and
 *     camera), launchers. Each class maps to its platform mechanism in
 *     src/platform/session-denies.ts (the platform registry); M1.7 realises it.
 * Paths are realpath'd (the longest existing prefix is resolved, the rest
 * appended): SBPL filters match resolved paths, and an unresolved path is a
 * deny that silently does not apply (§15.5 "Paths").
 *
 * `policyHash = sha256(canonicalJson(policy))`, recorded on the session (§3.3).
 * `claudePermissions` is the matching `policy.json` permissions block (§6.1
 * step 6) — Claude Code's own deny rules, defence in depth under the sandbox.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { canonicalJson } from '@a-company/gnomon-contracts';
import { defaultClaudeJson, resolveGitDirs } from './layers.js';

export const SESSION_POLICY_SCHEMA = 'gnomon-session-policy:v1' as const;

/** §15.5 `session` denies that are not file paths (platform-neutral names). */
export const SESSION_DENY_CLASSES = ['unix-socket:tmux', 'unix-socket:screen', 'ipc:helper-service', 'ipc:process-table-service', 'automation:apple-events', 'service-manager', 'media:microphone', 'media:camera', 'launchers', 'process-info:others', 'loopback:endpoint-port'] as const;
export type SessionDenyClass = (typeof SESSION_DENY_CLASSES)[number];

/**
 * `steering` (P8-D97 R1): under `path`, at ANY depth and in ANY letter case, a `CLAUDE*.md` file or anything in a
 * `.claude` dir — the memory and settings Claude Code may load from a subtree. Write-deny only.
 */
/**
 * `dep-steering` (P8-D97 F2): under `path`, inside ANY `node_modules` at any depth, in any case, a `CLAUDE*.md` file or
 * anything in a `.claude` dir — dependency-shipped memory the subtree audit does not walk. Read-deny only.
 */
/**
 * `worktree-guard` (#git-verbs, T-2026-10-23-002): `path` is a kernel worktrees dir W (`<root>/.gnomon/worktrees`).
 * Write-deny of each worktree's own entry `W/<name>` (no create, remove or rename: only the kernel adds or removes a
 * worktree), its `.git` pointer file `W/<name>/.git` and its `W/<name>/.mcp.json` (any case).
 * `worktree-gitdir`: `path` is `<commonDir>/worktrees`. Write-deny of each worktree's private git dir entry and its
 * `commondir`, `gitdir` and `config.worktree` (what tells git where the config lives); HEAD, index and logs stay writable.
 */
/**
 * `dotgit-any` (Aegis round 2 M5): under `path` (a session root), at ANY depth and in any case, an entry named `.git`
 * (a planted nested repo or gitfile the human's git would later read). Only the entry itself: an existing nested repo's
 * contents stay as they were. The kernel worktrees' pointers are below it too (and guarded by worktree-guard).
 */
export type PathMatch = 'subpath' | 'literal' | 'prefix' | 'steering' | 'dep-steering' | 'worktree-guard' | 'worktree-gitdir' | 'dotgit-any';
/** Where the kernel makes a session's worktrees, relative to a session root (#git-verbs git.worktree.add). */
export const KERNEL_WORKTREES_REL = '.gnomon/worktrees';
export interface PolicyPath {
  path: string;
  match: PathMatch;
  /** why the deny exists (the §15.5 class) */
  class: 'keys' | 'kernel-log' | 'warpline-tokens' | 'browser-profile' | 'gnomon-home' | 'settings' | 'linked-folder' | 'git' | 'binary' | 'persistence' | 'transcripts' | 'session-env' | 'worktrees' | 'root' | 'temp' | 'cache';
}

export interface SessionPolicy {
  schemaVersion: typeof SESSION_POLICY_SCHEMA;
  profile: 'session';
  denyRead: PolicyPath[];
  /**
   * M1.7 slice 2 (T-2026-10-18-010): the ONLY reads carved back out of the
   * read-denied Gnomon home — the session's own dir, the binary the kernel
   * execs from `<home>/bin`, the pinned runner copy. Never under keys/,
   * the kernel log, or another session's dir (buildSessionPolicy refuses).
   */
  allowRead: PolicyPath[];
  /** metadata only (lstat, for realpath) on the literal ancestors of allowRead inside the home; no listing, no data */
  allowReadMetadata: PolicyPath[];
  /** re-denied AFTER allowRead (belt and braces: keys + the kernel log stay unreadable whatever is allowed) */
  denyReadAlways: PolicyPath[];
  denyWrite: PolicyPath[];
  /**
   * TD-2026-10-19-814 item 1 (probe p-resume, darwin): writes carved back out of denyWrite, rendered AFTER it (last
   * match wins). Only ever `<userClaudeDir>/projects` (subpath) — Claude Code's transcripts, so `--resume` works —
   * and `<userClaudeDir>/session-env/<uuid>` (subpath) — THIS session's dir Claude Code creates before any command
   * hook runs (never the whole session-env, Aegis H1) — and only for a Claude session (`claudeTranscripts` / `claudeSessionEnv`). Never an input path: no
   * manifest or caller can name one.
   */
  allowWrite: PolicyPath[];
  /**
   * T-2026-10-23-004 (Aegis, the root fix): session file writes are DENY BY DEFAULT. The profile opens with
   * `(deny file-write*)` and allows ONLY these (rendered before denyWrite, so every deny still wins inside them): the
   * session roots (subpath; the kernel worktrees live under them), the session's temp (its TMPDIR's per-user
   * /private/var/folders/<a>/<b> dir, /private/tmp, /private/var/tmp) and the measured tool caches
   * (WRITE_CACHE_PATHS under the user home). The transcript and session-env carve-backs stay allowWrite. A policy
   * object without the field allows nothing but those carve-backs and the device files (fail closed).
   */
  writeAllow?: PolicyPath[];
  /**
   * re-denied AFTER allowWrite so the carve-back reopens nothing else: each allowWrite root itself (literal — it can
   * be neither removed, renamed nor replaced; Aegis M1), the denyWrite entries inside it, and the steering regexes
   * re-rooted at it (Aegis L3)
   */
  denyWriteAlways: PolicyPath[];
  /** why the transcript carve-back was withheld (fail closed: no allow), when `claudeTranscripts` asked for it */
  allowWriteRefused?: string;
  /** why the session-env carve-back was withheld (fail closed: no allow), when `claudeSessionEnv` asked for it */
  sessionEnvRefused?: string;
  /** outbound loopback connects refused to these ports (the web endpoint) */
  denyLoopbackPorts: number[];
  /** process-info on every process but self (process-info*, sysctl process lists, the sysmond lookup on macOS) */
  processInfo: 'deny-others';
  /** launcher escapes (open/osascript/lsregister on macOS; job limits on Windows) — realised by M1.7 */
  launchers: 'deny';
  /** platform-neutral deny classes (SESSION_DENY_CLASSES); mapped per platform in src/platform/session-denies.ts */
  denyClasses: SessionDenyClass[];
  /** the M1.7 step that turns this data into a platform profile */
  realisedBy: 'M1.7';
}

export interface SessionPolicyInput {
  home: string;
  cwd: string;
  worktree?: string;
  userClaudeDir: string;
  managedSettingsPaths: readonly string[];
  linkedFolders: readonly string[];
  /** the web endpoint port, or null when the endpoint is not listening */
  endpointPort: number | null;
  /** platform-specific browser profile + wrapper WebView data dirs (S29-K7) */
  browserProfileDirs?: readonly string[];
  /** `~/.claude.json` (default: beside userClaudeDir) */
  userClaudeJson?: string;
  /**
   * M1.7 (Aegis M2): the user's home — its persistence paths are write-denied
   * (PERSISTENCE_PATHS: LaunchAgents, shell rc files, git config, ~/.ssh).
   */
  userHome?: string;
  /**
   * M1.7 (Aegis H1): extra write denies the supervisor computes, ALREADY
   * resolved (a symlink's own path must stay literal: the claude binary's
   * known-location links, its realpath and its versions dir).
   */
  extraDenyWrite?: readonly PolicyPath[];
  /**
   * M1.8 slice 2 round 3 (Aegis H1, node half): the root-signed local runner. EVERY session profile — Claude
   * and local alike — denies writes to its node binary, node's install prefix (bin/ + lib/libnode) and the
   * pinned runner source dir, so no running session can swap what the next local session execs.
   */
  localRunner?: { node: string; dir: string };
  /**
   * M1.7 slice 2 (T-2026-10-18-010): what the session may READ inside the
   * read-denied Gnomon home. Each entry must sit strictly inside one of
   * HOME_READABLE_ROOTS (`sessions/<short>/…`, `bin/<file>`,
   * `runners/<tree>/…`); anything else refuses the policy (fail closed).
   */
  homeReadable?: ReadonlyArray<{ path: string; match: 'literal' | 'subpath' }>;
  /**
   * P8-D97 (Aegis M1): the memory chain (the cwd and its ancestors up to the git top-level). Each dir's `CLAUDE*`
   * (prefix) and `.claude/**` join the settings write denies, so a session cannot plant steering that a later
   * session loads (`--add-dir` memory, or an ancestor's `.claude`).
   */
  memoryDirs?: readonly string[];
  /**
   * P8-D97 (Aegis R1): the memory subtree root (the git top-level, else the cwd). Every `CLAUDE*.md` and `.claude/**`
   * below it, in any case, joins the settings write denies (`steering` match: an SBPL regex), because Claude Code
   * loads a subdirectory's CLAUDE.md lazily.
   */
  memorySubtree?: string;
  /**
   * P8-D97 (Aegis F3): every in-repo `@` import target the memory audit resolved, existing or not. Each is a
   * settings-class write-deny literal, so a session cannot plant or rewrite what an approved memory file imports.
   */
  memoryImports?: readonly string[];
  /**
   * TD-2026-10-19-814 item 1: a Claude Code session — carve `<userClaudeDir>/projects` (its transcripts) back out of
   * the `~/.claude` write deny. A flag, not a path: the carve-back is derived here and nowhere else, so nothing a
   * project supplies can widen it to another `~/.claude` path. Withheld (allowWriteRefused) when its realpath is not
   * exactly `realpath(userClaudeDir)/projects` or another write deny covers it.
   */
  claudeTranscripts?: boolean;
  /**
   * T-2026-10-21 (hooks fix; Aegis H1/M1 rework): the backend session uuid (`--session-id` / `--resume`) of a Claude
   * Code session — carve ONLY `<userClaudeDir>/session-env/<uuid>` back out of the `~/.claude` write deny. Claude Code
   * creates `session-env/<session-id>/` before it runs ANY command hook; with it denied, every hook fails with
   * `EPERM mkdir`. Not a path: a uuid, checked against a strict lowercase RFC 4122 shape, so it can never name
   * `..`, a separator or a sibling. Writing another session's dir would let this session plant that session's
   * CLAUDE_ENV_FILE, which Claude Code sources as shell before its Bash commands (the user's unsandboxed Claude Code
   * included) — so siblings stay denied. `session-env` and `session-env/<uuid>` are both literal re-denied (neither
   * can be removed, renamed or swapped for a link). Withheld (sessionEnvRefused) on a malformed uuid, when the dir's
   * realpath is not exactly `realpath(userClaudeDir)/session-env/<uuid>`, or another write deny covers it.
   */
  claudeSessionEnv?: string;
  /**
   * #git-verbs (T-2026-10-23-002): the session may work in kernel-made worktrees under `<root>/.gnomon/worktrees/<name>`
   * (git.worktree.add runs outside the sandbox). Ordinary files there stay writable (they are under the root); what
   * steers Claude or git there is write-denied: `<root>/.gnomon` and W as literals (never renamed or removed), each
   * worktree's own entry, `.git` pointer and `.mcp.json` (worktree-guard), every CLAUDE*.md and `.claude/**` below W
   * (steering), and each worktree git dir's entry, commondir, gitdir and config.worktree (worktree-gitdir). The common
   * dir's hooks, config and info stay denied as for any root.
   */
  kernelWorktrees?: boolean;
  /** T-2026-10-23-004 / Aegis round 2 M1: the session's TMPDIR — only its own realpath is writable (a Gnomon-made dir for a Claude session) */
  tmpdir?: string;
  /** Aegis round 2 H: the session's Gnomon-made tool cache dir (SESSION_CACHE_ENV); writable */
  sessionCache?: string;
  /** TEST RIG ONLY (the supervisor passes it only with allowScripts): the fake claude's own dir, where it writes its trace */
  testWriteAllow?: readonly string[];
}

/**
 * T-2026-10-23-004: the tool caches under the user home a session may write (deny-by-default writes). MEASURED, not
 * guessed: what Claude Code and an `npm install` in a root wrote under the profile (test/session-sandbox.test.ts,
 * probes/p10m-write-allow). Anything else under the home stays denied; add one only when measured, narrowly.
 */
export const WRITE_CACHE_PATHS: readonly string[] = Object.freeze([]);
/**
 * Aegis round 2 H (T-2026-10-23-004): a session never writes the human's own tool caches (~/.npm/_npx is run unsandboxed
 * by the human's npx). Each session gets a Gnomon-made cache per repo (SESSION_CACHE_ENV points the tools at it,
 * `sessionCache` is its write allow) and a Gnomon-made 0700 TMPDIR (`tmpdir`), both made by the supervisor.
 */
export const SESSION_CACHE_ENV: Readonly<Record<string, string>> = Object.freeze({ npm_config_cache: 'npm', XDG_CACHE_HOME: 'xdg', PIP_CACHE_DIR: 'pip', GOCACHE: 'go-build', GOMODCACHE: 'go-mod', BUN_INSTALL_CACHE_DIR: 'bun' });
/** Aegis round 2 M6: credential stores a session can neither read nor write (subpath / literal / prefix, under the user home). */
export const CREDENTIAL_READ_DENY: ReadonlyArray<{ rel: string; match: PathMatch }> = Object.freeze([
  { rel: '.ssh', match: 'subpath' },
  { rel: '.aws', match: 'subpath' },
  { rel: '.config/gh', match: 'subpath' },
  { rel: '.netrc', match: 'literal' },
  { rel: '.git-credentials', match: 'literal' },
  { rel: '.docker/config.json', match: 'literal' },
  { rel: '.kube', match: 'subpath' },
  { rel: '.gnupg', match: 'subpath' },
  { rel: '.config/gcloud', match: 'subpath' },
  { rel: '.azure', match: 'subpath' },
  { rel: '.pypirc', match: 'literal' },
  { rel: '.cargo/credentials', match: 'prefix' },
]);
/** T-2026-10-23-004: the shared temp dirs every session may write. */
export const WRITE_TEMP_PATHS: readonly string[] = Object.freeze(['/private/tmp', '/private/var/tmp']);

/** Aegis round 2 M1: the TMPDIR a session may write is exactly its realpath (never the per-user /private/var/folders parent). */
export function userTempRoot(tmpdir: string): string {
  return realpathLoose(tmpdir).replace(/\/+$/, '') || '/';
}

/** The one write carve-back (TD-2026-10-19-814): Claude Code's transcript dir, relative to the user Claude dir. */
export const CLAUDE_TRANSCRIPTS_REL = 'projects';
/** The second write carve-back: Claude Code's per-session hook environment dir, relative to the user Claude dir. */
export const CLAUDE_SESSION_ENV_REL = 'session-env';
/** The only session id shape the session-env carve-back accepts (lowercase RFC 4122, as `randomUUID()` mints). */
export const SESSION_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Does deny `d` cover path `p` (equal, or an ancestor for subpath / a string prefix for prefix)? Regex matches are judged by the caller. */
function covers(d: PolicyPath, p: string): boolean {
  if (d.match === 'literal') return d.path === p;
  if (d.match === 'prefix') return p.startsWith(d.path);
  if (d.match === 'subpath') return p === d.path || p.startsWith(d.path.endsWith(path.sep) ? d.path : d.path + path.sep);
  return false;
}

/** Is `p` at or below `root`? */
function within(p: string, root: string): boolean {
  return p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

/** The only top-level home entries a session may be granted a read under (one level below them, never the root itself). */
export const HOME_READABLE_ROOTS = Object.freeze(['sessions', 'bin', 'runners']);

/** The kernel log files inside the home (spec §3.2; kernel-log.ts ACTIVE_DB + SEGMENTS_DIR): read-denied by name too. */
export const KERNEL_LOG_PATHS: ReadonlyArray<{ rel: string; match: PathMatch }> = Object.freeze([
  { rel: 'kernel.db', match: 'prefix' }, // kernel.db, -wal, -shm, -journal
  { rel: 'log', match: 'subpath' }, // log/segments/**, quarantine
]);

/** The write denies for the local runner's node install and source dir (realpath'd; a prefix that is /, the user home or above it narrows to node's own dir). */
export function localRunnerDenies(r: { node: string; dir: string }, userHome?: string): PolicyPath[] {
  const node = realpathLoose(r.node);
  // POSIX: <prefix>/bin/node, so the prefix (bin/ + lib/) is two up. Windows: node.exe sits at the top of its install
  // dir (Program Files/nodejs/node.exe) beside its DLLs: the prefix is that dir, never Program Files itself (keyed on the
  // layout, a node.exe outside a bin/ dir, not on the platform: a POSIX-layout node under a drive path stays two up)
  const winLayout = path.basename(node).toLowerCase() === 'node.exe' && path.basename(path.dirname(node)).toLowerCase() !== 'bin';
  let prefix = winLayout ? path.dirname(node) : path.dirname(path.dirname(node));
  // Homebrew (Aegis): node loads sibling kegs' dylibs via <prefix>/opt/*/lib (libuv, llhttp, ada-url, simdjson, …),
  // so a Cellar node denies the WHOLE Homebrew prefix — the parent of `Cellar` (/opt/homebrew, /usr/local,
  // /home/linuxbrew/.linuxbrew) — covering Cellar/, opt/ and lib/. Consequence: sessions cannot brew install/upgrade.
  const parts = node.split(path.sep);
  const cellar = parts.lastIndexOf('Cellar');
  if (cellar > 0) prefix = parts.slice(0, cellar).join(path.sep) || path.sep;
  const uh = userHome ? realpathLoose(userHome) : null;
  const above = (a: string, b: string): boolean => a === b || b.startsWith(a.endsWith(path.sep) ? a : a + path.sep);
  if (prefix === path.parse(prefix).root || (uh && above(prefix, uh))) prefix = path.dirname(node);
  return [
    { path: node, match: 'literal', class: 'binary' },
    { path: prefix, match: 'subpath', class: 'binary' },
    { path: realpathLoose(r.dir), match: 'subpath', class: 'binary' },
  ];
}

/** Aegis M2: user persistence paths a session may not write (relative to the user's home). */
export const PERSISTENCE_PATHS: ReadonlyArray<{ rel: string; match: PathMatch }> = Object.freeze([
  { rel: 'Library/LaunchAgents', match: 'subpath' },
  { rel: '.zshrc', match: 'literal' },
  { rel: '.zprofile', match: 'literal' },
  { rel: '.zshenv', match: 'literal' },
  { rel: '.zlogin', match: 'literal' },
  { rel: '.bashrc', match: 'literal' },
  { rel: '.bash_profile', match: 'literal' },
  { rel: '.profile', match: 'literal' },
  { rel: '.bash_login', match: 'literal' },
  { rel: '.zlogout', match: 'literal' },
  { rel: '.config/fish', match: 'subpath' },
  { rel: '.gitconfig', match: 'literal' },
  { rel: '.config/git', match: 'subpath' },
  { rel: '.ssh', match: 'subpath' },
  // Aegis M4 (T-2026-10-23-002): gh's sign-in and config (hosts.yml) — the kernel's repo.create runs gh with them
  { rel: '.config/gh', match: 'subpath' },
  // Aegis M (TD-2026-10-21-077): ~/.local/bin is on every session's PATH ahead of /usr/bin — a planted `ls`/`git`
  // there would run in a later session's auto-passed read-only command with no card
  { rel: '.local/bin', match: 'subpath' },
]);

/** Realpath the longest existing prefix of `p` and append the rest. */
export function realpathLoose(p: string): string {
  const abs = path.resolve(p);
  const rest: string[] = [];
  let cur = abs;
  for (;;) {
    try {
      const real = fs.realpathSync.native(cur);
      return rest.length ? path.join(real, ...rest.reverse()) : real;
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return abs;
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

/** A path whose symlinks cannot be followed to an answer (a loop, too many hops, a component that cannot be lstat'd). */
export class UnresolvablePath extends Error {}

/**
 * Aegis H1 (run modes): the path a WRITE to `p` actually lands on. Unlike realpathLoose, a DANGLING symlink is
 * followed (readlink, textually, as the OS does when it creates the target), so `scripts/x -> ../.git/hooks/pre-commit`
 * resolves to the hook, not to `scripts/x`. Components past the first missing one are appended as text. Throws
 * UnresolvablePath on a loop (more than 40 hops) or on an lstat/readlink failure other than ENOENT/ENOTDIR — the
 * caller treats that as denied/carded, never as a plain name.
 */
export function realpathFollow(p: string): string {
  const abs = path.resolve(p);
  const { root } = path.parse(abs);
  const queue = abs.slice(root.length).split(path.sep).filter((x) => x !== '' && x !== '.');
  let cur = root;
  let hops = 0;
  let missing = false;
  while (queue.length) {
    const seg = queue.shift()!;
    if (seg === '..') {
      cur = path.dirname(cur);
      continue;
    }
    const next = path.join(cur, seg);
    if (missing) {
      cur = next;
      continue;
    }
    let st: fs.Stats;
    try {
      st = fs.lstatSync(next);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        missing = true;
        cur = next;
        continue;
      }
      throw new UnresolvablePath(`cannot lstat ${next}: ${code ?? 'error'}`);
    }
    if (!st.isSymbolicLink()) {
      cur = next;
      continue;
    }
    if (++hops > 40) throw new UnresolvablePath(`too many symlinks at ${next}`);
    let target: string;
    try {
      target = fs.readlinkSync(next);
    } catch (e) {
      throw new UnresolvablePath(`cannot readlink ${next}: ${(e as NodeJS.ErrnoException).code ?? 'error'}`);
    }
    const t = path.parse(target);
    if (t.root) cur = path.resolve(t.root);
    queue.unshift(...target.slice(t.root.length).split(/[\\/]+/).filter((x) => x !== '' && x !== '.'));
  }
  return cur;
}

function uniq(list: PolicyPath[]): PolicyPath[] {
  const seen = new Map<string, PolicyPath>();
  for (const p of list) seen.set(`${p.match}\u0000${p.path}`, p);
  return [...seen.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.match < b.match ? -1 : 1));
}

export function buildSessionPolicy(inp: SessionPolicyInput): SessionPolicy {
  const P = (p: string, match: PathMatch, cls: PolicyPath['class']): PolicyPath => ({ path: realpathLoose(p), match, class: cls });
  const home = inp.home;
  const roots = [inp.cwd, ...(inp.worktree ? [inp.worktree] : [])];
  const keys: PolicyPath[] = [
    P(path.join(home, 'keys'), 'subpath', 'keys'),
    P(path.join(home, 'warpline'), 'subpath', 'keys'),
    P(path.join(home, 'link'), 'subpath', 'keys'),
    P(path.join(home, 'head'), 'literal', 'keys'),
    ...roots.flatMap((r) => [
      P(path.join(r, '.warpline', 'keys'), 'subpath', 'warpline-tokens'),
      P(path.join(r, '.warpline', 'daemon-tokens.jsonl'), 'literal', 'warpline-tokens'),
      P(path.join(r, '.warpline', 'daemon', 'mcp-tokens.json'), 'literal', 'warpline-tokens'),
      P(path.join(r, '.warpline', 'daemon', 'mcp.token'), 'literal', 'warpline-tokens'),
    ]),
  ];
  const browsers = (inp.browserProfileDirs ?? []).map((d) => P(d, 'subpath', 'browser-profile'));
  const settings: PolicyPath[] = [
    P(path.join(home), 'subpath', 'gnomon-home'),
    P(inp.userClaudeDir, 'subpath', 'settings'),
    P(inp.userClaudeJson ?? defaultClaudeJson(inp.userClaudeDir), 'literal', 'settings'),
    ...inp.managedSettingsPaths.map((m) => P(m, 'literal', 'settings')),
    ...[...roots, ...(inp.memoryDirs ?? [])].flatMap((r) => [P(path.join(r, '.claude'), 'subpath', 'settings'), P(path.join(r, 'CLAUDE'), 'prefix', 'settings')]),
    ...(inp.memorySubtree ? [P(inp.memorySubtree, 'steering', 'settings')] : []),
    ...(inp.memoryImports ?? []).map((t) => P(t, 'literal', 'settings')),
  ];
  // T-2026-10-18-010: the WHOLE Gnomon home is read-denied (keys, the kernel log, other sessions, the device key,
  // the pin, generated plugins…); the session's own reads are carved back explicitly and checked here
  const homeReal = realpathLoose(home);
  const kernelLog = KERNEL_LOG_PATHS.map((x) => P(path.join(home, x.rel), x.match, 'kernel-log'));
  const allowRead: PolicyPath[] = [];
  const meta = new Set<string>();
  for (const a of inp.homeReadable ?? []) {
    if (a.match !== 'literal' && a.match !== 'subpath') throw new TypeError(`#manifest-loader: homeReadable match must be literal|subpath, got ${String(a.match)}`);
    const real = realpathLoose(a.path);
    const rel = path.relative(homeReal, real);
    const parts = rel.split(path.sep);
    if (!rel || path.isAbsolute(rel) || parts[0] === '..' || parts.length < 2 || !HOME_READABLE_ROOTS.includes(parts[0]!) || parts.some((x) => x === '' || x === '.' || x === '..')) {
      throw new TypeError(`#manifest-loader: a session may read only inside ${HOME_READABLE_ROOTS.map((r) => `${r}/<x>`).join(', ')} of the Gnomon home (got ${JSON.stringify(rel)})`);
    }
    allowRead.push({ path: real, match: a.match, class: 'gnomon-home' });
    for (let i = 0; i < parts.length; i++) meta.add(path.join(homeReal, ...parts.slice(0, i))); // the home itself and every ancestor below it
  }
  const linked = inp.linkedFolders.map((f) => P(f, 'subpath', 'linked-folder'));
  const persistence = inp.userHome ? PERSISTENCE_PATHS.map((x) => P(path.join(inp.userHome!, ...x.rel.split('/')), x.match, 'persistence')) : [];
  const extra = [...(inp.extraDenyWrite ?? []), ...(inp.localRunner ? localRunnerDenies(inp.localRunner, inp.userHome) : [])].map((x) => ({ ...x }));
  const gitDirs = roots.flatMap((r) => {
    const d = resolveGitDirs(r);
    return [...new Set([path.join(r, '.git'), ...(d ? [d.gitDir, d.commonDir] : [])])];
  });
  // Aegis H1/M3 (T-2026-10-23-002): also each git dir's commondir (where its config lives), remotes/ and branches/ (legacy
  // remote definitions git reads beside the config), and every root's own `.git` entry as a literal, existing or not
  // (never renamed, replaced or created by the session: `mv .git .git2`, a planted gitfile)
  const git = [
    ...gitDirs.flatMap((g) => [P(path.join(g, 'hooks'), 'subpath', 'git'), P(path.join(g, 'config'), 'literal', 'git'), P(path.join(g, 'info'), 'subpath', 'git'), P(path.join(g, 'commondir'), 'literal', 'git'), P(path.join(g, 'remotes'), 'subpath', 'git'), P(path.join(g, 'branches'), 'subpath', 'git')]),
    ...roots.map((r) => P(path.join(r, '.git'), 'literal', 'git')),
    // Aegis round 2 M5: no `.git` entry may be created, replaced or renamed anywhere below a root
    ...roots.map((r) => P(r, 'dotgit-any', 'git')),
  ];
  // #git-verbs: kernel worktrees under each root (only the kernel creates or removes one; their steering stays denied)
  const worktrees: PolicyPath[] = !inp.kernelWorktrees
    ? []
    : [
        ...roots.flatMap((r) => {
          const w = path.join(r, ...KERNEL_WORKTREES_REL.split('/'));
          return [P(path.join(r, '.gnomon'), 'literal', 'worktrees'), P(w, 'literal', 'worktrees'), P(w, 'worktree-guard', 'worktrees'), P(w, 'steering', 'settings')];
        }),
        ...gitDirs.flatMap((g) => [P(path.join(g, 'worktrees'), 'literal', 'git'), P(path.join(g, 'worktrees'), 'worktree-gitdir', 'git')]),
      ];
  const denyWrite = uniq([...keys, ...settings, ...linked, ...git, ...worktrees, ...persistence, ...extra]);
  // T-2026-10-23-004: the deny-by-default write allowlist (every deny above is rendered AFTER it)
  const writeAllow = uniq([
    ...roots.map((r) => P(r, 'subpath', 'root')),
    ...WRITE_TEMP_PATHS.map((t) => P(t, 'subpath', 'temp')),
    ...(inp.tmpdir ? [{ path: userTempRoot(inp.tmpdir), match: 'subpath' as const, class: 'temp' as const }] : []),
    ...(inp.userHome ? WRITE_CACHE_PATHS.map((c) => P(path.join(inp.userHome!, ...c.split('/')), 'subpath', 'cache')) : []),
    ...(inp.sessionCache ? [P(inp.sessionCache, 'subpath', 'cache')] : []),
    ...(inp.testWriteAllow ?? []).map((t) => P(t, 'subpath', 'temp')),
  ]);
  // TD-2026-10-19-814 item 1: the transcript carve-back. Fail closed (no allow) when ~/.claude/projects is a link
  // elsewhere, or any write deny other than the user Claude dir's own subpath (and the steering regexes, which match
  // `.claude` dirs anywhere) covers it — the allow must reopen exactly ~/.claude/projects and nothing else.
  const allowWrite: PolicyPath[] = [];
  const claudeReal = realpathLoose(inp.userClaudeDir);
  /** One `~/.claude/<rel>` carve-back: the allowed path, or why it is withheld (fail closed). */
  const carve = (rel: string, cls: PolicyPath['class'], what: string): string | undefined => {
    const want = path.join(claudeReal, rel);
    const real = realpathLoose(path.join(inp.userClaudeDir, rel));
    const other = denyWrite.filter((d) => d.match !== 'steering' && d.match !== 'dep-steering' && !(d.match === 'subpath' && d.path === claudeReal) && covers(d, real));
    if (real !== want) return `${what} dir resolves outside the user Claude dir (${real})`;
    if (other.length) return `${what} dir is covered by another write deny (${other.map((d) => `${d.class}:${d.match}:${d.path}`).join(', ')})`;
    allowWrite.push({ path: real, match: 'subpath', class: cls });
    return undefined;
  };
  const allowWriteRefused = inp.claudeTranscripts ? carve(CLAUDE_TRANSCRIPTS_REL, 'transcripts', 'transcript') : undefined;
  // the session-env carve-back follows the transcript one (same fail-closed rules, same literal re-deny of the allowed
  // dir below) but is scoped to THIS session's uuid (Aegis H1): never session-env itself, never a sibling
  const sessionEnvUuid = inp.claudeSessionEnv;
  const sessionEnvRefused =
    sessionEnvUuid === undefined ? undefined
    : !SESSION_UUID_RE.test(sessionEnvUuid) ? `session-env uuid is not a lowercase RFC 4122 uuid (${JSON.stringify(sessionEnvUuid).slice(0, 60)})`
    : realpathLoose(path.join(inp.userClaudeDir, CLAUDE_SESSION_ENV_REL)) !== path.join(claudeReal, CLAUDE_SESSION_ENV_REL) ? 'session-env dir resolves outside the user Claude dir'
    : carve(path.join(CLAUDE_SESSION_ENV_REL, sessionEnvUuid), 'session-env', 'session-env');
  // Aegis M1: the carve-back root itself is re-denied (literal): its children match on their own paths, so transcripts
  // are still written, but `projects` cannot be removed, renamed or swapped for a link (a link there would redirect
  // the user's own unsandboxed Claude Code). Aegis L3: a steering regex whose root holds the carve-back is re-rooted
  // AT it (the original regex would also match `~/.claude` itself and re-close the whole allow); one rooted inside it
  // is re-denied as is. The supervisor creates `projects` before the spawn, so the literal never names a missing dir.
  const steeringAgain = denyWrite.flatMap((d) =>
    d.match !== 'steering' ? [] : allowWrite.flatMap((a): PolicyPath[] => (within(a.path, d.path) ? [{ path: a.path, match: 'steering', class: d.class }] : within(d.path, a.path) ? [d] : [])),
  );
  const denyWriteAlways = uniq([
    ...allowWrite.map((a): PolicyPath => ({ path: a.path, match: 'literal', class: a.class })),
    // Aegis M1: the session-env dir itself stays a literal deny too (it cannot be removed, renamed or swapped)
    ...(allowWrite.some((a) => a.class === 'session-env') ? [{ path: path.join(claudeReal, CLAUDE_SESSION_ENV_REL), match: 'literal' as const, class: 'session-env' as const }] : []),
    ...denyWrite.filter((d) => d.match !== 'steering' && allowWrite.some((a) => d.path !== a.path && within(d.path, a.path))),
    ...steeringAgain,
  ]);
  if (inp.endpointPort !== null && !(Number.isInteger(inp.endpointPort) && inp.endpointPort > 0 && inp.endpointPort < 65536)) {
    throw new TypeError(`#manifest-loader: endpoint port must be 1..65535 or null, got ${String(inp.endpointPort)}`);
  }
  return {
    schemaVersion: SESSION_POLICY_SCHEMA,
    profile: 'session',
    denyRead: uniq([...keys, ...browsers, ...kernelLog, P(home, 'subpath', 'gnomon-home'), ...(inp.userHome ? CREDENTIAL_READ_DENY.map((c) => P(path.join(inp.userHome!, ...c.rel.split('/')), c.match, 'keys')) : []), ...(inp.memorySubtree ? [P(inp.memorySubtree, 'dep-steering', 'settings')] : [])]),
    allowRead: uniq(allowRead),
    allowReadMetadata: uniq([...meta].map((m) => ({ path: m, match: 'literal' as const, class: 'gnomon-home' as const }))),
    denyReadAlways: uniq([...keys.filter((k) => k.class === 'keys'), ...kernelLog]),
    denyWrite,
    allowWrite,
    denyWriteAlways,
    writeAllow,
    ...(allowWriteRefused ? { allowWriteRefused } : {}),
    ...(sessionEnvRefused ? { sessionEnvRefused } : {}),
    denyLoopbackPorts: inp.endpointPort === null ? [] : [inp.endpointPort],
    processInfo: 'deny-others',
    launchers: 'deny',
    denyClasses: SESSION_DENY_CLASSES.filter((c) => c !== 'loopback:endpoint-port' || inp.endpointPort !== null),
    realisedBy: 'M1.7',
  };
}

export function policyHash(p: SessionPolicy): string {
  return `sha256:${createHash('sha256').update(canonicalJson(p), 'utf8').digest('hex')}`;
}

/** Claude Code permission rule for an absolute path (`//` = filesystem root form). */
function rule(tool: 'Read' | 'Edit', p: PolicyPath): string {
  const posix = p.path.split(path.sep).join('/');
  const abs = posix.startsWith('/') ? `/${posix}` : `//${posix}`;
  return `${tool}(${abs}${p.match === 'subpath' ? '/**' : p.match === 'prefix' ? '*' : ''})`;
}

/**
 * P8-D96 (Aegis C2, probe p01b (h)): every tool that writes, runs or fetches is ALWAYS asked. An `allow` rule in
 * any loaded settings layer would otherwise run it with no can_use_tool request (no card); `ask` wins over `allow`,
 * so the request reaches the kernel and the card stays the gate. `deny` still wins over `ask`.
 */
export const ALWAYS_ASK_TOOLS = Object.freeze(['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'PowerShell']);

/** The `policy.json` permissions block: the sandbox deny mirror (§6.1 step 6) and the always-ask tools (P8-D96). */
/**
 * F7 (TD-2026-10-20-086): settings env for every Claude session. CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=1 makes
 * Claude Code return to the project dir after each Bash command, so its idea of the cwd matches the anchored
 * read-only pass (#shell-readonly K1, which stays the proof: it cds into the root itself).
 */
export const CLAUDE_SESSION_ENV: Readonly<Record<string, string>> = Object.freeze({ CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: '1' });

export function claudePermissions(p: SessionPolicy, platform: string = process.platform): { permissions: { deny: string[]; ask: string[] }; env: Record<string, string> } {
  const deny = new Set<string>();
  // W5 (win32): sessions run at Low integrity, where Git Bash cannot start nested: Claude Code's PowerShell tool is the
  // shell and its Bash tool is removed (a bare tool name in deny drops it from the session)
  const win = platform === 'win32';
  if (win) deny.add('Bash');
  for (const d of p.denyRead) {
    if (d.match !== 'dep-steering') {
      deny.add(rule('Read', d));
      continue;
    }
    // F2: Claude's own Read rules for dependency-shipped memory (both common spellings: its globs may be case-sensitive)
    const base = rule('Read', { ...d, match: 'literal' }).slice(0, -1);
    for (const g of ['**/node_modules/**/CLAUDE*.md', '**/node_modules/**/claude*.md', '**/node_modules/**/.claude/**', '**/node_modules/**/.Claude/**']) deny.add(`${base}/${g})`);
  }
  for (const d of p.denyWrite) {
    if (d.match !== 'steering') {
      deny.add(rule('Edit', d));
      continue;
    }
    // R1: Claude's own rules for the subtree (its glob matching may be case-sensitive: both common spellings)
    const base = rule('Edit', { ...d, match: 'literal' }).slice(0, -1);
    for (const g of ['**/CLAUDE*.md', '**/claude*.md', '**/.claude/**', '**/.Claude/**']) deny.add(`${base}/${g})`);
  }
  return { permissions: { deny: [...deny].sort(), ask: [...ALWAYS_ASK_TOOLS] }, env: { ...CLAUDE_SESSION_ENV, ...(win ? { CLAUDE_CODE_USE_POWERSHELL_TOOL: '1' } : {}) } };
}
