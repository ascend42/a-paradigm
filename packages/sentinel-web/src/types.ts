/**
 * Sentinel Web Client Types — Self-contained, zero-dependency
 */

export interface SentinelWebClientOptions {
  /** Sentinel server URL, e.g. "http://localhost:3838" */
  url: string;
  /** Schema ID to associate events with */
  schemaId: string;
  /** Service/app name */
  service: string;
  /** Optional auth token */
  token?: string;
  /** Events per flush batch (default: 100) */
  batchSize?: number;
  /** Flush interval in ms (default: 2000) */
  flushIntervalMs?: number;
  /** Maximum buffer size before dropping (default: 5000) */
  maxBufferSize?: number;
  /** Backpressure strategy (default: 'drop-oldest') */
  backpressure?: 'drop-oldest' | 'drop-newest';
  /** Called when events are dropped due to backpressure */
  onDrop?: (count: number) => void;
  /** Called on transport errors */
  onError?: (error: Error) => void;
}

export interface EventSchemaDeclaration {
  id: string;
  version: string;
  name: string;
  description?: string;
  scope: {
    field: string;
    type: 'number' | 'string';
    label: string;
    ordering: 'sequential' | 'independent';
    sessionField?: string;
  };
  eventTypes: Array<{
    type: string;
    category: string;
    label?: string;
    description?: string;
    fields?: Array<{
      name: string;
      type: 'string' | 'number' | 'boolean' | 'object' | 'array';
      description?: string;
      indexed?: boolean;
      display?: boolean;
    }>;
    frequency?: 'high' | 'medium' | 'low';
    severity?: 'debug' | 'info' | 'warn' | 'error';
  }>;
  causality?: {
    parentField?: string;
    depthField?: string;
    scopeStart?: string[];
    scopeEnd?: string[];
  };
  visualization?: {
    defaultView?: 'timeline' | 'table' | 'tree' | 'flame';
    categoryColors?: Record<string, string>;
    summaryFields?: string[];
    defaultExcluded?: string[];
  };
  tags?: string[];
}

export interface BufferedEvent {
  id: string;
  type: string;
  timestamp: string;
  scopeValue?: string;
  sessionId?: string;
  data?: Record<string, unknown>;
  severity?: string;
  parentEventId?: string;
  depth?: number;
}

export interface EmitOptions {
  scopeValue?: string | number;
  severity?: string;
  parentEventId?: string;
  depth?: number;
  sessionId?: string;
}

export interface BatchEmitEvent {
  type: string;
  data?: Record<string, unknown>;
  timestamp?: number;
  scopeValue?: string | number;
  severity?: string;
  parentEventId?: string;
  depth?: number;
}
