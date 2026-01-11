/**
 * Top toolbar with logo, stats, and actions
 */

import { useNodesStore } from '../../store/nodesStore';
import { useCanvasStore } from '../../store/canvasStore';
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
  const { nodes, visibleTypes, toggleType } = useNodesStore();
  const { viewport, setZoom, resetViewport } = useCanvasStore();

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
          {(Object.entries(counts) as [SymbolType, number][]).map(([type, count]) => (
            <button
              key={type}
              className="toolbar-stat"
              onClick={() => toggleType(type)}
              style={{
                opacity: visibleTypes.includes(type) ? 1 : 0.4,
                cursor: 'pointer',
                background: 'none',
                border: 'none',
                color: 'inherit',
                font: 'inherit',
              }}
              title={`Toggle ${type} visibility`}
            >
              <span
                className="toolbar-stat-icon"
                style={{ background: TYPE_COLORS[type] }}
              />
              <span>{count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="toolbar-right">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
