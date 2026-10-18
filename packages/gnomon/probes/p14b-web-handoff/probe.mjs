// p14b-web-handoff — P14b-web, macOS half (T-2026-10-18-020; spec §15.5
// transport row, §11.2 rule 1, §A.7; the P14b pattern from research
// paradigm-8/37 applied to the INBOUND side).
// The transport child's old profile allowed network-bind/-inbound on
// (local ip "localhost:*"), and SBPL `localhost` in a `local` filter matches
// every configured interface (0.0.0.0, ::, the LAN address), so a compromised
// child could listen on the LAN while holding the GUI session token.
// The alternative: the KERNEL listens on 127.0.0.1 (IPv4 literal, OS-chosen
// port, pauseOnConnect), accepts each connection and hands the connected
// socket to the child over the IPC channel (subprocess.send('conn', socket),
// SCM_RIGHTS). The child runs deny-default with NO network-* rule.
// Pass requires:
//   (i)   full duplex on a handed socket, 4 MiB both ways, bytes verified;
//   (ii)  the peer's (client's) close is seen by the child;
//   (iii) repeated hand-offs (several more accepted connections) work;
//   (iv)  inside the child: bind/listen on 0.0.0.0, ::, the en0 address,
//         127.0.0.1 and ::1, UDP bind on each, listen() with no host (the
//         implicit bind of an unbound socket), outbound TCP connect (to the
//         kernel's own listener and to another port) and unix-socket connect
//         are all EPERM;
//   (v)   an unsandboxed control run of the same child code reaches every
//         target, so an EPERM above is the sandbox's answer.
// Non-darwin: partial (the Windows transport profile is the parity phase, P8-D78).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { NODE, lanAddress, profileFor } from '../p14-link-outbound/probe.mjs';

export const specRefs = ['§15.5 transport', '§11.2 rule 1', '§A.7', '§19.1 M1.0 P14b-web', 'research paradigm-8/37 P14b', 'T-2026-10-18-020', 'T-2026-10-18-017'];

const SIZE = 4 * 1024 * 1024;
const REPEATS = 5;
const sha = (b) => createHash('sha256').update(b).digest('hex');

const CHILD = `
const net = require('net'), dgram = require('dgram'), crypto = require('crypto');
const SIZE = ${SIZE};
const [kport, otherPort, lanIp, sock] = process.argv.slice(1);
const tcp = (host, p) => new Promise((res) => {
  const s = net.connect({ host, port: Number(p) });
  const t = setTimeout(() => { s.destroy(); res('TIMEOUT'); }, 3000);
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
let mode = 'big';
process.on('message', async (m, s) => {
  if (m === 'conn') {
    if (!s) return process.send({ cmd: 'conn', error: 'no-socket' });
    if (mode === 'big') {
      mode = 'small';
      const h = crypto.createHash('sha256'); let got = 0; let wrote = false;
      s.on('data', (d) => { got += d.length; h.update(d); });
      s.on('end', () => { process.send({ cmd: 'big', received: got, sha: h.digest('hex'), sawPeerClose: true, wrote, remote: s.remoteAddress, local: s.localAddress }); s.end(); });
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
    out.connect_kernel = await tcp('127.0.0.1', kport);
    out.connect_other = await tcp('127.0.0.1', otherPort);
    out.unixSocket = await new Promise((res) => { const c = net.connect(sock); c.on('connect', () => { c.destroy(); res('connected'); }); c.on('error', (e) => res(e.code)); });
    process.send({ cmd: 'denies', out });
  }
});
process.send({ cmd: 'ready' });
`;

const listen = (srv, port, host) => new Promise((r, j) => srv.once('error', j).listen(port, host, () => r(srv.address().port)));
const dial = (port) => new Promise((r, j) => { const s = net.connect({ host: '127.0.0.1', port }); s.once('connect', () => r(s)); s.once('error', j); });

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

