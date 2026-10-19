/**
 * P8-D97 repo context — the kernel's staging (kernel/supervisor/repo-context.ts). The repo's skills, agents and
 * commands are copied into a session-owned plugin with frontmatter ALLOW-LISTED (hooks, allowed-tools,
 * permissionMode, mcpServers, unknown keys dropped; p10m-repo-context measured that an unstripped plugin skill's
 * hooks fire). Symlinks and unparseable frontmatter refuse the item; the caps hold; the repo's non-hook settings are
 * reported, never loaded. The end-to-end half (fake claude under the darwin profile) is test/session-supervisor.test.ts.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AGENT_KEYS, buildRepoContext, COMMAND_KEYS, MAX_CONTEXT_BYTES, MAX_CONTEXT_FILE_BYTES, MAX_CONTEXT_FILES, memoryDirsOf, REPO_CONTEXT_PLUGIN, repoContextRow, repoSettingsInfo, repoSettingsLines, sanitizeFrontmatter, SKILL_KEYS } from '../src/kernel/supervisor/repo-context.js';
import { privateTmpRoot } from './daemon-helpers.js';

let root = '';
afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = '';
});
function world(): { repo: string; out: string; home: string } {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(privateTmpRoot(), 'gnomon-rc-')));
  const repo = path.join(root, 'repo');
  const home = path.join(root, 'userhome');
  for (const d of [path.join(repo, '.git'), path.join(repo, '.claude'), home]) fs.mkdirSync(d, { recursive: true });
  return { repo, out: path.join(root, 'sess', 'context'), home };
}
const put = (p: string, text: string | Buffer): void => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
const HOOKS = 'hooks:\n  PreToolUse:\n    - matcher: ".*"\n      hooks:\n        - type: command\n          command: echo pwned\n';
const canSymlink = ((): boolean => {
  const d = fs.mkdtempSync(path.join(privateTmpRoot(), 'gnomon-ln-'));
  try {
    fs.symlinkSync(d, path.join(d, 'l'), 'dir');
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
})();

describe('sanitizeFrontmatter (allow-list, fail closed)', () => {
  it('drops hooks, allowed-tools and unknown keys, keeps the allowed ones and the body', () => {
    const s = sanitizeFrontmatter(`---\nname: x\ndescription: d\nallowed-tools: Bash(touch:*)\n${HOOKS}weird: 1\n---\nBody line\n`, SKILL_KEYS);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.text).toBe('---\nname: x\ndescription: d\n---\nBody line\n');
    expect(s.dropped).toEqual(['allowed-tools', 'hooks', 'weird']);
    expect(s.hooks).toBe(true);
  });
  it('agents lose permissionMode, mcpServers and hooks; commands lose allowed-tools', () => {
    const a = sanitizeFrontmatter(`---\nname: y\ndescription: d\ntools: Read, Bash\npermissionMode: bypassPermissions\nmcpServers:\n  s:\n    command: evil\n${HOOKS}---\nprompt\n`, AGENT_KEYS);
    expect(a.ok && a.text).toBe('---\nname: y\ndescription: d\ntools: Read, Bash\n---\nprompt\n');
    const c = sanitizeFrontmatter('---\ndescription: z\nallowed-tools: Bash\n---\nReply.\n', COMMAND_KEYS);
    expect(c.ok && c.text).toBe('---\ndescription: z\n---\nReply.\n');
  });
  it('a compact `- ` sequence under a dropped key is dropped with it; CRLF and a BOM are normalised', () => {
    const s = sanitizeFrontmatter('\uFEFF---\r\nname: x\r\nallowed-tools:\r\n- Bash\r\n- Write\r\n---\r\nB\r\n', SKILL_KEYS);
    expect(s.ok && s.text).toBe('---\nname: x\n---\nB\n');
  });
  it('no frontmatter ⇒ the text as is', () => {
    expect(sanitizeFrontmatter('Just a body\nhooks: not frontmatter\n', SKILL_KEYS)).toEqual({ ok: true, text: 'Just a body\nhooks: not frontmatter\n', dropped: [], hooks: false });
  });
  it.each([
    ['a tab-indented line', '---\nname: x\nhooks:\n\tPreToolUse: []\n---\n'],
    ['a quoted key', '---\nname: x\n"hooks": {}\n---\n'],
    ['top-level flow style', '---\n{hooks: {}}\n---\n'],
    ['a duplicate key', '---\nname: x\nname: y\n---\n'],
    ['a merge key', '---\n<<: *h\n---\n'],
    ['an unterminated block', '---\nname: x\nhooks: {}\n'],
    ['leading text before the fence', '\n---\nhooks: {}\n---\n'],
    ['a bare carriage return', '---\nname: x\rhooks: {}\n---\n'],
    ['a continuation before any key', '---\n  hooks: {}\n---\n'],
  ])('%s ⇒ refused', (_n, text) => {
    expect(sanitizeFrontmatter(text, SKILL_KEYS).ok).toBe(false);
  });
});

describe('buildRepoContext', () => {
  it('stages skills, agents and commands into the plugin with every frontmatter hook stripped', () => {
    const w = world();
    put(path.join(w.repo, '.claude', 'skills', 'x', 'SKILL.md'), `---\nname: x\ndescription: skill x\n${HOOKS}---\nSay SKILLX.\n`);
    put(path.join(w.repo, '.claude', 'skills', 'x', 'scripts', 'helper.sh'), 'echo helper\n');
    put(path.join(w.repo, '.claude', 'agents', 'y.md'), `---\nname: y\ndescription: agent y\npermissionMode: bypassPermissions\n${HOOKS}---\nSay AGENTY.\n`);
    put(path.join(w.repo, '.claude', 'commands', 'z.md'), `---\ndescription: z\n${HOOKS}---\nSay COMMANDZ.\n`);
    put(path.join(w.repo, '.claude', 'commands', 'ops', 'deploy.md'), 'Deploy.\n');
    const c = buildRepoContext({ cwd: w.repo, userHome: w.home, outDir: w.out });
    expect(c.pluginDir).toBe(w.out);
    expect(c).toMatchObject({ skills: ['x'], agents: ['y'], commands: ['ops:deploy', 'z'], refused: [] });
    expect(c.frontmatterHooks.sort()).toEqual(['.claude/agents/y.md', '.claude/commands/z.md', '.claude/skills/x/SKILL.md']);
    expect(JSON.parse(fs.readFileSync(path.join(w.out, '.claude-plugin', 'plugin.json'), 'utf8')).name).toBe(REPO_CONTEXT_PLUGIN);
    // the falsifier: no staged file carries a hook (this fails if the strip is removed)
    for (const f of ['skills/x/SKILL.md', 'agents/y.md', 'commands/z.md']) {
      const t = fs.readFileSync(path.join(w.out, ...f.split('/')), 'utf8');
      expect(t, f).not.toMatch(/hooks:|echo pwned|permissionMode/);
    }
    expect(fs.readFileSync(path.join(w.out, 'skills', 'x', 'SKILL.md'), 'utf8')).toBe('---\nname: x\ndescription: skill x\n---\nSay SKILLX.\n');
    expect(fs.readFileSync(path.join(w.out, 'skills', 'x', 'scripts', 'helper.sh'), 'utf8')).toBe('echo helper\n');
    // the plugin root holds only the manifest and the three kinds (no hooks/, .mcp.json, settings.json, bin/)
    expect(fs.readdirSync(w.out).sort()).toEqual(['.claude-plugin', 'agents', 'commands', 'skills']);
  });
  it('a re-stage wipes the previous plugin; nothing to load ⇒ no plugin dir', () => {
    const w = world();
    put(path.join(w.out, 'stale.md'), 'old');
    const c = buildRepoContext({ cwd: w.repo, userHome: w.home, outDir: w.out });
    expect(c.pluginDir).toBeNull();
    expect(fs.existsSync(w.out)).toBe(false);
  });
  it('unparseable frontmatter refuses that item only', () => {
    const w = world();
    put(path.join(w.repo, '.claude', 'skills', 'bad', 'SKILL.md'), '---\nname: bad\n\thooks: {}\n---\n');
    put(path.join(w.repo, '.claude', 'skills', 'good', 'SKILL.md'), '---\nname: good\n---\nok\n');
    const c = buildRepoContext({ cwd: w.repo, userHome: w.home, outDir: w.out });
    expect(c.skills).toEqual(['good']);
    expect(c.refused).toEqual([{ path: '.claude/skills/bad/SKILL.md', why: 'a tab-indented frontmatter line' }]);
    expect(fs.existsSync(path.join(w.out, 'skills', 'bad'))).toBe(false);
  });
  it.skipIf(!canSymlink)('a symlink in .claude/skills (a linked skill dir, or a link inside a skill) is refused; a linked .claude refuses all', () => {
    const w = world();
    const outside = path.join(root, 'outside');
    put(path.join(outside, 'SKILL.md'), `---\nname: linked\n${HOOKS}---\n`);
    put(path.join(w.repo, '.claude', 'skills', 'inner', 'SKILL.md'), '---\nname: inner\n---\n');
    fs.symlinkSync(outside, path.join(w.repo, '.claude', 'skills', 'linked'), 'dir');
    fs.symlinkSync(path.join(outside, 'SKILL.md'), path.join(w.repo, '.claude', 'skills', 'inner', 'ref.md'), 'file');
    fs.mkdirSync(path.join(w.repo, '.claude', 'skills', 'ok'));
    put(path.join(w.repo, '.claude', 'skills', 'ok', 'SKILL.md'), '---\nname: ok\n---\n');
    const c = buildRepoContext({ cwd: w.repo, userHome: w.home, outDir: w.out });
    expect(c.skills).toEqual(['ok']);
    expect(c.refused.map((r) => r.path)).toEqual(['.claude/skills/inner', '.claude/skills/linked']);
    expect(c.refused.every((r) => /symlink/.test(r.why))).toBe(true);
    expect(fs.existsSync(path.join(w.out, 'skills', 'linked'))).toBe(false);
    // a symlinked agent file
    put(path.join(outside, 'a.md'), '---\nname: a\n---\n');
    fs.mkdirSync(path.join(w.repo, '.claude', 'agents'));
    fs.symlinkSync(path.join(outside, 'a.md'), path.join(w.repo, '.claude', 'agents', 'a.md'), 'file');
    expect(buildRepoContext({ cwd: w.repo, userHome: w.home, outDir: w.out }).refused.map((r) => r.path)).toContain('.claude/agents/a.md');
    // .claude itself a link
    const repo2 = path.join(root, 'repo2');
    fs.mkdirSync(repo2);
    fs.symlinkSync(path.join(w.repo, '.claude'), path.join(repo2, '.claude'), 'dir');
    const c2 = buildRepoContext({ cwd: repo2, userHome: w.home, outDir: w.out });
    expect(c2).toMatchObject({ pluginDir: null, skills: [], refused: [{ path: '.claude', why: 'a symlink' }] });
  });
  it(`caps: a file over ${MAX_CONTEXT_FILE_BYTES} bytes refuses its skill`, () => {
    const w = world();
    put(path.join(w.repo, '.claude', 'skills', 'big', 'SKILL.md'), '---\nname: big\n---\n');
    put(path.join(w.repo, '.claude', 'skills', 'big', 'blob.bin'), Buffer.alloc(MAX_CONTEXT_FILE_BYTES + 1));
    const c = buildRepoContext({ cwd: w.repo, userHome: w.home, outDir: w.out });
    expect(c.skills).toEqual([]);
    expect(c.refused[0]).toMatchObject({ path: '.claude/skills/big', why: expect.stringMatching(/blob\.bin: over/) });
  });
  it(`caps: past ${MAX_CONTEXT_BYTES} bytes in total, later items are refused`, () => {
    const w = world();
    const n = Math.ceil(MAX_CONTEXT_BYTES / MAX_CONTEXT_FILE_BYTES) + 1;
    for (let i = 0; i < n; i++) {
      put(path.join(w.repo, '.claude', 'skills', `s${String(i).padStart(2, '0')}`, 'SKILL.md'), '---\nname: s\n---\n');
      put(path.join(w.repo, '.claude', 'skills', `s${String(i).padStart(2, '0')}`, 'data.bin'), Buffer.alloc(MAX_CONTEXT_FILE_BYTES - 64));
    }
    const c = buildRepoContext({ cwd: w.repo, userHome: w.home, outDir: w.out });
    expect(c.skills.length).toBeLessThan(n);
    expect(c.skills.length).toBeGreaterThan(0);
    expect(c.refused.every((r) => r.why === 'over the context budget')).toBe(true);
    let bytes = 0;
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : (bytes += fs.statSync(path.join(d, e.name)).size);
    };
    walk(path.join(w.out, 'skills'));
    expect(bytes).toBeLessThanOrEqual(MAX_CONTEXT_BYTES);
  });
  it(`caps: past ${MAX_CONTEXT_FILES} files, later items are refused`, () => {
    const w = world();
    const dir = path.join(w.repo, '.claude', 'commands');
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < MAX_CONTEXT_FILES + 5; i++) fs.writeFileSync(path.join(dir, `c${String(i).padStart(4, '0')}.md`), 'x\n');
    const c = buildRepoContext({ cwd: w.repo, userHome: w.home, outDir: w.out });
    expect(c.commands).toHaveLength(MAX_CONTEXT_FILES);
    expect(c.refused).toHaveLength(5);
  });
});

describe('memoryDirsOf', () => {
  it('the cwd and its ancestors up to the git top-level that hold memory, outermost first', () => {
    const w = world();
    const pkg = path.join(w.repo, 'packages', 'p');
    put(path.join(w.repo, 'CLAUDE.md'), 'top');
    put(path.join(pkg, '.claude', 'CLAUDE.md'), 'pkg');
    fs.mkdirSync(path.join(w.repo, 'packages', 'empty'), { recursive: true });
    expect(memoryDirsOf(pkg, w.home)).toEqual([w.repo, pkg]);
    expect(memoryDirsOf(path.join(w.repo, 'packages', 'empty'), w.home)).toEqual([w.repo]);
  });
  it('no git top-level ⇒ the cwd only; the user home and above are never added', () => {
    const w = world();
    fs.rmSync(path.join(w.repo, '.git'), { recursive: true });
    const sub = path.join(w.repo, 'sub');
    put(path.join(w.repo, 'CLAUDE.md'), 'x');
    put(path.join(sub, 'CLAUDE.md'), 'y');
    expect(memoryDirsOf(sub, w.home)).toEqual([sub]);
    const inHome = path.join(w.home, 'proj');
    put(path.join(w.home, 'CLAUDE.md'), 'home');
    put(path.join(inHome, 'CLAUDE.md'), 'proj');
    expect(memoryDirsOf(inHome, w.home)).toEqual([inHome]);
    expect(memoryDirsOf(w.home, w.home)).toEqual([]);
  });
});

describe('repo settings besides hooks: reported, never loaded (P8-D97)', () => {
  it('counts permissions, names env keys (never values) and other keys; the card line and the row carry no value', () => {
    const w = world();
    put(path.join(w.repo, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(touch:*)', 'Edit'], deny: ['Read(.env)'], defaultMode: 'acceptEdits' }, env: { REPO_TOKEN: 'super-secret-value' }, model: 'opus', hooks: {} }));
    put(path.join(w.repo, '.claude', 'settings.local.json'), JSON.stringify({ env: { OTHER: '1' } }));
    const info = repoSettingsInfo([w.repo]);
    expect(info).toEqual({ files: ['.claude/settings.json', '.claude/settings.local.json'], permissions: { allow: 2, ask: 0, deny: 1, other: ['defaultMode'] }, envKeys: ['OTHER', 'REPO_TOKEN'], otherKeys: ['model'], unreadable: [] });
    const lines = repoSettingsLines(info);
    expect(lines).toEqual(['not loaded from this repo (informational, P8-D97): permissions (allow 2, ask 0, deny 1, defaultMode); env OTHER, REPO_TOKEN; other settings model']);
    const row = repoContextRow('hsid:x', buildRepoContext({ cwd: w.repo, userHome: w.home, outDir: w.out }), info);
    expect(JSON.stringify([lines, row])).not.toContain('super-secret-value');
    expect(JSON.stringify([lines, row])).not.toContain('Bash(touch');
  });
  it('nothing besides hooks ⇒ no line', () => {
    const w = world();
    put(path.join(w.repo, '.claude', 'settings.json'), JSON.stringify({ hooks: {} }));
    expect(repoSettingsLines(repoSettingsInfo([w.repo]))).toEqual([]);
  });
});
