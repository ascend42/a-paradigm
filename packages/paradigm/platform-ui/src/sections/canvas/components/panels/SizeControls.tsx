import React from 'react';
import { useNode } from '@craftjs/core';

export function SizeControls() {
  const { actions: { setProp }, props } = useNode((node) => ({
    props: node.data.props,
  }));

  const p = props as Record<string, unknown>;
  const hasSize = 'width' in p || 'height' in p;

  if (!hasSize) return null;

  return (
    <div className="prop-section">
      <div className="prop-section__title">Size</div>

      {'width' in p && (
        <label className="prop-field">
          <span className="prop-field__label">Width</span>
          <input
            className="prop-field__input"
            type="text"
            value={String(p.width || 'auto')}
            onChange={(e) => setProp((pr: Record<string, unknown>) => { pr.width = e.target.value; })}
          />
        </label>
      )}

      {'height' in p && (
        <label className="prop-field">
          <span className="prop-field__label">Height</span>
          <input
            className="prop-field__input"
            type="text"
            value={String(p.height || 'auto')}
            onChange={(e) => setProp((pr: Record<string, unknown>) => { pr.height = e.target.value; })}
          />
        </label>
      )}

      {'minHeight' in p && (
        <label className="prop-field">
          <span className="prop-field__label">Min Height</span>
          <input
            className="prop-field__input"
            type="text"
            value={String(p.minHeight || '')}
            onChange={(e) => setProp((pr: Record<string, unknown>) => { pr.minHeight = e.target.value; })}
          />
        </label>
      )}

      {'overflow' in p && (
        <label className="prop-field">
          <span className="prop-field__label">Overflow</span>
          <select
            className="prop-field__input"
            value={String(p.overflow || 'visible')}
            onChange={(e) => setProp((pr: Record<string, unknown>) => { pr.overflow = e.target.value; })}
          >
            <option value="visible">Visible</option>
            <option value="hidden">Hidden</option>
            <option value="scroll">Scroll</option>
            <option value="auto">Auto</option>
          </select>
        </label>
      )}
    </div>
  );
}
