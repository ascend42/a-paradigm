import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { auditAgents } from './agent-audit.js';
import { createTempProject } from '../../test-utils.js';

let cleanups: Array<() => void> = [];

afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
});

function setup(): { rootDir: string; globalDir: string } {
  const { rootDir, cleanup } = createTempProject();
  const globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-global-agents-'));
  cleanups.push(cleanup, () => fs.rmSync(globalDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(rootDir, '.paradigm', 'agents'), { recursive: true });
  return { rootDir, globalDir };
}

function writeAgent(dir: string, id: string, extra: Record<string, unknown> = {}): void {
  fs.writeFileSync(
    path.join(dir, `${id}.agent`),
    yaml.dump({ id, role: `${id} role`, description: 'd', version: '1.0.0', ...extra }),
    'utf8',
  );
}

function writeRoster(rootDir: string, active: string[]): void {
  fs.writeFileSync(path.join(rootDir, '.paradigm', 'roster.yaml'), yaml.dump({ version: '1.0', active }), 'utf8');
}

describe('auditAgents', () => {
  it('flags unknown top-level keys', () => {
    const { rootDir, globalDir } = setup();
    writeAgent(path.join(rootDir, '.paradigm', 'agents'), 'builder', { foo: 1 });
    const audit = auditAgents(rootDir, { globalDir });
    expect(audit.unknownKeys).toHaveLength(1);
    expect(audit.unknownKeys[0].keys).toEqual(['foo']);
    expect(path.basename(audit.unknownKeys[0].file)).toBe('builder.agent');
  });

  it('reports behaviors as unread, not unknown', () => {
    const { rootDir, globalDir } = setup();
    writeAgent(globalDir, 'architect', { behaviors: { plan: 'Plans things' }, tags: ['core'] });
    const audit = auditAgents(rootDir, { globalDir });
    expect(audit.unknownKeys).toEqual([]);
    expect(audit.unreadKeys).toHaveLength(1);
    expect(audit.unreadKeys[0].keys).toEqual(['behaviors']);
  });

  it('reports a roster member with no .agent file anywhere as a gap', () => {
    const { rootDir, globalDir } = setup();
    writeAgent(globalDir, 'architect');
    writeAgent(globalDir, 'composer', { benched: true });
    writeRoster(rootDir, ['architect', 'showrunner', 'composer']);
    const audit = auditAgents(rootDir, { globalDir });
    expect(audit.rosterGaps).toEqual(['showrunner']);
    expect(audit.benchedOnRoster).toEqual(['composer']);
  });

  it('does not report a roster member satisfied only by agents.yaml', () => {
    const { rootDir, globalDir } = setup();
    writeRoster(rootDir, ['reviewer']);
    fs.writeFileSync(
      path.join(rootDir, '.paradigm', 'agents.yaml'),
      yaml.dump({ version: '1.0', agents: { reviewer: { name: 'reviewer', role: 'Reviews' } } }),
      'utf8',
    );
    const audit = auditAgents(rootDir, { globalDir });
    expect(audit.rosterGaps).toEqual([]);
  });

  it('treats a roster file with a missing id as a gap', () => {
    const { rootDir, globalDir } = setup();
    fs.writeFileSync(path.join(globalDir, 'forge.agent'), yaml.dump({ role: 'no id here' }), 'utf8');
    writeRoster(rootDir, ['forge']);
    const audit = auditAgents(rootDir, { globalDir });
    expect(audit.rosterGaps).toEqual(['forge']);
  });
});

describe('auditAgents — skills (Phase 1)', () => {
  function writeSkill(dir: string, id: string, migratedFrom?: string): void {
    fs.mkdirSync(path.join(dir, id), { recursive: true });
    const fm = { name: id, description: 'd', metadata: { paradigm: {
      id, version: '0.1.0', steward: 'designer', trust: 'provisional',
      provenance: { source: 'bundled', createdBy: 'designer', ...(migratedFrom ? { migratedFrom } : {}) },
    } } };
    fs.writeFileSync(path.join(dir, id, 'SKILL.md'), `---\n${yaml.dump(fm)}---\n# ${id}\n`, 'utf8');
  }

  it('accepts `skills` as a known profile key', () => {
    const { rootDir, globalDir } = setup();
    const skillsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-global-skills-'));
    cleanups.push(() => fs.rmSync(skillsDir, { recursive: true, force: true }));
    writeAgent(path.join(rootDir, '.paradigm', 'agents'), 'designer', { skills: [{ id: 'ui-critique-loop', role: 'owns' }] });
    const audit = auditAgents(rootDir, { globalDir, globalSkillsDir: skillsDir });
    expect(audit.unknownKeys).toEqual([]);
    expect(audit.migratedBehaviors).toEqual([]);
  });

  it('reports behaviors blocks migrated to a skill (project and global skill sources)', () => {
    const { rootDir, globalDir } = setup();
    const skillsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-global-skills-'));
    cleanups.push(() => fs.rmSync(skillsDir, { recursive: true, force: true }));
    writeSkill(skillsDir, 'ui-critique-loop', 'designer.agent#behaviors.review-checklist');
    writeSkill(path.join(rootDir, '.paradigm', 'skills'), 'design-system-extract', 'designer.agent#behaviors.design-system-maintenance');
    writeSkill(skillsDir, 'unrelated');
    writeAgent(path.join(rootDir, '.paradigm', 'agents'), 'designer', {
      behaviors: { 'review-checklist': 'x', 'design-system-maintenance': 'y', 'tool-fluency': 'z' },
    });
    const audit = auditAgents(rootDir, { globalDir, globalSkillsDir: skillsDir });
    const found = audit.migratedBehaviors.map(m => `${m.block}->${m.skillId}`).sort();
    expect(found).toEqual(['design-system-maintenance->design-system-extract', 'review-checklist->ui-critique-loop']);
    // behaviors stays an UNREAD key (info), never unknown
    expect(audit.unknownKeys).toEqual([]);
    expect(audit.unreadKeys).toHaveLength(1);
  });
});
