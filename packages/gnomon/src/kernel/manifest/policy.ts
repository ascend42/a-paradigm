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
 *   - settings (write): `<home>/**`, every Claude settings layer — the user
 *     `settings*.json` (prefix), the managed files, project and worktree
 *     `.claude/**` and `CLAUDE*.md` (prefix);
 *   - linked mod folders (write), the list regenerated at each spawn;
 *   - the web endpoint's port (outbound loopback), when the endpoint is up;
 *   - process information on other processes.
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

export const SESSION_POLICY_SCHEMA = 'gnomon-session-policy:v1' as const;

export type PathMatch = 'subpath' | 'literal' | 'prefix';
export interface PolicyPath {
  path: string;
  match: PathMatch;
  /** why the deny exists (the §15.5 class) */
  class: 'keys' | 'warpline-tokens' | 'browser-profile' | 'gnomon-home' | 'settings' | 'linked-folder';
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
}

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
    P(path.join(inp.userClaudeDir, 'settings'), 'prefix', 'settings'),
    ...inp.managedSettingsPaths.map((m) => P(m, 'literal', 'settings')),
    ...roots.flatMap((r) => [P(path.join(r, '.claude'), 'subpath', 'settings'), P(path.join(r, 'CLAUDE'), 'prefix', 'settings')]),
  ];
  const linked = inp.linkedFolders.map((f) => P(f, 'subpath', 'linked-folder'));
  if (inp.endpointPort !== null && !(Number.isInteger(inp.endpointPort) && inp.endpointPort > 0 && inp.endpointPort < 65536)) {
    throw new TypeError(`#manifest-loader: endpoint port must be 1..65535 or null, got ${String(inp.endpointPort)}`);
  }
  return {
    schemaVersion: SESSION_POLICY_SCHEMA,
    profile: 'session',
    denyRead: uniq([...keys, ...browsers]),
    denyWrite: uniq([...keys, ...settings, ...linked]),
    denyLoopbackPorts: inp.endpointPort === null ? [] : [inp.endpointPort],
    processInfo: 'deny-others',
    launchers: 'deny',
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
