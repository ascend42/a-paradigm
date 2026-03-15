import React from 'react';

interface StatCardProps {
  value: string | number;
  label: string;
  detail?: string;
  accent?: string;
  onClick?: () => void;
}

export function StatCard({ value, label, detail, accent, onClick }: StatCardProps) {
  return (
    <div
      className={`stat-card ${onClick ? 'stat-card--clickable' : ''}`}
      onClick={onClick}
      style={accent ? { borderTopColor: accent, borderTopWidth: 2 } as React.CSSProperties : undefined}
    >
      <div className="stat-card__value">{value}</div>
      <div className="stat-card__label">{label}</div>
      {detail && <div className="stat-card__detail">{detail}</div>}
    </div>
  );
}
