/**
 * #gui-board hardening (boards S1.0; Probe's mutation pass on the S1.0 oracles). Each block closes a mutant that
 * the other board tests let live when the real-engine runs are skipped (every CI vitest run; G-DDL-06 runs only on
 * a developer machine and in the probes job):
 *
 *   - a patch, stub or stylesheet extraction DROPPED from scripts/board-patches.mjs: the per-patch tests iterate
 *     the list itself, so a missing entry was a shorter loop, not a failure;
 *   - forbidden source in a form the P12 scanner's patterns do not see: indirect `(0,eval)(`, `globalThis.eval(`,
 *     a string timer, `wss://` or protocol-relative hosts, XHR/WebSocket/beacon, and above all a `data:` URL whose
 *     media type is interpolated (the shape the engine itself ships: `data:${H.svg},…`);
 *   - the served page reaching the chunk by an injected script element instead of `import()`.
 *
 * Like test/board-scan.test.ts this reads the SHIPPED bytes (the kernel embed), never a source file.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs (the zero-dependency probe harness)
import { embeddedBundle, shippedBoard } from '../../gnomon/probes/p12-excalidraw-csp/harness.mjs';
// @ts-expect-error plain .mjs build scripts (no types)
import { CSS_ASSETS, ENGINE, PATCHES, STUBS } from '../scripts/board-patches.mjs';

const board = shippedBoard() as Map<string, Buffer>;
const bundle = embeddedBundle() as Map<string, Buffer>;
const js = board.get('board/board.js')!.toString('utf8');
const css = board.get('board/board.css')!.toString('utf8');

/**
 * What the board chunk's JS may not contain, by rules stricter than the P12 scanner's. Every rule holds on the
 * shipped chunk today with ZERO hits, so each is an absence, not a count to maintain.
 */
