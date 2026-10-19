// @gnomon-platform: darwin
/**
 * #gui browser smoke (T-2026-10-19-006 item 6): the first dogfood run hit a blank page no test caught (Chrome
 * sends no Sec-Fetch-Site on the WebSocket handshake, so every page was refused 403). This loads the SETUP page
 * (a #setup-endpoint grant) and the LAUNCH page (a dev kernel's `{t:launch}` grant) in real headless Chrome and
 * asserts each one rendered past "connecting": the setup page reaches its welcome screen (hello + auth done over
 * the WebSocket), the app shows its session in #conn.
 * No dependency: Chrome is driven over the DevTools protocol with Node's global WebSocket; the URL (which carries
 * the single-use token) goes over CDP, never Chrome's argv. Skips with a reason when Chrome is not installed.
 * darwin only: Chrome's install path, and the kernel's GUI endpoint needs the darwin `transport` profile (§15.5).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { runDevCommand } from '../src/cli/dev-cli.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { acceptUnsignedHelperForTests, DEV_TEST_HELPER_ACK, type HelperTransport } from '../src/kernel/identity/index.js';
import { SetupEndpoint } from '../src/kernel/setup/setup-endpoint.js';
import { createWebEndpointForTest } from '../src/kernel/testing.js';
import { privateTmpRoot } from './daemon-helpers.js';
import { FakeHelper } from './helper-fake.js';
import { PKG_ROOT } from './helpers.js';

const CHROME = process.env.GNOMON_TEST_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HAVE_CHROME = fs.existsSync(CHROME);
const CHILD = path.join(PKG_ROOT, 'dist', 'transport', 'gnomon-web.js');
const DEV = acceptUnsignedHelperForTests(DEV_TEST_HELPER_ACK);
/** How long a page may take to render (a bound, G-HON-07): at most this many ms of polling. */
const RENDER_MS = 15_000;
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function tmp(prefix: string): string {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(privateTmpRoot(), prefix)));
  cleanups.push(() => removeTree(d));
  return d;
}

type Cdp = { send: (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<Record<string, unknown>> };

/** Headless Chrome with a private profile; resolves the browser's CDP connection. */
async function chrome(): Promise<Cdp> {
  const profile = tmp('gch-');
  const p: ChildProcess = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  cleanups.push(() => new Promise<void>((r) => (p.exitCode !== null ? r() : (p.once('exit', () => r()), p.kill('SIGKILL')))));
  const wsUrl = await new Promise<string>((resolve, reject) => {
    let err = '';
    const t = setTimeout(() => reject(new Error(`chrome gave no DevTools URL in at most 20 s: ${err}`)), 20_000);
    p.stderr!.on('data', (d) => {
      err += String(d);
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
      if (m) {
        clearTimeout(t);
        resolve(m[1]!);
      }
    });
    p.once('exit', (c) => (clearTimeout(t), reject(new Error(`chrome exited ${c}: ${err}`))));
  });
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((r, j) => ((ws.onopen = () => r()), (ws.onerror = () => j(new Error('CDP connect failed')))));
  cleanups.push(() => ws.close());
  let id = 0;
  const pending = new Map<number, (m: Record<string, unknown>) => void>();
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data)) as Record<string, unknown>;
    if (typeof m.id === 'number') pending.get(m.id)?.(m), pending.delete(m.id);
  };
  return {
    send: (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        const n = ++id;
        pending.set(n, (m) => (m.error ? reject(new Error(`${method}: ${JSON.stringify(m.error)}`)) : resolve((m.result ?? {}) as Record<string, unknown>)));
        ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
      }),
  };
}

/** Open `url` in a new tab and poll `expr` (a string-valued JS expression) until `ok` holds; returns the last value. */
async function render(cdp: Cdp, url: string, expr: string, ok: (v: string) => boolean): Promise<string> {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })) as { sessionId: string };
  await cdp.send('Page.navigate', { url }, sessionId);
  const end = Date.now() + RENDER_MS;
  let last = '';
  while (Date.now() < end) {
    const r = (await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId)) as { result?: { value?: unknown } };
    last = String(r.result?.value ?? '');
    if (ok(last)) return last;
    await new Promise((x) => setTimeout(x, 100));
  }
  return last;
}

