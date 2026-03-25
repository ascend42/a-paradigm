/**
 * IncidentsTab — Incident triage and pattern matching
 *
 * Ported from sentinel/ui/src/views/IncidentsView.tsx with useSentinelIncidentsStore.
 */

import { useEffect } from 'react';
import { useSentinelIncidentsStore } from '../store/sentinelIncidentsStore';

const STATUS_COLORS: Record<string, string> = {
  open: 'var(--p-accent-red)',
  investigating: 'var(--p-accent-amber)',
  resolved: 'var(--p-accent-green)',
  'wont-fix': 'var(--p-text-muted)',
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  investigating: 'Investigating',
  resolved: 'Resolved',
  'wont-fix': "Won't Fix",
};

export function IncidentsTab() {
  const {
    isLoading,
    error,
    statusFilter,
    selectedIncidentId,
    loadIncidents,
    loadPatterns,
    selectIncident,
    setStatusFilter,
    getFilteredIncidents,
    getSelectedIncident,
    resolveIncident,
  } = useSentinelIncidentsStore();

  const incidents = getFilteredIncidents();
  const selectedIncident = getSelectedIncident();

  useEffect(() => {
    loadIncidents();
    loadPatterns();
  }, []);

  if (isLoading) {
    return (
      <div className="incidents-view s-loading-state">
        <div className="s-loading-content">
          <div className="s-loading-spinner" />
          <p>Loading incidents...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="incidents-view s-error-state">
        <div className="s-error-content">
          <h2>Failed to load incidents</h2>
          <p>{error}</p>
          <button onClick={() => loadIncidents()}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="incidents-view">
      {/* Filters Bar */}
      <div className="incidents-filters">
        <div className="filter-group">
          <label>Status:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          >
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="investigating">Investigating</option>
            <option value="resolved">Resolved</option>
            <option value="wont-fix">Won't Fix</option>
          </select>
        </div>
        <div className="filter-stats">
          {incidents.length} incident{incidents.length !== 1 ? 's' : ''}
        </div>
      </div>

      <div className="incidents-content">
        {/* Incidents List */}
        <div className="incidents-list">
          {incidents.length === 0 ? (
            <div className="incidents-empty">
              <p>No incidents found.</p>
              <p className="hint">
                Incidents are recorded when errors occur in your application.
              </p>
            </div>
          ) : (
            incidents.map((incident) => (
              <div
                key={incident.id}
                className={`incident-card ${selectedIncidentId === incident.id ? 'selected' : ''}`}
                onClick={() => selectIncident(incident.id)}
              >
                <div className="incident-header">
                  <span className="incident-id">{incident.id}</span>
                  <span
                    className="incident-status"
                    style={{ color: STATUS_COLORS[incident.status] }}
                  >
                    {STATUS_LABELS[incident.status]}
                  </span>
                </div>
                <div className="incident-error">{incident.error.message}</div>
                <div className="incident-meta">
                  <span className="incident-env">{incident.environment}</span>
                  <span className="incident-time">
                    {new Date(incident.timestamp).toLocaleString()}
                  </span>
                </div>
                {incident.symbols && Object.keys(incident.symbols).length > 0 && (
                  <div className="incident-symbols">
                    {incident.symbols.component && (
                      <span className="symbol-tag component">#{incident.symbols.component}</span>
                    )}
                    {incident.symbols.flow && (
                      <span className="symbol-tag flow">${incident.symbols.flow}</span>
                    )}
                    {incident.symbols.gate && (
                      <span className="symbol-tag gate">^{incident.symbols.gate}</span>
                    )}
                    {incident.symbols.signal && (
                      <span className="symbol-tag signal">!{incident.symbols.signal}</span>
                    )}
                  </div>
                )}
                {incident.patternMatches && incident.patternMatches.length > 0 && (
                  <div className="incident-patterns">
                    <span className="pattern-match">
                      Matched: {incident.patternMatches[0].patternName}
                      ({Math.round(incident.patternMatches[0].confidence)}%)
                    </span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Incident Detail Panel */}
        {selectedIncident && (
          <div className="incident-detail">
            <div className="detail-header">
              <h2>{selectedIncident.id}</h2>
              <button
                className="detail-close"
                onClick={() => selectIncident(null)}
              >
                &times;
              </button>
            </div>

            <div className="detail-content">
              <section className="detail-section">
                <h3>Error</h3>
                <div className="error-message">{selectedIncident.error.message}</div>
                {selectedIncident.error.type && (
                  <div className="error-type">Type: {selectedIncident.error.type}</div>
                )}
              </section>

              <section className="detail-section">
                <h3>Context</h3>
                <div className="detail-field">
                  <label>Status</label>
                  <span
                    className="status-badge"
                    style={{ backgroundColor: STATUS_COLORS[selectedIncident.status] }}
                  >
                    {STATUS_LABELS[selectedIncident.status]}
                  </span>
                </div>
                <div className="detail-field">
                  <label>Environment</label>
                  <span>{selectedIncident.environment}</span>
                </div>
                <div className="detail-field">
                  <label>Timestamp</label>
                  <span>{new Date(selectedIncident.timestamp).toLocaleString()}</span>
                </div>
              </section>

              {selectedIncident.symbols && Object.keys(selectedIncident.symbols).length > 0 && (
                <section className="detail-section">
                  <h3>Symbols</h3>
                  <div className="symbols-list">
                    {Object.entries(selectedIncident.symbols).map(([key, value]) => (
                      value && (
                        <div key={key} className="symbol-item">
                          <label>{key}</label>
                          <span className={`symbol-value ${key}`}>{value}</span>
                        </div>
                      )
                    ))}
                  </div>
                </section>
              )}

              {selectedIncident.patternMatches && selectedIncident.patternMatches.length > 0 && (
                <section className="detail-section">
                  <h3>Pattern Matches</h3>
                  <div className="patterns-list">
                    {selectedIncident.patternMatches.map((match) => (
                      <div key={match.patternId} className="pattern-item">
                        <div className="pattern-name">{match.patternName}</div>
                        <div className="pattern-confidence">
                          {Math.round(match.confidence)}% confidence
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {selectedIncident.status === 'open' && (
                <section className="detail-actions">
                  <button
                    className="action-btn resolve"
                    onClick={() => resolveIncident(selectedIncident.id)}
                  >
                    Mark Resolved
                  </button>
                </section>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
