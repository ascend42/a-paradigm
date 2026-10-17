// p10m-sbx-deny-mac — Arky P10m + Aegis S29-03 + S29-04 (research 29 §2,
// research 30 Part 2). Runs the macOS `session` profile denies under
// `sandbox-exec` and records what actually holds on this machine:
//
//   A. endpoint-port deny: `(deny network-outbound (remote ip "localhost:PORT"))`
//      for curl, Node net.connect and Node's WebSocket; PORT+1 must stay open.
//   B. process-info deny: `(deny process-info*)(allow process-info* (target self))
//      (deny sysctl-read (sysctl-name-prefix "kern.proc"))` — can a sandboxed
//      process see another process's pid / argv / env? (ps, pgrep, lsof, a
//      Node spawn/kill, and a raw KERN_PROCARGS2 read if python3 exists)
//   C. linked-folder write deny and browser-profile read deny (mechanism, on
//      temp dirs; real browser profile dirs are only checked for presence).
//   D. escape matrix (S29-03): same-user unsandboxed services reachable from
//      inside the profile. Only throwaway instances are DRIVEN (a private tmux
//      server, a private screen session, a launchd job that curls our own
//      throwaway server); the user's real sockets are only connect()ed and
//      closed (docker gets a read-only GET /_ping). Nothing is installed.
//
// Not done here (cost): a real `claude -p` Bash turn inside the profile — that
// is recorded as pending-manual.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const specRefs = [
  '§11.2 rule 2b',
  '§15.1 row 19',
  '§15.5 session',
  '§16 session denies row',
  '§19.1 M1.0 P10m / S29-03 + S29-04',
  'G-SBX-08',
  'OPEN 5',
  'research 29 §2 P10m',
  'research 30 S29-03',
  'research 30 S29-04',
];

const SBX = '/usr/bin/sandbox-exec';
const NODE = process.execPath;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const trunc = (s, n = 600) => (s && s.length > n ? `${s.slice(0, n)}…[${s.length} chars]` : s ?? '');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: opts.timeout ?? 15_000, input: opts.input, env: opts.env });
  return { status: r.status, signal: r.signal, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error?.message };
}

function runAsync(cmd, args, opts = {}) {
  // Async variant so our own in-process HTTP servers keep serving while the
  // sandboxed client runs (spawnSync would block the event loop).
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const t = setTimeout(() => child.kill('SIGKILL'), opts.timeout ?? 15_000);
    child.on('close', (status, signal) => {
      clearTimeout(t);
      resolve({ status, signal, stdout, stderr });
    });
  });
}

const sbx = (profile, cmd, args, opts) => runAsync(SBX, ['-p', profile, cmd, ...args], opts);
const brief = (r) => ({ status: r.status, signal: r.signal, stdout: trunc(r.stdout.trim()), stderr: trunc(r.stderr.trim()) });

function lastJson(text) {
  const line = text.trim().split('\n').filter(Boolean).pop();
  try {
    return JSON.parse(line);
  } catch {
    return { unparsed: trunc(text) };
  }
}

// ---------------------------------------------------------------- servers

function listen(server, port, host) {
  return new Promise((resolve) => {
    server.once('error', (e) => resolve(e));
    server.listen(port, host, () => resolve(null));
  });
}

async function startServers(hits) {
  const make = () => {
    const s = http.createServer((req, res) => {
      hits.push({ port: s.address().port, url: req.url, at: Date.now() });
      res.end('ok');
    });
    s.on('upgrade', (req, socket) => {
      hits.push({ port: s.address().port, url: `ws:${req.url}`, at: Date.now() });
      const { createHash } = globalThis.__crypto;
      const accept = createHash('sha1')
        .update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest('base64');
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    });
    return s;
  };
  for (let attempt = 0; attempt < 20; attempt++) {
    const a = make();
    await listen(a, 0, '127.0.0.1');
    const port = a.address().port;
    const b = make();
    if ((await listen(b, port + 1, '127.0.0.1')) === null) {
      const v6 = make();
      const v6err = await listen(v6, port, '::1');
      return { a, b, v6: v6err ? null : v6, port, v6err: v6err?.code };
    }
    a.close();
  }
  throw new Error('could not bind an adjacent port pair');
}

// ------------------------------------------------------- client snippets

