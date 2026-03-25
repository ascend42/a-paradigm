import React from 'react';
import { useNode, type UserComponent } from '@craftjs/core';
import { SPACER_DEFAULTS, type SpacerProps } from '../../types';

export const SpacerComponent: UserComponent<Partial<SpacerProps>> = ({
  width = SPACER_DEFAULTS.width,
  height = SPACER_DEFAULTS.height,
}) => {
  const { connectors: { connect, drag }, selected } = useNode((node) => ({
    selected: node.events.selected,
  }));

  return (
    <div
      ref={(ref) => { if (ref) connect(drag(ref)); }}
      style={{
        width,
        height,
        // Show dashed border in design mode when selected or hovered
        border: selected ? '1px dashed var(--p-border-active, #58a6ff)' : '1px dashed transparent',
        background: selected ? 'color-mix(in srgb, var(--p-border-active) 5%, transparent)' : 'transparent',
        transition: 'border-color 150ms ease, background 150ms ease',
      }}
    />
  );
};

SpacerComponent.craft = {
  displayName: 'Spacer',
  props: { ...SPACER_DEFAULTS },
  rules: {
    canDrag: () => true,
    canMoveIn: () => false,
  },
};
