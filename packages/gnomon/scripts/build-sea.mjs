#!/usr/bin/env node
/**
 * @symbol #kernel-sea
 *
 * Build the signed SEA kernel `gnomon.kernel` (TD-2026-10-29-746, spec P8-D68 amended, G-ID-13). The helper can
 * certify only a kernel it identifies by code signature; `node` + a script cannot be told apart from any other
 * script, so the kernel becomes a Node Single Executable Application whose signature covers its code.
 *
 *   node packages/gnomon/scripts/build-sea.mjs [--sign auto|adhoc] [--out-dir <dir>] [--node-cache <dir>]
 *        [--json]
 *
 *   This CLI builds a DEV SEA only (Aegis S0 review H2): identifier gnomon.kernel.dev, its children's node
 *   gnomon.node.dev. Only release-darwin.mjs produces `gnomon.kernel` (buildSeaBinary refuses that identifier unless
 *   `release: true`), so a dev build can never meet the production requirement the helper and Gnomon.app check.
 *   The base node is always the pinned bundled node (bundled-node.lock.json, sha256-checked); there is no override.
 *
 *   --sign auto     (default) the Developer ID identity in the login keychain when there is exactly one for team
 *                   SW4BMQ8PNL (gnomon-helper/scripts/signing.mjs), else ad-hoc with the note
 *                   "unsigned → guarded only" (CI). `adhoc` forces ad-hoc.
 *   --out-dir       where gnomon.kernel (and node/bin/node, the gnomon.node) go; default packages/gnomon (the kernel package root: the
 *                   SEA finds dist/ beside itself, sea-prelude.mjs).
 *
 * Steps:
 *   1. esbuild: scripts/sea/sea-main.mjs + dist/cli/gnomon.js + dist/cli/gnomond.js → one CommonJS main (Node 24's
 *      SEA runs CommonJS only), import.meta.url defined from the SEA's own location (sea-prelude.mjs);
 *   2. sea-config: execArgv ["--disable-sigusr1"] (the kernel's SIGUSR1 guard, env.ts), execArgvExtension "none"
 *      (NODE_OPTIONS is never read), no snapshot, no code cache; `<base node> --experimental-sea-config`;
 *   3. copy the base node, strip its signature, postject the blob (segment NODE_SEA, the documented fuse);
 *   4. codesign --identifier gnomon.kernel --options runtime --entitlements KernelEntitlements.plist (allow-jit only;
 *      + --timestamp for a Developer ID); verify: identifier, runtime flag, NO get-task-allow, and for a Developer ID
 *      the kernel requirement (kernelRequirement below, what the helper checks);
 *   5. self-test: `gnomon.kernel --version` answers, and with NODE_OPTIONS=--require=<marker.js> the marker never
 *      runs (fail closed: the build is refused otherwise);
 *   0. FIRST <out-dir>/node/bin/node = the same base node, signed identifier gnomon.node.dev (NodeEntitlements.plist),
 *      the binary the kernel's children run (src/kernel/lifecycle/sea.ts childNodePath); its cdhash-pinned
 *      requirement and the dist tree hash are baked into the SEA (Aegis S0 H1, sea-prelude.mjs).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PACKAGES = path.resolve(PKG, '..');
export const WRAPPER = path.join(PACKAGES, 'gnomon-wrapper');
export const TEAM = 'SW4BMQ8PNL';
/** The SEA's file name and code-signing identifier (layout.rs KERNEL_EXE_REL / KERNEL_IDENTIFIER, sea.ts). */
export const KERNEL_SEA_NAME = 'gnomon.kernel';
export const KERNEL_IDENTIFIER = 'gnomon.kernel';
/** A dev SEA's identifier (Aegis H2): never the production gnomon.kernel. */
export const KERNEL_DEV_IDENTIFIER = 'gnomon.kernel.dev';
/** The children's node under a dev SEA's directory (sea.ts DEV_CHILD_NODE_REL); in Gnomon.app it is Resources/node/bin/node. */
export const CHILD_NODE_REL = path.join('node', 'bin', 'node');
export const NODE_IDENTIFIER = 'gnomon.node';
/** A dev SEA's children's node identifier. */
export const NODE_DEV_IDENTIFIER = 'gnomon.node.dev';
export const KERNEL_ENTITLEMENTS = path.join(WRAPPER, 'KernelEntitlements.plist');
export const NODE_ENTITLEMENTS = path.join(WRAPPER, 'NodeEntitlements.plist');
/** Node's documented SEA sentinel fuse and Mach-O segment (nodejs.org/api/single-executable-applications.html). */
export const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
export const SEA_SEGMENT = 'NODE_SEA';
/** The one interpreter flag baked into the SEA (env.ts DISABLE_SIGUSR1); argv can add none (execArgvExtension none). */
export const SEA_EXEC_ARGV = Object.freeze(['--disable-sigusr1']);
export const UNSIGNED_NOTE = 'unsigned → guarded only: an ad-hoc gnomon.kernel has no team, so the helper cannot certify it (TD-2026-10-29-746); the terminal profile stays off';

