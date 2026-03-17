import React from 'react';
import { SymbolLink } from './SymbolLink';

interface Step { type: string; symbol: string; description?: string }

const STEP_ICONS: Record<string, string> = {
  gate: '^',
  action: '#',
  signal: '!',
};

const STEP_COLORS: Record<string, string> = {
  gate: 'var(--p-symbol-gate)',
  action: 'var(--p-symbol-component)',
  signal: 'var(--p-symbol-signal)',
};

export function FlowSteps({ steps }: { steps: Step[] }) {
  return (
    <div className="flow-steps">
      {steps.map((step, i) => (
        <div key={i} className="flow-steps__step">
          <div className="flow-steps__connector">
            <span className="flow-steps__dot" style={{ background: STEP_COLORS[step.type] || 'var(--p-text-muted)' }} />
            {i < steps.length - 1 && <span className="flow-steps__line" />}
          </div>
          <div className="flow-steps__content">
            <span className="flow-steps__type" style={{ color: STEP_COLORS[step.type] }}>
              {step.type}
            </span>
            <SymbolLink symbol={step.symbol} />
            {step.description && <span className="flow-steps__desc">{step.description}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
