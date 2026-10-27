/**
 * The Claude Code plugin's MCP launch must start in a project whose devEngines require pnpm.
 *
 * npm 11 applies the nearest package.json's devEngines to npx. The plugin ran `npx paradigm-mcp` from the project,
 * so a repo with devEngines.packageManager pnpm and onFail "error" (e.g. a-atelier) made npx exit EBADDEVENGINES
 * and the plugin server showed as CONNECTION_CLOSED. `--prefix` was rejected: it also moves npm's global prefix and
 * globalconfig. plugins/paradigm/scripts/paradigm-mcp-launch.cjs finds an installed @a-company/paradigm (the project
 * root, then PATH) and uses npx, from a temp folder of its own that stops npm's walk up, only to locate a fetched one.
 * These tests run it against stub packages whose paradigm-mcp entry reports where and how it was started, and a stub
 * npx that behaves like npm 11 (nearest package.json's devEngines enforced; the command run unescaped, args escaped).
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

function launch(
  pathDirs: string[],
  extraEnv: Record<string, string> = {},
  opts: { launcher?: string; args?: string[]; cwd?: string } = {},
) {
  // TMPDIR keeps the launcher's npx folder inside this test's sandbox.
  const env = { PATH: [...pathDirs, '/usr/bin', '/bin'].join(path.delimiter), HOME: tmp, TMPDIR: tmp, ...extraEnv };
  const args = opts.args ?? [project];
  const r = spawnSync(process.execPath, [opts.launcher ?? LAUNCHER, ...args], { cwd: opts.cwd ?? tmp, env, encoding: 'utf8' });
  const seen = r.stdout ? (JSON.parse(r.stdout) as Seen) : null;
  return { status: r.status, stderr: r.stderr, seen };
}

/** The folder the launcher runs npx from (os.tmpdir() is TMPDIR = tmp here). */
const npxHome = (): string => path.join(tmp, typeof process.getuid === 'function' ? `paradigm-mcp-npx-${process.getuid()}` : 'paradigm-mcp-npx');

/**
 * A stub npx that behaves like npm 11's: it fails EBADDEVENGINES when the nearest package.json (walking up from its
 * cwd) has devEngines, and runs `<command> <args>` through sh with only the args escaped. The fetched package's .bin
 * is put on PATH after an ancestor's, with npm's env. Logs "<cwd>|<args>" to `log`.
 */
