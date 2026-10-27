/**
 * The Claude Code plugin's MCP launch must start in a project whose devEngines require pnpm.
 *
 * npm 11 applies the nearest package.json's devEngines to npx. The plugin ran `npx paradigm-mcp` from the project,
 * so a repo with devEngines.packageManager pnpm and onFail "error" (e.g. a-atelier) made npx exit EBADDEVENGINES
 * and the plugin server showed as CONNECTION_CLOSED. `--prefix` was rejected: it also moves npm's global prefix and
 * globalconfig. plugins/paradigm/scripts/paradigm-mcp-launch.cjs finds an installed @a-company/paradigm (the project
 * root, then PATH) and uses npx, from a folder of its own that stops npm's walk up, only to locate a fetched one.
 *
 * These tests run it against stub packages whose paradigm-mcp entry reports where and how it was started, and one
 * stub npx (npx-stub.cjs below) that behaves like npm 11 on each OS: the nearest package.json's devEngines are
 * enforced; the --call string runs through the --script-shell (default: the bare word `sh`, or ComSpec / `cmd` on
 * Windows, looked up on the PATH npm builds) with every ancestor's node_modules/.bin on PATH, here even ahead of
 * the fetched package's (npm puts them after it: the worst case); cmd gets `/d /s /c <call>` verbatim, as npm's
 * promise-spawn does. On POSIX the launcher finds `npx` on PATH (a wrapper to the stub); on Windows it starts
 * npx-cli.js beside node, so the suite copies node.exe into a folder with spaces and puts the stub there.
 * scripts tests/e2e/plugin-mcp-launch-e2e.mjs does the same against real npm.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SYS_PATH, WIN, baseEnv, pathValue, realPath, tempDir } from '../src/test-shell-utils.js';

const REPO = path.resolve(__dirname, '..', '..', '..');
const PLUGIN = path.join(REPO, 'plugins', 'paradigm');
const LAUNCHER = path.join(PLUGIN, 'scripts', 'paradigm-mcp-launch.cjs');
const PLUGIN_VERSION: string = JSON.parse(fs.readFileSync(path.join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8')).version;
const TIMEOUT = WIN ? 180_000 : 30_000;

interface Seen { who: string; cwd: string; arg: string; npm: string[] }

const NPX_STUB = `'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const WIN = process.platform === 'win32';
const args = process.argv.slice(2);
const cwd = fs.realpathSync.native(process.cwd());
fs.writeFileSync(process.env.STUB_LOG, JSON.stringify({ cwd, args }));
for (let d = cwd; ; ) {
  const pj = path.join(d, 'package.json');
  if (fs.existsSync(pj)) {
    if (fs.readFileSync(pj, 'utf8').includes('devEngines')) { process.stderr.write('npm error code EBADDEVENGINES\\n'); process.exit(1); }
    break;
  }
  const up = path.dirname(d); if (up === d) break; d = up;
}
let shell = null, call = null;
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--script-shell=')) shell = args[i].slice('--script-shell='.length);
  else if (args[i] === '--call') { call = args[i + 1]; break; }
}
if (call === null) { process.stderr.write('stub npx: no --call\\n'); process.exit(9); }
const anc = [];
for (let d = cwd; ; ) { anc.push(path.join(d, 'node_modules', '.bin')); const up = path.dirname(d); if (up === d) break; d = up; }
const env = { ...process.env };
const key = Object.keys(env).find((k) => /^path$/i.test(k)) || 'PATH';
env[key] = [...anc, path.join(process.env.STUB_CACHE, '.bin'), env[key] || ''].join(path.delimiter);
Object.assign(env, { INIT_CWD: cwd, npm_command: 'exec', npm_config_local_prefix: cwd });
if (!shell) shell = WIN ? (process.env.ComSpec || 'cmd') : 'sh';
const isCmd = /(?:^|\\\\)cmd(?:\\.exe)?$/i.test(shell);
const r = spawnSync(shell, isCmd ? ['/d', '/s', '/c', call] : ['-c', call], { stdio: 'inherit', env, cwd, windowsVerbatimArguments: isCmd });
process.exit(r.status === null ? 1 : r.status);
`;

let suite: string; // per-file: the stub npx, and (Windows) node.exe copies
let stubBin: string; // POSIX: dir with an `npx` wrapper to the stub
let nodeWithNpx: string; // the node the launcher runs under when npx is in play (Windows: a copy, spaces in its path)
let nodeWithoutNpx: string; // Windows: a node copy with no npx-cli.js beside it

let tmp: string;
let project: string;

const write = (file: string, body: string, mode = 0o644): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, { mode });
};

beforeAll(() => {
  suite = tempDir('pm launch-suite-');
  const stub = path.join(suite, 'npx-stub.cjs');
  write(stub, NPX_STUB);
  if (WIN) {
    nodeWithNpx = path.join(suite, 'node dir', 'node.exe');
    write(path.join(suite, 'node dir', 'node_modules', 'npm', 'bin', 'npx-cli.js'), NPX_STUB);
    fs.copyFileSync(process.execPath, nodeWithNpx);
    nodeWithoutNpx = path.join(suite, 'bare node', 'node.exe');
    fs.mkdirSync(path.dirname(nodeWithoutNpx), { recursive: true });
    fs.copyFileSync(process.execPath, nodeWithoutNpx);
  } else {
    nodeWithNpx = process.execPath;
    nodeWithoutNpx = process.execPath;
    stubBin = path.join(suite, 'bin');
    write(path.join(stubBin, 'npx'), `#!/bin/sh\nexec '${process.execPath}' '${stub}' "$@"\n`, 0o755);
  }
}, TIMEOUT);
afterAll(() => fs.rmSync(suite, { recursive: true, force: true }));

/** An @a-company/paradigm package under `nodeModules` whose paradigm-mcp entry prints what it saw. */
function stubPackage(nodeModules: string, who: string, version = PLUGIN_VERSION): string {
  const dir = path.join(nodeModules, '@a-company', 'paradigm');
  write(path.join(dir, 'package.json'), JSON.stringify({ name: '@a-company/paradigm', version, bin: { 'paradigm-mcp': './dist/mcp.js' } }));
  write(
    path.join(dir, 'dist', 'mcp.js'),
    `process.stdout.write(JSON.stringify({ who: ${JSON.stringify(who)}, cwd: process.cwd(), arg: process.argv[2],` +
      ` npm: Object.keys(process.env).filter((k) => k === 'INIT_CWD' || k.startsWith('npm_')) }));\n`,
  );
  // Explicit modes: the launcher only takes an npx-located package that is not group/world-writable.
  fs.chmodSync(dir, 0o755);
  fs.chmodSync(path.join(dir, 'dist'), 0o755);
  return path.join(dir, 'dist', 'mcp.js');
}

