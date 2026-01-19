/**
 * Top toolbar with logo, stats, and actions
 */

import { useNodesStore } from '../../store/nodesStore';
import { useCanvasStore } from '../../store/canvasStore';
import { useThemeStore } from '../../store/themeStore';
import type { SymbolType } from '../../types';

const TYPE_COLORS: Record<SymbolType, string> = {
  feature: 'var(--color-feature)',
  component: 'var(--color-component)',
  flow: 'var(--color-flow)',
  state: 'var(--color-state)',
  aspect: 'var(--color-aspect)',
  gate: 'var(--color-gate)',
  signal: 'var(--color-signal)',
  idea: 'var(--color-idea)',
};

export function Toolbar() {
  const { nodes, visibleTypes, toggleType, setVisibleTypes } = useNodesStore();
  const { viewport, setZoom, resetViewport } = useCanvasStore();
  const { theme, setTheme } = useThemeStore();

  // Count nodes by type
  const counts = nodes.reduce(
    (acc, node) => {
      acc[node.type] = (acc[node.type] || 0) + 1;
      return acc;
    },
    {} as Record<SymbolType, number>
  );

  return (
    <header className="toolbar">
      <div className="toolbar-left">
        <div className="toolbar-logo">
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="#0f172a" />
            <path d="M8 16h16" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" />
            <circle cx="16" cy="10" r="3" fill="#f97316" />
            <circle cx="10" cy="22" r="2" fill="#22c55e" />
            <circle cx="22" cy="22" r="2" fill="#a855f7" />
          </svg>
          <span>Horizon</span>
          <span className="toolbar-title">Dreamscape</span>
        </div>
      </div>

      <div className="toolbar-center">
        <div className="toolbar-stats">
          {/* All On/Off Toggle */}
          <button
            className="toolbar-toggle-all"
            onClick={() => {
              const totalTypes = Object.keys(counts).length;
              const allVisible = visibleTypes.length === totalTypes;
              const noneVisible = visibleTypes.length === 0;
              
              if (allVisible) {
                // Turn all off
                setVisibleTypes([]);
              } else {
                // Turn all on - use all available types
                const allTypes = Object.keys(counts) as SymbolType[];
                setVisibleTypes(allTypes);
              }
            }}
            title={
              visibleTypes.length === Object.keys(counts).length 
                ? 'Hide all types' 
                : visibleTypes.length === 0
                ? 'Show all types'
                : 'Show all types'
            }
          >
            {(() => {
              const totalTypes = Object.keys(counts).length;
              const allVisible = visibleTypes.length === totalTypes;
              const noneVisible = visibleTypes.length === 0;
              
              if (allVisible) {
                // Eye open - all visible
                return (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                );
              } else if (noneVisible) {
                // Eye closed - none visible
                return (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                );
              } else {
                // Eye half-open - some visible
                return (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <path d="M12 9v6"/>
                    <path d="M9 12h6"/>
                  </svg>
                );
              }
            })()}
          </button>
          
          {(Object.entries(counts) as [SymbolType, number][]).map(([type, count]) => {
            const isActive = visibleTypes.includes(type);
            return (
              <button
                key={type}
                className={`toolbar-stat ${isActive ? 'toolbar-stat--active' : 'toolbar-stat--inactive'}`}
                onClick={() => toggleType(type)}
                style={{
                  cursor: 'pointer',
                  background: 'none',
                  border: 'none',
                  color: 'inherit',
                  font: 'inherit',
                }}
                title={`Toggle ${type} visibility`}
              >
                <span className={`toolbar-stat-icon-wrapper ${isActive ? 'toolbar-stat-icon-wrapper--active' : 'toolbar-stat-icon-wrapper--inactive'}`}>
                  <span
                    className={`toolbar-stat-icon ${isActive ? 'toolbar-stat-icon--active' : 'toolbar-stat-icon--inactive'}`}
                    style={{ background: isActive ? TYPE_COLORS[type] : 'transparent' }}
                  />
                </span>
                <span className={isActive ? 'toolbar-stat-count--active' : 'toolbar-stat-count--inactive'}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="toolbar-right">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Theme Toggle */}
          <div className="theme-toggle">
            <button
              onClick={() => setTheme('morning')}
              className={`theme-btn ${theme === 'morning' ? 'active' : ''}`}
              title="Morning theme"
              aria-label="Morning theme"
            >
              🌅
            </button>
            <button
              onClick={() => setTheme('daytime')}
              className={`theme-btn ${theme === 'daytime' ? 'active' : ''}`}
              title="Daytime theme"
              aria-label="Daytime theme"
            >
              ☀️
            </button>
            <button
              onClick={() => setTheme('nighttime')}
              className={`theme-btn ${theme === 'nighttime' ? 'active' : ''}`}
              title="Nighttime theme"
              aria-label="Nighttime theme"
            >
              🌙
            </button>
          </div>
          <button
            onClick={() => setZoom(viewport.zoom / 1.2)}
            style={{
              background: 'var(--input-bg)',
              border: '1px solid var(--input-border)',
              borderRadius: '4px',
              padding: '4px 8px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            −
          </button>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', minWidth: '50px', textAlign: 'center' }}>
            {Math.round(viewport.zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom(viewport.zoom * 1.2)}
            style={{
              background: 'var(--input-bg)',
              border: '1px solid var(--input-border)',
              borderRadius: '4px',
              padding: '4px 8px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            +
          </button>
          <button
            onClick={resetViewport}
            style={{
              background: 'var(--input-bg)',
              border: '1px solid var(--input-border)',
              borderRadius: '4px',
              padding: '4px 8px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            Reset
          </button>
        </div>
      </div>
    </header>
  );
}
