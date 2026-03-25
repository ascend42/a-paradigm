import React, { useEffect } from 'react';
import { useTeamStore, type AgentSummary, type TeamThread, type ThreadMessage } from './store/teamStore';
import { usePlatformStore } from '../../store/platformStore';
import './styles/team.css';

// Agent color palette — deterministic by role (uses CSS variable tokens)
const AGENT_COLORS: Record<string, string> = {
  architect: 'var(--p-accent-purple)',
  builder: 'var(--p-accent-blue)',
  tester: 'var(--p-accent-green)',
  reviewer: 'var(--p-accent-orange)',
  security: 'var(--p-accent-red)',
};

function agentColor(role: string): string {
  return AGENT_COLORS[role] || `hsl(${Math.abs(hashCode(role)) % 360}, 60%, 50%)`;
}

function hashCode(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

const INTENT_COLORS: Record<string, string> = {
  question: 'var(--p-accent-blue)',
  context: 'var(--p-accent-cyan)',
  clarification: 'var(--p-accent-cyan)',
  proposal: 'var(--p-accent-orange)',
  verification: 'var(--p-accent-purple)',
  action: 'var(--p-accent-green)',
  decision: 'var(--p-accent-yellow)',
  alert: 'var(--p-accent-red)',
  approval: 'var(--p-accent-green)',
  rejection: 'var(--p-accent-red)',
  reference: 'var(--p-text-muted)',
  progress: 'var(--p-accent-emerald)',
};

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
  return `${Math.floor(ms / 86400000)}d ago`;
}

function stripAttribution(text: string): string {
  if (text.startsWith('[')) {
    const idx = text.indexOf(']');
    if (idx > 0) {
      const rest = text.slice(idx + 1);
      return rest.startsWith(' ') ? rest.slice(1) : rest;
    }
  }
  return text;
}

export default function TeamSection() {
  const {
    activeAgents, benchedAgents, rosterLoading,
    threads, threadsLoading, selectedThread,
    fetchRoster, fetchThreads, toggleBench, selectThread,
  } = useTeamStore();

  useEffect(() => {
    fetchRoster();
    fetchThreads();
    const interval = setInterval(() => {
      if (usePlatformStore.getState().activeSection === 'team') {
        fetchRoster();
        fetchThreads();
      }
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const currentThread = selectedThread
    ? threads.find(t => t.id === selectedThread)
    : threads[0];

  return (
    <div className="team">
      <h1 className="team__title">Team</h1>

      {/* Roster */}
      <div className="team__roster">
        <div className="team__roster-header">
          <span className="team__roster-label">Agent Roster</span>
          <span className="team__roster-count">
            {activeAgents.length} active
            {benchedAgents.length > 0 && ` · ${benchedAgents.length} benched`}
          </span>
        </div>

        {rosterLoading && activeAgents.length === 0 ? (
          <p className="team__empty">Loading roster...</p>
        ) : activeAgents.length === 0 && benchedAgents.length === 0 ? (
          <p className="team__empty">No agents registered</p>
        ) : (
          <>
            <div className="team__agent-grid">
              {activeAgents.map(agent => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onBench={() => toggleBench(agent.id, true)}
                />
              ))}
            </div>
            {benchedAgents.length > 0 && (
              <div className="team__benched">
                <div className="team__benched-label">Benched</div>
                <div className="team__agent-grid">
                  {benchedAgents.map(agent => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      benched
                      onActivate={() => toggleBench(agent.id, false)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Team Threads */}
      <div className="team__threads">
        <div className="team__threads-header">
          <span className="team__roster-label">Team Threads</span>
          <span className="team__roster-count">{threads.length} threads</span>
        </div>

        {threadsLoading && threads.length === 0 ? (
          <p className="team__empty">Loading threads...</p>
        ) : threads.length === 0 ? (
          <p className="team__empty">No orchestration threads yet</p>
        ) : (
          <>
            {threads.length > 1 && (
              <div className="team__thread-tabs">
                {threads.map(t => (
                  <button
                    key={t.id}
                    className={`team__thread-tab ${
                      (currentThread?.id === t.id) ? 'team__thread-tab--active' : ''
                    }`}
                    onClick={() => selectThread(t.id)}
                  >
                    {t.displayName} ({t.messages.length})
                  </button>
                ))}
              </div>
            )}

            {currentThread && (
              <div className="team__messages">
                {currentThread.messages.map(msg => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Agent Card ───────────────────────────────────────

function AgentCard({
  agent, benched, onBench, onActivate,
}: {
  agent: AgentSummary;
  benched?: boolean;
  onBench?: () => void;
  onActivate?: () => void;
}) {
  const color = agentColor(agent.id);

  return (
    <div className={`team__agent-card ${benched ? 'team__agent-card--benched' : ''}`}>
      <div className="team__agent-header">
        <div>
          <span className="team__agent-name" style={{ color }}>
            {agent.nickname || agent.id}
          </span>
          {agent.nickname && (
            <span className="team__agent-nickname">({agent.id})</span>
          )}
          <div className="team__agent-role">{agent.role}</div>
        </div>
        {benched ? (
          <button className="team__bench-btn" onClick={onActivate}>Activate</button>
        ) : (
          <button className="team__bench-btn" onClick={onBench}>Bench</button>
        )}
      </div>
      <div className="team__agent-stats">
        <span>{agent.expertiseCount} symbols</span>
        {agent.threshold != null && (
          <span>thr: {agent.threshold.toFixed(2)}</span>
        )}
        {agent.topExpertise.length > 0 && (
          <span className="team__agent-stat--good">
            top: {agent.topExpertise[0].symbol} ({Math.round(agent.topExpertise[0].confidence * 100)}%)
          </span>
        )}
      </div>
    </div>
  );
}

// ── Message Bubble ───────────────────────────────────

function MessageBubble({ message }: { message: ThreadMessage }) {
  const role = message.sender.role || message.sender.name;
  const color = agentColor(role);
  const intentColor = INTENT_COLORS[message.intent] || 'var(--p-text-muted)';

  return (
    <div className="team__message">
      <div className="team__message-header">
        <span className="team__message-sender" style={{ color }}>
          [{role}]
        </span>
        <span className="team__message-time">{relativeTime(message.timestamp)}</span>
      </div>
      <div>
        <span
          className="team__message-intent"
          style={{
            color: intentColor,
            backgroundColor: `color-mix(in srgb, ${intentColor} 12%, transparent)`,
          }}
        >
          {message.intent}
        </span>
        {message.symbols.length > 0 && (
          <span className="team__message-symbols">
            {message.symbols.join(' ')}
          </span>
        )}
      </div>
      <div className="team__message-text">{stripAttribution(message.text)}</div>
      {message.diff && (
        <div className="team__message-diff">{message.diff}</div>
      )}
      {message.decision && (
        <div className="team__message-decision">✓ {message.decision}</div>
      )}
    </div>
  );
}
