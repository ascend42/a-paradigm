import { Canvas } from './components/Canvas/Canvas';
import { CommandInput } from './components/Input/CommandInput';
import { PropertiesPanel } from './components/Panel/PropertiesPanel';
import { Toolbar } from './components/Toolbar/Toolbar';
import { TimelineSlider } from './components/Timeline/TimelineSlider';
import { useNodesStore } from './store/nodesStore';

// Declare the version injected by Vite
declare const __HORIZON_VERSION__: string;

function App() {
  const selectedId = useNodesStore((state) => state.selectedId);

  return (
    <div className="app">
      <Toolbar />
      <main className="main-content">
        <Canvas />
        {selectedId && <PropertiesPanel />}
      </main>
      <TimelineSlider />
      <CommandInput />
      <div className="version-badge">
        Horizon v{__HORIZON_VERSION__}
      </div>
    </div>
  );
}

export default App;
