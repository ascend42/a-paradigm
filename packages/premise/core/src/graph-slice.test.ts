/**
 * Tests for #graph-slice-projector.
 *
 * The projector now sources neighbors from a LIVE `SymbolIndex` (built via
 * aggregateFromDirectory + buildSymbolIndex — the SAME pipeline `paradigm ripple`
 * uses), NOT the stale scan-index/flow-index. So fixtures here write real
 * `.purpose` files into a tmp dir and aggregate them, exercising the true
 * live-parse path end-to-end.
 *
 * Guards the contract properties:
 *  1. flow membership — a flow-member symbol yields an `in-flow` edge (the
 *     #cockpit-view → $$fleet-switch case the old projector hid);
 *  2. references — referencesTo/From yield used-by/uses edges;
 *  3. determinism — same input → byte-identical sorted output;
 *  4. did-you-mean — fires on an unknown symbol and renders NOTHING;
 *  5. bounded — radius + degree caps respected, `truncated` set when exceeded;
 *  6. freshness — a freshness stamp is always present (and never stale).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadLiveGraph,
  projectGraphSlice,
  graphSliceFromRoot,
  sliceToMermaid,
} from './graph-slice.js';

// ── Fixture builders ──────────────────────────────────────
//
// We write `.purpose` files in the real schema and let the live aggregator parse
// them. Each writePurpose call drops one `.purpose` in its own subdirectory.

interface ComponentSpec {
  /** symbols this component references, e.g. ['^auth', '$checkout', '#peer'] */
  references?: string[];
}

interface FlowSpec {
  /** ordered member step symbols, e.g. ['#a', '#b', '#cockpit-view'] */
  steps: string[];
}

interface PurposeSpec {
  components?: Record<string, ComponentSpec>;
  flows?: Record<string, FlowSpec>;
  gates?: Record<string, Record<string, never>>;
  signals?: Record<string, Record<string, never>>;
  aspects?: Record<string, Record<string, never>>;
}

let purposeCounter = 0;

/**
 * Write a single `.purpose` file (in its own subdir to keep ids unique) in the
 * real Paradigm v2 schema the aggregator parses.
 */
