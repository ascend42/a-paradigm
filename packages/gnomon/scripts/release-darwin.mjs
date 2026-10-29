#!/usr/bin/env node
/**
 * @symbol #release-darwin
 *
 * Build ONE relocatable, signed Gnomon.app for one arch (TD-2026-10-21-758 zero-build; T-2026-10-21-029, 8.0 M2).
 * Founder-run on the founder's Mac (secrets never in CI); `--unsigned` (ad-hoc) for CI and tests.
 *
 *   node packages/gnomon/scripts/release-darwin.mjs [--arch arm64|x64] [--out <dir>] [--unsigned] [--notarize]
 *        [--dry-run [--zip]] [--package-dir <dir>] [--node-cache <dir>] [--skip-native] [--experimental-x64]
 *
 *   --arch        default: this Mac's arch. The Swift helpers, cargo and the sherpa platform package build for the
 *                 HOST arch only, so another arch is refused (build each arch on a Mac of that arch). Gnomon 8.0 ships
 *                 for Apple silicon Macs only (TD-2026-10-22-310): x64 is refused with X64_REFUSED unless
 *                 --experimental-x64 is given. The x64 path is kept for when Intel can be built and verified; nothing
 *                 publishes it (there is no packages/gnomon-darwin-x64 to package into).
 *   --unsigned    ad-hoc signatures everywhere, no Developer ID, no notarization (CI, tests, any Mac).
 *   --notarize    after signing: packages/gnomon-wrapper/scripts/notarize-darwin.mjs (keychain profile gnomon-notary).
 *   --dry-run     no swift, npm, cargo, network or codesign: placeholder binaries stand in for the wrapper, node,
 *                 helper and voice-io, and the REAL layout, staging and pin logic run into --out. Prints the plan.
 *   --zip         with --dry-run: still run step 9 (ditto zip + .sha256) on the placeholder app (pack round-trip tests).
 *   --package-dir copy the zip and its .sha256 into this npm platform package as Gnomon.app.zip(.sha256) (T-2026-10-21-030,
 *                 8.0 M3). Default for a SHIPPABLE release (Developer ID signed, notarized AND stapled, not dry-run):
 *                 packages/gnomon-darwin-<arch>. Any other build is refused --package-dir unless
 *                 --allow-unsigned-for-tests is also given (tests only; Aegis M3 high 1), so an ad-hoc, unnotarized or
 *                 placeholder app never lands in a package that gets published. scripts/gate-gnomon-publish.mjs
 *                 re-verifies the packaged zips before any publish.
 *   --skip-native reuse the already-built helper and voice-io (packages/*\/bin/darwin) instead of rebuilding them.
 *
 * Steps (signed inside-out; every step that fails stops the release):
 *   1. helper + voice-io: their own build scripts (Developer ID, their own entitlements and profile), after building
 *      @a-company/gnomon-contracts, which build-voice-io.mjs imports;
 *   2. `npm run build:gnomon`, then `npm run build:release -w @a-company/gnomon -- --arch <arch>` (the kernel with
 *      the GUI embedded and the helper/voice-io sha256 COMPILED IN, #release-pins);
 *   3. Node: packages/gnomon-wrapper/bundled-node.lock.json names the official tarball and its sha256; it is
 *      downloaded from nodejs.org (or reused from the cache) and REFUSED unless it hashes to the pin. Never `which node`.
 *      The lock itself is refused unless scripts/bump-bundled-node.mjs wrote it (gpg-verified SHASUMS256.txt, signer
 *      in packages/gnomon-wrapper/node-release-keys.json);
 *   4. stage a Contents-shaped tree: Resources/node/bin/node (+ LICENSE), Resources/kernel/{dist,package.json}
 *      (the kernel has ZERO runtime deps, G-SEC-01: tsup already inlines gnomon-contracts, so no node_modules),
 *      Resources/gnomon-voice/{package.json, dist, voice-models.manifest.json, node_modules/sherpa-onnx-node,
 *      node_modules/sherpa-onnx-darwin-<arch>} (a pruned copy of exactly the client and its native engine), and
 *      Resources/gnomon-mods (packages/gnomon-mods byte for byte, plain .mjs + manifests, no native code: each keeps its
 *      pinned packageHash; the kernel finds it bundle-relative, mods-admin.ts findFirstPartyRoot; 8.0 M4);
 *   5. sign inside-out IN THE STAGE: every sherpa .node/.dylib, then node (identifier gnomon.node,
 *      NodeEntitlements.plist = allow-jit only, hardened runtime + timestamp; --unsigned: ad-hoc, no runtime), then
 *      `codesign -R` against the requirement the wrapper checks at spawn. Signing rewrites node, so this precedes 6;
 *      staged trees hold no symlink (refused, never dereferenced);
 *   5b. #kernel-sea (TD-2026-10-29-746): the signed SEA kernel Resources/kernel/gnomon.kernel, built from the SAME
 *      pristine pinned node (scripts/build-sea.mjs: identifier gnomon.kernel, KernelEntitlements.plist = allow-jit,
 *      hardened runtime, no get-task-allow; Developer ID + timestamp, or ad-hoc with --unsigned), `codesign -R` against
 *      the kernel requirement, and the self-test (answers --version; a NODE_OPTIONS --require never runs). The wrapper
 *      spawns it; the kernel's node children run Resources/node/bin/node;
 *   6. `cargo tauri build --bundles app --no-sign` with GNOMON_WRAPPER_BUNDLE_STAGE=<stage> and
 *      GNOMON_WRAPPER_BUNDLE_SIGNING: build.rs pins the BUNDLE-RELATIVE paths, the hashes of the staged (signed) node
 *      and kernel, and the node's code requirement (src/layout.rs); the built binary must answer `--build-mode`
 *      with `bundle` before anything is signed;
 *   7. assemble: the Tauri app + the stage's Resources + Contents/Helpers/{GnomonHelper,GnomonVoiceIO}.app (ditto,
 *      signatures kept); the assembled node and kernel must re-hash to the stage's pins;
 *   8. sign the app (Entitlements.plist: none, hardened runtime, no --deep: nested code is already signed), verify
 *      --strict --deep and the wrapper requirement; optionally notarize + staple;
 *   9. `ditto -c -k --keepParent` → Gnomon-<version>-darwin-<arch>.zip and a .sha256 beside it;
 *  10. copy both into the platform package (--package-dir; see above).
 * Output: one JSON summary on stdout (paths, pins, signed, notarized, zip, sha256).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkReleaseDist } from './prepack.mjs';

export const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PACKAGES = path.resolve(PKG, '..');
export const REPO = path.resolve(PACKAGES, '..');
export const WRAPPER = path.join(PACKAGES, 'gnomon-wrapper');
export const NODE_LOCK = path.join(WRAPPER, 'bundled-node.lock.json');
export const RELEASE_KEYS = path.join(WRAPPER, 'node-release-keys.json');
/** The bundled node's code-signing identifier and our team (identical to packages/gnomon-wrapper/src/layout.rs). */
export const NODE_IDENTIFIER = 'gnomon.node';
export const TEAM = 'SW4BMQ8PNL';

