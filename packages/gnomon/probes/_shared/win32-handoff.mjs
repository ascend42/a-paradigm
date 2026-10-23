// P14b-w — the Windows half of P14b (link-fdpass, outbound) and P14b-web
// (web-handoff, inbound). docs/plans/gnomon-windows.md W1/W5.
//
// Question: can the kernel hand a TCP socket to a CONFINED child the way the
// win32 transport does it (src/kernel/sandbox/transport.ts win32Transport)?
//   1. the kernel (this process) spawns node directly with an IPC channel and a
//      near-empty env ({SystemRoot});
//   2. the SAME process runs `gnomon-helper once` with `process.confine {pid}`
//      (Low integrity + a job with ACTIVE_PROCESS=1, DIE_ON_UNHANDLED_EXCEPTION
//      and every UI limit) and sends the child nothing before the reply, as
//      helper-client.ts helperOp does (the helper refuses `not-a-child` for a
//      pid that is not this process's direct child);
//   3. the kernel accepts (inbound) or dials (outbound) a socket and hands it
//      over with child.send('conn', socket) (libuv WSADuplicateSocketW into the
//      child's pid); 4 MiB both ways, the peer's close, 5 more hand-offs;
//   4. inside the confined child: what it can still do on its own — listen,
//      UDP bind, connect (loopback, LAN, internet), a named pipe the kernel
//      owns, spawning a process, writing a Medium-labelled file.
// An unconfined control run of the same child code shows each target is
// reachable without confinement. AppContainer (the profile that would deny
// the network) is not built; that is recorded as a field, not skipped.
// Zero deps; the helper is called exactly as helper-client.ts calls it.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 4 * 1024 * 1024;
const REPEATS = 5;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const NODE = realpathSync.native(process.execPath);
const HELPER = fileURLToPath(new URL('../../../gnomon-helper/bin/win32/gnomon-helper.exe', import.meta.url));
const SYSROOT = process.env.SystemRoot ?? 'C:\\Windows';
const INTERNET = { host: '1.1.1.1', port: 443 };
const trace = (m) => { if (process.env.P14BW_TRACE) process.stderr.write(`p14b-w: ${m}
`); };

function lanAddress() {
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (/^vEthernet|^Loopback/i.test(name)) continue;
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) return { name, address: a.address };
  }
  return null;
}

const CHILD = `
const net = require('net'), dgram = require('dgram'), fs = require('fs'), cp = require('child_process'), crypto = require('crypto'), path = require('path');
const SIZE = ${SIZE};
const [kport, otherPort, lanIp, pipeName, mediumDir, inetHost, inetPort] = process.argv.slice(1);
const tcp = (host, p) => new Promise((res) => {
  const s = net.connect({ host, port: Number(p) });
  const t = setTimeout(() => { s.destroy(); res('TIMEOUT'); }, 4000);
  s.on('connect', () => { clearTimeout(t); s.destroy(); res('connected'); });
  s.on('error', (e) => { clearTimeout(t); res(e.code || e.message); });
});
const lst = (host) => new Promise((res) => {
  const v = net.createServer();
  v.on('error', (e) => res(e.code || e.message));
  const done = () => { v.close(); res('listening'); };
  if (host === null) v.listen(0, done); else v.listen(0, host, done);
});
const ubind = (type, host) => new Promise((res) => {
  try { const u = dgram.createSocket(type); u.on('error', (e) => { try { u.close(); } catch {} res(e.code || e.message); }); u.bind(0, host, () => { u.close(); res('bound'); }); } catch (e) { res(e.code || e.message); }
});
const attempt = (f) => { try { return f(); } catch (e) { return e.code || e.message; } };
let mode = 'big';
process.on('message', async (m, s) => {
  if (m === 'conn') {
    if (!s) return process.send({ cmd: 'conn', error: 'no-socket' });
    if (mode === 'big') {
      mode = 'small';
      const h = crypto.createHash('sha256'); let got = 0; let wrote = false;
      s.on('data', (d) => { got += d.length; h.update(d); });
      s.on('end', () => { process.send({ cmd: 'big', received: got, sha: h.digest('hex'), sawPeerClose: true, wrote, remote: s.remoteAddress + ':' + s.remotePort, local: s.localAddress + ':' + s.localPort }); s.end(); });
      s.on('error', (e) => process.send({ cmd: 'big', error: e.code || e.message }));
      s.write(Buffer.alloc(SIZE, 0x61), () => { wrote = true; });
    } else {
      let d = '';
      s.on('data', (x) => { d += x; if (d.endsWith('\\n')) s.end('pong:' + d.trim()); });
      s.on('end', () => process.send({ cmd: 'small', got: d.trim(), sawPeerClose: true }));
      s.on('error', (e) => process.send({ cmd: 'small', error: e.code || e.message }));
    }
  } else if (m && m.cmd === 'denies') {
    const out = {};
    out.listen_0000 = await lst('0.0.0.0');
    out.listen_v6any = await lst('::');
    out.listen_lan = lanIp ? await lst(lanIp) : 'no-lan-ip';
    out.listen_loop4 = await lst('127.0.0.1');
    out.listen_loop6 = await lst('::1');
    out.listen_nohost = await lst(null);
    out.udpbind_0000 = await ubind('udp4', '0.0.0.0');
    out.udpbind_v6any = await ubind('udp6', '::');
    out.udpbind_lan = lanIp ? await ubind('udp4', lanIp) : 'no-lan-ip';
    out.udpbind_loop4 = await ubind('udp4', '127.0.0.1');
    out.connect_kernelPort = await tcp('127.0.0.1', kport);
    out.connect_otherLoopbackPort = await tcp('127.0.0.1', otherPort);
    out.connect_lan = lanIp ? await tcp(lanIp, otherPort) : 'no-lan-ip';
    out.connect_internet = await tcp(inetHost, inetPort);
    out.namedPipe = await new Promise((res) => { const c = net.connect(pipeName); c.on('connect', () => { c.destroy(); res('connected'); }); c.on('error', (e) => res(e.code || e.message)); });
    out.spawn = attempt(() => { const r = cp.spawnSync(process.env.SystemRoot + '\\\\System32\\\\cmd.exe', ['/d', '/c', 'exit 0'], { timeout: 5000 }); return r.error ? (r.error.code || r.error.message) + ' errno ' + r.error.errno : 'spawned(status ' + r.status + ')'; });
    out.writeMediumDir = attempt(() => { fs.writeFileSync(path.join(mediumDir, 'child-wrote.txt'), 'x'); return 'written'; });
    out.readMediumFile = attempt(() => { fs.readFileSync(path.join(mediumDir, 'kernel.txt')); return 'read'; });
    process.send({ cmd: 'denies', out });
  }
});
process.send({ cmd: 'ready' });
`;

