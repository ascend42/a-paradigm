// @gnomon-platform: darwin
/**
 * #gnomon-up end to end — the founder's first real test, with the FakeHelper
 * (test/helper-fake.ts) in place of Touch ID: `gnomon identity init` provisions
 * a temp home → `gnomon up`'s kernel (startUpKernel: the hardware identity via
 * openHardwareIdentity, the same path gnomond takes) → the launch URL from
 * the in-process `gnomon open` path → the GUI's WebSocket (hello + auth with
 * the launch token, under the real darwin transport profile) → session.open
 * on the FAKE claude under the real session profile → the session proposes a
 * plan (ExitPlanMode) and the broker raises a card → the GUI approves with
 * {cardId, decision} only, exactly what gnomon-gui sends → ONE fresh helper
 * prompt (Touch ID) → approval.decide{presence:fresh, via:gui} whose
 * decisionSig verifies under the approvals public key in identity.json.
 *
 * Seams, all documented: UpDeps (verifier = the dev-test helper verifier,
 * startHelper = the fake), and the internal test entry's daemon slot for the
 * fake claude (startDaemonForTest), as in test/dev-launch-session.test.ts.
 * Never the real claude, never Anthropic, never the real Secure Enclave.
 */
import { createPublicKey } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { runIdentityCommand } from '../src/cli/identity-cli.js';
import { startUpKernel, type UpKernel } from '../src/cli/up-cli.js';
import { acceptUnsignedHelperForTests, DEV_TEST_HELPER_ACK, readIdentity, type HelperTransport } from '../src/kernel/identity/index.js';
import { approveMessage, KeyRing } from '../src/kernel/log/signer.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { darwinFloor } from '../src/kernel/sandbox/session.js';
import { startDaemonForTest } from '../src/kernel/testing.js';
import { FakeHelper } from './helper-fake.js';
import { sessionWorld, setMode } from './session-helpers.js';
import { GOOD, HELLO, rpc, wsConnect, type RawWs } from './web-helpers.js';

const SANDBOX_OK = darwinFloor().ok;
const DEV = acceptUnsignedHelperForTests(DEV_TEST_HELPER_ACK);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function view(fake: FakeHelper): HelperTransport {
  return {
    request: (r) => fake.request(r),
    get alive() {
      return fake.alive;
    },
    onExit: (cb) => fake.onExit(cb),
    close: async () => undefined,
  };
}

/** The reply to request `id` (skips notifications and other replies). */
async function reply(ws: RawWs, id: number, ms = 15_000): Promise<Record<string, unknown>> {
  const end = Date.now() + ms;
  for (;;) {
    const f = await ws.nextJson(Math.max(1, end - Date.now()));
    if (f.id === id) return f;
  }
}