/** Apple anchor, a Developer ID Application leaf from the Developer ID CA, our team. */
export const DEVELOPER_ID_ANCHOR = `anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "${TEAM}"`;

/**
 * The code requirement a kernel meets. `release` (the default; what the helper checks with SecCodeCheckValidity on the
 * peer's audit token, probe p15, and Gnomon.app at spawn): identifier gnomon.kernel. `dev`: gnomon.kernel.dev, which
 * never meets the release requirement. `developer-id` adds the Apple anchor + Developer ID + team; `adhoc` is the
 * identifier only (nothing certifies an ad-hoc kernel).
 */
export function kernelRequirement(signing, profile = 'release') {
  if (profile !== 'release' && profile !== 'dev') throw new Error(`unknown kernel profile ${profile}`);
  const id = profile === 'release' ? KERNEL_IDENTIFIER : KERNEL_DEV_IDENTIFIER;
  if (signing === 'developer-id') return `${DEVELOPER_ID_ANCHOR} and identifier "${id}"`;
  if (signing === 'adhoc') return `identifier "${id}"`;
  throw new Error(`unknown kernel signing ${signing}`);
}

/** The sea-config.json for `main` → `blob` (exported for tests: the NODE_OPTIONS and SIGUSR1 guarantees live here). */
export function seaConfig(main, blob) {
  return { main, output: blob, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false, execArgv: [...SEA_EXEC_ARGV], execArgvExtension: 'none' };
}

function capture(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: opts.timeout ?? 180_000, env: opts.env ?? process.env, cwd: opts.cwd });
  return { status: r.status, signal: r.signal, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() };
}

function must(r, what) {
  if (r.status !== 0) throw new Error(`${what} failed (exit ${r.status ?? r.signal}): ${(r.stderr || r.stdout).slice(0, 600)}`);
  return r;
}

/**
 * `auto`: the one Developer ID identity for TEAM in the keychain, else ad-hoc; `adhoc`: ad-hoc.
 * Returns { identity: sha1 | '-', signing: 'developer-id' | 'adhoc', name, note }.
 */
export async function resolveSigning(mode = 'auto') {
  if (mode !== 'auto' && mode !== 'adhoc') throw new Error(`--sign must be auto or adhoc (have ${mode})`);
  if (mode === 'auto' && process.platform === 'darwin') {
    const { listIdentities } = await import(path.join(PACKAGES, 'gnomon-helper', 'scripts', 'signing.mjs'));
    const ids = listIdentities() ?? [];
    if (ids.length > 1) throw new Error(`more than one Developer ID Application identity for ${TEAM}; remove the stale one (${ids.map((u) => u.sha1.slice(0, 8)).join(', ')})`);
    if (ids.length === 1) return { identity: ids[0].sha1, signing: 'developer-id', name: ids[0].name, note: null };
  }
  return { identity: '-', signing: 'adhoc', name: null, note: UNSIGNED_NOTE };
}

