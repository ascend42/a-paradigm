/**
 * Skills Phase 1 — #skill-loader, #skill-projector, !skill-used, enrichment.
 * Every test runs in a tmp root with an injected homedir; the real home is never touched.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import {
  parseSkill,
  serializeSkill,
  resolveSkill,
  listSkills,
  listSkillsDetailed,
  lintSkill,
  hasLintErrors,
  computeContentHash,
  computeStatus,
  checkPins,
  hashToolSchema,
  parseToolsDump,
  resolveAgentSkills,
  evaluateCertification,
  applyCertification,
  buildSkillCertRow,
  writeSkill,
  skillKey,
  projectedSkillDir,
  loadSkillCertLedger,
  appendGlobalSkillCertRow,
  listSkillScripts,
  isCertificationValid,
  type SkillEnv,
} from './skill-loader.js';
import { appendClassroomCertification } from './field-failures.js';
import {
  projectSkill,
  adoptSkill,
  readMarker,
  isUnderSynced,
  sweepStaleTemps,
  parseAllowedTools,
  PROVISIONAL_BANNER,
} from './skill-projector.js';
import {
  appendSkillUsage,
  readSkillUsage,
  skillIdFromProjectedName,
  buildSkillUsageRow,
  resolveHookProjectDir,
} from './skill-usage.js';
import { buildProfileEnrichment, computeIntegrityHash, verifyIntegrity } from './agent-loader.js';
import type { SkillFile, SkillSummary } from '../types/skills.js';
import type { AgentProfile } from '../types/agents.js';
import type { Scenario } from './scenario-loader.js';

let tmp: string;
let env: SkillEnv;
let home: string;
let root: string;

const BODY = [
  '# Audit',
  '',
  '1. Inventory the tokens.',
  '2. Check contrast against WCAG thresholds.',
  '3. Report findings in a table.',
  '',
].join('\n');

function meta(overrides: Record<string, unknown> = {}) {
  return {
    id: 'demo-skill',
    version: '1.0.0',
    steward: 'designer',
    trust: 'provisional',
    provenance: { source: 'authored', createdBy: 'designer' },
    notebooks: ['designer/nb-a'],
    tools: { Read: 'host' },
    triggers: { concepts: ['contrast'] },
    ...overrides,
  };
}

function writeSource(
  scopeDir: string,
  id: string,
  m: Record<string, unknown> = {},
  body = BODY,
  extra: Record<string, unknown> = {},
): string {
  const dir = path.join(scopeDir, id);
  fs.mkdirSync(dir, { recursive: true });
  const fm = { name: id, description: `The ${id} skill`, ...extra, metadata: { paradigm: meta({ id, ...m }) } };
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${yaml.dump(fm)}---\n${body}`);
  return dir;
}

const projDir = () => path.join(root, '.paradigm', 'skills');
const globDir = () => path.join(home, '.paradigm', 'skills');

/** Certify a source: SKILL.md block + (by default) the ledger row. */
function certify(id: string, opts: { ledger?: boolean } = {}): SkillFile {
  const s = resolveSkill(id, env)!;
  const cert = {
    approvedBy: 'founder', approvedAt: '2026-09-28T00:00:00.000Z', project: 'p', scenarios: ['sc'],
    contentHash: computeContentHash({ ...s, metadata: { paradigm: { ...s.metadata.paradigm, trust: 'certified' as const } } }),
  };
  const certified = applyCertification(s, cert);
  writeSkill(certified);
  if (opts.ledger !== false) appendClassroomCertification(root, buildSkillCertRow(certified, cert));
  return resolveSkill(id, env)!;
}
const ledger = () => loadSkillCertLedger(env);

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-test-'));
  home = path.join(tmp, 'home');
  root = path.join(tmp, 'proj');
  fs.mkdirSync(path.join(home, '.paradigm', 'agents', 'designer', 'notebooks'), { recursive: true });
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(home, '.paradigm', 'agents', 'designer.agent'), 'id: designer\nrole: designer\n');
  fs.writeFileSync(path.join(home, '.paradigm', 'agents', 'a11y.agent'), 'id: a11y\nrole: a11y\n');
  fs.writeFileSync(path.join(home, '.paradigm', 'agents', 'designer', 'notebooks', 'nb-a.yaml'), 'id: nb-a\n');
  env = { rootDir: root, homedir: home };
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ─── Parse / resolve ────────────────────────────────────

describe('parse + resolve', () => {
  it('round-trips SKILL.md', () => {
    const dir = writeSource(globDir(), 'demo-skill', {}, BODY, { 'allowed-tools': 'Read Bash' });
    const s = resolveSkill('demo-skill', env)!;
    expect(s.scope).toBe('global');
    expect(s['allowed-tools']).toBe('Read Bash');
    const again = parseSkill(serializeSkill(s), dir, 'global');
    expect(again).toEqual(s);
    expect(serializeSkill(again)).toBe(serializeSkill(s));
  });

  it('rejects missing metadata.paradigm', () => {
    expect(() => parseSkill('---\nname: x\ndescription: y\n---\nbody', tmp, 'project')).toThrow(/metadata.paradigm/);
  });

  it('project overrides global', () => {
    writeSource(globDir(), 'demo-skill', { version: '1.0.0' });
    writeSource(projDir(), 'demo-skill', { version: '2.0.0' });
    expect(resolveSkill('demo-skill', env)!.metadata.paradigm.version).toBe('2.0.0');
    const all = listSkills(env);
    expect(all).toHaveLength(1);
    expect(all[0].scope).toBe('project');
  });

  it('globalDir is injectable and invalid sources are reported', () => {
    const custom = path.join(tmp, 'custom-global');
    writeSource(custom, 'demo-skill');
    fs.mkdirSync(path.join(custom, 'broken'), { recursive: true });
    fs.writeFileSync(path.join(custom, 'broken', 'SKILL.md'), 'no frontmatter');
    const d = listSkillsDetailed({ ...env, globalDir: custom });
    expect(d.skills.map(s => s.metadata.paradigm.id)).toEqual(['demo-skill']);
    expect(d.invalid.map(i => i.id)).toEqual(['broken']);
  });
});

