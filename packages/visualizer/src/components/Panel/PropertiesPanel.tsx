/**
 * Properties panel - shows details of selected node
 */

import { useNodesStore } from '../../store/nodesStore';
import type { SymbolType } from '../../types';

const TYPE_LABELS: Record<SymbolType, string> = {
  feature: 'Feature',
  component: 'Component',
  flow: 'Flow',
  state: 'State',
  aspect: 'Aspect',
  gate: 'Gate',
  signal: 'Signal',
  idea: 'Idea',
};

const SOURCE_LABELS: Record<string, string> = {
  purpose: 'Purpose',
  gate: 'Gate',
  dream: 'Dream',
};

export function PropertiesPanel() {
  const { getSelectedNode, selectNode, addTag, removeTag } = useNodesStore();
  const node = getSelectedNode();

  if (!node) return null;

  return (
    <aside className="properties-panel">
      <header className="properties-header">
        <h2 className="properties-title">{node.symbol}</h2>
        <button
          className="properties-close"
          onClick={() => selectNode(null)}
          aria-label="Close panel"
        >
          ✕
        </button>
      </header>

      <div className="properties-content">
        {/* Basic Info */}
        <section className="properties-section">
          <h3 className="properties-section-title">Details</h3>
          
          <div className="properties-field">
            <div className="properties-field-label">Type</div>
            <div className="properties-field-value">{TYPE_LABELS[node.type]}</div>
          </div>

          <div className="properties-field">
            <div className="properties-field-label">Source</div>
            <div className="properties-field-value">{SOURCE_LABELS[node.source]}</div>
          </div>

          {node.description && (
            <div className="properties-field">
              <div className="properties-field-label">Description</div>
              <div className="properties-field-value">{node.description}</div>
            </div>
          )}

          <div className="properties-field">
            <div className="properties-field-label">File</div>
            <a href="#" className="properties-source-link">
              {node.filePath}
              <span>↗</span>
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
                onClick={() => removeTag(node.id, tag)}
                title="Click to remove"
                style={{ cursor: 'pointer' }}
              >
                {tag} ✕
              </span>
            ))}
            <button
              className="properties-tag"
              style={{ background: 'transparent', border: '1px dashed var(--input-border)' }}
              onClick={() => {
                const tag = prompt('Enter tag name:');
                if (tag) addTag(node.id, tag);
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
