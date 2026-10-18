// p14b-link-fdpass — P14b, macOS half (research paradigm-8/37 "Follow-up
// probe: P14b link-fdpass"; spec §15.5 `link`, §16 link row, §19.1 P14).
// P14 showed SBPL cannot pin a LAN ip ("host must be * or localhost"). The
// alternative: the KERNEL dials the configured ip:port itself and hands the
// connected socket to the gnomon-link child over the IPC channel
// (subprocess.send(msg, socket), SCM_RIGHTS); the child runs deny-default with
// NO network* allow, so it can only speak on sockets it is given.
// Pass requires:
//   (i)   full-duplex on the handed socket, 4 MiB both ways, bytes verified;
//   (ii)  the peer's close is seen by the child;
//   (iii) a second hand-off after a kernel redial works;
//   (iv)  the child's own connect to the SAME ip:port, another port, another
//         host (this Mac's en0 address — local, stated), UDP, listen and
//         unix-socket connect are all EPERM;
//   (v)   file read, home listing and exec are EPERM (as P14).
// Stand-in: the "LAN peer" is a listener this probe starts on 0.0.0.0:P.
// Non-darwin: partial (P14b-w is the Windows parity phase, P8-D78).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { NODE, lanAddress, profileFor } from '../p14-link-outbound/probe.mjs';

export const specRefs = ['§15.5 link', '§16 link row', '§3.9', '§19.1 M1.0 P14', 'research paradigm-8/37 P14b', 'G-LNK-11', 'P8-D74'];

const SIZE = 4 * 1024 * 1024;
const sha = (b) => createHash('sha256').update(b).digest('hex');

const CHILD = `
const net = require('net'), dgram = require('dgram'), fs = require('fs'), cp = require('child_process'), os = require('os'), crypto = require('crypto');
const SIZE = ${SIZE};
const [port, otherPort, lanIp, file, sock] = process.argv.slice(1);
const tcp = (host, p) => new Promise((res) => {
  const s = net.connect({ host, port: Number(p) });
  const t = setTimeout(() => { s.destroy(); res('TIMEOUT'); }, 3000);
  s.on('connect', () => { clearTimeout(t); s.destroy(); res('connected'); });
  s.on('error', (e) => { clearTimeout(t); res(e.code || e.message); });
});
process.on('message', async (m, s) => {
  if (m.cmd === 'big') {
    const h = crypto.createHash('sha256'); let got = 0; const t0 = Date.now(); let wrote = false;
    s.on('data', (d) => { got += d.length; h.update(d); });
    s.on('end', () => { process.send({ cmd: 'big', received: got, sha: h.digest('hex'), sawPeerClose: true, wrote, ms: Date.now() - t0 }); s.destroy(); });
    s.on('error', (e) => process.send({ cmd: 'big', error: e.code || e.message }));
    s.write(Buffer.alloc(SIZE, 0x61), () => { wrote = true; });
  } else if (m.cmd === 'small') {
    let d = '';
    s.on('data', (x) => (d += x));
    s.on('end', () => { process.send({ cmd: 'small', reply: d }); s.destroy(); });
    s.on('error', (e) => process.send({ cmd: 'small', error: e.code || e.message }));
    s.write('ping');
  } else if (m.cmd === 'denies') {
    const out = {};
    out.samePeer = await tcp('127.0.0.1', port);
    out.otherPort = await tcp('127.0.0.1', otherPort);
    out.otherHost = lanIp ? await tcp(lanIp, port) : 'no-lan-ip';
    out.unixSocket = await new Promise((res) => { const c = net.connect(sock); c.on('connect', () => { c.destroy(); res('connected'); }); c.on('error', (e) => res(e.code)); });
    out.udp = await new Promise((res) => { try { const u = dgram.createSocket('udp4'); u.on('error', (e) => { u.close(); res(e.code); }); u.send('x', Number(otherPort), '127.0.0.1', (e) => { u.close(); res(e ? e.code : 'sent'); }); } catch (e) { res(e.code || e.message); } });
    out.listen = await new Promise((res) => { const v = net.createServer(); v.on('error', (e) => res(e.code)); v.listen(0, '127.0.0.1', () => { v.close(); res('listening'); }); });
    try { out.fileRead = fs.readFileSync(file, 'utf8') ? 'read' : 'read-empty'; } catch (e) { out.fileRead = e.code; }
    try { out.homeList = fs.readdirSync(os.homedir()) && 'listed'; } catch (e) { out.homeList = e.code; }
    try { const r = cp.spawnSync('/bin/echo', ['hi'], { encoding: 'utf8' }); out.exec = r.error ? r.error.code : r.status === 0 ? 'ran' : 'status=' + r.status + ' signal=' + r.signal; } catch (e) { out.exec = e.code || e.message; }
    process.send({ cmd: 'denies', out });
  }
});
process.send({ cmd: 'ready' });
`;

const listen = (srv, port, host) => new Promise((r, j) => srv.once('error', j).listen(port, host, () => r(srv.address().port)));
const dial = (port) => new Promise((r, j) => { const s = net.connect({ host: '127.0.0.1', port }); s.once('connect', () => r(s)); s.once('error', j); });

