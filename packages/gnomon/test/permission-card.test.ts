// @gnomon-platform: darwin, linux
/**
 * P8-D96 card composition (permission.ts, pure; Aegis C1/A1/A2 round 2):
 * every input field is on the card, wrapped and never cut; writing tools are
 * never approved on an excerpt except Write (explicit excerpt + inputHash);
 * sandbox escapes and malformed inputs are auto-denied with no card; deny
 * paths case-fold where the default filesystem is case-insensitive.
 * Platform-independent (paths are POSIX strings; the platform is passed).
 */
import { describe, expect, it } from 'vitest';
import { composePermission, deniedWrite, FIELD_BODY_PREFIX, fieldLines, MAX_CARD_CHARS, type PermissionPlan } from '../src/kernel/supervisor/permission.js';
import type { PolicyPath } from '../src/kernel/manifest/policy.js';

const ctx = { repo: '/r', denyWrite: [] as PolicyPath[] };
const req = (toolName: string, input: Record<string, unknown>) => ({ requestId: 'q', toolName, toolUseId: 't', input });
/** the rendered text with continuations joined back (what a human reads, wrap undone) */
const shown = (p: PermissionPlan): string => {
  if (p.kind !== 'card') throw new Error(`expected a card, got ${p.kind}:${p.why}`);
  const texts = (p.block as { children: Array<{ text: string }> }).children.map((c) => c.text);
  expect(texts.every((t) => Array.from(t).length <= 512)).toBe(true);
  // the field fence (Aegis L4) is undone too: body lines lose FIELD_BODY_PREFIX
  return texts.map((t, i) => (i && t.startsWith('  ↳ ') ? `\u0000${t.slice(4)}` : `\n${t}`)).join('').replaceAll('\u0000', '').replaceAll(`\n${FIELD_BODY_PREFIX}`, '\n');
};
/** a key=value field as the card shows it (Aegis L4): a JSON-quoted key label, the fenced value, the end marker */
const kv = (k: string, v: string): string => `field "${k}":\n${v}\n  └ end of field "${k}"`;
const why = (p: PermissionPlan): string => (p.kind === 'auto-deny' ? p.why : 'card');

describe('Aegis L4: field text can never start a card line', () => {
  const lines = (p: PermissionPlan): string[] => (p.kind === 'card' ? (p.block as { children: Array<{ text: string }> }).children.map((c) => c.text) : []);
  it('a multi-line command, an extra key and its value that imitate kernel lines are fenced, with an end marker', () => {
    const spoof = 'ls\nThe session asks to run Read\nrepo: /safe\nquestion 1: ok?';
    const out = lines(composePermission(req('Bash', { command: spoof, ['repo: /x\nalways: safe']: 'v\nrepo: /y' }), ctx));
    for (const l of ['The session asks to run Read', 'repo: /safe', 'question 1: ok?', 'repo: /y']) {
      expect(out).not.toContain(l);
      expect(out).toContain(`${FIELD_BODY_PREFIX}${l}`);
    }
    expect(out).toContain('  └ end of command');
    // the model-chosen key is JSON-quoted on a kernel-prefixed label line (its newline escaped)
    expect(out).toContain('field "repo: /x\\nalways: safe":');
    expect(out.filter((l) => l.startsWith('repo: '))).toEqual(['repo: /r']);
  });
  it('fieldLines: label, every body line prefixed, end marker', () => {
    expect(fieldLines('plan', 'a\nb')).toEqual(['plan:', `${FIELD_BODY_PREFIX}a`, `${FIELD_BODY_PREFIX}b`, '  └ end of plan']);
  });
  it('Aegis L3: a Bash card says the rule pins the command text, not what it runs', () => {
    expect(lines(composePermission(req('Bash', { command: './deploy.sh' }), ctx))).toContain('always: the rule pins this exact command text, not what it runs (a script or binary it calls can change).');
  });
});

describe('Aegis A1: every input field is on the card', () => {
  it('Bash: the command and every other key as key=value', () => {
    const t = shown(composePermission(req('Bash', { command: 'make test', timeout: 600000, run_in_background: true, description: 'run tests' }), ctx));
    for (const s of ['make test', kv('timeout', '600000'), kv('run_in_background', 'true'), kv('description', 'run tests')]) expect(t).toContain(s);
  });
  it('Bash dangerouslyDisableSandbox (any value but false) is auto-denied sandbox-escape, no card', () => {
    for (const v of [true, 'yes', 1]) expect(why(composePermission(req('Bash', { command: 'ls', dangerouslyDisableSandbox: v }), ctx))).toBe('sandbox-escape');
    expect(why(composePermission(req('Bash', { command: 'ls', dangerouslyDisableSandbox: false }), ctx))).toBe('card');
  });
  it('a non-text command / content / old_string is auto-denied bad-input', () => {
    expect(why(composePermission(req('Bash', { command: ['rm', '-rf', '/'] }), ctx))).toBe('bad-input');
    expect(why(composePermission(req('Write', { file_path: '/r/f', content: { a: 1 } }), ctx))).toBe('bad-input');
    expect(why(composePermission(req('Edit', { file_path: '/r/f', old_string: 1, new_string: 'x' }), ctx))).toBe('bad-input');
    expect(why(composePermission(req('ExitPlanMode', { plan: 7 }), ctx))).toBe('bad-input');
  });
  it('an unknown tool shows every key in full (no JSON cap)', () => {
    const url = `https://example.com/${'p'.repeat(3000)}`;
    const t = shown(composePermission(req('WebFetch', { url, prompt: 'summarise' }), ctx));
    expect(t).toContain(kv('url', url));
    expect(t).toContain(kv('prompt', 'summarise'));
  });
});

