import React from 'react';

export function DateSeparator({ date }: { date: string }) {
  const d = new Date(date);
  const label = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="date-separator">
      <span>{label}</span>
    </div>
  );
}
