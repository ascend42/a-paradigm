import React from 'react';
import { useEditor } from '@craftjs/core';
import { LayoutControls } from './LayoutControls';
import { SpacingControls } from './SpacingControls';
import { SizeControls } from './SizeControls';
import { TypographyControls } from './TypographyControls';
import { BackgroundControls } from './BackgroundControls';
import { BorderControls } from './BorderControls';

export function PropertyPanel() {
  const { selected, selectedNodeId } = useEditor((state) => {
    const [currentNodeId] = state.events.selected;
    return {
      selectedNodeId: currentNodeId,
      selected: currentNodeId != null,
    };
  });

  if (!selected || !selectedNodeId) {
    return (
      <div className="property-panel">
        <div className="property-panel__empty">
          Select an element to edit its properties
        </div>
      </div>
    );
  }

  return (
    <div className="property-panel">
      <div className="property-panel__header">Properties</div>
      <div className="property-panel__content">
        <SelectedNodeControls />
      </div>
    </div>
  );
}

/**
 * Inner component that renders controls for the selected node.
 * Separated so that useNode() context works correctly.
 */
function SelectedNodeControls() {
  return (
    <>
      <LayoutControls />
      <SpacingControls />
      <SizeControls />
      <TypographyControls />
      <BackgroundControls />
      <BorderControls />
    </>
  );
}
