/**
 * @symbol #kernel-sea
 *
 * The first module the signed SEA kernel (`gnomon.kernel`, TD-2026-10-29-746, spec P8-D68) evaluates, before any
 * kernel code. ESM evaluates imports in order, so sea-main.mjs imports this first and every side effect below has
 * happened before dist/cli/gnomon.js or gnomond.js runs.
 *
 * 1. Env. The SEA is built with `execArgvExtension: "none"` (scripts/build-sea.mjs), so node itself never reads
 *    NODE_OPTIONS: no `--require`, `--import`, `--inspect` or loader can be injected through the environment
 *    (measured by test/sea-kernel.test.ts and probe p15). The variables are also DELETED here so nothing the kernel
 *    spawns inherits them and the kernel's own unsafe-env guard (launch-tty.ts unsafeRuntime) sees a clean env.
 *    NODE_PATH has no effect on a SEA (its require() loads built-ins only). Aegis S0 M1: every NODE_*, OPENSSL_* and
 *    SSL_CERT_* variable is deleted so no child inherits it, and the variables read BEFORE this code runs
 *    (REFUSED_ENV: NODE_EXTRA_CA_CERTS, NODE_ICU_DATA, SSL_CERT_FILE, SSL_CERT_DIR, OPENSSL_CONF,
 *    NODE_TLS_REJECT_UNAUTHORIZED) make the kernel refuse to start (exit 78).
 * 2. argv. A SEA's argv is [execPath, argv0, ...args] (argv0 as typed, possibly relative). The first user arg
 *    `--gnomond` selects the daemon entry (env.ts SEA_GNOMOND_ARG); anything else runs the `gnomon` CLI. argv is
 *    rewritten to [execPath, execPath, ...args] so the kernel's existing "argv[1] is execPath ⇒ SEA" checks hold.
 * 3. import.meta.url. Each dist entry finds its siblings (transport/gnomon-web.js, build-id.json, gnomon-local,
 *    app-bundle.ts) from import.meta.url. The SEA defines it as `<dir of realpath(execPath)>/dist/cli/<entry>.js`:
 *    the SEA sits at the kernel package root (`Contents/Resources/kernel/gnomon.kernel` in Gnomon.app,
 *    `packages/gnomon/gnomon.kernel` in a checkout), beside dist/ and package.json.
 * 4. What sits beside it (Aegis S0 review H1). A copy of the signed kernel placed next to someone else's node and
 *    dist must not run their code. Two values are baked into the signed binary at build (__GNOMON_SEA_BUILD__,
 *    build-sea.mjs bundleSeaMain):
 *    - distTree: the gnomon-wrapper-kernel-tree:v1 hash of dist/ + package.json (release-darwin.mjs kernelTreeHash,
 *      gnomon-wrapper src/tree.rs). Checked HERE, before any kernel code: a mismatch refuses to start (exit 78).
 *      Checked again before every child spawn (checkDist; re-hashed whenever any file's dev/ino/size/mtimeNs/ctimeNs (BigInt stats)
 *      changed);
 *    - childNodeRequirement: the code requirement of the node the children run, pinned to its cdhash
 *      (identifier gnomon.node, or gnomon.node.dev for a dev SEA, + the Developer ID anchor and team when signed).
 *      checkChildNode runs `/usr/bin/codesign --verify --strict -R=<it>` before every spawn (re-run whenever the
 *      file's dev/ino/size/mtimeNs/ctimeNs changed).
 *    Both are exposed, frozen and non-writable, as globalThis.__gnomonSea (src/kernel/lifecycle/sea.ts seaGuard).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Aegis S0 M1: variables node or OpenSSL read at process start, BEFORE this prelude runs (TLS trust roots, ICU data,
 * the OpenSSL config, certificate verification). Stripping them here is too late, so the kernel refuses to start when
 * any is set, fail closed like launch-tty.ts unsafeRuntime. The wrapper's env allowlist and gnomond's clean re-exec
 * never pass them.
 */
export const REFUSED_ENV = Object.freeze(['NODE_EXTRA_CA_CERTS', 'NODE_ICU_DATA', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'OPENSSL_CONF', 'NODE_TLS_REJECT_UNAUTHORIZED']);
/** Every variable matching this is deleted before any kernel code runs, so no child inherits it (Aegis S0 M1). */
export const STRIPPED_ENV_PATTERN = /^(NODE_|OPENSSL_|SSL_CERT_)/;
const KERNEL_TREE_DOMAIN = 'gnomon-wrapper-kernel-tree:v1';
const MAX_FILES = 4096;
const MAX_BYTES = 256 * 1024 * 1024;

