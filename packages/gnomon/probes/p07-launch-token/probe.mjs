// p07-launch-token — P07 / S29-05, macOS half (spec §19.1 M1.0 P07; §11.2
// rule 2, §16 hand-off; K7). FOUNDER-RUN, interactive.
//   sudo -v && node packages/gnomon/probes/run.mjs p07-launch-token --timeout 3600000
// (or `sudo node …`: the probe then drops back to $SUDO_USER for the browser
// hand-off, so the browsers never run as root).
// Claim: when the helper reads the launch token on stdin and hands the URL
// (token in the fragment) to LaunchServices via NSWorkspace.open, no process on
// the box sees the token on a command line — browser cold-launched, warm, or
// with an update pending — and we learn whether the token lands in browser
// history / session-restore files (K7 says it may; replay is then log-only).
// Capture, all three running across each hand-off and scanned for the token:
//   eslogger exec fork (root + Full Disk Access for the terminal),
//   log stream (unified log, no root), and a 50 ms `ps -axww` sampler.
// Positive control first: `/usr/bin/open -a <browser> <url-with-token>` puts the
// token on open's argv; the capture MUST see it, or the run proves nothing.
// After the runs: quit the browsers, then every history/session file of
// Safari, Chrome and Firefox (mozlz4 decoded) is grepped for every token used.
// Tokens are throwaway; results keep only sha256 prefixes.
// Verdict: fail if a test hand-off's token appears on any argv; partial if the
// control was not detected or a run did not deliver; pass otherwise (history
// hits are recorded as K7 evidence, not failures — spec table).
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../_shared/browser.mjs';
import { onAbort } from '../_shared/abort.mjs';
import { ask, bindSignal, interactive, say } from '../_shared/signing.mjs';

export const specRefs = ['§11.2 rule 2', '§16 hand-off row', '§19.1 M1.0 P07 / S29-05', 'K7', 'G-WEB-05'];

const BROWSERS = [
  { name: 'Safari', app: '/Applications/Safari.app', proc: 'Safari' },
  { name: 'Chrome', app: '/Applications/Google Chrome.app', proc: 'Google Chrome' },
  { name: 'Firefox', app: '/Applications/Firefox.app', proc: 'firefox' },
];
// Capture children alive right now (killed by the abort cleanup).
const LIVE = new Set();
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE = '<!doctype html><meta charset="utf-8"><title>gnomon p07</title><p id="s">p07: waiting</p><script src="/p07.js"></script>';
const PAGE_JS = `(function () {
  var h = location.hash; var run = new URLSearchParams(location.search).get('run') || '';
  history.replaceState(null, '', location.pathname + location.search); // §11.2: read once, clear
  document.getElementById('s').textContent = h.indexOf('launch=') >= 0 ? 'p07: token received — you can leave this tab' : 'p07: NO token in fragment';
  fetch('/report?run=' + encodeURIComponent(run), { method: 'POST', body: JSON.stringify({ hasToken: h.indexOf('launch=') >= 0, hashLen: h.length, ua: navigator.userAgent }) });
})();`;

// ---- mozlz4 (Firefox session files): "mozLz40\\0" + u32 size + LZ4 block
function lz4Block(src, outLen) {
  const out = Buffer.alloc(outLen);
  let i = 0;
  let o = 0;
  while (i < src.length) {
    const tok = src[i++];
    let lit = tok >> 4;
    if (lit === 15) for (let b = 255; b === 255; lit += b) b = src[i++];
    src.copy(out, o, i, i + lit);
    i += lit;
    o += lit;
    if (i >= src.length) break;
    const off = src[i] | (src[i + 1] << 8);
    i += 2;
    let len = tok & 15;
    if (len === 15) for (let b = 255; b === 255; len += b) b = src[i++];
    len += 4;
    for (let k = 0; k < len; k++, o++) out[o] = out[o - off];
  }
  return out.subarray(0, o);
}
function readMaybeMozlz4(file) {
  const b = readFileSync(file);
  if (b.length > 12 && b.subarray(0, 8).toString('latin1') === 'mozLz40\0') {
    try {
      return lz4Block(b.subarray(12), b.readUInt32LE(8));
    } catch {
      return b;
    }
  }
  return b;
}