describe.skipIf(!SANDBOX_OK)('#gnomon-up end to end: identity init → gnomon up → GUI → card → approve → verified decision', () => {
  it('a GUI approve goes broker → one helper presence prompt → decisionSig that verifies under the approvals key', async () => {
    const w = sessionWorld();
    cleanups.push(() => w.cleanup());
    // P8-D96: the fake claude asks can_use_tool for ExitPlanMode (p01b shape): the broker raises a `plan` card
    setMode(w, { permissionAsk: { steps: [{ request: { id: 'plan-1', tool: 'ExitPlanMode', input: { plan: '1. write plan.txt' } } }], hold: true } });
    const uh = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gue-')));
    cleanups.push(() => removeTree(uh));
    const home = path.join(uh, '.gnomon');

    // 1. gnomon identity init (the real code) over the fake Secure Enclave
    const fake = new FakeHelper(null);
    const helperExe = path.join(uh, 'gnomon-helper');
    fs.writeFileSync(helperExe, `#!${process.execPath}\n`);
    fs.chmodSync(helperExe, 0o755);
    const init = await runIdentityCommand(['init', '--home', home, '--helper', helperExe, '--name', 'matt', '--host', 'mac'], { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() }, {
      env: {},
      verifier: DEV,
      handleSignals: false,
      start: () => (fake.revive(), view(fake)),
      once: () => (req) => fake.handle(req),
    });
    expect(init).toBe(0);
    const rec = readIdentity(home)!;

    // 2. gnomon up's kernel on that home
    const k: UpKernel = await startUpKernel(fs.realpathSync.native(home), {
      userHome: uh,
      verifier: DEV,
      startHelper: () => (fake.revive(), view(fake)),
      start: (o) =>
        startDaemonForTest(o, {
          supervisor: { claudePath: w.claude, allowScripts: true, userHome: w.userHome, env: () => ({ HOME: w.userHome, PATH: '/usr/bin:/bin' }) },
          billing: { env: () => ({}), layers: () => [] },
        }),
    });
    cleanups.push(() => k.stop());
    expect(k.client.serverVerified).toBe(true);

    // 3. the launch URL, then the GUI's WebSocket with the token from the fragment
    const g = await k.launch();
    const m = /^http:\/\/127\.0\.0\.1:(\d+)\/#launch=([A-Za-z0-9_-]{43})&k=[A-Za-z0-9_-]+$/.exec(g.url);
    expect(m).not.toBeNull();
    const ws = await wsConnect(Number(m![1]), GOOD(Number(m![1])));
    cleanups.push(() => ws.end());
    ws.sendJson(rpc(1, 'hello', HELLO('browser')));
    expect((await reply(ws, 1)).result).toBeDefined();
    ws.sendJson(rpc(2, 'auth', { launchToken: m![2] }));
    const auth = (await reply(ws, 2)).result as { principal: string; connId: string };
    expect(auth.principal).toBe(rec.principalId);

    // 4. a session on the fake claude; its plan raises a card
    ws.sendJson(rpc(3, 'session.open', { cwd: w.cwd, attended: true }));
    const opened = (await reply(ws, 3)).result as { hsid: string; state: string };
    expect(opened.state).toBe('running');
    ws.sendJson(rpc(4, 'session.send', { hsid: opened.hsid, content: [{ text: 'make a plan' }] }));
    expect((await reply(ws, 4)).result).toBeDefined();
    let cardId: string | null = null;
    const deadline = Date.now() + 10_000;
    while (!cardId && Date.now() < deadline) {
      for (const v of k.handle.log.read({ reader: { class: 'human' }, kinds: ['turn.plan'] })) {
        const p = v.view === 'full' ? (v.event.payload as { hsid?: string; cardId?: string | null }) : undefined;
        if (p?.hsid === opened.hsid && typeof p.cardId === 'string') cardId = p.cardId;
      }
      if (!cardId) await new Promise((r) => setTimeout(r, 50));
    }
    expect(cardId).toMatch(/^card:/);

    // 5a. falsifier: the human cancels the Touch ID prompt — refused, nothing decided
    fake.opts = { touch: false };
    ws.sendJson(rpc(6, 'approve', { cardId, decision: 'approve-plan' }));
    const declined = await reply(ws, 6);
    expect(declined.result).toBeUndefined();
    expect(JSON.stringify(declined.error)).toContain('presence');
    expect([...k.handle.log.read({ reader: { class: 'human' }, kinds: ['approval.decide'] })]).toHaveLength(0);
    fake.opts = {};

    // 5. the GUI approves exactly as gnomon-gui does: {cardId, decision}, no decisionSig
    const promptsBefore = fake.prompts.length;
    const signsBefore = fake.signs.length;
    ws.sendJson(rpc(5, 'approve', { cardId, decision: 'approve-plan' }));
    const decided = await reply(ws, 5);
    expect(decided.error, JSON.stringify(decided.error)).toBeUndefined();
    expect(decided.result).toMatchObject({ cardId, state: 'decided', presence: 'fresh', via: 'gui', decidedBy: rec.principalId });

    // one presence prompt, on the approvals key, fresh
    expect(fake.prompts.length).toBe(promptsBefore + 1);
    expect(fake.signs.slice(signsBefore).map((s) => [s.key, s.mode])).toContainEqual(['approvals', 'fresh']);

    // 6. the logged decision verifies independently, under the approvals public key in identity.json
    const rows = [...k.handle.log.read({ reader: { class: 'human' }, kinds: ['approval.decide'] })].flatMap((v) => (v.view === 'full' ? [v.event.payload as Record<string, unknown>] : []));
    const row = rows.find((r) => r.cardId === cardId)!;
    expect(row).toMatchObject({ decision: 'approve-plan', by: rec.principalId, presence: 'fresh', via: 'gui' });
    const ring = new KeyRing();
    const keyId = ring.addP256(createPublicKey(rec.approvals.row.publicKeyPem));
    const card = (decided.result as { contentHash: string }).contentHash;
    const msg = approveMessage({ cardId: cardId!, decision: 'approve-plan', cardContentHash: card, approverPrincipalId: rec.principalId });
    expect(ring.verify(keyId, 'approve', msg, Buffer.from(String(row.decisionSig), 'base64'))).toBe('ok');
    // and a different decision does not verify with that signature (it is bound to the decision)
    const other = approveMessage({ cardId: cardId!, decision: 'reject', cardContentHash: card, approverPrincipalId: rec.principalId });
    expect(ring.verify(keyId, 'approve', other, Buffer.from(String(row.decisionSig), 'base64'))).not.toBe('ok');
  }, 60_000);

  it('P8-D96: the session asks to Write → a permission card → the GUI allows → one fresh presence (Touch ID) → the fake claude\'s Write runs', async () => {
    const w = sessionWorld();
    cleanups.push(() => w.cleanup());
    const target = path.join(w.cwd, 'written-by-claude.txt');
    setMode(w, { permissionAsk: { steps: [{ request: { id: 'write-1', tool: 'Write', input: { file_path: target, content: 'hello from the session' } } }] } });
    const uh = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gue-')));
    cleanups.push(() => removeTree(uh));
    const home = path.join(uh, '.gnomon');

    // 1. gnomon identity init (the real code) over the fake Secure Enclave
    const fake = new FakeHelper(null);
    const helperExe = path.join(uh, 'gnomon-helper');
    fs.writeFileSync(helperExe, `#!${process.execPath}\n`);
    fs.chmodSync(helperExe, 0o755);
    const init = await runIdentityCommand(['init', '--home', home, '--helper', helperExe, '--name', 'matt', '--host', 'mac'], { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() }, {
      env: {},
      verifier: DEV,
      handleSignals: false,
      start: () => (fake.revive(), view(fake)),
      once: () => (req) => fake.handle(req),
    });
    expect(init).toBe(0);
    const rec = readIdentity(home)!;

    // 2. gnomon up's kernel on that home
    const k: UpKernel = await startUpKernel(fs.realpathSync.native(home), {
      userHome: uh,
      verifier: DEV,
      startHelper: () => (fake.revive(), view(fake)),
      start: (o) =>
        startDaemonForTest(o, {
          supervisor: { claudePath: w.claude, allowScripts: true, userHome: w.userHome, env: () => ({ HOME: w.userHome, PATH: '/usr/bin:/bin' }) },
          billing: { env: () => ({}), layers: () => [] },
        }),
    });
    cleanups.push(() => k.stop());
    expect(k.client.serverVerified).toBe(true);

    // 3. the launch URL, then the GUI's WebSocket with the token from the fragment
    const g = await k.launch();
    const m = /^http:\/\/127\.0\.0\.1:(\d+)\/#launch=([A-Za-z0-9_-]{43})&k=[A-Za-z0-9_-]+$/.exec(g.url);
    expect(m).not.toBeNull();
    const ws = await wsConnect(Number(m![1]), GOOD(Number(m![1])));
    cleanups.push(() => ws.end());
    ws.sendJson(rpc(1, 'hello', HELLO('browser')));
    expect((await reply(ws, 1)).result).toBeDefined();
    ws.sendJson(rpc(2, 'auth', { launchToken: m![2] }));
    const auth = (await reply(ws, 2)).result as { principal: string; connId: string };
    expect(auth.principal).toBe(rec.principalId);

    // 4. a session on the fake claude; its plan raises a card
    ws.sendJson(rpc(3, 'session.open', { cwd: w.cwd, attended: true }));
    const opened = (await reply(ws, 3)).result as { hsid: string; state: string };
    expect(opened.state).toBe('running');
    ws.sendJson(rpc(4, 'session.send', { hsid: opened.hsid, content: [{ text: 'write the file' }] }));
    expect((await reply(ws, 4)).result).toBeDefined();
    // the card the kernel raised for the request (approval.request carries it)
    let card: { cardId: string; kind: string; contentHash: string } | null = null;
    const deadline = Date.now() + 10_000;
    while (!card && Date.now() < deadline) {
      for (const v of k.handle.log.read({ reader: { class: 'human' }, kinds: ['approval.request'] })) {
        const p = v.view === 'full' ? (v.event.payload as { card?: { cardId: string; kind: string; contentHash: string; hsid?: string } }) : undefined;
        if (p?.card?.hsid === opened.hsid) card = p.card;
      }
      if (!card) await new Promise((r) => setTimeout(r, 50));
    }
    expect(card).toMatchObject({ kind: 'permission' });
    expect(fs.existsSync(target)).toBe(false); // the card is the gate

    // the GUI allows exactly as gnomon-gui does: {cardId, decision}; one fresh presence prompt
    const promptsBefore = fake.prompts.length;
    ws.sendJson(rpc(5, 'approve', { cardId: card!.cardId, decision: 'allow' }));
    const decided = await reply(ws, 5);
    expect(decided.error, JSON.stringify(decided.error)).toBeUndefined();
    expect(decided.result).toMatchObject({ cardId: card!.cardId, state: 'decided', presence: 'fresh', via: 'gui' });
    expect(fake.prompts.length).toBe(promptsBefore + 1);

    // the kernel answers allow with the kernel-held input; the fake claude's Write runs under the session profile
    const end = Date.now() + 10_000;
    while (!fs.existsSync(target) && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    expect(fs.readFileSync(target, 'utf8')).toBe('hello from the session');
    const inject = [...k.handle.log.read({ reader: { class: 'human' }, kinds: ['session.inject'] })].flatMap((v) => (v.view === 'full' ? [v.event.payload as Record<string, unknown>] : [])).find((p) => p.origin === 'kernel' && p.requestId === 'write-1');
    expect(inject).toMatchObject({ answer: 'allow', cardId: card!.cardId });
  }, 60_000);

});
