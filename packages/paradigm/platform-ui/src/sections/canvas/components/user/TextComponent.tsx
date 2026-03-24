import React, { useState, useCallback } from 'react';
import { useNode, type UserComponent } from '@craftjs/core';
import { TEXT_DEFAULTS, type TextProps } from '../../types';

export const TextComponent: UserComponent<Partial<TextProps>> = ({
  content = TEXT_DEFAULTS.content,
  fontSize = TEXT_DEFAULTS.fontSize,
  fontWeight = TEXT_DEFAULTS.fontWeight,
  fontFamily = TEXT_DEFAULTS.fontFamily,
  color = TEXT_DEFAULTS.color,
  textAlign = TEXT_DEFAULTS.textAlign,
  lineHeight = TEXT_DEFAULTS.lineHeight,
  letterSpacing = TEXT_DEFAULTS.letterSpacing,
  padding = TEXT_DEFAULTS.padding,
  margin = TEXT_DEFAULTS.margin,
}) => {
  const { connectors: { connect, drag }, actions: { setProp }, isEditing } = useNode((node) => ({
    isEditing: node.events.selected,
  }));

  const [editable, setEditable] = useState(false);

  const handleDoubleClick = useCallback(() => {
    setEditable(true);
  }, []);

  const handleBlur = useCallback((e: React.FocusEvent<HTMLParagraphElement>) => {
    setEditable(false);
    setProp((props: Record<string, unknown>) => {
      props.content = e.currentTarget.textContent || '';
    });
  }, [setProp]);

  return (
    <p
      ref={(ref) => { if (ref) connect(drag(ref)); }}
      contentEditable={editable}
      suppressContentEditableWarning
      onDoubleClick={handleDoubleClick}
      onBlur={handleBlur}
      style={{
        fontSize,
        fontWeight,
        fontFamily,
        color,
        textAlign,
        lineHeight,
        letterSpacing,
        padding,
        margin,
        outline: 'none',
        cursor: editable ? 'text' : 'default',
        minWidth: 20,
      }}
    >
      {content}
    </p>
  );
};

TextComponent.craft = {
  displayName: 'Text',
  props: { ...TEXT_DEFAULTS },
  rules: {
    canDrag: () => true,
    canMoveIn: () => false,
  },
};
