/**
 * @symbol #client-conformance
 *
 * #client-conformance runner (spec §12.8, §19.1 M1.12, G-CLI-02): drives a
 * client through the driver protocol (driver.ts) against a LIVE kernel and
 * runs every `CONFORMANCE_CHECKS` entry whose status is `run`; `slice-2`
 * entries are reported `todo`, never as a pass. The report carries
 * `conformanceReportHash`, which is what a client declares in
 * `hello{client.conformance}` (status labels it `declared`, never `passed`).
 *
 * The fixture is the kernel side the runner needs and a client never has:
 * a registered and an unregistered device key, a read token, the pinned kernel
 * key plus another key, and an observer counting `socket.auth.*` rows (to
 * prove a client sent NO auth to a server it could not verify).
 */
import {
  CLIENT_API_ID,
  CONFORMANCE_CHECKS,
  CONFORMANCE_SUITE,
  CONFORMANCE_VERSION,
  GNOMON_RPC_V1,
  KIT_ID,
  buildDisplayVectors,
  canonicalJson,
  conformanceReportHash,
  type ConformanceCheckResult,
  type ConformanceReport,
} from '@a-company/gnomon-contracts';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Driver, DriverResponse } from './driver.js';

export interface DeviceCredentialWire {
  kind: 'device';
  principalId: string;
  deviceId: string;
  privateKeyPem: string;
}

export interface ConformanceFixture {
  socketPath: string;
  endpointPath?: string;
  kernelKey: { keyId: string; publicKeyPem: string };
  /** A valid Ed25519 key that is NOT the kernel's. */
  otherKey: { keyId: string; publicKeyPem: string };
  device: DeviceCredentialWire;
  /** A well-formed device credential absent from the root-signed registry. */
  unregisteredDevice: DeviceCredentialWire;
  readToken: string;
  /** Number of socket.auth.* rows in the kernel log now (observer). */
  authRows(): Promise<number> | number;
}

export interface RunOptions {
  client: { name: string; version: string; language?: string };
}

/**
 * A fake endpoint that REPLAYS a real recorded hello result — the kernel's
 * genuine serverSig included — to whoever connects, and counts the auth
 * frames it receives (T-2026-10-18-016). `verbatim` sends it unchanged (its
 * clientNonce is the recording connection's); `echo-rewrite` sets clientNonce
 * to the one the victim just sent, so an echo-only check passes and only the
 * signature, which covers the recorded nonce, can catch it. A conformant
 * client refuses both: the signature is over another connection's nonce.
 *
 * POSIX: a socket file in a private temp dir. Windows: a named pipe with a
 * random name (a pipe path is not a filesystem entry, so there is no dir).
 * A listen failure (EADDRINUSE, EACCES, …) rejects, so the check FAILS with
 * that error instead of crashing the runner.
 */
