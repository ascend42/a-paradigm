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
/** DevTools key descriptions for the keys the tests press. */
const KEYS = { Tab: ['Tab', 9], Escape: ['Escape', 27], Enter: ['Enter', 13], ArrowDown: ['ArrowDown', 40], ArrowUp: ['ArrowUp', 38], ArrowRight: ['ArrowRight', 39], ArrowLeft: ['ArrowLeft', 37], Delete: ['Delete', 46], Backspace: ['Backspace', 8] };

/**
 * `actions` are REAL input, sent through the DevTools Input domain (trusted pointer and key events, the kind a person
 * makes), in order: {press: selector} moves the mouse to the element's centre and presses and releases it;
 * {at: [x, y], press: true} does the same at a point of #preview-board's stage; {dbl: selector}; {wheel: selector};
 * {drag: [[x, y], [x, y], …]} presses at the first point of the stage, moves through the others with a frame
 * between moves (the engine keeps the first move of a frame) and releases at the last; {hold: [[x, y], …]} does the
 * same and does NOT release ({release: [x, y]} does);
 * {key: 'Tab' | 'r' | …, shift?, meta?}; {paste: text} puts text on the clipboard and pastes it with the keyboard;
 * {read: expression} evaluates and records the value under `as`; {wait: ms}.
 * For the C8 test (test/board-c8.test.ts): {clip: {'text/html': …, 'text/plain': …, 'image/png': <base64>}} puts
 * those types on the clipboard and pastes with the keyboard; {key: 'c' | 'x', meta: true, commands: ['copy' | 'cut']}
 * is a real copy or cut; {drop: {files?: [absolute paths], items?: [{mimeType, data}]}, at: [x, y]} is a real drag
 * from outside the page dropped on the stage; {ime: composing, commit: text} drives an IME composition into the
 * focused field; {drag: …, alt: true} holds Alt; {await: expression} awaits a promise and records its value.
 */
