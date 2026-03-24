import React from 'react';
import { useEditor, Element } from '@craftjs/core';
import { ContainerComponent } from '../user/ContainerComponent';
import { TextComponent } from '../user/TextComponent';
import { ButtonComponent } from '../user/ButtonComponent';
import { ImageComponent } from '../user/ImageComponent';
import { SpacerComponent } from '../user/SpacerComponent';

const PALETTE_ITEMS = [
  { name: 'Container', icon: '▦', element: <Element is={ContainerComponent} canvas /> },
  { name: 'Text', icon: 'T', element: <TextComponent /> },
  { name: 'Button', icon: '▮', element: <ButtonComponent /> },
  { name: 'Image', icon: '▨', element: <ImageComponent /> },
  { name: 'Spacer', icon: '⊟', element: <SpacerComponent /> },
];

export function ComponentPalette() {
  const { connectors } = useEditor();

  return (
    <div className="component-palette">
      <div className="component-palette__header">Components</div>
      <div className="component-palette__list">
        {PALETTE_ITEMS.map((item) => (
          <div
            key={item.name}
            ref={(ref) => { if (ref) connectors.create(ref, item.element); }}
            className="component-palette__item"
          >
            <span className="component-palette__icon">{item.icon}</span>
            <span className="component-palette__name">{item.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
