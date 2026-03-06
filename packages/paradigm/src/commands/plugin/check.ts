/**
 * paradigm plugin check - Check for updates to installed Claude Code plugins
 *
 * Scans ~/.claude/plugins/marketplaces/ for git clones, compares local HEAD
 * with remote HEAD (via git ls-remote), and reports stale cache versions.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import chalk from 'chalk';

// ─── Types (duplicated from paradigm-mcp to avoid cross-package import) ──

interface PluginUpdateResult {
  repo: string;
  plugin: string;
  installedVersion: string;
  localVersion: string;
  remoteSha: string | null;
  localSha: string;
  marketplacePath: string;
  hasRemoteUpdate: boolean;
  hasCacheStale: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────

function execAsync(cmd: string, options: { timeout?: number; cwd?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: options.timeout || 5000, cwd: options.cwd }, (err, stdout) => {
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

// ─── Discovery ──────────────────────────────────────────────────────

interface DiscoveredPlugin {
  repo: string;
  plugin: string;
  installedVersion: string;
  marketplacePath: string;
  localVersion: string;
}

function discoverPlugins(): DiscoveredPlugin[] {
  const plugins: DiscoveredPlugin[] = [];
  const claudePluginsDir = path.join(os.homedir(), '.claude', 'plugins');
  const marketplacesDir = path.join(claudePluginsDir, 'marketplaces');
  const cacheDir = path.join(claudePluginsDir, 'cache');

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

      // Find installed version from cache
      const pluginCacheDir = path.join(cacheDir, repoDir, pluginName);
      let installedVersion = 'unknown';

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
          if (versions.length > 0) installedVersion = versions[0];
        } catch {
          // Best-effort
        }
      }

      // Infer repo owner/name
      let repo = repoDir;
      try {
        const gitConfig = fs.readFileSync(path.join(marketplacePath, '.git', 'config'), 'utf8');
        const match = gitConfig.match(/github\.com[:/]([^/]+\/[^/\s.]+)/);
        if (match) repo = match[1].replace(/\.git$/, '');
      } catch {
        // Use directory name
      }

      plugins.push({ repo, plugin: pluginName, installedVersion, marketplacePath, localVersion });
    }
  }

  return plugins;
}

async function checkPlugin(plugin: DiscoveredPlugin): Promise<PluginUpdateResult> {
  let remoteSha: string | null = null;
  let localSha = 'unknown';

  try {
    localSha = await execAsync('git rev-parse HEAD', { cwd: plugin.marketplacePath });
  } catch {
    // Keep unknown
  }

  try {
    const output = await execAsync('git ls-remote origin HEAD', {
      cwd: plugin.marketplacePath,
      timeout: 5000,
    });
    const match = output.match(/^([a-f0-9]+)/);
    if (match) remoteSha = match[1];
  } catch {
    // Network failure
  }

  const hasRemoteUpdate = remoteSha !== null && remoteSha !== localSha;
  const hasCacheStale = plugin.localVersion !== plugin.installedVersion &&
    plugin.installedVersion !== 'unknown';

  return {
    repo: plugin.repo,
    plugin: plugin.plugin,
    installedVersion: plugin.installedVersion,
    localVersion: plugin.localVersion,
    remoteSha,
    localSha,
    marketplacePath: plugin.marketplacePath,
    hasRemoteUpdate,
    hasCacheStale,
  };
}

// ─── Command ────────────────────────────────────────────────────────

export async function pluginCheckCommand(options: { update?: boolean } = {}): Promise<void> {
  console.log(chalk.blue('\nPlugin Update Check\n'));

  const plugins = discoverPlugins();

  if (plugins.length === 0) {
    console.log(chalk.gray('No Claude Code plugins found in ~/.claude/plugins/marketplaces/'));
    console.log(chalk.gray('Install plugins with: /plugin marketplace add <owner>/<repo>\n'));
    return;
  }

  console.log(chalk.gray(`Checking ${plugins.length} plugin(s)...\n`));

  const results = await Promise.all(plugins.map(p => checkPlugin(p)));
  const updatable = results.filter(r => r.hasRemoteUpdate || r.hasCacheStale);

  // Display results table
  for (const r of results) {
    const status = r.hasRemoteUpdate
      ? chalk.yellow('update available')
      : r.hasCacheStale
        ? chalk.cyan('restart needed')
        : chalk.green('up to date');

    const version = r.installedVersion !== 'unknown'
      ? `${r.installedVersion} → ${r.localVersion}`
      : r.localVersion;

    console.log(`  ${chalk.bold(r.plugin)} ${chalk.gray(`(${r.repo})`)}`);
    console.log(`    Version: ${version}  Status: ${status}`);

    if (r.hasRemoteUpdate) {
      console.log(chalk.gray(`    Local:  ${r.localSha?.slice(0, 8) || '?'}`));
      console.log(chalk.gray(`    Remote: ${r.remoteSha?.slice(0, 8) || '?'}`));
    }
    if (r.remoteSha === null) {
      console.log(chalk.gray('    (remote check skipped — network unavailable)'));
    }
    console.log();
  }

  if (updatable.length === 0) {
    console.log(chalk.green('All plugins are up to date.\n'));
    return;
  }

  // If --update flag, run git pull on each stale marketplace clone
  const remoteUpdates = updatable.filter(r => r.hasRemoteUpdate);

  if (options.update && remoteUpdates.length > 0) {
    console.log(chalk.blue('Pulling updates...\n'));

    for (const r of remoteUpdates) {
      process.stdout.write(`  ${r.plugin}: `);
      try {
        await execAsync('git pull origin main', {
          cwd: r.marketplacePath,
          timeout: 15000,
        });
        console.log(chalk.green('updated'));
      } catch (err) {
        console.log(chalk.red(`failed — ${err instanceof Error ? err.message : 'unknown error'}`));
      }
    }

    console.log(chalk.yellow('\nRestart your Claude Code session to apply updates.\n'));
  } else if (remoteUpdates.length > 0) {
    console.log(chalk.yellow('To pull updates, run:'));
    for (const r of remoteUpdates) {
      console.log(chalk.gray(`  git -C ${r.marketplacePath} pull origin main`));
    }
    console.log(chalk.gray('\nOr run: paradigm plugin check --update'));
    console.log(chalk.yellow('\nAfter updating, restart your Claude Code session.\n'));
  } else {
    console.log(chalk.yellow('Restart your Claude Code session to apply cached updates.\n'));
  }
}
