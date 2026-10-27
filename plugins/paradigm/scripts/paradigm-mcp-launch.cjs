#!/usr/bin/env node
'use strict';
/**
 * paradigm-mcp-launch.cjs — starts the plugin's Paradigm MCP server.
 *
 * npm 11 applies the nearest package.json's devEngines to npx, so `npx paradigm-mcp` run from a project that
 * requires pnpm (devEngines.packageManager onFail "error") exits EBADDEVENGINES and the server never starts.
 * `npx --prefix=<elsewhere>` avoids that but also moves npm's global prefix and globalconfig.
 *
 * The server is the paradigm-mcp entry of an @a-company/paradigm package, found in the order the hooks find the
 * `paradigm` CLI (scripts/paradigm-resolve.sh), so both come from one install:
 *   1. the project's own node_modules/@a-company/paradigm (the project root only, never a parent folder), so a
 *      project that pins Paradigm gets its version
 *   2. paradigm-mcp on PATH (a global install)
 *   3. npx pinned to the plugin's version (--prefer-offline), run from a folder of its own under the OS temp dir
 *      whose {"private":true} package.json stops npm's walk up to a project's devEngines. npx only resolves or
 *      fetches the package: it runs this script (`node <this file> --locate`), which prints the entry and exits.
 * This script then starts the entry with node, in the project, with its own environment (none of npm's). A
 * version that differs from the plugin's is reported on stderr.
 *
 * The project is argv[2] when it is an existing directory; otherwise (missing, or an unexpanded ${...}) the
 * expanded CLAUDE_PROJECT_DIR, then the current directory, and stderr says which.
 *
 * Usage: node paradigm-mcp-launch.cjs <project-dir>
 *        node paradigm-mcp-launch.cjs --locate   (from npx only)
 */

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WIN = process.platform === 'win32';
const PKG = '@a-company/paradigm';
const BIN = 'paradigm-mcp';
const PLUGIN_ROOT = path.resolve(__dirname, '..');
const LOCATED = 'PARADIGM_MCP_ENTRY=';

const say = (msg) => process.stderr.write(`[paradigm] ${msg}\n`);

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/** The paradigm-mcp entry of the @a-company/paradigm package in `dir`, or null. */
function packageAt(dir) {
  const pkg = readJson(path.join(dir, 'package.json'));
  if (!pkg || pkg.name !== PKG || !pkg.bin || typeof pkg.bin[BIN] !== 'string') return null;
  const entry = path.resolve(dir, pkg.bin[BIN]);
  return fs.existsSync(entry) ? { entry, version: typeof pkg.version === 'string' ? pkg.version : null } : null;
}

/** The package a bin file belongs to: its real path, up to the package.json named @a-company/paradigm. */
function packageOfBin(bin) {
  let d;
  try {
    d = path.dirname(fs.realpathSync(bin));
  } catch {
    return null;
  }
  for (; path.dirname(d) !== d; d = path.dirname(d)) {
    const found = packageAt(d);
    if (found) return found;
  }
  return null;
}

/** npm's Windows .cmd shims are not links: the package sits under node_modules beside the shim. */
function packageBesideShim(dir) {
  return packageAt(path.join(dir, 'node_modules', ...PKG.split('/')));
}

function fromPath(env) {
  for (const d of (env.PATH || env.Path || '').split(path.delimiter)) {
    if (!d || !path.isAbsolute(d)) continue;
    for (const name of WIN ? [`${BIN}.cmd`] : [BIN]) {
      const bin = path.join(d, name);
      if (!fs.existsSync(bin)) continue;
      const found = WIN ? packageBesideShim(d) : packageOfBin(bin);
      if (found) return found;
    }
  }
  return null;
}

const fromProject = (project) => packageAt(path.join(project, 'node_modules', ...PKG.split('/')));

if (process.argv[2] === '--locate') {
  // Run by npx: the fetched package's bin dir is on PATH. Prefer the one holding the pinned version, so a stray
  // copy in a parent folder's node_modules/.bin (npm puts those first) cannot shadow it.
  const want = process.env.PARADIGM_MCP_WANT;
  const dirs = (process.env.PATH || process.env.Path || '').split(path.delimiter).filter((d) => path.isAbsolute(d));
  let found = null;
  for (const d of dirs) {
    const p = path.basename(d) === '.bin' ? packageAt(path.join(path.dirname(d), ...PKG.split('/'))) : null;
    if (p && (!want || p.version === want)) {
      found = p;
      break;
    }
  }
  if (!found) process.exit(1);
  process.stdout.write(`${LOCATED}${found.entry}\n`);
  process.exit(0);
}

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const usableDir = (p) => typeof p === 'string' && p !== '' && !p.includes('${') && isDir(p);