/** layout.rs node_requirement: what the wrapper's SecStaticCode check enforces right before the spawn. */
export function nodeRequirement(signing) {
  if (signing === 'developer-id') return `anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "${TEAM}" and identifier "${NODE_IDENTIFIER}"`;
  if (signing === 'adhoc') return `identifier "${NODE_IDENTIFIER}"`;
  throw new Error(`unknown bundle signing ${signing}`);
}
export const APP_NAME = 'Gnomon.app';
export const WRAPPER_EXE = 'gnomon-wrapper';

/** The layout (relative to Contents), identical to packages/gnomon-wrapper/src/layout.rs and src/kernel/lifecycle/app-bundle.ts. */
export const LAYOUT = Object.freeze({
  wrapper: `MacOS/${WRAPPER_EXE}`,
  node: 'Resources/node/bin/node',
  kernel: 'Resources/kernel',
  /** #kernel-sea: the signed SEA kernel (layout.rs KERNEL_EXE_REL) */
  kernelExe: 'Resources/kernel/gnomon.kernel',
  voice: 'Resources/gnomon-voice',
  mods: 'Resources/gnomon-mods',
  helper: 'Helpers/GnomonHelper.app',
  voiceIo: 'Helpers/GnomonVoiceIO.app',
});

export const KERNEL_TREE_DOMAIN = 'gnomon-wrapper-kernel-tree:v1';
const MAX_FILES = 4096;
const MAX_BYTES = 256 * 1024 * 1024;

const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** The JS twin of packages/gnomon-wrapper/src/tree.rs kernel_tree_hash (the wrapper re-checks the same value). */
export function kernelTreeHash(pkg) {
  const files = [];
  let total = 0;
  const walk = (abs, rel) => {
    for (const name of readdirSync(abs).sort()) {
      const full = path.join(abs, name);
      const r = `${rel}/${name}`;
      const st = lstatSync(full);
      if (st.isSymbolicLink()) throw new Error(`symlink in the kernel tree: ${r}`);
      if (st.isDirectory()) walk(full, r);
      else if (st.isFile()) {
        total += st.size;
        if (files.length >= MAX_FILES || total > MAX_BYTES) throw new Error('the kernel tree is too large');
        files.push([r, sha256File(full)]);
      } else throw new Error(`not a regular file in the kernel tree: ${r}`);
    }
  };
  walk(path.join(pkg, 'dist'), 'dist');
  if (!lstatSync(path.join(pkg, 'package.json')).isFile()) throw new Error('package.json is not a regular file');
  files.push(['package.json', sha256File(path.join(pkg, 'package.json'))]);
  files.sort((a, b) => Buffer.compare(Buffer.from(a[0]), Buffer.from(b[0])));
  const h = createHash('sha256').update(`${KERNEL_TREE_DOMAIN}\n`);
  for (const [n, s] of files) h.update(`${n}\0${s}\n`);
  return `sha256:${h.digest('hex')}`;
}

export const VOICE_TREE_DOMAIN = 'gnomon-voice-tree:v1';
const VOICE_MAX_FILES = 50_000;
const VOICE_MAX_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Helper 1.11.0 slice (TD-2026-10-29-746): the voice client tree the SEA pins — package.json, dist/ and node_modules/
 * (the .node and .dylib addons included, after they were codesigned) of Resources/gnomon-voice. A symlink is hashed
 * as its target text, never followed. The JS twin of sea-prelude.mjs checkVoice.
 */
export function voiceTreeHash(dir) {
  const files = [];
  let total = 0;
  const walk = (abs, rel) => {
    for (const name of readdirSync(abs).sort()) {
      const full = path.join(abs, name);
      const r = `${rel}/${name}`;
      const st = lstatSync(full);
      if (st.isSymbolicLink()) files.push([r, `link:${readlinkSync(full)}`]);
      else if (st.isDirectory()) walk(full, r);
      else if (st.isFile()) {
        total += st.size;
        if (files.length >= VOICE_MAX_FILES || total > VOICE_MAX_BYTES) throw new Error('the voice client tree is too large');
        files.push([r, sha256File(full)]);
      } else throw new Error(`not a regular file in the voice client tree: ${r}`);
    }
  };
  if (!lstatSync(path.join(dir, 'package.json')).isFile()) throw new Error('the voice client package.json is not a regular file');
  files.push(['package.json', sha256File(path.join(dir, 'package.json'))]);
  for (const sub of ['dist', 'node_modules']) if (existsSync(path.join(dir, sub))) walk(path.join(dir, sub), sub);
  files.sort((a, b) => Buffer.compare(Buffer.from(a[0]), Buffer.from(b[0])));
  const h = createHash('sha256').update(`${VOICE_TREE_DOMAIN}\n`);
  for (const [n, s] of files) h.update(`${n}\0${s}\n`);
  return `sha256:${h.digest('hex')}`;
}

