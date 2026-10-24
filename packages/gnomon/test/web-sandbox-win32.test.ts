// @gnomon-platform: win32
/**
 * #web-endpoint under the win32 `transport` profile (W5, docs/plans/gnomon-windows.md; spec §15.5, §16 "Web
 * endpoint"): node runs the script directly and gnomon-helper confines the running child (Low integrity, a job with
 * ACTIVE_PROCESS = 1 and UI limits) before it gets anything. Sibling of test/web-sandbox.test.ts (darwin).
 * Falsifiers: inside the confined child the bundle is readable, the no-read-up Gnomon home is not, nothing can be
 * spawned and nothing written; a handed socket is served. Reported `partial`: outbound network is NOT denied yet
 * (the WFP filter, probe P10w) — asserted as such, so this test fails the day it changes and the profile is restated.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs';
import * as net from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureGnomonHome } from '../src/kernel/lifecycle/home.js';
import { transportLaunchPlan } from '../src/kernel/sandbox/index.js';
import { NdjsonDecoder } from '../src/kernel/socket/framing.js';
import { childDefaultHeaders, materializePlaceholderBundle } from '../src/kernel/web/index.js';
import type { ChildRecord, KernelRecord } from '../src/kernel/web/protocol.js';
import { clearVerifiedRootsForTests } from '../src/platform/owner-only.js';
import { PKG_ROOT } from './helpers.js';
import { tempHome } from './daemon-helpers.js';
import { GOOD, rawHttp, wsConnect } from './web-helpers.js';

const CHILD = path.join(PKG_ROOT, 'dist', 'transport', 'gnomon-web.js');
const HELPER = path.resolve(PKG_ROOT, '..', 'gnomon-helper', 'bin', 'win32', 'gnomon-helper.exe');
const built = fs.existsSync(HELPER);
if (!built && process.env.CI) throw new Error(`the win32 helper is not built at ${HELPER}`);
const d = built ? describe : describe.skip;

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  clearVerifiedRootsForTests();
  while (cleanups.length) await cleanups.pop()!();
});

d('the win32 transport profile (W5)', () => {
  it('confined child: bundle readable; home, spawn and writes denied; outbound network still open (partial)', async () => {
    const t = tempHome('gw-');
    cleanups.push(t.cleanup);
    ensureGnomonHome(t.home); // owner-only DACL + the no-read-up label
    const secret = path.join(t.home, 'secret.key');
    writeFileSync(secret, 'k');
    const dir = materializePlaceholderBundle(t.home);
    const probeDir = realpathSync(mkdtempSync(path.join(path.dirname(t.home), 'probe-')));
    const probe = path.join(probeDir, 'probe.cjs');
    writeFileSync(
      probe,
      `const fs = require('fs'), net = require('net'), cp = require('child_process');
process.on('message', async (m) => {
  if (m !== 'go') return;
  const [bundle, secret, port, outDir] = process.argv.slice(2); const r = {};
  try { fs.readFileSync(bundle + '/index.html'); r.bundle = 'ok'; } catch (e) { r.bundle = e.code; }
  try { fs.readFileSync(secret); r.secret = 'READ'; } catch (e) { r.secret = e.code; }
  try { const c = cp.spawnSync(process.execPath, ['-e', '1']); r.exec = c.error ? 'denied' : 'RAN'; } catch (e) { r.exec = 'denied'; }
  try { fs.writeFileSync(outDir + '/w.txt', 'x'); r.write = 'WROTE'; } catch (e) { r.write = e.code; }
  r.out = await new Promise((res) => { const s = net.connect({ host: '127.0.0.1', port: Number(port) }); s.on('connect', () => (s.destroy(), res('CONNECTED'))); s.on('error', (e) => res(e.code)); });
  process.send(r);
});`,
    );
    const target = net.createServer((c) => c.destroy()).listen(0, '127.0.0.1');
    await new Promise((r) => target.once('listening', r));
    cleanups.push(() => target.close());
    const plan = transportLaunchPlan({ scriptPath: probe, bundleDir: dir });
    expect(plan).toMatchObject({ sandbox: 'partial', args: [realpathSync.native(probe)] });
    expect(typeof plan.confine).toBe('function');
    const child = spawn(plan.command, [...plan.args, realpathSync(dir), secret, String((target.address() as net.AddressInfo).port), probeDir], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: plan.env, windowsHide: true });
    cleanups.push(() => child.kill());
    await plan.confine!(child.pid!);
    child.send('go');
    const r = await new Promise<Record<string, string>>((res) => child.once('message', (m) => res(m as Record<string, string>)));
    expect(r).toEqual({ bundle: 'ok', secret: 'EPERM', exec: 'denied', write: 'EPERM', out: 'CONNECTED' });
  });

  it('the confined child serves a handed socket (HTTP)', async () => {
    const t = tempHome('gw-');
    cleanups.push(t.cleanup);
    ensureGnomonHome(t.home);
    const dir = materializePlaceholderBundle(t.home);
    const plan = transportLaunchPlan({ scriptPath: CHILD, bundleDir: dir });
    const child = spawn(plan.command, plan.args, { stdio: ['pipe', 'pipe', 'pipe', 'ipc'], env: plan.env, windowsHide: true });
    cleanups.push(() => child.kill());
    child.stdin!.on('error', () => undefined);
    let stderr = '';
    child.stderr!.on('data', (b: Buffer) => (stderr += b.toString()));
    await plan.confine!(child.pid!);
    const recs: ChildRecord[] = [];
    const dec = new NdjsonDecoder(16 * 1024 * 1024);
    child.stdout!.on('data', (c: Buffer) => {
      for (const i of dec.push(c)) if (i.kind === 'frame') recs.push(i.value as unknown as ChildRecord);
    });
    const send = (r: KernelRecord) => child.stdin!.write(`${JSON.stringify(r)}\n`);
    send({
      t: 'config', bundleDir: realpathSync(dir), pingMs: 60_000, missedPongs: 2, maxFrameBytes: 4 * 1024 * 1024, preAuthMaxFrameBytes: 16 * 1024,
      maxBodyBytes: 64 * 1024, maxSocketBuffer: 8 * 1024 * 1024, writeHighWater: 1024 * 1024, defaultHeaders: childDefaultHeaders(),
    });
    for (let i = 0; i < 500 && !recs.some((r) => r.t === 'ready'); i++) await new Promise((r) => setTimeout(r, 20));
    expect(recs.some((r) => r.t === 'ready'), stderr).toBe(true);
    const wait = async <T extends ChildRecord['t']>(kind: T): Promise<Extract<ChildRecord, { t: T }>> => {
      for (let i = 0; i < 500; i++) {
        const k = recs.findIndex((r) => r.t === kind);
        if (k !== -1) return recs.splice(k, 1)[0] as Extract<ChildRecord, { t: T }>;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`no ${kind} record; stderr: ${stderr}`);
    };
    // the kernel's half, as endpoint.ts: listen on 127.0.0.1, hand each accepted socket over unread
    const srv = net.createServer({ pauseOnConnect: true }, (s) => child.send('conn', s));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    cleanups.push(() => srv.close());
    const port = (srv.address() as net.AddressInfo).port;
    const resP = rawHttp(port, 'GET', '/', GOOD(port));
    const h = await wait('http');
    expect(h).toMatchObject({ method: 'GET', path: '/' });
    send({ t: 'static', rid: h.rid, file: 'index.html', headers: { 'content-type': 'text/html' } });
    const res = await resP;
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    const wsP = wsConnect(port);
    const up = await wait('upgrade');
    send({ t: 'accept', rid: up.rid });
    const ws = await wsP;
    cleanups.push(() => ws.end());
    expect(ws.status).toBe(101);
    ws.sendJson({ ping: 1 });
    const f = await wait('frame');
    expect(JSON.parse(Buffer.from(f.data, 'base64').toString('utf8'))).toEqual({ ping: 1 });
    send({ t: 'send', rid: up.rid, data: Buffer.from(JSON.stringify({ pong: 1 })).toString('base64') });
    expect(await ws.nextJson()).toEqual({ pong: 1 });
  });
});
