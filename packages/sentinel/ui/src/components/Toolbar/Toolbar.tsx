/**
 * Top toolbar with logo, stats, layout controls, and actions
 */

import { useNodesStore, type LayoutMode, type SortOption } from '../../store/nodesStore';
import { useCanvasStore } from '../../store/canvasStore';
import { useThemeStore } from '../../store/themeStore';
import type { SymbolType } from '../../types';

// SVG Icons for layout modes
const CanvasIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

const GridIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="5" height="18" rx="1" />
    <rect x="10" y="3" width="5" height="18" rx="1" />
    <rect x="17" y="3" width="5" height="18" rx="1" />
  </svg>
);

const ListIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <circle cx="4" cy="6" r="1" fill="currentColor" />
    <circle cx="4" cy="12" r="1" fill="currentColor" />
    <circle cx="4" cy="18" r="1" fill="currentColor" />
  </svg>
);

const TYPE_COLORS: Record<SymbolType, string> = {
  feature: 'var(--color-feature)',
  component: 'var(--color-component)',
  flow: 'var(--color-flow)',
  state: 'var(--color-state)',
  aspect: 'var(--color-aspect)',
  portal: 'var(--color-portal)',
  signal: 'var(--color-signal)',
  idea: 'var(--color-idea)',
};

interface ToolbarProps {
  projectName?: string | null;
}

export function Toolbar({ projectName }: ToolbarProps) {
  const { nodes, visibleTypes, toggleType, setVisibleTypes, layoutMode, setLayoutMode, sortOption, setSortOption } = useNodesStore();
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

  const layoutButtons: { mode: LayoutMode; icon: React.ReactNode; title: string }[] = [
    { mode: 'canvas', icon: <CanvasIcon />, title: 'Canvas view' },
    { mode: 'grid', icon: <GridIcon />, title: 'Grid view (by type)' },
    { mode: 'list', icon: <ListIcon />, title: 'List view' },
  ];

  const sortOptions: { value: SortOption; label: string }[] = [
    { value: 'type', label: 'Sort by Type' },
    { value: 'alpha', label: 'Sort A-Z' },
    { value: 'updated', label: 'Recently Updated' },
    { value: 'stale', label: 'Stale First' },
  ];

  return (
    <header className="toolbar">
      <div className="toolbar-left">
        {projectName && (
          <span className="toolbar-project-name">{projectName}</span>
        )}
      </div>

      <div className="toolbar-center">
        <div className="toolbar-stats">
          {/* All On/Off Toggle */}
          <button
            className="toolbar-toggle-all"
            onClick={() => {
              const totalTypes = Object.keys(counts).length;
              const allVisible = visibleTypes.length === totalTypes;

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
        <div className="layout-controls">
          {/* Layout Mode Toggle */}
          <div className="layout-toggle">
            {layoutButtons.map(({ mode, icon, title }) => (
              <button
                key={mode}
                className={`layout-btn ${layoutMode === mode ? 'active' : ''}`}
                onClick={() => setLayoutMode(mode)}
                title={title}
              >
                {icon}
              </button>
            ))}
          </div>

          {/* Sort Dropdown (for grid/list views) */}
          {layoutMode !== 'canvas' && (
            <select
              className="sort-select"
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value as SortOption)}
            >
              {sortOptions.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Theme Toggle */}
          <div className="theme-toggle">
            <button
              onClick={() => setTheme('spectrum')}
              className={`theme-btn ${theme === 'spectrum' ? 'active' : ''}`}
              title="Spectrum theme"
              aria-label="Spectrum theme"
            >
              S
            </button>
            <button
              onClick={() => setTheme('focus')}
              className={`theme-btn ${theme === 'focus' ? 'active' : ''}`}
              title="Focus theme"
              aria-label="Focus theme"
            >
              F
            </button>
            <button
              onClick={() => setTheme('deep')}
              className={`theme-btn ${theme === 'deep' ? 'active' : ''}`}
              title="Deep theme"
              aria-label="Deep theme"
            >
              D
            </button>
          </div>

          {/* Zoom controls - only in canvas mode */}
          {layoutMode === 'canvas' && (
            <>
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
                -
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
            </>
          )}
        </div>
      </div>
    </header>
  );
}
