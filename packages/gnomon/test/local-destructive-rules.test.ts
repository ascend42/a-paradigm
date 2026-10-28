/**
 * G-LCL-22 (amended) and G-LCL-25..27 (slice C6'a2-1, TD-2026-10-28-956 / -969): destructive Always, "/" runs, the result
 * policy and the injection pause, kernel side. A REAL ApprovalBroker over the fake helper (TS row tables) raises and
 * decides the brokered cards, a REAL RuleBook folds what it writes, and LocalToolBroker asks that book at call time.
 * Falsifiers: a destructive card under a cached unlock still asks fresh presence; a destructive rule is never formed
 * from standing, CLI or cached presence; a mutate rule never matches a destructive call; a tainted turn's model call is
 * carded while a "/" run passes; the pass limits; `$&` in args is literal; a forged policy row widens nothing; an old
 * helper is offered no Always.
 */
import { describe, expect, it } from 'vitest';
import { RefusedError, validateKindPayload } from '@a-company/gnomon-contracts';
import { ApprovalBroker } from '../src/kernel/broker/index.js';
import { HardwareRootAuthority, HelperApprovalsKey } from '../src/kernel/identity/index.js';
import { ROW_TABLE_MIN_HELPER, rowTableRefusal } from '../src/kernel/identity/decision-batch.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { narrow, type CapabilityEntry } from '../src/kernel/local/capability-index.js';
import { UNTRUSTED_IRREVERSIBLE_LINE, DESTRUCTIVE_RULED_PER_RULE_DAY, DESTRUCTIVE_RULED_PER_SESSION_MINUTE, DestructiveRuleBudget, destructiveAlwaysLine, HUMAN_RUNS_PER_MINUTE, LocalToolBroker, schemaRefusal, toolBindHash, toolRulePaused, type BrokerTarget, type BrokeredTool } from '../src/kernel/local/tool-broker.js';
import { frameResult, RESULT_FOOTER, resultCapBytes, ResultPolicyBook, RESULT_SEND_MAX_BYTES } from '../src/kernel/local/result-policy.js';
import { RuleBook } from '../src/kernel/supervisor/rules.js';
import { followUpLine, promptLine } from '../src/adapters/local/runner.js';
import { FakeHelper } from './helper-fake.js';

