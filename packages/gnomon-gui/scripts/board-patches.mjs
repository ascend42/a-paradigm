// #gui-board build-time patches (spec §12.7 engine hygiene, §11.2 rule 6; boards S1.0; Aegis S1 risks e, f).
// PURE: no esbuild, no build on import. scripts/board-build.mjs applies these while bundling; test/board-patches.test.ts
// applies each one to the installed package and fails loudly when a count moves (an Excalidraw version bump).
//
// Every patch names the ONE file it edits (a dist/prod file of the engine by the hashed chunk name the pinned version
// ships, or `<package>/<path>` for another bundled package), what it looks for and how many times it must match. A patch that matches a different number of times throws: the build never ships a
// half-patched engine. Nothing here is a fork: each edit is a string replacement on the published dist/prod files.
import { createHash } from 'node:crypto';

/** The exact engine these patches are written against (package.json pins the same version). */
export const ENGINE = Object.freeze({ name: '@excalidraw/excalidraw', version: '0.18.1' });

/**
 * sha256 of every file the patches edit or replace: a different byte anywhere is a different engine. A bare name is
 * a file of the engine's dist/prod; `<package>/<path>` is a file of another bundled package.
 */
export const ENGINE_FILES = Object.freeze({
  'lodash.debounce/index.js': '78bba4c545cab8e50a6a1fd2570f853a59aacf960f0e5d264c12bb46f9aaa302',
  'lodash.throttle/index.js': '9b5dc6b0a7061704cfd74704aa8dd85a8d0c816bada28cf1cb493531fd254712',
  'index.js': '7f651063487849c79a8cdedc3aa6bd04c6b0c717ee63959116f1f12dbc0a51b8',
  'index.css': 'e72092760bae272ebe075bdadaff7f82909d318c5d819313185b19e99be31e49',
  'chunk-K2UTITRG.js': '72b54e8e9b3c17c69f1dd5e40203bfaed62313bc611b86ecb8a1625a12562e51',
  'chunk-ZUYEQ4TG.js': '810dbb85e738f382cdd82e080185029a5ba30c17d3ba0df587e0e6d92e04d952',
});

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** `style="a:b;c:d"` → `a="b" c="d"` (SVG presentation properties only: the strings below carry nothing else). */
const styleToAttrs = (_m, css) =>
  css
    .split(';')
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(':');
      return `${d.slice(0, i).trim()}="${d.slice(i + 1).trim()}"`;
    })
    .join(' ');

const SVG_BLOB = (expr) => `URL.createObjectURL(new Blob([${expr}],{type:H.svg}))`;

/**
 * The text patches. `find` is a string (exact) or a global RegExp; `expect` is the exact number of matches.
 * Order matters only within one file and is the order written here.
 */
