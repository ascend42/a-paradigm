/**
 * Plugin Update Checker - Detects stale Claude Code plugins
 *
 * Reads Claude Code's plugin metadata at ~/.claude/plugins/ and compares
 * installed versions/SHAs against marketplace clones and remote origins.
 *
 * Reported only on request: paradigm_status check:'plugins' (MCP) and
 * `paradigm plugin check` (CLI). Never prepended to other tool results: the
 * output is structured PluginUpdateNotice facts, not agent-directed text.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { exec } from 'child_process';

// ─── Types ──────────────────────────────────────────────────────────

export interface PluginUpdateResult {
  repo: string;
  plugin: string;
  /** Claude Code marketplace name (the clone's dir name); absent in older stored state */
  marketplace?: string;
  installedVersion: string;
  installedSha: string;
  localVersion: string;
  remoteSha: string | null;
  marketplacePath: string;
  hasRemoteUpdate: boolean;
  hasCacheStale: boolean;
  /** Content hash of marketplace plugin directory — detects changes even without version bump */
  marketplaceContentHash: string;
  /** Content hash of cached (installed) plugin directory */
  cachedContentHash: string;
  /** True if marketplace content differs from cached content */
  hasContentDrift: boolean;
}

export interface PluginUpdateCheckState {
  lastCheck: string;
  results: PluginUpdateResult[];
}

// ─── Paths ──────────────────────────────────────────────────────────

const CLAUDE_PLUGINS_DIR = path.join(os.homedir(), '.claude', 'plugins');
const CHECK_STATE_PATH = path.join(os.homedir(), '.paradigm', 'plugin-update-check.json');

// ─── Helpers ────────────────────────────────────────────────────────

function execAsync(cmd: string, options: { timeout?: number; cwd?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: options.timeout || 3000, cwd: options.cwd }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.trim());
    });
  });
}

function readJsonSafe<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Last results on disk, for diagnostics (nothing reads them back into a tool result). */
function saveCheckState(state: PluginUpdateCheckState): void {
  const dir = path.dirname(CHECK_STATE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CHECK_STATE_PATH, JSON.stringify(state, null, 2));
}

// ─── Content Hash ───────────────────────────────────────────────────

/**
 * Compute a SHA-256 hash of plugin directory contents (skills, scripts, plugin.json).
 * This detects changes even when semver hasn't been bumped.
 * Only hashes text files relevant to plugin behavior — skips .git, node_modules, etc.
 */
function computePluginContentHash(pluginDir: string): string {
  const hash = crypto.createHash('sha256');
  const relevantExts = new Set(['.md', '.json', '.sh', '.yaml', '.yml', '.ts', '.js']);
  const skipDirs = new Set(['.git', 'node_modules', '.cache']);

  function walkDir(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }

    // Sort for deterministic hashing
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (skipDirs.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (relevantExts.has(ext)) {
          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            // Hash relative path + content for position-aware hashing
            const relPath = path.relative(pluginDir, fullPath);
            hash.update(relPath + '\0' + content);
          } catch { /* skip unreadable */ }
        }
      }
    }
  }

  walkDir(pluginDir);
  return hash.digest('hex').slice(0, 12); // Short hash, 12 chars
}

// ─── Core Logic ─────────────────────────────────────────────────────

/**
 * Discover installed plugins by scanning the Claude Code plugin directories.
 *
 * Claude Code uses:
 * - ~/.claude/plugins/marketplaces/{repo-name}/  (git clones)
 * - ~/.claude/plugins/cache/{repo-name}/{plugin-name}/{version}/  (installed copies)
 */
interface DiscoveredPlugin {
  repo: string;
  marketplace: string;
  plugin: string;
  installedVersion: string;
  installedSha: string;
  marketplacePath: string;
  localVersion: string;
  /** Path to the plugin dir inside the marketplace clone */
  pluginSourceDir: string;
  /** Path to the cached plugin dir */
  pluginCacheDir: string;
}

