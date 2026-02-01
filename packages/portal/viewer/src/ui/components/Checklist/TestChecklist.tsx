/**
 * Test Checklist - testing mode with auto-ticking gates
 */

import { useMemo } from 'react';
import { useViewerStore } from '../../store/viewerStore';
import type { PortalNode } from '../../../types';

export function TestChecklist() {
  const { portals, flows, selectedFlowId, selectFlow, selectPortal, resetStats } =
    useViewerStore();

  // Get portals to display (filtered by flow if selected)
  const displayPortals = useMemo(() => {
    if (!selectedFlowId) return portals;

    const flow = flows.find((f) => f.id === selectedFlowId);
    if (!flow) return portals;

    // Return portals in flow order
    return flow.flow.gates
      .map((gateId) => portals.find((p) => p.id === gateId))
      .filter(Boolean) as typeof portals;
  }, [portals, flows, selectedFlowId]);

  // Calculate stats
  const stats = useMemo(() => {
    const total = displayPortals.length;
    const checked = displayPortals.filter((p) => p.hitCount > 0).length;
    const passed = displayPortals.filter((p) => p.passCount > 0).length;
    const failed = displayPortals.filter((p) => p.failCount > 0).length;

    return { total, checked, passed, failed };
  }, [displayPortals]);

  return (
    <div className="test-checklist">
      <div className="checklist-header">
        <h2>Test Checklist</h2>
        <div className="checklist-actions">
          {flows.length > 0 && (
            <select
              value={selectedFlowId || ''}
              onChange={(e) => selectFlow(e.target.value || null)}
              className="flow-select"
            >
              <option value="">All Portals</option>
              {flows.map((flow) => (
                <option key={flow.id} value={flow.id}>
                  {flow.flow.description || flow.id}
                </option>
              ))}
            </select>
          )}
          <button className="reset-btn" onClick={resetStats}>
            Reset
          </button>
        </div>
      </div>

      {/* Stats summary */}
      <div className="checklist-stats">
        <div className="stat">
          <span className="stat-value">{stats.checked}/{stats.total}</span>
          <span className="stat-label">Checked</span>
        </div>
        <div className="stat pass">
          <span className="stat-value">{stats.passed}</span>
          <span className="stat-label">Passed</span>
        </div>
        <div className="stat fail">
          <span className="stat-value">{stats.failed}</span>
          <span className="stat-label">Failed</span>
        </div>
        {stats.total > 0 && (
          <div className="stat progress">
            <div
              className="progress-bar"
              style={{ width: `${(stats.checked / stats.total) * 100}%` }}
            />
            <span className="stat-value">
              {Math.round((stats.checked / stats.total) * 100)}%
            </span>
          </div>
        )}
      </div>

      {/* Checklist items */}
      <div className="checklist-items">
        {displayPortals.length === 0 ? (
          <div className="checklist-empty">
            <p>No portals to display</p>
            <p className="hint">
              {selectedFlowId
                ? 'This flow has no gates defined.'
                : 'Waiting for portal events...'}
            </p>
          </div>
        ) : (
          displayPortals.map((portal, index) => (
            <ChecklistItem
              key={portal.id}
              portal={portal}
              index={index + 1}
              onSelect={() => selectPortal(portal.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface ChecklistItemProps {
  portal: PortalNode;
  index: number;
  onSelect: () => void;
}

function ChecklistItem({ portal, index, onSelect }: ChecklistItemProps) {
  const hasBeenChecked = portal.hitCount > 0;
  const hasPassed = portal.passCount > 0;
  const hasFailed = portal.failCount > 0;

  let statusIcon = '⬜';
  let statusClass = 'unchecked';

  if (hasBeenChecked) {
    if (hasFailed && !hasPassed) {
      statusIcon = '❌';
      statusClass = 'failed';
    } else if (hasPassed && !hasFailed) {
      statusIcon = '✅';
      statusClass = 'passed';
    } else if (hasPassed && hasFailed) {
      statusIcon = '⚠️';
      statusClass = 'mixed';
    }
  }

  return (
    <div
      className={`checklist-item ${statusClass}`}
      onClick={onSelect}
    >
      <span className="item-index">{index}</span>
      <span className="item-status">{statusIcon}</span>
      <div className="item-content">
        <span className="item-name">{portal.id}</span>
        {portal.gate.description && (
          <span className="item-description">{portal.gate.description}</span>
        )}
      </div>
      <div className="item-stats">
        {hasBeenChecked && (
          <>
            <span className="item-stat check">{portal.hitCount}×</span>
            <span className="item-stat pass">✓{portal.passCount}</span>
            <span className="item-stat fail">✗{portal.failCount}</span>
          </>
        )}
      </div>
    </div>
  );
}
