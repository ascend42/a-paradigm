/**
 * @horizon/gate-sdk
 *
 * Runtime SDK for checking gates in applications
 */

// Re-export types from core
export type {
  Key,
  Lock,
  Prize,
  Gate,
  Flow,
  ParsedGateConfig,
  GateCheckResult,
  LockResult,
  KeyResult,
} from '@horizon/gate-core';

// Client
export { GateClient, createGate } from './client.js';

// Evaluator
export { evaluateExpression, createExpressionContext } from './evaluator.js';

// Decorators (also available via @horizon/gate-sdk/decorators)
export { GateGuard, GateCheck, setGateClient, getGateClient } from './decorators/index.js';
