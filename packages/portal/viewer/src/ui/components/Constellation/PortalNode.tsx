/**
 * Portal Node - individual portal visualization with glow effects
 */

import type { PortalNode as PortalNodeType, Position } from '../../../types';

interface PortalNodeProps {
  portal: PortalNodeType;
  position: Position;
  isSelected: boolean;
  isInSelectedFlow: boolean;
  onClick: () => void;
}

export function PortalNode({
  portal,
  position,
  isSelected,
  isInSelectedFlow,
  onClick,
}: PortalNodeProps) {
  const statusClass = getStatusClass(portal.status);
  const passRate = portal.hitCount > 0
    ? Math.round((portal.passCount / portal.hitCount) * 100)
    : null;

  return (
    <div
      className={`portal-node ${statusClass} ${isSelected ? 'selected' : ''} ${isInSelectedFlow ? 'in-flow' : ''}`}
      style={{
        left: position.x,
        top: position.y,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {/* Glow effect layers */}
      <div className="node-glow outer" />
      <div className="node-glow inner" />

      {/* Main node */}
      <div className="node-body">
        <div className="node-icon">{getStatusIcon(portal.status)}</div>
        <div className="node-label">{formatGateName(portal.id)}</div>
      </div>

      {/* Stats tooltip */}
      <div className="node-tooltip">
        <div className="tooltip-header">{portal.id}</div>
        {portal.gate.description && (
          <div className="tooltip-description">{portal.gate.description}</div>
        )}
        <div className="tooltip-stats">
          <span className="stat">
            <span className="stat-icon">👁️</span>
            {portal.hitCount} checks
          </span>
          <span className="stat pass">
            <span className="stat-icon">✅</span>
            {portal.passCount}
          </span>
          <span className="stat fail">
            <span className="stat-icon">❌</span>
            {portal.failCount}
          </span>
          {passRate !== null && (
            <span className="stat rate">
              {passRate}% pass rate
            </span>
          )}
        </div>
        {portal.lastEvent && (
          <div className="tooltip-last-event">
            <span className="event-label">Last:</span>
            <span className="event-reason">{portal.lastEvent.reason}</span>
          </div>
        )}
      </div>

      {/* Pulse ring animation for active state */}
      {(portal.status === 'passed' || portal.status === 'failed') && (
        <div className="pulse-ring" />
      )}
    </div>
  );
}

function getStatusClass(status: PortalNodeType['status']): string {
  switch (status) {
    case 'checking':
      return 'status-checking';
    case 'passed':
      return 'status-passed';
    case 'failed':
      return 'status-failed';
    case 'pending':
      return 'status-pending';
    default:
      return 'status-idle';
  }
}

function getStatusIcon(status: PortalNodeType['status']): string {
  switch (status) {
    case 'checking':
      return '⏳';
    case 'passed':
      return '✅';
    case 'failed':
      return '❌';
    case 'pending':
      return '⏳';
    default:
      return '🚪';
  }
}

function formatGateName(id: string): string {
  // Remove ^ prefix and format nicely
  return id.replace(/^\^/, '').replace(/-/g, ' ');
}
