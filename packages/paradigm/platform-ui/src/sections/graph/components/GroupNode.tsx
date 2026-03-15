import { memo, useState, useCallback } from 'react';
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';
import type { GroupNodeData } from '../types';
import { useGraphStore } from '../store/graphStore';

function GroupNodeComponent({ id, data, selected }: NodeProps) {
  const d = data as GroupNodeData;
  const updateGroupLabel = useGraphStore((s) => s.updateGroupLabel);
  const [editing, setEditing] = useState(false);
  const [labelText, setLabelText] = useState(d.label);

  const handleDoubleClick = useCallback(() => {
    setLabelText(d.label);
    setEditing(true);
  }, [d.label]);

  const handleBlur = useCallback(() => {
    setEditing(false);
    if (labelText.trim()) {
      updateGroupLabel(id, labelText.trim());
    }
  }, [id, labelText, updateGroupLabel]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        (e.target as HTMLInputElement).blur();
      } else if (e.key === 'Escape') {
        setLabelText(d.label);
        setEditing(false);
      }
    },
    [d.label]
  );

  return (
    <div className="group-node">
      <NodeResizer
        minWidth={200}
        minHeight={100}
        isVisible={selected}
        lineClassName="group-node__resizer-line"
        handleClassName="group-node__resizer-handle"
      />
      <Handle type="target" position={Position.Left} className="group-handle" />
      <div className="group-node__header" onDoubleClick={handleDoubleClick}>
        {editing ? (
          <input
            className="group-node__input"
            value={labelText}
            onChange={(e) => setLabelText(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            autoFocus
          />
        ) : (
          <span className="group-node__label">{d.label}</span>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="group-handle" />
    </div>
  );
}

export default memo(GroupNodeComponent);
