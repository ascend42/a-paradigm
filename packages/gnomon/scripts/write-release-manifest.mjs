#!/usr/bin/env node
/**
 * @symbol #release-pins
 *
 * Write the release manifest (release-manifest:v1, gnomon-contracts; T-2026-10-21-028, TD-2026-10-21-758) from the
 * BUILT, SIGNED native artifacts, so the kernel built next pins their exact bytes:
 *
 *   run by scripts/build-release.mjs (npm run build:release), which compiles the result into the bundle
 *   node packages/gnomon/scripts/write-release-manifest.mjs --out <file>
 *     [--helper <exe>] [--voice-io <exe>] [--dist <dir>] [--release <version>] [--arch arm64|x64|universal]
 *     [--no-codesign]   tests only: skip the codesign check (never for a shipped release)
 *     [--app-zip <arch>=<zip>]...   (T-2026-10-21-030, Aegis M3 high 2) the published Gnomon.app.zip per arch: its
 *                       sha256 becomes `appZips` and is compiled into the @a-company/gnomon that npm publishes, so the
 *                       zip is checked against the CODE, never the .sha256 shipped beside it (scripts/seal-npm-release.mjs)
 *
 * Defaults: the helper and voice-io executables inside their .app in packages/gnomon-helper/bin/darwin and
 * packages/gnomon-voice/bin/darwin; dist = packages/gnomon/dist (its index.js gives the requirements and floors this
 * kernel enforces); release = this package's
 * version. For each artifact: realpath, `--version` (must meet the kernel's floor), sha256 of the executable, arch
 * from `lipo -archs` (both slices = universal), and `codesign --verify --strict --deep -R=<requirement>` on its .app
 * against the requirement THIS kernel enforces (read from the built dist/index.js, so the two cannot drift).
 *
 * The manifest is NOT read at runtime: build-release.mjs passes it to tsup (GNOMON_RELEASE_MANIFEST → define), so
 * the hashes are compiled into the kernel; a plain `npm run build` is a dev build.
 * Exit 0 = written; 1 = refused (said why); 64 = usage.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RELEASE_MANIFEST_V1, validateReleaseManifestV1 } from '@a-company/gnomon-contracts';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = path.resolve(PKG, '..');
export const DEFAULT_HELPER = path.join(PACKAGES, 'gnomon-helper', 'bin', 'darwin', 'GnomonHelper.app', 'Contents', 'MacOS', 'gnomon-helper');
export const DEFAULT_VOICE_IO = path.join(PACKAGES, 'gnomon-voice', 'bin', 'darwin', 'GnomonVoiceIO.app', 'Contents', 'MacOS', 'gnomon-voice-io');

function fail(msg, code = 1) {
  process.stderr.write(`write-release-manifest: ${msg}\n`);
  process.exit(code);
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) fail(`${name} needs a value`, 64);
  return v;
}

/** Every `--app-zip <arch>=<file>` (repeatable; arm64 or x64, one each). */
export function appZipArgs(argv) {
  const out = [];
  argv.forEach((a, i) => {
    if (a !== '--app-zip') return;
    const v = argv[i + 1] ?? '';
    const m = /^(arm64|x64)=(.+)$/.exec(v);
    if (!m) fail('--app-zip needs <arm64|x64>=<zip>', 64);
    if (out.some((o) => o.arch === m[1])) fail(`--app-zip ${m[1]} given twice`, 64);
    out.push({ arch: m[1], zip: m[2] });
  });
  return out;
}

const atLeast = (v, min) => {
  const a = v.split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
};

