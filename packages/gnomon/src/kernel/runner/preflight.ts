/**
 * @symbol #session-runner
 * @symbol ^subscription-only
 *
 * #session-runner preflight (spec §3.3 "Preflight", §3.4 "Law 7 inside the
 * broker", §16 "Claude Code preflight paths"; G-SUB-01, G-RUN-06; T-009 /
 * Aegis C5). Authoritative before every spawn and respawn.
 *
 *   resolveClaudeBinary — explicit path (root-signed config) else the
 *     platform registry's known locations (src/platform/claude-code.ts),
 *     NEVER a PATH lookup (p01); realpath + sha256; a respawn whose binary
 *     sha changed is refused `claude_binary_changed`.
 *   claudeVersionOk — `<bin> --version` ≥ 2.1.288 (`claudeCli.ts:13`).
 *   claudeAuthOk — `<bin> auth status` JSON says authMethod "claude.ai" and
 *     apiProvider "firstParty" (`headless.py:586-610`).
 *   law7Layers — EVERY layer the child `claude` reads FOR THIS SPAWN'S CWD:
 *     the managed sources (per-OS list; directories' *.json; sources the
 *     kernel cannot read on this OS are hits, fail closed), the user
 *     settings files, project and worktree `.claude/settings.json` +
 *     `settings.local.json`, project and worktree `.mcp.json`, `~/.claude.json`
 *     `mcpServers` AND `projects.<cwd>.mcpServers` (the cwd as given and
 *     realpath'd), the session's own generated policy.json and mcp.json.
 *     Scanned with billing.ts's scanApiBilling over the CHILD's env — the
 *     daemon-global fuse scan covers only the daemon env and the user layer.
 * No platform branch: the platform row is looked up by key (G-WIN-05).
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileLayers, scanApiBilling, type BillingHit, type SettingsLayer } from '../budget/billing.js';
import { CLAUDE_MIN_VERSION, type ClaudeCodePlatformRow } from '../../platform/claude-code.js';

/** §3.3 closed refusal codes (flow's, preserved) + law 7. */
export const SESSION_REFUSAL_CODES = Object.freeze(['claude_version', 'not_subscription_auth', 'spawn_failed', 'claude_binary_changed', 'bad_message', 'session_busy', 'api_billing_refused', 'claude_binary_unsupported'] as const);
export type SessionRefusalCode = (typeof SESSION_REFUSAL_CODES)[number];

export class PreflightRefusal extends Error {
  readonly code: SessionRefusalCode;
  readonly data: Record<string, unknown>;
  constructor(code: SessionRefusalCode, message: string, data: Record<string, unknown> = {}) {
    super(`#session-runner: ${message}`);
    this.code = code;
    this.data = data;
  }
}

export interface ClaudeBinary {
  path: string;
  real: string;
  sha256: string;
}

const expandHome = (p: string, home: string): string => (p === '~' ? home : p.startsWith('~/') ? path.join(home, p.slice(2)) : p);

