/**
 * Canvas background grid
 */

import type { Viewport } from '../../store/canvasStore';

interface CanvasGridProps {
  viewport: Viewport;
}

export function CanvasGrid({ viewport }: CanvasGridProps) {
  // Adjust grid position based on viewport
  const style = {
    backgroundPosition: `${viewport.x}px ${viewport.y}px`,
    backgroundSize: `
      ${20 * viewport.zoom}px ${20 * viewport.zoom}px,
      ${20 * viewport.zoom}px ${20 * viewport.zoom}px,
      ${100 * viewport.zoom}px ${100 * viewport.zoom}px,
      ${100 * viewport.zoom}px ${100 * viewport.zoom}px
    `,
  };

  return <div className="canvas-grid" style={style} />;
}
