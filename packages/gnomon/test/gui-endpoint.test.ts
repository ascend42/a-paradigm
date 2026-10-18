/**
 * #gui (M1.10 slice 1) ⇄ the real #web-endpoint over the real `gnomon-web`
 * child (unsandboxed test seam, every OS): the GUI's in-bundle client
 * (packages/gnomon-gui/src/core/client.ts) does hello → WebCrypto Ed25519
 * serverSig verification against the launch fragment's SPKI → auth
 * {launchToken} → status / log.read; a foreign key sends nothing after hello;
 * Reconnect is refused honestly until #identity M1.3; the endpoint serves the
 * pinned GUI bundle. Needs dist/transport/gnomon-web.js (`npm run test:gnomon` builds first).
 */
import { webcrypto } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GnomonClient, type Transport } from '../../gnomon-gui/src/core/client.js';
import { parseLaunchFragment } from '../../gnomon-gui/src/core/launch.js';
import { UnprovisionedRootAuthority } from '../src/kernel/identity/index.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/index.js';
import { createKernelDispatcher, SocketAuthenticator } from '../src/kernel/socket/index.js';
import { createWebEndpointForTest } from '../src/kernel/testing.js';
import { GUI_BUNDLE_HASH, guiBundleFiles, type WebEndpoint } from '../src/kernel/web/index.js';
import { tempHome } from './daemon-helpers.js';
import { PKG_ROOT } from './helpers.js';
import { GOOD, rawHttp, wsConnect, type RawWs } from './web-helpers.js';

const CHILD = path.join(PKG_ROOT, 'dist', 'transport', 'gnomon-web.js');
const subtle = webcrypto.subtle as unknown as SubtleCrypto;
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});
const HUMAN = { connId: 'conn:01JTESTASKER0000000000000', phase: 'authenticated' as const, credential: 'device' as const, principalKind: 'human' as const, principal: 'p:00000000/founder', deviceId: 'dev:00000000/mac-1' };

async function rig() {
  const t = tempHome('gg-');
  cleanups.push(t.cleanup);
  mkdirSync(t.home, { recursive: true, mode: 0o700 });
  const kernel = SoftwareEd25519Signer.generate('kernel');
  const log = async () => undefined;
  const trust = new UnprovisionedRootAuthority();
  let ep!: WebEndpoint;
  ep = createWebEndpointForTest(
    {
      home: t.home,
      kernelPublicKeyPem: kernel.publicKeyPem,
      scriptPath: CHILD,
      log,
      dispatcher: (endpointPath, web) =>
        createKernelDispatcher({
          authenticator: new SocketAuthenticator({ home: t.home, endpointPath, kernelSigner: kernel, trust }),
          web,
          log,
          status: { daemon: () => ({}), log: () => ({}), kernelKey: () => ({ keyId: kernel.keyId, custody: 'partial', source: 'test' }), root: () => ({ state: 'unprovisioned', rootKeyId: null }), web: () => ep.status() },
        }),
    },
    {},
  );
  cleanups.push(() => ep.stop('test'));
  return { ep };
}

/** A raw RFC 6455 socket (the page's Origin + Sec-Fetch-Site) as the client's Transport. */
async function transport(port: number): Promise<{ t: Transport; ws: RawWs; sent: string[] }> {
  const ws = await wsConnect(port, GOOD(port));
  cleanups.push(() => ws.end());
  const sent: string[] = [];
  const t: Transport = { send: (s) => (sent.push(s), ws.sendText(s)), close: () => ws.end(), onMessage: null, onClose: null };
  // poll the raw frame list (TEXT frames → onMessage; a CLOSE frame or a dead socket → onClose)
  const timer = setInterval(() => {
    for (let i = 0; i < ws.frames.length; ) {
      const f = ws.frames[i]!;
      if (f.op === 0x1) {
        ws.frames.splice(i, 1);
        t.onMessage?.(f.payload.toString('utf8'));
      } else if (f.op === 0x8) {
        clearInterval(timer);
        return t.onClose?.(f.closeCode ?? 1005);
      } else i++;
    }
    if (ws.socket.destroyed) {
      clearInterval(timer);
      t.onClose?.(1006);
    }
  }, 5);
  cleanups.push(() => clearInterval(timer));
  return { t, ws, sent };
}

describe('#gui client ⇄ #web-endpoint (M1.10 slice 1)', () => {
  it('the endpoint serves the pinned GUI bundle', async () => {
    const { ep } = await rig();
    const grant = await ep.requestLaunch(HUMAN);
    expect(grant.bundleHash).toBe(GUI_BUNDLE_HASH);
    const r = await rawHttp(ep.port, 'GET', '/boot.js', { Host: `127.0.0.1:${ep.port}` });
    expect(r.status).toBe(200);
    expect(r.body.equals(guiBundleFiles().get('boot.js')!)).toBe(true);
  });

  it('launch: hello → WebCrypto serverSig verified with the fragment key → auth{launchToken} → status + log.read', async () => {
    const { ep } = await rig();
    const grant = await ep.requestLaunch(HUMAN);
    const frag = parseLaunchFragment(new URL(grant.url).hash)!;
    expect(frag).toEqual({ launchToken: grant.launchToken, kernelPublicKey: grant.kernelPublicKey });
    const { t } = await transport(ep.port);
    const c = new GnomonClient(t);
    const out = await c.connect({ surface: 'browser', endpointPath: ep.endpointPath, verifyKey: frag.kernelPublicKey, auth: { launchToken: frag.launchToken }, subtle });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.session.principal).toBe(HUMAN.principal);
    expect(out.session.guiToken.length).toBeGreaterThan(20);
    expect(out.session.clientApiDrift).toBe(false);
    const st = await c.call<{ principal: string; surface: string }>('status');
    expect(st).toMatchObject({ principal: HUMAN.principal, surface: 'browser' });
  });

  it('a foreign kernel key: serverSig refused, nothing sent after hello (the token is never offered)', async () => {
    const { ep } = await rig();
    const grant = await ep.requestLaunch(HUMAN);
    const foreign = SoftwareEd25519Signer.generate('kernel');
    const { createPublicKey } = await import('node:crypto');
    const k = createPublicKey(foreign.publicKeyPem).export({ type: 'spki', format: 'der' }).toString('base64url');
    const { t, sent } = await transport(ep.port);
    const out = await new GnomonClient(t).connect({ surface: 'browser', endpointPath: ep.endpointPath, verifyKey: k, auth: { launchToken: grant.launchToken }, subtle });
    expect(out).toMatchObject({ ok: false, stage: 'server-sig' });
    expect(sent.map((s) => JSON.parse(s).method)).toEqual(['hello']);
  });

  it('Reconnect is refused UNSUPPORTED until #identity M1.3 presence, and the GUI gets the refusal verbatim', async () => {
    const { ep } = await rig();
    const grant = await ep.requestLaunch(HUMAN);
    const { t } = await transport(ep.port);
    const out = await new GnomonClient(t).connect({ surface: 'browser', endpointPath: ep.endpointPath, verifyKey: grant.kernelPublicKey, auth: { reconnect: true }, subtle });
    expect(out).toMatchObject({ ok: false, stage: 'auth', refusal: { code: 'UNSUPPORTED', reason: 'web-auth-not-implemented' } });
  });
});
