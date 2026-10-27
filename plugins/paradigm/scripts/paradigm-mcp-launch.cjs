#!/usr/bin/env node
'use strict';
/**
 * paradigm-mcp-launch.cjs — starts the plugin's Paradigm MCP server.
 *
 * npm 11 applies the nearest package.json's devEngines to npx, so `npx paradigm-mcp` run from a project that
 * requires pnpm (devEngines.packageManager onFail "error") exits EBADDEVENGINES and the server never starts.
 * `npx --prefix=<elsewhere>` avoids that but also moves npm's global prefix and globalconfig (a global install
 * and the user's global npmrc are ignored, and npm_config_prefix leaks into the server).
 *
 * So, in order:
 *   1. the project's own install (node_modules/.bin/paradigm-mcp from the project up)
 *   2. paradigm-mcp on PATH (a global install, the same one the hooks' `paradigm` comes from)
 *   3. npx from the plugin folder (no package.json), which runs this script again with --resolved so the
 *      fetched paradigm-mcp, now on PATH, starts like case 2
 * The server always runs with the project as its cwd and its argument.
 *
 * Usage: node paradigm-mcp-launch.cjs <project-dir>
 *        node paradigm-mcp-launch.cjs --resolved <project-dir>   (from npx only)
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WIN = process.platform === 'win32';
const BIN = 'paradigm-mcp';
const PLUGIN_ROOT = path.resolve(__dirname, '..');

function executable(p) {
  try {
    const st = fs.statSync(p);
    return st.isFile() && (WIN || (st.mode & 0o111) !== 0);
  } catch {
    return false;
  }
}

function binIn(dir) {
  for (const ext of WIN ? ['.cmd', '.exe', ''] : ['']) {
    const p = path.join(dir, BIN + ext);
    if (executable(p)) return p;
  }
  return null;
}

/** The project's own install: node_modules/.bin from the project up to the filesystem root. */
function localBin(project) {
  for (let d = project; ; d = path.dirname(d)) {
    const p = binIn(path.join(d, 'node_modules', '.bin'));
    if (p) return p;
    if (path.dirname(d) === d) return null;
  }
}

function pathBin(env) {
  for (const d of (env.PATH || env.Path || '').split(path.delimiter)) {
    if (!d || !path.isAbsolute(d)) continue;
    const p = binIn(d);
    if (p) return p;
  }
  return null;
}

/** Run with stdio passed straight through (it is the MCP transport); exit as the child exits. */
function run(cmd, args, cwd, env) {
  // A .cmd shim only starts through the shell on Windows (Node refuses to spawn one directly).
  const shell = WIN && /\.cmd$/i.test(cmd);
  const q = (s) => (shell ? `"${s}"` : s);
  const child = spawn(q(cmd), args.map(q), { cwd, env, stdio: 'inherit', shell });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => child.kill(sig));
  child.on('error', (e) => {
    process.stderr.write(`[paradigm] could not start ${cmd}: ${e.message}\n`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => process.exit(signal ? 128 + (os.constants.signals[signal] || 0) : (code ?? 1)));
}

const resolved = process.argv[2] === '--resolved';
const project = path.resolve(process.argv[resolved ? 3 : 2] || process.env.CLAUDE_PROJECT_DIR || process.cwd());

if (resolved) {
  // npx ran us from the plugin folder; drop the npm values that point there instead of at the project.
  const env = { ...process.env };
  for (const k of ['INIT_CWD', 'npm_config_local_prefix', 'npm_package_json']) delete env[k];
  const bin = pathBin(env);
  if (!bin) {
    process.stderr.write(`[paradigm] npx did not put ${BIN} on PATH; install with: npm i -g @a-company/paradigm\n`);
    process.exit(1);
  }
  run(bin, [project], project, env);
} else {
  const bin = localBin(project) || pathBin(process.env);
  if (bin) {
    run(bin, [project], project, process.env);
  } else {
    run(
      WIN ? 'npx.cmd' : 'npx',
      ['--yes', '--package=@a-company/paradigm', '--', process.execPath, __filename, '--resolved', project],
      PLUGIN_ROOT,
      process.env,
    );
  }
}