function discoverPlugins(): DiscoveredPlugin[] {
  const plugins: DiscoveredPlugin[] = [];

  const marketplacesDir = path.join(CLAUDE_PLUGINS_DIR, 'marketplaces');
  const cacheDir = path.join(CLAUDE_PLUGINS_DIR, 'cache');

  if (!fs.existsSync(marketplacesDir)) return plugins;

  let marketplaceRepos: string[];
  try {
    marketplaceRepos = fs.readdirSync(marketplacesDir).filter(d => {
      const fullPath = path.join(marketplacesDir, d);
      return fs.statSync(fullPath).isDirectory() && fs.existsSync(path.join(fullPath, '.git'));
    });
  } catch {
    return plugins;
  }

  for (const repoDir of marketplaceRepos) {
    const marketplacePath = path.join(marketplacesDir, repoDir);

    // Find plugin.json files inside the marketplace clone
    // Convention: plugins/{plugin-name}/.claude-plugin/plugin.json
    const pluginsSubdir = path.join(marketplacePath, 'plugins');
    if (!fs.existsSync(pluginsSubdir)) continue;

    let pluginDirs: string[];
    try {
      pluginDirs = fs.readdirSync(pluginsSubdir).filter(d =>
        fs.statSync(path.join(pluginsSubdir, d)).isDirectory()
      );
    } catch {
      continue;
    }

    for (const pluginName of pluginDirs) {
      const pluginJsonPath = path.join(pluginsSubdir, pluginName, '.claude-plugin', 'plugin.json');
      const pluginJson = readJsonSafe<{ version?: string }>(pluginJsonPath);
      if (!pluginJson) continue;

      const localVersion = pluginJson.version || 'unknown';

      // Find matching cache entry to get installed version
      // Cache structure: cache/{repo-name}/{plugin-name}/{version}/
      const pluginCacheDir = path.join(cacheDir, repoDir, pluginName);
      let installedVersion = 'unknown';
      let installedSha = 'unknown';

      if (fs.existsSync(pluginCacheDir)) {
        try {
          const versions = fs.readdirSync(pluginCacheDir)
            .filter(d => fs.statSync(path.join(pluginCacheDir, d)).isDirectory())
            .sort((a, b) => {
              // Semver-aware sort: compare major.minor.patch numerically
              const pa = a.split('.').map(Number);
              const pb = b.split('.').map(Number);
              for (let i = 0; i < 3; i++) {
                if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
              }
              return 0;
            })
            .reverse();

          if (versions.length > 0) {
            installedVersion = versions[0];

            // Try to read the cached plugin.json for SHA info
            const cachedPluginJson = readJsonSafe<{ version?: string; sha?: string }>(
              path.join(pluginCacheDir, versions[0], '.claude-plugin', 'plugin.json')
            );
            if (cachedPluginJson?.sha) {
              installedSha = cachedPluginJson.sha;
            }
          }
        } catch {
          // Best-effort
        }
      }

      // Infer repo owner/name from git remote if possible
      let repo = repoDir;
      try {
        const remoteUrl = fs.readFileSync(
          path.join(marketplacePath, '.git', 'config'), 'utf8'
        );
        const match = remoteUrl.match(/github\.com[:/]([^/]+\/[^/\s.]+)/);
        if (match) {
          repo = match[1].replace(/\.git$/, '');
        }
      } catch {
        // Use directory name as fallback
      }

      plugins.push({
        repo,
        marketplace: repoDir,
        plugin: pluginName,
        installedVersion,
        installedSha,
        marketplacePath,
        localVersion,
        pluginSourceDir: path.join(pluginsSubdir, pluginName),
        pluginCacheDir: fs.existsSync(pluginCacheDir) && installedVersion !== 'unknown'
          ? path.join(pluginCacheDir, installedVersion)
          : '',
      });
    }
  }

  return plugins;
}

async function checkPlugin(plugin: DiscoveredPlugin): Promise<PluginUpdateResult> {
  let remoteSha: string | null = null;
  let localSha = plugin.installedSha;

  // Get local HEAD SHA
  try {
    localSha = await execAsync('git rev-parse HEAD', { cwd: plugin.marketplacePath });
  } catch {
    // Keep whatever we had
  }

  // Get remote HEAD SHA
  try {
    const output = await execAsync('git ls-remote origin HEAD', {
      cwd: plugin.marketplacePath,
      timeout: 3000,
    });
    const match = output.match(/^([a-f0-9]+)/);
    if (match) {
      remoteSha = match[1];
    }
  } catch {
    // Network failure — leave as null
  }

  const hasRemoteUpdate = remoteSha !== null && remoteSha !== localSha;
  const hasCacheStale = plugin.localVersion !== plugin.installedVersion &&
    plugin.installedVersion !== 'unknown';

  // Content hash comparison — detects changes even without version bump
  const marketplaceContentHash = computePluginContentHash(plugin.pluginSourceDir);
  const cachedContentHash = plugin.pluginCacheDir
    ? computePluginContentHash(plugin.pluginCacheDir)
    : '';
  const hasContentDrift = cachedContentHash !== '' && marketplaceContentHash !== cachedContentHash;

  return {
    repo: plugin.repo,
    plugin: plugin.plugin,
    marketplace: plugin.marketplace,
    installedVersion: plugin.installedVersion,
    installedSha: localSha,
    localVersion: plugin.localVersion,
    remoteSha,
    marketplacePath: plugin.marketplacePath,
    hasRemoteUpdate,
    hasCacheStale: hasCacheStale || hasContentDrift,
    marketplaceContentHash,
    cachedContentHash,
    hasContentDrift,
  };
}

// ─── Public API ─────────────────────────────────────────────────────

/** Why a plugin is reported as updatable. */
export type PluginUpdateReason = 'remote-commits' | 'content-changed' | 'version-changed';

