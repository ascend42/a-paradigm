import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: string;
  trend?: string;
  detail?: string;
  accent?: string;
  onClick?: () => void;
}

export function StatCard({ label, value, icon, trend, detail, accent, onClick }: StatCardProps) {
  return (
    <div
      className={`stat-card ${onClick ? 'stat-card--clickable' : ''}`}
      onClick={onClick}
      style={accent ? { borderTopColor: accent, borderTopWidth: 2 } as React.CSSProperties : undefined}
    >
      <div className="stat-card__value">
        {icon && <span className="stat-card__icon">{icon}</span>}
        {value}
        {trend && <span className="stat-card__trend">{trend}</span>}
      </div>
      <div className="stat-card__label">{label}</div>
      {detail && <div className="stat-card__detail">{detail}</div>}
    </div>
  );
}
