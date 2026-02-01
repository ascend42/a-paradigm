import { useEffect, useState } from 'react';
import { ConstellationCanvas } from './components/Constellation/ConstellationCanvas';
import { EventTimeline } from './components/Timeline/EventTimeline';
import { TestChecklist } from './components/Checklist/TestChecklist';
import { SessionControls } from './components/Session/SessionControls';
import { CommandPalette } from './components/CommandPalette/CommandPalette';
import { Toolbar } from './components/Toolbar/Toolbar';
import { useViewerStore } from './store/viewerStore';

declare const __PORTAL_VIEWER_VERSION__: string;

function App() {
  const { isConnected, error, viewMode, connect, portals } = useViewerStore();
  const [showCommands, setShowCommands] = useState(false);

  // Connect to WebSocket on mount
  useEffect(() => {
    connect();
  }, [connect]);

  // Loading state
  if (!isConnected && !error) {
    return (
      <div className="app loading-state">
        <div className="loading-content">
          <div className="loading-spinner" />
          <p>Connecting to Portal Viewer...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="app error-state">
        <div className="error-content">
          <h2>Connection Failed</h2>
          <p>{error}</p>
          <p className="hint">
            Make sure the Portal Viewer server is running on port 42196.
          </p>
          <button onClick={() => connect()}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Toolbar />
      <main className="main-content">
        <div className="viewer-container">
          {viewMode === 'constellation' && <ConstellationCanvas />}
          {viewMode === 'checklist' && <TestChecklist />}
          {viewMode === 'timeline' && <EventTimeline />}
        </div>
        <aside className="sidebar">
          <SessionControls />
          <div className="sidebar-toggle">
            <button 
              className={`toggle-btn ${showCommands ? 'active' : ''}`}
              onClick={() => setShowCommands(!showCommands)}
            >
              📋 CLI Commands
            </button>
          </div>
          {showCommands ? (
            <CommandPalette />
          ) : viewMode !== 'timeline' && (
            <div className="mini-timeline">
              <h3>Recent Events</h3>
              <EventTimeline compact />
            </div>
          )}
        </aside>
      </main>
      <div className="status-bar">
        <span className="connection-status">
          <span className={`dot ${isConnected ? 'connected' : 'disconnected'}`} />
          {isConnected ? 'Connected' : 'Disconnected'}
        </span>
        <span className="portal-count">{portals.length} Portals</span>
        <span className="version">Portal Viewer v{__PORTAL_VIEWER_VERSION__}</span>
      </div>
    </div>
  );
}

export default App;
