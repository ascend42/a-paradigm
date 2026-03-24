import React from 'react';
import { useNode } from '@craftjs/core';

export function BorderControls() {
  const { actions: { setProp }, props } = useNode((node) => ({
    props: node.data.props,
  }));

  const p = props as Record<string, unknown>;

  if (!('borderWidth' in p) && !('borderRadius' in p)) return null;

  return (
    <div className="prop-section">
      <div className="prop-section__title">Border</div>

      {'borderWidth' in p && (
        <label className="prop-field">
          <span className="prop-field__label">Width</span>
          <input
            className="prop-field__input"
            type="number"
            min={0}
            max={20}
            value={Number(p.borderWidth || 0)}
            onChange={(e) => setProp((pr: Record<string, unknown>) => { pr.borderWidth = parseInt(e.target.value) || 0; })}
          />
        </label>
      )}

      {'borderStyle' in p && Number(p.borderWidth || 0) > 0 && (
        <label className="prop-field">
          <span className="prop-field__label">Style</span>
          <select
            className="prop-field__input"
            value={String(p.borderStyle || 'solid')}
            onChange={(e) => setProp((pr: Record<string, unknown>) => { pr.borderStyle = e.target.value; })}
          >
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
          </select>
        </label>
      )}

      {'borderColor' in p && Number(p.borderWidth || 0) > 0 && (
        <label className="prop-field">
          <span className="prop-field__label">Color</span>
          <div className="prop-field__color-row">
            <input
              className="prop-field__color-swatch"
              type="color"
              value={String(p.borderColor || '#d1d5db')}
              onChange={(e) => setProp((pr: Record<string, unknown>) => { pr.borderColor = e.target.value; })}
            />
            <input
              className="prop-field__input"
              type="text"
              value={String(p.borderColor || '#d1d5db')}
              onChange={(e) => setProp((pr: Record<string, unknown>) => { pr.borderColor = e.target.value; })}
            />
          </div>
        </label>
      )}

      {'borderRadius' in p && (
        <label className="prop-field">
          <span className="prop-field__label">Radius</span>
          <input
            className="prop-field__input"
            type="number"
            min={0}
            max={100}
            value={Number(p.borderRadius || 0)}
            onChange={(e) => setProp((pr: Record<string, unknown>) => { pr.borderRadius = parseInt(e.target.value) || 0; })}
          />
        </label>
      )}
    </div>
  );
}
