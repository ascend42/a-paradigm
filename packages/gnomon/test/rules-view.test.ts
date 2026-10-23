/**
 * 8.0:rules-view (session 2026-10-23-gnomon-rules-view; Aegis M2/L1/L2) falsifiers.
 *
 * FOLD AND MATCH: an off rule never matches and is not the repo's edits-by-rule (the mode chip); a timed off reads on
 * once the KERNEL clock passes `until`; enabled{human} turns it back on; enabled{expired} clears only the flag it
 * names; enabled never creates a rule and never undoes a revoke; forged rows are ignored; `gnomon rules list` says off.
 *
 * BATCH (#rules-apply): narrowing (remove, off) is written at once, before and without any card; every `on` of a
 * batch rides ONE strictness card (op rules.apply, changes in the detail, the kernel's own words on its lines, hand
 * only, never standing); the effect re-validates at allow time (a rule revoked meanwhile never comes back) and takes
 * fresh presence only; a bad change, an off time in the past or past 7 days, or an oversize card writes nothing; the
 * sweep writes enabled{cause:'expired'} for each off time that passed.
 */
import { describe, expect, it } from 'vitest';
import type { CardV1 } from '@a-company/gnomon-contracts';
import { RefusedError } from '@a-company/gnomon-contracts';
import { inputHash } from '../src/kernel/supervisor/permission.js';
import { RuleBook, ruleWords, type RuleRow } from '../src/kernel/supervisor/rules.js';
import { createRulesApply, createRulesLock, parseRulesApply, rulesStatus, RULES_APPLY_OP, STATUS_WORDS_MAX } from '../src/kernel/socket/rules-apply.js';
import { MAX_LINE } from '../src/kernel/broker/card.js';
import { createRulesRevokeHandler } from '../src/kernel/socket/rules-revoke.js';
import { standingTupleOf } from '../src/kernel/broker/standing-grant.js';
import type { RaiseInput } from '../src/kernel/broker/broker.js';

const K = 'p:abcdefgh/kernel';
const KEY = 'kernel-key';
const REPO = `sha256:${'a'.repeat(64)}`;
const card = (n: number) => `card:01J${String(n).padStart(23, '0')}`;
const CONN = 'conn:01J9Z8Y7X6W5V4T3S2R1Q0P9N8';
const T0 = Date.parse('2026-10-23T14:07:00.000Z');
const HOUR = 3_600_000;

function learnRows(cardId: string, o: { input?: unknown; tool?: string; scope?: 'repo-edits' } = {}): RuleRow[] {
  const tool = o.tool ?? (o.scope ? 'Edit' : 'Bash');
  return [
    { principal: K, keyId: KEY, kind: 'approval.request', session: 'hsid:v1:01J9Z8Y7X6W5V4T3S2R1Q0P9N8', payload: { card: { cardId, kind: 'permission' }, tool, tool_input: o.input ?? { command: `npm run build-${cardId.slice(-3)}` } } },
    { principal: K, keyId: KEY, kind: 'approval.decide', payload: { cardId, decision: 'always', ...(o.scope ? { scope: { kind: o.scope } } : {}) } },
    { principal: K, keyId: KEY, at: '2026-10-23T12:53:00.000Z', kind: 'approval.rule.learned', payload: { cardId, tool, presence: 'fresh', repoKey: REPO, ...(o.scope ? { match: o.scope } : { matchExact: true }) } },
  ];
}
const off = (ruleId: string, until: string | null, by: Partial<RuleRow> = {}): RuleRow => ({ principal: K, keyId: KEY, at: new Date(T0).toISOString(), kind: 'approval.rule.disabled', payload: { ruleId, repoKey: REPO, tool: 'Bash', until, batch: 'batch:01J9Z8Y7X6W5V4T3S2R1Q0P9N8', connId: CONN }, ...by });
const on = (ruleId: string, p: Record<string, unknown> = { cause: 'human', until: null }): RuleRow => ({ principal: K, keyId: KEY, kind: 'approval.rule.enabled', payload: { ruleId, repoKey: REPO, tool: 'Bash', ...p } });
const revoked = (ruleId: string): RuleRow => ({ principal: K, keyId: KEY, kind: 'approval.rule.revoked', payload: { ruleId, repoKey: REPO, tool: 'Bash', connId: CONN } });

