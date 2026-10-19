/**
 * #session-runner / #approval-broker: the GUI re-pin of the claude binary
 * (TD-2026-10-19-063, flow 1). Platform-free: the signer check is a fake
 * verifier (the real codesign half is test/claude-verifier-darwin.test.ts),
 * the binaries are files with a Mach-O magic, the home is tempHome().
 */
import { generateKeyPairSync, randomBytes, sign as cryptoSign } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { ApprovalBroker, approvalsKeyFrom, PresenceDenied, type PresenceProvider } from '../src/kernel/broker/index.js';
import { approveMessage, KeyRing, signaturePreimage, SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { mintTestPresence } from '../src/kernel/testing.js';
import { commitPin, prepareClaude, readClaudePin, REPIN_NEXT } from '../src/kernel/runner/binary.js';
import { PreflightRefusal } from '../src/kernel/runner/preflight.js';
import { ClaudeRepinCards, REPIN_CARD_TTL_MS } from '../src/kernel/runner/repin-card.js';
import { CLAUDE_EXPECTED_TEAM, claudeRequirement, type PlatformClaudeVerifier } from '../src/platform/claude-verifier.js';
import { runSessionCommand } from '../src/cli/session-cli.js';
import { tempHome } from './daemon-helpers.js';

const HUMAN = 'p:abcdefgh/matt';
const KERNEL = 'p:abcdefgh/kernel';
const CONN = 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA';
const H = { connId: CONN, principal: HUMAN, principalClass: 'human', surface: 'browser', credential: 'gui' };

const homes: Array<() => void> = [];
afterEach(() => {
  while (homes.length) homes.pop()!();
});

const signed: PlatformClaudeVerifier = { kind: 'codesign', why: 'x', check: () => ({ verified: true, team: CLAUDE_EXPECTED_TEAM }) };
const unsigned: PlatformClaudeVerifier = { kind: 'codesign', why: 'does not satisfy the expected code-signing requirement', check: () => ({ verified: false, team: null }) };

function world(o: { verifier?: PlatformClaudeVerifier; presence?: PresenceProvider } = {}) {
  const t = tempHome('grp-');
  homes.push(t.cleanup);
  const home = t.home;
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const src = path.join(path.dirname(home), 'versions', '2.1.304');
  fs.mkdirSync(path.dirname(src), { recursive: true });
  const write = () => fs.writeFileSync(src, Buffer.concat([Buffer.from('cffaedfe', 'hex'), randomBytes(4096)]));
  write();
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const kernel = SoftwareEd25519Signer.generate('kernel');
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ring = new KeyRing();
  const keyId = ring.addP256(publicKey);
  const sig = (cardId: string, decision: string, contentHash: string) =>
    cryptoSign('sha256', signaturePreimage('approve', approveMessage({ cardId, decision, cardContentHash: contentHash, approverPrincipalId: HUMAN })), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
  const broker = new ApprovalBroker({
    kernel,
    kernelPrincipal: KERNEL,
    log: async (kind, payload) => void rows.push({ kind, payload }),
    approvals: approvalsKeyFrom(ring, (p) => (p === HUMAN ? keyId : undefined)),
    ...(o.presence ? { presence: o.presence } : {}),
    guiSessions: () => 1,
  });
  const repin = new ClaudeRepinCards({ home, broker, requestedBy: KERNEL, verifier: o.verifier ?? signed, source: () => src });
  return { home, src, write, rows, broker, repin, sig, requests: () => rows.filter((r) => r.kind === 'approval.request') };
}

/** First use: the open path's copy + pin (what a live session executes). */
async function firstUse(w: ReturnType<typeof world>): Promise<string> {
  const p = await prepareClaude(w.home, w.src);
  commitPin(w.home, p);
  return p.exec;
}

const touches = (seen: unknown[]): PresenceProvider => ({
  prove: async (req) => {
    seen.push(req);
    return mintTestPresence(req.purpose, { bind: req.binding });
  },
});

describe('TD-2026-10-19-063 the GUI re-pin card', () => {
  it('the designated requirement names Anthropic PBC by team', () => {
    expect(claudeRequirement()).toBe('anchor apple generic and certificate leaf[subject.OU] = "Q6L2SF6YDW"');
  });

  it('a swapped binary pre-stages exactly ONE card (refusal + poll + a second refusal); the open refusal says approve the card', async () => {
    const w = world();
    await firstUse(w);
    expect(await w.repin.poll()).toBeNull(); // unchanged pinned source: nothing
    w.write(); // Claude Code updated itself
    const e = await prepareClaude(w.home, w.src).then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(PreflightRefusal);
    expect((e as PreflightRefusal).data).toMatchObject({ next: REPIN_NEXT });
    const c1 = await w.repin.stage(w.src);
    const c2 = await w.repin.poll();
    const c3 = await w.repin.stage(w.src);
    expect(c1).not.toBeNull();
    expect(c2?.cardId ?? c1!.cardId).toBe(c1!.cardId);
    expect(c3!.cardId).toBe(c1!.cardId);
    expect(w.requests()).toHaveLength(1);
    expect(w.repin.pendingCardId()).toBe(c1!.cardId);
    expect(c1).toMatchObject({ kind: 'gate-class', state: 'pending', requestedBy: KERNEL });
    expect(c1!.flags ?? []).not.toContain('claim-mismatch');
    expect(Date.parse(c1!.timeoutAt!)).toBeGreaterThan(Date.now() + REPIN_CARD_TTL_MS - 60_000);
    const text = JSON.stringify(c1!.block);
    expect(text).toContain('signed by Anthropic PBC (Q6L2SF6YDW)');
    expect(text).toContain('version 2.1.304');
  });

  it('approving with ONE presence token pins; a live session keeps its exec path; the next open runs the new copy', async () => {
    const seen: unknown[] = [];
    const w = world({ presence: touches(seen) });
    const liveExec = await firstUse(w);
    const liveBytes = fs.readFileSync(liveExec);
    const oldSha = readClaudePin(w.home)!.sha256;
    w.write();
    const card = (await w.repin.stage(w.src))!;
    const decided = await w.broker.approve(H, { cardId: card.cardId, decision: 'allow', decisionSig: w.sig(card.cardId, 'allow', card.contentHash) });
    expect(decided).toMatchObject({ state: 'decided', presence: 'fresh' });
    expect(seen).toHaveLength(1); // one Touch ID
    const pin = readClaudePin(w.home)!;
    expect(pin).toMatchObject({ by: 'repin', from: oldSha, logged: false, signer: { team: CLAUDE_EXPECTED_TEAM, verified: true }, approval: { cardId: card.cardId, contentHash: card.contentHash } });
    expect(pin.approval!.decisionSig).toBeTruthy();
    expect(w.rows.find((r) => r.kind === 'approval.decide')!.payload).toMatchObject({ cardId: card.cardId, decision: 'allow' });
    // the live session's copy is untouched
    expect(fs.readFileSync(liveExec).equals(liveBytes)).toBe(true);
    const next = await prepareClaude(w.home, w.src);
    expect(next.exec).not.toBe(liveExec);
    expect(next).toMatchObject({ pin: 'repin', sha256: pin.sha256, repin: { from: oldSha, to: pin.sha256, cardId: card.cardId } });
  });

  it('an unsigned binary is LOUD: claim-mismatch and a first line naming the publisher', async () => {
    const w = world({ verifier: unsigned });
    await firstUse(w);
    w.write();
    const card = (await w.repin.stage(w.src))!;
    expect(card.flags).toContain('claim-mismatch');
    const first = JSON.stringify(card.block);
    expect(first.indexOf('NOT signed by the expected publisher')).toBeGreaterThan(-1);
    expect(first.indexOf('NOT signed by the expected publisher')).toBeLessThan(first.indexOf('Claude Code updated itself'));
  });

  it('a different team than the previous pin is a mismatch even if it verifies', async () => {
    const other: PlatformClaudeVerifier = { kind: 'codesign', why: 'x', check: () => ({ verified: true, team: 'ZZZZZZZZZZ' }) };
    const w = world({ verifier: other });
    await firstUse(w);
    w.write();
    expect((await w.repin.stage(w.src))!.flags).toContain('claim-mismatch');
  });

  it('no pin is written without presence', async () => {
    const w = world({ presence: { prove: async () => Promise.reject(new PresenceDenied('the human did not touch')) } });
    await firstUse(w);
    const before = fs.readFileSync(path.join(w.home, 'claude-pin.json'));
    w.write();
    const card = (await w.repin.stage(w.src))!;
    await expect(w.broker.approve(H, { cardId: card.cardId, decision: 'allow', decisionSig: w.sig(card.cardId, 'allow', card.contentHash) })).rejects.toThrow();
    expect(fs.readFileSync(path.join(w.home, 'claude-pin.json')).equals(before)).toBe(true);
    expect(w.broker.card(card.cardId)!.state).toBe('pending');
  });

  it('a human deny suppresses that sha (no second card)', async () => {
    const w = world({ presence: touches([]) });
    await firstUse(w);
    w.write();
    const card = (await w.repin.stage(w.src))!;
    await w.broker.approve(H, { cardId: card.cardId, decision: 'deny', decisionSig: w.sig(card.cardId, 'deny', card.contentHash) });
    await new Promise((r) => setImmediate(r));
    expect(await w.repin.stage(w.src)).toBeNull();
    expect(w.requests()).toHaveLength(1);
  });

  it('the poll never writes a pin (first use stays the open path; a change only raises the card)', async () => {
    const w = world();
    expect(await w.repin.poll()).toBeNull();
    expect(readClaudePin(w.home)).toBeNull(); // no pin yet: the poll does not pin on first use
    await firstUse(w);
    const before = fs.readFileSync(path.join(w.home, 'claude-pin.json'));
    w.write();
    expect(await w.repin.poll()).not.toBeNull();
    expect(await w.repin.poll()).toBeNull(); // unchanged since the last poll
    expect(fs.readFileSync(path.join(w.home, 'claude-pin.json')).equals(before)).toBe(true);
  });

  it('the CLI still refuses without a TTY', async () => {
    const t = tempHome('grc-');
    homes.push(t.cleanup);
    const stdin = Object.assign(new PassThrough(), { isTTY: false });
    let err = '';
    stdin.end('x\n');
    expect(await runSessionCommand(['repin-claude', '--home', t.home], { stdin, stdout: { isTTY: false, write: () => true }, stderr: { write: (x: string) => (err += x) } })).toBe(1);
    expect(err).toContain('interactive terminal');
    expect(readClaudePin(t.home)).toBeNull();
  });
});
