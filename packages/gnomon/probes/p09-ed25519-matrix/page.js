// p09 engine page script (served as /page.js under the §11.2 CSP). Runs the
// shared test, shows the line, and POSTs the report to the probe's server.
(async function () {
  var run = new URLSearchParams(location.search).get('run') || '';
  var report = { userAgent: navigator.userAgent, origin: location.origin };
  try {
    report.result = await globalThis.p09Ed25519Test();
  } catch (e) {
    report.result = { ok: false, error: String(e) };
  }
  document.getElementById('line').textContent = report.result.line || '';
  fetch('/report?run=' + encodeURIComponent(run), { method: 'POST', body: JSON.stringify(report) });
})();
