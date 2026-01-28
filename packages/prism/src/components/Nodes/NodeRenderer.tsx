/**
 * Node renderer - renders nodes based on their type
 */

import { useCallback, useRef, useState, useEffect } from 'react';
import type { SymbolEntry, SymbolType } from '../../types';
import { useNodesStore } from '../../store/nodesStore';
import { useCanvasStore } from '../../store/canvasStore';

interface NodeRendererProps {
  node: SymbolEntry;
}

const TYPE_TO_PREFIX: Record<SymbolType, string> = {
  feature: '@',
  component: '#',
  flow: '$',
  state: '%',
  aspect: '~',
  portal: '^',
  signal: '!',
  idea: '?',
};

// Helper to get display name (handles compound ideas)
function getDisplayName(symbol: string, type: SymbolType, ideaType?: SymbolType): string {
  if (type === 'idea' && ideaType) {
    // Compound idea: ?@subscription -> "subscription"
    return symbol.slice(2);
  }
  // Standard: @subscription -> "subscription"
  return symbol.slice(1);
}

// Helper to get display prefix (handles compound ideas)
function getDisplayPrefix(type: SymbolType, ideaType?: SymbolType): string {
  if (type === 'idea' && ideaType) {
    // Show both ? and inner prefix for compound ideas
    const innerPrefix = TYPE_TO_PREFIX[ideaType];
    return `?${innerPrefix}`; // e.g., "?@"
  }
  return TYPE_TO_PREFIX[type];
}

export function NodeRenderer({ node }: NodeRendererProps) {
  const { selectedId, selectNode, updateNodePosition, hoverNode } = useNodesStore();
  const { viewport } = useCanvasStore();
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const isSelected = selectedId === node.id;
  const prefix = getDisplayPrefix(node.type, node.ideaType);
  const name = getDisplayName(node.symbol, node.type, node.ideaType);

  // Get position or use default
  const position = node.position || { x: Math.random() * 400, y: Math.random() * 400 };

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return; // Only left click
      e.stopPropagation();

      selectNode(node.id);
      setIsDragging(true);

      // Calculate offset from node origin
      const rect = (e.target as HTMLElement).closest('.node')?.getBoundingClientRect();
      if (rect) {
        dragOffset.current = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };
      }
    },
    [node.id, selectNode]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;

      // Calculate new position accounting for viewport transform
      const newX = (e.clientX - dragOffset.current.x - viewport.x) / viewport.zoom;
      const newY = (e.clientY - dragOffset.current.y - viewport.y) / viewport.zoom;

      updateNodePosition(node.id, { x: newX, y: newY });
    },
    [isDragging, node.id, updateNodePosition, viewport]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Attach global listeners when dragging
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Build CSS classes including compound idea type
  const nodeClasses = [
    `node`,
    `node--${node.type}`,
    node.ideaType ? `node--idea-${node.ideaType}` : '',
    isSelected ? 'selected' : '',
    isDragging ? 'dragging' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={nodeClasses}
      style={{
        left: position.x,
        top: position.y,
      }}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => hoverNode(node.id)}
      onMouseLeave={() => hoverNode(null)}
    >
      <div className="node-header">
        <span className="node-symbol">{prefix}</span>
        <span className="node-name">{name}</span>
        {node.ideaType && (
          <span className="node-idea-type">Idea: {node.ideaType}</span>
        )}
      </div>
      {node.description && (
        <div className="node-description">{node.description}</div>
      )}
      {node.tags && node.tags.length > 0 && (
        <div className="node-tags">
          {node.tags.slice(0, 3).map((tag: string) => (
            <span key={tag} className="node-tag">
              {tag}
            </span>
          ))}
          {node.tags.length > 3 && (
            <span className="node-tag">+{node.tags.length - 3}</span>
          )}
        </div>
      )}
    </div>
  );
}
