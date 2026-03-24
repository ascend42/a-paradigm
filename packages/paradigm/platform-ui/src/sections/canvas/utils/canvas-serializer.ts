/**
 * Canvas Serializer — Converts between Craft.js JSON and CanvasFile format
 */

import type { CanvasFile } from '../types';

/**
 * Create a CanvasFile object from Craft.js serialized JSON string
 */
export function craftStateToCanvasFile(
  editorJson: string,
  metadata: {
    name: string;
    description?: string;
    created?: string;
    viewport?: { width: number; zoom: number; scrollX: number; scrollY: number };
  }
): CanvasFile {
  const now = new Date().toISOString();
  let editor: Record<string, unknown> = {};

  try {
    editor = JSON.parse(editorJson);
  } catch {
    // empty editor state
  }

  return {
    version: 1,
    name: metadata.name,
    description: metadata.description || '',
    created: metadata.created || now,
    updated: now,
    editor: editor as CanvasFile['editor'],
    symbols: {},
    viewport: metadata.viewport || { width: 1280, zoom: 1.0, scrollX: 0, scrollY: 0 },
  };
}

/**
 * Extract Craft.js JSON string from a CanvasFile
 */
export function canvasFileToCraftState(file: CanvasFile): string | null {
  if (!file.editor || Object.keys(file.editor).length === 0) {
    return null;
  }
  return JSON.stringify(file.editor);
}
