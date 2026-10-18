/**
 * #approval-broker (spec §3.4, §5 verb 8; §19.1 M1.6): G-BRK-01..03, G-BRK-05,
 * the G-ABI-02 voice row, G-SUB-02/03, presence binding (T-2026-10-18-003),
 * the install card under the broker (T-2026-10-18-008), the signed presence
 * prompt. Platform-independent: in-process, temp dirs only.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { RefusedError, validateCardV1, validateRefusalV1 } from '@a-company/gnomon-contracts';
import {
  ApprovalBroker,
  ApiTokenBilling,
  approvalsKeyFrom,
  PresenceDenied,
  raiseInstallCard,
  verifyActions,
  verifyPresencePrompt,
  UNLOCK_IDLE_MS,
  type PresenceProvider,
} from '../src/kernel/broker/index.js';
import { approveMessage, KeyRing, signaturePreimage, SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { DEV_TEST_ROOT_ACK, DevTestRootAuthority } from '../src/kernel/identity/root-authority.js';
import { mintTestPresence } from '../src/kernel/testing.js';
import { MANIFEST_FILE, readGrants, removeTree, stageInstall } from '../src/kernel/manifest/index.js';

const HUMAN = 'p:abcdefgh/matt';
const AGENT = 'p:abcdefgh/s-01hzzzzz';
const KERNEL = 'p:abcdefgh/kernel';

const tmps: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-brk-'));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) removeTree(tmps.pop()!);
});

/** A software P-256 stands in for the hardware approvals key (tests only). */
function approvalsKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ring = new KeyRing();
  const keyId = ring.addP256(publicKey);
  const sig = (cardId: string, decision: string, contentHash: string, approver = HUMAN) =>
    cryptoSign('sha256', signaturePreimage('approve', approveMessage({ cardId, decision, cardContentHash: contentHash, approverPrincipalId: approver })), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
  return { key: approvalsKeyFrom(ring, (p) => (p === HUMAN ? keyId : undefined)), sig };
}

/** A presence provider that mints a token bound to exactly what the broker asks (the M1.3 helper's stand-in). */
const touching = (seen: Array<{ text: string; connId: string }> = []): PresenceProvider => ({
  prove: async (req) => {
    seen.push({ text: req.prompt.text, connId: req.connId });
    return mintTestPresence(req.purpose, { bind: req.binding });
  },
});
const declining: PresenceProvider = { prove: async () => Promise.reject(new PresenceDenied('the human did not touch')) };

function rig(o: { presence?: PresenceProvider; now?: { t: number }; root?: DevTestRootAuthority } = {}) {
  const rows: Array<{ kind: string; payload: Record<string, unknown>; connId?: string }> = [];
  const kernel = SoftwareEd25519Signer.generate('kernel');
  const ring = new KeyRing();
  ring.addEd25519(kernel.publicKeyPem);
  const ak = approvalsKey();
  const now = o.now ?? { t: Date.UTC(2026, 9, 18, 12) };
  const broker = new ApprovalBroker({
    kernel,
    kernelPrincipal: KERNEL,
    log: async (kind, payload, ids) => void rows.push({ kind, payload, ...(ids?.connId ? { connId: ids.connId } : {}) }),
    approvals: ak.key,
    ...(o.presence ? { presence: o.presence } : {}),
    ...(o.root ? { root: o.root } : {}),
    clock: () => now.t,
    mono: () => now.t,
    guiSessions: () => 1,
  });
  return { broker, rows, ring, sig: ak.sig, now, kinds: () => rows.map((r) => r.kind) };
}

