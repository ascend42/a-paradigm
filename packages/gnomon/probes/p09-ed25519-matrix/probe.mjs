// p09-ed25519-matrix — Arky P09 (spec §19.1 M1.0 P09, §11.1 renderer, OPEN 8).
// The GUI verifies the kernel's `serverSig` with WebCrypto Ed25519 and pins the
// kernel key from the launch fragment as SPKI. This probe runs one test body
// (ed25519-test.js: generate, sign, verify, forged signature + forged message
// rejected, SPKI round trip, the RFC 8032 §7.1 TEST 2 vector (gating), and —
// recorded, not gating — strict S < L and the empty-message TEST 1) in:
//   - Node's WebCrypto (baseline),
//   - every engine found locally, each loading a page served from the probe's
//     own loopback server under the exact §11.2 rule 6 CSP (no unsafe-eval,
//     no inline script); engines: see _shared/browser.mjs,
//   - real Safari by hand: safari.html (self-contained). The founder pastes the
//     line it prints into P09_SAFARI_LINE to have it recorded on a re-run.
// Playwright is not used: it is not installed in this repo, and adding it would
// put a dependency in a workspace. Engines are driven by "open URL" only.
// Verdict: fail if any engine run (or Node) fails the gating checks; pass only
// when the whole mac matrix ran (Chromium, Edge, Firefox, WKWebView, Safari by
// hand); otherwise partial with the missing rows named. Non-darwin: whatever
// runs is recorded and the verdict is partial (Windows parity phase, P8-D78).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { findEngines, runPage, startServer } from '../_shared/browser.mjs';
import { renderSafariHtml } from './make-safari-html.mjs';

export const specRefs = ['§11.1 renderer', '§11.2 rule 2', '§11.2 rule 6', '§4.9 serverSig', '§19.1 M1.0 P09', 'OPEN 8', 'G-GUI-03'];

const MAC_MATRIX = ['chromium', 'edge', 'firefox', 'wkwebview', 'safari-by-hand'];

export default async function probe(ctx) {
  const dir = ctx.probeDir;
  const read = (f) => readFileSync(path.join(dir, f));
  const testSrc = read('ed25519-test.js').toString();

  // Node baseline (same body, evaluated by Node's vm — never in a page).
  vm.runInThisContext(testSrc, { filename: 'ed25519-test.js' });
  const node = await globalThis.p09Ed25519Test();

  // Content drift only: a Windows checkout (core.autocrlf) hands safari.html and
  // ed25519-test.js over with CRLF, which is not drift (run 39091956873: every
  // engine passed on win32 yet the verdict failed on this check alone).
  const lf = (s) => s.replace(/\r\n/g, '\n');
  const safariHtmlInSync = lf(read('safari.html').toString()) === lf(renderSafariHtml());

  const { engines, missing } = findEngines();
  const server = await startServer({
    files: new Map([
      ['/index.html', read('index.html')],
      ['/ed25519-test.js', testSrc],
      ['/page.js', read('page.js')],
    ]),
  });
  const runs = {};
  try {
    for (const e of engines) {
      const { report, wallMs, launcherTail } = await runPage(server, e, '/', 60_000);
      runs[e.name] = report
        ? { version: e.version, ok: report.result?.ok === true, line: report.result?.line, result: report.result, userAgent: report.userAgent, wallMs }
        : { version: e.version, ok: false, error: 'no report within 60 s', launcherTail, wallMs };
    }
  } finally {
    await server.close();
  }

  const safariLine = process.env.P09_SAFARI_LINE?.trim() || null;
  const safari = safariLine
    ? { line: safariLine, ok: /\bPASS\b/.test(safariLine) && safariLine.startsWith('ed25519 ✓ verify · ✕ forged'), source: 'P09_SAFARI_LINE (pasted by the founder from safari.html)' }
    : { pending: 'founder: open packages/gnomon/probes/p09-ed25519-matrix/safari.html in Safari, then re-run with P09_SAFARI_LINE="<line>"' };

  const covered = new Set();
  for (const [name, r] of Object.entries(runs)) {
    if (!r.result) continue;
    if (['chrome', 'chrome-testing', 'headless-shell'].includes(name)) covered.add('chromium');
    else covered.add(name);
  }
  if (safariLine) covered.add('safari-by-hand');
  const notCovered = MAC_MATRIX.filter((m) => !covered.has(m));
  const anyFail = !node.ok || Object.values(runs).some((r) => !r.ok) || (safariLine && !safari.ok) || !safariHtmlInSync;
  const verdict = anyFail ? 'fail' : ctx.platform === 'darwin' && notCovered.length === 0 ? 'pass' : 'partial';

  const emptyMessageBroken = Object.entries(runs)
    .filter(([, r]) => r.result && (r.result.ownKeyEmptyMessage === false || r.result.rfc8032EmptyMessage === false))
    .map(([n, r]) => `${n} (${r.version}): ownKey=${r.result.ownKeyEmptyMessage}, rfc8032Test1=${r.result.rfc8032EmptyMessage}`);
  const laxS = Object.entries(runs).filter(([, r]) => r.result && r.result.nonCanonicalSRejected === false).map(([n]) => n);
  const findings = [];
  if (emptyMessageBroken.length) {
    findings.push(`Ed25519 verify over an EMPTY message returns false in: ${emptyMessageBroken.join('; ')}. Not gating: every Gnomon preimage (gnomon:auth-server:v1 + nonce + path …) is non-empty; the kernel must never sign an empty preimage for a page to verify.`);
  }
  if (laxS.length) findings.push(`non-canonical S (S+L) accepted by: ${laxS.join(', ')} — malleable signatures; serverSig is never used as an identifier, so informational.`);

  const toolVersions = Object.fromEntries(Object.entries(runs).map(([n, r]) => [n, String(r.version)]));
  return {
    verdict,
    evidence: {
      node: { ok: node.ok, line: node.line, result: node },
      engines: runs,
      enginesUnavailable: missing,
      safariByHand: safari,
      safariHtmlInSync,
      macMatrix: { required: MAC_MATRIX, covered: [...covered], notCovered },
      findings,
      csp: 'served under the §11.2 rule 6 CSP (script-src \'self\', no unsafe-eval, no inline script)',
      ...(ctx.platform !== 'darwin' ? { platformNote: `${ctx.platform}: Windows half (WebView2, Edge on Windows) is the Windows parity phase (P8-D78); recorded runs are mechanics only` } : {}),
      method: 'one test body (ed25519-test.js) in Node vm, in each engine via a page POSTing to the probe server, and inlined in safari.html',
    },
    toolVersions,
  };
}
