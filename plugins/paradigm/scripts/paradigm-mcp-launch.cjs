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
 *   1. the project's own node_modules/@a-company/paradigm (the project root only, never a parent folder, and never
 *      a copy committed to git), so a project that pins Paradigm gets its version
 *   2. paradigm-mcp on PATH (a global install)
 *   3. npx pinned to the plugin's version (--prefer-offline), run from a folder of its own under the OS temp dir
 *      whose {"private":true} package.json stops npm's walk up to a project's devEngines. npx only resolves or
 *      fetches the package: through --call it runs this script with this node (both paths quoted here, so npm
 *      resolves no command on PATH, where every ancestor's node_modules/.bin comes first), and --locate prints
 *      the entry of the fetched package and exits.
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
const UID = typeof process.getuid === 'function' ? process.getuid() : null;

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

/** True when git tracks a copy of the package in the project (quietly false outside a git repo). */
function committedToGit(project) {
  const r = spawnSync('git', ['ls-files', '--', 'node_modules/@a-company/paradigm', `node_modules/.bin/${BIN}`], {
    cwd: project,
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf8',
  });
  return r.status === 0 && (r.stdout || '').trim() !== '';
}

function fromProject(project) {
  const found = packageAt(path.join(project, 'node_modules', ...PKG.split('/')));
  if (!found) return null;
  if (committedToGit(project)) {
    say(`not using ${PKG} in ${project}/node_modules: it is committed to git`);
    return null;
  }
  return found;
}

/** POSIX: the real path is ours and not writable by group or others. Windows has no such bits to check. */
function ownedAndPrivate(p) {
  if (WIN || UID === null) return true;
  try {
    const st = fs.statSync(fs.realpathSync(p));
    return st.uid === UID && (st.mode & 0o022) === 0;
  } catch {
    return false;
  }
}

if (process.argv[2] === '--locate') {
  // Run by npx, in its cwd: the fetched package's bin dir is on PATH, after npm's own bin paths and before every
  // ancestor's node_modules/.bin. Take the copy holding the pinned version, skip any .bin that belongs to the npx
  // cwd or one of its ancestors (anyone who can write to /tmp or C:\ could plant one there), and require the
  // package to be ours and not group/world-writable.
  const want = process.env.PARADIGM_MCP_WANT;
  const ancestors = new Set();
  for (let d = process.cwd(); ; d = path.dirname(d)) {
    ancestors.add(d);
    try {
      ancestors.add(fs.realpathSync(d));
    } catch {
      /* gone: the plain path is enough */
    }
    if (path.dirname(d) === d) break;
  }
  const dirs = (process.env.PATH || process.env.Path || '').split(path.delimiter).filter((d) => path.isAbsolute(d));
  let found = null;
  for (const d of dirs) {
    if (path.basename(d) !== '.bin') continue;
    const owner = path.dirname(path.dirname(d)); // <owner>/node_modules/.bin
    if (ancestors.has(owner)) continue;
    const pkgDir = path.join(path.dirname(d), ...PKG.split('/'));
    const p = packageAt(pkgDir);
    if (p && (!want || p.version === want) && ownedAndPrivate(pkgDir) && ownedAndPrivate(p.entry)) {
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

const NPX_PKG_JSON = '{"private":true}\n';

/**
 * Where npx runs: a folder of its own whose package.json ends npm's walk up, so no project's devEngines (or
 * .npmrc) applies. Not PLUGIN_ROOT: a plugin checked out inside a pnpm-only repo would walk up into it.
 * The fixed <tmp>/paradigm-mcp-npx-<uid> is used only when it is a real directory (lstat: never a symlink), ours,
 * not group/world-writable, and holds nothing but its package.json (npx writes nothing there, so a .npmrc or
 * node_modules was put there by someone else). On any problem a fresh mkdtemp folder is used instead.
 */
function npxDir() {
  const fixed = path.join(os.tmpdir(), UID === null ? 'paradigm-mcp-npx' : `paradigm-mcp-npx-${UID}`);
  const prepare = (d) => {
    const pkg = path.join(d, 'package.json');
    let body = null;
    try {
      body = fs.readFileSync(pkg, 'utf8');
    } catch {
      /* written below */
    }
    if (body !== NPX_PKG_JSON) fs.writeFileSync(pkg, NPX_PKG_JSON);
    return d;
  };
  const usable = (d) => {
    const st = fs.lstatSync(d);
    if (!st.isDirectory()) return false;
    if (UID !== null && (st.uid !== UID || (st.mode & 0o022) !== 0)) return false;
    return fs.readdirSync(d).every((n) => n === 'package.json');
  };
  try {
    let exists = true;
    try {
      fs.lstatSync(fixed);
    } catch {
      exists = false;
    }
    if (!exists) fs.mkdirSync(fixed, { mode: 0o700 });
    if (usable(fixed)) return prepare(fixed);
  } catch {
    /* fall through to a fresh folder */
  }
  try {
    return prepare(fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-mcp-npx-')));
  } catch (e) {
    say(`could not make a folder for npx under ${os.tmpdir()}: ${e.message}`);
    return null;
  }
}

/**
 * How to start npx, and the --call string npm runs through its shell (sh on POSIX, cmd /d /s /c on Windows). The
 * string names this node and this file by absolute path, quoted for that shell, so npm resolves nothing on PATH.
 * Windows: npx-cli.js beside node is started with node directly (no cmd layer of our own); cmd then parses the
 * string once, and paths holding % " or ^ are refused rather than risk cmd reinterpreting them.
 */
function npxLaunch() {
  if (WIN) {
    for (const p of [process.execPath, __filename]) {
      if (/[%"^\r\n]/.test(p)) {
        say(`not running npx: ${p} holds a character cmd would reinterpret (% " ^)`);
        return null;
      }
    }
    const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
    if (!fs.existsSync(cli)) {
      say(`not running npx: ${cli} not found beside node`);
      return null;
    }
    // cmd /s drops the first and last quote of the line, so the whole command gets one more pair around it.
    return { file: process.execPath, pre: [cli], call: `""${process.execPath}" "${__filename}" --locate"` };
  }
  const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  return { file: 'npx', pre: [], call: `${q(process.execPath)} ${q(__filename)} --locate` };
}

function viaNpx() {
  const spec = want ? `${PKG}@${want}` : PKG;
  const launch = npxLaunch();
  if (!launch) return null;
  const cwd = npxDir();
  if (!cwd) return null;
  const r = spawnSync(
    launch.file,
    [...launch.pre, '--yes', '--prefer-offline', `--package=${spec}`, '--call', launch.call],
    // stdout carries only the located entry; npm's own output goes to stderr (Claude Code's MCP log)
    {
      cwd,
      env: { ...process.env, PARADIGM_MCP_WANT: want ?? '' },
      stdio: ['ignore', 'pipe', 'inherit'],
      encoding: 'utf8',
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
