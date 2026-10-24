#!/usr/bin/env node
// @symbol #gnomon-shim
//
// `gnomon` from @a-company/paradigm (T-2026-10-21-030 M3, T-2026-10-21-031 M4; TD-2026-10-21-758). npm does not link a
// dependency's bins on a global install, so paradigm carries this shim. It NEVER runs Gnomon on the user's Node: it
// resolves @a-company/gnomon and its @a-company/gnomon-darwin-<arch> platform package, installs (or upgrades) the
// signed Gnomon.app from that package's zip into /Applications or ~/Applications (gnomon-app.js ensureApp: pinned
// zip hash, codesign, atomic swap, a lock), then launches the INSTALLED app (gnomon-app.js launchApp). node:
// built-ins only; nothing of the kernel is ever imported here (Gnomon runs on the app's bundled Node). Off macOS,
// or when npm skipped the darwin platform package, it prints one plain line and exits non-zero: Gnomon runs on macOS
// only in 8.0. Gnomon 8.0 ships for Apple silicon Macs only (TD-2026-10-22-310): @a-company/gnomon-darwin-arm64 is the
// one platform package, and an Intel Mac gets UNSUPPORTED_INTEL. The arch is the MAC's, not Node's: an x64 Node under
// Rosetta on Apple silicon still gets the arm64 app (macArch).
// Aegis M3 medium 3: every resolved package is realpath'd and must sit where THIS paradigm's install put it (its own
// node_modules, the node_modules it was hoisted into, or the monorepo workspace in dev) and carry the expected name;
// a package planted higher in the path or reached through NODE_PATH is refused.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appInstallDir, compiledAppZipPin, ensureApp, launchApp, ShimRefused } from './gnomon-app.js';

export const UNSUPPORTED = 'Gnomon runs on macOS only in 8.0; Windows and Linux are planned';
export const UNSUPPORTED_INTEL = 'Gnomon 8.0 runs on Apple silicon Macs; Intel support is planned.';
export const EXIT_UNSUPPORTED = 69; // EX_UNAVAILABLE
export const EXIT_REFUSED = 77; // EX_NOPERM: the app could not be installed or verified

const REINSTALL = 'Gnomon is not installed beside paradigm; reinstall with: npm i -g @a-company/paradigm';
/** One sysctl value, '' when the key does not exist (an Intel Mac has no hw.optional.arm64) or sysctl fails. */
function sysctl(name) {
  try {
    const r = spawnSync('/usr/sbin/sysctl', ['-in', name], { encoding: 'utf8', timeout: 5000 });
    return r.status === 0 ? String(r.stdout ?? '').trim() : '';
  } catch {
    return '';
  }
}

/**
 * The Mac's arch, which is not always Node's: an x64 Node running under Rosetta 2 on Apple silicon reports
 * process.arch 'x64', but the Mac is arm64 (sysctl.proc_translated is 1 for a translated process; hw.optional.arm64 is
 * 1 on Apple silicon hardware whatever the process). Only a genuine Intel Mac comes back 'x64'. `read` is for tests.
 */
export function macArch({ arch = process.arch, read = sysctl } = {}) {
  if (arch !== 'x64') return arch;
  return read('sysctl.proc_translated') === '1' || read('hw.optional.arm64') === '1' ? 'arm64' : 'x64';
}

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
 * Where this paradigm's gnomon packages are, or why Gnomon cannot run here. `from` is the file resolution starts at
 * (this shim); its package root (bin/..) bounds where the resolved packages may live.
 * @returns {{ ok: true, gnomonPackage: string, platformPackage: string, version: string } | { ok: false, message: string }}
 */