async function impostor(hello: Record<string, unknown>, mode: 'verbatim' | 'echo-rewrite'): Promise<{ path: string; authFrames: () => number; close: () => Promise<void> }> {
  const win = process.platform === 'win32';
  const dir = win ? null : mkdtempSync(path.join(tmpdir(), 'gimp-'));
  const sockPath = dir ? path.join(dir, 's') : `\\\\.\\pipe\\gnomon-impostor-${randomBytes(12).toString('hex')}`;
  let auths = 0;
  const server = net.createServer((sock) => {
    let buf = '';
    sock.on('error', () => undefined);
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        try {
          const f = JSON.parse(line) as { id: number; method: string; params?: { clientNonce?: unknown } };
          if (f.method === 'auth') auths++;
          if (f.method === 'hello') {
            const replayed = mode === 'echo-rewrite' ? { ...hello, clientNonce: f.params?.clientNonce } : hello;
            sock.write(`${JSON.stringify({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id: f.id, result: replayed })}\n`);
          }
        } catch {
          /* ignored */
        }
      }
    });
  });
  const cleanup = (): void => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  };
  try {
    await new Promise<void>((res, rej) => {
      server.once('error', rej);
      server.listen(sockPath, () => {
        server.off('error', rej);
        res();
      });
    });
  } catch (err) {
    cleanup();
    throw new CheckFailed(`the impostor endpoint could not listen on ${sockPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  server.on('error', () => undefined); // after listen: a late server error never crashes the runner
  return {
    path: sockPath,
    authFrames: () => auths,
    close: () =>
      new Promise<void>((res) => {
        server.close(() => {
          cleanup();
          res();
        });
      }),
  };
}

class CheckFailed extends Error {}
function must(cond: unknown, detail: string): asserts cond {
  if (!cond) throw new CheckFailed(detail);
}

type Check = (d: Driver, f: ConformanceFixture, c: RunOptions['client']) => Promise<void>;

const CLIENT_INFO = (c: RunOptions['client']) => ({ name: c.name, version: c.version, surface: 'cli' });

async function connect(d: Driver, f: ConformanceFixture, c: RunOptions['client'], extra: Record<string, unknown> = {}): Promise<DriverResponse> {
  return d.request({ op: 'connect', socketPath: f.socketPath, ...(f.endpointPath ? { endpointPath: f.endpointPath } : {}), client: CLIENT_INFO(c), ...extra });
}
async function authed(d: Driver, f: ConformanceFixture, c: RunOptions['client']): Promise<string> {
  const r = await connect(d, f, c, { kernelKey: f.kernelKey, credential: f.device });
  must(r.ok, `device connect failed: ${JSON.stringify(r.error)}`);
  return String(r.conn);
}
const refusedAs = (r: DriverResponse, code: string, reason?: string): boolean => !r.ok && r.error?.kind === 'refused' && r.error.code === code && (reason === undefined || r.error.reason === reason);

const CHECKS: Record<string, Check> = {
  async 'hello.negotiate'(d, f, c) {
    const r = await connect(d, f, c, { kernelKey: f.kernelKey });
    must(r.ok, `hello failed: ${JSON.stringify(r.error)}`);
    const h = r.hello as Record<string, unknown>;
    must(h.clientApi === GNOMON_RPC_V1, `clientApi ${String(h.clientApi)}`);
    must(h.clientApiId === CLIENT_API_ID && h.kitId === KIT_ID, 'clientApiId / kitId differ from the package');
    await d.request({ op: 'close', conn: r.conn });
  },
  async 'hello.unsupported'(d, f, c) {
    const r = await connect(d, f, c, { clientApis: ['gnomon-rpc:v9'] });
    must(refusedAs(r, 'UNSUPPORTED'), `expected UNSUPPORTED, got ${JSON.stringify(r.error ?? r.hello)}`);
  },
  async 'hello.server-sig'(d, f, c) {
    const r = await connect(d, f, c, { kernelKey: f.kernelKey });
    must(r.ok && r.serverVerified === true, 'serverSig was not verified against the pinned key');
    await d.request({ op: 'close', conn: r.conn });
  },
  async 'hello.server-sig-mismatch'(d, f, c) {
    // (a) a pin naming the kernel's keyId but another key's PEM: a keyId-only client would trust it
    const before = await f.authRows();
    const a = await connect(d, f, c, { kernelKey: { keyId: f.kernelKey.keyId, publicKeyPem: f.otherKey.publicKeyPem }, credential: f.device });
    must(!a.ok && a.error?.kind === 'client', `a pin whose PEM is not the kernel's was trusted: ${JSON.stringify(a.error ?? 'connected')}`);
    // (b) another key altogether
    const b = await connect(d, f, c, { kernelKey: f.otherKey, credential: f.device });
    must(!b.ok && b.error?.kind === 'client', `a hello signed by another key was not refused locally: ${JSON.stringify(b.error ?? 'connected')}`);
    await new Promise((res) => setTimeout(res, 50));
    must((await f.authRows()) === before, 'an auth was sent to an unverified server');
    // (c) T-2026-10-18-016: an impostor REPLAYS a real recorded hello (genuine serverSig, the kernel's keyId) on
    //     the same endpoint path — verbatim, then with clientNonce rewritten to the victim's. The signature
    //     covers the recording connection's clientNonce, so a conformant client refuses both: zero auth frames.
    const real = await connect(d, f, c, { kernelKey: f.kernelKey });
    must(real.ok, 'hello failed');
    await d.request({ op: 'close', conn: real.conn });
    for (const mode of ['verbatim', 'echo-rewrite'] as const) {
      const fake = await impostor(real.hello as Record<string, unknown>, mode);
      try {
        const r = await d.request({ op: 'connect', socketPath: fake.path, endpointPath: f.endpointPath ?? f.socketPath, client: CLIENT_INFO(c), kernelKey: f.kernelKey, credential: f.device });
        await new Promise((res) => setTimeout(res, 50));
        must(!r.ok && r.error?.kind === 'client', `a replayed hello (${mode}) was accepted: ${JSON.stringify(r.error ?? 'connected')}`);
        must(fake.authFrames() === 0, `${fake.authFrames()} auth frame(s) reached an impostor replaying a hello (${mode})`);
      } finally {
        await fake.close();
      }
    }
  },
  async 'auth.device'(d, f, c) {
    const r = await connect(d, f, c, { kernelKey: f.kernelKey, credential: f.device });
    must(r.ok && r.principal === f.device.principalId && typeof r.connId === 'string', `device auth failed: ${JSON.stringify(r.error)}`);
    const st = await d.request({ op: 'call', conn: r.conn, method: 'status', params: {} });
    must(st.ok && (st.result as { principal?: string }).principal === f.device.principalId, 'status does not name the device principal');
    await d.request({ op: 'close', conn: r.conn });
  },
  async 'auth.device-refused'(d, f, c) {
    const r = await connect(d, f, c, { kernelKey: f.kernelKey, credential: f.unregisteredDevice });
    must(refusedAs(r, 'AUTH'), `expected one AUTH refusal, got ${JSON.stringify(r.error ?? 'connected')}`);
    // "the client keeps no connection": a refusal carries no live handle; if the driver hands one back, it must be closed
    if (r.conn !== undefined && r.conn !== null) {
      const cl = await d.request({ op: 'closed', conn: r.conn, timeoutMs: 1000 });
      must(cl.ok && cl.closed === true, 'the client kept a live connection after the AUTH refusal');
      await d.request({ op: 'close', conn: r.conn });
    }
  },
  async 'auth.read-token'(d, f, c) {
    const r = await connect(d, f, c, { kernelKey: f.kernelKey, credential: { kind: 'read-token', token: f.readToken } });
    must(r.ok, `read-token auth failed: ${JSON.stringify(r.error)}`);
    const st = await d.request({ op: 'call', conn: r.conn, method: 'status', params: {} });
    must(st.ok, 'status refused to a read token');
    const w = await d.request({ op: 'call', conn: r.conn, method: 'log.append', params: { kind: 'request.grant', payload: {} } });
    must(refusedAs(w, 'FORBIDDEN'), `a write verb was not FORBIDDEN to a read token: ${JSON.stringify(w.error ?? w.result)}`);
    await d.request({ op: 'close', conn: r.conn });
  },
  async 'auth.before-auth'(d, f, c) {
    const r = await connect(d, f, c, { kernelKey: f.kernelKey });
    must(r.ok, 'hello failed');
    const s = await d.request({ op: 'call', conn: r.conn, method: 'status', params: {} });
    must(refusedAs(s, 'AUTH', 'unauthenticated'), `expected AUTH{unauthenticated}, got ${JSON.stringify(s.error ?? s.result)}`);
    const cl = await d.request({ op: 'closed', conn: r.conn, timeoutMs: 1000 });
    must(cl.ok && cl.closed === true, 'the connection stayed open');
    await d.request({ op: 'close', conn: r.conn });
  },
  async 'refusal.unknown-verb'(d, f, c) {
    const conn = await authed(d, f, c);
    const r = await d.request({ op: 'call', conn, method: 'no.such.verb', params: {} });
    must(refusedAs(r, 'UNKNOWN_VERB'), `expected UNKNOWN_VERB, got ${JSON.stringify(r.error ?? r.result)}`);
    await d.request({ op: 'close', conn });
  },
  async 'refusal.bad-request'(d, f, c) {
    const conn = await authed(d, f, c);
    const r = await d.request({ op: 'call', conn, method: 'log.read', params: { since: 'yesterday' } });
    must(refusedAs(r, 'BAD_REQUEST'), `expected BAD_REQUEST, got ${JSON.stringify(r.error ?? r.result)}`);
    // journal.cursor (P8-D98, §5): `since` is the {logId, seq} cursor — a bare seq is refused, and a cursor from
    // another log (another kernel, or one a quarantine replaced) is refused cursor-epoch, never resumed
    const page = await d.request({ op: 'call', conn, method: 'log.read', params: { limit: 1 } });
    must(page.ok, `log.read page refused: ${JSON.stringify(page.error)}`);
    const { logId } = page.result as { logId: string };
    must(typeof logId === 'string' && logId.startsWith('log:'), `a page carries no logId: ${JSON.stringify(page.result)}`);
    const bare = await d.request({ op: 'call', conn, method: 'log.read', params: { since: 1 } });
    must(refusedAs(bare, 'BAD_REQUEST', 'bad-since'), `a bare-seq since: expected BAD_REQUEST{bad-since}, got ${JSON.stringify(bare.error ?? bare.result)}`);
    const otherLog = `${logId.slice(0, -1)}${logId.endsWith('0') ? '1' : '0'}`;
    const epoch = await d.request({ op: 'call', conn, method: 'log.read', params: { since: { logId: otherLog, seq: 1 } } });
    must(refusedAs(epoch, 'BAD_REQUEST', 'cursor-epoch'), `another log's cursor: expected BAD_REQUEST{cursor-epoch}, got ${JSON.stringify(epoch.error ?? epoch.result)}`);
    await d.request({ op: 'close', conn });
  },
  /**
   * Contiguity (`seqs[i] === seqs[i-1] + 1`, first row = since + 1) holds only
   * because the fixture's device principal has FULL visibility of the log:
   * every seq is delivered to it. A restricted principal (a projection, a mod's
   * own modns, a read token over a redacted view) legitimately sees gaps; a
   * runner for such a principal must compare the subscription against the
   * oracle page from the same `since` (the backlog check below) and must not
   * assert contiguity.
   */
  async 'subscribe.since'(d, f, c) {
    const conn = await authed(d, f, c);
    const probe = await d.request({ op: 'call', conn, method: 'log.read', params: { limit: 1 } });
    must(probe.ok, `log.read page refused: ${JSON.stringify(probe.error)}`);
    const pp = probe.result as { head: number; logId: string };
    const since = Math.max(1, Number(pp.head) - 4);
    const cursor = { logId: pp.logId, seq: since }; // journal.cursor: a resume names its log
    // the oracle: a non-follow page from the same since names exactly the backlog the subscription must deliver
    const page = await d.request({ op: 'call', conn, method: 'log.read', params: { since: cursor, limit: 1000 } });
    must(page.ok, 'log.read page refused');
    const pr = page.result as { rows: Array<{ seq: number }>; head: number };
    const expected = pr.rows.map((x) => x.seq);
    must(expected.length > 0 && expected[0] === since + 1, `the oracle page does not start at since+1: ${expected.join(',')}`);
    const sub = await d.request({ op: 'subscribe', conn, params: { since: cursor } });
    must(sub.ok, `subscribe refused: ${JSON.stringify(sub.error)}`);
    const other = await authed(d, f, c); // a second client makes live rows
    const ev = await d.request({ op: 'events', conn, subscription: (sub.result as { subscription: string }).subscription, n: expected.length + 1, timeoutMs: 3000 });
    const seqs = ((ev.rows ?? []) as Array<{ seq: number }>).map((x) => x.seq);
    const backlog = seqs.filter((x) => x <= pr.head);
    must(canonicalJson(backlog) === canonicalJson(expected.filter((x) => x <= pr.head)), `backlog ${backlog.join(',')} != page ${expected.join(',')}`);
    must(seqs[0] === since + 1, `first row ${seqs[0]} is not since+1 (${since + 1})`);
    must(seqs.every((x, i) => i === 0 || x === seqs[i - 1]! + 1), `rows out of order or with gaps: ${seqs.join(',')}`);
    must(seqs.some((x) => x > pr.head), 'no live row arrived after the backlog');
    await d.request({ op: 'close', conn: other });
    await d.request({ op: 'close', conn });
  },
  async 'display.sanitize'(d) {
    for (const v of buildDisplayVectors().sanitize) {
      const r = await d.request({ op: 'sanitize', input: v.input });
      must(r.ok && r.text === v.text && canonicalJson(r.flags) === canonicalJson(v.flags), `vector ${JSON.stringify(v.input)}: ${JSON.stringify({ text: r.text, flags: r.flags })}`);
    }
  },
  async 'display.event-rows'(d) {
    for (const v of buildDisplayVectors().rows) {
      const r = await d.request({ op: 'row', event: v.event });
      must(r.ok && canonicalJson(r.row) === canonicalJson(v.row), `row ${v.event.kind}: ${JSON.stringify(r.row)}`);
    }
  },
  async 'display.denominator'(d) {
    for (const v of buildDisplayVectors().denominators) {
      const r = await d.request({ op: 'denominator', value: v.value });
      must(r.ok && (r.text ?? null) === v.text, `denominator ${JSON.stringify(v.value)}: ${JSON.stringify(r.text)}`);
    }
  },
  async 'conformance.declared'(d, f, c) {
    const tuple = { suite: CONFORMANCE_SUITE, version: CONFORMANCE_VERSION, reportHash: `sha256:${'0'.repeat(64)}` };
    const r = await d.request({ op: 'connect', socketPath: f.socketPath, ...(f.endpointPath ? { endpointPath: f.endpointPath } : {}), client: { ...CLIENT_INFO(c), conformance: tuple }, kernelKey: f.kernelKey, credential: f.device });
    must(r.ok, `connect with a declared tuple failed: ${JSON.stringify(r.error)}`);
    const st = await d.request({ op: 'call', conn: r.conn, method: 'status', params: {} });
    const mine = ((st.result as { clients?: Array<{ connId: string; conformance: unknown }> }).clients ?? []).find((x) => x.connId === r.connId);
    must(mine && canonicalJson(mine.conformance) === canonicalJson({ ...tuple, label: 'declared' }), `status.clients[] does not label the tuple declared: ${JSON.stringify(mine)}`);
    await d.request({ op: 'close', conn: r.conn });
  },
};

