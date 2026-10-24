/**
 * Tests for the `paradigm skill` CLI (#skill-cli) — sync-global skip/force,
 * the three bundled seeds linting clean from templates/skills, list/lint/project
 * over a temp HOME, certify's TTY gate + happy path ($skill-certification), and
 * the silent PostToolUse `Skill` usage recorder (!skill-used).
 *
 * Real temp dirs, real paradigm-mcp skill modules. HOME is always a temp dir.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';

import {
  loadSkillFromDir,
  lintSkill,
  resolveSkill,
  skillKey,
  type SkillEnv,
} from '../../../../paradigm-mcp/src/utils/skill-loader.js';
import { readSkillUsage } from '../../../../paradigm-mcp/src/utils/skill-usage.js';
import { readClassroomCertifications } from '../../../../paradigm-mcp/src/utils/field-failures.js';

import { resolveBundledSkillsDir, skillSyncGlobalCommand } from './sync-global.js';
import {
  skillListCommand,
  skillLintCommand,
  skillProjectCommand,
  recordSkillUsageFromHook,
  skillAdoptCommand,
  skillImportCommand,
} from './index.js';
import { skillCertifyCommand, previewSkillScripts, CERTIFICATION_POSTURE } from './certify.js';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const SEEDS = ['a11y-audit', 'design-options-protocol', 'design-system-extract', 'ui-build-protocol', 'ui-critique-loop'];

let root: string;
let home: string;
let priorHome: string | undefined;
let output: string;
let priorProjectDir: string | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-cli-root-'));
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-cli-home-'));
  fs.mkdirSync(path.join(root, '.paradigm'), { recursive: true });
  priorHome = process.env.HOME;
  process.env.HOME = home;
  priorProjectDir = process.env.CLAUDE_PROJECT_DIR;
  delete process.env.CLAUDE_PROJECT_DIR;
  output = '';
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => { output += String(chunk); return true; }) as any);
  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => { output += String(chunk); return true; }) as any);
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (priorProjectDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
  else process.env.CLAUDE_PROJECT_DIR = priorProjectDir;
  if (priorHome === undefined) delete process.env.HOME;
  else process.env.HOME = priorHome;
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
  process.exitCode = undefined;
});

const bundledDir = (): string => {
  const d = resolveBundledSkillsDir();
  if (!d) throw new Error('bundled templates/skills not found');
  return d;
};

/** Stub the stewards' .agent files and every notebook the seeds cite, under the temp HOME. */
function stubSeedDependencies(): void {
  const agentsDir = path.join(home, '.paradigm', 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  for (const id of ['designer', 'a11y']) {
    fs.writeFileSync(path.join(agentsDir, `${id}.agent`), yaml.dump({ id, role: id, version: '1.0.0' }));
  }
  for (const seed of SEEDS) {
    const skill = loadSkillFromDir(path.join(bundledDir(), seed), 'bundled');
    for (const ref of skill.metadata.paradigm.notebooks ?? []) {
      const [agent, nb] = ref.split('/');
      const dir = path.join(home, '.paradigm', 'notebooks', agent);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${nb}.yaml`), yaml.dump({ id: nb, agentId: agent }));
    }
  }
}

describe('skill sync-global', () => {
  it('resolves the bundled templates dir with all bundled seeds', () => {
    const entries = fs.readdirSync(bundledDir()).sort();
    expect(entries).toEqual(SEEDS);
  });

  it('adds missing skills, skips existing ones, and --force overwrites', async () => {
    const globalDir = path.join(home, '.paradigm', 'skills');
    const first = await skillSyncGlobalCommand({});
    expect(first?.added.sort()).toEqual(SEEDS);
    expect(fs.existsSync(path.join(globalDir, 'a11y-audit', 'SKILL.md'))).toBe(true);

    // User customization survives a normal sync
    const custom = path.join(globalDir, 'a11y-audit', 'SKILL.md');
    fs.writeFileSync(custom, fs.readFileSync(custom, 'utf8') + '\nlocal note\n');
    const second = await skillSyncGlobalCommand({});
    expect(second?.added).toEqual([]);
    expect(second?.skipped.sort()).toEqual(SEEDS);
    expect(fs.readFileSync(custom, 'utf8')).toContain('local note');

    const forced = await skillSyncGlobalCommand({ force: true });
    expect(forced?.overwritten.sort()).toEqual(SEEDS);
    expect(fs.readFileSync(custom, 'utf8')).not.toContain('local note');
  });

  it('--dry-run writes nothing', async () => {
    const r = await skillSyncGlobalCommand({ dryRun: true });
    expect(r?.added.sort()).toEqual(SEEDS);
    expect(fs.existsSync(path.join(home, '.paradigm', 'skills'))).toBe(false);
  });
});

describe('bundled seeds', () => {
  it.each(SEEDS)('%s parses, is provisional/bundled, and lints clean', (seed) => {
    stubSeedDependencies();
    const skill = loadSkillFromDir(path.join(bundledDir(), seed), 'bundled');
    const m = skill.metadata.paradigm;
    expect(m.id).toBe(seed);
    expect(skill.name).toBe(seed);
    expect(m.trust).toBe('provisional');
    expect(m.provenance.source).toBe('bundled');
    expect(m.hosts).toEqual(['claude-code']);
    const env: SkillEnv = { rootDir: root, homedir: home };
    const issues = lintSkill(skill, env);
    expect(issues).toEqual([]);
  });

  it('bundled agent templates declare only bundled skills and drop migrated behaviors', () => {
    const agentsDir = path.join(bundledDir(), '..', 'agents');
    const designer = yaml.load(fs.readFileSync(path.join(agentsDir, 'designer.agent'), 'utf8')) as any;
    const a11y = yaml.load(fs.readFileSync(path.join(agentsDir, 'a11y.agent'), 'utf8')) as any;
    expect(designer.skills).toEqual([
      { id: 'design-system-extract', role: 'owns' },
      { id: 'ui-critique-loop', role: 'owns' },
      { id: 'ui-build-protocol', role: 'owns' },
      { id: 'design-options-protocol', role: 'owns' },
      { id: 'a11y-audit', role: 'uses' },
    ]);
    expect(a11y.skills).toEqual([{ id: 'a11y-audit', role: 'owns' }]);
    expect(Object.keys(designer.behaviors)).not.toContain('design-system-maintenance');
    expect(Object.keys(designer.behaviors)).not.toContain('review-checklist');
    expect(Object.keys(designer.behaviors)).not.toContain('ui-build-protocol');
    expect(Object.keys(designer.behaviors)).not.toContain('design-options-protocol');
    expect(Object.keys(designer.behaviors)).toEqual(['design-foundations', 'platform-awareness', 'tool-fluency', 'anti-patterns']);
  });
});

describe('skill list / lint / project (temp HOME)', () => {
  beforeEach(async () => {
    stubSeedDependencies();
    await skillSyncGlobalCommand({});
    output = '';
  });

  it('list shows the seeds as provisional + uncertified', async () => {
    await skillListCommand({ json: true, project: root });
    const parsed = JSON.parse(output);
    expect(parsed.skills.map((s: any) => s.id).sort()).toEqual(SEEDS);
    for (const s of parsed.skills) {
      expect(s.trust).toBe('provisional');
      expect(s.status).toBe('uncertified');
      expect(s.scope).toBe('global');
    }
  });

  it('list --agent filters by steward/declared skills', async () => {
    await skillListCommand({ json: true, agent: 'a11y', project: root });
    expect(JSON.parse(output).skills.map((s: any) => s.id)).toEqual(['a11y-audit']);
  });

  it('lint --all is clean', async () => {
    await skillLintCommand(undefined, { all: true, project: root });
    expect(process.exitCode).toBeUndefined();
    expect(output).toContain('a11y-audit@0.1.0 — clean');
  });

  it('project refuses a provisional skill without --allow-provisional', async () => {
    await skillProjectCommand('design-system-extract', { project: root });
    expect(process.exitCode).toBe(1);
    expect(output).toMatch(/refused \(untrusted\)/);
    expect(fs.existsSync(path.join(home, '.claude', 'skills', 'pdg-design-system-extract'))).toBe(false);
  });

  it('project --allow-provisional --dry-run reports without writing', async () => {
    await skillProjectCommand('design-system-extract', { allowProvisional: true, dryRun: true, project: root });
    expect(process.exitCode).toBeUndefined();
    expect(output).toMatch(/would project/);
    expect(fs.existsSync(path.join(home, '.claude', 'skills', 'pdg-design-system-extract'))).toBe(false);
  });

  it('project withholds scripts/ for a provisional skill and says so', async () => {
    const sdir = path.join(home, '.paradigm', 'skills', 'a11y-audit', 'scripts');
    fs.mkdirSync(sdir, { recursive: true });
    fs.writeFileSync(path.join(sdir, 'x.sh'), 'echo hi\n');
    await skillProjectCommand('a11y-audit', { allowProvisional: true, target: 'project', project: root });
    expect(process.exitCode).toBeUndefined();
    expect(output).toMatch(/scripts\/ withheld/);
    expect(fs.existsSync(path.join(root, '.claude', 'skills', 'pdg-a11y-audit', 'scripts'))).toBe(false);
  });

  it('project --allow-provisional writes a flat-metadata projection and usage is recorded from the hook payload', async () => {
    await skillProjectCommand('a11y-audit', { allowProvisional: true, target: 'project', project: root });
    expect(process.exitCode).toBeUndefined();
    const dest = path.join(root, '.claude', 'skills', 'pdg-a11y-audit');
    const md = fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8');
    expect(md).toMatch(/^---\nname: pdg-a11y-audit/);
    expect(md).toContain('PROVISIONAL — not certified.');

    const ok = recordSkillUsageFromHook({ tool_name: 'Skill', tool_input: { skill: 'pdg-a11y-audit' }, cwd: root }, { homedir: home });
    expect(ok).toBe(true);
    const rows = readSkillUsage(root);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ skillId: 'a11y-audit', version: '0.1.0', entryId: skillKey('a11y-audit', '0.1.0'), host: 'claude-code' });
  });
});

describe('id validation', () => {
  it('rejects path-traversal ids before touching the filesystem', async () => {
    await skillProjectCommand('../../etc', { project: root, allowProvisional: true });
    expect(process.exitCode).toBe(1);
    expect(output).toMatch(/Invalid skill id/);
  });
});

describe('recordSkillUsageFromHook', () => {
  it('prefers CLAUDE_PROJECT_DIR over the payload cwd', async () => {
    stubSeedDependencies();
    await skillSyncGlobalCommand({});
    await skillProjectCommand('a11y-audit', { allowProvisional: true, project: root });
    const sub = path.join(root, 'nested');
    fs.mkdirSync(path.join(sub, '.paradigm'), { recursive: true });
    process.env.CLAUDE_PROJECT_DIR = root;
    expect(recordSkillUsageFromHook({ tool_name: 'Skill', tool_input: { skill: 'pdg-a11y-audit' }, cwd: sub }, { homedir: home })).toBe(true);
    expect(readSkillUsage(root)).toHaveLength(1);
    expect(readSkillUsage(sub)).toHaveLength(0);
  });


  it('ignores non-Skill tools, non-projection names and garbage without throwing', () => {
    expect(recordSkillUsageFromHook({ tool_name: 'Read', tool_input: {}, cwd: root })).toBe(false);
    expect(recordSkillUsageFromHook({ tool_name: 'Skill', tool_input: { skill: 'archify' }, cwd: root })).toBe(false);
    expect(recordSkillUsageFromHook({ tool_name: 'Skill', tool_input: { skill: 'pdg-unknown' }, cwd: root }, { homedir: home })).toBe(false);
    expect(recordSkillUsageFromHook(null)).toBe(false);
    expect(recordSkillUsageFromHook('nonsense')).toBe(false);
  });
});

describe('skill certify', () => {
  const ID = 'a11y-audit';
  const KEY = skillKey(ID, '0.1.0');

  function writeScenario(over: Record<string, unknown> = {}): void {
    const dir = path.join(root, '.paradigm', 'curriculum', 'scenarios');
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(root, 'fixtures'), { recursive: true });
    fs.writeFileSync(path.join(root, 'fixtures', 'low-contrast-login.html'), '<input placeholder="x" style="color:#aaa">');
    fs.writeFileSync(path.join(dir, 'sc-a11y.scenario'), yaml.dump({
      id: 'sc-a11y',
      scenario: 'Low-contrast placeholder text planted in a login form',
      origin: 'authored',
      fixture: 'fixtures/low-contrast-login.html',
      probes: [{ agent: 'designer', learning_ref: KEY, claim: 'audit flags the 2.8:1 placeholder' }],
      expected: { must: 'survive' },
      outcome_history: [{ term: KEY, agent: 'designer', result: 'survived', assessor: 'founder', human_confirmed: true, at: '2026-09-28T00:00:00.000Z' }],
      repeat_failures: 0,
      status: 'active',
      ...over,
    }));
  }

  beforeEach(async () => {
    stubSeedDependencies();
    await skillSyncGlobalCommand({});
    output = '';
  });

  it('refuses without a TTY', async () => {
    writeScenario();
    const ok = await skillCertifyCommand(ID, { project: root }, { tty: false, founder: 'Matt', prompt: async () => ID, paradigmTools: [] });
    expect(ok).toBe(false);
    expect(process.exitCode).toBe(1);
    expect(output).toMatch(/interactive terminal/);
  });

  it('refuses when the only probe is the steward', async () => {
    writeScenario({ probes: [{ agent: 'a11y', learning_ref: KEY, claim: 'c' }] });
    const ok = await skillCertifyCommand(ID, { project: root }, { tty: true, founder: 'Matt', prompt: async () => ID, paradigmTools: [] });
    expect(ok).toBe(false);
    expect(output).toMatch(/peer probe/);
  });

  it('aborts when the typed confirmation does not match', async () => {
    writeScenario();
    const ok = await skillCertifyCommand(ID, { project: root }, { tty: true, founder: 'Matt', prompt: async () => 'nope', paradigmTools: [] });
    expect(ok).toBe(false);
    expect(resolveSkill(ID, { rootDir: root, homedir: home })!.metadata.paradigm.trust).toBe('provisional');
  });

  it('happy path writes the certification block and a kind:skill ledger row', async () => {
    writeScenario();
    const ok = await skillCertifyCommand(ID, { project: root, scenario: ['sc-a11y'] }, { tty: true, founder: 'Matt', prompt: async () => ID, paradigmTools: [] });
    expect(ok).toBe(true);
    const skill = resolveSkill(ID, { rootDir: root, homedir: home })!;
    expect(skill.metadata.paradigm.trust).toBe('certified');
    expect(skill.metadata.paradigm.certification).toMatchObject({ approvedBy: 'Matt', project: path.basename(root), scenarios: ['sc-a11y'] });
    const rows = readClassroomCertifications(root);
    expect(rows.at(-1)).toMatchObject({ kind: 'skill', entryId: KEY, approvedBy: 'Matt', certifiedBy: 'peer', outcome: 'pending' });
    // Ledger cross-check: the certified skill reads as `ok` from a DIFFERENT project (global ledger).
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-cli-other-'));
    fs.mkdirSync(path.join(other, '.paradigm'), { recursive: true });
    output = '';
    await skillListCommand({ json: true, project: other });
    fs.rmSync(other, { recursive: true, force: true });
    expect(JSON.parse(output).skills.find((x: any) => x.id === ID).status).toBe('ok');
  });

  it('refuses unknown --scenario ids', async () => {
    writeScenario();
    const ok = await skillCertifyCommand(ID, { project: root, scenario: ['nope'] }, { tty: true, founder: 'Matt', prompt: async () => ID, paradigmTools: [] });
    expect(ok).toBe(false);
    expect(output).toMatch(/not found: nope/);
  });
});

describe('certify — scripts preview + posture', () => {
  it('previewSkillScripts returns every scripts/ file with hash and first 20 lines', () => {
    const dir = path.join(root, 'sk');
    fs.mkdirSync(path.join(dir, 'scripts', 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'scripts', 'run.sh'), Array.from({ length: 30 }, (_, i) => `echo ${i}`).join('\n'));
    fs.writeFileSync(path.join(dir, 'scripts', 'sub', 'b.py'), 'print(1)\n');
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${yaml.dump({ name: 'sk', description: 'd', metadata: { paradigm: {
      id: 'sk', version: '0.1.0', steward: 'designer', trust: 'provisional', provenance: { source: 'authored', createdBy: 'designer' } } } })}---\nbody\n`);
    const list = previewSkillScripts(loadSkillFromDir(dir, 'project'));
    expect(list.map(s => s.name)).toEqual(['scripts/run.sh', 'scripts/sub/b.py']);
    expect(list[0].head).toHaveLength(20);
    expect(list[0].totalLines).toBe(30);
    expect(list[0].hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('shows scripts and the posture line before prompting', async () => {
    stubSeedDependencies();
    await skillSyncGlobalCommand({});
    const key = skillKey('a11y-audit', '0.1.0');
    const scDir = path.join(root, '.paradigm', 'curriculum', 'scenarios');
    fs.mkdirSync(scDir, { recursive: true });
    fs.writeFileSync(path.join(root, 'f.html'), '<p>fixture</p>');
    fs.writeFileSync(path.join(scDir, 'sc.scenario'), yaml.dump({
      id: 'sc', scenario: 's', origin: 'authored', fixture: 'f.html',
      probes: [{ agent: 'designer', learning_ref: key, claim: 'c' }], expected: { must: 'survive' },
      outcome_history: [{ term: key, agent: 'designer', result: 'survived', assessor: 'x', human_confirmed: true, at: 'x' }],
      repeat_failures: 0, status: 'active',
    }));
    fs.mkdirSync(path.join(home, '.paradigm', 'skills', 'a11y-audit', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(home, '.paradigm', 'skills', 'a11y-audit', 'scripts', 'contrast.sh'), '#!/bin/sh\necho contrast-check\n');
    let seenAtPrompt = '';
    await skillCertifyCommand('a11y-audit', { project: root }, {
      tty: true, founder: 'Matt', paradigmTools: [],
      prompt: async () => { seenAtPrompt = output; return 'no'; },
    });
    expect(seenAtPrompt).toContain('contrast.sh');
    expect(seenAtPrompt).toContain('echo contrast-check');
    expect(seenAtPrompt).toMatch(/sha256:[0-9a-f]{64}/);
    expect(seenAtPrompt).toContain(CERTIFICATION_POSTURE);
  });
});

describe('Skill PostToolUse hook script', () => {
  const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'scripts', 'claude-code-skill-used.sh');

  it('exits 0 silently when paradigm is not on PATH (no npx fallback)', () => {
    const r = spawnSync('sh', [script], {
      input: JSON.stringify({ tool_name: 'Skill', tool_input: { skill: 'pdg-a11y-audit' }, cwd: root }),
      env: { PATH: '/usr/bin:/bin', HOME: home },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    const code = fs.readFileSync(script, 'utf8').split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
    expect(code).not.toMatch(/npx/);
  });

  it('exits 0 for non-projection skills', () => {
    const r = spawnSync('sh', [script], { input: '{"tool_name":"Skill","tool_input":{"skill":"archify"}}', encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toBe('');
  });
});

describe('skill adopt — diff, allowed-tools guard, --force', () => {
  const ID = 'demo-adopt';
  const srcDir = (): string => path.join(root, '.paradigm', 'skills', ID);
  const destMd = (): string => path.join(root, '.claude', 'skills', `pdg-${ID}`, 'SKILL.md');

  beforeEach(async () => {
    stubSeedDependencies();
    fs.mkdirSync(srcDir(), { recursive: true });
    fs.writeFileSync(path.join(srcDir(), 'SKILL.md'), `---\n${yaml.dump({
      name: ID, description: 'Demo skill for adopt tests', 'allowed-tools': 'Read',
      metadata: { paradigm: { id: ID, version: '0.1.0', steward: 'designer', trust: 'provisional',
        provenance: { source: 'authored', createdBy: 'designer' } } },
    })}---\n# Demo\n\n1. Step one.\n2. Step two.\n3. Step three.\n`);
    await skillProjectCommand(ID, { project: root, target: 'project', allowProvisional: true });
    expect(process.exitCode).toBeUndefined();
    output = '';
  });

  function editDownstream(widen: boolean): void {
    let md = fs.readFileSync(destMd(), 'utf8');
    if (widen) md = md.replace('allowed-tools: Read', 'allowed-tools: Read Bash');
    fs.writeFileSync(destMd(), md + '4. Step four (downstream).\n');
  }

  it('shows the diff and adopts a non-widening edit', async () => {
    editDownstream(false);
    const ok = await skillAdoptCommand(ID, { project: root, target: 'project' }, { tty: false });
    expect(ok).toBe(true);
    expect(output).toMatch(/~ SKILL\.md/);
    expect(resolveSkill(ID, { rootDir: root, homedir: home })!.metadata.paradigm.version).toBe('0.1.1');
  });

  it('refuses widened allowed-tools without a TTY unless --confirm-allowed-tools', async () => {
    editDownstream(true);
    expect(await skillAdoptCommand(ID, { project: root, target: 'project' }, { tty: false })).toBe(false);
    expect(process.exitCode).toBe(1);
    expect(output).toMatch(/allowed-tools-widened/);
    expect(output).toMatch(/--confirm-allowed-tools/);
    expect(output).toMatch(/added: Bash/);
    expect(resolveSkill(ID, { rootDir: root, homedir: home })!.metadata.paradigm.version).toBe('0.1.0');

    process.exitCode = undefined;
    expect(await skillAdoptCommand(ID, { project: root, target: 'project', confirmAllowedTools: true }, { tty: false })).toBe(true);
    expect(resolveSkill(ID, { rootDir: root, homedir: home })!['allowed-tools']).toBe('Read Bash');
  });

  it('on a TTY, widened allowed-tools needs the typed id', async () => {
    editDownstream(true);
    expect(await skillAdoptCommand(ID, { project: root, target: 'project' }, { tty: true, prompt: async () => 'no' })).toBe(false);
    expect(await skillAdoptCommand(ID, { project: root, target: 'project' }, { tty: true, prompt: async () => ID })).toBe(true);
  });

  it('refuses when the source changed since projection unless --force', async () => {
    editDownstream(false);
    const md = path.join(srcDir(), 'SKILL.md');
    fs.writeFileSync(md, fs.readFileSync(md, 'utf8') + '\nSource-side edit.\n');
    expect(await skillAdoptCommand(ID, { project: root, target: 'project' }, { tty: false })).toBe(false);
    expect(output).toMatch(/source-changed/);
    expect(output).toMatch(/--force/);
    process.exitCode = undefined;
    expect(await skillAdoptCommand(ID, { project: root, target: 'project', force: true }, { tty: false })).toBe(true);
  });
});

describe('paradigm skill import (pack skills)', () => {
  function writePackSkill(): void {
    const pack = path.join(root, '.paradigm', 'university');
    const dir = path.join(pack, 'skills', 'trace-debug');
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(pack, 'pack.yaml'), yaml.dump({
      id: 'proj-pack', name: 'P', version: '1.0.0', schema_version: '2', tenant_kind: 'project',
      skills: [{ path: 'skills/trace-debug' }],
    }));
    const fm = { name: 'trace-debug', description: 'Trace debugging', 'allowed-tools': 'Read Bash',
      metadata: { paradigm: { id: 'trace-debug', version: '1.0.0', steward: 'designer', trust: 'certified',
        provenance: { source: 'authored', createdBy: 'pack-author' } } } };
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${yaml.dump(fm)}---\n# T\n1. a\n2. b\n3. c\n`);
    fs.writeFileSync(path.join(dir, 'scripts', 'run.sh'), 'echo hi\n');
  }

  it('refuses when not on a TTY and writes nothing', async () => {
    writePackSkill();
    const ok = await skillImportCommand('proj-pack:trace-debug', { project: root }, { tty: false, homedir: home });
    expect(ok).toBe(false);
    expect(process.exitCode).toBe(1);
    expect(fs.existsSync(path.join(root, '.paradigm', 'skills', 'trace-debug'))).toBe(false);
  });

  it('shows allowed-tools + scripts, requires the typed id, then writes provisional with source pack', async () => {
    writePackSkill();
    let asked = '';
    const no = await skillImportCommand('proj-pack:trace-debug', { project: root }, {
      tty: true, homedir: home, prompt: async q => { asked = q; return 'wrong'; },
    });
    expect(no).toBe(false);
    expect(asked).toContain('trace-debug');
    expect(output).toContain('Read Bash');
    expect(output).toContain('scripts/run.sh');
    const ok = await skillImportCommand('proj-pack:trace-debug', { project: root }, {
      tty: true, homedir: home, prompt: async () => 'trace-debug',
    });
    expect(ok).toBe(true);
    const imported = loadSkillFromDir(path.join(root, '.paradigm', 'skills', 'trace-debug'), 'project');
    expect(imported.metadata.paradigm.trust).toBe('provisional');
    expect(imported.metadata.paradigm.provenance.source).toBe('pack');
  });

  it('list shows pack scope', async () => {
    writePackSkill();
    await skillListCommand({ project: root });
    expect(output).toContain('pack:proj-pack');
  });

  it('rejects a malformed ref', async () => {
    expect(await skillImportCommand('no-colon', { project: root }, { tty: true, homedir: home })).toBe(false);
    expect(process.exitCode).toBe(1);
  });
});