export function resolveGnomon({ platform = process.platform, arch = platform === 'darwin' ? macArch() : process.arch, nodeArch = process.arch, from = fileURLToPath(import.meta.url) } = {}) {
  if (platform !== 'darwin') return { ok: false, message: UNSUPPORTED };
  if (arch === 'x64') return { ok: false, message: UNSUPPORTED_INTEL }; // Apple silicon only in 8.0 (TD-2026-10-22-310)
  if (arch !== 'arm64') return { ok: false, message: UNSUPPORTED };
  const paradigmRoot = real(path.resolve(path.dirname(from), '..'));
  const roots = allowedRoots(paradigmRoot);
  const g = resolveOwned('@a-company/gnomon', from, roots);
  if (!g) return { ok: false, message: REINSTALL };
  if (g.refused) return { ok: false, message: g.refused };
  const pkgJson = g.pj;
  // resolved FROM the gnomon package: the platform package is its optional dependency, not paradigm's
  const p = resolveOwned(`@a-company/gnomon-darwin-${arch}`, pkgJson, [...roots, real(path.join(path.dirname(pkgJson), 'node_modules'))]);
  if (!p) {
    // npm filters optional dependencies by NODE's arch, so an x64 Node under Rosetta skipped the arm64 package
    if (nodeArch !== arch) return { ok: false, message: `this Node is ${nodeArch} (Rosetta), so npm skipped @a-company/gnomon-darwin-${arch}; install an ${arch} Node, then reinstall with: npm i -g @a-company/paradigm` };
    return { ok: false, message: UNSUPPORTED };
  }
  if (p.refused) return { ok: false, message: p.refused };
  const version = g.pkg.version;
  if (typeof version !== 'string' || p.pkg.version !== version) return { ok: false, message: `@a-company/gnomon ${version} and @a-company/gnomon-darwin-${arch} ${p.pkg.version} do not match; reinstall with: npm i -g @a-company/paradigm` };
  return { ok: true, gnomonPackage: path.dirname(pkgJson), platformPackage: path.dirname(p.pj), version };
}

const say = (line) => process.stderr.write(`gnomon: ${line}\n`);

function report(e) {
  if (e.step === 'installing') say(`installing Gnomon ${e.to} in ${e.dir} ...`);
  else if (e.step === 'upgrading') say(`updating Gnomon ${e.from} to ${e.to} in ${e.dir} ...`);
  else if (e.step === 'upgraded') say(`Gnomon ${e.version} is installed. If Gnomon was open, quit it (Cmd-Q) and run gnomon again to use it.`);
  else if (e.step === 'rejected') say(`${e.app} failed verification (${e.why}); it was NOT opened and was moved to ${e.movedTo}. Reinstalling Gnomon from the verified package.`);
  else if (e.step === 'discarded') say(`discarded ${e.app}, an interrupted install's copy that failed verification (${e.why})`);
  else if (e.step === 'reinstalled') say(`Gnomon ${e.version} is reinstalled.`);
}

/**
 * The whole `gnomon` command: resolve, install or upgrade the app, launch it. Resolves to the exit code. `o` is for
 * tests only (the CLI below passes nothing, so the codesign verifier and the real install dir always apply).
 */
export async function run(args, o = {}) {
  const platform = o.platform ?? process.platform;
  const arch = o.arch ?? (platform === 'darwin' ? macArch() : process.arch);
  const r = (o.resolve ?? resolveGnomon)({ platform, arch, ...(o.nodeArch ? { nodeArch: o.nodeArch } : {}), ...(o.from ? { from: o.from } : {}) });
  if (!r.ok) {
    process.stderr.write(`${r.message}\n`);
    return EXIT_UNSUPPORTED;
  }
  try {
    const sha256 = compiledAppZipPin(r.gnomonPackage, r.version, arch);
    const installed = await ensureApp({
      zip: path.join(r.platformPackage, 'Gnomon.app.zip'),
      sha256,
      version: r.version,
      installDir: o.installDir ?? appInstallDir(),
      onEvent: report,
      ...(o.verifyApp ? { verifyApp: o.verifyApp } : {}),
    });
    return await launchApp(installed, args, { ...(o.verifyApp ? { verifyApp: o.verifyApp } : {}), ...(o.open ? { open: o.open } : {}) });
  } catch (e) {
    if (e instanceof ShimRefused) {
      say(e.message);
      return EXIT_REFUSED;
    }
    say(e instanceof Error ? e.message : String(e));
    return 70;
  }
}

const isMain = (() => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
