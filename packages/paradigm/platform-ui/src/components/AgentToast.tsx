import React from 'react';
import { useAgentStore, type Annotation } from '../store/agentStore';

const severityColors: Record<string, string> = {
  info: 'var(--p-symbol-component)',
  warning: 'var(--p-symbol-signal)',
  error: 'var(--p-symbol-gate)',
  success: 'var(--p-symbol-flow)',
};

function Toast({ toast }: { toast: Annotation }) {
  const dismissToast = useAgentStore(s => s.dismissToast);
  const borderColor = severityColors[toast.severity] || severityColors.info;

  return (
    <div className="agent-toast" style={{ borderLeftColor: borderColor }}>
      <span className="agent-toast__icon">&#x1F916;</span>
      <span className="agent-toast__message">{toast.message}</span>
      <button
        className="agent-toast__dismiss"
        onClick={() => dismissToast(toast.id)}
        aria-label="Dismiss"
      >
        &times;
      </button>
    </div>
  );
}

export function AgentToastContainer() {
  const toasts = useAgentStore(s => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div className="agent-toast-container">
      {toasts.map(t => (
        <Toast key={t.id} toast={t} />
      ))}
    </div>
  );
}