function clockBook(t = { now: T0 }): { b: RuleBook; t: { now: number } } {
  return { b: new RuleBook({ principal: K, isKernelKey: (k) => k === KEY }, { clock: () => t.now }), t };
}
const H = (n: number) => inputHash({ command: `npm run build-${card(n).slice(-3)}` });

describe('8.0:rules-view fold and match: disabled, timed, re-enabled', () => {
  it('an off rule never matches; enabled{human} turns it back on', () => {
    const { b } = clockBook();
    for (const r of learnRows(card(1))) b.fold(r);
    expect(b.match(REPO, 'Bash', H(1))?.ruleId).toBe(card(1));
    b.fold(off(card(1), null));
    expect(b.match(REPO, 'Bash', H(1))).toBeNull();
    expect(b.stateOf(card(1))).toEqual({ state: 'off', until: null, since: new Date(T0).toISOString() });
    expect(b.list().map((r) => r.ruleId)).toEqual([card(1)]); // still listed (the Rules view shows it off)
    b.fold(on(card(1)));
    expect(b.match(REPO, 'Bash', H(1))?.ruleId).toBe(card(1));
  });

  it('a timed off reads on once the KERNEL clock passes until (no row needed); the sweep row then clears the flag', () => {
    const { b, t } = clockBook();
    for (const r of learnRows(card(2))) b.fold(r);
    const until = new Date(T0 + HOUR).toISOString();
    b.fold(off(card(2), until));
    expect(b.match(REPO, 'Bash', H(2))).toBeNull();
    expect(b.dueExpiries()).toEqual([]);
    t.now = T0 + HOUR; // the end itself counts as passed
    expect(b.match(REPO, 'Bash', H(2))?.ruleId).toBe(card(2));
    expect(b.dueExpiries().map((x) => [x.rule.ruleId, x.until])).toEqual([[card(2), until]]);
    b.fold(on(card(2), { cause: 'expired', until }));
    expect(b.dueExpiries()).toEqual([]);
  });

  it('an old expiry row never clears a newer off with another time', () => {
    const { b } = clockBook();
    for (const r of learnRows(card(3))) b.fold(r);
    const first = new Date(T0 + HOUR).toISOString();
    b.fold(off(card(3), first));
    b.fold(off(card(3), null)); // lengthened to "until I turn it back on"
    b.fold(on(card(3), { cause: 'expired', until: first }));
    expect(b.stateOf(card(3)).state).toBe('off');
  });

  it('enabled never creates a rule and never undoes a revoke; an off for an unknown rule marks nothing; forged rows are ignored', () => {
    const { b } = clockBook();
    for (const r of learnRows(card(4))) b.fold(r);
    b.fold(off(card(4), null));
    b.fold(revoked(card(4)));
    b.fold(on(card(4)));
    expect(b.get(card(4))).toBeNull();
    expect(b.match(REPO, 'Bash', H(4))).toBeNull();
    b.fold(on(card(5))); // never learned
    expect(b.get(card(5))).toBeNull();
    b.fold(off(card(6), null)); // never learned: no flag waits for a later learn
    for (const r of learnRows(card(6))) b.fold(r);
    expect(b.match(REPO, 'Bash', H(6))?.ruleId).toBe(card(6));
    b.fold(off(card(6), null, { principal: 'p:abcdefgh/founder' }));
    b.fold(off(card(6), null, { keyId: 'device-key' }));
    expect(b.match(REPO, 'Bash', H(6))?.ruleId).toBe(card(6));
  });

  it('Aegis L2: the mode chip (repoEditsRule) skips an off "edits in this repo" rule', () => {
    const { b } = clockBook();
    for (const r of learnRows(card(7), { scope: 'repo-edits', input: { file_path: '/r/a.ts', old_string: 'a', new_string: 'b' } })) b.fold(r);
    expect(b.repoEditsRule(REPO)?.ruleId).toBe(card(7));
    b.fold({ ...off(card(7), null), payload: { ...(off(card(7), null).payload as object), tool: 'Edit' } });
    expect(b.repoEditsRule(REPO)).toBeNull();
    expect(b.match(REPO, 'Edit', 'x', {}, { prefixRules: true, roots: ['/r'], editPath: '/r/a.ts', repoEdits: true })).toBeNull();
  });

  it('the kernel composes the words: an exact command, a prefix, a file, repo edits', () => {
    const { b } = clockBook();
    for (const r of learnRows(card(8), { input: { command: 'npm run build' } })) b.fold(r);
    expect(ruleWords(b.get(card(8))!)).toBe('this exact command: npm run build');
    expect(b.get(card(8))).toMatchObject({ learnedAt: '2026-10-23T12:53:00.000Z', hsid: 'hsid:v1:01J9Z8Y7X6W5V4T3S2R1Q0P9N8' });
    expect(ruleWords({ ...b.get(card(8))!, match: 'prefix', prefix: ['paradigm', 'lore', 'record'] })).toBe('Bash commands starting paradigm lore record …');
    expect(ruleWords({ ...b.get(card(8))!, match: 'file', path: '/r/src/app.ts' })).toBe('edits to /r/src/app.ts');
    expect(ruleWords({ ...b.get(card(8))!, match: 'repo-edits' })).toBe('edits in this repo (same as auto-edits)');
  });
});

