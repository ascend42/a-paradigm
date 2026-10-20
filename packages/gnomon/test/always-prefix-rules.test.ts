/**
 * #always-rules prefix falsifiers (TD-2026-10-20-294 part 3). A prefix rule is formed only from kernel-signed rows
 * (request + decide{always, scope} + learned{match:'prefix', prefix}) whose scope and prefix agree and whose shown
 * command starts with the prefix; it matches only a later single literal simple Bash command whose argv starts with
 * the prefix word for word, in the same repo. Pure fold tests: no POSIX-only fixtures.
 */
import { describe, expect, it } from 'vitest';
import { composePermission, inputHash } from '../src/kernel/supervisor/permission.js';
import { bashArgvOfInput, RuleBook, type RuleRow } from '../src/kernel/supervisor/rules.js';

const K = 'p:abcdefgh/kernel';
const KEY = 'kernel-key';
const REPO = `sha256:${'a'.repeat(64)}`;
const OTHER = `sha256:${'b'.repeat(64)}`;
const card = (n: number) => `card:01J${String(n).padStart(23, '0')}`;
const PREFIX = ['git', 'log'];

function prefixRows(cardId: string, o: { command?: string; scope?: unknown; prefix?: unknown; decision?: string; principal?: string; keyId?: string; tool?: string; omit?: number } = {}): RuleRow[] {
  const by = { principal: o.principal ?? K, keyId: o.keyId ?? KEY };
  const rows: RuleRow[] = [
    { ...by, kind: 'approval.request', payload: { card: { cardId, kind: 'permission' }, tool: o.tool ?? 'Bash', tool_input: { command: o.command ?? 'git log -n 5' } } },
    { ...by, kind: 'approval.decide', payload: { cardId, decision: o.decision ?? 'always', ...('scope' in o ? (o.scope === undefined ? {} : { scope: o.scope }) : { scope: { kind: 'prefix', prefix: PREFIX } }) } },
    { ...by, kind: 'approval.rule.learned', payload: { cardId, tool: o.tool ?? 'Bash', match: 'prefix', prefix: 'prefix' in o ? o.prefix : PREFIX, presence: 'fresh', repoKey: REPO } },
  ];
  return rows;
}
const book = (rows: RuleRow[]) => {
  const b = new RuleBook({ principal: K, isKernelKey: (k) => k === KEY });
  for (const r of rows) b.fold(r);
  return b;
};
const m = (b: RuleBook, command: string, repo = REPO, extra: Record<string, unknown> = {}) => {
  const input = { command, ...extra };
  return b.match(repo, 'Bash', inputHash(input), input);
};

