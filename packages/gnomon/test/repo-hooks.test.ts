/**
 * P8-D94 audited repo hooks — the kernel's extract (kernel/supervisor/repo-hooks.ts).
 * Strict parse, fail closed: refused hooks (U+2028, control characters,
 * unknown keys, non-command types) are listed by id only and never
 * approvable; a symlinked, oversized or unparseable layer makes the whole
 * set unreadable; the set hash moves when any hook changes. The end-to-end
 * half (cards, decisions, a hook actually running or not under the darwin
 * profile) is test/session-supervisor.test.ts.
 */
// @gnomon-platform: darwin, linux
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractRepoHooks, hooksBlock, MAX_REPO_HOOKS, MAX_SETTINGS_BYTES, mergeHooks, repoHookCard } from '../src/kernel/supervisor/repo-hooks.js';

let root = '';
afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = '';
});
function repo(settings?: unknown, local?: unknown): string {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-rh-')));
  fs.mkdirSync(path.join(root, '.claude'));
  if (settings !== undefined) fs.writeFileSync(path.join(root, '.claude', 'settings.json'), typeof settings === 'string' ? settings : JSON.stringify(settings));
  if (local !== undefined) fs.writeFileSync(path.join(root, '.claude', 'settings.local.json'), JSON.stringify(local));
  return root;
}
const one = (command: unknown, extra: Record<string, unknown> = {}) => ({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command, ...extra }] }] } });

describe('extractRepoHooks', () => {
  it('no layers / no hooks ⇒ none', () => {
    expect(extractRepoHooks([repo()]).status).toBe('none');
    expect(extractRepoHooks([repo({ permissions: {} })]).status).toBe('none');
  });
  it('project + local hooks are extracted with source, event, matcher; ids are stable', () => {
    const r = repo(one('echo a'), { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo b', timeout: 5 }] }] } });
    const s = extractRepoHooks([r]);
    expect(s.status).toBe('ok');
    if (s.status !== 'ok') return;
    expect(s.hooks.map((h) => [h.source, h.event, h.matcher, h.command, h.timeout]).sort()).toEqual([
      ['local', 'SessionStart', null, 'echo b', 5],
      ['project', 'PreToolUse', 'Bash', 'echo a', null],
    ]);
    expect(extractRepoHooks([r])).toEqual(s);
  });
  it.each([
    ['U+2028 in the command', one('echo a echo b')],
    ['U+2029 in the command', one('echo a ')],
    ['a BEL control character', one('echo a\u0007')],
    ['a newline', one('echo a\nrm -rf x')],
    ['a format character (RLO)', one('echo ‮gnp')],
    ['U+2028 in the matcher', { hooks: { PreToolUse: [{ matcher: 'Ba sh', hooks: [{ type: 'command', command: 'echo a' }] }] } }],
    ['an unknown hook key', one('echo a', { env: { X: '1' } })],
    ['a non-command type', { hooks: { PreToolUse: [{ hooks: [{ type: 'prompt', prompt: 'x' }] }] } }],
    ['a bad event name', { hooks: { 'Pre Tool': [{ hooks: [{ type: 'command', command: 'echo a' }] }] } }],
    ['a non-array group list', { hooks: { PreToolUse: { hooks: [{ type: 'command', command: 'echo a' }] } } }],
    ['a zero timeout', one('echo a', { timeout: 0 })],
  ])('%s ⇒ refused (by id only, never approvable)', (_n, doc) => {
    const s = extractRepoHooks([repo(doc)]);
    expect(s.status).toBe('ok');
    if (s.status !== 'ok') return;
    expect(s.hooks).toEqual([]);
    expect(s.refused).toHaveLength(1);
    expect(s.refused[0]).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
  it('a refused hook beside a good one: the good one stays approvable, the set hash covers both', () => {
    const doc = { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'echo ok' }, { type: 'command', command: 'echo bad' }] }] } };
    const s = extractRepoHooks([repo(doc)]);
    expect(s.status === 'ok' && s.hooks.map((h) => h.command)).toEqual(['echo ok']);
    expect(s.status === 'ok' && s.refused.length).toBe(1);
  });
  it('unparseable, not-an-object, oversized or symlinked layers ⇒ the whole set is unreadable (fail closed)', () => {
    expect(extractRepoHooks([repo('{nope')]).status).toBe('unreadable');
    expect(extractRepoHooks([repo('[1]')]).status).toBe('unreadable');
    expect(extractRepoHooks([repo({ hooks: [] })]).status).toBe('unreadable');
    expect(extractRepoHooks([repo(`{"x":"${'a'.repeat(MAX_SETTINGS_BYTES)}"}`)]).status).toBe('unreadable');
    const r = repo();
    const outside = path.join(r, 'elsewhere.json');
    fs.writeFileSync(outside, JSON.stringify(one('echo a')));
    fs.symlinkSync(outside, path.join(r, '.claude', 'settings.json'));
    expect(extractRepoHooks([r]).status).toBe('unreadable');
  });
  it(`more than ${MAX_REPO_HOOKS} hooks ⇒ too-many (none run; bounded)`, () => {
    const hooks = Array.from({ length: MAX_REPO_HOOKS + 1 }, (_, i) => ({ type: 'command', command: `echo ${i}` }));
    expect(extractRepoHooks([repo({ hooks: { PreToolUse: [{ hooks }] } })]).status).toBe('too-many');
  });
  it('the set hash moves when a hook changes, is added, or a refused one appears', () => {
    const h = (doc: unknown) => {
      const s = extractRepoHooks([repo(doc)]);
      fs.rmSync(root, { recursive: true, force: true });
      return s.setHash;
    };
    const base = h(one('echo a'));
    expect(h(one('echo a'))).toBe(base);
    expect(h(one('echo b'))).not.toBe(base);
    expect(h({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo a' }, { type: 'command', command: 'echo c' }] }] } })).not.toBe(base);
    expect(h({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo a' }, { type: 'command', command: 'x ' }] }] } })).not.toBe(base);
  });
});

describe('card + policy rendering', () => {
  it('the card: kernel count line first, the hook on its own never-cut line, detail inside contentHash', () => {
    const r = repo(one(`echo ${'y'.repeat(300)}`));
    const s = extractRepoHooks([r]);
    if (s.status !== 'ok') throw new Error('expected ok');
    const c = repoHookCard(s, s.hooks[0]!, r);
    expect(c.lines[0]).toBe('runs commands: repo hook 1 of 1');
    expect(c.detail).toMatchObject({ event: 'repo-hook', setHash: s.setHash, hookId: s.hooks[0]!.hookId, command: s.hooks[0]!.command });
    const text = (c.block.children as Array<{ text: string }>).map((x) => x.text.replace(/^ {2}↳ /, '')).join('');
    expect(text).toContain('y'.repeat(300)); // wrapped, never truncated
  });
  it('hooksBlock + mergeHooks: generated hooks first, approved repo hooks appended', () => {
    const s = extractRepoHooks([repo(one('echo a'))]);
    if (s.status !== 'ok') throw new Error('expected ok');
    const merged = mergeHooks({ PreToolUse: [{ hooks: [{ type: 'command', command: 'gnomon' }] }] }, hooksBlock(s.hooks));
    expect(merged.PreToolUse).toEqual([{ hooks: [{ type: 'command', command: 'gnomon' }] }, { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo a' }] }]);
  });
});