/* ── the batch ─────────────────────────────────────────────────────── */

const HUMAN = { connId: CONN, principal: 'p:abcdefgh/founder', principalClass: 'human', credential: 'gui' };

function harness(n: number, o: { maxCardChars?: number; failAt?: number } = {}) {
  const { b, t } = clockBook();
  for (let i = 1; i <= n; i++) for (const r of learnRows(card(i))) b.fold(r);
  const written: RuleRow[] = [];
  const raised: RaiseInput[] = [];
  const cards = new Map<string, { state: string }>();
  let seq = 1000;
  const deps = {
    book: () => b,
    append: async (kind: string, payload: Record<string, unknown>) => {
      if (o.failAt !== undefined && written.length === o.failAt) throw new Error('disk full');
      const row: RuleRow = { principal: K, keyId: KEY, seq: ++seq, at: new Date(t.now).toISOString(), kind, payload };
      written.push(row);
      b.fold(row);
    },
    broker: {
      raise: async (input: RaiseInput) => {
        raised.push(input);
        const cardId = card(9000 + raised.length);
        cards.set(cardId, { state: 'pending' });
        return { cardId, kind: input.kind } as unknown as CardV1;
      },
      card: (id: string) => cards.get(id) as never,
    },
    lock: createRulesLock(),
    ...(o.maxCardChars !== undefined ? { maxCardChars: o.maxCardChars } : {}),
  };
  const apply = createRulesApply(deps);
  return { b, t, written, raised, apply, deps };
}
const refusalOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof RefusedError) return { code: e.refusal.code, reason: e.refusal.data?.reason };
    throw e;
  }
  throw new Error('expected a refusal');
};

