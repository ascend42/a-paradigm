/**
 * v7.11 — pack skill scope (#skill-loader, #skill-projector).
 *
 * Pack skills (pack.yaml v2 `skills:`) resolve as the lowest-precedence,
 * read-only scope `pack` (project › global › pack), are ALWAYS trust external,
 * never project, and leave the pack scope only via importPackSkill (provisional,
 * provenance.source pack). Tmp root + injected homedir — the real home is never touched.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import {
  resolveSkill,
  listSkillsDetailed,
  listPackSkills,
  lintSkill,
  hasLintErrors,
  importPackSkill,
  findPackSkill,
  envPackSkillDirs,
  loadSkillFromDir,
  resolveAgentSkills,
  computeContentHash,
  type SkillEnv,
} from './skill-loader.js';
import { projectSkill, adoptSkill } from './skill-projector.js';
import { buildProfileEnrichment } from './agent-loader.js';
import type { AgentProfile } from '../types/agents.js';

let tmp: string;
let home: string;
let root: string;
let packRoot: string;
let env: SkillEnv;

const BODY = ['# Trace', '', '1. Reproduce the failure.', '2. Bisect the trace.', '3. Report the root cause.', ''].join('\n');

function writeSkillDir(dir: string, id: string, paradigm: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): string {
  fs.mkdirSync(dir, { recursive: true });
  const fm = {
    name: id,
    description: `The ${id} skill`,
    ...extra,
    metadata: {
      paradigm: {
        id, version: '1.2.0', steward: 'designer', trust: 'certified',
        provenance: { source: 'authored', createdBy: 'pack-author' },
        certification: { approvedBy: 'x', approvedAt: '2026-01-01', project: 'p', scenarios: ['s'], contentHash: 'sha256:00' },
        ...paradigm,
      },
    },
  };
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${yaml.dump(fm)}---\n${BODY}`);
  return dir;
}

/** A local v2 project pack at .paradigm/university shipping the given skill ids. */
function writePack(ids: string[]): void {
  fs.mkdirSync(packRoot, { recursive: true });
  const manifest = {
    id: 'proj-pack', name: 'Proj', version: '1.0.0', schema_version: '2', tenant_kind: 'project',
    skills: ids.map(id => ({ path: `skills/${id}` })),
  };
  fs.writeFileSync(path.join(packRoot, 'pack.yaml'), yaml.dump(manifest));
  for (const id of ids) writeSkillDir(path.join(packRoot, 'skills', id), id);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-pack-'));
  home = path.join(tmp, 'home');
  root = path.join(tmp, 'proj');
  packRoot = path.join(root, '.paradigm', 'university');
  fs.mkdirSync(path.join(home, '.paradigm', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(home, '.paradigm', 'agents', 'designer.agent'), 'id: designer\nrole: designer\n');
  fs.mkdirSync(path.join(root, '.paradigm'), { recursive: true });
  env = { rootDir: root, homedir: home };
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('pack scope — discovery + trust', () => {
  it('discovers pack skills from pack.yaml v2 via university-core', () => {
    writePack(['trace-debug']);
    expect(envPackSkillDirs(env)).toEqual([{ packId: 'proj-pack', dir: path.join(packRoot, 'skills', 'trace-debug') }]);
    const s = resolveSkill('trace-debug', env)!;
    expect(s.scope).toBe('pack');
    expect(s.packId).toBe('proj-pack');
  });

  it('forces trust external and drops certification regardless of frontmatter', () => {
    writePack(['trace-debug']);
    const s = resolveSkill('trace-debug', env)!;
    expect(s.metadata.paradigm.trust).toBe('external');
    expect(s.metadata.paradigm.certification).toBeUndefined();
    const direct = loadSkillFromDir(path.join(packRoot, 'skills', 'trace-debug'), 'pack');
    expect(direct.metadata.paradigm.trust).toBe('external');
  });

  it('no .paradigm dir → no discovery (and no cache written)', () => {
    const bare = path.join(tmp, 'bare');
    fs.mkdirSync(bare);
    expect(envPackSkillDirs({ rootDir: bare, homedir: home })).toEqual([]);
    expect(fs.existsSync(path.join(bare, '.paradigm'))).toBe(false);
  });

  it('precedence: project › global › pack', () => {
    writePack(['trace-debug']);
    expect(resolveSkill('trace-debug', env)!.scope).toBe('pack');
    writeSkillDir(path.join(home, '.paradigm', 'skills', 'trace-debug'), 'trace-debug', { trust: 'provisional' });
    expect(resolveSkill('trace-debug', env)!.scope).toBe('global');
    writeSkillDir(path.join(root, '.paradigm', 'skills', 'trace-debug'), 'trace-debug', { trust: 'provisional' });
    expect(resolveSkill('trace-debug', env)!.scope).toBe('project');
    const listed = listSkillsDetailed(env).skills.filter(s => s.metadata.paradigm.id === 'trace-debug');
    expect(listed.map(s => s.scope)).toEqual(['project']);
  });

  it('listSkillsDetailed includes pack skills at the lowest precedence', () => {
    writePack(['trace-debug', 'other-skill']);
    writeSkillDir(path.join(home, '.paradigm', 'skills', 'other-skill'), 'other-skill', { trust: 'provisional' });
    const { skills } = listSkillsDetailed(env);
    expect(skills.map(s => [s.metadata.paradigm.id, s.scope])).toEqual([['other-skill', 'global'], ['trace-debug', 'pack']]);
  });

  it('a pack skill whose SKILL.md id ≠ dir is skipped (invalid, pack scope)', () => {
    const dir = path.join(tmp, 'packs', 'mismatch-dir');
    writeSkillDir(dir, 'other-id');
    const e: SkillEnv = { ...env, packSkillDirs: [{ packId: 'x', dir }] };
    expect(resolveSkill('mismatch-dir', e)).toBeNull();
    const { invalid } = listSkillsDetailed(e);
    expect(invalid).toHaveLength(1);
    expect(invalid[0]).toMatchObject({ scope: 'pack', packId: 'x' });
    expect(listPackSkills(e)).toEqual([]);
  });

  it('traversal / symlink entries in pack.yaml never become pack skills', () => {
    fs.mkdirSync(packRoot, { recursive: true });
    const outside = writeSkillDir(path.join(tmp, 'outside', 'escape-skill'), 'escape-skill');
    fs.mkdirSync(path.join(packRoot, 'skills'), { recursive: true });
    fs.symlinkSync(outside, path.join(packRoot, 'skills', 'escape-skill'));
    fs.writeFileSync(path.join(packRoot, 'pack.yaml'), yaml.dump({
      id: 'proj-pack', name: 'P', version: '1.0.0', schema_version: '2', tenant_kind: 'project',
      skills: [{ path: 'skills/escape-skill' }, { path: '../../outside/escape-skill' }],
    }));
    expect(envPackSkillDirs(env)).toEqual([]);
    expect(resolveSkill('escape-skill', env)).toBeNull();
  });
});

describe('listPackSkills', () => {
  it('returns every pack skill incl. shadowed ones, with scriptCount', () => {
    writePack(['trace-debug', 'other-skill']);
    fs.mkdirSync(path.join(packRoot, 'skills', 'trace-debug', 'scripts'));
    fs.writeFileSync(path.join(packRoot, 'skills', 'trace-debug', 'scripts', 'run.sh'), 'echo hi\n');
    writeSkillDir(path.join(root, '.paradigm', 'skills', 'other-skill'), 'other-skill', { trust: 'provisional' });
    const entries = listPackSkills(env);
    expect(entries.map(e => [e.packId, e.skill.metadata.paradigm.id, e.skill.metadata.paradigm.trust, e.scriptCount, e.shadowedBy]))
      .toEqual([
        ['proj-pack', 'trace-debug', 'external', 1, undefined],
        ['proj-pack', 'other-skill', 'external', 0, 'project'],
      ]);
    expect(findPackSkill('proj-pack', 'trace-debug', env)?.skill.scope).toBe('pack');
    expect(findPackSkill('proj-pack', '../x', env)).toBeNull();
  });
});

describe('lint — PACK_SHADOWED + pack-scope resolution warnings', () => {
  it('warns (not errors) when a project skill shadows a pack skill, and on the pack skill itself', () => {
    writePack(['trace-debug']);
    const pack = resolveSkill('trace-debug', env)!;
    expect(lintSkill(pack, env).some(i => i.code === 'PACK_SHADOWED')).toBe(false);
    writeSkillDir(path.join(root, '.paradigm', 'skills', 'trace-debug'), 'trace-debug', { trust: 'provisional' });
    const proj = resolveSkill('trace-debug', env)!;
    const issue = lintSkill(proj, env).find(i => i.code === 'PACK_SHADOWED');
    expect(issue?.level).toBe('warn');
    expect(issue?.message).toContain('proj-pack:trace-debug');
    expect(lintSkill(pack, env).find(i => i.code === 'PACK_SHADOWED')?.level).toBe('warn');
  });

  it('unresolvable steward/protocol on a pack skill is a warning, not an error', () => {
    const dir = path.join(tmp, 'packs', 'foreign-skill');
    writeSkillDir(dir, 'foreign-skill', { steward: 'nobody-here', protocols: ['missing-proto'] });
    const e: SkillEnv = { ...env, packSkillDirs: [{ packId: 'x', dir }] };
    const issues = lintSkill(resolveSkill('foreign-skill', e)!, e);
    expect(issues.find(i => i.code === 'STEWARD_UNRESOLVED')?.level).toBe('warn');
    expect(issues.find(i => i.code === 'PROTOCOL_MISSING')?.level).toBe('warn');
    expect(hasLintErrors(issues)).toBe(false);
  });
});

describe('projection refuses pack skills', () => {
  it('projectSkill refuses a pack skill even with allowProvisional', () => {
    writePack(['trace-debug']);
    const r = projectSkill('trace-debug', { env, allowProvisional: true });
    expect(r.ok).toBe(false);
    expect(r.refused).toBe('untrusted');
    expect(r.message).toContain('paradigm skill import proj-pack:trace-debug');
    expect(fs.existsSync(path.join(home, '.claude', 'skills', 'pdg-trace-debug'))).toBe(false);
  });

  it('adoptSkill never treats a pack skill as a writable source', () => {
    writePack(['trace-debug']);
    const r = adoptSkill('trace-debug', { env });
    expect(r.ok).toBe(false);
    expect(r.refused).toBe('not-found');
  });
});

describe('importPackSkill', () => {
  it('copies to project scope as provisional with provenance.source pack (+ resources, no symlinks)', () => {
    writePack(['trace-debug']);
    const src = path.join(packRoot, 'skills', 'trace-debug');
    fs.mkdirSync(path.join(src, 'references'));
    fs.writeFileSync(path.join(src, 'references', 'guide.md'), '# guide\n');
    const r = importPackSkill('proj-pack', 'trace-debug', { env });
    expect(r.ok).toBe(true);
    expect(r.dest).toBe(path.join(root, '.paradigm', 'skills', 'trace-debug'));
    expect(r.files).toEqual(['references/guide.md']);
    const imported = resolveSkill('trace-debug', env)!;
    expect(imported.scope).toBe('project');
    expect(imported.metadata.paradigm.trust).toBe('provisional');
    expect(imported.metadata.paradigm.provenance.source).toBe('pack');
    expect(imported.metadata.paradigm.provenance.upstream).toBe('proj-pack:trace-debug@1.2.0');
    expect(imported.metadata.paradigm.certification).toBeUndefined();
    expect(fs.readFileSync(path.join(r.dest!, 'references', 'guide.md'), 'utf8')).toBe('# guide\n');
  });

  it('--global writes to the injected globalDir, never the real home', () => {
    writePack(['trace-debug']);
    const globalDir = path.join(tmp, 'gskills');
    const r = importPackSkill('proj-pack', 'trace-debug', { env: { ...env, globalDir }, scope: 'global' });
    expect(r.ok).toBe(true);
    expect(r.dest).toBe(path.join(globalDir, 'trace-debug'));
  });

  it('refuses unknown pack / skill / invalid id / existing destination', () => {
    writePack(['trace-debug']);
    expect(importPackSkill('nope', 'trace-debug', { env }).refused).toBe('pack-not-found');
    expect(importPackSkill('proj-pack', 'missing-skill', { env }).refused).toBe('not-found');
    expect(importPackSkill('proj-pack', '../evil', { env }).refused).toBe('invalid-id');
    expect(importPackSkill('proj-pack', 'trace-debug', { env }).ok).toBe(true);
    expect(importPackSkill('proj-pack', 'trace-debug', { env }).refused).toBe('exists');
  });
});

describe('v7.11 fix pass — pack skills stay out of agent prompts', () => {
  it('a pack skill stewarded by the agent is not resolved for it, nor rendered in Your Skills', () => {
    writePack(['trace-debug']);
    const profile = { id: 'designer', role: 'designer', skills: [{ id: 'trace-debug', role: 'owns' }] } as unknown as AgentProfile;
    expect(resolveSkill('trace-debug', env)?.metadata.paradigm.steward).toBe('designer');
    const summaries = resolveAgentSkills(profile, env);
    expect(summaries).toEqual([]);
    expect(buildProfileEnrichment(profile, [], undefined, undefined, undefined, summaries)).not.toContain('Your Skills');
    expect(resolveSkill('trace-debug', env, { includePack: false })).toBeNull();
  });
});

describe('v7.11 fix pass — unparseable project/global source does not fall through', () => {
  it('a broken project skill dir resolves to null, not the pack copy', () => {
    writePack(['trace-debug']);
    const bad = path.join(root, '.paradigm', 'skills', 'trace-debug');
    fs.mkdirSync(bad, { recursive: true });
    fs.writeFileSync(path.join(bad, 'SKILL.md'), '---\nname: [unclosed\n---\nbody\n');
    expect(resolveSkill('trace-debug', env)).toBeNull();
    expect(listSkillsDetailed(env).invalid.some(i => i.id === 'trace-debug' && i.scope === 'project')).toBe(true);
  });
});

describe('v7.11 fix pass — import TOCTOU', () => {
  it('refuses content-changed when the pack skill changed after review', () => {
    writePack(['trace-debug']);
    const reviewed = computeContentHash(findPackSkill('proj-pack', 'trace-debug', env)!.skill);
    fs.appendFileSync(path.join(packRoot, 'skills', 'trace-debug', 'SKILL.md'), '\n4. Sneaky new step.\n');
    const r = importPackSkill('proj-pack', 'trace-debug', { env, expectedHash: reviewed });
    expect(r.ok).toBe(false);
    expect(r.refused).toBe('content-changed');
    expect(fs.existsSync(path.join(root, '.paradigm', 'skills', 'trace-debug'))).toBe(false);
  });

  it('imports when the hash still matches', () => {
    writePack(['trace-debug']);
    const reviewed = computeContentHash(findPackSkill('proj-pack', 'trace-debug', env)!.skill);
    expect(importPackSkill('proj-pack', 'trace-debug', { env, expectedHash: reviewed }).ok).toBe(true);
  });

  it('never copies a symlinked resource file', () => {
    writePack(['trace-debug']);
    const src = path.join(packRoot, 'skills', 'trace-debug');
    fs.mkdirSync(path.join(src, 'references'));
    fs.writeFileSync(path.join(tmp, 'secret.txt'), 'SECRET');
    fs.symlinkSync(path.join(tmp, 'secret.txt'), path.join(src, 'references', 'leak.md'));
    const r = importPackSkill('proj-pack', 'trace-debug', { env });
    expect(r.files ?? []).not.toContain('references/leak.md');
    if (r.ok) expect(fs.existsSync(path.join(r.dest!, 'references', 'leak.md'))).toBe(false);
  });
});
