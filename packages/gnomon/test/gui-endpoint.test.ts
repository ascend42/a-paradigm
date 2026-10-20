/**
 * #gui (M1.10 slice 1) ⇄ the real #web-endpoint over the real `gnomon-web`
 * child (unsandboxed test seam, every OS): the GUI's in-bundle client
 * (packages/gnomon-gui/src/core/client.ts) does hello → WebCrypto Ed25519
 * serverSig verification against the launch fragment's SPKI → auth
 * {launchToken} → status / log.read; a foreign key sends nothing after hello;
 * Reconnect is refused honestly until #identity M1.3; the endpoint serves the
 * pinned GUI bundle. Needs dist/transport/gnomon-web.js (`npm run test:gnomon` builds first).
 */
import { createPublicKey, webcrypto } from 'node:crypto';
import { verifiedDecisions } from '../../gnomon-gui/src/core/server-sig.js';
import { actionMessage, signActions } from '../src/kernel/broker/card.js';
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

  it('S1: bundled fonts are served byte-exact from a sub-directory as font/woff2 under the rule-6 CSP (font-src self)', async () => {
    const { ep } = await rig();
    await ep.requestLaunch(HUMAN);
    const fonts = [...guiBundleFiles().keys()].filter((k) => k.endsWith('.woff2'));
    expect(fonts.length).toBeGreaterThanOrEqual(4);
    for (const f of fonts) {
      const r = await rawHttp(ep.port, 'GET', `/${f}`, { Host: `127.0.0.1:${ep.port}` });
      expect(r.status, f).toBe(200);
      expect(r.headers['content-type'], f).toBe('font/woff2');
      expect(r.headers['content-security-policy'], f).toContain("font-src 'self'");
      expect(r.body.subarray(0, 4).toString('latin1'), f).toBe('wOF2');
      expect(r.body.equals(guiBundleFiles().get(f)!), f).toBe(true);
    }
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

  it('I3: right keyId but a bit-flipped serverSig ⇒ refused at server-sig, nothing sent after hello', async () => {
    const { ep } = await rig();
    const grant = await ep.requestLaunch(HUMAN);
    const { t, sent } = await transport(ep.port);
    // wrap the inbound path: flip one bit of the hello result's serverSig before the client sees it
    const relay: Transport = { send: (s) => t.send(s), close: () => t.close(), onMessage: null, onClose: null };
    t.onMessage = (text) => {
      const f = JSON.parse(text) as { id?: number; result?: { serverSig?: string } };
      if (f.id === 1 && f.result?.serverSig) {
        const b = Buffer.from(f.result.serverSig, 'base64');
        b[7] = b[7]! ^ 0x01;
        f.result.serverSig = b.toString('base64');
      }
      relay.onMessage?.(JSON.stringify(f));
    };
    t.onClose = (c) => relay.onClose?.(c);
    const out = await new GnomonClient(relay).connect({ surface: 'browser', endpointPath: ep.endpointPath, verifyKey: grant.kernelPublicKey, auth: { launchToken: grant.launchToken }, subtle });
    expect(out).toMatchObject({ ok: false, stage: 'server-sig', sig: { reason: 'bad-server-sig' } });
    expect(sent.map((s) => JSON.parse(s).method)).toEqual(['hello']);
  });

  it('T-2026-10-18-016: a genuine hello recorded on another connection, replayed into this one, is refused at server-sig; nothing sent after hello', async () => {
    const { ep } = await rig();
    const grant = await ep.requestLaunch(HUMAN);
    // record a genuine hello on a first connection
    const first = await transport(ep.port);
    const rec: Transport = { send: (s) => first.t.send(s), close: () => first.t.close(), onMessage: null, onClose: null };
    let recorded: Record<string, unknown> | undefined;
    first.t.onMessage = (text) => {
      const f = JSON.parse(text) as { id?: number; result?: Record<string, unknown> };
      if (f.id === 1 && f.result) recorded = f.result;
      rec.onMessage?.(text);
    };
    first.t.onClose = (c) => rec.onClose?.(c);
    await new GnomonClient(rec).connect({ surface: 'browser', endpointPath: ep.endpointPath, verifyKey: grant.kernelPublicKey, auth: { launchToken: grant.launchToken }, subtle });
    expect(recorded?.serverSig).toBeDefined();
    for (const [mode, reason] of [['verbatim', 'client-nonce-mismatch'], ['echo-rewrite', 'bad-server-sig']] as const) {
      const { t, sent } = await transport(ep.port);
      const relay: Transport = { send: (s) => t.send(s), close: () => t.close(), onMessage: null, onClose: null };
      t.onMessage = (text) => {
        const f = JSON.parse(text) as { id?: number; result?: Record<string, unknown> };
        if (f.id === 1 && f.result) {
          const mine = (JSON.parse(sent[0]!) as { params: { clientNonce: string } }).params.clientNonce;
          f.result = mode === 'verbatim' ? recorded : { ...recorded, clientNonce: mine };
        }
        relay.onMessage?.(JSON.stringify(f));
      };
      t.onClose = (c) => relay.onClose?.(c);
      const out = await new GnomonClient(relay).connect({ surface: 'browser', endpointPath: ep.endpointPath, verifyKey: grant.kernelPublicKey, auth: { launchToken: grant.launchToken }, subtle });
      expect(out).toMatchObject({ ok: false, stage: 'server-sig', sig: { reason } });
      expect(sent.map((s) => JSON.parse(s).method)).toEqual(['hello']);
    }
  });

  it('I2: card decision keys come only from actions the KERNEL signed (broker signActions) with the hello key', async () => {
    const kernel = SoftwareEd25519Signer.generate('kernel');
    const other = SoftwareEd25519Signer.generate('kernel');
    const spki = createPublicKey(kernel.publicKeyPem).export({ type: 'spki', format: 'der' }).toString('base64url');
    const cardId = 'card:01JTESTCARD000000000000000';
    const contentHash = `sha256:${'b'.repeat(64)}`;
    const actions = signActions(kernel, cardId, 'permission', contentHash);
    expect(actions.length).toBeGreaterThan(1);
    const all = await verifiedDecisions(subtle, spki, kernel.keyId, { cardId, contentHash, actions });
    expect(all).toEqual(actions.map((a) => a.decision));
    // another contentHash, another key, a keyId that is not the hello's: nothing offered
    expect(await verifiedDecisions(subtle, spki, kernel.keyId, { cardId, contentHash: `sha256:${'c'.repeat(64)}`, actions })).toEqual([]);
    expect(await verifiedDecisions(subtle, spki, kernel.keyId, { cardId, contentHash, actions: signActions(other, cardId, 'permission', contentHash) })).toEqual([]);
    expect(await verifiedDecisions(subtle, spki, other.keyId, { cardId, contentHash, actions })).toEqual([]);
    // the GUI's preimage is the kernel's actionMessage under the card-action domain
    expect(actionMessage(cardId, 'allow', contentHash)).toBe(`${cardId}\nallow\n${contentHash}`);
  });

  it('Reconnect is refused UNSUPPORTED until #identity M1.3 presence, and the GUI gets the refusal verbatim', async () => {
    const { ep } = await rig();
    const grant = await ep.requestLaunch(HUMAN);
    const { t } = await transport(ep.port);
    const out = await new GnomonClient(t).connect({ surface: 'browser', endpointPath: ep.endpointPath, verifyKey: grant.kernelPublicKey, auth: { reconnect: true }, subtle });
    expect(out).toMatchObject({ ok: false, stage: 'auth', refusal: { code: 'UNSUPPORTED', reason: 'web-auth-not-implemented' } });
  });
});
