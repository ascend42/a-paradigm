/**
 * Constellation Canvas - visualizes portals as an interactive star map
 */

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useViewerStore } from '../../store/viewerStore';
import { PortalNode } from './PortalNode';
import type { Position } from '../../../types';

interface CanvasState {
  offset: Position;
  scale: number;
  isDragging: boolean;
  dragStart: Position;
}

export function ConstellationCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { portals, flows, selectedPortalId, selectedFlowId, selectPortal } = useViewerStore();

  const [canvas, setCanvas] = useState<CanvasState>({
    offset: { x: 0, y: 0 },
    scale: 1,
    isDragging: false,
    dragStart: { x: 0, y: 0 },
  });

  // Calculate node positions in a constellation layout
  const nodePositions = useMemo(() => {
    const positions = new Map<string, Position>();
    const count = portals.length;
    
    if (count === 0) return positions;

    // Arrange in a circular constellation pattern
    const centerX = 400;
    const centerY = 300;
    const baseRadius = Math.min(200, 50 + count * 20);

    portals.forEach((portal, index) => {
      // Use golden angle for natural-looking distribution
      const goldenAngle = Math.PI * (3 - Math.sqrt(5));
      const angle = index * goldenAngle;
      const radius = baseRadius * Math.sqrt(index + 1) / Math.sqrt(count);

      positions.set(portal.id, {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      });
    });

    return positions;
  }, [portals]);

  // Get connections for the selected flow
  const flowConnections = useMemo(() => {
    if (!selectedFlowId) return [];

    const flow = flows.find((f) => f.id === selectedFlowId);
    if (!flow) return [];

    const connections: Array<{ from: Position; to: Position; completed: boolean }> = [];

    for (let i = 0; i < flow.flow.gates.length - 1; i++) {
      const fromPos = nodePositions.get(flow.flow.gates[i]);
      const toPos = nodePositions.get(flow.flow.gates[i + 1]);

      if (fromPos && toPos) {
        connections.push({
          from: fromPos,
          to: toPos,
          completed: flow.completedGates.includes(flow.flow.gates[i]),
        });
      }
    }

    return connections;
  }, [selectedFlowId, flows, nodePositions]);

  // Pan handling
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target === containerRef.current) {
      setCanvas((prev) => ({
        ...prev,
        isDragging: true,
        dragStart: { x: e.clientX - prev.offset.x, y: e.clientY - prev.offset.y },
      }));
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (canvas.isDragging) {
      setCanvas((prev) => ({
        ...prev,
        offset: {
          x: e.clientX - prev.dragStart.x,
          y: e.clientY - prev.dragStart.y,
        },
      }));
    }
  }, [canvas.isDragging]);

  const handleMouseUp = useCallback(() => {
    setCanvas((prev) => ({ ...prev, isDragging: false }));
  }, []);

  // Zoom handling
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setCanvas((prev) => ({
      ...prev,
      scale: Math.min(Math.max(prev.scale * delta, 0.3), 3),
    }));
  }, []);

  // Center view on mount or when portals change
  useEffect(() => {
    if (containerRef.current && portals.length > 0) {
      const rect = containerRef.current.getBoundingClientRect();
      setCanvas((prev) => ({
        ...prev,
        offset: {
          x: rect.width / 2 - 400,
          y: rect.height / 2 - 300,
        },
      }));
    }
  }, [portals.length]);

  return (
    <div
      ref={containerRef}
      className="constellation-canvas"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      onClick={(e) => {
        if (e.target === containerRef.current) {
          selectPortal(null);
        }
      }}
    >
      {/* Background grid */}
      <div className="canvas-grid" />

      {/* Connection lines for selected flow */}
      <svg
        className="flow-connections"
        style={{
          transform: `translate(${canvas.offset.x}px, ${canvas.offset.y}px) scale(${canvas.scale})`,
        }}
      >
        {flowConnections.map((conn, i) => (
          <line
            key={i}
            x1={conn.from.x}
            y1={conn.from.y}
            x2={conn.to.x}
            y2={conn.to.y}
            className={`flow-line ${conn.completed ? 'completed' : ''}`}
          />
        ))}
      </svg>

      {/* Portal nodes */}
      <div
        className="nodes-container"
        style={{
          transform: `translate(${canvas.offset.x}px, ${canvas.offset.y}px) scale(${canvas.scale})`,
        }}
      >
        {portals.map((portal) => {
          const position = nodePositions.get(portal.id);
          if (!position) return null;

          return (
            <PortalNode
              key={portal.id}
              portal={portal}
              position={position}
              isSelected={selectedPortalId === portal.id}
              isInSelectedFlow={
                selectedFlowId
                  ? flows
                      .find((f) => f.id === selectedFlowId)
                      ?.flow.gates.includes(portal.id) ?? false
                  : false
              }
              onClick={() => selectPortal(portal.id)}
            />
          );
        })}
      </div>

      {/* Empty state */}
      {portals.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🚪</div>
          <h3>No Portals Detected</h3>
          <p>Waiting for portal events from your application...</p>
          <p className="hint">
            Make sure your app is using the Portal SDK and connected to this viewer.
          </p>
        </div>
      )}

      {/* Zoom controls */}
      <div className="zoom-controls">
        <button onClick={() => setCanvas((prev) => ({ ...prev, scale: Math.min(prev.scale * 1.2, 3) }))}>
          +
        </button>
        <span>{Math.round(canvas.scale * 100)}%</span>
        <button onClick={() => setCanvas((prev) => ({ ...prev, scale: Math.max(prev.scale * 0.8, 0.3) }))}>
          −
        </button>
        <button onClick={() => setCanvas((prev) => ({ ...prev, scale: 1 }))}>
          ⟲
        </button>
      </div>
    </div>
  );
}
