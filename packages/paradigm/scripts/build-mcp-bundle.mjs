#!/usr/bin/env node
/**
 * TD-2026-10-27-833 (#paradigm-mcp): the SINGLE-FILE Paradigm MCP bundle the Gnomon kernel stages for local model
 * sessions. dist/mcp.js is code-split and imports its dependencies from node_modules, so a staged copy would have to
 * carry the whole package tree; this bundle carries everything in one ESM file plus the one asset it loads at runtime
 * (sql.js's wasm), and a manifest the kernel reads to know what to copy:
 *
 *   dist/mcp-bundle/paradigm-mcp.mjs     every dependency bundled (no import outside node: builtins)
 *   dist/mcp-bundle/sql-wasm.wasm        loaded by sql.js beside the script (__dirname)
 *   dist/mcp-bundle/manifest.json        {schema: 'paradigm-mcp-bundle:v1', entry, files: [{relativePath, mode, sha256, size}]}
 *
 * The kernel never trusts this manifest's hashes: it copies the named files, hashes the COPY and pins that.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'tsup';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(PKG, 'dist', 'mcp-bundle');
const ENTRY = 'paradigm-mcp.mjs';
export const BUNDLE_SCHEMA = 'paradigm-mcp-bundle:v1';

// ESM has no require/__filename/__dirname; bundled CommonJS dependencies (sql.js locates its wasm by __dirname) need them
const SHIM = [
  "import { createRequire as __pgCreateRequire } from 'node:module';",
  "import { fileURLToPath as __pgFileURLToPath } from 'node:url';",
  "import { dirname as __pgDirname } from 'node:path';",
  'const require = __pgCreateRequire(import.meta.url);',
  'const __filename = __pgFileURLToPath(import.meta.url);',
  'const __dirname = __pgDirname(__filename);',
].join(' ');

// zod 4 + esbuild 0.28: the dynamic imports (sentinel, gnomon/agent) make zod's modules lazy (__esm), and esbuild then
// drops the init call behind `zod/v4`'s `export * from './classic/index.js'`, so the MCP SDK's top-level schemas run
// before ZodCustom exists ("is not a constructor" at load). `zod` (the root) is the same v4 classic API and keeps its
// init call, so the bare `zod/v4` specifier is resolved to it.
const ZOD_V4_ROOT = {
  name: 'zod-v4-root',
  setup(b) {
    b.onResolve({ filter: /^zod\/v4$/ }, (args) => b.resolve('zod', { resolveDir: args.resolveDir, kind: args.kind, importer: args.importer }));
  },
};

fs.rmSync(OUT, { recursive: true, force: true });
await build({
  entry: { 'paradigm-mcp': path.join(PKG, '..', 'paradigm-mcp', 'src', 'index.ts') },
  outDir: OUT,
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  splitting: false,
  treeshake: true,
  minify: true,
  dts: false,
  clean: false,
  config: false,
  silent: true,
  noExternal: [/.*/],
  esbuildPlugins: [ZOD_V4_ROOT],
  // keep node: prefixes (node:sqlite exists only under its prefix)
  removeNodeProtocol: false,
  outExtension: () => ({ js: '.mjs' }),
  banner: { js: `#!/usr/bin/env node\n${SHIM}` },
});

const req = createRequire(path.join(PKG, '..', 'paradigm-mcp', 'package.json'));
const wasm = path.join(path.dirname(req.resolve('sql.js')), 'sql-wasm.wasm');
fs.copyFileSync(wasm, path.join(OUT, 'sql-wasm.wasm'));

const files = fs
  .readdirSync(OUT)
  .filter((n) => n !== 'manifest.json')
  .sort()
  .map((n) => {
    const abs = path.join(OUT, n);
    const st = fs.lstatSync(abs);
    if (!st.isFile()) throw new Error(`build-mcp-bundle: ${n} is not a regular file`);
    return { relativePath: n, mode: st.mode & 0o777, sha256: createHash('sha256').update(fs.readFileSync(abs)).digest('hex'), size: st.size };
  });
if (!files.some((f) => f.relativePath === ENTRY)) throw new Error(`build-mcp-bundle: ${ENTRY} was not built`);
fs.writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify({ schema: BUNDLE_SCHEMA, entry: ENTRY, files }, null, 2)}\n`);
process.stdout.write(`build-mcp-bundle: ${files.map((f) => `${f.relativePath} ${f.size}`).join(', ')}\n`);
