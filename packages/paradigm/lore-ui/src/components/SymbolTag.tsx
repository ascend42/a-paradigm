import React from 'react';

const SYMBOL_TYPE_MAP: Record<string, string> = {
  '#': 'component',
  '^': 'gate',
  '$': 'flow',
  '!': 'signal',
  '~': 'aspect',
};

export function SymbolTag({ symbol }: { symbol: string }) {
  const prefix = symbol.charAt(0);
  const type = SYMBOL_TYPE_MAP[prefix] || 'component';

  return (
    <span className={`symbol-tag ${type}`}>{symbol}</span>
  );
}
