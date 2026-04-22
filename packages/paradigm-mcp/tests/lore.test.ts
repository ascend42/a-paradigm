/**
 * lore.test.ts — v6.0 hard-error tests for paradigm_lore_record({type:'decision'}).
 *
 * Per D3 (locked) + Jinx premortem mitigation #2:
 *   - The handler MUST return a structured rejection envelope (not throw,
 *     not let zod produce a bare enum-mismatch).
 *   - The envelope MUST contain the literal successor tool name
 *     `paradigm_decision_record` so a downstream agent can auto-retry without
 *     human intervention.
 *   - The companion-lore pattern (recordDecision auto-writes a lore insight
 *     entry with references.decision_id) MUST be untouched by the rejection
 *     path — see decision-migration.test.ts for the regression assertion.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleLoreTool } from '../src/tools/lore.js';
import type { ProjectContext } from '../src/utils/index-loader.js';

function mktemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-lore-test-'));
}

/** Minimal ProjectContext for tool dispatch. The lore.record path only reads rootDir. */
function makeCtx(rootDir: string): ProjectContext {
  return {
    rootDir,
    // The rejection path returns before any of these are touched.
    index: {} as ProjectContext['index'],
    aggregation: {} as ProjectContext['aggregation'],
    gateConfig: null,
    projectName: 'test',
    wisdom: null,
    history: null,
  };
}

describe("paradigm_lore_record({type:'decision'}) — v6.0 hard rejection", () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    tmpDir = undefined;
  });

  it("returns a structured rejection envelope (no throw) when type:'decision' is supplied", async () => {
    tmpDir = mktemp();
    const ctx = makeCtx(tmpDir);

    // Note: the handler must NOT throw — it returns the envelope so downstream
    // agents can parse it and auto-retry against paradigm_decision_record.
    const result = await handleLoreTool(
      'paradigm_lore_record',
      {
        type: 'decision',
        title: 'Adopt monorepo layout',
        summary: 'Consolidate packages into a single repo.',
        symbols_touched: ['#repo-layout'],
      },
      ctx,
    );

    expect(result.handled).toBe(true);
    const parsed = JSON.parse(result.text);
    expect(parsed.error).toBeDefined();
    expect(parsed.error.code).toBe('lore_type_decision_removed');
    // The literal successor tool name MUST be present so callers can retry.
    expect(parsed.error.successor_tool).toBe('paradigm_decision_record');
    // Message must mention the successor tool by name (machine-actionable).
    expect(parsed.error.message).toContain('paradigm_decision_record');
    // Removed-in field anchors the change to the v6.0 cut.
    expect(parsed.error.removed_in).toBe('6.0.0');
  });

  it('does not write a lore entry on the rejection path', async () => {
    tmpDir = mktemp();
    const ctx = makeCtx(tmpDir);

    await handleLoreTool(
      'paradigm_lore_record',
      {
        type: 'decision',
        title: 'Should not be persisted',
        summary: 'If this lands on disk the rejection short-circuit failed.',
        symbols_touched: ['#test'],
      },
      ctx,
    );

    // No .paradigm/lore/entries directory should be created — rejection is
    // immediate, before any file IO.
    const loreDir = path.join(tmpDir, '.paradigm', 'lore', 'entries');
    expect(fs.existsSync(loreDir)).toBe(false);
  });

  it("rejection path is independent of paradigm_decision_record's companion-lore writer", async () => {
    // Sanity: the rejection envelope's `successor_tool` literal points at the
    // same tool whose handler writes the companion-lore insight (asserted in
    // decision-migration.test.ts → 'writeCompanionLoreEntry writes a lore
    // insight referencing the decision'). Keeping these wired together is the
    // contract — we assert the literal here so a rename is caught immediately.
    tmpDir = mktemp();
    const ctx = makeCtx(tmpDir);

    const result = await handleLoreTool(
      'paradigm_lore_record',
      {
        type: 'decision',
        title: 'wiring assertion',
        summary: 'companion-lore is the bridge',
        symbols_touched: ['#contract'],
      },
      ctx,
    );

    const parsed = JSON.parse(result.text);
    expect(parsed.error.successor_tool).toBe('paradigm_decision_record');
  });
});
