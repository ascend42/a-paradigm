import React from 'react';

interface BadgeProps {
  label: string;
  color?: string;
  variant?: 'solid' | 'outline';
}

export function Badge({ label, color, variant = 'solid' }: BadgeProps) {
  const baseColor = color || 'var(--p-text-secondary)';

  const style: React.CSSProperties = variant === 'outline'
    ? {
        display: 'inline-flex',
        alignItems: 'center',
        padding: '1px 6px',
        borderRadius: 8,
        fontSize: 10,
        fontWeight: 500,
        lineHeight: '16px',
        color: baseColor,
        border: `1px solid ${baseColor}`,
        background: 'transparent',
      }
    : {
        display: 'inline-flex',
        alignItems: 'center',
        padding: '1px 6px',
        borderRadius: 8,
        fontSize: 10,
        fontWeight: 500,
        lineHeight: '16px',
        color: baseColor,
        background: `color-mix(in srgb, ${baseColor} 15%, transparent)`,
        border: `1px solid color-mix(in srgb, ${baseColor} 30%, transparent)`,
      };

  return <span style={style}>{label}</span>;
}
