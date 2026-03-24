import React, { useState, useCallback } from 'react';
import { useNode, type UserComponent } from '@craftjs/core';
import { BUTTON_DEFAULTS, type ButtonProps } from '../../types';

export const ButtonComponent: UserComponent<Partial<ButtonProps>> = ({
  label = BUTTON_DEFAULTS.label,
  fontSize = BUTTON_DEFAULTS.fontSize,
  fontWeight = BUTTON_DEFAULTS.fontWeight,
  color = BUTTON_DEFAULTS.color,
  textAlign = BUTTON_DEFAULTS.textAlign,
  background = BUTTON_DEFAULTS.background,
  paddingTop = BUTTON_DEFAULTS.paddingTop,
  paddingRight = BUTTON_DEFAULTS.paddingRight,
  paddingBottom = BUTTON_DEFAULTS.paddingBottom,
  paddingLeft = BUTTON_DEFAULTS.paddingLeft,
  borderWidth = BUTTON_DEFAULTS.borderWidth,
  borderStyle = BUTTON_DEFAULTS.borderStyle,
  borderColor = BUTTON_DEFAULTS.borderColor,
  borderRadius = BUTTON_DEFAULTS.borderRadius,
  width = BUTTON_DEFAULTS.width,
  cursor = BUTTON_DEFAULTS.cursor,
}) => {
  const { connectors: { connect, drag }, actions: { setProp } } = useNode();
  const [editable, setEditable] = useState(false);

  const handleDoubleClick = useCallback(() => {
    setEditable(true);
  }, []);

  const handleBlur = useCallback((e: React.FocusEvent<HTMLButtonElement>) => {
    setEditable(false);
    setProp((props: Record<string, unknown>) => {
      props.label = e.currentTarget.textContent || '';
    });
  }, [setProp]);

  return (
    <button
      ref={(ref) => { if (ref) connect(drag(ref)); }}
      contentEditable={editable}
      suppressContentEditableWarning
      onDoubleClick={handleDoubleClick}
      onBlur={handleBlur}
      style={{
        fontSize,
        fontWeight,
        color,
        textAlign,
        background,
        paddingTop,
        paddingRight,
        paddingBottom,
        paddingLeft,
        borderWidth: borderWidth > 0 ? borderWidth : 0,
        borderStyle: borderWidth > 0 ? borderStyle : 'none',
        borderColor: borderWidth > 0 ? borderColor : 'transparent',
        borderRadius,
        width,
        cursor: editable ? 'text' : cursor,
        outline: 'none',
        fontFamily: 'inherit',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {label}
    </button>
  );
};

ButtonComponent.craft = {
  displayName: 'Button',
  props: { ...BUTTON_DEFAULTS },
  rules: {
    canDrag: () => true,
    canMoveIn: () => false,
  },
};
