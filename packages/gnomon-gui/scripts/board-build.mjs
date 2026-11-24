// #gui-board chunk build (spec §12.7 engine hygiene, §11.2 rule 6; boards S1.0). No build on import.
// Bundles src/board/index.ts (React + the pinned Excalidraw) as ONE ES module plus its stylesheet:
//   board/board.js, board/board.css, board/asset-<sha>.{png,svg}, board/LICENSES.txt
// build.mjs adds these to the pinned GUI tree (same gnomon-bundle-tree:v1 hash, same embed), so the kernel serves
// them hash-pinned and same-origin; core/board.ts loads board.js with import() only when a board opens.
//
// One file, no code splitting: the output names are fixed (no content-hashed chunk names to drift between OSes) and
// every engine `import()` (locales, the Mermaid importer, the font subsetter, the image resizer) resolves at build
// time to a stand-in (src/board/stubs). Never a sourcemap: the kernel would serve it (Aegis S1 risk d).
import { build } from 'esbuild';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPatches, ENGINE, ENGINE_FILES, extractCssAssets, PATCHED_FILES, PatchError, sha256, STUBS, stripHosts } from './board-patches.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const STUB_DIR = path.join(ROOT, 'src', 'board', 'stubs');

/** The board chunk's size budget, raw bytes over every board/ file (s1-build-plan §2 S1.0). */
export const BOARD_BUDGET_BYTES = 4 * 1024 * 1024;
export const BOARD_DIR = 'board';
/** The members every board chunk has; assets carry content-hashed names beside them. */
export const BOARD_REQUIRED = Object.freeze(['board/board.js', 'board/board.css', 'board/LICENSES.txt']);
/** SPDX ids a bundled package may declare. Anything else stops the build: a human reads the licence first. */
export const LICENSE_ALLOW = Object.freeze(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'Apache-2.0', 'CC0-1.0', '(MIT AND Zlib)']);

const lf = (s) => s.replace(/\r\n/g, '\n');
/** A path as its segments, whatever the OS separator (Windows trap: never assume `/`). */
const segs = (p) => p.split(/[\\/]/);
const ENGINE_DIST = [...ENGINE.name.split('/'), 'dist', 'prod'];
/** `<pkg>/dist/prod/<rest>` → `<rest>` for a file of the engine's dist/prod, else null. */
function engineFile(abs) {
  const s = segs(abs);
  const i = s.lastIndexOf('node_modules');
  if (i < 0 || i + ENGINE_DIST.length >= s.length - 1) return null;
  return ENGINE_DIST.every((x, j) => s[i + 1 + j] === x) ? s.slice(i + 1 + ENGINE_DIST.length).join('/') : null;
}

/** The patch key of a module path: an engine dist/prod file's relative name, else `<package>/<path>`; null outside node_modules. */
function patchKey(abs) {
  const ef = engineFile(abs);
  if (ef !== null) return ef;
  const root = packageRootOf(abs);
  if (root === null) return null;
  const s = segs(abs);
  const r = segs(root);
  const i = r.lastIndexOf('node_modules');
  return [...r.slice(i + 1), ...s.slice(r.length)].join('/');
}

/** Where a patch key lives on disk, resolved the way the bundle resolves it. */
export function patchKeyPath(key, engineDir) {
  if (key in ENGINE_FILES && !key.includes('/')) return path.join(engineDir, 'dist', 'prod', key);
  const [pkg, ...rest] = key.split('/');
  return path.join(path.dirname(createRequire(path.join(engineDir, 'package.json')).resolve(`${pkg}/package.json`)), ...rest);
}

function pkgJson(dir) {
  return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
}

/** The package root (dir holding package.json) of an absolute module path under node_modules, or null. */
function packageRootOf(abs) {
  const s = segs(abs);
  const i = s.lastIndexOf('node_modules');
  if (i < 0 || i + 1 >= s.length) return null;
  const n = s[i + 1].startsWith('@') ? 2 : 1;
  return s.slice(0, i + 1 + n).join(path.sep);
}

function licenseTextOf(dir) {
  const name = readdirSync(dir).sort().find((f) => /^licen[sc]e([-.][A-Za-z0-9]+)*$/i.test(f));
  return name ? lf(readFileSync(path.join(dir, name), 'utf8')).trim() : null;
}

