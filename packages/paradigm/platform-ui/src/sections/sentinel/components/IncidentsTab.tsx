/**
 * IncidentsTab — Incident triage and pattern matching
 *
 * Ported from sentinel/ui/src/views/IncidentsView.tsx with useSentinelIncidentsStore.
 */

import { useEffect, useState } from 'react';
import { useSentinelIncidentsStore } from '../store/sentinelIncidentsStore';
import {
  STATUS_LABELS,
  canResolve,
  describeLoadError,
  emptyStateCopy,
  isActiveStatus,
  patternMatchLabel,
} from '../incidentCopy';

const STATUS_COLORS: Record<string, string> = {
  open: 'var(--p-accent-red)',
  investigating: 'var(--p-accent-orange)',
  resolved: 'var(--p-accent-green)',
  'wont-fix': 'var(--p-text-muted)',
};

type ResolveState = 'idle' | 'confirming' | 'pending' | 'failed';

export function IncidentsTab() {
  const {
    incidents: allIncidents,
    isLoading,
    error,
    errorStatus,
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
  const [resolveState, setResolveState] = useState<ResolveState>('idle');

  useEffect(() => {
    loadIncidents();
    loadPatterns();
  }, []);

  // A new selection starts with a fresh resolve control.
  useEffect(() => {
    setResolveState('idle');
  }, [selectedIncidentId]);

  const handleResolve = async (id: string) => {
    setResolveState('pending');
    try {
      await resolveIncident(id);
      setResolveState('idle');
    } catch {
      setResolveState('failed');
    }
  };

  const loadError = error ? describeLoadError(errorStatus) : null;
  const empty = emptyStateCopy(statusFilter, allIncidents.length);

  return (
    <div className="incidents-view">
      {/* Filters Bar */}
      <div className="incidents-filters">
        <div className="filter-group">
          <label htmlFor="incidents-status-filter">Status:</label>
          <select
            id="incidents-status-filter"
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

      <div className={`incidents-content ${selectedIncident ? 'incidents-content--detail-open' : ''}`}>
        {/* Incidents List */}
        <div className="incidents-list">
          {loadError ? (
            <div className="s-error-content incidents-load-error" role="alert">
              <h2>{loadError.title}</h2>
              <p>{loadError.detail}</p>
              <p><code className="incidents-command">{loadError.command}</code></p>
              <p className="hint">{error}</p>
              <button onClick={() => loadIncidents()}>Retry</button>
            </div>
          ) : isLoading && allIncidents.length === 0 ? (
            <div className="s-loading-content incidents-loading">
              <div className="s-loading-spinner" />
              <p>Loading incidents...</p>
            </div>
          ) : incidents.length === 0 ? (
            <div className="incidents-empty">
              <p>{empty.title}</p>
              <p className="hint">{empty.hint}</p>
              {empty.canClearFilter && (
                <button className="action-btn cancel" onClick={() => setStatusFilter('all')}>
                  Show all incidents
                </button>
              )}
            </div>
          ) : (
            incidents.map((incident) => (
              <div
                key={incident.id}
                className={`incident-card ${selectedIncidentId === incident.id ? 'selected' : ''} ${isActiveStatus(incident.status) ? '' : 'incident-card--closed'}`}
                onClick={() => selectIncident(incident.id)}
              >
                <div className="incident-header">
                  <span className="incident-id">{incident.id}</span>
                  <span
                    className={`incident-status incident-status--${incident.status}`}
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
                      {patternMatchLabel(
                        incident.patternMatches[0].patternName,
                        incident.patternMatches[0].confidence,
                      )}
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
                aria-label="Close incident details"
                title="Close"
              >
                <span aria-hidden="true">&times;</span>
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
                    style={{ color: STATUS_COLORS[selectedIncident.status] }}
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

              {canResolve(selectedIncident.status) && (
                <section className="detail-actions">
                  {resolveState === 'confirming' ? (
                    <>
                      <p className="action-confirm-text">
                        Resolve {selectedIncident.id}? This can't be undone from here.
                      </p>
                      <div className="action-row">
                        <button
                          className="action-btn resolve"
                          onClick={() => handleResolve(selectedIncident.id)}
                        >
                          Yes, resolve
                        </button>
                        <button
                          className="action-btn cancel"
                          onClick={() => setResolveState('idle')}
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <button
                      className="action-btn resolve"
                      disabled={resolveState === 'pending'}
                      onClick={() => setResolveState('confirming')}
                    >
                      {resolveState === 'pending' ? 'Resolving...' : 'Mark Resolved'}
                    </button>
                  )}
                  {resolveState === 'failed' && (
                    <p className="action-error" role="alert">
                      Couldn't resolve this incident. Check that <code>paradigm serve</code> is running, then try again.
                    </p>
                  )}
                </section>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
