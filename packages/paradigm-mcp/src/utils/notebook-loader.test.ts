/**
 * Tests for notebook-loader — CRUD for agent notebook entries
 *
 * notebook-loader.ts computes GLOBAL_NOTEBOOKS_DIR at module load time via
 * os.homedir(). We mock os.homedir() before the module is imported so the
 * constant resolves to a temp directory we control. This mock-home directory
 * persists for the entire test file; each test cleans its agent subdirectories
 * to ensure isolation.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';

// Create a stable mock-home directory before the module is imported.
// vi.hoisted runs before vi.mock factories and before imports.
const shared = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const nodeFs = require('fs') as typeof import('fs');
  const nodePath = require('path') as typeof import('path');
  const nodeOs = require('os') as typeof import('os');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const mockHome = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'nb-mock-home-'));
  return { mockHome };
});

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: () => shared.mockHome,
  };
});

// Imported AFTER the mock — GLOBAL_NOTEBOOKS_DIR will use shared.mockHome
import {
  loadNotebookEntries,
  searchNotebooks,
  addNotebookEntry,
  incrementApplied,
  promoteFromLore,
} from './notebook-loader.js';

import type { NotebookEntry } from '../types/notebooks.js';

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────

let projectDir: string;

/** Path to the global notebooks directory the module will actually use */
const globalNotebooksBase = path.join(shared.mockHome, '.paradigm', 'notebooks');

function makeEntry(overrides: Partial<NotebookEntry> = {}): NotebookEntry {
  return {
    id: overrides.id || 'nb-test-001',
    context: overrides.context || 'Test context',
    snippet: overrides.snippet || 'Test snippet',
    provenance: overrides.provenance || { source: 'manual' },
    appliedCount: overrides.appliedCount ?? 0,
    confidence: overrides.confidence ?? 0.8,
    concepts: overrides.concepts || ['testing'],
    tags: overrides.tags || ['unit-test'],
    created: overrides.created || '2026-01-01T00:00:00.000Z',
    updated: overrides.updated || '2026-01-01T00:00:00.000Z',
  };
}

function writeNotebookYaml(baseDir: string, agentId: string, entry: NotebookEntry): string {
  const agentDir = path.join(baseDir, agentId);
  if (!fs.existsSync(agentDir)) {
    fs.mkdirSync(agentDir, { recursive: true });
  }
  const filePath = path.join(agentDir, `${entry.id}.yaml`);
  fs.writeFileSync(filePath, yaml.dump(entry, { lineWidth: 120, noRefs: true }));
  return filePath;
}

function writeProjectNotebook(entry: NotebookEntry, agentId: string = 'test-agent'): string {
  const nbDir = path.join(projectDir, '.paradigm', 'notebooks');
  return writeNotebookYaml(nbDir, agentId, entry);
}

function writeGlobalNotebook(entry: NotebookEntry, agentId: string = 'test-agent'): string {
  return writeNotebookYaml(globalNotebooksBase, agentId, entry);
}

// ────────────────────────────────────────────────────────
// Setup / Teardown
// ────────────────────────────────────────────────────────