/**
 * Copyright lines for bundled MIT packages whose npm tarball ships NO licence file (the MIT terms need the notice
 * to travel with the copy). Each line is the one in the project's own repository LICENSE, read 2026-11-23:
 * excalidraw/excalidraw (tag v0.18.0), radix-ui/primitives, theKashey/react-remove-scroll-bar. A package with no
 * licence file and no line here stops the build.
 */
export const VENDORED_COPYRIGHT = Object.freeze({
  '@excalidraw/excalidraw': 'Copyright (c) 2020 Excalidraw',
  '@radix-ui/': 'Copyright (c) 2022 WorkOS',
  'react-remove-scroll-bar': 'Copyright (c) 2025 Anton Korzunov <thekashey@gmail.com>',
});
const MIT_TEXT = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

/** The notice for a package that ships no licence file: MIT with its vendored copyright line, or null (stop). */
export function vendoredNotice(name, license) {
  const key = Object.keys(VENDORED_COPYRIGHT).find((k) => (k.endsWith('/') ? name.startsWith(k) : name === k));
  return key && license === 'MIT' ? `MIT License\n\n${VENDORED_COPYRIGHT[key]}\n\n${MIT_TEXT}` : null;
}

/** The SPDX id a package declares: `license`, or the legacy `licenses: [{type}]` list joined; 'UNKNOWN' otherwise. */
function declaredLicense(pj) {
  if (typeof pj.license === 'string') return pj.license;
  if (Array.isArray(pj.licenses) && pj.licenses.length && pj.licenses.every((l) => l && typeof l.type === 'string')) return pj.licenses.map((l) => l.type).join(' OR ');
  return 'UNKNOWN';
}

/** LICENSES.txt: one section per bundled third-party package, sorted by name (deterministic on every OS). */
export function licensesText(packages) {
  const head = [
    'Third-party software in the Gnomon board chunk (board/board.js, board/board.css).',
    'Each package below is bundled, in whole or in part, under the licence shown.',
    '',
  ];
  const body = packages.map((p) => [`${'='.repeat(78)}`, `${p.name}@${p.version}`, `Licence: ${p.license}`, '', p.text, ''].join('\n'));
  return `${[...head, ...body].join('\n')}`;
}

/** The installed engine's package directory. */
export const engineRoot = () => path.dirname(path.dirname(path.dirname(require.resolve(ENGINE.name))));

/**
 * Build the board chunk. Resolves {files: Map<'board/…', Buffer>, report}; throws (never a partial chunk) on a
 * patch that does not match, an engine that is not the pinned one, a second React, an unknown licence or a sourcemap.
 */
