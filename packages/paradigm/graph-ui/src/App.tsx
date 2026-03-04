import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useGraphStore } from './store/graphStore';
import SymbolPanel from './components/SymbolPanel';
import Canvas from './components/Canvas';
import Toolbar from './components/Toolbar';
import ExportDialog from './components/ExportDialog';
import LoadDialog from './components/LoadDialog';

export default function App() {
  const fetchSymbols = useGraphStore((s) => s.fetchSymbols);
  const loadFromLocalStorage = useGraphStore((s) => s.loadFromLocalStorage);

  useEffect(() => {
    fetchSymbols();
    loadFromLocalStorage();
  }, [fetchSymbols, loadFromLocalStorage]);

  return (
    <ReactFlowProvider>
      <div className="app">
        <SymbolPanel />
        <div className="app__main">
          <Toolbar />
          <Canvas />
        </div>
        <ExportDialog />
        <LoadDialog />
      </div>
    </ReactFlowProvider>
  );
}
