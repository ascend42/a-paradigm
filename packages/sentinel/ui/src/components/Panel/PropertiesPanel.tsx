/**
 * Properties panel - shows details of selected node
 */

import { useState, useEffect, useCallback } from 'react';
import { useNodesStore } from '../../store/nodesStore';
import type { SymbolType } from '../../types';
import { parseSymbol } from '../../types';

const TYPE_LABELS: Record<SymbolType, string> = {
  feature: 'Feature',
  component: 'Component',
  flow: 'Flow',
  state: 'State',
  aspect: 'Aspect',
  portal: 'Gate',
  signal: 'Signal',
  idea: 'Idea',
};

const SOURCE_LABELS: Record<string, string> = {
  purpose: 'Purpose',
  portal: 'Gate',
  premise: 'Dream',
};

export function PropertiesPanel() {
  const { getSelectedNode, selectNode, addTag, removeTag, updateNode } = useNodesStore();
  const node = getSelectedNode();

  // Local state for editing
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{
    symbol?: string;
    type?: SymbolType;
    description?: string;
  }>({});

  // Reset edit state when node changes
  useEffect(() => {
    setEditingField(null);
    setEditValues({});
  }, [node?.id]);

  if (!node) return null;

  // Handle field edit start
  const startEdit = useCallback((field: string, currentValue: unknown) => {
    setEditingField(field);
    setEditValues({ [field]: currentValue });
  }, []);

  // Save to API
  const saveToApi = useCallback(async (nodeId: string, updates: { description?: string; tags?: string[] }) => {
    try {
      const response = await fetch(`/api/symbols/${nodeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        const data = await response.json();
        console.error('Failed to save:', data.error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Failed to save:', error);
      return false;
    }
  }, []);

  // Handle field save
  const saveField = useCallback(async (field: string) => {
    if (!node) return;

    const value = editValues[field as keyof typeof editValues];
    if (value === undefined) {
      setEditingField(null);
      return;
    }

    // Validate symbol format
    if (field === 'symbol' && typeof value === 'string') {
      const parsed = parseSymbol(value);
      if (!parsed) {
        alert('Invalid symbol format. Must start with @, #, $, %, ~, ^, !, or ?');
        return;
      }
    }

    // Update node locally
    updateNode(node.id, { [field]: value });

    // Save to API for persistent fields (description, tags)
    if (field === 'description') {
      await saveToApi(node.id, { description: value as string });
    }

    setEditingField(null);
    setEditValues({});
  }, [node, editValues, updateNode, saveToApi]);

  // Handle cancel edit
  const cancelEdit = useCallback(() => {
    setEditingField(null);
    setEditValues({});
  }, []);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((e: React.KeyboardEvent, field: string) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveField(field);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  }, [saveField, cancelEdit]);

  return (
    <aside className="properties-panel">
      <header className="properties-header">
        {editingField === 'symbol' ? (
          <input
            type="text"
            className="properties-title-input"
            value={editValues.symbol ?? node.symbol}
            onChange={(e) => setEditValues({ symbol: e.target.value })}
            onBlur={() => saveField('symbol')}
            onKeyDown={(e) => handleKeyDown(e, 'symbol')}
            autoFocus
          />
        ) : (
          <h2
            className="properties-title properties-title-editable"
            onClick={() => startEdit('symbol', node.symbol)}
            title="Click to edit"
          >
            {node.symbol}
          </h2>
        )}
        <button
          className="properties-close"
          onClick={() => selectNode(null)}
          aria-label="Close panel"
        >
          &times;
        </button>
      </header>

      <div className="properties-content">
        {/* Basic Info */}
        <section className="properties-section">
          <h3 className="properties-section-title">Details</h3>

          <div className="properties-field">
            <div className="properties-field-label">Type</div>
            {editingField === 'type' ? (
              <select
                className="properties-field-input"
                value={editValues.type ?? node.type}
                onChange={(e) => {
                  const newType = e.target.value as SymbolType;
                  setEditValues({ type: newType });
                  updateNode(node.id, { type: newType });
                  setEditingField(null);
                }}
                onBlur={() => setEditingField(null)}
                autoFocus
              >
                {(Object.keys(TYPE_LABELS) as SymbolType[]).map((type) => (
                  <option key={type} value={type}>
                    {TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            ) : (
              <div
                className="properties-field-value properties-field-value-editable"
                onClick={() => startEdit('type', node.type)}
                title="Click to edit"
              >
                {TYPE_LABELS[node.type]}
              </div>
            )}
          </div>

          <div className="properties-field">
            <div className="properties-field-label">Source</div>
            <div className="properties-field-value">{SOURCE_LABELS[node.source]}</div>
          </div>

          <div className="properties-field">
            <div className="properties-field-label">Description</div>
            {editingField === 'description' ? (
              <textarea
                className="properties-field-textarea"
                value={editValues.description ?? node.description ?? ''}
                onChange={(e) => setEditValues({ description: e.target.value })}
                onBlur={() => saveField('description')}
                onKeyDown={(e) => handleKeyDown(e, 'description')}
                placeholder="Enter description..."
                rows={3}
                autoFocus
              />
            ) : (
              <div
                className="properties-field-value properties-field-value-editable"
                onClick={() => startEdit('description', node.description ?? '')}
                title="Click to edit"
              >
                {node.description || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No description (click to add)</span>}
              </div>
            )}
          </div>

          <div className="properties-field">
            <div className="properties-field-label">File</div>
            <a href="#" className="properties-source-link">
              {node.filePath}
              <span>&nearr;</span>
            </a>
          </div>
        </section>

        {/* Tags */}
        <section className="properties-section">
          <h3 className="properties-section-title">Tags</h3>
          <div className="properties-tags">
            {(node.tags || []).map((tag: string) => (
              <span
                key={tag}
                className="properties-tag"
                onClick={async () => {
                  removeTag(node.id, tag);
                  // Save to API
                  const newTags = (node.tags || []).filter((t: string) => t !== tag);
                  await saveToApi(node.id, { tags: newTags });
                }}
                title="Click to remove"
                style={{ cursor: 'pointer' }}
              >
                {tag} &times;
              </span>
            ))}
            <button
              className="properties-tag"
              style={{ background: 'transparent', border: '1px dashed var(--input-border)' }}
              onClick={async () => {
                const tag = prompt('Enter tag name:');
                if (tag) {
                  addTag(node.id, tag);
                  // Save to API
                  const newTags = [...(node.tags || []), tag];
                  await saveToApi(node.id, { tags: newTags });
                }
              }}
            >
              + Add
            </button>
          </div>
        </section>

        {/* References */}
        {(node.references.length > 0 || node.referencedBy.length > 0) && (
          <section className="properties-section">
            <h3 className="properties-section-title">References</h3>

            {node.references.length > 0 && (
              <div className="properties-field">
                <div className="properties-field-label">References ({node.references.length})</div>
                <div className="properties-field-value properties-field-value--mono">
                  {node.references.join(', ')}
                </div>
              </div>
            )}

            {node.referencedBy.length > 0 && (
              <div className="properties-field">
                <div className="properties-field-label">Referenced by ({node.referencedBy.length})</div>
                <div className="properties-field-value properties-field-value--mono">
                  {node.referencedBy.join(', ')}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Position */}
        {node.position && (
          <section className="properties-section">
            <h3 className="properties-section-title">Position</h3>
            <div className="properties-field">
              <div className="properties-field-value properties-field-value--mono">
                x: {Math.round(node.position.x)}, y: {Math.round(node.position.y)}
              </div>
            </div>
          </section>
        )}

        {/* Timestamps */}
        {(node.created || node.modified) && (
          <section className="properties-section">
            <h3 className="properties-section-title">Timeline</h3>

            {node.created && (
              <div className="properties-field">
                <div className="properties-field-label">Created</div>
                <div className="properties-field-value">
                  {new Date(node.created).toLocaleString()}
                </div>
              </div>
            )}

            {node.modified && (
              <div className="properties-field">
                <div className="properties-field-label">Modified</div>
                <div className="properties-field-value">
                  {new Date(node.modified).toLocaleString()}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Raw Data */}
        <section className="properties-section">
          <h3 className="properties-section-title">Raw Data</h3>
          <pre
            style={{
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
              background: 'var(--input-bg)',
              padding: '12px',
              borderRadius: '8px',
              overflow: 'auto',
              maxHeight: '200px',
            }}
          >
            {JSON.stringify(node.data, null, 2)}
          </pre>
        </section>
      </div>
    </aside>
  );
}
