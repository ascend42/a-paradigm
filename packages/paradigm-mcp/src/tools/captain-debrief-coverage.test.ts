/**
 * T-2026-10-27-003 — Cid's debrief coverage (#captain, #purpose-coverage).
 *
 *  - A subdirectory documented by an ancestor .purpose counts as covered and
 *    gets no stub.
 *  - A truly uncovered directory: nothing is written into the tree; a paradigm
 *    task and a pending-review entry appear; coverage stays uncovered.
 *  - An existing TODO stub never counts as coverage.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { handleCaptainTool, PURPOSE_COVERAGE_TASK_TAG } from './captain.js';
import { loadTasks } from '../utils/task-loader.js';
import { loadProjectContext } from '../utils/index-loader.js';

let root: string;

function write(rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

/** Every file under root outside .paradigm/, relative + posix. */
function treeFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (rel === '.paradigm' || rel.startsWith('.paradigm/')) continue;
      if (e.isDirectory()) walk(full);
      else out.push(rel);
    }
  };
  walk(root);
  return out.sort();
}

async function debrief(touchedFiles: string[], orchestrationId = 'orch-cov') {
  const ctx = await loadProjectContext(root);
  const res = await handleCaptainTool(
    'paradigm_captain_debrief',
    { orchestrationId, sessionSummary: 'coverage fixture', touchedFiles },
    ctx,
  );
  expect(res.handled).toBe(true);
  return JSON.parse(res.text.split('\n━━━')[0]);
}

function pendingEntries(): Array<{ path: string; reason: string }> {
  const p = path.join(root, '.paradigm', '.pending-review');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

const PKG_PURPOSE = `version: "2.0"
description: The widget package and everything it ships, documented properly.
components:
  widget-cli:
    description: >-
      The command line. src/cli/main.ts parses argv. Tests: test/cli.test.ts.
    tags: [cli]
`;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'captain-debrief-cov-'));
  write('.paradigm/config.yaml', 'version: 2.0.0\nproject:\n  name: debrief-coverage-test\n');
  // Settlement liveness present so the debrief does not self-heal postflight.
  write(
    '.paradigm/events/settlement-liveness.jsonl',
    JSON.stringify({ ts: new Date().toISOString(), stages: { runPostflightLearning: 'ok' }, chainLive: true }) + '\n',
  );
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('debrief coverage — ancestor .purpose', () => {
  it('a subdirectory documented by an ancestor counts as covered and gets no stub', async () => {
    write('pkg/.purpose', PKG_PURPOSE);
    write('pkg/src/cli/main.ts', 'export {};\n');
    write('pkg/test/cli.test.ts', 'export {};\n');
    const before = treeFiles();

    const report = await debrief(['pkg/src/cli/main.ts', 'pkg/test/cli.test.ts']);

    expect(treeFiles()).toEqual(before);
    expect(fs.existsSync(path.join(root, 'pkg/src/cli/.purpose'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'pkg/test/.purpose'))).toBe(false);
    expect(report.coverageScore).toEqual({ before: 1, after: 1, delta: 0 });
    expect(report.uncoveredDirs).toEqual([]);
    expect(report.coverageAdded).toEqual([]);
    expect(report.coverageTaskId).toBeUndefined();
    expect(await loadTasks(root, { status: 'all', tag: PURPOSE_COVERAGE_TASK_TAG })).toEqual([]);
  });
});

describe('debrief coverage — truly uncovered directory', () => {
  it('writes nothing into the tree, queues a task and a pending entry, stays uncovered', async () => {
    write('pkg/.purpose', PKG_PURPOSE);
    write('pkg/src/cli/main.ts', 'export {};\n');
    write('pkg/scripts/release.mjs', '// release\n');
    const before = treeFiles();

    const report = await debrief(['pkg/src/cli/main.ts', 'pkg/scripts/release.mjs']);

    expect(treeFiles()).toEqual(before);
    expect(report.uncoveredDirs).toEqual(['pkg/scripts']);
    expect(report.coverageScore.before).toBe(0.5);
    expect(report.coverageScore.after).toBe(0.5);
    expect(report.delegatedToDocumentor).toContain('pkg/scripts');

    const tasks = await loadTasks(root, { status: 'all', tag: PURPOSE_COVERAGE_TASK_TAG });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe(report.coverageTaskId);
    expect(tasks[0].blurb).toContain('pkg/scripts');
    expect(tasks[0].blurb).not.toContain('pkg/src/cli');

    expect(pendingEntries()).toContainEqual(
      expect.objectContaining({ path: 'pkg/scripts', reason: 'captain-debrief-uncovered' }),
    );
  });

  it('a second debrief does not duplicate the open coverage task', async () => {
    write('pkg/scripts/release.mjs', '// release\n');
    const first = await debrief(['pkg/scripts/release.mjs'], 'orch-a');
    const second = await debrief(['pkg/scripts/release.mjs'], 'orch-b');
    expect(first.coverageTaskId).toBeTruthy();
    expect(second.coverageTaskId).toBeUndefined();
    expect(await loadTasks(root, { status: 'all', tag: PURPOSE_COVERAGE_TASK_TAG })).toHaveLength(1);
  });
});

describe('debrief coverage — placeholder stubs', () => {
  it('an existing TODO stub never counts as coverage', async () => {
    write(
      'pkg/core/.purpose',
      `# Auto-generated .purpose stub — created by Cid (captain debrief)
# Delegate to Scribe (Documentor) for rich documentation
name: core
description: "TODO: describe what this directory/module does"
context:
  - "Stub created by Cid during coverage audit — update with real context"
components:
  core:
    description: "TODO: describe this component"
    tags: []
`,
    );
    write('pkg/core/index.ts', 'export {};\n');
    const before = treeFiles();

    const report = await debrief(['pkg/core/index.ts']);

    expect(treeFiles()).toEqual(before);
    expect(report.coverageScore).toEqual({ before: 0, after: 0, delta: 0 });
    expect(report.uncoveredDirs).toEqual(['pkg/core']);
    expect(report.placeholderPurposes).toEqual(['pkg/core/.purpose']);
  });

  it('a stop-hook auto-fix stub (TODO only, no Cid header) does not count either', async () => {
    write(
      'pkg/ui/.purpose',
      `# Auto-generated .purpose stub — update with real descriptions
components:
  ui:
    description: "TODO: describe this component"
    tags: []
`,
    );
    write('pkg/ui/view.ts', 'export {};\n');
    const report = await debrief(['pkg/ui/view.ts']);
    expect(report.uncoveredDirs).toEqual(['pkg/ui']);
    expect(report.coverageScore.after).toBe(0);
  });
});