describe('#always-rules prefix rules (TD-2026-10-20-294)', () => {
  it('matches a single literal simple command starting with the prefix, and nothing that widens it', () => {
    const b = book(prefixRows(card(1)));
    expect(b.list()).toEqual([expect.objectContaining({ ruleId: card(1), match: 'prefix', prefix: PREFIX })]);
    expect(m(b, 'git log --oneline')).toMatchObject({ ruleId: card(1) });
    expect(m(b, 'git log')).toMatchObject({ ruleId: card(1) });
    expect(m(b, "git log --format='%h %s'")).toMatchObject({ ruleId: card(1) }); // a quoted literal is still literal
    expect(m(b, 'git log --oneline', REPO, { description: 'x', timeout: 1000 })).toMatchObject({ ruleId: card(1) });
    for (const bad of [
      'git log; rm -rf x',
      'git log && rm -rf x',
      'git log || rm -rf x',
      'git log | sh',
      'git log $(x)',
      'git log `x`',
      'git log ${X}',
      'git log $X',
      'git log > out.txt',
      'git log < in.txt',
      'git log &',
      'git log\nrm -rf x',
      'FOO=1 git log',
      'git logx',
      'git',
      'gitlog',
      'git  status',
      'git log *',
      'git log ~/x',
      'xgit log',
      '',
    ]) expect(m(b, bad), JSON.stringify(bad)).toBeNull();
    expect(m(b, 'git log --oneline', OTHER)).toBeNull(); // a different repo
    expect(m(b, 'git log --oneline', REPO, { run_in_background: true })).toBeNull(); // an unknown input key raises the card
    expect(b.match(REPO, 'Write', inputHash({ command: 'git log' }), { command: 'git log' })).toBeNull(); // a different tool
  });

  it('a forged row on any of the three is ignored', () => {
    for (const i of [0, 1, 2]) {
      for (const forge of [{ principal: 'p:abcdefgh/founder' }, { keyId: 'device-key' }]) {
        const rows = prefixRows(card(2));
        rows[i] = { ...rows[i]!, ...forge };
        expect(book(rows).list()).toEqual([]);
      }
    }
  });

  it('a learned prefix row forms no rule unless the decide row carries the same scope', () => {
    expect(book(prefixRows(card(3), { scope: undefined })).list()).toEqual([]); // an exact always never learns a prefix
    expect(book(prefixRows(card(4), { scope: { kind: 'prefix', prefix: ['git'] } })).list()).toEqual([]); // wider learned than decided
    expect(book(prefixRows(card(5), { prefix: ['git'] })).list()).toEqual([]);
    expect(book(prefixRows(card(6), { scope: { kind: 'exact' } })).list()).toEqual([]);
    expect(book(prefixRows(card(7), { decision: 'allow' })).list()).toEqual([]);
  });

  it('a prefix the shown command does not start with, a compound shown command, a non-Bash tool or a bad prefix form no rule', () => {
    expect(book(prefixRows(card(8), { command: 'git status' })).list()).toEqual([]);
    expect(book(prefixRows(card(9), { command: 'git log; rm -rf x' })).list()).toEqual([]);
    expect(book(prefixRows(card(10), { tool: 'Write' })).list()).toEqual([]);
    for (const bad of [[], ['a', 'b', 'c', 'd'], [''], 'git', [1]]) {
      expect(book(prefixRows(card(11), { scope: { kind: 'prefix', prefix: bad }, prefix: bad })).list(), JSON.stringify(bad)).toEqual([]);
    }
  });

  it('an exact learned row after a prefix decision forms no rule (a decision learns only what it bound)', () => {
    const rows = prefixRows(card(12));
    rows[2] = { ...rows[2]!, payload: { cardId: card(12), tool: 'Bash', matchExact: true, presence: 'fresh', repoKey: REPO } };
    expect(book(rows).list()).toEqual([]);
  });

  it('revoke removes a prefix rule and a replayed learned row does not bring it back', () => {
    const rows = prefixRows(card(13));
    const b = book(rows);
    expect(m(b, 'git log -p')).not.toBeNull();
    b.fold({ principal: K, keyId: KEY, kind: 'approval.rule.revoked', payload: { ruleId: card(13), repoKey: REPO, tool: 'Bash', connId: 'conn:x' } });
    expect(m(b, 'git log -p')).toBeNull();
    b.fold(rows[2]!);
    expect(m(b, 'git log -p')).toBeNull();
  });

  it('a Bash card offers prefix choices (first 1-2 argv words) inside contentHash detail only for one literal simple command', () => {
    const plan = (command: string) => composePermission({ requestId: 'q', toolName: 'Bash', toolUseId: 't', input: { command } }, { repo: '/r', denyWrite: [] }) as { kind: string; detail: Record<string, unknown>; block: { children: Array<{ type?: string; detail?: unknown }> } };
    const p = plan('git log -n 5');
    expect(p.detail.prefixOptions).toEqual([['git'], ['git', 'log']]);
    expect(p.block.children.filter((c) => c.type === 'bash-prefix').map((c) => c.detail)).toEqual([p.detail]);
    expect(plan('ls').detail.prefixOptions).toEqual([['ls']]);
    for (const c of ['git log | sh', 'git log; rm x', 'FOO=1 git log', 'git log $(x)', 'git log > f']) {
      const q = plan(c);
      expect(q.detail.prefixOptions, c).toBeUndefined();
      expect(q.block.children.some((x) => x.type === 'bash-prefix'), c).toBe(false);
    }
  });

  it('bashArgvOfInput is the simple-command rule over the input', () => {
    expect(bashArgvOfInput({ command: 'git log -n 5' })).toEqual(['git', 'log', '-n', '5']);
    expect(bashArgvOfInput({ command: 'git log | sh' })).toBeNull();
    expect(bashArgvOfInput({ command: 1 })).toBeNull();
    expect(bashArgvOfInput('git log')).toBeNull();
  });
});
