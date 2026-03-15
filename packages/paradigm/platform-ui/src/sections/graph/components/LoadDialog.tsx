import { useCallback, useEffect, useRef, useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import type { GraphState } from '../types';

interface SavedGraph {
  slug: string;
  file: string;
  name: string;
  nodes: number;
  edges: number;
  size: number;
  modified: string;
}

export default function LoadDialog() {
  const loadDialogOpen = useGraphStore((s) => s.loadDialogOpen);
  const setLoadDialogOpen = useGraphStore((s) => s.setLoadDialogOpen);
  const importFromFile = useGraphStore((s) => s.importFromFile);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [jsonText, setJsonText] = useState('');
  const [status, setStatus] = useState<{ type: 'error' | 'success'; message: string } | null>(null);
  const [parsed, setParsed] = useState<GraphState | null>(null);
  const [savedGraphs, setSavedGraphs] = useState<SavedGraph[]>([]);
  const [loadingGraphs, setLoadingGraphs] = useState(false);

  const reset = useCallback(() => {
    setJsonText('');
    setStatus(null);
    setParsed(null);
  }, []);

  const handleClose = useCallback(() => {
    setLoadDialogOpen(false);
    reset();
  }, [setLoadDialogOpen, reset]);

  // Fetch saved graphs when dialog opens
  useEffect(() => {
    if (!loadDialogOpen) return;
    setLoadingGraphs(true);
    fetch('/api/graphs')
      .then((res) => res.json())
      .then((data) => setSavedGraphs(data.graphs || []))
      .catch(() => setSavedGraphs([]))
      .finally(() => setLoadingGraphs(false));
  }, [loadDialogOpen]);

  const handleLoadSaved = useCallback(
    async (slug: string) => {
      try {
        const res = await fetch(`/api/graphs/${slug}`);
        const state: GraphState = await res.json();
        importFromFile(state);
        handleClose();
      } catch {
        setStatus({ type: 'error', message: `Failed to load graph "${slug}".` });
      }
    },
    [importFromFile, handleClose]
  );

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

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  function formatDate(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

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
          {/* Saved graphs section */}
          {(savedGraphs.length > 0 || loadingGraphs) && (
            <div className="load-dialog__section">
              <label className="load-dialog__label">Saved Graphs</label>
              {loadingGraphs ? (
                <div className="load-dialog__loading">Loading...</div>
              ) : (
                <div className="load-dialog__graph-list">
                  {savedGraphs.map((g) => (
                    <button
                      key={g.slug}
                      className="load-dialog__graph-item"
                      onClick={() => handleLoadSaved(g.slug)}
                    >
                      <span className="load-dialog__graph-name">{g.name}</span>
                      <span className="load-dialog__graph-meta">
                        {g.nodes} nodes, {g.edges} edges &middot; {formatSize(g.size)} &middot; {formatDate(g.modified)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {savedGraphs.length > 0 && (
            <div className="load-dialog__divider">
              <span>or</span>
            </div>
          )}

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
              rows={8}
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