const HUMAN = 'p:abcdefgh/matt';
const AGENT = 'p:abcdefgh/s-01hzzzzz';
const KERNEL = 'p:abcdefgh/kernel';
const GEN = 'test0001';
const HSID = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ';
const REPO = 'sha256:' + '0'.repeat(64);
const BINDING = 'sha256:' + 'b'.repeat(64);
const T0 = Date.UTC(2026, 9, 28, 12);
const BOUNDS = { idleSeconds: 12 * 3600, absoluteSeconds: 12 * 3600, maxSignatures: 512 };
const gui = () => ({ connId: 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA', principal: HUMAN, principalClass: 'human', surface: 'browser', credential: 'gui', deviceId: 'dev:01HZZZZZZZZZZZZZZZZZZZZZZD' });
const cli = () => ({ ...gui(), credential: 'cli', surface: 'cli' });

const TOOLS = [
  { name: 'write', description: 'Write a note.', inputSchema: { type: 'object', properties: { t: { type: 'string' } } }, annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: 'drop', description: 'Delete a note.', inputSchema: { type: 'object', properties: { t: { type: 'string' } } }, annotations: { readOnlyHint: false, destructiveHint: true } },
  { name: 'peek', description: 'Read a note.', inputSchema: { type: 'object', properties: { t: { type: 'string' } } }, annotations: { readOnlyHint: true, openWorldHint: false } },
];
const entries: CapabilityEntry[] = narrow(TOOLS, 'srv', { trust: 'trusted' });
const entry = (name: string): CapabilityEntry => entries.find((e) => e.name === name)!;

async function waitFor(f: () => boolean, ms = 5_000): Promise<void> {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

function rig(o: { level?: () => 'trusted' | 'enabled'; version?: string; tainted?: () => boolean; rules?: { match(r: string, t: string, b: string, c: 'mutate' | 'destructive'): { ruleId: string } | null }; budget?: DestructiveRuleBudget } = {}) {
  const helper = new FakeHelper(GEN, { bounds: BOUNDS, version: o.version ?? '1.10.0' });
  const approvals = new HelperApprovalsKey({ gen: GEN, approvalsPublicKeyPem: helper.publicPem('approvals') }, HUMAN, helper);
  const root = new HardwareRootAuthority({ gen: GEN, rootPublicKeyPem: helper.publicPem('root') }, { helper, once: () => { throw new Error('never the once seam'); } });
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => void rows.push({ kind, payload: structuredClone(payload) });
  const broker = new ApprovalBroker({ kernel: SoftwareEd25519Signer.generate('kernel'), kernelPrincipal: KERNEL, log, approvals, root, clock: () => T0, mono: () => T0 });
  const book = new RuleBook({ principal: KERNEL, isKernelKey: () => true }, { clock: () => T0 });
  let folded = 0;
  const sync = (): RuleBook => {
    for (; folded < rows.length; folded++) book.fold({ seq: folded + 1, at: new Date(T0).toISOString(), kind: rows[folded]!.kind, principal: KERNEL, keyId: 'k', payload: structuredClone(rows[folded]!.payload) });
    return book;
  };
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const target: BrokerTarget = { server: 'srv', provenance: 'mcp:srv', ownsGate: false, list: async () => [], call: async (name, args) => (calls.push({ name, args }), { text: `ran ${JSON.stringify(args)}`, isError: false }) };
  const tools: BrokeredTool[] = entries.map((e) => ({ name: e.name, description: e.description, parameters: e.parameters, class: e.class, entry: e, target }));
  const rules = o.rules ?? { match: (repoKey: string, tool: string, bindHash: string, toolClass: 'mutate' | 'destructive') => sync().match(repoKey, tool, bindHash, undefined, { prefixRules: true, roots: ['/r'], bindHash, toolClass }) };
  const tb = new LocalToolBroker({ hsid: HSID, principalId: AGENT, repo: '/r', loop: false, log, broker, target, tools, running: () => true, manual: () => false, trustLive: o.level ?? (() => 'trusted'), rules, repoKey: REPO, trustBinding: () => BINDING, ...(o.tainted ? { tainted: o.tainted } : {}), ...(o.budget ? { destructiveBudget: o.budget } : {}) });
  let n = 0;
  const call = (name: string, args: Record<string, unknown> = { t: 'x' }) => tb.handle({ id: `tr-${++n}`, toolCallId: `c${n}`, name, args, error: null });
  const run = (name: string, args: Record<string, unknown> = { t: 'x' }) => tb.runHuman({ runId: `r${++n}`, entry: entry(name), target, form: 'narrow', args });
  const pending = () => broker.cards().filter((c) => c.state === 'pending');
  const decideRow = () => rows.filter((r) => r.kind === 'approval.decide').at(-1)!.payload;
  return { helper, broker, rows, book: sync, calls, call, run, pending, decideRow, tb };
}

const presenceOf = (rows: Array<{ kind: string; payload: Record<string, unknown> }>) => rows.filter((r) => r.kind === 'approval.decide').map((r) => r.payload.presence);

describe('G-LCL-22 (amended): every destructive brokered card is irreversible', () => {
  it('a destructive card under a cached unlock still asks for fresh presence (a mutate allow opened the unlock)', async () => {
    const r = rig();
    const first = r.call('write');
    await waitFor(() => r.pending().length === 1);
    await r.broker.approve(gui(), { cardId: r.pending()[0]!.cardId, decision: 'allow' });
    await first;
    const second = r.call('write', { t: 'y' });
    await waitFor(() => r.pending().length === 1);
    await r.broker.approve(gui(), { cardId: r.pending()[0]!.cardId, decision: 'allow' });
    await second;
    expect(presenceOf(r.rows)).toEqual(['fresh', 'cached']);
    const out = r.call('drop');
    await waitFor(() => r.pending().length === 1);
    const c = r.pending()[0]!;
    expect(c.flags).toContain('irreversible');
    const prompts = r.helper.prompts.length;
    await r.broker.approve(gui(), { cardId: c.cardId, decision: 'allow' });
    expect(await out).toMatchObject({ decision: 'approved' });
    expect(presenceOf(r.rows).at(-1)).toBe('fresh');
    expect(r.helper.prompts.length).toBe(prompts + 1);
  });

  it('a "/" run of a destructive tool is irreversible too, and its row says author human', async () => {
    const r = rig();
    const out = r.run('drop');
    await waitFor(() => r.pending().length === 1);
    const c = r.pending()[0]!;
    expect(c.flags).toContain('irreversible');
    expect(JSON.stringify(c.block)).toContain('a \\"/\\" run you started');
    await r.broker.approve(gui(), { cardId: c.cardId, decision: 'deny' });
    expect(await out).toMatchObject({ decision: 'denied' });
    const row = r.rows.filter((x) => x.kind === 'tool.brokered').at(-1)!.payload;
    expect(row).toMatchObject({ author: 'human', class: 'destructive', decision: 'denied' });
    expect(validateKindPayload('tool.brokered', row)).toEqual([]);
    // the human's deny never strikes the model: no cooldown on the same call
    const again = r.call('drop');
    await waitFor(() => r.pending().length === 1);
    r.broker.expire(r.pending()[0]!.cardId, 'cancelled');
    expect(await again).not.toMatchObject({ decision: 'cooldown' });
  });
});

describe('Aegis L3 (founder: fresh Touch ID): a server with no live trust', () => {
  it("an untrusted server's call under a cached unlock still asks fresh presence; its card says why and offers no Always", async () => {
    let level: 'trusted' | 'enabled' = 'trusted';
    const r = rig({ level: () => level });
    for (const t of ['a', 'b']) {
      const out = r.call('write', { t });
      await waitFor(() => r.pending().length === 1);
      await r.broker.approve(gui(), { cardId: r.pending()[0]!.cardId, decision: 'allow' });
      await out;
    }
    expect(presenceOf(r.rows)).toEqual(['fresh', 'cached']);
    level = 'enabled';
    const out = r.call('write', { t: 'c' });
    await waitFor(() => r.pending().length === 1);
    const c = r.pending()[0]!;
    expect(c.flags).toContain('irreversible');
    expect(c.actions!.map((a) => a.decision).sort()).toEqual(['allow', 'deny']);
    expect(JSON.stringify(c.block)).toContain(UNTRUSTED_IRREVERSIBLE_LINE);
    await r.broker.approve(gui(), { cardId: c.cardId, decision: 'allow' });
    await out;
    expect(presenceOf(r.rows).at(-1)).toBe('fresh');
  });

  it('a trusted read is unchanged: it runs with no card', async () => {
    const r = rig();
    expect(await r.call('peek')).toMatchObject({ decision: 'ran' });
    expect(r.pending()).toEqual([]);
  });
});

describe('G-LCL-22 (amended): destructive Always', () => {
  it('helper 1.10.0: offered (root class, card copy), learned from a fresh root touch, and passes the next call with approval.auto first', async () => {
    const r = rig();
    const out = r.call('drop');
    await waitFor(() => r.pending().length === 1);
    const c = r.pending()[0]!;
    expect(c.actions!.map((a) => a.decision).sort()).toEqual(['allow', 'always', 'deny']);
    expect(JSON.stringify(c.block)).toContain(destructiveAlwaysLine('drop', 'srv'));
    const req = r.rows.filter((x) => x.kind === 'approval.request').at(-1)!.payload;
    expect(req.bindHash).toBe(toolBindHash(entry('drop'), 'destructive', BINDING));
    expect(req.flags).toContain('irreversible');
    await r.broker.approve(gui(), { cardId: c.cardId, decision: 'always', scope: { kind: 'tool' } });
    expect(await out).toMatchObject({ decision: 'approved' });
    expect(r.decideRow()).toMatchObject({ presence: 'fresh', rootSig: expect.objectContaining({ sig: expect.any(String) }), rootKind: 'permission' });
    expect(r.book().get(c.cardId)).toMatchObject({ match: 'tool', destructive: true });
    const next = await r.call('drop', { t: 'other' });
    expect(next).toMatchObject({ decision: 'approved' });
    expect(r.pending()).toEqual([]);
    const kinds = r.rows.map((x) => x.kind);
    expect(kinds.lastIndexOf('approval.auto')).toBeLessThan(kinds.lastIndexOf('tool.brokered'));
  });

  it('an old helper (1.9.0) gets no Always offer and the card is still raised (allow | deny)', async () => {
    const r = rig({ version: '1.9.0' });
    const out = r.call('drop');
    await waitFor(() => r.pending().length === 1);
    expect(r.pending()[0]!.actions!.map((a) => a.decision).sort()).toEqual(['allow', 'deny']);
    expect(await r.broker.rootTableReady('permission', {})).toBe(false);
    r.broker.expire(r.pending()[0]!.cardId, 'cancelled');
    await out;
    expect(ROW_TABLE_MIN_HELPER.permission).toBe('1.10.0');
    expect(rowTableRefusal('permission', [])).toBeNull();
  });

  it('a mutate rule never matches a destructive call (nor the reverse)', async () => {
    const r = rig();
    const out = r.call('write');
    await waitFor(() => r.pending().length === 1);
    await r.broker.approve(gui(), { cardId: r.pending()[0]!.cardId, decision: 'always', scope: { kind: 'tool' } });
    await out;
    const drop = r.call('drop');
    await waitFor(() => r.pending().length === 1);
    r.broker.expire(r.pending()[0]!.cardId, 'cancelled');
    await drop;
    const bh = toolBindHash(entry('write'), 'mutate', BINDING);
    expect(r.book().match(REPO, 'mcp:srv/write', bh, undefined, { prefixRules: true, roots: ['/r'], bindHash: bh, toolClass: 'destructive' })).toBeNull();
    expect(r.book().match(REPO, 'mcp:srv/write', bh, undefined, { prefixRules: true, roots: ['/r'], bindHash: bh, toolClass: 'mutate' })).not.toBeNull();
  });

  it('a destructive rule is never formed from standing, CLI or cached presence, or a decide row without rootSig', () => {
    const card = 'card:01HZZZZZZZZZZZZZZZZZZZZZZ1';
    const bindHash = 'sha256:' + 'c'.repeat(64);
    const base = (presence: string, rootSig: unknown, learnedPresence = presence) => {
      const book = new RuleBook({ principal: KERNEL, isKernelKey: () => true }, { clock: () => T0 });
      let seq = 0;
      const f = (kind: string, payload: Record<string, unknown>) => book.fold({ seq: ++seq, at: new Date(T0).toISOString(), kind, principal: KERNEL, keyId: 'k', payload });
      f('approval.request', { card: { cardId: card, kind: 'permission' }, flags: ['irreversible'], tool: 'mcp:srv/drop', tool_input: { t: 'x' }, bindHash });
      f('approval.decide', { cardId: card, decision: 'always', presence, scope: { kind: 'tool' }, ...(rootSig ? { rootSig } : {}) });
      f('approval.rule.learned', { cardId: card, tool: 'mcp:srv/drop', match: 'tool', bindHash, presence: learnedPresence, repoKey: REPO });
      return book.get(card);
    };
    const sig = { signer: 'root', sig: 'AAAA' };
    expect(base('fresh', sig)).toMatchObject({ destructive: true });
    expect(base('cli', sig)).toBeNull();
    expect(base('cached', sig)).toBeNull();
    expect(base('standing:card:01HZZZZZZZZZZZZZZZZZZZZGRA', sig)).toBeNull();
    expect(base('fresh', null)).toBeNull();
    expect(base('fresh', sig, 'cli')).toBeNull();
  });

  it('a CLI touch on a destructive Always forms no rule', async () => {
    const r = rig();
    const out = r.call('drop');
    await waitFor(() => r.pending().length === 1);
    const c = r.pending()[0]!;
    await r.broker.approve(cli(), { cardId: c.cardId, decision: 'always', scope: { kind: 'tool' } }).catch(() => undefined);
    await waitFor(() => r.pending().length === 0).catch(() => r.broker.expire(c.cardId, 'cancelled'));
    await out;
    expect(r.book().get(c.cardId)).toBeNull();
  });
});

describe('INJECTION PAUSE and the pass limits', () => {
  const RULE = { ruleId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZ9' };
  const destructiveOnly = { match: (_r: string, _t: string, _b: string, c: 'mutate' | 'destructive') => (c === 'destructive' ? RULE : null) };

  it('a tainted turn: a destructive rule passes no MODEL call (it is carded), while a "/" run passes', async () => {
    let tainted = true;
    const r = rig({ rules: destructiveOnly, tainted: () => tainted });
    const model = r.call('drop');
    await waitFor(() => r.pending().length === 1);
    r.broker.expire(r.pending()[0]!.cardId, 'cancelled');
    await model;
    expect(await r.run('drop')).toMatchObject({ decision: 'approved' });
    tainted = false;
    expect(await r.call('drop', { t: 'next turn' })).toMatchObject({ decision: 'approved' });
    expect(r.rows.filter((x) => x.kind === 'approval.auto')).toHaveLength(2);
  });

  it('H1 (founder: whole session): a hostile result in turn 5 keeps destructive rules paused in turn 6; a fresh session is unaffected', async () => {
    // the session-wide flag as LocalLane keeps it: set when turn 5 attached a sent result, never cleared by a turn's end
    const session = { turn: 4, tainted: false };
    const r = rig({ rules: destructiveOnly, tainted: () => session.tainted });
    session.turn = 5;
    session.tainted = true; // turn 5 took in a sent result
    session.turn = 6; // turn 5 ended: the taint stays
    const model = r.call('drop', { t: 'turn 6' });
    await waitFor(() => r.pending().length === 1);
    r.broker.expire(r.pending()[0]!.cardId, 'cancelled');
    await model;
    expect(r.rows.filter((x) => x.kind === 'approval.auto')).toHaveLength(0);
    // a "/" run in the same session still passes by the rule
    expect(await r.run('drop', { t: 'human' })).toMatchObject({ decision: 'approved' });
    const fresh = rig({ rules: destructiveOnly, tainted: () => false });
    expect(await fresh.call('drop', { t: 'turn 6' })).toMatchObject({ decision: 'approved' });
  });

  it(`a destructive rule passes at most ${DESTRUCTIVE_RULED_PER_SESSION_MINUTE} calls per session per minute, then cards`, async () => {
    const r = rig({ rules: destructiveOnly });
    for (let i = 0; i < DESTRUCTIVE_RULED_PER_SESSION_MINUTE; i++) expect(await r.call('drop', { t: `${i}` })).toMatchObject({ decision: 'approved' });
    const over = r.call('drop', { t: 'over' });
    await waitFor(() => r.pending().length === 1);
    r.broker.expire(r.pending()[0]!.cardId, 'cancelled');
    await over;
  });

  it(`DestructiveRuleBudget: ${DESTRUCTIVE_RULED_PER_RULE_DAY} per rule per day across sessions`, () => {
    const b = new DestructiveRuleBudget();
    let t = T0;
    for (let i = 0; i < DESTRUCTIVE_RULED_PER_RULE_DAY; i++) expect(b.take(`hsid-${i}`, 'rule', (t += 1000))).toBe(true);
    expect(b.take('hsid-x', 'rule', (t += 1000))).toBe(false);
    expect(b.take('hsid-x', 'rule', t + 24 * 3600_000)).toBe(true);
  });

  it(`"/" runs: their own ${HUMAN_RUNS_PER_MINUTE}/min bucket`, async () => {
    const r = rig({ rules: destructiveOnly, budget: { take: () => true } as unknown as DestructiveRuleBudget });
    for (let i = 0; i < HUMAN_RUNS_PER_MINUTE; i++) expect(await r.run('drop', { t: `${i}` })).toMatchObject({ decision: 'approved' });
    expect(await r.run('drop', { t: 'over' })).toMatchObject({ decision: 'busy' });
  });

  it('`$&` in "/" args reaches the target literally', async () => {
    const r = rig({ rules: destructiveOnly });
    await r.run('drop', { t: 'a $& b $1 $$' });
    expect(r.calls.at(-1)!.args).toEqual({ t: 'a $& b $1 $$' });
  });

  it('toolRulePaused judges a destructive rule like a mutate one', () => {
    const tools = TOOLS as unknown as Array<Record<string, unknown>>;
    const src = { listed: () => [{ id: 'user::srv', label: 'srv', launchHash: 'h', pluginVersion: null, toolsHash: 't', tools }] as never, trust: () => ({ binding: 'nope' }), on: () => true };
    expect(toolRulePaused({ match: 'tool', tool: 'mcp:srv/drop', bindHash: 'sha256:' + 'd'.repeat(64) }, src)).toBe('untrusted');
  });
});

describe('G-LCL-26 the result policy and framing', () => {
  const SHA = 'sha256:' + 'e'.repeat(64);
  const row = { hsid: HSID, repoKey: REPO, tool: 'mcp:srv/drop', bindHash: SHA, policy: 'send' };
  it('only kernel-signed rows count: a forged row widens nothing; a binding change reads ask', () => {
    const book = new ResultPolicyBook({ principal: KERNEL, isKernelKey: (k) => k === 'kk' });
    book.fold({ seq: 1, kind: 'tool.result.policy', principal: 'p:abcdefgh/mod', keyId: 'kk', payload: row });
    book.fold({ seq: 2, kind: 'tool.result.policy', principal: KERNEL, keyId: 'forged', payload: row });
    expect(book.of(REPO, 'mcp:srv/drop', SHA)).toBeNull();
    book.fold({ seq: 3, kind: 'tool.result.policy', principal: KERNEL, keyId: 'kk', payload: row });
    expect(book.of(REPO, 'mcp:srv/drop', SHA)).toBe('send');
    expect(book.of(REPO, 'mcp:srv/drop', 'sha256:' + 'f'.repeat(64))).toBeNull();
    book.fold({ seq: 4, kind: 'tool.result.policy', principal: KERNEL, keyId: 'kk', payload: { ...row, policy: 'ask' } });
    expect(book.of(REPO, 'mcp:srv/drop', SHA)).toBe('ask');
    expect(validateKindPayload('tool.result.policy', row)).toEqual([]);
  });

  it('a frame: header, nonce-tagged body (collision re-drawn), Cf stripped, footer, cut over the cap', () => {
    let k = 0;
    const nonces = ['abc', 'def'];
    const f = frameResult({ tool: 'mcp:srv/drop', trust: 'trusted', text: 'x‮y gnomon-data-abc $&', isError: false }, 1024, () => nonces[k++]!);
    expect(f.frame).toContain('<gnomon-data-def>');
    expect(f.frame).not.toContain('‮');
    expect(f.frame).toContain('run by the human from /');
    expect(f.frame).toContain('$&');
    expect(f.frame.endsWith(RESULT_FOOTER)).toBe(true);
    const big = frameResult({ tool: 'mcp:srv/drop', trust: 'trusted', text: 'é'.repeat(100), isError: true }, 51);
    expect(big).toMatchObject({ bytes: 200, cut: true });
    expect(big.frame).toContain('cut to the first 50');
    expect(resultCapBytes(1_000_000)).toBe(RESULT_SEND_MAX_BYTES);
    expect(resultCapBytes(8192)).toBe(5120);
  });

  it('Aegis M1: frames ride as the line\'s own data field, never glued onto the prompt text', () => {
    const p = JSON.parse(promptLine('fix it', undefined, ['FRAME']));
    expect(p).toEqual({ type: 'prompt', message: 'fix it', data: ['FRAME'] });
    expect(JSON.parse(followUpLine('next'))).toEqual({ type: 'follow_up', message: 'next' });
  });

  it('schemaRefusal names an unchecked keyword anywhere in the schema', () => {
    expect(schemaRefusal({ type: 'object', properties: { a: { type: 'string', format: 'uri' } } })).toMatch(/format/);
    expect(schemaRefusal(TOOLS[0]!.inputSchema)).toBeNull();
  });
});

void RefusedError;
