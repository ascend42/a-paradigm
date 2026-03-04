import { useCallback, useRef, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  SelectionMode,
  type ReactFlowInstance,
  type NodeDragEvent,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useGraphStore } from '../store/graphStore';
import type { SymbolData } from '../types';
import SymbolNode from './SymbolNode';
import GroupNode from './GroupNode';

const nodeTypes = {
  symbolNode: SymbolNode,
  groupNode: GroupNode,
};

export default function Canvas() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const onNodesChange = useGraphStore((s) => s.onNodesChange);
  const onEdgesChange = useGraphStore((s) => s.onEdgesChange);
  const onConnect = useGraphStore((s) => s.onConnect);
  const addSymbolToCanvas = useGraphStore((s) => s.addSymbolToCanvas);
  const addNodeToGroup = useGraphStore((s) => s.addNodeToGroup);
  const removeSelected = useGraphStore((s) => s.removeSelected);
  const groupSelected = useGraphStore((s) => s.groupSelected);
  const setExportOpen = useGraphStore((s) => s.setExportOpen);

  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const rfInstance = useRef<ReactFlowInstance | null>(null);
  const { getIntersectingNodes } = useReactFlow();

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData('application/paradigm-symbol');
      if (!raw) return;

      try {
        const symbol: SymbolData = JSON.parse(raw);
        if (!rfInstance.current) return;

        const position = rfInstance.current.screenToFlowPosition({
          x: e.clientX,
          y: e.clientY,
        });

        addSymbolToCanvas(symbol, position);
      } catch {
        // Invalid JSON
      }
    },
    [addSymbolToCanvas]
  );

  const onNodeDragStop = useCallback(
    (_event: NodeDragEvent, node: Node) => {
      // Only symbol nodes can be dragged into groups
      if (node.type !== 'symbolNode' || node.parentId) return;

      const intersecting = getIntersectingNodes(node);
      const targetGroup = intersecting.find((n) => n.type === 'groupNode');
      if (targetGroup) {
        addNodeToGroup(node.id, targetGroup.id);
      }
    },
    [getIntersectingNodes, addNodeToGroup]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Don't delete when editing text inputs
        if (
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement
        )
          return;
        removeSelected();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'g') {
        e.preventDefault();
        const label = prompt('Group label:');
        if (label) groupSelected(label);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault();
        setExportOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [removeSelected, groupSelected, setExportOpen]);

  return (
    <div className="canvas-wrapper" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onInit={(instance) => {
          rfInstance.current = instance;
        }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeDragStop={onNodeDragStop}
        nodeTypes={nodeTypes}
        selectionOnDrag
        panOnDrag={[1, 2]}
        selectionMode={SelectionMode.Partial}
        multiSelectionKeyCode="Meta"
        fitView
        snapToGrid
        snapGrid={[16, 16]}
        deleteKeyCode={null}
        className="paradigm-flow"
      >
        <Background color="#1e293b" gap={16} />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            if (node.type === 'groupNode') return '#334155';
            return '#86efac';
          }}
          style={{ background: '#0f172a' }}
        />
      </ReactFlow>
    </div>
  );
}
