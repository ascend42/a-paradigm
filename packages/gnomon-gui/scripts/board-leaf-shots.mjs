#!/usr/bin/env node
// #gui-preview (DEV ONLY): PNGs of the board leaf fixture, per state, theme and window size, from an installed
// Chrome in real time over the DevTools protocol (Node's own WebSocket; no package is added).
//
//   node packages/gnomon-gui/scripts/board-leaf-shots.mjs <out-dir> [--clip] [--states open,tray,…] [--sizes 1440x900,1024x768]
//
// --clip captures only the leaf (#preview-board) instead of the window. test/board-leaf-golden.test.ts imports
// shootLeaf() for the G-DDL-07 leaf goldens. No build on import.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureUrl, startPreview } from './preview.mjs';

export const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const LEAF_STATES = ['open', 'tray', 'empty', 'yielded', 'loading', 'failed', 'crashed', 'short', 'tiny'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The first Chrome this machine has, or null. */
export function findChrome() {
  const candidates = [process.env.GNOMON_CHROME, MAC_CHROME, '/usr/bin/google-chrome', '/usr/bin/chromium', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean);
  return candidates.find((c) => existsSync(c)) ?? null;
}

/**
 * One capture. Resolves { png: Buffer, facts } or throws. `facts` is what the page says about the leaf (its state,
 * the rects of the leaf, the stack, the pinned zone, the composer and the status strip), read after it is ready.
 */
export async function shootLeaf({ chrome, url, width, height, clip = false, timeoutMs = 30_000, script = null }) {
  const profile = mkdtempSync(path.join(os.tmpdir(), 'gnomon-leaf-'));
  const proc = spawn(chrome, ['--headless=new', '--disable-gpu', `--user-data-dir=${profile}`, `--window-size=${width},${height}`, '--hide-scrollbars', '--force-device-scale-factor=1', '--remote-debugging-port=0', url], { stdio: 'ignore' });
  let ws = null;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
    if (!existsSync(portFile)) throw new Error('chrome did not open its DevTools port');
    const port = readFileSync(portFile, 'utf8').split(/\r?\n/)[0];
    let page = null;
    for (let i = 0; i < 50 && !page; i++) {
      page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page') ?? null;
      if (!page) await sleep(100);
    }
    if (!page) throw new Error('chrome opened no page');
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
    const evaluate = async (expression) => (await call('Runtime.evaluate', { expression, returnByValue: true })).result?.value;
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    const until = Date.now() + timeoutMs;
    while (Date.now() < until && (await evaluate('document.documentElement.dataset.preview === "ready"')) !== true) await sleep(100);
    if ((await evaluate('document.documentElement.dataset.preview === "ready"')) !== true) throw new Error('the fixture never set data-preview="ready"');
    await sleep(300);
    // an optional page-side script (an async function body returning JSON-able data), run once the fixture is ready
    // (its value crosses as a JSON string: an object returned by value from an awaited promise arrived empty)
    const scripted = script ? await call('Runtime.evaluate', { expression: `(async () => JSON.stringify(await (async () => { ${script} })()))()`, awaitPromise: true, returnByValue: true }) : null;
    const facts = JSON.parse(
      await evaluate(`(() => {
        const r = (q) => { const e = document.querySelector(q); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
        const leaf = globalThis.gnomonPreviewLeaf;
        return JSON.stringify({ state: leaf ? leaf.state() : null, leaf: r('#preview-board'), stage: r('#preview-board .bd-stage'), rail: r('#preview-board .bd-rail'), stack: r('#stack'), pinned: r('#pinned'), composer: r('#composer'), status: r('#status-line'), active: document.activeElement ? document.activeElement.className : null, stock: ['.App-toolbar', '.layer-ui__wrapper', '.excalidraw--mobile', '.Island'].filter((q) => document.querySelector(q)) });
      })()`),
    );
    const params = { format: 'png' };
    if (clip && facts.leaf) params.clip = { x: Math.round(facts.leaf.x), y: Math.round(facts.leaf.y), width: Math.round(facts.leaf.w), height: Math.round(facts.leaf.h), scale: 1 };
    const shot = await call('Page.captureScreenshot', params);
    if (!shot.data) throw new Error('no screenshot data');
    return { png: Buffer.from(shot.data, 'base64'), facts, scripted: scripted ? (typeof scripted.result?.value === 'string' ? JSON.parse(scripted.result.value) : { error: scripted.exceptionDetails?.exception?.description ?? 'no value' }) : null };
  } finally {
    try {
      ws?.close();
    } catch {
      /* already closed */
    }
    proc.kill();
    await sleep(200);
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  }
}

export const leafUrl = (base, state, theme) => `${fixtureUrl(base, 'board', theme, 'off')}&board=${state}`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
  const out = args.find((a, i) => !a.startsWith('--') && !['--states', '--sizes'].includes(args[i - 1]));
  const chrome = findChrome();
  if (!out || !chrome) {
    process.stderr.write(out ? '✕ no Chrome found (set GNOMON_CHROME)\n' : '✕ usage: board-leaf-shots.mjs <out-dir> [--clip] [--states a,b] [--sizes 1440x900,1024x768]\n');
    process.exit(2);
  }
  mkdirSync(out, { recursive: true });
  const p = await startPreview({ port: 0 });
  try {
    for (const size of opt('--sizes', '1440x900,1024x768').split(',')) {
      const [width, height] = size.split('x').map(Number);
      for (const state of opt('--states', LEAF_STATES.join(',')).split(',')) {
        for (const theme of ['day', 'night']) {
          const file = path.resolve(out, `leaf-${state}-${theme}-${width}.png`);
          try {
            const { png, facts } = await shootLeaf({ chrome, url: leafUrl(p.url, state, theme), width, height, clip: args.includes('--clip') });
            writeFileSync(file, png);
            process.stdout.write(`✓ ${path.basename(file)} · ${facts.state} · leaf ${Math.round(facts.leaf?.w ?? 0)}x${Math.round(facts.leaf?.h ?? 0)}\n`);
          } catch (e) {
            process.stdout.write(`✕ ${path.basename(file)} (${e.message})\n`);
          }
        }
      }
    }
    process.stdout.write(`${(await (await fetch(`${p.url}/diag`)).text()).split('\n')[0]}\n`);
  } finally {
    await p.close();
  }
}