const listen = (srv, port, host) => new Promise((r, j) => srv.once('error', j).listen(port, host, () => r(srv.address().port)));
const dial = (port, host = '127.0.0.1') => new Promise((r, j) => { const s = net.connect({ host, port }); s.once('connect', () => r(s)); s.once('error', j); });

function harness(child) {
  const inbox = [];
  const waiters = [];
  child.on('message', (m) => {
    const w = waiters.findIndex((x) => x.cmd === m.cmd);
    if (w >= 0) waiters.splice(w, 1)[0].resolve(m);
    else inbox.push(m);
  });
  return (cmd, ms = 30_000) => {
    const i = inbox.findIndex((m) => m.cmd === cmd);
    if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve({ cmd, error: 'TIMEOUT' }), ms);
      waiters.push({ cmd, resolve: (m) => { clearTimeout(t); resolve(m); } });
    });
  };
}

// helper-client.ts helperOp, mirrored: `gnomon-helper once`, one JSON line in, the first non-empty line out.
function helperOp(op, args, timeoutMs = 15_000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const h = spawn(HELPER, ['once'], { env: { SystemRoot: SYSROOT, PATH: path.win32.join(SYSROOT, 'System32') }, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => { h.kill(); resolve({ ok: false, error: 'timeout' }); }, timeoutMs);
    h.stdout.setEncoding('utf8');
    h.stdout.on('data', (d) => (out += d));
    h.once('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: 'spawn', message: e.message }); });
    h.once('close', () => {
      clearTimeout(timer);
      const line = out.split('\n').find((l) => l.trim() !== '') ?? '';
      try { resolve({ ...JSON.parse(line), ms: Date.now() - t0 }); } catch { resolve({ ok: false, error: 'protocol', raw: line.slice(0, 300) }); }
    });
    h.stdin.on('error', () => {});
    h.stdin.end(`${JSON.stringify({ id: 1, op, ...args })}\n`);
  });
}

const childEnv = { SystemRoot: SYSROOT };

