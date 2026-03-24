/**
 * Canvas Zustand Store
 *
 * Manages canvas file operations, editor state serialization,
 * and UI state (mode, selection).
 */

import { create } from 'zustand';
import type { CanvasFile, CanvasFileInfo } from '../types';

const DEBOUNCE_MS = 500;
const STORAGE_KEY = 'paradigm-canvas-last';

let saveTimeout: ReturnType<typeof setTimeout> | null = null;

export interface CanvasStore {
  // File management
  files: CanvasFileInfo[];
  currentFile: string | null;
  currentFileName: string;
  isDirty: boolean;
  isLoading: boolean;
  error: string | null;

  // Editor state (Craft.js serialized JSON string)
  editorState: string | null;

  // UI state
  mode: 'design' | 'preview';

  // Actions
  fetchFiles: () => Promise<void>;
  loadFile: (filePath: string) => Promise<void>;
  saveFile: (editorJson?: string) => Promise<void>;
  createFile: (name: string, description?: string) => Promise<void>;
  deleteFile: (filePath: string) => Promise<void>;
  setCurrentFileName: (name: string) => void;
  setEditorState: (state: string) => void;
  setMode: (mode: 'design' | 'preview') => void;
  setDirty: (dirty: boolean) => void;
  setError: (error: string | null) => void;
  debouncedSave: (editorJson: string) => void;
}

function createEmptyCanvasFile(name: string, description = ''): CanvasFile {
  const now = new Date().toISOString();
  return {
    version: 1,
    name,
    description,
    created: now,
    updated: now,
    editor: {},
    symbols: {},
    viewport: { width: 1280, zoom: 1.0, scrollX: 0, scrollY: 0 },
  };
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  files: [],
  currentFile: null,
  currentFileName: '',
  isDirty: false,
  isLoading: false,
  error: null,
  editorState: null,
  mode: 'design',

  fetchFiles: async () => {
    try {
      const res = await fetch('/api/canvas/files');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      set({ files: data.files || [] });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  loadFile: async (filePath: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`/api/canvas/files/${filePath}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: CanvasFile = await res.json();

      // Craft.js expects a JSON string of the editor node tree
      const editorJson = data.editor && Object.keys(data.editor).length > 0
        ? JSON.stringify(data.editor)
        : null;

      set({
        currentFile: filePath,
        currentFileName: data.name || filePath.replace(/\.canvas$/, ''),
        editorState: editorJson,
        isDirty: false,
        isLoading: false,
      });

      localStorage.setItem(STORAGE_KEY, filePath);
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
    }
  },

  saveFile: async (editorJson?: string) => {
    const state = get();
    const filePath = state.currentFile;
    if (!filePath) return;

    const json = editorJson || state.editorState;
    let editorData = {};
    if (json) {
      try { editorData = JSON.parse(json); } catch { /* use empty */ }
    }

    const body: CanvasFile = {
      version: 1,
      name: state.currentFileName,
      description: '',
      created: '',  // server preserves existing
      updated: '',  // server sets this
      editor: editorData as Record<string, never>,
      symbols: {},
      viewport: { width: 1280, zoom: 1.0, scrollX: 0, scrollY: 0 },
    };

    try {
      const res = await fetch(`/api/canvas/files/${filePath}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      set({ isDirty: false });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  createFile: async (name: string, description = '') => {
    const fileName = name.endsWith('.canvas') ? name : `${name}.canvas`;
    const body = createEmptyCanvasFile(name, description);

    try {
      const res = await fetch(`/api/canvas/files/${fileName}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Refresh file list and load the new file
      await get().fetchFiles();
      await get().loadFile(fileName);
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  deleteFile: async (filePath: string) => {
    try {
      const res = await fetch(`/api/canvas/files/${filePath}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const state = get();
      if (state.currentFile === filePath) {
        set({ currentFile: null, currentFileName: '', editorState: null, isDirty: false });
        localStorage.removeItem(STORAGE_KEY);
      }

      await get().fetchFiles();
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  setCurrentFileName: (name: string) => set({ currentFileName: name, isDirty: true }),

  setEditorState: (state: string) => set({ editorState: state }),

  setMode: (mode) => set({ mode }),

  setDirty: (dirty) => set({ isDirty: dirty }),

  setError: (error) => set({ error }),

  debouncedSave: (editorJson: string) => {
    set({ editorState: editorJson, isDirty: true });
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      get().saveFile(editorJson);
    }, DEBOUNCE_MS);
  },
}));

/**
 * Get the last-opened canvas file path from localStorage
 */
export function getLastOpenedCanvas(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}
