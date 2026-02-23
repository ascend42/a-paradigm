import React from 'react';

interface DateSeparatorProps {
  date: string;
  humanCount: number;
  agentCount: number;
}

export function DateSeparator({ date, humanCount, agentCount }: DateSeparatorProps) {
  const d = new Date(date);
  const label = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="date-separator">
      <span className="date-count human">{humanCount}</span>
      <span className="date-badge">{label}</span>
      <span className="date-count agent">{agentCount}</span>
    </div>
  );
}
