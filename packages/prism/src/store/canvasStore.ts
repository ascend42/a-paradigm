/**
 * Canvas state management - viewport, pan, zoom
 */

import { create } from 'zustand';

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

interface CanvasState {
  viewport: Viewport;
  isDragging: boolean;
  dragStart: { x: number; y: number } | null;
  
  // Actions
  setViewport: (viewport: Viewport) => void;
  pan: (dx: number, dy: number) => void;
  zoom: (factor: number, centerX?: number, centerY?: number) => void;
  setZoom: (zoom: number) => void;
  resetViewport: () => void;
  startDrag: (x: number, y: number) => void;
  endDrag: () => void;
}

const DEFAULT_VIEWPORT: Viewport = {
  x: 0,
  y: 0,
  zoom: 1,
};

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;

export const useCanvasStore = create<CanvasState>((set) => ({
  viewport: DEFAULT_VIEWPORT,
  isDragging: false,
  dragStart: null,

  setViewport: (viewport) => set({ viewport }),

  pan: (dx, dy) =>
    set((state) => ({
      viewport: {
        ...state.viewport,
        x: state.viewport.x + dx,
        y: state.viewport.y + dy,
      },
    })),

  zoom: (factor, centerX = 0, centerY = 0) =>
    set((state) => {
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.viewport.zoom * factor));
      
      // Zoom toward the center point
      const zoomRatio = newZoom / state.viewport.zoom;
      const newX = centerX - (centerX - state.viewport.x) * zoomRatio;
      const newY = centerY - (centerY - state.viewport.y) * zoomRatio;

      return {
        viewport: {
          x: newX,
          y: newY,
          zoom: newZoom,
        },
      };
    }),

  setZoom: (zoom) =>
    set((state) => ({
      viewport: {
        ...state.viewport,
        zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)),
      },
    })),

  resetViewport: () => set({ viewport: DEFAULT_VIEWPORT }),

  startDrag: (x, y) =>
    set({
      isDragging: true,
      dragStart: { x, y },
    }),

  endDrag: () =>
    set({
      isDragging: false,
      dragStart: null,
    }),
}));
