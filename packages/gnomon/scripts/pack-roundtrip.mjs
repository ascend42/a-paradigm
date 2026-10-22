#!/usr/bin/env node
/**
 * @symbol #gnomon-npm-packaging
 *
 * The npm pack round trip for a Gnomon platform package (T-2026-10-21-030 acceptance, TD-2026-10-21-758; 8.0 M3).
 * npm tarballs drop symlinks and permissions that a macOS app bundle needs, which is why the platform package ships
 * Gnomon.app as a ditto zip. This proves that choice end to end:
 *
 *   1. a zip: --zip <file> (e.g. a signed release), or one built here by
 *      `release-darwin.mjs --dry-run --unsigned --zip` (placeholder binaries, real layout, a framework with symlinks);
 *   2. a copy of packages/gnomon-darwin-<arch> (package.json, index.js, README.md) with the zip copied in;
 *   3. `npm pack --json` → the tarball; its packed and unpacked sizes are reported;
 *   4. tar -x into a fresh directory; the package holds exactly its files and the zip hashes to its .sha256;
 *   5. `ditto -x -k` the zip; Gnomon.app has the release layout (missingFromLayout), and every symlink inside the app
 *      (framework Versions/Current etc.) survives with its target, compared with the app the zip was made from when
 *      this run built it, and each *.framework's Versions/Current must be a symlink;
 *   6. signed verification (`codesign --verify --strict --deep`, `spctl -a -t exec`) runs ONLY when the app carries a
 *      real (non-ad-hoc) signature; otherwise it is skipped with a message saying so.
 *
 *   node packages/gnomon/scripts/pack-roundtrip.mjs [--arch arm64] [--zip <file>] [--keep]
 *   (Apple silicon only in 8.0, TD-2026-10-22-310: arm64 is the one platform package; x64 is refused.)
 * Output: one JSON summary on stdout; exit 1 on any failed check. macOS only (ditto, codesign).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_NAME, copyIntoPlatformPackage, missingFromLayout, PACKAGES, PLACEHOLDER_FRAMEWORK } from './release-darwin.mjs';

const RELEASE = path.join(PACKAGES, 'gnomon', 'scripts', 'release-darwin.mjs');
export const PACKAGE_FILES = Object.freeze(['Gnomon.app.zip', 'Gnomon.app.zip.sha256', 'README.md', 'index.js', 'package.json']);

const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} ${args.slice(0, 2).join(' ')} failed (exit ${r.status ?? r.signal}): ${String(r.stderr).slice(0, 600)}`);
  return r;
}

/** Every symlink under `root`: { relativePath: target }, sorted. */
export function symlinksUnder(root) {
  const out = {};
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = path.join(d, n);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) out[path.relative(root, p)] = readlinkSync(p);
      else if (st.isDirectory()) walk(p);
    }
  };
  walk(root);
  return out;
}

/** Every `*.framework` directory under `root` (relative paths). */
function frameworksUnder(root) {
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      const st = lstatSync(p);
      if (!st.isDirectory()) continue;
      if (n.endsWith('.framework')) out.push(path.relative(root, p));
      walk(p);
    }
  };
  walk(root);
  return out.sort();
}

/** 'developer-id' | 'adhoc' | 'unsigned', from codesign -dv. */
export function signatureKind(app) {
  const r = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=2', app], { encoding: 'utf8' });
  if (r.status !== 0) return 'unsigned';
  return /Signature=adhoc/.test(r.stderr) ? 'adhoc' : /Authority=Developer ID Application/.test(r.stderr) ? 'developer-id' : 'adhoc';
}