/** Code-signature facts of `file` (codesign -d): identifier, team, runtime flag, entitlement keys, get-task-allow. */
export function inspectSignature(file) {
  const d = capture('/usr/bin/codesign', ['-d', '-vv', file]);
  const field = (k) => (new RegExp(`^${k}=(.*)$`, 'm').exec(d.stderr) ?? [])[1] ?? null;
  const e = capture('/usr/bin/codesign', ['-d', '--entitlements', '-', '--xml', file]);
  const entitlements = [...e.stdout.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]);
  const flags = /flags=0x[0-9a-f]+\(([^)]*)\)/.exec(d.stderr)?.[1] ?? '';
  return {
    signed: d.status === 0,
    identifier: field('Identifier'),
    teamIdentifier: field('TeamIdentifier'),
    adhoc: /Signature=adhoc/.test(d.stderr) || flags.split(',').includes('adhoc'),
    runtime: flags.split(',').includes('runtime'),
    entitlements,
    getTaskAllow: entitlements.includes('com.apple.security.get-task-allow'),
  };
}

/** The one entitlement the kernel and its child node carry (KernelEntitlements.plist, NodeEntitlements.plist). */
export const SIGNED_ENTITLEMENTS = Object.freeze(['com.apple.security.cs.allow-jit']);

/** True only when `keys` is exactly SIGNED_ENTITLEMENTS. */
export function entitlementsAreExactly(keys) {
  return Array.isArray(keys) && keys.length === SIGNED_ENTITLEMENTS.length && SIGNED_ENTITLEMENTS.every((k, i) => keys[i] === k);
}

/** Sign `file` with identity ('-' = ad-hoc), identifier, entitlements, hardened runtime; Developer ID adds --timestamp. */
export function signBinary(file, { identity, identifier, entitlements }) {
  const args = ['--force', '--options', 'runtime', ...(identity === '-' ? [] : ['--timestamp']), '--identifier', identifier, '--entitlements', entitlements, '--sign', identity, file];
  must(capture('/usr/bin/codesign', args), `codesign ${path.basename(file)}`);
  const sig = inspectSignature(file);
  if (sig.identifier !== identifier) throw new Error(`${file} signed as ${sig.identifier}, not ${identifier}`);
  if (!sig.runtime) throw new Error(`${file} is not signed with the hardened runtime`);
  if (sig.getTaskAllow) throw new Error(`${file} carries get-task-allow; refused`);
  // Aegis S0 L1: exactly allow-jit, nothing more and nothing less (no library-validation opt-out, no DYLD env)
  if (!entitlementsAreExactly(sig.entitlements)) throw new Error(`${file} is signed with entitlements ${JSON.stringify(sig.entitlements)}, not exactly ${JSON.stringify(SIGNED_ENTITLEMENTS)}; refused`);
  return sig;
}

/** The 20-byte cdhash (hex) of a signed file (codesign -dvvv CDHash). */
export function cdhashOf(file) {
  const d = capture('/usr/bin/codesign', ['-dvvv', file]);
  const cd = /^CDHash=([0-9a-f]{40})$/m.exec(d.stderr)?.[1];
  if (!cd) throw new Error(`no CDHash for ${file}: ${d.stderr.slice(0, 200)}`);
  return cd;
}

/**
 * Aegis S0 H1: the requirement the SEA checks on its children's node before every spawn, pinned to that node's cdhash
 * (so an ad-hoc node with the right identifier, or another signed node, never passes): `identifier "<id>" and cdhash
 * H"<cdhash>"`, plus the Developer ID anchor and team when signed.
 */