// ─── Lint ──────────────────────────────────────────────

describe('lint', () => {
  const codes = (s: SkillFile, opts = {}) => lintSkill(s, env, opts).map(i => i.code);

  it('clean skill passes', () => {
    writeSource(globDir(), 'demo-skill');
    expect(lintSkill(resolveSkill('demo-skill', env)!, env)).toEqual([]);
  });

  it('SKILL_IS_PROTOCOL fires on repo paths in steps, not own resources or prose', () => {
    writeSource(globDir(), 'demo-skill', {}, BODY + '4. Edit `packages/paradigm/src/index.ts` now\n');
    expect(codes(resolveSkill('demo-skill', env)!)).toContain('SKILL_IS_PROTOCOL');
    writeSource(globDir(), 'demo-skill', {}, BODY + '4. Open app/theme/tokens.ts\n');
    expect(codes(resolveSkill('demo-skill', env)!)).toContain('SKILL_IS_PROTOCOL');
    writeSource(globDir(), 'demo-skill', {}, BODY + '4. Read references/checklist.yaml and scripts/run.py\nsrc/foo.ts in prose is fine\n');
    expect(codes(resolveSkill('demo-skill', env)!)).not.toContain('SKILL_IS_PROTOCOL');
  });

  it('SKILL_IS_NOTEBOOK warns on thin bodies', () => {
    writeSource(globDir(), 'demo-skill', {}, 'one line\n\n');
    const issues = lintSkill(resolveSkill('demo-skill', env)!, env);
    expect(issues.find(i => i.code === 'SKILL_IS_NOTEBOOK')?.level).toBe('warn');
    expect(hasLintErrors(issues)).toBe(false);
  });

  it('OWNED_SKILL_CAP warns past 5', () => {
    for (let i = 0; i < 6; i++) writeSource(globDir(), `s-${i}`);
    const issues = lintSkill(resolveSkill('s-0', env)!, env);
    expect(issues.find(i => i.code === 'OWNED_SKILL_CAP')?.level).toBe('warn');
  });

  it('errors on missing notebook, missing protocol, unresolved steward, non-kebab name', () => {
    writeSource(globDir(), 'demo-skill', { notebooks: ['designer/nb-missing'], protocols: ['nope'], steward: 'ghost' });
    const c = codes(resolveSkill('demo-skill', env)!);
    expect(c).toEqual(expect.arrayContaining(['NOTEBOOK_MISSING', 'PROTOCOL_MISSING', 'STEWARD_UNRESOLVED']));
    const s = resolveSkill('demo-skill', env)!;
    expect(codes({ ...s, name: 'Demo_Skill' })).toContain('NAME_NOT_KEBAB');
  });

  it('resolves notebooks by id field and protocols on disk', () => {
    fs.mkdirSync(path.join(root, '.paradigm', 'notebooks', 'a11y'), { recursive: true });
    fs.writeFileSync(path.join(root, '.paradigm', 'notebooks', 'a11y', 'other-name.yaml'), 'id: nb-x\n');
    fs.mkdirSync(path.join(root, '.paradigm', 'protocols'), { recursive: true });
    fs.writeFileSync(path.join(root, '.paradigm', 'protocols', 'p1.protocol'), 'id: p1\n');
    writeSource(globDir(), 'demo-skill', { notebooks: ['a11y/nb-x'], protocols: ['p1'] });
    expect(lintSkill(resolveSkill('demo-skill', env)!, env)).toEqual([]);
  });
});

// ─── Hash / status ─────────────────────────────────────

describe('contentHash + status', () => {
  it('changes on body and reference edits, not on certification', () => {
    const dir = writeSource(globDir(), 'demo-skill');
    const h0 = computeContentHash(resolveSkill('demo-skill', env)!);
    fs.mkdirSync(path.join(dir, 'references'));
    fs.writeFileSync(path.join(dir, 'references', 'a.md'), 'x');
    const h1 = computeContentHash(resolveSkill('demo-skill', env)!);
    expect(h1).not.toBe(h0);
    fs.writeFileSync(path.join(dir, 'references', 'a.md'), 'y');
    const h2 = computeContentHash(resolveSkill('demo-skill', env)!);
    expect(h2).not.toBe(h1);
    const s = resolveSkill('demo-skill', env)!;
    expect(computeContentHash({ ...s, body: s.body + 'more\n' })).not.toBe(h2);
    const withCert = { ...s, metadata: { paradigm: { ...s.metadata.paradigm, certification: {
      approvedBy: 'x', approvedAt: 'y', project: 'z', scenarios: [], contentHash: 'sha256:0' } } } };
    expect(computeContentHash(withCert)).toBe(h2);
  });

  it('certified + hash valid → ok; tampered → uncertified; provisional → uncertified', () => {
    writeSource(globDir(), 'demo-skill');
    expect(computeStatus(resolveSkill('demo-skill', env)!)).toBe('uncertified');
    const c = certify('demo-skill');
    expect(computeStatus(c, { ledger: ledger() })).toBe('ok');
    expect(computeStatus(c)).toBe('uncertified'); // no ledger supplied → never ok
    expect(computeStatus({ ...c, body: c.body + 'tamper\n' }, { ledger: ledger() })).toBe('uncertified');
    expect(computeStatus(c, { lint: [{ level: 'error', code: 'NAME_NOT_KEBAB', message: '' }] })).toBe('invalid');
  });
});

