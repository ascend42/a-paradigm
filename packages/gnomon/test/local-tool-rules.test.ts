/**
 * G-LCL-22 ^local-tool-grant (TD-2026-10-27-833 slice C5'a2): brokered Always rules, kernel side. A REAL
 * ApprovalBroker raises and decides the brokered cards, a REAL RuleBook folds the rows it writes, and LocalToolBroker
 * asks that RuleBook at call time (the supervisor's alwaysRule seam, as local-session.ts wires it).
 * Falsifiers: a destructive tool never auto-passes and never offers Always; an untrusted server never runs without a
 * card; a rule never matches in manual mode, a loop session, after a schema change or after a trust drop. Plus the
 * rule pass limits (RULED_PER_MINUTE, one carded call in flight, log-before-effect), the standing-grant path, the
 * scope digest, the TOOL_NAME form of a rule's name, and Arky 9 (a tier change re-offering the same entry in another
 * form keeps the rule). Platform-neutral: no paths, no keys on disk.
 */
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RefusedError, scopeDigest, TOOL_NAME, validateKindPayload } from '@a-company/gnomon-contracts';
import { ApprovalBroker, approvalsKeyFrom, type PresenceProvider, type StandingSeam } from '../src/kernel/broker/index.js';
import { contentHashOf } from '../src/kernel/broker/card.js';
import { composePermission } from '../src/kernel/supervisor/permission.js';
import { decisionMessage, KeyRing, signaturePreimage, SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { mintTestPresence } from '../src/kernel/testing.js';
import { narrow, type CapabilityEntry, type ServerTrust } from '../src/kernel/local/capability-index.js';
import { alwaysLine, LocalToolBroker, RULED_PER_MINUTE, toolBindHash, type BrokerTarget, type BrokeredTool } from '../src/kernel/local/tool-broker.js';
import { RuleBook, ruleWords, type RuleRow } from '../src/kernel/supervisor/rules.js';

const HUMAN = 'p:abcdefgh/matt';
const AGENT = 'p:abcdefgh/s-01hzzzzz';
const KERNEL = 'p:abcdefgh/kernel';
const HSID = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ';
const REPO = 'sha256:' + '0'.repeat(64);
const OTHER = 'sha256:' + '1'.repeat(64);
const H = { connId: 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA', principal: HUMAN, principalClass: 'human', surface: 'browser', credential: 'gui' };
const T0 = Date.UTC(2026, 9, 28, 12);
const GRANT = 'card:01HZZZZZZZZZZZZZZZZZZZZGRA';
const BINDING = 'sha256:' + 'b'.repeat(64);

const TOOLS = [
  { name: 'write', description: 'Write a note.', inputSchema: { type: 'object', properties: { t: { type: 'string' } } }, annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: 'drop', description: 'Delete a note.', inputSchema: { type: 'object', properties: { t: { type: 'string' } } }, annotations: { readOnlyHint: false, destructiveHint: true } },
];
const entriesOf = (tools = TOOLS, trust: ServerTrust = 'trusted'): CapabilityEntry[] => narrow(tools, 'srv', { trust });

async function waitFor(f: () => boolean, ms = 5_000): Promise<void> {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function refusal(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  const e = await p.then(
    () => undefined,
    (x: unknown) => x,
  );
  if (!(e instanceof RefusedError)) throw new Error(`expected a refusal, got ${String(e)}`);
  return { code: e.refusal.code, message: e.message };
}

interface RigOpts {
  level?: () => ServerTrust;
  binding?: () => string | null;
  manual?: () => boolean;
  loop?: boolean;
  /** a stand-in rule source (default: the real RuleBook) */
  rules?: { match(repoKey: string, tool: string, bindHash: string): { ruleId: string } | null };
  /** the broker's approval.auto write fails */
  autoFails?: boolean;
}

function rig(o: RigOpts = {}) {
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ring = new KeyRing();
  const keyId = ring.addP256(publicKey);
  const signMsg = (m: string) => cryptoSign('sha256', signaturePreimage('approve', m), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
  const prompts: string[] = [];
  const presence: PresenceProvider = {
    prove: async (req) => {
      prompts.push(req.prompt.text);
      return mintTestPresence(req.purpose, { bind: req.binding });
    },
  };
  const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => {
    if (kind === 'approval.auto' && o.autoFails) throw new Error('disk full');
    rows.push({ kind, payload });
  };
  const broker = new ApprovalBroker({ kernel: SoftwareEd25519Signer.generate('kernel'), kernelPrincipal: KERNEL, log, approvals: approvalsKeyFrom(ring, (p) => (p === HUMAN ? keyId : undefined)), presence, clock: () => T0, mono: () => T0, guiSessions: () => 1 });
  const book = new RuleBook({ principal: KERNEL, isKernelKey: () => true }, { clock: () => T0 });
  let folded = 0;
  const sync = (): RuleBook => {
    for (; folded < rows.length; folded++) book.fold({ seq: folded + 1, at: new Date(T0).toISOString(), kind: rows[folded]!.kind, principal: KERNEL, keyId: 'k', payload: structuredClone(rows[folded]!.payload) });
    return book;
  };
  const calls: Array<{ name: string; args: Record<string, unknown>; trustedRead: boolean }> = [];
  let release: (() => void) | null = null;
  const target: BrokerTarget = {
    server: 'srv',
    provenance: 'mcp:srv',
    ownsGate: false,
    list: async () => [],
    call: async (name, args, c) => {
      calls.push({ name, args, trustedRead: c.trustedRead === true });
      if (release === null) return { text: 'ok', isError: false };
      await new Promise<void>((r) => (release = r));
      return { text: 'ok', isError: false };
    },
  };
  const toBrokered = (es: readonly CapabilityEntry[], form?: 'full' | 'narrow'): BrokeredTool[] => es.map((e) => ({ name: e.name, description: e.description, parameters: e.parameters, class: e.class, entry: e, target, ...(form ? { form } : {}) }));
  const manual = o.manual ?? (() => false);
  const rules = o.rules ?? { match: (repoKey: string, tool: string, bindHash: string) => sync().match(repoKey, tool, bindHash, undefined, { prefixRules: !manual(), roots: ['/r'], bindHash }) };
  const tb = new LocalToolBroker({
    hsid: HSID, principalId: AGENT, repo: '/r', loop: o.loop ?? false, log, broker, target, tools: toBrokered(entriesOf()), running: () => true,
    manual, trustLive: o.level ?? (() => 'trusted'), rules, repoKey: REPO, trustBinding: o.binding ?? (() => BINDING),
  });
  let n = 0;
  const call = (name: string, args: Record<string, unknown> = { t: 'x' }) => tb.handle({ id: `tr-${++n}`, toolCallId: `c${n}`, name, args, error: null });
  const pending = () => broker.cards().filter((c) => c.state === 'pending');
  const raisedRow = () => rows.filter((r) => r.kind === 'approval.request').at(-1)!.payload;
  const toolSig = (cardId: string, h: string) => signMsg(decisionMessage({ cardId, decision: 'always', cardContentHash: h, approverPrincipalId: HUMAN, scopeDigest: scopeDigest({ kind: 'tool' }) }));
  const v1 = (cardId: string, decision: string, h: string) => signMsg(decisionMessage({ cardId, decision, cardContentHash: h, approverPrincipalId: HUMAN }));
  /** a call whose card the human answers `always` with the tool scope; returns the reply and the card */
  const learnBy = async (name = 'write') => {
    const out = call(name);
    await waitFor(() => pending().length === 1);
    const c = pending()[0]!;
    await broker.approve(H, { cardId: c.cardId, decision: 'always', scope: { kind: 'tool' }, decisionSig: toolSig(c.cardId, c.contentHash) });
    return { out: await out, card: c };
  };
  const brokeredRows = () => rows.filter((r) => r.kind === 'tool.brokered').map((r) => r.payload);
  const autos = () => rows.filter((r) => r.kind === 'approval.auto').map((r) => r.payload);
  return { tb, broker, rows, book: sync, calls, call, pending, raisedRow, toolSig, v1, learnBy, brokeredRows, autos, toBrokered, prompts, hold: () => (release = () => undefined), release: () => release?.() };
}

describe('G-LCL-22 a ruleable call: the card offers Always, the rule passes the next call', () => {
  it('the card of a mutate tool of a trusted server offers always with the tool scope, its bindHash and a ruleScope', async () => {
    const r = rig();
    const out = r.call('write');
    await waitFor(() => r.pending().length === 1);
    const c = r.pending()[0]!;
    expect(c.actions!.map((a) => a.decision).sort()).toEqual(['allow', 'always', 'deny']);
    const e = entriesOf().find((x) => x.name === 'write')!;
    const bindHash = toolBindHash(e, 'mutate', BINDING);
    expect(r.raisedRow()).toMatchObject({ tool: 'mcp:srv/write', bindHash });
    expect(JSON.stringify(c.block)).toContain(alwaysLine('mcp:srv/write'));
    r.broker.expire(c.cardId, 'cancelled');
    await out;
  });

  it('always runs THIS call (Arky 1: always counts as allow), learns a tool rule, and the next call runs with no card', async () => {
    const r = rig();
    const { out, card } = await r.learnBy();
    expect(out).toMatchObject({ isError: false, decision: 'approved' });
    expect(r.calls).toHaveLength(1);
    expect(r.rows.find((x) => x.kind === 'approval.decide')!.payload.scope).toEqual({ kind: 'tool' });
    const learned = r.rows.find((x) => x.kind === 'approval.rule.learned')!.payload;
    expect(learned).toMatchObject({ cardId: card.cardId, tool: 'mcp:srv/write', match: 'tool', bindHash: r.raisedRow().bindHash, presence: 'fresh', repoKey: REPO });
    expect(r.prompts[0]).toContain('always allow mcp:srv/write calls (any arguments) in this repo');
    const rule = r.book().get(card.cardId)!;
    expect(rule).toMatchObject({ match: 'tool', tool: 'mcp:srv/write', bindHash: learned.bindHash });
    expect(ruleWords(rule)).toBe('any call of mcp:srv/write (any arguments), while the tool and its server stay the same');
    // the next call: approval.auto first, then the run (on trust), tool.brokered approved with NO cardId
    const next = await r.call('write', { t: 'other args' });
    expect(next).toMatchObject({ isError: false, decision: 'approved' });
    expect(r.pending()).toEqual([]);
    expect(r.autos()).toEqual([{ hsid: HSID, tool: 'mcp:srv/write', inputHash: expect.stringMatching(/^sha256:/), modeRef: `rule:${card.cardId}` }]);
    const row = r.brokeredRows().at(-1)!;
    expect(row).toMatchObject({ tool: 'write', class: 'mutate', decision: 'approved' });
    expect(row).not.toHaveProperty('cardId');
    expect(validateKindPayload('tool.brokered', row)).toEqual([]);
    expect(r.calls.at(-1)).toMatchObject({ args: { t: 'other args' }, trustedRead: true });
  });

  it('the rule is for this repo only and never spans tools', async () => {
    const r = rig();
    const { card } = await r.learnBy();
    const bindHash = r.book().get(card.cardId)!.bindHash!;
    expect(r.book().match(OTHER, 'mcp:srv/write', bindHash, undefined, { prefixRules: true, roots: ['/r'], bindHash })).toBeNull();
    expect(r.book().match(REPO, 'mcp:srv/other', bindHash, undefined, { prefixRules: true, roots: ['/r'], bindHash })).toBeNull();
    expect(r.book().match(REPO, 'mcp:srv/write', bindHash, undefined, { prefixRules: true, roots: ['/r'], bindHash })).toMatchObject({ ruleId: card.cardId });
  });
});

describe('G-LCL-22 falsifiers', () => {
  it('a destructive tool never offers Always and never passes, even when a rule source answers a rule', async () => {
    const r = rig({ rules: { match: () => ({ ruleId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ' }) } });
    const out = r.call('drop');
    await waitFor(() => r.pending().length === 1);
    const c = r.pending()[0]!;
    expect(c.actions!.map((a) => a.decision).sort()).toEqual(['allow', 'deny']);
    expect(r.raisedRow()).not.toHaveProperty('bindHash');
    expect(r.autos()).toEqual([]);
    // always is not one of its actions, and a tool scope is refused on it
    expect(await refusal(r.broker.approve(H, { cardId: c.cardId, decision: 'always', scope: { kind: 'tool' }, decisionSig: r.toolSig(c.cardId, c.contentHash) }))).toMatchObject({ code: 'BAD_REQUEST' });
    await r.broker.approve(H, { cardId: c.cardId, decision: 'deny', decisionSig: r.v1(c.cardId, 'deny', c.contentHash) });
    expect(await out).toMatchObject({ decision: 'denied' });
    expect(r.calls).toEqual([]);
  });

  it('an untrusted server never runs without a card and never offers Always (a rule learned while trusted stays dormant)', async () => {
    let level: ServerTrust = 'trusted';
    const r = rig({ level: () => level });
    await r.learnBy();
    level = 'enabled';
    const out = r.call('write');
    await waitFor(() => r.pending().length === 1);
    const c = r.pending()[0]!;
    expect(c.actions!.map((a) => a.decision).sort()).toEqual(['allow', 'deny']);
    expect(r.autos()).toEqual([]);
    r.broker.expire(c.cardId, 'cancelled');
    expect(await out).toMatchObject({ isError: true });
    // trust back on the same binding: the rule matches again (dormant, never deleted); other args (the expired card's cooldown)
    level = 'trusted';
    expect(await r.call('write', { t: 'after the deny cooldown' })).toMatchObject({ decision: 'approved' });
    expect(r.autos()).toHaveLength(1);
  });

  it('after a trust drop the binding is gone: no rule matches, the call takes a card', async () => {
    let binding: string | null = BINDING;
    const r = rig({ binding: () => binding });
    await r.learnBy();
    binding = null; // trustBindingOf answers null once the TrustBook no longer holds the binding
    const out = r.call('write');
    await waitFor(() => r.pending().length === 1);
    expect(r.autos()).toEqual([]);
    r.broker.expire(r.pending()[0]!.cardId, 'cancelled');
    await out;
    // re-trusted under ANOTHER binding (the server changed): the old rule stays dormant
    binding = 'sha256:' + 'c'.repeat(64);
    const again = r.call('write', { t: 'y' });
    await waitFor(() => r.pending().length === 1);
    expect(r.autos()).toEqual([]);
    r.broker.expire(r.pending()[0]!.cardId, 'cancelled');
    await again;
    expect(r.book().list()).toHaveLength(1);
  });

  it('after a schema change the rule is dormant (the full schema is in the bindHash)', async () => {
    const r = rig();
    await r.learnBy();
    const changed = [{ ...TOOLS[0]!, inputSchema: { type: 'object', properties: { t: { type: 'string', maxLength: 10 } } } }, TOOLS[1]!];
    r.tb.setTools(r.toBrokered(entriesOf(changed)));
    const out = r.call('write');
    await waitFor(() => r.pending().length === 1);
    expect(r.autos()).toEqual([]);
    r.broker.expire(r.pending()[0]!.cardId, 'cancelled');
    await out;
  });

  it('manual mode: a rule never matches (the call is refused, no card, no approval.auto)', async () => {
    let manual = false;
    const r = rig({ manual: () => manual });
    const { card } = await r.learnBy();
    manual = true;
    expect(await r.call('write')).toMatchObject({ decision: 'refused', isError: true });
    expect(r.autos()).toEqual([]);
    // and the RuleBook itself never matches without prefixRules
    const bindHash = r.book().get(card.cardId)!.bindHash!;
    expect(r.book().match(REPO, 'mcp:srv/write', bindHash, undefined, { prefixRules: false, roots: ['/r'], bindHash })).toBeNull();
  });

  it('a loop session: no rule ever matches', async () => {
    const r = rig({ loop: true, rules: { match: () => ({ ruleId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ' }) } });
    expect(await r.call('write')).toMatchObject({ decision: 'loop-session' });
    expect(r.autos()).toEqual([]);
    expect(r.calls).toEqual([]);
  });

  it('Arky 9: the same entry re-offered in another form (a tier change) keeps the rule', async () => {
    const r = rig();
    await r.learnBy();
    r.tb.setTools(r.toBrokered(entriesOf(), 'full'), { ackId: 'ts-1' });
    expect(await r.call('write')).toMatchObject({ decision: 'approved' });
    expect(r.autos()).toHaveLength(1);
  });
});

describe('G-LCL-22 the rule pass limits', () => {
  it(`RULED_PER_MINUTE (${RULED_PER_MINUTE}): past it the call is refused busy (the carded limit of 6 does not apply)`, async () => {
    const r = rig();
    await r.learnBy();
    for (let i = 0; i < RULED_PER_MINUTE; i++) expect(await r.call('write'), `call ${i}`).toMatchObject({ decision: 'approved' });
    expect(await r.call('write')).toMatchObject({ decision: 'busy', isError: true });
    expect(r.autos()).toHaveLength(RULED_PER_MINUTE);
  });

  it('a rule-passed call counts as carded in flight (one at a time)', async () => {
    const r = rig();
    await r.learnBy();
    r.hold();
    const first = r.call('write');
    await waitFor(() => r.calls.length === 2);
    expect(await r.call('write')).toMatchObject({ decision: 'busy' });
    r.release();
    expect(await first).toMatchObject({ decision: 'approved' });
  });

  it('log before effect: no approval.auto row, no run', async () => {
    const r = rig({ autoFails: true, rules: { match: () => ({ ruleId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ' }) } });
    expect(await r.call('write')).toMatchObject({ decision: 'refused', isError: true });
    expect(r.calls).toEqual([]);
  });
});

describe('G-LCL-22 the tool scope in the approval broker', () => {
  it('a brokered card refuses always without the tool scope (and with the exact scope)', async () => {
    const r = rig();
    const out = r.call('write');
    await waitFor(() => r.pending().length === 1);
    const c = r.pending()[0]!;
    expect(await refusal(r.broker.approve(H, { cardId: c.cardId, decision: 'always', decisionSig: r.v1(c.cardId, 'always', c.contentHash) }))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(await refusal(r.broker.approve(H, { cardId: c.cardId, decision: 'always', scope: { kind: 'exact' }, decisionSig: r.v1(c.cardId, 'always', c.contentHash) }))).toMatchObject({ code: 'BAD_REQUEST' });
    // decisionSig binds the scope: an unscoped signature never passes as the tool scope
    expect(await refusal(r.broker.approve(H, { cardId: c.cardId, decision: 'always', scope: { kind: 'tool' }, decisionSig: r.v1(c.cardId, 'always', c.contentHash) }))).toMatchObject({ code: 'AUTH' });
    expect(r.rows.map((x) => x.kind)).not.toContain('approval.rule.learned');
    r.broker.expire(c.cardId, 'cancelled');
    await out;
  });

  it('the tool scope is refused on a card the kernel did not offer it on (a Claude permission card, a Bash card)', async () => {
    const r = rig();
    const plain = await r.broker.raise({ kind: 'permission', requestedBy: AGENT, attended: true, detail: { tool: 'Write' }, lines: ['Write'], tool: 'Write', toolInput: { file_path: '/r/a', content: 'x' }, ruleScope: { repoKey: REPO } });
    expect(await refusal(r.broker.approve(H, { cardId: plain.cardId, decision: 'always', scope: { kind: 'tool' }, decisionSig: r.toolSig(plain.cardId, plain.contentHash) }))).toMatchObject({ code: 'BAD_REQUEST' });
    // a forged-looking detail on a non-mcp tool name is refused too
    const odd = await r.broker.raise({ kind: 'permission', requestedBy: AGENT, attended: true, detail: { toolScopes: ['tool'], brokered: { bindHash: BINDING } }, lines: ['x'], tool: 'Bash', toolInput: { command: 'ls' }, ruleScope: { repoKey: REPO } });
    expect(await refusal(r.broker.approve(H, { cardId: odd.cardId, decision: 'always', scope: { kind: 'tool' }, decisionSig: r.toolSig(odd.cardId, odd.contentHash) }))).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('Aegis I1: the request row carries a bindHash only when detail.toolScopes includes tool', async () => {
    const r = rig();
    const reqRow = () => r.rows.filter((x) => x.kind === 'approval.request').at(-1)!.payload;
    const raise = (toolScopes: unknown) => r.broker.raise({ kind: 'permission', requestedBy: AGENT, attended: true, detail: { toolScopes, brokered: { bindHash: BINDING } }, lines: ['x'], tool: 'mcp:srv/write', toolInput: { t: 'x' }, ruleScope: { repoKey: REPO } });
    for (const scopes of [[], ['file'], ['repo-edits', 'prefix']]) {
      await raise(scopes);
      expect(reqRow(), JSON.stringify(scopes)).not.toHaveProperty('bindHash');
    }
    await raise(['tool']);
    expect(reqRow()).toMatchObject({ bindHash: BINDING });
  });

  it('the scope digest of the tool scope is its own (never another scope\'s) and the presence binding carries it', () => {
    const d = scopeDigest({ kind: 'tool' });
    expect(d).toMatch(/^sha256:[0-9a-f]{64}$/);
    for (const other of [scopeDigest({ kind: 'file' }), scopeDigest({ kind: 'repo-edits' }), scopeDigest({ kind: 'prefix', prefix: ['tool'] })]) expect(other).not.toBe(d);
  });

  it('a rule tool name is the TOOL_NAME mcp form (revoke / off / on rows validate)', () => {
    expect(TOOL_NAME.test('mcp:srv/write')).toBe(true);
    expect(TOOL_NAME.test('mcp:srv/fam.put')).toBe(true);
    expect(TOOL_NAME.test('mcp:Srv/write')).toBe(false);
    expect(TOOL_NAME.test('mcp:srv/../x')).toBe(false);
    expect(validateKindPayload('approval.rule.revoked', { ruleId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ', repoKey: REPO, tool: 'mcp:srv/write', connId: 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA' })).toEqual([]);
  });
});

describe('G-LCL-22 the RuleBook forms a tool rule only from consistent kernel rows', () => {
  const C = 'card:01HZZZZZZZZZZZZZZZZZZZZCRD';
  const by = { principal: KERNEL, keyId: 'k' };
  const BH = 'sha256:' + 'd'.repeat(64);
  const rowsOf = (o: { reqBind?: string | null; learnedBind?: string; scope?: unknown; match?: string; tool?: string } = {}): RuleRow[] => [
    { ...by, kind: 'approval.request', payload: { card: { cardId: C, kind: 'permission' }, tool: o.tool ?? 'mcp:srv/write', tool_input: { t: 'x' }, ...(o.reqBind === null ? {} : { bindHash: o.reqBind ?? BH }) } },
    { ...by, kind: 'approval.decide', payload: { cardId: C, decision: 'always', ...(o.scope === null ? {} : { scope: o.scope ?? { kind: 'tool' } }) } },
    { ...by, kind: 'approval.rule.learned', payload: { cardId: C, tool: o.tool ?? 'mcp:srv/write', match: o.match ?? 'tool', bindHash: o.learnedBind ?? BH, presence: 'fresh', repoKey: REPO } },
  ];
  const book = (rows: RuleRow[]) => {
    const b = new RuleBook({ principal: KERNEL, isKernelKey: (k) => k === 'k' });
    rows.forEach((r, i) => b.fold({ ...r, seq: i + 1 }));
    return b;
  };
  const ctx = (bindHash: string) => ({ prefixRules: true, roots: ['/r'], bindHash });
  it('consistent rows form the rule; it matches only its own bindHash', () => {
    const b = book(rowsOf());
    expect(b.match(REPO, 'mcp:srv/write', BH, undefined, ctx(BH))).toMatchObject({ ruleId: C, match: 'tool' });
    expect(b.match(REPO, 'mcp:srv/write', BH, undefined, ctx('sha256:' + 'e'.repeat(64)))).toBeNull();
    expect(b.match(REPO, 'mcp:srv/write', BH, undefined, { prefixRules: true, roots: ['/r'] })).toBeNull();
  });
  it('a learned bindHash other than the request row\'s, a request with none, a decide without the tool scope, or an exact match for an mcp tool forms nothing', () => {
    expect(book(rowsOf({ learnedBind: 'sha256:' + 'e'.repeat(64) })).list()).toEqual([]);
    expect(book(rowsOf({ reqBind: null })).list()).toEqual([]);
    expect(book(rowsOf({ scope: null })).list()).toEqual([]);
    expect(book(rowsOf({ scope: { kind: 'repo-edits' } })).list()).toEqual([]);
    expect(book(rowsOf({ match: 'exact', scope: null })).list()).toEqual([]);
    // a tool rule for a Claude tool name forms nothing either
    expect(book(rowsOf({ tool: 'Write' })).list()).toEqual([]);
  });
  it('rows signed by anyone but the kernel form nothing', () => {
    expect(book(rowsOf().map((r) => ({ ...r, principal: 'p:abcdefgh/agent' }))).list()).toEqual([]);
    expect(book(rowsOf().map((r) => ({ ...r, keyId: 'other' }))).list()).toEqual([]);
  });
});

describe('G-LCL-22 a standing grant may create a tool rule (founder answer 3)', () => {
  it('permission:always under a live grant of this device decides the always with no prompt and the rule forms', async () => {
    const r = rig();
    const seam: StandingSeam = {
      match: (_ctx, card, decision, _detail, ruleRepo) => (String(card.kind) === 'permission' && decision === 'always' && ruleRepo === REPO ? { grantId: GRANT, tuple: 'permission:always', repo: REPO } : null),
      used: async () => undefined,
    };
    r.broker.setStanding(seam);
    // the kernel's own grant.standing row (the RuleBook verifies the grant at the decide row), device = this connection
    r.rows.push({ kind: 'grant.standing', payload: { grantId: GRANT, cardId: GRANT, tuples: ['permission:always'], repos: [REPO], device: H.connId, expiresAt: new Date(T0 + 3_600_000).toISOString(), by: HUMAN } });
    const { out, card } = await r.learnBy();
    expect(out).toMatchObject({ decision: 'approved' });
    expect(r.prompts).toEqual([]);
    expect(r.rows.find((x) => x.kind === 'approval.rule.learned')!.payload).toMatchObject({ match: 'tool', presence: `standing:${GRANT}` });
    expect(r.book().get(card.cardId)).toMatchObject({ match: 'tool', presence: `standing:${GRANT}` });
    expect(await r.call('write')).toMatchObject({ decision: 'approved' });
    expect(r.autos()).toHaveLength(1);
  });
});

describe("C5'a3 K1: a brokered card carries a tool-scope node the contentHash covers", () => {
  type Node = { type?: unknown; detail?: Record<string, unknown> };
  const scopeNodes = (block: unknown): Node[] => ((block as { children?: Node[] }).children ?? []).filter((k) => k && k.type === 'tool-scope');
  const hashOf = (c: { kind: string; requestedBy: string; hsid?: string; flags?: readonly string[] }, detail: unknown): string => contentHashOf({ kind: c.kind, requestedBy: c.requestedBy, ...(c.hsid ? { hsid: c.hsid } : {}), detail, flags: c.flags ?? [] });

  it('a ruleable card: ONE node, its detail hashes to the contentHash and names what the kernel offered', async () => {
    const r = rig();
    const out = r.call('write');
    await waitFor(() => r.pending().length === 1);
    const c = r.pending()[0]!;
    const nodes = scopeNodes(c.block);
    expect(nodes).toHaveLength(1);
    const d = nodes[0]!.detail!;
    expect(hashOf(c as never, d)).toBe(c.contentHash);
    const e = entriesOf().find((x) => x.name === 'write')!;
    expect(d.tool).toBe('mcp:srv/write');
    expect(d.toolScopes).toEqual(['tool']);
    expect(d.brokered).toMatchObject({ server: 'srv', tool: 'write', class: 'mutate', trust: 'trusted', bindHash: toolBindHash(e, 'mutate', BINDING) });
    // a tampered node no longer hashes to the card (the GUI refuses it)
    expect(hashOf(c as never, { ...d, toolScopes: ['tool', 'server'] })).not.toBe(c.contentHash);
    // the text lines are unchanged: the node is the block's last child, after every Text line
    expect(((c.block as { children: Node[] }).children.at(-1) as Node).type).toBe('tool-scope');
    r.broker.expire(c.cardId, 'cancelled');
    await out;
  });

  it('a non-ruleable brokered card (destructive) carries the node with no toolScopes and no bindHash', async () => {
    const r = rig();
    const out = r.call('drop');
    await waitFor(() => r.pending().length === 1);
    const c = r.pending()[0]!;
    const nodes = scopeNodes(c.block);
    expect(nodes).toHaveLength(1);
    expect(hashOf(c as never, nodes[0]!.detail)).toBe(c.contentHash);
    expect(nodes[0]!.detail).not.toHaveProperty('toolScopes');
    expect(nodes[0]!.detail!.brokered).not.toHaveProperty('bindHash');
    r.broker.expire(c.cardId, 'cancelled');
    await out;
  });

  it('a non-brokered permission card carries no tool-scope node', () => {
    let n = 0;
    for (const [toolName, input] of [['Bash', { command: 'ls -la' }], ['Edit', { file_path: '/r/a.ts', old_string: 'a', new_string: 'b' }], ['Write', { file_path: '/r/b.ts', content: 'x' }]] as const) {
      const plan = composePermission({ requestId: 'q1', toolName, toolUseId: 't1', input }, { repo: '/r', denyWrite: [] });
      if (plan.kind !== 'card') continue;
      n++;
      expect(scopeNodes(plan.block)).toEqual([]);
      expect(JSON.stringify(plan.block)).not.toContain('tool-scope');
    }
    expect(n).toBeGreaterThan(0);
  });
});
