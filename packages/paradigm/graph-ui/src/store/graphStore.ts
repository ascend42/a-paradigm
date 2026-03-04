import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from '@xyflow/react';
import type {
  SymbolData,
  GraphNode,
  GraphEdge,
  GraphState,
  SymbolNodeData,
  GroupNodeData,
  SymbolCategory,
} from '../types';
import { CATEGORY_PREFIXES } from '../types';

const STORAGE_KEY = 'paradigm-graph-state';
const DEBOUNCE_MS = 500;

interface GraphStore {
  // Data
  symbols: SymbolData[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  graphName: string;
  exportOpen: boolean;
  loadDialogOpen: boolean;

  // Actions
  fetchSymbols: () => Promise<void>;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addSymbolToCanvas: (symbol: SymbolData, position: { x: number; y: number }) => void;
  removeSelected: () => void;
  groupSelected: (label: string) => void;
  ungroupSelected: () => void;
  addNodeToGroup: (nodeId: string, groupId: string) => void;
  removeNodeFromGroup: (nodeId: string) => void;
  updateGroupLabel: (nodeId: string, label: string) => void;
  updateEdgeLabel: (edgeId: string, label: string) => void;
  setGraphName: (name: string) => void;
  setExportOpen: (open: boolean) => void;
  setLoadDialogOpen: (open: boolean) => void;
  saveToLocalStorage: () => void;
  loadFromLocalStorage: () => void;
  exportToFile: () => void;
  importFromFile: (state: GraphState) => void;
  exportToMarkdown: () => string;
  newGraph: () => void;
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null;

function debouncedSave(store: GraphStore) {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => store.saveToLocalStorage(), DEBOUNCE_MS);
}

export const useGraphStore = create<GraphStore>((set, get) => ({
  symbols: [],
  nodes: [],
  edges: [],
  graphName: 'Untitled Graph',
  exportOpen: false,
  loadDialogOpen: false,

  fetchSymbols: async () => {
    try {
      const res = await fetch('/api/symbols');
      const data = await res.json();
      set({ symbols: data.symbols || [] });
    } catch (err) {
      console.error('Failed to fetch symbols:', err);
    }
  },

  onNodesChange: (changes) => {
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes) as GraphNode[],
    }));
    debouncedSave(get());
  },

  onEdgesChange: (changes) => {
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges) as GraphEdge[],
    }));
    debouncedSave(get());
  },

  onConnect: (connection) => {
    const id = `e-${connection.source}-${connection.target}`;
    const edge: GraphEdge = {
      id,
      source: connection.source!,
      target: connection.target!,
      type: 'default',
      data: { label: '' },
    };
    set((state) => ({ edges: [...state.edges, edge] }));
    debouncedSave(get());
  },

  addSymbolToCanvas: (symbol, position) => {
    const { nodes } = get();
    // Dedupe by symbol id
    if (nodes.some((n) => n.id === `sym-${symbol.id}`)) return;

    const prefix = CATEGORY_PREFIXES[symbol.category as SymbolCategory] || '#';
    const newNode: GraphNode = {
      id: `sym-${symbol.id}`,
      type: 'symbolNode',
      position,
      data: {
        type: 'symbol',
        symbol,
        label: `${prefix}${symbol.name}`,
      } as SymbolNodeData,
    };
    set((state) => ({ nodes: [...state.nodes, newNode] }));
    debouncedSave(get());
  },

  removeSelected: () => {
    set((state) => {
      const selectedNodeIds = new Set(
        state.nodes.filter((n) => n.selected).map((n) => n.id)
      );
      // Also remove child nodes of selected groups
      const childNodeIds = new Set(
        state.nodes
          .filter((n) => n.parentId && selectedNodeIds.has(n.parentId))
          .map((n) => n.id)
      );
      const allRemoved = new Set([...selectedNodeIds, ...childNodeIds]);

      return {
        nodes: state.nodes.filter((n) => !allRemoved.has(n.id)),
        edges: state.edges.filter(
          (e) =>
            !allRemoved.has(e.source) &&
            !allRemoved.has(e.target) &&
            !e.selected
        ),
      };
    });
    debouncedSave(get());
  },

  groupSelected: (label) => {
    const { nodes } = get();
    const selected = nodes.filter((n) => n.selected && n.type !== 'groupNode');
    if (selected.length < 1) return;

    // Compute bounding box
    const padding = 40;
    const headerHeight = 50;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of selected) {
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + 200);
      maxY = Math.max(maxY, n.position.y + 60);
    }

    const groupId = `group-${Date.now()}`;
    const groupNode: GraphNode = {
      id: groupId,
      type: 'groupNode',
      position: { x: minX - padding, y: minY - padding - headerHeight },
      style: {
        width: maxX - minX + padding * 2 + 200,
        height: maxY - minY + padding * 2 + headerHeight + 60,
      },
      data: {
        type: 'group',
        label,
      } as GroupNodeData,
    };

    // Reparent children — positions become relative to group
    const updatedNodes = nodes.map((n) => {
      if (n.selected && n.type !== 'groupNode') {
        return {
          ...n,
          parentId: groupId,
          position: {
            x: n.position.x - (minX - padding),
            y: n.position.y - (minY - padding - headerHeight),
          },
          selected: false,
        };
      }
      return { ...n, selected: false };
    });

    set({ nodes: [groupNode, ...updatedNodes] });
    debouncedSave(get());
  },

  ungroupSelected: () => {
    const { nodes } = get();
    const selectedGroups = nodes.filter(
      (n) => n.selected && n.type === 'groupNode'
    );
    if (selectedGroups.length === 0) return;

    const groupIds = new Set(selectedGroups.map((g) => g.id));

    const updatedNodes = nodes
      .filter((n) => !groupIds.has(n.id))
      .map((n) => {
        if (n.parentId && groupIds.has(n.parentId)) {
          const parent = selectedGroups.find((g) => g.id === n.parentId);
          return {
            ...n,
            parentId: undefined,
            position: parent
              ? {
                  x: n.position.x + parent.position.x,
                  y: n.position.y + parent.position.y,
                }
              : n.position,
          };
        }
        return n;
      });

    set({ nodes: updatedNodes });
    debouncedSave(get());
  },

  addNodeToGroup: (nodeId, groupId) => {
    const { nodes } = get();
    const node = nodes.find((n) => n.id === nodeId);
    const group = nodes.find((n) => n.id === groupId);
    if (!node || !group || node.parentId === groupId) return;

    // Convert absolute position to relative (subtract group position)
    const updatedNodes = nodes.map((n) => {
      if (n.id === nodeId) {
        return {
          ...n,
          parentId: groupId,
          position: {
            x: n.position.x - group.position.x,
            y: n.position.y - group.position.y,
          },
        };
      }
      return n;
    });
    set({ nodes: updatedNodes });
    debouncedSave(get());
  },

  removeNodeFromGroup: (nodeId) => {
    const { nodes } = get();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node || !node.parentId) return;

    const parent = nodes.find((n) => n.id === node.parentId);
    const updatedNodes = nodes.map((n) => {
      if (n.id === nodeId) {
        return {
          ...n,
          parentId: undefined,
          position: parent
            ? {
                x: n.position.x + parent.position.x,
                y: n.position.y + parent.position.y,
              }
            : n.position,
        };
      }
      return n;
    });
    set({ nodes: updatedNodes });
    debouncedSave(get());
  },

  updateGroupLabel: (nodeId, label) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, label } } : n
      ),
    }));
    debouncedSave(get());
  },

  updateEdgeLabel: (edgeId, label) => {
    set((state) => ({
      edges: state.edges.map((e) =>
        e.id === edgeId ? { ...e, label, data: { ...e.data, label } } : e
      ),
    }));
    debouncedSave(get());
  },

  setGraphName: (name) => {
    set({ graphName: name });
    debouncedSave(get());
  },

  setExportOpen: (open) => set({ exportOpen: open }),
  setLoadDialogOpen: (open) => set({ loadDialogOpen: open }),

  saveToLocalStorage: () => {
    const { nodes, edges, graphName } = get();
    const state: GraphState = {
      version: '1.0',
      name: graphName,
      projectId: window.location.hostname,
      lastModified: new Date().toISOString(),
      nodes,
      edges,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.error('Failed to save to localStorage:', err);
    }
  },

  loadFromLocalStorage: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const state: GraphState = JSON.parse(raw);
      set({
        nodes: state.nodes || [],
        edges: state.edges || [],
        graphName: state.name || 'Untitled Graph',
      });
    } catch (err) {
      console.error('Failed to load from localStorage:', err);
    }
  },

  exportToFile: () => {
    const { nodes, edges, graphName } = get();
    const state: GraphState = {
      version: '1.0',
      name: graphName,
      projectId: window.location.hostname,
      lastModified: new Date().toISOString(),
      nodes,
      edges,
    };
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${graphName.toLowerCase().replace(/\s+/g, '-')}.graph.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  importFromFile: (state) => {
    set({
      nodes: state.nodes || [],
      edges: state.edges || [],
      graphName: state.name || 'Imported Graph',
    });
    get().saveToLocalStorage();
  },

  exportToMarkdown: () => {
    const { nodes, edges, graphName } = get();

    const groups = nodes.filter((n) => n.type === 'groupNode');
    const symbolNodes = nodes.filter((n) => n.type === 'symbolNode');

    const lines: string[] = [`## Paradigm Graph: ${graphName}`, ''];

    // Groups
    if (groups.length > 0) {
      lines.push('### Groups');
      for (const group of groups) {
        const label = (group.data as GroupNodeData).label;
        lines.push(`[${label}]`);
        const children = symbolNodes.filter((n) => n.parentId === group.id);
        for (const child of children) {
          const d = child.data as SymbolNodeData;
          const desc = d.symbol.description ? ` — ${d.symbol.description}` : '';
          lines.push(`  - ${d.label}${desc}`);
        }
        lines.push('');
      }
    }

    // Links between groups
    const groupEdges = edges.filter(
      (e) =>
        groups.some((g) => g.id === e.source) &&
        groups.some((g) => g.id === e.target)
    );
    if (groupEdges.length > 0) {
      lines.push('### Links');
      for (const e of groupEdges) {
        const src = groups.find((g) => g.id === e.source);
        const tgt = groups.find((g) => g.id === e.target);
        if (src && tgt) {
          const srcLabel = (src.data as GroupNodeData).label;
          const tgtLabel = (tgt.data as GroupNodeData).label;
          lines.push(`[${srcLabel}] → [${tgtLabel}]`);
          const label = e.label || (e.data as { label?: string })?.label;
          if (label) {
            lines.push(`  "${label}"`);
          }
        }
      }
      lines.push('');
    }

    // Ungrouped symbols
    const ungrouped = symbolNodes.filter((n) => !n.parentId);
    if (ungrouped.length > 0) {
      lines.push('### Ungrouped Symbols');
      for (const n of ungrouped) {
        const d = n.data as SymbolNodeData;
        const desc = d.symbol.description ? ` — ${d.symbol.description}` : '';
        lines.push(`- ${d.label}${desc}`);
      }
      lines.push('');
    }

    // Symbol reference
    if (symbolNodes.length > 0) {
      lines.push('### Symbol Reference');
      for (const n of symbolNodes) {
        const d = n.data as SymbolNodeData;
        const desc = d.symbol.description ? ` — ${d.symbol.description}` : '';
        const loc = d.symbol.path ? ` (${d.symbol.path})` : '';
        lines.push(`${d.symbol.category}: ${d.label}${desc}${loc}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  },

  newGraph: () => {
    set({
      nodes: [],
      edges: [],
      graphName: 'Untitled Graph',
    });
    localStorage.removeItem(STORAGE_KEY);
  },
}));
