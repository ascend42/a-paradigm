/**
 * #gui-board build-time patches (boards S1.0; s1-build-plan §6 "Fragile Excalidraw patches: exact pin; a test per
 * patch that fails on a version bump"). Each patch is applied to the INSTALLED engine and must match exactly as
 * many times as it was written for; a patch whose target moved throws by name, so the build never ships a
 * half-patched engine. The whole-chunk results (what the patches leave in the bytes) are test/board-scan.test.ts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs build scripts (no types)
import { applyPatch, applyPatches, countMatches, CSS_ASSETS, ENGINE, ENGINE_FILES, extractCssAssets, NAMESPACE_URLS, PATCHED_FILES, PATCHES, PatchError, sha256, STRIPPED_HOST, stripHosts, STUBS } from '../scripts/board-patches.mjs';
// @ts-expect-error plain .mjs build scripts (no types)
import { buildBoard, embeddedFiles, engineRoot, LICENSE_ALLOW, patchKeyPath, vendoredNotice } from '../scripts/board-build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { devDependencies: Record<string, string> };
const installed = (key: string): Buffer => readFileSync(patchKeyPath(key, engineRoot()) as string);

interface Patch { id: string; file: string; find: string | RegExp; expect: number; why: string }
interface Report { engine: string; patches: Record<string, number>; stubs: Record<string, number>; hosts: Record<string, number>; packages: Array<{ name: string; version: string; license: string }>; reactInputs: string[]; totalBytes: number }

describe('#gui-board engine pin', () => {
  it('react, react-dom and the engine are EXACT pins of the private gnomon-gui package (devDependencies, no range)', () => {
    expect(pkg.devDependencies['@excalidraw/excalidraw']).toBe('0.18.1');
    expect(pkg.devDependencies.react).toBe('19.3.1');
    expect(pkg.devDependencies['react-dom']).toBe('19.3.1');
    expect(ENGINE).toEqual({ name: '@excalidraw/excalidraw', version: pkg.devDependencies['@excalidraw/excalidraw'] });
    expect(JSON.parse(readFileSync(path.join(engineRoot() as string, 'package.json'), 'utf8')).version).toBe(ENGINE.version);
  });

  it.each(Object.keys(ENGINE_FILES as Record<string, string>))('%s is byte-for-byte the file the patches were written for', (key) => {
    expect(sha256(installed(key)), `${key} changed: the engine is not ${ENGINE.name}@${ENGINE.version}; re-derive every patch`).toBe((ENGINE_FILES as Record<string, string>)[key]);
  });
});

describe('#gui-board patches: one test per patch, loud on a version bump', () => {
  const counts: Record<string, number> = {};
  beforeAll(() => {
    for (const f of PATCHED_FILES as string[]) Object.assign(counts, (applyPatches(f, installed(f).toString('utf8')) as { counts: Record<string, number> }).counts);
  });

  it('applyPatches reports MEASURED counts (a count read back from `expect` would prove nothing)', () => {
    const p = (PATCHES as Patch[]).find((x) => x.id === 'no-fetch-ui')!;
    expect(countMatches(p, 'a=fetch(u);b=fetch(v);c=x.fetch(w);fetch(z)')).toBe(3);
    expect(countMatches({ find: 'ab' }, 'abab-ab')).toBe(3);
    expect(countMatches({ find: /x/ }, 'xxx')).toBe(3);
  });

  it.each((PATCHES as Patch[]).map((p) => [p.id, p] as const))('%s matches the installed engine exactly as often as written', (_id, p) => {
    expect(counts[p.id], `${p.id} (${p.why})`).toBe(p.expect);
    // measured a second way, on the text this patch sees: the file with only the EARLIER patches applied
    let text = installed(p.file).toString('utf8');
    for (const q of (PATCHES as Patch[]).filter((x) => x.file === p.file)) {
      if (q.id === p.id) break;
      text = applyPatch(q, text) as string;
    }
    expect(countMatches(p, text), p.id).toBe(p.expect);
    expect(p.why.length).toBeGreaterThan(10);
  });

  it.each((PATCHES as Patch[]).map((p) => [p.id, p] as const))('%s throws by name when its target is gone (never a silent no-op)', (_id, p) => {
    const text = installed(p.file).toString('utf8');
    const gone = typeof p.find === 'string' ? text.split(p.find).join('') : text.replace(p.find, '');
    let thrown: unknown;
    try {
      applyPatch(p, gone);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(PatchError);
    expect((thrown as { patch: string }).patch).toBe(p.id);
    expect(String((thrown as Error).message)).toContain(`${ENGINE.name}@${ENGINE.version}`);
  });

  it('the stylesheet data: images become bundle files (5 png of one image, 2 svg), named by content hash; a moved count throws', () => {
    const css = (applyPatches('index.css', installed('index.css').toString('utf8')) as { text: string }).text;
    const x = extractCssAssets(css) as { css: string; assets: Map<string, Buffer>; counts: Record<string, number> };
    expect(x.counts).toEqual({ 'css-data-png': CSS_ASSETS.png.expect, 'css-data-svg': CSS_ASSETS.svg.expect });
    expect(x.css).not.toMatch(/data:/);
    expect(x.css).not.toMatch(/@font-face/);
    expect([...x.assets.keys()].map((n) => n.replace(/[0-9a-f]{16}/, '<sha>')).sort()).toEqual(['asset-<sha>.png', 'asset-<sha>.svg', 'asset-<sha>.svg']);
    for (const [n, b] of x.assets) {
      expect(n).toBe(`asset-${(sha256(b) as string).slice(0, 16)}.${n.endsWith('.png') ? 'png' : 'svg'}`);
      if (n.endsWith('.png')) expect(b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
      else expect(b.toString('utf8')).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^]*<\/svg>$/);
    }
    expect(() => extractCssAssets('.a{background:url(data:image/png;base64,AAAA)}')).toThrow(PatchError);
  });

  it('stripHosts removes every http(s) host but the XML namespaces, and says which', () => {
    const src = `a="https://esm.sh/x";b='http://json.excalidraw.com/api';c="http://www.w3.org/2000/svg";d=\`https://\${host}/x\`;e="https://127.0.0.1:8080/y"`;
    const r = stripHosts(src) as { text: string; hosts: Record<string, number> };
    expect(r.hosts).toEqual({ 'esm.sh': 1, 'json.excalidraw.com': 1, '127.0.0.1:8080': 1 });
    expect(r.text).toBe(`a="${STRIPPED_HOST}/x";b='${STRIPPED_HOST}/api';c="http://www.w3.org/2000/svg";d=\`https://\${host}/x\`;e="${STRIPPED_HOST}/y"`);
    for (const ns of NAMESPACE_URLS as string[]) expect((stripHosts(`"${ns}"`) as { text: string }).text).toBe(`"${ns}"`);
  });
});

describe('#gui-board build report (a real build of the pinned engine)', () => {
  let report: Report;
  let files: Map<string, Buffer>;
  beforeAll(async () => {
    const r = (await buildBoard()) as { report: Report; files: Map<string, Buffer> };
    report = r.report;
    files = r.files;
  }, 120_000);

  it('every patch and every stub applied exactly as written', () => {
    const want: Record<string, number> = Object.fromEntries((PATCHES as Patch[]).map((p) => [p.id, p.expect]));
    want['css-data-png'] = CSS_ASSETS.png.expect;
    want['css-data-svg'] = CSS_ASSETS.svg.expect;
    expect(report.patches).toEqual(want);
    expect(report.stubs).toEqual(Object.fromEntries((STUBS as Array<{ id: string; expect: number }>).map((s) => [s.id, s.expect])));
    expect(report.stubs).toEqual({ locales: 55, 'font-subset': 2, 'build-env': 3, mermaid: 1, 'image-resize': 2 });
  });

  it('untrusted input cannot be made to count in what ships: `syntheticInput` is not in the built chunk, nor in the pinned bytes; only a probe build carries it (Aegis, P3b-1 review)', async () => {
    const built = files.get('board/board.js')!.toString('utf8');
    expect(built).not.toContain('syntheticInput');
    expect(built).not.toContain('__GNOMON_BOARD_PROBE__');
    // the bytes the kernel serves: the pinned embed's own board/board.js
    const pinned = (embeddedFiles(readFileSync(new URL('../../gnomon/src/kernel/web/gui-bundle.ts', import.meta.url), 'utf8')) as Map<string, Buffer>).get('board/board.js')!;
    expect(pinned.length).toBeGreaterThan(1_000_000);
    expect(pinned.toString('utf8')).not.toContain('syntheticInput');
    // the probe build differs from the shipped one by that branch alone, and build.mjs (the embed) never asks for it
    const probe = ((await buildBoard({ probe: true })) as { files: Map<string, Buffer> }).files.get('board/board.js')!.toString('utf8');
    expect(probe).toContain('syntheticInput');
    // what is embedded (build.mjs) and what the dev preview serves (preview.mjs) call buildBoard() with NO argument:
    // an object literal, a `{ probe }` shorthand or a variable would all fail here
    for (const script of ['build.mjs', 'preview.mjs']) {
      const calls = [...readFileSync(new URL(`../scripts/${script}`, import.meta.url), 'utf8').matchAll(/buildBoard\(([^)]*)\)/g)].map((m) => m[1]);
      expect(calls.length, script).toBeGreaterThan(0);
      expect(calls, script).toEqual(calls.map(() => ''));
    }
  }, 120_000);

  it('the hosts stripped from the minified chunk are exactly the pinned list (a new host in a bump is seen here)', () => {
    // (libraries.excalidraw.com left with the Library components, patch library-components-stubbed, S1.4 P4a)
    expect(Object.keys(report.hosts).sort()).toEqual([
      'discord.gg', 'docs.excalidraw.com', 'embed.reddit.com', 'giphy.com', 'gist.github.com', 'github.com', 'mermaid.js.org',
      'platform.twitter.com', 'player.vimeo.com', 'plus.excalidraw.com', 'react.dev', 'reddit.com', 'twitter.com', 'www.figma.com', 'www.youtube.com', 'x.com', 'youtube.com',
    ]);
  });

  it('React is one copy, the pinned version, the production build (Aegis S1 risk e)', () => {
    const reacts = report.packages.filter((p) => ['react', 'react-dom', 'scheduler'].includes(p.name));
    expect(reacts.map((p) => `${p.name}@${p.version}`)).toEqual([`react@${pkg.devDependencies.react}`, `react-dom@${pkg.devDependencies['react-dom']}`, expect.stringMatching(/^scheduler@/)]);
    expect(report.reactInputs.filter((i) => /development/.test(i))).toEqual([]);
    expect(report.reactInputs).toEqual(expect.arrayContaining(['react/cjs/react.production.js', 'react-dom/cjs/react-dom-client.production.js', 'scheduler/cjs/scheduler.production.js']));
    const js = files.get('board/board.js')!.toString('utf8');
    expect(js).not.toMatch(/process\.env\.NODE_ENV/);
    expect(js).not.toMatch(/react(-dom)?\.development|Download the React DevTools/);
  });

  it('the pruned trees are not bundled: no Mermaid, KaTeX, lodash-es, langium, chevrotain or pica package', () => {
    const names = report.packages.map((p) => p.name);
    for (const gone of ['@excalidraw/mermaid-to-excalidraw', 'mermaid', 'katex', 'lodash-es', 'langium', 'chevrotain', 'pica', 'image-blob-reduce', '@mermaid-js/parser']) expect(names, gone).not.toContain(gone);
  });

  it('LICENSES.txt carries a notice for every bundled package, all under an allowed licence (item 8)', () => {
    const txt = files.get('board/LICENSES.txt')!.toString('utf8');
    expect(txt).not.toMatch(/\r/);
    expect(report.packages.length).toBeGreaterThan(40);
    for (const p of report.packages) {
      expect(LICENSE_ALLOW as string[], `${p.name}@${p.version}`).toContain(p.license);
      expect(txt, p.name).toContain(`\n${p.name}@${p.version}\nLicence: ${p.license}\n`);
    }
    expect(txt).not.toMatch(/ships no licence file/);
    // every section carries a copyright line and licence terms, including the packages whose tarball has no file
    const sections = txt.split('='.repeat(78)).slice(1);
    expect(sections.length).toBe(report.packages.length);
    for (const sec of sections) expect(sec, sec.slice(0, 60)).toMatch(/copyright|public domain|CC0/i);
    expect(vendoredNotice('@radix-ui/react-popover', 'MIT')).toMatch(/^MIT License\n\nCopyright \(c\) 2022 WorkOS\n\nPermission is hereby granted/);
    expect(vendoredNotice('@radix-ui/react-popover', 'Apache-2.0')).toBeNull();
    expect(vendoredNotice('left-pad', 'MIT')).toBeNull();
    // the MIT permission notice itself, for the engine and for React
    for (const name of ['@excalidraw/excalidraw', 'react', 'react-dom']) {
      const at = txt.indexOf(`\n${name}@`);
      const section = txt.slice(at, txt.indexOf(`\n${'='.repeat(78)}`, at + 1) === -1 ? undefined : txt.indexOf(`\n${'='.repeat(78)}`, at + 1));
      expect(section, name).toMatch(/Permission is hereby granted, free of charge/);
      expect(section, name).toMatch(/Copyright/);
    }
  });

  it('the build is deterministic: a second build is byte-identical', async () => {
    const again = ((await buildBoard()) as { files: Map<string, Buffer> }).files;
    expect([...again.keys()].sort()).toEqual([...files.keys()].sort());
    for (const [n, b] of files) expect(again.get(n)!.equals(b), n).toBe(true);
  }, 120_000);
});

describe('#gui-board S1.4 P4a: the Library is out of the bytes', () => {
  it('the shipped chunk holds no Library unit, item grid or menu, and the one innerHTML writer of the unit is gone', async () => {
    const { buildBoard } = (await import('../scripts/board-build.mjs')) as { buildBoard: () => Promise<{ files: Map<string, Uint8Array> }> };
    const { files } = await buildBoard();
    const js = Buffer.from(files.get('board/board.js')!).toString('utf8');
    for (const word of ['library-unit', 'library-menu-items-container', 'library-menu', 'layer-ui__library', 'libraries.excalidraw.com']) expect(js.includes(word), word).toBe(false);
    expect(js.includes('h.innerHTML=c.outerHTML')).toBe(false);
  }, 120_000);
});