function refuse(why) {
  process.stderr.write(`gnomon.kernel: ${why}; refusing to start\n`);
  process.exit(78); // EX_CONFIG, as the kernel's own config refusals (exit-codes.ts)
}

// esbuild replaces __GNOMON_SEA_BUILD__ with the JSON string build-sea.mjs computed (bundleSeaMain)
// eslint-disable-next-line no-undef
const BUILD = typeof __GNOMON_SEA_BUILD__ === 'string' ? JSON.parse(__GNOMON_SEA_BUILD__) : null;
if (!BUILD || typeof BUILD.distTree !== 'string' || typeof BUILD.childNodeRequirement !== 'string') refuse('this SEA carries no build pins (dist tree, child node requirement): rebuild it with scripts/build-sea.mjs');

const refusedSet = REFUSED_ENV.filter((k) => process.env[k] !== undefined);
if (refusedSet.length) refuse(`${refusedSet.join(', ')} ${refusedSet.length === 1 ? 'is' : 'are'} set: node reads ${refusedSet.length === 1 ? 'it' : 'them'} before any kernel code runs (TLS trust, ICU or OpenSSL config); unset ${refusedSet.length === 1 ? 'it' : 'them'}`);
for (const k of Object.keys(process.env)) if (STRIPPED_ENV_PATTERN.test(k)) delete process.env[k];

const args = process.argv.slice(2);
const entry = args[0] === '--gnomond' ? 'gnomond' : 'gnomon';
if (entry === 'gnomond') args.shift();
process.argv = [process.execPath, process.execPath, ...args];

let exe = process.execPath;
try {
  exe = fs.realpathSync.native(process.execPath);
} catch {
  // keep execPath as given
}
const root = path.dirname(exe);

/** dist/** + package.json under the kernel root: [rel, abs, stat] (no symlink, regular files only, bounded). */
function treeFiles() {
  const out = [];
  let total = 0;
  const walk = (abs, rel) => {
    for (const name of fs.readdirSync(abs)) {
      const full = path.join(abs, name);
      const r = `${rel}/${name}`;
      const st = fs.lstatSync(full, { bigint: true });
      if (st.isSymbolicLink()) throw new Error(`symlink in the kernel tree: ${r}`);
      if (st.isDirectory()) walk(full, r);
      else if (st.isFile()) {
        total += Number(st.size);
        if (out.length >= MAX_FILES || total > MAX_BYTES) throw new Error('the kernel tree is too large');
        out.push([r, full, st]);
      } else throw new Error(`not a regular file in the kernel tree: ${r}`);
    }
  };
  walk(path.join(root, 'dist'), 'dist');
  const pj = path.join(root, 'package.json');
  const st = fs.lstatSync(pj, { bigint: true });
  if (!st.isFile()) throw new Error('package.json is not a regular file');
  out.push(['package.json', pj, st]);
  return out;
}

/**
 * The stat fingerprint the cache keys on (Aegis S0 merge hardening): BigInt stats, nanosecond mtime and ctime, never
 * the *Ms doubles, which round two writes within the same microsecond-ish window to one value.
 */
export const fp = (st) => {
  if (typeof st.ctimeNs !== 'bigint' || typeof st.mtimeNs !== 'bigint') throw new Error('the kernel tree cache needs BigInt stats (statSync(p, { bigint: true }))');
  return `${st.dev}:${st.ino}:${st.size}:${st.mtimeNs}:${st.ctimeNs}`;
};
let distVerified = null;
let nodeVerified = null;

/** Throws unless dist/ + package.json beside this SEA hash to the build's distTree. */
function checkDist() {
  const files = treeFiles();
  const print = files.map(([r, , st]) => `${r}:${fp(st)}`).sort().join('\n');
  if (print === distVerified) return;
  const rows = files.map(([r, abs]) => [r, createHash('sha256').update(fs.readFileSync(abs)).digest('hex')]);
  rows.sort((a, b) => Buffer.compare(Buffer.from(a[0]), Buffer.from(b[0])));
  const h = createHash('sha256').update(`${KERNEL_TREE_DOMAIN}\n`);
  for (const [n, s] of rows) h.update(`${n}\0${s}\n`);
  const got = `sha256:${h.digest('hex')}`;
  if (got !== BUILD.distTree) throw new Error(`the kernel files beside ${exe} (dist/, package.json) hash to ${got.slice(0, 19)}…, not this build's ${BUILD.distTree.slice(0, 19)}…`);
  distVerified = print;
}

