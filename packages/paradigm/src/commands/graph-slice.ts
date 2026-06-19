/**
 * paradigm graph slice <symbol> — #graph-slice-command
 *
 * Projects a BOUNDED slice of the real symbol graph centered on a symbol and
 * emits it in renderable formats. Thin CLI shell over the shared
 * #graph-slice-projector in @a-company/premise-core — zero traversal logic here.
 *
 * Formats:
 *   (default)        human-readable summary via cli-output helpers
 *   --format mermaid ```mermaid `graph LR` projection (renders in cockpit + GitHub)
 *   --format envelope / --as-lightbox  ```conductor-visual fenced block
 *   --format json    raw projector output
 *
 * On a missed symbol: prints did-you-mean candidates and exits non-zero.
 */

import { graphSliceFromRoot, sliceToMermaid, type GraphSlice, type SliceMode } from '@a-company/premise-core';
import { log } from '../utils/logger.js';
import { out, success, warn, error as cliError, dim, header, kv, json } from '../utils/cli-output.js';

export interface GraphSliceOptions {
  radius?: string;
  mode?: string;
  format?: string; // mermaid | envelope | json
  asLightbox?: boolean;
}

const VALID_FORMATS = new Set(['mermaid', 'envelope', 'json']);
const VALID_MODES = new Set(['ego', 'ripple', 'flow']);

export async function graphSliceCommand(
  symbol: string,
  pathArg: string | undefined,
  options: GraphSliceOptions,
): Promise<void> {
  const rootDir = pathArg || process.cwd();
  const radius = options.radius ? parseInt(options.radius, 10) : 1;
  const mode = (options.mode || 'ego') as SliceMode;

  if (options.mode && !VALID_MODES.has(options.mode)) {
    cliError(`Invalid mode: "${options.mode}". Expected: ego | ripple | flow`);
    process.exit(1);
  }
  if (options.format && !VALID_FORMATS.has(options.format)) {
    cliError(`Invalid format: "${options.format}". Expected: mermaid | envelope | json`);
    process.exit(1);
  }

  let slice: GraphSlice;
  try {
    slice = await graphSliceFromRoot(rootDir, { symbol, radius, mode });
  } catch (err) {
    cliError(`Failed to project graph slice: ${(err as Error).message}`);
    process.exit(1);
    return;
  }

  // Only log to stdout in human mode — machine formats (mermaid/envelope/json)
  // must emit ONLY the renderable payload so they pipe cleanly.
  const machineFormat = options.asLightbox || options.format;
  if (!machineFormat && process.env.DEBUG) {
    log.component('graph-slice-command').info('Projected graph slice', {
      symbol,
      radius,
      mode,
      nodes: slice.nodes.length,
      edges: slice.edges.length,
      truncated: slice.truncated,
    });
  }

  // ── Fail loud on a missed resolve ───────────────────────
  if (slice.didYouMean) {
    cliError(`Symbol not found: ${symbol}`);
    if (slice.didYouMean.length > 0) {
      out('');
      dim('  Did you mean:');
      for (const candidate of slice.didYouMean) {
        out('    ' + candidate);
      }
      out('');
    } else {
      dim('  No similar symbols found. Run `paradigm scan` to (re)build the index.');
    }
    process.exit(1);
    return;
  }

  // ── Render-by-format ────────────────────────────────────
  const format = options.format;

  if (options.asLightbox || format === 'envelope') {
    out(renderEnvelope(slice));
    return;
  }
  if (format === 'mermaid') {
    out(renderMermaidBlock(slice));
    return;
  }
  if (format === 'json') {
    json(slice);
    return;
  }

  // Default: human-readable summary.
  renderSummary(slice, mode, radius);
}

// ────────────────────────────────────────────────────────
// Renderers
// ────────────────────────────────────────────────────────

function renderMermaidBlock(slice: GraphSlice): string {
  return '```mermaid\n' + sliceToMermaid(slice) + '\n```';
}

function renderEnvelope(slice: GraphSlice): string {
  const envelope = {
    id: `graph-${slice.root.replace(/^[#$^!~]/, '')}`,
    kind: 'graph',
    title: `Graph slice: ${slice.root}`,
    payload: slice,
  };
  return '```conductor-visual\n' + JSON.stringify(envelope, null, 2) + '\n```';
}

function renderSummary(slice: GraphSlice, mode: SliceMode, radius: number): void {
  header(`Graph slice — ${slice.root}`);
  kv('mode', mode);
  kv('radius', String(radius));
  kv('nodes', String(slice.nodes.length));
  kv('edges', String(slice.edges.length));
  kv('generated', slice.freshness.generatedAt || 'unknown');
  if (slice.freshness.stale) {
    warn('  scan-index is STALE — a .purpose is newer than the index. Run `paradigm scan`.');
  }
  if (slice.truncated) {
    warn('  slice truncated — some nodes have >8 neighbors (collapsed to +N more).');
  }

  out('');
  dim('  Nodes:');
  for (const node of slice.nodes) {
    out(`    ${node.id}  ${dimKind(node.kind)}`);
  }

  out('');
  dim('  Edges:');
  for (const edge of slice.edges) {
    out(`    ${edge.source} --(${edge.kind})--> ${edge.target}`);
  }
  out('');
  success(`Projected ${slice.nodes.length} node(s), ${slice.edges.length} edge(s).`);
  dim('  Render: --format mermaid (cockpit/GitHub) | --as-lightbox (conductor-visual)');
}

function dimKind(kind: string): string {
  return `[${kind}]`;
}
