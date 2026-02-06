/**
 * Design View - Symbol visualization canvas
 * Extracted from original Prism App.tsx
 */

import { useEffect } from 'react';
import { Canvas } from '../components/Canvas/Canvas';
import { GridView } from '../components/Views/GridView';
import { ListView } from '../components/Views/ListView';
import { CommandInput } from '../components/Input/CommandInput';
import { PropertiesPanel } from '../components/Panel/PropertiesPanel';
import { Toolbar } from '../components/Toolbar/Toolbar';
import { HelpPanel } from '../components/Help/HelpPanel';
import { useNodesStore } from '../store/nodesStore';

// Timeline is hidden by default - will be shown in flow editor mode (future feature)
// import { TimelineSlider } from '../components/Timeline/TimelineSlider';

export function DesignView() {
  const selectedId = useNodesStore((state) => state.selectedId);
  const isLoading = useNodesStore((state) => state.isLoading);
  const loadError = useNodesStore((state) => state.loadError);
  const projectName = useNodesStore((state) => state.projectName);
  const loadFromApi = useNodesStore((state) => state.loadFromApi);
  const layoutMode = useNodesStore((state) => state.layoutMode);

  // Load symbols from API on mount
  useEffect(() => {
    loadFromApi();
  }, [loadFromApi]);

  // Render the appropriate view based on layout mode
  const renderMainView = () => {
    switch (layoutMode) {
      case 'grid':
        return <GridView />;
      case 'list':
        return <ListView />;
      case 'canvas':
      default:
        return <Canvas />;
    }
  };

  // Show loading state
  if (isLoading) {
    return (
      <div className="design-view loading-state">
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
      <div className="design-view error-state">
        <div className="error-content">
          <h2>Failed to load symbols</h2>
          <p>{loadError}</p>
          <button onClick={() => loadFromApi()}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="design-view">
      <Toolbar projectName={projectName} />
      <div className="design-content">
        {renderMainView()}
        {selectedId && <PropertiesPanel />}
      </div>
      {/* Timeline hidden - will be shown in flow editor mode */}
      {layoutMode === 'canvas' && <CommandInput />}
      <HelpPanel />
    </div>
  );
}