/** Throws unless `node` meets the build's child-node requirement (codesign, cdhash-pinned). */
function checkChildNode(node) {
  const st = fs.statSync(node, { bigint: true });
  const print = `${node}:${fp(st)}`;
  if (print === nodeVerified) return;
  const r = spawnSync('/usr/bin/codesign', ['--verify', '--strict', `-R=${BUILD.childNodeRequirement}`, node], { encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0) throw new Error(`${node} does not meet this kernel's child-node requirement (${String(r.stderr ?? '').trim().slice(0, 200) || `codesign exit ${r.status}`})`);
  nodeVerified = print;
}

/**
 * Helper 1.11.0 slice (TD-2026-10-29-746): the voice client pin. Resources/gnomon-voice (the app) or
 * packages/gnomon-voice (a checkout) — the `gnomon-voice` directory beside the kernel's — must hash to BUILD.voiceTree
 * (release-darwin.mjs voiceTreeHash) before each voice spawn and each model fetch; the same stat cache as checkDist.
 * A SEA built without a voice pin refuses every voice spawn.
 */
const voiceRoot = path.join(path.dirname(root), 'gnomon-voice');
let voiceVerified = null;
function voiceFiles() {
  const out = [];
  let total = 0;
  const walk = (abs, rel) => {
    for (const name of fs.readdirSync(abs)) {
      const full = path.join(abs, name);
      const r = `${rel}/${name}`;
      const st = fs.lstatSync(full, { bigint: true });
      if (st.isSymbolicLink()) out.push([r, full, st, true]);
      else if (st.isDirectory()) walk(full, r);
      else if (st.isFile()) {
        total += Number(st.size);
        if (out.length >= 50_000 || total > 2 * 1024 * 1024 * 1024) throw new Error('the voice client tree is too large');
        out.push([r, full, st, false]);
      } else throw new Error(`not a regular file in the voice client tree: ${r}`);
    }
  };
  const pj = path.join(voiceRoot, 'package.json');
  const st = fs.lstatSync(pj, { bigint: true });
  if (!st.isFile()) throw new Error('the voice client package.json is not a regular file');
  out.push(['package.json', pj, st, false]);
  for (const sub of ['dist', 'node_modules']) if (fs.existsSync(path.join(voiceRoot, sub))) walk(path.join(voiceRoot, sub), sub);
  return out;
}
function checkVoice() {
  if (typeof BUILD.voiceTree !== 'string') throw new Error('this kernel build pins no voice client');
  const files = voiceFiles();
  const print = files.map(([r, , st]) => `${r}:${fp(st)}`).sort().join('\n');
  if (print === voiceVerified) return;
  const rows = files.map(([r, abs, , link]) => [r, link ? `link:${fs.readlinkSync(abs)}` : createHash('sha256').update(fs.readFileSync(abs)).digest('hex')]);
  rows.sort((a, b) => Buffer.compare(Buffer.from(a[0]), Buffer.from(b[0])));
  const h = createHash('sha256').update('gnomon-voice-tree:v1\n');
  for (const [n, s] of rows) h.update(`${n}\0${s}\n`);
  const got = `sha256:${h.digest('hex')}`;
  if (got !== BUILD.voiceTree) throw new Error(`the voice client in ${voiceRoot} hashes to ${got.slice(0, 19)}…, not this build's ${BUILD.voiceTree.slice(0, 19)}…`);
  voiceVerified = print;
}

try {
  checkDist();
} catch (e) {
  refuse(e instanceof Error ? e.message : String(e));
}

Object.defineProperty(globalThis, '__gnomonSea', {
  value: Object.freeze({ profile: BUILD.profile, version: BUILD.version, distTree: BUILD.distTree, childNodeRequirement: BUILD.childNodeRequirement, voiceRoot, checkDist, checkChildNode, checkVoice }),
  writable: false,
  configurable: false,
  enumerable: false,
});
globalThis.__gnomonSeaEntry = entry;
globalThis.__gnomonSeaMetaUrl = pathToFileURL(path.join(root, 'dist', 'cli', `${entry}.js`)).href;