export async function shootLeaf({ chrome, url, width, height, clip = false, timeoutMs = 30_000, script = null, actions = [] }) {
  const profile = mkdtempSync(path.join(os.tmpdir(), 'gnomon-leaf-'));
  const proc = spawn(chrome, ['--headless=new', '--disable-gpu', `--user-data-dir=${profile}`, `--window-size=${width},${height}`, '--hide-scrollbars', '--force-device-scale-factor=1', '--remote-debugging-port=0', url], { stdio: 'ignore' });
  let ws = null;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    // (the file appears before its first line is written: an empty read used to give port "" and a refused connection)
    const portOf = () => (existsSync(portFile) ? readFileSync(portFile, 'utf8').split(/\r?\n/)[0] : '');
    for (let i = 0; i < 150 && !/^\d+$/.test(portOf()); i++) await sleep(100);
    if (!/^\d+$/.test(portOf())) throw new Error('chrome did not open its DevTools port');
    const port = portOf();
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
    const acted = {};
    const centre = async (selector) => JSON.parse(await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return 'null'; const b = e.getBoundingClientRect(); return JSON.stringify({ x: b.x + b.width / 2, y: b.y + b.height / 2 }); })()`));
    const mouse = (type, x, y, extra = {}) => call('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' || type === 'mouseMoved' ? 0 : 1, clickCount: 1, ...extra });
    const pressAt = async (x, y, clickCount = 1) => {
      await mouse('mouseMoved', x, y, { button: 'none' });
      await mouse('mousePressed', x, y, { clickCount });
      await mouse('mouseReleased', x, y, { clickCount });
    };
    for (const a of actions) {
      if (a.wait) await sleep(a.wait);
      else if (a.await) {
        await call('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
        const r = await call('Runtime.evaluate', { expression: `(async () => JSON.stringify((await (${a.await})) ?? null))()`, awaitPromise: true, returnByValue: true });
        acted[a.as] = typeof r.result?.value === 'string' ? JSON.parse(r.result.value) : { failed: r.exceptionDetails?.exception?.description ?? JSON.stringify(r).slice(0, 300) };
      }
      else if (a.clip) {
        await call('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
        const expr = `(async () => { const src = ${JSON.stringify(a.clip)}; const parts = {}; for (const [type, v] of Object.entries(src)) parts[type] = type.startsWith('image/') ? new Blob([Uint8Array.from(atob(v), (c) => c.charCodeAt(0))], { type }) : new Blob([v], { type }); await navigator.clipboard.write([new ClipboardItem(parts)]); return 'written'; })().catch((e) => 'not written: ' + e)`;
        // (the page's own clipboard.write parses the HTML it is given: a handler attribute in it raises a
        // script-src-attr CSP row AT THE WRITE, before any paste, measured. `between` runs after the write and before
        // the paste so a test can set those rows apart. A headless Chrome keeps its own clipboard: the system
        // pasteboard cannot be used to avoid the page write.)
        acted[a.as ?? 'clip'] = (await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.value ?? 'no answer';
        if (a.between) await evaluate(a.between);
        const v = { key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: process.platform === 'darwin' ? 4 : 2 };
        await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...v, commands: ['paste'] });
        await call('Input.dispatchKeyEvent', { type: 'keyUp', ...v });
      } else if (a.drop) {
        const box = JSON.parse(await evaluate(`(() => { const b = document.querySelector('#preview-board .bd-stage').getBoundingClientRect(); return JSON.stringify({ x: b.x, y: b.y }); })()`));
        const at = { x: box.x + a.at[0], y: box.y + a.at[1] };
        const data = { items: a.drop.items ?? [], files: a.drop.files ?? [], dragOperationsMask: 1 };
        for (const type of ['dragEnter', 'dragOver', 'drop']) {
          await call('Input.dispatchDragEvent', { type, x: at.x, y: at.y, data });
          await sleep(60);
        }
      } else if (a.ime !== undefined) {
        await call('Input.imeSetComposition', { text: a.ime, selectionStart: a.ime.length, selectionEnd: a.ime.length });
        await sleep(80);
        await call('Input.insertText', { text: a.commit ?? a.ime });
      } else if (a.read) acted[a.as] = JSON.parse((await evaluate(`JSON.stringify((() => (${a.read}))() ?? null)`)) ?? 'null');
      else if (a.key) {
        const [key, code] = KEYS[a.key] ?? [a.key, a.key.toUpperCase().charCodeAt(0)];
        const modifiers = (a.shift ? 8 : 0) | (a.meta ? 4 : 0) | (a.ctrl ? 2 : 0) | (a.alt ? 1 : 0);
        const base = { key, code: KEYS[a.key] ? key : `Key${a.key.toUpperCase()}`, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers };
        await call('Input.dispatchKeyEvent', { type: KEYS[a.key] || modifiers ? 'rawKeyDown' : 'keyDown', ...base, ...(KEYS[a.key] || modifiers ? {} : { text: a.key }), ...(a.commands ? { commands: a.commands } : {}) });
        await call('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      } else if (a.paste !== undefined) {
        await call('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
        acted[a.as ?? 'paste'] = (await call('Runtime.evaluate', { expression: `navigator.clipboard.writeText(${JSON.stringify(a.paste)}).then(() => 'written', (e) => 'not written: ' + e)`, awaitPromise: true, returnByValue: true })).result?.value ?? 'no answer';
        await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: process.platform === 'darwin' ? 4 : 2, commands: ['paste'] });
        await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: process.platform === 'darwin' ? 4 : 2 });
      } else {
        if (a.drag || a.hold || a.release) {
          const box = JSON.parse(await evaluate(`(() => { const b = document.querySelector('#preview-board .bd-stage').getBoundingClientRect(); return JSON.stringify({ x: b.x, y: b.y }); })()`));
          const pts = (a.drag ?? a.hold ?? [a.release]).map(([x, y]) => ({ x: box.x + x, y: box.y + y }));
          if (!a.release) {
            const mods = a.alt ? { modifiers: 1 } : {};
            await mouse('mouseMoved', pts[0].x, pts[0].y, { button: 'none', ...mods });
            await mouse('mousePressed', pts[0].x, pts[0].y, mods);
            for (const q of pts.slice(1)) {
              await sleep(34);
              await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: q.x, y: q.y, button: 'left', buttons: 1, ...mods });
            }
            await sleep(34);
          }
          if (a.release) {
            await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pts[0].x, y: pts[0].y, button: 'left', buttons: 1 });
            await sleep(34);
          }
          if (!a.hold) await mouse('mouseReleased', pts[pts.length - 1].x, pts[pts.length - 1].y, a.alt ? { modifiers: 1 } : {});
          await sleep(a.settle ?? 120);
          continue;
        }
        let p = null;
        if (a.at) {
          const stage = await centre('#preview-board .bd-stage');
          const box = JSON.parse(await evaluate(`(() => { const b = document.querySelector('#preview-board .bd-stage').getBoundingClientRect(); return JSON.stringify({ x: b.x, y: b.y }); })()`));
          p = stage ? { x: box.x + a.at[0], y: box.y + a.at[1] } : null;
        } else p = await centre(a.press ?? a.dbl ?? a.wheel ?? a.move);
        if (!p) throw new Error(`no element for ${JSON.stringify(a)}`);
        if (a.wheel) await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: p.x, y: p.y, deltaX: 0, deltaY: 240 });
        else if (a.move) await mouse('mouseMoved', p.x, p.y, { button: 'none' });
        else if (a.dbl) {
          await pressAt(p.x, p.y, 1);
          await pressAt(p.x, p.y, 2);
        } else await pressAt(p.x, p.y);
      }
      await sleep(a.settle ?? 90);
    }
    // an optional page-side script (an async function body returning JSON-able data), run once the fixture is ready
    // (its value crosses as a JSON string: an object returned by value from an awaited promise arrived empty)
    const scripted = script ? await call('Runtime.evaluate', { expression: `(async () => JSON.stringify(await (async () => { ${script} })()))()`, awaitPromise: true, returnByValue: true }) : null;
    const facts = JSON.parse(
      await evaluate(`(() => {
        const r = (q) => { const e = document.querySelector(q); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
        const leaf = globalThis.gnomonPreviewLeaf;
        return JSON.stringify({ state: leaf ? leaf.state() : null, leaf: r('#preview-board'), stage: r('#preview-board .bd-stage'), rail: r('#preview-board .bd-rail'), stack: r('#stack'), pinned: r('#pinned'), composer: r('#composer'), status: r('#status-line'), active: document.activeElement ? document.activeElement.className : null, overlay: { seals: document.querySelectorAll('#preview-board .bd-over .bd-seal').length, stubs: document.querySelectorAll('#preview-board .bd-over .bd-stub').length, stubWords: [...document.querySelectorAll('#preview-board .bd-over .bd-stub-k')].map((e) => e.textContent.replace(/^kind/, 'kind ')), pins: document.querySelectorAll('#preview-board .bd-over .bd-pin:not(.unk)').length, textboxes: document.querySelectorAll('#preview-board .bd-over .bd-textbox').length }, foot: [...document.querySelectorAll('#preview-board .bd-foot .bd-hand')].map((e) => e.textContent.trim().replace(/\\s+/g, ' ')).join(' · '), stock: ['.App-toolbar', '.layer-ui__wrapper', '.excalidraw--mobile', '.Island'].filter((q) => document.querySelector(q)) });
      })()`),
    );
    const params = { format: 'png' };
    if (clip && facts.leaf) params.clip = { x: Math.round(facts.leaf.x), y: Math.round(facts.leaf.y), width: Math.round(facts.leaf.w), height: Math.round(facts.leaf.h), scale: 1 };
    const shot = await call('Page.captureScreenshot', params);
    if (!shot.data) throw new Error('no screenshot data');
    return { png: Buffer.from(shot.data, 'base64'), facts, acted, scripted: scripted ? (typeof scripted.result?.value === 'string' ? JSON.parse(scripted.result.value) : { error: scripted.exceptionDetails?.exception?.description ?? 'no value' }) : null };
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

export const leafUrl = (base, state, theme, marks = null) => `${fixtureUrl(base, 'board', theme, 'off')}&board=${state}${marks ? `&marks=${marks}` : ''}`;

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
