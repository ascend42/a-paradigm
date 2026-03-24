import React, { useCallback } from 'react';
import { useNode, useEditor } from '@craftjs/core';

export function RenderNode({ render }: { render: React.ReactElement }) {
  const { id } = useNode();
  const { isSelected, isHovered, displayName, isCanvas } = useNode((node) => ({
    isSelected: node.events.selected,
    isHovered: node.events.hovered,
    displayName: node.data.custom?.displayName || node.data.displayName || node.data.type,
    isCanvas: node.data.isCanvas,
  }));

  const { actions } = useEditor();

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    actions.delete(id);
  }, [actions, id]);

  // ROOT node doesn't get outlines
  if (id === 'ROOT') {
    return <>{render}</>;
  }

  return (
    <div
      className={[
        'craft-node',
        isSelected ? 'craft-node--selected' : '',
        isHovered && !isSelected ? 'craft-node--hovered' : '',
        isCanvas ? 'craft-node--canvas' : '',
      ].filter(Boolean).join(' ')}
      style={{ position: 'relative' }}
    >
      {render}
      {isSelected && (
        <div className="craft-node__toolbar">
          <span className="craft-node__label">{String(displayName)}</span>
          <button
            className="craft-node__delete"
            onClick={handleDelete}
            title="Delete"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
