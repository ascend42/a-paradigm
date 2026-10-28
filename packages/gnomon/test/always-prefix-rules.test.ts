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
  return b.match(repo, 'Bash', inputHash(input), input, CTX);
};
const CTX = { prefixRules: true, roots: ['/work/repo'] };

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
    expect(m(b, 'git log --stat')).not.toBeNull();
    b.fold({ principal: K, keyId: KEY, kind: 'approval.rule.revoked', payload: { ruleId: card(13), repoKey: REPO, tool: 'Bash', connId: 'conn:x' } });
    expect(m(b, 'git log --stat')).toBeNull();
    b.fold(rows[2]!);
    expect(m(b, 'git log --stat')).toBeNull();
  });

  it('a Bash card offers prefix choices (first two argv words, policy-checked) inside contentHash detail only for one literal simple command', () => {
    const plan = (command: string) => composePermission({ requestId: 'q', toolName: 'Bash', toolUseId: 't', input: { command } }, { repo: '/r', denyWrite: [] }) as { kind: string; detail: Record<string, unknown>; block: { children: Array<{ type?: string; detail?: unknown }> } };
    const p = plan('git log -n 5');
    expect(p.detail.prefixOptions).toEqual([['git', 'log']]); // Aegis H1: never one word
    expect(p.block.children.filter((c) => c.type === 'bash-prefix').map((c) => c.detail)).toEqual([p.detail]);
    expect(plan('ls').detail.prefixOptions).toBeUndefined();
    expect(plan('rg foo').detail.prefixOptions).toEqual([['rg', 'foo']]);
    for (const c of ['ls -la', 'bash x.sh', 'python3 x.py', 'npm test', 'npm run build', 'git push origin', 'git -c x=y log', 'cargo build', 'make all', 'npm ls', 'npm view x', 'cargo tree', 'go env', 'go list ./...', 'pnpm ls', 'yarn why x', './run.sh go', 'g\u0456t log']) expect(plan(c).detail.prefixOptions, c).toBeUndefined();
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

describe('3-word prefixes (Aegis 2026-10-23, TD-2026-10-23-939 follow-up): offered beside the 2-word one, same policy', () => {
  it('a Bash card offers the 2- and the 3-word prefix #prefix-policy allows; never one word, never a refused one', () => {
    const offers = (command: string): unknown => {
      const p = composePermission({ toolName: 'Bash', input: { command }, toolUseId: null } as never, { repo: '/work/repo', denyWrite: [] });
      return p.kind === 'card' ? (p.detail.prefixOptions ?? []) : null;
    };
    expect(offers('paradigm lore record --type decision --title x')).toEqual([['paradigm', 'lore'], ['paradigm', 'lore', 'record']]);
    expect(offers('git log -n 5')).toEqual([['git', 'log']]); // git: exactly two words
    expect(offers('bash -c x')).toEqual([]); // an interpreter is never a prefix
    expect(offers('ls')).toEqual([]); // one word is never a prefix
  });
  it('a 3-word rule answers the next call with different arguments (the founder\'s `paradigm lore record` case)', () => {
    const P3 = ['paradigm', 'lore', 'record'];
    const b = book(prefixRows(card(9), { command: 'paradigm lore record --type decision --title a', scope: { kind: 'prefix', prefix: P3 }, prefix: P3 }));
    expect(m(b, 'paradigm lore record --type insight --title b')).toMatchObject({ ruleId: card(9) });
    expect(m(b, 'paradigm lore list')).toBeNull();
    expect(m(b, 'paradigm lore record --body /etc/passwd')).toBeNull(); // M3: an absolute path outside the roots
  });
});

describe('scoped edit rules fold and match (TD-2026-10-23-939 follow-up)', () => {
  const editRows = (cardId: string, scope: unknown, learned: Record<string, unknown>, tool = 'Write'): RuleRow[] => [
    { principal: K, keyId: KEY, kind: 'approval.request', payload: { card: { cardId, kind: 'permission' }, tool, tool_input: { file_path: '/work/repo/a.ts', content: 'x' } } },
    { principal: K, keyId: KEY, kind: 'approval.decide', payload: { cardId, decision: 'always', ...(scope === undefined ? {} : { scope }) } },
    { principal: K, keyId: KEY, kind: 'approval.rule.learned', payload: { cardId, tool, presence: 'fresh', repoKey: REPO, ...learned } },
  ];
  const em = (b: RuleBook, tool: string, editPath: string | null, o: { repo?: string; prefixRules?: boolean; repoEdits?: boolean } = {}) => b.match(o.repo ?? REPO, tool, 'sha256:x', { file_path: editPath ?? '/x' }, { prefixRules: o.prefixRules ?? true, roots: ['/work/repo'], editPath, repoEdits: o.repoEdits ?? true });
  it('a file rule matches only its path, any edit tool, any content; never without the pass, in manual mode or another repo', () => {
    const b = book(editRows(card(20), { kind: 'file' }, { match: 'file', path: '/work/repo/a.ts' }));
    expect(b.list()).toEqual([expect.objectContaining({ ruleId: card(20), match: 'file', path: '/work/repo/a.ts' })]);
    expect(em(b, 'Edit', '/work/repo/a.ts')).toMatchObject({ ruleId: card(20) });
    expect(em(b, 'Write', '/work/repo/b.ts')).toBeNull();
    expect(em(b, 'Edit', null)).toBeNull(); // the auto-edits pass failed (gate-class, symlink, outside the roots, flagged)
    expect(em(b, 'Edit', '/work/repo/a.ts', { prefixRules: false })).toBeNull(); // manual
    expect(em(b, 'Edit', '/work/repo/a.ts', { repo: OTHER })).toBeNull();
    expect(em(b, 'Bash', '/work/repo/a.ts')).toBeNull(); // a Bash write never matches an edit rule
  });
  it('a repo-edits rule matches any edit the pass allows in its repo', () => {
    const b = book(editRows(card(21), { kind: 'repo-edits' }, { match: 'repo-edits' }));
    expect(em(b, 'MultiEdit', '/work/repo/any/where.ts')).toMatchObject({ ruleId: card(21) });
    expect(em(b, 'Edit', null)).toBeNull();
    expect(em(b, 'Edit', '/work/repo/x', { prefixRules: false })).toBeNull();
    expect(em(b, 'Edit', '/work/repo/x', { repoEdits: false })).toBeNull(); // Aegis H1: the ceiling forbids auto-edits
  });
  it('a learned row whose decide scope differs, a relative path or a non-edit tool forms no rule', () => {
    expect(book(editRows(card(22), undefined, { match: 'repo-edits' })).list()).toEqual([]); // decided exact
    expect(book(editRows(card(23), { kind: 'file' }, { match: 'repo-edits' })).list()).toEqual([]); // scope mismatch
    expect(book(editRows(card(24), { kind: 'file' }, { match: 'file', path: 'a.ts' })).list()).toEqual([]);
    expect(book(editRows(card(25), { kind: 'repo-edits' }, { match: 'repo-edits' }, 'Bash')).list()).toEqual([]);
    expect(book(editRows(card(26), { kind: 'file', path: '/x' }, { match: 'file', path: '/work/repo/a.ts' })).list()).toEqual([]); // malformed scope
  });
});

describe('G-BRK-09 (Aegis C6\'a2-2 M1): a destructive program is never a prefix rule (offer, fold, match)', () => {
  const offers = (command: string): unknown => {
    const p = composePermission({ toolName: 'Bash', input: { command }, toolUseId: null } as never, { repo: '/work/repo', denyWrite: [] });
    return p.kind === 'card' ? (p.detail.prefixOptions ?? []) : null;
  };
  it('no rm, mv, dd, truncate, shred, chmod, chown or rsync prefix is offered; nor git clean/reset, find or xargs', () => {
    for (const c of ['rm build/x -rf src', 'mv a b', 'dd if=a of=b', 'truncate -s 0 f', 'shred f', 'chmod 777 f', 'chown me f', 'rsync -a --delete a b', 'RM build/x', 'rm.exe build/x', 'mkfs.ext4 x y', 'git clean -fdx', 'git reset --hard', 'find . -delete', 'xargs rm -rf']) expect(offers(c), c).toEqual([]);
  });
  it('a kernel-signed rm prefix rule never folds, so `rm build/x -rf src` never passes without a card', () => {
    for (const prefix of [['rm', 'build/x'], ['mv', 'a'], ['chmod', '777'], ['rsync', 'a']]) {
      const b = book(prefixRows(card(40), { command: `${prefix.join(' ')} y`, scope: { kind: 'prefix', prefix }, prefix }));
      expect(b.list(), prefix.join(' ')).toEqual([]);
    }
    expect(m(book(prefixRows(card(41), { command: 'rm build/x', scope: { kind: 'prefix', prefix: ['rm', 'build/x'] }, prefix: ['rm', 'build/x'] })), 'rm build/x -rf src')).toBeNull();
  });
  it('a forged rm prefix rule never folds', () => {
    const rows = prefixRows(card(42), { command: 'rm build/x', scope: { kind: 'prefix', prefix: ['rm', 'build/x'] }, prefix: ['rm', 'build/x'], principal: 'p:abcdefgh/founder' });
    expect(book(rows).list()).toEqual([]);
  });
});
