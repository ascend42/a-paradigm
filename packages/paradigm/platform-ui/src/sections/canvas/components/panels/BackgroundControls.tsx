import React from 'react';
import { useNode } from '@craftjs/core';

export function BackgroundControls() {
  const { actions: { setProp }, props } = useNode((node) => ({
    props: node.data.props,
  }));

  const p = props as Record<string, unknown>;

  if (!('background' in p)) return null;

  return (
    <div className="prop-section">
      <div className="prop-section__title">Background</div>

      <label className="prop-field">
        <span className="prop-field__label">Color</span>
        <div className="prop-field__color-row">
          <input
            className="prop-field__color-swatch"
            type="color"
            value={String(p.background || '#ffffff').startsWith('#') ? String(p.background) : '#ffffff'}
            onChange={(e) => setProp((pr: Record<string, unknown>) => { pr.background = e.target.value; })}
          />
          <input
            className="prop-field__input"
            type="text"
            value={String(p.background || 'transparent')}
            onChange={(e) => setProp((pr: Record<string, unknown>) => { pr.background = e.target.value; })}
          />
        </div>
      </label>

      {'opacity' in p && (
        <label className="prop-field">
          <span className="prop-field__label">Opacity</span>
          <input
            className="prop-field__input"
            type="number"
            step={0.05}
            min={0}
            max={1}
            value={Number(p.opacity ?? 1)}
            onChange={(e) => setProp((pr: Record<string, unknown>) => { pr.opacity = parseFloat(e.target.value); })}
          />
        </label>
      )}
    </div>
  );
}
