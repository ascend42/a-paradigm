import { useEffect } from 'react';
import { Canvas } from './components/Canvas/Canvas';
import { CommandInput } from './components/Input/CommandInput';
import { PropertiesPanel } from './components/Panel/PropertiesPanel';
import { Toolbar } from './components/Toolbar/Toolbar';
import { TimelineSlider } from './components/Timeline/TimelineSlider';
import { HelpPanel } from './components/Help/HelpPanel';
import { useNodesStore } from './store/nodesStore';
import { useThemeStore } from './store/themeStore';

// Declare the version injected by Vite
declare const __PARADIGM_VERSION__: string;

function App() {
  const selectedId = useNodesStore((state) => state.selectedId);
  const isLoading = useNodesStore((state) => state.isLoading);
  const loadError = useNodesStore((state) => state.loadError);
  const projectName = useNodesStore((state) => state.projectName);
  const loadFromApi = useNodesStore((state) => state.loadFromApi);
  const theme = useThemeStore((state) => state.theme);

  // Ensure theme is applied on mount
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Load symbols from API on mount
  useEffect(() => {
    loadFromApi();
  }, [loadFromApi]);

  // Show loading state
  if (isLoading) {
    return (
      <div className="app loading-state">
        <div className="loading-content">
          <div className="loading-spinner" />
          <p>Loading symbols...</p>
        </div>
      </div>
    );
  }

  // Show error state
  if (loadError) {
    return (
      <div className="app error-state">
        <div className="error-content">
          <h2>Failed to load project</h2>
          <p>{loadError}</p>
          <p className="hint">Make sure you're running <code>paradigm visualize</code> from your project directory.</p>
          <button onClick={() => loadFromApi()}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Toolbar projectName={projectName} />
      <main className="main-content">
        <Canvas />
        {selectedId && <PropertiesPanel />}
      </main>
      <TimelineSlider />
      <CommandInput />
      <HelpPanel />
      <div className="version-badge">
        Paradigm v{__PARADIGM_VERSION__}
      </div>
    </div>
  );
}

export default App;
