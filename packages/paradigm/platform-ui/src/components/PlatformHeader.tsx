import React from 'react';
import { usePlatformStore } from '../store/platformStore';
import { useAgentStore } from '../store/agentStore';

export function PlatformHeader() {
  const activeSection = usePlatformStore(s => s.activeSection);
  const projectName = usePlatformStore(s => s.projectName);
  const agents = useAgentStore(s => s.agents);
  const agentMuted = useAgentStore(s => s.agentMuted);
  const setAgentMuted = useAgentStore(s => s.setAgentMuted);

  const sectionLabel = activeSection.charAt(0).toUpperCase() + activeSection.slice(1);

  return (
    <header className="header">
      <div className="header__left">
        <span className="header__title">Paradigm Platform</span>
        {projectName && (
          <span className="header__project">{projectName}</span>
        )}
      </div>
      <div className="header__right">
        {agents.length > 0 && (
          <div className="agent-presence">
            {agents.map(a => (
              <span
                key={a.agentId}
                className="agent-presence__dot"
                style={{ backgroundColor: a.color }}
                title={a.agentId}
              />
            ))}
            <span>{agents.length} agent{agents.length !== 1 ? 's' : ''}</span>
            <button
              className={`agent-mute-btn${agentMuted ? ' agent-mute-btn--muted' : ''}`}
              onClick={() => setAgentMuted(!agentMuted)}
              title={agentMuted ? 'Unmute agent actions' : 'Mute agent actions'}
            >
              {agentMuted ? 'Muted' : 'Mute'}
            </button>
          </div>
        )}
        <span style={{ fontSize: 12, color: 'var(--p-text-muted)' }}>
          {sectionLabel}
        </span>
      </div>
    </header>
  );
}
