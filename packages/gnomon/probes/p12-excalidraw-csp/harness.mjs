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
/** The rail tools the page selects in turn (boards S1.1: the handle offers these and nothing else). */
export const TOOLS = ['select', 'sticky', 'text', 'rect', 'ellipse', 'arrow', 'frame', 'stroke', 'hand'];
/** Engine tools the handle must refuse (G-DDL-07: only tools in the design's rail exist). */
export const REFUSED_TOOLS = ['image', 'eraser', 'laser', 'line', 'diamond', 'embeddable', 'selection', 'freedraw'];
/** The one font file the board may ask for: the bundle's own JetBrains Mono, beside the board chunk. */
export const BOARD_FONT = 'fonts/JetBrainsMono-Regular.woff2';
/** Stock engine nodes that must not be in the DOM (G-DDL-07). */
export const STOCK_SELECTORS = ['.layer-ui__wrapper', '.App-toolbar', '.App-menu', '.App-top-bar', '.App-bottom-bar', '.Island', '.main-menu-trigger', '.dropdown-menu', '.dropdown-menu-button', '.welcome-screen-center', '.welcome-screen-menu', '.help-icon', '.HintViewer', '.zoom-actions', '.undo-redo-buttons', '.ToolIcon', '[data-testid="toolbar-image"]', '.mobile-misc-tools-container', '.excalidraw--mobile', '.LoadingMessage', '.sidebar', '.default-sidebar', '.layer-ui__library', '.library-menu-items-container', '.command-palette-dialog', '.Modal', '.Dialog', '.context-menu', '.popover', '.Toast', '.excalidraw-hyperlinkContainer', '.color-picker-container', '.scroll-back-to-content', '.HelpDialog', '.layer-ui__wrapper__footer'];
/** The desk ground the captures are composed on (the --ground token of each theme; the GUI test compares them with styles.css). */
export const GROUND = { day: '#EDE8DC', night: '#0F1116' };
/** The board width at a 1024 window (design board-leaf.widths) and a short pane (board-leaf.heights). */
export const NARROW = { width: 374, height: 304 };

