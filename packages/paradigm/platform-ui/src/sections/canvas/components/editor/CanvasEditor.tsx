import React, { useCallback, useEffect, useRef } from 'react';
import { Editor } from '@craftjs/core';
import { CanvasFrame } from './CanvasFrame';
import { RenderNode } from './RenderNode';
import { CanvasToolbar } from '../toolbar/CanvasToolbar';
import { ComponentPalette } from '../panels/ComponentPalette';
import { PropertyPanel } from '../panels/PropertyPanel';
import { ContainerComponent } from '../user/ContainerComponent';
import { TextComponent } from '../user/TextComponent';
import { ButtonComponent } from '../user/ButtonComponent';
import { ImageComponent } from '../user/ImageComponent';
import { SpacerComponent } from '../user/SpacerComponent';
import { useCanvasStore } from '../../store/canvasStore';
import { useCanvasSync } from '../../hooks/useCanvasData';

const resolver = {
  ContainerComponent,
  TextComponent,
  ButtonComponent,
  ImageComponent,
  SpacerComponent,
};

export function CanvasEditor() {
  const mode = useCanvasStore((s) => s.mode);

  return (
    <Editor
      resolver={resolver}
      onRender={RenderNode}
      enabled={mode === 'design'}
    >
      <CanvasEditorInner />
    </Editor>
  );
}

function CanvasEditorInner() {
  // This hook syncs editor state with the Zustand store
  useCanvasSync();

  return (
    <div className="canvas-editor">
      <ComponentPalette />
      <div className="canvas-editor__center">
        <CanvasToolbar />
        <CanvasFrame />
      </div>
      <PropertyPanel />
    </div>
  );
}
