import React, { useCallback } from 'react';
import { useEditor } from '@craftjs/core';
import { useCanvasStore } from '../../store/canvasStore';

export function CanvasToolbar() {
  const {
    files,
    currentFile,
    currentFileName,
    isDirty,
    mode,
    setCurrentFileName,
    saveFile,
    createFile,
    deleteFile,
    loadFile,
    setMode,
  } = useCanvasStore();

  const { canUndo, canRedo, actions: editorActions } = useEditor((state, query) => ({
    canUndo: query.history.canUndo(),
    canRedo: query.history.canRedo(),
  }));

  const handleNew = useCallback(() => {
    const name = prompt('Canvas name:');
    if (name?.trim()) {
      createFile(name.trim());
    }
  }, [createFile]);

  const handleDelete = useCallback(() => {
    if (currentFile && confirm(`Delete "${currentFileName}"?`)) {
      deleteFile(currentFile);
    }
  }, [currentFile, currentFileName, deleteFile]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const path = e.target.value;
    if (path) loadFile(path);
  }, [loadFile]);

  const handleSave = useCallback(() => {
    saveFile();
  }, [saveFile]);

  return (
    <div className="canvas-toolbar">
      <div className="canvas-toolbar__left">
        {currentFile && (
          <input
            className="canvas-toolbar__name"
            value={currentFileName}
            onChange={(e) => setCurrentFileName(e.target.value)}
            placeholder="Canvas name"
          />
        )}
        {isDirty && <span className="canvas-toolbar__dirty">*</span>}
      </div>

      <div className="canvas-toolbar__center">
        <select
          className="canvas-toolbar__file-picker"
          value={currentFile || ''}
          onChange={handleFileChange}
        >
          <option value="" disabled>Select canvas...</option>
          {files.map((f) => (
            <option key={f.path} value={f.path}>{f.name}</option>
          ))}
        </select>

        <button className="canvas-toolbar__btn" onClick={handleNew} title="New canvas">
          + New
        </button>
        <button className="canvas-toolbar__btn" onClick={handleSave} disabled={!currentFile} title="Save (Cmd+S)">
          Save
        </button>
        <button className="canvas-toolbar__btn canvas-toolbar__btn--danger" onClick={handleDelete} disabled={!currentFile} title="Delete canvas">
          Delete
        </button>
      </div>

      <div className="canvas-toolbar__right">
        <button
          className="canvas-toolbar__btn"
          onClick={() => editorActions.history.undo()}
          disabled={!canUndo}
          title="Undo"
        >
          ↩
        </button>
        <button
          className="canvas-toolbar__btn"
          onClick={() => editorActions.history.redo()}
          disabled={!canRedo}
          title="Redo"
        >
          ↪
        </button>

        <div className="canvas-toolbar__divider" />

        <button
          className={`canvas-toolbar__btn ${mode === 'design' ? 'canvas-toolbar__btn--active' : ''}`}
          onClick={() => setMode('design')}
        >
          Design
        </button>
        <button
          className={`canvas-toolbar__btn ${mode === 'preview' ? 'canvas-toolbar__btn--active' : ''}`}
          onClick={() => setMode('preview')}
        >
          Preview
        </button>
      </div>
    </div>
  );
}