const NET_CLIENT = `
const [host, port] = process.argv.slice(1);
const s = require('net').connect({ host, port: Number(port) });
const done = (o) => { console.log(JSON.stringify(o)); process.exit(0); };
s.on('connect', () => { s.destroy(); done({ connected: true }); });
s.on('error', (e) => done({ connected: false, code: e.code, message: e.message }));
setTimeout(() => done({ connected: false, code: 'TIMEOUT' }), 4000);
`;

const WS_CLIENT = `
const [url] = process.argv.slice(1);
const done = (o) => { console.log(JSON.stringify(o)); process.exit(0); };
const ws = new WebSocket(url);
ws.onopen = () => { ws.close(); done({ open: true }); };
ws.onerror = (e) => done({ open: false, error: String(e.message ?? e.error?.cause?.code ?? e.type) });
setTimeout(() => done({ open: false, error: 'TIMEOUT' }), 4000);
`;

const UNIX_CLIENT = `
const [p, ping] = process.argv.slice(1);
const s = require('net').connect(p);
const done = (o) => { console.log(JSON.stringify(o)); process.exit(0); };
let buf = '';
s.on('connect', () => {
  if (ping === 'docker') { s.write('GET /_ping HTTP/1.0\\r\\nHost: docker\\r\\n\\r\\n'); }
  else { s.destroy(); done({ connected: true }); }
});
s.on('data', (d) => { buf += d; });
s.on('end', () => done({ connected: true, response: buf.split('\\r\\n')[0], body: buf.split('\\r\\n\\r\\n')[1] }));
s.on('error', (e) => done({ connected: false, code: e.code }));
setTimeout(() => done({ connected: buf.length > 0, code: 'TIMEOUT', partial: buf.slice(0, 80) }), 4000);
`;

const NODE_PROC_CLIENT = `
const { spawn, execFileSync } = require('child_process');
const [markerPid, marker] = process.argv.slice(1);
const out = {};
try { process.kill(Number(markerPid), 0); out.signal0ToOther = 'allowed'; } catch (e) { out.signal0ToOther = e.code; }
try { out.psInNode = execFileSync('/bin/ps', ['-axww', '-o', 'pid=,command='], { encoding: 'utf8' }).split('\\n').some((l) => l.trim().startsWith(markerPid + ' ') && l.includes(marker)) ? 'markerVisible' : 'markerHidden'; }
catch (e) { out.psInNode = 'error:' + (e.code ?? '') + ':' + String(e.message).split('\\n')[0]; }
try { out.pgrepInNode = execFileSync('/usr/bin/pgrep', ['-fl', marker], { encoding: 'utf8' }).split('\\n').some((l) => l.startsWith(markerPid + ' ')) ? 'markerVisible' : 'markerHidden'; }
catch (e) { out.pgrepInNode = 'error:status=' + e.status; }
const c = spawn('/bin/sleep', ['30']);
out.childSpawned = typeof c.pid === 'number';
c.on('exit', (code, sig) => { out.childExit = { code, sig }; console.log(JSON.stringify(out)); });
setTimeout(() => { out.childKillReturned = c.kill('SIGTERM'); }, 200);
`;

// python3 (if present) reads another process's KERN_PROCARGS2 directly —
// argv AND environment — to show what any non-setuid tool could do.
const PY_PROCARGS = `
import ctypes, ctypes.util, sys, json
libc = ctypes.CDLL(ctypes.util.find_library('c'), use_errno=True)
pid = int(sys.argv[1])
mib = (ctypes.c_int * 3)(1, 49, pid)  # CTL_KERN, KERN_PROCARGS2
size = ctypes.c_size_t(0)
r = libc.sysctl(mib, 3, None, ctypes.byref(size), None, 0)
if r != 0:
    print(json.dumps({"ok": False, "errno": ctypes.get_errno(), "stage": "size"})); sys.exit(0)
buf = ctypes.create_string_buffer(size.value)
r = libc.sysctl(mib, 3, buf, ctypes.byref(size), None, 0)
if r != 0:
    print(json.dumps({"ok": False, "errno": ctypes.get_errno(), "stage": "read"})); sys.exit(0)
raw = buf.raw[:size.value]
print(json.dumps({"ok": True, "bytes": len(raw), "argvMarker": sys.argv[2].encode() in raw, "envMarker": sys.argv[3].encode() in raw}))
`;

// ------------------------------------------------------------------ probe

