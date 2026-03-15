import React from 'react';
import { useAgentStore, type Annotation } from '../store/agentStore';

const severityColors: Record<string, string> = {
  info: 'var(--p-symbol-component)',
  warning: 'var(--p-symbol-signal)',
  error: 'var(--p-symbol-gate)',
  success: 'var(--p-symbol-flow)',
};

export function AgentCalloutOverlay() {
  const annotations = useAgentStore(s => s.annotations);
  const callouts = annotations.filter(a => a.type === 'callout');

  if (callouts.length === 0) return null;

  return (
    <div className="agent-callout-overlay">
      {callouts.map(c => (
        <div
          key={c.id}
          className="agent-callout"
          style={{ borderColor: severityColors[c.severity] || severityColors.info }}
        >
          <div className="agent-callout__symbol">{c.symbol || ''}</div>
          <div className="agent-callout__message">{c.message}</div>
        </div>
      ))}
    </div>
  );
}

export function AgentNavigationPrompt() {
  const pendingNavigation = useAgentStore(s => s.pendingNavigation);
  const acceptNavigation = useAgentStore(s => s.acceptNavigation);
  const dismissNavigation = useAgentStore(s => s.dismissNavigation);

  if (!pendingNavigation) return null;

  const target = pendingNavigation.symbol || pendingNavigation.section || 'a view';

  return (
    <div className="agent-nav-prompt">
      <span className="agent-nav-prompt__icon">&#x1F916;</span>
      <span className="agent-nav-prompt__text">
        Agent wants to show you <strong>{target}</strong>
      </span>
      <button className="agent-nav-prompt__accept" onClick={acceptNavigation}>
        Go there
      </button>
      <button className="agent-nav-prompt__dismiss" onClick={dismissNavigation}>
        Dismiss
      </button>
    </div>
  );
}
