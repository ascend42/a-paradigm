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
 *     worktree `.claude/**` and `CLAUDE*.md` (prefix); every input layersHash
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

export type PathMatch = 'subpath' | 'literal' | 'prefix';
export interface PolicyPath {
  path: string;
  match: PathMatch;
  /** why the deny exists (the §15.5 class) */
  class: 'keys' | 'warpline-tokens' | 'browser-profile' | 'gnomon-home' | 'settings' | 'linked-folder' | 'git' | 'binary' | 'persistence';
}

export interface SessionPolicy {
  schemaVersion: typeof SESSION_POLICY_SCHEMA;
  profile: 'session';
  denyRead: PolicyPath[];
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
}

/** The write denies for the local runner's node install and source dir (realpath'd; a prefix that is /, the user home or above it narrows to node's own dir). */
export function localRunnerDenies(r: { node: string; dir: string }, userHome?: string): PolicyPath[] {
  const node = realpathLoose(r.node);
  let prefix = path.dirname(path.dirname(node));
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
    ...roots.flatMap((r) => [P(path.join(r, '.claude'), 'subpath', 'settings'), P(path.join(r, 'CLAUDE'), 'prefix', 'settings')]),
  ];
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
    denyRead: uniq([...keys, ...browsers]),
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

/** The `policy.json` permissions block mirroring the sandbox denies (§6.1 step 6). */
export function claudePermissions(p: SessionPolicy): { permissions: { deny: string[] } } {
  const deny = new Set<string>();
  for (const d of p.denyRead) deny.add(rule('Read', d));
  for (const d of p.denyWrite) deny.add(rule('Edit', d));
  return { permissions: { deny: [...deny].sort() } };
}
