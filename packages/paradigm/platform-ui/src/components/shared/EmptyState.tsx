import React from 'react';

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '80px 20px',
      color: 'var(--p-text-muted)',
      textAlign: 'center',
    }}>
      {icon && (
        <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.6 }}>{icon}</div>
      )}
      <h2 style={{
        fontSize: 16,
        color: 'var(--p-text-secondary)',
        marginBottom: 8,
        fontWeight: 600,
      }}>{title}</h2>
      {description && (
        <p style={{
          fontSize: 13,
          maxWidth: 400,
          lineHeight: 1.5,
        }}>{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          style={{
            marginTop: 16,
            padding: '6px 16px',
            background: 'var(--p-bg-tertiary)',
            border: '1px solid var(--p-border)',
            borderRadius: 6,
            color: 'var(--p-text-primary)',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >{action.label}</button>
      )}
    </div>
  );
}
