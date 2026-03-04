/**
 * Graph Generate MCP Tool - Produces GraphState JSON for the Symbol Graph UI
 *
 * Accepts optional symbols, groups, and links; reads scan-index.json to resolve
 * symbol data; auto-positions nodes in a grid layout within groups.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProjectContext } from '../utils/index-loader.js';
import { trackToolCall } from './context.js';

// ============================================================================
// Types (mirror graph-ui/src/types.ts for output compatibility)
// ============================================================================

interface SymbolData {
  id: string;
  name: string;
  category: string;
  prefix: string;
  description?: string;
  path?: string;
  tags?: string[];
}

interface GraphState {
  version: '1.0';
  name: string;
  projectId: string;
  lastModified: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface GraphNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  style?: Record<string, unknown>;
  data: Record<string, unknown>;
  parentId?: string;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  label?: string;
  data: { label?: string };
}

interface GroupInput {
  label: string;
  symbols: string[];
}

interface LinkInput {
  source: string;
  target: string;
  label?: string;
}

// ============================================================================
// Constants
// ============================================================================

const CATEGORY_PREFIXES: Record<string, string> = {
  component: '#',
  flow: '$',
  gate: '^',
  signal: '!',
  aspect: '~',
};

const NODE_WIDTH = 200;
const NODE_HEIGHT = 60;
const NODE_GAP = 20;
const GROUP_PADDING = 40;
const GROUP_HEADER = 50;
const GROUP_GAP = 60;

// ============================================================================
// Tool Definition
// ============================================================================

export function getGraphToolsList() {
  return [
    {
      name: 'paradigm_graph_generate',
      description:
        'Generate a GraphState JSON document for the Paradigm Symbol Graph UI. Accepts optional symbols (filter), groups (clustering), and links (edges between groups). Returns valid GraphState ready to load. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          symbols: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Symbol names to include (e.g. ["#auth-middleware", "^authenticated"]). Omit to include all from scan-index.',
          },
          groups: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: 'Group display label' },
                symbols: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Symbol names belonging to this group',
                },
              },
              required: ['label', 'symbols'],
            },
            description: 'Optional groupings of symbols.',
          },
          links: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                source: { type: 'string', description: 'Source group label' },
                target: { type: 'string', description: 'Target group label' },
                label: { type: 'string', description: 'Edge label' },
              },
              required: ['source', 'target'],
            },
            description: 'Edges between groups (by label name).',
          },
          name: {
            type: 'string',
            description: 'Graph name (default: "Generated Graph").',
          },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
  ];
}

// ============================================================================
// Tool Handler
// ============================================================================

export async function handleGraphTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ handled: boolean; text: string }> {
  if (name !== 'paradigm_graph_generate') {
    return { handled: false, text: '' };
  }

  try {
    const result = buildGraphState(
      ctx.rootDir,
      args.symbols as string[] | undefined,
      args.groups as GroupInput[] | undefined,
      args.links as LinkInput[] | undefined,
      (args.name as string) || 'Generated Graph',
    );

    const text = JSON.stringify(result, null, 2);
    trackToolCall(text.length, name);
    return { handled: true, text };
  } catch (err) {
    const text = JSON.stringify({ error: (err as Error).message }, null, 2);
    trackToolCall(text.length, name);
    return { handled: true, text };
  }
}

// ============================================================================
// Graph Building Logic
// ============================================================================

const SCAN_CATEGORY_MAP: Record<string, string> = {
  components: 'component',
  flows: 'flow',
  gates: 'gate',
  signals: 'signal',
  aspects: 'aspect',
};

function loadScanIndex(rootDir: string): SymbolData[] {
  const indexPath = path.join(rootDir, '.paradigm', 'scan-index.json');
  if (!fs.existsSync(indexPath)) return [];

  const raw = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const symbols: SymbolData[] = [];

  // scan-index uses category keys: components, gates, flows, signals, aspects
  for (const [sectionKey, categoryName] of Object.entries(SCAN_CATEGORY_MAP)) {
    const section = raw[sectionKey];
    if (!section || typeof section !== 'object') continue;
    for (const [id, sym] of Object.entries(section)) {
      const s = sym as Record<string, unknown>;
      symbols.push({
        id,
        name: id,
        category: categoryName,
        prefix: CATEGORY_PREFIXES[categoryName] || '#',
        description: s.description as string | undefined,
        path: s.path as string | undefined,
        tags: s.tags as string[] | undefined,
      });
    }
  }

  return symbols;
}

function resolveSymbol(name: string, allSymbols: SymbolData[]): SymbolData | undefined {
  // Try exact match with prefix stripped
  const stripped = name.replace(/^[#$^!~]/, '');
  return allSymbols.find(
    (s) => s.id === stripped || s.name === stripped || s.id === name || s.name === name,
  );
}

export function buildGraphState(
  rootDir: string,
  symbolFilter?: string[],
  groups?: GroupInput[],
  links?: LinkInput[],
  graphName = 'Generated Graph',
): GraphState {
  const allSymbols = loadScanIndex(rootDir);

  // Determine which symbols to include
  let included: SymbolData[];
  if (symbolFilter && symbolFilter.length > 0) {
    included = symbolFilter
      .map((name) => resolveSymbol(name, allSymbols))
      .filter(Boolean) as SymbolData[];
  } else {
    included = allSymbols;
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const groupIdMap = new Map<string, string>(); // label -> groupId
  const assignedSymbols = new Set<string>();

  let nextGroupX = 0;

  // Build groups
  if (groups && groups.length > 0) {
    for (const group of groups) {
      const groupId = `group-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      groupIdMap.set(group.label, groupId);

      const memberSymbols = group.symbols
        .map((name) => resolveSymbol(name, included))
        .filter(Boolean) as SymbolData[];

      // Grid layout for members inside group
      const cols = Math.ceil(Math.sqrt(memberSymbols.length));
      const rows = Math.ceil(memberSymbols.length / cols);

      for (let i = 0; i < memberSymbols.length; i++) {
        const sym = memberSymbols[i];
        const col = i % cols;
        const row = Math.floor(i / cols);
        const prefix = CATEGORY_PREFIXES[sym.category] || '#';

        nodes.push({
          id: `sym-${sym.id}`,
          type: 'symbolNode',
          position: {
            x: GROUP_PADDING + col * (NODE_WIDTH + NODE_GAP),
            y: GROUP_HEADER + GROUP_PADDING + row * (NODE_HEIGHT + NODE_GAP),
          },
          parentId: groupId,
          data: {
            type: 'symbol',
            symbol: sym,
            label: `${prefix}${sym.name}`,
          },
        });
        assignedSymbols.add(sym.id);
      }

      // Compute group dimensions
      const cols2 = Math.max(cols, 1);
      const rows2 = Math.max(rows, 1);
      const groupWidth = GROUP_PADDING * 2 + cols2 * NODE_WIDTH + (cols2 - 1) * NODE_GAP;
      const groupHeight = GROUP_HEADER + GROUP_PADDING * 2 + rows2 * NODE_HEIGHT + (rows2 - 1) * NODE_GAP;

      // Group node must come before its children in the array
      nodes.unshift({
        id: groupId,
        type: 'groupNode',
        position: { x: nextGroupX, y: 0 },
        style: { width: groupWidth, height: groupHeight },
        data: { type: 'group', label: group.label },
      });

      nextGroupX += groupWidth + GROUP_GAP;
    }
  }

  // Place ungrouped symbols in a grid below/after groups
  const ungrouped = included.filter((s) => !assignedSymbols.has(s.id));
  if (ungrouped.length > 0) {
    const startY = groups && groups.length > 0 ? 400 : 0;
    const cols = Math.ceil(Math.sqrt(ungrouped.length));
    for (let i = 0; i < ungrouped.length; i++) {
      const sym = ungrouped[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const prefix = CATEGORY_PREFIXES[sym.category] || '#';

      nodes.push({
        id: `sym-${sym.id}`,
        type: 'symbolNode',
        position: {
          x: col * (NODE_WIDTH + NODE_GAP),
          y: startY + row * (NODE_HEIGHT + NODE_GAP),
        },
        data: {
          type: 'symbol',
          symbol: sym,
          label: `${prefix}${sym.name}`,
        },
      });
    }
  }

  // Build edges between groups
  if (links && links.length > 0) {
    for (const link of links) {
      const sourceId = groupIdMap.get(link.source);
      const targetId = groupIdMap.get(link.target);
      if (sourceId && targetId) {
        edges.push({
          id: `e-${sourceId}-${targetId}`,
          source: sourceId,
          target: targetId,
          type: 'default',
          label: link.label,
          data: { label: link.label },
        });
      }
    }
  }

  return {
    version: '1.0',
    name: graphName,
    projectId: path.basename(rootDir),
    lastModified: new Date().toISOString(),
    nodes,
    edges,
  };
}
