/**
 * Built-in Paradigm Schema Declaration
 *
 * Registers Paradigm's existing log/metric/trace types as an event schema.
 * This is informational — existing tables remain untouched.
 */

import type { EventSchemaDeclaration } from './types.js';

export const PARADIGM_SCHEMA: EventSchemaDeclaration = {
  id: 'paradigm-logger',
  version: '1.0.0',
  name: 'Paradigm Logger',
  description: 'Structured logs from @a-company/paradigm-logger with symbolic context',
  scope: {
    field: 'correlationId',
    type: 'string',
    label: 'Correlation',
    ordering: 'independent',
    sessionField: 'sessionId',
  },
  eventTypes: [
    {
      type: 'log:debug',
      category: 'logs',
      label: 'Debug Log',
      severity: 'debug',
      frequency: 'high',
      fields: [
        { name: 'symbol', type: 'string', indexed: true, display: true },
        { name: 'symbolType', type: 'string', indexed: true, display: true },
        { name: 'message', type: 'string', display: true },
        { name: 'service', type: 'string', indexed: true, display: true },
        { name: 'durationMs', type: 'number', display: true },
      ],
    },
    {
      type: 'log:info',
      category: 'logs',
      label: 'Info Log',
      severity: 'info',
      frequency: 'high',
      fields: [
        { name: 'symbol', type: 'string', indexed: true, display: true },
        { name: 'symbolType', type: 'string', indexed: true, display: true },
        { name: 'message', type: 'string', display: true },
        { name: 'service', type: 'string', indexed: true, display: true },
        { name: 'durationMs', type: 'number', display: true },
      ],
    },
    {
      type: 'log:warn',
      category: 'logs',
      label: 'Warning Log',
      severity: 'warn',
      frequency: 'medium',
      fields: [
        { name: 'symbol', type: 'string', indexed: true, display: true },
        { name: 'symbolType', type: 'string', indexed: true, display: true },
        { name: 'message', type: 'string', display: true },
        { name: 'service', type: 'string', indexed: true, display: true },
      ],
    },
    {
      type: 'log:error',
      category: 'logs',
      label: 'Error Log',
      severity: 'error',
      frequency: 'low',
      fields: [
        { name: 'symbol', type: 'string', indexed: true, display: true },
        { name: 'symbolType', type: 'string', indexed: true, display: true },
        { name: 'message', type: 'string', display: true },
        { name: 'service', type: 'string', indexed: true, display: true },
      ],
    },
    {
      type: 'metric:counter',
      category: 'metrics',
      label: 'Counter Metric',
      severity: 'info',
      frequency: 'high',
      fields: [
        { name: 'name', type: 'string', indexed: true, display: true },
        { name: 'value', type: 'number', display: true },
        { name: 'tags', type: 'object' },
      ],
    },
    {
      type: 'metric:gauge',
      category: 'metrics',
      label: 'Gauge Metric',
      severity: 'info',
      frequency: 'medium',
      fields: [
        { name: 'name', type: 'string', indexed: true, display: true },
        { name: 'value', type: 'number', display: true },
        { name: 'tags', type: 'object' },
      ],
    },
    {
      type: 'metric:histogram',
      category: 'metrics',
      label: 'Histogram Metric',
      severity: 'info',
      frequency: 'medium',
      fields: [
        { name: 'name', type: 'string', indexed: true, display: true },
        { name: 'value', type: 'number', display: true },
        { name: 'tags', type: 'object' },
      ],
    },
    {
      type: 'trace:span',
      category: 'traces',
      label: 'Trace Span',
      severity: 'info',
      frequency: 'medium',
      fields: [
        { name: 'traceId', type: 'string', indexed: true, display: true },
        { name: 'spanId', type: 'string', indexed: true },
        { name: 'operation', type: 'string', display: true },
        { name: 'durationMs', type: 'number', display: true },
        { name: 'status', type: 'string', display: true },
      ],
    },
    {
      type: 'incident:recorded',
      category: 'incidents',
      label: 'Incident Recorded',
      severity: 'error',
      frequency: 'low',
      fields: [
        { name: 'incidentId', type: 'string', indexed: true, display: true },
        { name: 'errorMessage', type: 'string', display: true },
        { name: 'symbols', type: 'object' },
        { name: 'environment', type: 'string', display: true },
      ],
    },
  ],
  visualization: {
    defaultView: 'table',
    categoryColors: {
      logs: '#3b82f6',
      metrics: '#22c55e',
      traces: '#a855f7',
      incidents: '#ef4444',
    },
    summaryFields: ['symbol', 'message', 'service'],
    defaultExcluded: ['log:debug'],
  },
  tags: ['builtin', 'paradigm'],
};
