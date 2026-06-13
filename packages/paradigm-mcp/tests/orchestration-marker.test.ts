/**
 * T-005 — enforcement verifies *completion*, not *invocation*.
 *
 * The Stop hook's orchestration-required gate is satisfied by the presence of
 * `.paradigm/.orchestrated`. It used to be written on tool ENTRY of
 * `orchestrate_inline` (for every mode, including `quick`), so a single
 * lightweight ping checked the box before any agent ran. The fix moves the
 * write to a real completion signal:
 *
 *   - a settlement whose learning chain ran end-to-end (chainLive === true), or
 *   - a debrief that recorded real agent verdicts.
 *
 * These tests pin the new contract:
 *   - quick/plan invocation does NOT write the marker
 *   - a chainLive settlement DOES write it with verdicts>0 + source:'settlement'
 *   - a settlement whose chain threw (chainLive===false) does NOT write it
 *   - the marker payload carries { verdicts, source }
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { recordOrchestrationCompletion } from '../src/utils/orchestration-marker.js';
import { settleParentIfComplete } from '../src/utils/task-settlement.js';
import { createTask, updateTask } from '../src/utils/task-loader.js';
import { handleOrchestrationTool } from '../src/tools/orchestration.js';
import type { ProjectContext } from '../src/utils/index-loader.js';

let tmpDir: string;

function markerPath(): string {
  return path.join(tmpDir, '.paradigm', '.orchestrated');
}

function readMarker(): { timestamp: string; type: string; verdicts: number; source: string } | null {
  if (!fs.existsSync(markerPath())) return null;
  return JSON.parse(fs.readFileSync(markerPath(), 'utf8'));
}

/** Minimal ProjectContext — the orchestrate_inline handler only reads rootDir
 *  before bailing on the (absent) agents manifest. */
function fakeCtx(): ProjectContext {
  return { rootDir: tmpDir } as unknown as ProjectContext;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-orch-marker-'));
  fs.mkdirSync(path.join(tmpDir, '.paradigm'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('recordOrchestrationCompletion (helper contract)', () => {
  it('writes .paradigm/.orchestrated with { timestamp, type, verdicts, source }', () => {
    const ok = recordOrchestrationCompletion(tmpDir, { verdicts: 3, source: 'settlement' });
    expect(ok).toBe(true);

    const marker = readMarker();
    expect(marker).not.toBeNull();
    expect(marker!.type).toBe('orchestrated');
    expect(marker!.verdicts).toBe(3);
    expect(marker!.source).toBe('settlement');
    expect(typeof marker!.timestamp).toBe('string');
  });

  it('is best-effort: a write failure returns false and does not throw', () => {
    // Point rootDir at a path whose `.paradigm` is actually a FILE, so mkdir/write fails.
    const badRoot = path.join(tmpDir, 'bad');
    fs.mkdirSync(badRoot);
    fs.writeFileSync(path.join(badRoot, '.paradigm'), 'i am a file, not a dir', 'utf8');

    let result: boolean | undefined;
    expect(() => {
      result = recordOrchestrationCompletion(badRoot, { verdicts: 1, source: 'debrief' });
    }).not.toThrow();
    expect(result).toBe(false);
  });
});

describe('orchestrate_inline does NOT write the marker on entry', () => {
  it('mode=quick leaves .orchestrated absent', async () => {
    expect(readMarker()).toBeNull();
    await handleOrchestrationTool(
      'paradigm_orchestrate_inline',
      { task: 'fix the login bug', mode: 'quick' },
      fakeCtx(),
    );
    expect(fs.existsSync(markerPath())).toBe(false);
  });

  it('mode=plan leaves .orchestrated absent', async () => {
    expect(readMarker()).toBeNull();
    await handleOrchestrationTool(
      'paradigm_orchestrate_inline',
      { task: 'add JWT auth', mode: 'plan' },
      fakeCtx(),
    );
    expect(fs.existsSync(markerPath())).toBe(false);
  });
});

describe('settlement writes the marker only on a live learning chain', () => {
  /**
   * Build a parent with one child and complete the child. Completing a child via
   * updateTask(status:'done') auto-triggers settleParentIfComplete inside the
   * loader, so the whole settlement (incl. the learning chain + marker write)
   * fires here. We assert on the marker afterward.
   */
  async function buildAndSettle(): Promise<string> {
    const parentId = await createTask(tmpDir, { blurb: 'parent task' });
    const childId = await createTask(tmpDir, { blurb: 'child task', parentTaskId: parentId });
    await updateTask(tmpDir, childId, { status: 'done' }); // → triggers settlement
    return parentId;
  }

  it('chainLive===true writes .orchestrated with verdicts>0 and source:settlement', async () => {
    expect(readMarker()).toBeNull();

    const parentId = await buildAndSettle();
    // Idempotent re-call is a no-op (parent already settled) but harmless.
    await settleParentIfComplete(tmpDir, parentId);

    const marker = readMarker();
    expect(marker).not.toBeNull();
    expect(marker!.source).toBe('settlement');
    expect(marker!.verdicts).toBeGreaterThan(0);
    expect(marker!.type).toBe('orchestrated');
  });

  it('chainLive===false (a chain stage threw) does NOT write the marker', async () => {
    // Force a chain-stage failure: plant a FILE where the learning chain needs a
    // directory. recordWorkLog (stage 1) does mkdirSync('.paradigm/work-log/{date}')
    // — if '.paradigm/work-log' is a file, that mkdir throws → chainLive===false →
    // no marker. Block it BEFORE settlement fires.
    fs.writeFileSync(path.join(tmpDir, '.paradigm', 'work-log'), 'block', 'utf8');

    expect(readMarker()).toBeNull();
    await buildAndSettle(); // settlement fires inside updateTask; chain throws

    // The chain did not run end-to-end, so enforcement must NOT be satisfied.
    expect(fs.existsSync(markerPath())).toBe(false);
  });
});
