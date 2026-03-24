/**
 * useCanvasSync — Syncs Craft.js editor state with the Zustand store.
 *
 * - On editor changes → serialize → push to store (debounced save)
 * - On file load → deserialize into the Craft.js editor
 */

import { useEffect, useRef } from 'react';
import { useEditor } from '@craftjs/core';
import { useCanvasStore } from '../store/canvasStore';

export function useCanvasSync() {
  const { query, actions } = useEditor();
  const editorState = useCanvasStore((s) => s.editorState);
  const currentFile = useCanvasStore((s) => s.currentFile);
  const debouncedSave = useCanvasStore((s) => s.debouncedSave);
  const setEditorState = useCanvasStore((s) => s.setEditorState);

  const isDeserializing = useRef(false);
  const lastSerializedRef = useRef<string | null>(null);

  // When editorState changes externally (file load), deserialize into the editor
  useEffect(() => {
    if (editorState && editorState !== lastSerializedRef.current) {
      isDeserializing.current = true;
      try {
        actions.deserialize(editorState);
      } catch (e) {
        // If deserialization fails, the editor stays in its current state
      }
      // Wait a tick before allowing serialization again
      setTimeout(() => {
        isDeserializing.current = false;
      }, 100);
    }
  }, [editorState, actions]);

  // Subscribe to editor changes and push to store
  useEffect(() => {
    if (!currentFile) return;

    const unsubscribe = query.subscribe(() => {
      if (isDeserializing.current) return;

      try {
        const json = query.serialize();
        if (json !== lastSerializedRef.current) {
          lastSerializedRef.current = json;
          debouncedSave(json);
        }
      } catch {
        // Editor may not be ready yet
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [query, currentFile, debouncedSave]);
}
