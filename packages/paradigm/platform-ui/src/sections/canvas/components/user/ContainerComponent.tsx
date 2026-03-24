import React from 'react';
import { useNode, type UserComponent } from '@craftjs/core';
import { CONTAINER_DEFAULTS, type ContainerProps } from '../../types';

export const ContainerComponent: UserComponent<Partial<ContainerProps>> = ({
  children,
  display = CONTAINER_DEFAULTS.display,
  flexDirection = CONTAINER_DEFAULTS.flexDirection,
  justifyContent = CONTAINER_DEFAULTS.justifyContent,
  alignItems = CONTAINER_DEFAULTS.alignItems,
  flexWrap = CONTAINER_DEFAULTS.flexWrap,
  gap = CONTAINER_DEFAULTS.gap,
  paddingTop = CONTAINER_DEFAULTS.paddingTop,
  paddingRight = CONTAINER_DEFAULTS.paddingRight,
  paddingBottom = CONTAINER_DEFAULTS.paddingBottom,
  paddingLeft = CONTAINER_DEFAULTS.paddingLeft,
  marginTop = CONTAINER_DEFAULTS.marginTop,
  marginRight = CONTAINER_DEFAULTS.marginRight,
  marginBottom = CONTAINER_DEFAULTS.marginBottom,
  marginLeft = CONTAINER_DEFAULTS.marginLeft,
  background = CONTAINER_DEFAULTS.background,
  borderWidth = CONTAINER_DEFAULTS.borderWidth,
  borderStyle = CONTAINER_DEFAULTS.borderStyle,
  borderColor = CONTAINER_DEFAULTS.borderColor,
  borderRadius = CONTAINER_DEFAULTS.borderRadius,
  width = CONTAINER_DEFAULTS.width,
  height = CONTAINER_DEFAULTS.height,
  minHeight = CONTAINER_DEFAULTS.minHeight,
  overflow = CONTAINER_DEFAULTS.overflow,
  opacity = CONTAINER_DEFAULTS.opacity,
  boxShadow = CONTAINER_DEFAULTS.boxShadow,
}) => {
  const { connectors: { connect, drag } } = useNode();

  return (
    <div
      ref={(ref) => { if (ref) connect(drag(ref)); }}
      style={{
        display,
        flexDirection,
        justifyContent,
        alignItems,
        flexWrap,
        gap,
        paddingTop,
        paddingRight,
        paddingBottom,
        paddingLeft,
        marginTop,
        marginRight,
        marginBottom,
        marginLeft,
        background,
        borderWidth: borderWidth > 0 ? borderWidth : undefined,
        borderStyle: borderWidth > 0 ? borderStyle : undefined,
        borderColor: borderWidth > 0 ? borderColor : undefined,
        borderRadius,
        width,
        height,
        minHeight,
        overflow,
        opacity,
        boxShadow: boxShadow !== 'none' ? boxShadow : undefined,
      }}
    >
      {children}
    </div>
  );
};

ContainerComponent.craft = {
  displayName: 'Container',
  props: { ...CONTAINER_DEFAULTS },
  rules: {
    canDrag: () => true,
    canMoveIn: () => true,
    canMoveOut: () => true,
  },
};
