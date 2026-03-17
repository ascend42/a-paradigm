import React from 'react';
import { useDocsStore } from '../store/docsStore';

const SYMBOL_COLORS: Record<string, string> = {
  '#': 'var(--p-symbol-component)',
  '$': 'var(--p-symbol-flow)',
  '^': 'var(--p-symbol-gate)',
  '!': 'var(--p-symbol-signal)',
  '~': 'var(--p-symbol-aspect)',
};

export function SymbolLink({ symbol, label }: { symbol: string; label?: string }) {
  const selectPage = useDocsStore(s => s.selectPage);
  const clearSearch = useDocsStore(s => s.clearSearch);

  const prefix = symbol.charAt(0);
  const color = SYMBOL_COLORS[prefix] || 'var(--p-text-primary)';
  const id = symbol.replace(/^[#$^!~]/, '');

  const kindMap: Record<string, 'symbol' | 'flow' | 'portal'> = {
    '#': 'symbol', '$': 'flow', '^': 'symbol', '!': 'symbol', '~': 'symbol',
  };
  const kind = kindMap[prefix] || 'symbol';

  return (
    <button
      className="symbol-link"
      style={{ color }}
      onClick={() => { clearSearch(); selectPage(kind, id); }}
      title={label || symbol}
    >
      {label || symbol}
    </button>
  );
}
