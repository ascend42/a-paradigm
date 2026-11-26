// Shared by the M1.0 browser probes (p09-ed25519-matrix, p12-excalidraw-csp).
// ZERO deps, no build. Not a probe: `_shared` cannot match run.mjs's id pattern.
//
// The model: the probe serves a page from its own loopback server under the
// exact §11.2 rule 6 headers (CSP included); the page runs the measurement and
// POSTs one JSON report back to /report (allowed by connect-src). Engines are
// therefore driven only by "open this URL" — no CDP, no Playwright, no WebDriver —
// so every engine is measured by the same page code.
//
// Engines found locally (each optional; absence is recorded, never faked):
//   chrome          Google Chrome stable, --headless=new
//   chrome-testing  Playwright's cached "Google Chrome for Testing" (Chromium)
//   headless-shell  Playwright's cached chrome-headless-shell
//   edge            Microsoft Edge, --headless=new
//   firefox         Firefox --headless with a throwaway profile
//   wkwebview       system WebKit via _shared/wkwebview-load.swift (darwin only)
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHARED = path.dirname(fileURLToPath(import.meta.url));

/** The §11.2 rule 6 CSP, verbatim, for a given port. */
export function gnomonCsp(port) {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' blob:",
    "font-src 'self'",
    `connect-src ws://127.0.0.1:${port} http://127.0.0.1:${port}`,
    "worker-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/**
 * Serve `files` (Map urlPath -> Buffer|string) and/or a static `rootDir` on
 * 127.0.0.1:<ephemeral> with the Gnomon headers. Reports POSTed to /report are
 * delivered to waiters keyed by the `run` query parameter of the page URL.
 */
export async function startServer({ files = new Map(), rootDir = null }) {
  const waiters = new Map();
  const early = new Map();
  const requests = [];
  // POST paths a probe answers itself while a page runs: path -> async (body, url) => ({ status, body? })
  const hooks = new Map();
  let port = 0;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    // `run` is the page's own id (its URL carries ?run=); a page whose run never shows here was never loaded
    requests.push({ method: req.method, path: u.pathname, at: Date.now(), run: u.searchParams.get('run') ?? undefined });
    const headers = {
      'Content-Security-Policy': gnomonCsp(port),
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    };
    if (req.method === 'POST' && u.pathname === '/report') {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        res.writeHead(204, headers).end();
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = { unparsedReport: body.slice(0, 2000) };
        }
        const run = u.searchParams.get('run') ?? '';
        const w = waiters.get(run);
        if (w) {
          waiters.delete(run);
          w(parsed);
        } else early.set(run, parsed);
      });
      return;
    }
    if (req.method === 'POST' && hooks.has(u.pathname)) {
      let posted = '';
      req.on('data', (d) => (posted += d));
      req.on('end', () => {
        Promise.resolve()
          .then(() => hooks.get(u.pathname)(posted, u))
          .then((r) => res.writeHead(r.status, headers).end(r.body ?? ''), (e) => res.writeHead(500, headers).end(String(e?.message ?? e).slice(0, 300)));
      });
      return;
    }
    let body = files.get(u.pathname === '/' ? '/index.html' : u.pathname);
    let ext = path.extname(u.pathname === '/' ? '/index.html' : u.pathname);
    if (body === undefined && rootDir) {
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      const abs = path.resolve(rootDir, rel || 'index.html');
      if (abs.startsWith(path.resolve(rootDir) + path.sep) && existsSync(abs) && statSync(abs).isFile()) {
        body = readFileSync(abs);
        ext = path.extname(abs);
      }
    }
    if (body === undefined) {
      res.writeHead(404, headers).end();
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Type': TYPES[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  return {
    port,
    origin: `http://127.0.0.1:${port}`,
    requests,
    hooks,
    waitReport(run, timeoutMs) {
      if (early.has(run)) {
        const v = early.get(run);
        early.delete(run);
        return Promise.resolve(v);
      }
      return new Promise((resolve) => {
        const t = setTimeout(() => {
          waiters.delete(run);
          resolve(null);
        }, timeoutMs);
        waiters.set(run, (v) => {
          clearTimeout(t);
          resolve(v);
        });
      });
    },
    /** Stop waiting for `run`: a report that still comes is kept for lateReport(). */
    forget(run) {
      waiters.delete(run);
    },
    /** A report that arrived after its waiter gave up (null when none did); taken once. */
    lateReport(run) {
      if (!early.has(run)) return null;
      const v = early.get(run);
      early.delete(run);
      return v;
    },
    close: () => new Promise((r) => server.close(r)),
  };
}

