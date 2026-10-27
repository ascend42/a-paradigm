#!/usr/bin/env node
'use strict';
/**
 * paradigm-mcp-launch.cjs — starts the plugin's Paradigm MCP server.
 *
 * npm 11 applies the nearest package.json's devEngines to npx, so `npx paradigm-mcp` run from a project that
 * requires pnpm (devEngines.packageManager onFail "error") exits EBADDEVENGINES and the server never starts.
 * `npx --prefix=<elsewhere>` avoids that but also moves npm's global prefix and globalconfig.
 *
 * The server is the paradigm-mcp entry of an @a-company/paradigm package, found in the same order the hooks find
 * the `paradigm` CLI, so both come from one install:
 *   1. paradigm-mcp on PATH (a global install)
 *   2. the project's own node_modules/@a-company/paradigm (the project root only, never a parent folder)
 *   3. npx from the plugin folder (no package.json), pinned to the plugin's version. npx only resolves or fetches
 *      the package: it runs this script with --locate, which prints the entry and exits.
 * This script then starts the entry with node, in the project, with its own environment (none of npm's). A
 * version that differs from the plugin's is reported on stderr.
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

const project = path.resolve(process.argv[2] || process.env.CLAUDE_PROJECT_DIR || process.cwd());
const want = readJson(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'))?.version ?? null;

function viaNpx() {
  const spec = want ? `${PKG}@${want}` : PKG;
  // npx.cmd only starts through the shell on Windows, so quote what may hold spaces (C:\Program Files\nodejs)
  const q = (s) => (WIN ? `"${s}"` : s);
  const r = spawnSync(
    WIN ? 'npx.cmd' : 'npx',
    ['--yes', `--package=${spec}`, '--', q(process.execPath), q(__filename), '--locate'],
    // stdout carries only the located entry; npm's own output goes to stderr (Claude Code's MCP log)
    { cwd: PLUGIN_ROOT, env: { ...process.env, PARADIGM_MCP_WANT: want ?? '' }, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', shell: WIN },
  );
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith(LOCATED));
  return line ? { entry: line.slice(LOCATED.length).trim(), version: want } : null;
}

const found = fromPath(process.env) || fromProject(project) || viaNpx();
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