export function childNodeRequirement({ signing, identifier, cdhash }) {
  if (!/^[0-9a-f]{40}$/.test(cdhash ?? '')) throw new Error(`bad cdhash ${cdhash}`);
  const tail = `identifier "${identifier}" and cdhash H"${cdhash}"`;
  if (signing === 'developer-id') return `${DEVELOPER_ID_ANCHOR} and ${tail}`;
  if (signing === 'adhoc') return tail;
  throw new Error(`unknown signing ${signing}`);
}

/**
 * esbuild sea-main.mjs (+ both dist entries) → one CommonJS file. `dist` must be built (npm run build:gnomon).
 * `build` = { profile: 'dev'|'release', version, distTree, childNodeRequirement } is baked in as __GNOMON_SEA_BUILD__
 * (sea-prelude.mjs refuses to start without it).
 */
export async function bundleSeaMain(outfile, { pkg = PKG, build } = {}) {
  if (!build || !['dev', 'release'].includes(build.profile) || !/^sha256:[0-9a-f]{64}$/.test(build.distTree ?? '') || !/cdhash H"[0-9a-f]{40}"/.test(build.childNodeRequirement ?? '')) throw new Error('bundleSeaMain needs build { profile, distTree, childNodeRequirement (cdhash-pinned) }');
  for (const e of ['gnomon.js', 'gnomond.js']) if (!existsSync(path.join(pkg, 'dist', 'cli', e))) throw new Error(`${pkg}/dist/cli/${e} is missing: run npm run build:gnomon first`);
  const esbuild = await import('esbuild');
  await esbuild.build({
    entryPoints: [path.join(pkg, 'scripts', 'sea', 'sea-main.mjs')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    outfile,
    // sea-prelude.mjs sets it from realpath(execPath) before any dist entry initialises
    define: { 'import.meta.url': 'globalThis.__gnomonSeaMetaUrl', __GNOMON_SEA_BUILD__: JSON.stringify(JSON.stringify(build)) },
    legalComments: 'none',
    logLevel: 'error',
  });
  return outfile;
}

/**
 * Helper 1.11.0 (G-HLP-03): the kernel's build stamp, a second postject resource in its own segment. The helper reads it
 * from the on-disk SEA whose cdhash equals the running kernel's (the signature covers it) for its kernel version floor.
 * Mirrors Caller.swift kernelStampSegment / kernelStampSection / kernelStampPrefix.
 */
export const KERNEL_STAMP_SEGMENT = '__GNOMON';
export const KERNEL_STAMP_SECTION = 'GNOMON_STAMP';
export function kernelStampBytes({ profile, version }) {
  if (!['dev', 'release'].includes(profile) || typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) || version.length > 32) throw new Error('a kernel stamp names profile dev|release and a semver version');
  return Buffer.from(`gnomon-kernel-stamp:v1\n${JSON.stringify({ profile, version })}`, 'utf8');
}

/**
 * The SEA from a CommonJS `main`: blob (generated by `baseNode` itself), copy, unsign, inject, sign, verify.
 * Shared with probe p15 (a probe SEA with its own main and identifier `gnomon.kernel.probe`, never gnomon.kernel).
 * Aegis H2: `identifier` is required, and the production `gnomon.kernel` is refused unless `release` is true (only
 * release-darwin.mjs passes it).
 */