// ─── Pins ──────────────────────────────────────────────

describe('checkPins', () => {
  const schema = { type: 'object', properties: { q: { type: 'string' } } };

  it('paradigm_* hash mismatch → stale; match → ok; host never checked', () => {
    writeSource(globDir(), 'demo-skill', { tools: { Read: 'host', paradigm_search: hashToolSchema(schema) } });
    const s = resolveSkill('demo-skill', env)!;
    const ok = checkPins(s, { paradigmTools: [{ name: 'paradigm_search', inputSchema: { properties: { q: { type: 'string' } }, type: 'object' } }] });
    expect(ok.stale).toBe(false);
    expect(ok.results.find(r => r.tool === 'Read')!.state).toBe('host');
    const bad = checkPins(s, { paradigmTools: [{ name: 'paradigm_search', inputSchema: { type: 'object' } }] });
    expect(bad.stale).toBe(true);
    expect(computeStatus(s, { pins: bad })).toBe('stale');
  });

  it('unknown third-party passes; --tools dump resolves', () => {
    const t = 'mcp__claude-in-chrome__computer';
    writeSource(globDir(), 'demo-skill', { tools: { [t]: hashToolSchema(schema) } });
    const s = resolveSkill('demo-skill', env)!;
    const unk = checkPins(s);
    expect(unk.stale).toBe(false);
    expect(unk.unverified).toBe(true);
    const dump = parseToolsDump({ result: { tools: [{ name: t, inputSchema: schema }] } });
    const res = checkPins(s, { externalTools: dump });
    expect(res.results[0].state).toBe('ok');
    expect(res.unverified).toBe(false);
    expect(checkPins(s, { externalTools: [{ name: t, inputSchema: {} }] }).stale).toBe(true);
  });
});

// ─── Projection ────────────────────────────────────────

describe('projectSkill', () => {
  it('refuses provisional without the flag; banner with it', () => {
    writeSource(globDir(), 'demo-skill');
    const r = projectSkill('demo-skill', { env });
    expect(r.ok).toBe(false);
    expect(r.refused).toBe('untrusted');
    const r2 = projectSkill('demo-skill', { env, allowProvisional: true });
    expect(r2.ok).toBe(true);
    const md = fs.readFileSync(path.join(r2.dest, 'SKILL.md'), 'utf8');
    expect(md).toContain(PROVISIONAL_BANNER);
    expect(r2.dest).toBe(path.join(home, '.claude', 'skills', 'pdg-demo-skill'));
  });

  it('projected metadata is a flat string map; name rewritten; certification dropped', () => {
    writeSource(globDir(), 'demo-skill', {}, BODY, { 'allowed-tools': 'Read' });
    certify('demo-skill');
    const r = projectSkill('demo-skill', { env });
    expect(r.ok).toBe(true);
    const fm = yaml.load(fs.readFileSync(path.join(r.dest, 'SKILL.md'), 'utf8').split('---\n')[1]) as any;
    expect(fm.name).toBe('pdg-demo-skill');
    expect(fm['allowed-tools']).toBe('Read');
    expect(fm.metadata).toEqual({
      'paradigm-id': 'demo-skill', 'paradigm-version': '1.0.0', 'paradigm-steward': 'designer',
      'paradigm-trust': 'certified', 'paradigm-source': 'authored',
    });
    for (const v of Object.values(fm.metadata)) expect(typeof v).toBe('string');
    expect(JSON.stringify(fm)).not.toContain('certification');
    const marker = readMarker(r.dest)!;
    expect(marker.skillId).toBe('demo-skill');
    expect(marker.sourceHash).toBe(computeContentHash(resolveSkill('demo-skill', env)!));
  });

  it('refuses synced/ destinations', () => {
    expect(isUnderSynced(path.join(home, '.claude', 'skills', 'synced', 'x'), home)).toBe(true);
    expect(isUnderSynced(path.join(home, '.claude', 'skills', 'pdg-x'), home)).toBe(false);
    // A symlinked skills dir pointing into synced/ is caught too.
    fs.mkdirSync(path.join(home, '.claude', 'skills', 'synced', 'inner'), { recursive: true });
    const alias = path.join(tmp, 'alias-root');
    fs.mkdirSync(path.join(alias, '.claude'), { recursive: true });
    fs.symlinkSync(path.join(home, '.claude', 'skills', 'synced', 'inner'), path.join(alias, '.claude', 'skills'));
    writeSource(globDir(), 'demo-skill');
    certify('demo-skill');
    const r = projectSkill('demo-skill', { env: { ...env, rootDir: alias }, target: 'project' });
    expect(r.refused).toBe('synced');
    expect(fs.readdirSync(path.join(home, '.claude', 'skills', 'synced', 'inner'))).toEqual([]);
  });

  it('refuses an unmarked dest and a drifted dest; idempotent re-project', () => {
    writeSource(globDir(), 'demo-skill');
    certify('demo-skill');
    const dest = projectedSkillDir('demo-skill', 'user', env);
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'SKILL.md'), 'user file');
    expect(projectSkill('demo-skill', { env }).refused).toBe('not-ours');
    fs.rmSync(dest, { recursive: true });

    const r1 = projectSkill('demo-skill', { env });
    expect(r1.ok).toBe(true);
    const r2 = projectSkill('demo-skill', { env });
    expect(r2.ok).toBe(true);
    expect(r2.unchanged).toBe(true);

    fs.appendFileSync(path.join(dest, 'SKILL.md'), '\nedited downstream\n');
    const r3 = projectSkill('demo-skill', { env });
    expect(r3.refused).toBe('drifted');
    expect(r3.message).toContain('paradigm skill adopt demo-skill');
  });

  it('--target project writes under <root>/.claude/skills; dry-run writes nothing', () => {
    writeSource(globDir(), 'demo-skill');
    certify('demo-skill');
    const dry = projectSkill('demo-skill', { env, target: 'project', dryRun: true });
    expect(dry.ok && dry.dryRun).toBe(true);
    expect(fs.existsSync(dry.dest)).toBe(false);
    const r = projectSkill('demo-skill', { env, target: 'project' });
    expect(r.dest).toBe(path.join(root, '.claude', 'skills', 'pdg-demo-skill'));
    expect(fs.existsSync(path.join(r.dest, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(home, '.claude', 'skills', 'pdg-demo-skill'))).toBe(false);
  });

  it('refuses on lint errors and stale pins; copies references', () => {
    const dir = writeSource(globDir(), 'demo-skill', { steward: 'ghost' });
    expect(projectSkill('demo-skill', { env, allowProvisional: true }).refused).toBe('lint');
    writeSource(globDir(), 'demo-skill', { tools: { paradigm_x: 'sha256:abc' } });
    expect(projectSkill('demo-skill', { env, allowProvisional: true, paradigmTools: [] }).refused).toBe('stale');
    const unv = projectSkill('demo-skill', { env, allowProvisional: true });
    expect(unv.ok).toBe(true);
    expect(readMarker(unv.dest)!.pinsUnverified).toBe(true);
    fs.mkdirSync(path.join(dir, 'references'));
    fs.writeFileSync(path.join(dir, 'references', 'r.md'), 'ref');
    const r = projectSkill('demo-skill', { env, allowProvisional: true });
    expect(fs.readFileSync(path.join(r.dest, 'references', 'r.md'), 'utf8')).toBe('ref');
  });
});

