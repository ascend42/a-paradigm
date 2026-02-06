/**
 * Grid View - Displays nodes in columns grouped by type
 */

import { useMemo } from 'react';
import type { SymbolEntry, SymbolType } from '../../types';
import { useNodesStore } from '../../store/nodesStore';

// v2 symbol types
const TYPE_INFO: Record<SymbolType, { prefix: string; label: string; color: string }> = {
  component: { prefix: '#', label: 'Components', color: 'var(--color-component)' },
  flow: { prefix: '$', label: 'Flows', color: 'var(--color-flow)' },
  gate: { prefix: '^', label: 'Gates', color: 'var(--color-gate)' },
  signal: { prefix: '!', label: 'Signals', color: 'var(--color-signal)' },
  aspect: { prefix: '~', label: 'Aspects', color: 'var(--color-aspect)' },
};

const TYPE_ORDER: SymbolType[] = ['component', 'flow', 'gate', 'signal', 'aspect'];

interface GridCardProps {
  node: SymbolEntry;
  isSelected: boolean;
  onClick: () => void;
}

function GridCard({ node, isSelected, onClick }: GridCardProps) {
  const info = TYPE_INFO[node.type];
  const name = node.symbol.slice(1); // Remove prefix

  return (
    <div
      className={`grid-card grid-card--${node.type} ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
    >
      <div className="grid-card-header">
        <span className="grid-card-symbol" style={{ color: info.color }}>
          {info.prefix}
        </span>
        <span className="grid-card-name">{name}</span>
      </div>
      {node.description && (
        <div className="grid-card-description">{node.description}</div>
      )}
      {node.tags && node.tags.length > 0 && (
        <div className="grid-card-tags">
          {node.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="grid-card-tag">{tag}</span>
          ))}
          {node.tags.length > 2 && (
            <span className="grid-card-tag">+{node.tags.length - 2}</span>
          )}
        </div>
      )}
    </div>
  );
}

export function GridView() {
  const { getSortedNodes, selectedId, selectNode, visibleTypes } = useNodesStore();
  const nodes = getSortedNodes();

  // Group nodes by type (v2)
  const groupedNodes = useMemo(() => {
    const groups: Record<SymbolType, SymbolEntry[]> = {
      component: [],
      flow: [],
      gate: [],
      signal: [],
      aspect: [],
    };

    nodes.forEach((node) => {
      if (groups[node.type]) {
        groups[node.type].push(node);
      }
    });

    return groups;
  }, [nodes]);

  // Get visible type columns (only types with nodes or that are visible)
  const visibleColumns = TYPE_ORDER.filter(
    (type) => visibleTypes.includes(type) && groupedNodes[type].length > 0
  );

  if (nodes.length === 0) {
    return (
      <div className="grid-view grid-view--empty">
        <p>No symbols match the current filters</p>
      </div>
    );
  }

  return (
    <div className="grid-view">
      <div className="grid-columns" style={{ gridTemplateColumns: `repeat(${visibleColumns.length}, 1fr)` }}>
        {visibleColumns.map((type) => {
          const info = TYPE_INFO[type];
          const typeNodes = groupedNodes[type];

          return (
            <div key={type} className="grid-column">
              <div className="grid-column-header" style={{ borderColor: info.color }}>
                <span className="grid-column-prefix" style={{ color: info.color }}>
                  {info.prefix}
                </span>
                <span className="grid-column-label">{info.label}</span>
                <span className="grid-column-count">{typeNodes.length}</span>
              </div>
              <div className="grid-column-content">
                {typeNodes.map((node) => (
                  <GridCard
                    key={node.id}
                    node={node}
                    isSelected={selectedId === node.id}
                    onClick={() => selectNode(node.id)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
