import React from 'react';
import { SymbolLink } from './SymbolLink';

interface Gate { symbol: string; description?: string }

export function GateChain({ gates }: { gates: Gate[] }) {
  if (gates.length === 0) return <span className="gate-chain--empty">none</span>;
  return (
    <span className="gate-chain">
      {gates.map((g, i) => (
        <React.Fragment key={g.symbol}>
          {i > 0 && <span className="gate-chain__separator"> → </span>}
          <SymbolLink symbol={g.symbol} label={g.description || g.symbol} />
        </React.Fragment>
      ))}
    </span>
  );
}
