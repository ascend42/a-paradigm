import React, { useEffect } from 'react';
import { useCanvasStore, getLastOpenedCanvas } from './store/canvasStore';
import { CanvasEditor } from './components/editor/CanvasEditor';
import './styles/canvas.css';

export default function CanvasSection() {
  const fetchFiles = useCanvasStore((s) => s.fetchFiles);
  const loadFile = useCanvasStore((s) => s.loadFile);
  const currentFile = useCanvasStore((s) => s.currentFile);
  const files = useCanvasStore((s) => s.files);

  useEffect(() => {
    fetchFiles().then(() => {
      const last = getLastOpenedCanvas();
      if (last && !currentFile) {
        loadFile(last);
      }
    });
  }, []);

  return (
    <div className="canvas-section" style={{ height: '100%' }}>
      <CanvasEditor />
    </div>
  );
}
