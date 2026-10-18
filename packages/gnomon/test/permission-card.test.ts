/**
 * P8-D96 card composition (permission.ts, pure; Aegis C1/A1/A2 round 2):
 * every input field is on the card, wrapped and never cut; writing tools are
 * never approved on an excerpt except Write (explicit excerpt + inputHash);
 * sandbox escapes and malformed inputs are auto-denied with no card; deny
 * paths case-fold where the default filesystem is case-insensitive.
 * Platform-independent (paths are POSIX strings; the platform is passed).
 */
import { describe, expect, it } from 'vitest';
import { composePermission, deniedWrite, MAX_CARD_CHARS, type PermissionPlan } from '../src/kernel/supervisor/permission.js';
import type { PolicyPath } from '../src/kernel/manifest/policy.js';

const ctx = { repo: '/r', denyWrite: [] as PolicyPath[] };
const req = (toolName: string, input: Record<string, unknown>) => ({ requestId: 'q', toolName, toolUseId: 't', input });
/** the rendered text with continuations joined back (what a human reads, wrap undone) */
const shown = (p: PermissionPlan): string => {
  if (p.kind !== 'card') throw new Error(`expected a card, got ${p.kind}:${p.why}`);
  const texts = (p.block as { children: Array<{ text: string }> }).children.map((c) => c.text);
  expect(texts.every((t) => Array.from(t).length <= 512)).toBe(true);
  return texts.map((t, i) => (i && t.startsWith('  ↳ ') ? `\u0000${t.slice(4)}` : `\n${t}`)).join('').replaceAll('\u0000', '');
};
const why = (p: PermissionPlan): string => (p.kind === 'auto-deny' ? p.why : 'card');

describe('Aegis A1: every input field is on the card', () => {
  it('Bash: the command and every other key as key=value', () => {
    const t = shown(composePermission(req('Bash', { command: 'make test', timeout: 600000, run_in_background: true, description: 'run tests' }), ctx));
    for (const s of ['make test', 'timeout=600000', 'run_in_background=true', 'description=run tests']) expect(t).toContain(s);
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
    expect(t).toContain(`url=${url}`);
    expect(t).toContain('prompt=summarise');
  });
});

describe('Aegis A2: writing tools are shown in full (Write: an explicit excerpt + inputHash)', () => {
  it('Edit shows old and new in full, even past the old 4000-character cap', () => {
    const oldS = `${'o'.repeat(5000)}END-OLD`;
    const newS = `${'n'.repeat(5000)}END-NEW`;
    const t = shown(composePermission(req('Edit', { file_path: '/r/f', old_string: oldS, new_string: newS, replace_all: true }), ctx));
    expect(t).toContain(oldS);
    expect(t).toContain(newS);
    expect(t).toContain('replace_all=true');
  });
  it('MultiEdit renders the path and every edit (old/new per edit)', () => {
    const edits = [{ old_string: 'a1', new_string: 'b1' }, { old_string: `${'x'.repeat(2000)}tail2`, new_string: 'b2', replace_all: true }];
    const t = shown(composePermission(req('MultiEdit', { file_path: '/r/f.ts', edits }), ctx));
    expect(t).toContain('edit 1 of 2 on /r/f.ts');
    expect(t).toContain('edit 2 of 2 on /r/f.ts');
    for (const s of ['a1', 'b1', `${'x'.repeat(2000)}tail2`, 'b2', 'replace_all=true']) expect(t).toContain(s);
    expect(why(composePermission(req('MultiEdit', { file_path: '/r/f', edits: [{ old_string: 'a' }] }), ctx))).toBe('bad-input');
    expect(why(composePermission(req('MultiEdit', { file_path: '/r/f', edits: [] }), ctx))).toBe('bad-input');
  });
  it('NotebookEdit renders its cell source in full, with every other key', () => {
    const src = `import os\n${'y'.repeat(3000)}\nos.system("x")`;
    const t = shown(composePermission(req('NotebookEdit', { notebook_path: '/r/n.ipynb', new_source: src, cell_id: 'c1', edit_mode: 'replace' }), ctx));
    expect(t).toContain('os.system("x")');
    expect(t).toContain('y'.repeat(3000));
    expect(t).toContain('cell_id=c1');
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
