import React from 'react';
import { useNode } from '@craftjs/core';

export function LayoutControls() {
  const { actions: { setProp }, props } = useNode((node) => ({
    props: node.data.props,
  }));

  if (!('display' in (props as Record<string, unknown>))) return null;

  const p = props as Record<string, unknown>;

  return (
    <div className="prop-section">
      <div className="prop-section__title">Layout</div>

      <label className="prop-field">
        <span className="prop-field__label">Display</span>
        <select
          className="prop-field__input"
          value={String(p.display || 'flex')}
          onChange={(e) => setProp((pr: Record<string, unknown>) => { pr.display = e.target.value; })}
        >
          <option value="flex">Flex</option>
          <option value="grid">Grid</option>
          <option value="block">Block</option>
        </select>
      </label>

      {p.display === 'flex' && (
        <>
          <label className="prop-field">
            <span className="prop-field__label">Direction</span>
            <select
              className="prop-field__input"
              value={String(p.flexDirection || 'column')}
              onChange={(e) => setProp((pr: Record<string, unknown>) => { pr.flexDirection = e.target.value; })}
            >
              <option value="row">Row</option>
              <option value="row-reverse">Row Reverse</option>
              <option value="column">Column</option>
              <option value="column-reverse">Column Reverse</option>
            </select>
          </label>

          <label className="prop-field">
            <span className="prop-field__label">Justify</span>
            <select
              className="prop-field__input"
              value={String(p.justifyContent || 'flex-start')}
              onChange={(e) => setProp((pr: Record<string, unknown>) => { pr.justifyContent = e.target.value; })}
            >
              <option value="flex-start">Start</option>
              <option value="flex-end">End</option>
              <option value="center">Center</option>
              <option value="space-between">Space Between</option>
              <option value="space-around">Space Around</option>
              <option value="space-evenly">Space Evenly</option>
            </select>
          </label>

          <label className="prop-field">
            <span className="prop-field__label">Align</span>
            <select
              className="prop-field__input"
              value={String(p.alignItems || 'stretch')}
              onChange={(e) => setProp((pr: Record<string, unknown>) => { pr.alignItems = e.target.value; })}
            >
              <option value="flex-start">Start</option>
              <option value="flex-end">End</option>
              <option value="center">Center</option>
              <option value="stretch">Stretch</option>
              <option value="baseline">Baseline</option>
            </select>
          </label>

          <label className="prop-field">
            <span className="prop-field__label">Wrap</span>
            <select
              className="prop-field__input"
              value={String(p.flexWrap || 'nowrap')}
              onChange={(e) => setProp((pr: Record<string, unknown>) => { pr.flexWrap = e.target.value; })}
            >
              <option value="nowrap">No Wrap</option>
              <option value="wrap">Wrap</option>
              <option value="wrap-reverse">Wrap Reverse</option>
            </select>
          </label>

          <label className="prop-field">
            <span className="prop-field__label">Gap</span>
            <input
              className="prop-field__input"
              type="number"
              min={0}
              value={Number(p.gap || 0)}
              onChange={(e) => setProp((pr: Record<string, unknown>) => { pr.gap = parseInt(e.target.value) || 0; })}
            />
          </label>
        </>
      )}
    </div>
  );
}
