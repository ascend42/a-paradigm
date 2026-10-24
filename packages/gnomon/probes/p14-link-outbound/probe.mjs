// p14-link-outbound — P14, macOS half (spec §19.1 M1.0 P14, §15.5 `link`, §16
// link row, G-LNK-11). Claim: the `link` profile lets the gnomon-link child
// make outbound TCP ONLY to a configured LAN ip:port; connect elsewhere,
// listen, file read and exec are all refused.
//
// Stand-ins (stated in evidence): no second machine is involved. The "LAN peer"
// is a listener this probe starts on 0.0.0.0:P, reached as 127.0.0.1:P (the
// allowed target) and as <this Mac's en0 address>:P (same port, other host —
// the host-pinning case); a second listener on 127.0.0.1:Q is "another port".
//
// Steps:
//   A. Which SBPL host forms compile for `(remote tcp "<host>:<port>")`:
//      a literal LAN ip, 127.0.0.1, localhost, *.
//   B. A default-deny profile allowing only what Node needs to start (read of
//      the node binary, system libraries, /dev/null) plus one outbound rule;
//      inside it a Node child tries: the allowed connect, another port, the
//      same port on another host, UDP, listen, a file read, a home listing,
//      exec, a unix-socket connect. Run once with the best compiling form of
//      the allowed host (literal ip if accepted, else localhost) and once with
//      `*:P` to show what a port-only rule lets through.
// Verdict: pass if a literal-ip rule compiles and every refusal holds; fail
// otherwise — including when SBPL cannot express the LAN ip at all (the claim
// as written then cannot hold; verdictReasons says which part). Non-darwin: partial
// (Windows half is the Windows parity phase, P8-D78).
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const specRefs = ['§15.5 link', '§16 link row', '§3.9', '§19.1 M1.0 P14', 'G-LNK-11', 'P8-D74'];

const SBX = '/usr/bin/sandbox-exec';
const NODE = realpathSync(process.execPath);

const CHILD = `
const net = require('net'), dgram = require('dgram'), fs = require('fs'), cp = require('child_process'), os = require('os');
const [allowHost, allowPort, otherPort, lanIp, file, sock] = process.argv.slice(1);
const out = {};
const tcp = (host, port) => new Promise((res) => {
  const s = net.connect({ host, port: Number(port) });
  const t = setTimeout(() => { s.destroy(); res('TIMEOUT'); }, 3000);
  s.on('connect', () => { clearTimeout(t); s.destroy(); res('connected'); });
  s.on('error', (e) => { clearTimeout(t); res(e.code || e.message); });
});
(async () => {
  out.allowed = await tcp(allowHost, allowPort);
  out.otherPort = await tcp('127.0.0.1', otherPort);
  out.otherHostSamePort = lanIp ? await tcp(lanIp, allowPort) : 'no-lan-ip';
  out.unixSocket = await new Promise((res) => { const s = net.connect(sock); s.on('connect', () => { s.destroy(); res('connected'); }); s.on('error', (e) => res(e.code)); });
  out.udp = await new Promise((res) => { try { const u = dgram.createSocket('udp4'); u.on('error', (e) => { u.close(); res(e.code); }); u.send('x', Number(otherPort), '127.0.0.1', (e) => { u.close(); res(e ? e.code : 'sent'); }); } catch (e) { res(e.code || e.message); } });
  out.listen = await new Promise((res) => { const s = net.createServer(); s.on('error', (e) => res(e.code)); s.listen(0, '127.0.0.1', () => { s.close(); res('listening'); }); });
  try { out.fileRead = fs.readFileSync(file, 'utf8') === 'p14-secret' ? 'read' : 'read-mismatch'; } catch (e) { out.fileRead = e.code; }
  try { out.homeList = fs.readdirSync(os.homedir()).length >= 0 ? 'listed' : '?'; } catch (e) { out.homeList = e.code; }
  try { const r = cp.spawnSync('/bin/echo', ['hi'], { encoding: 'utf8' }); out.exec = r.error ? r.error.code : r.status === 0 && r.stdout.trim() === 'hi' ? 'ran' : 'status=' + r.status + ' signal=' + r.signal; } catch (e) { out.exec = e.code || e.message; }
  process.stdout.write(JSON.stringify(out) + '\\n');
  process.exit(0);
})();
`;

// Node's own non-system dylibs (Homebrew node links libuv, openssl, icu … from
// /opt/homebrew) and its install prefix (libnode via @rpath). A shipped
// gnomon-link is a single SEA, so this list collapses to the binary itself.
function nodeLibs() {
  const out = spawnSync('/usr/bin/otool', ['-L', NODE], { encoding: 'utf8' }).stdout ?? '';
  const libs = out.split('\n').slice(1).map((l) => l.trim().split(' (')[0])
    .filter((p) => p && p.startsWith('/') && !p.startsWith('/usr/lib') && !p.startsWith('/System'))
    .map((p) => { try { return realpathSync(p); } catch { return p; } });
  return { prefix: path.dirname(path.dirname(NODE)), libs };
}

