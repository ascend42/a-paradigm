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

  it('core/board.ts reaches the chunk only by URL: import() of a computed bundle path, and its one static specifier is a TYPE-ONLY import of the contracts (the handle speaks DimState and DimOp since S1.3)', () => {
    const src = readFileSync(path.join(SRC, 'core', 'board.ts'), 'utf8');
    expect(specifiers(src)).toEqual(['@a-company/gnomon-contracts']);
    expect(src.match(/^import .*$/gm)).toEqual(["import type { DimOp, DimState } from '@a-company/gnomon-contracts';"]);
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
      // since S1.3 P4b-1 the app mounts the leaf: the loader and the board's HOST layer are in the app bundle (they
      // draw round the engine and hold no engine code); the engine itself stays in the lazy chunk (next assertion)
      expect(inputs.map((i) => i.slice(i.lastIndexOf('src/') + 4)).filter((i) => /^(core|ui)\/board[-.]/.test(i)).sort()).toEqual(['core/board-leaf.ts', 'core/board-open.ts', 'core/board-overlay.ts', 'core/board-rail.ts', 'core/board-seal.ts', 'core/board-tray.ts', 'core/board-turn.ts', 'core/board.ts', 'ui/board-dock.ts', 'ui/board-leaf.ts', 'ui/board-turn.ts']);
      // (P4b-2: the turn strip, core/board-turn.ts and ui/board-turn.ts, is host DOM over the chat's own items)
      // the loader is a native dynamic import of a computed URL in BOTH passes now (nothing for esbuild to inline)
      expect(r.outputFiles[0]!.text).toMatch(/import\(\s*(\/\*[^*]*\*\/\s*)?url\s*\)/);
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

  // Since S1.3 P4b-1 the app opens the board: app.js names the chunk and loads it, lazily, through the loader's ONE
  // dynamic import of a computed URL. Nothing else the kernel-served page runs references or can load it.
  it('the SHIPPED app.js reaches the board chunk only through the loader: one dynamic import, of a computed URL, and the engine is not in it', () => {
    const app = shipped('app.js');
    expect(app).toMatch(/board\/board\.js/);
    expect(app.match(/\bimport\s*\(/g)).toHaveLength(1);
    expect(app).toMatch(/import\(\s*(\/\*[^*]*\*\/\s*)?[A-Za-z_$][\w$]*\s*\)/);
    // the engine is megabytes: the app bundle did not grow by it
    // the engine is 1.3 MB on its own: the app bundle grew by the board's host layer (about 165 kB), not by the engine
    expect(shipped('board/board.js').length).toBeGreaterThan(1_200_000);
    expect(app.length).toBeLessThan(1_400_000);
  });

  it.each(['index.html', 'boot.js', 'styles.css'])('the SHIPPED %s neither references the board chunk nor can load it', (name) => {
    const text = shipped(name);
    expect(text.length).toBeGreaterThan(100);
    expect(text).not.toMatch(/board\/board\.(js|css)|board\/asset-|loadBoard|mountBoard|gnomonBoard|BOARD_SCRIPT|BOARD_STYLES/);
    expect(text).not.toMatch(/\bimport\s*\(/); // no dynamic import of anything in the served GUI
  });

  /** The board's host layer (boards S1.1 pass B): it draws round the engine and is handed the loader, never imports it. */
  /** With it since S1.3 P4a: the dimension session (core/dim-session.ts), which is handed a board handle. Since P4b-1 the dock (ui/board-dock.ts) mounts the leaf in the app. */
  const HOST_LAYER = ['core/board-leaf.ts', 'core/board-overlay.ts', 'core/board-rail.ts', 'core/board-seal.ts', 'core/board-tray.ts', 'core/dim-session.ts', 'ui/board-leaf.ts', 'ui/board-dock.ts'];
  /** The ONE product caller of the loader: the app hands `loadBoard` to the dock as its `load` option. */
  const APP = 'ui/app.ts';

  it('in src, only the dev preview, the loader itself, the host layer and the app name the loader module; only the preview and the app CALL it', () => {
    const users = walk(SRC)
      .filter((f) => /loadBoard|core\/board\.js|\.\/board\.js/.test(readFileSync(f, 'utf8')))
      .map(rel)
      .filter((f) => f !== 'core/board.ts' && !f.startsWith('board/'));
    expect(users.every((f) => f.startsWith('preview/') || HOST_LAYER.includes(f) || f === APP), users.join(', ')).toBe(true);
    // the host layer takes types (and three constants) from core/board.ts; the loader is passed to it as an option
    for (const f of HOST_LAYER) expect(readFileSync(path.join(SRC, ...f.split('/')), 'utf8'), f).not.toMatch(/\bloadBoard\b|\bimport\s*\(/);
    const callers = walk(SRC).filter((f) => /\bloadBoard\s*\(/.test(readFileSync(f, 'utf8'))).map(rel).filter((f) => f !== 'core/board.ts');
    expect(callers.every((f) => f.startsWith('preview/') || f === APP), callers.join(', ')).toBe(true);
    expect(callers).toContain(APP);
  });

  it('no module-level "current event" exists: a board command is handed the event of its own press (Aegis M1, review of PR #119)', () => {
    for (const f of ['ui/app.ts', 'ui/board-dock.ts', 'ui/slash-menu.ts', 'core/board-open.ts']) {
      const src = readFileSync(path.join(SRC, ...f.split('/')), 'utf8');
      // no top-level variable holds an Event, and the deprecated ambient event is never read
      expect(src.match(/^(let|var|const) \w+: (Event|KeyboardEvent|MouseEvent|PointerEvent)\b[^\n]*$/gm), f).toBeNull();
      expect(src, f).not.toMatch(/\bpressEvent\b|\bwindow\.event\b|\bglobalThis\.event\b/);
    }
    const app = readFileSync(path.join(SRC, 'ui', 'app.ts'), 'utf8');
    expect(app).toMatch(/function run\(id: string, trusted: boolean, event\?: Event\): void \{/);
    expect(app).toContain("if (trusted && event?.isTrusted) boardDock.command('', event);");
  });

  it("'mod.command' is named only by the one sender and the preview's fake kernel", () => {
    const users = walk(SRC).filter((f) => /['"`]mod\.command['"`]/.test(readFileSync(f, 'utf8'))).map(rel);
    expect(users.sort()).toEqual(['core/mod-command.ts', 'preview/fake-kernel.ts']);
  });

  it('the app entry reaches the loader, the leaf and the session (it mounts the board since P4b-1), and at no depth src/board or src/preview', () => {
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
    expect(reached.filter((f) => f.startsWith('board/') || f.startsWith('preview/'))).toEqual([]);
    for (const f of ['core/board.ts', 'ui/board-leaf.ts', 'core/dim-session.ts', 'ui/board-dock.ts', 'core/board-open.ts']) expect(reached, f).toContain(f);
    // app.ts itself names no file under src/board or src/preview
    const app = specifiers(readFileSync(path.join(SRC, 'ui', 'app.ts'), 'utf8')).filter((x) => x.startsWith('.')).map((x) => rel(path.resolve(SRC, 'ui', x)));
    expect(app.filter((f) => f.startsWith('board/') || f.startsWith('preview/'))).toEqual([]);
    expect(app).toEqual(expect.arrayContaining(['core/board.js', 'core/dim-session.js', 'ui/board-dock.js']));
  });
});
