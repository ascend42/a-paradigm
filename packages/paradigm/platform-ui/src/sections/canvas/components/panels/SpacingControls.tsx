import React from 'react';
import { useNode } from '@craftjs/core';

function QuadInput({
  label,
  prefix,
  props,
  setProp,
}: {
  label: string;
  prefix: string;
  props: Record<string, unknown>;
  setProp: (cb: (props: Record<string, unknown>) => void) => void;
}) {
  const sides = ['Top', 'Right', 'Bottom', 'Left'] as const;

  return (
    <div className="prop-quad">
      <span className="prop-quad__label">{label}</span>
      <div className="prop-quad__inputs">
        {sides.map((side) => {
          const key = `${prefix}${side}`;
          return (
            <input
              key={key}
              className="prop-quad__input"
              type="number"
              min={0}
              value={Number(props[key] || 0)}
              title={side}
              placeholder={side[0]}
              onChange={(e) => setProp((p) => { p[key] = parseInt(e.target.value) || 0; })}
            />
          );
        })}
      </div>
    </div>
  );
}

export function SpacingControls() {
  const { actions: { setProp }, props } = useNode((node) => ({
    props: node.data.props,
  }));

  const p = props as Record<string, unknown>;
  const hasPadding = 'paddingTop' in p || 'padding' in p;
  const hasMargin = 'marginTop' in p || 'margin' in p;

  if (!hasPadding && !hasMargin) return null;

  return (
    <div className="prop-section">
      <div className="prop-section__title">Spacing</div>
      {hasPadding && (
        <QuadInput label="Padding" prefix="padding" props={p} setProp={setProp} />
      )}
      {hasMargin && (
        <QuadInput label="Margin" prefix="margin" props={p} setProp={setProp} />
      )}
    </div>
  );
}