/** A human connection; `credential: 'gui'` = a launch-token GUI session (the only class that may hold an unlock, Aegis C1). */
const H = (connId = 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA', surface: string | null = 'browser', credential = 'gui') => ({ connId, principal: HUMAN, principalClass: 'human', surface, credential });
const permission = (b: ApprovalBroker, lines = ['Bash: rm -rf build/']) => b.raise({ kind: 'permission', requestedBy: AGENT, attended: true, detail: { tool: 'Bash', input: 'rm -rf build/' }, lines, tool: 'Bash', toolInput: { command: 'rm -rf build/' } });

async function refusal(p: Promise<unknown>): Promise<{ code: string; gate: string; reason?: string; data: Record<string, unknown> }> {
  const e = await p.then(
    () => undefined,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(RefusedError);
  const r = (e as RefusedError).refusal;
  expect(validateRefusalV1(r)).toEqual([]);
  return { code: r.code, gate: r.gate, reason: r.data?.reason as string | undefined, data: (r.data ?? {}) as Record<string, unknown> };
}

describe('#approval-broker cards (§3.4 card:v1)', () => {
  it('cards validate, carry kernel-signed actions per valid decision, and approval.request is written before the card is returned', async () => {
    const r = rig();
    const c = await permission(r.broker);
    expect(validateCardV1(c, { mode: 'strict' })).toEqual([]);
    expect(c.actions.map((a) => (a as { decision: string }).decision).sort()).toEqual(['allow', 'always', 'deny']);
    expect(verifyActions(r.ring, c)).toBe(true);
    expect(verifyActions(r.ring, { ...c, contentHash: `sha256:${'0'.repeat(64)}` })).toBe(false);
    expect(r.kinds()).toEqual(['approval.request']);
    expect(r.rows[0]!.payload).toMatchObject({ tool_input: { command: 'rm -rf build/' } });
  });

  it('hidden characters and bidi controls are escaped visibly and flag the card (§4.5)', async () => {
    const r = rig();
    const c = await permission(r.broker, ['rm\u202E-rf\u200B /']);
    expect(c.flags).toEqual(['bidi', 'hidden-chars']);
    // tag characters are stripped and flag hidden-chars; C1 controls (incl. CSI U+009B) are escaped like C0
    const t = await permission(r.broker, [`ok${String.fromCodePoint(0xe0041, 0xe0042)} ${String.fromCharCode(0x9b)}31m ${String.fromCharCode(0x85)}x`]);
    expect(t.flags).toEqual(['hidden-chars']);
    const text = JSON.stringify(t.block);
    expect(text).not.toMatch(/[\u{E0000}-\u{E007F}\u0080-\u009F]/u);
    expect(text).toContain('\\\\u{9B}');
    expect(text).toContain('\\\\u{85}');
    expect(JSON.stringify(c.block)).not.toMatch(/[\u202E\u200B]/);
    expect(JSON.stringify(c.block)).toContain('\\\\u{202E}');
  });

  it('the presence prompt is composed from the card record and signed by the kernel key', async () => {
    const seen: Array<{ text: string; connId: string }> = [];
    const r = rig({ presence: touching(seen) });
    const c = await permission(r.broker);
    const p = r.broker.promptFor(c.cardId, 'always', 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA', 'fresh presence: always is a standing rule');
    expect(verifyPresencePrompt(r.ring, p)).toBe(true);
    expect(p.text).toContain('conn:01HZZZZZZZZZZZZZZZZZZZZZZA');
    expect(p.text).toContain(c.contentHash.slice(7, 19));
    expect(p.text).toContain('1 GUI session open');
    expect(verifyPresencePrompt(r.ring, { ...p, text: `${p.text} (approve all)` })).toBe(false);
    expect(verifyPresencePrompt(r.ring, { ...p, record: { ...p.record, kind: 'install' } })).toBe(false);
    await r.broker.approve(H(), { cardId: c.cardId, decision: 'always', decisionSig: r.sig(c.cardId, 'always', c.contentHash) });
    expect(seen[0]!.text).toContain('always is a standing rule');
  });
});

describe('G-BRK-01 deny on silence (B6)', () => {
  it('a tool.permission card expires into deny; nothing expires into allow; unknown cards are deny', async () => {
    const r = rig();
    const c = await permission(r.broker);
    const waiting = r.broker.decisionOf(c.cardId);
    expect(await r.broker.expireDue()).toEqual([]);
    r.now.t += 10 * 60_000 + 1;
    expect(await r.broker.expireDue()).toEqual([c.cardId]);
    expect(await waiting).toBe('deny');
    expect(r.broker.card(c.cardId)!.state).toBe('expired');
    expect(r.rows.find((x) => x.kind === 'approval.expire')!.payload).toMatchObject({ into: 'deny' });
    expect(await r.broker.decisionOf('card:01HZZZZZZZZZZZZZZZZZZZZZZZ')).toBe('deny');
  });

  it('fallback and api-token cards never expire (they wait); unattended cards are never auto-decided', async () => {
    const r = rig();
    const f = await r.broker.raise({ kind: 'fallback', requestedBy: AGENT, attended: false, detail: { model: 'local' }, lines: ['no local model: use cloud?'] });
    const a = await r.broker.raise({ kind: 'api-token', requestedBy: HUMAN, attended: true, detail: { x: 1 }, lines: ['api'] });
    expect(f.timeoutAt).toBeUndefined();
    expect(a.timeoutAt).toBeUndefined();
    r.now.t += 365 * 24 * 3_600_000;
    expect(await r.broker.expireDue()).toEqual([]);
    expect(r.broker.card(f.cardId)!.state).toBe('pending');
  });
});

describe('G-BRK-02 / G-ABI-02: only the human decides; the voice row refuses every form', () => {
  it('agent, session, mod, read-token and peer classes are FORBIDDEN{matrix}', async () => {
    const r = rig({ presence: touching() });
    const c = await permission(r.broker);
    for (const cls of ['agent', 'session', 'mod', 'readToken', 'peer']) {
      const x = await refusal(r.broker.approve({ ...H(), principal: AGENT, principalClass: cls }, { cardId: c.cardId, decision: 'allow', decisionSig: r.sig(c.cardId, 'allow', c.contentHash, AGENT) }));
      expect(x).toMatchObject({ code: 'FORBIDDEN', reason: 'matrix' });
    }
    expect(r.broker.card(c.cardId)!.state).toBe('pending');
  });

  it('voice: every approve form is FORBIDDEN gate voice reason voice-off (no arm can exist before Move 4)', async () => {
    const r = rig({ presence: touching() });
    const c = await permission(r.broker);
    const forms: unknown[] = [
      { via: 'voice', decision: 'allow', voice: { armId: 'arm:01HZZZZZZZZZZZZZZZZZZZZZZZ', turnId: 't', target: 'x', attest: {} } },
      { cardId: c.cardId, decision: 'allow', decisionSig: 'AAAA' },
      { decision: 'deny' },
      {},
    ];
    for (const f of forms) expect(await refusal(r.broker.approve({ ...H(), principal: 'p:abcdefgh/voice', principalClass: 'voice' }, f))).toMatchObject({ code: 'FORBIDDEN', gate: 'voice', reason: 'voice-off' });
    // a human sending the intent form is refused the same way; via link is refused (no decision over a link)
    expect(await refusal(r.broker.approve(H(), { via: 'voice', decision: 'allow', voice: {} }))).toMatchObject({ gate: 'voice', reason: 'voice-off' });
    expect(await refusal(r.broker.approve(H(), { cardId: c.cardId, decision: 'allow', via: 'link', decisionSig: 'AAAA' }))).toMatchObject({ gate: 'link', reason: 'peer-via' });
  });
});

describe('G-BRK-03 decisionSig', () => {
  it('a bad, cross-card, cross-decision or cross-approver decisionSig is AUTH{bad-signature}', async () => {
    const r = rig({ presence: touching() });
    const c = await permission(r.broker);
    const other = await permission(r.broker, ['other']);
    for (const sig of ['AAAA', r.sig(other.cardId, 'allow', other.contentHash), r.sig(c.cardId, 'deny', c.contentHash), r.sig(c.cardId, 'allow', c.contentHash, AGENT)]) {
      expect(await refusal(r.broker.approve(H(), { cardId: c.cardId, decision: 'allow', decisionSig: sig }))).toMatchObject({ code: 'AUTH', reason: 'bad-signature' });
    }
    expect(await refusal(r.broker.approve(H(), { cardId: c.cardId, decision: 'allow' }))).toMatchObject({ code: 'BAD_REQUEST', reason: 'bad-params' });
    expect(r.kinds()).not.toContain('approval.decide');
  });

  it('production before M1.3: no approvals key ⇒ UNSUPPORTED{presence}; no presence prompt ⇒ UNSUPPORTED{presence} + approval.presence.denied', async () => {
    const rows: string[] = [];
    const kernel = SoftwareEd25519Signer.generate('kernel');
    const prod = new ApprovalBroker({ kernel, kernelPrincipal: KERNEL, log: async (k) => void rows.push(k) });
    const c = await permission(prod);
    expect(await refusal(prod.approve(H(), { cardId: c.cardId, decision: 'allow', decisionSig: 'AAAA' }))).toMatchObject({ code: 'UNSUPPORTED', reason: 'presence', data: { milestone: 'M1.3' } });
    const r = rig(); // approvals key present, presence provider = PRESENCE_UNAVAILABLE (the production default)
    const c2 = await permission(r.broker);
    expect(await refusal(r.broker.approve(H(), { cardId: c2.cardId, decision: 'allow', decisionSig: r.sig(c2.cardId, 'allow', c2.contentHash) }))).toMatchObject({ code: 'UNSUPPORTED', reason: 'presence', data: { milestone: 'M1.3' } });
    expect(r.kinds()).toContain('approval.presence.denied');
    expect(r.kinds()).not.toContain('approval.decide');
  });
});

describe('G-BRK-05 presence classes and the per-connection cached unlock', () => {
  const A = 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA';
  const B = 'conn:01HZZZZZZZZZZZZZZZZZZZZZZB';

  it('a fresh presence on A opens A’s unlock; a cached allow then rides it on A only — never from B; always is refused under the cached unlock', async () => {
    let touch = true;
    const presence: PresenceProvider = { prove: (req) => (touch ? touching().prove(req) : declining.prove(req)) };
    const r = rig({ presence });
    const c1 = await permission(r.broker);
    const d1 = await r.broker.approve(H(A), { cardId: c1.cardId, decision: 'allow', decisionSig: r.sig(c1.cardId, 'allow', c1.contentHash) });
    expect(d1).toMatchObject({ state: 'decided', presence: 'fresh', via: 'gui', decidedBy: HUMAN });
    expect(r.kinds()).toContain('approval.unlock');
    touch = false; // from now on the human does not touch
    const c2 = await permission(r.broker);
    expect(await r.broker.approve(H(A), { cardId: c2.cardId, decision: 'deny', decisionSig: r.sig(c2.cardId, 'deny', c2.contentHash) })).toMatchObject({ presence: 'cached' });
    const c3 = await permission(r.broker);
    expect(await refusal(r.broker.approve(H(B), { cardId: c3.cardId, decision: 'allow', decisionSig: r.sig(c3.cardId, 'allow', c3.contentHash) }))).toMatchObject({ code: 'FORBIDDEN', reason: 'presence' });
    expect(await refusal(r.broker.approve(H(A), { cardId: c3.cardId, decision: 'always', decisionSig: r.sig(c3.cardId, 'always', c3.contentHash) }))).toMatchObject({ code: 'FORBIDDEN', reason: 'presence' });
    expect(r.kinds()).not.toContain('approval.rule.learned');
    touch = true;
    expect(await r.broker.approve(H(A), { cardId: c3.cardId, decision: 'always', decisionSig: r.sig(c3.cardId, 'always', c3.contentHash) })).toMatchObject({ presence: 'fresh' });
    expect(r.rows.find((x) => x.kind === 'approval.rule.learned')!.payload).toMatchObject({ tool: 'Bash', matchExact: true, presence: 'fresh' });
  });

  it('the unlock drops on connection close and after 15 min idle; a CLI connection never holds one', async () => {
    let touch = true;
    const presence: PresenceProvider = { prove: (req) => (touch ? touching().prove(req) : declining.prove(req)) };
    const r = rig({ presence });
    const c1 = await permission(r.broker);
    await r.broker.approve(H(A), { cardId: c1.cardId, decision: 'allow', decisionSig: r.sig(c1.cardId, 'allow', c1.contentHash) });
    expect(r.broker.unlocks.state(A)).toMatchObject({ state: 'cached' });
    await r.broker.connectionClosed(A);
    expect(r.broker.unlocks.state(A)).toBeNull();
    expect(r.rows.find((x) => x.kind === 'approval.unlock.dropped')!.payload).toMatchObject({ connId: A, reason: 'closed' });
    const c2 = await permission(r.broker);
    await r.broker.approve(H(A), { cardId: c2.cardId, decision: 'allow', decisionSig: r.sig(c2.cardId, 'allow', c2.contentHash) });
    r.now.t += UNLOCK_IDLE_MS + 1;
    touch = false;
    const c3 = await permission(r.broker);
    expect(await refusal(r.broker.approve(H(A), { cardId: c3.cardId, decision: 'allow', decisionSig: r.sig(c3.cardId, 'allow', c3.contentHash) }))).toMatchObject({ reason: 'presence' });
    touch = true;
    const cli = 'conn:01HZZZZZZZZZZZZZZZZZZZZZZC';
    const d = await r.broker.approve(H(cli, 'cli', 'device'), { cardId: c3.cardId, decision: 'allow', decisionSig: r.sig(c3.cardId, 'allow', c3.contentHash) });
    expect(d).toMatchObject({ presence: 'cli', via: 'cli' });
    expect(r.broker.unlocks.state(cli)).toBeNull();
    expect(r.rows.filter((x) => x.kind === 'approval.suspect').map((x) => x.payload.why)).toContain('cli-provenance-unknown');
  });

  it('presence is BOUND to the decision on the kernel-trusted clock: another card’s token, a stale token or an unbound token never decides', async () => {
    const c0 = { id: '' };
    const wrong: PresenceProvider = { prove: async (req) => mintTestPresence(req.purpose, { bind: { ...req.binding, cardId: c0.id } }) };
    const stale: PresenceProvider = { prove: async (req) => mintTestPresence(req.purpose, { bind: req.binding, ageMs: 61_000 }) };
    const unbound: PresenceProvider = { prove: async (req) => mintTestPresence(req.purpose) };
    for (const p of [wrong, stale, unbound]) {
      const r = rig({ presence: p });
      const other = await permission(r.broker, ['other']);
      c0.id = other.cardId;
      const c = await permission(r.broker);
      expect(await refusal(r.broker.approve(H(), { cardId: c.cardId, decision: 'allow', decisionSig: r.sig(c.cardId, 'allow', c.contentHash) }))).toMatchObject({ code: 'FORBIDDEN', reason: 'presence' });
      expect(r.kinds()).not.toContain('approval.decide');
    }
  });

  it('approval.decide carries decisionSig, presence, via, connId and client provenance, and is written before the state changes', async () => {
    const r = rig({ presence: touching() });
    const c = await permission(r.broker);
    const sig = r.sig(c.cardId, 'allow', c.contentHash);
    await r.broker.approve(H(), { cardId: c.cardId, decision: 'allow', decisionSig: sig });
    expect(r.rows.find((x) => x.kind === 'approval.decide')!.payload).toMatchObject({ cardId: c.cardId, decision: 'allow', by: HUMAN, decisionSig: sig, presence: 'fresh', via: 'gui', connId: H().connId, cli: { client: 'gui', connId: H().connId } });
    expect(await refusal(r.broker.approve(H(), { cardId: c.cardId, decision: 'allow', decisionSig: sig }))).toMatchObject({ code: 'BAD_REQUEST' }); // decided: not decidable again
    expect(await refusal(r.broker.approve(H(), { cardId: c.cardId, decision: 'install', decisionSig: sig }))).toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('Aegis C1: the credential, not the self-declared surface, decides GUI vs CLI', () => {
  it('a device-key connection claiming surface browser gets no unlock and is recorded via cli with a suspect row', async () => {
    const r = rig({ presence: touching() });
    const c = await permission(r.broker);
    const conn = 'conn:01HZZZZZZZZZZZZZZZZZZZZZZD';
    const d = await r.broker.approve(H(conn, 'browser', 'device'), { cardId: c.cardId, decision: 'allow', decisionSig: r.sig(c.cardId, 'allow', c.contentHash) });
    expect(d).toMatchObject({ presence: 'cli', via: 'cli' });
    expect(r.broker.unlocks.state(conn)).toBeNull();
    expect(r.kinds()).not.toContain('approval.unlock');
    expect(r.rows.filter((x) => x.kind === 'approval.suspect').map((x) => x.payload.why)).toContain('cli-provenance-unknown');
  });

  it('a closed connection never opens an unlock nor appends approval.decide', async () => {
    const r = rig({ presence: touching() });
    const c = await permission(r.broker);
    const x = await refusal(r.broker.approve({ ...H(), isLive: () => false }, { cardId: c.cardId, decision: 'allow', decisionSig: r.sig(c.cardId, 'allow', c.contentHash) }));
    expect(x).toMatchObject({ code: 'ENGINE', reason: 'gone' });
    expect(r.kinds()).not.toContain('approval.decide');
    expect(r.kinds()).not.toContain('approval.unlock');
  });
});

describe('expiry vs an in-flight decision', () => {
  it('the clock passes the timeout while presence is being proved: exactly one terminal row', async () => {
    const now = { t: Date.UTC(2026, 9, 18, 12) };
    let broker: ApprovalBroker | undefined;
    const slow: PresenceProvider = {
      prove: async (req) => {
        now.t += 11 * 60_000; // past the permission timeout
        expect(await broker!.expireDue()).toEqual([]); // the sweep skips a card being decided
        return mintTestPresence(req.purpose, { bind: req.binding });
      },
    };
    const r = rig({ presence: slow, now });
    broker = r.broker;
    const c = await permission(r.broker);
    await r.broker.approve(H(), { cardId: c.cardId, decision: 'allow', decisionSig: r.sig(c.cardId, 'allow', c.contentHash) });
    await r.broker.expireDue();
    expect(r.kinds().filter((k) => k === 'approval.decide' || k === 'approval.expire')).toEqual(['approval.decide']);
    expect(await r.broker.decisionOf(c.cardId)).toBe('allow');
  });
});

describe('one decision per card', () => {
  it('two concurrent approves of one card: exactly one decides, one approval.decide row', async () => {
    const r = rig({ presence: touching() });
    const c = await permission(r.broker);
    const p = { cardId: c.cardId, decision: 'allow', decisionSig: r.sig(c.cardId, 'allow', c.contentHash) };
    const out = await Promise.allSettled([r.broker.approve(H(), p), r.broker.approve(H('conn:01HZZZZZZZZZZZZZZZZZZZZZZB'), p)]);
    expect(out.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(r.kinds().filter((k) => k === 'approval.decide')).toHaveLength(1);
  });
});

describe('install card under the broker (T-2026-10-18-008)', () => {
  it('rendered from the re-derived detail; install = fresh presence bound to {cardId, contentHash} + root; grant rows appended', async () => {
    const home = tmp();
    const auth = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    const src = path.join(tmp(), 'diff-lens');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, MANIFEST_FILE), JSON.stringify({ manifest: 1, kind: 'mod', name: 'diff-lens', version: '1.0.0', abi: 'mod-abi:v1', provides: { tools: [{ name: 'lens.diff', effects: ['read'] }] } }));
    const st = stageInstall({ home, source: src, via: 'package', requestedBy: AGENT, trust: auth });
    if (st.state !== 'staged') throw new Error('expected staged');
    const r = rig({ presence: touching(), root: auth });
    const card = await raiseInstallCard(r.broker, { home, name: 'diff-lens', cardId: st.cardId, authority: auth });
    expect(validateCardV1(card)).toEqual([]);
    expect(JSON.stringify(card.block)).toContain('diff-lens'); // rendered by the broker from the re-derived lines
    const d = await r.broker.approve(H(), { cardId: card.cardId, decision: 'install', decisionSig: r.sig(card.cardId, 'install', card.contentHash) });
    expect(d.state).toBe('decided');
    expect(r.rows.find((x) => x.kind === 'approval.decide')!.payload.rootSig).toBeDefined();
    expect(readGrants(home, auth).installs.map((g) => g.cardId)).toEqual([st.cardId]);
  });

  it('a tampered staged detail never renders: re-derivation refuses INTEGRITY', async () => {
    const home = tmp();
    const auth = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    const src = path.join(tmp(), 'diff-lens');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, MANIFEST_FILE), JSON.stringify({ manifest: 1, kind: 'mod', name: 'diff-lens', version: '1.0.0', abi: 'mod-abi:v1', provides: { tools: [{ name: 'lens.diff', effects: ['read'] }] } }));
    const st = stageInstall({ home, source: src, via: 'package', requestedBy: AGENT, trust: auth });
    if (st.state !== 'staged') throw new Error('expected staged');
    const file = path.join(home, 'mods', 'diff-lens', 'staged', `${st.cardId.replace(':', '-')}.json`);
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    rec.detail.effects = [];
    fs.writeFileSync(file, JSON.stringify(rec));
    const r = rig({ presence: touching(), root: auth });
    await expect(raiseInstallCard(r.broker, { home, name: 'diff-lens', cardId: st.cardId, authority: auth })).rejects.toMatchObject({ manifestCode: 'INTEGRITY' });
  });
});

describe('G-SUB-02 / G-SUB-03 the per-use api-token card', () => {
  const HSID = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ';
  it('agent, session, mod and voice principals cannot request one', async () => {
    const r = rig();
    const billing = new ApiTokenBilling(r.broker, async (k, p) => void r.rows.push({ kind: k, payload: p }));
    for (const cls of ['agent', 'session', 'mod', 'voice']) {
      expect(await refusal(billing.request({ principal: AGENT, principalClass: cls, reason: 'need it', hsid: HSID }))).toMatchObject({ code: 'FORBIDDEN', reason: 'matrix' });
    }
    expect(r.kinds().filter((k) => k === 'billing.api.refused')).toHaveLength(4);
    expect(r.broker.cards()).toEqual([]);
  });

  it('human request → root + fresh presence → injected into exactly one child; indicator and billing.api.active for the whole validity; ended on expiry', async () => {
    const auth = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    const r = rig({ presence: touching(), root: auth });
    const log = async (k: string, p: Record<string, unknown>) => void r.rows.push({ kind: k, payload: p });
    const billing = new ApiTokenBilling(r.broker, log, { fetch: async () => 'sk-test-token' }, () => r.now.t);
    const card = await billing.request({ principal: HUMAN, principalClass: 'human', reason: 'subscription window exhausted for a deadline', hsid: HSID, ttlMs: 30 * 60_000 });
    expect(card.timeoutAt).toBeUndefined();
    expect(billing.status()).toMatchObject({ mode: 'subscription', indicator: null });
    await r.broker.approve(H(), { cardId: card.cardId, decision: 'use-api-token', decisionSig: r.sig(card.cardId, 'use-api-token', card.contentHash) });
    expect(billing.status()).toMatchObject({ mode: 'api-token', indicator: 'API CREDITS ACTIVE' });
    expect(billing.billingForKernelSpawn(HSID, AGENT)).toBeNull(); // bound to card.requestedBy
    expect(billing.billingForKernelSpawn('hsid:v1:01HYYYYYYYYYYYYYYYYYYYYYYY', HUMAN)).toBeNull(); // only the card's own hsid
    expect(billing.billingForKernelSpawn(HSID, HUMAN)).toBe(`api-token:${card.cardId}`);
    expect(billing.takeEnvFor(HSID, { PATH: '/bin' })).toEqual({ PATH: '/bin', ANTHROPIC_API_KEY: 'sk-test-token' });
    expect(billing.takeEnvFor(HSID, { PATH: '/bin' })).toBeNull(); // exactly one child
    expect(billing.billingForKernelSpawn(HSID, HUMAN)).toBeNull(); // the single injection ends api billing for later spawns
    expect(billing.status().indicator).toBe('API CREDITS ACTIVE'); // the indicator stays for the card's validity
    await billing.onTurn(HSID);
    expect(r.kinds().filter((k) => k === 'billing.api.active')).toHaveLength(2);
    r.now.t += 30 * 60_000 + 1;
    await billing.sweep();
    expect(r.kinds()).toContain('billing.api.ended');
    expect(billing.status().indicator).toBeNull();
    expect(JSON.stringify(r.rows)).not.toContain('sk-test-token');
  });

  it('production keystore (before M1.3) refuses the activation', async () => {
    const auth = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    const r = rig({ presence: touching(), root: auth });
    const billing = new ApiTokenBilling(r.broker, async () => undefined);
    const card = await billing.request({ principal: HUMAN, principalClass: 'human', reason: 'x', hsid: HSID });
    expect(await refusal(r.broker.approve(H(), { cardId: card.cardId, decision: 'use-api-token', decisionSig: r.sig(card.cardId, 'use-api-token', card.contentHash) }))).toMatchObject({ code: 'UNSUPPORTED', data: { milestone: 'M1.3' } });
    expect(billing.status().indicator).toBeNull();
  });

  it.todo('G-SUB-03 the GUI Shuttle view renders API CREDITS ACTIVE for the card’s whole validity — #gui (M1.12)');
});

describe('M1.6 residuals named by slice', () => {
  it.todo('G-BRK-04 — the spec names the id in M1.6’s row but defines no prose for it (v2 had G-BRK-01..03 only); reading pending (see report)');
  it.todo('presence prompt rendered natively or in a helper window (status.presencePromptText) — M1.3 (#identity helper, probe S29-07)');
  it.todo('web endpoint theft raises a fresh-presence gate-class card naming the revoked connection — next M1.6 slice (#web-endpoint → broker hook)');
  it.todo('approval.suspect for a CLI decision whose pgid is a live session’s job — M1.7 (#supervisor supplies liveSessionPgids, peer credentials supply provenance)');
});
