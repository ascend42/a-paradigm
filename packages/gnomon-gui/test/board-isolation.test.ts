/**
 * #gui-board isolation (boards S1.0 item 4; s1-build-plan §2 S1.0): React and the board code live ONLY in the lazy
 * board chunk. Fails if anything under src/core or src/ui (or anything they import, or the app entry) imports
 * react, react-dom, the engine or a file under src/board; and if the built app.js carries any of it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const EMBED = path.resolve(ROOT, '..', 'gnomon', 'src', 'kernel', 'web', 'gui-bundle.ts');

/** A text file of the shipped GUI bundle, decoded from the kernel embed. */
function shipped(name: string): string {
  const m = new RegExp(`^ {2}${JSON.stringify(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\n {4}"([A-Za-z0-9+/=]*)",$`, 'm').exec(readFileSync(EMBED, 'utf8'));
  if (!m) throw new Error(`${name} is not in the embed`);
  return Buffer.from(m[1]!, 'base64').toString('utf8');
}

const walk = (dir: string): string[] => readdirSync(dir).sort().flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : n.endsWith('.ts') ? [path.join(dir, n)] : []));
/** every module specifier a source file names: static import/export-from, side-effect import, dynamic import() and require() */
const specifiers = (src: string): string[] => [...src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g)].map((m) => m[2]!);
const FORBIDDEN_BARE = /^(react|react-dom|scheduler|@excalidraw\/[^/]+)(\/|$)/;
/** src-relative POSIX path of a file (never an OS path in an assertion message) */
const rel = (abs: string): string => path.relative(SRC, abs).split(path.sep).join('/');

function offences(file: string): string[] {
  const out: string[] = [];
  for (const spec of specifiers(readFileSync(file, 'utf8'))) {
    if (FORBIDDEN_BARE.test(spec)) out.push(`${rel(file)} imports ${spec}`);
    else if (spec.startsWith('.')) {
      const target = rel(path.resolve(path.dirname(file), spec));
      if (target === 'board' || target.startsWith('board/')) out.push(`${rel(file)} imports board code (${spec})`);
    }
  }
  return out;
}

