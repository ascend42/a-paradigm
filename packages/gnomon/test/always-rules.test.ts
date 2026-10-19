// @gnomon-platform: darwin, linux
/**
 * #always-rules + #rules-cli falsifiers (spec §3.4 S-L1, S25-C2;
 * gui-complete item 2). The rule book is derived from KERNEL-signed rows
 * only; a forged row of any kind, a cached-presence learn, a missing
 * `always` decision or a tool mismatch forms no rule; a rule matches only
 * its exact (repoKey, tool, inputHash). `gnomon rules list` reads the same
 * fold from a VERIFIED log; revoke is refused (needs a new event kind).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { recordKernelPub } from '../src/kernel/identity/index.js';
import { kernelPrincipalOf } from '../src/kernel/lifecycle/index.js';
import { KeyRing, SoftwareEd25519Signer, type KernelLog } from '../src/kernel/log/index.js';
import { openKernelLog } from '../src/kernel/testing.js';
import { inputHash } from '../src/kernel/supervisor/permission.js';
import { catchUp, MAX_RULES, RuleBook, type RuleRow } from '../src/kernel/supervisor/rules.js';
import { repoKeyOf } from '../src/kernel/supervisor/repo-hooks.js';
import { runRulesCommand, rulesOfHome } from '../src/cli/rules-cli.js';
import { tempHome } from './daemon-helpers.js';

const K = 'p:abcdefgh/kernel';
const KEY = 'kernel-key';
const REPO = `sha256:${'a'.repeat(64)}`;
const OTHER = `sha256:${'b'.repeat(64)}`;
const INPUT = { command: 'npm test' };
const card = (n: number) => `card:01J${String(n).padStart(23, '0')}`;

/** The three kernel rows one `always` decision leaves on the chain. */
function learnRows(cardId: string, o: { tool?: string; input?: unknown; repoKey?: string; presence?: string; decision?: string; principal?: string; keyId?: string } = {}): RuleRow[] {
  const by = { principal: o.principal ?? K, keyId: o.keyId ?? KEY };
  return [
    { ...by, kind: 'approval.request', payload: { card: { cardId, kind: 'permission' }, tool: o.tool ?? 'Bash', tool_input: o.input ?? INPUT } },
    { ...by, kind: 'approval.decide', payload: { cardId, decision: o.decision ?? 'always' } },
    { ...by, kind: 'approval.rule.learned', payload: { cardId, tool: o.tool ?? 'Bash', matchExact: true, presence: o.presence ?? 'fresh', repoKey: o.repoKey ?? REPO } },
  ];
}
const book = (rows: RuleRow[]) => {
  const b = new RuleBook({ principal: K, isKernelKey: (k) => k === KEY });
  for (const r of rows) b.fold(r);
  return b;
};

