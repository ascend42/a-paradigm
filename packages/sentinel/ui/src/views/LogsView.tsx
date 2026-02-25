/**
 * Logs View - Real-time structured log viewer with WebSocket streaming
 */

import { useEffect, useRef, useState } from 'react';
import { useLogsStore, type LogEntry } from '../store/logsStore';

const LEVEL_COLORS: Record<string, string> = {
  debug: '#94a3b8',
  info: '#3b82f6',
  warn: '#f59e0b',
  error: '#ef4444',
};

const SYMBOL_COLORS: Record<string, string> = {
  component: 'var(--color-component)',
  gate: '#f59e0b',
  signal: 'var(--color-signal)',
  flow: 'var(--color-flow)',
  aspect: 'var(--color-aspect)',
  raw: 'var(--text-muted)',
};

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 3 });
}

function LogRow({ entry, isExpanded, onToggle }: {
  entry: LogEntry;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const symbolColor = SYMBOL_COLORS[entry.symbolType] || SYMBOL_COLORS.raw;

  return (
    <div className={`log-row log-row--${entry.level}`} onClick={onToggle}>
      <span className="log-time">{formatTimestamp(entry.timestamp)}</span>
      <span className="log-level" style={{ color: LEVEL_COLORS[entry.level] }}>
        {entry.level.toUpperCase().padEnd(5)}
      </span>
      <span className="log-symbol" style={{ color: symbolColor }}>
        {entry.symbol}
      </span>
      <span className="log-service">{entry.service}</span>
      <span className="log-message">{entry.message}</span>
      {entry.durationMs !== undefined && (
        <span className="log-duration">{entry.durationMs.toFixed(1)}ms</span>
      )}

      {isExpanded && entry.data && (
        <div className="log-data" onClick={(e) => e.stopPropagation()}>
          <pre>{JSON.stringify(entry.data, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export function LogsView() {
  const {
    isLoading,
    error,
    isLive,
    services,
    levelFilter,
    serviceFilter,
    searchQuery,
    loadLogs,
    loadServices,
    connectWebSocket,
    disconnectWebSocket,
    setLevelFilter,
    setServiceFilter,
    setSearchQuery,
    getFilteredLogs,
    clearLogs,
  } = useLogsStore();

  const logs = getFilteredLogs();
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Load initial data and connect WebSocket
  useEffect(() => {
    loadLogs();
    loadServices();
    connectWebSocket();
    return () => disconnectWebSocket();
  }, [loadLogs, loadServices, connectWebSocket, disconnectWebSocket]);

  // Auto-scroll when new logs arrive
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs.length, autoScroll]);

  if (isLoading && logs.length === 0) {
    return (
      <div className="logs-view loading-state">
        <div className="loading-content">
          <div className="loading-spinner" />
          <p>Loading logs...</p>
        </div>
      </div>
    );
  }

  if (error && logs.length === 0) {
    return (
      <div className="logs-view error-state">
        <div className="error-content">
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
            className={`logs-live-btn ${isLive ? 'active' : ''}`}
            onClick={() => isLive ? disconnectWebSocket() : connectWebSocket()}
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

      {/* Log Table */}
      <div className="logs-table">
        <div className="logs-header">
          <span className="log-time">Time</span>
          <span className="log-level">Level</span>
          <span className="log-symbol">Symbol</span>
          <span className="log-service">Service</span>
          <span className="log-message">Message</span>
        </div>

        <div className="logs-body">
          {logs.length === 0 ? (
            <div className="logs-empty">
              <p>No logs yet.</p>
              <p className="hint">
                POST structured logs to <code>/api/logs</code> or connect an app with the Sentinel client SDK.
              </p>
            </div>
          ) : (
            logs.map((entry) => (
              <LogRow
                key={entry.id}
                entry={entry}
                isExpanded={expandedId === entry.id}
                onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
              />
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
}
