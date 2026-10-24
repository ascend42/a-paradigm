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
import { CLAUDE_HOOK_EVENTS, extractRepoHooks, hooksBlock, MAX_REPO_HOOKS, MAX_SETTINGS_BYTES, mergeHooks, REPO_HOOK_WARNING, repoHookCard, TOOL_APPROVAL_WARNING, repoHookDecisionsFrom, type RepoHook } from '../src/kernel/supervisor/repo-hooks.js';

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
  it('round 2 (reviewer): the cap holds for NON-ARRAY event values too (every increment is checked)', () => {
    const hooks: Record<string, unknown> = {};
    for (let i = 0; i <= MAX_REPO_HOOKS; i++) hooks[`E${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`] = { not: 'an array' };
    expect(extractRepoHooks([repo({ hooks })]).status).toBe('too-many');
    // exactly at the cap: still a set, every entry refused (the refused list is bounded by the cap)
    const at: Record<string, unknown> = {};
    for (let i = 0; i < MAX_REPO_HOOKS; i++) at[`E${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`] = 1;
    fs.rmSync(root, { recursive: true, force: true });
    const s = extractRepoHooks([repo({ hooks: at })]);
    expect(s.status === 'ok' && s.refused.length).toBe(MAX_REPO_HOOKS);
  });
  it('Aegis C1: only the hook events Claude supports; constructor / __proto__ / toString are refused', () => {
    for (const ev of ['constructor', '__proto__', 'toString', 'NotAnEvent']) {
      const s = extractRepoHooks([repo({ hooks: { [ev]: [{ hooks: [{ type: 'command', command: 'echo a' }] }] } })]);
      fs.rmSync(root, { recursive: true, force: true });
      expect(s.status === 'ok' && s.hooks.length, ev).toBe(0);
    }
    for (const ev of CLAUDE_HOOK_EVENTS) {
      const s = extractRepoHooks([repo({ hooks: { [ev]: [{ hooks: [{ type: 'command', command: 'echo a' }] }] } })]);
      fs.rmSync(root, { recursive: true, force: true });
      expect(s.status === 'ok' && s.hooks.length, ev).toBe(1);
    }
  });
  it('Aegis C1: an approved hook named like an Object.prototype member never throws and stays an own key', () => {
    const h = (event: string): RepoHook => ({ hookId: `sha256:${'0'.repeat(64)}`, source: 'project', event, matcher: null, command: 'echo a', timeout: null });
    const b = hooksBlock([h('constructor'), h('__proto__'), h('hasOwnProperty')]);
    expect(Object.keys(b).sort()).toEqual(['__proto__', 'constructor', 'hasOwnProperty']);
    const m = mergeHooks(JSON.parse('{"__proto__":[1],"constructor":[2]}'), b);
    expect(Object.keys(m).sort()).toEqual(['__proto__', 'constructor', 'hasOwnProperty']);
    expect(JSON.parse(JSON.stringify(m)).constructor).toHaveLength(2);
  });
  it('reviewer: a worktree equal to cwd (by realpath) counts once', () => {
    const r = repo(one('echo a'));
    const link = `${r}-alias`;
    fs.symlinkSync(r, link);
    try {
      const a = extractRepoHooks([r]);
      const b = extractRepoHooks([r, link]);
      expect(b.setHash).toBe(a.setHash);
      expect(b.repoKey).toBe(a.repoKey);
    } finally {
      fs.rmSync(link, { force: true });
    }
  });
  it('Aegis L: a symlinked .claude dir makes the set unreadable (O_NOFOLLOW covers only the file itself)', () => {
    const r = repo();
    fs.rmSync(path.join(r, '.claude'), { recursive: true });
    const elsewhere = path.join(r, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(elsewhere, 'settings.json'), JSON.stringify(one('echo a')));
    fs.symlinkSync(elsewhere, path.join(r, '.claude'));
    expect(extractRepoHooks([r]).status).toBe('unreadable');
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
    // Aegis C2: the kernel's warning, on every card, before the decision line
    expect(c.lines).toContain(REPO_HOOK_WARNING);
    expect(REPO_HOOK_WARNING).toBe('approving trusts the command and every file it runs; a repo change, a pull, or a session edit can change what runs');
    expect(c.lines.indexOf(REPO_HOOK_WARNING)).toBeLessThan(c.lines.findIndex((l) => l.startsWith('allow:')));
    expect(c.detail).toMatchObject({ event: 'repo-hook', setHash: s.setHash, hookId: s.hooks[0]!.hookId, command: s.hooks[0]!.command });
    const text = (c.block.children as Array<{ text: string }>).map((x) => x.text.replace(/^ {2}↳ /, '')).join('');
    expect(text).toContain('y'.repeat(300)); // wrapped, never truncated
  });
  it('P8-D96: a PreToolUse or PermissionRequest hook card says it can approve tool uses with no card; other events do not', () => {
    for (const [event, warns] of [['PreToolUse', true], ['PermissionRequest', true], ['PostToolUse', false], ['UserPromptSubmit', false]] as const) {
      const s = extractRepoHooks([repo({ hooks: { [event]: [{ hooks: [{ type: 'command', command: 'echo a' }] }] } })]);
      if (s.status !== 'ok') throw new Error('expected ok');
      const lines = repoHookCard(s, s.hooks[0]!, root).lines;
      expect(lines.includes(TOOL_APPROVAL_WARNING), event).toBe(warns);
      fs.rmSync(root, { recursive: true, force: true });
    }
    expect(TOOL_APPROVAL_WARNING).toContain('can approve tool uses with no card');
  });
  it('hooksBlock + mergeHooks: generated hooks first, approved repo hooks appended', () => {
    const s = extractRepoHooks([repo(one('echo a'))]);
    if (s.status !== 'ok') throw new Error('expected ok');
    const merged = mergeHooks({ PreToolUse: [{ hooks: [{ type: 'command', command: 'gnomon' }] }] }, hooksBlock(s.hooks));
    expect(merged.PreToolUse).toEqual([{ hooks: [{ type: 'command', command: 'gnomon' }] }, { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo a' }] }]);
  });
});

describe('G-SUB-07 decisions are read back from KERNEL-signed rows only (reviewer)', () => {
  const K = { principal: 'p:abcdefgh/kernel', isKernelKey: (k: string) => k === 'key:kernel' };
  const row = (over: Record<string, unknown> = {}, p: Record<string, unknown> = {}) => ({ principal: K.principal, keyId: 'key:kernel', payload: { what: 'repo-hook', repoKey: 'rk', setHash: 'sh', hookId: 'h1', decision: 'allow', ...p }, ...over });
  it('a kernel-signed allow counts; the last decision per hook wins', () => {
    expect(repoHookDecisionsFrom([row()], K, 'rk', 'sh').get('h1')).toBe('allow');
    expect(repoHookDecisionsFrom([row(), row({}, { decision: 'deny' })], K, 'rk', 'sh').get('h1')).toBe('deny');
  });
  it('a forged decision from another principal, another key, no key, another set or an unknown decision is ignored', () => {
    for (const forged of [row({ principal: 'p:abcdefgh/founder' }), row({ principal: 'p:abcdefgh/s-1234' }), row({ keyId: 'key:device' }), row({ keyId: undefined }), row({}, { setHash: 'other' }), row({}, { repoKey: 'other' }), row({}, { decision: 'withdraw' }), row({}, { what: 'install' })]) {
      expect(repoHookDecisionsFrom([forged], K, 'rk', 'sh').size, JSON.stringify(forged)).toBe(0);
    }
    // a forged allow AFTER a real deny does not flip it
    expect(repoHookDecisionsFrom([row({}, { decision: 'deny' }), row({ principal: 'p:abcdefgh/founder' })], K, 'rk', 'sh').get('h1')).toBe('deny');
  });
});