/**
 * A global install, as npm lays it out. POSIX: <prefix>/lib/node_modules/@a-company/paradigm with
 * <prefix>/bin/paradigm-mcp linked to its entry. Windows: <prefix>\paradigm-mcp.cmd (a shim, not a link) with the
 * package beside it in <prefix>\node_modules (packageBesideShim). Returns the dir to put on PATH.
 */
function globalInstall(prefix: string, who: string, version?: string): string {
  if (WIN) {
    stubPackage(path.join(prefix, 'node_modules'), who, version);
    write(path.join(prefix, 'paradigm-mcp.cmd'), '@ECHO off\r\nnode "%~dp0\\node_modules\\@a-company\\paradigm\\dist\\mcp.js" %*\r\n');
    return prefix;
  }
  const entry = stubPackage(path.join(prefix, 'lib', 'node_modules'), who, version);
  fs.mkdirSync(path.join(prefix, 'bin'), { recursive: true });
  fs.symlinkSync(entry, path.join(prefix, 'bin', 'paradigm-mcp'));
  return path.join(prefix, 'bin');
}

function launch(
  pathDirs: string[],
  extraEnv: Record<string, string> = {},
  opts: { launcher?: string; args?: string[]; cwd?: string; node?: string } = {},
) {
  // TMPDIR (POSIX) / TEMP, TMP (Windows) keep the launcher's npx folder inside this test's sandbox.
  const env = {
    ...baseEnv(),
    PATH: pathValue([...pathDirs, ...SYS_PATH]),
    HOME: tmp,
    USERPROFILE: tmp,
    TMPDIR: tmp,
    TEMP: tmp,
    TMP: tmp,
    ...extraEnv,
  };
  const args = opts.args ?? [project];
  // Default node: one with no npx reachable. On Windows the launcher starts npx-cli.js beside node, and the
  // runner's own node has it, so without this a "nothing installed" case fetches the real package from npm
  // (CI run 40561919605: 75 s, then the real server exits 0 on stdin EOF). POSIX: SYS_PATH has no npx.
  const r = spawnSync(opts.node ?? nodeWithoutNpx, [opts.launcher ?? LAUNCHER, ...args], {
    cwd: opts.cwd ?? tmp,
    env,
    encoding: 'utf8',
    timeout: TIMEOUT,
  });
  let seen: Seen | null = null;
  try {
    seen = r.stdout ? (JSON.parse(r.stdout) as Seen) : null;
  } catch {
    throw new Error(`launcher stdout is not the stub's JSON:\n${r.stdout}\nstderr:\n${r.stderr}`);
  }
  return { status: r.status, stderr: r.stderr, seen };
}

