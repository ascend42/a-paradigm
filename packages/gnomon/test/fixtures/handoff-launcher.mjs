// A stub browser launcher for test/p12-browser-handoff.test.ts (T-2026-11-25-002). Run by node as
// `node handoff-launcher.mjs <mode> <the engine's own arguments...>`; the last argument is the page URL.
//   handoff         the launcher starts a "browser" with the SAME arguments (the profile among them, as a Firefox
//                   relaunch does), exits 0 at once, and the browser asks for the page at 2.5 s and reports at 3 s
//   handoff-silent  the same hand-off; the browser stays alive and never asks for anything
//   exit            the launcher exits 0 and nothing serves the page
//   browser         (internal) the handed-off browser; argv[3] is what it does: 'report' or 'silent'
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [mode, ...rest] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (mode === 'handoff' || mode === 'handoff-silent') {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'browser', mode === 'handoff' ? 'report' : 'silent', ...rest], { detached: true, stdio: 'ignore' });
  child.unref();
  await sleep(200);
  process.exit(0);
} else if (mode === 'exit') {
  await sleep(200);
  process.exit(0);
} else if (mode === 'browser') {
  const [what, ...args] = rest;
  const url = new URL(args[args.length - 1]);
  const keep = setInterval(() => {}, 1000);
  if (what === 'report') {
    await sleep(2500);
    await fetch(url).then((r) => r.text()).catch(() => null);
    await sleep(500);
    await fetch(new URL(`/report?run=${url.searchParams.get('run')}`, url), { method: 'POST', body: JSON.stringify({ stage: 'done', mounted: true, violations: [], by: 'handed-off browser' }) }).catch(() => null);
  }
  // alive until stopped (the harness must stop it), at most 120 s
  await sleep(120_000);
  clearInterval(keep);
}