function profileFor(allowRule) {
  // Minimal reads for Node to start (found by bisection on this Mac): its
  // binary + prefix + linked dylibs, the system libraries and dyld cache, the
  // literal "/" directory (Node aborts without it), /dev/null and the random
  // devices; metadata + sysctl reads for libuv. Nothing under $HOME or /tmp.
  const { prefix, libs } = nodeLibs();
  return [
    '(version 1)',
    '(deny default)',
    `(allow process-exec (literal "${NODE}"))`,
    // lib directories, not files: dylibs load siblings via @loader_path
    // Homebrew node pulls a transitive dylib tree through /opt/homebrew/opt
    // symlinks; allow the Homebrew lib trees whole (a harness allowance — the
    // shipped SEA links nothing outside /usr/lib and /System).
    `(allow file-read* (literal "/") (subpath "${prefix}") ${[...new Set(libs.map((l) => path.dirname(l)))].map((d) => `(subpath "${d}")`).join(' ')}${libs.some((l) => l.startsWith('/opt/homebrew/')) ? ' (subpath "/opt/homebrew/opt") (subpath "/opt/homebrew/Cellar")' : ''})`,
    `(allow file-read* (literal "${NODE}") (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random") (subpath "/usr/lib") (subpath "/System/Library") (subpath "/System/Cryptexes") (subpath "/private/var/db/dyld") (subpath "/Library/Apple/System/Library"))`,
    '(allow file-read-metadata)',
    '(allow file-write-data (literal "/dev/null"))',
    '(allow sysctl-read)',
    allowRule ? `(allow network-outbound ${allowRule})` : null,
  ].filter(Boolean).join('\n');
}

// Shared with p14b-link-fdpass (null allowRule = no network* allow at all).
export { profileFor, lanAddress, NODE };

function compiles(rule) {
  const r = spawnSync(SBX, ['-p', `(version 1)(allow default)(deny network-outbound)(allow network-outbound ${rule})`, '/usr/bin/true'], { encoding: 'utf8', timeout: 10_000 });
  return { rule, compiles: r.status === 0, stderr: (r.stderr || '').trim().slice(0, 200) || undefined };
}

function runChild(profile, args) {
  return new Promise((resolve) => {
    // OPENSSL_CONF=/dev/null: Homebrew node otherwise reads
    // /opt/homebrew/etc/openssl@3/openssl.cnf at start (the child's env is the kernel's to set).
    const c = spawn(SBX, ['-p', profile, NODE, '-e', CHILD, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, OPENSSL_CONF: '/dev/null' } });
    let so = '';
    let se = '';
    c.stdout.on('data', (d) => (so += d));
    c.stderr.on('data', (d) => (se += d));
    const t = setTimeout(() => c.kill('SIGKILL'), 30_000);
    c.on('close', (code, signal) => {
      clearTimeout(t);
      let parsed = null;
      try {
        parsed = JSON.parse(so.trim().split('\n').pop());
      } catch {
        // node did not start or crashed — recorded below
      }
      resolve({ code, signal, result: parsed, stderr: se.trim().slice(-600) || undefined });
    });
  });
}

function lanAddress() {
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal && /^(en|bridge)/.test(name)) return { name, address: a.address };
  }
  return null;
}

const listen = (srv, port, host) => new Promise((r, j) => srv.once('error', j).listen(port, host, () => r(srv.address().port)));

