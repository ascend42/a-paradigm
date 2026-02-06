/**
 * Bottom command input for creating nodes and searching
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useSymbolStore } from '../../store/symbolStore';
import { useNodesStore } from '../../store/nodesStore';
import { parseSymbol, type SymbolEntry } from '../../types';
import { Autocomplete } from './Autocomplete';

export function CommandInput() {
  const [value, setValue] = useState('');
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const { getAutocomplete } = useSymbolStore();
  const { addNode, selectNode } = useNodesStore();

  const suggestions = value.length > 0 ? getAutocomplete(value) : [];

  // Handle input change
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setValue(newValue);
    setShowAutocomplete(newValue.length > 0);
    setSelectedIndex(0);
  }, []);

  // Handle submit
  const handleSubmit = useCallback(() => {
    if (!value.trim()) return;

    // Check if it's a known symbol
    if (suggestions.length > 0 && selectedIndex < suggestions.length) {
      // Select existing symbol
      const selected = suggestions[selectedIndex];
      selectNode(selected.id);
      setValue('');
      setShowAutocomplete(false);
      return;
    }

    // Try to create a new node
    const parts = value.trim().split(/\s+/);
    const symbolStr = parts[0];
    const parsed = parseSymbol(symbolStr);
    if (parsed) {
      // Extract content after the symbol name
      const symbol = symbolStr;
      const content = parts.slice(1).join(' ');

      const newNode: SymbolEntry = {
        id: `premise-${Date.now()}`,
        symbol,
        type: parsed.type,
        source: 'premise',
        filePath: '.premise',
        data: { content },
        description: content || undefined,
        references: [],
        referencedBy: [],
        position: {
          x: 200 + Math.random() * 200,
          y: 200 + Math.random() * 200,
        },
        tags: [],
        created: new Date().toISOString(),
      };

      addNode(newNode);
      selectNode(newNode.id);
      setValue('');
      setShowAutocomplete(false);
    }
  }, [value, suggestions, selectedIndex, selectNode, addNode]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Escape') {
        setShowAutocomplete(false);
        inputRef.current?.blur();
      } else if (e.key === 'Tab' && suggestions.length > 0) {
        e.preventDefault();
        const selected = suggestions[selectedIndex];
        if (selected) {
          setValue(selected.symbol + ' ');
          setSelectedIndex(0);
        }
      }
    },
    [handleSubmit, suggestions, selectedIndex]
  );

  // Handle autocomplete selection
  const handleSelectSuggestion = useCallback(
    (entry: SymbolEntry) => {
      selectNode(entry.id);
      setValue('');
      setShowAutocomplete(false);
    },
    [selectNode]
  );

  // Global keyboard shortcut (/ to focus)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  return (
    <div className="command-input-container">
      {showAutocomplete && suggestions.length > 0 && (
        <Autocomplete
          suggestions={suggestions}
          selectedIndex={selectedIndex}
          onSelect={handleSelectSuggestion}
          onHover={setSelectedIndex}
        />
      )}
      <div className="command-input">
        <span className="command-input-prefix">&gt;</span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowAutocomplete(value.length > 0)}
          onBlur={() => setTimeout(() => setShowAutocomplete(false), 200)}
          placeholder="Type @ # ^ ! ? to create nodes, or search..."
        />
        <span className="command-input-hint">Press / to focus</span>
      </div>
    </div>
  );
}