describe('#gui-board isolation: core/ and ui/ never import React or board code', () => {
  it('the scanner sees every import form (a guard that cannot see is no guard)', () => {
    const sample = `import a from 'react';\nimport { b } from "react-dom/client";\nexport * from '@excalidraw/excalidraw';\nimport '../board/index.js';\nconst c = await import('../board/stubs/env.js');\nconst d = require('react');\nimport type { T } from './board.js';`;
    expect(specifiers(sample)).toEqual(['react', 'react-dom/client', '@excalidraw/excalidraw', '../board/index.js', '../board/stubs/env.js', 'react', './board.js']);
    expect(FORBIDDEN_BARE.test('react')).toBe(true);
    expect(FORBIDDEN_BARE.test('react-dom/client')).toBe(true);
    expect(FORBIDDEN_BARE.test('@excalidraw/excalidraw/index.css')).toBe(true);
    expect(FORBIDDEN_BARE.test('reactive-thing')).toBe(false);
  });

  it.each(['core', 'ui', 'setup'])('no file under src/%s imports react, the engine or src/board', (dir) => {
    const files = walk(path.join(SRC, dir));
    expect(files.length).toBeGreaterThan(1);
    expect(files.flatMap(offences)).toEqual([]);
  });

  it('src/main.ts (the app.js entry) does not either, and only src/board imports React at all', () => {
    expect(offences(path.join(SRC, 'main.ts'))).toEqual([]);
    const importers = walk(SRC).filter((f) => specifiers(readFileSync(f, 'utf8')).some((s) => FORBIDDEN_BARE.test(s))).map(rel);
    expect(importers).toEqual(['board/index.ts']);
  });

  it('core/board.ts reaches the chunk only by URL: import() of a computed bundle path, no static specifier', () => {
    const src = readFileSync(path.join(SRC, 'core', 'board.ts'), 'utf8');
    expect(specifiers(src)).toEqual([]);
    expect(src).toMatch(/import\(\/\* @vite-ignore \*\/ url\)/);
    expect(src).toMatch(/BOARD_SCRIPT = 'board\/board\.js'/);
  });

  it('the bundled app.js has no React, engine or board input (esbuild metafile), with or without the loader in the graph', async () => {
    for (const stdin of [null, `import { loadBoard } from './core/board.js';\nimport './main.js';\n(globalThis as { keep?: unknown }).keep = loadBoard;`]) {
      const r = await build({
        ...(stdin ? { stdin: { contents: stdin, resolveDir: SRC, loader: 'ts' as const } } : { entryPoints: [path.join(SRC, 'main.ts')] }),
        absWorkingDir: ROOT,
        bundle: true,
        format: 'iife',
        platform: 'browser',
        target: 'es2022',
        define: { __GNOMON_PREVIEW__: 'false' },
        write: false,
        metafile: true,
        logLevel: 'silent',
      });
      const inputs = Object.keys(r.metafile.inputs);
      // nor the board's host layer: the leaf, the rail, the tray, the overlay, the seal (review S5). core/board.ts,
      // the loader, is an input only in the second pass, where this test puts it in the graph itself
      expect(inputs.map((i) => i.slice(i.lastIndexOf('src/') + 4)).filter((i) => /^(core|ui)\/board[-.]/.test(i))).toEqual(stdin ? ['core/board.ts'] : []);
      expect(inputs.filter((i) => /(^|\/)node_modules\/(react|react-dom|scheduler|@excalidraw)\//.test(i) || /(^|\/)src\/board\//.test(i))).toEqual([]);
      expect(inputs.some((i) => i.endsWith('src/main.ts'))).toBe(true);
      // the loader stays a native dynamic import of a computed URL (nothing for esbuild to inline)
      if (stdin) expect(r.outputFiles[0]!.text).toMatch(/import\(\s*(\/\*[^*]*\*\/\s*)?url\s*\)/);
    }
  });

  it('the SHIPPED app.js (the kernel embed) names no React or engine internals', () => {
    const app = shipped('app.js');
    expect(app.length).toBeGreaterThan(100_000);
    expect(app).not.toMatch(/react-dom|__SECRET_INTERNALS|__CLIENT_INTERNALS_DO_NOT_USE|createRoot|excalidraw|EXCALIDRAW_ASSET_PATH/i);
  });

  // The board bytes are in the pinned tree and the kernel serves them, but until the S1.1 reskin and the S1.3 board
  // leaf NOTHING the kernel-served page runs may reach them: the stock-looking engine must not be openable.
  it.each(['app.js', 'index.html', 'boot.js', 'styles.css'])('the SHIPPED %s neither references the board chunk nor can load it', (name) => {
    const text = shipped(name);
    expect(text.length).toBeGreaterThan(100);
    expect(text).not.toMatch(/board\/board\.(js|css)|board\/asset-|loadBoard|mountBoard|gnomonBoard|BOARD_SCRIPT|BOARD_STYLES/);
    expect(text).not.toMatch(/\bimport\s*\(/); // no dynamic import of anything in the served GUI
  });

  /** The board's host layer (boards S1.1 pass B): it draws round the engine and is handed the loader, never imports it. */
  const HOST_LAYER = ['core/board-leaf.ts', 'core/board-overlay.ts', 'core/board-rail.ts', 'core/board-seal.ts', 'core/board-tray.ts', 'ui/board-leaf.ts'];

  it('in src, only the dev preview, the loader itself and the host layer name the loader module; only the preview CALLS it', () => {
    const users = walk(SRC)
      .filter((f) => /loadBoard|core\/board\.js|\.\/board\.js/.test(readFileSync(f, 'utf8')))
      .map(rel)
      .filter((f) => f !== 'core/board.ts' && !f.startsWith('board/'));
    expect(users.every((f) => f.startsWith('preview/') || HOST_LAYER.includes(f)), users.join(', ')).toBe(true);
    // the host layer takes types (and three constants) from core/board.ts; the loader is passed to it as an option
    for (const f of HOST_LAYER) expect(readFileSync(path.join(SRC, ...f.split('/')), 'utf8'), f).not.toMatch(/\bloadBoard\b|\bimport\s*\(/);
    const callers = walk(SRC).filter((f) => /\bloadBoard\s*\(/.test(readFileSync(f, 'utf8'))).map(rel).filter((f) => f !== 'core/board.ts');
    expect(callers.every((f) => f.startsWith('preview/')), callers.join(', ')).toBe(true);
  });

  it('nothing the app entry imports, at any depth, reaches the host layer or the loader (no product code path opens a board yet)', () => {
    const seen = new Set<string>();
    const visit = (abs: string): void => {
      if (seen.has(abs)) return;
      seen.add(abs);
      for (const spec of specifiers(readFileSync(abs, 'utf8'))) {
        if (!spec.startsWith('.')) continue;
        const target = path.resolve(path.dirname(abs), spec.replace(/\.js$/, '.ts'));
        if (target.endsWith('.ts') && statSync(target, { throwIfNoEntry: false })?.isFile()) visit(target);
      }
    };
    visit(path.join(SRC, 'main.ts'));
    const reached = [...seen].map(rel);
    expect(reached.length).toBeGreaterThan(20);
    expect(reached).toContain('ui/app.ts');
    expect(reached.filter((f) => HOST_LAYER.includes(f) || f === 'core/board.ts' || f.startsWith('board/') || f.startsWith('preview/'))).toEqual([]);
  });
});