export async function buildBoard() {
  const pins = pkgJson(ROOT).devDependencies;
  const reactDir = path.dirname(require.resolve('react/package.json'));
  const reactDomDir = path.dirname(require.resolve('react-dom/package.json'));
  const engineDir = engineRoot();
  for (const [name, dir] of [['react', reactDir], ['react-dom', reactDomDir], [ENGINE.name, engineDir]]) {
    const v = pkgJson(dir).version;
    if (v !== pins[name]) throw new Error(`board build: ${name} resolves to ${v}, package.json pins ${pins[name]} (run npm ci)`);
  }
  if (pins[ENGINE.name] !== ENGINE.version) throw new Error(`board build: package.json pins ${ENGINE.name}@${pins[ENGINE.name]} but the patches are written for ${ENGINE.version}`);
  for (const [f, want] of Object.entries(ENGINE_FILES)) {
    const got = sha256(readFileSync(patchKeyPath(f, engineDir)));
    if (got !== want) throw new PatchError(`engine-file:${f}`, f, want, got);
  }

  const report = { engine: `${ENGINE.name}@${ENGINE.version}`, patches: {}, stubs: Object.fromEntries(STUBS.map((s) => [s.id, 0])), hosts: {} };
  const assets = new Map();
  const seenPatched = new Set();
  const noteHosts = (hosts) => {
    for (const [h, n] of Object.entries(hosts)) report.hosts[h] = (report.hosts[h] ?? 0) + n;
  };

  const plugin = {
    name: 'gnomon-board',
    setup(b) {
      b.onResolve({ filter: /^gnomon-board:refused$/ }, () => ({ path: path.join(STUB_DIR, 'refused.ts') }));
      for (const s of STUBS) {
        b.onResolve({ filter: s.filter }, (args) => {
          // relative stubs apply only to the engine's own files; bare ones (mermaid, pica) wherever they are imported
          if (args.path.startsWith('.') && engineFile(path.join(args.resolveDir, 'x')) === null) return null;
          report.stubs[s.id]++;
          return { path: path.join(STUB_DIR, s.stub) };
        });
      }
      // extracted stylesheet assets stay as relative URLs beside board.css (written by this script, not by esbuild)
      b.onResolve({ filter: /^\.\/asset-[0-9a-f]{16}\.(png|svg)$/ }, (args) => ({ path: args.path, external: true }));
      b.onLoad({ filter: /\.(m?js|cjs|css)$/ }, (args) => {
        const key = patchKey(args.path);
        if (key === null || !PATCHED_FILES.includes(key)) return null;
        // the bytes actually bundled are the bytes the patches were written for (a nested second copy would differ)
        const raw = readFileSync(args.path);
        if (sha256(raw) !== ENGINE_FILES[key]) throw new PatchError(`engine-file:${key}`, key, ENGINE_FILES[key], sha256(raw));
        const css = key.endsWith('.css');
        const r = applyPatches(key, raw.toString('utf8'));
        let text = r.text;
        Object.assign(report.patches, r.counts);
        seenPatched.add(key);
        if (css) {
          const x = extractCssAssets(text);
          text = x.css;
          Object.assign(report.patches, x.counts);
          for (const [n, bytes] of x.assets) assets.set(n, bytes);
        }
        return { contents: text, loader: css ? 'css' : 'js' };
      });
    },
  };

  const r = await build({
    absWorkingDir: ROOT,
    entryPoints: { board: path.join(ROOT, 'src', 'board', 'index.ts') },
    outdir: path.join(ROOT, 'dist', 'bundle', BOARD_DIR),
    bundle: true,
    splitting: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    conditions: ['production'],
    // one React for the whole chunk: the engine and its dependencies are hoisted beside a different major
    alias: { react: reactDir, 'react-dom': reactDomDir },
    define: {
      'process.env.NODE_ENV': '"production"',
      __GNOMON_BOARD_ENGINE__: JSON.stringify(`${ENGINE.name}@${ENGINE.version}`),
      __GNOMON_BOARD_ENGINE_VERSION__: JSON.stringify(ENGINE.version),
    },
    minify: true,
    legalComments: 'none', // the notices ship in board/LICENSES.txt
    charset: 'utf8',
    sourcemap: false,
    metafile: true,
    write: false,
    logLevel: 'silent',
    plugins: [plugin],
  });

  // React is the production build, once (Aegis S1 risk e): no development file may be an input
  const reactInputs = [...new Set(Object.keys(r.metafile.inputs).filter((i) => /(^|\/)node_modules\/(react|react-dom|scheduler)\//.test(i)).map((i) => i.slice(i.lastIndexOf('node_modules/') + 'node_modules/'.length)))].sort();
  if (reactInputs.some((i) => /development/.test(i)) || !reactInputs.includes('react-dom/cjs/react-dom-client.production.js') || !reactInputs.includes('react/cjs/react.production.js')) {
    throw new Error(`board build: React is not the production build (${reactInputs.join(', ')})`);
  }
  report.reactInputs = reactInputs;

  for (const f of PATCHED_FILES) if (!seenPatched.has(f)) throw new PatchError('patched-file-loaded', f, 1, 0);
  for (const s of STUBS) if (report.stubs[s.id] !== s.expect) throw new PatchError(`stub:${s.id}`, 'the engine', s.expect, report.stubs[s.id]);

  const files = new Map();
  for (const o of r.outputFiles) {
    const name = path.basename(o.path);
    if (name !== 'board.js' && name !== 'board.css') throw new Error(`board build: unexpected output ${name}`);
    // after minification only string literals are left: every http(s) host in them goes (Aegis S1 risk f)
    const h = stripHosts(Buffer.from(o.contents).toString('utf8'));
    noteHosts(h.hosts);
    files.set(`${BOARD_DIR}/${name}`, Buffer.from(h.text, 'utf8'));
  }
  for (const [n, bytes] of assets) files.set(`${BOARD_DIR}/${n}`, bytes);

  // third-party notices, from exactly the packages esbuild read
  const roots = new Map();
  for (const input of Object.keys(r.metafile.inputs)) {
    const abs = path.resolve(ROOT, ...input.replace(/^[a-z-]+:/, '').split('/'));
    const dir = packageRootOf(abs);
    if (dir && !roots.has(dir)) roots.set(dir, pkgJson(dir));
  }
  // the same name@version installed in several places is one package (and one notice)
  const byId = new Map();
  for (const [dir, pj] of [...roots.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const id = `${pj.name}@${pj.version}`;
    const cur = byId.get(id);
    if (!cur || (cur.text === null && licenseTextOf(dir) !== null)) byId.set(id, { name: pj.name, version: pj.version, license: declaredLicense(pj), text: licenseTextOf(dir) });
  }
  const packages = [...byId.values()]
    .sort((a, b) => (a.name === b.name ? (a.version < b.version ? -1 : 1) : a.name < b.name ? -1 : 1));
  for (const p of packages) if (!LICENSE_ALLOW.includes(p.license)) throw new Error(`board build: ${p.name}@${p.version} declares licence "${p.license}", not in LICENSE_ALLOW (scripts/board-build.mjs)`);
  for (const p of packages) {
    p.text ??= vendoredNotice(p.name, p.license);
    if (p.text === null) throw new Error(`board build: ${p.name}@${p.version} ships no licence file and has no vendored notice (VENDORED_COPYRIGHT in scripts/board-build.mjs)`);
  }
  const reacts = packages.filter((p) => p.name === 'react' || p.name === 'react-dom');
  if (reacts.length !== 2 || reacts.some((p) => p.version !== pins[p.name])) throw new Error(`board build: expected exactly one react and one react-dom at the pinned version, got ${reacts.map((p) => `${p.name}@${p.version}`).join(', ')}`);
  files.set(`${BOARD_DIR}/LICENSES.txt`, Buffer.from(licensesText(packages), 'utf8'));

  report.packages = packages.map((p) => ({ name: p.name, version: p.version, license: p.license }));
  report.bytes = Object.fromEntries([...files.entries()].sort().map(([n, b]) => [n, b.length]));
  report.totalBytes = [...files.values()].reduce((a, b) => a + b.length, 0);
  const problems = boardProblems(files);
  if (problems.length) throw new Error(`board build: ${problems.join('; ')}`);
  return { files, report };
}

/**
 * Why a file map must not ship as the pinned bundle's board chunk ([] when it may). Pure, shared by the build, by
 * `--check` and by the tests: a missing member, a sourcemap anywhere in the bundle, an unexpected board file or a
 * chunk over its budget.
 */
export function boardProblems(files, budget = BOARD_BUDGET_BYTES) {
  const problems = [];
  for (const n of BOARD_REQUIRED) if (!files.has(n)) problems.push(`${n} is missing`);
  let total = 0;
  for (const [n, bytes] of files) {
    if (/\.map$/i.test(n)) problems.push(`${n}: no sourcemap may ship`);
    if (!n.startsWith(`${BOARD_DIR}/`)) continue;
    total += bytes.length;
    if (!BOARD_REQUIRED.includes(n) && !/^board\/asset-[0-9a-f]{16}\.(png|svg)$/.test(n)) problems.push(`${n}: not a known board file`);
    if (/sourceMappingURL=/.test(n.endsWith('.js') || n.endsWith('.css') ? bytes.toString('utf8').slice(-400) : '')) problems.push(`${n}: carries a sourceMappingURL`);
  }
  if (total > budget) problems.push(`the board chunk is ${total} bytes, over its ${budget} byte budget`);
  return problems;
}

/** Every board file of a fresh build that the embed does not carry byte-for-byte ([] when all are pinned). */
export function unpinnedBoardFiles(fresh, embedded) {
  const out = [];
  for (const [n, bytes] of fresh) {
    if (!n.startsWith(`${BOARD_DIR}/`)) continue;
    const e = embedded.get(n);
    if (!e) out.push(`${n} is not in the pinned tree`);
    else if (!e.equals(bytes)) out.push(`${n} differs from the pinned bytes`);
  }
  for (const n of embedded.keys()) if (n.startsWith(`${BOARD_DIR}/`) && !fresh.has(n)) out.push(`${n} is pinned but no longer built`);
  return out;
}

/** The files of a generated gui-bundle.ts source (the bytes the kernel materializes). */
export function embeddedFiles(src) {
  return new Map([...src.matchAll(/^ {2}("[^"]+"):\n {4}"([A-Za-z0-9+/=]*)",$/gm)].map((m) => [JSON.parse(m[1]), Buffer.from(m[2], 'base64')]));
}