describe('#rules-apply: narrow at once, one card for loosening', () => {
  it('a tighten-only batch writes every row at once and raises no card', async () => {
    const h = harness(3);
    const r = await h.apply.apply(HUMAN, { changes: [{ ruleId: card(1), op: 'off', until: 'manual' }, { ruleId: card(2), op: 'off', until: new Date(T0 + HOUR).toISOString() }, { ruleId: card(3), op: 'remove' }] });
    expect(r.cardId).toBeNull();
    expect(h.raised).toEqual([]);
    expect(h.written.map((w) => w.kind)).toEqual(['approval.rule.disabled', 'approval.rule.disabled', 'approval.rule.revoked']);
    expect(new Set(h.written.slice(0, 2).map((w) => (w.payload as { batch: string }).batch))).toEqual(new Set([r.batch]));
    expect(h.b.match(REPO, 'Bash', H(1))).toBeNull();
    expect(h.b.get(card(3))).toBeNull();
  });

  it('M2: narrowing never waits on loosening; every on of the batch rides ONE card (hand-only, never standing)', async () => {
    const h = harness(5);
    for (const id of [card(1), card(2), card(3)]) h.b.fold(off(id, null));
    const r = await h.apply.apply(HUMAN, { changes: [{ ruleId: card(1), op: 'on' }, { ruleId: card(4), op: 'off', until: 'manual' }, { ruleId: card(2), op: 'on' }, { ruleId: card(5), op: 'remove' }, { ruleId: card(3), op: 'on' }] });
    // the narrowing rows are written before (and whatever happens to) the card
    expect(h.written.map((w) => w.kind)).toEqual(['approval.rule.disabled', 'approval.rule.revoked']);
    expect(h.raised).toHaveLength(1);
    const c = h.raised[0]!;
    expect(c.kind).toBe('strictness');
    expect(c.handOnly).toBe(true); // never by voice
    expect(c.decisions).toEqual(['allow', 'deny']);
    // L-1: each change carries the repo, the kernel's words and (M-2) the off flag it clears, all inside the contentHash
    expect(c.detail).toEqual({ op: RULES_APPLY_OP, batch: r.batch, changes: [card(1), card(2), card(3)].map((ruleId) => ({ ruleId, op: 'on', repoKey: REPO, words: ruleWords(h.b.get(ruleId)!), until: null })), connId: CONN });
    // L1: the lines are the kernel's words for each rule, never page text
    for (const id of [card(1), card(2), card(3)]) expect(c.lines.some((l) => l.includes(ruleWords(h.b.get(id)!)))).toBe(true);
    // never standing: no standing tuple names a rules.apply card, whatever the repo
    expect(standingTupleOf({ kind: 'strictness', flags: [] } as never, 'allow', c.detail, REPO)).toBeNull();
    expect(r).toMatchObject({ cardId: card(9001), on: [card(1), card(2), card(3)] });
    // allow with fresh presence: the three rules come back on, each row naming the batch and the card
    await c.effect!('allow', { token: null, rootSig: null, connId: CONN, presence: 'fresh' });
    expect(h.written.slice(2).map((w) => [w.kind, (w.payload as { ruleId: string }).ruleId, (w.payload as { cardId: string }).cardId])).toEqual([card(1), card(2), card(3)].map((id) => ['approval.rule.enabled', id, card(9001)]));
    for (const n of [1, 2, 3]) expect(h.b.match(REPO, 'Bash', H(n))?.ruleId).toBe(card(n));
  });

  it('the effect re-validates at allow time: a rule revoked while the card waited never comes back', async () => {
    const h = harness(2);
    for (const id of [card(1), card(2)]) h.b.fold(off(id, null));
    await h.apply.apply(HUMAN, { changes: [{ ruleId: card(1), op: 'on' }, { ruleId: card(2), op: 'on' }] });
    const revoke = createRulesRevokeHandler({ lookup: (id) => h.b.get(id), append: async (p) => void h.b.fold({ principal: K, keyId: KEY, kind: 'approval.rule.revoked', payload: p }), lock: h.deps.lock });
    await revoke({ connId: CONN, principal: HUMAN.principal, surface: 'gui', isLive: () => true }, { ruleId: card(1) });
    await h.raised[0]!.effect!('allow', { token: null, rootSig: null, connId: CONN, presence: 'fresh' });
    expect(h.written.filter((w) => w.kind === 'approval.rule.enabled').map((w) => (w.payload as { ruleId: string }).ruleId)).toEqual([card(2)]);
    expect(h.b.get(card(1))).toBeNull();
    expect(h.b.match(REPO, 'Bash', H(1))).toBeNull();
  });

  it('only fresh presence turns rules back on (a standing grant or a cached unlock is refused); deny writes nothing', async () => {
    const h = harness(1);
    h.b.fold(off(card(1), null));
    await h.apply.apply(HUMAN, { changes: [{ ruleId: card(1), op: 'on' }] });
    await h.raised[0]!.effect!('deny', { token: null, rootSig: null, connId: CONN, presence: 'fresh' });
    for (const presence of ['standing:card:01J00000000000000000000001', 'cached', undefined]) {
      expect(await refusalOf(h.raised[0]!.effect!('allow', { token: null, rootSig: null, connId: CONN, ...(presence ? { presence } : {}) }))).toMatchObject({ code: 'FORBIDDEN', reason: 'presence' });
    }
    expect(h.written).toEqual([]);
    expect(h.b.stateOf(card(1)).state).toBe('off');
  });

  it('atomic: one bad change refuses the whole batch before any write', async () => {
    const h = harness(3);
    expect(await refusalOf(h.apply.apply(HUMAN, { changes: [{ ruleId: card(1), op: 'off', until: 'manual' }, { ruleId: card(2), op: 'on' }] }))).toMatchObject({ code: 'BAD_REQUEST', reason: 'already-on' });
    expect(await refusalOf(h.apply.apply(HUMAN, { changes: [{ ruleId: card(1), op: 'remove' }, { ruleId: card(77), op: 'remove' }] }))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(h.apply.apply(HUMAN, { changes: [{ ruleId: card(1), op: 'remove' }, { ruleId: card(1), op: 'off', until: 'manual' }] }))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(h.written).toEqual([]);
    expect(h.b.list()).toHaveLength(3);
  });

  it('L2: until is on the kernel clock, in the future and at most 7 days ahead; an off already off only lengthens', async () => {
    const h = harness(2);
    expect(await refusalOf(h.apply.apply(HUMAN, { changes: [{ ruleId: card(1), op: 'off', until: new Date(T0 - 1).toISOString() }] }))).toMatchObject({ reason: 'until-past' });
    expect(await refusalOf(h.apply.apply(HUMAN, { changes: [{ ruleId: card(1), op: 'off', until: new Date(T0 + 7 * 24 * HOUR + 1).toISOString() }] }))).toMatchObject({ reason: 'until-too-far' });
    expect(await refusalOf(h.apply.apply(HUMAN, { changes: [{ ruleId: card(1), op: 'off', until: 'tomorrow' }] }))).toMatchObject({ code: 'BAD_REQUEST' });
    await h.apply.apply(HUMAN, { changes: [{ ruleId: card(1), op: 'off', until: 'manual' }] });
    expect(await refusalOf(h.apply.apply(HUMAN, { changes: [{ ruleId: card(1), op: 'off', until: new Date(T0 + HOUR).toISOString() }] }))).toMatchObject({ reason: 'would-loosen' });
    expect(parseRulesApply({ changes: [{ ruleId: card(2), op: 'off', until: new Date(T0 + 7 * 24 * HOUR).toISOString() }] }, T0)[0]!.until).toBe(T0 + 7 * 24 * HOUR);
  });

  it('L1: a batch whose card would pass MAX_CARD_CHARS is refused, never cut, and writes nothing', async () => {
    const h = harness(3, { maxCardChars: 200 });
    for (const id of [card(1), card(2), card(3)]) h.b.fold(off(id, null));
    const r = await refusalOf(h.apply.apply(HUMAN, { changes: [{ ruleId: card(1), op: 'on' }, { ruleId: card(2), op: 'on' }, { ruleId: card(3), op: 'on' }] }));
    expect(r).toMatchObject({ code: 'BAD_REQUEST', reason: 'too-large' });
    expect(h.raised).toEqual([]);
    expect(h.written).toEqual([]);
  });

  it('only the human on a first-party connection; at most 64 changes', async () => {
    const h = harness(1);
    for (const a of [{ ...HUMAN, principalClass: 'agent' }, { ...HUMAN, credential: 'read-token' }, { ...HUMAN, principalClass: 'voice' }]) expect(await refusalOf(h.apply.apply(a, { changes: [{ ruleId: card(1), op: 'remove' }] }))).toMatchObject({ code: 'FORBIDDEN' });
    expect(await refusalOf(h.apply.apply(HUMAN, { changes: Array.from({ length: 65 }, (_, i) => ({ ruleId: card(i + 1), op: 'remove' })) }))).toMatchObject({ reason: 'too-many' });
  });

  it('the sweep writes enabled{cause:expired} for each off time that passed (the GUI feed shows it)', async () => {
    const h = harness(2);
    const until = new Date(T0 + HOUR).toISOString();
    await h.apply.apply(HUMAN, { changes: [{ ruleId: card(1), op: 'off', until }, { ruleId: card(2), op: 'off', until: 'manual' }] });
    expect(await h.apply.expireDue()).toBe(0);
    h.t.now = T0 + HOUR + 1;
    expect(await h.apply.expireDue()).toBe(1);
    expect(h.written.at(-1)).toMatchObject({ kind: 'approval.rule.enabled', payload: { ruleId: card(1), cause: 'expired', until } });
    expect(await h.apply.expireDue()).toBe(0);
    expect(h.b.stateOf(card(2)).state).toBe('off');
  });

  it('status.rules: each rule in the kernel words, its state, and the presets on the kernel clock', () => {
    const h = harness(2);
    h.b.fold(off(card(2), new Date(T0 + HOUR).toISOString()));
    const s = rulesStatus(h.b, { repoName: () => 'a-paradigm' }) as { now: string; presets: { hour: string; tomorrow: string }; rules: Array<Record<string, unknown>> };
    expect(s.now).toBe(new Date(T0).toISOString());
    expect(s.presets.hour).toBe(new Date(T0 + HOUR).toISOString());
    const tm = new Date(s.presets.tomorrow);
    expect([tm.getHours(), tm.getMinutes()]).toEqual([6, 0]);
    expect(Date.parse(s.presets.tomorrow) > T0).toBe(true);
    expect(s.rules.map((r) => [r.ruleId, r.state, r.until ?? null, r.repoName])).toEqual([
      [card(1), 'on', null, 'a-paradigm'],
      [card(2), 'off', new Date(T0 + HOUR).toISOString(), 'a-paradigm'],
    ]);
    expect(s.rules[0]!.words).toBe(ruleWords(h.b.get(card(1))!));
  });

  it('Aegis M-1: a 1000-character command and a multi-line command are shown in full on the card (wrapped, never cut)', async () => {
    const long = `echo ${'x'.repeat(995)}`;
    const multi = 'cat <<EOF > notes.txt\nfirst line\nsecond line\nEOF';
    const { b } = clockBook();
    for (const [i, cmd] of [[1, long], [2, multi]] as const) for (const r of learnRows(card(i), { input: { command: cmd } })) b.fold(r);
    for (const id of [card(1), card(2)]) b.fold(off(id, null));
    const raised: RaiseInput[] = [];
    const apply = createRulesApply({ book: () => b, append: async () => undefined, broker: { raise: async (i: RaiseInput) => (raised.push(i), { cardId: card(9100) } as unknown as CardV1), card: () => ({ state: 'pending' }) as never }, lock: createRulesLock() });
    await apply.apply(HUMAN, { changes: [{ ruleId: card(1), op: 'on' }, { ruleId: card(2), op: 'on' }] });
    const block = raised[0]!.block as { children: Array<{ text: string }> };
    expect(block).toBeDefined();
    const texts = block.children.map((c) => c.text);
    for (const t of texts) expect([...t].length).toBeLessThanOrEqual(MAX_LINE);
    expect(texts.some((t) => t.endsWith('…'))).toBe(false);
    const shown = texts.join('').replace(/\s*↳ /g, '');
    expect(shown).toContain(long);
    for (const line of multi.split('\n')) expect(texts.some((t) => t.endsWith(line))).toBe(true);
  });

  it('Aegis M-2: a card raised for an off rule never undoes a newer off with another time (skipped and reported)', async () => {
    const h = harness(1);
    const until = new Date(T0 + HOUR).toISOString();
    await h.apply.apply(HUMAN, { changes: [{ ruleId: card(1), op: 'off', until }] });
    await h.apply.apply(HUMAN, { changes: [{ ruleId: card(1), op: 'on' }] }); // the card waits
    await h.apply.apply(HUMAN, { changes: [{ ruleId: card(1), op: 'off', until: 'manual' }] }); // narrowing never waits
    await h.raised[0]!.effect!('allow', { token: null, rootSig: null, connId: CONN, presence: 'fresh' });
    expect(h.written.filter((w) => w.kind === 'approval.rule.enabled')).toEqual([]);
    expect(h.b.stateOf(card(1))).toMatchObject({ state: 'off', until: null });
    expect(h.apply.lastSkipped()).toEqual({ cardId: card(9001), ruleIds: [card(1)] });
    // and the fold refuses a stale row too: an enabled{human} naming the old time clears nothing
    h.b.fold(on(card(1), { cause: 'human', until, batch: 'batch:01J9Z8Y7X6W5V4T3S2R1Q0P9N8', connId: CONN, cardId: card(9001) }));
    expect(h.b.stateOf(card(1)).state).toBe('off');
  });

  it('a partial log failure mid-batch: the rows written stand, the refusal names them, and no card is raised', async () => {
    const h = harness(3, { failAt: 1 });
    h.b.fold(off(card(3), null));
    const r = await refusalOf(h.apply.apply(HUMAN, { changes: [{ ruleId: card(1), op: 'off', until: 'manual' }, { ruleId: card(2), op: 'remove' }, { ruleId: card(3), op: 'on' }] }));
    expect(r).toMatchObject({ code: 'ENGINE', reason: 'partial' });
    expect(h.written.map((w) => w.kind)).toEqual(['approval.rule.disabled']);
    expect(h.b.stateOf(card(1)).state).toBe('off');
    expect(h.b.get(card(2))).not.toBeNull();
    expect(h.raised).toEqual([]);
  });

  it('the repo brake landing while a re-enable card waits: the repo-edits rule is gone and the allow brings nothing back', async () => {
    const { b } = clockBook();
    for (const r of learnRows(card(1), { scope: 'repo-edits', input: { file_path: '/r/a.ts', old_string: 'a', new_string: 'b' } })) b.fold(r);
    b.fold({ ...off(card(1), null), payload: { ...(off(card(1), null).payload as object), tool: 'Edit' } });
    const written: RuleRow[] = [];
    const raised: RaiseInput[] = [];
    const apply = createRulesApply({ book: () => b, append: async (kind, payload) => void written.push({ principal: K, keyId: KEY, kind, payload }), broker: { raise: async (i: RaiseInput) => (raised.push(i), { cardId: card(9200) } as unknown as CardV1), card: () => ({ state: 'pending' }) as never }, lock: createRulesLock() });
    await apply.apply(HUMAN, { changes: [{ ruleId: card(1), op: 'on' }] });
    b.fold({ principal: K, keyId: KEY, kind: 'approval.mode.set', payload: { scope: { repo: REPO }, from: 'auto-edits', to: 'ask' } });
    await raised[0]!.effect!('allow', { token: null, rootSig: null, connId: CONN, presence: 'fresh' });
    expect(written).toEqual([]);
    expect(b.get(card(1))).toBeNull();
    expect(b.repoEditsRule(REPO)).toBeNull();
    expect(apply.lastSkipped()?.ruleIds).toEqual([card(1)]);
  });

  it('Aegis L-2: status.rules caps the words (the card shows them in full); L-3: until must be an ISO time', () => {
    const { b } = clockBook();
    for (const r of learnRows(card(1), { input: { command: `echo ${'y'.repeat(2000)}` } })) b.fold(r);
    const row = (rulesStatus(b) as { rules: Array<{ words: string; wordsChars?: number }> }).rules[0]!;
    expect([...row.words].length).toBe(STATUS_WORDS_MAX);
    expect(row.wordsChars).toBe(ruleWords(b.get(card(1))!).length);
    expect(() => parseRulesApply({ changes: [{ ruleId: card(1), op: 'off', until: 'Fri Oct 24 2026' }] }, T0)).toThrow();
  });
});
