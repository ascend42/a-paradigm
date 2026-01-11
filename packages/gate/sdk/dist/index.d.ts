export { Flow, Gate, GateCheckResult, Key, KeyResult, Lock, LockResult, ParsedGateConfig, Prize } from '@horizon/gate-core';
export { b as GateCheck, G as GateClient, a as GateGuard, c as createGate, g as getGateClient, s as setGateClient } from './index-0604oE60.js';

/**
 * Safe expression evaluator for Gate key expressions
 *
 * Uses a restricted subset of JavaScript for security.
 */
/**
 * Evaluate a key expression against an entity context
 */
declare function evaluateExpression(expression: string, context: Record<string, unknown>): {
    passed: boolean;
    error?: string;
};
/**
 * Create a context object from entity data
 * This normalizes the entity for expression evaluation
 */
declare function createExpressionContext(entity: Record<string, unknown>): Record<string, unknown>;

export { createExpressionContext, evaluateExpression };
