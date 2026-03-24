import React from 'react';
import { Frame, Element } from '@craftjs/core';
import { ContainerComponent } from '../user/ContainerComponent';

export function CanvasFrame() {
  return (
    <div className="canvas-frame-wrapper">
      <div className="canvas-frame">
        <Frame>
          <Element
            is={ContainerComponent}
            canvas
            display="flex"
            flexDirection="column"
            padding={24}
            minHeight="600px"
            width="100%"
            background="#ffffff"
          />
        </Frame>
      </div>
    </div>
  );
}
