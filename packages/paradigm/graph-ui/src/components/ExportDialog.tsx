import { useCallback, useEffect, useRef } from 'react';
import { useGraphStore } from '../store/graphStore';

export default function ExportDialog() {
  const exportOpen = useGraphStore((s) => s.exportOpen);
  const setExportOpen = useGraphStore((s) => s.setExportOpen);
  const exportToMarkdown = useGraphStore((s) => s.exportToMarkdown);
  const graphName = useGraphStore((s) => s.graphName);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const markdown = exportOpen ? exportToMarkdown() : '';

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      // Brief visual feedback
      if (textRef.current) {
        textRef.current.select();
      }
    } catch {
      // Fallback: select text
      textRef.current?.select();
      document.execCommand('copy');
    }
  }, [markdown]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${graphName.toLowerCase().replace(/\s+/g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [markdown, graphName]);

  // Close on Escape
  useEffect(() => {
    if (!exportOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExportOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [exportOpen, setExportOpen]);

  if (!exportOpen) return null;

  return (
    <div className="export-overlay" onClick={() => setExportOpen(false)}>
      <div className="export-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="export-dialog__header">
          <h3>Export Markdown</h3>
          <button className="export-dialog__close" onClick={() => setExportOpen(false)}>
            &times;
          </button>
        </div>
        <textarea
          ref={textRef}
          className="export-dialog__content"
          value={markdown}
          readOnly
          rows={20}
        />
        <div className="export-dialog__actions">
          <button className="toolbar__btn toolbar__btn--primary" onClick={handleCopy}>
            Copy to Clipboard
          </button>
          <button className="toolbar__btn" onClick={handleDownload}>
            Download .md
          </button>
        </div>
      </div>
    </div>
  );
}