const FORBIDDEN: Readonly<Record<string, RegExp>> = Object.freeze({
  // the identifier itself, in any position: direct, indirect `(0,eval)(`, `globalThis.eval(`, an alias
  evalIdentifier: /\beval\b/,
  // the Function constructor however it is reached as a bare name: called, constructed, passed, `.call`ed
  functionConstructor: /(?<![.\w$])Function\b/,
  constructorOfConstructor: /\.constructor\.constructor\b|\.constructor\(\s*["'`]/,
  stringTimer: /\bset(?:Timeout|Interval)\(\s*["'`]/,
  webAssembly: /\bWebAssembly\b/,
  networkApi: /\b(?:XMLHttpRequest|sendBeacon|WebSocket|EventSource|RTCPeerConnection|importScripts|SharedWorker|serviceWorker)\b/,
  dynamicImport: /(?<![.\w$])import\s*\(/,
  // a host under any fetching scheme the http(s) rule does not cover, or with no scheme at all
  otherSchemeHost: /\b(?:wss?|ftp|file):\/\/[A-Za-z0-9[]/,
  protocolRelativeHost: /["'`(]\/\/[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}/,
  inlineStyleInMarkup: /style=\\?["']/,
  styleAttribute: /setAttribute\(\s*["'`]style["'`]/,
});
const hits = (text: string): string[] => Object.entries(FORBIDDEN).filter(([, re]) => re.test(text)).map(([rule]) => rule);

describe('#gui-board patch manifest is pinned (a dropped patch is a failure, not a shorter loop)', () => {
  it('the engine these counts were read from', () => {
    expect(ENGINE).toEqual({ name: '@excalidraw/excalidraw', version: '0.18.1' });
  });

  it('every patch is present, against its file, with its match count', () => {
    expect((PATCHES as Array<{ id: string; file: string; expect: number }>).map((p) => `${p.id} @ ${p.file} x${p.expect}`)).toEqual([
      'font-family-table @ chunk-K2UTITRG.js x1',
      'font-defaults @ chunk-K2UTITRG.js x1',
      'font-metrics @ chunk-K2UTITRG.js x1',
      'font-family-string @ chunk-K2UTITRG.js x1',
      'font-registry-empty @ chunk-K2UTITRG.js x1',
      'font-table-uris @ chunk-K2UTITRG.js x230',
      'embed-allowlists-empty @ chunk-K2UTITRG.js x1',
      'font-cdn-fallback-url @ chunk-K2UTITRG.js x1',
      'font-cdn-fallback-push @ chunk-K2UTITRG.js x1',
      'svg-inline-style-attrs @ chunk-K2UTITRG.js x4',
      'data-svg-images @ chunk-K2UTITRG.js x6',
      'eraser-cursor @ chunk-K2UTITRG.js x1',
      'svg-text-style-attribute @ chunk-K2UTITRG.js x1',
      'no-fetch-core @ chunk-K2UTITRG.js x2',
      'no-fetch-ui @ index.js x2',
      'library-trigger-removed @ index.js x1',
      'library-tab-trigger-removed @ index.js x1',
      'library-tab-removed @ index.js x1',
      'library-components-stubbed @ index.js x1',
      'image-tool-removed @ chunk-K2UTITRG.js x1',
      'roughness-zero @ chunk-K2UTITRG.js x1',
      'stroke-exact @ chunk-K2UTITRG.js x1',
      'dash-two-three @ chunk-K2UTITRG.js x1',
      'frame-edge-dashed @ chunk-K2UTITRG.js x1',
      'skin-frame @ chunk-K2UTITRG.js x1',
      'skin-marquee @ chunk-K2UTITRG.js x2',
      'layer-ui-removed @ index.js x1',
      'loading-message-removed @ index.js x1',
      'phone-layout-removed @ index.js x1',
      'toast-removed @ index.js x1',
      'link-popup-removed @ index.js x1',
      'context-menu-removed @ index.js x1',
      'image-insert-refused @ index.js x1',
      'paste-types-filtered @ index.js x1',
      'engine-paste-removed @ index.js x1',
      'engine-cut-removed @ index.js x1',
      'engine-copy-removed @ index.js x1',
      'text-editor-paste-removed @ index.js x1',
      'engine-drop-removed @ index.js x1',
      'flowchart-keys-removed @ index.js x1',
      'flowchart-navigate-removed @ index.js x1',
      'alt-drag-duplicate-removed @ index.js x1',
      'duplicate-action-removed @ index.js x1',
      'key-actions-allowlist @ index.js x1',
      'key-dialogs-removed @ index.js x1',
      'key-tools-removed @ index.js x1',
      'text-size-keys-removed @ index.js x1',
      'frame-name-editor @ index.js x1',
      'frame-name-editor-ink @ index.js x1',
      'frame-name-editor-keys @ index.js x1',
      'frame-name-title @ index.js x1',
      'api-run-action @ index.js x1',
      'yield-keyup @ index.js x1',
      'yield-gesture-start @ index.js x1',
      'yield-gesture-change @ index.js x1',
      'yield-gesture-end @ index.js x1',
      'skin-selection @ index.js x1',
      'skin-point-hover @ index.js x1',
      'skin-point-handles @ index.js x1',
      'skin-binding @ index.js x2',
      'skin-box-highlight @ index.js x2',
      'skin-transform-handles @ index.js x2',
      'skin-guides @ index.js x1',
      'skin-guide-literals @ index.js x1',
      'dash-screen-floor @ roughjs/bin/canvas.js x1',
      'dash-runs-continue @ roughjs/bin/canvas.js x1',
      'dash-runs-track @ roughjs/bin/canvas.js x1',
      'dash-runs-start @ roughjs/bin/canvas.js x1',
      'lodash-debounce-root @ lodash.debounce/index.js x1',
      'lodash-throttle-root @ lodash.throttle/index.js x1',
      'css-engine-violets @ index.css x7',
      'css-ui-font-faces @ index.css x4',
    ]);
  });

  it('every stand-in and every stylesheet extraction is present, with its count', () => {
    expect((STUBS as Array<{ id: string; stub: string; expect: number }>).map((s) => `${s.id} -> ${s.stub} x${s.expect}`)).toEqual([
      'locales -> locale.ts x55',
      'font-subset -> refused.ts x2',
      'build-env -> env.ts x3',
      'mermaid -> refused.ts x1',
      'image-resize -> refused.ts x2',
    ]);
    expect(Object.entries(CSS_ASSETS as Record<string, { expect: number }>).map(([ext, a]) => `${ext} x${a.expect}`)).toEqual(['png x5', 'svg x2']);
  });
});

describe('#gui-board strict scan of the shipped chunk (forms the P12 scanner does not see)', () => {
  it('the rules flag each form on planted bytes (they are not vacuous) and pass ordinary code', () => {
    const planted: Array<[string, string]> = [
      ['x=(0,eval)("1")', 'evalIdentifier'],
      ['x=globalThis.eval("1")', 'evalIdentifier'],
      ['const e=eval;e("1")', 'evalIdentifier'],
      ['x=Function.call(null,"return 1")()', 'functionConstructor'],
      ['x=Reflect.construct(Function,["return 1"])', 'functionConstructor'],
      ['x=[].constructor.constructor("return 1")()', 'constructorOfConstructor'],
      ['setTimeout("go()",0)', 'stringTimer'],
      ['const{instantiate:i}=WebAssembly;i(b)', 'webAssembly'],
      ['await globalThis["WebAssembly"].instantiate(b)', 'webAssembly'],
      ['new XMLHttpRequest().open("GET",u)', 'networkApi'],
      ['navigator.sendBeacon(u,d)', 'networkApi'],
      ['new EventSource(u)', 'networkApi'],
      ['const m=await import(u)', 'dynamicImport'],
      ['a="ftp://files.example/x"', 'otherSchemeHost'],
      ['a="//cdn.example/x.js"', 'protocolRelativeHost'],
      ['s=\'<svg style="fill:red"/>\'', 'inlineStyleInMarkup'],
      ['n.setAttribute("style","white-space: pre;")', 'styleAttribute'],
    ];
    for (const [code, rule] of planted) expect(hits(code), code).toEqual([rule]);
    expect(hits('new WebSocket("wss://relay.example/s")').sort()).toEqual(['networkApi', 'otherSchemeHost']);
    // ordinary code the rules must leave alone
    for (const ok of ['a.isFunction(b)', 'x.evaluate()', 'const medieval=1', 'q.import(a)', 'a="http://www.w3.org/2000/svg"', 'r=a//b.co\n', 'setTimeout(()=>go(),0)', 'e.constructor(a)', 'n.style.whiteSpace="pre"']) expect(hits(ok), ok).toEqual([]);
  });

  it('the shipped board.js has none of them', () => {
    expect(hits(js)).toEqual([]);
  });

  it('exactly ONE `data:` URL builder is left, the image-file encoder, and one canvas data URL (the image-insert cursor)', () => {
    // A string or template that STARTS a data: URL, whatever its media type (the engine's own cursors and
    // placeholders are `data:${H.svg},…`, which no `data:image/` pattern sees). The one left encodes a picked
    // image file; images are refused until the redaction pass (S2), and inserting one today is refused by
    // img-src (Probe's S1.0 walk). A second builder here is a dropped or half-matching patch.
    const builders = js.match(/["'`]data:[^"'`]{0,24}/g) ?? [];
    expect(builders.length, builders.join(' | ')).toBe(1);
    expect(builders[0]).toMatch(/^`data:\$\{[\w$]+\};base64,/);
    expect(js.match(/\btoDataURL\(/g)?.length ?? 0).toBe(1);
    expect(js.match(/\breadAsDataURL\(/g)?.length ?? 0).toBe(1);
    expect(js).not.toMatch(/["'`]blob:/); // blob: URLs are made by URL.createObjectURL, never written out
  });

  it('the one Worker constructor left is the font subsetter pool, whose worker URL is the stand-in (undefined)', () => {
    expect(js.match(/new\s+(?:Shared)?Worker\b/g)?.length ?? 0).toBe(1);
    expect(js).toMatch(/new Worker\([\w$]+,\{type:"module"\}\)/);
    expect(js).toMatch(/is not built into the board/);
  });

  it('the shipped board.css pulls in nothing: no @import, no remote or data: url(), no scripted CSS', () => {
    expect(css).not.toMatch(/@import|expression\(|behavior\s*:|-moz-binding|javascript:/i);
    expect(css).not.toMatch(/url\(\s*["']?(?:[a-z][a-z0-9+.-]*:|\/\/)/i);
    expect(css).not.toMatch(/\/\/[a-z0-9.-]+\.[a-z]{2,}/i);
  });
});

describe('#gui-board isolation: the served page cannot reach the chunk by any loader', () => {
  const served = [...bundle.keys()].filter((n) => !n.startsWith('board/') && /\.(js|html)$/.test(n));

  it('the served scripts and page are the ones scanned', () => {
    expect(served.sort()).toEqual(['app.js', 'boot.js', 'index.html']);
  });

  it.each(['app.js', 'boot.js'])('the SHIPPED %s creates no script element, worker or module loader', (name) => {
    const text = bundle.get(name)!.toString('utf8');
    // board-isolation.test.ts forbids `import(` and the chunk's names; a script element built at run time with a
    // computed src needs neither, so the element itself is forbidden
    expect(text).not.toMatch(/createElement(?:NS)?\(\s*(?:[^,)]+,\s*)?["'`]script["'`]\s*\)/i);
    expect(text).not.toMatch(/new\s+(?:Shared)?Worker\b|\bimportScripts\b|\bserviceWorker\b|document\.write\b|modulepreload/);
    expect(text).not.toMatch(/<script\b/i);
    expect(text).not.toMatch(/\.innerHTML\s*=|\binsertAdjacentHTML\b|\bouterHTML\s*=/);
  });

  it('the SHIPPED index.html loads exactly boot.js and app.js, as classic scripts', () => {
    const html = bundle.get('index.html')!.toString('utf8');
    expect([...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0])).toEqual(['<script src="/boot.js">', '<script src="/app.js" defer>']);
    expect(html).not.toMatch(/type\s*=\s*["']?module|modulepreload|<iframe|<object|<embed|<base\b/i);
  });
});

describe('#gui-board no engine clipboard action can be run through the handle (review of PR #117, B2)', () => {
  it('the one action door (patch api-run-action) names exactly four zoom actions, and the key allowlist names none of the engine\'s clipboard or duplicate actions', async () => {
    const { PATCHES } = (await import('../scripts/board-patches.mjs')) as { PATCHES: Array<{ id: string; replace: unknown }> };
    const { gnomonBoardKeyActions } = await import('../src/board/skin.js');
    const door = String(PATCHES.find((p) => p.id === 'api-run-action')!.replace);
    expect(/\[([^\]]*)\]\.includes\(p\)/.exec(door)?.[1]).toBe('"zoomIn","zoomOut","resetZoom","zoomToFit"');
    for (const name of ['copy', 'cut', 'paste', 'copyStyles', 'pasteStyles', 'copyAsPng', 'copyAsSvg', 'duplicateSelection']) {
      expect(gnomonBoardKeyActions.has(name), name).toBe(false);
      expect(door.includes(`"${name}"`), name).toBe(false);
    }
    // the handle itself calls gnomonAction only through its closed list of the same four
    const src = (await import('node:fs')).readFileSync(new URL('../src/board/index.ts', import.meta.url), 'utf8');
    expect(/const HANDLE_ACTIONS = \[([^\]]*)\] as const;/.exec(src)?.[1]).toBe("'zoomIn', 'zoomOut', 'resetZoom', 'zoomToFit'");
    expect(src).not.toMatch(/executeAction|actionManager|navigator\.clipboard/);
  });
});
