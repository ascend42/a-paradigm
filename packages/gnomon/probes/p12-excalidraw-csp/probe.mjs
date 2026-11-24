// p12-excalidraw-csp — Arky P12 (spec §19.1 M1.0 P12, §11.2 rule 6, §12.7; boards S1.0, oracle G-DDL-06).
// Claim: the SHIPPED Gnomon board chunk — Excalidraw 0.18.1 and React, patched and pruned at build time
// (packages/gnomon-gui/scripts/board-patches.mjs) — loads, draws and exports a PNG under the §11.2 CSP with ZERO
// refusals of any directive: script-src 'self' with no 'unsafe-eval' and no 'wasm-unsafe-eval', no inline script
// or style, img-src without data:, font-src 'self', connect-src loopback only. And what it costs (bytes, load).
//
// Method (ZERO deps, no install, no build: it runs on a fresh checkout):
//   1. Decode the `board/*` files from the kernel's pinned embed (src/kernel/web/gui-bundle.ts): the exact bytes
//      the web endpoint serves. Nothing is bundled here and nothing comes from npm.
//   2. Static scan of those bytes: eval / new Function / WebAssembly / external hosts / fetch / data: URLs / maps.
//   3. Serve them from the probe's loopback server with the rule 6 headers verbatim (_shared/browser.mjs) beside a
//      page that does what a board open does (harness.mjs): <link> the stylesheet, import() board.js from a classic
//      script, mount, draw through the handle and with pointer events, select every tool (their cursors), select a
//      mark and reach for the stock Library (it must not exist), export a PNG, and POST every
//      securitypolicyviolation event, error and what it drew. RUNS cold loads per local engine.
// Verdict: fail if the static scan finds anything, or any engine that ran did not mount, raised any CSP violation,
// asked for anything outside the bundle or could not draw or export; pass if every engine is clean and the
// required ones ran (a Chromium-family browser, and WKWebView on a Mac: the two the oracle names); fail on a Mac with
// no WKWebView row; partial when the Chromium-family browser is missing, and on non-darwin hosts (mechanics only,
// Windows parity phase).
// History: until boards S1.0 this probe bundled the stock engine in a temp dir and recorded what the CSP refused
// (results before 2026-11-23: 230 esm.sh font loads, eval in the font subsetter, 4 data: images, 1 inline style).
// Launch flake (T-2026-10-31-001; T-2026-11-06-003 for WKWebView, fixed in _shared/wkwebview-load.swift): a run whose
// browser sends NO report never loaded the page; it is retried ONCE per engine and both attempts stay in the
// evidence. A run that reported is never retried.
import { gnomonCsp } from '../_shared/browser.mjs';
import { NO_REPORT, runBoardUnderCsp, shippedBoard, staticScan } from './harness.mjs';

export const specRefs = ['§11.2 rule 6', '§12.7', '§19.1 M1.0 P12', 'OPEN 12', 'G-WEB-06', 'G-DDL-06', 'S25-M3'];

const RUNS = Number(process.env.P12_RUNS ?? 3);

const median = (xs) => {
  const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};

export default async function probe(ctx) {
  let board;
  try {
    board = shippedBoard();
  } catch (e) {
    return { verdict: 'fail', evidence: { blocked: 'could not read the pinned GUI embed', error: String(e.message).slice(0, 800) } };
  }
  if (!board.has('board/board.js') || !board.has('board/board.css')) return { verdict: 'fail', evidence: { blocked: 'the pinned GUI embed carries no board chunk', files: [...board.keys()] } };
  const scan = staticScan(board);
  const out = await runBoardUnderCsp({ runs: RUNS, timeoutMs: 90_000, launchRetries: 1, board });

  const engines = {};
  for (const [name, e] of Object.entries(out.engines)) {
    const ok = e.runs.filter((r) => r.mounted);
    engines[name] = {
      version: e.version,
      family: e.family,
      runs: e.runs.length,
      mountedRuns: ok.length,
      clean: e.clean,
      problems: e.problems,
      violationCount: e.runs.reduce((a, r) => a + (r.violationCount ?? 0), 0),
      violatedDirectives: [...new Set(e.runs.flatMap((r) => (r.violations ?? []).map((v) => v.directive)))],
      exportPng: ok.length > 0 && ok.every((r) => r.png?.ok),
      medianMs: { module: median(ok.map((r) => r.ms.module)), mounted: median(ok.map((r) => r.ms.mounted)) },
      firstRun: e.runs[0],
      nonReportingRuns: e.runs.map((r, i) => ({ run: i + 1, r })).filter(({ r }) => r.error === NO_REPORT).map(({ run, r }) => ({ run, wallMs: r.wallMs, launcherTail: r.launcherTail })),
      launchRetries: e.launchRetries,
    };
  }
  const rows = Object.values(engines);
  const families = new Set(rows.map((r) => r.family));
  const required = ['chromium', ...(ctx.platform === 'darwin' ? ['wkwebview'] : [])];
  const missingRequired = required.filter((f) => !families.has(f));
  const clean = rows.length > 0 && rows.every((r) => r.clean) && scan.findings.length === 0;
  const findings = [];
  if (scan.findings.length) findings.push(`static: ${scan.findings.map((f) => `${f.rule} x${f.count} in ${f.file}`).join('; ')}`);
  for (const [n, r] of Object.entries(engines)) if (!r.clean) findings.push(`${n}: ${r.problems.join(' | ')}`);
  if (missingRequired.length) findings.push(`required engine(s) not on this machine: ${missingRequired.join(', ')}`);

  // On a Mac the WKWebView row is the claim (the wrapper's engine): without it the probe FAILS, on CI too. A missing
  // Chromium-family browser stays partial.
  const noWebKit = ctx.platform === 'darwin' && !families.has('wkwebview');
  let verdict = !clean || noWebKit ? 'fail' : missingRequired.length ? 'partial' : 'pass';
  if (ctx.platform !== 'darwin' && verdict === 'pass') verdict = 'partial';

  return {
    verdict,
    evidence: {
      claim: 'the shipped board chunk loads, draws and exports PNG under the unchanged CSP with zero refusals',
      csp: gnomonCsp('<port>'),
      source: 'board/* decoded from packages/gnomon/src/kernel/web/gui-bundle.ts (the pinned embed)',
      size: { files: scan.files, totalBytes: scan.totalBytes, totalGzip: scan.totalGzip },
      staticFindings: scan.findings,
      engines,
      enginesUnavailable: out.missing,
      requiredEngines: required,
      clean,
      findings,
      ...(ctx.platform !== 'darwin' ? { platformNote: `${ctx.platform}: mechanics only (Windows parity phase, P8-D78)` } : {}),
    },
    toolVersions: { excalidraw: rows[0]?.firstRun?.engine?.replace(/^.*@/, '') ?? 'unknown', ...Object.fromEntries(Object.entries(engines).map(([n, r]) => [n, String(r.version)])) },
  };
}
