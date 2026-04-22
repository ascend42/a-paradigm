/**
 * university-multi-tenant.test.ts — v5.39.0 / v6.0 University sub-phase 3.
 *
 * Integration test for the multi-tenant content-pack loader. Builds a tmp
 * project with a project pack + a discipline sub-pack, writes notes into
 * each via the loader's pack-root-aware write fns, and asserts:
 *
 *   - Each pack has its own pack.yaml with the expected shape.
 *   - Discipline sub-packs discover with parentPackId wired to the project
 *     pack's id.
 *   - Entries saved with an explicit packRoot land under the correct pack's
 *     content/ tree.
 *   - Entries carry a `pack_id` stamp matching their resolving pack.
 *   - Cross-pack address resolution works: bare ids resolve to the context's
 *     activePack; <pack-id>:<entry-id> form parses correctly.
 *   - v5-layout fallback: a `.paradigm/university/` directory WITHOUT
 *     `pack.yaml` still produces a usable fabricated manifest via
 *     loadOrFabricatePackManifest — preserving v5 implicit-project-pack
 *     behavior.
 *
 * Safety property preserved:
 *   Pack boundaries are honored on write. An entry saved into the `design`
 *   sub-pack cannot end up in the parent project pack's content/ tree.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  saveNote,
  saveQuiz,
  loadOrFabricatePackManifest,
  discoverDisciplineSubPacks,
  resolveDefaultPackRoot,
} from '../src/utils/university-loader.js';
import { discoverPacks, resolveEntryAddress } from '../src/utils/pack-loader.js';

function mktemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-multi-tenant-'));
}

function writePackYaml(dir: string, body: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pack.yaml'), body, 'utf8');
}

function scaffoldProjectPack(rootDir: string): string {
  const packRoot = path.join(rootDir, '.paradigm', 'university');
  writePackYaml(
    packRoot,
    [
      'id: acme-project',
      'name: Acme Onboarding',
      'version: 0.1.0',
      'schema_version: "1"',
      'tenant_kind: project',
      'description: Project pack.',
    ].join('\n'),
  );
  return packRoot;
}

function scaffoldDisciplineSubPack(projectPackRoot: string, discipline: string, id: string): string {
  const subRoot = path.join(projectPackRoot, discipline);
  writePackYaml(
    subRoot,
    [
      `id: ${id}`,
      `name: ${id}`,
      'version: 0.1.0',
      'schema_version: "1"',
      'tenant_kind: project',
      `description: ${discipline} sub-pack.`,
      `disciplines: [${discipline}]`,
    ].join('\n'),
  );
  return subRoot;
}

describe('university multi-tenant — pack scaffold shapes', () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('creates a project pack with a valid pack.yaml shape', () => {
    tmpDir = mktemp();
    const packRoot = scaffoldProjectPack(tmpDir);

    const manifest = loadOrFabricatePackManifest(packRoot);
    expect(manifest).not.toBeNull();
    expect(manifest!.id).toBe('acme-project');
    expect(manifest!.tenant_kind).toBe('project');
    expect(manifest!.version).toBe('0.1.0');
  });

  it('creates a discipline sub-pack with parent linkage via discovery', () => {
    tmpDir = mktemp();
    const packRoot = scaffoldProjectPack(tmpDir);
    scaffoldDisciplineSubPack(packRoot, 'design', 'acme-project-design');

    const subs = discoverDisciplineSubPacks(packRoot);
    expect(subs).toHaveLength(1);
    expect(subs[0].manifest.id).toBe('acme-project-design');
    expect(subs[0].parentPackId).toBe('acme-project');
    expect(subs[0].source).toBe('local');
  });
});

describe('university multi-tenant — CRUD across packs', () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('saves a note with pack_id stamp matching the resolving pack', () => {
    tmpDir = mktemp();
    const packRoot = scaffoldProjectPack(tmpDir);

    const filePath = saveNote(
      tmpDir,
      {
        id: 'N-onboarding',
        title: 'Welcome',
        type: 'note',
        author: 'tester',
        created: '2026-04-23',
        updated: '2026-04-23',
        tags: [],
        symbols: [],
      },
      'Welcome body',
      packRoot,
    );

    expect(fs.existsSync(filePath)).toBe(true);
    // Read the raw file to confirm the stamp landed on disk. (loadNote()
    // currently strips v6.0 frontmatter extension fields during normalize —
    // this test asserts on-disk persistence, which is the load-bearing bit.)
    const raw = fs.readFileSync(filePath, 'utf8');
    expect(raw).toContain('pack_id: acme-project');
  });

  it('saves notes into separate pack trees (sub-pack isolation)', () => {
    tmpDir = mktemp();
    const projectRoot = scaffoldProjectPack(tmpDir);
    const designRoot = scaffoldDisciplineSubPack(projectRoot, 'design', 'acme-project-design');

    saveNote(
      tmpDir,
      {
        id: 'N-engineering',
        title: 'Engineering Intro',
        type: 'note',
        author: 'tester',
        created: '2026-04-23',
        updated: '2026-04-23',
        tags: [],
        symbols: [],
      },
      'Engineering body',
      projectRoot,
    );
    saveNote(
      tmpDir,
      {
        id: 'N-design-basics',
        title: 'Design Basics',
        type: 'note',
        author: 'tester',
        created: '2026-04-23',
        updated: '2026-04-23',
        tags: [],
        symbols: [],
      },
      'Design body',
      designRoot,
    );

    // Engineering note MUST NOT appear in design subtree
    const designNotesDir = path.join(designRoot, 'content', 'notes');
    const engInDesign = path.join(designNotesDir, 'N-engineering.md');
    expect(fs.existsSync(engInDesign)).toBe(false);

    // Design note MUST NOT appear in project root's notes
    const projNotesDir = path.join(projectRoot, 'content', 'notes');
    const designInProj = path.join(projNotesDir, 'N-design-basics.md');
    expect(fs.existsSync(designInProj)).toBe(false);

    // Each lives where expected
    expect(fs.existsSync(path.join(projNotesDir, 'N-engineering.md'))).toBe(true);
    expect(fs.existsSync(path.join(designNotesDir, 'N-design-basics.md'))).toBe(true);
  });

  it('pack_id stamping reflects the sub-pack when writing via the sub-pack root', () => {
    tmpDir = mktemp();
    const projectRoot = scaffoldProjectPack(tmpDir);
    const designRoot = scaffoldDisciplineSubPack(projectRoot, 'design', 'acme-project-design');

    const filePath = saveNote(
      tmpDir,
      {
        id: 'N-tokens',
        title: 'Design Tokens',
        type: 'note',
        author: 'tester',
        created: '2026-04-23',
        updated: '2026-04-23',
        tags: [],
        symbols: [],
      },
      'Token body',
      designRoot,
    );

    const raw = fs.readFileSync(filePath, 'utf8');
    expect(raw).toContain('pack_id: acme-project-design');
  });

  it('saves quizzes into the correct pack with pack_id stamp', () => {
    tmpDir = mktemp();
    const packRoot = scaffoldProjectPack(tmpDir);

    const filePath = saveQuiz(
      tmpDir,
      {
        id: 'Q-welcome',
        title: 'Welcome Quiz',
        author: 'tester',
        created: '2026-04-23',
        updated: '2026-04-23',
        tags: [],
        symbols: [],
        difficulty: 'beginner',
        passThreshold: 0.7,
        questions: [
          {
            id: 'q1',
            question: 'What is this?',
            choices: { A: 'a', B: 'b' },
            correct: 'A',
            explanation: 'because a',
          },
        ],
      },
      packRoot,
    );
    expect(fs.existsSync(filePath)).toBe(true);
    const raw = fs.readFileSync(filePath, 'utf8');
    expect(raw).toContain('pack_id: acme-project');
  });
});

describe('university multi-tenant — discovery + addressing', () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('discoverPacks returns project + sub-pack with source=local', () => {
    tmpDir = mktemp();
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'host', version: '0.0.0' }),
      'utf8',
    );
    const packRoot = scaffoldProjectPack(tmpDir);
    scaffoldDisciplineSubPack(packRoot, 'design', 'acme-project-design');

    const packs = discoverPacks(tmpDir);
    const ids = packs.map(p => p.manifest.id).sort();
    expect(ids).toContain('acme-project');
    expect(ids).toContain('acme-project-design');

    for (const p of packs) {
      expect(p.source).toBe('local');
    }
  });

  it('resolves bare entry id to activePack and <pack-id>:<entry-id> form explicitly', () => {
    const bare = resolveEntryAddress('N-welcome', { activePack: 'acme-project' });
    expect(bare).toEqual({ packId: 'acme-project', entryId: 'N-welcome' });

    const explicit = resolveEntryAddress('acme-project-design:N-tokens', {
      activePack: 'acme-project',
    });
    expect(explicit).toEqual({ packId: 'acme-project-design', entryId: 'N-tokens' });
  });

  it('cross-pack reference address parses and retains pack-id prefix', () => {
    // A quiz in the design sub-pack might reference a prerequisite note from
    // the parent project pack via "acme-project:N-welcome".
    const r = resolveEntryAddress('acme-project:N-welcome', {
      activePack: 'acme-project-design',
    });
    expect(r.packId).toBe('acme-project');
    expect(r.entryId).toBe('N-welcome');
  });
});

describe('university multi-tenant — v5-layout fallback', () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('loadOrFabricatePackManifest fabricates an implicit manifest when pack.yaml is absent', () => {
    tmpDir = mktemp();
    // v5 layout — just .paradigm/university/ with no pack.yaml
    const localRoot = path.join(tmpDir, '.paradigm', 'university');
    fs.mkdirSync(localRoot, { recursive: true });

    const manifest = loadOrFabricatePackManifest(localRoot);
    expect(manifest).not.toBeNull();
    expect(manifest!.tenant_kind).toBe('project');
    // Fabricated manifest uses the directory name as the id
    expect(typeof manifest!.id).toBe('string');
    expect(manifest!.id.length).toBeGreaterThan(0);
  });

  it('resolveDefaultPackRoot prefers existing .paradigm/university/ regardless of pack.yaml presence', () => {
    tmpDir = mktemp();
    const localRoot = path.join(tmpDir, '.paradigm', 'university');
    fs.mkdirSync(localRoot, { recursive: true });

    const resolved = resolveDefaultPackRoot(tmpDir);
    expect(resolved).toBe(localRoot);
  });

  it('saveNote to an implicit v5 project pack still works and stamps a fabricated pack_id', () => {
    tmpDir = mktemp();
    const localRoot = path.join(tmpDir, '.paradigm', 'university');
    fs.mkdirSync(localRoot, { recursive: true });

    const filePath = saveNote(
      tmpDir,
      {
        id: 'N-legacy',
        title: 'Legacy',
        type: 'note',
        author: 'tester',
        created: '2026-04-23',
        updated: '2026-04-23',
        tags: [],
        symbols: [],
      },
      'Legacy body',
      localRoot,
    );

    // Fabricated manifest uses basename of packRoot ("university") as id.
    // Read raw — loadNote() currently drops pack_id during normalize.
    const raw = fs.readFileSync(filePath, 'utf8');
    expect(raw).toContain('pack_id: university');
  });
});
