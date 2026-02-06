/**
 * Autocomplete dropdown for command input
 */

import type { SymbolEntry, SymbolType } from '../../types';

interface AutocompleteProps {
  suggestions: SymbolEntry[];
  selectedIndex: number;
  onSelect: (entry: SymbolEntry) => void;
  onHover: (index: number) => void;
}

// v2 symbol types
const TYPE_COLORS: Record<SymbolType, string> = {
  component: 'var(--color-component)',
  flow: 'var(--color-flow)',
  gate: 'var(--color-gate)',
  signal: 'var(--color-signal)',
  aspect: 'var(--color-aspect)',
};

export function Autocomplete({ suggestions, selectedIndex, onSelect, onHover }: AutocompleteProps) {
  return (
    <div className="autocomplete-dropdown">
      {suggestions.map((entry, index) => (
        <div
          key={entry.id}
          className={`autocomplete-item ${index === selectedIndex ? 'selected' : ''}`}
          onClick={() => onSelect(entry)}
          onMouseEnter={() => onHover(index)}
        >
          <span
            className="autocomplete-item-symbol"
            style={{ color: TYPE_COLORS[entry.type] }}
          >
            {entry.symbol}
          </span>
          {entry.description && (
            <span className="autocomplete-item-desc">{entry.description}</span>
          )}
        </div>
      ))}
    </div>
  );
}
