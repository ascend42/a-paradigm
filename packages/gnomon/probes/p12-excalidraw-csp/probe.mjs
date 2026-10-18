// p12-excalidraw-csp — Arky P12 (spec §19.1 M1.0 P12, §11.2 rule 6, §12.7, OPEN 12).
// Claim: a self-hosted Excalidraw bundle loads under the §11.2 CSP — script-src
// 'self' with NO 'unsafe-eval' (and no 'wasm-unsafe-eval'), no inline script,
// font-src 'self', connect-src loopback only — and what it costs (size, parse).
//
// Method (nothing here is committed except this file):
//   1. Install the PINNED packages below into a temp dir (npm, --ignore-scripts),
//      cached across runs by pin hash.
//   2. Bundle a tiny app with the pinned esbuild exactly as the GUI would ship it:
//      ESM + code splitting, minified, production conditions; copy Excalidraw's
//      self-contained font-subset worker chunks and fonts/ beside it, and set
//      EXCALIDRAW_ASSET_PATH = '/' from an external classic script (no inline
//      script anywhere), so no asset is fetched from esm.sh.
//   3. Serve it from the probe's loopback server with the §11.2 rule 6 headers
//      verbatim (_shared/browser.mjs) and load it cold in each local engine,
//      RUNS times. The page mounts <Excalidraw/>, adds a rectangle and a text
//      element through the API, exports PNG (canvas) and SVG (font subsetting:
//      a wasm module in a worker), and POSTs timings, every
//      securitypolicyviolation event, errors and resource timings back.
//   4. Static scan of every served .js for eval / new Function / WebAssembly.
// Timings: tFirstModule = the first module in the graph evaluates (external
// /mark.js, imported first by the entry) — the whole static graph has been
// fetched, parsed and linked by then; parse ≈ tFirstModule − last static script
// responseEnd. tMounted = Excalidraw's canvas is in the DOM.
// Verdict: fail if the page does not mount or any load-time script/eval
// violation fires; partial if load is clean but the export path is refused by
// the CSP (or an engine row is missing); pass if all clean.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { findEngines, gnomonCsp, runPage, startServer } from '../_shared/browser.mjs';

export const specRefs = ['§11.2 rule 6', '§12.7', '§19.1 M1.0 P12', 'OPEN 12', 'G-WEB-06', 'S25-M3'];

const PINS = { '@excalidraw/excalidraw': '0.18.1', react: '19.3.1', 'react-dom': '19.3.1', esbuild: '0.28.2' };
const RUNS = Number(process.env.P12_RUNS ?? 3);
// Excalidraw's dist/prod chunks that the font-subset worker loads by relative
// URL at runtime; they have no bare imports, so they are served as-is.
const WORKER_CHUNKS = /^(subset-worker\.chunk\.js|subset-shared\.chunk\.js|chunk-[A-Z0-9]+\.js)$/;

const ENTRY = `import '/mark.js';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, exportToSvg, exportToBlob, convertToExcalidrawElements } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
const R = window.__p12;
R.tEntry = performance.now();
R.phase = 'load';
let api = null;
const h = React.createElement;
createRoot(document.getElementById('root')).render(
  h('div', { style: { height: '800px', width: '1280px' } }, h(Excalidraw, { excalidrawAPI: (a) => { api = a; } })),
);
const until = (pred, ms) => new Promise((res) => {
  const t0 = performance.now();
  (function poll() { if (pred()) return res(true); if (performance.now() - t0 > ms) return res(false); setTimeout(poll, 25); })();
});
(async () => {
  try {
    R.mounted = await until(() => api && document.querySelector('canvas'), 30000);
    R.tMounted = performance.now();
    R.phase = 'scene';
    if (!R.mounted) return R.send('mount-timeout');
    api.updateScene({ elements: convertToExcalidrawElements([
      { type: 'rectangle', x: 40, y: 40, width: 160, height: 80 },
      { type: 'text', x: 60, y: 160, text: 'gnomon p12 ✓' },
    ]) });
    R.sceneElements = api.getSceneElements().length;
    R.tScene = performance.now();
    const args = { elements: api.getSceneElements(), appState: { ...api.getAppState(), exportBackground: true }, files: api.getFiles() };
    try {
      const t = performance.now();
      R.phase = 'export-png';
      const blob = await exportToBlob({ ...args, mimeType: 'image/png' });
      R.png = { ok: true, bytes: blob.size, ms: Math.round(performance.now() - t) };
    } catch (e) { R.png = { ok: false, error: String(e && e.stack || e).slice(0, 400) }; }
    try {
      const t = performance.now();
      R.phase = 'export-svg';
      const svg = await exportToSvg(args);
      const text = svg.outerHTML;
      R.svg = { ok: true, chars: text.length, fontFace: /@font-face/.test(text), ms: Math.round(performance.now() - t) };
    } catch (e) { R.svg = { ok: false, error: String(e && e.stack || e).slice(0, 400) }; }
    R.phase = 'settle';
    await new Promise((r) => setTimeout(r, 1500)); // late violations (workers, lazy chunks)
    R.send('done');
  } catch (e) {
    R.errors.push('driver: ' + String(e && e.stack || e).slice(0, 400));
    R.send('driver-error');
  }
})();
`;