// ─── Adopt ─────────────────────────────────────────────

describe('adoptSkill', () => {
  it('patch-bumps, goes provisional, archives prior, restores nested metadata, re-projects', () => {
    const dir = writeSource(globDir(), 'demo-skill', { provenance: { source: 'bundled', createdBy: 'designer', migratedFrom: 'designer.agent#behaviors.x' } });
    certify('demo-skill');
    const r = projectSkill('demo-skill', { env });
    const md = path.join(r.dest, 'SKILL.md');
    fs.writeFileSync(md, fs.readFileSync(md, 'utf8').replace('Report findings in a table.', 'Report findings in a WCAG table.'));
    fs.mkdirSync(path.join(r.dest, 'references'));
    fs.writeFileSync(path.join(r.dest, 'references', 'new.md'), 'n');

    const a = adoptSkill('demo-skill', { env });
    expect(a.ok).toBe(true);
    expect(a.fromVersion).toBe('1.0.0');
    expect(a.toVersion).toBe('1.0.1');
    expect(a.diff!.modified).toContain('SKILL.md');
    expect(a.diff!.added).toContain('references/new.md');

    const s = resolveSkill('demo-skill', env)!;
    const m = s.metadata.paradigm;
    expect(m.version).toBe('1.0.1');
    expect(m.trust).toBe('provisional');
    expect(m.provenance.source).toBe('adopted');
    expect(m.provenance.migratedFrom).toBe('designer.agent#behaviors.x');
    expect(m.certification).toBeUndefined();
    expect(m.notebooks).toEqual(['designer/nb-a']);
    expect(m.triggers).toEqual({ concepts: ['contrast'] });
    expect(s.name).toBe('demo-skill');
    expect(s.body).toContain('WCAG table');
    expect(s.body).not.toContain(PROVISIONAL_BANNER);
    expect(fs.readFileSync(path.join(dir, 'references', 'new.md'), 'utf8')).toBe('n');

    const archived = fs.readFileSync(path.join(dir, '.versions', '1.0.0', 'SKILL.md'), 'utf8');
    expect(archived).toContain('certification');

    const marker = readMarker(r.dest)!;
    expect(marker.version).toBe('1.0.1');
    // Fresh marker: plain re-project with the flag is now clean (no drift).
    expect(projectSkill('demo-skill', { env, allowProvisional: true }).ok).toBe(true);
    expect(fs.readFileSync(md, 'utf8')).toContain(PROVISIONAL_BANNER);
  });

  it('refuses when nothing changed or dest is not ours', () => {
    writeSource(globDir(), 'demo-skill');
    certify('demo-skill');
    projectSkill('demo-skill', { env });
    expect(adoptSkill('demo-skill', { env }).refused).toBe('no-changes');
    fs.rmSync(path.join(projectedSkillDir('demo-skill', 'user', env), '.pdg-generated.json'));
    expect(adoptSkill('demo-skill', { env }).refused).toBe('not-ours');
  });
});

// ─── Certification ─────────────────────────────────────