/** The validated lock entry for `arch`: { version, url, file, sha256 }. */
export function nodeLockFor(arch, lockFile = NODE_LOCK, keysFile = RELEASE_KEYS) {
  const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
  // Aegis M2 medium 3: only a lock written by scripts/bump-bundled-node.mjs (gpg-verified SHASUMS256.txt, signer in
  // the vendored Node release keys) is accepted
  const keys = JSON.parse(readFileSync(keysFile, 'utf8')).fingerprints ?? [];
  const p = lock.provenance ?? {};
  if (p.method !== 'gpg-shasums256' || !keys.includes(p.signer) || !/^[0-9a-f]{64}$/.test(p.shasumsSha256 ?? '')) throw new Error(`${lockFile}: not produced by bump-bundled-node.mjs (no gpg provenance from a vendored Node release key); run it`);
  if (lock.schema !== 'gnomon-bundled-node-lock:v1') throw new Error(`${lockFile}: unknown schema`);
  if (!/^24\.\d+\.\d+$/.test(lock.version ?? '')) throw new Error(`${lockFile}: the bundled node must be a pinned 24.x (have ${lock.version})`);
  const a = lock.artifacts?.[`darwin-${arch}`];
  if (!a || !/^[0-9a-f]{64}$/.test(a.sha256 ?? '') || a.file !== `node-v${lock.version}-darwin-${arch}.tar.gz`) throw new Error(`${lockFile}: no valid darwin-${arch} entry`);
  if (lock.base !== 'https://nodejs.org/dist') throw new Error(`${lockFile}: node comes from https://nodejs.org/dist only`);
  return { version: lock.version, file: a.file, sha256: a.sha256, url: `${lock.base}/v${lock.version}/${a.file}` };
}