function historyFiles(home) {
  const roots = [
    path.join(home, 'Library/Safari'),
    path.join(home, 'Library/Containers/com.apple.Safari/Data/Library/Safari'),
    path.join(home, 'Library/Application Support/Google/Chrome'),
    path.join(home, 'Library/Application Support/Firefox/Profiles'),
  ];
  const want = /^(History\.db.*|LastSession\.plist|History(-journal)?|Current (Session|Tabs)|Last (Session|Tabs)|Session_.*|Tabs_.*|places\.sqlite.*|sessionstore.*\.jsonlz4|recovery.*\.jsonlz4|previous\.jsonlz4|upgrade\..*\.jsonlz4)$/;
  const out = [];
  const errors = {};
  const walk = (d, depth) => {
    let ents;
    try {
      ents = readdirSync(d, { withFileTypes: true });
    } catch (e) {
      errors[d.replace(home, '~')] = e.code;
      return;
    }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 4 && !/^(Cache|Code Cache|GPUCache|Service Worker|IndexedDB|Extensions|cache2|storage)$/.test(e.name)) walk(p, depth + 1);
      else if (e.isFile() && want.test(e.name)) out.push(p);
    }
  };
  for (const r of roots) if (existsSync(r)) walk(r, 0);
  return { files: out, errors };
}

function grepFiles(files, tokens, home) {
  const hits = [];
  for (const f of files) {
    let buf;
    try {
      if (statSync(f).size > 300 * 1024 * 1024) continue;
      buf = readMaybeMozlz4(f);
    } catch (e) {
      hits.push({ file: f.replace(home, '~'), error: e.code });
      continue;
    }
    for (const t of tokens) if (buf.includes(t.token)) hits.push({ file: f.replace(home, '~'), token: sha(t.token), label: t.label });
  }
  return hits;
}

