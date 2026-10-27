/**
 * The Claude Code plugin's MCP launch must start in a project whose devEngines require pnpm.
 *
 * npm 11 applies the nearest package.json's devEngines to npx. The plugin ran `npx paradigm-mcp` from the project,
 * so a repo with devEngines.packageManager pnpm and onFail "error" (e.g. a-atelier) made npx exit EBADDEVENGINES
 * and the plugin server showed as CONNECTION_CLOSED. `--prefix` was rejected: it also moves npm's global prefix and
 * globalconfig. plugins/paradigm/scripts/paradigm-mcp-launch.cjs finds an installed @a-company/paradigm (PATH, then
 * the project root) and uses npx, from the plugin folder, only to locate a fetched one. These tests run it against
 * stub packages whose paradigm-mcp entry reports where and how it was started.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..', '..');
const PLUGIN = path.join(REPO, 'plugins', 'paradigm');
const LAUNCHER = path.join(PLUGIN, 'scripts', 'paradigm-mcp-launch.cjs');
const PLUGIN_VERSION: string = JSON.parse(fs.readFileSync(path.join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8')).version;

interface Seen { who: string; cwd: string; arg: string; npm: string[] }

let tmp: string;
let project: string;

const write = (file: string, body: string, mode = 0o644): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, { mode });
};

/** An @a-company/paradigm package under `nodeModules` whose paradigm-mcp entry prints what it saw. */
function stubPackage(nodeModules: string, who: string, version = PLUGIN_VERSION): string {
  const dir = path.join(nodeModules, '@a-company', 'paradigm');
  write(path.join(dir, 'package.json'), JSON.stringify({ name: '@a-company/paradigm', version, bin: { 'paradigm-mcp': './dist/mcp.js' } }));
  write(
    path.join(dir, 'dist', 'mcp.js'),
    `process.stdout.write(JSON.stringify({ who: ${JSON.stringify(who)}, cwd: process.cwd(), arg: process.argv[2],` +
      ` npm: Object.keys(process.env).filter((k) => k === 'INIT_CWD' || k.startsWith('npm_')) }));\n`,
  );
  return path.join(dir, 'dist', 'mcp.js');
}

/** A global install: <prefix>/lib/node_modules/@a-company/paradigm with <prefix>/bin/paradigm-mcp linked to it. */
function globalInstall(prefix: string, who: string, version?: string): string {
  const entry = stubPackage(path.join(prefix, 'lib', 'node_modules'), who, version);
  fs.mkdirSync(path.join(prefix, 'bin'), { recursive: true });
  fs.symlinkSync(entry, path.join(prefix, 'bin', 'paradigm-mcp'));
  return path.join(prefix, 'bin');
}

