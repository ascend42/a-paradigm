import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { SymbolNodeData, SymbolCategory } from '../types';
import { CATEGORY_COLORS } from '../types';

function SymbolNodeComponent({ data }: NodeProps) {
  const d = data as SymbolNodeData;
  const color = CATEGORY_COLORS[d.symbol.category as SymbolCategory] || 'var(--p-symbol-node-component)';
  const desc = d.symbol.description || '';
  const truncated = desc.length > 60 ? desc.slice(0, 57) + '...' : desc;

  return (
    <div className="symbol-node" style={{ borderLeftColor: color }}>
      <Handle type="target" position={Position.Left} />
      <div className="symbol-node__name" style={{ color }}>{d.label}</div>
      {truncated && (
        <div className="symbol-node__desc">{truncated}</div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export default memo(SymbolNodeComponent);
