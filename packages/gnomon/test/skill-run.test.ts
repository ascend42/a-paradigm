/**
 * G-LCL-29 (slice C6'a2-2, "/" skills; kernel/supervisor/skill-run.ts): the listing of the kernel's STAGED skills
 * (refused, `user-invocable: false` and unsupported names listed loaded:false with a why), the args check (4 KiB, NFC,
 * badText, one line, no !` and no ```!), the template (staged body only, frontmatter stripped, the kernel's first line,
 * $ARGUMENTS replaced once by split/join so `$&` comes through literally) and the slash probe (a canary in a kernel
 * scratch dir, cached by the binary's sha256, a failed probe means the template).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildRepoContext } from '../src/kernel/supervisor/repo-context.js';
import { frontmatterOf, listSkills, nativeSkillText, readStagedSkill, skillArgsRefusal, skillBody, skillTemplate, SKILL_ARGS_MAX_BYTES, SlashSkillsProbe, SLASH_CANARY_SKILL, type SlashProbeInput } from '../src/kernel/supervisor/skill-run.js';

let root: string | null = null;
afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = null;
});

function repo(skills: Record<string, string>): { cwd: string; home: string; out: string } {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-skill-')));
  const cwd = path.join(root, 'repo');
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(cwd, '.git'), { recursive: true });
  fs.mkdirSync(home);
  for (const [rel, text] of Object.entries(skills)) {
    const f = path.join(cwd, '.claude', 'skills', rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
  return { cwd, home, out: path.join(root, 'sess', 'context') };
}

describe('G-LCL-29 skills.list reads the staged copy', () => {
  it('lists loaded skills with their description and hint; refused, not user-invocable and unsupported names are loaded:false with a why', () => {
    const w = repo({
      'deploy/SKILL.md': '---\nname: deploy\ndescription: Ship it\nargument-hint: "[env]"\nallowed-tools: Bash\n---\nDeploy to $ARGUMENTS.\n',
      'hidden/SKILL.md': '---\nname: hidden\nuser-invocable: false\n---\nInternal.\n',
      'shell/SKILL.md': '---\nname: shell\n---\nRun !`rm -rf /`\n',
      'Upper/SKILL.md': 'No frontmatter.\n',
      'notes/README.txt': 'not a skill dir',
    });
    const ctx = buildRepoContext({ cwd: w.cwd, userHome: w.home, outDir: w.out, skillsOnly: true });
    expect(ctx.agents).toEqual([]);
    expect(ctx.memoryDirs).toEqual([]);
    const listed = listSkills({ dir: ctx.pluginDir, ctx });
    expect(listed.map((x) => [x.name, x.loaded])).toEqual([['Upper', false], ['deploy', true], ['hidden', false], ['shell', false]]);
    expect(listed.find((x) => x.name === 'deploy')).toMatchObject({ description: 'Ship it', argumentHint: '[env]' });
    expect(listed.find((x) => x.name === 'hidden')!.why).toMatch(/user-invocable/);
    expect(listed.find((x) => x.name === 'shell')!.why).toMatch(/shell preprocessing/);
    expect(listed.find((x) => x.name === 'Upper')!.why).toMatch(/lowercase/);
    // the staged copy lost allowed-tools (P8-D97): the template never sees it
    expect(readStagedSkill(ctx.pluginDir, 'deploy')!.text).not.toMatch(/allowed-tools/);
  });

  it('no staged dir lists nothing loaded', () => {
    expect(listSkills({ dir: null, ctx: { skills: ['x'], refused: [] } })).toEqual([{ name: 'x', loaded: false, why: 'its staged copy could not be read' }]);
  });
});

describe('G-LCL-29 skill args', () => {
  it.each([
    ['', null],
    ['prod --fast', null],
    ['x'.repeat(SKILL_ARGS_MAX_BYTES), null],
    ['x'.repeat(SKILL_ARGS_MAX_BYTES + 1), /over 4096 bytes/],
    ['é'.repeat(2049), /over 4096 bytes/],
    ['two\nlines', /one line/],
    ['cr\r', /one line/],
    ['ls x', /one line/],
    ['é', /NFC/],
    ['zero​width', /format/],
    ['bell\u0007', /one line|control/],
    ['run !`id`', /!`/],
    ['```!', /!`|```!/],
  ])('%j', (args, want) => {
    const r = skillArgsRefusal(args);
    if (want === null) expect(r).toBeNull();
    else expect(r).toMatch(want);
  });
  it('a non-string is refused', () => {
    expect(skillArgsRefusal({ a: 1 })).toMatch(/string/);
  });
});

describe('G-LCL-29 the template', () => {
  const staged = '---\nname: deploy\ndescription: Ship it\n---\nDeploy to $ARGUMENTS now.\nThen tell me about $ARGUMENTS.\n@CLAUDE.md is not inlined.\n';
  it('the kernel first line, the body only, $ARGUMENTS replaced once and `$&` / `$1` / $ARGUMENTS in args literal', () => {
    const t = skillTemplate({ name: 'deploy', sha: 'a'.repeat(64), body: skillBody(staged), args: '$& $1 $ARGUMENTS $$' });
    const lines = t.split('\n');
    expect(lines[0]).toBe(`The human ran repo skill deploy (from .claude/skills/deploy/SKILL.md, sha ${'a'.repeat(12)}).`);
    expect(t).not.toMatch(/description: Ship it/);
    expect(t).not.toMatch(/^---$/m);
    expect(lines).toContain('Deploy to $& $1 $ARGUMENTS $$ now.');
    expect(lines).toContain('Then tell me about $& $1 $ARGUMENTS $$.');
    expect(lines).toContain('@CLAUDE.md is not inlined.');
    expect(t.split('$ARGUMENTS').length - 1).toBe(2); // only the two the args brought, never re-substituted
  });
  it('a body without the placeholder gets an ARGUMENTS line; none when the args are empty', () => {
    expect(skillTemplate({ name: 'x', sha: 'b'.repeat(64), body: 'Just do it.\n', args: 'now' }).split('\n').slice(-1)[0]).toBe('ARGUMENTS: now');
    expect(skillTemplate({ name: 'x', sha: 'b'.repeat(64), body: 'Just do it.\n', args: '' })).not.toMatch(/ARGUMENTS/);
  });
  it('the staged file name keeps its case in the first line; frontmatterOf reads block scalars', () => {
    expect(skillTemplate({ name: 'x', file: 'skill.md', sha: 'c'.repeat(64), body: 'b', args: '' })).toMatch(/^The human ran repo skill x \(from \.claude\/skills\/x\/skill\.md, sha c{12}\)\./);
    expect(frontmatterOf('---\ndescription: >\n  two\n  lines\nuser-invocable: "false"\n---\nbody')).toMatchObject({ description: 'two lines', 'user-invocable': 'false' });
  });
  it('the native text is the namespaced plugin command', () => {
    expect(nativeSkillText('deploy', 'prod')).toBe('/project:deploy prod');
    expect(nativeSkillText('deploy', '')).toBe('/project:deploy');
  });
});

describe('G-LCL-29 the slash probe', () => {
  const SHA = 'd'.repeat(64);
  it('runs the canary in a kernel scratch dir under the home, caches by the binary sha (also across restarts), joins concurrent asks', async () => {
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-probe-')));
    const seen: SlashProbeInput[] = [];
    const run = async (i: SlashProbeInput) => {
      seen.push(i);
      const skill = fs.readFileSync(path.join(i.pluginDir, 'skills', SLASH_CANARY_SKILL, 'SKILL.md'), 'utf8');
      expect(skill).toContain(i.nonce);
      expect(JSON.parse(fs.readFileSync(path.join(i.pluginDir, '.claude-plugin', 'plugin.json'), 'utf8')).name).toBe('project');
      return true;
    };
    const p = new SlashSkillsProbe({ home: root, run });
    const [a, b] = await Promise.all([p.native({ exec: '/x/claude', sha256: SHA }), p.native({ exec: '/x/claude', sha256: `sha256:${SHA}` })]);
    expect([a, b]).toEqual([true, true]);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.scratch.startsWith(path.join(root, 'probes', 'slash-skills') + path.sep)).toBe(true);
    expect(seen[0]!.text).toBe(`/project:${SLASH_CANARY_SKILL}`);
    expect(fs.existsSync(seen[0]!.scratch)).toBe(false); // the scratch is removed
    // a new instance (a daemon restart) reads the cache: no second probe
    const again = new SlashSkillsProbe({ home: root, run: async () => { throw new Error('never probed again'); } });
    expect(again.cached(SHA)).toBe(true);
    expect(await again.native({ exec: '/x/claude', sha256: SHA })).toBe(true);
  });
  it('a failing probe means the template: false is cached, a throw is not; no runner probes nothing', async () => {
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-probe-')));
    expect(await new SlashSkillsProbe({ home: root }).native({ exec: '/x', sha256: SHA })).toBe(false);
    let calls = 0;
    const throws = new SlashSkillsProbe({ home: root, run: async () => { calls++; throw new Error('spawn failed'); } });
    expect(await throws.native({ exec: '/x', sha256: SHA })).toBe(false);
    expect(await throws.native({ exec: '/x', sha256: SHA })).toBe(false);
    expect(calls).toBe(2);
    expect(throws.cached(SHA)).toBeUndefined();
    const no = new SlashSkillsProbe({ home: root, run: async () => { calls++; return false; } });
    expect(await no.native({ exec: '/x', sha256: SHA })).toBe(false);
    expect(await no.native({ exec: '/x', sha256: SHA })).toBe(false);
    expect(calls).toBe(3);
    expect(no.cached(SHA)).toBe(false);
    // another binary is probed on its own
    expect(no.cached('e'.repeat(64))).toBeUndefined();
    expect(await no.native({ exec: '/x', sha256: 'not-a-sha' })).toBe(false);
  });
});