const BOOT = `window.EXCALIDRAW_ASSET_PATH = '/';
(function () {
  var R = window.__p12 = { t0: performance.now(), violations: [], errors: [], rejections: [], sent: false };
  document.addEventListener('securitypolicyviolation', function (e) {
    R.violations.push({ directive: e.effectiveDirective || e.violatedDirective, blockedURI: e.blockedURI, sourceFile: e.sourceFile, line: e.lineNumber, sample: (e.sample || '').slice(0, 80), at: Math.round(performance.now()), phase: R.phase || 'boot' });
  });
  window.addEventListener('error', function (e) { R.errors.push(String(e.message).slice(0, 300) + ' @' + e.filename + ':' + e.lineno); });
  window.addEventListener('unhandledrejection', function (e) { R.rejections.push(String(e.reason && (e.reason.stack || e.reason)).slice(0, 400)); });
  R.send = function (stage) {
    if (R.sent) return; R.sent = true; R.stage = stage;
    R.resources = performance.getEntriesByType('resource').map(function (r) {
      return { path: new URL(r.name).pathname, type: r.initiatorType, start: Math.round(r.startTime), responseEnd: Math.round(r.responseEnd), bytes: r.decodedBodySize };
    });
    R.userAgent = navigator.userAgent;
    var run = new URLSearchParams(location.search).get('run') || '';
    fetch('/report?run=' + encodeURIComponent(run), { method: 'POST', body: JSON.stringify(R) });
  };
  setTimeout(function () { R.send('watchdog'); }, 45000);
})();
`;

const MARK = 'window.__p12.tFirstModule = performance.now();\n';