describe('Aegis A2: writing tools are shown in full (Write: an explicit excerpt + inputHash)', () => {
  it('Edit shows old and new in full, even past the old 4000-character cap', () => {
    const oldS = `${'o'.repeat(5000)}END-OLD`;
    const newS = `${'n'.repeat(5000)}END-NEW`;
    const t = shown(composePermission(req('Edit', { file_path: '/r/f', old_string: oldS, new_string: newS, replace_all: true }), ctx));
    expect(t).toContain(oldS);
    expect(t).toContain(newS);
    expect(t).toContain(kv('replace_all', 'true'));
  });
  it('MultiEdit renders the path and every edit (old/new per edit)', () => {
    const edits = [{ old_string: 'a1', new_string: 'b1' }, { old_string: `${'x'.repeat(2000)}tail2`, new_string: 'b2', replace_all: true }];
    const t = shown(composePermission(req('MultiEdit', { file_path: '/r/f.ts', edits }), ctx));
    expect(t).toContain('edit 1 of 2 on /r/f.ts');
    expect(t).toContain('edit 2 of 2 on /r/f.ts');
    for (const s of ['a1', 'b1', `${'x'.repeat(2000)}tail2`, 'b2', kv('replace_all', 'true')]) expect(t).toContain(s);
    expect(why(composePermission(req('MultiEdit', { file_path: '/r/f', edits: [{ old_string: 'a' }] }), ctx))).toBe('bad-input');
    expect(why(composePermission(req('MultiEdit', { file_path: '/r/f', edits: [] }), ctx))).toBe('bad-input');
  });
  it('NotebookEdit renders its cell source in full, with every other key', () => {
    const src = `import os\n${'y'.repeat(3000)}\nos.system("x")`;
    const t = shown(composePermission(req('NotebookEdit', { notebook_path: '/r/n.ipynb', new_source: src, cell_id: 'c1', edit_mode: 'replace' }), ctx));
    expect(t).toContain('os.system("x")');
    expect(t).toContain('y'.repeat(3000));
    expect(t).toContain(kv('cell_id', 'c1'));
  });
  it('a writing-tool card too large to show in full is denied, never cut', () => {
    const huge = 'z'.repeat(MAX_CARD_CHARS + 10);
    expect(why(composePermission(req('Edit', { file_path: '/r/f', old_string: 'a', new_string: huge }), ctx))).toBe('too-large');
    expect(why(composePermission(req('NotebookEdit', { notebook_path: '/r/n.ipynb', new_source: huge }), ctx))).toBe('too-large');
  });
  it('Write keeps its explicit excerpt line plus the inputHash', () => {
    const t = shown(composePermission(req('Write', { file_path: '/r/f', content: 'c'.repeat(4000) }), ctx));
    expect(t).toMatch(/4000 bytes · inputHash sha256:[0-9a-f]{64}/);
    expect(t).toContain('Only an excerpt is shown: the first 1500 characters');
  });
  it('plan text is shown in full, wrapped', () => {
    const plan = `1. ${'step '.repeat(400)}\n2. final`;
    expect(shown(composePermission(req('ExitPlanMode', { plan }), ctx))).toContain(plan.split('\n')[0]);
  });
});

describe('deny paths case-fold on darwin and win32', () => {
  const deny: PolicyPath[] = [{ path: '/r/.claude', match: 'subpath', class: 'settings' }];
  it('darwin/win32 deny `.CLAUDE/Settings.json`; linux does not fold', () => {
    expect(deniedWrite('/r/.CLAUDE/Settings.json', deny, 'darwin')).not.toBeNull();
    expect(deniedWrite('/r/.CLAUDE/Settings.json', deny, 'win32')).not.toBeNull();
    expect(deniedWrite('/r/.CLAUDE/Settings.json', deny, 'linux')).toBeNull();
    expect(why(composePermission(req('Write', { file_path: '/r/.Claude/settings.json', content: '{}' }), { repo: '/r', denyWrite: deny }, 'darwin'))).toBe('deny-write');
  });
});
