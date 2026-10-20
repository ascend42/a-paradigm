/**
 * #approval-broker prefix scope falsifiers (TD-2026-10-20-294 part 3). approve{always, scope:{kind:'prefix'}} is
 * accepted only on a Bash permission card whose shown command is one literal simple command starting with the
 * prefix; decisionSig covers the scope (v2 layout, last line the scope digest), the presence binding carries the
 * scope digest, approval.decide records the scope and approval.rule.learned records match:'prefix'. The rows the
 * broker writes, folded by #always-rules, form a working prefix rule.
 */
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RefusedError, scopeDigest } from '@a-company/gnomon-contracts';
import { ApprovalBroker, approvalsKeyFrom, type PresenceProvider } from '../src/kernel/broker/index.js';
import { approveMessage, decisionMessage, KeyRing, signaturePreimage, SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { mintTestPresence } from '../src/kernel/testing.js';
import { inputHash } from '../src/kernel/supervisor/permission.js';
import { RuleBook } from '../src/kernel/supervisor/rules.js';
import { checkDecisionSigs } from '../src/kernel/log/replay.js';

const HUMAN = 'p:abcdefgh/matt';
const AGENT = 'p:abcdefgh/s-01hzzzzz';
const KERNEL = 'p:abcdefgh/kernel';
const REPO = 'sha256:' + '0'.repeat(64);
const H = { connId: 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA', principal: HUMAN, principalClass: 'human', surface: 'browser', credential: 'gui' };

function rig() {
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const prompts: string[] = [];
  const bindings: Array<Record<string, string>> = [];
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ring = new KeyRing();
  const keyId = ring.addP256(publicKey);
  const signMsg = (m: string) => cryptoSign('sha256', signaturePreimage('approve', m), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
  const presence: PresenceProvider = {
    prove: async (req) => {
      prompts.push(req.prompt.text);
      bindings.push({ ...req.binding });
      return mintTestPresence(req.purpose, { bind: req.binding });
    },
  };
  const broker = new ApprovalBroker({
    kernel: SoftwareEd25519Signer.generate('kernel'),
    kernelPrincipal: KERNEL,
    log: async (kind, payload) => void rows.push({ kind, payload }),
    approvals: approvalsKeyFrom(ring, (p) => (p === HUMAN ? keyId : undefined)),
    presence,
    clock: () => Date.UTC(2026, 9, 20, 12),
    mono: () => Date.UTC(2026, 9, 20, 12),
    guiSessions: () => 1,
  });
  const raise = (command: string, tool = 'Bash') =>
    broker.raise({ kind: 'permission', requestedBy: AGENT, attended: true, detail: { tool, input: command }, lines: [`${tool}: ${command}`], tool, toolInput: { command }, ruleScope: { repoKey: REPO } });
  const v1 = (cardId: string, decision: string, h: string) => signMsg(approveMessage({ cardId, decision, cardContentHash: h, approverPrincipalId: HUMAN }));
  const scoped = (cardId: string, h: string, prefix: string[]) => signMsg(decisionMessage({ cardId, decision: 'always', cardContentHash: h, approverPrincipalId: HUMAN, scopeDigest: scopeDigest({ kind: 'prefix', prefix }) }));
  return { broker, rows, prompts, bindings, raise, v1, scoped, ring, keyId };
}

async function refusal(p: Promise<unknown>): Promise<{ code: string; reason?: string }> {
  const e = await p.then(
    () => undefined,
    (x: unknown) => x,
  );
  if (!(e instanceof RefusedError)) throw new Error(`expected a refusal, got ${String(e)}`);
  return { code: e.refusal.code, reason: (e.refusal as { reason?: string }).reason };
}

describe('#approval-broker prefix-scoped always (TD-2026-10-20-294)', () => {
  it('a prefix always is signed over the scope, recorded on decide and learned, and folds into a working rule', async () => {
    const r = rig();
    const c = await r.raise('git log -n 5');
    const d = await r.broker.approve(H, { cardId: c.cardId, decision: 'always', scope: { kind: 'prefix', prefix: ['git', 'log'] }, decisionSig: r.scoped(c.cardId, c.contentHash, ['git', 'log']) });
    expect(d).toMatchObject({ state: 'decided', presence: 'fresh' });
    expect(r.prompts[0]).toContain('git log');
    expect(r.bindings[0]!.scopeDigest).toBe(scopeDigest({ kind: 'prefix', prefix: ['git', 'log'] }));
    expect(r.rows.find((x) => x.kind === 'approval.decide')!.payload.scope).toEqual({ kind: 'prefix', prefix: ['git', 'log'] });
    expect(r.rows.find((x) => x.kind === 'approval.rule.learned')!.payload).toMatchObject({ match: 'prefix', prefix: ['git', 'log'], tool: 'Bash', repoKey: REPO });
    // the broker's rows, as the kernel signs them, form the rule
    const book = new RuleBook({ principal: KERNEL, isKernelKey: () => true });
    for (const row of r.rows) book.fold({ kind: row.kind, principal: KERNEL, keyId: 'k', payload: row.payload });
    const input = { command: 'git log --oneline' };
    expect(book.match(REPO, 'Bash', inputHash(input), input, { prefixRules: true, roots: ['/r'] })).toMatchObject({ ruleId: c.cardId, match: 'prefix' });
    const bad = { command: 'git log; rm -rf x' };
    expect(book.match(REPO, 'Bash', inputHash(bad), bad, { prefixRules: true, roots: ['/r'] })).toBeNull();
  });

  it('decisionSig covers the scope: a v1 (unscoped) signature or one over another prefix is refused AUTH', async () => {
    const r = rig();
    const c = await r.raise('git log -n 5');
    expect(await refusal(r.broker.approve(H, { cardId: c.cardId, decision: 'always', scope: { kind: 'prefix', prefix: ['git', 'log'] }, decisionSig: r.v1(c.cardId, 'always', c.contentHash) }))).toMatchObject({ code: 'AUTH' });
    expect(await refusal(r.broker.approve(H, { cardId: c.cardId, decision: 'always', scope: { kind: 'prefix', prefix: ['git', 'log'] }, decisionSig: r.scoped(c.cardId, c.contentHash, ['git']) }))).toMatchObject({ code: 'AUTH' });
    // a scoped signature never passes as the exact rule either
    expect(await refusal(r.broker.approve(H, { cardId: c.cardId, decision: 'always', decisionSig: r.scoped(c.cardId, c.contentHash, ['git', 'log']) }))).toMatchObject({ code: 'AUTH' });
    expect(r.rows.map((x) => x.kind)).not.toContain('approval.rule.learned');
  });

  it('refuses a prefix the shown command does not have, a compound command, a non-Bash card, a non-always decision and a malformed scope', async () => {
    const r = rig();
    const c = await r.raise('git log -n 5');
    for (const prefix of [['git', 'status'], ['git', 'lo'], ['log'], ['git', 'log', '-n']].slice(0, 3)) {
      expect(await refusal(r.broker.approve(H, { cardId: c.cardId, decision: 'always', scope: { kind: 'prefix', prefix }, decisionSig: r.scoped(c.cardId, c.contentHash, prefix) })), prefix.join(' ')).toMatchObject({ code: 'BAD_REQUEST' });
    }
    const compound = await r.raise('git log | sh');
    expect(await refusal(r.broker.approve(H, { cardId: compound.cardId, decision: 'always', scope: { kind: 'prefix', prefix: ['git', 'log'] }, decisionSig: r.scoped(compound.cardId, compound.contentHash, ['git', 'log']) }))).toMatchObject({ code: 'BAD_REQUEST' });
    const envd = await r.raise('FOO=1 git log');
    expect(await refusal(r.broker.approve(H, { cardId: envd.cardId, decision: 'always', scope: { kind: 'prefix', prefix: ['git'] }, decisionSig: r.scoped(envd.cardId, envd.contentHash, ['git']) }))).toMatchObject({ code: 'BAD_REQUEST' });
    const write = await r.raise('git log', 'Write');
    expect(await refusal(r.broker.approve(H, { cardId: write.cardId, decision: 'always', scope: { kind: 'prefix', prefix: ['git'] }, decisionSig: r.scoped(write.cardId, write.contentHash, ['git']) }))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(await refusal(r.broker.approve(H, { cardId: c.cardId, decision: 'allow', scope: { kind: 'prefix', prefix: ['git'] }, decisionSig: r.v1(c.cardId, 'allow', c.contentHash) }))).toMatchObject({ code: 'BAD_REQUEST' });
    for (const scope of [{ kind: 'prefix', prefix: [] }, { kind: 'prefix', prefix: ['a', 'b', 'c', 'd'] }, { kind: 'glob', prefix: ['git*'] }, 'git']) {
      expect(await refusal(r.broker.approve(H, { cardId: c.cardId, decision: 'always', scope, decisionSig: r.v1(c.cardId, 'always', c.contentHash) }))).toMatchObject({ code: 'BAD_REQUEST' });
    }
    expect(r.rows.map((x) => x.kind)).not.toContain('approval.decide');
  });

  it('replay verifies a scoped always over the scope layout and flags one whose recorded scope was rewritten', async () => {
    const r = rig();
    const c = await r.raise('git log -n 5');
    await r.broker.approve(H, { cardId: c.cardId, decision: 'always', scope: { kind: 'prefix', prefix: ['git', 'log'] }, decisionSig: r.scoped(c.cardId, c.contentHash, ['git', 'log']) });
    const decide = r.rows.find((x) => x.kind === 'approval.decide')!;
    const row = (payload: Record<string, unknown>) => ({ seq: 1, kind: 'approval.decide', envelope: JSON.stringify({ payload }) }) as never;
    const keys = { keyIdsFor: () => [r.keyId] };
    expect(checkDecisionSigs([row(decide.payload)], r.ring, keys).divergences).toEqual([]);
    const widened = { ...decide.payload, scope: { kind: 'prefix', prefix: ['git'] } };
    expect(checkDecisionSigs([row(widened)], r.ring, keys).divergences).toMatchObject([{ reason: 'decision-sig-bad' }]);
  });

  it('an exact scope is the v1 exact rule', async () => {
    const r = rig();
    const c = await r.raise('git log -n 5');
    await r.broker.approve(H, { cardId: c.cardId, decision: 'always', scope: { kind: 'exact' }, decisionSig: r.v1(c.cardId, 'always', c.contentHash) });
    expect(r.rows.find((x) => x.kind === 'approval.decide')!.payload.scope).toBeUndefined();
    expect(r.rows.find((x) => x.kind === 'approval.rule.learned')!.payload).toMatchObject({ matchExact: true });
  });
  it('Aegis H1: the broker refuses a prefix the policy refuses, even when it is a true prefix of the shown command', async () => {
    const r = rig();
    for (const [command, prefix] of [['npm test', ['npm', 'test']], ['bash x.sh', ['bash', 'x.sh']], ['git push origin', ['git', 'push']], ['git log -n 5', ['git']], ['g\u0456t log', ['g\u0456t', 'log']], ['python3 -m http.server', ['python3', '-m']], ['cargo build', ['cargo', 'build']]] as Array<[string, string[]]>) {
      const c = await r.raise(command);
      const e = await refusal(r.broker.approve(H, { cardId: c.cardId, decision: 'always', scope: { kind: 'prefix', prefix }, decisionSig: r.scoped(c.cardId, c.contentHash, prefix) }));
      expect(e, command).toMatchObject({ code: 'BAD_REQUEST' });
    }
    expect(r.prompts).toEqual([]); // refused before any presence prompt
    expect(r.rows.map((x) => x.kind)).not.toContain('approval.decide');
  });

  it('Aegis M1: the presence prompt shows each prefix word quoted and escaped', async () => {
    const r = rig();
    const c = await r.raise('git log -n 5');
    await r.broker.approve(H, { cardId: c.cardId, decision: 'always', scope: { kind: 'prefix', prefix: ['git', 'log'] }, decisionSig: r.scoped(c.cardId, c.contentHash, ['git', 'log']) });
    expect(r.prompts[0]).toContain("'git' 'log' (2 words)");
  });

  it('Aegis L1: a CLI-credential always+prefix takes FRESH presence (presence:cli), every time, and learns the same rule', async () => {
    const r = rig();
    const CLI = { ...H, connId: 'conn:01HZZZZZZZZZZZZZZZZZZZZZZC', surface: 'cli', credential: 'cli' };
    for (const n of [1, 2]) {
      const c = await r.raise('git log -n 5');
      const d = await r.broker.approve(CLI, { cardId: c.cardId, decision: 'always', scope: { kind: 'prefix', prefix: ['git', 'log'] }, decisionSig: r.scoped(c.cardId, c.contentHash, ['git', 'log']) });
      expect(d).toMatchObject({ state: 'decided', presence: 'cli', via: 'cli' });
      expect(r.prompts).toHaveLength(n); // a prompt per decision: no cached unlock on a CLI connection
      expect(r.bindings[n - 1]!.scopeDigest).toBe(scopeDigest({ kind: 'prefix', prefix: ['git', 'log'] }));
    }
    const learned = r.rows.filter((x) => x.kind === 'approval.rule.learned').map((x) => x.payload);
    expect(learned).toHaveLength(2);
    for (const l of learned) expect(l).toMatchObject({ match: 'prefix', prefix: ['git', 'log'], presence: 'cli' });
    const book = new RuleBook({ principal: KERNEL, isKernelKey: () => true });
    for (const row of r.rows) book.fold({ kind: row.kind, principal: KERNEL, keyId: 'k', payload: row.payload });
    expect(book.list().filter((x) => x.match === 'prefix')).toHaveLength(2);
  });
});
