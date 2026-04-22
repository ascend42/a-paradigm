/**
 * assessment.test.ts — v6.0 hard-error tests for the deprecated
 * paradigm_assessment_record({type:'decision'}) back-door.
 *
 * Per the Bundle A reviewer's F-1 finding: assessment.ts is a deprecated
 * wrapper that previously forwarded `type:'decision'` straight into a lore
 * entry via a TypeScript cast, defeating paradigm_lore_record's rejection
 * envelope. v6.0 closes the back door — the assessment-record handler must
 * return the same structured envelope as paradigm_lore_record so callers
 * (older agents, scripts, automations) get identical machine-actionable
 * guidance regardless of which entry path they took.
 *
 * Mirror of lore.test.ts — keep these in sync.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleAssessmentTool } from '../src/tools/assessment.js';
import type { ProjectContext } from '../src/utils/index-loader.js';

function mktemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-assessment-test-'));
}

/** Minimal ProjectContext for tool dispatch. The rejection path returns
 * before any of the index/aggregation/etc. fields are touched. */
function makeCtx(rootDir: string): ProjectContext {
  return {
    rootDir,
    index: {} as ProjectContext['index'],
    aggregation: {} as ProjectContext['aggregation'],
    gateConfig: null,
    projectName: 'test',
    wisdom: null,
    history: null,
  };
}

describe("paradigm_assessment_record({type:'decision'}) — v6.0 back-door closure", () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    tmpDir = undefined;
  });

  it("returns the same structured rejection envelope as paradigm_lore_record", async () => {
    tmpDir = mktemp();
    const ctx = makeCtx(tmpDir);

    const result = await handleAssessmentTool(
      'paradigm_assessment_record',
      {
        arc_id: 'arc-test',
        type: 'decision',
        title: 'Adopt monorepo layout',
        summary: 'Should be rejected, not written.',
      },
      ctx,
    );

    expect(result.handled).toBe(true);
    const parsed = JSON.parse(result.text);
    expect(parsed.error).toBeDefined();
    // Same code as paradigm_lore_record — single source of truth.
    expect(parsed.error.code).toBe('lore_type_decision_removed');
    expect(parsed.error.successor_tool).toBe('paradigm_decision_record');
    expect(parsed.error.message).toContain('paradigm_decision_record');
    expect(parsed.error.removed_in).toBe('6.0.0');
  });

  it('does not write a lore entry on the rejection path', async () => {
    tmpDir = mktemp();
    const ctx = makeCtx(tmpDir);

    await handleAssessmentTool(
      'paradigm_assessment_record',
      {
        arc_id: 'arc-test',
        type: 'decision',
        title: 'Should not be persisted',
        summary: 'If this lands on disk the back-door closure failed.',
      },
      ctx,
    );

    // No .paradigm/lore/entries directory should be created — rejection is
    // immediate, before any file IO. Same invariant as lore.test.ts.
    const loreDir = path.join(tmpDir, '.paradigm', 'lore', 'entries');
    expect(fs.existsSync(loreDir)).toBe(false);
  });

  it('non-decision types (retro/insight/milestone) are NOT rejected by the back-door check', async () => {
    // Sanity: the rejection guard must be type-specific. A plain retro
    // assessment should still flow through normally (we don't assert success
    // here because that requires a fully wired ctx — we only assert that
    // the rejection envelope is NOT returned).
    tmpDir = mktemp();
    const ctx = makeCtx(tmpDir);

    const result = await handleAssessmentTool(
      'paradigm_assessment_record',
      {
        arc_id: 'arc-test',
        type: 'retro',
        title: 'Retro entry',
        summary: 'Should not be rejected by the decision guard.',
      },
      ctx,
    );

    expect(result.handled).toBe(true);
    const parsed = JSON.parse(result.text);
    // If the guard fired incorrectly it would set error.code to the
    // decision-removed envelope — assert the contrary.
    if (parsed.error) {
      expect(parsed.error.code).not.toBe('lore_type_decision_removed');
    }
  });
});
