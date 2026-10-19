// @gnomon-platform: darwin, linux
/**
 * TD-2026-10-19-063 end to end, in process, on a dev home: a GUI launched from the human device sees the kernel's
 * own upgrade card after a stamp change; accepting it from the GUI takes ONE presence, sends gui.resume to that
 * connection alone, drains and exits `upgrade` with a hand-off naming the old web port and the successor's key; the
 * successor (that key, `--prefer-port`) listens on the SAME port and the GUI reattaches with {resumeToken} and NO
 * second presence; the token is refused on replay.
 */
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { approvalsKeyFrom, type ApprovalsKey } from '../src/kernel/broker/index.js';
import { selectSocketPath, startDaemon } from '../src/kernel/lifecycle/index.js';
import { connectGnomon } from '../src/kernel/socket/index.js';
import { loadDevHome, provisionDevHome } from '../src/cli/dev-home.js';
import { recordKernelPub } from '../src/kernel/identity/index.js';
import { KeyRing, signaturePreimage, SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { mintTestPresence } from '../src/kernel/testing.js';
import { kernelPinOf } from '../src/cli/daemon-cli.js';
import { humanDeviceOf } from '../src/cli/rules-cli.js';
import { GNOMON_VERSION } from '../src/version.js';
import { RESUME_FILE } from '../src/kernel/web/resume.js';
import { tempHome } from './daemon-helpers.js';
import { HELLO, rpc, wsConnect, type RawWs } from './web-helpers.js';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const stamp = (n: string, version: string) => ({ schemaVersion: 'gnomon-build:v1', version, commit: `c${n}`, distHash: `sha256:${n.repeat(64)}`, guiBundleHash: null });

function world() {
  const t = tempHome('su-');
  cleanups.push(t.cleanup);
  fs.mkdirSync(path.dirname(t.home), { recursive: true });
  const userHome = fs.realpathSync.native(path.dirname(t.home));
  const home = path.join(userHome, 'devhome');
  provisionDevHome(home, { userHome });
  const l = loadDevHome(home, { userHome });
  recordKernelPub(home, l.kernelKey.publicKeyPem);
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ring = new KeyRing();
  const keyId = ring.addP256(publicKey);
  const prompts: string[] = [];
  const approvalsKey: ApprovalsKey = {
    ...approvalsKeyFrom(ring, (p) => (p === l.device.principalId ? keyId : undefined)),
    signDecision: async (req) => {
      prompts.push(req.mode);
      const decisionSig = cryptoSign('sha256', signaturePreimage('approve', req.message), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
      return { decisionSig, token: req.presence ? mintTestPresence(req.presence.purpose, { bind: req.presence.binding }) : null, kept: false };
    },
  };
  const sock = selectSocketPath({ home });
  if (!sock.ok) throw new Error('no socket path');
  const stampPath = path.join(userHome, 'build-id.json');
  fs.writeFileSync(stampPath, JSON.stringify(stamp('a', '8.0.0')));
  return { home, l, approvalsKey, prompts, sock: sock.path, stampPath };
}

async function next(ws: RawWs, pred: (f: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
  for (let i = 0; i < 50; i++) {
    const f = await ws.nextJson(10_000);
    if (pred(f)) return f;
  }
  throw new Error('frame not seen');
}

async function guiAuth(port: number, auth: Record<string, unknown>): Promise<{ ws: RawWs; res: Record<string, unknown> }> {
  const ws = await wsConnect(port);
  cleanups.push(() => ws.end());
  ws.sendJson(rpc(1, 'hello', HELLO()));
  await next(ws, (f) => f.id === 1);
  ws.sendJson(rpc(2, 'auth', auth));
  return { ws, res: await next(ws, (f) => f.id === 2) };
}

describe('self-update: stamp change → card → ONE Touch ID → successor on the same port → GUI resumes', () => {
  it('end to end', async () => {
    const w = world();
    const d = await startDaemon({ home: w.home, idleMs: 60_000, kernelSigner: w.l.kernel, rootAuthority: w.l.root, approvalsKey: w.approvalsKey, update: { stampPath: w.stampPath, pollMs: 3_600_000 } });
    cleanups.push(() => d.shutdown('signal').catch(() => undefined));
    expect(JSON.parse(fs.readFileSync(path.join(w.home, 'kernel-build.json'), 'utf8')).stamp.distHash).toBe(stamp('a', '8.0.0').distHash);
    const found = kernelPinOf(w.home, w.l.kernelKey.keyId)!;
    const device = humanDeviceOf(w.home);
    if (typeof device === 'string') throw new Error(device);
    const s = await connectGnomon({ socketPath: w.sock, client: { name: 'gnomon', version: GNOMON_VERSION, surface: 'cli' }, serverKey: found.pin, device });
    cleanups.push(() => s.conn.close().catch(() => undefined));
    const open = (await s.conn.call('gui.open', {}, 30_000)) as { result?: { url: string } };
    const url = new URL(open.result!.url);
    const port = Number(url.port);
    const launchToken = /launch=([^&]+)/.exec(url.hash)![1]!;
    const gui = await guiAuth(port, { launchToken });
    expect(gui.res.result).toBeTruthy();

    // detect: the stamp changes ⇒ ONE kernel card; a second tick raises nothing more
    fs.writeFileSync(w.stampPath, JSON.stringify(stamp('b', '8.0.1')));
    await d.updateWatch!.tick();
    await d.updateWatch!.tick();
    const cards = [...d.log.read({ reader: { class: 'human' }, kinds: ['approval.request'] })].filter((v) => v.view === 'full' && (v.event.payload as { card?: { kind?: string } }).card?.kind === 'daemon-stop');
    expect(cards.length).toBe(1);
    const card = (cards[0] as { event: { payload: { card: { cardId: string; lines?: string[] } } } }).event.payload.card;

    // accept from the GUI: one presence; gui.resume reaches this connection
    expect(w.prompts.length).toBe(0);
    gui.ws.sendJson(rpc(3, 'approve', { cardId: card.cardId, decision: 'accept' }));
    const resume = await next(gui.ws, (f) => f.method === 'gui.resume');
    const rp = resume.params as { resumeToken: string; kernelPublicKey: string; ttlMs: number };
    expect(rp.resumeToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await d.exited).toBe('upgrade');
    expect(w.prompts.length).toBe(1);
    const h = d.upgradeHandoff()!;
    expect(h.preferPort).toBe(port);
    // the home holds the digest only
    expect(fs.readFileSync(path.join(w.home, RESUME_FILE), 'utf8')).not.toContain(rp.resumeToken);

    // the successor: the predecessor's minted key, the old port
    const signer = new SoftwareEd25519Signer(h.successorKeyPem, 'kernel');
    recordKernelPub(w.home, signer.publicKeyPem);
    const d2 = await startDaemon({ home: w.home, idleMs: 60_000, kernelSigner: signer, rootAuthority: w.l.root, approvalsKey: w.approvalsKey, web: { preferPort: port }, update: { stampPath: null } });
    cleanups.push(() => d2.shutdown('signal').catch(() => undefined));
    expect(fs.existsSync(path.join(w.home, RESUME_FILE))).toBe(false); // taken at boot
    for (let i = 0; i < 200 && !(d2.web()?.status() as { listening?: boolean } | undefined)?.listening; i++) await new Promise((r) => setTimeout(r, 50));
    expect((d2.web()!.status() as { port?: number }).port).toBe(port);

    // the GUI reattaches with the resume form: no second presence
    const back = await guiAuth(port, { resumeToken: rp.resumeToken });
    expect((back.res.result as { principal?: string }).principal).toBe(w.l.device.principalId);
    expect(w.prompts.length).toBe(1);
    // replay ⇒ refused
    const again = await guiAuth(port, { resumeToken: rp.resumeToken });
    expect(again.res.error).toBeTruthy();
    expect(JSON.stringify(again.res.error)).toMatch(/replayed-transcript/);
  }, 60_000);
});
