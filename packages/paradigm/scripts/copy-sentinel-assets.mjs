#!/usr/bin/env node
// Copies the built Sentinel UI (packages/sentinel/ui/dist) into dist/sentinel-ui, the copy the published
// @a-company/paradigm serves, WITHOUT source maps. The Vite build writes assets/index-*.js.map (about 600 KB) for
// local debugging; it used to ship in the npm package (performance audit 2026-11-24, finding 9).
//
//   node scripts/copy-sentinel-assets.mjs          replace dist/sentinel-ui with the map-free copy (build:sentinel-assets)
//   node scripts/copy-sentinel-assets.mjs --check  exit 1 if any .map sits in a directory the package publishes (prepack)
//
// A copied .js or .css whose map was left out loses its trailing `//# sourceMappingURL=` comment too, so a browser's
// dev tools do not ask the Sentinel server for a file that is not there. No other byte changes.
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const PKG_ROOT = join(here, '..');
export const SENTINEL_UI_DIST = join(PKG_ROOT, '..', 'sentinel', 'ui', 'dist');
export const SENTINEL_UI_OUT = join(PKG_ROOT, 'dist', 'sentinel-ui');

export const isSourceMap = (name) => name.toLowerCase().endsWith('.map');
/** The comment a bundler leaves on the last line of a .js (`//# …`) or .css (`/*# … *\/`) file. */
const MAP_COMMENT = /\n?(?:\/\/[#@] ?sourceMappingURL=[^\s'"]+|\/\*[#@] ?sourceMappingURL=[^\s'"*]+ ?\*\/)[ \t]*\r?\n?$/;

/** Every regular file under `dir`, as posix paths relative to it. Symlinks are not followed. */
export function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const abs = join(d, name);
      const st = lstatSync(abs);
      if (st.isDirectory()) walk(abs);
      else if (st.isFile()) out.push(relative(dir, abs).split(sep).join('/'));
    }
  };
  walk(dir);
  return out;
}

/** Replace `dest` with a copy of `src` that holds no source map. Returns what was copied and what was left out. */
export function copyWithoutSourceMaps(src, dest) {
  if (!existsSync(src) || !lstatSync(src).isDirectory()) throw new Error(`copy-sentinel-assets: ${src} is missing (build @a-company/sentinel first)`);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const copied = [];
  const skipped = [];
  for (const file of listFiles(src)) {
    if (isSourceMap(file)) {
      skipped.push(file);
      continue;
    }
    const to = join(dest, ...file.split('/'));
    mkdirSync(dirname(to), { recursive: true });
    cpSync(join(src, ...file.split('/')), to);
    copied.push(file);
  }
  // a file whose map was left out no longer points at it
  const dropped = new Set(skipped);
  for (const file of copied) {
    if (!dropped.has(`${file}.map`)) continue;
    const to = join(dest, ...file.split('/'));
    const text = readFileSync(to, 'utf8');
    const without = text.replace(MAP_COMMENT, '\n');
    if (without !== text) writeFileSync(to, without);
  }
  return { copied, skipped };
}

/** Source maps inside the directories package.json `files` publishes, as posix paths relative to the package. */
export function publishedSourceMaps(pkgRoot = PKG_ROOT) {
  const { files = [] } = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));
  const found = [];
  for (const entry of files) {
    const abs = join(pkgRoot, ...String(entry).split('/'));
    if (!existsSync(abs)) continue;
    if (lstatSync(abs).isDirectory()) for (const f of listFiles(abs)) if (isSourceMap(f)) found.push(`${entry}/${f}`);
    if (lstatSync(abs).isFile() && isSourceMap(String(entry))) found.push(String(entry));
  }
  return found;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  if (process.argv.includes('--check')) {
    const maps = publishedSourceMaps();
    if (maps.length) {
      process.stderr.write(`copy-sentinel-assets: source maps would ship in @a-company/paradigm:\n${maps.map((m) => `  ${m}`).join('\n')}\nRun: npm run build:sentinel-assets (or stop the build that writes them)\n`);
      process.exit(1);
    }
  } else {
    const { copied, skipped } = copyWithoutSourceMaps(SENTINEL_UI_DIST, SENTINEL_UI_OUT);
    process.stdout.write(`copy-sentinel-assets: ${copied.length} files to dist/sentinel-ui${skipped.length ? `, left out ${skipped.join(', ')}` : ''}\n`);
  }
}