export async function buildSeaBinary({ baseNode, main, out, identifier, release = false, identity = '-', entitlements = KERNEL_ENTITLEMENTS, work, stamp }) {
  if (typeof identifier !== 'string' || !identifier) throw new Error('buildSeaBinary needs an explicit identifier');
  if (identifier === KERNEL_IDENTIFIER && !release) throw new Error(`only release-darwin.mjs signs ${KERNEL_IDENTIFIER}; a dev SEA is ${KERNEL_DEV_IDENTIFIER}`);
  const v = must(capture(baseNode, ['--version']), `${baseNode} --version`).stdout;
  if (!/^v24\.\d+\.\d+$/.test(v)) throw new Error(`the SEA base node must be a Node 24 (execArgvExtension needs it); ${baseNode} is ${v}`);
  const blob = path.join(work, 'sea.blob');
  const cfg = path.join(work, 'sea-config.json');
  writeFileSync(cfg, JSON.stringify(seaConfig(main, blob), null, 2));
  must(capture(baseNode, ['--experimental-sea-config', cfg], { cwd: work }), 'node --experimental-sea-config');
  const tmp = path.join(work, `${path.basename(out)}.tmp`);
  copyFileSync(baseNode, tmp);
  chmodSync(tmp, 0o755);
  must(capture('/usr/bin/codesign', ['--remove-signature', tmp]), 'codesign --remove-signature');
  const { inject } = await import('postject');
  await inject(tmp, 'NODE_SEA_BLOB', readFileSync(blob), { machoSegmentName: SEA_SEGMENT, sentinelFuse: SEA_FUSE });
  // a kernel (not a probe) carries its build stamp, signed with the rest of the file (helper 1.11.0 version floor)
  if (stamp) await inject(tmp, KERNEL_STAMP_SECTION, kernelStampBytes(stamp), { machoSegmentName: KERNEL_STAMP_SEGMENT, sentinelFuse: SEA_FUSE });
  const signature = signBinary(tmp, { identity, identifier, entitlements });
  mkdirSync(path.dirname(out), { recursive: true });
  renameSync(tmp, out);
  return { out, nodeVersion: v, signature, sha256: createHash('sha256').update(readFileSync(out)).digest('hex') };
}

