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
      // Only pan with middle mouse or when holding space
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        e.preventDefault();
        startDrag(e.clientX, e.clientY);
      } else if (e.button === 0 && e.target === containerRef.current) {
        // Clicked on canvas background - deselect
        selectNode(null);
      }
    },
    [startDrag, selectNode]
  );

  // Handle mouse move for panning
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
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

  // Calculate transform
  const transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;

  return (
    <div
      ref={containerRef}
      className={`canvas-container ${isDragging ? 'dragging' : ''}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
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