export const PATCHES = Object.freeze([
  {
    id: 'font-registry-empty',
    file: 'chunk-K2UTITRG.js',
    why: 'no Excalidraw font ships: every family is registered with its metrics and zero faces, so no FontFace is created and no font URL is ever built. Until S1.1 registers a bundled face, board text and PNG export fall to the browser default font and measure differently per OS',
    find: 'return n("Cascadia",...Gd),n("Comic Shanns",...Qd),n("Excalifont",...sc),n("Helvetica",...dc),n("Liberation Sans",...lc),n("Lilita One",...pc),n("Nunito",...xc),n("Virgil",...yc),n(Mn,...b1),n(Tn,...jd),ne._initialized=!0,t.registered}',
    replace: 'return n("Cascadia"),n("Comic Shanns"),n("Excalifont"),n("Helvetica"),n("Liberation Sans"),n("Lilita One"),n("Nunito"),n("Virgil"),n(Mn),n(Tn),ne._initialized=!0,t.registered}',
    expect: 1,
  },
  {
    id: 'font-table-uris',
    file: 'chunk-K2UTITRG.js',
    why: 'the 230 font file names leave with the fonts: the now-unused tables name nothing',
    find: /"\.\/fonts\/[^"]+\.woff2"/g,
    replace: '""',
    expect: 230,
  },
  {
    id: 'embed-allowlists-empty',
    file: 'chunk-K2UTITRG.js',
    why: 'embeddables are off (S25-M3): no third-party host is an allowed embed or an allowed same-origin embed',
    find: 'Qa=new Set(["youtube.com","youtu.be","vimeo.com","player.vimeo.com","figma.com","link.excalidraw.com","gist.github.com","twitter.com","x.com","*.simplepdf.eu","stackblitz.com","val.town","giphy.com","reddit.com"]),C2=new Set(["youtube.com","youtu.be","vimeo.com","player.vimeo.com","figma.com","twitter.com","x.com","*.simplepdf.eu","stackblitz.com","reddit.com"])',
    replace: 'Qa=new Set([]),C2=new Set([])',
    expect: 1,
  },
  {
    id: 'font-cdn-fallback-url',
    file: 'chunk-K2UTITRG.js',
    why: 'the esm.sh asset fallback is removed, not merely unreached',
    find: 'P(jn,"ASSETS_FALLBACK_URL",`https://esm.sh/${M.PKG_NAME?`${M.PKG_NAME}@${M.PKG_VERSION}`:"@excalidraw/excalidraw"}/dist/prod/`);',
    replace: '',
    expect: 1,
  },
  {
    id: 'font-cdn-fallback-push',
    file: 'chunk-K2UTITRG.js',
    why: 'an asset URL is built from EXCALIDRAW_ASSET_PATH (the bundle) only',
    find: 'return r.push(new URL(n,jn.ASSETS_FALLBACK_URL)),r}',
    replace: 'return r}',
    expect: 1,
  },
  {
    id: 'svg-inline-style-attrs',
    file: 'chunk-K2UTITRG.js',
    why: 'the placeholder and cursor SVG strings carry inline style attributes; as presentation attributes they need no style-src',
    find: /style="([a-z-]+:[^";]+(?:;[a-z-]+:[^";]+)*)"/g,
    replace: styleToAttrs,
    expect: 4,
  },
  {
    id: 'data-svg-images',
    file: 'chunk-K2UTITRG.js',
    why: 'img-src has no data: (§11.2 rule 6): the four placeholder images and the two laser cursors become blob: URLs',
    find: /`data:\$\{H\.svg\}, ?\$\{encodeURIComponent\(('(?:[^'\\]|\\.)*'|`[^`]*`)\)\}`/g,
    replace: (_m, svg) => SVG_BLOB(svg),
    expect: 6,
  },
  {
    id: 'eraser-cursor',
    file: 'chunk-K2UTITRG.js',
    why: 'the eraser cursor was a canvas data: URL; it is the same 5px ring as a blob: SVG',
    find: 'D2=Ct.toDataURL(H.svg)',
    replace: `D2=${SVG_BLOB(`'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="5" fill="'+(o?Ei.black:Ei.white)+'" stroke="'+(o?Ei.white:Ei.black)+'"/></svg>'`)}`,
    expect: 1,
  },
  {
    id: 'svg-text-style-attribute',
    file: 'chunk-K2UTITRG.js',
    why: 'setAttribute("style") is an inline style (style-src-attr); the CSSOM property is not',
    find: '_.setAttribute("style","white-space: pre;")',
    replace: '_.style.whiteSpace="pre"',
    expect: 1,
  },
  {
    id: 'no-fetch-core',
    file: 'chunk-K2UTITRG.js',
    why: 'the font fetch and the image-by-URL fetch are refused: the board makes no HTTP request of its own',
    find: /(?<![.\w$])fetch\(/g,
    replace: 'gnomonBoardRefuseFetch(',
    expect: 2,
    prepend: 'import{gnomonBoardRefuseFetch}from"gnomon-board:refused";',
  },
  {
    id: 'no-fetch-ui',
    file: 'index.js',
    why: 'the library-by-URL fetch and the library publish POST are refused',
    find: /(?<![.\w$])fetch\(/g,
    replace: 'gnomonBoardRefuseFetch(',
    expect: 2,
    prepend: 'import{gnomonBoardRefuseFetch}from"gnomon-board:refused";',
  },
  {
    id: 'library-trigger-removed',
    file: 'index.js',
    why: 'the stock Library sidebar writes exported SVG previews with innerHTML (an inline style attribute and a <style> element: style-src refusals); the board has no Library, so its trigger renders nothing, on the desktop and the mobile layout',
    find: 'return vo(o.In,{children:vo(no.Trigger,{...e,className:"default-sidebar-trigger",name:pt.name})})',
    replace: 'return null',
    expect: 1,
  },
  {
    id: 'library-tab-trigger-removed',
    file: 'index.js',
    why: 'the default sidebar (still used by canvas search) offers no Library tab',
    find: 'vo(no.TabTrigger,{tab:ia,children:jn}),',
    replace: '',
    expect: 1,
  },
  {
    id: 'library-tab-removed',
    file: 'index.js',
    why: 'the Library panel is never rendered, whatever opens the sidebar (command palette, updateLibrary, a stored tab)',
    find: 'vo(no.Tab,{tab:ia,children:vo(fw,{})}),',
    replace: '',
    expect: 1,
  },
  {
    id: 'lodash-debounce-root',
    file: 'lodash.debounce/index.js',
    why: 'the global lookup ends in Function("return this")(): eval-class source, replaced by globalThis',
    find: "Function('return this')()",
    replace: 'globalThis',
    expect: 1,
  },
  {
    id: 'lodash-throttle-root',
    file: 'lodash.throttle/index.js',
    why: 'the global lookup ends in Function("return this")(): eval-class source, replaced by globalThis',
    find: "Function('return this')()",
    replace: 'globalThis',
    expect: 1,
  },
  {
    id: 'css-ui-font-faces',
    file: 'index.css',
    why: 'the Assistant UI font is not shipped; the stack falls through to the system font',
    find: /@font-face\{font-family:Assistant;[^}]*\}/g,
    replace: '',
    expect: 4,
  },
]);

/**
 * `data:` images in the engine stylesheet become real files of the bundle (img-src 'self').
 * Returns the rewritten CSS and the extracted files (name → bytes); names carry the content hash.
 */
export const CSS_ASSETS = Object.freeze({
  png: { find: /url\(data:image\/png;base64,([A-Za-z0-9+/=]+)\)/g, expect: 5 },
  svg: { find: /url\('data:image\/svg\+xml,(<svg[^']*<\/svg>)'\)/g, expect: 2 },
});

export function extractCssAssets(css) {
  const assets = new Map();
  const counts = {};
  const put = (bytes, ext) => {
    const name = `asset-${sha256(bytes).slice(0, 16)}.${ext}`;
    assets.set(name, bytes);
    return `url(./${name})`;
  };
  let out = css;
  for (const [ext, { find, expect }] of Object.entries(CSS_ASSETS)) {
    let n = 0;
    out = out.replace(find, (_m, body) => {
      n++;
      return put(ext === 'png' ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8'), ext);
    });
    if (n !== expect) throw new PatchError(`css-data-${ext}`, 'index.css', expect, n);
    counts[`css-data-${ext}`] = n;
  }
  return { css: out, assets, counts };
}

/**
 * Imports that resolve to a stand-in instead of the engine's own module. `expect` counts distinct (importer, specifier)
 * pairs: esbuild resolves each pair once.
 */
export const STUBS = Object.freeze([
  { id: 'locales', filter: /^\.\/locales\/[A-Za-z0-9-]+\.js$/, stub: 'locale.ts', expect: 55, why: 'one language ships' },
  { id: 'font-subset', filter: /^\.\/subset-(shared|worker)\.chunk\.js$/, stub: 'refused.ts', expect: 2, why: 'the font subsetter and its worker: eval, new Function and WebAssembly source' },
  { id: 'build-env', filter: /^\.\.?\/chunk-ZUYEQ4TG\.js$/, stub: 'env.ts', expect: 3, why: 'the hardcoded excalidraw.com json, library, AI and collab backends' },
  { id: 'mermaid', filter: /^@excalidraw\/mermaid-to-excalidraw$/, stub: 'refused.ts', expect: 1, why: 'the Mermaid importer (and its dependency tree) is not part of a board' },
  { id: 'image-resize', filter: /^(pica|image-blob-reduce)$/, stub: 'refused.ts', expect: 2, why: 'WebAssembly source; images are refused until the redaction pass (S2)' },
]);

/** XML namespace URIs are identifiers, never fetched; they are the only http(s) literals the bundle may carry. */
export const NAMESPACE_URLS = Object.freeze([
  'http://www.w3.org/1998/Math/MathML',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/2000/xmlns/',
  'http://www.w3.org/XML/1998/namespace',
]);
export const STRIPPED_HOST = 'about:invalid#';
const HOST_URL = /https?:\/\/(?!www\.w3\.org\/)[A-Za-z0-9][A-Za-z0-9.-]*(?::\d+)?/g;

/** Replace every `http(s)://<host>` literal (namespaces aside) with an inert scheme; returns the hosts it removed. */
export function stripHosts(text) {
  const hosts = {};
  const out = text.replace(HOST_URL, (m) => {
    const host = m.replace(/^https?:\/\//, '');
    hosts[host] = (hosts[host] ?? 0) + 1;
    return STRIPPED_HOST;
  });
  return { text: out, hosts };
}

export class PatchError extends Error {
  constructor(id, file, expected, got) {
    super(`board patch "${id}" matched ${got} time(s) in ${file}, expected ${expected}: the engine is not ${ENGINE.name}@${ENGINE.version} as pinned (re-derive the patch in scripts/board-patches.mjs)`);
    this.name = 'PatchError';
    this.patch = id;
  }
}

/** Apply ONE patch to `text`; throws PatchError unless it matches exactly `expect` times. Returns the new text. */
export function applyPatch(p, text) {
  let n = 0;
  let out = text;
  if (typeof p.find === 'string') {
    const parts = text.split(p.find);
    n = parts.length - 1;
    if (n === p.expect) out = parts.join(typeof p.replace === 'string' ? p.replace : '');
  } else {
    out = text.replace(p.find, (...a) => {
      n++;
      return typeof p.replace === 'function' ? p.replace(...a) : p.replace;
    });
  }
  if (n !== p.expect) throw new PatchError(p.id, p.file, p.expect, n);
  return out;
}

/** Apply every patch for `file` to `text`, in order; throws PatchError on any count mismatch. Returns {text, counts}. */
export function applyPatches(file, text) {
  const counts = {};
  const prepend = new Set();
  let out = text;
  for (const p of PATCHES) {
    if (p.file !== file) continue;
    out = applyPatch(p, out);
    counts[p.id] = p.expect;
    if (p.prepend) prepend.add(p.prepend);
  }
  return { text: [...prepend].join('') + out, counts };
}

/** The files PATCHES edits (keys of ENGINE_FILES). */
export const PATCHED_FILES = Object.freeze([...new Set(PATCHES.map((p) => p.file))]);
