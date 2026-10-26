#!/usr/bin/env node
// #gui-preview (DEV ONLY): PNGs of every fixture × theme at 1440×900.
//
//   node packages/gnomon-gui/scripts/preview-shots.mjs <out-dir> [--chrome [path]]
//
// It uses Playwright or Puppeteer when one is ALREADY installed in this repo's node_modules (none is added as a
// dependency). With neither, it says so and skips, unless --chrome is given: then it drives an installed Chrome's own
// headless `--screenshot` (no package needed; default path is the macOS app). Files are <fixture>-<theme>.png.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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

/** One headless Chrome run (async: the preview server runs in this same process and must keep answering). */
const runChrome = (bin, argv) =>
  new Promise((resolve) => {
    const c = spawn(bin, argv, { stdio: 'ignore' });
    const t = setTimeout(() => c.kill(), 60_000);
    c.on('error', () => resolve(-1));
    c.on('exit', (code) => {
      clearTimeout(t);
      resolve(code);
    });
  });

async function shootWithChrome(bin, jobs) {
  for (const j of jobs) {
    const profile = mkdtempSync(path.join(os.tmpdir(), 'gnomon-preview-'));
    try {
      // MacAppCodeSignClone off: Chrome's per-launch ~1 GB app-bundle copy leaks when a run is killed (crbug.com/379125944)
      const code = await runChrome(bin, ['--headless=new', '--disable-features=MacAppCodeSignClone', '--disable-gpu', `--user-data-dir=${profile}`, `--window-size=${W},${H}`, '--hide-scrollbars', '--virtual-time-budget=10000', `--screenshot=${j.file}`, j.url]);
      process.stdout.write(code === 0 && existsSync(j.file) ? `✓ ${path.basename(j.file)}\n` : `✕ ${path.basename(j.file)} (chrome exit ${code})\n`);
    } finally {
      rmSync(profile, { recursive: true, force: true });
    }
  }
}

const args = process.argv.slice(2);
const ci = args.indexOf('--chrome');
const chrome = ci >= 0 ? (args[ci + 1] && !args[ci + 1].startsWith('--') ? args[ci + 1] : MAC_CHROME) : null;
const out = args.find((a, i) => !a.startsWith('--') && !(ci >= 0 && i === ci + 1));
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
  const jobs = p.list.flatMap((f) => THEMES.map((t) => ({ url: fixtureUrl(p.url, f.name, t, 'off'), file: path.resolve(out, `${f.name}-${t}.png`) })));
  if (driver) await shootWithDriver(driver, jobs);
  else await shootWithChrome(chrome, jobs);
} finally {
  await p.close();
}