export function resolveClaudeBinary(o: { explicit?: string; row: ClaudeCodePlatformRow; home: string; previousSha256?: string }): ClaudeBinary {
  const candidates = o.explicit ? [o.explicit] : o.row.knownBinaries.map((b) => expandHome(b, o.home));
  for (const c of candidates) {
    if (!path.isAbsolute(c)) continue; // never a bare name (that would be a PATH lookup)
    let real: string;
    try {
      real = fs.realpathSync.native(c);
      if (!fs.statSync(real).isFile()) continue;
    } catch {
      continue;
    }
    const sha256 = createHash('sha256').update(fs.readFileSync(real)).digest('hex');
    if (o.previousSha256 && o.previousSha256 !== sha256) throw new PreflightRefusal('claude_binary_changed', 'the claude binary changed since the session spawned', { path: c });
    return { path: c, real, sha256 };
  }
  throw new PreflightRefusal('spawn_failed', o.explicit ? `claude not found at the configured path` : 'claude not found at any known location (never a PATH lookup, p01)', { candidates });
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** How preflight runs the binary: the supervisor passes a runner that executes the PRIVATE copy under the session profile (Aegis H1). */
export type ClaudeRun = (args: string[]) => Promise<{ status: number | null; stdout: string }>;

/** A plain runner (spawnSync, given env) — the supervisor wraps it in the session profile. */
export function spawnRunner(command: string, prefix: string[], env: Record<string, string>): ClaudeRun {
  return async (args) => {
    const r = spawnSync(command, [...prefix, ...args], { env, encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: r.status, stdout: r.stdout ?? '' };
  };
}

/** `<bin> --version` ≥ the floor; returns the version. */
export async function claudeVersion(run: ClaudeRun, min: string = CLAUDE_MIN_VERSION): Promise<string> {
  const r = await run(['--version']);
  const m = /(\d+\.\d+\.\d+)/.exec(r.stdout);
  if (r.status !== 0 || !m) throw new PreflightRefusal('claude_version', 'claude --version gave no version');
  if (compareVersions(m[1]!, min) < 0) throw new PreflightRefusal('claude_version', `claude ${m[1]} is older than ${min}`, { version: m[1], min });
  return m[1]!;
}

/** `<bin> auth status` must say subscription auth (claude.ai, firstParty). */
export async function claudeAuthOk(run: ClaudeRun): Promise<void> {
  const r = await run(['auth', 'status', '--json']);
  let j: Record<string, unknown> | null = null;
  try {
    j = JSON.parse(r.stdout) as Record<string, unknown>;
  } catch {
    j = null;
  }
  if (r.status !== 0 || !j || j.loggedIn === false || j.authMethod !== 'claude.ai' || j.apiProvider !== 'firstParty') {
    throw new PreflightRefusal('not_subscription_auth', 'claude auth status is not subscription auth (claude.ai / firstParty)', { authMethod: typeof j?.authMethod === 'string' ? j.authMethod : null, apiProvider: typeof j?.apiProvider === 'string' ? j.apiProvider : null });
  }
}

export interface Law7Input {
  row: ClaudeCodePlatformRow;
  cwd: string;
  worktree?: string;
  userClaudeDir: string;
  userClaudeJson: string;
  /** the session's generated policy.json / mcp.json */
  policyPath?: string;
  mcpConfigPath?: string;
}

/** Managed sources as concrete files (directories expanded to their *.json). */
export function managedFiles(row: ClaudeCodePlatformRow): string[] {
  const out = [...row.managedSettings];
  for (const d of row.managedSettingsDirs) {
    try {
      for (const n of fs.readdirSync(d).sort()) if (n.toLowerCase().endsWith('.json')) out.push(path.join(d, n));
    } catch {
      /* absent directory: nothing to scan */
    }
  }
  return out;
}

function claudeJsonLayers(file: string, cwds: string[]): SettingsLayer[] {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? [] : [{ where: 'claude-json', json: undefined, kind: 'mcp' }];
  }
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return [{ where: 'claude-json', json: undefined, kind: 'mcp' }];
  }
  if (j === null || typeof j !== 'object') return [{ where: 'claude-json', json: undefined, kind: 'mcp' }];
  const o = j as Record<string, unknown>;
  const out: SettingsLayer[] = [
    { where: 'claude-json', json: { mcpServers: o.mcpServers ?? {} }, kind: 'mcp' },
    // Aegis L2: a stored or approved API key in ~/.claude.json bills credits
    { where: 'claude-json', json: { primaryApiKey: o.primaryApiKey, customApiKeyResponses: o.customApiKeyResponses, forceLoginMethod: o.forceLoginMethod }, kind: 'settings' },
  ];
  const projects = o.projects && typeof o.projects === 'object' ? (o.projects as Record<string, unknown>) : {};
  for (const c of new Set(cwds)) {
    const p = projects[c];
    if (p && typeof p === 'object') {
      const pj = p as Record<string, unknown>;
      out.push({ where: `claude-json#projects:${c}`, json: { mcpServers: pj.mcpServers ?? {} }, kind: 'mcp' });
      if ('env' in pj) out.push({ where: `claude-json#projects:${c}`, json: { env: pj.env }, kind: 'settings' });
    }
  }
  return out;
}