const INDEX = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>p12 excalidraw csp</title>
<link rel="stylesheet" href="/entry.css">
<script src="/boot.js"></script>
<script type="module" src="/entry.js"></script>
</head>
<body><div id="root"></div></body>
</html>
`;

function npm(args, cwd) {
  const bin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return execFileSync(bin, args, { cwd, encoding: 'utf8', timeout: 600_000, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
}

function prepare() {
  const pinHash = createHash('sha256').update(JSON.stringify(PINS)).digest('hex').slice(0, 12);
  const work = path.join(os.tmpdir(), `gnomon-p12-${pinHash}`);
  const timings = {};
  if (!existsSync(path.join(work, 'node_modules/@excalidraw/excalidraw/package.json'))) {
    mkdirSync(work, { recursive: true });
    writeFileSync(path.join(work, 'package.json'), JSON.stringify({ name: 'gnomon-p12-tmp', private: true, dependencies: PINS }, null, 2));
    const t = Date.now();
    npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock'], work);
    timings.npmInstallMs = Date.now() - t;
  } else timings.npmInstallMs = 'cached';
  const out = path.join(work, 'out');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(work, 'entry.jsx'), ENTRY);
  const esbuild = path.join(work, 'node_modules/esbuild/bin/esbuild');
  const t = Date.now();
  const log = execFileSync(process.execPath, [esbuild, 'entry.jsx', '--bundle', '--format=esm', '--splitting', '--minify',
    '--outdir=out', '--entry-names=[name]', '--chunk-names=c-[hash]', '--asset-names=a-[hash]', '--external:/mark.js',
    '--define:process.env.NODE_ENV="production"', '--conditions=production', '--jsx=automatic', '--target=es2022',
    '--loader:.woff2=file', '--loader:.png=file', '--loader:.svg=file', '--log-level=warning'], { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  timings.esbuildMs = Date.now() - t;
  const dist = path.join(work, 'node_modules/@excalidraw/excalidraw/dist/prod');
  const copied = [];
  // Copy the worker entry chunks and their relative-import closure only.
  const queue = readdirSync(dist).filter((f) => /^subset-(worker|shared)\.chunk\.js$/.test(f));
  while (queue.length) {
    const f = queue.shift();
    if (copied.includes(f) || !WORKER_CHUNKS.test(f)) continue;
    const src = readFileSync(path.join(dist, f), 'utf8');
    if (/(?:from|import)\s*"(?!\.\/)[^"]+"/.test(src)) throw new Error(`${f} has a bare import; cannot serve as-is`);
    copyFileSync(path.join(dist, f), path.join(out, f));
    copied.push(f);
    for (const m of src.matchAll(/(?:from|import)\s*"\.\/([^"]+)"/g)) queue.push(m[1]);
  }
  cpSync(path.join(dist, 'fonts'), path.join(out, 'fonts'), { recursive: true });
  writeFileSync(path.join(out, 'index.html'), INDEX);
  writeFileSync(path.join(out, 'boot.js'), BOOT);
  writeFileSync(path.join(out, 'mark.js'), MARK);
  return { work, out, timings, copiedWorkerChunks: copied, esbuildLog: log.trim().slice(0, 1000) };
}

function walk(dir, base = dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  });
}

function staticScan(out) {
  const files = walk(out);
  const js = {};
  let total = 0;
  let totalGz = 0;
  let fonts = 0;
  for (const f of files) {
    const buf = readFileSync(path.join(out, f));
    if (f.startsWith('fonts/')) {
      fonts += buf.length;
      continue;
    }
    total += buf.length;
    const gz = gzipSync(buf).length;
    totalGz += gz;
    if (!f.endsWith('.js')) continue;
    const s = buf.toString('utf8');
    const count = (re) => (s.match(re) ?? []).length;
    js[`/${f}`] = {
      bytes: buf.length,
      gzip: gz,
      newFunction: count(/new Function\s*\(/g),
      evalCall: count(/(^|[^.\w$])eval\s*\(/g),
      wasmInstantiate: count(/WebAssembly\.(instantiate|instantiateStreaming|compile|compileStreaming)\b/g),
    };
  }
  return { js, allNonFontBytes: total, allNonFontGzip: totalGz, fontBytes: fonts, files: files.length };
}

// Collapse violation events to {directive, blocked, source, phase} x count.
function aggregate(violations) {
  const m = new Map();
  for (const v of violations) {
    let blocked = v.blockedURI || '(none)';
    try {
      const u = new URL(blocked);
      if (u.origin !== 'null') blocked = `${u.origin}${u.pathname.split('/').slice(0, 4).join('/')}…`;
    } catch {
      // 'inline', 'eval', 'wasm-eval', 'data' — kept as-is
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
  return [...m.values()].sort((x, y) => y.count - x.count);
}

const CLAIM_DIRECTIVES = new Set(['script-src', 'script-src-elem', 'script-src-attr', 'worker-src']);

function summarize(rep, scan, served = []) {
  if (!rep) return null;
  const v = rep.violations ?? [];
  const claim = v.filter((x) => CLAIM_DIRECTIVES.has(x.directive));
  return { ...summarizeBase(rep, scan), fontsServedLocally: served.filter((r) => r.path.startsWith('/fonts/')).length,
    violationCount: v.length, violations: aggregate(v), claimViolations: claim.length,
    loadPhaseClaimViolations: claim.filter((x) => x.phase === 'load' || x.phase === 'boot').length };
}

function summarizeBase(rep, scan) {
  const staticScripts = (rep.resources ?? []).filter((r) => r.path.endsWith('.js') && r.responseEnd <= (rep.tFirstModule ?? Infinity) && r.type !== 'fetch');
  const lastStatic = Math.max(0, ...staticScripts.map((r) => r.responseEnd));
  const initialBytes = staticScripts.reduce((a, r) => a + (scan.js[r.path]?.bytes ?? 0), 0);
  const initialGzip = staticScripts.reduce((a, r) => a + (scan.js[r.path]?.gzip ?? 0), 0);
  return {
    stage: rep.stage,
    mounted: rep.mounted === true,
    sceneElements: rep.sceneElements,
    ms: {
      firstModule: rep.tFirstModule != null ? Math.round(rep.tFirstModule - rep.t0) : null,
      parseLinkAfterLastStaticScript: rep.tFirstModule != null ? Math.round(rep.tFirstModule - lastStatic) : null,
      entryEval: rep.tEntry != null && rep.tFirstModule != null ? Math.round(rep.tEntry - rep.tFirstModule) : null,
      mounted: rep.tMounted != null ? Math.round(rep.tMounted - rep.t0) : null,
    },
    initialStaticScripts: staticScripts.map((r) => r.path),
    initialBytes,
    initialGzip,
    png: rep.png,
    svg: rep.svg,
    errors: rep.errors,
    rejections: rep.rejections,
    lazyResources: (rep.resources ?? []).filter((r) => r.responseEnd > (rep.tFirstModule ?? Infinity)).map((r) => `${r.path} (${r.type})`),
    userAgent: rep.userAgent,
  };
}

const median = (xs) => {
  const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};

export default async function probe(ctx) {
  let prep;
  try {
    prep = prepare();
  } catch (e) {
    return { verdict: 'partial', evidence: { blocked: 'could not install/bundle the pinned packages (network or npm missing?)', pins: PINS, error: String(e.stderr ?? e.message).slice(0, 1500) } };
  }
  const scan = staticScan(prep.out);
  const { engines, missing } = findEngines();
  // One engine per family: Chromium (prefer stable Chrome), Firefox, WKWebView, Edge.
  const pick = [];
  const chromium = ['chrome', 'chrome-testing', 'headless-shell'].map((n) => engines.find((e) => e.name === n)).find(Boolean);
  if (chromium) pick.push(chromium);
  for (const n of ['edge', 'firefox', 'wkwebview']) {
    const e = engines.find((x) => x.name === n);
    if (e) pick.push(e);
  }
  const server = await startServer({ rootDir: prep.out });
  const perEngine = {};
  try {
    for (const e of pick) {
      const runs = [];
      for (let i = 0; i < RUNS; i++) {
        const before = server.requests.length;
        const { report, wallMs, launcherTail } = await runPage(server, e, '/', 90_000);
        const served = server.requests.slice(before);
        runs.push(report ? { wallMs, ...summarize(report, scan, served) } : { wallMs, error: 'no report within 90 s', launcherTail });
      }
      const ok = runs.filter((r) => r.mounted);
      const directives = [...new Set(runs.flatMap((r) => (r.violations ?? []).map((v) => v.directive)))];
      perEngine[e.name] = {
        version: e.version,
        runs: runs.length,
        mountedRuns: ok.length,
        medianMs: {
          firstModule: median(ok.map((r) => r.ms.firstModule)),
          parseLinkAfterLastStaticScript: median(ok.map((r) => r.ms.parseLinkAfterLastStaticScript)),
          mounted: median(ok.map((r) => r.ms.mounted)),
        },
        violationCount: runs.reduce((a, r) => a + (r.violationCount ?? 0), 0),
        claimViolationCount: runs.reduce((a, r) => a + (r.claimViolations ?? 0), 0),
        loadPhaseClaimViolationCount: runs.reduce((a, r) => a + (r.loadPhaseClaimViolations ?? 0), 0),
        violatedDirectives: directives,
        exportPng: ok.every((r) => r.png?.ok),
        exportSvg: ok.every((r) => r.svg?.ok),
        firstRun: runs[0],
      };
    }
  } finally {
    await server.close();
  }

  const rows = Object.values(perEngine);
  // The claim: mounts with no script/eval refusal while loading. Everything else
  // (export path, img-src data:, font fallback, style attributes) is recorded.
  const loadClean = rows.length > 0 && rows.every((r) => r.mountedRuns === r.runs && r.loadPhaseClaimViolationCount === 0);
  const exportClean = rows.every((r) => r.violationCount === 0 && r.exportPng && r.exportSvg);
  const evalSites = Object.entries(scan.js).filter(([, v]) => v.newFunction || v.evalCall || v.wasmInstantiate).map(([f, v]) => ({ file: f, ...v }));
  const findings = [];
  if (evalSites.length) findings.push(`static: ${evalSites.length} served file(s) contain new Function / eval / WebAssembly instantiation (Excalidraw's Emscripten font-subset glue); runtime behaviour under the CSP is in engines.*`);
  for (const [n, r] of Object.entries(perEngine)) {
    if (r.violatedDirectives.length) findings.push(`${n}: CSP refused ${r.violatedDirectives.join(', ')} (${r.violationCount} events over ${r.runs} runs; script/worker: ${r.claimViolationCount}, of which while loading: ${r.loadPhaseClaimViolationCount}); PNG export ${r.exportPng ? 'ok' : 'FAILED'}, SVG export ${r.exportSvg ? 'ok' : 'FAILED'}`);
  }
  let verdict = !loadClean ? 'fail' : exportClean && !missing.firefox && (ctx.platform !== 'darwin' || perEngine.wkwebview) ? 'pass' : 'partial';
  if (ctx.platform !== 'darwin' && verdict === 'pass') verdict = 'partial';

  return {
    verdict,
    evidence: {
      pins: PINS,
      csp: gnomonCsp('<port>'),
      build: { ...prep.timings, copiedWorkerChunks: prep.copiedWorkerChunks, esbuildWarnings: prep.esbuildLog || null, tempDir: prep.work.replace(os.homedir(), '~') },
      size: {
        allNonFontBytes: scan.allNonFontBytes,
        allNonFontGzip: scan.allNonFontGzip,
        fontBytes: scan.fontBytes,
        servedFiles: scan.files,
        js: scan.js,
      },
      evalSites,
      engines: perEngine,
      enginesUnavailable: missing,
      loadClean,
      exportClean,
      findings,
      ...(ctx.platform !== 'darwin' ? { platformNote: `${ctx.platform}: mechanics only (Windows parity phase, P8-D78)` } : {}),
    },
    toolVersions: { excalidraw: PINS['@excalidraw/excalidraw'], react: PINS.react, esbuild: PINS.esbuild, ...Object.fromEntries(Object.entries(perEngine).map(([n, r]) => [n, String(r.version)])) },
  };
}
