/**
 * Node renderer - renders nodes based on their type
 */

import { useCallback } from 'react';
import type { SymbolEntry, SymbolType } from '../../types';
import { useNodesStore } from '../../store/nodesStore';

interface NodeRendererProps {
  node: SymbolEntry;
}

// v2 symbol types
const TYPE_TO_PREFIX: Record<SymbolType, string> = {
  component: '#',
  flow: '$',
  gate: '^',
  signal: '!',
  aspect: '~',
};

// Helper to get display name
function getDisplayName(symbol: string): string {
  return symbol.slice(1);
}

// Helper to get display prefix
function getDisplayPrefix(type: SymbolType): string {
  return TYPE_TO_PREFIX[type];
}

export function NodeRenderer({ node }: NodeRendererProps) {
  const { selectedId, selectNode, hoverNode } = useNodesStore();

  const isSelected = selectedId === node.id;
  const prefix = getDisplayPrefix(node.type);
  const name = getDisplayName(node.symbol);

  // Get position or use default
  const position = node.position || { x: Math.random() * 400, y: Math.random() * 400 };

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      selectNode(node.id);
    },
    [node.id, selectNode]
  );

  // Build CSS classes
  const nodeClasses = [
    `node`,
    `node--${node.type}`,
    isSelected ? 'selected' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={nodeClasses}
      style={{
        left: position.x,
        top: position.y,
      }}
      onClick={handleClick}
      onMouseEnter={() => hoverNode(node.id)}
      onMouseLeave={() => hoverNode(null)}
    >
      <div className="node-header">
        <span className="node-symbol">{prefix}</span>
        <span className="node-name">{name}</span>
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
