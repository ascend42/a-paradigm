/**
 * NetworkTab — Grid of agent cards with status indicators
 */

import { useSymphonyStore } from '../store/symphonyStore';

function relativeTime(ts: string | undefined): string {
  if (!ts) return 'never';
  const diff = Date.now() - new Date(ts).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function NetworkTab() {
  const agents = useSymphonyStore(s => s.agents);
  const status = useSymphonyStore(s => s.status);

  return (
    <div className="network-view">
      {status && (
        <div className="network-status-bar">
          <div className="network-stat">
            <div className="network-stat-value">{status.agentCount}</div>
            <div className="network-stat-label">Agents</div>
          </div>
          <div className="network-stat">
            <div className="network-stat-value" style={{ color: 'var(--p-accent-green)' }}>{status.awakeCount}</div>
            <div className="network-stat-label">Awake</div>
          </div>
          <div className="network-stat">
            <div className="network-stat-value">{status.activeThreadCount}</div>
            <div className="network-stat-label">Active Threads</div>
          </div>
          <div className="network-stat">
            <div className="network-stat-value">{status.unreadCount}</div>
            <div className="network-stat-label">Unread</div>
          </div>
          <div className="network-stat">
            <div className="network-stat-value">{status.pendingFileRequests}</div>
            <div className="network-stat-label">Pending Files</div>
          </div>
        </div>
      )}

      {agents.length === 0 ? (
        <div className="network-empty">
          <p>No agents registered.</p>
          <p style={{ marginTop: 8 }}>
            Run <code>paradigm symphony join</code> in a project to register an agent.
          </p>
        </div>
      ) : (
        <div className="agent-grid">
          {agents.map(agent => (
            <div key={agent.id} className="agent-card">
              <div className="agent-card-header">
                <span className="agent-card-id">{agent.id}</span>
                <span className={`agent-status-dot ${agent.status}`} title={agent.status} />
              </div>
              <div className="agent-card-name">{agent.name}</div>
              {agent.statusBlurb && (
                <div className="agent-card-blurb">{agent.statusBlurb}</div>
              )}
              <div className="agent-card-details">
                <div className="agent-card-detail">
                  <span className="agent-card-detail-label">Project</span>
                  <span className="agent-card-detail-value">{agent.project}</span>
                </div>
                <div className="agent-card-detail">
                  <span className="agent-card-detail-label">Role</span>
                  <span className="agent-card-detail-value">{agent.role}</span>
                </div>
                <div className="agent-card-detail">
                  <span className="agent-card-detail-label">Last Poll</span>
                  <span className="agent-card-detail-value">{relativeTime(agent.lastPoll)}</span>
                </div>
                <div className="agent-card-detail">
                  <span className="agent-card-detail-label">Started</span>
                  <span className="agent-card-detail-value">{relativeTime(agent.startedAt)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