export default async function probe(ctx) {
  if (ctx.platform !== 'darwin') {
    return { verdict: 'partial', evidence: { skipped: `${ctx.platform}: the Windows half (S29-08 allow-list, AppContainer privateNetworkClientServer) is the Windows parity phase (P8-D78)` } };
  }
  const hits = [];
  const peer = net.createServer((s) => { hits.push({ remote: s.remoteAddress }); s.destroy(); });
  const other = net.createServer((s) => { hits.push({ other: s.remoteAddress }); s.destroy(); });
  const P = await listen(peer, 0, '0.0.0.0');
  const Q = await listen(other, 0, '127.0.0.1');
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gnomon-p14-')));
  const file = path.join(dir, 'secret.txt');
  writeFileSync(file, 'p14-secret');
  const sock = path.join(dir, 's.sock');
  const unix = net.createServer((s) => s.destroy());
  await new Promise((r) => unix.listen(sock, r));
  const lan = lanAddress();

  try {
    // Every literal-IP spelling SBPL might accept, before concluding only
    // localhost/* compile: remote ip / tcp / tcp4, loopback and LAN literals.
    const literalForms = [];
    for (const host of ['127.0.0.1', lan?.address].filter(Boolean)) {
      for (const kind of ['ip', 'tcp', 'tcp4', 'ip4']) literalForms.push(`(remote ${kind} "${host}:${P}")`);
    }
    const literal = literalForms.map(compiles);
    const forms = [...literal, ...[`(remote tcp "localhost:${P}")`, `(remote tcp "*:${P}")`, `(remote ip "localhost:${P}")`].map(compiles)];
    const firstLiteral = literal.find((f) => f.compiles && f.rule.includes('127.0.0.1'));
    const literalIpOk = literal.some((f) => f.compiles);
    const bestRule = firstLiteral ? firstLiteral.rule : `(remote tcp "localhost:${P}")`;
    const args = ['127.0.0.1', String(P), String(Q), lan?.address ?? '', file, sock];

    const control = await new Promise((resolve) => {
      const c = spawn(NODE, ['-e', CHILD, ...args], { stdio: ['ignore', 'pipe', 'ignore'] });
      let so = '';
      c.stdout.on('data', (d) => (so += d));
      c.on('close', () => { try { resolve(JSON.parse(so.trim())); } catch { resolve({ unparsed: so.slice(0, 300) }); } });
    });
    hits.length = 0;
    const pinned = await runChild(profileFor(bestRule), args);
    const pinnedHits = [...hits];
    hits.length = 0;
    const portOnly = await runChild(profileFor(`(remote tcp "*:${P}")`), args);
    const portOnlyHits = [...hits];

    const refused = (v) => typeof v === 'string' && !['connected', 'listening', 'read', 'read-mismatch', 'listed', 'ran', 'sent'].includes(v);
    const r = pinned.result ?? {};
    const refusals = {
      otherPort: refused(r.otherPort),
      otherHostSamePort: lan ? refused(r.otherHostSamePort) : 'no LAN address',
      udp: refused(r.udp),
      listen: refused(r.listen),
      fileRead: refused(r.fileRead),
      homeList: refused(r.homeList),
      exec: refused(r.exec),
      unixSocket: refused(r.unixSocket),
    };
    // otherHostSamePort uses this Mac's own en0 address — local, not a remote
    // host — so it is reported separately from the refusals that gate.
    const { otherHostSamePort, ...gating } = refusals;
    const allHold = Object.values(gating).every((v) => v === true);
    const allowedWorks = r.allowed === 'connected';
    const reasons = [];
    if (!pinned.result) reasons.push('node did not start under the profile');
    if (!allowedWorks) reasons.push('allowed connect failed');
    if (!allHold) reasons.push('a refusal leaked');
    if (!literalIpOk) reasons.push('the claim as written (allow ONLY a configured LAN ip:port) is not expressible in SBPL: host must be * or localhost');
    const verdict = reasons.length ? 'fail' : 'pass';
    const findings = [];
    if (otherHostSamePort === false) findings.push(`"localhost:${P}" also admitted ${lan?.address}:${P} — this Mac's own en0 address, which SBPL/the kernel treat as local. Not a remote host; a true other-host case needs a second machine.`);
    if (allHold) findings.push('port-scoped refusals all hold under deny-default: other port, UDP, listen, file read, home listing, exec, unix-socket connect (EPERM).');
    if (!literalIpOk) findings.push('SBPL refuses a literal IP host in (remote tcp "<ip>:<port>"): only localhost or * compile. A real LAN peer can be pinned by PORT only in the profile; the host must be enforced elsewhere (the child dialing only root-signed addresses, plus a kernel-side peer check / pf) — §15.5 `link` text needs that caveat.');
    if (portOnly.result?.otherHostSamePort === 'connected') findings.push(`with "*:${P}" the child reached ${lan?.address}:${P} — a port-only rule admits any host on that port.`);

    return {
      verdict,
      evidence: {
        standIns: `no second machine: the LAN peer is a listener on 0.0.0.0:${P} reached as 127.0.0.1:${P} (allowed) and as the en0 address (${lan ? lan.name : 'none'}) on the same port (other host); 127.0.0.1:${Q} is another port; the unix socket and file are in a temp dir`,
        hostForms: forms,
        literalIpCompiles: literalIpOk,
        pinnedRun: { rule: bestRule, ...pinned, serverSaw: pinnedHits },
        refusals: gating,
        ownLanAddressSamePortRefused: otherHostSamePort,
        verdictReasons: reasons,
        allowedConnect: r.allowed,
        portOnlyRun: { rule: `(remote tcp "*:${P}")`, result: portOnly.result, serverSaw: portOnlyHits, stderr: portOnly.stderr },
        unsandboxedControl: control,
        profile: profileFor(bestRule).replace(NODE, '<node>'),
        findings,
      },
      toolVersions: { macOS: spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).stdout.trim() },
    };
  } finally {
    peer.close();
    other.close();
    unix.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
