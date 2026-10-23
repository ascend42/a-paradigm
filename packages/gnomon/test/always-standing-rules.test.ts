/**
 * TD-2026-10-23-815 (founder ruling on Aegis M1): an Always taken under a standing grant forms a rule, but only when the
 * kernel's OWN rows show that grant live at the decide row (minted with permission:always, not revoked before it, not
 * expired at the row's time, the rule's repo among its repos). Plus the Aegis H1 brake fold. Pure RuleBook folds.
 */
import { describe, expect, it } from 'vitest';
import { inputHash } from '../src/kernel/supervisor/permission.js';
import { RuleBook, type RuleRow } from '../src/kernel/supervisor/rules.js';

const K = 'p:abcdefgh/kernel';
const KEY = 'kernel-key';
const REPO = `sha256:${'a'.repeat(64)}`;
const OTHER = `sha256:${'b'.repeat(64)}`;
const G = 'card:01HZZZZZZZZZZZZZZZZZZZZGRA';
const C = 'card:01HZZZZZZZZZZZZZZZZZZZZCRD';
const T0 = Date.parse('2026-10-23T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const DEV = `udev:${'c'.repeat(40)}`;
const by = { principal: K, keyId: KEY };
const INPUT = { file_path: '/w/a.ts', content: 'x' };

const grant = (o: { tuples?: string[]; repos?: string[]; expiresAt?: number; principal?: string } = {}): RuleRow => ({ ...by, ...(o.principal ? { principal: o.principal } : {}), kind: 'grant.standing', at: iso(T0), payload: { grantId: G, cardId: G, tuples: o.tuples ?? ['permission:always'], repos: o.repos ?? [REPO], device: DEV, expiresAt: iso(o.expiresAt ?? T0 + 3_600_000), by: 'p:abcdefgh/founder' } });
const decided = (o: { at?: number; presence?: string; scope?: unknown; device?: string | null } = {}): RuleRow[] => [
  { ...by, kind: 'approval.request', at: iso((o.at ?? T0 + 60_000) - 1000), payload: { card: { cardId: C, kind: 'permission' }, tool: 'Write', tool_input: INPUT } },
  { ...by, kind: 'approval.decide', at: iso(o.at ?? T0 + 60_000), payload: { cardId: C, decision: 'always', presence: o.presence ?? `standing:${G}`, ...(o.device === null ? {} : { device: o.device ?? DEV }), ...(o.scope ? { scope: o.scope } : {}) } },
];
const learned = (o: { presence?: string; repoKey?: string; match?: Record<string, unknown> } = {}): RuleRow => ({ ...by, kind: 'approval.rule.learned', payload: { cardId: C, tool: 'Write', ...(o.match ?? { matchExact: true }), presence: o.presence ?? `standing:${G}`, repoKey: o.repoKey ?? REPO } });
const book = (rows: RuleRow[]) => {
  const b = new RuleBook({ principal: K, isKernelKey: (k) => k === KEY });
  rows.forEach((r, i) => b.fold({ ...r, seq: i + 1 }));
  return b;
};

describe('TD-2026-10-23-815: a standing-covered always forms a rule only when its grant is verified live', () => {
  it('a live grant: the rule forms and matches next time (exact and repo-edits)', () => {
    const b = book([grant(), ...decided(), learned()]);
    expect(b.match(REPO, 'Write', inputHash(INPUT), INPUT)).toMatchObject({ ruleId: C, presence: `standing:${G}` });
    const e = book([grant(), ...decided({ scope: { kind: 'repo-edits' } }), learned({ match: { match: 'repo-edits' } })]);
    expect(e.match(REPO, 'Edit', 'sha256:x', {}, { prefixRules: true, roots: ['/w'], editPath: '/w/b.ts', repoEdits: true })).toMatchObject({ ruleId: C });
  });
  it('a forged grant id, a grant row from another principal, or a grant without permission:always never folds', () => {
    expect(book([grant(), ...decided({ presence: 'standing:card:01HZZZZZZZZZZZZZZZZZZZZZZZ' }), learned({ presence: 'standing:card:01HZZZZZZZZZZZZZZZZZZZZZZZ' })]).list()).toEqual([]);
    expect(book([...decided(), learned()]).list()).toEqual([]); // no grant row at all
    expect(book([grant({ principal: 'p:abcdefgh/agent' }), ...decided(), learned()]).list()).toEqual([]);
    expect(book([grant({ tuples: ['voice.widen'] }), ...decided(), learned()]).list()).toEqual([]);
    expect(book([grant(), ...decided(), learned({ presence: 'standing:card:01HZZZZZZZZZZZZZZZZZZZZZZZ' })]).list()).toEqual([]); // learned names another grant
  });
  it('an expired grant (decide row after expiresAt) or a decide row with no kernel time never folds', () => {
    expect(book([grant({ expiresAt: T0 + 30_000 }), ...decided({ at: T0 + 60_000 }), learned()]).list()).toEqual([]);
    const noAt = decided().map((r) => (r.kind === 'approval.decide' ? { ...r, at: undefined } : r));
    expect(book([grant(), ...noAt, learned()]).list()).toEqual([]);
  });
  it('a grant revoked before the decision never folds; one revoked after it keeps the rule', () => {
    const revoked: RuleRow = { ...by, kind: 'grant.standing.revoked', payload: { grantId: G, by: 'p:abcdefgh/founder', reason: 'human' } };
    expect(book([grant(), revoked, ...decided(), learned()]).list()).toEqual([]);
    expect(book([grant(), ...decided(), revoked, learned()]).list()).toHaveLength(1);
  });
  it('Aegis L2: the decide row must name the grant device (another device, or none, never folds)', () => {
    expect(book([grant(), ...decided({ device: `udev:${'d'.repeat(40)}` }), learned()]).list()).toEqual([]);
    expect(book([grant(), ...decided({ device: null }), learned()]).list()).toEqual([]);
  });
  it('Aegis L1: a revoked grant stays revoked; a second grant.standing row for its id never re-mints it', () => {
    const revoked: RuleRow = { ...by, kind: 'grant.standing.revoked', payload: { grantId: G, by: 'p:abcdefgh/founder', reason: 'human' } };
    expect(book([grant(), revoked, grant({ expiresAt: T0 + 7_200_000 }), ...decided(), learned()]).list()).toEqual([]);
    // nor does a second row widen a live grant (another repo set): the first row's repos stand
    expect(book([grant({ repos: [OTHER] }), grant({ repos: [REPO] }), ...decided(), learned()]).list()).toEqual([]);
  });
  it('the rule repo must be one of the grant repos', () => {
    expect(book([grant({ repos: [OTHER] }), ...decided(), learned()]).list()).toEqual([]);
  });
  it('cached and click presence still never learn', () => {
    expect(book([grant(), ...decided({ presence: 'cached' }), learned({ presence: 'cached' })]).list()).toEqual([]);
  });
});

describe('Aegis H1: the emergency brake fold', () => {
  const repoEdits = (repo = REPO): RuleRow[] => [
    { ...by, kind: 'approval.request', payload: { card: { cardId: C, kind: 'permission' }, tool: 'Write', tool_input: INPUT } },
    { ...by, kind: 'approval.decide', payload: { cardId: C, decision: 'always', scope: { kind: 'repo-edits' } } },
    { ...by, kind: 'approval.rule.learned', payload: { cardId: C, tool: 'Write', match: 'repo-edits', presence: 'fresh', repoKey: repo } },
  ];
  const modeSet = (from: string, to: string, hsid?: string): RuleRow => ({ ...by, kind: 'approval.mode.set', payload: { scope: { repo: REPO, ...(hsid ? { hsid } : {}) }, from, to, by: {}, presence: 'none' } });
  it('a repo tightened drops its repo-edits rules; a loosening, a session tighten or another repo leaves them', () => {
    expect(book([...repoEdits(), modeSet('auto-edits', 'ask')]).list()).toEqual([]);
    expect(book([...repoEdits(), modeSet('ask', 'manual')]).list()).toEqual([]);
    expect(book([...repoEdits(), modeSet('ask', 'auto-edits')]).list()).toHaveLength(1);
    expect(book([...repoEdits(), modeSet('auto-edits', 'ask', 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA')]).list()).toHaveLength(1);
    expect(book([...repoEdits(OTHER), modeSet('auto-edits', 'ask')]).list()).toHaveLength(1);
  });
});
