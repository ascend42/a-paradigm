import type { Node, Edge } from '@xyflow/react';

// --- Symbol data from API ---

export interface SymbolData {
  id: string;
  name: string;
  category: SymbolCategory;
  prefix: string;
  description?: string;
  path?: string;
  tags?: string[];
  related?: string[];
}

export type SymbolCategory = 'component' | 'flow' | 'gate' | 'signal' | 'aspect';

// --- Color + prefix maps ---

export const CATEGORY_COLORS: Record<SymbolCategory, string> = {
  component: 'var(--p-symbol-node-component)',
  flow: 'var(--p-symbol-node-flow)',
  gate: 'var(--p-symbol-node-gate)',
  signal: 'var(--p-symbol-node-signal)',
  aspect: 'var(--p-symbol-node-aspect)',
};

export const CATEGORY_PREFIXES: Record<SymbolCategory, string> = {
  component: '#',
  flow: '$',
  gate: '^',
  signal: '!',
  aspect: '~',
};

export const CATEGORY_LABELS: Record<SymbolCategory, string> = {
  component: 'Components',
  flow: 'Flows',
  gate: 'Gates',
  signal: 'Signals',
  aspect: 'Aspects',
};

// --- Node data ---

export interface SymbolNodeData {
  type: 'symbol';
  symbol: SymbolData;
  label: string;
  [key: string]: unknown;
}

export interface GroupNodeData {
  type: 'group';
  label: string;
  [key: string]: unknown;
}

export type GraphNode = Node<SymbolNodeData | GroupNodeData>;
export type GraphEdge = Edge<{ label?: string }>;

// --- Persistence ---

export interface GraphState {
  version: '1.0';
  name: string;
  projectId: string;
  lastModified: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}
