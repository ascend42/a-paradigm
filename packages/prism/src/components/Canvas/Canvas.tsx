/**
 * Infinite Canvas Component
 */

import { useCallback, useRef, useEffect } from 'react';
import { useCanvasStore } from '../../store/canvasStore';
import { useNodesStore } from '../../store/nodesStore';
import { CanvasGrid } from './CanvasGrid';
import { NodeRenderer } from '../Nodes/NodeRenderer';
import { ConnectionLines } from './ConnectionLines';

export function Canvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { viewport, isDragging, dragStart, pan, zoom, startDrag, endDrag } = useCanvasStore();
  const { getFilteredNodes, selectNode } = useNodesStore();
  
  const nodes = getFilteredNodes();

  // Handle mouse wheel zoom
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      zoom(factor, e.clientX, e.clientY);
    },
    [zoom]
  );

  // Handle mouse down for panning
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      const isNode = target.closest('.node');
      
      // Allow panning with middle mouse, space+click, or left-click on canvas background (not on nodes)
      const isMiddleMouse = e.button === 1;
      const isSpaceClick = e.button === 0 && e.altKey;
      const isCanvasBackground = e.button === 0 && !isNode && (target === containerRef.current || target.classList.contains('canvas-content') || target.classList.contains('canvas-grid') || target.classList.contains('connections-layer') || target.tagName === 'svg' || target.tagName === 'path');
      
      if (isMiddleMouse || isSpaceClick || isCanvasBackground) {
        e.preventDefault();
        startDrag(e.clientX, e.clientY);
        // Deselect nodes when panning
        if (isCanvasBackground) {
          selectNode(null);
        }
      } else if (e.button === 0 && !isNode && target === containerRef.current) {
        // Clicked on canvas background - deselect
        selectNode(null);
      }
    },
    [startDrag, selectNode]
  );

  // Handle mouse move for panning (global event)
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (isDragging && dragStart) {
        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;
        pan(dx, dy);
        startDrag(e.clientX, e.clientY);
      }
    },
    [isDragging, dragStart, pan, startDrag]
  );

  // Handle mouse up
  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      endDrag();
    }
  }, [isDragging, endDrag]);

  // Attach wheel event (needs to be passive: false)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel]);

  // Attach global mouse move/up events when dragging
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

  // Calculate transform
  const transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;

  return (
    <div
      ref={containerRef}
      className={`canvas-container ${isDragging ? 'dragging' : ''}`}
      onMouseDown={handleMouseDown}
    >
      <CanvasGrid viewport={viewport} />
      <div className="canvas-content" style={{ transform }}>
        <ConnectionLines nodes={nodes} />
        {nodes.map((node) => (
          <NodeRenderer key={node.id} node={node} />
        ))}
      </div>
    </div>
  );
}
