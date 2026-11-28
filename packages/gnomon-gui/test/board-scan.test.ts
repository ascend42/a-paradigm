/**
 * #gui-board static scan and pin (boards S1.0 items 5, 6; Aegis S1 merge condition, risks d, e, f). The scan runs
 * over the SHIPPED bytes: the `board/*` files decoded from the kernel's embed (gui-bundle.ts), the bytes the web
 * endpoint serves. The forbidden source must be ABSENT, not merely unreached: no `eval(`, no `new Function` /
 * `Function(`, no `WebAssembly.`, no external host, no `fetch(` at all (so none can be non-loopback), no `data:`
 * URL, no sourcemap. The scanner is the P12 probe's own (one definition), and is itself tested on planted bytes.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs (the zero-dependency probe harness)
import { embeddedBundle, shippedBoard, staticScan } from '../../gnomon/probes/p12-excalidraw-csp/harness.mjs';
// @ts-expect-error plain .mjs build scripts (no types)
import { BOARD_BUDGET_BYTES, BOARD_REQUIRED, boardProblems, buildBoard, embeddedFiles, unpinnedBoardFiles } from '../scripts/board-build.mjs';
// @ts-expect-error plain .mjs build scripts (no types)
import { NAMESPACE_URLS } from '../scripts/board-patches.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EMBED = path.resolve(ROOT, '..', 'gnomon', 'src', 'kernel', 'web', 'gui-bundle.ts');
interface Finding { file: string; rule: string; count: number; sample?: string[] }
interface Scan { files: Record<string, { bytes: number; gzip: number }>; totalBytes: number; totalGzip: number; findings: Finding[] }

const board = shippedBoard() as Map<string, Buffer>;
const text = (n: string): string => board.get(n)!.toString('utf8');
const scan = (files: Map<string, Buffer>): Scan => staticScan(files) as Scan;
const planted = (js: string): string[] => scan(new Map([['board/board.js', Buffer.from(js)]])).findings.map((f) => f.rule);

describe('#gui-board static scan of the shipped chunk (item 6)', () => {
  it('the scanner flags each forbidden construct on planted bytes (it is not vacuous)', () => {
    expect(planted('x=eval("1")')).toEqual(['eval']);
    expect(planted('x=window.eval ("1")')).toEqual(['eval']);
    expect(planted('x=(0,eval)("1")')).toEqual(['eval']);
    expect(planted('const medieval=1,evaluate=2')).toEqual([]);
    expect(planted('i.src=`data:${t},${encodeURIComponent(s)}`')).toEqual(['dataUrlBuilder']); // not the allowed shape
    expect(planted('a=`data:${t};base64,${x}`')).toEqual([]); // the one image-file encoder, by exact count
    expect(planted('a=`data:${t};base64,${x}`;b=`data:${u};base64,${y}`')).toEqual(['dataUrlBuilder']);
    expect(planted('c.toDataURL()')).toEqual([]);
    expect(planted('c.toDataURL();d.toDataURL("image/png")')).toEqual(['toDataURL']);
    expect(scan(new Map([['board/board.css', Buffer.from('a{b:url("data:x/y,1")}')]])).findings.map((f) => f.rule)).toEqual(['dataUrlBuilder']);
    expect(planted('x=new Function("return 1")')).toEqual(['newFunction']);
    expect(planted('x=a||Function("return this")()')).toEqual(['newFunction']);
    expect(planted('await WebAssembly.instantiate(b)')).toEqual(['webAssembly']);
    expect(planted('await WebAssembly .compile(b)')).toEqual(['webAssembly']);
    expect(planted('const W=WebAssembly')).toEqual(['webAssembly']);
    expect(planted('fetch("/x")')).toEqual(['fetch']);
    expect(planted('window.fetch(u)')).toEqual(['fetch']);
    expect(planted('a="https://esm.sh/@excalidraw/excalidraw@0.18.1/dist/prod/"')).toEqual(['externalUrl']);
    expect(planted('a="http://json.excalidraw.com/api/v2/"')).toEqual(['externalUrl']);
    expect(planted('a="http://www.w3.org/2000/svg"')).toEqual([]);
    expect(planted('i.src="data:image/svg+xml,<svg/>"')).toEqual(['dataUrl', 'dataUrlBuilder']);
    expect(planted('x=1\n//# sourceMappingURL=board.js.map')).toEqual(['sourceMap']);
    expect(scan(new Map([['board/board.js.map', Buffer.from('{}')]])).findings.map((f) => f.rule)).toEqual(['mapFile']);
    expect(planted('const refetch=()=>prefetch(1);o.gnomonBoardRefuseFetch()')).toEqual([]);
  });

  it('the shipped board chunk has NO finding: no eval(, new Function, WebAssembly., external host, fetch(, data: URL or sourcemap', () => {
    const s = scan(board);
    expect(s.findings, JSON.stringify(s.findings, null, 1)).toEqual([]);
    expect(Object.keys(s.files).sort()).toEqual([...board.keys()].sort());
  });

  it('the only http(s) literals left are XML namespace URIs', () => {
    for (const n of ['board/board.js', 'board/board.css']) {
      const urls = [...new Set(text(n).match(/https?:\/\/[^\s"'`)\\]*/g) ?? [])].filter((u) => !/^https:\/\/\$\{/.test(u) && u !== 'https://');
      for (const u of urls) expect(NAMESPACE_URLS as string[], `${n}: ${u}`).toContain(u);
    }
  });

  it("Excalidraw's hardcoded hosts are gone by name: esm.sh, excalidraw.com, the json/collab/AI/library backends, Firebase", () => {
    const js = text('board/board.js');
    expect(js).not.toMatch(/esm\.sh|excalidraw\.com|excalidraw-room-persistence|firebaseapp|firebaseio|cloudfunctions\.net|oss-collab|oss-ai|googleapis|unpkg|jsdelivr/);
    expect(js).not.toMatch(/AIzaSy|MIIBIjANBgkq/); // the Firebase API key and the export public key left with the env chunk
    expect(js).not.toMatch(/"youtu\.be"|simplepdf|stackblitz|val\.town|link\.excalidraw/); // the embed allowlists are empty
  });

  it('no font, locale, Mermaid, subsetter or image-resizer source is in the chunk; the stand-ins are', () => {
    const js = text('board/board.js');
    const css = text('board/board.css');
    // the one font the chunk names is the bundle's own JetBrains Mono, beside the chunk (S1.1); no engine font file
    expect([...js.matchAll(/["'`]([^"'`]*\.(?:woff2?|ttf|otf))["'`]/g)].map((m) => m[1])).toEqual(['../fonts/JetBrainsMono-Regular.woff2']);
    expect(css).not.toMatch(/@font-face|\.woff|url\(\s*["']?(data:|https?:|\/\/)/);
    expect([...css.matchAll(/url\(([^)]*)\)/g)].map((m) => m[1]!).every((u) => /^\.\/asset-[0-9a-f]{16}\.(png|svg)$/.test(u))).toBe(true);
    expect(js).not.toMatch(/hb-subset|harfbuzz|woff2_|Emscripten|asm\.js|mermaid\.initialize|parseMermaid\w*=async|katex/i);
    expect(js).not.toMatch(/Wybierz|Auswählen|Sélection|选择|選択/); // a word from five locale packs
    expect(js).toMatch(/is not built into the board/); // src/board/stubs/refused.ts
    expect(js).not.toMatch(/setAttribute\("style"/);
  });

  it('every stylesheet asset the chunk names is a file of the chunk, and nothing else is', () => {
    const named = [...text('board/board.css').matchAll(/url\(\.\/(asset-[0-9a-f]{16}\.(?:png|svg))\)/g)].map((m) => `board/${m[1]}`);
    expect([...new Set(named)].sort()).toEqual([...board.keys()].filter((n) => /asset-/.test(n)).sort());
    for (const n of board.keys()) if (n.endsWith('.svg')) expect(text(n), n).not.toMatch(/<script|foreignObject|\son[a-z]+=|href|style=|<style/i);
  });
});

describe('#gui-board is inside the pinned tree, under budget, with no sourcemap (item 5; Aegis S1 risk d)', () => {
  let fresh: Map<string, Buffer>;
  beforeAll(async () => {
    fresh = ((await buildBoard()) as { files: Map<string, Buffer> }).files;
  }, 120_000);

  it('the board files are members of the embed and its gnomon-bundle-tree:v1 hash covers them', () => {
    const src = readFileSync(EMBED, 'utf8');
    const files = embeddedBundle() as Map<string, Buffer>;
    for (const n of BOARD_REQUIRED as string[]) expect(files.has(n), n).toBe(true);
    const treeHash = (m: Map<string, Buffer>): string => {
      const h = createHash('sha256').update('gnomon-bundle-tree:v1\n');
      for (const n of [...m.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) h.update(`${n}\0${createHash('sha256').update(m.get(n)!).digest('hex')}\n`);
      return `sha256:${h.digest('hex')}`;
    };
    const pin = /export const GUI_BUNDLE_HASH = "(sha256:[0-9a-f]{64})";/.exec(src)![1];
    expect(treeHash(files)).toBe(pin);
    // one changed byte in a board file, or a dropped board file, is a different pin
    const bent = new Map(files);
    bent.set('board/board.js', Buffer.concat([files.get('board/board.js')!, Buffer.from(' ')]));
    expect(treeHash(bent)).not.toBe(pin);
    const dropped = new Map(files);
    dropped.delete('board/LICENSES.txt');
    expect(treeHash(dropped)).not.toBe(pin);
  });

  it('a fresh build of the board is byte-identical to the pinned files (nothing unpinned)', () => {
    expect(unpinnedBoardFiles(fresh, embeddedFiles(readFileSync(EMBED, 'utf8')))).toEqual([]);
    expect(unpinnedBoardFiles(fresh, board)).toEqual([]);
  });

  it('--check names an unpinned, changed or stale board file', () => {
    const embedded = new Map(board);
    embedded.delete('board/board.css');
    expect(unpinnedBoardFiles(fresh, embedded)).toEqual(['board/board.css is not in the pinned tree']);
    const changed = new Map(board);
    changed.set('board/board.js', Buffer.from('x'));
    expect(unpinnedBoardFiles(fresh, changed)).toEqual(['board/board.js differs from the pinned bytes']);
    const stale = new Map(board);
    stale.set('board/asset-0000000000000000.png', Buffer.from('x'));
    expect(unpinnedBoardFiles(fresh, stale)).toEqual(['board/asset-0000000000000000.png is pinned but no longer built']);
  });

  it('the chunk is within its 4 MB raw budget; over budget, a sourcemap, a missing or an unknown member stop the build', () => {
    expect(BOARD_BUDGET_BYTES).toBe(4 * 1024 * 1024);
    const total = [...board.values()].reduce((a, b) => a + b.length, 0);
    expect(total).toBeLessThanOrEqual(BOARD_BUDGET_BYTES);
    expect(total).toBeGreaterThan(500_000); // a real engine, not an empty stub
    expect(gzipSync(board.get('board/board.js')!).length).toBeLessThan(600_000);
    expect(boardProblems(board)).toEqual([]);
    expect(boardProblems(board, total - 1)).toEqual([`the board chunk is ${total} bytes, over its ${total - 1} byte budget`]);
    expect(boardProblems(new Map([...board, ['board/board.js.map', Buffer.from('{}')]]))).toEqual(expect.arrayContaining(['board/board.js.map: no sourcemap may ship']));
    expect(boardProblems(new Map([...board, ['app.js.map', Buffer.from('{}')]]))).toEqual(['app.js.map: no sourcemap may ship']);
    expect(boardProblems(new Map([...board, ['board/board.js', Buffer.from('x=1\n//# sourceMappingURL=board.js.map\n')]]))).toEqual(['board/board.js: carries a sourceMappingURL']);
    expect(boardProblems(new Map([...board, ['board/extra.wasm', Buffer.from('x')]]))).toEqual(['board/extra.wasm: not a known board file']);
    const missing = new Map(board);
    missing.delete('board/LICENSES.txt');
    expect(boardProblems(missing)).toEqual(['board/LICENSES.txt is missing']);
    for (const n of board.keys()) expect(n).not.toMatch(/\.map$/);
  });

  it('build.mjs hashes the board into the tree and --check gates it (the script says so in code)', () => {
    const src = readFileSync(path.join(ROOT, 'scripts', 'build.mjs'), 'utf8');
    expect(src).toMatch(/for \(const \[n, b\] of \(await buildBoard\(\)\)\.files\)/);
    expect(src).toMatch(/const problems = boardProblems\(files\);/);
    expect(src).toMatch(/const unpinned = unpinnedBoardFiles\(files, embeddedFiles\(cur\)\);/);
    expect(src).toMatch(/if \(cur !== src \|\| unpinned\.length\)/);
    expect(readFileSync(path.join(ROOT, 'scripts', 'board-build.mjs'), 'utf8')).toMatch(/sourcemap: false,/);
  });
});
