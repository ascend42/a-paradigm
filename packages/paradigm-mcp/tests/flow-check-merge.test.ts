/**
 * Tests for paradigm_flow_check's two-source flow merge (handleFlowTool).
 *
 * Regression coverage for v6.6.2 Bug 1: flow_check read ONLY .paradigm/flows.yaml,
 * so flows authored in .purpose files (indexed into .paradigm/flow-index.json by
 * reindex) were invisible — flow_check returned "Flow not found" for them, even
 * though search/reindex/flows_affected saw them. The fix merges both sources,
 * with flows.yaml winning on id collision.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleFlowTool } from '../src/tools/flows.js';
import { clearFlowCache } from '../src/utils/flow-loader.js';
import type { ProjectContext } from '../src/utils/index-loader.js';

let tmpDir: string;

/** flow_check only reads ctx.rootDir (plus files on disk); stub the rest. */
function ctxFor(rootDir: string): ProjectContext {
  return { rootDir } as unknown as ProjectContext;
}

/** Write a .paradigm/flow-index.json fixture (the reindex output of .purpose flows). */
function writeFlowIndex(flows: Record<string, unknown>): void {
  const dir = path.join(tmpDir, '.paradigm');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'flow-index.json'),
    JSON.stringify({ version: '1', generatedAt: '2026-05-30', flows, symbolToFlows: {} }),
  );
}

/** Write a .paradigm/flows.yaml fixture (the legacy explicit flow registry). */
function writeFlowsYaml(yamlBody: string): void {
  const dir = path.join(tmpDir, '.paradigm');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'flows.yaml'), yamlBody);
}

async function flowCheck(flowId?: string) {
  const res = await handleFlowTool('paradigm_flow_check', flowId ? { flowId } : {}, ctxFor(tmpDir));
  return JSON.parse(res.text);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-flowcheck-test-'));
  clearFlowCache();
});

afterEach(() => {
  clearFlowCache();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('paradigm_flow_check — two-source merge', () => {
  it('validates a .purpose-defined flow from flow-index.json when no flows.yaml exists (Bug 1)', async () => {
    writeFlowIndex({
      'crystal-guide-chat-flow': {
        id: 'crystal-guide-chat-flow',
        description: 'Guide chat',
        steps: [{ id: 's1', action: 'do thing', symbol: '@chat' }],
        definedIn: 'supabase/functions/.purpose',
      },
    });

    const out = await flowCheck('crystal-guide-chat-flow');

    // Before the fix this returned { error: "Flow not found" }.
    expect(out.error).toBeUndefined();
    expect(out.totalFlows).toBe(1);
    expect(out.results[0].flowId).toBe('crystal-guide-chat-flow');
  });

  it('still returns "No flows found" when neither source exists', async () => {
    const out = await flowCheck('anything');
    expect(out.error).toBe('No flows found');
  });

  it('returns "Flow not found" only when the id is in neither source, and lists merged ids', async () => {
    writeFlowIndex({
      'known-flow': { id: 'known-flow', description: 'k', steps: [], definedIn: 'x/.purpose' },
    });

    const out = await flowCheck('does-not-exist');
    expect(out.error).toBe('Flow not found: does-not-exist');
    expect(out.availableFlows).toContain('known-flow');
  });

  it('classifies flow-index steps by symbol prefix (^→gate, !→signal, else action)', async () => {
    writeFlowIndex({
      'classified-flow': {
        id: 'classified-flow',
        description: 'mixed steps',
        steps: [
          { id: 'g', action: 'check auth', symbol: '^authenticated' }, // gate, undeclared → missing
          { id: 's', action: 'emit done', symbol: '!done' }, // signal
          { id: 'a', action: 'write row', symbol: '#db' }, // action (non-gate/signal symbol)
        ],
        definedIn: 'x/.purpose',
      },
    });

    const out = await flowCheck('classified-flow');
    const r = out.results[0];
    expect(r.gatesReferenced).toContain('^authenticated');
    expect(r.gatesMissing).toContain('^authenticated'); // no portal.yaml → undeclared
    expect(r.signalsEmitted).toContain('!done');
    expect(r.actionsReferenced).toContain('#db');
  });

  it('lets flows.yaml win over flow-index on id collision', async () => {
    // flows.yaml: same id, no steps → 0 gates referenced.
    writeFlowsYaml(
      [
        'version: 1',
        'flows:',
        '  shared-id:',
        '    description: from flows.yaml',
        '    steps: []',
        '',
      ].join('\n'),
    );
    // flow-index: same id, WITH a gate step. If the index won, gatesReferenced
    // would be non-empty.
    writeFlowIndex({
      'shared-id': {
        id: 'shared-id',
        description: 'from index',
        steps: [{ id: 'g', action: 'gate', symbol: '^authenticated' }],
        definedIn: 'x/.purpose',
      },
    });

    const out = await flowCheck('shared-id');
    expect(out.totalFlows).toBe(1);
    expect(out.results[0].gatesReferenced).toEqual([]); // flows.yaml (stepless) won
  });
});