export default async function probe(ctx) {
  if (ctx.platform !== 'darwin') {
    return { verdict: 'fail', evidence: { skipped: 'macOS-only probe', platform: ctx.platform } };
  }
  globalThis.__crypto = await import('node:crypto');
  const rand = randomBytes(4).toString('hex');
  const evidence = {
    macOS: run('sw_vers', ['-productVersion']).stdout.trim(),
    build: run('sw_vers', ['-buildVersion']).stdout.trim(),
    kernel: os.release(),
    sandboxExec: existsSync(SBX),
  };
  const toolVersions = {
    macOS: evidence.macOS,
    curl: run('curl', ['--version']).stdout.split('\n')[0],
  };

  const hits = [];
  const { a, b, v6, port, v6err } = await startServers(hits);
  // Short socket dirs under /private/tmp (unix socket paths are capped at 104 bytes).
  const work = realpathSync(os.tmpdir());
  const root = path.join(work, `gnomon-p10m-${rand}`);
  const sockRoot = `/private/tmp/gp10m-${rand}`;
  const deniedDir = path.join(root, 'linked-denied');
  const allowedDir = path.join(root, 'allowed');
  const browserDir = path.join(root, 'browser-profile');
  const sockDenied = path.join(sockRoot, 'deny');
  const sockAllowed = path.join(sockRoot, 'allow');
  for (const d of [deniedDir, allowedDir, browserDir, sockDenied, sockAllowed]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(browserDir, 'History'), 'secret-history');

  const ownUnix = [];
  const cleanups = [];
  let marker;
  try {
    // ---------------------------------------------------- A. port deny
    const portProfile = `(version 1)(allow default)(deny network-outbound (remote ip "localhost:${port}"))`;
    const curl = (p, host = '127.0.0.1') =>
      sbx(portProfile, '/usr/bin/curl', ['-sS', '-m', '4', '-o', '/dev/null', '-w', '%{http_code}', `http://${host}:${p}/curl-${p}`]);
    const nodeNet = (p, host = '127.0.0.1') => sbx(portProfile, NODE, ['-e', NET_CLIENT, host, String(p)]);
    const nodeWs = (p) => sbx(portProfile, NODE, ['-e', WS_CLIENT, `ws://127.0.0.1:${p}/ws-${p}`]);

    const curlDenied = await curl(port);
    const curlAllowed = await curl(port + 1);
    const netDenied = lastJson((await nodeNet(port)).stdout);
    const netAllowed = lastJson((await nodeNet(port + 1)).stdout);
    const wsDenied = lastJson((await nodeWs(port)).stdout);
    const wsAllowed = lastJson((await nodeWs(port + 1)).stdout);
    const netV6 = v6 ? lastJson((await nodeNet(port, '::1')).stdout) : { skipped: `::1 bind failed: ${v6err}` };
    const unsandboxedControl = lastJson(run(NODE, ['-e', NET_CLIENT, '127.0.0.1', String(port)]).stdout);
    const portDeny = {
      profile: portProfile,
      port,
      curl: {
        deniedPort: { ...brief(curlDenied), httpCode: curlDenied.stdout.trim() },
        portPlus1: { ...brief(curlAllowed), httpCode: curlAllowed.stdout.trim() },
      },
      nodeNet: { deniedPort: netDenied, portPlus1: netAllowed, ipv6LoopbackSamePort: netV6 },
      nodeWebSocket: { deniedPort: wsDenied, portPlus1: wsAllowed },
      unsandboxedControlToDeniedPort: unsandboxedControl,
      serverHitsOnDeniedPortSoFar: hits.filter((h) => h.port === port).length,
    };
    const portDenyHolds =
      curlDenied.status !== 0 &&
      curlAllowed.stdout.trim() === '200' &&
      netDenied.connected === false &&
      netAllowed.connected === true &&
      wsDenied.open === false &&
      wsAllowed.open === true &&
      unsandboxedControl.connected === true &&
      portDeny.serverHitsOnDeniedPortSoFar === 0;
    portDeny.holds = portDenyHolds;
    evidence.portDeny = portDeny;

    // ------------------------------------------- B. process-info deny
    const pinfoRules = '(deny process-info*)(allow process-info* (target self))(deny sysctl-read (sysctl-name-prefix "kern.proc"))';
    const sessionProfile =
      `(version 1)(allow default)` +
      `(deny network-outbound (remote ip "localhost:${port}"))` +
      pinfoRules +
      `(deny file-write* (subpath "${deniedDir}"))` +
      `(deny file-read* (subpath "${browserDir}"))`;
    evidence.sessionProfile = sessionProfile;

    marker = `gnomon-probe-marker-${rand}`;
    const envMarker = `GNOMON_PROBE_ENV_${rand}`;
    const markerProc = spawn(NODE, ['-e', 'setTimeout(()=>{},120000)', marker], {
      stdio: 'ignore',
      env: { ...process.env, GNOMON_PROBE_SECRET: envMarker },
    });
    cleanups.push(() => markerProc.kill('SIGKILL'));
    await sleep(300);
    const mpid = String(markerProc.pid);

    const shellChecks = (prof) => sbx(prof, '/bin/sh', ['-c', shellChecksScript(marker, mpid)]);
    const parseShell = (r) => {
      const t = r.stdout;
      const grab = (re) => (t.match(re) ?? [])[1];
      return {
        psAxwwMarkerLines: grab(/ps_axww:\n([^\n]*)\n/),
        psStderr: trunc(r.stderr.split('\n').find((l) => l.includes('/bin/ps')) ?? ''),
        pgrepFlFoundMarker: new RegExp(`^\\s*${mpid} .*${marker}`, 'm').test(t),
        pgrepRc: grab(/pgrep_rc=(\d+)/),
        pgrepProcessCount: Number(grab(/pgrep_count:\n\s*(\d+)/)),
        lsofOther: trunc(grab(/lsof:\n([\s\S]*?)lsof_rc=/)?.trim() ?? ''),
        launchctlListPidRows: Number(grab(/launchctl_list_pids:\n\s*(\d+)/)),
        ownChildKill0: /kill0_child=ok/.test(t),
        ownChildWaitRc: grab(/wait_rc=(\d+)/),
      };
    };
    const unsandboxedShell = parseShell(await runAsync('/bin/sh', ['-c', shellChecksScript(marker, mpid)]));
    const sandboxedShell = parseShell(await shellChecks(sessionProfile));
    const allowDefaultOnly = parseShell(await shellChecks('(version 1)(allow default)'));
    const nodeProc = lastJson((await sbx(sessionProfile, NODE, ['-e', NODE_PROC_CLIENT, mpid, marker])).stdout);

    // Alternative rule sets — does ANY sysctl-read formulation hide argv from pgrep?
    // (pgrep carries the com.apple.sysmond.client entitlement and asks the root
    // sysmond daemon for the process table over XPC, so sysctl rules miss it.)
    const SYSMOND_DENY = '(deny mach-lookup (global-name "com.apple.sysmond"))';
    const pgrepVisible = (r) => r.stdout.split('\n').some((l) => l.startsWith(`${mpid} `));
    const variants = {};
    for (const [name, extra] of Object.entries({
      'kern.procargs prefix': '(deny sysctl-read (sysctl-name-prefix "kern.procargs"))',
      'kern.procargs2 exact': '(deny sysctl-read (sysctl-name "kern.procargs2"))',
      'kern. prefix': '(deny sysctl-read (sysctl-name-prefix "kern."))',
      'sysmond mach-lookup deny': SYSMOND_DENY,
    })) {
      const prof = `(version 1)(allow default)${pinfoRules}${extra}`;
      const r = await sbx(prof, '/usr/bin/pgrep', ['-fl', marker]);
      variants[name] = { pgrepRc: r.status, markerVisible: pgrepVisible(r), stderr: trunc(r.stderr.trim(), 200) };
    }
    const pgrepEntitlements = trunc(run('/usr/bin/codesign', ['-d', '--entitlements', '-', '/usr/bin/pgrep']).stdout.trim(), 300);

    // Hardened = the as-specified session profile + the sysmond deny.
    const hardenedProfile = `${sessionProfile}${SYSMOND_DENY}`;
    const hardenedShell = parseShell(await shellChecks(hardenedProfile));
    const hardenedNode = lastJson((await sbx(hardenedProfile, NODE, ['-e', NODE_PROC_CLIENT, mpid, marker])).stdout);

    const pyProcargs = { skipped: 'python3 not found' };
    const py = ['/usr/bin/python3', '/usr/local/bin/python3', '/opt/homebrew/bin/python3'].find((p) => existsSync(p));
    if (py) {
      delete pyProcargs.skipped;
      pyProcargs.python = py;
      const pyRun = async (prof) => {
        const args = ['-I', '-c', PY_PROCARGS, mpid, marker, envMarker];
        const r = prof ? await sbx(prof, py, args) : await runAsync(py, args);
        return { ...lastJson(r.stdout), stderr: trunc(r.stderr.trim(), 200) };
      };
      pyProcargs.unsandboxed = await pyRun(null);
      pyProcargs.allowDefaultOnly = await pyRun('(version 1)(allow default)');
      pyProcargs.processInfoOnly = await pyRun('(version 1)(allow default)(deny process-info*)(allow process-info* (target self))');
      pyProcargs.sysctlKernProcOnly = await pyRun('(version 1)(allow default)(deny sysctl-read (sysctl-name-prefix "kern.proc"))');
      pyProcargs.sessionProfile = await pyRun(sessionProfile);
    }

    const argvHiddenUnder = (sh, nd) =>
      !sh.pgrepFlFoundMarker && nd.pgrepInNode !== 'markerVisible' && nd.psInNode !== 'markerVisible';
    const argvHidden = argvHiddenUnder(sandboxedShell, nodeProc) && pyProcargs.sessionProfile?.argvMarker !== true;
    const argvHiddenHardened = argvHiddenUnder(hardenedShell, hardenedNode) && pyProcargs.sessionProfile?.argvMarker !== true;
    evidence.processInfoDeny = {
      rules: pinfoRules,
      markerPid: mpid,
      unsandboxedControl: unsandboxedShell,
      sessionProfile: sandboxedShell,
      allowDefaultOnlyProfile: allowDefaultOnly,
      nodeInsideSessionProfile: nodeProc,
      pgrepUnderAlternativeRules: variants,
      pgrepEntitlements,
      hardenedProfileAddition: SYSMOND_DENY,
      hardenedShell,
      hardenedNode,
      kernProcargs2ViaPython: pyProcargs,
      otherProcessArgvHidden: argvHidden,
      otherProcessArgvHiddenWithSysmondDeny: argvHiddenHardened,
      notes: [
        '/bin/ps is setuid root on macOS; sandbox-exec refuses to exec setuid binaries under ANY profile (even allow default), so ps "denial" is not evidence of the process-info rule.',
        'pgrep (entitlement com.apple.sysmond.client) gets the process table incl. argv from the root sysmond daemon over XPC, so neither process-info* nor any sysctl-read rule hides it; a mach-lookup deny of com.apple.sysmond does.',
        'Direct sysctl KERN_PROCARGS2 (python ctypes) is denied under the full session profile; see kernProcargs2ViaPython for which rule does it.',
      ],
    };

    // ------------------------------------------ C. write/read denies
    const fsScript = (p) => `require('fs').writeFileSync(${JSON.stringify(p)}, 'x'); console.log('wrote')`;
    const wDenied = await sbx(sessionProfile, NODE, ['-e', fsScript(path.join(deniedDir, 'f.txt'))]);
    const wAllowed = await sbx(sessionProfile, NODE, ['-e', fsScript(path.join(allowedDir, 'f.txt'))]);
    const shDenied = await sbx(sessionProfile, '/bin/sh', ['-c', `echo x > ${deniedDir}/g.txt`]);
    const rBrowser = await sbx(sessionProfile, '/bin/cat', [path.join(browserDir, 'History')]);
    const home = os.homedir();
    const browserProfiles = Object.fromEntries(
      Object.entries({
        safari: 'Library/Safari',
        chrome: 'Library/Application Support/Google/Chrome',
        edge: 'Library/Application Support/Microsoft Edge',
        firefox: 'Library/Application Support/Firefox',
        arc: 'Library/Application Support/Arc',
      }).map(([k, rel]) => [k, existsSync(path.join(home, rel))]),
    );
    const fsDeny = {
      linkedFolderWrite: {
        nodeDenied: brief(wDenied),
        shellDenied: brief(shDenied),
        allowedDirWrite: brief(wAllowed),
        deniedFileExists: existsSync(path.join(deniedDir, 'f.txt')) || existsSync(path.join(deniedDir, 'g.txt')),
      },
      browserProfileRead: { denied: brief(rBrowser) },
      realBrowserProfileDirsPresent: browserProfiles,
    };
    fsDeny.holds =
      wDenied.status !== 0 &&
      shDenied.status !== 0 &&
      !fsDeny.linkedFolderWrite.deniedFileExists &&
      wAllowed.status === 0 &&
      rBrowser.status !== 0 &&
      !rBrowser.stdout.includes('secret-history');
    evidence.fsDeny = fsDeny;

    // ------------------------------------------------- D. escape matrix
    const escape = {};
    const hitCount = (tag) => hits.filter((h) => h.port === port && h.url.includes(tag)).length;
    const waitHit = async (tag, ms) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (hitCount(tag) > 0) return true;
        await sleep(100);
      }
      return false;
    };

    // Each escape is driven twice: an UNSANDBOXED control arm (proves the route
    // works on this machine at all) and the arm inside the session profile.
    const drive = async (tag, profile, cmd, args, env) => {
      const r = await new Promise((resolve) => {
        const argv = profile ? [SBX, ['-p', profile, cmd, ...args]] : [cmd, args];
        const c = spawn(argv[0], argv[1], { env: env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        c.stdout.on('data', (d) => (stdout += d));
        c.stderr.on('data', (d) => (stderr += d));
        const t = setTimeout(() => c.kill('SIGKILL'), 15_000);
        c.on('close', (status, signal) => {
          clearTimeout(t);
          resolve({ status, signal, stdout, stderr });
        });
      });
      return { ...brief(r), reachedDeniedPort: await waitHit(tag, 6000) };
    };
    const url = (tag) => `http://127.0.0.1:${port}/${tag}`;

    // D1. launchd: `launchctl submit` (launchd would run the job unsandboxed).
    {
      const label = (k) => `com.gnomon.probe.p10m.${rand}.${k}`;
      const sub = (k, prof) => drive(`esc-launchd-${k}-${rand}`, prof, '/bin/launchctl', ['submit', '-l', label(k), '--', '/usr/bin/curl', '-s', '-m', '3', url(`esc-launchd-${k}-${rand}`)]);
      const inSession = await sub('session', sessionProfile);
      const control = await sub('control', null);
      for (const k of ['session', 'control']) run('/bin/launchctl', ['remove', label(k)]);
      escape.launchctlSubmit = { control, inSession };
    }

    // D1b. LaunchServices: `open` a throwaway background .app whose executable
    // curls the denied port (stand-in for "open a browser at the endpoint",
    // with no UI). Unregistered from LaunchServices afterwards.
    {
      const app = path.join(root, `GnomonProbe${rand}.app`);
      mkdirSync(path.join(app, 'Contents/MacOS'), { recursive: true });
      writeFileSync(
        path.join(app, 'Contents/Info.plist'),
        `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleExecutable</key><string>run</string><key>CFBundleIdentifier</key><string>com.gnomon.probe.p10m.${rand}</string><key>CFBundlePackageType</key><string>APPL</string><key>LSBackgroundOnly</key><true/><key>LSUIElement</key><true/></dict></plist>\n`,
      );
      // The tag is baked into the script per launch: `open --args` from inside a
      // sandbox-exec profile drops the arguments (observed; recorded below).
      const exe = path.join(app, 'Contents/MacOS/run');
      const LSREG = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
      cleanups.push(() => run(LSREG, ['-u', app]));
      const launch = (k, prof) => {
        const tag = `esc-open-${k}-${rand}`;
        writeFileSync(exe, `#!/bin/sh\n/usr/bin/curl -s -m 3 "http://127.0.0.1:${port}/${tag}?arg=$1"\n`, { mode: 0o755 });
        return drive(tag, prof, '/usr/bin/open', ['-g', '-j', '-n', app, '--args', 'argv-survived']);
      };
      const inSession = await launch('session', sessionProfile);
      const control = await launch('control', null);
      const argSeen = (k) => hits.find((h) => h.url.includes(`esc-open-${k}-${rand}`))?.url.includes('arg=argv-survived') ?? null;
      escape.launchServicesOpenApp = { control, inSession, openArgsSurvived: { control: argSeen('control'), inSession: argSeen('session') } };
      // Candidate fix rules — does denying the LaunchServices mach services stop it?
      escape.launchServicesOpenApp.fixCandidates = {};
      for (const [i, rule] of [
        '(deny mach-lookup (global-name "com.apple.coreservices.launchservicesd"))',
        '(deny mach-lookup (global-name-prefix "com.apple.lsd."))',
      ].entries()) {
        const r = await launch(`fix${i}`, `${sessionProfile}${rule}`);
        escape.launchServicesOpenApp.fixCandidates[rule] = { openStatus: r.status, reachedDeniedPort: r.reachedDeniedPort };
      }
    }

    // D2. tmux: a PRIVATE throwaway server (never the user's) driven from inside.
    const tmux = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'].find((p) => existsSync(p));
    if (tmux) {
      const sockDir = path.join(sockRoot, 'tmux');
      mkdirSync(sockDir, { recursive: true });
      const sock = path.join(sockDir, 's');
      const started = run(tmux, ['-S', sock, '-f', '/dev/null', 'new-session', '-d', '-s', 'gp', '/bin/sh']);
      cleanups.push(() => run(tmux, ['-S', sock, 'kill-server']));
      await sleep(500);
      const keys = (k, prof) => drive(`esc-tmux-${k}-${rand}`, prof, tmux, ['-S', sock, 'send-keys', '-t', 'gp', `/usr/bin/curl -s -m 3 ${url(`esc-tmux-${k}-${rand}`)}`, 'Enter']);
      const control = await keys('control', null);
      const inSession = await keys('session', sessionProfile);
      // Proposed fix form: deny unix-socket connects to the tmux socket dir.
      const withFix = await keys('fixed', `${sessionProfile}(deny network-outbound (remote unix-socket (subpath "${sockDir}")))`);
      escape.tmuxPrivateServer = { tmux: run(tmux, ['-V']).stdout.trim(), started: started.status === 0, control, inSession, withUnixSocketDenyRule: withFix };
      toolVersions.tmux = escape.tmuxPrivateServer.tmux;
    } else {
      escape.tmuxPrivateServer = { present: false };
    }
    escape.userTmuxDefaultSocket = { path: `/private/tmp/tmux-${process.getuid()}/default`, present: existsSync(`/private/tmp/tmux-${process.getuid()}/default`) };

    // D3. GNU screen: private throwaway session in a private SCREENDIR.
    if (existsSync('/usr/bin/screen')) {
      const name = `gp${rand}`;
      const screenDir = path.join(sockRoot, 'screen');
      mkdirSync(screenDir, { recursive: true, mode: 0o700 });
      const env = { ...process.env, SCREENDIR: screenDir };
      const started = run('/usr/bin/screen', ['-dmS', name, '/bin/sh'], { env });
      cleanups.push(() => run('/usr/bin/screen', ['-S', name, '-X', 'quit'], { env }));
      await sleep(800);
      const stuff = (k, prof) => drive(`esc-screen-${k}-${rand}`, prof, '/usr/bin/screen', ['-S', name, '-p', '0', '-X', 'stuff', `/usr/bin/curl -s -m 3 ${url(`esc-screen-${k}-${rand}`)}\n`], env);
      const control = await stuff('control', null);
      const inSession = await stuff('session', sessionProfile);
      escape.screenPrivateSession = { version: run('/usr/bin/screen', ['-v']).stdout.trim(), started: started.status === 0, control, inSession };
    } else {
      escape.screenPrivateSession = { present: false };
    }

    // D4. The user's real same-user sockets: presence + connect() reachability only.
    const tmpdir = process.env.TMPDIR ?? os.tmpdir();
    const candidates = [];
    const addIf = (kind, p, mode) => {
      if (p && existsSync(p)) candidates.push({ kind, path: p, mode });
    };
    addIf('docker', path.join(home, '.docker/run/docker.sock'), 'docker');
    addIf('docker(/var/run)', '/var/run/docker.sock', 'docker');
    addIf('docker(orbstack)', path.join(home, '.orbstack/run/docker.sock'), 'docker');
    addIf('docker(colima)', path.join(home, '.colima/default/docker.sock'), 'docker');
    addIf('ssh-agent', process.env.SSH_AUTH_SOCK, 'connect');
    const scanDir = (kind, dir, re, depth = 1) => {
      try {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (re.test(e.name)) {
            try {
              if (statSync(p).isSocket()) candidates.push({ kind, path: p, mode: 'connect' });
            } catch {
              // ignore races
            }
          } else if (depth > 0 && e.isDirectory()) scanDir(kind, p, re, depth - 1);
        }
      } catch {
        // dir absent
      }
    };
    scanDir('vscode-ipc', tmpdir, /^vscode-ipc-.*\.sock$/, 0);
    scanDir('vscode-main', path.join(home, 'Library/Application Support/Code'), /-main\.sock$/, 0);
    scanDir('cursor-main', path.join(home, 'Library/Application Support/Cursor'), /-main\.sock$/, 0);
    scanDir('cursor-ipc', tmpdir, /^cursor-ipc-.*\.sock$/, 0);
    scanDir('chrome-singleton', tmpdir, /^SingletonSocket$/, 1);
    const userSockets = [];
    for (const c of candidates) {
      const r = lastJson((await sbx(sessionProfile, NODE, ['-e', UNIX_CLIENT, c.path, c.mode])).stdout);
      const reach = r.connected === true ? 'yes' : r.code === 'ECONNREFUSED' ? 'no-listener' : r.code === 'EPERM' || r.code === 'EACCES' ? 'denied' : `unknown:${r.code}`;
      userSockets.push({ kind: c.kind, path: c.path.replace(home, '~'), reachableFromSession: reach, detail: r });
    }
    escape.userSocketsReachability = userSockets;
    escape.notTested = [
      '`ssh -L` through ssh-agent (needs an ssh server; agent socket reachability recorded above)',
      '`open` of a real browser at the endpoint (would open user-visible windows; D1b uses a background stand-in app instead)',
      'osascript / Apple Events to Terminal or iTerm (would drive the user\'s apps; TCC-gated)',
    ];

    // D5. Mechanism check for the proposed unix-socket fix rule on our own sockets.
    for (const [k, dir] of [['denied', sockDenied], ['allowed', sockAllowed]]) {
      const s = net.createServer((c) => c.end());
      await new Promise((r) => s.listen(path.join(dir, 's'), r));
      ownUnix.push(s);
      const prof = `(version 1)(allow default)(deny network-outbound (remote unix-socket (subpath "${sockDenied}")))`;
      escape[`unixSocketDenyRule_${k}`] = lastJson((await sbx(prof, NODE, ['-e', UNIX_CLIENT, path.join(dir, 's'), 'connect'])).stdout);
    }
    evidence.escapeMatrix = escape;

    // ------------------------------------------------------- verdict
    const escapesFound = [
      escape.launchctlSubmit?.inSession?.reachedDeniedPort && 'launchctl submit (launchd runs the job unsandboxed)',
      escape.launchServicesOpenApp?.inSession?.reachedDeniedPort && 'open (LaunchServices launches an app unsandboxed, which reaches the denied port)',
      escape.tmuxPrivateServer?.inSession?.reachedDeniedPort && 'tmux send-keys to an unsandboxed tmux server',
      escape.screenPrivateSession?.inSession?.reachedDeniedPort && 'screen -X stuff to an unsandboxed screen session',
      ...userSockets.filter((s) => s.reachableFromSession === 'yes').map((s) => `${s.kind} socket reachable (${s.path})`),
    ].filter(Boolean);
    evidence.escapesFound = escapesFound;
    evidence.claudeCompat = {
      status: 'pending-manual',
      step: 'Run a real `claude -p` turn that uses the Bash tool (incl. spawning and killing a child, and `ps`) under the session profile above; record whether Claude works. Skipped here for cost. Note: /bin/ps (setuid) cannot be exec\'d under any sandbox-exec profile on this machine, so a Bash tool call that runs ps will fail regardless of process-info rules.',
    };

    const summary = {
      portDenyHolds,
      otherProcessArgvHiddenAsSpecified: argvHidden,
      otherProcessArgvHiddenWithSysmondDeny: argvHiddenHardened,
      fsDenyHolds: fsDeny.holds,
      escapesFound: escapesFound.length,
      claudeCompat: 'pending-manual',
    };
    evidence.summary = summary;
    // fail  = a denial the spec relies on does not hold as specified;
    // partial = the denies hold but escapes/residuals exist or Claude-compat is pending.
    const verdict = !portDenyHolds || !fsDeny.holds || !argvHidden ? 'fail' : 'partial';
    return { verdict, evidence, toolVersions };
  } finally {
    for (const c of cleanups.reverse()) {
      try {
        c();
      } catch {
        // best effort
      }
    }
    for (const s of ownUnix) s.close();
    a.close();
    b.close();
    v6?.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(sockRoot, { recursive: true, force: true });
  }
}

// Same shell checks, unsandboxed (the control arm).
function shellChecksScript(marker, mpid) {
  return [
    `echo "ps_axww:"; /bin/ps -axww -o pid=,command= 2>/dev/null | awk '$1 == ${mpid}' | grep -c ${marker}; echo "ps_rc=$?"`,
    `echo "pgrep_fl:"; /usr/bin/pgrep -fl ${marker}; echo "pgrep_rc=$?"`,
    `echo "pgrep_count:"; /usr/bin/pgrep -l . | wc -l`,
    `echo "lsof:"; /usr/sbin/lsof -p ${mpid} 2>&1 | head -2; echo "lsof_rc=$?"`,
    `echo "launchctl_list_pids:"; /bin/launchctl list 2>/dev/null | awk '$1 ~ /^[0-9]+$/' | wc -l`,
    `echo "own_child:"; /bin/sleep 30 & C=$!; kill -0 $C && echo "kill0_child=ok"; kill $C; wait $C; echo "wait_rc=$?"`,
  ].join('; ');
}
