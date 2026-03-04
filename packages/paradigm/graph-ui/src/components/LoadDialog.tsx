import { useCallback, useEffect, useRef, useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import type { GraphState } from '../types';

export default function LoadDialog() {
  const loadDialogOpen = useGraphStore((s) => s.loadDialogOpen);
  const setLoadDialogOpen = useGraphStore((s) => s.setLoadDialogOpen);
  const importFromFile = useGraphStore((s) => s.importFromFile);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [jsonText, setJsonText] = useState('');
  const [status, setStatus] = useState<{ type: 'error' | 'success'; message: string } | null>(null);
  const [parsed, setParsed] = useState<GraphState | null>(null);

  const reset = useCallback(() => {
    setJsonText('');
    setStatus(null);
    setParsed(null);
  }, []);

  const handleClose = useCallback(() => {
    setLoadDialogOpen(false);
    reset();
  }, [setLoadDialogOpen, reset]);

  const handleValidate = useCallback(() => {
    try {
      const state = JSON.parse(jsonText);
      if (!state.version || !Array.isArray(state.nodes)) {
        setStatus({ type: 'error', message: 'Invalid graph: missing "version" or "nodes" array.' });
        setParsed(null);
        return;
      }
      setParsed(state as GraphState);
      const nodeCount = state.nodes?.length || 0;
      const edgeCount = state.edges?.length || 0;
      setStatus({ type: 'success', message: `Valid graph: ${nodeCount} nodes, ${edgeCount} edges.` });
    } catch {
      setStatus({ type: 'error', message: 'Invalid JSON.' });
      setParsed(null);
    }
  }, [jsonText]);

  const handleApply = useCallback(() => {
    if (parsed) {
      importFromFile(parsed);
      handleClose();
    }
  }, [parsed, importFromFile, handleClose]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const state: GraphState = JSON.parse(reader.result as string);
          importFromFile(state);
          handleClose();
        } catch {
          setStatus({ type: 'error', message: 'Invalid graph file.' });
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    },
    [importFromFile, handleClose]
  );

  // Close on Escape
  useEffect(() => {
    if (!loadDialogOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [loadDialogOpen, handleClose]);

  if (!loadDialogOpen) return null;

  return (
    <div className="export-overlay" onClick={handleClose}>
      <div className="export-dialog load-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="export-dialog__header">
          <h3>Load Graph</h3>
          <button className="export-dialog__close" onClick={handleClose}>
            &times;
          </button>
        </div>
        <div className="load-dialog__body">
          <div className="load-dialog__section">
            <label className="load-dialog__label">Upload File</label>
            <button
              className="toolbar__btn"
              onClick={() => fileInputRef.current?.click()}
            >
              Choose .graph.json
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.graph.json"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>
          <div className="load-dialog__divider">
            <span>or</span>
          </div>
          <div className="load-dialog__section">
            <label className="load-dialog__label">Paste JSON</label>
            <textarea
              className="export-dialog__content"
              value={jsonText}
              onChange={(e) => {
                setJsonText(e.target.value);
                setStatus(null);
                setParsed(null);
              }}
              placeholder='Paste GraphState JSON here...'
              rows={12}
            />
          </div>
          {status && (
            <div className={`load-dialog__status load-dialog__status--${status.type}`}>
              {status.message}
            </div>
          )}
        </div>
        <div className="export-dialog__actions">
          <button
            className="toolbar__btn"
            onClick={handleValidate}
            disabled={!jsonText.trim()}
          >
            Validate
          </button>
          <button
            className="toolbar__btn toolbar__btn--primary"
            onClick={handleApply}
            disabled={!parsed}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
