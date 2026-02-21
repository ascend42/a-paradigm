import React from 'react';

export function VerificationBadge({ status }: { status?: string }) {
  if (!status) return null;

  const config: Record<string, { icon: string; className: string }> = {
    pass: { icon: '\u2713', className: 'pass' },
    fail: { icon: '\u2717', className: 'fail' },
    partial: { icon: '\u26A0', className: 'partial' },
    untested: { icon: '\u00B7', className: '' },
  };

  const c = config[status] || config.untested;

  return (
    <span className={`lore-card-verify ${c.className}`}>{c.icon} {status}</span>
  );
}
