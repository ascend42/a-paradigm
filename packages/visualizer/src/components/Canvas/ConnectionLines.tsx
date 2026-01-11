/**
 * SVG connection lines between nodes
 */

import type { SymbolEntry } from '../../types';

interface ConnectionLinesProps {
  nodes: SymbolEntry[];
}

export function ConnectionLines({ nodes }: ConnectionLinesProps) {
  // Build a map of symbol -> position
  const positionMap = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    if (node.position) {
      positionMap.set(node.symbol, node.position);
    }
  }

  // Collect all connections
  const connections: Array<{
    from: { x: number; y: number };
    to: { x: number; y: number };
    key: string;
  }> = [];

  for (const node of nodes) {
    if (!node.position) continue;

    for (const ref of node.references) {
      const targetPos = positionMap.get(ref);
      if (targetPos) {
        connections.push({
          from: { x: node.position.x + 60, y: node.position.y + 20 },
          to: { x: targetPos.x + 60, y: targetPos.y + 20 },
          key: `${node.symbol}-${ref}`,
        });
      }
    }
  }

  if (connections.length === 0) {
    return null;
  }

  return (
    <svg className="connections-layer">
      <defs>
        <marker
          id="arrowhead"
          markerWidth="10"
          markerHeight="7"
          refX="9"
          refY="3.5"
          orient="auto"
        >
          <polygon points="0 0, 10 3.5, 0 7" fill="currentColor" />
        </marker>
      </defs>
      {connections.map(({ from, to, key }) => {
        // Calculate bezier curve control points
        const dx = to.x - from.x;
        const cx1 = from.x + dx * 0.5;
        const cy1 = from.y;
        const cx2 = from.x + dx * 0.5;
        const cy2 = to.y;

        return (
          <path
            key={key}
            className="connection-line"
            d={`M ${from.x} ${from.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${to.x} ${to.y}`}
            markerEnd="url(#arrowhead)"
          />
        );
      })}
    </svg>
  );
}
