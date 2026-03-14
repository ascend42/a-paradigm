import { useEffect, useState } from 'react';
import { DesignView } from './views/DesignView';
import { IncidentsView } from './views/IncidentsView';
import { LogsView } from './views/LogsView';
import { FlowsView } from './views/FlowsView';
import { EventsView } from './views/EventsView';
import { ConversationView } from './views/ConversationView';
import { useThemeStore } from './store/themeStore';

// Declare the version injected by Vite
declare const __PARADIGM_VERSION__: string;

type ViewType = 'design' | 'incidents' | 'logs' | 'flows' | 'events' | 'conversations';

function App() {
  const [currentView, setCurrentView] = useState<ViewType>('design');
  const [projectName, setProjectName] = useState<string | null>(null);
  const [projectDir, setProjectDir] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const theme = useThemeStore((state) => state.theme);

  // Ensure theme is applied on mount
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Load project info on mount
  useEffect(() => {
    async function loadProjectInfo() {
      try {
        const response = await fetch('/api/info');
        if (response.ok) {
          const info = await response.json();
          setProjectName(info.projectName || null);
          setProjectDir(info.projectDir || null);
        }
        setIsLoading(false);
      } catch (error) {
        console.error('Failed to load project info:', error);
        setLoadError(error instanceof Error ? error.message : 'Failed to connect to server');
        setIsLoading(false);
      }
    }
    loadProjectInfo();
  }, []);

  // Show loading state
  if (isLoading) {
    return (
      <div className="app loading-state">
        <div className="loading-content">
          <div className="loading-spinner" />
          <p>Connecting to Sentinel...</p>
        </div>
      </div>
    );
  }

  // Show error state
  if (loadError) {
    return (
      <div className="app error-state">
        <div className="error-content">
          <h2>Failed to connect</h2>
          <p>{loadError}</p>
          <p className="hint">Make sure you're running <code>paradigm sentinel</code> from your project directory.</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {/* View Tabs Header */}
      <header className="view-tabs-header">
        <div className="view-tabs-left">
          <div className="toolbar-logo">
            <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="8" fill="#0f172a"/>
              <path d="M16 6L6 26h20L16 6z" fill="none" stroke="url(#sentinel-grad)" strokeWidth="2"/>
              <path d="M4 14L14 16" stroke="#f8fafc" strokeWidth="2" strokeLinecap="round"/>
              <path d="M18 17L28 12" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M18 18L28 16" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M18 19L28 20" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M18 20L28 24" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round"/>
              <defs>
                <linearGradient id="sentinel-grad" x1="6" y1="26" x2="26" y2="6">
                  <stop offset="0%" stopColor="#818cf8"/>
                  <stop offset="100%" stopColor="#c084fc"/>
                </linearGradient>
              </defs>
            </svg>
            <span>Sentinel</span>
            {projectName && <span className="toolbar-title">{projectName}</span>}
          </div>
        </div>

        <div className="view-tabs">
          <button
            className={`view-tab ${currentView === 'design' ? 'active' : ''}`}
            onClick={() => setCurrentView('design')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 1v6m0 6v6M1 12h6m6 0h6"/>
              <path d="M4.93 4.93l4.24 4.24m5.66 5.66l4.24 4.24M4.93 19.07l4.24-4.24m5.66-5.66l4.24-4.24"/>
            </svg>
            Design
          </button>
          <button
            className={`view-tab ${currentView === 'logs' ? 'active' : ''}`}
            onClick={() => setCurrentView('logs')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
            Logs
          </button>
          <button
            className={`view-tab ${currentView === 'incidents' ? 'active' : ''}`}
            onClick={() => setCurrentView('incidents')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            Incidents
          </button>
          <button
            className={`view-tab ${currentView === 'flows' ? 'active' : ''}`}
            onClick={() => setCurrentView('flows')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="5" cy="12" r="3"/>
              <circle cx="19" cy="6" r="3"/>
              <circle cx="19" cy="18" r="3"/>
              <line x1="8" y1="12" x2="16" y2="6"/>
              <line x1="8" y1="12" x2="16" y2="18"/>
            </svg>
            Flows
          </button>
          <button
            className={`view-tab ${currentView === 'events' ? 'active' : ''}`}
            onClick={() => setCurrentView('events')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M3 9h18"/>
              <path d="M9 21V9"/>
            </svg>
            Events
          </button>
          <button
            className={`view-tab ${currentView === 'conversations' ? 'active' : ''}`}
            onClick={() => setCurrentView('conversations')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
            </svg>
            Conversations
          </button>
        </div>

        <div className="view-tabs-right">
          {projectDir && (
            <div className="project-dir-badge" title={projectDir}>
              {projectDir}
            </div>
          )}
          <div className="version-badge-inline">
            v{__PARADIGM_VERSION__}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {currentView === 'design' && <DesignView />}
        {currentView === 'logs' && <LogsView />}
        {currentView === 'incidents' && <IncidentsView />}
        {currentView === 'flows' && <FlowsView />}
        {currentView === 'events' && <EventsView />}
        {currentView === 'conversations' && <ConversationView />}
      </main>
    </div>
  );
}

export default App;