export default async function probe(ctx) {
  if (ctx.platform !== 'darwin') return { verdict: 'partial', evidence: { skipped: `${ctx.platform}: P14b-w (libuv duplication into a restricted-token child, then an AppContainer) is the Windows parity phase (P8-D78)` } };
  const expectBack = sha(Buffer.alloc(SIZE, 0x62));
  const expectFromChild = sha(Buffer.alloc(SIZE, 0x61));
  const peerSaw = [];
  let conns = 0;
  const peer = net.createServer((s) => {
    const i = conns++;
    if (i === 0) {
      const h = createHash('sha256');
      let got = 0;
      s.on('data', (d) => {
        got += d.length;
        h.update(d);
        if (got === SIZE) {
          peerSaw.push({ conn: 0, received: got, shaOk: h.digest('hex') === expectFromChild });
          s.end(Buffer.alloc(SIZE, 0x62)); // write 4 MiB back, then close (ii)
        }
      });
    } else if (i === 1) {
      s.on('data', (d) => {
        peerSaw.push({ conn: 1, got: String(d) });
        s.end('pong');
      });
    } else {
      peerSaw.push({ conn: i, unexpected: true, remote: s.remoteAddress });
      s.destroy();
    }
  });
  const other = net.createServer((s) => {
    peerSaw.push({ otherPortHit: true });
    s.destroy();
  });
  const P = await listen(peer, 0, '0.0.0.0');
  const Q = await listen(other, 0, '127.0.0.1');
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gnomon-p14b-')));
  const file = path.join(dir, 'secret.txt');
  writeFileSync(file, 'p14b-secret');
  const sockPath = path.join(dir, 's.sock');
  const unix = net.createServer((s) => s.destroy());
  await new Promise((r) => unix.listen(sockPath, r));
  const lan = lanAddress();
  const profile = profileFor(null); // deny-default, NO network* allow
  const child = spawn('/usr/bin/sandbox-exec', ['-p', profile, NODE, '-e', CHILD, String(P), String(Q), lan?.address ?? '', file, sockPath], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, OPENSSL_CONF: '/dev/null' },
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const inbox = [];
  const waiters = [];
  child.on('message', (m) => {
    const w = waiters.findIndex((x) => x.cmd === m.cmd);
    if (w >= 0) waiters.splice(w, 1)[0].resolve(m);
    else inbox.push(m);
  });
  const next = (cmd, ms = 30_000) => {
    const i = inbox.findIndex((m) => m.cmd === cmd);
    if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve({ cmd, error: 'TIMEOUT' }), ms);
      waiters.push({ cmd, resolve: (m) => { clearTimeout(t); resolve(m); } });
    });
  };
  const ev = { standIn: `LAN peer = listener on 0.0.0.0:${P}; other port 127.0.0.1:${Q}; other host = this Mac's en0 address (${lan ? lan.name : 'none'}), local`, profile: profile.replace(NODE, '<node>') };
  try {
    const ready = await next('ready', 20_000);
    ev.childStarted = !ready.error;
    if (ready.error) return { verdict: 'fail', evidence: { ...ev, error: 'child did not start under the profile', stderr: stderr.slice(-600) } };

    // (i) + (ii): first hand-off
    const s1 = await dial(P);
    const t1 = Date.now();
    child.send({ cmd: 'big' }, s1);
    const big = await next('big', 60_000);
    ev.i_fullDuplex = { ...big, expectedSha: big.sha === expectBack, sentFromChildOk: peerSaw.find((x) => x.conn === 0)?.shaOk === true, wallMs: Date.now() - t1, ok: big.received === SIZE && big.sha === expectBack && peerSaw.find((x) => x.conn === 0)?.shaOk === true };
    delete ev.i_fullDuplex.sha;
    ev.ii_peerCloseSeen = big.sawPeerClose === true;

    // (iii): kernel redials, second hand-off
    const s2 = await dial(P);
    child.send({ cmd: 'small' }, s2);
    const small = await next('small', 20_000);
    ev.iii_secondHandoff = { reply: small.reply ?? null, error: small.error, ok: small.reply === 'pong' };

    // (iv) + (v): the child's own attempts
    child.send({ cmd: 'denies' });
    const d = (await next('denies', 40_000)).out ?? {};
    const eperm = (v) => typeof v === 'string' && !['connected', 'listening', 'read', 'read-empty', 'listed', 'ran', 'sent', 'TIMEOUT'].includes(v);
    ev.iv_networkDenies = { results: { samePeer: d.samePeer, otherPort: d.otherPort, otherHost: d.otherHost, udp: d.udp, listen: d.listen, unixSocket: d.unixSocket } };
    ev.iv_networkDenies.ok = ['samePeer', 'otherPort', 'udp', 'listen', 'unixSocket'].every((k) => eperm(d[k])) && (d.otherHost === 'no-lan-ip' || eperm(d.otherHost));
    ev.v_otherDenies = { results: { fileRead: d.fileRead, homeList: d.homeList, exec: d.exec }, ok: ['fileRead', 'homeList', 'exec'].every((k) => eperm(d[k])) };
    ev.peerSaw = peerSaw;
    ev.peerConnections = conns;
    const all = ev.i_fullDuplex.ok && ev.ii_peerCloseSeen && ev.iii_secondHandoff.ok && ev.iv_networkDenies.ok && ev.v_otherDenies.ok && conns === 2;
    return { verdict: all ? 'pass' : 'fail', evidence: ev, toolVersions: {} };
  } finally {
    child.kill('SIGKILL');
    peer.close();
    other.close();
    unix.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
