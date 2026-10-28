/**
 * G-LCL-29 / G-LCL-27 (slice C6'a2-2, founder: skill text taints the session): "/" skills in a REAL LocalLane — the
 * real gnomon-local child against a fake OpenAI-compatible endpoint, the fake stdio MCP server (with its destructive
 * `wipe`) through the TEST-RIG-ONLY unsandboxed launchPlan seam, trusted by a TrustBook stand-in, a REAL ApprovalBroker
 * over the fake helper at 1.10.0 and a REAL RuleBook holding a destructive Always rule for `mcp:fake/wipe` (as
 * test/local-taint-lane.test.ts).
 *
 * skills.list lists the STAGED copy (a shell skill and a `user-invocable: false` one loaded:false); a name not listed
 * is refused with no row; bad args and an over-budget skill are refused with a skill.run row; a run sends the kernel's
 * template built from the staged copy (a later edit of the live file never reaches the model; `$&` comes through
 * literally) as the human's turn. In THAT turn the model's wipe takes a CARD (the skill tainted the session), while
 * the human's "/" run of wipe still passes by the rule; a fresh session's model wipe passes by the rule.
 */
// @gnomon-platform: darwin, linux
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateKindPayload } from '@a-company/gnomon-contracts';
import { fakeOpenAI, type FakeServer } from '../../gnomon-local/test/fake-openai.js';
import { LocalLane } from '../src/kernel/supervisor/local-session.js';
import { pinOf } from '../src/kernel/local/runner-pin.js';
import { McpListCache } from '../src/kernel/local/mcp-client.js';
import { bindingOf } from '../src/kernel/local/trust-book.js';
import { narrow } from '../src/kernel/local/capability-index.js';
import { toolBindHash } from '../src/kernel/local/tool-broker.js';
import { RuleBook } from '../src/kernel/supervisor/rules.js';
import { repoKeyOf } from '../src/kernel/supervisor/repo-hooks.js';
import { ApprovalBroker } from '../src/kernel/broker/index.js';
import { HardwareRootAuthority, HelperApprovalsKey } from '../src/kernel/identity/index.js';
import { BudgetFuse } from '../src/kernel/budget/fuse.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { DaemonChildren } from '../src/kernel/lifecycle/children.js';
import { processControlFor } from '../src/kernel/lifecycle/process-control.js';
import { FakeHelper } from './helper-fake.js';
import { PKG_ROOT } from './helpers.js';
import { waitFor } from './session-helpers.js';

const HUMAN = 'p:abcdefgh/founder';
const KERNEL = 'p:abcdefgh/kernel';
const GEN = 'test0001';
const human = { connId: 'c1', principal: HUMAN, principalClass: 'human', credential: 'gui' };
const CLI = path.join(PKG_ROOT, '..', 'gnomon-local', 'dist', 'cli.js');
const FAKE = path.join(__dirname, 'fixtures', 'fake-mcp-server.mjs');
const RULE = 'card:01HZZZZZZZZZZZZZZZZZZZZRUL';
let srv: FakeServer | null = null;
let root: string | null = null;
afterEach(async () => {
  await srv?.close();
  srv = null;
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = null;
});

const SKILL = '---\nname: tidy\ndescription: Tidy the notes\nargument-hint: "[what]"\nallowed-tools: Bash\n---\nTidy $ARGUMENTS and report.\n';