function startCaptures(dir, label, root) {
  // Refresh the sudo timestamp before every capture so a long session does not
  // leave eslogger dead behind an expired `sudo -n`.
  if (!root) spawnSync('/usr/bin/sudo', ['-v'], { stdio: 'inherit' });
  const caps = {};
  const es = root ? spawn('/usr/bin/eslogger', ['exec', 'fork'], { stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn('/usr/bin/sudo', ['-n', '/usr/bin/eslogger', 'exec', 'fork'], { stdio: ['ignore', 'pipe', 'pipe'] });
  caps.eslogger = { proc: es, out: [], err: '' };
  LIVE.add(es);
  es.on('close', () => LIVE.delete(es));
  es.stdout.on('data', (d) => caps.eslogger.out.push(d));
  es.stderr.on('data', (d) => (caps.eslogger.err += d));
  const ls = spawn('/usr/bin/log', ['stream', '--style', 'ndjson', '--level', 'info'], { stdio: ['ignore', 'pipe', 'ignore'] });
  caps.log = { proc: ls, out: [] };
  LIVE.add(ls);
  ls.on('close', () => LIVE.delete(ls));
  ls.stdout.on('data', (d) => caps.log.out.push(d));
  caps.ps = { out: [], timer: setInterval(() => {
    const r = spawnSync('/bin/ps', ['-axww', '-o', 'pid=,command='], { encoding: 'utf8' });
    caps.ps.out.push(Buffer.from(r.stdout ?? ''));
  }, 50) };
  return caps;
}

async function stopCaptures(caps) {
  await sleep(2500);
  clearInterval(caps.ps.timer);
  for (const k of ['eslogger', 'log']) caps[k].proc.kill('SIGINT');
  await sleep(500);
  return {
    eslogger: Buffer.concat(caps.eslogger.out),
    esloggerErr: caps.eslogger.err.slice(0, 400),
    log: Buffer.concat(caps.log.out),
    ps: Buffer.concat(caps.ps.out),
  };
}

function scan(cap, token) {
  const esloggerErr = cap.esloggerErr.trim();
  return {
    eslogger: cap.eslogger.includes(token),
    log: cap.log.includes(token),
    ps: cap.ps.includes(token),
    esloggerBytes: cap.eslogger.length,
    esloggerErr: esloggerErr || undefined,
    // A run only counts if eslogger was demonstrably alive for it.
    captureLive: cap.eslogger.length > 0 && !esloggerErr,
  };
}

function asUser(cmd, args) {
  // Under sudo, run the hand-off as the real user in their GUI session.
  if (process.getuid?.() === 0 && process.env.SUDO_UID) {
    return ['/bin/launchctl', ['asuser', process.env.SUDO_UID, '/usr/bin/sudo', '-u', process.env.SUDO_USER, cmd, ...args]];
  }
  return [cmd, args];
}

function runHelper(bin, input) {
  const [c, a] = asUser(bin, []);
  const r = spawnSync(c, a, { input: `${JSON.stringify(input)}\n`, encoding: 'utf8', timeout: 70_000 });
  try {
    return JSON.parse(r.stdout.trim().split('\n').pop());
  } catch {
    return { ok: false, status: r.status, stderr: (r.stderr ?? '').slice(0, 300) };
  }
}

export default async function probe(ctx) {
  if (ctx.platform !== 'darwin') return { verdict: 'partial', evidence: { skipped: `${ctx.platform}: the Windows half (WebView2/Edge private channel) is the Windows parity phase (P8-D78)` } };
  const root = process.getuid?.() === 0;
  const home = root && process.env.SUDO_USER ? `/Users/${process.env.SUDO_USER}` : os.homedir();
  const work = mkdtempSync(path.join(os.tmpdir(), 'gnomon-p07-'));
  const helperBin = path.join(work, 'launch-helper');
  bindSignal(ctx.signal);
  const done = onAbort(() => {
    // SIGINT first (sudo relays it to eslogger, which then releases its ES
    // client cleanly), SIGKILL whatever is still alive after a short grace.
    // Synchronous: this can run from a signal handler.
    for (const p of LIVE) p.kill('SIGINT');
    const alive = (p) => {
      try {
        process.kill(p.pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const deadline = Date.now() + 1500;
    const pause = new Int32Array(new SharedArrayBuffer(4));
    while ([...LIVE].some(alive) && Date.now() < deadline) Atomics.wait(pause, 0, 0, 50);
    for (const p of LIVE) if (alive(p)) p.kill('SIGKILL');
    rmSync(work, { recursive: true, force: true });
  }, ctx.signal);
  try {
    return await body();
  } finally {
    done();
  }

  async function body() {
  const prereq = { root, eslogger: existsSync('/usr/bin/eslogger'), sudoCached: root || spawnSync('/usr/bin/sudo', ['-n', 'true']).status === 0, browsers: BROWSERS.filter((b) => existsSync(b.app)).map((b) => b.name) };
  try {
    execFileSync('/usr/bin/xcrun', ['swiftc', '-O', path.join(ctx.probeDir, 'LaunchHelper.swift'), '-o', helperBin], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000 });
    // Under `sudo node …` the work dir is root's mkdtemp (0700); the helper runs
    // as $SUDO_USER, so open the dir and binary for traversal/exec.
    chmodSync(work, 0o755);
    chmodSync(helperBin, 0o755);
    prereq.helperBuilt = true;
  } catch (e) {
    prereq.helperBuilt = false;
    prereq.helperError = String(e.stderr ?? e.message).slice(0, 400);
  }
  try {
    readdirSync(path.join(home, 'Library/Safari'));
    prereq.fullDiskAccess = true;
  } catch (e) {
    prereq.fullDiskAccess = e.code === 'ENOENT' ? 'unknown (no Safari dir)' : false;
  }
  if (!interactive()) {
    return { verdict: 'partial', evidence: { notRun: 'interactive founder probe — run it in a terminal', prerequisites: prereq, howTo: 'sudo -v && node packages/gnomon/probes/run.mjs p07-launch-token --timeout 3600000' } };
  }
  if (!prereq.helperBuilt || !prereq.eslogger) return { verdict: 'partial', evidence: { blocked: 'helper build or eslogger missing', prerequisites: prereq } };
  say('P07 launch-token probe. You will quit and reopen browsers when asked; everything else is automatic.');
  if (!prereq.sudoCached) {
    await ask('eslogger needs root. Press Enter, then type your Mac password at the sudo prompt that follows (it is cached for this terminal only).');
    spawnSync('/usr/bin/sudo', ['-v'], { stdio: 'inherit' });
    prereq.sudoCached = spawnSync('/usr/bin/sudo', ['-n', 'true']).status === 0;
  }
  if (prereq.fullDiskAccess === false) {
    await ask('Your terminal lacks Full Disk Access (eslogger and the Safari history read need it): System Settings → Privacy & Security → Full Disk Access → enable your terminal app, then QUIT and reopen the terminal and re-run this probe. Press Enter to continue anyway (results will be partial).');
  }
  const server = await startServer({ files: new Map([['/index.html', PAGE], ['/p07.js', PAGE_JS]]) });
  const tokens = [];
  const runs = [];
  try {
    const mk = (label) => {
      const t = { token: randomBytes(32).toString('base64url'), run: randomBytes(6).toString('hex'), label };
      tokens.push(t);
      return { ...t, url: `${server.origin}/?run=${t.run}#launch=${t.token}&k=p07-probe` };
    };
    const first = BROWSERS.find((b) => existsSync(b.app));
    // Positive control: token on open's argv.
    await ask(`CONTROL. Press Enter. ${first.name} will open a page (the CONTROL run deliberately puts the token on a command line, to prove the capture works).`);
    const c = mk(`control:${first.name}`);
    const caps = startCaptures(work, 'control', root);
    await sleep(1500);
    const [oc, oa] = asUser('/usr/bin/open', ['-a', first.app, c.url]);
    spawnSync(oc, oa, { timeout: 30_000 });
    const crep = await server.waitReport(c.run, 30_000);
    const ccap = await stopCaptures(caps);
    const control = { browser: first.name, delivered: !!crep?.hasToken, seen: scan(ccap, c.token), token: sha(c.token) };
    runs.push({ kind: 'control', ...control });

    for (const b of BROWSERS) {
      if (!existsSync(b.app)) {
        runs.push({ kind: 'skip', browser: b.name, reason: 'not installed' });
        continue;
      }
      const pending = await ask(`${b.name}: is an UPDATE pending (a "Relaunch to update" / "Update" badge or menu item)? Type y or n.`);
      for (const mode of ['cold', 'warm']) {
        await ask(mode === 'cold'
          ? `${b.name} COLD: quit ${b.name} completely now (Cmd-Q; for Chrome also check no window remains). Press Enter when it is closed.`
          : `${b.name} WARM: leave ${b.name} OPEN (it should still be running from the cold run). Press Enter.`);
        const running = spawnSync('/usr/bin/pgrep', ['-x', b.proc]).status === 0;
        const t = mk(`${mode}:${b.name}`);
        const cp = startCaptures(work, `${b.name}-${mode}`, root);
        await sleep(1500);
        const h = runHelper(helperBin, { url: t.url, app: b.app });
        const rep = await server.waitReport(t.run, 45_000);
        const cap = await stopCaptures(cp);
        runs.push({ kind: 'test', browser: b.name, mode, updatePending: /^y/i.test(pending), runningBefore: running, helper: { ok: h.ok, app: h.app, error: h.error ?? undefined }, delivered: !!rep?.hasToken, seen: scan(cap, t.token), token: sha(t.token) });
        process.stderr.write(`   ${b.name} ${mode}: delivered=${!!rep?.hasToken} argv(eslogger)=${scan(cap, t.token).eslogger} ps=${scan(cap, t.token).ps}\n`);
      }
    }
    await ask('LAST STEP. Quit Safari, Chrome and Firefox now (Cmd-Q each) so they write their history and session files. Wait 5 seconds, then press Enter.');
    await sleep(3000);
    const { files, errors } = historyFiles(home);
    const historyHits = grepFiles(files, tokens, home);
    const tests = runs.filter((r) => r.kind === 'test');
    const argvLeak = tests.some((r) => r.seen.eslogger || r.seen.ps);
    const controlOk = control.seen.eslogger && control.seen.captureLive;
    const allDelivered = tests.length > 0 && tests.every((r) => r.delivered);
    const allLive = tests.length > 0 && tests.every((r) => r.seen.captureLive);
    const updatePendingCovered = tests.some((r) => r.updatePending);
    const coldReallyCold = tests.filter((r) => r.mode === 'cold').every((r) => !r.runningBefore);
    const gaps = [];
    if (!controlOk) gaps.push('positive control not seen by a live eslogger');
    if (!allDelivered) gaps.push('a run did not deliver the token to the page');
    if (!allLive) gaps.push('eslogger was dead (no bytes or stderr) for at least one run');
    if (!updatePendingCovered) gaps.push('no run with an update pending');
    if (!coldReallyCold) gaps.push('a cold run found the browser already running');
    const verdict = argvLeak ? 'fail' : gaps.length === 0 ? 'pass' : 'partial';
    return {
      verdict,
      evidence: {
        prerequisites: prereq,
        runs,
        controlDetectedOnArgv: controlOk,
        gaps,
        tokenOnAnyArgvInTests: argvLeak,
        history: { filesScanned: files.length, unreadable: errors, hits: historyHits.filter((h) => h.token), errors: historyHits.filter((h) => h.error) },
        note: 'log stream hits are recorded but are not argv; a token in history/session files only is K7 evidence (replay is log-only), not a failure',
      },
      toolVersions: { macOS: spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).stdout.trim() },
    };
  } finally {
    await server.close();
  }
  }
}