/** The fixed folder the launcher runs npx from (os.tmpdir() is tmp here). */
const npxHome = (): string => path.join(tmp, typeof process.getuid === 'function' ? `paradigm-mcp-npx-${process.getuid()}` : 'paradigm-mcp-npx');

interface Npx { pathDirs: string[]; env: Record<string, string>; node: string; log: string; cache: string }

/** The stub npx plus a fetched copy in its cache. */
function npxWithCache(): Npx {
  const log = path.join(tmp, 'npx.log');
  const cache = path.join(tmp, 'npx-cache', 'node_modules');
  stubPackage(cache, 'fetched');
  return { pathDirs: WIN ? [] : [stubBin], env: { STUB_LOG: log, STUB_CACHE: cache }, node: nodeWithNpx, log, cache };
}

const npxLog = (npx: Npx): { cwd: string; args: string[] } => JSON.parse(fs.readFileSync(npx.log, 'utf8'));

const quoted = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** The --script-shell and --call the launcher must hand npx, for this platform. */
function expectedCall(node: string, launcher: string): string[] {
  if (WIN) {
    const shell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
    return [`--script-shell=${shell}`, `--call`, `""${node}" "${launcher}" --locate"`];
  }
  return ['--script-shell=/bin/sh', '--call', `${quoted(node)} ${quoted(launcher)} --locate`];
}

/** Executables a hostile user could plant in an ancestor's node_modules/.bin; each drops a marker if it runs. */
function plantAncestorShims(dir: string, evil: string): string[] {
  const markers: string[] = [];
  for (const name of WIN ? ['node', 'sh', 'cmd'] : ['node', 'sh']) {
    const marker = path.join(tmp, `planted-${name}-ran`);
    markers.push(marker);
    if (WIN) {
      write(path.join(dir, 'node_modules', '.bin', `${name}.cmd`), `@echo off\r\ntype nul > "${marker}"\r\necho PARADIGM_MCP_ENTRY=${evil}\r\n`);
    } else {
      write(path.join(dir, 'node_modules', '.bin', name), `#!/bin/sh\n: > '${marker}'\necho 'PARADIGM_MCP_ENTRY=${evil}'\n`, 0o755);
    }
  }
  return markers;
}

/** A copy of the launcher (and plugin.json) at `pluginDir`. */
function copyPlugin(pluginDir: string): string {
  const launcher = path.join(pluginDir, 'scripts', 'paradigm-mcp-launch.cjs');
  write(launcher, fs.readFileSync(LAUNCHER, 'utf8'));
  write(path.join(pluginDir, '.claude-plugin', 'plugin.json'), JSON.stringify({ version: PLUGIN_VERSION }));
  return launcher;
}

