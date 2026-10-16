import type React from 'react';

/** Shared inline style tokens (mirrors the Memory / Academy sections). */
export const card: React.CSSProperties = {
  background: 'var(--p-bg-secondary)',
  border: '1px solid var(--p-border)',
  borderRadius: 'var(--p-radius)',
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};
export const h2: React.CSSProperties = { margin: 0, fontSize: 16, color: 'var(--p-text-primary)' };
export const muted: React.CSSProperties = { color: 'var(--p-text-muted)', fontSize: 13 };
export const errorText: React.CSSProperties = { color: 'var(--p-accent-red)', fontSize: 13 };
export const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, color: 'var(--p-text-secondary)' };
export const num: React.CSSProperties = { color: 'var(--p-text-primary)', fontVariantNumeric: 'tabular-nums' };