export default async function probe(ctx) {
  if (ctx.platform !== 'darwin') return { verdict: 'partial', evidence: { skipped: `${ctx.platform}: the Windows transport profile (AppContainer without internetClientServer/privateNetworkClientServer) is the Windows parity phase (P8-D78)` } };
  const other = net.createServer((s) => s.destroy());
  const Q = await listen(other, 0, '127.0.0.1');
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gnomon-p14bw-')));
  const sockPath = path.join(dir, 's.sock');
  const unix = net.createServer((s) => s.destroy());
  await new Promise((r) => unix.listen(sockPath, r));
  const lan = lanAddress();
  const profile = profileFor(null); // deny-default, NO network-* rule at all

  // The kernel's listener: IPv4 literal, OS-chosen port, pauseOnConnect so
  // the kernel never reads a byte (accept-and-forward only).
  let target = null;
  let accepted = 0;
  const kernel = net.createServer({ pauseOnConnect: true }, (s) => {
    accepted++;
    if (target) target.send('conn', s);
    else s.destroy();
  });
  const P = await listen(kernel, 0, '127.0.0.1');
  const childArgs = (port) => ['-e', CHILD, String(port), String(Q), lan?.address ?? '', sockPath];

  // Unsandboxed control: same child code, no profile — every target reachable.
  const control = await new Promise((resolve) => {
    const c = spawn(NODE, childArgs(P), { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const t = setTimeout(() => { c.kill('SIGKILL'); resolve({ error: 'TIMEOUT' }); }, 40_000);
    c.on('message', (m) => {
      if (m.cmd === 'ready') c.send({ cmd: 'denies' });
      if (m.cmd === 'denies') { clearTimeout(t); c.kill('SIGKILL'); resolve(m.out); }
    });
  });
  const acceptedDuringControl = accepted;
  accepted = 0;
  const reachableValue = (k) => (k.startsWith('listen_') ? 'listening' : k.startsWith('udpbind_') ? 'bound' : 'connected');
  const controlOk = Object.entries(control).every(([k, v]) => v === reachableValue(k) || v === 'no-lan-ip');

  const child = spawn('/usr/bin/sandbox-exec', ['-p', profile, NODE, ...childArgs(P)], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, OPENSSL_CONF: '/dev/null' },
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const next = harness(child);
  const ev = { design: `kernel listens on 127.0.0.1:${P} (pauseOnConnect), hands each accepted socket to the child via subprocess.send('conn', socket)`, lan: lan ? lan.name : 'none', profile: profile.replace(NODE, '<node>') };
  try {
    const ready = await next('ready', 20_000);
    ev.childStarted = !ready.error;
    if (ready.error) return { verdict: 'fail', evidence: { ...ev, error: 'child did not start under the profile', stderr: stderr.slice(-600) } };
    target = child;

    // (i) + (ii): the client dials the kernel; the kernel hands off; 4 MiB each way
    const expectFromChild = sha(Buffer.alloc(SIZE, 0x61));
    const expectAtChild = sha(Buffer.alloc(SIZE, 0x62));
    const c1 = await dial(P);
    const t1 = Date.now();
    const clientSide = new Promise((resolve) => {
      const h = createHash('sha256');
      let got = 0;
      let done = false;
      c1.on('data', (d) => {
        got += d.length;
        h.update(d);
        if (got === SIZE && !done) { done = true; resolve({ received: got, shaOk: h.digest('hex') === expectFromChild }); }
      });
      c1.on('error', (e) => resolve({ error: e.code }));
    });
    c1.write(Buffer.alloc(SIZE, 0x62), () => c1.end()); // write 4 MiB, then half-close (ii)
    const [cs, big] = await Promise.all([clientSide, next('big', 60_000)]);
    ev.i_fullDuplex = { clientReceived: cs.received, clientShaOk: cs.shaOk, childReceived: big.received, childShaOk: big.sha === expectAtChild, wrote: big.wrote, childSawRemote: big.remote, childSawLocal: big.local, wallMs: Date.now() - t1, error: big.error ?? cs.error };
    ev.i_fullDuplex.ok = cs.received === SIZE && cs.shaOk === true && big.received === SIZE && big.sha === expectAtChild;
    ev.ii_peerCloseSeen = big.sawPeerClose === true;
    c1.destroy();

    // (iii): repeated hand-offs
    const reps = [];
    for (let i = 0; i < REPEATS; i++) {
      const c = await dial(P);
      const reply = new Promise((resolve) => { let d = ''; c.on('data', (x) => (d += x)); c.on('end', () => resolve(d)); c.on('error', (e) => resolve('ERR:' + e.code)); });
      c.write(`ping${i}\n`);
      const r = await reply;
      c.end();
      const seen = await next('small', 20_000);
      reps.push({ i, reply: r, childGot: seen.got, peerClose: seen.sawPeerClose === true, ok: r === `pong:ping${i}` && seen.got === `ping${i}` && seen.sawPeerClose === true });
    }
    ev.iii_repeatedHandoffs = { count: REPEATS, reps, ok: reps.every((r) => r.ok) };

    // (iv): the child's own attempts — exactly EPERM (the sandbox's answer)
    child.send({ cmd: 'denies' });
    const d = (await next('denies', 60_000)).out ?? {};
    ev.iv_networkDenies = { results: d, ok: Object.keys(d).length > 0 && Object.values(d).every((v) => v === 'EPERM' || v === 'no-lan-ip') };
    ev.kernelAccepted = accepted;
    ev.v_unsandboxedControl = { results: control, acceptedDuringControl, ok: controlOk };
    const all = controlOk && ev.i_fullDuplex.ok && ev.ii_peerCloseSeen && ev.iii_repeatedHandoffs.ok && ev.iv_networkDenies.ok && accepted === 1 + REPEATS;
    return { verdict: all ? 'pass' : 'fail', evidence: ev, toolVersions: {} };
  } finally {
    child.kill('SIGKILL');
    kernel.close();
    other.close();
    unix.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
