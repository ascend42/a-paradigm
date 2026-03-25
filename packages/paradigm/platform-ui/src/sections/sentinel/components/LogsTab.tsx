/**
 * LogsTab — Real-time structured log viewer
 *
 * Ported from sentinel/ui/src/views/LogsView.tsx with:
 * - useSentinelLogsStore instead of useLogsStore
 * - No direct WS connection (uses useSentinelWs via SentinelSection)
 */

import { useEffect, useRef, useState, useCallback, type CSSProperties } from 'react';
import { useSentinelLogsStore, type LogEntry } from '../store/sentinelLogsStore';

function useResizableColumns(defaults: number[]) {
  const [widths, setWidths] = useState(defaults);
  const dragging = useRef<{ idx: number; startX: number; startW: number } | null>(null);

  const onMouseDown = useCallback((idx: number, e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = { idx, startX: e.clientX, startW: widths[idx] };

    const onMouseMove = (ev: MouseEvent) => {
      const d = dragging.current;
      if (!d) return;
      const newW = Math.max(40, d.startW + (ev.clientX - d.startX));
      setWidths((prev) => {
        const next = [...prev];
        next[d.idx] = newW;
        return next;
      });
    };

    const onMouseUp = () => {
      dragging.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [widths]);

  const gridTemplate = widths.map((w) => `${w}px`).join(' ') + ' 1fr';
  return { gridTemplate, onMouseDown };
}

function ResizeHandle({ idx, onMouseDown }: { idx: number; onMouseDown: (idx: number, e: React.MouseEvent) => void }) {
  return (
    <span
      className="col-resize-handle"
      onMouseDown={(e) => onMouseDown(idx, e)}
    />
  );
}

interface ContextMenuState {
  x: number;
  y: number;
  entry: LogEntry;
}

const LEVEL_COLORS: Record<string, string> = {
  debug: 'var(--p-accent-slate)',
  info: 'var(--p-accent-blue)',
  warn: 'var(--p-accent-amber)',
  error: 'var(--p-accent-red)',
};

const SYMBOL_COLORS: Record<string, string> = {
  component: 'var(--p-symbol-component)',
  gate: 'var(--p-symbol-gate)',
  signal: 'var(--p-symbol-signal)',
  flow: 'var(--p-symbol-flow)',
  aspect: 'var(--p-symbol-aspect)',
  raw: 'var(--p-text-muted)',
};

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function LogRow({ entry, isExpanded, onToggle, onContextMenu }: {
  entry: LogEntry;
  isExpanded: boolean;
  onToggle: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const symbolColor = SYMBOL_COLORS[entry.symbolType] || SYMBOL_COLORS.raw;

  return (
    <div
      className={`log-row log-row--${entry.level}${isExpanded ? ' log-row--expanded' : ''}`}
      onClick={onToggle}
      onContextMenu={onContextMenu}
    >
      <span className="log-time">{formatTimestamp(entry.timestamp)}</span>
      <span className="log-level" style={{ color: LEVEL_COLORS[entry.level] }}>
        {entry.level.toUpperCase().padEnd(5)}
      </span>
      <span className="log-symbol" style={{ color: symbolColor }}>
        {entry.symbol}
      </span>
      <span className="log-service">{entry.service}</span>
      <span className="log-message">
        {entry.message}
        {entry.durationMs !== undefined && (
          <span className="log-duration">{entry.durationMs.toFixed(1)}ms</span>
        )}
      </span>

      {isExpanded && entry.data && (
        <div className="log-data" onClick={(e) => e.stopPropagation()}>
          <pre>{JSON.stringify(entry.data, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export function LogsTab() {
  const {
    isLoading,
    error,
    isLive,
    services,
    levelFilter,
    serviceFilter,
    searchQuery,
    excludedSymbols,
    excludedSymbolTypes,
    excludedMessages,
    excludedServices,
    loadLogs,
    loadServices,
    setIsLive,
    setLevelFilter,
    setServiceFilter,
    setSearchQuery,
    getFilteredLogs,
    clearLogs,
    toggleExcludedSymbol,
    toggleExcludedSymbolType,
    toggleExcludedMessage,
    toggleExcludedService,
    clearAllExclusions,
  } = useSentinelLogsStore();

  const logs = getFilteredLogs();
  const logsTopRef = useRef<HTMLDivElement>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expandAll, setExpandAll] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const { gridTemplate, onMouseDown: onColResize } = useResizableColumns([180, 50, 160, 100]);

  const hasExclusions = excludedSymbols.size > 0 || excludedSymbolTypes.size > 0 ||
    excludedMessages.size > 0 || excludedServices.size > 0;

  const handleRowContextMenu = useCallback((e: React.MouseEvent, entry: LogEntry) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  const toggleRow = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setExpandAll(false);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleExpandAll = () => {
    if (expandAll) {
      setExpandedIds(new Set());
      setExpandAll(false);
    } else {
      setExpandAll(true);
    }
  };

  // Load initial data, mark as live
  useEffect(() => {
    loadLogs();
    loadServices();
    setIsLive(true);
    return () => setIsLive(false);
  }, []);

  // Auto-scroll to top when new logs arrive
  useEffect(() => {
    if (autoScroll && logsTopRef.current) {
      logsTopRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs.length, autoScroll]);

  if (isLoading && logs.length === 0) {
    return (
      <div className="logs-view s-loading-state">
        <div className="s-loading-content">
          <div className="s-loading-spinner" />
          <p>Loading logs...</p>
        </div>
      </div>
    );
  }

  if (error && logs.length === 0) {
    return (
      <div className="logs-view s-error-state">
        <div className="s-error-content">
          <h2>Failed to load logs</h2>
          <p>{error}</p>
          <button onClick={() => loadLogs()}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="logs-view">
      {/* Toolbar */}
      <div className="logs-toolbar">
        <div className="logs-filters">
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value as any)}
            className="logs-select"
          >
            <option value="all">All Levels</option>
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
          </select>

          <select
            value={serviceFilter || ''}
            onChange={(e) => setServiceFilter(e.target.value || null)}
            className="logs-select"
          >
            <option value="">All Services</option>
            {services.map((s) => (
              <option key={s.name} value={s.name}>{s.name}</option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Search logs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="logs-search"
          />
        </div>

        <div className="logs-actions">
          <span className="logs-count">{logs.length} entries</span>
          <button
            className={`logs-expand-btn ${expandAll ? 'active' : ''}`}
            onClick={handleExpandAll}
            title={expandAll ? 'Collapse all payloads' : 'Expand all payloads'}
          >
            {expandAll ? 'Collapse All' : 'Expand All'}
          </button>
          <button
            className={`logs-live-btn ${isLive ? 'active' : ''}`}
            onClick={() => setIsLive(!isLive)}
            title={isLive ? 'Streaming live' : 'Click to connect'}
          >
            <span className={`live-dot ${isLive ? 'live' : ''}`} />
            {isLive ? 'Live' : 'Paused'}
          </button>
          <button
            className={`logs-scroll-btn ${autoScroll ? 'active' : ''}`}
            onClick={() => setAutoScroll(!autoScroll)}
            title="Auto-scroll to new logs"
          >
            {autoScroll ? 'Auto' : 'Manual'}
          </button>
          <button className="logs-clear-btn" onClick={clearLogs} title="Clear log buffer">
            Clear
          </button>
        </div>
      </div>

      {/* Exclusion Chips */}
      {hasExclusions && (
        <div className="exclusion-bar">
          {[...excludedSymbols].map((s) => (
            <span key={`sym-${s}`} className="exclusion-chip">
              symbol: {s} <button onClick={() => toggleExcludedSymbol(s)}>&times;</button>
            </span>
          ))}
          {[...excludedSymbolTypes].map((t) => (
            <span key={`type-${t}`} className="exclusion-chip">
              type: {t} <button onClick={() => toggleExcludedSymbolType(t)}>&times;</button>
            </span>
          ))}
          {[...excludedMessages].map((m) => (
            <span key={`msg-${m}`} className="exclusion-chip">
              msg: {m.length > 40 ? m.slice(0, 40) + '...' : m} <button onClick={() => toggleExcludedMessage(m)}>&times;</button>
            </span>
          ))}
          {[...excludedServices].map((s) => (
            <span key={`svc-${s}`} className="exclusion-chip">
              service: {s} <button onClick={() => toggleExcludedService(s)}>&times;</button>
            </span>
          ))}
          <button className="exclusion-clear" onClick={clearAllExclusions}>Clear all</button>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => { toggleExcludedSymbol(contextMenu.entry.symbol); setContextMenu(null); }}>
            Exclude symbol "{contextMenu.entry.symbol}"
          </button>
          <button onClick={() => { toggleExcludedSymbolType(contextMenu.entry.symbolType); setContextMenu(null); }}>
            Exclude type "{contextMenu.entry.symbolType}"
          </button>
          <button onClick={() => { toggleExcludedMessage(contextMenu.entry.message); setContextMenu(null); }}>
            Exclude this message
          </button>
          <button onClick={() => { toggleExcludedService(contextMenu.entry.service); setContextMenu(null); }}>
            Exclude service "{contextMenu.entry.service}"
          </button>
        </div>
      )}

      {/* Log Table */}
      <div className="logs-table" style={{ '--log-cols': gridTemplate } as CSSProperties}>
        <div className="logs-header">
          <span className="log-time">Time<ResizeHandle idx={0} onMouseDown={onColResize} /></span>
          <span className="log-level">Level<ResizeHandle idx={1} onMouseDown={onColResize} /></span>
          <span className="log-symbol">Symbol<ResizeHandle idx={2} onMouseDown={onColResize} /></span>
          <span className="log-service">Service<ResizeHandle idx={3} onMouseDown={onColResize} /></span>
          <span className="log-message">Message</span>
        </div>

        <div className="logs-body">
          <div ref={logsTopRef} />
          {logs.length === 0 ? (
            <div className="logs-empty">
              <p>No logs yet.</p>
              <p className="hint">
                POST structured logs to <code>/api/sentinel/logs</code> or connect an app with the Sentinel client SDK.
              </p>
            </div>
          ) : (
            logs.map((entry) => (
              <LogRow
                key={entry.id}
                entry={entry}
                isExpanded={expandAll || expandedIds.has(entry.id)}
                onToggle={() => toggleRow(entry.id)}
                onContextMenu={(e) => handleRowContextMenu(e, entry)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