export function packRoundTrip({ arch = 'arm64', zip, keep = false } = {}) {
  if (process.platform !== 'darwin') throw new Error('the pack round trip needs macOS (ditto, codesign)');
  if (arch !== 'arm64') throw new Error(`--arch must be arm64: Gnomon 8.0 ships for Apple silicon Macs only (TD-2026-10-22-310) (have ${arch})`);
  const work = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gnomon-pack-roundtrip-')));
  const problems = [];
  try {
    // 1. the zip
    let sourceApp = null;
    let built = false;
    if (!zip) {
      const out = path.join(work, 'release');
      const r = run(process.execPath, [RELEASE, '--dry-run', '--unsigned', '--zip', '--arch', arch, '--out', out]);
      const s = JSON.parse(r.stdout);
      if (!s.zip) throw new Error('release-darwin --dry-run --zip produced no zip');
      zip = s.zip;
      sourceApp = s.app;
      built = true;
    }
    zip = path.resolve(zip);
    const zipSha = sha256File(zip);
    // 2. a copy of the platform package with the zip in
    const src = path.join(PACKAGES, `gnomon-darwin-${arch}`);
    const pkg = path.join(work, 'pkg');
    mkdirSync(pkg);
    for (const f of ['package.json', 'index.js', 'README.md']) copyFileSync(path.join(src, f), path.join(pkg, f));
    copyIntoPlatformPackage(zip, zipSha, pkg, arch);
    // 3. npm pack (prepack/postpack only; prepublishOnly does not run)
    const tarDir = path.join(work, 'tarball');
    mkdirSync(tarDir);
    const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', tarDir], { cwd: pkg }).stdout)[0];
    const tarball = path.join(tarDir, packed.filename);
    // 4. extract into a fresh directory, check the file set and the hash
    const extract = path.join(work, 'extract');
    mkdirSync(extract);
    run('/usr/bin/tar', ['-xzf', tarball, '-C', extract]);
    const root = path.join(extract, 'package');
    const files = readdirSync(root).sort();
    if (JSON.stringify(files) !== JSON.stringify([...PACKAGE_FILES].sort())) problems.push(`the tarball holds ${files.join(', ')}, not ${PACKAGE_FILES.join(', ')}`);
    const shaLine = readFileSync(path.join(root, 'Gnomon.app.zip.sha256'), 'utf8').trim().split(/\s+/)[0];
    if (sha256File(path.join(root, 'Gnomon.app.zip')) !== zipSha || shaLine !== zipSha) problems.push('the packed zip does not hash to its .sha256');
    // 5. ditto -x -k, the layout, the symlinks
    const unzip = path.join(work, 'unzip');
    mkdirSync(unzip);
    run('/usr/bin/ditto', ['-x', '-k', path.join(root, 'Gnomon.app.zip'), unzip]);
    const app = path.join(unzip, APP_NAME);
    if (!existsSync(app)) throw new Error(`the zip does not unpack to ${APP_NAME}`);
    const missing = missingFromLayout(app);
    if (missing.length) problems.push(`the unpacked app is missing ${missing.join(', ')}`);
    const links = symlinksUnder(app);
    if (sourceApp) {
      const want = symlinksUnder(sourceApp);
      if (JSON.stringify(links) !== JSON.stringify(want)) problems.push(`symlinks changed through npm: have ${JSON.stringify(links)}, want ${JSON.stringify(want)}`);
    }
    if (built) {
      const fw = `${path.join('Contents', 'Helpers', 'GnomonHelper.app', PLACEHOLDER_FRAMEWORK)}`;
      if (links[path.join(fw, 'Versions', 'Current')] !== 'A') problems.push(`${fw}/Versions/Current is not a symlink to A`);
    }
    const frameworks = frameworksUnder(app);
    for (const fw of frameworks) {
      const cur = path.join(app, fw, 'Versions', 'Current');
      if (existsSync(path.join(app, fw, 'Versions')) && !lstatSync(cur).isSymbolicLink()) problems.push(`${fw}/Versions/Current is not a symlink`);
    }
    const exe = path.join(app, 'Contents', 'MacOS', 'gnomon-wrapper');
    if (existsSync(exe) && (statSync(exe).mode & 0o111) === 0) problems.push('Contents/MacOS/gnomon-wrapper lost its exec bit');
    // 6. signed verification only for a real signature
    const kind = signatureKind(app);
    let signedChecks;
    if (kind === 'developer-id') {
      const v = spawnSync('/usr/bin/codesign', ['--verify', '--strict', '--deep', '-vv', app], { encoding: 'utf8' });
      const g = spawnSync('/usr/sbin/spctl', ['-a', '-t', 'exec', '-vv', app], { encoding: 'utf8' });
      signedChecks = { codesign: v.status === 0 ? 'ok' : String(v.stderr).trim(), spctl: g.status === 0 ? 'ok' : String(g.stderr).trim() };
      if (v.status !== 0) problems.push(`codesign --verify --strict --deep failed: ${String(v.stderr).slice(0, 400)}`);
      if (g.status !== 0) problems.push(`spctl -a failed: ${String(g.stderr).slice(0, 400)}`);
    } else signedChecks = `skipped: the app is ${kind === 'adhoc' ? 'ad-hoc signed' : 'unsigned'} (no signed zip present), so codesign --verify --strict --deep and spctl -a were not run`;
    return {
      arch,
      zip,
      zipSha256: zipSha,
      built,
      tarball: keep ? tarball : packed.filename,
      packedSize: packed.size,
      unpackedSize: packed.unpackedSize,
      files,
      symlinks: Object.keys(links).length,
      frameworks,
      signature: kind,
      signedChecks,
      problems,
      ok: problems.length === 0,
      ...(keep ? { work } : {}),
    };
  } finally {
    if (!keep) rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const v = (n) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  try {
    const r = packRoundTrip({ arch: v('--arch') ?? 'arm64', zip: v('--zip'), keep: argv.includes('--keep') });
    process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
    if (typeof r.signedChecks === 'string') process.stderr.write(`pack-roundtrip: ${r.signedChecks}\n`);
    if (!r.ok) process.exitCode = 1;
  } catch (e) {
    process.stderr.write(`pack-roundtrip: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  }
}