/**
 * An inert, structured plugin-update fact. Data only, no instructions to the
 * agent, so it is safe inside a tool result.
 */
export interface PluginUpdateNotice {
  kind: 'plugin-update';
  plugin: string;
  /** Claude Code marketplace name (the `<mkt>` in `plugin@<mkt>`) */
  marketplace: string;
  /** Git owner/name of the marketplace source */
  repo: string;
  /** Installed state: short SHA, content hash or version, per `reason` */
  from: string;
  /** Available state, same unit as `from` */
  to: string;
  reason: PluginUpdateReason;
  /** The terminal command that applies the update (works in every host) */
  command: string;
}

/** The host running the agent session this MCP server serves. */
export type PluginHost = 'gnomon' | 'claude-code';

/**
 * Gnomon sets GNOMON_HSID on every session it spawns (packages/gnomon
 * src/kernel/runner/env.ts buildSessionEnv) and Claude Code passes its env to
 * stdio MCP servers. A Gnomon session is not interactive Claude Code: it has
 * no slash commands.
 */
export function detectPluginHost(env: NodeJS.ProcessEnv = process.env): PluginHost {
  return typeof env.GNOMON_HSID === 'string' && env.GNOMON_HSID.length > 0 ? 'gnomon' : 'claude-code';
}

/** `claude plugin` CLI form (checked against `claude plugin --help`). */
export function pluginUpdateCommand(plugin: string, marketplace: string): string {
  return `claude plugin marketplace update ${marketplace} && claude plugin update ${plugin}@${marketplace}`;
}

/** Turn check results into structured notices (empty when nothing is updatable). */
export function toPluginUpdateNotices(results: PluginUpdateResult[]): PluginUpdateNotice[] {
  const notices: PluginUpdateNotice[] = [];
  for (const r of results) {
    // Marketplace name = the clone's directory under ~/.claude/plugins/marketplaces/
    const marketplace = r.marketplace || path.basename(r.marketplacePath);
    const base = {
      kind: 'plugin-update' as const,
      plugin: r.plugin,
      marketplace,
      repo: r.repo,
      command: pluginUpdateCommand(r.plugin, marketplace),
    };
    if (r.hasRemoteUpdate) {
      notices.push({ ...base, reason: 'remote-commits', from: (r.installedSha || 'unknown').slice(0, 12), to: (r.remoteSha || 'unknown').slice(0, 12) });
    } else if (r.hasContentDrift) {
      notices.push({ ...base, reason: 'content-changed', from: r.cachedContentHash, to: r.marketplaceContentHash });
    } else if (r.hasCacheStale) {
      notices.push({ ...base, reason: 'version-changed', from: r.installedVersion, to: r.localVersion });
    }
  }
  return notices;
}

const REASON_TEXT: Record<PluginUpdateReason, string> = {
  'remote-commits': 'newer commits upstream',
  'content-changed': 'content changed',
  'version-changed': 'newer version in the marketplace',
};

/**
 * A descriptive summary for a person, never addressed to the agent.
 * Host-aware: a Gnomon session names only the terminal command; interactive
 * Claude Code also names `/plugin`.
 */
export function formatPluginUpdateSummary(notices: PluginUpdateNotice[], host: PluginHost): string {
  if (notices.length === 0) return 'All installed plugins are up to date.';
  const lines = [`Plugin updates available (${notices.length}):`];
  for (const n of notices) {
    lines.push(`  - ${n.plugin}@${n.marketplace} (${n.repo}): ${REASON_TEXT[n.reason]}, ${n.from} → ${n.to}`);
  }
  lines.push('');
  lines.push(host === 'gnomon'
    ? 'Update from a terminal outside the Gnomon session; a new session loads it:'
    : 'Update with /plugin in Claude Code or from a terminal; a restart loads it:');
  for (const n of notices) lines.push(`  ${n.command}`);
  return lines.join('\n');
}

export interface PluginCheckReport {
  host: PluginHost;
  pluginsChecked: number;
  notices: PluginUpdateNotice[];
  summary: string;
}

/** The paradigm_status check:'plugins' payload: structured notices plus a descriptive summary. */
export function buildPluginCheckReport(results: PluginUpdateResult[], host: PluginHost): PluginCheckReport {
  const notices = toPluginUpdateNotices(results);
  const summary = results.length === 0
    ? 'No Claude Code plugins found in ~/.claude/plugins/marketplaces/.'
    : formatPluginUpdateSummary(notices, host);
  return { host, pluginsChecked: results.length, notices, summary };
}

/**
 * Run the full update check synchronously (for CLI and MCP tool use).
 */
export async function runPluginUpdateCheck(): Promise<PluginUpdateResult[]> {
  const plugins = discoverPlugins();
  if (plugins.length === 0) return [];

  const results = await Promise.all(plugins.map(p => checkPlugin(p)));

  // Also save state so the background check stays fresh
  saveCheckState({
    lastCheck: new Date().toISOString(),
    results,
  });

  return results;
}
