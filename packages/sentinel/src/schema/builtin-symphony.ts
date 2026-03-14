/**
 * Built-in Symphony Schema Declaration — #SymphonySchema
 *
 * Defines the paradigm-symphony event schema for agent-to-agent messaging.
 * Events are scoped by threadId with parent-child causality via parentId.
 * 19 event types across 6 categories: dialogue, action, outcome, system, lifecycle, transfer.
 */

import type { EventSchemaDeclaration } from './types.js';

export const SYMPHONY_SCHEMA: EventSchemaDeclaration = {
  id: 'paradigm-symphony',
  version: '1.0.0',
  name: 'Symphony Conversations',
  description: 'Agent-to-agent messaging events from The Score protocol',
  scope: {
    field: 'threadId',
    type: 'string',
    label: 'Thread',
    ordering: 'independent',
    sessionField: 'sessionId',
  },
  eventTypes: [
    // ── Dialogue (5) ──────────────────────────────────────
    {
      type: 'note:question',
      category: 'dialogue',
      label: 'Question',
      severity: 'info',
      frequency: 'high',
      fields: [
        { name: 'sender', type: 'string', indexed: true, display: true },
        { name: 'senderRole', type: 'string', indexed: true, display: true },
        { name: 'text', type: 'string', display: true },
        { name: 'symbols', type: 'object' },
        { name: 'parentId', type: 'string', indexed: true },
      ],
    },
    {
      type: 'note:context',
      category: 'dialogue',
      label: 'Context',
      severity: 'info',
      frequency: 'high',
      fields: [
        { name: 'sender', type: 'string', indexed: true, display: true },
        { name: 'senderRole', type: 'string', indexed: true, display: true },
        { name: 'text', type: 'string', display: true },
        { name: 'symbols', type: 'object' },
        { name: 'parentId', type: 'string', indexed: true },
      ],
    },
    {
      type: 'note:clarification',
      category: 'dialogue',
      label: 'Clarification',
      severity: 'info',
      frequency: 'medium',
      fields: [
        { name: 'sender', type: 'string', indexed: true, display: true },
        { name: 'senderRole', type: 'string', indexed: true, display: true },
        { name: 'text', type: 'string', display: true },
        { name: 'symbols', type: 'object' },
        { name: 'parentId', type: 'string', indexed: true },
      ],
    },
    {
      type: 'note:verification',
      category: 'dialogue',
      label: 'Verification',
      severity: 'info',
      frequency: 'medium',
      fields: [
        { name: 'sender', type: 'string', indexed: true, display: true },
        { name: 'senderRole', type: 'string', indexed: true, display: true },
        { name: 'text', type: 'string', display: true },
        { name: 'symbols', type: 'object' },
        { name: 'parentId', type: 'string', indexed: true },
      ],
    },
    {
      type: 'note:reference',
      category: 'dialogue',
      label: 'Reference',
      severity: 'info',
      frequency: 'medium',
      fields: [
        { name: 'sender', type: 'string', indexed: true, display: true },
        { name: 'senderRole', type: 'string', indexed: true, display: true },
        { name: 'text', type: 'string', display: true },
        { name: 'symbols', type: 'object' },
        { name: 'parentId', type: 'string', indexed: true },
      ],
    },

    // ── Action (2) ────────────────────────────────────────
    {
      type: 'note:proposal',
      category: 'action',
      label: 'Proposal',
      severity: 'info',
      frequency: 'medium',
      fields: [
        { name: 'sender', type: 'string', indexed: true, display: true },
        { name: 'senderRole', type: 'string', indexed: true, display: true },
        { name: 'text', type: 'string', display: true },
        { name: 'diff', type: 'string' },
        { name: 'symbols', type: 'object' },
        { name: 'parentId', type: 'string', indexed: true },
      ],
    },
    {
      type: 'note:action',
      category: 'action',
      label: 'Action',
      severity: 'info',
      frequency: 'medium',
      fields: [
        { name: 'sender', type: 'string', indexed: true, display: true },
        { name: 'senderRole', type: 'string', indexed: true, display: true },
        { name: 'text', type: 'string', display: true },
        { name: 'diff', type: 'string' },
        { name: 'symbols', type: 'object' },
        { name: 'parentId', type: 'string', indexed: true },
      ],
    },

    // ── Outcome (3) ───────────────────────────────────────
    {
      type: 'note:decision',
      category: 'outcome',
      label: 'Decision',
      severity: 'warn',
      frequency: 'low',
      fields: [
        { name: 'sender', type: 'string', indexed: true, display: true },
        { name: 'senderRole', type: 'string', indexed: true, display: true },
        { name: 'text', type: 'string', display: true },
        { name: 'decision', type: 'string', display: true },
        { name: 'symbols', type: 'object' },
        { name: 'parentId', type: 'string', indexed: true },
      ],
    },
    {
      type: 'note:approval',
      category: 'outcome',
      label: 'Approval',
      severity: 'info',
      frequency: 'low',
      fields: [
        { name: 'sender', type: 'string', indexed: true, display: true },
        { name: 'senderRole', type: 'string', indexed: true, display: true },
        { name: 'text', type: 'string', display: true },
        { name: 'parentId', type: 'string', indexed: true },
      ],
    },
    {
      type: 'note:rejection',
      category: 'outcome',
      label: 'Rejection',
      severity: 'warn',
      frequency: 'low',
      fields: [
        { name: 'sender', type: 'string', indexed: true, display: true },
        { name: 'senderRole', type: 'string', indexed: true, display: true },
        { name: 'text', type: 'string', display: true },
        { name: 'parentId', type: 'string', indexed: true },
      ],
    },

    // ── System (1) ────────────────────────────────────────
    {
      type: 'note:alert',
      category: 'system',
      label: 'Alert',
      severity: 'error',
      frequency: 'low',
      fields: [
        { name: 'sender', type: 'string', indexed: true, display: true },
        { name: 'senderRole', type: 'string', indexed: true, display: true },
        { name: 'text', type: 'string', display: true },
        { name: 'symbols', type: 'object' },
        { name: 'parentId', type: 'string', indexed: true },
      ],
    },

    // ── Lifecycle (4) ─────────────────────────────────────
    {
      type: 'note:handoff',
      category: 'lifecycle',
      label: 'Handoff',
      severity: 'info',
      frequency: 'low',
      fields: [
        { name: 'sender', type: 'string', indexed: true, display: true },
        { name: 'senderRole', type: 'string', indexed: true, display: true },
        { name: 'text', type: 'string', display: true },
        { name: 'parentId', type: 'string', indexed: true },
      ],
    },
    {
      type: 'thread:created',
      category: 'lifecycle',
      label: 'Thread Created',
      severity: 'info',
      frequency: 'low',
      fields: [
        { name: 'topic', type: 'string', display: true },
        { name: 'initiator', type: 'string', indexed: true, display: true },
      ],
    },
    {
      type: 'thread:resolved',
      category: 'lifecycle',
      label: 'Thread Resolved',
      severity: 'info',
      frequency: 'low',
      fields: [
        { name: 'topic', type: 'string', display: true },
        { name: 'decision', type: 'string', display: true },
      ],
    },
    {
      type: 'participant:joined',
      category: 'lifecycle',
      label: 'Participant Joined',
      severity: 'info',
      frequency: 'low',
      fields: [
        { name: 'participantId', type: 'string', indexed: true, display: true },
        { name: 'participantName', type: 'string', display: true },
        { name: 'participantRole', type: 'string', display: true },
      ],
    },
    {
      type: 'participant:left',
      category: 'lifecycle',
      label: 'Participant Left',
      severity: 'info',
      frequency: 'low',
      fields: [
        { name: 'participantId', type: 'string', indexed: true, display: true },
        { name: 'participantName', type: 'string', display: true },
      ],
    },

    // ── Transfer (4) ──────────────────────────────────────
    {
      type: 'file:requested',
      category: 'transfer',
      label: 'File Requested',
      severity: 'info',
      frequency: 'low',
      fields: [
        { name: 'requestId', type: 'string', indexed: true, display: true },
        { name: 'filePath', type: 'string', display: true },
        { name: 'requester', type: 'string', indexed: true, display: true },
        { name: 'reason', type: 'string', display: true },
        { name: 'urgency', type: 'string', display: true },
      ],
    },
    {
      type: 'file:approved',
      category: 'transfer',
      label: 'File Approved',
      severity: 'info',
      frequency: 'low',
      fields: [
        { name: 'requestId', type: 'string', indexed: true, display: true },
        { name: 'filePath', type: 'string', display: true },
        { name: 'size', type: 'number', display: true },
        { name: 'hash', type: 'string' },
      ],
    },
    {
      type: 'file:denied',
      category: 'transfer',
      label: 'File Denied',
      severity: 'warn',
      frequency: 'low',
      fields: [
        { name: 'requestId', type: 'string', indexed: true, display: true },
        { name: 'filePath', type: 'string', display: true },
        { name: 'reason', type: 'string', display: true },
      ],
    },
    {
      type: 'file:delivered',
      category: 'transfer',
      label: 'File Delivered',
      severity: 'info',
      frequency: 'low',
      fields: [
        { name: 'requestId', type: 'string', indexed: true, display: true },
        { name: 'filePath', type: 'string', display: true },
        { name: 'size', type: 'number', display: true },
        { name: 'hash', type: 'string' },
      ],
    },
  ],
  visualization: {
    defaultView: 'tree',
    categoryColors: {
      dialogue: '#7dd3fc',
      action: '#86efac',
      outcome: '#fbbf24',
      system: '#f87171',
      lifecycle: '#a78bfa',
      transfer: '#34d399',
    },
    summaryFields: ['sender', 'text', 'senderRole'],
    defaultExcluded: [],
  },
  tags: ['builtin', 'symphony'],
};
