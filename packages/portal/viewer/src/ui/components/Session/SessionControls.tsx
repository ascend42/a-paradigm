/**
 * Session Controls - start/stop recording, naming, export
 */

import { useState } from 'react';
import { useViewerStore } from '../../store/viewerStore';

export function SessionControls() {
  const { session, startSession, endSession, renameSession } = useViewerStore();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');

  const handleStartSession = () => {
    startSession();
  };

  const handleEndSession = () => {
    endSession();
  };

  const handleStartRename = () => {
    setEditName(session?.name || '');
    setIsEditing(true);
  };

  const handleSaveRename = () => {
    if (editName.trim()) {
      renameSession(editName.trim());
    }
    setIsEditing(false);
  };

  const formatDuration = (start: string, end?: string) => {
    const startTime = new Date(start).getTime();
    const endTime = end ? new Date(end).getTime() : Date.now();
    const duration = Math.floor((endTime - startTime) / 1000);

    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;

    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  };

  return (
    <div className="session-controls">
      <div className="session-header">
        <h3>Session</h3>
        {!session && (
          <button className="btn-primary" onClick={handleStartSession}>
            Start Recording
          </button>
        )}
        {session && session.status === 'active' && (
          <button className="btn-danger" onClick={handleEndSession}>
            End Session
          </button>
        )}
      </div>

      {session && (
        <div className="session-info">
          {/* Session name */}
          <div className="session-name">
            {isEditing ? (
              <div className="name-edit">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveRename();
                    if (e.key === 'Escape') setIsEditing(false);
                  }}
                  autoFocus
                />
                <button onClick={handleSaveRename}>Save</button>
                <button onClick={() => setIsEditing(false)}>Cancel</button>
              </div>
            ) : (
              <div className="name-display" onClick={handleStartRename}>
                <span className="name-text">{session.name}</span>
                <span className="name-edit-hint">✏️</span>
              </div>
            )}
          </div>

          {/* Session status */}
          <div className={`session-status ${session.status}`}>
            <span className="status-dot" />
            <span className="status-text">
              {session.status === 'active' ? 'Recording' : 'Completed'}
            </span>
            <span className="status-duration">
              {formatDuration(session.startedAt, session.endedAt)}
            </span>
          </div>

          {/* Session stats */}
          <div className="session-stats">
            <div className="stat">
              <span className="stat-icon">📊</span>
              <span className="stat-value">{session.totalEvents}</span>
              <span className="stat-label">Events</span>
            </div>
            <div className="stat">
              <span className="stat-icon">🚪</span>
              <span className="stat-value">{session.gatesChecked}</span>
              <span className="stat-label">Checked</span>
            </div>
            <div className="stat pass">
              <span className="stat-icon">✅</span>
              <span className="stat-value">{session.gatesPassed}</span>
              <span className="stat-label">Passed</span>
            </div>
            <div className="stat fail">
              <span className="stat-icon">❌</span>
              <span className="stat-value">{session.gatesFailed}</span>
              <span className="stat-label">Failed</span>
            </div>
          </div>

          {/* Pass rate */}
          {session.gatesChecked > 0 && (
            <div className="session-pass-rate">
              <span className="rate-label">Pass Rate:</span>
              <span className="rate-value">
                {Math.round((session.gatesPassed / session.gatesChecked) * 100)}%
              </span>
              <div className="rate-bar">
                <div
                  className="rate-fill"
                  style={{
                    width: `${(session.gatesPassed / session.gatesChecked) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Flows completed */}
          {session.flowsCompleted.length > 0 && (
            <div className="session-flows">
              <span className="flows-label">Flows Completed:</span>
              <div className="flows-list">
                {session.flowsCompleted.map((flowId) => (
                  <span key={flowId} className="flow-badge">
                    {flowId}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Export actions */}
          {session.status === 'completed' && (
            <div className="session-actions">
              <button className="btn-secondary" disabled>
                Export JSON
              </button>
              <button className="btn-secondary" disabled>
                Export Markdown
              </button>
              <button className="btn-secondary" disabled>
                Send to Webhook
              </button>
            </div>
          )}
        </div>
      )}

      {!session && (
        <div className="session-empty">
          <p>No active session</p>
          <p className="hint">
            Start a session to record portal events for testing and reporting.
          </p>
        </div>
      )}
    </div>
  );
}
