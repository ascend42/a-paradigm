/**
 * Portal Viewer Types
 */

import type { WatcherEvent, WatcherEventType, Gate, Flow } from '@a-company/portal-core';

// Re-export for convenience
export type { WatcherEvent, WatcherEventType, Gate, Flow };

// ============================================
// Portal State Types
// ============================================

export type PortalStatus = 'idle' | 'checking' | 'passed' | 'failed' | 'pending';

export interface PortalNode {
  id: string;
  gate: Gate;
  status: PortalStatus;
  lastEvent?: ViewerEvent;
  lastUpdated?: string;
  hitCount: number;
  passCount: number;
  failCount: number;
}

export interface FlowNode {
  id: string;
  flow: Flow;
  progress: number; // 0-100
  currentGateIndex: number;
  completedGates: string[];
  status: 'idle' | 'in-progress' | 'completed';
}

// ============================================
// Viewer Event Types (extends WatcherEvent)
// ============================================

export interface ViewerEvent {
  id: string;
  type: WatcherEventType;
  timestamp: string;
  entityId: string;
  gate?: string;
  decision?: 'allow' | 'deny' | 'pending';
  reason?: string;
  context?: Record<string, unknown>;
  duration?: number;
  raw: WatcherEvent;
}

// ============================================
// Session Types
// ============================================

export type SessionStatus = 'active' | 'completed' | 'exported';

export interface PortalSession {
  id: string;
  name?: string;
  startedAt: string;
  endedAt?: string;
  status: SessionStatus;

  // Summary stats
  totalEvents: number;
  gatesChecked: number;
  gatesPassed: number;
  gatesFailed: number;
  flowsCompleted: string[];

  // Full event log
  events: ViewerEvent[];

  // Entities tracked
  entities: Record<string, EntityJourney>;
}

export interface EntityJourney {
  entityId: string;
  firstSeen: string;
  lastSeen: string;
  events: ViewerEvent[];
  gatesVisited: string[];
  flowProgress: Record<string, number>; // flowId -> % complete
}

// ============================================
// Webhook Types
// ============================================

export type WebhookType = 'slack' | 'discord' | 'email' | 'http';
export type WebhookTrigger = 'session-end' | 'gate-fail' | 'flow-complete';

export interface WebhookConfig {
  id: string;
  name: string;
  type: WebhookType;
  url: string;
  enabled: boolean;
  triggers: WebhookTrigger[];
  headers?: Record<string, string>;
  customFields?: Record<string, unknown>;
}

export interface WebhookPayload {
  type: 'session-report' | 'gate-alert' | 'flow-complete';
  timestamp: string;

  // Session summary (for session-report)
  session?: {
    id: string;
    name: string;
    duration: number; // seconds
    totalEvents: number;
    gatesPassed: number;
    gatesFailed: number;
    passRate: number; // percentage
    flowsCompleted: string[];
  };

  // Gate alert (for gate-alert)
  event?: ViewerEvent;

  // Highlights
  failures?: ViewerEvent[];

  // Custom fields from config
  customFields: Record<string, unknown>;
}

// ============================================
// Server Message Types
// ============================================

export type ServerMessageType =
  | 'init'
  | 'portal-event'
  | 'session-update'
  | 'state-sync';

export interface ServerMessage {
  type: ServerMessageType;
  data: unknown;
}

export interface InitMessage extends ServerMessage {
  type: 'init';
  data: {
    portals: PortalNode[];
    flows: FlowNode[];
    session: PortalSession | null;
  };
}

export interface PortalEventMessage extends ServerMessage {
  type: 'portal-event';
  data: ViewerEvent;
}

export interface SessionUpdateMessage extends ServerMessage {
  type: 'session-update';
  data: PortalSession;
}

export interface StateSyncMessage extends ServerMessage {
  type: 'state-sync';
  data: {
    portals: PortalNode[];
    flows: FlowNode[];
    session: PortalSession | null;
  };
}

// ============================================
// Client Message Types
// ============================================

export type ClientMessageType =
  | 'session-start'
  | 'session-end'
  | 'session-name'
  | 'session-export'
  | 'send-webhook'
  | 'reset-stats';

export interface ClientMessage {
  type: ClientMessageType;
  data?: unknown;
}

// ============================================
// UI Types
// ============================================

export type ViewMode = 'constellation' | 'checklist' | 'timeline';

export interface Position {
  x: number;
  y: number;
}