/** Every file of the pinned GUI bundle, decoded from the generated embed source. */
export function embeddedBundle(embedPath = EMBED_PATH) {
  const src = readFileSync(embedPath, 'utf8');
  return new Map([...src.matchAll(/^ {2}("[^"]+"):\r?\n {4}"([A-Za-z0-9+/=]*)",\r?$/gm)].map((m) => [JSON.parse(m[1]), Buffer.from(m[2], 'base64')]));
}

/** The shipped board chunk: name ('board/…') → bytes. */
export function shippedBoard(embedPath = EMBED_PATH) {
  return new Map([...embeddedBundle(embedPath)].filter(([n]) => n.startsWith('board/')));
}

/** The bundle's JetBrains Mono (the board's one text face), from the same embed. */
export function shippedBoardFont(embedPath = EMBED_PATH) {
  return embeddedBundle(embedPath).get(BOARD_FONT);
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

const CSS = `html, body { margin: 0; }\n#board { width: 1280px; height: 800px; }\n#board.narrow { width: ${NARROW.width}px; height: ${NARROW.height}px; }\n`;

// A classic script (the GUI's app.js is one): the board arrives by import().
const DRIVER = `'use strict';
(function () {
  var R = (window.__board = { t0: performance.now(), phase: 'boot', violations: [], errors: [], rejections: [], sent: false });
  // when each phase began (ms since the driver ran): a report that stopped early shows where the time went
  R.phaseAt = [['boot', 0]];
  (function () {
    var now = R.phase;
    Object.defineProperty(R, 'phase', { enumerable: true, configurable: true, get: function () { return now; }, set: function (v) { now = v; R.phaseAt.push([v, Math.round(performance.now() - R.t0)]); } });
  })();
  document.addEventListener('securitypolicyviolation', function (e) {
    R.violations.push({ directive: e.effectiveDirective || e.violatedDirective, blockedURI: e.blockedURI, sourceFile: e.sourceFile, line: e.lineNumber, sample: (e.sample || '').slice(0, 80), at: Math.round(performance.now()), phase: R.phase });
  });
  window.addEventListener('error', function (e) { R.errors.push(String(e.message).slice(0, 300) + ' @' + e.filename + ':' + e.lineno); });
  window.addEventListener('unhandledrejection', function (e) { R.rejections.push(String(e.reason && (e.reason.stack || e.reason)).slice(0, 400)); });
  R.send = function (stage) {
    if (R.sent) return;
    R.sent = true;
    R.stage = stage;
    R.sentAt = Math.round(performance.now() - R.t0);
    R.visibility = document.visibilityState;
    R.resources = performance.getEntriesByType('resource').map(function (r) { return { path: new URL(r.name).pathname, type: r.initiatorType }; });
    R.userAgent = navigator.userAgent;
    var run = new URLSearchParams(location.search).get('run') || '';
    fetch('/report?run=' + encodeURIComponent(run), { method: 'POST', body: JSON.stringify(R) });
  };
  // the page's own deadline: it reports what it has (stage 'watchdog', never clean) before the host stops waiting.
  // The host sets it from its wait (?watchdog=ms); 45 s when it does not.
  var WATCHDOG = Number(new URLSearchParams(location.search).get('watchdog')) || 45000;
  R.watchdogMs = WATCHDOG;
  setTimeout(function () { R.send('watchdog'); }, WATCHDOG);
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  // every font string the engine gives a canvas (G-DDL-07: only the board's one face may be named)
  var FONTS_SEEN = {};
  (function () {
    var d = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'font');
    if (!d || !d.set) return;
    Object.defineProperty(CanvasRenderingContext2D.prototype, 'font', { configurable: true, enumerable: d.enumerable, get: d.get, set: function (v) { FONTS_SEEN[String(v).replace(/^[0-9.]+px /, '<size>px ')] = 1; d.set.call(this, v); } });
  })();
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
  // The engine applies ONE pointer move per animation frame: it keeps the first move of a frame and drops later ones,
  // and a pointer-up flushes a move that is still pending. So two synthetic moves must never share a frame (that was
  // the 117 x 83 rectangle: the last move was dropped), and every move here is followed by a frame, not by a timer.
  var frame = function () { return new Promise(function (r) { requestAnimationFrame(function () { r(); }); }); };
  var drag = async function (canvas, x0, y0, x1, y1) {
    pointer(canvas, 'pointerdown', x0, y0, 1);
    await frame();
    for (var i = 1; i <= 6; i++) { pointer(canvas, 'pointermove', x0 + ((x1 - x0) * i) / 6, y0 + ((y1 - y0) * i) / 6, 1); await frame(); }
    pointer(canvas, 'pointerup', x1, y1, 0);
    await frame(); await frame();
    await wait(60);
  };
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  // Two pages, one script (boards S1.3 pass P3b-2). /pinned.html loads the PINNED chunk, the bytes the kernel serves,
  // where only input the browser itself made counts: it mounts, renders, runs the paste, copy and drop containment
  // checks (condition C8), exports a PNG and reports every CSP row. / loads the PROBE build of the same sources
  // (packages/gnomon-gui/scripts/board-build.mjs, probe: true; never embedded, never served by the kernel), the one
  // build in which this page's synthetic pointer and key events count, and runs every check, the edits included.
  var PINNED = location.pathname === '/pinned.html';
  var BASE = PINNED ? '/board' : '/probe-board';
  R.mode = PINNED ? 'pinned' : 'probe';
  link.href = BASE + '/board.css';
  document.head.appendChild(link);
  R.phase = 'load';
  import(BASE + '/board.js').then(async function (m) {
    R.tModule = Math.round(performance.now() - R.t0);
    R.engine = m.BOARD_ENGINE;
    R.phase = 'mount';
    var h = await m.mountBoard(document.getElementById('board'), { syntheticInput: true });
    // The board is a view of a folded dimension (boards S1.3): the page keeps the rows, folds them with the chunk's
    // own foldDim and renders the fold. put() appends a row as the host would stamp it (a mark's \`by\` picks the
    // stamp: none is you, an agent, or no stamp at all for the unknown hand); an edit the board reports becomes a
    // row of yours and is rendered back (the live loop's stand-in); revert() takes back the last such row.
    var DIM = 'dim:01JP12HARNESS0000000000001', B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ', ZK = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    var YOU = { principal: 'p:p12/you', connId: 'conn:p12', surface: 'gui' };
    var rows = [{ seq: 1, kind: 'modns.gnomon.dimension.session.start', payload: { v: 1, dim: DIM, title: 'P12', attached: ['hsid-p12'], opened: 'command', relayedFor: YOU } }];
    var nodeCount = 0;
    R.edits = [];
    var pushRow = function (ops, by, edit) {
      var stamp = !by || by.cls === 'human' ? { relayedFor: YOU } : by.cls === 'agent' ? { relayedFor: { principal: 'p:p12/' + by.id, connId: 'conn:p12', surface: 'bridge', agent: by.name } } : {};
      rows.push({ seq: rows.length + 1, kind: 'modns.gnomon.dimension.op', edit: !!edit, payload: Object.assign({ v: 1, dim: DIM, ops: ops }, stamp) });
    };
    var show = function () { h.render(m.foldDim(rows)); };
    var nodeOf = function (k) {
      var n = nodeCount++;
      var node = { id: '01JP12HARNESS0000000000' + B32[Math.floor(n / 1024) % 32] + B32[Math.floor(n / 32) % 32] + B32[n % 32], z: ZK[Math.floor(n / ZK.length)] + ZK[n % ZK.length], x: k.x, y: k.y };
      if (k.line) node.color = k.line;
      if (k.weight && k.weight !== 'fine') node.weight = k.weight === 'bold' ? 2 : 3;
      if (k.type === 'stub') { node.kind = k.kind; return node; }
      if (k.type === 'text') { node.kind = 'text'; node.text = k.text || ''; return node; }
      if (k.type === 'arrow') { node.kind = 'arrow'; node.points = k.points || [0, 0, k.width == null ? 120 : k.width, k.height || 0]; if (k.head) node.head = k.head; if (k.text) node.label = k.text; return node; }
      if (k.type === 'stroke') { node.kind = 'stroke'; node.points = k.points; return node; }
      node.w = k.width == null ? 120 : k.width; node.h = k.height == null ? 80 : k.height;
      if (k.rot) node.rot = k.rot;
      if (k.type === 'frame') { node.kind = 'frame'; if (k.text) node.title = k.text; return node; }
      node.kind = k.type === 'ellipse' ? 'ellipse' : k.type === 'diamond' ? 'diamond' : 'rect';
      if (k.type === 'sticky') { node.fill = k.fill || 'lemon'; node.label = k.text || ''; return node; }
      if (k.fill) node.fill = k.fill;
      if (k.text) node.label = k.text;
      return node;
    };
    // marks of one hand are one row; a list that mixes hands is one row per run of the same hand
    var put = function (marks) {
      var run = [], by = null;
      var flush = function () { if (run.length) pushRow(run.map(function (k) { return { type: 'add', node: nodeOf(k) }; }), by, false); run = []; };
      marks.forEach(function (k) { var b = k.by || null; if (JSON.stringify(b) !== JSON.stringify(by)) flush(); by = b; run.push(k); });
      flush();
      show();
      return h.count();
    };
    var revert = function () { for (var n = rows.length - 1; n > 0; n--) if (rows[n].edit) { rows.splice(n, 1); break; } show(); };
    h.onEdit(function (ops, cause) { R.edits.push({ types: ops.map(function (o) { return o.type; }), cause: cause ? cause.type : null }); pushRow(ops, null, true); show(); });
    R.undoKeys = [];
    h.onUndoKey(function (e, redo) { R.undoKeys.push(redo ? 'redo' : 'undo'); });
    R.handleKeys = Object.keys(h).filter(function (k) { return k === 'add' || k === 'undo' || k === 'redo'; });
    // Condition C8: a paste, a copy and a cut are stopped BEFORE the engine. A paste is made the realest way this
    // browser allows: in a Chromium-family browser the harness server pastes for the page over the DevTools protocol
    // (the text goes on the clipboard and the platform's paste chord is pressed, so the browser itself fires the
    // paste); elsewhere (WKWebView, Firefox) the server answers 501 and a synthetic event is dispatched on the
    // board's own container. Either way the handle's listener is the path exercised: the engine's own handlers must
    // never be entered (m.boardEngineRuns()), nothing is added by the paste itself, no iframe, img, embed or object
    // node appears and no CSP row is raised. A real paste is handed on as the LITERAL text; a synthetic one is
    // stopped and, in the pinned chunk, goes no further (in the probe build it counts, and is handed on too).
    var c8 = async function (said) {
      var out = {};
      var box = document.querySelector('.excalidraw-container');
      var cv = document.querySelector('canvas.interactive') || document.querySelector('canvas');
      var AT = { x: 250, y: 420 };
      var heard = [];
      var offP = h.onPasteText(function (t) { heard.push(t); });
      var offC = h.onCopy(function () { return 'p12 copy'; });
      var nodes = [];
      var watch = new MutationObserver(function (records) {
        records.forEach(function (rec) { Array.prototype.forEach.call(rec.addedNodes, function (nd) {
          if (nd.nodeType !== 1) return;
          var hit = /^(IFRAME|EMBED|IMG|OBJECT)$/.test(nd.tagName) ? [nd] : Array.prototype.slice.call(nd.querySelectorAll('iframe, embed, img, object'));
          hit.forEach(function (x) { nodes.push(x.tagName.toLowerCase()); });
        }); });
      });
      watch.observe(document.documentElement, { childList: true, subtree: true });
      var carriedBy = function (ev, text) {
        var cd = ev.clipboardData, types = [], file = false, got = null;
        try { types = cd ? Array.prototype.slice.call(cd.types) : []; } catch (e) { types = []; }
        try { got = cd ? cd.getData('text/plain') : null; } catch (e) { got = null; }
        try { file = !!cd && ((cd.files && cd.files.length > 0) || Array.prototype.some.call(cd.items || [], function (i) { return i.kind === 'file'; })); } catch (e) { file = false; }
        return { carried: file ? 'file' : text !== null && got === text ? 'text' : 'nothing', types: types };
      };
      var paste = async function (text) {
        // a press on an empty spot, so nothing stays selected and the board has the keyboard
        pointer(cv, 'pointerdown', AT.x, AT.y, 1); await wait(30); pointer(cv, 'pointerup', AT.x, AT.y, 0); await wait(150);
        h.focus();
        try {
          var ans = await fetch('/paste?x=' + AT.x + '&y=' + AT.y, { method: 'POST', body: text });
          if (ans.status === 200) return { via: 'devtools', stopped: null, carried: 'text', types: ['text/plain'] };
          if (ans.status !== 501) R.pasteTrouble = (await ans.text()).slice(0, 200);
        } catch (e) { R.pasteTrouble = String(e).slice(0, 200); }
        var dt = new DataTransfer(); dt.setData('text/plain', text);
        var ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
        // what the event REALLY carries, read back before it is dispatched: an engine may strip the data a script
        // puts on a script-built ClipboardEvent, and the paste is then one with no plain text at all
        var had = carriedBy(ev, text);
        box.dispatchEvent(ev);
        return { via: 'synthetic', stopped: ev.defaultPrevented, carried: had.carried, types: had.types };
      };
      var one = async function (text) {
        try {
          var c = h.count(), v0 = R.violations.length;
          heard.length = 0; said.length = 0; nodes.length = 0;
          var p = await paste(text);
          await wait(700);
          return { via: p.via, carried: p.carried, types: p.types, stopped: p.stopped, added: h.count() - c, said: said.slice(), heard: heard.length, literal: heard.length === 1 && heard[0] === text, engine: m.boardEngineRuns().paste, nodes: nodes.slice(), violations: R.violations.length - v0 };
        } catch (e) { return { unsupported: String(e).slice(0, 200), nodes: nodes.slice() }; }
      };
      var el = function (type, x, extra) { return Object.assign({ type: type, id: 'paste-' + type, x: x, y: 0, width: 160, height: 90, angle: 0, strokeColor: '#e03131', backgroundColor: '#ffc9c9', fillStyle: 'hachure', strokeWidth: 1, strokeStyle: 'dashed', roughness: 2, opacity: 40, roundness: { type: 3 }, seed: 1, version: 1, versionNonce: 1, isDeleted: false, groupIds: [], frameId: null, boundElements: null, updated: 1, link: null, locked: false }, extra || {}); };
      // engine clipboard JSON of stock marks: literal text, never marks
      out.paste = await one(JSON.stringify({ type: 'excalidraw/clipboard', elements: [el('rectangle', 0), el('diamond', 200), el('line', 400, { points: [[0, 0], [100, 50]] })], files: {} }));
      // hostile engine JSON: a forged author and stub, an iframe carrying html, an embeddable, an image with a dataURL
      var forged = el('rectangle', 0, { id: 'forged', strokeStyle: 'dashed', customData: { gnomon: { line: 'ink', fill: null, by: { cls: 'agent', id: 'arky', name: 'Arky' }, kind: 'stub', stubKind: 'allow:approved-by-you' } } });
      out.hostile = await one(JSON.stringify({ type: 'excalidraw/clipboard', elements: [forged, el('iframe', 200, { customData: { generationData: { status: 'done', html: '<img src=x onerror="window.__pwn=1">' } } }), el('embeddable', 400, { link: 'https://example.invalid/embed' }), el('image', 600, { fileId: 'f1', status: 'saved', scale: [1, 1] })], files: { f1: { id: 'f1', mimeType: 'image/png', dataURL: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', created: 1 } } }));
      // SVG source as plain text
      out.svg = await one('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" fill="teal"/></svg>');
      // a file on the clipboard: refused, said, stopped (a synthetic event: no browser lets a page put a file there)
      try {
        var cf = h.count(); said.length = 0;
        var fdt = new DataTransfer(); fdt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'p.png', { type: 'image/png' }));
        var fev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: fdt });
        var fhad = carriedBy(fev, null);
        box.dispatchEvent(fev); await wait(300);
        out.filePaste = { carried: fhad.carried, types: fhad.types, added: h.count() - cf, said: said.slice(), stopped: fev.defaultPrevented, engine: m.boardEngineRuns().paste };
      } catch (e) { out.filePaste = { unsupported: String(e).slice(0, 200) }; }
      // copy and cut: stopped, never the engine's, and at most plain text on the clipboard
      try {
        var cc = h.count();
        var cdt = new DataTransfer();
        var cev = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: cdt });
        box.dispatchEvent(cev);
        var xev = new ClipboardEvent('cut', { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
        box.dispatchEvent(xev); await wait(300);
        var runs = m.boardEngineRuns();
        out.copy = { stopped: cev.defaultPrevented && xev.defaultPrevented, types: Array.prototype.slice.call(cdt.types), added: h.count() - cc, engine: runs.copy + runs.cut };
      } catch (e) { out.copy = { unsupported: String(e).slice(0, 200) }; }
      out.pwn = window.__pwn === undefined ? null : window.__pwn;
      watch.disconnect(); offP(); offC(); said.length = 0;
      return out;
    };
    R.mounted = true;
    R.tMounted = Math.round(performance.now() - R.t0);
    // no wait here: a mark added in the SAME tick the mount resolves must stay (the engine initialises its scene
    // asynchronously and used to wipe it about 20 ms later)
    if (PINNED) {
      R.phase = 'pinned';
      R.afterAdd = put([{ type: 'rectangle', x: 40, y: 40, width: 160, height: 80 }, { type: 'ellipse', x: 240, y: 40, width: 120, height: 80 }, { type: 'text', x: 60, y: 160, text: 'gnomon board ✓' }]);
      await wait(400);
      R.afterAddSettled = h.count();
      var saidPinned = [];
      h.onRefusal(function (r) { saidPinned.push(r.what + (r.detail ? ':' + r.detail : '')); });
      R.fix = await c8(saidPinned);
      // the pinned chunk ignores the mount option: a synthetic press and drag draws nothing that stays
      var cvp = document.querySelector('canvas.interactive') || document.querySelector('canvas');
      var beforeDraw = h.count();
      h.setTool('rect'); await wait(60); await drag(cvp, 500, 300, 620, 380); await wait(400);
      R.syntheticDraw = { added: h.count() - beforeDraw, edits: R.edits.length };
      h.setTool('select');
    } else {
    R.phase = 'draw';
    R.afterAdd = put([{ type: 'rectangle', x: 40, y: 40, width: 160, height: 80 }, { type: 'ellipse', x: 240, y: 40, width: 120, height: 80 }, { type: 'text', x: 60, y: 160, text: 'gnomon board ✓' }]);
    await wait(400);
    R.afterAddSettled = h.count();
    var canvas = document.querySelector('canvas.interactive') || document.querySelector('canvas');
    R.canvas = !!canvas;
    h.setTool('rect');
    await wait(60);
    await drag(canvas, 500, 300, 640, 400);
    R.afterPointerRect = h.count();
    h.setTool('stroke');
    await wait(60);
    await drag(canvas, 700, 300, 820, 420);
    R.afterPointerStroke = h.count();
    R.phase = 'tools';
    R.cursors = {};
    R.toolState = {};
    for (var i = 0; i < TOOLS.length; i++) {
      h.setTool(TOOLS[i]);
      await wait(50);
      pointer(canvas, 'pointermove', 400 + i * 10, 500, 0);
      await wait(50);
      R.cursors[TOOLS[i]] = String(canvas.style.cursor || '').replace(/blob:[^)"' ]+/, 'blob:…').slice(0, 60);
      R.toolState[TOOLS[i]] = h.state().tool;
    }
    h.setTool('select');
    // G-DDL-07: only the rail's tools exist. Every other engine tool is refused by the handle.
    R.refusedTools = {};
    REFUSED_TOOLS.forEach(function (t) { try { h.setTool(t); R.refusedTools[t] = 'accepted'; } catch (e) { R.refusedTools[t] = 'refused'; } });
    // select a mark, then reach for the stock Library (Mika's S1.0 repro: its previews are written with innerHTML
    // and carry an inline style attribute and a <style> element). The board ships no Library entry point: the
    // trigger must be absent, and pressing it if it ever comes back must still raise no violation.
    R.phase = 'library';
    await wait(60);
    pointer(canvas, 'pointerdown', 120, 41, 1);
    await wait(30);
    pointer(canvas, 'pointerup', 120, 41, 0);
    await wait(150);
    R.selectedAfterClick = h.state().selected;
    var trigger = document.querySelector('.default-sidebar-trigger, .sidebar-trigger');
    R.libraryTrigger = !!trigger;
    if (trigger) {
      var box = trigger.closest('label') ? trigger.closest('label').querySelector('input') : null;
      (box || trigger).click();
      await wait(700);
    }
    R.libraryOpen = !!document.querySelector('.layer-ui__library, .library-menu-items-container, .default-sidebar');
    var container = document.querySelector('.excalidraw-container');
    var stock = function () { return STOCK_SELECTORS.filter(function (q) { return !!document.querySelector(q); }); };
    var key = function (init) { container.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true, composed: true }, init))); };
    var drop = function (file) {
      var dt = new DataTransfer();
      dt.items.add(file);
      container.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, composed: true, clientX: 900, clientY: 600, dataTransfer: dt }));
    };
    // The command palette (S1.1 probe phase): its keys must open nothing (it offered "Library" and the stock links).
    R.phase = 'command-palette';
    container.focus();
    [{ key: '/', code: 'Slash', metaKey: true }, { key: '/', code: 'Slash', ctrlKey: true }, { key: 'p', code: 'KeyP', metaKey: true, shiftKey: true }, { key: 'p', code: 'KeyP', ctrlKey: true, shiftKey: true }, { key: '?', code: 'Slash', shiftKey: true }].forEach(key);
    await wait(400);
    R.commandPalette = { stock: stock(), dialogs: document.querySelectorAll('.Modal, .Dialog, .command-palette-dialog, [role="dialog"]').length };
    // A library file dropped on the board (S1.1 probe phase): no Library opens and nothing joins the scene.
    R.phase = 'library-drop';
    var beforeDrop = h.count();
    try {
      drop(new File([JSON.stringify({ type: 'excalidrawlib', version: 2, source: 'probe', libraryItems: [{ id: 'probe-item', status: 'unpublished', created: 1, elements: [{ type: 'rectangle', id: 'probe-rect', x: 0, y: 0, width: 40, height: 40 }] }] })], 'probe.excalidrawlib', { type: 'application/vnd.excalidrawlib+json' }));
      await wait(700);
      R.libraryDrop = { stock: stock(), added: h.count() - beforeDrop };
    } catch (e) {
      R.libraryDrop = { unsupported: String(e).slice(0, 200) };
    }
    // The image tool (S1.1 probe phase): it is absent. Its number key does nothing, the handle refuses it, and an
    // image FILE dropped on the board adds no element (it used to leave a broken placeholder and img-src refusals).
    R.phase = 'image-tool';
    var beforeImage = h.count();
    // the refusal reaches the host through the handle (the engine shows nothing itself), and a drop is reported
    var refusals = [];
    var attempts = [];
    var offRefused = h.onRefusal(function (r) { refusals.push(r.what + ':' + r.why); });
    var offAttempt = h.onAttempt(function (a) { attempts.push(a.kind + ':' + a.files); });
    key({ key: '9', code: 'Digit9' });
    await wait(150);
    R.imageTool = { afterKey: h.state().tool, handle: R.refusedTools.image, node: !!document.querySelector('[data-testid="toolbar-image"]') };
    try {
      var png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), function (ch) { return ch.charCodeAt(0); });
      drop(new File([png], 'probe.png', { type: 'image/png' }));
      await wait(900);
      R.imageTool.addedByDrop = h.count() - beforeImage;
      R.imageTool.refused = refusals;
      R.imageTool.attempts = attempts;
    } catch (e) {
      R.imageTool.dropUnsupported = String(e).slice(0, 200);
    }
    offRefused(); offAttempt();
    // what the host layer reads: every mark with its kind, box and hand, and the viewport
    R.hostView = { marks: h.marks().map(function (m) { return m.kind + ':' + m.author.cls + ':' + Math.round(m.x) + ',' + Math.round(m.y) + ',' + Math.round(m.width) + ',' + Math.round(m.height); }), view: h.view(), focus: (h.focus(), h.hasFocus()) };
    // The engine's own tool letters are gone (A arrow, K laser, E eraser, Q lock, R, D, O ...): the rail owns letters.
    R.phase = 'tool-keys';
    R.toolKeys = {};
    for (var k = 0; k < 8; k++) {
      var letter = 'akeqrdo1'[k];
      key({ key: letter });
      await wait(40);
      R.toolKeys[letter] = h.state().tool;
    }
    // G-DDL-07 runtime facts: the font strings the canvas was given, the faces the page holds, the stock nodes,
    // and whether a drawn rectangle's edge is exact (roughness 0: every column of the top edge has one profile).
    R.phase = 'reskin';
    R.stockNodes = stock();
    R.canvasFonts = Object.keys(FONTS_SEEN);
    R.fontFaces = [];
    document.fonts.forEach(function (f) { R.fontFaces.push(f.family.replace(/["']/g, '') + ' ' + f.weight + ' ' + f.status); });
    var dpr = window.devicePixelRatio || 1;
    var staticCanvas = document.querySelector('canvas.static') || document.querySelector('canvas');
    R.dpr = dpr;
    (function () {
      // the pointer rectangle was dragged from (500,300) to (640,400)
      var ctx = staticCanvas.getContext('2d');
      var profiles = {};
      var opaque = 0;
      for (var x = 520; x <= 620; x += 4) {
        var col = ctx.getImageData(Math.round(x * dpr), Math.round((300 - 6) * dpr), 1, Math.round(12 * dpr)).data;
        var p = '';
        for (var y = 0; y < col.length; y += 4) { p += col[y + 3] > 128 ? '1' : '0'; if (col[y + 3] > 128) opaque++; }
        profiles[p] = (profiles[p] || 0) + 1;
      }
      R.edge = { profiles: Object.keys(profiles).length, opaque: opaque };
    })();
    // zoom, undo and redo through the handle (what the rail's keys call)
    R.zoom = { start: h.state().zoom };
    h.zoomIn(); await wait(80); R.zoom.afterIn = h.state().zoom;
    h.zoomOut(); await wait(80); h.zoomOut(); await wait(80); R.zoom.afterOut = h.state().zoom;
    h.zoomReset(); await wait(80); R.zoom.afterReset = h.state().zoom;
    R.style = { refusedLine: h.setStyle({ line: 'lemon' }), refusedFill: h.setStyle({ fill: 'custom:#B4382A' }), okLine: h.setStyle({ line: 'cobalt' }), okBack: h.setStyle({ line: 'ink', fill: null, weight: 'fine' }), after: h.state().style };
    var states = 0;
    var off = h.onState(function () { states++; });
    // The skin, day and night (G-DDL-07 goldens): selection, the marquee, multi-select, the binding highlight and
    // the guides, each composed on the theme's ground from the engine's two canvases. Text is not in these captures
    // (the caret is DOM: its computed colour is recorded instead).
    R.phase = 'skin';
    R.skin = {};
    var capture = function (theme) {
      var c = document.createElement('canvas');
      c.width = staticCanvas.width; c.height = staticCanvas.height;
      var g = c.getContext('2d');
      g.fillStyle = GROUND[theme]; g.fillRect(0, 0, c.width, c.height);
      // every engine canvas, in paint order: the scene, the mark being drawn, the interactive layer
      Array.prototype.forEach.call(container.querySelectorAll('canvas'), function (layer) { if (layer.width && layer.height) g.drawImage(layer, 0, 0, c.width, c.height); });
      return new Promise(function (res) {
        c.toBlob(function (b) {
          b.arrayBuffer().then(function (buf) {
            var u = new Uint8Array(buf), bin = '';
            for (var n = 0; n < u.length; n += 8192) bin += String.fromCharCode.apply(null, u.subarray(n, n + 8192));
            res({ width: c.width, height: c.height, png: btoa(bin) });
          });
        }, 'image/png');
      });
    };
    var click = async function (x, y) { pointer(canvas, 'pointerdown', x, y, 1); await wait(30); pointer(canvas, 'pointerup', x, y, 0); await wait(150); };
    var hold = async function (x0, y0, x1, y1) {
      pointer(canvas, 'pointerdown', x0, y0, 1);
      await wait(30);
      for (var n = 1; n <= 8; n++) { pointer(canvas, 'pointermove', x0 + ((x1 - x0) * n) / 8, y0 + ((y1 - y0) * n) / 8, 1); await frame(); }
      await frame(); await frame();
      await wait(60);
    };
    var release = async function (x, y) { pointer(canvas, 'pointerup', x, y, 0); await wait(150); };
    for (var ti = 0; ti < 2; ti++) {
      var theme = ['day', 'night'][ti];
      var S = (R.skin[theme] = {});
      h.setTheme(theme);
      h.setTool('select');
      await click(1100, 700); // clear the selection
      await wait(200);
      S.marks = await capture(theme);
      await click(120, 41); // the first rectangle's top edge
      S.selected = h.state().selected;
      S.selection = await capture(theme);
      await click(1100, 700);
      await hold(20, 20, 420, 140); // a marquee over the first rectangle and the ellipse
      S.marquee = await capture(theme);
      await release(420, 140);
      S.multiSelected = h.state().selected;
      S.multi = await capture(theme);
      await click(1100, 700);
      var beforeArrow = h.count();
      h.setTool('arrow');
      await wait(60);
      await hold(300, 330, 203, 100); // an arrow dragged to the first rectangle's right edge: it is about to bind
      S.binding = await capture(theme);
      await release(203, 100);
      S.arrowAdded = h.count() - beforeArrow;
      revert();
      await wait(120);
      S.afterUndo = h.count() - beforeArrow;
      h.setTool('select');
      await click(1100, 700);
      await hold(240, 80, 322, 82); // the ellipse dragged along by its left point: its top and bottom stay level with the rectangle's
      S.guides = await capture(theme);
      await release(322, 82);
      revert();
      await wait(120);
      await click(1100, 700);
      // the caret: a text is being typed; its colours and face are computed style, not pixels
      h.setTool('text');
      await wait(60);
      await click(300, 520);
      var ta = document.querySelector('textarea.excalidraw-wysiwyg') || document.querySelector('.excalidraw-textEditorContainer textarea');
      if (ta) {
        var cs = getComputedStyle(ta);
        S.caret = { caretColor: cs.caretColor, color: cs.color, fontFamily: cs.fontFamily, fontSize: cs.fontSize, editing: h.state().editingText };
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await wait(150);
      } else S.caret = null;
      window.scrollTo(0, 0); // a focused text field may scroll a small window; the pointer coordinates below assume it has not
      h.setTool('select');
      S.count = h.count();
    }
    // The 374px board (a 1024 window) in a short pane: no phone layout, no stock node.
    R.phase = 'narrow';
    h.setTheme('day');
    var boardEl = document.getElementById('board');
    boardEl.classList.add('narrow');
    window.dispatchEvent(new Event('resize'));
    await wait(500);
    R.narrow = { stock: stock(), width: container.getBoundingClientRect().width, height: container.getBoundingClientRect().height, capture: await capture('day') };
    boardEl.classList.remove('narrow');
    window.dispatchEvent(new Event('resize'));
    await wait(300);
    // Mika's S1.1 pass A findings, each replayed on the shipped chunk (day theme, select tool).
    R.phase = 'fixes';
    R.fix = {};
    var said = [];
    var offSaid = h.onRefusal(function (r) { said.push(r.what + (r.detail ? ':' + r.detail : '')); });
    h.setTheme('day'); h.setTool('select'); await click(1100, 700);
    // 2. a programmatic add is never an undo step: add, one user action, one undo: the added mark stays
    var c0 = h.count();
    put([{ type: 'rectangle', x: 900, y: 480, width: 120, height: 80 }]);
    h.setTool('rect'); await wait(60); await drag(canvas, 1060, 480, 1160, 540);
    R.fix.undo = { afterDraw: h.count() - c0 };
    revert(); await wait(150);
    R.fix.undo.afterUndo = h.count() - c0;
    // the engine has no undo of its own (boards S1.3): Cmd+Z and Cmd+Shift+Z in the board change nothing and reach the host
    var cz = h.count();
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', metaKey: true, bubbles: true, cancelable: true }));
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await wait(150);
    R.fix.undoKey = { keys: R.undoKeys.slice(), changed: h.count() - cz };
    // 5. with the last-made mark still selected, choosing Text and clicking starts a text at once
    h.setTool('rect'); await wait(60); await drag(canvas, 1060, 560, 1160, 620);
    R.fix.textAfterShape = { selectedBefore: h.state().selected };
    h.setTool('text'); await wait(60);
    R.fix.textAfterShape.selectedAfterTool = h.state().selected;
    await click(700, 650);
    R.fix.textAfterShape.editing = h.state().editingText;
    var ta2 = document.querySelector('textarea.excalidraw-wysiwyg');
    if (ta2) ta2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await wait(150); h.setTool('select');
    // 1. a dropped scene file never reaches the engine
    var c1 = h.count();
    said.length = 0;
    try {
      var over = new DragEvent('dragover', { bubbles: true, cancelable: true, composed: true, clientX: 900, clientY: 600, dataTransfer: (function () { var d = new DataTransfer(); d.items.add(new File(['{}'], 'x.excalidraw', { type: 'application/json' })); return d; })() });
      container.dispatchEvent(over);
      drop(new File([JSON.stringify({ type: 'excalidraw', version: 2, source: 'probe', elements: [{ type: 'rectangle', id: 'scene-rect', x: 10, y: 10, width: 300, height: 200, strokeStyle: 'dashed', roughness: 2 }], appState: { viewBackgroundColor: '#ffffff' } })], 'probe.excalidraw', { type: 'application/json' }));
      await wait(700);
      R.fix.sceneDrop = { added: h.count() - c1, said: said.slice(), dragStopped: over.defaultPrevented };
    } catch (e) { R.fix.sceneDrop = { unsupported: String(e).slice(0, 200) }; }
    // 3. paste, copy and cut never reach the engine (condition C8): see c8() above
    var el = function (type, x, extra) { return Object.assign({ type: type, id: 'paste-' + type, x: x, y: 0, width: 160, height: 90 }, extra || {}); };
    var c8r = await c8(said);
    R.fix.paste = c8r.paste; R.fix.hostile = c8r.hostile; R.fix.svg = c8r.svg; R.fix.filePaste = c8r.filePaste; R.fix.copy = c8r.copy; R.fix.pwn = c8r.pwn;
    // S2. a drag that carries the library type and NO file (a drag from another page): refused like any drop
    var c3 = h.count();
    said.length = 0;
    try {
      var ld = new DataTransfer();
      ld.setData('application/vnd.excalidrawlib+json', JSON.stringify({ type: 'excalidrawlib', version: 2, libraryItems: [{ id: 'x', status: 'published', created: 1, elements: [el('rectangle', 0)] }] }));
      var dropped = new DragEvent('drop', { bubbles: true, cancelable: true, composed: true, clientX: 600, clientY: 500, dataTransfer: ld });
      container.dispatchEvent(dropped);
      await wait(500);
      R.fix.dataDrop = { added: h.count() - c3, said: said.slice(), stopped: dropped.defaultPrevented, stock: stock() };
    } catch (e) { R.fix.dataDrop = { unsupported: String(e).slice(0, 200) }; }
    // R1 (review round 2). What the host adds through the REAL engine keeps its hand: an agent's mark, an unknown
    // hand's mark, a stub and a sticky are reported as such (the engine used to replace the ids the record is
    // keyed by, so every added mark came back as a plain mark of yours)
    var seen0 = {};
    h.marks().forEach(function (k) { if (k.node) seen0[k.node] = 1; });
    put([
      { type: 'rectangle', x: 700, y: 520, width: 60, height: 40, by: { cls: 'agent', id: 'arky', name: 'Arky' } },
      { type: 'ellipse', x: 780, y: 520, width: 60, height: 40, by: { cls: 'unknown' } },
      { type: 'stub', x: 860, y: 520, kind: 'live:session', by: { cls: 'agent', id: 'luna', name: 'Luna' } },
      { type: 'sticky', x: 700, y: 600, width: 80, height: 50 },
      { type: 'text', x: 800, y: 610, text: 'by quill', by: { cls: 'agent', id: 'quill', name: 'Quill' } },
    ]);
    await wait(250);
    // (paint order is the order keys', so the marks of this row are picked by node id, in the order they were put)
    R.fix.hands = h.marks().filter(function (k) { return k.node && !seen0[k.node] && !k.labelOf; }).sort(function (a, b) { return a.node < b.node ? -1 : 1; }).map(function (m) { return m.kind + ':' + m.author.cls + (m.author.name ? ':' + m.author.name : '') + (m.stubKind ? ':' + m.stubKind : '') + ':' + Math.round(m.width); });
    await click(1100, 700); await wait(150);
    (function () {
      // an agent's rectangle is dashed (gaps along its top edge); yours stays solid
      var v3 = h.view(), g4 = staticCanvas.getContext('2d'), gaps3 = 0;
      for (var ax = 706; ax < 754; ax += 2) { if (g4.getImageData(Math.round((ax + v3.scrollX) * v3.zoom * dpr), Math.round((520 + v3.scrollY) * v3.zoom * dpr), 1, 1).data[3] < 128) gaps3++; }
      R.fix.agentEdgeGaps = gaps3;
    })();
    // 4. the frame title editor wears the system, and Esc ends it
    put([{ type: 'frame', x: 60, y: 560, width: 220, height: 120, text: 'a frame title that is long enough to be cut off' }]);
    await wait(200);
    var ft = document.querySelector('.excalidraw [id*="-frame-name-"]');
    R.fix.frame = { title: ft ? ft.getAttribute('title') : null, weight: ft ? getComputedStyle(ft).fontWeight : null };
    if (ft) {
      ft.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, composed: true }));
      await wait(200);
      var fi = ft.querySelector('input');
      if (fi) {
        var fcs = getComputedStyle(fi);
        R.fix.frame.editor = { fontFamily: fcs.fontFamily, fontSize: fcs.fontSize, fontWeight: fcs.fontWeight, color: fcs.color, radius: fcs.borderTopLeftRadius, editing: h.state().editingText };
        fi.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await wait(250);
        R.fix.frame.afterEsc = { input: !!document.querySelector('.excalidraw [id*="-frame-name-"] input'), editing: h.state().editingText };
      }
    }
    // 7. a label typed into a shape is the default ink whatever line is current; the state counts marks, not labels
    h.setStyle({ line: 'raspberry' });
    var m0 = h.state().marks;
    put([{ type: 'sticky', x: 320, y: 560, width: 120, height: 70, text: 'label' }]);
    await wait(200);
    var lab = h.marks().filter(function (m) { return !!m.labelOf; });
    R.fix.label = { lines: lab.map(function (m) { return m.line; }), marksAdded: h.state().marks - m0, countAdded: lab.length };
    h.setStyle({ line: 'ink' });
    offSaid();
    // 8. one capture per theme with a mark in every content colour: only those colours and the theme's own may show
    R.phase = 'colours';
    var pairs = [['ink', 'paper'], ['graphite', 'lemon'], ['leaf', 'leaf'], ['sky', 'sky'], ['cobalt', 'cobalt'], ['orchid', 'orchid'], ['raspberry', 'raspberry']];
    put(pairs.map(function (p, n) { return { type: n % 2 ? 'ellipse' : 'rectangle', x: 480 + n * 100, y: 40, width: 80, height: 60, line: p[0], fill: p[1], weight: n % 2 ? 'bold' : 'fine' }; }));
    await click(1100, 760);
    R.colours = {};
    for (var ci = 0; ci < 2; ci++) { h.setTheme(['day', 'night'][ci]); await wait(250); R.colours[['day', 'night'][ci]] = await capture(['day', 'night'][ci]); }
    h.setTheme('day');
    off();
    R.stateEvents = states;
    R.canvasFontsEnd = Object.keys(FONTS_SEEN);
    // 9. the whole kind and style matrix, once per hand (you, an agent, the unknown hand), day and night; then a
    // stroke drawn by pointer at 400% (a row stores whole board units, so it comes back stepped)
    R.phase = 'matrix';
    var keptRows = rows.slice(), TICK = [0, 0, 6, 9, 13, 15, 22, 12, 34, -2, 46, -18, 58, -30];
    var column = function (dx, by) {
      return [
        { type: 'frame', x: dx + 8, y: 16, width: 392, height: 96, text: 'frame' },
        { type: 'stroke', x: dx + 24, y: 70, points: TICK },
        { type: 'stroke', x: dx + 100, y: 70, points: TICK, weight: 'bold', line: 'cobalt' },
        { type: 'stroke', x: dx + 176, y: 70, points: TICK, weight: 'marker', line: 'raspberry' },
        { type: 'text', x: dx + 260, y: 52, text: 'plain text' },
        { type: 'rectangle', x: dx + 16, y: 136, width: 84, height: 52 },
        { type: 'rectangle', x: dx + 116, y: 136, width: 84, height: 52, line: 'cobalt', fill: 'sky' },
        { type: 'sticky', x: dx + 216, y: 136, width: 84, height: 52, text: 'sticky' },
        { type: 'rectangle', x: dx + 316, y: 136, width: 84, height: 52, weight: 'bold', rot: 150 },
        { type: 'ellipse', x: dx + 16, y: 212, width: 84, height: 52 },
        { type: 'ellipse', x: dx + 116, y: 212, width: 84, height: 52, line: 'leaf', fill: 'leaf', text: 'label' },
        { type: 'diamond', x: dx + 216, y: 208, width: 84, height: 60 },
        { type: 'diamond', x: dx + 316, y: 208, width: 84, height: 60, line: 'cobalt', fill: 'orchid', text: 'if' },
        { type: 'arrow', x: dx + 16, y: 300, width: 84, head: 'none' },
        { type: 'arrow', x: dx + 116, y: 300, width: 84 },
        { type: 'arrow', x: dx + 216, y: 300, width: 84, head: 'both', weight: 'bold' },
        { type: 'arrow', x: dx + 400, y: 300, points: [0, 0, -84, 0], line: 'graphite', text: 'back' },
        { type: 'arrow', x: dx + 16, y: 336, points: [0, 0, 40, 28, 84, 0], line: 'raspberry' },
        { type: 'stub', x: dx + 112, y: 328, kind: 'live:session' },
      ].map(function (k) { return by ? Object.assign(k, { by: by }) : k; });
    };
    rows.length = 1;
    put(column(0, null).concat(column(424, { cls: 'agent', id: 'arky', name: 'Arky' }), column(848, { cls: 'unknown' })));
    await click(1100, 760);
    R.matrix = { hands: h.marks().filter(function (k) { return !k.labelOf; }).reduce(function (a, k) { a[k.author.cls] = (a[k.author.cls] || 0) + 1; return a; }, {}), kinds: Object.keys(h.marks().reduce(function (a, k) { a[k.kind] = 1; return a; }, {})).sort() };
    for (var mi = 0; mi < 2; mi++) { h.setTheme(['day', 'night'][mi]); await wait(250); R.matrix[['day', 'night'][mi]] = await capture(['day', 'night'][mi]); }
    h.setTheme('day');
    rows.length = 1; show();
    for (var zi = 0; zi < 30; zi++) { h.zoomIn(); await wait(25); }
    await wait(200);
    R.zoom400 = { zoom: h.state().zoom, editsBefore: R.edits.length };
    h.setTool('stroke'); await wait(60);
    pointer(canvas, 'pointerdown', 200, 330, 1); await wait(30);
    // a SLOW stroke: 240 samples 3.5px apart, about one per board unit at 400%
    for (var sn = 1; sn <= 240; sn++) { pointer(canvas, 'pointermove', 200 + sn * 3.5, 330 - 150 * Math.sin(sn / 36) - sn * 0.375, 1); await frame(); }
    pointer(canvas, 'pointerup', 200 + 240 * 3.5, 330 - 150 * Math.sin(240 / 36) - 90, 0); await wait(300);
    R.zoom400.samples = 240;
    R.zoom400.points = (function () { var out = 0; m.foldDim(rows).nodes.forEach(function (n) { if (n.node.kind === 'stroke') out = n.node.points.length / 2; }); return out; })();
    R.zoom400.edits = R.edits.slice(R.zoom400.editsBefore);
    R.zoom400.strokes = h.marks().filter(function (k) { return k.kind === 'stroke' && k.node; }).length;
    h.setTool('select'); await click(60, 760);
    R.zoom400.capture = await capture('day');
    h.zoomReset(); await wait(120);
    rows.length = 0; keptRows.forEach(function (r) { rows.push(r); }); show();
    await wait(150);
    }
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
`.replace('(function () {', `var TOOLS = ${JSON.stringify(TOOLS)};\nvar REFUSED_TOOLS = ${JSON.stringify(REFUSED_TOOLS)};\nvar STOCK_SELECTORS = ${JSON.stringify(STOCK_SELECTORS)};\nvar GROUND = ${JSON.stringify(GROUND)};\n(function () {`);

/** url path → bytes of everything the harness serves: the shipped board files plus the page. */
export function harnessFiles(board = shippedBoard(), probe = null) {
  const files = new Map();
  for (const [n, b] of board) files.set(`/${n}`, b);
  // the board's one text face lives beside the chunk in the same pinned bundle (../fonts from board/)
  const font = shippedBoardFont();
  if (font) files.set(`/${BOARD_FONT}`, font);
  // the probe build (never embedded, never shipped) in its own directory beside the pinned one, so both ask for
  // the same face at ../fonts
  for (const [n, b] of probe ?? []) files.set(`/probe-board/${n.replace(/^board\//, '')}`, b);
  files.set('/pinned.html', INDEX);
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

/**
 * Which of the paste and drop checks a run REALLY exercised (a browser that ignores a synthetic paste or cannot
 * build a DragEvent reports `unsupported`; that is not a pass). The probe and the GUI test require every check to
 * have run in at least one engine, and print which.
 */
/**
 * The probe build of the board chunk: the same sources and patches as the pinned one, with the build-time define
 * that lets untrusted events count as input (packages/gnomon-gui/scripts/board-build.mjs, `probe: true`). It needs
 * the GUI package's own build tool, so it is made only where the repo's dependencies are installed; it is never
 * embedded, never pinned and never served by the kernel.
 */
export async function probeBoard() {
  const { buildBoard } = await import('../../../gnomon-gui/scripts/board-build.mjs');
  return (await buildBoard({ probe: true })).files;
}

/**
 * What a paste event carried, as the page read it back before dispatching it: `text` (the pasted text, or a real
 * paste the browser made), `file`, or `nothing` (the engine stripped what the script put on a script-built
 * ClipboardEvent). A record without the field is judged as carrying what was put on it.
 */
const carriedOf = (x, otherwise) => (x?.carried === 'text' || x?.carried === 'file' || x?.carried === 'nothing' ? x.carried : otherwise);

/** The one contained outcome of a paste that carried NOTHING: stopped, nothing added, engine not entered, no node, no CSP row, and the board said `paste` (no plain text), once. */
function emptyPasteTrouble(x) {
  if (x.added !== 0) return `the paste itself added ${x.added} mark(s)`;
  if (x.engine !== 0) return `the engine's own paste handler ran ${x.engine} time(s)`;
  if (x.nodes?.length) return `nodes appeared: ${x.nodes.join()}`;
  if (x.violations) return `${x.violations} CSP row(s)`;
  if (x.stopped !== true) return `a paste that carried nothing was not stopped (stopped ${x.stopped})`;
  if (x.heard) return `a paste that carried nothing was handed on ${x.heard} time(s)`;
  if (x.said?.join() !== 'paste') return `a paste that carried nothing must be refused as "paste" (no plain text), once; said: ${JSON.stringify(x.said ?? null)}`;
  return '';
}

/**
 * Why a paste check did not hold ('' when it did). `mode` is the page's: 'pinned' or 'probe'. Judged by what the
 * event CARRIED, never by the engine's name: with the text, the expectations are the strict ones (no refusal said;
 * handed on as the literal text when the browser made the paste or the build counts synthetic input; stopped and
 * heard by nobody otherwise); with nothing, the only contained outcome is `emptyPasteTrouble`'s.
 */
export function pasteTrouble(x, mode) {
  if (!x) return 'no result';
  if (x.unsupported) return '';
  const carried = carriedOf(x, 'text');
  if (carried === 'nothing') return emptyPasteTrouble(x);
  if (carried !== 'text') return `a text paste carried ${carried}`;
  if (x.added !== 0) return `the paste itself added ${x.added} mark(s)`;
  if (x.engine !== 0) return `the engine's own paste handler ran ${x.engine} time(s)`;
  if (x.said?.length) return `a refusal was said: ${x.said.join()}`;
  if (x.nodes?.length) return `nodes appeared: ${x.nodes.join()}`;
  if (x.violations) return `${x.violations} CSP row(s)`;
  // a paste the browser made, or one that counts in the probe build, is handed on as the literal text, once
  if (x.via === 'devtools' || mode === 'probe') return x.heard === 1 && x.literal === true ? '' : `handed on ${x.heard} time(s), literal ${x.literal}`;
  // a synthetic paste on the pinned chunk is stopped and goes no further
  return x.heard === 0 && x.stopped === true ? '' : `a synthetic paste was heard ${x.heard} time(s), stopped ${x.stopped}`;
}

/** Why the pasted-file check did not hold ('' when it did): a file that was carried is refused as `image`; an event that carried nothing is refused as `paste`. */
export function filePasteTrouble(fp) {
  if (!fp) return 'no result';
  if (fp.unsupported) return '';
  const carried = carriedOf(fp, 'file');
  if (carried === 'text') return 'a file paste carried text';
  const want = carried === 'file' ? 'image' : 'paste';
  return fp.added === 0 && fp.said?.join() === want && fp.stopped === true && fp.engine === 0 ? '' : `carried ${carried}: expected the refusal "${want}", stopped, nothing added, engine 0`;
}

/** The C8 problems of a run (both pages run these checks). */
export function c8Problems(r) {
  const f = r.fix ?? {};
  const p = [];
  for (const [k, what] of [['paste', 'a paste was not contained before the engine'], ['hostile', 'hostile pasted content got through'], ['svg', 'pasted SVG source was not contained']]) {
    const why = pasteTrouble(f[k], r.mode);
    if (why || f[k]?.nodes?.length) p.push(`${what}: ${why || 'nodes appeared'} ${JSON.stringify(f[k])}`);
  }
  const fp = f.filePaste;
  const fileWhy = filePasteTrouble(fp);
  if (fileWhy) p.push(`a pasted file was not refused: ${fileWhy} ${JSON.stringify(fp)}`);
  const cp = f.copy;
  if (!cp || (!cp.unsupported && (cp.stopped !== true || cp.engine !== 0 || cp.added !== 0 || cp.types?.some((t) => t !== 'text/plain')))) p.push(`a copy or a cut reached the engine or the clipboard got more than plain text: ${JSON.stringify(cp)}`);
  if (f.pwn !== null && f.pwn !== undefined) p.push(`a handler from pasted content ran: ${JSON.stringify(f.pwn)}`);
  return p;
}

/** What each paste check of a run carried (`text`, `file`, `nothing`), or null where it did not run. For the evidence. */
export function pasteCarried(r) {
  const f = r?.fix ?? {};
  const of = (x, otherwise) => (!x || x.unsupported ? null : carriedOf(x, otherwise));
  return { paste: of(f.paste, 'text'), hostile: of(f.hostile, 'text'), svg: of(f.svg, 'text'), filePaste: of(f.filePaste, 'file') };
}

export function exercisedChecks(r) {
  const ran = (x) => !!x && !x.unsupported;
  // a paste check is exercised only where the event carried what the check is about: a paste that carried nothing
  // proves the empty paste is contained, not that pasted text or a pasted file is
  const carrying = (x, what) => ran(x) && carriedOf(x, what) === what;
  const f = r?.fix ?? {};
  return { 'library-file drop': ran(r?.libraryDrop), 'image-file drop': !!r?.imageTool && r.imageTool.dropUnsupported === undefined, 'scene-file drop': ran(f.sceneDrop), 'library-type drag (no file)': ran(f.dataDrop), 'paste: stock marks': carrying(f.paste, 'text'), 'paste: forged author, iframe, embeddable, image': carrying(f.hostile, 'text'), 'paste: a file': carrying(f.filePaste, 'file'), 'copy and cut': ran(f.copy) };
}

/** The only font string the canvas may be given (patch font-family-string), with the size folded out. */
export const BOARD_FONT_STRING = '<size>px "JetBrains Mono", monospace';

/**
 * The runtime half of G-DDL-07 (boards S1.1), one finished run of one engine: no stock node, only the rail's tools,
 * no engine tool key, no command palette, no Library from a dropped file, no image from the key or a dropped file,
 * one font face and one font string, an exact (roughness 0) edge, the handle's zoom, undo and style, and the skin
 * captures present for day and night. The pixel checks of the captures are the GUI test's (it has the palette).
 */
export function reskinProblems(r) {
  const p = [];
  if (r.stockNodes?.length !== 0) p.push(`stock engine nodes in the DOM: ${(r.stockNodes ?? ['(not reported)']).join(', ')}`);
  const tools = r.toolState ?? {};
  for (const t of TOOLS) if (tools[t] !== t) p.push(`the rail tool ${t} left the handle in ${tools[t]}`);
  for (const t of REFUSED_TOOLS) if (r.refusedTools?.[t] !== 'refused') p.push(`the handle accepted the engine tool ${t}`);
  for (const [k, v] of Object.entries(r.toolKeys ?? { '(not reported)': '?' })) if (v !== 'select') p.push(`the engine tool key ${k} chose ${v}`);
  if (r.commandPalette?.stock?.length !== 0 || r.commandPalette?.dialogs !== 0) p.push(`the command palette keys opened something: ${JSON.stringify(r.commandPalette)}`);
  if (!r.libraryDrop || (!r.libraryDrop.unsupported && (r.libraryDrop.stock?.length !== 0 || r.libraryDrop.added !== 0))) p.push(`a dropped library file changed the board: ${JSON.stringify(r.libraryDrop)}`);
  const im = r.imageTool ?? {};
  if (im.afterKey !== 'select' || im.handle !== 'refused' || im.node !== false || (im.dropUnsupported === undefined && im.addedByDrop !== 0)) p.push(`the image tool is reachable: ${JSON.stringify(im)}`);
  if (im.dropUnsupported === undefined && (im.refused?.join() !== 'image:no-image-kind' || im.attempts?.join() !== 'drop:1')) p.push(`a refused image was not reported to the host: ${JSON.stringify({ refused: im.refused, attempts: im.attempts })}`);
  const hv = r.hostView ?? {};
  if (hv.marks?.join(' ') !== 'rect:human:40,40,160,80 ellipse:human:240,40,120,80 text:human:60,160,' + (hv.marks?.[2] ?? '').split(',').slice(2).join(',') + ' rect:human:500,300,140,100 stroke:human:700,300,120,120' || hv.view?.zoom !== 1 || hv.focus !== true) p.push(`the host view of the marks: ${JSON.stringify(hv)}`);
  const fonts = r.canvasFonts ?? [];
  if (fonts.length === 0 || fonts.some((f) => f !== BOARD_FONT_STRING)) p.push(`canvas font strings other than the board face: ${JSON.stringify(fonts)}`);
  const faces = r.fontFaces ?? [];
  if (!faces.some((f) => f === 'JetBrains Mono 400 loaded') || faces.some((f) => !f.startsWith('JetBrains Mono '))) p.push(`font faces on the page: ${JSON.stringify(faces)}`);
  if (r.edge?.profiles !== 1 || !(r.edge?.opaque > 0)) p.push(`a drawn rectangle's edge is not exact (roughness 0): ${JSON.stringify(r.edge)}`);
  const z = r.zoom ?? {};
  if (!(z.start === 1 && z.afterIn > 1 && z.afterOut < 1 && z.afterReset === 1)) p.push(`zoom through the handle: ${JSON.stringify(z)}`);
  const st = r.style ?? {};
  if (st.refusedLine?.ok !== false || st.refusedFill?.ok !== false || st.okLine?.ok !== true || st.after?.line !== 'ink' || st.after?.fill !== null) p.push(`style through the handle: ${JSON.stringify(st)}`);
  for (const theme of ['day', 'night']) {
    const s = r.skin?.[theme];
    if (!s) {
      p.push(`no ${theme} skin captures`);
      continue;
    }
    for (const shot of ['marks', 'selection', 'marquee', 'multi', 'binding', 'guides']) if (!s[shot]?.png) p.push(`no ${theme} ${shot} capture`);
    if (s.selected !== 1) p.push(`${theme}: a click selected ${s.selected} marks, expected 1`);
    if (s.multiSelected !== 2) p.push(`${theme}: the marquee selected ${s.multiSelected} marks, expected 2`);
    if (s.arrowAdded !== 1 || s.afterUndo !== 0) p.push(`${theme}: arrow then undo left ${s.arrowAdded} then ${s.afterUndo}`);
    if (!s.caret || s.caret.editing !== true || !/^"?JetBrains Mono"?, monospace$/.test(s.caret.fontFamily) || s.caret.caretColor !== RGB_INK[theme]) p.push(`${theme}: the text caret: ${JSON.stringify(s.caret)}`);
  }
  if (!r.narrow || r.narrow.stock?.length !== 0 || Math.round(r.narrow.width) !== NARROW.width || !r.narrow.capture?.png) p.push(`the ${NARROW.width}px board: ${JSON.stringify({ ...r.narrow, capture: r.narrow?.capture ? '(png)' : null })}`);
  const f = r.fix ?? {};
  if (f.undoKey?.keys?.join() !== 'undo,redo' || f.undoKey?.changed !== 0) p.push(`Cmd+Z did not reach the host, or the engine acted on it: ${JSON.stringify(f.undoKey)}`);
  if (r.handleKeys?.length !== 0) p.push(`the handle still has ${JSON.stringify(r.handleKeys)}`);
  const mx = r.matrix;
  if (!mx || mx.hands?.human !== 19 || mx.hands?.agent !== 19 || mx.hands?.unknown !== 19 || mx.kinds?.join() !== 'arrow,diamond,ellipse,frame,rect,sticky,stroke,stub,text') p.push(`the kind and style matrix did not render per hand: ${JSON.stringify({ hands: mx?.hands, kinds: mx?.kinds })}`);
  const z4 = r.zoom400;
  if (!z4 || Math.round(z4.zoom * 100) !== 400 || z4.edits?.length !== 1 || z4.edits[0].types.join() !== 'add' || z4.edits[0].cause !== 'pointerup' || z4.strokes !== 1 || !(z4.points >= 8 && z4.points < z4.samples / 2)) p.push(`a stroke drawn at 400% was not one add at pointer-up, thinned to fewer than half its samples: ${JSON.stringify({ ...z4, capture: undefined })}`);
  if (f.undo?.afterDraw !== 2 || f.undo?.afterUndo !== 1) p.push(`an undo after a programmatic add took the added marks with it: ${JSON.stringify(f.undo)}`);
  if (!(f.textAfterShape?.selectedBefore === 1 && f.textAfterShape?.selectedAfterTool === 0 && f.textAfterShape?.editing === true)) p.push(`text did not start on the first click after a shape: ${JSON.stringify(f.textAfterShape)}`);
  if (!f.sceneDrop || (!f.sceneDrop.unsupported && (f.sceneDrop.added !== 0 || f.sceneDrop.said?.join() !== 'scene-file' || f.sceneDrop.dragStopped !== true))) p.push(`a dropped scene file reached the board: ${JSON.stringify(f.sceneDrop)}`);
  const dd = f.dataDrop;
  if (!dd || (!dd.unsupported && (dd.added !== 0 || dd.said?.join() !== 'library-file' || dd.stopped !== true || dd.stock?.length !== 0))) p.push(`a drag of the library type with no file reached the board: ${JSON.stringify(dd)}`);
  p.push(...c8Problems(r));
  if (f.hands?.join() !== 'rect:agent:Arky:60,ellipse:unknown:60,stub:agent:Luna:live:session:288,sticky:human:80,text:agent:Quill:' + String(f.hands?.[4] ?? '').split(':').pop() || !(f.agentEdgeGaps > 0)) p.push(`marks added by the host lost their hand: ${JSON.stringify({ hands: f.hands, agentEdgeGaps: f.agentEdgeGaps })}`);
  const fr = f.frame ?? {};
  if (fr.title !== 'a frame title that is long enough to be cut off' || fr.weight !== '600' || !fr.editor || !/^"?JetBrains Mono"?, monospace$/.test(fr.editor.fontFamily) || fr.editor.fontSize !== '11.5px' || fr.editor.fontWeight !== '600' || fr.editor.color !== RGB_INK.day || fr.editor.radius !== '0px' || fr.editor.editing !== true || fr.afterEsc?.input !== false || fr.afterEsc?.editing !== false) p.push(`the frame title: ${JSON.stringify(fr)}`);
  if (f.label?.lines?.join() !== 'ink' || f.label?.marksAdded !== 1) p.push(`a label in a sticky: ${JSON.stringify(f.label)}`);
  for (const theme of ['day', 'night']) if (!r.colours?.[theme]?.png) p.push(`no ${theme} content-colour capture`);
  if (!(r.stateEvents > 0)) p.push('the handle announced no state change');
  return p;
}
/** The ink token of each theme as a computed colour: the harness page defines no tokens, so the caret takes the text's own colour, which is the mark's line colour (ink) in that theme. */
export const RGB_INK = { day: 'rgb(22, 21, 15)', night: 'rgb(232, 244, 240)' };

/** Why a run is not clean ([] when it is): the G-DDL-06 predicate, one run of one engine. */
export function runProblems(r, known) {
  if (r.error) {
    // a page that did not report is never clean; a report that came after the wait gave up does not make it one,
    // and any CSP row it carries is a violation like any other
    const p = [r.miss && MISS[r.miss] ? `${r.error} (${MISS[r.miss]})` : r.error];
    if (r.lateReport?.violationCount) p.push(`${r.lateReport.violationCount} CSP violation(s) in a report that came after the timeout: ${r.lateReport.violations.map((v) => `${v.directive} ${v.blocked} in ${v.phase} x${v.count}`).join('; ')}`);
    return p;
  }
  const p = [];
  if (!r.mounted) p.push(`did not mount (stage ${r.stage})`);
  if (r.violationCount) p.push(`${r.violationCount} CSP violation(s): ${r.violations.map((v) => `${v.directive} ${v.blocked} in ${v.phase} x${v.count}`).join('; ')}`);
  if (r.errors?.length) p.push(`page errors: ${r.errors.join(' | ')}`);
  if (r.rejections?.length) p.push(`unhandled rejections: ${r.rejections.join(' | ')}`);
  if (r.mounted && r.afterAdd !== 3) p.push(`the handle added ${r.afterAdd} marks, expected 3`);
  if (r.mounted && r.afterAddSettled !== 3) p.push(`marks added as the mount resolved did not stay: ${r.afterAddSettled} of 3 left`);
  if (r.mounted && r.stage === 'done' && (r.aliveAfterUnmount !== false || r.deadHandle !== 'refused')) p.push(`a handle whose board is gone still answers (alive ${r.aliveAfterUnmount}, count ${r.deadHandle})`);
  if (r.mounted && r.stage === 'done' && r.alive !== true) p.push('the handle says the engine is no longer alive');
  const pinned = r.mode === 'pinned';
  if (!pinned && r.mounted && r.afterPointerRect !== 4) p.push(`the pointer rectangle left ${r.afterPointerRect} elements, expected 4`);
  if (!pinned && r.mounted && r.afterPointerStroke !== 5) p.push(`the pointer stroke left ${r.afterPointerStroke} elements, expected 5`);
  if (!pinned && r.mounted && r.libraryTrigger !== false) p.push('the stock Library trigger is on the page');
  if (!pinned && r.mounted && r.libraryOpen !== false) p.push('the stock Library sidebar opened');
  if (r.mounted && !r.png?.ok) p.push(`PNG export failed: ${r.png?.error ?? JSON.stringify(r.png)}`);
  if (!pinned && r.mounted && r.stage === 'done') p.push(...reskinProblems(r));
  // the pinned bytes: the containment checks, and the proof that untrusted input does not count there
  if (pinned && r.mounted && r.stage === 'done') {
    p.push(...c8Problems(r));
    if (r.syntheticDraw?.added !== 0 || r.syntheticDraw?.edits !== 0) p.push(`synthetic input counted in the pinned chunk: ${JSON.stringify(r.syntheticDraw)}`);
  }
  if (r.stage !== 'done') p.push(`stage ${r.stage}`);
  const stray = (r.requests ?? []).filter((q) => !known.has(q.path) && q.path !== '/report' && q.path !== '/paste' && q.path !== '/' && q.path !== '/pinned.html' && q.path !== '/favicon.ico'); // the browser's own favicon probe
  if (stray.length) p.push(`requests outside the bundle: ${[...new Set(stray.map((q) => q.path))].slice(0, 8).join(', ')}`);
  return p;
}

/** Why a page sent no report, as runPage classifies it (_shared/browser.mjs). */
export const MISS = { exited: 'the browser exited before the page reported', 'never-requested': 'the browser never asked for the page', 'no-report': 'the page loaded and sent nothing' };

/** The row of one page that reported. `mode` is 'pinned' (/pinned.html, the pinned bytes) or 'probe' (/, the probe build). */
export function pageRow(mode, { report, wallMs, pageRequestedMs }, requests) {
  const v = report.violations ?? [];
  const common = { mode, wallMs, pageRequestedMs, stage: report.stage, mounted: report.mounted === true, engine: report.engine, sentAt: report.sentAt, watchdogMs: report.watchdogMs, phaseAt: report.phaseAt, afterAdd: report.afterAdd, afterAddSettled: report.afterAddSettled, alive: report.alive, aliveAfterUnmount: report.aliveAfterUnmount, deadHandle: report.deadHandle, fix: report.fix, pasteTrouble: report.pasteTrouble, png: report.png, violationCount: v.length, violations: aggregate(v), errors: report.errors ?? [], rejections: report.rejections ?? [], requests };
  if (mode === 'pinned') return { ...common, syntheticDraw: report.syntheticDraw };
  return { ...common, visibility: report.visibility, ms: { module: report.tModule ?? null, mounted: report.tMounted ?? null }, captureRefused: report.captureRefused, afterPointerRect: report.afterPointerRect, afterPointerStroke: report.afterPointerStroke, finalCount: report.finalCount, cursors: report.cursors, hostView: report.hostView, toolState: report.toolState, refusedTools: report.refusedTools, selectedAfterClick: report.selectedAfterClick, commandPalette: report.commandPalette, libraryDrop: report.libraryDrop, imageTool: report.imageTool, toolKeys: report.toolKeys, stockNodes: report.stockNodes, canvasFonts: report.canvasFontsEnd ?? report.canvasFonts, fontFaces: report.fontFaces, dpr: report.dpr, edge: report.edge, zoom: report.zoom, style: report.style, skin: report.skin, colours: report.colours, matrix: report.matrix, zoom400: report.zoom400, edits: report.edits, undoKeys: report.undoKeys, handleKeys: report.handleKeys, narrow: report.narrow, stateEvents: report.stateEvents, libraryTrigger: report.libraryTrigger, libraryOpen: report.libraryOpen, userAgent: report.userAgent };
}

/** The row of one page that sent no report: never clean (runProblems), and it says why (runPage's `miss`). */
export function missRow(mode, { wallMs, launcherTail, miss, exit, pageRequestedMs, lateReport }, requests) {
  const late = lateReport ? { stage: lateReport.stage, sentAt: lateReport.sentAt, phaseAt: lateReport.phaseAt, violationCount: (lateReport.violations ?? []).length, violations: aggregate(lateReport.violations ?? []) } : undefined;
  return { mode, wallMs, error: NO_REPORT, miss, exit, pageRequestedMs, launcherTail, requests, ...(late ? { lateReport: late } : {}) };
}

/**
 * Whether a page row may be retried: only a page that sent NO report (a launch failure or a missed report), and
 * never one whose late report carries a CSP row. A page that reported is never retried, whatever it reported.
 */
export function retryable(row) {
  return !!row && row.error === NO_REPORT && !(row.lateReport?.violationCount > 0);
}

/** Both pages of a run mounted (the pinned bytes and the probe build). A run with a missing page did not. */
export const runMounted = (r) => !!r && r.mounted === true && r.pinned?.mounted === true;

/** Every problem of an engine's runs, both pages of each ([] when every run is clean). */
export function engineProblems(rows, known) {
  return rows.flatMap((r, i) => [...(r.pinned ? runProblems(r.pinned, known).map((p) => `run ${i + 1} (pinned bytes): ${p}`) : [`run ${i + 1}: the pinned bytes were not run`]), ...runProblems(r, known).map((p) => `run ${i + 1} (probe build): ${p}`)]);
}

/**
 * The result's accounting of an engine's runs: a run is mounted only if BOTH its pages mounted; every page that
 * sent no report is listed (pinned or probe) with its wall time, why, and the launcher's last lines; the
 * violations of both pages and of any late report are counted.
 */
export function runAccounting(rows) {
  const pages = (r) => [r, r.pinned].filter(Boolean);
  const late = (p) => (p.lateReport ? [p.lateReport] : []);
  const all = rows.flatMap(pages);
  return {
    runs: rows.length,
    mountedRuns: rows.filter(runMounted).length,
    violationCount: all.reduce((a, p) => a + (p.violationCount ?? 0) + (p.lateReport?.violationCount ?? 0), 0),
    violatedDirectives: [...new Set(all.flatMap((p) => [p, ...late(p)]).flatMap((p) => (p.violations ?? []).map((v) => v.directive)))],
    nonReportingRuns: rows.flatMap((r, i) => pages(r).filter((p) => p.error === NO_REPORT).map((p) => ({ run: i + 1, page: p.mode === 'pinned' ? 'pinned' : 'probe', wallMs: p.wallMs, miss: p.miss ?? null, exit: p.exit ?? null, pageRequestedMs: p.pageRequestedMs ?? null, launcherTail: p.launcherTail, ...(p.lateReport ? { lateReport: { stage: p.lateReport.stage, violationCount: p.lateReport.violationCount } } : {}) }))),
  };
}

/**
 * Load the shipped board under the CSP in each picked engine, `runs` times; every run is two pages. A PAGE that
 * sends no report (a launch failure or a missed report) is retried, that page alone, at most `launchRetries` times
 * per engine; every retried attempt stays in `launchRetries` with the page it was. A page that reported is never
 * retried, and neither is one whose late report carries a CSP row, so a violation can never be retried away.
 * The page's own watchdog is set from `timeoutMs` (it reports before the host stops waiting), and a page the
 * browser never asked for within `loadDeadlineMs` is a launch failure, not a wait to the full timeout.
 * Resolves {csp, engines: {name: {version, family, runs: [...], launchRetries, clean, problems}}, missing}.
 */
export async function runBoardUnderCsp({ runs = 1, timeoutMs = 90_000, launchRetries = 1, loadDeadlineMs = 30_000, engines = null, board = shippedBoard(), probe = null } = {}) {
  // every run is TWO pages: /pinned.html on the pinned bytes (CSP rows, containment), then / on the probe build (edits)
  const files = harnessFiles(board, probe ?? (await probeBoard()));
  const known = new Set(files.keys());
  const { pick, missing } = engines ? { pick: engines, missing: {} } : pickEngines();
  const server = await startServer({ files });
  // the page's deadline sits inside the host's wait and inside the WKWebView host's own (timeout - 5 s)
  const watchdogMs = Math.max(10_000, timeoutMs - 15_000);
  const out = {};
  try {
    for (const e of pick) {
      const rows = [];
      const retried = [];
      const page = async (run, mode) => {
        for (;;) {
          const b0 = server.requests.length;
          const got = await runPage(server, e, `${mode === 'pinned' ? '/pinned.html' : '/'}?watchdog=${watchdogMs}`, timeoutMs, { loadDeadlineMs });
          const rq = server.requests.slice(b0).map((q) => ({ method: q.method, path: q.path }));
          const row = got.report ? pageRow(mode, got, rq) : missRow(mode, got, rq);
          if (!retryable(row) || retried.length >= launchRetries) return row;
          retried.push({ run, page: mode, ...row });
        }
      };
      for (let i = 0; i < runs; i++) {
        // the pinned bytes first; its row rides on the probe page's row as `pinned`
        const pinned = await page(i + 1, 'pinned');
        const r = await page(i + 1, 'probe');
        r.pinned = pinned;
        rows.push(r);
      }
      const problems = engineProblems(rows, known);
      out[e.name] = { version: e.version, family: e.family ?? e.kind, runs: rows, launchRetries: retried, clean: problems.length === 0, problems };
    }
  } finally {
    await server.close();
  }
  return { csp: gnomonCsp('<port>'), engines: out, missing };
}
