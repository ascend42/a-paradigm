/**
 * The Classroom — .syllabus artifact (TD-2026-06-19-007).
 *
 * Proves the gate-zero instrument: record → load → version bump, and that
 * validateSyllabus correctly recomputes status — current / stale (a referenced
 * notebook is newer than last_ratified) / broken (a source ref no longer
 * resolves) / expired (term TTL passed).
 *
 * loadNotebookEntries (which validateSyllabus calls) resolves GLOBAL_NOTEBOOKS_DIR
 * from os.homedir() at module-load. We mock os.homedir BEFORE import so it
 * resolves to a temp dir; all fixtures use PROJECT scope so the test never
 * touches the developer's real ~/.paradigm/notebooks.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';

const shared = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const nodeFs = require('fs') as typeof import('fs');
  const nodePath = require('path') as typeof import('path');
  const nodeOs = require('os') as typeof import('os');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const mockHome = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'syl-mock-home-'));
  return { mockHome };
});

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => shared.mockHome };
});

import {
  recordSyllabus,
  loadSyllabi,
  loadLatestSyllabus,
  validateSyllabus,
  rebuildSyllabusIndex,
} from './syllabus-loader.js';
import { recordScenario } from './scenario-loader.js';
import type { NotebookEntry } from '../types/notebooks.js';

let projectDir: string;
const globalNotebooksBase = path.join(shared.mockHome, '.paradigm', 'notebooks');

const AGENT = 'builder';
const NB_ID = 'nb-builder-auth-pattern';

function writeProjectNotebook(entry: NotebookEntry, agentId = AGENT): void {
  const dir = path.join(projectDir, '.paradigm', 'notebooks', agentId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${entry.id}.yaml`), yaml.dump(entry, { lineWidth: 120, noRefs: true }));
}

function makeNotebook(overrides: Partial<NotebookEntry> = {}): NotebookEntry {
  return {
    id: overrides.id ?? NB_ID,
    context: 'auth',
    snippet: 'app.use(authMiddleware)',
    provenance: { source: 'lore' },
    appliedCount: 0,
    confidence: 0.8,
    concepts: ['auth'],
    tags: [],
    created: '2026-01-01T00:00:00.000Z',
    updated: overrides.updated ?? '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const baseSyllabus = (overrides: Record<string, unknown> = {}) => ({
  agent: AGENT,
  sources: [{ kind: 'notebook' as const, ref: NB_ID, trust: 'certified' as const }],
  scope: 'project-specific' as const,
  success_criteria: [{ probe: 'SC-x', must: 'survive' as const }],
  notebook_target: 'local' as const,
  approved_by: 'gate',
  term_ttl_days: 30,
  last_ratified: '2026-06-01T00:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'syl-project-'));
  if (fs.existsSync(globalNotebooksBase)) {
    fs.rmSync(globalNotebooksBase, { recursive: true, force: true });
  }
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(shared.mockHome, { recursive: true, force: true });
});

describe('recordSyllabus / load', () => {
  it('records → loads → bumps version on re-ratify', async () => {
    writeProjectNotebook(makeNotebook());

    const id1 = await recordSyllabus(projectDir, baseSyllabus());
    expect(id1).toBe(`SY-${AGENT}`);

    const first = await loadLatestSyllabus(projectDir, AGENT);
    expect(first?.version).toBe(1);
    expect(first?.agent).toBe(AGENT);
    expect(first?.status).toBe('current');

    // Re-ratify → version bumps.
    await recordSyllabus(projectDir, baseSyllabus());
    const second = await loadLatestSyllabus(projectDir, AGENT);
    expect(second?.version).toBe(2);

    const all = await loadSyllabi(projectDir);
    expect(all).toHaveLength(1); // one file per agent
  });
});

describe('validateSyllabus — status recomputation', () => {
  it('current when every notebook source resolves and is not newer than ratification', async () => {
    writeProjectNotebook(makeNotebook({ updated: '2026-05-01T00:00:00.000Z' }));
    await recordSyllabus(projectDir, baseSyllabus());
    const s = await loadLatestSyllabus(projectDir, AGENT);
    expect(validateSyllabus(projectDir, s!).status).toBe('current');
  });

  it('stale when a referenced notebook was updated AFTER last_ratified', async () => {
    // ratified 2026-06-01, notebook updated 2026-06-10 → stale.
    writeProjectNotebook(makeNotebook({ updated: '2026-06-10T00:00:00.000Z' }));
    await recordSyllabus(projectDir, baseSyllabus({ last_ratified: '2026-06-01T00:00:00.000Z' }));
    const s = await loadLatestSyllabus(projectDir, AGENT);
    const v = validateSyllabus(projectDir, s!);
    expect(v.status).toBe('stale');
    expect(v.issues.join(' ')).toContain(NB_ID);
  });

  it('broken when a notebook source ref no longer resolves', async () => {
    // No notebook written → the ref is dangling.
    await recordSyllabus(projectDir, baseSyllabus());
    const s = await loadLatestSyllabus(projectDir, AGENT);
    const v = validateSyllabus(projectDir, s!);
    expect(v.status).toBe('broken');
    expect(v.issues.join(' ')).toContain('missing');
  });

  it('broken when a scenario source ref no longer resolves', async () => {
    writeProjectNotebook(makeNotebook());
    await recordSyllabus(projectDir, baseSyllabus({
      sources: [
        { kind: 'notebook', ref: NB_ID, trust: 'certified' },
        { kind: 'scenario', ref: 'SC-does-not-exist' },
      ],
    }));
    const s = await loadLatestSyllabus(projectDir, AGENT);
    expect(validateSyllabus(projectDir, s!).status).toBe('broken');
  });

  it('current when a scenario source ref DOES resolve', async () => {
    writeProjectNotebook(makeNotebook());
    await recordScenario(projectDir, {
      id: 'SC-real',
      scenario: 'a real probe',
      probes: [{ agent: AGENT, learning_ref: NB_ID, claim: 'x' }],
      origin: 'authored',
      expected: { must: 'survive' },
    });
    await recordSyllabus(projectDir, baseSyllabus({
      sources: [
        { kind: 'notebook', ref: NB_ID, trust: 'certified' },
        { kind: 'scenario', ref: 'SC-real' },
      ],
    }));
    const s = await loadLatestSyllabus(projectDir, AGENT);
    expect(validateSyllabus(projectDir, s!).status).toBe('current');
  });

  it('expired when now > last_ratified + term_ttl_days', async () => {
    writeProjectNotebook(makeNotebook({ updated: '2020-01-01T00:00:00.000Z' }));
    // ratified long ago, short TTL → expired.
    await recordSyllabus(projectDir, baseSyllabus({
      last_ratified: '2020-01-01T00:00:00.000Z',
      term_ttl_days: 30,
    }));
    const s = await loadLatestSyllabus(projectDir, AGENT);
    expect(validateSyllabus(projectDir, s!).status).toBe('expired');
  });
});

describe('rebuildSyllabusIndex — health rollup', () => {
  it('reflects a broken syllabus in the health rollup and persists status', async () => {
    // builder: broken (dangling notebook ref). other-agent: current.
    await recordSyllabus(projectDir, baseSyllabus()); // no notebook → broken
    writeProjectNotebook(makeNotebook({ id: 'nb-mika-color', updated: '2026-05-01T00:00:00.000Z' }), 'mika');
    await recordSyllabus(projectDir, baseSyllabus({
      agent: 'mika',
      sources: [{ kind: 'notebook', ref: 'nb-mika-color', trust: 'certified' }],
    }));

    const index = await rebuildSyllabusIndex(projectDir);
    expect(index.health.total).toBe(2);
    expect(index.health.broken).toBe(1);
    expect(index.health.current).toBe(1);

    // Status persisted to disk (gate-zero reads it on next run).
    const builder = await loadLatestSyllabus(projectDir, AGENT);
    expect(builder?.status).toBe('broken');

    // Index file written.
    expect(fs.existsSync(path.join(projectDir, '.paradigm', 'curriculum', 'index.yaml'))).toBe(true);
  });

  it('reflects an expired syllabus in the health rollup', async () => {
    writeProjectNotebook(makeNotebook({ updated: '2020-01-01T00:00:00.000Z' }));
    await recordSyllabus(projectDir, baseSyllabus({
      last_ratified: '2020-01-01T00:00:00.000Z',
      term_ttl_days: 1,
    }));
    const index = await rebuildSyllabusIndex(projectDir);
    expect(index.health.expired).toBe(1);
  });
});