describe('#always-rules: derived from kernel-signed rows only, exact match only', () => {
  it('a learned rule matches its exact (repoKey, tool, inputHash) and nothing else', () => {
    const b = book(learnRows(card(1)));
    const h = inputHash(INPUT);
    expect(b.match(REPO, 'Bash', h)).toMatchObject({ ruleId: card(1), repoKey: REPO, tool: 'Bash', inputHash: h });
    expect(b.match(OTHER, 'Bash', h)).toBeNull(); // a different repo
    expect(b.match(REPO, 'Bash', inputHash({ command: 'npm test ' }))).toBeNull(); // a different input
    expect(b.match(REPO, 'Write', h)).toBeNull(); // a different tool
  });

  it('a forged row is ignored: wrong principal or a non-kernel key on ANY of the three rows forms no rule', () => {
    for (const i of [0, 1, 2]) {
      for (const forge of [{ principal: 'p:abcdefgh/founder' }, { keyId: 'device-key' }, { keyId: undefined as unknown as string }]) {
        const rows = learnRows(card(2));
        rows[i] = { ...rows[i]!, ...forge };
        expect(book(rows).list()).toEqual([]);
      }
    }
    // a whole forged set signed by another principal
    expect(book(learnRows(card(3), { principal: 'p:abcdefgh/s-x' })).list()).toEqual([]);
  });

  it('no rule without the `always` decision, under cached presence, on a tool mismatch, or without a repoKey', () => {
    expect(book(learnRows(card(4), { decision: 'allow' })).list()).toEqual([]);
    expect(book(learnRows(card(5), { presence: 'cached' })).list()).toEqual([]);
    const mism = learnRows(card(6));
    mism[2] = { ...mism[2]!, payload: { ...(mism[2]!.payload as object), tool: 'Write' } };
    expect(book(mism).list()).toEqual([]);
    const norepo = learnRows(card(7));
    norepo[2] = { ...norepo[2]!, payload: { ...(norepo[2]!.payload as object), repoKey: null } };
    expect(book(norepo).list()).toEqual([]);
    // a learned row with no request on the chain (or a non-permission card) forms none
    expect(book(learnRows(card(8)).slice(1)).list()).toEqual([]);
    const plan = learnRows(card(9));
    plan[0] = { ...plan[0]!, payload: { ...(plan[0]!.payload as object), card: { cardId: card(9), kind: 'plan' } } };
    expect(book(plan).list()).toEqual([]);
  });

  it('Aegis C2: catchUp advances past EVERY scanned row to the head — 1000 non-rule rows are read once, never rescanned', () => {
    const b = new RuleBook({ principal: K, isKernelKey: (k) => k === KEY });
    let head = 1000; // 1000 non-rule rows: the RULE_KINDS read yields nothing for them
    const reads: Array<[number, number]> = [];
    const src = { head: () => head, read: (from: number, to: number) => (reads.push([from, to]), [] as RuleRow[]) };
    expect(catchUp(b, src)).toBe(true);
    expect(b.lastSeq).toBe(1000);
    for (let i = 0; i < 5; i++) expect(catchUp(b, src)).toBe(false); // no new rows: no read at all
    expect(reads).toEqual([[1, 1000]]);
    head = 1003;
    const rows = learnRows(card(1)).map((r, i) => ({ ...r, seq: 1001 + i }));
    expect(catchUp(b, { head: () => head, read: (from, to) => (reads.push([from, to]), rows) })).toBe(true);
    expect(reads.at(-1)).toEqual([1001, 1003]); // only the new rows
    expect(b.list().map((r) => r.ruleId)).toEqual([card(1)]);
  });

  it('repoKeyOf is the one shared key (repo-hooks.ts): pinned value for /', () => {
    expect(repoKeyOf(['/'])).toBe('sha256:8a5edab282632443219e051e4ade2d1d5bbc671c781051bf1437897cbdfea0f1');
    expect(repoKeyOf(['/', '/'])).toBe(repoKeyOf(['/'])); // a worktree equal to cwd counts once
  });

  it('bounded: at most MAX_RULES rules (oldest dropped: the card is raised again, never an allow)', () => {
    const b = new RuleBook({ principal: K, isKernelKey: (k) => k === KEY });
    for (let i = 0; i < MAX_RULES + 5; i++) for (const r of learnRows(card(100 + i), { input: { command: `c${i}` } })) b.fold(r);
    expect(b.list()).toHaveLength(MAX_RULES);
    expect(b.match(REPO, 'Bash', inputHash({ command: 'c0' }))).toBeNull();
    expect(b.match(REPO, 'Bash', inputHash({ command: `c${MAX_RULES + 4}` }))).not.toBeNull();
  });
});

describe('#rules-cli: `gnomon rules list` reads a VERIFIED log; revoke is refused', () => {
  const homes: Array<() => void> = [];
  const logs: KernelLog[] = [];
  afterEach(async () => {
    for (const l of logs.splice(0)) await l.close().catch(() => undefined);
    for (const c of homes.splice(0)) c();
  });
  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { stdout: { write: (s: string) => (out.push(s), true) }, stderr: { write: (s: string) => (err.push(s), true) } } };
  };

  it('lists the kernel-signed rule; a row appended under another principal is not a rule; revoke exits 1 UNSUPPORTED', async () => {
    const t = tempHome('rules-');
    homes.push(t.cleanup);
    const KERNEL = kernelPrincipalOf();
    const key = SoftwareEd25519Signer.generate('kernel');
    recordKernelPub(t.home, key.publicKeyPem);
    const ring = new KeyRing();
    ring.addEd25519(key.publicKeyPem);
    const log = openKernelLog({ home: t.home, kernelPrincipal: KERNEL, signer: key, keyRing: ring });
    logs.push(log);
    for (const r of learnRows(card(1), { principal: KERNEL })) await log.append({ kind: r.kind, principal: KERNEL, payload: r.payload as Record<string, unknown> });
    // a forged learn: a non-kernel principal (the log signs it, but readers attribute by principal)
    for (const r of learnRows(card(2))) await log.append({ kind: r.kind, principal: 'p:abcdefgh/founder', payload: r.payload as Record<string, unknown> }).catch(() => undefined);
    await log.close();
    const r = rulesOfHome(t.home);
    expect(r.ok).toBe(true);
    expect(r.ok && r.rules.map((x) => x.ruleId)).toEqual([card(1)]);
    const j = io();
    expect(await runRulesCommand(['list', t.home, '--json'], j.io)).toBe(0);
    expect((JSON.parse(j.out.join('')) as { rules: Array<{ ruleId: string; inputHash: string }> }).rules).toEqual([expect.objectContaining({ ruleId: card(1), inputHash: inputHash(INPUT) })]);
    const txt = io();
    expect(await runRulesCommand(['list', t.home], txt.io)).toBe(0);
    expect(txt.out.join('')).toContain('1 standing always-allow rule(s)');
    const rv = io();
    expect(await runRulesCommand(['revoke', card(1)], rv.io)).toBe(1);
    expect(rv.err.join('')).toContain('REFUSED  UNSUPPORTED');
    const bad = io();
    expect(await runRulesCommand(['list', 'relative/home'], bad.io)).toBe(64);
  });
});