/** Run every `run` check against `driver`; `slice-2` checks are `todo`. */
export async function runConformance(driver: Driver, fixture: ConformanceFixture, o: RunOptions): Promise<ConformanceReport> {
  const checks: ConformanceCheckResult[] = [];
  for (const spec of CONFORMANCE_CHECKS) {
    if (spec.status !== 'run') {
      checks.push({ id: spec.id, result: 'todo' });
      continue;
    }
    const fn = CHECKS[spec.id];
    if (!fn) {
      checks.push({ id: spec.id, result: 'fail', detail: 'the runner has no implementation for this run check' });
      continue;
    }
    try {
      await fn(driver, fixture, o.client);
      checks.push({ id: spec.id, result: 'pass' });
    } catch (err) {
      checks.push({ id: spec.id, result: 'fail', detail: err instanceof Error ? err.message : String(err) });
    }
  }
  const body = { suite: CONFORMANCE_SUITE, version: CONFORMANCE_VERSION, client: o.client, checks } as const;
  return { ...body, pass: checks.every((c) => c.result !== 'fail'), reportHash: conformanceReportHash(body) };
}

/** The check ids the runner implements (so a test can prove every `run` check has one). */
export const RUNNER_CHECK_IDS: readonly string[] = Object.freeze(Object.keys(CHECKS));