function launch(pathDirs: string[], extraEnv: Record<string, string> = {}) {
  const env = { PATH: [...pathDirs, '/usr/bin', '/bin'].join(path.delimiter), HOME: tmp, ...extraEnv };
  const r = spawnSync(process.execPath, [LAUNCHER, project], { cwd: tmp, env, encoding: 'utf8' });
  const seen = r.stdout ? (JSON.parse(r.stdout) as Seen) : null;
  return { status: r.status, stderr: r.stderr, seen };
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pm-launch-')));
  project = path.join(tmp, 'work', 'pnpm only');
  write(path.join(project, 'package.json'), JSON.stringify({ name: 'p', devEngines: { packageManager: { name: 'pnpm', onFail: 'error' } } }));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('plugin MCP launch', () => {
  it('.mcp.json starts the launcher with node and passes the project', () => {
    const { command, args } = JSON.parse(fs.readFileSync(path.join(PLUGIN, '.mcp.json'), 'utf8')).mcpServers.paradigm;
    expect(command).toBe('node');
    expect(args).toEqual(['${CLAUDE_PLUGIN_ROOT}/scripts/paradigm-mcp-launch.cjs', '${CLAUDE_PROJECT_DIR}']);
    expect(fs.existsSync(LAUNCHER)).toBe(true);
  });

  it('the plugin folder has no package.json for npm to apply devEngines from', () => {
    expect(fs.existsSync(path.join(PLUGIN, 'package.json'))).toBe(false);
  });

  describe.skipIf(process.platform === 'win32')('resolution (stub packages)', () => {
    it('a global install on PATH comes first (the hooks resolve `paradigm` the same way), run in the project', () => {
      stubPackage(path.join(project, 'node_modules'), 'local');
      const { status, seen } = launch([globalInstall(path.join(tmp, 'g'), 'global')]);
      expect(status).toBe(0);
      expect(seen).toEqual({ who: 'global', cwd: project, arg: project, npm: [] });
    });

    it("then the project's own node_modules/@a-company/paradigm", () => {
      stubPackage(path.join(project, 'node_modules'), 'local');
      const { status, seen } = launch([]);
      expect(status).toBe(0);
      expect(seen?.who).toBe('local');
      expect(seen?.cwd).toBe(project);
    });

    it('never a parent folder, and never a bare paradigm-mcp that is not @a-company/paradigm', () => {
      stubPackage(path.join(tmp, 'work', 'node_modules'), 'parent');
      write(path.join(project, 'node_modules', '.bin', 'paradigm-mcp'), '#!/bin/sh\necho planted\n', 0o755);
      write(path.join(tmp, 'stray', 'paradigm-mcp'), '#!/bin/sh\necho planted\n', 0o755);
      const { status, seen, stderr } = launch([path.join(tmp, 'stray')]);
      expect(seen).toBeNull();
      expect(status).toBe(1);
      expect(stderr).toContain('could not find or fetch @a-company/paradigm');
    });

    it('otherwise npx, from the plugin folder and pinned to the plugin version, only locates the package', () => {
      const bin = path.join(tmp, 'bin');
      const log = path.join(tmp, 'npx.log');
      const cache = path.join(tmp, 'npx-cache', 'node_modules');
      const shadow = path.join(tmp, 'ancestor', 'node_modules');
      stubPackage(cache, 'fetched');
      stubPackage(shadow, 'shadow', '0.0.1');
      // Like npm exec: an ancestor's node_modules/.bin before the fetched package's, npm_* env, run after `--`.
      write(
        path.join(bin, 'npx'),
        `#!/bin/sh\nprintf '%s|%s' "$(pwd -P)" "$*" > '${log}'\nwhile [ "$1" != "--" ]; do shift; done; shift\n` +
          `PATH='${shadow}/.bin:${cache}/.bin':$PATH INIT_CWD="$(pwd -P)" npm_command=exec npm_config_local_prefix="$(pwd -P)" exec "$@"\n`,
        0o755,
      );
      const { status, seen } = launch([bin]);
      expect(status).toBe(0);
      const [npxCwd, npxArgs] = fs.readFileSync(log, 'utf8').split('|');
      expect(npxCwd).toBe(fs.realpathSync(PLUGIN));
      expect(npxArgs).toContain(`--package=@a-company/paradigm@${PLUGIN_VERSION}`);
      expect(npxArgs).not.toContain('--prefix');
      // The fetched copy, not the ancestor's, started by the launcher in the project with none of npm's env.
      expect(seen).toEqual({ who: 'fetched', cwd: project, arg: project, npm: [] });
    });

    it('a version that differs from the plugin is used, and reported on stderr', () => {
      const { status, seen, stderr } = launch([globalInstall(path.join(tmp, 'g'), 'global', '7.0.0')]);
      expect(status).toBe(0);
      expect(seen?.who).toBe('global');
      expect(stderr).toContain(`using @a-company/paradigm 7.0.0`);
      expect(stderr).toContain(`this plugin is ${PLUGIN_VERSION}`);
    });
  });
});