function version(bin, args = ['--version']) {
  try {
    return execFileSync(bin, args, { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0];
  } catch {
    return null;
  }
}

function playwrightCache() {
  const home = os.homedir();
  const dirs = {
    darwin: path.join(home, 'Library/Caches/ms-playwright'),
    win32: path.join(process.env.LOCALAPPDATA ?? path.join(home, 'AppData/Local'), 'ms-playwright'),
    linux: path.join(home, '.cache/ms-playwright'),
  };
  const d = process.env.PLAYWRIGHT_BROWSERS_PATH || dirs[process.platform];
  return d && existsSync(d) ? d : null;
}

function newestCached(prefix) {
  const cache = playwrightCache();
  if (!cache) return null;
  const hits = readdirSync(cache).filter((n) => n.startsWith(`${prefix}-`)).sort((a, b) => Number(b.split('-').pop()) - Number(a.split('-').pop()));
  return hits.length ? path.join(cache, hits[0]) : null;
}

function chromeArgs(profile, url) {
  return ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
    '--disable-background-networking', '--disable-component-update', '--remote-debugging-port=0', `--user-data-dir=${profile}`, url];
}

/** Compile (once, cached by source hash) the WKWebView host. darwin only. */
export function buildWkwebview() {
  const src = path.join(SHARED, 'wkwebview-load.swift');
  const hash = createHash('sha256').update(readFileSync(src)).digest('hex').slice(0, 12);
  const dir = path.join(os.tmpdir(), `gnomon-probe-wkwebview-${hash}`);
  const bin = path.join(dir, 'wkwebview-load');
  if (existsSync(bin)) return { bin, compiled: 'cached' };
  mkdirSync(dir, { recursive: true });
  execFileSync('/usr/bin/xcrun', ['swiftc', '-O', src, '-o', bin], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000 });
  return { bin, compiled: 'fresh' };
}

/** Engines available on this machine. Each: {name, version, launch(url) -> {kill()}}. */
export function findEngines() {
  const engines = [];
  const missing = {};
  const p = process.platform;
  const add = (name, bin, kind) => {
    if (!bin || !existsSync(bin)) {
      missing[name] = bin ? `not found at ${bin.replace(os.homedir(), '~')}` : 'no known location on this OS';
      return;
    }
    const v = version(bin);
    engines.push({ name, bin, version: v ?? 'unknown', kind });
  };
  const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const chrome = {
    darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    win32: path.join(pf, 'Google/Chrome/Application/chrome.exe'),
    linux: '/usr/bin/google-chrome',
  }[p];
  add('chrome', chrome, 'chromium');
  const cft = newestCached('chromium');
  add('chrome-testing', cft && {
    darwin: path.join(cft, `chrome-mac-${process.arch === 'arm64' ? 'arm64' : 'x64'}/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`),
    win32: path.join(cft, 'chrome-win/chrome.exe'),
    linux: path.join(cft, 'chrome-linux/chrome'),
  }[p], 'chromium');
  const hs = newestCached('chromium_headless_shell');
  add('headless-shell', hs && {
    darwin: path.join(hs, `chrome-headless-shell-mac-${process.arch === 'arm64' ? 'arm64' : 'x64'}/chrome-headless-shell`),
    win32: path.join(hs, 'chrome-headless-shell-win64/chrome-headless-shell.exe'),
    linux: path.join(hs, 'chrome-headless-shell-linux64/chrome-headless-shell'),
  }[p], 'chromium');
  add('edge', {
    darwin: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    win32: path.join(pf86, 'Microsoft/Edge/Application/msedge.exe'),
    linux: '/usr/bin/microsoft-edge',
  }[p], 'chromium');
  add('firefox', {
    darwin: '/Applications/Firefox.app/Contents/MacOS/firefox',
    win32: path.join(pf, 'Mozilla Firefox/firefox.exe'),
    linux: '/usr/bin/firefox',
  }[p], 'firefox');
  if (p === 'darwin') {
    try {
      const { bin, compiled } = buildWkwebview();
      const webkitVersion = version('/usr/bin/defaults', ['read', '/System/Library/Frameworks/WebKit.framework/Resources/Info', 'CFBundleVersion']);
      engines.push({ name: 'wkwebview', bin, version: `WebKit ${webkitVersion ?? 'unknown'}`, kind: 'wkwebview', compiled });
    } catch (e) {
      missing.wkwebview = `swiftc build failed: ${String(e.stderr ?? e.message).slice(0, 400)}`;
    }
  } else missing.wkwebview = 'darwin only';
  return { engines, missing };
}