function archOf(exe) {
  const r = spawnSync('/usr/bin/lipo', ['-archs', exe], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
  if (r.status !== 0) fail(`lipo could not read ${exe} (${String(r.stderr).trim()}); pass --arch`);
  const archs = r.stdout.trim().split(/\s+/);
  const arm = archs.includes('arm64');
  const x64 = archs.includes('x86_64');
  if (arm && x64) return 'universal';
  if (arm) return 'arm64';
  if (x64) return 'x64';
  return fail(`${exe} has no arm64 or x86_64 slice (${archs.join(' ')})`);
}

function artifact({ name, exe, requirement, floor, codesign, arch }) {
  let real;
  try {
    real = realpathSync.native(exe);
  } catch {
    return fail(`no ${name} at ${exe} (build and sign it first)`);
  }
  const st = statSync(real);
  if (!st.isFile() || (st.mode & 0o111) === 0) fail(`${real} is not an executable file`);
  const v = spawnSync(real, ['--version'], { encoding: 'utf8', timeout: 10_000, env: { PATH: '/usr/bin:/bin' } });
  const version = new RegExp(`${name} (\\d+\\.\\d+\\.\\d+)`).exec(v.stdout ?? '')?.[1];
  if (v.status !== 0 || !version) fail(`${real} does not answer --version as "${name} a.b.c"`);
  if (!atLeast(version, floor)) fail(`${name} ${version} is below the kernel's floor ${floor}`);
  if (codesign) {
    const app = path.resolve(real, '..', '..', '..');
    const r = spawnSync('/usr/bin/codesign', ['--verify', '--strict', '--deep', `-R=${requirement}`, app], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
    if (r.status !== 0) fail(`${app} does not satisfy the requirement the kernel enforces (${String(r.stderr).trim().split('\n').at(-1)}); a release ships signed artifacts only`);
  }
  const sha256 = createHash('sha256').update(readFileSync(real)).digest('hex');
  return { name, version, sha256, requirement, arch: arch ?? archOf(real) };
}

export async function main(argv = process.argv.slice(2)) {
  const codesign = !argv.includes('--no-codesign');
  if (codesign && process.platform !== 'darwin') fail('a release manifest is written on macOS (codesign); --no-codesign is for tests only');
  const arch = arg(argv, '--arch');
  if (arch !== undefined && !['arm64', 'x64', 'universal'].includes(arch)) fail('--arch must be arm64, x64 or universal', 64);
  const outArg = arg(argv, '--out');
  if (!outArg) fail('--out <file> is required', 64);
  const out = path.resolve(outArg);
  const dist = path.resolve(arg(argv, '--dist') ?? path.join(PKG, 'dist'));
  const release = arg(argv, '--release') ?? JSON.parse(readFileSync(path.join(PKG, 'package.json'), 'utf8')).version;
  let kernel;
  try {
    kernel = await import(pathToFileURL(path.join(dist, 'index.js')).href);
  } catch {
    return fail('dist/index.js is missing: run tsup (npm run build) first');
  }
  const manifest = {
    schemaVersion: RELEASE_MANIFEST_V1,
    release,
    artifacts: [
      artifact({ name: 'gnomon-helper', exe: arg(argv, '--helper') ?? DEFAULT_HELPER, requirement: kernel.HELPER_REQUIREMENT, floor: kernel.MIN_HELPER_VERSION, codesign, arch }),
      artifact({ name: 'gnomon-voice-io', exe: arg(argv, '--voice-io') ?? DEFAULT_VOICE_IO, requirement: kernel.VOICE_IO_REQUIREMENT, floor: kernel.MIN_VOICE_IO_VERSION, codesign, arch }),
    ],
  };
  const appZips = appZipArgs(argv).map(({ arch: a, zip }) => {
    let real;
    try {
      real = realpathSync.native(zip);
    } catch {
      return fail(`no app zip at ${zip}`);
    }
    if (!statSync(real).isFile()) fail(`${real} is not a file`);
    return { arch: a, sha256: createHash('sha256').update(readFileSync(real)).digest('hex') };
  });
  if (appZips.length) manifest.appZips = appZips;
  const errors = validateReleaseManifestV1(manifest);
  if (errors.length) fail(`the manifest does not validate: ${errors.join('; ')}`);
  const tmp = `${out}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  renameSync(tmp, out);
  process.stdout.write(`write-release-manifest: ${release} → ${out}\n${manifest.artifacts.map((a) => `  ${a.name} ${a.version} ${a.arch} ${a.sha256.slice(0, 16)}…`).join('\n')}\n${(manifest.appZips ?? []).map((z) => `  Gnomon.app.zip ${z.arch} ${z.sha256.slice(0, 16)}…\n`).join('')}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