/** mode 'inbound' = P14b-web (kernel accepts), 'outbound' = P14b link (kernel dials the peer). */
export async function win32Handoff(mode) {
  const ev = {
    mode,
    design:
      mode === 'inbound'
        ? "kernel listens on 127.0.0.1 (pauseOnConnect), hands each accepted socket to the confined child via child.send('conn', socket)"
        : "kernel dials the peer paused (stand-in: a listener on 127.0.0.1) and hands the connected socket to the confined child via child.send('conn', socket)",
    confinement: 'gnomon-helper process.confine {pid}: Low integrity + job (ACTIVE_PROCESS=1, DIE_ON_UNHANDLED_EXCEPTION, UI limits); the win32Transport profile',
    ...(mode === 'outbound' ? { kernelDialMustBePaused: 'measured while writing this arm: a socket the kernel dials with plain net.connect starts reading at connect, so bytes the peer sends before the child takes the handle are consumed in the kernel and lost (the repeat hand-offs hung); dialing with socket.pause() before connect leaves them in the OS buffer and the duplicated handle delivers them' } : {}),
    appContainer: { built: false, note: 'no AppContainer/LPAC profile exists yet (W5 open item); nothing below is an AppContainer measurement' },
  };
  if (!existsSync(HELPER)) return { verdict: 'fail', evidence: { ...ev, error: `no helper at ${HELPER}` } };
  ev.helper = { path: 'packages/gnomon-helper/bin/win32/gnomon-helper.exe', sha256: sha(readFileSync(HELPER)) };

  const lan = lanAddress();
  ev.lan = lan ? lan.name : 'none';
  const dir = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'gnomon-p14bw-')));
  writeFileSync(path.join(dir, 'kernel.txt'), 'kernel');
  const pipeName = `\\\\.\\pipe\\gnomon-p14bw-${process.pid}-${Date.now()}`;
  const pipe = net.createServer((s) => s.destroy());
  await new Promise((r) => pipe.listen(pipeName, r));
  const other = net.createServer((s) => s.destroy());
  const Q = await listen(other, 0, '0.0.0.0');

  // the socket source: inbound = the kernel's listener; outbound = the peer the kernel dials
  let target = null;
  let accepted = 0;
  const peerConns = [];
  const kernel =
    mode === 'inbound'
      ? net.createServer({ pauseOnConnect: true }, (s) => { accepted++; if (target) target.send('conn', s); else s.destroy(); })
      : net.createServer((s) => { accepted++; peerConns.push(s); });
  const P = await listen(kernel, 0, '127.0.0.1');
  const childArgs = ['-e', CHILD, String(P), String(Q), lan?.address ?? '', pipeName, dir, INTERNET.host, String(INTERNET.port)];
  const reachable = (k) => (k.startsWith('listen_') ? 'listening' : k.startsWith('udpbind_') ? 'bound' : k === 'spawn' ? 'spawned(status 0)' : k === 'writeMediumDir' ? 'written' : k === 'readMediumFile' ? 'read' : 'connected');

  trace('control start');
  // Unconfined control: same child code, same env, no confine.
  const control = await new Promise((resolve) => {
    const c = spawn(NODE, childArgs, { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: childEnv, windowsHide: true });
    const t = setTimeout(() => { c.kill(); resolve({ error: 'TIMEOUT' }); }, 60_000);
    c.on('message', (m) => {
      if (m.cmd === 'ready') c.send({ cmd: 'denies' });
      if (m.cmd === 'denies') { clearTimeout(t); c.kill(); resolve(m.out); }
    });
  });
  rmSync(path.join(dir, 'child-wrote.txt'), { force: true });
  const acceptedDuringControl = accepted;
  accepted = 0;
  peerConns.splice(0).forEach((s) => s.destroy());
  ev.v_unconfinedControl = { results: control, acceptedDuringControl, everyTargetReachable: Object.entries(control).every(([k, v]) => v === reachable(k) || v === 'no-lan-ip') };

  trace('control done');
  const child = spawn(NODE, childArgs, { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: childEnv, windowsHide: true });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const next = harness(child);
  try {
    const ready = await next('ready', 20_000);
    ev.childStarted = !ready.error;
    if (ready.error) return { verdict: 'fail', evidence: { ...ev, error: 'child did not start', stderr: stderr.slice(-600) } };

    trace('child ready');
    // confine BEFORE the kernel sends anything (transport.ts: "before the kernel sends the config")
    const c = await helperOp('process.confine', { pid: child.pid });
    ev.confine = { reply: c, integrityReadBack: c.integrity ?? null, low: c.ok === true && c.integrity === '0x1000' };
    if (!ev.confine.low) return { verdict: 'fail', evidence: { ...ev, error: 'process.confine did not confine the child', stderr: stderr.slice(-600) } };
    target = child;

    const getSocket = async () => {
      if (mode === 'inbound') return dial(P); // the client; the kernel's listener hands its accepted end over
      // the kernel dials the peer PAUSED (no readStart, so no byte is read in the kernel) and hands its end over
      const k = await new Promise((r, j) => { const x = net.connect({ host: '127.0.0.1', port: P }); x.pause(); x.once('connect', () => r(x)); x.once('error', j); });
      await new Promise((r) => setTimeout(r, 50));
      const peer = peerConns.shift();
      child.send('conn', k);
      return peer;
    };

    trace('confined');
    // (i) + (ii): 4 MiB each way, then the far end half-closes
    const expectFromChild = sha(Buffer.alloc(SIZE, 0x61));
    const expectAtChild = sha(Buffer.alloc(SIZE, 0x62));
    const t1 = Date.now();
    const far = await getSocket();
    const farSide = new Promise((resolve) => {
      const h = createHash('sha256');
      let got = 0;
      let done = false;
      far.on('data', (d) => { got += d.length; h.update(d); if (got === SIZE && !done) { done = true; resolve({ received: got, shaOk: h.digest('hex') === expectFromChild }); } });
      far.on('error', (e) => resolve({ error: e.code }));
    });
    far.write(Buffer.alloc(SIZE, 0x62), () => far.end());
    const [fs_, big] = await Promise.all([farSide, next('big', 60_000)]);
    ev.i_fullDuplex = { farReceived: fs_.received, farShaOk: fs_.shaOk, childReceived: big.received, childShaOk: big.sha === expectAtChild, childSawRemote: big.remote, childSawLocal: big.local, wallMs: Date.now() - t1, error: big.error ?? fs_.error };
    ev.i_fullDuplex.ok = fs_.received === SIZE && fs_.shaOk === true && big.received === SIZE && big.sha === expectAtChild;
    ev.ii_peerCloseSeen = big.sawPeerClose === true;
    far.destroy();

    trace('big done');
    // (iii): repeated hand-offs
    const reps = [];
    for (let i = 0; i < REPEATS; i++) {
      const s = await getSocket();
      const reply = new Promise((resolve) => { let d = ''; s.on('data', (x) => (d += x)); s.on('end', () => resolve(d)); s.on('error', (e) => resolve('ERR:' + e.code)); });
      s.write(`ping${i}\n`);
      const r = await Promise.race([reply, new Promise((res) => setTimeout(() => res('TIMEOUT'), 20_000))]);
      s.end();
      const seen = await next('small', 20_000);
      reps.push({ i, reply: r, childGot: seen.got, peerClose: seen.sawPeerClose === true, ok: r === `pong:ping${i}` && seen.got === `ping${i}` && seen.sawPeerClose === true });
    }
    ev.iii_repeatedHandoffs = { count: REPEATS, reps, ok: reps.every((r) => r.ok) };

    trace('reps done');
    // (iv): what the confined child can still do on its own (stop handing off first: its own
    // connect to the kernel's port must not be forwarded back to it)
    const handedOff = accepted;
    target = null;
    child.send({ cmd: 'denies' });
    const d = (await next('denies', 90_000)).out ?? {};
    const allowed = Object.entries(d).filter(([k, v]) => v === reachable(k)).map(([k]) => k);
    const denied = Object.entries(d).filter(([k, v]) => v !== reachable(k) && v !== 'no-lan-ip').map(([k, v]) => `${k}:${v}`);
    ev.iv_confinedChild = {
      results: d,
      stillAllowed: allowed,
      denied,
      newListenSocketDenied: Object.entries(d).filter(([k]) => k.startsWith('listen_')).every(([, v]) => v !== 'listening'),
      outboundDenied: ['connect_kernelPort', 'connect_otherLoopbackPort', 'connect_lan', 'connect_internet'].every((k) => d[k] !== 'connected'),
      spawnDenied: d.spawn !== reachable('spawn'),
      writeMediumDenied: d.writeMediumDir !== 'written',
    };
    ev.kernelAccepted = handedOff;
    ev.childStderr = stderr.slice(-600);
    const handoff = ev.i_fullDuplex.ok && ev.ii_peerCloseSeen && ev.iii_repeatedHandoffs.ok && handedOff === 1 + REPEATS;
    const networkContained = ev.iv_confinedChild.newListenSocketDenied && ev.iv_confinedChild.outboundDenied;
    ev.summary = {
      handoffWorksUnderConfine: handoff,
      confinedLow: ev.confine.low,
      networkContained,
      spawnDenied: ev.iv_confinedChild.spawnDenied,
      controlReachedEveryTarget: ev.v_unconfinedControl.everyTargetReachable,
      verdictRule: 'pass needs the hand-off under confine AND the child unable to open its own sockets; Low integrity + job does not deny the network (that is WFP, P10w, or an AppContainer), so a working hand-off is partial',
    };
    const verdict = !handoff || !ev.confine.low ? 'fail' : networkContained && ev.iv_confinedChild.spawnDenied ? 'pass' : 'partial';
    return { verdict, evidence: ev, toolVersions: {} };
  } finally {
    child.kill();
    kernel.close();
    other.close();
    pipe.close();
    peerConns.forEach((s) => s.destroy());
    await new Promise((r) => setTimeout(r, 200));
    rmSync(dir, { recursive: true, force: true });
  }
}
