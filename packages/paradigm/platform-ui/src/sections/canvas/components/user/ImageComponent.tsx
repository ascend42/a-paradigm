import React from 'react';
import { useNode, type UserComponent } from '@craftjs/core';
import { IMAGE_DEFAULTS, type ImageProps } from '../../types';

export const ImageComponent: UserComponent<Partial<ImageProps>> = ({
  src = IMAGE_DEFAULTS.src,
  alt = IMAGE_DEFAULTS.alt,
  objectFit = IMAGE_DEFAULTS.objectFit,
  width = IMAGE_DEFAULTS.width,
  height = IMAGE_DEFAULTS.height,
  borderRadius = IMAGE_DEFAULTS.borderRadius,
}) => {
  const { connectors: { connect, drag } } = useNode();

  return src ? (
    <img
      ref={(ref) => { if (ref) connect(drag(ref)); }}
      src={src}
      alt={alt}
      style={{
        objectFit,
        width,
        height,
        borderRadius,
        display: 'block',
      }}
    />
  ) : (
    <div
      ref={(ref) => { if (ref) connect(drag(ref)); }}
      style={{
        width,
        height,
        borderRadius,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--p-bg-tertiary)',
        color: 'var(--p-text-muted)',
        fontSize: 13,
        border: '1px dashed var(--p-border)',
      }}
    >
      Image placeholder
    </div>
  );
};

ImageComponent.craft = {
  displayName: 'Image',
  props: { ...IMAGE_DEFAULTS },
  rules: {
    canDrag: () => true,
    canMoveIn: () => false,
  },
};
