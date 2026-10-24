// @gnomon-platform: darwin, linux
/**
 * #always-rules + #rules-cli falsifiers (spec §3.4 S-L1, S25-C2;
 * gui-complete item 2). The rule book is derived from KERNEL-signed rows
 * only; a forged row of any kind, a cached-presence learn, a missing
 * `always` decision or a tool mismatch forms no rule; a rule matches only
 * its exact (repoKey, tool, inputHash). `gnomon rules list` reads the same
 * fold from a VERIFIED log.
 *
 * Revoke (P8-D98, TD-2026-10-19-528 F1/F2): a kernel-signed
 * approval.rule.revoked removes the rule (the exact match raises the card
 * again), a forged one is ignored, a fresh `always` on a new card learns a
 * new rule, `rules list` hides the revoked rule, the #rules-revoke handler
 * refuses an unknown id NOT_FOUND, and `gnomon rules revoke` works end to end
 * against a running daemon as the home's human device.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startDaemon, type DaemonHandle } from '../src/kernel/lifecycle/index.js';
import { createRulesRevokeHandler, type RulesRevokeDeps } from '../src/kernel/socket/rules-revoke.js';
import { RpcRefusal } from '../src/kernel/socket/index.js';
import { loadDevHome, provisionDevHome } from '../src/cli/dev-home.js';
import { recordKernelPub } from '../src/kernel/identity/index.js';
import { kernelPrincipalOf } from '../src/kernel/lifecycle/index.js';
import { KeyRing, SoftwareEd25519Signer, type AnchorStore, type HeadAnchor, type KernelLog } from '../src/kernel/log/index.js';
import { openKernelLog } from '../src/kernel/testing.js';
import { inputHash } from '../src/kernel/supervisor/permission.js';
import { catchUp, MAX_RULES, RuleBook, ruleSourceOf, type RuleRow } from '../src/kernel/supervisor/rules.js';
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

const revokedRow = (ruleId: string, by: { principal?: string; keyId?: string } = {}): RuleRow => ({
  principal: by.principal ?? K,
  keyId: by.keyId ?? KEY,
  kind: 'approval.rule.revoked',
  payload: { ruleId, repoKey: REPO, tool: 'Bash', connId: 'conn:x' },
});

describe('#always-rules: revoke (approval.rule.revoked) and the exact-only match (F1/F2)', () => {
  const h = inputHash(INPUT);
  it('after a kernel-signed revoke the exact match is gone (the card is raised again) and list hides it', () => {
    const b = book([...learnRows(card(1)), ...learnRows(card(2), { input: { command: 'ls' } })]);
    expect(b.match(REPO, 'Bash', h)?.ruleId).toBe(card(1));
    b.fold(revokedRow(card(1)));
    expect(b.match(REPO, 'Bash', h)).toBeNull();
    expect(b.get(card(1))).toBeNull();
    expect(b.list().map((r) => r.ruleId)).toEqual([card(2)]);
  });

  it('a forged revoked row (another principal, a non-kernel key, no key) is ignored', () => {
    for (const forge of [{ principal: 'p:abcdefgh/founder' }, { keyId: 'device-key' }, { keyId: undefined as unknown as string }]) {
      const b = book(learnRows(card(1)));
      b.fold({ ...revokedRow(card(1)), ...forge });
      expect(b.match(REPO, 'Bash', h)?.ruleId).toBe(card(1));
    }
  });

  it('a replayed learned row for the revoked card never brings it back; a fresh `always` on a new card learns a new rule', () => {
    const b = book(learnRows(card(1)));
    b.fold(revokedRow(card(1)));
    b.fold(learnRows(card(1))[2]!);
    expect(b.match(REPO, 'Bash', h)).toBeNull();
    for (const r of learnRows(card(3))) b.fold(r);
    expect(b.match(REPO, 'Bash', h)?.ruleId).toBe(card(3));
  });

  it("F2: `match:'exact'` learns; any other match value forms no rule", () => {
    const withMatch = (m: unknown) => {
      const rows = learnRows(card(1));
      const { matchExact: _drop, ...rest } = rows[2]!.payload as Record<string, unknown>;
      rows[2] = { ...rows[2]!, payload: { ...rest, match: m } };
      return book(rows).list().length;
    };
    expect(withMatch('exact')).toBe(1);
    for (const m of ['prefix', 'glob', 'any', null, true]) expect(withMatch(m)).toBe(0);
  });
});

describe('#rules-revoke: the rules.revoke handler', () => {
  const ctx = { connId: 'conn:test-1', principal: 'p:local/founder', surface: 'cli', isLive: () => true };
  const rig = () => {
    const b = book(learnRows(card(1)));
    const appended: Array<{ payload: unknown; connId: string }> = [];
    const deps: RulesRevokeDeps = {
      lookup: (id) => b.get(id),
      append: async (payload, ids) => {
        appended.push({ payload, connId: ids.connId });
        b.fold(revokedRow(payload.ruleId)); // the kernel-signed row the daemon would write
      },
    };
    return { b, appended, handler: createRulesRevokeHandler(deps) };
  };
  const refusalOf = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      if (e instanceof RpcRefusal) return e.refusal.code;
      throw e;
    }
    return 'no refusal';
  };

  it('revokes a standing rule: one row stamped with THIS connection, then the match is gone', async () => {
    const r = rig();
    expect(await r.handler(ctx, { ruleId: card(1) })).toEqual({ ruleId: card(1), revoked: true });
    expect(r.appended).toEqual([{ payload: { ruleId: card(1), repoKey: REPO, tool: 'Bash', connId: 'conn:test-1' }, connId: 'conn:test-1' }]);
    expect(r.b.match(REPO, 'Bash', inputHash(INPUT))).toBeNull();
  });

  it('an unknown id is NOT_FOUND; a second (even concurrent) revoke of one rule writes one row', async () => {
    const r = rig();
    expect(await refusalOf(r.handler(ctx, { ruleId: card(9) }))).toBe('NOT_FOUND');
    const both = await Promise.allSettled([r.handler(ctx, { ruleId: card(1) }), r.handler(ctx, { ruleId: card(1) })]);
    expect(both.map((x) => x.status)).toEqual(['fulfilled', 'rejected']);
    expect(r.appended).toHaveLength(1);
  });

  it('bad params are BAD_REQUEST and write nothing', async () => {
    const r = rig();
    for (const p of [undefined, null, [], 'card', {}, { ruleId: 7 }, { ruleId: 'rule:1' }, { ruleId: card(1), extra: 1 }]) expect(await refusalOf(r.handler(ctx, p))).toBe('BAD_REQUEST');
    expect(r.appended).toEqual([]);
  });
});

describe('#always-rules: catch-up stops at the RELEASED head (Aegis H1)', () => {
  const homes: Array<() => void> = [];
  const logs: KernelLog[] = [];
  const unhold: Array<() => void> = [];
  afterEach(async () => {
    for (const u of unhold.splice(0)) u();
    for (const l of logs.splice(0)) await l.close().catch(() => undefined);
    for (const c of homes.splice(0)) c();
  });

  it('falsifier: a revoke appended while a critical approval.decide waits on its anchors is folded once released — the rule is gone', async () => {
    const t = tempHome('rules-h1-');
    homes.push(t.cleanup);
    fs.mkdirSync(t.home, { recursive: true, mode: 0o700 });
    const g = { hold: false, waiting: [] as Array<() => void>, stored: undefined as HeadAnchor | undefined };
    const ks: AnchorStore = {
      name: 'keystore',
      read: () => (g.stored ? { state: 'present', head: g.stored } : { state: 'absent' }),
      write: async (h) => {
        if (g.hold) await new Promise<void>((res) => g.waiting.push(res));
        g.stored = h;
      },
    };
    const log = openKernelLog({ home: t.home, kernelPrincipal: K, signer: SoftwareEd25519Signer.generate('kernel'), keystoreAnchor: ks, keystoreTimeoutMs: 60_000 });
    logs.push(log);
    unhold.push(() => ((g.hold = false), g.waiting.splice(0).forEach((res) => res())));
    const append = (r: RuleRow) => log.append({ kind: r.kind, principal: K, payload: r.payload as Record<string, unknown> });
    for (const r of learnRows(card(1))) await append(r);
    const b = new RuleBook({ principal: K, isKernelKey: (k) => log.isKernelKey(k) });
    const src = ruleSourceOf(log);
    catchUp(b, src);
    const h = inputHash(INPUT);
    expect(b.match(REPO, 'Bash', h)?.ruleId).toBe(card(1));
    // a critical approval.decide for another card waits on its keystore anchor; the revoke lands behind it
    g.hold = true;
    const pendingDecide = append(learnRows(card(2), { input: { command: 'ls' } })[1]!);
    await new Promise((r) => setTimeout(r, 10));
    const pendingRevoke = append(revokedRow(card(1)));
    await new Promise((r) => setTimeout(r, 20));
    expect(log.releasedHead()).toBeLessThan(log.head().seq);
    catchUp(b, src);
    expect(b.lastSeq).toBe(log.releasedHead()); // never past what the read could return
    expect(b.match(REPO, 'Bash', h)?.ruleId).toBe(card(1)); // hidden until released (D83)
    g.hold = false;
    for (;;) {
      const w = g.waiting.splice(0);
      if (w.length === 0) break;
      w.forEach((res) => res());
      await new Promise((r) => setTimeout(r, 10));
    }
    await Promise.all([pendingDecide, pendingRevoke]);
    expect(log.releasedHead()).toBe(log.head().seq);
    catchUp(b, src);
    expect(b.match(REPO, 'Bash', h)).toBeNull();
    expect(b.get(card(1))).toBeNull();
  });

  it('a tip-valued head would have skipped the hidden rows forever (why the source is the released head)', () => {
    const b = new RuleBook({ principal: K, isKernelKey: (k) => k === KEY });
    for (const r of learnRows(card(1))) b.fold(r);
    const rows = [{ ...revokedRow(card(1)), seq: 7 }];
    // a source whose head exceeds what read returns: catchUp ignores nothing it read, folds nothing above head
    expect(catchUp(b, { head: () => 6, read: () => rows })).toBe(true);
    expect(b.lastSeq).toBe(6);
    expect(b.get(card(1))?.ruleId).toBe(card(1)); // seq 7 is above the captured head: not folded early
  });
});

describe('#rules-cli: `gnomon rules list` reads a VERIFIED log', () => {
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

  it('lists the kernel-signed rule; a row appended under another principal is not a rule', async () => {
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
    const bad = io();
    expect(await runRulesCommand(['list', 'relative/home'], bad.io)).toBe(64);
  });

  it('lists a prefix rule (TD-2026-10-20-294) with its match and words, and the json carries match + prefix', async () => {
    const t = tempHome('rules-prefix-');
    homes.push(t.cleanup);
    const KERNEL = kernelPrincipalOf();
    const key = SoftwareEd25519Signer.generate('kernel');
    recordKernelPub(t.home, key.publicKeyPem);
    const ring = new KeyRing();
    ring.addEd25519(key.publicKeyPem);
    const log = openKernelLog({ home: t.home, kernelPrincipal: KERNEL, signer: key, keyRing: ring });
    logs.push(log);
    const cid = card(7);
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [
      { kind: 'approval.request', payload: { card: { cardId: cid, kind: 'permission' }, tool: 'Bash', tool_input: { command: 'git log -n 5' } } },
      { kind: 'approval.decide', payload: { cardId: cid, decision: 'always', scope: { kind: 'prefix', prefix: ['git', 'log'] } } },
      { kind: 'approval.rule.learned', payload: { cardId: cid, tool: 'Bash', match: 'prefix', prefix: ['git', 'log'], presence: 'fresh', repoKey: REPO } },
    ];
    for (const r of rows) await log.append({ kind: r.kind, principal: KERNEL, payload: r.payload });
    await log.close();
    const j = io();
    expect(await runRulesCommand(['list', t.home, '--json'], j.io)).toBe(0);
    expect((JSON.parse(j.out.join('')) as { rules: unknown[] }).rules).toEqual([expect.objectContaining({ ruleId: cid, match: 'prefix', prefix: ['git', 'log'], tool: 'Bash', repoKey: REPO })]);
    const txt = io();
    expect(await runRulesCommand(['list', t.home], txt.io)).toBe(0);
    expect(txt.out.join('')).toContain('prefix: git log …');
  });
});

describe('#rules-cli: `gnomon rules revoke` end to end (running daemon, human device)', () => {
  const homes: Array<() => void> = [];
  const daemons: DaemonHandle[] = [];
  afterEach(async () => {
    for (const d of daemons.splice(0)) await d.shutdown('signal').catch(() => undefined);
    for (const c of homes.splice(0)) c();
  });
  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { stdout: { write: (s: string) => (out.push(s), true) }, stderr: { write: (s: string) => (err.push(s), true) } } };
  };

  it('revokes the rule over the socket; list hides it; a second revoke and an unknown id are NOT_FOUND', async () => {
    const t = tempHome('rv-');
    homes.push(t.cleanup);
    fs.mkdirSync(path.dirname(t.home), { recursive: true });
    const userHome = fs.realpathSync.native(path.dirname(t.home));
    const home = path.join(userHome, 'devhome');
    provisionDevHome(home, { userHome });
    const l = loadDevHome(home, { userHome });
    const KERNEL = kernelPrincipalOf(l.root); // the daemon's principal: namespaced by the home's root
    recordKernelPub(home, l.kernelKey.publicKeyPem);
    const ring = new KeyRing();
    ring.addEd25519(l.kernelKey.publicKeyPem);
    const log = openKernelLog({ home, kernelPrincipal: KERNEL, signer: l.kernel, keyRing: ring });
    for (const r of learnRows(card(1), { principal: KERNEL })) await log.append({ kind: r.kind, principal: KERNEL, payload: r.payload as Record<string, unknown> });
    await log.close();

    const before = io();
    const bc = await runRulesCommand(['list', home, '--json'], before.io);
    expect(before.err.join('')).toBe('');
    expect(bc).toBe(0);
    expect((JSON.parse(before.out.join('')) as { rules: Array<{ ruleId: string }> }).rules.map((r) => r.ruleId)).toEqual([card(1)]);

    // no daemon yet: refused, not UNSUPPORTED
    const down = io();
    expect(await runRulesCommand(['revoke', card(1), '--home', home], down.io)).toBe(1);
    expect(down.err.join('')).toContain('not-running');

    const d = await startDaemon({ home, idleMs: 60_000, kernelSigner: l.kernel, rootAuthority: l.root });
    daemons.push(d);
    const ok = io();
    const okCode = await runRulesCommand(["revoke", card(1), "--home", home, "--json"], ok.io);
    expect(ok.err.join("")).toBe("");
    expect(okCode).toBe(0);
    expect(JSON.parse(ok.out.join(''))).toEqual({ ruleId: card(1), revoked: true });
    const again = io();
    expect(await runRulesCommand(['revoke', card(1), '--home', home], again.io)).toBe(1);
    expect(again.err.join('')).toContain('NOT_FOUND');
    const unknown = io();
    expect(await runRulesCommand(['revoke', card(7), '--home', home], unknown.io)).toBe(1);
    expect(unknown.err.join('')).toContain('NOT_FOUND');
    const usage = io();
    expect(await runRulesCommand(['revoke', '--home', home], usage.io)).toBe(64);
    await d.shutdown('signal');
    daemons.splice(0);

    const after = io();
    expect(await runRulesCommand(['list', home, '--json'], after.io)).toBe(0);
    expect((JSON.parse(after.out.join('')) as { rules: unknown[] }).rules).toEqual([]);
  });
});
