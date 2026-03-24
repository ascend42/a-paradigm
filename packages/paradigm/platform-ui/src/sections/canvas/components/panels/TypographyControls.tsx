import React from 'react';
import { useNode } from '@craftjs/core';

export function TypographyControls() {
  const { actions: { setProp }, props } = useNode((node) => ({
    props: node.data.props,
  }));

  const p = props as Record<string, unknown>;
  const hasTypography = 'fontSize' in p || 'fontWeight' in p || 'content' in p || 'label' in p;

  if (!hasTypography) return null;

  return (
    <div className="prop-section">
      <div className="prop-section__title">Typography</div>

      {'content' in p && (
        <label className="prop-field">
          <span className="prop-field__label">Content</span>
          <input
            className="prop-field__input"
            type="text"
            value={String(p.content || '')}
            onChange={(e) => setProp((pr: Record<string, unknown>) => { pr.content = e.target.value; })}
          />
        </label>
      )}

      {'label' in p && (
        <label className="prop-field">
          <span className="prop-field__label">Label</span>
          <input
            className="prop-field__input"
            type="text"
            value={String(p.label || '')}
            onChange={(e) => setProp((pr: Record<string, unknown>) => { pr.label = e.target.value; })}
          />
        </label>
      )}

      {'fontSize' in p && (
        <label className="prop-field">
          <span className="prop-field__label">Font Size</span>
          <input
            className="prop-field__input"
            type="number"
            min={1}
            max={200}
            value={Number(p.fontSize || 16)}
            onChange={(e) => setProp((pr: Record<string, unknown>) => { pr.fontSize = parseInt(e.target.value) || 16; })}
          />
        </label>
      )}

      {'fontWeight' in p && (
        <label className="prop-field">
          <span className="prop-field__label">Font Weight</span>
          <select
            className="prop-field__input"
            value={String(p.fontWeight || '400')}
            onChange={(e) => setProp((pr: Record<string, unknown>) => { pr.fontWeight = e.target.value; })}
          >
            <option value="100">Thin</option>
            <option value="300">Light</option>
            <option value="400">Regular</option>
            <option value="500">Medium</option>
            <option value="600">Semibold</option>
            <option value="700">Bold</option>
            <option value="900">Black</option>
          </select>
        </label>
      )}

      {'fontFamily' in p && (
        <label className="prop-field">
          <span className="prop-field__label">Font Family</span>
          <input
            className="prop-field__input"
            type="text"
            value={String(p.fontFamily || 'inherit')}
            onChange={(e) => setProp((pr: Record<string, unknown>) => { pr.fontFamily = e.target.value; })}
          />
        </label>
      )}

      {'color' in p && !('background' in p) && (
        <label className="prop-field">
          <span className="prop-field__label">Color</span>
          <div className="prop-field__color-row">
            <input
              className="prop-field__color-swatch"
              type="color"
              value={String(p.color || '#000000')}
              onChange={(e) => setProp((pr: Record<string, unknown>) => { pr.color = e.target.value; })}
            />
            <input
              className="prop-field__input"
              type="text"
              value={String(p.color || '#000000')}
              onChange={(e) => setProp((pr: Record<string, unknown>) => { pr.color = e.target.value; })}
            />
          </div>
        </label>
      )}

      {'textAlign' in p && (
        <label className="prop-field">
          <span className="prop-field__label">Text Align</span>
          <select
            className="prop-field__input"
            value={String(p.textAlign || 'left')}
            onChange={(e) => setProp((pr: Record<string, unknown>) => { pr.textAlign = e.target.value; })}
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
            <option value="justify">Justify</option>
          </select>
        </label>
      )}

      {'lineHeight' in p && (
        <label className="prop-field">
          <span className="prop-field__label">Line Height</span>
          <input
            className="prop-field__input"
            type="number"
            step={0.1}
            min={0.5}
            max={4}
            value={Number(p.lineHeight || 1.5)}
            onChange={(e) => setProp((pr: Record<string, unknown>) => { pr.lineHeight = parseFloat(e.target.value) || 1.5; })}
          />
        </label>
      )}
    </div>
  );
}
