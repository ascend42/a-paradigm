/**
 * No source map ships in @a-company/paradigm (performance audit 2026-11-24, finding 9: the Sentinel UI's
 * assets/index-*.js.map, about 600 KB, was copied into dist/sentinel-ui by build:sentinel-assets and published).
 *
 *   - scripts/copy-sentinel-assets.mjs copies the Sentinel UI without `.map` files (fixture trees, any platform);
 *   - its `--check` (run at prepack) names every map inside a published directory;
 *   - what is built here holds none, and `npm pack --dry-run` lists none (both run only when dist/ exists).
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
// @ts-expect-error a plain .mjs build script (no declarations)
import { copyWithoutSourceMaps, listFiles, publishedSourceMaps } from '../scripts/copy-sentinel-assets.mjs';

const PKG = path.resolve(__dirname, '..');
const SCRIPT = path.join(PKG, 'scripts', 'copy-sentinel-assets.mjs');
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-sentinel-assets-'));
  dirs.push(d);
  return d;
}
function write(root: string, rel: string, body: string): void {
  const abs = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}
const read = (root: string, rel: string): string => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');

describe('copy-sentinel-assets: the copy', () => {
  it('copies every file except source maps, at any depth and in any case', () => {
    const src = path.join(tmp(), 'ui-dist');
    const dest = path.join(tmp(), 'out', 'sentinel-ui');
    write(src, 'index.html', '<!doctype html>');
    write(src, 'sentinel.svg', '<svg/>');
    write(src, 'assets/index-AbC123.js', 'render();\n//# sourceMappingURL=index-AbC123.js.map\n');
    write(src, 'assets/index-AbC123.js.map', '{"version":3}');
    write(src, 'assets/index-XyZ789.css', 'body{}\n/*# sourceMappingURL=index-XyZ789.css.map */');
    write(src, 'assets/index-XyZ789.css.map', '{"version":3}');
    write(src, 'assets/deep/er/chunk.js.MAP', '{}');
    write(src, 'assets/vendor.js', 'v();\n//# sourceMappingURL=https://cdn.invalid/vendor.js.map\n');
    write(src, 'assets/roadmap.js', 'export const map = 1;\n');

    const r = copyWithoutSourceMaps(src, dest) as { copied: string[]; skipped: string[] };
    expect(r.skipped.sort()).toEqual(['assets/deep/er/chunk.js.MAP', 'assets/index-AbC123.js.map', 'assets/index-XyZ789.css.map']);
    expect((listFiles(dest) as string[]).sort()).toEqual(['assets/index-AbC123.js', 'assets/index-XyZ789.css', 'assets/roadmap.js', 'assets/vendor.js', 'index.html', 'sentinel.svg']);
    expect(r.copied.sort()).toEqual((listFiles(dest) as string[]).sort());
    // a file whose map was left out no longer points at it; nothing else is touched
    expect(read(dest, 'assets/index-AbC123.js')).toBe('render();\n');
    expect(read(dest, 'assets/index-XyZ789.css')).toBe('body{}\n');
    expect(read(dest, 'assets/vendor.js')).toBe(read(src, 'assets/vendor.js'));
    expect(read(dest, 'assets/roadmap.js')).toBe(read(src, 'assets/roadmap.js'));
    expect(read(dest, 'index.html')).toBe('<!doctype html>');
    // the source tree is not changed
    expect(read(src, 'assets/index-AbC123.js')).toContain('sourceMappingURL');
    expect(fs.existsSync(path.join(src, 'assets', 'index-AbC123.js.map'))).toBe(true);
  });

  it('replaces an earlier copy (a map left by an older build does not survive)', () => {
    const src = path.join(tmp(), 'ui-dist');
    const dest = path.join(tmp(), 'sentinel-ui');
    write(src, 'index.html', 'new');
    write(dest, 'assets/old.js.map', '{}');
    write(dest, 'assets/old.js', 'old');
    copyWithoutSourceMaps(src, dest);
    expect(listFiles(dest)).toEqual(['index.html']);
  });

  it('fails by name when the Sentinel UI was not built', () => {
    const base = tmp();
    expect(() => copyWithoutSourceMaps(path.join(base, 'absent'), path.join(base, 'out'))).toThrow(/build @a-company\/sentinel first/);
  });
});

describe('copy-sentinel-assets: the prepack check', () => {
  it('names every source map inside a published directory, and nothing outside one', () => {
    const pkg = tmp();
    write(pkg, 'package.json', JSON.stringify({ files: ['dist', 'platform-ui/dist', 'bin', 'absent'] }));
    write(pkg, 'dist/index.js', '');
    write(pkg, 'dist/sentinel-ui/assets/index-AbC123.js.map', '{}');
    write(pkg, 'platform-ui/dist/assets/app.css.map', '{}');
    write(pkg, 'platform-ui/src/app.js.map', '{}');
    write(pkg, 'src/unpublished.js.map', '{}');
    expect((publishedSourceMaps(pkg) as string[]).sort()).toEqual(['dist/sentinel-ui/assets/index-AbC123.js.map', 'platform-ui/dist/assets/app.css.map']);
    fs.rmSync(path.join(pkg, 'dist', 'sentinel-ui'), { recursive: true });
    fs.rmSync(path.join(pkg, 'platform-ui', 'dist'), { recursive: true });
    expect(publishedSourceMaps(pkg)).toEqual([]);
  });

  it('prepack runs the check, and build:sentinel-assets runs the copy', () => {
    const scripts = (JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;
    expect(scripts.prepack).toContain('node scripts/copy-sentinel-assets.mjs --check');
    expect(scripts['build:sentinel-assets']).toBe('node scripts/copy-sentinel-assets.mjs');
    expect(scripts.build).toContain('npm run build:sentinel-assets');
  });
});

describe('what is built here ships no source map', () => {
  const built = fs.existsSync(path.join(PKG, 'dist', 'sentinel-ui'));

  it.skipIf(!built)('dist/sentinel-ui holds no .map, and the check passes on this package', () => {
    expect((listFiles(path.join(PKG, 'dist', 'sentinel-ui')) as string[]).filter((f) => f.toLowerCase().endsWith('.map'))).toEqual([]);
    const r = spawnSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it.skipIf(!built)('npm pack lists no .map file', () => {
    // --ignore-scripts: prepack writes README.md. npm 12 answers with an object keyed by package name, older npm with an array.
    const r = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: PKG, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 1 << 28 });
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as unknown;
    const pack = (Array.isArray(out) ? out[0] : Object.values(out as Record<string, unknown>)[0]) as { files: Array<{ path: string }> };
    expect(pack.files.length).toBeGreaterThan(100);
    expect(pack.files.map((f) => f.path).filter((p) => p.toLowerCase().endsWith('.map'))).toEqual([]);
  }, 120_000);
});