beforeEach(() => {
  tmp = tempDir('pm-launch-');
  project = path.join(tmp, 'work', 'pnpm only');
  write(path.join(project, 'package.json'), JSON.stringify({ name: 'p', devEngines: { packageManager: { name: 'pnpm', onFail: 'error' } } }));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('plugin MCP launch', { timeout: TIMEOUT }, () => {
  it('.mcp.json starts the launcher with node and passes the project', () => {
    const { command, args } = JSON.parse(fs.readFileSync(path.join(PLUGIN, '.mcp.json'), 'utf8')).mcpServers.paradigm;
    expect(command).toBe('node');
    expect(args).toEqual(['${CLAUDE_PLUGIN_ROOT}/scripts/paradigm-mcp-launch.cjs', '${CLAUDE_PROJECT_DIR}']);
    expect(fs.existsSync(LAUNCHER)).toBe(true);
  });

  it('the plugin folder has no package.json for npm to apply devEngines from', () => {
    expect(fs.existsSync(path.join(PLUGIN, 'package.json'))).toBe(false);
  });

  it('the launcher is checked out with LF line endings', () => {
    expect(fs.readFileSync(LAUNCHER, 'utf8')).not.toContain('\r');
  });

  describe('resolution (stub packages)', () => {
    it("the project's own node_modules/@a-company/paradigm comes first, even with a global install on PATH", () => {
      stubPackage(path.join(project, 'node_modules'), 'local');
      const { status, seen } = launch([globalInstall(path.join(tmp, 'g'), 'global')]);
      expect(status).toBe(0);
      expect(seen).toEqual({ who: 'local', cwd: project, arg: project, npm: [] });
    });

    it('a project copy committed to git is skipped, and said', () => {
      stubPackage(path.join(project, 'node_modules'), 'local');
      spawnSync('git', ['init', '-q', project]);
      spawnSync('git', ['add', '-f', 'node_modules/@a-company/paradigm/package.json'], { cwd: project });
      const { status, seen, stderr } = launch([globalInstall(path.join(tmp, 'g'), 'global')]);
      expect(status).toBe(0);
      expect(seen?.who).toBe('global');
      expect(stderr).toContain('it is committed to git');
    });

    it('a project with a .git that git cannot read: the project copy is skipped, and said', () => {
      stubPackage(path.join(project, 'node_modules'), 'local');
      write(path.join(project, '.git'), 'gitdir: /nonexistent/paradigm-test\n');
      const { status, seen, stderr } = launch([globalInstall(path.join(tmp, 'g'), 'global')]);
      expect(status).toBe(0);
      expect(seen?.who).toBe('global');
      expect(stderr).toContain('git could not say whether it is committed');
    });

    it(`then a global install on PATH (${WIN ? 'the package beside the paradigm-mcp.cmd shim' : 'paradigm-mcp linked into the package'}), run in the project`, () => {
      const { status, seen } = launch([globalInstall(path.join(tmp, 'g'), 'global')]);
      expect(status).toBe(0);
      expect(seen).toEqual({ who: 'global', cwd: project, arg: project, npm: [] });
    });

    it('no npx reachable by default in these tests (a real npm fetch would hide resolution bugs)', () => {
      const { stderr } = launch([]);
      if (WIN) expect(stderr).toContain('npx-cli.js not found beside node');
      else expect(stderr).toMatch(/npx could not provide .*\(spawnSync npx ENOENT\)/);
    });

    it('never a parent folder, and never a bare paradigm-mcp that is not @a-company/paradigm', () => {
      stubPackage(path.join(tmp, 'work', 'node_modules'), 'parent');
      const shim = WIN ? 'paradigm-mcp.cmd' : 'paradigm-mcp';
      const body = WIN ? '@echo planted\r\n' : '#!/bin/sh\necho planted\n';
      write(path.join(project, 'node_modules', '.bin', shim), body, 0o755);
      write(path.join(tmp, 'stray', shim), body, 0o755);
      const { status, seen, stderr } = launch([path.join(tmp, 'stray')]);
      expect(seen).toBeNull();
      expect(status).toBe(1);
      expect(stderr).toContain('could not find or fetch @a-company/paradigm');
    });

    it(`otherwise npx, from its own folder${WIN ? ' under %TEMP%' : ''}, pinned; node, launcher and shell by absolute path; ancestors are ignored`, () => {
      const npx = npxWithCache();
      // An ancestor of the npx folder that requires pnpm, the way npm 11 would see it; planted executables and a
      // version-matched @a-company/paradigm in the same ancestor's node_modules (anyone can write to /tmp).
      write(path.join(tmp, 'package.json'), JSON.stringify({ name: 'pnpm-only', devEngines: { packageManager: { name: 'pnpm', onFail: 'error' } } }));
      const evil = path.join(tmp, 'evil.js');
      write(evil, `require('fs').writeFileSync(${JSON.stringify(path.join(tmp, 'evil-ran'))}, '')\n`);
      const markers = plantAncestorShims(tmp, evil);
      stubPackage(path.join(tmp, 'node_modules'), 'ancestor');

      const { status, seen, stderr } = launch(npx.pathDirs, npx.env, { node: npx.node });
      expect(stderr).not.toContain('EBADDEVENGINES');
      expect(status).toBe(0);
      const log = npxLog(npx);
      expect(log.cwd).toBe(realPath(npxHome()));
      expect(fs.readFileSync(path.join(npxHome(), 'package.json'), 'utf8')).toBe('{"private":true}\n');
      expect(log.args).toEqual([
        '--yes',
        '--prefer-offline',
        expectedCall(npx.node, LAUNCHER)[0],
        `--package=@a-company/paradigm@${PLUGIN_VERSION}`,
        ...expectedCall(npx.node, LAUNCHER).slice(1),
      ]);
      for (const m of markers) expect(fs.existsSync(m), m).toBe(false);
      expect(fs.existsSync(path.join(tmp, 'evil-ran'))).toBe(false);
      // The fetched copy, not the ancestor's, started by the launcher in the project with none of npm's env.
      expect(seen).toEqual({ who: 'fetched', cwd: project, arg: project, npm: [] });
    });

    it(`npx re-enters a launcher whose path has spaces${WIN ? ', through cmd /d /s /c, from a node path with spaces' : ' and a quote'}`, () => {
      const launcher = copyPlugin(path.join(tmp, 'Application Support', WIN ? 'plugin copy' : "plugin's copy"));
      const npx = npxWithCache();
      if (WIN) expect(npx.node).toContain(' ');
      const { status, seen, stderr } = launch(npx.pathDirs, npx.env, { launcher, node: npx.node });
      expect(stderr).toBe('');
      expect(status).toBe(0);
      expect(npxLog(npx).args.slice(-2)).toEqual(expectedCall(npx.node, launcher).slice(1));
      expect(seen?.who).toBe('fetched');
    });

    it.skipIf(!WIN)('Windows: no npx-cli.js beside node means no npx step, and says so', () => {
      const npx = npxWithCache();
      const { status, seen, stderr } = launch(npx.pathDirs, npx.env, { node: nodeWithoutNpx });
      expect(seen).toBeNull();
      expect(status).toBe(1);
      expect(stderr).toContain('npx-cli.js not found beside node');
      expect(fs.existsSync(npx.log)).toBe(false);
    });

    // `"` cannot occur in a Windows file name, so % ^ and ! are what a plugin path can carry.
    it.skipIf(!WIN).each(['%', '^', '!'])('Windows: a launcher path holding %s is refused before cmd sees it', (ch) => {
      const launcher = copyPlugin(path.join(tmp, `plugin${ch}dir`));
      const npx = npxWithCache();
      const { status, seen, stderr } = launch(npx.pathDirs, npx.env, { launcher, node: npx.node });
      expect(seen).toBeNull();
      expect(status).toBe(1);
      expect(stderr).toContain('holds a character cmd would reinterpret');
      expect(fs.existsSync(npx.log)).toBe(false);
    });

    // POSIX only: the stub's default shell is the bare word `sh` looked up on the built PATH. On Windows npm's
    // default is ComSpec (an absolute path) and node only searches .com/.exe, so a planted .cmd is not reachable.
    it.skipIf(WIN)('without --script-shell the stub would run a planted ancestor sh (the stub is faithful)', () => {
      const npx = npxWithCache();
      write(path.join(tmp, 'node_modules', '.bin', 'sh'), `#!/bin/sh\n: > '${path.join(tmp, 'planted-sh-ran')}'\n`, 0o755);
      spawnSync(process.execPath, [path.join(suite, 'npx-stub.cjs'), '--call', 'true'], {
        cwd: tmp,
        env: { PATH: '/usr/bin:/bin', ...npx.env },
      });
      expect(fs.existsSync(path.join(tmp, 'planted-sh-ran'))).toBe(true);
    });

    // POSIX only from here: owner and mode bits (Windows has no such bits; the launcher skips those checks there).
    it.skipIf(WIN)('a fetched copy that is group-writable is used when its group is the primary group (umask 002)', () => {
      const npx = npxWithCache();
      const pkgDir = path.join(npx.cache, '@a-company', 'paradigm');
      for (const p of [pkgDir, path.join(pkgDir, 'dist', 'mcp.js')]) {
        fs.chownSync(p, process.getuid!(), process.getgid!());
        fs.chmodSync(p, 0o775);
      }
      const { status, seen } = launch(npx.pathDirs, npx.env);
      expect(status).toBe(0);
      expect(seen?.who).toBe('fetched');
    });

    const otherGroup = typeof process.getgroups === 'function' ? process.getgroups().find((g) => g !== process.getgid!()) : undefined;
    it.skipIf(WIN || otherGroup === undefined)('a fetched copy group-writable by another group is not used', () => {
      const npx = npxWithCache();
      const pkgDir = path.join(npx.cache, '@a-company', 'paradigm');
      fs.chownSync(pkgDir, process.getuid!(), otherGroup!);
      fs.chmodSync(pkgDir, 0o775);
      const { status, seen } = launch(npx.pathDirs, npx.env);
      expect(seen).toBeNull();
      expect(status).toBe(1);
    });

    it.skipIf(WIN)('a fetched copy that is world-writable is not used', () => {
      const npx = npxWithCache();
      fs.chmodSync(path.join(npx.cache, '@a-company', 'paradigm'), 0o777);
      const { status, seen, stderr } = launch(npx.pathDirs, npx.env);
      expect(seen).toBeNull();
      expect(status).toBe(1);
      expect(stderr).toContain(`npx could not provide @a-company/paradigm@${PLUGIN_VERSION} (exit 1)`);
    });

    it.skipIf(WIN)('with a shared sticky temp dir, npx runs from the per-user cache (XDG_CACHE_HOME, else ~/.cache)', () => {
      const shared = path.join(tmp, 'shared-tmp');
      fs.mkdirSync(shared);
      fs.chmodSync(shared, 0o1777);
      for (const [extra, expected] of [
        [{ XDG_CACHE_HOME: path.join(tmp, 'xdg') }, path.join(tmp, 'xdg', 'paradigm', 'npx')],
        [{}, path.join(tmp, '.cache', 'paradigm', 'npx')],
      ] as const) {
        const npx = npxWithCache();
        const { status, seen } = launch(npx.pathDirs, { ...npx.env, TMPDIR: shared, ...extra });
        expect(status).toBe(0);
        expect(seen?.who).toBe('fetched');
        expect(npxLog(npx).cwd).toBe(realPath(expected));
        expect(fs.statSync(path.dirname(expected)).mode & 0o777).toBe(0o700);
      }
    });

    describe('the fixed npx folder is used only when it is safe; otherwise a fresh one', () => {
      const fresh = (npx: Npx): string => {
        const cwd = npxLog(npx).cwd;
        expect(cwd).not.toBe(path.join(realPath(tmp), path.basename(npxHome())));
        expect(path.basename(cwd)).toMatch(/^paradigm-mcp-npx-/);
        return cwd;
      };

      it.skipIf(WIN)('group/world-writable', () => {
        fs.mkdirSync(npxHome());
        fs.chmodSync(npxHome(), 0o777);
        const npx = npxWithCache();
        const { status, seen } = launch(npx.pathDirs, npx.env);
        expect(status).toBe(0);
        expect(seen?.who).toBe('fetched');
        fresh(npx);
      });

      it('holding a .npmrc (or anything but its package.json)', () => {
        fs.mkdirSync(npxHome(), { mode: 0o700 });
        write(path.join(npxHome(), '.npmrc'), 'registry=http://attacker.invalid/\n');
        const npx = npxWithCache();
        const { status } = launch(npx.pathDirs, npx.env, { node: npx.node });
        expect(status).toBe(0);
        expect(fs.readdirSync(fresh(npx))).toEqual(['package.json']);
      });

      // Symlinks need a privilege on Windows.
      it.skipIf(WIN)('a dangling symlink at the fixed name', () => {
        fs.symlinkSync(path.join(tmp, 'nowhere'), npxHome());
        const npx = npxWithCache();
        const { status, seen } = launch(npx.pathDirs, npx.env);
        expect(status).toBe(0);
        expect(seen?.who).toBe('fetched');
        fresh(npx);
        expect(fs.existsSync(path.join(tmp, 'nowhere'))).toBe(false);
      });
    });

    it('an npx failure is reported with its exit status', () => {
      const npx = npxWithCache();
      // The stub cannot write its log there, so it exits 1 before doing anything.
      const failing = { ...npx.env, STUB_LOG: path.join(tmp, 'no-such-dir', 'npx.log') };
      const { status, stderr } = launch(npx.pathDirs, failing, { node: npx.node });
      expect(status).toBe(1);
      expect(stderr).toContain(`npx could not provide @a-company/paradigm@${PLUGIN_VERSION} (exit 1)`);
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
