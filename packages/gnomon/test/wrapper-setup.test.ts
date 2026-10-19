// @gnomon-platform: darwin, linux
/**
 * #gnomon-wrapper × #setup-endpoint (T-2026-10-19-006 item 2): `gnomon up --wrapper`, the way Gnomon.app
 * spawns it, on a home that is not ready routes to the setup screens, and the setup page (driven here over the
 * real setup WebSocket, as the app's WebView would) carries it through to `{t:up}`.
 *   - item 2: identity.json exists but the device registry row does not (a setup interrupted before its last
 *     step): `up --wrapper` emits `{t:setup}`, never a `device-unregistered` refusal, and setup.complete finishes it;
 * What this does NOT cover: a real WebView rendering the page (the Tauri app is not built in CI); the browser
 * smoke (test/gui-browser-darwin.test.ts) loads the pages in headless Chrome instead.
 * POSIX only: the #provisioner writes an owner-only keys/ dir and pins a shebang helper (as setup-endpoint.test.ts).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { SETUP_API } from '@a-company/gnomon-contracts';
import { runUpCommand, type UpDeps } from '../src/cli/up-cli.js';
import type { GuiSetupDeps } from '../src/cli/setup-cli.js';
import { acceptUnsignedHelperForTests, DEV_TEST_HELPER_ACK, Provisioner, readIdentity, type HelperTransport } from '../src/kernel/identity/index.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { deviceRegistered } from '../src/kernel/setup/setup-endpoint.js';
import { createWebEndpointForTest } from '../src/kernel/testing.js';
import { privateTmpRoot, TEST_CLIENT_NONCE } from './daemon-helpers.js';
import { FakeHelper } from './helper-fake.js';
import { PKG_ROOT } from './helpers.js';
import { rpc, wsConnect, type RawWs } from './web-helpers.js';

const DEV = acceptUnsignedHelperForTests(DEV_TEST_HELPER_ACK);
const CLEAN = { env: {}, execArgv: ['--disable-sigusr1'] as string[] };
const CHILD = path.join(PKG_ROOT, 'dist', 'transport', 'gnomon-web.js');
const HELLO = { clientApis: [SETUP_API], features: [], clientNonce: TEST_CLIENT_NONCE, client: { name: 'gnomon-gui', version: '0', surface: 'webview' } };
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function userHome(): string {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(privateTmpRoot(), 'gws-'))); // short: the socket must fit sun_path
  cleanups.push(() => removeTree(d));
  return d;
}

function helperExe(dir: string): string {
  const f = path.join(dir, 'gnomon-helper');
  fs.writeFileSync(f, `#!${process.execPath}\n`);
  fs.chmodSync(f, 0o755);
  return f;
}

function transport(fake: FakeHelper): () => HelperTransport {
  return () => {
    fake.revive();
    return {
      request: (r) => fake.request(r),
      get alive() {
        return fake.alive;
      },
      onExit: (cb: () => void) => fake.onExit(cb),
      close: async () => undefined,
    };
  };
}

/** Up deps that are also the setup deps runUp hands to runGuiSetup (the fake SE, an unsandboxed setup transport). */
function deps(uh: string, fake: FakeHelper): UpDeps & GuiSetupDeps {
  return {
    userHome: uh,
    runtime: CLEAN,
    verifier: DEV,
    startHelper: transport(fake),
    once: () => (req) => fake.handle(req),
    helperPath: helperExe(uh),
    platform: 'darwin',
    exec: (f) => (f.endsWith('sw_vers') ? '15.1\n' : 'System Integrity Protection status: enabled.\n'),
    scriptPath: CHILD,
    createWeb: (w) => createWebEndpointForTest(w),
    openEnv: {},
  };
}

/** The app's side of the channel: stdin it writes, stdout parsed into lines. */
function channel() {
  const lines: Record<string, unknown>[] = [];
  const err: string[] = [];
  let buf = '';
  return {
    stdin: new PassThrough(),
    stdout: {
      write: (s: string) => {
        buf += s;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          lines.push(JSON.parse(buf.slice(0, i)) as Record<string, unknown>);
          buf = buf.slice(i + 1);
        }
        return true;
      },
    },
    stderr: { write: (s: string) => (err.push(s), true) },
    lines,
    err,
    async next(t: string, ms = 20_000): Promise<Record<string, unknown>> {
      const end = Date.now() + ms;
      for (;;) {
        const hit = lines.find((l) => l.t === t);
        if (hit) return hit;
        if (Date.now() > end) throw new Error(`no ${t} line; got ${JSON.stringify(lines)} / ${err.join('')}`);
        await new Promise((r) => setTimeout(r, 20));
      }
    },
  };
}

/** The setup page's protocol over the real setup WebSocket (what the WebView's JS does). */
async function page(port: number, setupToken: string): Promise<{ call: (id: number, method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>> }> {
  const ws: RawWs = await wsConnect(port);
  cleanups.push(() => ws.end());
  const call = async (id: number, method: string, params: Record<string, unknown> = {}) => {
    ws.sendJson(rpc(id, method, params));
    for (;;) {
      const f = await ws.nextJson(15_000);
      if (f.id === id) {
        if (f.error) throw new Error(`${method}: ${JSON.stringify(f.error)}`);
        return f;
      }
    }
  };
  await call(1, 'hello', HELLO);
  await call(2, 'auth', { setupToken });
  return { call };
}

describe('#gnomon-wrapper setup routing (up --wrapper)', () => {
  it('item 2: an identity with no device registry row routes to {t:setup} (never a device-unregistered refusal); setup.complete finishes it into {t:up}', async () => {
    const uh = userHome();
    const home = path.join(uh, '.gnomon');
    const fake = new FakeHelper(null);
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    const crash = new Provisioner({ home, helperPath: helperExe(uh), verifier: DEV, start: transport(fake), once: () => (req) => fake.handle(req), fault: (st: string) => { if (st === 'registry') throw new Error('crash'); } });
    expect((await crash.provision({ mode: 'init', existing: null, name: 'founder', host: 'mac-1' })).ok).toBe(false);
    const rec = readIdentity(home)!;
    expect(rec).not.toBeNull();
    expect(deviceRegistered(home, rec)).toBe(false); // the state under test
    const signsBefore = fake.signs.length;

    const c = channel();
    const run = runUpCommand(['--wrapper'], c, deps(uh, fake));
    const s = await c.next('setup');
    expect(c.lines.some((l) => l.t === 'refused')).toBe(false);
    expect(c.err.join('')).not.toContain('device-unregistered');
    const p = await page(Number(s.port), String(s.setupToken));
    expect(((await p.call(3, 'setup.preflight')).result as { existing: unknown }).existing).toMatchObject({ registered: false });
    await p.call(4, 'setup.complete');
    expect(fake.signs.length).toBe(signsBefore); // the saved row: no new root signature, no prompt
    await p.call(5, 'setup.finish');
    await c.next('up');
    expect(deviceRegistered(home, readIdentity(home)!)).toBe(true);
    c.stdin.write('quit\n');
    expect(await run).toBe(0);
    await c.next('down');
  });
});