/** Download (or reuse from `cacheDir`) the pinned tarball; refused unless it hashes to the lock. Returns the extracted node binary. */
export async function fetchPinnedNode(entry, cacheDir, workDir) {
  mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  const tarball = path.join(cacheDir, entry.file);
  if (!existsSync(tarball) || sha256File(tarball) !== entry.sha256) {
    const res = await fetch(entry.url);
    if (!res.ok) throw new Error(`GET ${entry.url}: ${res.status}`);
    const body = Buffer.from(await res.arrayBuffer());
    const got = createHash('sha256').update(body).digest('hex');
    if (got !== entry.sha256) throw new Error(`${entry.file} hashes to ${got}, not the lock's ${entry.sha256}; refused`);
    writeFileSync(`${tarball}.part`, body);
    renameSync(`${tarball}.part`, tarball);
  }
  if (sha256File(tarball) !== entry.sha256) throw new Error(`${tarball} does not hash to the lock; refused`);
  const x = path.join(workDir, 'node-extract'); // a fresh, empty directory: the archive is untrusted until checked
  rmSync(x, { recursive: true, force: true });
  mkdirSync(x, { recursive: true });
  const t = spawnSync('/usr/bin/tar', ['-xzf', tarball, '-C', x], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
  if (t.status !== 0) throw new Error(`tar failed: ${t.stderr}`);
  const root = path.join(x, entry.file.replace(/\.tar\.gz$/, ''));
  const node = path.join(root, 'bin', 'node');
  if (!lstatSync(node).isFile()) throw new Error(`${entry.file} has no regular bin/node`);
  return { node, license: path.join(root, 'LICENSE') };
}

/** Refuse any symlink (or other non-regular entry) under `dir` (Aegis M2 medium 4). */
export function assertNoSymlinks(dir) {
  const st = lstatSync(dir);
  if (st.isSymbolicLink()) throw new Error(`symlink in a staged tree: ${dir}`);
  if (st.isDirectory()) for (const n of readdirSync(dir)) assertNoSymlinks(path.join(dir, n));
  else if (!st.isFile()) throw new Error(`not a regular file in a staged tree: ${dir}`);
}

function copyTree(src, dst) {
  // regular files and dirs only: the source must hold no symlink (checked first), and nothing is dereferenced, so
  // the staged copy cannot pick up a file from outside the tree (the wrapper's tree hash refuses symlinks too)
  assertNoSymlinks(src);
  cpSync(src, dst, { recursive: true, dereference: false, errorOnExist: false, force: true, preserveTimestamps: false });
  assertNoSymlinks(dst);
}

/** Stage the kernel: dist + package.json only (zero runtime deps; G-SEC-01). */
export function stageKernel(pkg, contents) {
  const dst = path.join(contents, LAYOUT.kernel);
  if (!existsSync(path.join(pkg, 'dist', 'cli', 'gnomon.js'))) throw new Error(`${pkg}/dist is not built (npm run build:release -w @a-company/gnomon)`);
  mkdirSync(dst, { recursive: true });
  copyTree(path.join(pkg, 'dist'), path.join(dst, 'dist'));
  copyFileSync(path.join(pkg, 'package.json'), path.join(dst, 'package.json'));
  return dst;
}

/**
 * TD-2026-10-24-447 (#loops-gate), Aegis review: the kernel a release app carries MUST be a release build (the pins and
 * the loops gate are compiled into the bundle). Loads `<kernel>/dist/index.js` and throws unless its mode is `release`
 * and its loops gate stays OFF even with GNOMON_LOOPS=1. Run on the staged kernel and on the assembled app's. It does
 * not require appZips: those are sealed into the npm dist after the zip exists (8.0.2 found this on the first real run).
 * It does require the helper and voice-io pins for `arch` (Aegis, 8.0.2).
 */
export async function assertReleaseKernel(kernelDir, version, arch, check = checkReleaseDist) {
  const dist = path.join(kernelDir, 'dist');
  // The in-app kernel cannot pin the zip of the app that carries it; appZips belong to the npm dist (seal-npm-release).
  const { problems, module: m } = await check(dist, version, { requireAppZips: false });
  if (problems.length || !m) throw new Error(`REFUSING TO SHIP: the kernel at ${kernelDir} is not a release build: ${problems.join('; ') || 'dist did not load'}`);
  const pins = m.releasePins?.loadedReleasePins?.();
  if (pins?.mode !== 'release') throw new Error(`REFUSING TO SHIP: the kernel at ${kernelDir} is a ${pins?.mode ?? 'unknown'} build, not a release`);
  // Every native artifact this app carries must be pinned for this arch (an exact entry, else a universal one, as
  // gnomon-contracts releaseArtifactFor resolves it): a missing pin would only surface at runtime as a refusal.
  const artifacts = Array.isArray(pins.manifest?.artifacts) ? pins.manifest.artifacts : [];
  const missing = ['gnomon-helper', 'gnomon-voice-io'].filter((name) => !artifacts.some((a) => a?.name === name && (a.arch === arch || a.arch === 'universal')));
  if (missing.length) throw new Error(`REFUSING TO SHIP: the kernel at ${kernelDir} pins no ${missing.join(' or ')} for ${arch}`);
  const gate = m.loopsGate?.resolveLoopsEnabled;
  if (typeof gate !== 'function') throw new Error(`REFUSING TO SHIP: the kernel at ${kernelDir} carries no loops gate (dist/index.js exports no loopsGate)`);
  if (gate({ env: { GNOMON_LOOPS: '1' } }) !== false) throw new Error(`REFUSING TO SHIP: loops are ON in the kernel at ${kernelDir} (the 8.0.1 release ships them disabled)`);
}

/** Stage the voice client: its package.json, dist, models manifest, and sherpa-onnx-node + this arch's platform package. */
export function stageVoice(voicePkg, contents, arch, { requireNative = true } = {}) {
  const dst = path.join(contents, LAYOUT.voice);
  if (!existsSync(path.join(voicePkg, 'dist', 'cli.js'))) throw new Error(`${voicePkg}/dist is not built (npm run build -w @a-company/gnomon-voice)`);
  mkdirSync(dst, { recursive: true });
  copyFileSync(path.join(voicePkg, 'package.json'), path.join(dst, 'package.json'));
  copyTree(path.join(voicePkg, 'dist'), path.join(dst, 'dist'));
  if (existsSync(path.join(voicePkg, 'voice-models.manifest.json'))) copyFileSync(path.join(voicePkg, 'voice-models.manifest.json'), path.join(dst, 'voice-models.manifest.json'));
  const req = createRequire(path.join(voicePkg, 'package.json'));
  const native = [];
  for (const name of ['sherpa-onnx-node', `sherpa-onnx-darwin-${arch}`]) {
    let dir;
    try {
      dir = path.dirname((name === 'sherpa-onnx-node' ? req : createRequire(path.join(native[0] ?? voicePkg, 'package.json'))).resolve(`${name}/package.json`));
    } catch {
      if (requireNative) throw new Error(`${name} is not installed for ${voicePkg} (npm ci on a ${arch} Mac)`);
      continue;
    }
    copyTree(dir, path.join(dst, 'node_modules', name));
    native.push(dir);
  }
  return dst;
}

/** Stage the first-party mods catalog (8.0 M4): packages/gnomon-mods copied byte for byte, no symlinks. */
export function stageMods(modsSrc, contents) {
  const dst = path.join(contents, LAYOUT.mods);
  if (!existsSync(modsSrc)) throw new Error(`${modsSrc} is missing (the first-party mods ship inside the app)`);
  copyTree(modsSrc, dst);
  return dst;
}

/** Every Mach-O file under `dir` that must be signed before the app (.node addons, .dylib). */
export function nativeLibsUnder(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      const st = lstatSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile() && /\.(node|dylib)$/.test(n)) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Assemble: a copy of the Tauri-built `skeletonApp` + the stage's Resources + the two helper apps → `outApp`.
 * Returns the pins recomputed from the ASSEMBLED app (they must equal the stage's: what build.rs compiled).
 */
export function assembleApp({ skeletonApp, stage, helperApp, voiceIoApp, outApp, ditto = true }) {
  rmSync(outApp, { recursive: true, force: true });
  const cp = (src, dst) => {
    mkdirSync(path.dirname(dst), { recursive: true });
    if (ditto) {
      const r = spawnSync('/usr/bin/ditto', [src, dst], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`ditto ${src}: ${r.stderr}`);
    } else cpSync(src, dst, { recursive: true });
  };
  cp(skeletonApp, outApp);
  const c = path.join(outApp, 'Contents');
  for (const n of readdirSync(path.join(stage, 'Resources'))) cp(path.join(stage, 'Resources', n), path.join(c, 'Resources', n));
  cp(helperApp, path.join(c, LAYOUT.helper));
  cp(voiceIoApp, path.join(c, LAYOUT.voiceIo));
  const pins = bundlePins(c);
  const want = bundlePins(stage);
  if (pins.nodeSha256 !== want.nodeSha256 || pins.kernelTree !== want.kernelTree || pins.kernelExeSha256 !== want.kernelExeSha256) throw new Error('the assembled app does not re-hash to the staged pins');
  return pins;
}

/** The values build.rs compiles (layout.rs bundle_hashes + kernel_exe_hash), for a Contents-shaped dir. */
export function bundlePins(contents) {
  const node = path.join(contents, LAYOUT.node);
  if (!lstatSync(node).isFile()) throw new Error(`${LAYOUT.node} is not a regular file`);
  const kexe = path.join(contents, LAYOUT.kernelExe);
  if (!lstatSync(kexe).isFile()) throw new Error(`${LAYOUT.kernelExe} is not a regular file`);
  return { nodeSha256: sha256File(node), kernelTree: kernelTreeHash(path.join(contents, LAYOUT.kernel)), kernelExeSha256: sha256File(kexe) };
}

/** The relative paths a release app must contain (tests and the final check). */
export function missingFromLayout(app) {
  const c = path.join(app, 'Contents');
  const need = [LAYOUT.wrapper, LAYOUT.node, LAYOUT.kernelExe, `${LAYOUT.kernel}/package.json`, `${LAYOUT.kernel}/dist/cli/gnomon.js`, `${LAYOUT.voice}/package.json`, `${LAYOUT.voice}/dist/cli.js`, LAYOUT.mods, `${LAYOUT.helper}/Contents/MacOS/gnomon-helper`, `${LAYOUT.voiceIo}/Contents/MacOS/gnomon-voice-io`, 'Info.plist'];
  return need.filter((r) => !existsSync(path.join(c, r)));
}

// ---------------------------------------------------------------- CLI

/** Why --arch x64 is refused in 8.0 (TD-2026-10-22-310); the shim prints the same first sentence on an Intel Mac. */
export const X64_REFUSED = 'Gnomon 8.0 runs on Apple silicon Macs; Intel support is planned. --arch x64 is refused (TD-2026-10-22-310); --experimental-x64 builds it anyway, unpublished';

function parseArgs(argv) {
  const v = (n) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    arch: v('--arch') ?? process.arch,
    out: path.resolve(v('--out') ?? path.join(PKG, 'release')),
    nodeCache: path.resolve(v('--node-cache') ?? path.join(os.homedir(), 'Library', 'Caches', 'gnomon-release', 'node')),
    unsigned: argv.includes('--unsigned'),
    notarize: argv.includes('--notarize'),
    dryRun: argv.includes('--dry-run'),
    zip: argv.includes('--zip'),
    packageDir: v('--package-dir') ? path.resolve(v('--package-dir')) : undefined,
    allowUnsignedForTests: argv.includes('--allow-unsigned-for-tests'),
    skipNative: argv.includes('--skip-native'),
    experimentalX64: argv.includes('--experimental-x64'),
  };
}

const say = (m) => process.stderr.write(`release-darwin: ${m}\n`);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: opts.cwd ?? REPO, env: { ...process.env, ...(opts.env ?? {}) }, stdio: ['ignore', 'inherit', 'inherit'], timeout: opts.timeout ?? 1_800_000 });
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} ${args.slice(0, 3).join(' ')} failed (exit ${r.status ?? r.signal})`);
}

function capture(cmd, args) {
  return spawnSync(cmd, args, { encoding: 'utf8', timeout: 180_000 });
}

/** The placeholder framework a --dry-run helper app carries: the real versioned-bundle symlink shape. */
export const PLACEHOLDER_FRAMEWORK = 'Contents/Frameworks/GnomonPlaceholder.framework';

/**
 * A placeholder app tree for --dry-run (no cargo, no swift). With `framework`, it also carries a versioned
 * framework whose `Versions/Current`, top-level binary and `Resources` are SYMLINKS, as a real embedded framework's
 * are, so the pack round-trip (scripts/pack-roundtrip.mjs) proves the zip keeps symlinks through npm.
 */
function placeholderApp(dir, name, exeRel, { framework = false } = {}) {
  const app = path.join(dir, name);
  mkdirSync(path.dirname(path.join(app, exeRel)), { recursive: true });
  writeFileSync(path.join(app, exeRel), `placeholder ${name}\n`);
  chmodSync(path.join(app, exeRel), 0o755);
  writeFileSync(path.join(app, 'Contents', 'Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict/></plist>\n');
  if (framework) {
    const fw = path.join(app, PLACEHOLDER_FRAMEWORK);
    mkdirSync(path.join(fw, 'Versions', 'A', 'Resources'), { recursive: true });
    writeFileSync(path.join(fw, 'Versions', 'A', 'GnomonPlaceholder'), 'placeholder framework binary\n');
    writeFileSync(path.join(fw, 'Versions', 'A', 'Resources', 'Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict/></plist>\n');
    symlinkSync('A', path.join(fw, 'Versions', 'Current'));
    symlinkSync('Versions/Current/GnomonPlaceholder', path.join(fw, 'GnomonPlaceholder'));
    symlinkSync('Versions/Current/Resources', path.join(fw, 'Resources'));
  }
  return app;
}

/** Copy a release zip and its sha256 into an npm platform package as Gnomon.app.zip(.sha256). Returns the two paths. */
export function copyIntoPlatformPackage(zip, zipSha, packageDir, arch) {
  const pj = path.join(packageDir, 'package.json');
  const name = existsSync(pj) ? JSON.parse(readFileSync(pj, 'utf8')).name : undefined;
  if (name !== `@a-company/gnomon-darwin-${arch}`) throw new Error(`${packageDir} is not the @a-company/gnomon-darwin-${arch} package (have ${name ?? 'no package.json'})`);
  const dstZip = path.join(packageDir, 'Gnomon.app.zip');
  copyFileSync(zip, dstZip);
  if (sha256File(dstZip) !== zipSha) throw new Error(`${dstZip} does not hash to the release zip`);
  writeFileSync(`${dstZip}.sha256`, `${zipSha}  Gnomon.app.zip\n`);
  return { zip: dstZip, sha256: `${dstZip}.sha256` };
}

/** Codesign one path (identity sha1, or '-' for ad-hoc). */
function sign(target, identity, { entitlements, runtime = true, identifier } = {}) {
  const args = ['--force', ...(runtime ? ['--options', 'runtime'] : []), ...(identity === '-' ? [] : ['--timestamp']), ...(identifier ? ['--identifier', identifier] : []), ...(entitlements ? ['--entitlements', entitlements] : []), '--sign', identity, target];
  const r = capture('/usr/bin/codesign', args);
  if (r.status !== 0) throw new Error(`codesign ${target}: ${String(r.stderr).slice(0, 400)}`);
}

export async function release(argv) {
  const o = parseArgs(argv);
  if (process.platform !== 'darwin' && !o.dryRun) throw new Error('the release app is built on macOS');
  if (o.arch !== 'arm64' && o.arch !== 'x64') throw new Error(`--arch must be arm64 or x64 (have ${o.arch})`);
  if (o.arch === 'x64' && !o.experimentalX64) throw new Error(X64_REFUSED);
  if (o.arch !== process.arch && !o.dryRun) throw new Error(`--arch ${o.arch} on a ${process.arch} Mac: the helpers, the wrapper and sherpa build for the host arch only; build ${o.arch} on a ${o.arch} Mac`);
  if (o.notarize && o.unsigned) throw new Error('--notarize needs a signed build (drop --unsigned)');
  // Aegis M3 high 1: only a Developer ID, notarized, stapled, real build may land in a platform package
  const shippable = !o.unsigned && !o.dryRun && o.notarize;
  if (o.packageDir && !shippable && !o.allowUnsignedForTests) throw new Error('--package-dir takes only a signed, notarized, stapled release (--notarize, no --unsigned or --dry-run); --allow-unsigned-for-tests is for tests');
  const version = JSON.parse(readFileSync(path.join(PKG, 'package.json'), 'utf8')).version;
  const lock = nodeLockFor(o.arch);
  const plan = [];
  const step = async (name, fn) => {
    plan.push(name);
    if (o.dryRun) return undefined;
    say(name);
    return await fn();
  };
  mkdirSync(o.out, { recursive: true });
  const work = mkdtempSync(path.join(os.tmpdir(), 'gnomon-release-darwin-'));
  try {
    const signFlag = o.unsigned ? ['--unsigned'] : [];
    let identity = '-';
    if (!o.unsigned && !o.dryRun) {
      const { findIdentity } = await import(path.join(PACKAGES, 'gnomon-helper', 'scripts', 'signing.mjs'));
      identity = findIdentity().sha1;
    }
    // 1. native helpers (their own scripts sign them with their own entitlements). build-voice-io.mjs imports the
    //    voice-io identifier and requirement from @a-company/gnomon-contracts' dist, so build that first: a fresh
    //    checkout (npm ci) has no dist, and a stale one would pin an old identity.
    if (!o.skipNative) {
      await step('npm run build -w @a-company/gnomon-contracts', () => run('npm', ['run', 'build', '-w', '@a-company/gnomon-contracts']));
      await step('build GnomonHelper.app', () => run(process.execPath, [path.join(PACKAGES, 'gnomon-helper', 'scripts', 'build-darwin.mjs'), ...signFlag]));
      await step('build GnomonVoiceIO.app', () => run(process.execPath, [path.join(PACKAGES, 'gnomon-voice', 'scripts', 'build-voice-io.mjs'), ...signFlag]));
    }
    // 2. the kernel (GUI embedded, helper and voice-io pins compiled in)
    await step('npm run build:gnomon', () => run('npm', ['run', 'build:gnomon']));
    await step(`npm run build:release -w @a-company/gnomon -- --arch ${o.arch}`, () => run('npm', ['run', 'build:release', '-w', '@a-company/gnomon', '--', '--arch', o.arch, ...(o.unsigned ? ['--no-codesign'] : [])]));
    // 3. the pinned node
    plan.push(`fetch ${lock.url} (sha256 ${lock.sha256})`);
    const fetched = o.dryRun ? null : await fetchPinnedNode(lock, o.nodeCache, work);
    // 4. stage (Contents-shaped)
    const stage = path.join(work, 'stage', 'Contents');
    plan.push('stage Resources/{node,kernel,gnomon-voice,gnomon-mods}');
    mkdirSync(path.join(stage, 'Resources', 'node', 'bin'), { recursive: true });
    const stagedNode = path.join(stage, LAYOUT.node);
    if (fetched) {
      copyFileSync(fetched.node, stagedNode);
      if (existsSync(fetched.license)) copyFileSync(fetched.license, path.join(stage, 'Resources', 'node', 'LICENSE'));
    } else writeFileSync(stagedNode, `placeholder node v${lock.version} darwin-${o.arch}\n`);
    chmodSync(stagedNode, 0o755);
    if (o.dryRun && !existsSync(path.join(PKG, 'dist', 'cli', 'gnomon.js'))) {
      const k = path.join(stage, LAYOUT.kernel);
      mkdirSync(path.join(k, 'dist', 'cli'), { recursive: true });
      writeFileSync(path.join(k, 'dist', 'cli', 'gnomon.js'), '// placeholder kernel\n');
      copyFileSync(path.join(PKG, 'package.json'), path.join(k, 'package.json'));
    } else stageKernel(PKG, stage);
    if (!o.dryRun) await assertReleaseKernel(path.join(stage, LAYOUT.kernel), version, o.arch);
    const voicePkg = path.join(PACKAGES, 'gnomon-voice');
    if (o.dryRun && !existsSync(path.join(voicePkg, 'dist', 'cli.js'))) {
      mkdirSync(path.join(stage, LAYOUT.voice, 'dist'), { recursive: true });
      copyFileSync(path.join(voicePkg, 'package.json'), path.join(stage, LAYOUT.voice, 'package.json'));
      writeFileSync(path.join(stage, LAYOUT.voice, 'dist', 'cli.js'), '// placeholder voice client\n');
    } else stageVoice(voicePkg, stage, o.arch, { requireNative: !o.dryRun });
    stageMods(path.join(PACKAGES, 'gnomon-mods'), stage);
    // 5. sign inside-out in the stage: native addons, then node (signing rewrites node, so it precedes the pin)
    const libs = nativeLibsUnder(path.join(stage, LAYOUT.voice, 'node_modules'));
    const signing = o.unsigned ? 'adhoc' : 'developer-id';
    plan.push(`codesign ${libs.length} sherpa native libs, then Resources/node/bin/node (identifier ${NODE_IDENTIFIER}, ${o.unsigned ? 'ad-hoc, no runtime' : 'NodeEntitlements.plist'}; verify -R ${signing})`);
    if (!o.dryRun) {
      for (const l of libs) sign(l, identity, { runtime: false });
      // ad-hoc (--unsigned): no hardened runtime, since ad-hoc code has no team and library validation would refuse
      // the ad-hoc sherpa addons (measured); a Developer ID node keeps the runtime and NodeEntitlements.plist
      sign(stagedNode, identity, { identifier: NODE_IDENTIFIER, runtime: !o.unsigned, ...(o.unsigned ? {} : { entitlements: path.join(WRAPPER, 'NodeEntitlements.plist') }) });
      const rq = capture('/usr/bin/codesign', ['--verify', '--strict', `-R=${nodeRequirement(signing)}`, stagedNode]);
      if (rq.status !== 0) throw new Error(`the signed bundled node does not meet the requirement the wrapper will check: ${String(rq.stderr).slice(0, 300)}`);
      const v = capture(stagedNode, ['--version']);
      if (v.stdout.trim() !== `v${lock.version}`) throw new Error(`the signed bundled node answers ${v.stdout.trim() || v.stderr.trim()}, not v${lock.version}`);
    }
    // 5b. #kernel-sea: the signed SEA kernel, from the same pristine pinned node (fetched.node is never signed by us)
    const stagedKernelExe = path.join(stage, LAYOUT.kernelExe);
    plan.push(`build + codesign Resources/kernel/gnomon.kernel (SEA, identifier gnomon.kernel, ${o.unsigned ? 'ad-hoc' : 'Developer ID'}, KernelEntitlements.plist; verify -R ${signing}; self-test)`);
    if (!o.dryRun) {
      const sea = await import('./build-sea.mjs');
      const seaWork = path.join(work, 'sea');
      mkdirSync(seaWork, { recursive: true });
      // Aegis S0 H1: the staged node's cdhash-pinned requirement and the staged kernel tree are baked into the SEA
      const childReq = sea.childNodeRequirement({ signing, identifier: NODE_IDENTIFIER, cdhash: sea.cdhashOf(stagedNode) });
      const build = { profile: 'release', version, distTree: kernelTreeHash(path.join(stage, LAYOUT.kernel)), childNodeRequirement: childReq, voiceTree: voiceTreeHash(path.join(stage, LAYOUT.voice)) };
      const main = await sea.bundleSeaMain(path.join(seaWork, 'sea-main.cjs'), { build });
      await sea.buildSeaBinary({ baseNode: fetched.node, main, out: stagedKernelExe, identifier: sea.KERNEL_IDENTIFIER, release: true, identity, work: seaWork, stamp: { profile: 'release', version } });
      const kq = capture('/usr/bin/codesign', ['--verify', '--strict', `-R=${sea.kernelRequirement(signing)}`, stagedKernelExe]);
      if (kq.status !== 0) throw new Error(`the signed SEA kernel does not meet the requirement the wrapper and helper check: ${String(kq.stderr).slice(0, 300)}`);
      sea.selfTest(stagedKernelExe, version);
    } else {
      writeFileSync(stagedKernelExe, `placeholder gnomon.kernel v${version} darwin-${o.arch}\n`);
      chmodSync(stagedKernelExe, 0o755);
    }
    const pins = bundlePins(stage);
    // 6. the wrapper, pinning the stage (bundle-relative paths, these hashes)
    const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
    await step('cargo tauri build --bundles app --no-sign (GNOMON_WRAPPER_BUNDLE_STAGE)', () =>
      run(existsSync(path.join(cargoBin, 'cargo')) ? path.join(cargoBin, 'cargo') : 'cargo', ['tauri', 'build', '--bundles', 'app', '--no-sign'], { cwd: WRAPPER, env: { GNOMON_WRAPPER_BUNDLE_STAGE: stage, GNOMON_WRAPPER_BUNDLE_SIGNING: signing, GNOMON_WRAPPER_DEV: '', PATH: `${cargoBin}:${process.env.PATH ?? ''}` } }),
    );
    const skeleton = o.dryRun ? placeholderApp(path.join(work, 'skeleton'), APP_NAME, path.join('Contents', 'MacOS', WRAPPER_EXE)) : path.join(WRAPPER, 'target', 'release', 'bundle', 'macos', APP_NAME);
    const helperApp = o.dryRun ? placeholderApp(path.join(work, 'helpers'), 'GnomonHelper.app', 'Contents/MacOS/gnomon-helper', { framework: true }) : path.join(PACKAGES, 'gnomon-helper', 'bin', 'darwin', 'GnomonHelper.app');
    const voiceIoApp = o.dryRun ? placeholderApp(path.join(work, 'helpers'), 'GnomonVoiceIO.app', 'Contents/MacOS/gnomon-voice-io') : path.join(PACKAGES, 'gnomon-voice', 'bin', 'darwin', 'GnomonVoiceIO.app');
    // Aegis M2 high 2: the BUILT wrapper must say it is a bundle build before anything is signed
    await step('gnomon-wrapper --build-mode = bundle', () => {
      const m = capture(path.join(skeleton, 'Contents', 'MacOS', WRAPPER_EXE), ['--build-mode']);
      if (m.status !== 0 || m.stdout.trim() !== 'bundle') throw new Error(`the built wrapper reports build mode ${JSON.stringify(m.stdout.trim() || m.stderr.trim())}, not bundle; refusing to sign it`);
    });
    // 7. assemble
    const outApp = path.join(o.out, APP_NAME);
    plan.push(`assemble ${outApp}`);
    assembleApp({ skeletonApp: skeleton, stage, helperApp, voiceIoApp, outApp, ditto: process.platform === 'darwin' });
    if (!o.dryRun) await assertReleaseKernel(path.join(outApp, 'Contents', LAYOUT.kernel), version, o.arch);
    const missing = missingFromLayout(outApp);
    if (missing.length) throw new Error(`the assembled app is missing ${missing.join(', ')}`);
    // 8. sign the app (no --deep: nested code is signed already), verify, notarize
    let notarized = false;
    await step(`codesign ${o.unsigned ? 'ad-hoc' : 'Developer ID'} ${APP_NAME} (Entitlements.plist, hardened runtime)`, () => {
      sign(outApp, identity, { entitlements: path.join(WRAPPER, 'Entitlements.plist') });
      const v = capture('/usr/bin/codesign', ['--verify', '--strict', '--deep', '-vv', outApp]);
      if (v.status !== 0) throw new Error(`codesign --verify --strict --deep: ${String(v.stderr).slice(0, 600)}`);
    });
    if (!o.unsigned) {
      await step('codesign -R wrapper requirement', async () => {
        // imported lazily: build-darwin.mjs's CLI body only runs as a main module
        const { WRAPPER_REQUIREMENT } = await import(path.join(WRAPPER, 'scripts', 'build-darwin.mjs'));
        const r = capture('/usr/bin/codesign', ['--verify', '--strict', `-R=${WRAPPER_REQUIREMENT}`, outApp]);
        if (r.status !== 0) throw new Error(`the app does not meet the wrapper requirement: ${String(r.stderr).slice(0, 400)}`);
      });
    }
    let stapled = false;
    if (o.notarize) {
      await step('notarize + staple', () => run(process.execPath, [path.join(WRAPPER, 'scripts', 'notarize-darwin.mjs'), '--app', outApp], { timeout: 3_600_000 }));
      notarized = !o.dryRun;
      await step('xcrun stapler validate', () => {
        const sv = capture('/usr/bin/xcrun', ['stapler', 'validate', outApp]);
        if (sv.status !== 0) throw new Error(`the notarization ticket is not stapled to ${APP_NAME}: ${String(sv.stdout).slice(0, 300)}${String(sv.stderr).slice(0, 300)}`);
        stapled = true;
      });
    }
    // 9. zip + sha256
    const zipName = `Gnomon-${version}-darwin-${o.arch}.zip`;
    const zip = path.join(o.out, zipName);
    let zipSha = null;
    const makeZip = () => {
      rmSync(zip, { force: true });
      const z = capture('/usr/bin/ditto', ['-c', '-k', '--keepParent', outApp, zip]);
      if (z.status !== 0) throw new Error(`ditto zip: ${z.stderr}`);
      zipSha = sha256File(zip);
      writeFileSync(`${zip}.sha256`, `${zipSha}  ${zipName}\n`);
    };
    const zipStep = `ditto -c -k --keepParent → ${zipName} (+ .sha256)`;
    // --dry-run --zip: the zip is local (ditto only), so it runs for real on the placeholder app
    if (o.dryRun && o.zip) {
      plan.push(zipStep);
      makeZip();
    } else await step(zipStep, makeZip);
    const zipped = zipSha !== null;
    // 10. the npm platform package (T-2026-10-21-030): a shippable release (signed + notarized + stapled) by default;
    //     anything else only with --package-dir --allow-unsigned-for-tests (checked before the build started)
    const signed = !o.unsigned && !o.dryRun && notarized && stapled;
    const packageDir = o.packageDir ?? (signed ? path.join(PACKAGES, `gnomon-darwin-${o.arch}`) : undefined);
    let packaged = null;
    if (packageDir) {
      plan.push(`copy ${zipName} (+ .sha256) → ${packageDir}/Gnomon.app.zip`);
      if (zipped) packaged = copyIntoPlatformPackage(zip, zipSha, packageDir, o.arch);
    }
    return { app: outApp, arch: o.arch, version, node: { version: lock.version, tarballSha256: lock.sha256 }, pins, signed, notarized, stapled, zip: zipped ? zip : null, zipSha256: zipSha, packaged, dryRun: o.dryRun, plan };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  release(process.argv.slice(2)).then(
    (r) => process.stdout.write(`${JSON.stringify(r, null, 2)}\n`),
    (e) => {
      process.stderr.write(`release-darwin: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exitCode = 1;
    },
  );
}
