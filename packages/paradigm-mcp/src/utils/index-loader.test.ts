/**
 * index-loader.test — ensureFreshContext contract (Symbol Integrity Phase 1).
 *
 *  - debounce: within FRESHNESS_DEBOUNCE_MS of the last check the context is
 *    trusted as-is (no glob/stat); past the window an edit is picked up;
 *  - single flight: concurrent calls on one context share ONE refresh;
 *  - atomic swap: index, aggregation and gateConfig change together — an
 *    observer never sees the new index paired with the old gateConfig.
 *
 * NOTE: imports @a-company/premise-core via its built dist.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getSymbol } from '@a-company/premise-core';
import {
  loadProjectContext,
  ensureFreshContext,
  resetFreshnessDebounce,
  flushStaticRebuilds,
  FRESHNESS_DEBOUNCE_MS,
} from './index-loader.js';

let tmpRoot: string;

function write(rel: string, content: string): void {
  const abs = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

const portal = (gate: string) =>
  `version: 2.0.0\ngates:\n  ${gate}:\n    description: ${gate} gate\n    prizes: []\n`;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'index-loader-'));
  write('src/a/.purpose', 'version: "2.0"\ncomponents:\n  alpha:\n    description: Alpha\n');
  write('portal.yaml', portal('first'));
});

afterEach(async () => {
  // Refreshes schedule background static rebuilds into tmpRoot — let them land.
  await flushStaticRebuilds();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('ensureFreshContext', () => {
  it('trusts the context inside the debounce window and refreshes after it', async () => {
    const ctx = await loadProjectContext(tmpRoot);
    const original = ctx.index;

    write('src/b/.purpose', 'version: "2.0"\ncomponents:\n  beta:\n    description: Beta\n');
    await ensureFreshContext(ctx);
    expect(ctx.index, 'inside the window: no re-check').toBe(original);

    await new Promise((r) => setTimeout(r, FRESHNESS_DEBOUNCE_MS + 50));
    await ensureFreshContext(ctx);
    expect(ctx.index).not.toBe(original);
    expect(getSymbol(ctx.index, '#beta')).toBeDefined();
  });

  it('shares one in-flight refresh between concurrent callers', async () => {
    const ctx = await loadProjectContext(tmpRoot);
    write('src/b/.purpose', 'version: "2.0"\ncomponents:\n  beta:\n    description: Beta\n');
    resetFreshnessDebounce(tmpRoot);

    const p1 = ensureFreshContext(ctx);
    const p2 = ensureFreshContext(ctx);
    expect(p2).toBe(p1);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(ctx);
    expect(r2).toBe(ctx);
    expect(getSymbol(ctx.index, '#beta')).toBeDefined();
  });

  it('swaps index, aggregation and gateConfig atomically', async () => {
    const ctx = await loadProjectContext(tmpRoot);
    const before = { index: ctx.index, aggregation: ctx.aggregation, gateConfig: ctx.gateConfig };
    expect(before.gateConfig?.gates.map((g) => g.id)).toEqual(['first']);

    write('portal.yaml', portal('second'));
    resetFreshnessDebounce(tmpRoot);

    // Sample the context on every macrotask while the refresh runs.
    const samples: Array<{ index: unknown; aggregation: unknown; gateConfig: unknown }> = [];
    let done = false;
    const sampler = (async () => {
      while (!done) {
        samples.push({ index: ctx.index, aggregation: ctx.aggregation, gateConfig: ctx.gateConfig });
        await new Promise((r) => setImmediate(r));
      }
    })();
    await ensureFreshContext(ctx);
    done = true;
    await sampler;

    const after = { index: ctx.index, aggregation: ctx.aggregation, gateConfig: ctx.gateConfig };
    expect(after.index).not.toBe(before.index);
    expect(after.gateConfig?.gates.map((g) => g.id)).toEqual(['second']);
    for (const s of samples) {
      const isOld = s.index === before.index && s.aggregation === before.aggregation && s.gateConfig === before.gateConfig;
      const isNew = s.index === after.index && s.aggregation === after.aggregation && s.gateConfig === after.gateConfig;
      expect(isOld || isNew, 'observer saw a half-swapped context').toBe(true);
    }
  });

  it('leaves hand-built (non-live) contexts untouched', async () => {
    const ctx = await loadProjectContext(tmpRoot);
    const handBuilt = { ...ctx, _live: undefined };
    write('src/b/.purpose', 'version: "2.0"\ncomponents:\n  beta:\n    description: Beta\n');
    resetFreshnessDebounce(tmpRoot);
    await ensureFreshContext(handBuilt);
    expect(handBuilt.index).toBe(ctx.index);
  });
});

describe('ensureFreshContext — static files follow the refreshed index', () => {
  const flowPurpose = (id: string) =>
    `version: "2.0"\nflows:\n  ${id}:\n    description: ${id} flow\n    steps:\n      - component: "#alpha"\n        action: go\n`;
  const flowIndex = () => fs.readFileSync(path.join(tmpRoot, '.paradigm', 'flow-index.json'), 'utf8');

  it('rebuilds flow-index.json in the background after a refresh swaps the index', async () => {
    const ctx = await loadProjectContext(tmpRoot);
    write('src/flows/.purpose', flowPurpose('late-flow'));
    resetFreshnessDebounce(tmpRoot);
    await ensureFreshContext(ctx);
    await flushStaticRebuilds();
    expect(flowIndex()).toContain('late-flow');
  });

  it('coalesces bursts: the final static files reflect the LAST refresh', async () => {
    const ctx = await loadProjectContext(tmpRoot);
    for (const id of ['burst-one', 'burst-two', 'burst-three']) {
      write('src/flows/.purpose', flowPurpose(id));
      resetFreshnessDebounce(tmpRoot);
      await ensureFreshContext(ctx);
    }
    await flushStaticRebuilds();
    const text = flowIndex();
    expect(text).toContain('burst-three');
    expect(text).not.toContain('burst-one');
  });

  it('does not rebuild when nothing changed', async () => {
    const ctx = await loadProjectContext(tmpRoot);
    resetFreshnessDebounce(tmpRoot);
    await ensureFreshContext(ctx);
    await flushStaticRebuilds();
    expect(fs.existsSync(path.join(tmpRoot, '.paradigm', 'flow-index.json'))).toBe(false);
  });
});