beforeEach(() => {
  // Fresh project directory per test
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-project-'));

  // Clean the global notebooks area between tests
  if (fs.existsSync(globalNotebooksBase)) {
    fs.rmSync(globalNotebooksBase, { recursive: true, force: true });
  }
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

afterAll(() => {
  // Remove the mock-home directory
  fs.rmSync(shared.mockHome, { recursive: true, force: true });
});

// ────────────────────────────────────────────────────────
// loadNotebookEntries
// ────────────────────────────────────────────────────────

describe('loadNotebookEntries', () => {
  it('returns empty array when directories do not exist', () => {
    const result = loadNotebookEntries('test-agent', projectDir);
    expect(result).toEqual([]);
  });

  it('loads entries from project directory', () => {
    const entry = makeEntry({ id: 'nb-project-001' });
    writeProjectNotebook(entry);

    const result = loadNotebookEntries('test-agent', projectDir);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('nb-project-001');
  });

  it('loads entries from global directory', () => {
    const entry = makeEntry({ id: 'nb-global-001' });
    writeGlobalNotebook(entry);

    const result = loadNotebookEntries('test-agent', projectDir);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('nb-global-001');
  });

  it('deduplicates by id with project entries winning over global', () => {
    const globalEntry = makeEntry({
      id: 'nb-shared-001',
      context: 'Global context',
      snippet: 'Global snippet',
    });
    const projectEntry = makeEntry({
      id: 'nb-shared-001',
      context: 'Project context',
      snippet: 'Project snippet',
    });

    writeGlobalNotebook(globalEntry);
    writeProjectNotebook(projectEntry);

    const result = loadNotebookEntries('test-agent', projectDir);
    expect(result).toHaveLength(1);
    expect(result[0].context).toBe('Project context');
    expect(result[0].snippet).toBe('Project snippet');
  });

  it('merges entries from both global and project directories', () => {
    const globalEntry = makeEntry({ id: 'nb-global-001' });
    const projectEntry = makeEntry({ id: 'nb-project-001' });

    writeGlobalNotebook(globalEntry);
    writeProjectNotebook(projectEntry);

    const result = loadNotebookEntries('test-agent', projectDir);
    expect(result).toHaveLength(2);
    const ids = result.map(e => e.id);
    expect(ids).toContain('nb-global-001');
    expect(ids).toContain('nb-project-001');
  });

  it('filters by concepts (case-insensitive)', () => {
    writeProjectNotebook(makeEntry({ id: 'nb-auth-001', concepts: ['Auth', 'JWT'] }));
    writeProjectNotebook(makeEntry({ id: 'nb-db-001', concepts: ['Database'] }));

    const result = loadNotebookEntries('test-agent', projectDir, {
      concepts: ['auth'],
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('nb-auth-001');
  });

  it('filters by tags (case-insensitive)', () => {
    writeProjectNotebook(makeEntry({ id: 'nb-a-001', tags: ['Security', 'Critical'] }));
    writeProjectNotebook(makeEntry({ id: 'nb-b-001', tags: ['performance'] }));

    const result = loadNotebookEntries('test-agent', projectDir, {
      tags: ['security'],
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('nb-a-001');
  });

  it('sorts results by appliedCount descending', () => {
    writeProjectNotebook(makeEntry({ id: 'nb-low-001', appliedCount: 1 }));
    writeProjectNotebook(makeEntry({ id: 'nb-high-001', appliedCount: 10 }));
    writeProjectNotebook(makeEntry({ id: 'nb-mid-001', appliedCount: 5 }));

    const result = loadNotebookEntries('test-agent', projectDir);
    expect(result.map(e => e.id)).toEqual([
      'nb-high-001',
      'nb-mid-001',
      'nb-low-001',
    ]);
  });

  it('ignores files that do not match the nb- prefix', () => {
    const agentDir = path.join(projectDir, '.paradigm', 'notebooks', 'test-agent');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, 'random-file.yaml'),
      yaml.dump(makeEntry({ id: 'nb-random-001' })),
    );

    const result = loadNotebookEntries('test-agent', projectDir);
    expect(result).toEqual([]);
  });

  it('skips malformed YAML files gracefully', () => {
    const agentDir = path.join(projectDir, '.paradigm', 'notebooks', 'test-agent');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'nb-broken.yaml'), '{{{{not yaml at all}}}}');

    writeProjectNotebook(makeEntry({ id: 'nb-valid-001' }));

    const result = loadNotebookEntries('test-agent', projectDir);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('nb-valid-001');
  });

  it('applies both concept and tag filters simultaneously', () => {
    writeProjectNotebook(makeEntry({
      id: 'nb-match-001',
      concepts: ['auth'],
      tags: ['critical'],
    }));
    writeProjectNotebook(makeEntry({
      id: 'nb-concept-only-001',
      concepts: ['auth'],
      tags: ['low-priority'],
    }));
    writeProjectNotebook(makeEntry({
      id: 'nb-tag-only-001',
      concepts: ['database'],
      tags: ['critical'],
    }));

    const result = loadNotebookEntries('test-agent', projectDir, {
      concepts: ['auth'],
      tags: ['critical'],
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('nb-match-001');
  });
});

// ────────────────────────────────────────────────────────
// searchNotebooks
// ────────────────────────────────────────────────────────

describe('searchNotebooks', () => {
  it('matches query against context text', () => {
    writeProjectNotebook(makeEntry({
      id: 'nb-ctx-001',
      context: 'Use this when handling authentication flows',
    }));
    writeProjectNotebook(makeEntry({
      id: 'nb-other-001',
      context: 'Database migration pattern',
    }));

    const result = searchNotebooks('test-agent', 'authentication', projectDir);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('nb-ctx-001');
  });

  it('matches query against snippet text', () => {
    writeProjectNotebook(makeEntry({
      id: 'nb-snip-001',
      snippet: 'const token = jwt.sign(payload, secret)',
    }));
    writeProjectNotebook(makeEntry({
      id: 'nb-other-001',
      snippet: 'SELECT * FROM users',
    }));

    const result = searchNotebooks('test-agent', 'jwt.sign', projectDir);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('nb-snip-001');
  });

  it('matches query against concept names', () => {
    writeProjectNotebook(makeEntry({
      id: 'nb-concept-001',
      concepts: ['middleware', 'express'],
    }));
    writeProjectNotebook(makeEntry({
      id: 'nb-other-001',
      concepts: ['database'],
    }));

    const result = searchNotebooks('test-agent', 'middleware', projectDir);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('nb-concept-001');
  });

  it('matches query against tag names', () => {
    writeProjectNotebook(makeEntry({
      id: 'nb-tag-001',
      tags: ['security', 'production'],
    }));
    writeProjectNotebook(makeEntry({
      id: 'nb-other-001',
      tags: ['testing'],
    }));

    const result = searchNotebooks('test-agent', 'security', projectDir);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('nb-tag-001');
  });

  it('returns empty array when no entries match', () => {
    writeProjectNotebook(makeEntry({ id: 'nb-unrelated-001' }));

    const result = searchNotebooks('test-agent', 'nonexistent-query-xyz', projectDir);
    expect(result).toEqual([]);
  });

  it('is case-insensitive', () => {
    writeProjectNotebook(makeEntry({
      id: 'nb-case-001',
      context: 'JWT Authentication Handler',
    }));

    const result = searchNotebooks('test-agent', 'jwt authentication', projectDir);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('nb-case-001');
  });

  it('returns empty array from empty directory', () => {
    const result = searchNotebooks('test-agent', 'anything', projectDir);
    expect(result).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────
// addNotebookEntry
// ────────────────────────────────────────────────────────

describe('addNotebookEntry', () => {
  it('creates a YAML file on disk in project scope', () => {
    const { entry, filePath } = addNotebookEntry(
      'test-agent',
      {
        context: 'When implementing auth middleware',
        snippet: 'app.use(authMiddleware)',
        provenance: { source: 'manual' },
        confidence: 0.9,
        concepts: ['auth', 'middleware'],
        tags: ['pattern'],
      },
      'project',
      projectDir,
    );

    expect(fs.existsSync(filePath)).toBe(true);
    expect(filePath).toContain(path.join('.paradigm', 'notebooks', 'test-agent'));

    const written = yaml.load(fs.readFileSync(filePath, 'utf-8')) as NotebookEntry;
    expect(written.id).toBe(entry.id);
    expect(written.context).toBe('When implementing auth middleware');
  });

  it('generates id from first concept slug', () => {
    const { entry } = addNotebookEntry(
      'test-agent',
      {
        context: 'Test',
        snippet: 'Test',
        provenance: { source: 'manual' },
        confidence: 0.5,
        concepts: ['JWT Tokens', 'auth'],
        tags: [],
      },
      'project',
      projectDir,
    );

    // ID should start with nb-jwt-tokens- (slugified first concept)
    expect(entry.id).toMatch(/^nb-jwt-tokens-[a-z0-9]+$/);
  });

  it('falls back to "entry" slug when concepts are empty', () => {
    const { entry } = addNotebookEntry(
      'test-agent',
      {
        context: 'Test',
        snippet: 'Test',
        provenance: { source: 'manual' },
        confidence: 0.5,
        concepts: [],
        tags: [],
      },
      'project',
      projectDir,
    );

    expect(entry.id).toMatch(/^nb-entry-[a-z0-9]+$/);
  });

  it('sets correct defaults for appliedCount, created, and updated', () => {
    const before = new Date().toISOString();

    const { entry } = addNotebookEntry(
      'test-agent',
      {
        context: 'Test',
        snippet: 'Test',
        provenance: { source: 'manual' },
        confidence: 0.7,
        concepts: ['test'],
        tags: [],
      },
      'project',
      projectDir,
    );

    const after = new Date().toISOString();

    expect(entry.appliedCount).toBe(0);
    expect(entry.created).toBeTruthy();
    expect(entry.updated).toBeTruthy();
    expect(entry.created).toBe(entry.updated);
    // Timestamps should be between before and after
    expect(entry.created >= before).toBe(true);
    expect(entry.created <= after).toBe(true);
  });

  it('creates directory structure if it does not exist', () => {
    const agentDir = path.join(projectDir, '.paradigm', 'notebooks', 'new-agent');
    expect(fs.existsSync(agentDir)).toBe(false);

    addNotebookEntry(
      'new-agent',
      {
        context: 'Test',
        snippet: 'Test',
        provenance: { source: 'manual' },
        confidence: 0.5,
        concepts: ['test'],
        tags: [],
      },
      'project',
      projectDir,
    );

    expect(fs.existsSync(agentDir)).toBe(true);
  });

  it('writes to global directory when scope is global', () => {
    const { filePath } = addNotebookEntry(
      'test-agent',
      {
        context: 'Global pattern',
        snippet: 'reusable code',
        provenance: { source: 'manual' },
        confidence: 0.8,
        concepts: ['global'],
        tags: [],
      },
      'global',
    );

    expect(filePath).toContain(path.join(shared.mockHome, '.paradigm', 'notebooks', 'test-agent'));
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('writes to project directory when scope is project', () => {
    const { filePath } = addNotebookEntry(
      'test-agent',
      {
        context: 'Project pattern',
        snippet: 'project code',
        provenance: { source: 'manual' },
        confidence: 0.8,
        concepts: ['project'],
        tags: [],
      },
      'project',
      projectDir,
    );

    expect(filePath).toContain(projectDir);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('preserves all input fields in the written entry', () => {
    const { entry } = addNotebookEntry(
      'test-agent',
      {
        context: 'When you need caching',
        snippet: 'cache.set(key, value, ttl)',
        provenance: { source: 'lore', loreEntryId: 'L-2026-01-01-001' },
        confidence: 0.95,
        concepts: ['caching', 'performance'],
        tags: ['pattern', 'optimization'],
      },
      'project',
      projectDir,
    );

    expect(entry.context).toBe('When you need caching');
    expect(entry.snippet).toBe('cache.set(key, value, ttl)');
    expect(entry.provenance.source).toBe('lore');
    expect(entry.provenance.loreEntryId).toBe('L-2026-01-01-001');
    expect(entry.confidence).toBe(0.95);
    expect(entry.concepts).toEqual(['caching', 'performance']);
    expect(entry.tags).toEqual(['pattern', 'optimization']);
  });
});

// ────────────────────────────────────────────────────────
// incrementApplied
// ────────────────────────────────────────────────────────

describe('incrementApplied', () => {
  it('increments appliedCount and updates timestamp', () => {
    const entry = makeEntry({
      id: 'nb-inc-001',
      appliedCount: 3,
      updated: '2026-01-01T00:00:00.000Z',
    });
    writeProjectNotebook(entry);

    const before = new Date().toISOString();
    const result = incrementApplied('test-agent', 'nb-inc-001', projectDir);
    const after = new Date().toISOString();

    expect(result).toBe(true);

    // Re-read from disk to verify
    const filePath = path.join(
      projectDir, '.paradigm', 'notebooks', 'test-agent', 'nb-inc-001.yaml',
    );
    const updated = yaml.load(fs.readFileSync(filePath, 'utf-8')) as NotebookEntry;
    expect(updated.appliedCount).toBe(4);
    expect(updated.updated >= before).toBe(true);
    expect(updated.updated <= after).toBe(true);
  });

  it('returns false for non-existent entry', () => {
    const result = incrementApplied('test-agent', 'nb-nonexistent-001', projectDir);
    expect(result).toBe(false);
  });

  it('prefers project directory entry over global', () => {
    const globalEntry = makeEntry({ id: 'nb-both-001', appliedCount: 10 });
    const projectEntry = makeEntry({ id: 'nb-both-001', appliedCount: 5 });

    writeGlobalNotebook(globalEntry);
    writeProjectNotebook(projectEntry);

    incrementApplied('test-agent', 'nb-both-001', projectDir);

    // Project file should have been incremented
    const projectPath = path.join(
      projectDir, '.paradigm', 'notebooks', 'test-agent', 'nb-both-001.yaml',
    );
    const projectUpdated = yaml.load(fs.readFileSync(projectPath, 'utf-8')) as NotebookEntry;
    expect(projectUpdated.appliedCount).toBe(6);

    // Global file should be unchanged
    const globalPath = path.join(
      shared.mockHome, '.paradigm', 'notebooks', 'test-agent', 'nb-both-001.yaml',
    );
    const globalUpdated = yaml.load(fs.readFileSync(globalPath, 'utf-8')) as NotebookEntry;
    expect(globalUpdated.appliedCount).toBe(10);
  });

  it('falls back to global directory when entry not in project', () => {
    const globalEntry = makeEntry({ id: 'nb-global-only-001', appliedCount: 2 });
    writeGlobalNotebook(globalEntry);

    const result = incrementApplied('test-agent', 'nb-global-only-001', projectDir);
    expect(result).toBe(true);

    const globalPath = path.join(
      shared.mockHome, '.paradigm', 'notebooks', 'test-agent', 'nb-global-only-001.yaml',
    );
    const updated = yaml.load(fs.readFileSync(globalPath, 'utf-8')) as NotebookEntry;
    expect(updated.appliedCount).toBe(3);
  });

  it('handles entry with zero appliedCount', () => {
    const entry = makeEntry({ id: 'nb-zero-001', appliedCount: 0 });
    writeProjectNotebook(entry);

    incrementApplied('test-agent', 'nb-zero-001', projectDir);

    const filePath = path.join(
      projectDir, '.paradigm', 'notebooks', 'test-agent', 'nb-zero-001.yaml',
    );
    const updated = yaml.load(fs.readFileSync(filePath, 'utf-8')) as NotebookEntry;
    expect(updated.appliedCount).toBe(1);
  });
});

// ────────────────────────────────────────────────────────
// promoteFromLore
// ────────────────────────────────────────────────────────

describe('promoteFromLore', () => {
  const LORE_DATE = '2026-01-01';
  const LORE_ID = `L-${LORE_DATE}-tester-000000-001`;

  function writeLoreEntry(
    rootDir: string,
    overrides: Record<string, unknown> = {},
  ): void {
    const dateDir = path.join(rootDir, '.paradigm', 'lore', 'entries', LORE_DATE);
    fs.mkdirSync(dateDir, { recursive: true });

    const loreEntry = {
      id: LORE_ID,
      type: 'agent-session',
      timestamp: `${LORE_DATE}T00:00:00.000Z`,
      author: 'tester',
      title: 'Test lore entry',
      summary: 'Summary of the lore entry',
      symbols_touched: ['#auth-middleware', '$login-flow'],
      tags: ['arc:auth', 'feature'],
      confidence: 0.85,
      body: 'Detailed body of the lore entry',
      ...overrides,
    };

    fs.writeFileSync(
      path.join(dateDir, `${LORE_ID}.yaml`),
      yaml.dump(loreEntry, { lineWidth: -1, noRefs: true }),
    );
  }

  it('creates a notebook entry from a lore entry', async () => {
    writeLoreEntry(projectDir);

    const result = await promoteFromLore('test-agent', LORE_ID, projectDir, 'project');

    expect(result).not.toBeNull();
    expect(result!.entry.id).toMatch(/^nb-/);
    expect(fs.existsSync(result!.filePath)).toBe(true);
  });

  it('sets provenance.source to lore', async () => {
    writeLoreEntry(projectDir);

    const result = await promoteFromLore('test-agent', LORE_ID, projectDir, 'project');

    expect(result!.entry.provenance.source).toBe('lore');
  });

  it('sets provenance.loreEntryId correctly', async () => {
    writeLoreEntry(projectDir);

    const result = await promoteFromLore('test-agent', LORE_ID, projectDir, 'project');

    expect(result!.entry.provenance.loreEntryId).toBe(LORE_ID);
  });

  it('extracts concepts from symbols_touched with prefix stripped', async () => {
    writeLoreEntry(projectDir, {
      symbols_touched: ['#auth-middleware', '$login-flow', '^authenticated'],
    });

    const result = await promoteFromLore('test-agent', LORE_ID, projectDir, 'project');

    expect(result!.entry.concepts).toEqual([
      'auth-middleware',
      'login-flow',
      'authenticated',
    ]);
  });

  it('includes summary in snippet', async () => {
    writeLoreEntry(projectDir, {
      summary: 'Summary text',
      body: 'Body text',
    });

    const result = await promoteFromLore('test-agent', LORE_ID, projectDir, 'project');

    expect(result!.entry.snippet).toContain('Summary text');
  });

  it('includes body in snippet after summary', async () => {
    writeLoreEntry(projectDir, {
      summary: 'Summary part',
      body: 'Body part',
    });

    const result = await promoteFromLore('test-agent', LORE_ID, projectDir, 'project');

    expect(result!.entry.snippet).toBe('Summary part\n\nBody part');
  });

  it('uses title as context', async () => {
    writeLoreEntry(projectDir, { title: 'My Lore Title' });

    const result = await promoteFromLore('test-agent', LORE_ID, projectDir, 'project');

    expect(result!.entry.context).toBe('My Lore Title');
  });

  it('copies tags from lore entry', async () => {
    writeLoreEntry(projectDir, { tags: ['arc:auth', 'feature', 'important'] });

    const result = await promoteFromLore('test-agent', LORE_ID, projectDir, 'project');

    expect(result!.entry.tags).toEqual(['arc:auth', 'feature', 'important']);
  });

  it('copies confidence from lore entry', async () => {
    writeLoreEntry(projectDir, { confidence: 0.85 });

    const result = await promoteFromLore('test-agent', LORE_ID, projectDir, 'project');

    expect(result!.entry.confidence).toBe(0.85);
  });

  it('defaults confidence to 0.7 when lore entry has no confidence', async () => {
    writeLoreEntry(projectDir, { confidence: undefined });

    const result = await promoteFromLore('test-agent', LORE_ID, projectDir, 'project');

    expect(result!.entry.confidence).toBe(0.7);
  });

  it('returns null for non-existent lore entry', async () => {
    const result = await promoteFromLore(
      'test-agent', 'L-2099-12-31-nobody-000000-001', projectDir, 'project',
    );

    expect(result).toBeNull();
  });

  it('defaults scope to global when not specified', async () => {
    writeLoreEntry(projectDir);

    const result = await promoteFromLore('test-agent', LORE_ID, projectDir);

    expect(result).not.toBeNull();
    // Global scope means the file is in shared.mockHome
    expect(result!.filePath).toContain(shared.mockHome);
  });

  it('sets provenance.originProject from rootDir basename', async () => {
    writeLoreEntry(projectDir);

    const result = await promoteFromLore('test-agent', LORE_ID, projectDir, 'project');

    expect(result!.entry.provenance.originProject).toBe(path.basename(projectDir));
  });

  it('sets provenance.createdBy to agentId', async () => {
    writeLoreEntry(projectDir);

    const result = await promoteFromLore('my-agent', LORE_ID, projectDir, 'project');

    expect(result!.entry.provenance.createdBy).toBe('my-agent');
  });

  it('handles lore entry with no body', async () => {
    writeLoreEntry(projectDir, { body: undefined, summary: 'Just a summary' });

    const result = await promoteFromLore('test-agent', LORE_ID, projectDir, 'project');

    expect(result!.entry.snippet).toBe('Just a summary');
  });

  it('handles lore entry with no symbols_touched', async () => {
    writeLoreEntry(projectDir, { symbols_touched: undefined });

    const result = await promoteFromLore('test-agent', LORE_ID, projectDir, 'project');

    expect(result!.entry.concepts).toEqual([]);
  });
});