describe.skipIf(!HAVE_CHROME)('#gui in headless Chrome (darwin smoke)', () => {
  it('the setup page renders past connecting: hello + auth over the WebSocket reach the welcome screen', async () => {
    const u = tmp('gcs-');
    const helperDir = tmp('gch-h-');
    const exe = path.join(helperDir, 'gnomon-helper');
    fs.writeFileSync(exe, `#!${process.execPath}\n`);
    fs.chmodSync(exe, 0o755);
    const fake = new FakeHelper(null);
    const start = (): HelperTransport => (fake.revive(), { request: (r) => fake.request(r), get alive() { return fake.alive; }, onExit: (cb: () => void) => fake.onExit(cb), close: async () => undefined } as HelperTransport);
    const ep = new SetupEndpoint({ home: path.join(u, '.gnomon'), userHome: u, helperPath: exe, host: 'mac-1', defaultName: 'founder', env: {}, unsafe: null, verifier: DEV, start, once: () => (req) => fake.handle(req), scriptPath: CHILD, createWeb: (w) => createWebEndpointForTest(w) });
    cleanups.push(() => ep.stop());
    const g = await ep.start();
    const cdp = await chrome();
    const text = await render(cdp, g.url, `(document.getElementById('setup')||{}).innerText||''`, (v) => v.includes('Check this Mac'));
    expect(text).toContain('Set up Gnomon');
    expect(text).toContain('Check this Mac'); // the welcome screen: only after the authed hello
    expect(text).not.toContain('could not connect');
  });

  it('the launch page renders the app with a live session in #conn', async () => {
    const w = tmp('gcl-');
    const devHome = path.join(w, 'devhome');
    const quiet = { stdin: new PassThrough(), stdout: { write: () => true }, stderr: { write: () => true } };
    expect(await runDevCommand(['init', '--home', devHome], quiet, { userHome: w, host: 'mac-1' })).toBe(0);
    const lines: Record<string, unknown>[] = [];
    let buf = '';
    const stdin = new PassThrough();
    const c = {
      stdin,
      stdout: { write: (s: string) => { buf += s; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i)) as Record<string, unknown>); buf = buf.slice(i + 1); } return true; } },
      stderr: { write: () => true },
    };
    const run = runDevCommand(['up', '--home', devHome, '--wrapper'], c, { userHome: w, runtime: { env: {}, execArgv: ['--disable-sigusr1'] } });
    const next = async (t: string): Promise<Record<string, unknown>> => {
      const end = Date.now() + 20_000;
      for (;;) {
        const hit = lines.find((l) => l.t === t);
        if (hit) return hit;
        if (Date.now() > end) throw new Error(`no ${t} line: ${JSON.stringify(lines)}`);
        await new Promise((r) => setTimeout(r, 20));
      }
    };
    cleanups.push(async () => (stdin.write('quit\n'), await run));
    await next('up');
    stdin.write('launch\n');
    const g = await next('launch');
    const cdp = await chrome();
    const url = `http://127.0.0.1:${String(g.port)}/#launch=${String(g.launchToken)}&k=${String(g.kernelPublicKey)}`;
    const conn = await render(cdp, url, `(document.getElementById('conn')||{}).textContent||''`, (v) => v.includes('·'));
    expect(conn).toContain('·'); // `<principal> · <connId>`: set only after the authed hello
    expect(conn).not.toBe('connecting');
  });
});

describe.runIf(!HAVE_CHROME)('#gui in headless Chrome (darwin smoke)', () => {
  it.skip(`skipped: Google Chrome is not installed at ${CHROME} (set GNOMON_TEST_CHROME to a Chrome binary)`, () => undefined);
});
