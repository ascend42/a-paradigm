import React from 'react';

interface HealthBarProps {
  label: string;
  value: number; // 0-1
  color?: string;
}

function getColor(value: number): string {
  if (value >= 0.8) return 'var(--p-accent-green)';
  if (value >= 0.5) return 'var(--p-accent-orange)';
  return 'var(--p-accent-red)';
}

export function HealthBar({ label, value, color }: HealthBarProps) {
  const pct = Math.round(value * 100);
  const barColor = color || getColor(value);

  return (
    <div className="health-bar">
      <div className="health-bar__header">
        <span className="health-bar__label">{label}</span>
        <span className="health-bar__value">{pct}%</span>
      </div>
      <div className="health-bar__track">
        <div
          className="health-bar__fill"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
        />
      </div>
    </div>
  );
}
