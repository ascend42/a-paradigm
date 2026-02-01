/**
 * Session and Report Types
 */

import type { ViewerEvent } from '../types.js';

export interface SessionReport {
  // Metadata
  id: string;
  name: string;
  generatedAt: string;
  format: 'json' | 'markdown';

  // Session info
  session: {
    id: string;
    name: string;
    startedAt: string;
    endedAt: string;
    duration: number; // seconds
    status: string;
  };

  // Summary
  summary: {
    totalEvents: number;
    gatesChecked: number;
    gatesPassed: number;
    gatesFailed: number;
    passRate: number; // 0-100
    uniqueEntities: number;
    flowsCompleted: string[];
  };

  // Gate breakdown
  gates: GateReport[];

  // Entity journeys
  entities: EntityReport[];

  // All events (optional, can be large)
  events?: ViewerEvent[];

  // Failures highlighted
  failures: ViewerEvent[];
}

export interface GateReport {
  id: string;
  description?: string;
  hitCount: number;
  passCount: number;
  failCount: number;
  passRate: number;
  lastDecision?: 'pending' | 'allow' | 'deny';
  lastReason?: string;
}

export interface EntityReport {
  entityId: string;
  firstSeen: string;
  lastSeen: string;
  eventCount: number;
  gatesVisited: string[];
  flowProgress: Record<string, number>;
}

export type ReportFormat = 'json' | 'markdown' | 'slack' | 'discord';