describe('evaluateCertification', () => {
  const key = skillKey('demo-skill', '1.0.0');
  function scenario(over: Partial<Scenario> = {}): Scenario {
    return {
      id: 'sc-1', scenario: 'planted defect', origin: 'poison-pill', fixture: 'fixtures/bad.css',
      probes: [{ agent: 'a11y', learning_ref: key, claim: 'catches low contrast' }],
      expected: { must: 'survive' },
      outcome_history: [{ term: key, agent: 'designer', result: 'survived', assessor: 'a11y', human_confirmed: true, at: '2026-09-27' }],
      repeat_failures: 0, status: 'active', ...over,
    };
  }
  const base = () => {
    writeSource(globDir(), 'demo-skill');
    fs.mkdirSync(path.join(root, 'fixtures'), { recursive: true });
    fs.writeFileSync(path.join(root, 'fixtures', 'bad.css'), '.x{color:#777;background:#888}');
    const s = resolveSkill('demo-skill', env)!;
    return { s, opts: { env, founder: 'matt', tty: true, project: 'proj', lint: lintSkill(s, env), pins: checkPins(s), now: new Date('2026-09-28T00:00:00Z') } };
  };

  it('refuses without a TTY', () => {
    const { s, opts } = base();
    const r = evaluateCertification(s, [scenario()], { ...opts, tty: false });
    expect(r.ok).toBe(false);
    expect(r.reasons.join()).toMatch(/TTY/);
  });

  it('refuses a steward-only probe', () => {
    const { s, opts } = base();
    const r = evaluateCertification(s, [scenario({ probes: [{ agent: 'designer', learning_ref: key, claim: 'c' }] })], opts);
    expect(r.ok).toBe(false);
    expect(r.rejected[0].why).toMatch(/steward/);
  });

  it('refuses an unconfirmed outcome and a wrong-version outcome', () => {
    const { s, opts } = base();
    const unconf = scenario({ outcome_history: [{ term: key, agent: 'designer', result: 'survived', assessor: 'a11y', human_confirmed: false, at: 'x' }] });
    expect(evaluateCertification(s, [unconf], opts).rejected[0].why).toMatch(/human-confirmed/);
    const wrongVer = scenario({ outcome_history: [{ term: skillKey('demo-skill', '0.9.0'), agent: 'designer', result: 'survived', assessor: 'a11y', human_confirmed: true, at: 'x' }] });
    expect(evaluateCertification(s, [wrongVer], opts).ok).toBe(false);
  });

  it('refuses a missing fixture', () => {
    const { s, opts } = base();
    const r = evaluateCertification(s, [scenario({ fixture: undefined })], opts);
    expect(r.ok).toBe(false);
    expect(r.rejected[0].why).toMatch(/fixture/);
  });

  it('refuses lint errors, stale pins and a mismatched confirmation', () => {
    const { s, opts } = base();
    expect(evaluateCertification(s, [scenario()], { ...opts, lint: [{ level: 'error', code: 'PROTOCOL_MISSING', message: '' }] }).ok).toBe(false);
    expect(evaluateCertification(s, [scenario()], { ...opts, pins: { results: [], stale: true, unverified: false } }).ok).toBe(false);
    expect(evaluateCertification(s, [scenario()], { ...opts, confirmation: 'other' }).ok).toBe(false);
  });

  it('happy path: writes block + ledger row; result is status ok and projectable', () => {
    const { s, opts } = base();
    const r = evaluateCertification(s, [scenario()], { ...opts, confirmation: 'demo-skill' });
    expect(r.ok).toBe(true);
    expect(r.entryId).toBe(key);
    expect(r.certification).toMatchObject({ approvedBy: 'matt', project: 'proj', scenarios: ['sc-1'] });
    const certified = applyCertification(s, r.certification!);
    writeSkill(certified);
    const reloaded = resolveSkill('demo-skill', env)!;
    expect(reloaded.metadata.paradigm.trust).toBe('certified');
    const row = buildSkillCertRow(reloaded, r.certification!);
    expect(computeStatus(reloaded, { ledger: ledger() })).toBe('uncertified'); // block alone is not enough
    appendClassroomCertification(root, row);
    expect(computeStatus(reloaded, { ledger: ledger() })).toBe('ok');
    expect(row).toMatchObject({ kind: 'skill', entryId: key, certifiedBy: 'peer', approvedBy: 'matt', outcome: 'pending', agent: 'designer' });
    expect(row.contentHash).toBe(r.certification!.contentHash);
    expect(projectSkill('demo-skill', { env }).ok).toBe(true);
    // Already certified → refused.
    expect(evaluateCertification(reloaded, [scenario()], { ...opts, ledger: ledger() }).reasons.join()).toMatch(/already certified/);
  });
});

// ─── Usage ─────────────────────────────────────────────

describe('skill usage', () => {
  it('appends rows with the shared join key', () => {
    appendSkillUsage(root, { ts: 't', skillId: 'demo-skill', version: '1.0.0', host: 'claude-code' });
    const rows = readSkillUsage(root);
    expect(rows).toHaveLength(1);
    expect(rows[0].entryId).toBe('skill:demo-skill@1.0.0');
    expect(fs.existsSync(path.join(root, '.paradigm', 'events', 'skill-usage.jsonl'))).toBe(true);
  });

  it('maps pdg-<id> via the sidecar version', () => {
    expect(skillIdFromProjectedName('pdg-demo-skill')).toBe('demo-skill');
    expect(skillIdFromProjectedName('plugin:pdg-demo-skill')).toBe('demo-skill');
    expect(skillIdFromProjectedName('archify')).toBeNull();
    writeSource(globDir(), 'demo-skill');
    certify('demo-skill');
    projectSkill('demo-skill', { env });
    const row = buildSkillUsageRow('pdg-demo-skill', { rootDir: root, homedir: home, orchestrationId: 'o1' })!;
    expect(row).toMatchObject({ skillId: 'demo-skill', version: '1.0.0', orchestrationId: 'o1', entryId: 'skill:demo-skill@1.0.0' });
    expect(buildSkillUsageRow('pdg-nope', { rootDir: root, homedir: home })).toBeNull();
  });
});