function stubNpx(bin: string, log: string, cache: string, shadow: string): void {
  write(
    path.join(bin, 'npx'),
    `#!/bin/sh
printf '%s|%s' "$(pwd -P)" "$*" > '${log}'
d=$(pwd -P)
while :; do
  if [ -f "$d/package.json" ]; then
    grep -q devEngines "$d/package.json" && { echo 'npm error code EBADDEVENGINES' >&2; exit 1; }
    break
  fi
  [ "$d" = / ] && break
  d=$(dirname "$d")
done
while [ "$1" != "--" ]; do shift; done; shift
script=$1; shift
for a in "$@"; do script="$script '$(printf %s "$a" | sed "s/'/'\\\\\\\\''/g")'"; done
PATH='${shadow}/.bin:${cache}/.bin:${path.dirname(process.execPath)}':$PATH INIT_CWD="$(pwd -P)" npm_command=exec npm_config_local_prefix="$(pwd -P)" exec sh -c "$script"
`,
    0o755,
  );
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
    it("the project's own node_modules/@a-company/paradigm comes first, even with a global install on PATH", () => {
      stubPackage(path.join(project, 'node_modules'), 'local');
      const { status, seen } = launch([globalInstall(path.join(tmp, 'g'), 'global')]);
      expect(status).toBe(0);
      expect(seen).toEqual({ who: 'local', cwd: project, arg: project, npm: [] });
    });

    it('then a global install on PATH (the hooks resolve `paradigm` the same way), run in the project', () => {
      const { status, seen } = launch([globalInstall(path.join(tmp, 'g'), 'global')]);
      expect(status).toBe(0);
      expect(seen).toEqual({ who: 'global', cwd: project, arg: project, npm: [] });
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

    it('otherwise npx, from its own temp folder, pinned to the plugin version, only locates the package', () => {
      const bin = path.join(tmp, 'bin');
      const log = path.join(tmp, 'npx.log');
      const cache = path.join(tmp, 'npx-cache', 'node_modules');
      const shadow = path.join(tmp, 'ancestor', 'node_modules');
      stubPackage(cache, 'fetched');
      stubPackage(shadow, 'shadow', '0.0.1');
      // An ancestor of the temp folder (and of the plugin) that requires pnpm, the way npm 11 would see it.
      write(path.join(tmp, 'package.json'), JSON.stringify({ name: 'pnpm-only', devEngines: { packageManager: { name: 'pnpm', onFail: 'error' } } }));
      stubNpx(bin, log, cache, shadow);
      const { status, seen, stderr } = launch([bin]);
      expect(stderr).not.toContain('EBADDEVENGINES');
      expect(status).toBe(0);
      const [npxCwd, npxArgs] = fs.readFileSync(log, 'utf8').split('|');
      expect(npxCwd).toBe(fs.realpathSync(npxHome()));
      expect(JSON.parse(fs.readFileSync(path.join(npxHome(), 'package.json'), 'utf8'))).toEqual({ private: true });
      expect(npxArgs).toContain(`--prefer-offline --package=@a-company/paradigm@${PLUGIN_VERSION} -- node ${LAUNCHER} --locate`);
      expect(npxArgs).not.toContain('--prefix');
      // The fetched copy, not the ancestor's, started by the launcher in the project with none of npm's env.
      expect(seen).toEqual({ who: 'fetched', cwd: project, arg: project, npm: [] });
    });

    it('npx re-enters a launcher whose path has spaces (node is the command, the launcher an escaped argument)', () => {
      const plugin = path.join(tmp, 'Application Support', "plugin's copy");
      const launcher = path.join(plugin, 'scripts', 'paradigm-mcp-launch.cjs');
      write(launcher, fs.readFileSync(LAUNCHER, 'utf8'));
      write(path.join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ version: PLUGIN_VERSION }));
      const bin = path.join(tmp, 'bin');
      const log = path.join(tmp, 'npx.log');
      const cache = path.join(tmp, 'npx-cache', 'node_modules');
      stubPackage(cache, 'fetched');
      stubNpx(bin, log, cache, path.join(tmp, 'none'));
      const { status, seen } = launch([bin], {}, { launcher });
      expect(status).toBe(0);
      expect(fs.readFileSync(log, 'utf8')).toContain(`-- node ${launcher} --locate`);
      expect(seen?.who).toBe('fetched');
    });

    it('an npx failure is reported with its exit status', () => {
      const bin = path.join(tmp, 'bin');
      write(path.join(bin, 'npx'), '#!/bin/sh\nexit 7\n', 0o755);
      const { status, stderr } = launch([bin]);
      expect(status).toBe(1);
      expect(stderr).toContain(`npx could not provide @a-company/paradigm@${PLUGIN_VERSION} (exit 7)`);
      expect(stderr).toContain('could not find or fetch @a-company/paradigm');
    });

    it('an unexpanded ${CLAUDE_PROJECT_DIR} argument falls back to the CLAUDE_PROJECT_DIR env, and says so', () => {
      stubPackage(path.join(project, 'node_modules'), 'local');
      const { status, seen, stderr } = launch([], { CLAUDE_PROJECT_DIR: project }, { args: ['${CLAUDE_PROJECT_DIR}'] });
      expect(status).toBe(0);
      expect(seen).toEqual({ who: 'local', cwd: project, arg: project, npm: [] });
      expect(stderr).toContain('project argument "${CLAUDE_PROJECT_DIR}" is not an existing directory; using CLAUDE_PROJECT_DIR');
    });

    it('no usable argument or env falls back to the current directory, and says so', () => {
      stubPackage(path.join(project, 'node_modules'), 'local');
      const { status, seen, stderr } = launch([], { CLAUDE_PROJECT_DIR: '${CLAUDE_PROJECT_DIR}' }, { args: [], cwd: project });
      expect(status).toBe(0);
      expect(seen).toEqual({ who: 'local', cwd: project, arg: project, npm: [] });
      expect(stderr).toContain('no project argument; using the current directory');
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