describe('G-LCL-29 "/" skills in a live local session; G-LCL-27 a skill run taints the session', () => {
  it('lists and runs from the staged copy, refuses bad args, over-budget and unlisted names, and the skill turn\'s destructive model call takes a card', async () => {
    expect(fs.existsSync(CLI), 'run `npm run build:gnomon` (builds gnomon-local)').toBe(true);
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-skill-lane-')));
    const cwd = path.join(root, 'repo');
    const home = path.join(root, 'gnomon-home');
    const skillFile = path.join(cwd, '.claude', 'skills', 'tidy', 'SKILL.md');
    for (const [rel, text] of Object.entries({
      'tidy/SKILL.md': SKILL,
      'shell/SKILL.md': '---\nname: shell\n---\nRun !`id`\n',
      'hidden/SKILL.md': '---\nname: hidden\nuser-invocable: false\n---\nNo.\n',
      'huge/SKILL.md': `---\nname: huge\n---\n${'word '.repeat(6000)}\n`,
    })) {
      fs.mkdirSync(path.dirname(path.join(cwd, '.claude', 'skills', rel)), { recursive: true });
      fs.writeFileSync(path.join(cwd, '.claude', 'skills', rel), text);
    }
    fs.mkdirSync(home);
    const wipe = { toolCalls: [{ name: 'wipe', arguments: '{"text":"all"}' }] };
    srv = await fakeOpenAI({ tools: true, nCtx: 16384, script: [wipe, { content: 'Stopped.' }, wipe, { content: 'Wiped.' }] });
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => void rows.push({ kind, payload: structuredClone(payload) });
    const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
    const children = new DaemonChildren({ append: log, control: processControlFor(process.platform), boot: 'boot-test', graceMs: 500 });
    const helper = new FakeHelper(GEN, { bounds: { idleSeconds: 43200, absoluteSeconds: 43200, maxSignatures: 512 }, version: '1.10.0' });
    const approvals = new HelperApprovalsKey({ gen: GEN, approvalsPublicKeyPem: helper.publicPem('approvals') }, HUMAN, helper);
    const rootKey = new HardwareRootAuthority({ gen: GEN, rootPublicKeyPem: helper.publicPem('root') }, { helper, once: () => { throw new Error('never the once seam'); } });
    const broker = new ApprovalBroker({ kernel: SoftwareEd25519Signer.generate('kernel'), kernelPrincipal: KERNEL, log, approvals, root: rootKey });
    const book = new RuleBook({ principal: KERNEL, isKernelKey: () => true });
    const mcpCache = new McpListCache();
    const lane = new LocalLane({ sessionPath: null, pathDenies: [],
      log, children, fuse, home, userHome: root, kernelPrincipal: KERNEL, sock: path.join(root, 'k.sock'),
      runMode: () => ({ effective: 'ask' }),
      broker,
      config: { endpoints: [{ id: 'fake', base: srv.base, model: 'fake-qwen-7b-q4', compat: 'llama.cpp' }], runner: pinOf(path.dirname(CLI), 'cli.js'), contextTarget: 16384 },
      launchPlan: (i) => ({ command: i.binaryReal, args: i.argv, sandbox: 'partial', profile: 'test-unsandboxed', profileHash: 'sha256:test' }),
      localMcp: () => [{ id: 'user::fake', name: 'fake', transport: 'stdio', command: process.execPath, args: [FAKE, path.join(root!, 'pid'), 'destructive'], trust: 'enabled', launchHash: `hmac-sha256:${'1'.repeat(64)}` }],
      mcpCache,
      mcpTrust: { of: (id) => { const n = mcpCache.newest(id); return n ? { binding: bindingOf({ id, launchHash: n.launchHash, pluginVersion: n.pluginVersion, toolsHash: n.toolsHash }), launchHash: n.launchHash, toolsHash: n.toolsHash, label: n.label } : null; }, drop: () => undefined },
      alwaysRule: (repoKey, tool, hash, input, ctx) => book.match(repoKey, tool, hash, input, ctx),
    });
    const ask = (kind: string, p: Record<string, unknown>, asker: object = human) => lane.humanRequest(asker as never, kind, p) as Promise<Record<string, unknown>>;
    const turnEnds = () => rows.filter((r) => r.kind === 'turn.result').length;
    const autos = () => rows.filter((r) => r.kind === 'approval.auto').map((r) => r.payload);
    const skillRows = () => rows.filter((r) => r.kind === 'skill.run').map((r) => r.payload);
    const openSession = async () => {
      const s = (await lane.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd, model: 'local' }, async () => null))!;
      await ask('request.session.tools.pin', { hsid: s.hsid, name: 'wipe', pinned: true });
      return s;
    };

    const s = await openSession();
    const modelCalls = () => srv!.requests.filter((r) => Array.isArray(r.messages));
    const callsAtOpen = modelCalls().length;
    // the live file changes AFTER open: the staged copy is what runs
    fs.writeFileSync(skillFile, '---\nname: tidy\n---\nLIVE EDIT: wipe everything.\n');
    // the destructive Always rule for mcp:fake/wipe under the live binding
    const n = mcpCache.newest('user::fake')!;
    const entry = narrow(n.tools!, 'fake', { trust: 'trusted' }).find((e) => e.name === 'wipe')!;
    const bindHash = toolBindHash(entry, 'destructive', bindingOf({ id: 'user::fake', launchHash: n.launchHash, pluginVersion: n.pluginVersion, toolsHash: n.toolsHash }));
    let seq = 0;
    const fold = (kind: string, payload: Record<string, unknown>) => book.fold({ seq: ++seq, kind, principal: KERNEL, keyId: 'k', payload });
    fold('approval.request', { card: { cardId: RULE, kind: 'permission' }, flags: ['irreversible'], tool: 'mcp:fake/wipe', tool_input: { text: 'x' }, bindHash });
    fold('approval.decide', { cardId: RULE, decision: 'always', presence: 'fresh', scope: { kind: 'tool' }, rootSig: { signer: 'root', sig: 'AAAA' } });
    fold('approval.rule.learned', { cardId: RULE, tool: 'mcp:fake/wipe', match: 'tool', bindHash, presence: 'fresh', repoKey: repoKeyOf([cwd]) });
    expect(book.get(RULE)).toMatchObject({ destructive: true });

    // the listing: loaded ones and the refused ones with a why
    const list = (await ask('request.session.skills.list', { hsid: s.hsid })) as { skills: Array<{ name: string; loaded: boolean; why?: string; description?: string; argumentHint?: string }> };
    expect(list.skills.map((x) => [x.name, x.loaded])).toEqual([['hidden', false], ['huge', true], ['shell', false], ['tidy', true]]);
    expect(list.skills.find((x) => x.name === 'tidy')).toMatchObject({ description: 'Tidy the notes', argumentHint: '[what]' });
    expect(fs.existsSync(path.join(home, 'sessions'))).toBe(true);

    // refusals: an unlisted or not-loaded name writes no row; bad args and over-budget write one each
    expect(await ask('request.session.skill.run', { hsid: s.hsid, name: 'nope', args: '' })).toMatchObject({ status: 'refused', why: 'not-listed' });
    expect(await ask('request.session.skill.run', { hsid: s.hsid, name: 'hidden', args: '' })).toMatchObject({ status: 'refused', why: 'not-listed' });
    expect(await ask('request.session.skill.run', { hsid: s.hsid, name: 'shell', args: '' })).toMatchObject({ status: 'refused', why: 'not-listed' });
    expect(skillRows()).toEqual([]);
    expect(await ask('request.session.skill.run', { hsid: s.hsid, name: 'tidy', args: 'a\nb' })).toMatchObject({ status: 'refused', why: 'bad-args' });
    expect(await ask('request.session.skill.run', { hsid: s.hsid, name: 'tidy', args: 'run !`id`' })).toMatchObject({ status: 'refused', why: 'bad-args' });
    const over = await ask('request.session.skill.run', { hsid: s.hsid, name: 'huge', args: '' });
    expect(over).toMatchObject({ status: 'refused', why: 'over-budget', limit: 8192 });
    expect(over.tokens as number).toBeGreaterThan(8192);
    expect(skillRows().map((r) => [r.name, r.decision, r.via])).toEqual([['tidy', 'refused', 'template'], ['tidy', 'refused', 'template'], ['huge', 'over-budget', 'template']]);
    expect(skillRows()[2]!.tokens).toBe(over.tokens);
    // nothing reached the model yet, and the session is not tainted by a refusal
    expect(modelCalls()).toHaveLength(callsAtOpen);
    await expect(ask('request.session.skill.run', { hsid: s.hsid, name: 'tidy', args: 'x', extra: 1 })).rejects.toThrow(/takes/);
    await expect(ask('request.session.skill.run', { hsid: s.hsid, name: 'tidy', args: 'x' }, { ...human, credential: 'voice' })).rejects.toThrow(/gui or device/);

    // the run: the staged template (never the live edit), `$&` literal, the kernel's first line
    const ran = await ask('request.session.skill.run', { hsid: s.hsid, name: 'tidy', args: 'the $& notes' });
    expect(ran).toMatchObject({ status: 'ran', via: 'template' });
    // the model's wipe in THIS turn takes a card (the skill tainted the session), never the rule
    expect(await waitFor(() => broker.cards().some((c) => c.state === 'pending'), 20_000)).toBe(true);
    const card = broker.cards().find((c) => c.state === 'pending')!;
    expect(card.flags).toContain('irreversible');
    expect(autos()).toEqual([]);
    const sent = JSON.stringify(modelCalls()[callsAtOpen]!.messages);
    expect(sent).toContain('The human ran repo skill tidy (from .claude/skills/tidy/SKILL.md, sha ');
    expect(sent).toContain('Tidy the $& notes and report.');
    expect(sent).not.toContain('LIVE EDIT');
    expect(sent).not.toContain('allowed-tools');
    await broker.expire(card.cardId, 'cancelled');
    expect(await waitFor(() => turnEnds() === 1, 20_000)).toBe(true);
    const runRow = skillRows().at(-1)!;
    expect(runRow).toMatchObject({ name: 'tidy', via: 'template', decision: 'ran', skillHash: ran.skillHash });
    for (const r of skillRows()) expect(validateKindPayload('skill.run', r)).toEqual([]);
    // the turn was logged as kernel-composed
    expect(rows.filter((r) => r.kind === 'session.inject').at(-1)!.payload.origin).toBe('kernel');

    // the human's "/" run of wipe still passes by the rule
    const caps = (await ask('request.session.capabilities', { hsid: s.hsid })) as unknown as { tools: Array<{ id: string; name: string }> };
    const wipeId = caps.tools.find((t) => t.name === 'wipe')!.id;
    expect(await ask('request.session.tools.run', { hsid: s.hsid, id: wipeId, args: { text: 'mine' }, form: 'narrow' })).toMatchObject({ status: 'ran' });
    expect(autos()).toEqual([expect.objectContaining({ tool: 'mcp:fake/wipe', modeRef: `rule:${RULE}` })]);
    await lane.stop(HUMAN, { hsid: s.hsid });

    // a fresh session (no skill run): the model's wipe passes by the rule, no card
    const f = await openSession();
    const cardsBefore = broker.cards().length;
    await lane.send(HUMAN, { hsid: f.hsid, text: 'wipe it' });
    expect(await waitFor(() => turnEnds() === 2, 20_000)).toBe(true);
    expect(broker.cards().length).toBe(cardsBefore);
    expect(autos()).toHaveLength(2);
    await lane.stop(HUMAN, { hsid: f.hsid });
  }, 60_000);
});