function writePurpose(rootDir: string, spec: PurposeSpec, subdir?: string): void {
  const dir = path.join(rootDir, subdir ?? `pkg${purposeCounter++}`);
  fs.mkdirSync(dir, { recursive: true });

  const lines: string[] = ['purpose: fixture component group', 'version: 2.0.0', ''];

  if (spec.components && Object.keys(spec.components).length > 0) {
    for (const [id, c] of Object.entries(spec.components)) {
      lines.push(`#${id}:`);
      lines.push(`  description: "fixture ${id}"`);
      const refs = c.references || [];
      if (refs.length > 0) {
        // References are surfaced via flows/gates lists the parser resolves.
        const flows = refs.filter((r) => /^\${1,2}/.test(r));
        const gates = refs.filter((r) => r.startsWith('^'));
        const others = refs.filter((r) => r.startsWith('#') || r.startsWith('!') || r.startsWith('~'));
        if (flows.length) lines.push(`  flows: [${flows.map((f) => JSON.stringify(f)).join(', ')}]`);
        if (gates.length) lines.push(`  gates: [${gates.map((g) => JSON.stringify(g)).join(', ')}]`);
        if (others.length) lines.push(`  uses: [${others.map((o) => JSON.stringify(o)).join(', ')}]`);
      }
      lines.push('');
    }
  }

  if (spec.gates && Object.keys(spec.gates).length > 0) {
    lines.push('gates:');
    for (const id of Object.keys(spec.gates)) {
      lines.push(`  ^${id}:`);
      lines.push(`    description: "fixture gate ${id}"`);
    }
    lines.push('');
  }

  if (spec.flows && Object.keys(spec.flows).length > 0) {
    lines.push('flows:');
    for (const [id, f] of Object.entries(spec.flows)) {
      // The parser canonicalizes a `$id` YAML flow key to the double-prefix
      // `$$id` symbol form the repo uses (e.g. `$fleet-switch` → `$$fleet-switch`).
      lines.push(`  $${id}:`);
      lines.push(`    description: "fixture flow ${id}"`);
      lines.push('    steps:');
      for (const step of f.steps) lines.push(`      - ${JSON.stringify(step)}`);
    }
    lines.push('');
  }

  if (spec.signals && Object.keys(spec.signals).length > 0) {
    lines.push('signals:');
    for (const id of Object.keys(spec.signals)) {
      lines.push(`  "!${id}":`);
      lines.push(`    description: "fixture signal ${id}"`);
    }
    lines.push('');
  }

  if (spec.aspects && Object.keys(spec.aspects).length > 0) {
    for (const id of Object.keys(spec.aspects)) {
      lines.push(`~${id}:`);
      lines.push(`  description: "fixture aspect ${id}"`);
      lines.push('');
    }
  }

  fs.writeFileSync(path.join(dir, '.purpose'), lines.join('\n') + '\n');
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-slice-'));
  purposeCounter = 0;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ──────────────────────────────────────────────────────────

describe('projectGraphSlice — resolution', () => {
  it('resolves a symbol with and without prefix', async () => {
    writePurpose(tmpDir, { components: { foo: { references: ['#bar'] }, bar: {} } });
    const graph = await loadLiveGraph(tmpDir);

    const withPrefix = projectGraphSlice(graph, { symbol: '#foo' });
    const withoutPrefix = projectGraphSlice(graph, { symbol: 'foo' });

    expect(withPrefix.root).toBe('#foo');
    expect(withoutPrefix.root).toBe('#foo');
    expect(withPrefix.didYouMean).toBeUndefined();
  });
});

describe('did-you-mean (fail loud)', () => {
  it('fires on an unknown symbol and renders nothing', async () => {
    writePurpose(tmpDir, {
      components: { 'cockpit-view': {}, 'cockpit-rail': {}, 'fenced-block-parser': {} },
    });
    const slice = await graphSliceFromRoot(tmpDir, { symbol: '#cockpit-veiw' });

    expect(slice.nodes).toHaveLength(0);
    expect(slice.edges).toHaveLength(0);
    expect(slice.didYouMean).toBeDefined();
    expect(slice.didYouMean!.length).toBeGreaterThan(0);
    // Nearest by typo distance should surface the real symbol (sourced from the
    // LIVE index's symbol list).
    expect(slice.didYouMean).toContain('#cockpit-view');
  });

  it('still stamps freshness on a missed resolve', async () => {
    writePurpose(tmpDir, { components: { foo: {} } });
    const slice = await graphSliceFromRoot(tmpDir, { symbol: '#nope' });
    expect(slice.freshness).toBeDefined();
    expect(slice.freshness.generatedAt).toBeTruthy();
    expect(slice.freshness.stale).toBe(false);
  });
});

describe('determinism', () => {
  it('produces byte-identical output across repeat live parses', async () => {
    writePurpose(tmpDir, {
      components: {
        root: { references: ['#a', '#b', '#c'] },
        a: { references: ['#root'] },
        b: {},
        c: {},
      },
    });

    // Normalize the live-parse timestamp out — the byte-identical guarantee is
    // over the deterministically-sorted graph STRUCTURE, not the parse clock.
    const norm = (s: string) => s.replace(/"generatedAt":"[^"]*"/, '"generatedAt":"X"');
    const first = norm(JSON.stringify(await graphSliceFromRoot(tmpDir, { symbol: '#root', radius: 2 })));
    const second = norm(JSON.stringify(await graphSliceFromRoot(tmpDir, { symbol: '#root', radius: 2 })));

    expect(second).toBe(first);
  });

  it('sorts nodes by id and edges by source+target+kind', async () => {
    writePurpose(tmpDir, {
      components: { root: { references: ['#zeta', '#alpha'] }, alpha: {}, zeta: {} },
    });
    const slice = await graphSliceFromRoot(tmpDir, { symbol: '#root' });

    const nodeIds = slice.nodes.map((n) => n.id);
    expect(nodeIds).toEqual([...nodeIds].sort((a, b) => a.localeCompare(b)));

    const edgeKeys = slice.edges.map((e) => `${e.source}|${e.target}|${e.kind}`);
    expect(edgeKeys).toEqual([...edgeKeys].sort((a, b) => a.localeCompare(b)));
  });
});

describe('bounding', () => {
  it('respects radius (ego = radius 1 reaches only direct neighbors)', async () => {
    writePurpose(tmpDir, {
      components: { root: { references: ['#mid'] }, mid: { references: ['#leaf'] }, leaf: {} },
    });
    const slice = await graphSliceFromRoot(tmpDir, { symbol: '#root', radius: 1 });
    const ids = slice.nodes.map((n) => n.id);
    expect(ids).toContain('#root');
    expect(ids).toContain('#mid');
    expect(ids).not.toContain('#leaf'); // radius 1 must NOT reach depth-2
  });

  it('caps radius at 3', async () => {
    writePurpose(tmpDir, {
      components: {
        n0: { references: ['#n1'] },
        n1: { references: ['#n2'] },
        n2: { references: ['#n3'] },
        n3: { references: ['#n4'] },
        n4: { references: ['#n5'] },
        n5: {},
      },
    });
    const slice = await graphSliceFromRoot(tmpDir, { symbol: '#n0', radius: 99 });
    const ids = slice.nodes.map((n) => n.id);
    expect(ids).toContain('#n3'); // radius capped at 3 → n3 reachable
    expect(ids).not.toContain('#n4'); // depth 4 must NOT appear
  });

  it('collapses degree overflow to a +N more node and sets truncated', async () => {
    const references = Array.from({ length: 12 }, (_, i) => `#c${i}`);
    const components: Record<string, ComponentSpec> = { hub: { references } };
    for (let i = 0; i < 12; i++) components[`c${i}`] = {};
    writePurpose(tmpDir, { components });

    const slice = await graphSliceFromRoot(tmpDir, { symbol: '#hub', radius: 1 });

    expect(slice.truncated).toBe(true);
    const moreNode = slice.nodes.find((n) => n.label.startsWith('+'));
    expect(moreNode).toBeDefined();
    // 12 neighbors, cap 8 → "+4 more"
    expect(moreNode!.label).toBe('+4 more');
    const realNeighbors = slice.nodes.filter((n) => /^#c\d+$/.test(n.id));
    expect(realNeighbors).toHaveLength(8);
  });

  it('does not set truncated when within the degree cap', async () => {
    writePurpose(tmpDir, { components: { hub: { references: ['#a', '#b'] }, a: {}, b: {} } });
    const slice = await graphSliceFromRoot(tmpDir, { symbol: '#hub' });
    expect(slice.truncated).toBe(false);
  });
});

describe('edge-kind taxonomy', () => {
  it('classifies gate / flow / reciprocal / plain edges', async () => {
    writePurpose(tmpDir, {
      components: {
        root: { references: ['^auth', '$checkout', '#peer', '#plain'] },
        peer: { references: ['#root'] },
        plain: {},
      },
      gates: { auth: {} },
      flows: { checkout: { steps: ['#root'] } },
    });
    const slice = await graphSliceFromRoot(tmpDir, { symbol: '#root', radius: 1 });
    const find = (t: string) => slice.edges.find((e) => e.source === '#root' && e.target === t)?.kind;

    expect(find('^auth')).toBe('gated-by');
    // The parser canonicalizes the `$checkout` reference to the `$$checkout`
    // flow symbol form; the edge to it is in-flow.
    expect(find('$$checkout')).toBe('in-flow');
    // #peer references #root back, so from #root's view #peer is a used-by (upstream) edge.
    expect(find('#peer')).toBe('used-by');
    expect(find('#plain')).toBe('uses');
  });
});

describe('freshness', () => {
  it('always reports fresh — a live parse is the source of truth', async () => {
    writePurpose(tmpDir, { components: { foo: {} } });
    const slice = await graphSliceFromRoot(tmpDir, { symbol: '#foo' });
    expect(slice.freshness.stale).toBe(false);
    // generatedAt is the parse timestamp (a valid ISO string).
    expect(Number.isNaN(Date.parse(slice.freshness.generatedAt!))).toBe(false);
  });
});

describe('unioned edge sources (flow membership + ripple dependents)', () => {
  it('yields an in-flow edge from a flow member to its $$flow (the #cockpit-view → $$fleet-switch case)', async () => {
    // #cockpit-view has NO direct references yet is a step of $$fleet-switch.
    // The old related-only projector rendered it bare; the live projector must
    // surface the in-flow edge.
    writePurpose(tmpDir, {
      components: { 'cockpit-view': {}, 'session-row': {}, 'fleet-store': {} },
      flows: {
        'fleet-switch': {
          symbol: '$$fleet-switch',
          steps: ['#session-row', '#fleet-store', '#cockpit-view'],
        },
      },
    });

    const slice = await graphSliceFromRoot(tmpDir, { symbol: '#cockpit-view', radius: 1 });

    const flowEdge = slice.edges.find((e) => e.source === '#cockpit-view' && e.kind === 'in-flow');
    expect(flowEdge).toBeDefined();
    expect(flowEdge!.target).toBe('$$fleet-switch');

    // The $flow node is present and correctly kinded.
    const flowNode = slice.nodes.find((n) => n.id === '$$fleet-switch');
    expect(flowNode).toBeDefined();
    expect(flowNode!.kind).toBe('flow');

    // A reference-less symbol is no longer bare.
    expect(slice.edges.length).toBeGreaterThan(0);
  });

  it('surfaces ripple-derived dependents as used-by edges even when references are empty', async () => {
    // #leaf has no references, but #hub references it → #leaf must see #hub upstream.
    writePurpose(tmpDir, { components: { hub: { references: ['#leaf'] }, leaf: {} } });
    const slice = await graphSliceFromRoot(tmpDir, { symbol: '#leaf', radius: 1 });
    const upstream = slice.edges.find((e) => e.source === '#leaf' && e.target === '#hub');
    expect(upstream).toBeDefined();
    expect(upstream!.kind).toBe('used-by');
    expect(slice.nodes.map((n) => n.id)).toContain('#hub');
  });

  it('flow mode expands to sibling flow members', async () => {
    writePurpose(tmpDir, {
      components: { 'cockpit-view': {}, 'session-row': {}, 'fleet-store': {} },
      flows: { 'fleet-switch': { steps: ['#session-row', '#fleet-store', '#cockpit-view'] } },
    });
    const slice = await graphSliceFromRoot(tmpDir, { symbol: '#cockpit-view', mode: 'flow', radius: 1 });
    const ids = slice.nodes.map((n) => n.id);
    expect(ids).toContain('#session-row');
    expect(ids).toContain('#fleet-store');
  });

  it('stays byte-identical across repeat parses WITH the unioned sources', async () => {
    writePurpose(tmpDir, {
      components: {
        root: { references: ['#a', '#b'] },
        a: { references: ['#root'] },
        b: {},
        sibling: { references: ['#root'] }, // contributes a reverse used-by edge
      },
      flows: { theflow: { steps: ['#root', '#a'] } },
    });

    // Normalize the live-parse timestamp out — it is intentionally `new Date()`
    // per call; the byte-identical guarantee is over the graph STRUCTURE.
    const norm = (s: string) => s.replace(/"generatedAt":"[^"]*"/, '"generatedAt":"X"');
    const first = norm(JSON.stringify(await graphSliceFromRoot(tmpDir, { symbol: '#root', radius: 2 })));
    const second = norm(JSON.stringify(await graphSliceFromRoot(tmpDir, { symbol: '#root', radius: 2 })));
    expect(second).toBe(first);
  });

  it('enforces the degree cap when the union exceeds 8 neighbors', async () => {
    // 6 references + 4 reverse dependents = 10 unioned neighbors on #hub.
    const components: Record<string, ComponentSpec> = {
      hub: { references: ['#r0', '#r1', '#r2', '#r3', '#r4', '#r5'] },
    };
    for (let i = 0; i < 6; i++) components[`r${i}`] = {};
    for (let i = 0; i < 4; i++) components[`up${i}`] = { references: ['#hub'] };
    writePurpose(tmpDir, { components });

    const slice = await graphSliceFromRoot(tmpDir, { symbol: '#hub', radius: 1 });
    expect(slice.truncated).toBe(true);
    const moreNode = slice.nodes.find((n) => n.label.startsWith('+'));
    expect(moreNode).toBeDefined();
    // 10 unioned neighbors, cap 8 → "+2 more".
    expect(moreNode!.label).toBe('+2 more');
  });

  it('emits no in-flow edge when the symbol is in no flow', async () => {
    writePurpose(tmpDir, { components: { root: { references: ['#child'] }, child: {} } });
    const slice = await graphSliceFromRoot(tmpDir, { symbol: '#root' });
    expect(slice.edges.some((e) => e.kind === 'in-flow')).toBe(false);
    expect(slice.didYouMean).toBeUndefined();
  });
});

describe('sliceToMermaid', () => {
  it('emits a graph LR projection of the same slice', async () => {
    writePurpose(tmpDir, { components: { root: { references: ['#child'] }, child: {} } });
    const slice = await graphSliceFromRoot(tmpDir, { symbol: '#root' });
    const mermaid = sliceToMermaid(slice);

    expect(mermaid.startsWith('graph LR')).toBe(true);
    expect(mermaid).toContain('-->|');
    // One edge line per edge.
    expect(mermaid.match(/-->/g)).toHaveLength(slice.edges.length);
  });
});
