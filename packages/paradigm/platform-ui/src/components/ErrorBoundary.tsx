import React, { Component, type ReactNode } from 'react';

interface Props {
  sectionName: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100%', gap: 12,
          color: 'var(--p-text-muted)', padding: 24,
        }}>
          <span style={{ fontSize: 32 }}>!</span>
          <h3 style={{ margin: 0, color: 'var(--p-text-primary)' }}>
            {this.props.sectionName} encountered an error
          </h3>
          <p style={{ margin: 0, fontSize: 13, maxWidth: 400, textAlign: 'center' }}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginTop: 8, padding: '6px 16px', cursor: 'pointer',
              background: 'var(--p-bg-tertiary)', color: 'var(--p-text-primary)',
              border: '1px solid var(--p-border)', borderRadius: 6, fontSize: 13,
            }}
          >
            Reload section
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