// ─── Enrichment ────────────────────────────────────────

describe('enrichment — Your Skills', () => {
  const prof = (id: string): AgentProfile => ({ id, role: id, description: '', version: '1', expertise: [], transferable: [], contexts: {}, created: '', updated: '' } as unknown as AgentProfile);
  const sum = (o: Partial<SkillSummary>): SkillSummary => ({
    id: 'x', name: 'x', description: 'does x', path: '/p/x', trust: 'certified', status: 'ok',
    role: 'uses', steward: 'designer', version: '1.0.0', ...o,
  });

  it('certified shown to all; provisional only to steward (labelled); stale/invalid omitted', () => {
    const skills = [
      sum({ id: 'c', name: 'pdg-c', path: '/home/.claude/skills/pdg-c' }),
      sum({ id: 'p', name: 'p', trust: 'provisional', status: 'uncertified', role: 'owns' }),
      sum({ id: 's', name: 'stale-one', status: 'stale' }),
      sum({ id: 'i', name: 'invalid-one', status: 'invalid' }),
    ];
    const forSteward = buildProfileEnrichment(prof('designer'), [], undefined, undefined, undefined, skills);
    expect(forSteward).toContain('## Your Skills');
    expect(forSteward).toContain('- pdg-c (uses, certified): does x — /home/.claude/skills/pdg-c');
    expect(forSteward).toMatch(/- p \(owns, PROVISIONAL — not certified, steward only\): does x — \/p\/x/);
    expect(forSteward).not.toContain('stale-one');
    expect(forSteward).not.toContain('invalid-one');

    const forPeer = buildProfileEnrichment(prof('a11y'), [], undefined, undefined, undefined, skills);
    expect(forPeer).toContain('pdg-c (uses, certified)');
    expect(forPeer).not.toMatch(/- p \(/);
  });

  it('no section when no visible skills', () => {
    expect(buildProfileEnrichment(prof('a11y'), [])).not.toContain('Your Skills');
    expect(buildProfileEnrichment(prof('a11y'), [], undefined, undefined, undefined, [sum({ status: 'stale' })])).not.toContain('Your Skills');
  });

  it('resolveAgentSkills builds summaries with projected path + status', () => {
    writeSource(globDir(), 'demo-skill');
    writeSource(globDir(), 'other-skill', { steward: 'a11y' });
    certify('other-skill');
    projectSkill('other-skill', { env });
    const p = { ...prof('designer'), skills: [{ id: 'demo-skill', role: 'owns' }, { id: 'other-skill', role: 'uses' }, { id: 'missing', role: 'uses' }] } as AgentProfile;
    const out = resolveAgentSkills(p, env);
    expect(out.map(s => s.id)).toEqual(['demo-skill', 'other-skill']);
    expect(out[0]).toMatchObject({ role: 'owns', trust: 'provisional', status: 'uncertified', name: 'demo-skill', path: path.join(globDir(), 'demo-skill') });
    expect(out[1]).toMatchObject({ role: 'uses', status: 'ok', name: 'pdg-other-skill', path: projectedSkillDir('other-skill', 'user', env) });
  });

  it('skills do not affect integrityHash', () => {
    const base = { ...prof('designer'), permissions: { paths: { deny: ['secrets/**'] } } } as AgentProfile;
    const h = computeIntegrityHash(base);
    const withSkills = { ...base, skills: [{ id: 'demo-skill', role: 'owns' as const }], integrityHash: h };
    expect(computeIntegrityHash(withSkills)).toBe(h);
    expect(verifyIntegrity(withSkills).valid).toBe(true);
  });
});

// ─── Fix pass (reviewer + Aegis) ───────────────────────

describe('hardening', () => {
  it('H1: traversal ids are rejected everywhere', () => {
    writeSource(globDir(), 'demo-skill');
    for (const bad of ['../x', 'a/b', '..', 'A_B', '']) {
      expect(resolveSkill(bad, env)).toBeNull();
      expect(() => projectedSkillDir(bad, 'user', env)).toThrow(/invalid skill id/);
      expect(projectSkill(bad, { env }).refused).toBe('invalid-id');
      expect(adoptSkill(bad, { env }).refused).toBe('invalid-id');
      expect(buildSkillUsageRow(`pdg-${bad}`, { rootDir: root, homedir: home })).toBeNull();
    }
    expect(path.dirname(projectedSkillDir('demo-skill', 'user', env))).toBe(path.join(home, '.claude', 'skills'));
  });

  it('key invariant: dir name ≠ meta.id is a lint error and blocks projection', () => {
    writeSource(globDir(), 'demo-skill', { id: 'other-id' });
    const s = resolveSkill('demo-skill', env)!;
    expect(lintSkill(s, env).find(i => i.code === 'DIR_ID_MISMATCH')?.level).toBe('error');
    expect(projectSkill('demo-skill', { env, allowProvisional: true }).refused).toBe('id-mismatch');
    expect(projectSkill(s, { env, allowProvisional: true }).refused).toBe('id-mismatch');
  });

  it('H2: a forged certified block with no ledger row is uncertified and will not project', () => {
    writeSource(globDir(), 'demo-skill');
    const forged = certify('demo-skill', { ledger: false });
    expect(forged.metadata.paradigm.trust).toBe('certified');
    expect(isCertificationValid(forged, ledger())).toBe(false);
    expect(computeStatus(forged, { ledger: ledger() })).toBe('uncertified');
    expect(projectSkill('demo-skill', { env }).refused).toBe('untrusted');
    // A row with the wrong contentHash does not count either.
    appendClassroomCertification(root, { ...buildSkillCertRow(forged, forged.metadata.paradigm.certification!), contentHash: 'sha256:00' });
    expect(computeStatus(forged, { ledger: ledger() })).toBe('uncertified');
  });

  it('certification is global: a global-ledger row validates in another project', () => {
    writeSource(globDir(), 'demo-skill');
    const c = certify('demo-skill', { ledger: false });
    appendGlobalSkillCertRow(env, buildSkillCertRow(c, c.metadata.paradigm.certification!));
    const other = { rootDir: path.join(tmp, 'other-proj'), homedir: home };
    expect(computeStatus(c, { ledger: loadSkillCertLedger(other) })).toBe('ok');
  });

  it('M1: scripts/ withheld for provisional projections; listed with hashes for certify', () => {
    const dir = writeSource(globDir(), 'demo-skill');
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.writeFileSync(path.join(dir, 'scripts', 'run.sh'), 'echo hi');
    const r = projectSkill('demo-skill', { env, allowProvisional: true });
    expect(r.ok && r.scriptsWithheld).toBe(true);
    expect(fs.existsSync(path.join(r.dest, 'scripts'))).toBe(false);
    expect(readMarker(r.dest)!.scriptsWithheld).toBe(true);
    const scripts = listSkillScripts(resolveSkill('demo-skill', env)!);
    expect(scripts).toEqual([{ path: 'scripts/run.sh', sha256: expect.stringMatching(/^[0-9a-f]{64}$/), bytes: 7 }]);
    certify('demo-skill');
    const r2 = projectSkill('demo-skill', { env });
    expect(r2.scriptsWithheld).toBe(false);
    expect(fs.readFileSync(path.join(r2.dest, 'scripts', 'run.sh'), 'utf8')).toBe('echo hi');
  });

  it('M2: adopt refuses widened allowed-tools unless confirmed; reports the diff', () => {
    writeSource(globDir(), 'demo-skill', {}, BODY, { 'allowed-tools': 'Read Grep' });
    certify('demo-skill');
    const r = projectSkill('demo-skill', { env });
    const md = path.join(r.dest, 'SKILL.md');
    fs.writeFileSync(md, fs.readFileSync(md, 'utf8').replace('allowed-tools: Read Grep', 'allowed-tools: Read Grep Bash(rm:*)').replace('The demo-skill skill', 'Changed desc'));
    const a = adoptSkill('demo-skill', { env });
    expect(a.refused).toBe('allowed-tools-widened');
    expect(a.frontmatterDiff!.allowedTools).toMatchObject({ added: ['Bash(rm:*)'], widened: true });
    expect(a.frontmatterDiff!.description).toEqual({ from: 'The demo-skill skill', to: 'Changed desc' });
    const ok = adoptSkill('demo-skill', { env, confirmAllowedTools: true });
    expect(ok.ok).toBe(true);
    expect(resolveSkill('demo-skill', env)!['allowed-tools']).toBe('Read Grep Bash(rm:*)');
    expect(parseAllowedTools('Read, Bash(git log:*) Grep')).toEqual(['Read', 'Bash(git log:*)', 'Grep']);
  });

  it('adopt refuses when the source changed since projection unless forced', () => {
    const dir = writeSource(globDir(), 'demo-skill');
    certify('demo-skill');
    const r = projectSkill('demo-skill', { env });
    fs.appendFileSync(path.join(r.dest, 'SKILL.md'), '\ndownstream\n');
    fs.appendFileSync(path.join(dir, 'SKILL.md'), '\nupstream\n');
    expect(adoptSkill('demo-skill', { env }).refused).toBe('source-changed');
    expect(adoptSkill('demo-skill', { env, force: true }).ok).toBe(true);
  });

  it('adopt lints before re-projecting: lint errors → source written, dest untouched', () => {
    writeSource(globDir(), 'demo-skill');
    certify('demo-skill');
    const r = projectSkill('demo-skill', { env });
    const md = path.join(r.dest, 'SKILL.md');
    fs.appendFileSync(md, '4. Edit packages/app/src/main.ts\n');
    const before = fs.readFileSync(md, 'utf8');
    const a = adoptSkill('demo-skill', { env });
    expect(a.ok).toBe(true);
    expect(a.reprojected).toBe(false);
    expect(a.lint!.some(i => i.code === 'SKILL_IS_PROTOCOL')).toBe(true);
    expect(resolveSkill('demo-skill', env)!.metadata.paradigm.version).toBe('1.0.1');
    expect(fs.readFileSync(md, 'utf8')).toBe(before);
    expect(readMarker(r.dest)!.version).toBe('1.0.0');
  });

  it('adopt refuses a non-semver source version', () => {
    writeSource(globDir(), 'demo-skill', { version: '../../evil' });
    const dest = projectedSkillDir('demo-skill', 'user', env);
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'SKILL.md'), 'x');
    expect(adoptSkill('demo-skill', { env }).refused).toBe('invalid-version');
  });

  it('certify: a probe without an agent or with an unknown agent is not a peer; missing fixture refuses', () => {
    writeSource(globDir(), 'demo-skill');
    const s = resolveSkill('demo-skill', env)!;
    const key = skillKey('demo-skill', '1.0.0');
    fs.mkdirSync(path.join(root, 'fx'), { recursive: true });
    fs.writeFileSync(path.join(root, 'fx', 'bad.css'), 'x');
    const sc = (probeAgent: any, fixture = 'fx/bad.css'): Scenario => ({
      id: 'sc', scenario: 's', origin: 'authored', fixture,
      probes: [{ agent: probeAgent, learning_ref: key, claim: 'c' }], expected: { must: 'survive' },
      outcome_history: [{ term: key, agent: 'designer', result: 'survived', assessor: 'x', human_confirmed: true, at: 'x' }],
      repeat_failures: 0, status: 'active',
    });
    const opts = { env, founder: 'matt', tty: true, project: 'p', lint: [], pins: checkPins(s) };
    expect(evaluateCertification(s, [sc(undefined)], opts).rejected[0].why).toMatch(/no peer probe/);
    expect(evaluateCertification(s, [sc('')], opts).ok).toBe(false);
    expect(evaluateCertification(s, [sc('ghost')], opts).rejected[0].why).toMatch(/known profile/);
    expect(evaluateCertification(s, [sc('ghost')], { ...opts, knownAgents: ['ghost'] }).ok).toBe(true);
    expect(evaluateCertification(s, [sc('a11y', 'fx/missing.css')], opts).rejected[0].why).toMatch(/fixture not found/);
    expect(evaluateCertification(s, [sc('a11y')], opts).ok).toBe(true);
  });

  it('L1: any symlink in the projected dir is drift; symlinked source resource dirs are rejected', () => {
    const dir = writeSource(globDir(), 'demo-skill');
    certify('demo-skill');
    const r = projectSkill('demo-skill', { env });
    fs.symlinkSync('/etc/hosts', path.join(r.dest, 'link'));
    expect(projectSkill('demo-skill', { env }).refused).toBe('drifted');
    expect(adoptSkill('demo-skill', { env }).refused).toBe('symlink');
    fs.rmSync(path.join(r.dest, 'link'));
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(dir, 'references'));
    const issues = lintSkill(resolveSkill('demo-skill', env)!, env);
    expect(issues.find(i => i.code === 'RESOURCE_SYMLINK')?.level).toBe('error');
  });

  it('.DS_Store and other dotfiles do not count as drift', () => {
    writeSource(globDir(), 'demo-skill');
    certify('demo-skill');
    const r = projectSkill('demo-skill', { env });
    fs.writeFileSync(path.join(r.dest, '.DS_Store'), 'junk');
    const again = projectSkill('demo-skill', { env });
    expect(again.ok).toBe(true);
    expect(again.unchanged).toBe(true);
    expect(adoptSkill('demo-skill', { env }).refused).toBe('no-changes');
  });

  it('stale .pdg-*.tmp-* dirs are swept; fresh ones are kept', () => {
    const skillsRoot = path.join(home, '.claude', 'skills');
    const stale = path.join(skillsRoot, '.pdg-x.tmp-1-aa');
    const fresh = path.join(skillsRoot, '.pdg-y.tmp-2-bb');
    fs.mkdirSync(stale, { recursive: true });
    fs.mkdirSync(fresh, { recursive: true });
    const old = new Date(Date.now() - 60 * 60 * 1000);
    fs.utimesSync(stale, old, old);
    writeSource(globDir(), 'demo-skill');
    certify('demo-skill');
    projectSkill('demo-skill', { env });
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(sweepStaleTemps(skillsRoot)).toEqual([]);
  });

  it('NOTEBOOK_MISSING is a warning for bundled skills, an error otherwise', () => {
    writeSource(globDir(), 'demo-skill', { notebooks: ['designer/nb-nope'], provenance: { source: 'bundled', createdBy: 'designer' } });
    const bundled = lintSkill(resolveSkill('demo-skill', env)!, env);
    expect(bundled.find(i => i.code === 'NOTEBOOK_MISSING')?.level).toBe('warn');
    expect(hasLintErrors(bundled)).toBe(false);
    writeSource(globDir(), 'demo-skill', { notebooks: ['designer/nb-nope'] });
    expect(lintSkill(resolveSkill('demo-skill', env)!, env).find(i => i.code === 'NOTEBOOK_MISSING')?.level).toBe('error');
  });

  it('L2: usage row uses the marker skillId; CLAUDE_PROJECT_DIR beats payload cwd', () => {
    writeSource(globDir(), 'demo-skill');
    certify('demo-skill');
    const r = projectSkill('demo-skill', { env, target: 'project' });
    const row = buildSkillUsageRow('pdg-demo-skill', { rootDir: root, homedir: home })!;
    expect(row.skillId).toBe('demo-skill');
    // A marker naming a different skill is not trusted.
    const mk = path.join(r.dest, '.pdg-generated.json');
    fs.writeFileSync(mk, JSON.stringify({ ...JSON.parse(fs.readFileSync(mk, 'utf8')), skillId: 'evil' }));
    expect(buildSkillUsageRow('pdg-demo-skill', { rootDir: root, homedir: home })).toBeNull();
    expect(resolveHookProjectDir({ env: { CLAUDE_PROJECT_DIR: '/a' }, payloadCwd: '/b' })).toBe('/a');
    expect(resolveHookProjectDir({ env: {}, payloadCwd: '/b' })).toBe('/b');
  });

  it('enrichment status is cheap: no notebook scan (structural lint only)', () => {
    writeSource(globDir(), 'demo-skill', { notebooks: ['designer/nb-nope'] });
    const p = { id: 'designer', role: 'designer', skills: [{ id: 'demo-skill', role: 'owns' }] } as unknown as AgentProfile;
    // Full lint would error (missing notebook); enrichment does not scan notebooks.
    expect(resolveAgentSkills(p, env)[0].status).toBe('uncertified');
  });
});
