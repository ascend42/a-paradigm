/**
 * Toolbar - view mode switcher and flow selector
 */

import { useViewerStore } from '../../store/viewerStore';
import type { ViewMode } from '../../../types';

export function Toolbar() {
  const { viewMode, setViewMode, flows, selectedFlowId, selectFlow } = useViewerStore();

  const viewModes: Array<{ id: ViewMode; label: string; icon: string }> = [
    { id: 'constellation', label: 'Constellation', icon: '✨' },
    { id: 'checklist', label: 'Checklist', icon: '☑️' },
    { id: 'timeline', label: 'Timeline', icon: '📜' },
  ];

  return (
    <header className="toolbar">
      <div className="toolbar-brand">
        <span className="brand-icon">🚪</span>
        <span className="brand-text">Portal Viewer</span>
      </div>

      <div className="toolbar-center">
        {/* View mode tabs */}
        <div className="view-tabs">
          {viewModes.map((mode) => (
            <button
              key={mode.id}
              className={`view-tab ${viewMode === mode.id ? 'active' : ''}`}
              onClick={() => setViewMode(mode.id)}
            >
              <span className="tab-icon">{mode.icon}</span>
              <span className="tab-label">{mode.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="toolbar-right">
        {/* Flow selector */}
        {flows.length > 0 && (
          <div className="flow-selector">
            <label>Flow:</label>
            <select
              value={selectedFlowId || ''}
              onChange={(e) => selectFlow(e.target.value || null)}
            >
              <option value="">All Portals</option>
              {flows.map((flow) => (
                <option key={flow.id} value={flow.id}>
                  {flow.flow.description || flow.id}
                  {flow.status === 'completed' ? ' ✓' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </header>
  );
}