/** Fail closed unless the built kernel answers --version and never runs a NODE_OPTIONS --require. */
export function selfTest(kernel, version) {
  const r = capture(kernel, ['--version'], { env: { HOME: os.homedir(), PATH: '/usr/bin:/bin' } });
  if (r.status !== 0 || !r.stdout.includes(version)) throw new Error(`${kernel} --version answered ${JSON.stringify(r.stdout || r.stderr)}, not ${version}`);
  const d = mkdtempSync(path.join(os.tmpdir(), 'gnomon-sea-selftest-'));
  try {
    const marker = path.join(d, 'ran');
    const inj = path.join(d, 'inject.js');
    writeFileSync(inj, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x');\n`);
    const n = capture(kernel, ['--version'], { env: { HOME: os.homedir(), PATH: '/usr/bin:/bin', NODE_OPTIONS: `--require=${inj}` } });
    if (n.status !== 0) throw new Error(`${kernel} --version under NODE_OPTIONS failed: ${n.stderr.slice(0, 300)}`);
    if (existsSync(marker)) throw new Error(`${kernel} ran a NODE_OPTIONS --require: the SEA does not ignore NODE_OPTIONS; refused`);
    return { version: r.stdout, nodeOptionsIgnored: true };
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

/** The pinned bundled node for this arch (the same binary the release ships as gnomon.node). */
export async function pinnedBaseNode({ arch = process.arch, nodeCache, work }) {
  const { nodeLockFor, fetchPinnedNode } = await import('./release-darwin.mjs');
  const lock = nodeLockFor(arch);
  const fetched = await fetchPinnedNode(lock, nodeCache ?? path.join(os.homedir(), 'Library', 'Caches', 'gnomon-release', 'node'), work);
  return { node: fetched.node, version: lock.version };
}

/**
 * Build a DEV gnomon.kernel (identifier gnomon.kernel.dev) and its children's node/bin/node (gnomon.node.dev) into
 * `outDir`. Returns a JSON-able summary. The base node is the pinned bundled node, always.
 * Aegis S0 H1: the child node is signed FIRST, so its cdhash-pinned requirement and the dist tree hash of `pkg` are
 * baked into the SEA (bundleSeaMain); the SEA refuses to start beside any other dist and to spawn any other node.
 * `outDir` must hold (or be) a kernel package root whose dist/ + package.json equal `pkg`'s.
 */
export async function buildKernelSea({ pkg = PKG, outDir = PKG, sign = 'auto', nodeCache } = {}) {
  if (process.platform !== 'darwin') throw new Error('the SEA kernel is built on macOS (codesign, Mach-O injection)');
  const s = await resolveSigning(sign);
  const version = JSON.parse(readFileSync(path.join(pkg, 'package.json'), 'utf8')).version;
  const work = mkdtempSync(path.join(os.tmpdir(), 'gnomon-build-sea-'));
  try {
    const base = await pinnedBaseNode({ nodeCache, work });
    // 1. the children's node, signed first: its cdhash goes into the SEA
    const to = path.join(outDir, CHILD_NODE_REL);
    mkdirSync(path.dirname(to), { recursive: true });
    const tmp = `${to}.tmp`;
    copyFileSync(base.node, tmp);
    chmodSync(tmp, 0o755);
    const nodeSig = signBinary(tmp, { identity: s.identity, identifier: NODE_DEV_IDENTIFIER, entitlements: NODE_ENTITLEMENTS });
    renameSync(tmp, to);
    const childReq = childNodeRequirement({ signing: s.signing, identifier: NODE_DEV_IDENTIFIER, cdhash: cdhashOf(to) });
    must(capture('/usr/bin/codesign', ['--verify', '--strict', `-R=${childReq}`, to]), 'codesign -R child node requirement');
    // 2. the SEA, with the dist tree and the child-node requirement baked in
    const { kernelTreeHash } = await import('./release-darwin.mjs');
    const build = { profile: 'dev', version, distTree: kernelTreeHash(pkg), childNodeRequirement: childReq };
    const main = await bundleSeaMain(path.join(work, 'sea-main.cjs'), { pkg, build });
    const kernel = path.join(outDir, KERNEL_SEA_NAME);
    const built = await buildSeaBinary({ baseNode: base.node, main, out: kernel, identifier: KERNEL_DEV_IDENTIFIER, identity: s.identity, work, stamp: { profile: 'dev', version } });
    must(capture('/usr/bin/codesign', ['--verify', '--strict', `-R=${kernelRequirement(s.signing, 'dev')}`, kernel]), 'codesign -R dev kernel requirement');
    // Aegis H2: a dev SEA must never meet the production requirement
    if (capture('/usr/bin/codesign', ['--verify', '--strict', `-R=${kernelRequirement(s.signing, 'release')}`, kernel]).status === 0) throw new Error(`${kernel} meets the release requirement; refused`);
    const test = selfTest(kernel, version);
    return { kernel, profile: 'dev', version, nodeVersion: built.nodeVersion, sha256: built.sha256, signing: s.signing, identity: s.name, signature: built.signature, selfTest: test, childNode: { path: to, signature: nodeSig, requirement: childReq }, distTree: build.distTree, note: s.note };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const v = (n) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return { sign: v('--sign') ?? 'auto', outDir: path.resolve(v('--out-dir') ?? PKG), nodeCache: v('--node-cache'), json: argv.includes('--json') };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const o = parseArgs(process.argv.slice(2));
  buildKernelSea(o).then(
    (r) => {
      if (o.json) process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
      else {
        process.stdout.write(`build-sea: ${r.kernel} (${r.signing}${r.identity ? `, ${r.identity}` : ''}, identifier ${r.signature.identifier}, runtime ${r.signature.runtime}, node ${r.nodeVersion})\n`);
        if (r.childNode) process.stdout.write(`build-sea: ${r.childNode.path} (identifier ${r.childNode.signature.identifier})\n`);
        process.stdout.write(`build-sea: self-test: ${r.selfTest.version}, NODE_OPTIONS ignored\n`);
      }
      if (r.note) process.stderr.write(`build-sea: NOTE ${r.note}\n`);
    },
    (e) => {
      process.stderr.write(`build-sea: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exitCode = 1;
    },
  );
}
