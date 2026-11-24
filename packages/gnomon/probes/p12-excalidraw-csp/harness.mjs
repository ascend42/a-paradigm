// Board-under-CSP harness, shared by probe P12 (probe.mjs) and oracle G-DDL-06
// (packages/gnomon-gui/test/board-csp.test.ts). ZERO deps, no build, no install.
//
// It serves the SHIPPED board chunk — the `board/*` files decoded from the
// kernel's pinned embed (packages/gnomon/src/kernel/web/gui-bundle.ts), the
// exact bytes the web endpoint serves — from a loopback server that sends the
// §11.2 rule 6 headers verbatim (_shared/browser.mjs), beside a small page
// that does what a board open does: add the stylesheet with a <link>, load
// board/board.js with import() from a classic script, mount, draw (through the
// handle and with pointer events), walk every tool (their cursors), export a
// PNG, and POST one report: every securitypolicyviolation event, errors,
// rejections and what it drew. The server's own request log says what the
// page asked for (a font or a CDN request would show there or as a violation).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { findEngines, gnomonCsp, runPage, startServer } from '../_shared/browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EMBED_PATH = path.resolve(HERE, '..', '..', 'src', 'kernel', 'web', 'gui-bundle.ts');
export const NO_REPORT = 'no report within the timeout';
/** The tools the page selects in turn; each sets the engine's cursor for that tool. */
export const TOOLS = ['selection', 'rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'freedraw', 'text', 'eraser', 'laser', 'hand'];

/** Every file of the pinned GUI bundle, decoded from the generated embed source. */
export function embeddedBundle(embedPath = EMBED_PATH) {
  const src = readFileSync(embedPath, 'utf8');
  return new Map([...src.matchAll(/^ {2}("[^"]+"):\r?\n {4}"([A-Za-z0-9+/=]*)",\r?$/gm)].map((m) => [JSON.parse(m[1]), Buffer.from(m[2], 'base64')]));
}

/** The shipped board chunk: name ('board/…') → bytes. */
export function shippedBoard(embedPath = EMBED_PATH) {
  return new Map([...embeddedBundle(embedPath)].filter(([n]) => n.startsWith('board/')));
}

const INDEX = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>gnomon board under the CSP</title>
<link rel="stylesheet" href="/harness.css">
<script src="/harness.js" defer></script>
</head>
<body><div id="board"></div></body>
</html>
`;

const CSS = 'html, body { margin: 0; }\n#board { width: 1280px; height: 800px; }\n';

// A classic script (the GUI's app.js is one): the board arrives by import().
const DRIVER = `'use strict';
(function () {
  var R = (window.__board = { t0: performance.now(), phase: 'boot', violations: [], errors: [], rejections: [], sent: false });
  document.addEventListener('securitypolicyviolation', function (e) {
    R.violations.push({ directive: e.effectiveDirective || e.violatedDirective, blockedURI: e.blockedURI, sourceFile: e.sourceFile, line: e.lineNumber, sample: (e.sample || '').slice(0, 80), at: Math.round(performance.now()), phase: R.phase });
  });
  window.addEventListener('error', function (e) { R.errors.push(String(e.message).slice(0, 300) + ' @' + e.filename + ':' + e.lineno); });
  window.addEventListener('unhandledrejection', function (e) { R.rejections.push(String(e.reason && (e.reason.stack || e.reason)).slice(0, 400)); });
  R.send = function (stage) {
    if (R.sent) return;
    R.sent = true;
    R.stage = stage;
    R.visibility = document.visibilityState;
    R.resources = performance.getEntriesByType('resource').map(function (r) { return { path: new URL(r.name).pathname, type: r.initiatorType }; });
    R.userAgent = navigator.userAgent;
    var run = new URLSearchParams(location.search).get('run') || '';
    fetch('/report?run=' + encodeURIComponent(run), { method: 'POST', body: JSON.stringify(R) });
  };
  setTimeout(function () { R.send('watchdog'); }, 45000);
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  // The page drives the engine with SYNTHETIC pointer events, whose pointerId is not an active pointer. Chromium
  // and WebKit accept setPointerCapture for it; Firefox throws NotFoundError ("Invalid pointer id") from the
  // engine's pointerdown handler, which would abort the draw before it starts. A real pointer never takes that
  // path, so the page lets capture of an inactive pointer be a no-op and counts how often (R.captureRefused).
  R.captureRefused = 0;
  ['setPointerCapture', 'releasePointerCapture'].forEach(function (name) {
    var real = Element.prototype[name];
    if (typeof real !== 'function') return;
    Element.prototype[name] = function (id) {
      try { return real.call(this, id); } catch (e) {
        if (e && e.name === 'NotFoundError') { R.captureRefused++; return undefined; }
        throw e;
      }
    };
  });
  var pointer = function (target, type, x, y, buttons) {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: type === 'pointermove' ? -1 : 0, buttons: buttons }));
  };
  var drag = async function (canvas, x0, y0, x1, y1) {
    pointer(canvas, 'pointerdown', x0, y0, 1);
    await wait(30);
    for (var i = 1; i <= 6; i++) { pointer(canvas, 'pointermove', x0 + ((x1 - x0) * i) / 6, y0 + ((y1 - y0) * i) / 6, 1); await wait(15); }
    pointer(canvas, 'pointerup', x1, y1, 0);
    await wait(120);
  };
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/board/board.css';
  document.head.appendChild(link);
  R.phase = 'load';
  import('/board/board.js').then(async function (m) {
    R.tModule = Math.round(performance.now() - R.t0);
    R.engine = m.BOARD_ENGINE;
    R.phase = 'mount';
    var h = await m.mountBoard(document.getElementById('board'));
    R.mounted = true;
    R.tMounted = Math.round(performance.now() - R.t0);
    // no wait here: a mark added in the SAME tick the mount resolves must stay (the engine initialises its scene
    // asynchronously and used to wipe it about 20 ms later)
    R.phase = 'draw';
    R.afterAdd = h.add([{ type: 'rectangle', x: 40, y: 40, width: 160, height: 80 }, { type: 'ellipse', x: 240, y: 40, width: 120, height: 80 }, { type: 'text', x: 60, y: 160, text: 'gnomon board ✓' }]);
    await wait(400);
    R.afterAddSettled = h.count();
    var canvas = document.querySelector('canvas.interactive') || document.querySelector('canvas');
    R.canvas = !!canvas;
    h.setTool('rectangle');
    await wait(60);
    await drag(canvas, 500, 300, 640, 400);
    R.afterPointerRect = h.count();
    h.setTool('freedraw');
    await wait(60);
    await drag(canvas, 700, 300, 820, 420);
    R.afterPointerStroke = h.count();
    R.phase = 'tools';
    R.cursors = {};
    for (var i = 0; i < TOOLS.length; i++) {
      h.setTool(TOOLS[i]);
      await wait(50);
      pointer(canvas, 'pointermove', 400 + i * 10, 500, 0);
      await wait(50);
      R.cursors[TOOLS[i]] = String(canvas.style.cursor || '').replace(/blob:[^)"' ]+/, 'blob:…').slice(0, 60);
    }
    h.setTool('selection');
    // select a mark, then reach for the stock Library (Mika's S1.0 repro: its previews are written with innerHTML
    // and carry an inline style attribute and a <style> element). The board ships no Library entry point: the
    // trigger must be absent, and pressing it if it ever comes back must still raise no violation.
    R.phase = 'library';
    await wait(60);
    pointer(canvas, 'pointerdown', 120, 41, 1);
    await wait(30);
    pointer(canvas, 'pointerup', 120, 41, 0);
    await wait(150);
    var trigger = document.querySelector('.default-sidebar-trigger, .sidebar-trigger');
    R.libraryTrigger = !!trigger;
    if (trigger) {
      var box = trigger.closest('label') ? trigger.closest('label').querySelector('input') : null;
      (box || trigger).click();
      await wait(700);
    }
    R.libraryOpen = !!document.querySelector('.layer-ui__library, .library-menu-items-container, .default-sidebar');
    R.phase = 'export-png';
    try {
      var t = performance.now();
      var blob = await h.exportPng();
      var head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
      R.png = { ok: blob.type === 'image/png' && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47, bytes: blob.size, ms: Math.round(performance.now() - t) };
    } catch (e) {
      R.png = { ok: false, error: String((e && e.stack) || e).slice(0, 400) };
    }
    R.phase = 'settle';
    await wait(1200); // late violations
    R.finalCount = h.count();
    R.alive = h.isAlive();
    // a handle whose board is gone says so and refuses, instead of answering as if alive
    h.unmount();
    R.aliveAfterUnmount = h.isAlive();
    try { h.count(); R.deadHandle = 'answered'; } catch (e) { R.deadHandle = 'refused'; }
    R.send('done');
  }).catch(function (e) {
    R.errors.push('driver: ' + String((e && e.stack) || e).slice(0, 400));
    R.send('driver-error');
  });
})();
`.replace('(function () {', `var TOOLS = ${JSON.stringify(TOOLS)};\n(function () {`);

/** url path → bytes of everything the harness serves: the shipped board files plus the page. */
export function harnessFiles(board = shippedBoard()) {
  const files = new Map();
  for (const [n, b] of board) files.set(`/${n}`, b);
  files.set('/index.html', INDEX);
  files.set('/harness.css', CSS);
  files.set('/harness.js', DRIVER);
  return files;
}

/** Static scan of the shipped board bytes (the same rules as packages/gnomon-gui/test/board-scan.test.ts). */
export function staticScan(board = shippedBoard()) {
  const out = { files: {}, totalBytes: 0, totalGzip: 0, findings: [] };
  const RULES = {
    // the identifier in any position: direct, indirect `(0,eval)(`, `globalThis.eval(`, an alias
    eval: /\beval\b/g,
    newFunction: /new\s+Function\b|(?<![.\w$])Function\s*\(/g,
    webAssembly: /\bWebAssembly\b/g,
    fetch: /(?<![\w$])fetch\s*\(/g,
    externalUrl: /https?:\/\/(?!www\.w3\.org\/)[A-Za-z0-9][^\s"'`)\\]*/g,
    dataUrl: /data:(image|font|application|text)\//g,
    sourceMap: /sourceMappingURL=/g,
  };
  // A string or template that STARTS a data: URL, whatever its media type (`data:${type},…` is not seen by the
  // dataUrl rule). board.js may keep exactly the builders named here, by exact count: the image-file encoder
  // (images are refused until S2) and the image-insert cursor's canvas.toDataURL. One more is a finding.
  const COUNTED = {
    dataUrlBuilder: { find: /["'`]data:[^"'`]{0,24}/g, allow: { 'board/board.js': 1 }, shape: /^`data:\$\{[\w$]+\};base64,/ },
    toDataURL: { find: /\btoDataURL\s*\(/g, allow: { 'board/board.js': 1 } },
  };
  for (const [n, b] of [...board].sort(([a], [c]) => (a < c ? -1 : 1))) {
    out.totalBytes += b.length;
    const gz = gzipSync(b).length;
    out.totalGzip += gz;
    out.files[n] = { bytes: b.length, gzip: gz };
    if (/\.map$/i.test(n)) out.findings.push({ file: n, rule: 'mapFile', count: 1 });
    if (!/\.(js|css|svg)$/.test(n)) continue; // LICENSES.txt cites project URLs; the PNG is not text
    const s = b.toString('utf8');
    for (const [rule, re] of Object.entries(RULES)) {
      const hits = s.match(re) ?? [];
      if (hits.length) out.findings.push({ file: n, rule, count: hits.length, sample: [...new Set(hits)].slice(0, 5) });
    }
    for (const [rule, c] of Object.entries(COUNTED)) {
      const hits = s.match(c.find) ?? [];
      const allowed = c.allow[n] ?? 0;
      if (hits.length > allowed || (c.shape && hits.some((h) => !c.shape.test(h)))) out.findings.push({ file: n, rule, count: hits.length, allowed, sample: [...new Set(hits)].slice(0, 5) });
    }
  }
  return out;
}

function aggregate(violations) {
  const m = new Map();
  for (const v of violations) {
    let blocked = v.blockedURI || '(none)';
    try {
      const u = new URL(blocked);
      if (u.origin !== 'null') blocked = `${u.origin}${u.pathname.split('/').slice(0, 4).join('/')}…`;
    } catch {
      // 'inline', 'eval', 'data': kept as is
    }
    let source = '';
    try {
      source = v.sourceFile ? new URL(v.sourceFile).pathname : '';
    } catch {
      source = String(v.sourceFile);
    }
    const key = `${v.directive}|${blocked}|${source}|${v.phase}`;
    const cur = m.get(key) ?? { directive: v.directive, blocked, source, phase: v.phase, count: 0, sample: v.sample || undefined };
    cur.count++;
    m.set(key, cur);
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}

/** One engine per family, in a fixed order: Chromium (stable Chrome first), Edge, Firefox, WKWebView. */
export function pickEngines() {
  const { engines, missing } = findEngines();
  const pick = [];
  const chromium = ['chrome', 'chrome-testing', 'headless-shell'].map((n) => engines.find((e) => e.name === n)).find(Boolean);
  if (chromium) pick.push({ ...chromium, family: 'chromium' });
  for (const n of ['edge', 'firefox', 'wkwebview']) {
    const e = engines.find((x) => x.name === n);
    if (e) pick.push({ ...e, family: n === 'edge' ? 'chromium-edge' : n });
  }
  return { pick, missing };
}

/** Why a run is not clean ([] when it is): the G-DDL-06 predicate, one run of one engine. */
export function runProblems(r, known) {
  if (r.error) return [r.error];
  const p = [];
  if (!r.mounted) p.push(`did not mount (stage ${r.stage})`);
  if (r.violationCount) p.push(`${r.violationCount} CSP violation(s): ${r.violations.map((v) => `${v.directive} ${v.blocked} in ${v.phase} x${v.count}`).join('; ')}`);
  if (r.errors?.length) p.push(`page errors: ${r.errors.join(' | ')}`);
  if (r.rejections?.length) p.push(`unhandled rejections: ${r.rejections.join(' | ')}`);
  if (r.mounted && r.afterAdd !== 3) p.push(`the handle added ${r.afterAdd} marks, expected 3`);
  if (r.mounted && r.afterAddSettled !== 3) p.push(`marks added as the mount resolved did not stay: ${r.afterAddSettled} of 3 left`);
  if (r.mounted && r.stage === 'done' && (r.aliveAfterUnmount !== false || r.deadHandle !== 'refused')) p.push(`a handle whose board is gone still answers (alive ${r.aliveAfterUnmount}, count ${r.deadHandle})`);
  if (r.mounted && r.stage === 'done' && r.alive !== true) p.push('the handle says the engine is no longer alive');
  if (r.mounted && r.afterPointerRect !== 4) p.push(`the pointer rectangle left ${r.afterPointerRect} elements, expected 4`);
  if (r.mounted && r.afterPointerStroke !== 5) p.push(`the pointer stroke left ${r.afterPointerStroke} elements, expected 5`);
  if (r.mounted && r.libraryTrigger !== false) p.push('the stock Library trigger is on the page');
  if (r.mounted && r.libraryOpen !== false) p.push('the stock Library sidebar opened');
  if (r.mounted && !r.png?.ok) p.push(`PNG export failed: ${r.png?.error ?? JSON.stringify(r.png)}`);
  if (r.stage !== 'done') p.push(`stage ${r.stage}`);
  const stray = (r.requests ?? []).filter((q) => !known.has(q.path) && q.path !== '/report' && q.path !== '/' && q.path !== '/favicon.ico'); // the browser's own favicon probe
  if (stray.length) p.push(`requests outside the bundle: ${[...new Set(stray.map((q) => q.path))].slice(0, 8).join(', ')}`);
  return p;
}

/**
 * Load the shipped board under the CSP in each picked engine, `runs` times. A launch that never reports is retried
 * `launchRetries` times per engine (a browser that never loaded the page says nothing about the CSP); a run that
 * reported is never retried. Resolves {csp, engines: {name: {version, family, runs: [...], clean, problems}}, missing}.
 */
export async function runBoardUnderCsp({ runs = 1, timeoutMs = 90_000, launchRetries = 1, engines = null, board = shippedBoard() } = {}) {
  const files = harnessFiles(board);
  const known = new Set(files.keys());
  const { pick, missing } = engines ? { pick: engines, missing: {} } : pickEngines();
  const server = await startServer({ files });
  const out = {};
  try {
    for (const e of pick) {
      const rows = [];
      const retried = [];
      for (let i = 0; i < runs; i++) {
        let r;
        for (;;) {
          const before = server.requests.length;
          const { report, wallMs, launcherTail } = await runPage(server, e, '/', timeoutMs);
          const requests = server.requests.slice(before).map((q) => ({ method: q.method, path: q.path }));
          if (report) {
            const v = report.violations ?? [];
            r = { wallMs, stage: report.stage, mounted: report.mounted === true, engine: report.engine, visibility: report.visibility, ms: { module: report.tModule ?? null, mounted: report.tMounted ?? null }, afterAdd: report.afterAdd, afterAddSettled: report.afterAddSettled, alive: report.alive, aliveAfterUnmount: report.aliveAfterUnmount, deadHandle: report.deadHandle, captureRefused: report.captureRefused, afterPointerRect: report.afterPointerRect, afterPointerStroke: report.afterPointerStroke, finalCount: report.finalCount, cursors: report.cursors, libraryTrigger: report.libraryTrigger, libraryOpen: report.libraryOpen, png: report.png, violationCount: v.length, violations: aggregate(v), errors: report.errors ?? [], rejections: report.rejections ?? [], requests, userAgent: report.userAgent };
          } else r = { wallMs, error: NO_REPORT, launcherTail, requests };
          if (report || retried.length >= launchRetries) break;
          retried.push({ run: i + 1, ...r });
        }
        rows.push(r);
      }
      const problems = rows.flatMap((r, i) => runProblems(r, known).map((p) => `run ${i + 1}: ${p}`));
      out[e.name] = { version: e.version, family: e.family ?? e.kind, runs: rows, launchRetries: retried, clean: problems.length === 0, problems };
    }
  } finally {
    await server.close();
  }
  return { csp: gnomonCsp('<port>'), engines: out, missing };
}
