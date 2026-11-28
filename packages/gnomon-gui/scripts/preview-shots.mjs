#!/usr/bin/env node
// #gui-preview (DEV ONLY): PNGs of every fixture × theme at 1440×900.
//
//   node packages/gnomon-gui/scripts/preview-shots.mjs <out-dir> [--chrome [path]]
//
// It uses Playwright or Puppeteer when one is ALREADY installed in this repo's node_modules (none is added as a
// dependency). With neither, it says so and skips, unless --chrome is given: then it drives an installed Chrome in real
// time over the DevTools protocol (no package needed; default path is the macOS app), waiting for each fixture to say
// it is ready. `--only <fixture>` shoots one fixture. Files are <fixture>-<theme>.png.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureUrl, startPreview, THEMES } from './preview.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ROOT, '..', '..');
const W = 1440;
const H = 900;
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** Playwright or Puppeteer, if one resolves from the package or the repo root; null otherwise. */
async function findDriver() {
  for (const from of [path.join(ROOT, 'package.json'), path.join(REPO, 'package.json')]) {
    const req = createRequire(from);
    for (const name of ['playwright', 'playwright-core', 'puppeteer', 'puppeteer-core']) {
      try {
        const mod = await import(req.resolve(name));
        return { name, mod: mod.default ?? mod };
      } catch {
        /* not installed here */
      }
    }
  }
  return null;
}

async function shootWithDriver(driver, jobs) {
  const isPw = driver.name.startsWith('playwright');
  const browser = isPw ? await driver.mod.chromium.launch() : await driver.mod.launch();
  try {
    for (const j of jobs) {
      const page = isPw ? await browser.newPage({ viewport: { width: W, height: H } }) : await browser.newPage();
      if (!isPw) await page.setViewport({ width: W, height: H });
      await page.goto(j.url);
      await page.waitForSelector('html[data-preview="ready"]', { timeout: 15_000 });
      await page.screenshot({ path: j.file });
      await page.close();
      process.stdout.write(`✓ ${path.basename(j.file)}\n`);
    }
  } finally {
    await browser.close();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const READY_TIMEOUT_MS = 30_000;

/**
 * One fixture in an installed Chrome, in REAL time, over the DevTools protocol (Node's own WebSocket; no package):
 * wait for <html data-preview="ready">, then capture. Chrome's `--screenshot --virtual-time-budget` is not used:
 * under virtual time the board fixture never finished mounting (measured 2026-11-24: an empty board in the PNG and
 * no `board ready` row), so its shots showed a board that was not there.
 */
async function shootOneWithChrome(bin, job) {
  const profile = mkdtempSync(path.join(os.tmpdir(), 'gnomon-preview-'));
  const chrome = spawn(bin, ['--headless=new', '--disable-gpu', `--user-data-dir=${profile}`, `--window-size=${W},${H}`, '--hide-scrollbars', '--remote-debugging-port=0', job.url], { stdio: 'ignore' });
  let ws = null;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
    if (!existsSync(portFile)) return 'chrome did not open its DevTools port';
    const port = readFileSync(portFile, 'utf8').split(/\r?\n/)[0];
    let page = null;
    for (let i = 0; i < 50 && !page; i++) {
      page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page') ?? null;
      if (!page) await sleep(100);
    }
    if (!page) return 'chrome opened no page';
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('DevTools socket refused')), { once: true });
    });
    let id = 0;
    const call = (method, params = {}) =>
      new Promise((res) => {
        const mine = ++id;
        const on = (e) => {
          const m = JSON.parse(e.data);
          if (m.id !== mine) return;
          ws.removeEventListener('message', on);
          res(m.result ?? {});
        };
        ws.addEventListener('message', on);
        ws.send(JSON.stringify({ id: mine, method, params }));
      });
    const until = Date.now() + READY_TIMEOUT_MS;
    let ready = false;
    while (!ready && Date.now() < until) {
      const r = await call('Runtime.evaluate', { expression: 'document.documentElement.dataset.preview === "ready"', returnByValue: true });
      ready = r.result?.value === true;
      if (!ready) await sleep(100);
    }
    if (!ready) return 'the fixture never set data-preview="ready"';
    await sleep(250); // one settled paint after ready (fonts swapped in, the board's canvases drawn)
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    if (!shot.data) return 'no screenshot data';
    writeFileSync(job.file, Buffer.from(shot.data, 'base64'));
    return null;
  } catch (e) {
    return String(e?.message ?? e);
  } finally {
    try {
      ws?.close();
    } catch {
      /* already closed */
    }
    chrome.kill();
    await sleep(200);
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  }
}

async function shootWithChrome(bin, jobs) {
  for (const j of jobs) {
    const problem = await shootOneWithChrome(bin, j);
    process.stdout.write(problem === null ? `✓ ${path.basename(j.file)}\n` : `✕ ${path.basename(j.file)} (${problem})\n`);
  }
}

const args = process.argv.slice(2);
const ci = args.indexOf('--chrome');
const chrome = ci >= 0 ? (args[ci + 1] && !args[ci + 1].startsWith('--') ? args[ci + 1] : MAC_CHROME) : null;
const oi = args.indexOf('--only');
const only = oi >= 0 ? args[oi + 1] : null;
const out = args.find((a, i) => !a.startsWith('--') && !(ci >= 0 && i === ci + 1) && !(oi >= 0 && i === oi + 1));
if (!out) {
  process.stderr.write('✕ usage: preview-shots.mjs <out-dir> [--chrome [path]]\n');
  process.exit(2);
}
const driver = await findDriver();
if (!driver && !chrome) {
  process.stdout.write('• no Playwright or Puppeteer in node_modules: screenshots skipped (no dependency is added).\n  Run scripts/preview.mjs and capture by hand, or pass --chrome to use an installed Chrome.\n');
  process.exit(0);
}
mkdirSync(out, { recursive: true });
const p = await startPreview({ port: 0 });
try {
  const jobs = p.list.filter((f) => !only || f.name === only).flatMap((f) => THEMES.map((t) => ({ url: fixtureUrl(p.url, f.name, t, 'off'), file: path.resolve(out, `${f.name}-${t}.png`) })));
  if (driver) await shootWithDriver(driver, jobs);
  else await shootWithChrome(chrome, jobs);
} finally {
  await p.close();
}
