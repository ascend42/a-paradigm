/**
 * Plugin Update Checker - Detects stale Claude Code plugins
 *
 * Reads Claude Code's plugin metadata at ~/.claude/plugins/ and compares
 * installed versions/SHAs against marketplace clones and remote origins.
 *
 * Used in two ways:
 * 1. Auto-check: On first MCP tool call, read stored results and fire background refresh
 * 2. Manual check: Via paradigm_plugin_check MCP tool or CLI command
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
const THROTTLE_HOURS = 6;

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

function loadCheckState(): PluginUpdateCheckState | null {
  return readJsonSafe<PluginUpdateCheckState>(CHECK_STATE_PATH);
}

function saveCheckState(state: PluginUpdateCheckState): void {
  const dir = path.dirname(CHECK_STATE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CHECK_STATE_PATH, JSON.stringify(state, null, 2));
}

function isThrottled(): boolean {
  const state = loadCheckState();
  if (!state) return false;
  const elapsed = Date.now() - new Date(state.lastCheck).getTime();
  return elapsed < THROTTLE_HOURS * 3600 * 1000;
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

/**
 * Read stored check results and return a notice string if updates are available.
 * Pure file read — safe for the synchronous first-tool-call path.
 */
export function getPluginUpdateNotice(): string | null {
  const state = loadCheckState();
  if (!state?.results) return null;

  const updatable = state.results.filter(r => r.hasRemoteUpdate || r.hasCacheStale);
  if (updatable.length === 0) return null;

  const lines: string[] = [];
  lines.push('--- PLUGIN UPDATES AVAILABLE ---');
  lines.push('Updates available for installed Claude Code plugins:');

  const pullCmds: string[] = [];
  const reinstallCmds: string[] = [];
  for (const r of updatable) {
    if (r.hasRemoteUpdate) {
      const versionInfo = r.installedVersion !== 'unknown'
        ? `${r.installedVersion} → ${r.localVersion}`
        : 'newer commits available';
      lines.push(`  - ${r.plugin} (${r.repo}): ${versionInfo}`);
      pullCmds.push(`git -C ${r.marketplacePath} pull origin main`);
      reinstallCmds.push(`/plugin marketplace add ${r.repo}`);
    } else if (r.hasContentDrift) {
      lines.push(`  - ${r.plugin} (${r.repo}): content changed (hash ${r.cachedContentHash} → ${r.marketplaceContentHash}, reinstall needed)`);
      reinstallCmds.push(`/plugin marketplace add ${r.repo}`);
    } else if (r.hasCacheStale) {
      lines.push(`  - ${r.plugin} (${r.repo}): ${r.installedVersion} → ${r.localVersion} (reinstall needed)`);
      reinstallCmds.push(`/plugin marketplace add ${r.repo}`);
    }
  }

  lines.push('');
  lines.push('Tell the user about these updates and suggest the following steps:');

  if (pullCmds.length > 0) {
    lines.push('');
    lines.push('Step 1 — Pull latest from remote:');
    lines.push(`  ${pullCmds.join(' && \\\n  ')}`);
  }

  if (reinstallCmds.length > 0) {
    const stepNum = pullCmds.length > 0 ? 2 : 1;
    lines.push('');
    lines.push(`Step ${stepNum} — Reinstall to update the cached version:`);
    for (const cmd of reinstallCmds) {
      lines.push(`  ${cmd}`);
    }
    lines.push('');
    lines.push(`Step ${stepNum + 1} — Restart the Claude Code session to load the new version.`);
  }

  lines.push('---');

  return lines.join('\n');
}

/**
 * Fire-and-forget async check. Writes results for the next session.
 * Throttled to skip if last check was <6 hours ago.
 */
export function schedulePluginUpdateCheck(): void {
  if (isThrottled()) return;

  // Fire and forget — don't await, don't let errors propagate
  (async () => {
    try {
      const results = await runPluginUpdateCheck();
      saveCheckState({
        lastCheck: new Date().toISOString(),
        results,
      });
    } catch {
      // Silently fail — this is background work
    }
  })();
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
