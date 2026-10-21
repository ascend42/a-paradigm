#!/usr/bin/env node
// @symbol #gnomon-shim
//
// `gnomon` from @a-company/paradigm (T-2026-10-21-030, TD-2026-10-21-758; 8.0 M3). npm does not link a dependency's
// bins on a global install, so paradigm carries this thin shim: it resolves its @a-company/gnomon dependency and runs
// that package's own `gnomon` CLI with the same arguments, stdio and exit code. Node >= 20 syntax only (paradigm's
// floor). Off macOS, or when npm skipped the darwin platform package (another OS or arch), it prints one plain line and
// exits non-zero: Gnomon runs on macOS only in 8.0.
// Aegis M3 medium 3: every resolved package is realpath'd and must sit where THIS paradigm's install put it (its own
// node_modules, the node_modules it was hoisted into, or the monorepo workspace in dev) and carry the expected name;
// a package planted higher in the path or reached through NODE_PATH is refused.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const UNSUPPORTED = 'Gnomon runs on macOS only in 8.0; Windows and Linux are planned';
export const EXIT_UNSUPPORTED = 69; // EX_UNAVAILABLE

const REINSTALL = 'Gnomon is not installed beside paradigm; reinstall with: npm i -g @a-company/paradigm';
const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};
const within = (file, root) => file.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

/**
 * The directories this paradigm's own install may hold its dependencies in (all realpath'd): `<paradigm>/node_modules`
 * (nested, as a global install does), the node_modules paradigm itself sits in (hoisted, a local install), and in the
 * monorepo the workspace's node_modules and packages/ (dev).
 */
export function allowedRoots(paradigmRoot) {
  const roots = [path.join(paradigmRoot, 'node_modules')];
  const parent = path.dirname(paradigmRoot);
  const nm = path.basename(parent).startsWith('@') ? path.dirname(parent) : parent;
  if (path.basename(nm) === 'node_modules') roots.push(nm);
  if (path.basename(parent) === 'packages') {
    const repo = path.dirname(parent);
    try {
      const rootPkg = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'));
      if (Array.isArray(rootPkg.workspaces) && existsSync(path.join(paradigmRoot, 'package.json'))) roots.push(path.join(repo, 'node_modules'), parent);
    } catch {
      /* not a workspace */
    }
  }
  return roots.map(real);
}

/** Resolve `name/package.json` from `from`, realpath it, and require it inside `roots` with that name; else null. */
function resolveOwned(name, from, roots) {
  let pj;
  try {
    pj = realpathSync(createRequire(from).resolve(`${name}/package.json`));
  } catch {
    return null;
  }
  if (!roots.some((r) => within(pj, r))) return { refused: `${name} resolved to ${path.dirname(pj)}, outside this paradigm install; refused` };
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pj, 'utf8'));
  } catch {
    return { refused: `${pj} is not readable JSON; refused` };
  }
  if (pkg.name !== name) return { refused: `${pj} is not ${name}; refused` };
  return { pj, pkg };
}

/**
 * Where the gnomon CLI is, or why it cannot run here. `from` is the file resolution starts at (this shim); its
 * package root (bin/..) bounds where the resolved packages may live.
 * @returns {{ ok: true, cli: string, platformPackage: string } | { ok: false, message: string }}
 */
export function resolveGnomon({ platform = process.platform, arch = process.arch, from = fileURLToPath(import.meta.url) } = {}) {
  if (platform !== 'darwin' || (arch !== 'arm64' && arch !== 'x64')) return { ok: false, message: UNSUPPORTED };
  const paradigmRoot = real(path.resolve(path.dirname(from), '..'));
  const roots = allowedRoots(paradigmRoot);
  const g = resolveOwned('@a-company/gnomon', from, roots);
  if (!g) return { ok: false, message: REINSTALL };
  if (g.refused) return { ok: false, message: g.refused };
  const pkgJson = g.pj;
  // resolved FROM the gnomon package: the platform package is its optional dependency, not paradigm's
  const p = resolveOwned(`@a-company/gnomon-darwin-${arch}`, pkgJson, [...roots, real(path.join(path.dirname(pkgJson), 'node_modules'))]);
  if (!p) return { ok: false, message: UNSUPPORTED };
  if (p.refused) return { ok: false, message: p.refused };
  const platformPackage = path.dirname(p.pj);
  const pkg = g.pkg;
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.gnomon;
  if (typeof bin !== 'string') return { ok: false, message: '@a-company/gnomon has no gnomon bin; reinstall with: npm i -g @a-company/paradigm' };
  return { ok: true, cli: path.resolve(path.dirname(pkgJson), bin), platformPackage };
}

/** Run the gnomon CLI as a child of this node; resolves to its exit code. */
export function runGnomon(cli, args) {
  // the CLI's own shebang asks for --disable-sigusr1; pass it where this node knows the flag (22.14+ / 23.7+)
  const flags = process.allowedNodeEnvironmentFlags.has('--disable-sigusr1') ? ['--disable-sigusr1'] : [];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...flags, cli, ...args], { stdio: 'inherit' });
    const forward = (sig) => () => child.kill(sig);
    const handlers = ['SIGINT', 'SIGTERM', 'SIGHUP'].map((s) => [s, forward(s)]);
    for (const [s, h] of handlers) process.on(s, h);
    child.on('error', (e) => {
      process.stderr.write(`gnomon: ${e.message}\n`);
      resolve(70);
    });
    child.on('exit', (code, signal) => {
      for (const [s, h] of handlers) process.off(s, h);
      resolve(code ?? (signal ? 128 + (signal === 'SIGINT' ? 2 : signal === 'SIGHUP' ? 1 : 15) : 70));
    });
  });
}

const isMain = (() => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) {
  const r = resolveGnomon();
  if (!r.ok) {
    process.stderr.write(`${r.message}\n`);
    process.exitCode = EXIT_UNSUPPORTED;
  } else {
    runGnomon(r.cli, process.argv.slice(2)).then((code) => {
      process.exitCode = code;
    });
  }
}