/**
 * The processes of a process listing whose command line names `tag` (a launch's own profile directory name), never
 * `self` and never the listing command itself. `listing` is `ps -axww -o pid=,command=` output, or the Windows
 * `<pid> <command line>` lines of profileHolders: one process a line, its pid first.
 */
export function holdersFrom(listing, tag, self = process.pid) {
  if (!tag) return [];
  return String(listing)
    .split(/\r?\n/)
    .map((l) => l.trim().match(/^(\d+)\s+(.*)$/))
    .filter((m) => m && m[2].includes(tag) && Number(m[1]) !== self && !m[2].includes('Get-CimInstance'))
    .map((m) => ({ pid: Number(m[1]), command: m[2].slice(0, 240) }));
}

/**
 * The live processes whose command line names `tag`: what a launcher handed the browser off to (a Firefox that
 * relaunches itself, or Windows' launcher process, starts the browser with the same arguments, the profile among
 * them, and exits 0). Resolves null when the platform's process listing could not be read.
 */
export function profileHolders(tag, platform = process.platform) {
  const [cmd, args] = platform === 'win32'
    ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance Win32_Process -Filter "CommandLine like '%${tag}%'" | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }`]]
    : ['/bin/ps', ['-axww', '-o', 'pid=,command=']];
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: 'utf8', timeout: 15_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout) => resolve(err ? null : holdersFrom(stdout, tag)));
  });
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === 'EPERM';
  }
};

/**
 * Launch `engine` on `url`. Returns {exited, gone, kill(), output(), profile}: `exited` resolves {code, signal} when
 * the LAUNCHED process ends; `gone` resolves {code, signal, handoff} when the BROWSER has ended, that is the launched
 * process and every process it handed off to. A launcher that relaunches the browser (Firefox restarting itself,
 * Windows' launcher process) exits 0 while the browser it started goes on with the same arguments: the profile
 * directory the harness made for this launch names it, so the processes whose command line holds that directory's
 * unique name are the browser. `handoff` lists them ({pids}) when there were any after the launcher exited, else
 * null. kill() stops the launcher and every such process, so no browser outlives its page or loses its profile under
 * it, and resolves the pids it found still holding the profile after the launcher ended.
 * `engine.preArgs` (tests: a stub launcher run by node) go before the engine's own arguments.
 */
export function launch(engine, url, timeoutSec = 60) {
  const profile = mkdtempSync(path.join(os.tmpdir(), `gnomon-probe-${engine.name}-`));
  const tag = path.basename(profile);
  let args;
  if (engine.kind === 'chromium') args = engine.name === 'headless-shell' ? chromeArgs(profile, url).slice(1) : chromeArgs(profile, url);
  else if (engine.kind === 'firefox') args = ['--headless', '--no-remote', '--profile', profile, url];
  else args = [url, String(timeoutSec)];
  // only a launch whose arguments name the profile can be followed (the WKWebView host takes none)
  const follows = args.some((a) => a.includes(tag));
  const child = spawn(engine.bin, [...(engine.preArgs ?? []), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out = (out + d).slice(-4000)));
  child.stderr.on('data', (d) => (out = (out + d).slice(-4000)));
  const exited = new Promise((r) => child.on('close', (code, signal) => r({ code, signal })));
  let stopping = false;
  const others = async () => (await profileHolders(tag))?.filter((h) => h.pid !== child.pid) ?? null;
  // the browser ends when the launcher has ended and, twice in a row 500 ms apart, no process holds the profile
  // (a relaunch spawns the new browser before the old process exits; the second look covers a hand-off in flight)
  const gone = exited.then(async (x) => {
    if (!follows) return { ...x, handoff: null };
    const seen = new Set();
    let empty = 0;
    while (!stopping && empty < 2) {
      const h = await others();
      if (h === null) break; // no listing on this host: the launcher's exit is all there is to go on
      h.forEach((p) => seen.add(p.pid));
      empty = h.length === 0 ? empty + 1 : 0;
      if (empty < 2) await sleep(h.length ? 250 : 500);
    }
    return { ...x, handoff: seen.size ? { pids: [...seen] } : null };
  });
  return {
    exited,
    gone,
    profile,
    output: () => out,
    async kill() {
      stopping = true;
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      const t = setTimeout(() => child.kill('SIGKILL'), 3000);
      await exited;
      clearTimeout(t);
      let left = [];
      if (follows) {
        const held = (await others()) ?? [];
        left = held.map((h) => h.pid);
        for (const pid of left) {
          try {
            process.kill(pid, 'SIGTERM');
          } catch {
            // already gone
          }
        }
        for (let i = 0; i < 30 && left.some(alive); i++) await sleep(100);
        for (const pid of left.filter(alive)) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // already gone
          }
        }
        for (let i = 0; i < 20 && left.some(alive); i++) await sleep(100);
      }
      try {
        rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
      } catch {
        // a Windows profile lock can outlive the process briefly; temp dir only
      }
      return left;
    },
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * The DevTools protocol of a launched Chromium-family browser (Chrome, Edge; they are started with
 * --remote-debugging-port=0, loopback only), over Node's own WebSocket. Resolves { call(method, params), close() }
 * for the page target, or null when there is no port, no page or no WebSocket.
 */
export async function devtools(profile) {
  if (typeof WebSocket === 'undefined') return null;
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) return null;
  const port = readFileSync(portFile, 'utf8').split(/\r?\n/)[0];
  let page = null;
  for (let i = 0; i < 50 && !page; i++) {
    try {
      page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page') ?? null;
    } catch {
      page = null;
    }
    if (!page) await sleep(100);
  }
  if (!page) return null;
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const opened = await new Promise((res) => {
    ws.addEventListener('open', () => res(true), { once: true });
    ws.addEventListener('error', () => res(false), { once: true });
  });
  if (!opened) return null;
  let id = 0;
  return {
    call: (method, params = {}) =>
      new Promise((res) => {
        const mine = ++id;
        const on = (e) => {
          const m = JSON.parse(e.data);
          if (m.id !== mine) return;
          ws.removeEventListener('message', on);
          res(m.result ?? { error: m.error?.message ?? 'no result' });
        };
        ws.addEventListener('message', on);
        ws.send(JSON.stringify({ id: mine, method, params }));
      }),
    close: () => {
      try {
        ws.close();
      } catch {
        // already closed
      }
    },
  };
}

/** The modifier bit and name the platform pastes with: Meta on macOS, Control on Windows and Linux. */
export const pasteModifier = (platform = process.platform) => (platform === 'darwin' ? { bit: 4, name: 'Meta' } : { bit: 2, name: 'Control' });

/**
 * A REAL paste into the page, the way a person makes one: the text goes on the clipboard (permission granted for
 * the page's origin), the mouse is moved to (x, y), and the platform's paste chord is pressed with the browser's own
 * `paste` editing command. Resolves null when done, or why not.
 */
export async function realPaste(cdp, origin, text, x, y, platform = process.platform) {
  await cdp.call('Browser.grantPermissions', { origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  const wrote = await cdp.call('Runtime.evaluate', { expression: `navigator.clipboard.writeText(${JSON.stringify(text)}).then(() => 'written', (e) => 'not written: ' + e)`, awaitPromise: true, returnByValue: true });
  if (wrote.result?.value !== 'written') return String(wrote.result?.value ?? wrote.error ?? 'the clipboard was not written');
  await cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  const mod = pasteModifier(platform);
  const key = { key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: mod.bit };
  await cdp.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key, commands: ['paste'] });
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  return null;
}

/**
 * Open `pagePath` on `server` in `engine` and wait for its report. A page that does not report says why, so a miss
 * is never a bare timeout: `miss` is 'exited' (the BROWSER ended first: the launched process and every process it
 * handed off to, see launch(); `exit` has the launcher's code, signal and time, and `browserGoneAtMs` when a hand-off
 * outlived it), 'never-requested' (the server saw no request for this page's run id within `loadDeadlineMs`: the browser
 * never loaded it, a launch failure), or 'no-report' (the page was requested and sent nothing in `timeoutMs`).
 * `pageRequestedMs` is when the page itself was first asked for. A report that lands after the wait gave up is
 * returned as `lateReport`, never as `report`: it does not count as a report, and the caller judges what it carries;
 * `runId` lets the caller pick up a report that lands later still (server.lateReport). With `deadlineMs` the URL
 * carries `deadline=<epoch ms>`, fixed at launch, for the page's own watchdog. A launcher that exits 0 while the
 * browser it started goes on (T-2026-11-25-002: Firefox on macos-15) is not a miss: the wait goes on for that browser,
 * and the result carries `handoff` ({launcherExit, pids, stopped}) whether the page reported or not.
 */
export async function runPage(server, engine, pagePath, timeoutMs = 60_000, { loadDeadlineMs = null, deadlineMs = null } = {}) {
  const run = randomBytes(6).toString('hex');
  const sep = pagePath.includes('?') ? '&' : '?';
  const t0 = Date.now();
  const url = `${server.origin}${pagePath}${sep}run=${run}${deadlineMs ? `&deadline=${t0 + deadlineMs}` : ''}`;
  const from = server.requests.length;
  // the WKWebView host times out a little BEFORE this wait does, so its last lines (the page's visibility and phase,
  // T-2026-11-06-003) reach the launcher tail of a run that never reported
  const proc = launch(engine, url, Math.max(5, Math.floor(timeoutMs / 1000) - 5));
  // `launcherExit`: the launched process ended. `ended`: the BROWSER ended (the launcher and whatever it handed off to)
  let launcherExit = null;
  let ended = null;
  proc.exited.then((x) => (launcherExit = { ...x, atMs: Date.now() - t0 }));
  proc.gone.then((x) => (ended = { atMs: Date.now() - t0, handoff: x.handoff }));
  // POST /paste?x=&y= with the text as its body: a real paste through DevTools in a Chromium-family browser (200),
  // or 501 where there is no such channel (WKWebView, Firefox) and the page falls back to a synthetic event
  let cdp = null;
  server.hooks.set('/paste', async (text, u) => {
    if (engine.kind !== 'chromium') return { status: 501, body: 'no devtools channel in this engine' };
    cdp ??= await devtools(proc.profile);
    if (!cdp) return { status: 501, body: 'the devtools port did not open' };
    const why = await realPaste(cdp, server.origin, text, Number(u.searchParams.get('x') ?? 0), Number(u.searchParams.get('y') ?? 0));
    return why === null ? { status: 200, body: 'pasted' } : { status: 500, body: why };
  });
  const requested = () => server.requests.slice(from).find((q) => q.run === run && q.method === 'GET');
  let neverRequested = false;
  let poll = null;
  const loaded = loadDeadlineMs
    ? new Promise((resolve) => {
        poll = setInterval(() => {
          if (requested()) {
            clearInterval(poll);
            poll = null;
          } else if (Date.now() - t0 >= loadDeadlineMs) {
            clearInterval(poll);
            poll = null;
            neverRequested = true;
            resolve(null);
          }
        }, 250);
      })
    : new Promise(() => {});
  // the wait ends early only when the BROWSER has gone (launcher and hand-off), never on a launcher that handed off
  const report = await Promise.race([server.waitReport(run, timeoutMs), proc.gone.then(() => server.waitReport(run, 1500)), loaded]);
  if (poll) clearInterval(poll);
  if (!report) server.forget(run);
  server.hooks.delete('/paste');
  cdp?.close();
  const wallMs = Date.now() - t0;
  const tail = proc.output();
  const goneFirst = ended !== null;
  const stopped = await proc.kill();
  // a launcher that exited while the browser it started went on: when and how it exited, which processes were the
  // browser after it, and which of them were still there to be stopped
  const handedTo = launcherExit ? [...new Set([...(ended?.handoff?.pids ?? []), ...stopped])] : [];
  const handoff = handedTo.length ? { launcherExit, pids: handedTo, stopped } : null;
  const first = requested();
  const pageRequestedMs = first ? first.at - t0 : null;
  if (report) return { report, runId: run, wallMs, pageRequestedMs, ...(handoff ? { handoff } : {}) };
  const lateReport = server.lateReport(run);
  const miss = goneFirst ? 'exited' : neverRequested || !first ? 'never-requested' : 'no-report';
  return { report: null, runId: run, wallMs, launcherTail: tail.slice(-800), miss, exit: goneFirst ? { ...launcherExit, ...(ended.handoff ? { browserGoneAtMs: ended.atMs } : {}) } : null, pageRequestedMs, ...(handoff ? { handoff } : {}), ...(lateReport ? { lateReport } : {}) };
}
