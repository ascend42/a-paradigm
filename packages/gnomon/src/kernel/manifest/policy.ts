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
export type PathMatch = 'subpath' | 'literal' | 'prefix' | 'steering';
export interface PolicyPath {
  path: string;
  match: PathMatch;
  /** why the deny exists (the §15.5 class) */
  class: 'keys' | 'kernel-log' | 'warpline-tokens' | 'browser-profile' | 'gnomon-home' | 'settings' | 'linked-folder' | 'git' | 'binary' | 'persistence';
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
  let prefix = path.dirname(path.dirname(node));
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
  const git = gitDirs.flatMap((g) => [P(path.join(g, 'hooks'), 'subpath', 'git'), P(path.join(g, 'config'), 'literal', 'git'), P(path.join(g, 'info'), 'subpath', 'git')]);
  if (inp.endpointPort !== null && !(Number.isInteger(inp.endpointPort) && inp.endpointPort > 0 && inp.endpointPort < 65536)) {
    throw new TypeError(`#manifest-loader: endpoint port must be 1..65535 or null, got ${String(inp.endpointPort)}`);
  }
  return {
    schemaVersion: SESSION_POLICY_SCHEMA,
    profile: 'session',
    denyRead: uniq([...keys, ...browsers, ...kernelLog, P(home, 'subpath', 'gnomon-home')]),
    allowRead: uniq(allowRead),
    allowReadMetadata: uniq([...meta].map((m) => ({ path: m, match: 'literal' as const, class: 'gnomon-home' as const }))),
    denyReadAlways: uniq([...keys.filter((k) => k.class === 'keys'), ...kernelLog]),
    denyWrite: uniq([...keys, ...settings, ...linked, ...git, ...persistence, ...extra]),
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
export function claudePermissions(p: SessionPolicy): { permissions: { deny: string[]; ask: string[] } } {
  const deny = new Set<string>();
  for (const d of p.denyRead) deny.add(rule('Read', d));
  for (const d of p.denyWrite) {
    if (d.match !== 'steering') {
      deny.add(rule('Edit', d));
      continue;
    }
    // R1: Claude's own rules for the subtree (its glob matching may be case-sensitive: both common spellings)
    const base = rule('Edit', { ...d, match: 'literal' }).slice(0, -1);
    for (const g of ['**/CLAUDE*.md', '**/claude*.md', '**/.claude/**', '**/.Claude/**']) deny.add(`${base}/${g})`);
  }
  return { permissions: { deny: [...deny].sort(), ask: [...ALWAYS_ASK_TOOLS] } };
}