/** argv[2] when usable, else an expanded CLAUDE_PROJECT_DIR, else the current directory (said on stderr). */
function projectDir(arg, env) {
  if (usableDir(arg)) return path.resolve(arg);
  const why = arg ? `project argument "${arg}" is not an existing directory` : 'no project argument';
  if (usableDir(env.CLAUDE_PROJECT_DIR)) {
    say(`${why}; using CLAUDE_PROJECT_DIR (${path.resolve(env.CLAUDE_PROJECT_DIR)})`);
    return path.resolve(env.CLAUDE_PROJECT_DIR);
  }
  say(`${why}; using the current directory (${process.cwd()})`);
  return process.cwd();
}

const project = projectDir(process.argv[2], process.env);
const want = readJson(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'))?.version ?? null;

/**
 * Where npx runs: a folder of its own whose package.json ends npm's walk up, so no project's devEngines (or
 * .npmrc) applies. Not PLUGIN_ROOT: a plugin checked out inside a pnpm-only repo would walk up into it. A folder
 * someone else owns (a shared /tmp) is not used; a fresh private one is made instead.
 */
function npxDir() {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const ours = (d) => {
    try {
      const st = fs.lstatSync(d);
      return st.isDirectory() && (uid === null || st.uid === uid);
    } catch {
      return false;
    }
  };
  let dir = path.join(os.tmpdir(), uid === null ? 'paradigm-mcp-npx' : `paradigm-mcp-npx-${uid}`);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!ours(dir)) dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-mcp-npx-'));
    const pkg = path.join(dir, 'package.json');
    if (readJson(pkg)?.private !== true) fs.writeFileSync(pkg, '{"private":true}\n');
    return dir;
  } catch (e) {
    say(`could not prepare a folder for npx under ${os.tmpdir()}: ${e.message}`);
    return null;
  }
}

function viaNpx() {
  const spec = want ? `${PKG}@${want}` : PKG;
  const cwd = npxDir();
  if (!cwd) return null;
  // npm runs `<command> <args>` through a shell and escapes only the args, so the command is the plain word
  // `node` and this file is an argument. npx.cmd only starts through cmd on Windows, so quote what may hold
  // spaces there.
  const q = (s) => (WIN ? `"${s}"` : s);
  const r = spawnSync(
    WIN ? 'npx.cmd' : 'npx',
    ['--yes', '--prefer-offline', `--package=${spec}`, '--', 'node', q(__filename), '--locate'],
    // stdout carries only the located entry; npm's own output goes to stderr (Claude Code's MCP log)
    {
      cwd,
      env: { ...process.env, PARADIGM_MCP_WANT: want ?? '' },
      stdio: ['ignore', 'pipe', 'inherit'],
      encoding: 'utf8',
      shell: WIN,
      timeout: 120000,
    },
  );
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith(LOCATED));
  if (line) return { entry: line.slice(LOCATED.length).trim(), version: want };
  const how = r.error
    ? r.error.message
    : r.signal
      ? `killed by ${r.signal}`
      : `exit ${r.status}${r.status === 0 ? ' without locating it' : ''}`;
  say(`npx could not provide ${spec} (${how})`);
  return null;
}

const found = fromProject(project) || fromPath(process.env) || viaNpx();
if (!found) {
  say(`could not find or fetch ${PKG}; install it with: npm i -g ${PKG}`);
  process.exit(1);
}
if (want && found.version && found.version !== want) {
  say(`using ${PKG} ${found.version} (${found.entry}); this plugin is ${want}`);
}

// stdio passes straight through: it is the MCP transport.
const child = spawn(process.execPath, [found.entry, project], { cwd: project, env: process.env, stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => child.kill(sig));
child.on('error', (e) => {
  say(`could not start ${found.entry}: ${e.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => process.exit(signal ? 128 + (os.constants.signals[signal] || 0) : (code ?? 1)));