export const realLoose = (p: string): string => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
};

/**
 * Reviewer (round 2): the law-7 PROJECTION of ~/.claude.json the mid-session
 * watch hashes — mcpServers, projects.<cwd>.{mcpServers, env}, primaryApiKey,
 * customApiKeyResponses, forceLoginMethod — so Claude's routine rewrites of the
 * rest of the file never fire session.layers.changed.
 */
export function claudeJsonProjection(file: string, cwds: readonly string[]): string {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return 'unreadable';
    text = '{}'; // absent projects like an empty file: creating it with routine state is not a law-7 change
  }
  let o: Record<string, unknown>;
  try {
    const j = JSON.parse(text) as unknown;
    if (j === null || typeof j !== 'object') return 'not-an-object';
    o = j as Record<string, unknown>;
  } catch {
    return 'unparseable';
  }
  const projects = o.projects && typeof o.projects === 'object' ? (o.projects as Record<string, Record<string, unknown> | undefined>) : {};
  const per = [...new Set(cwds)].sort().map((c) => [c, projects[c]?.mcpServers ?? null, projects[c]?.env ?? null]);
  return createHash('sha256').update(JSON.stringify([o.mcpServers ?? null, o.primaryApiKey ?? null, o.customApiKeyResponses ?? null, o.forceLoginMethod ?? null, per])).digest('hex');
}

/** Every settings/mcp layer the child claude reads for this spawn (see header). */
export function law7Layers(i: Law7Input): SettingsLayer[] {
  const roots = [i.cwd, ...(i.worktree && path.resolve(i.worktree) !== path.resolve(i.cwd) ? [i.worktree] : [])];
  const files: Array<{ where: string; path: string; kind: 'settings' | 'mcp' }> = [];
  for (const m of managedFiles(i.row)) files.push({ where: `managed:${m}`, path: m, kind: 'settings' });
  let userNames: string[] = [];
  try {
    userNames = fs.readdirSync(i.userClaudeDir).filter((n) => /^settings.*\.json$/i.test(n)).sort();
  } catch {
    userNames = [];
  }
  for (const n of userNames) files.push({ where: `user:${n}`, path: path.join(i.userClaudeDir, n), kind: 'settings' });
  for (const [label, r] of roots.map((r, k) => [k === 0 ? 'project' : 'worktree', r] as const)) {
    files.push({ where: `${label}:.claude/settings.json`, path: path.join(r, '.claude', 'settings.json'), kind: 'settings' });
    files.push({ where: `${label}:.claude/settings.local.json`, path: path.join(r, '.claude', 'settings.local.json'), kind: 'settings' });
    files.push({ where: `${label}:.mcp.json`, path: path.join(r, '.mcp.json'), kind: 'mcp' });
  }
  if (i.policyPath) files.push({ where: 'session:policy.json', path: i.policyPath, kind: 'settings' });
  if (i.mcpConfigPath) files.push({ where: 'session:mcp.json', path: i.mcpConfigPath, kind: 'mcp' });
  const unscannable: SettingsLayer[] = i.row.managedUnscannable.map((s) => ({ where: `managed:${s}`, json: undefined, kind: 'settings' }));
  const cwds = roots.flatMap((r) => [path.resolve(r), realLoose(r)]);
  return [...fileLayers(files), ...claudeJsonLayers(i.userClaudeJson, cwds), ...unscannable];
}

/** The per-spawn law-7 scan: the child's env + every layer. Empty = subscription-only holds. */
export function law7Scan(env: Readonly<Record<string, string | undefined>>, layers: SettingsLayer[], opts: { ignoreEnv?: readonly string[] } = {}): BillingHit[] {
  return scanApiBilling({ env: () => env, layers: () => layers }, opts);
}
