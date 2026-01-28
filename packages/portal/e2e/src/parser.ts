/**
 * Console log parser for portal check results
 */

import type { PortalCheckResult } from './types.js';

/**
 * Parse portal check results from console log lines
 *
 * Supports two formats:
 * 1. Visual format with box drawing characters
 * 2. JSON format prefixed with [GATE_RESULT]
 *
 * @param logs - Array of console log lines
 * @returns Array of parsed portal check results
 */
export function parsePortalLogs(logs: string[]): PortalCheckResult[] {
  const results: PortalCheckResult[] = [];

  for (const log of logs) {
    const result = parsePortalLog(log);
    if (result) {
      results.push(result);
    }
  }

  return results;
}

/**
 * Parse a single console log line for portal check
 *
 * @param log - Single console log line
 * @returns Parsed result or null if not a portal check
 */
export function parsePortalLog(log: string): PortalCheckResult | null {
  // Try JSON format first (test mode)
  if (log.includes('[GATE_RESULT]')) {
    return parseJsonFormat(log);
  }

  // Try visual format
  if (log.includes('PORTAL CHECK:')) {
    return parseVisualFormat(log);
  }

  return null;
}

/**
 * Parse JSON format portal check
 * Format: [GATE_RESULT] {"gate":"^name","decision":"allow",...}
 */
function parseJsonFormat(log: string): PortalCheckResult | null {
  const jsonIndex = log.indexOf('[GATE_RESULT]');
  if (jsonIndex === -1) return null;

  const jsonStr = log.slice(jsonIndex + '[GATE_RESULT]'.length).trim();

  try {
    const parsed = JSON.parse(jsonStr);

    return {
      gate: parsed.gate,
      decision: normalizeDecision(parsed.decision),
      reason: parsed.reason || '',
      requires: parsed.requires,
      context: parsed.context,
      timestamp: parsed.timestamp,
      duration: parsed.duration,
    };
  } catch {
    return null;
  }
}

/**
 * Parse visual format portal check
 * Format:
 * ┌─────────────────────────────────────────────────────────
 * │ 🚪 PORTAL CHECK: ^gate-name
 * │ ├─ Requires: requirement1, requirement2
 * │ ├─ Context: { ... }
 * │ ├─ Decision: ✅ ALLOW
 * │ └─ Reason: Human-readable reason
 * └─────────────────────────────────────────────────────────
 */
function parseVisualFormat(log: string): PortalCheckResult | null {
  // Extract gate name
  const gateMatch = log.match(/PORTAL CHECK:\s*(\^[\w-]+)/);
  if (!gateMatch) return null;

  const gate = gateMatch[1];

  // Extract decision
  let decision: 'ALLOW' | 'DENY' | 'PENDING' = 'PENDING';
  if (log.includes('✅ ALLOW') || /Decision:\s*ALLOW/i.test(log)) {
    decision = 'ALLOW';
  } else if (log.includes('❌ DENY') || /Decision:\s*DENY/i.test(log)) {
    decision = 'DENY';
  } else if (log.includes('⏳ PENDING') || /Decision:\s*PENDING/i.test(log)) {
    decision = 'PENDING';
  }

  // Extract reason
  const reasonMatch = log.match(/Reason:\s*(.+?)(?:\n|$|│)/);
  const reason = reasonMatch?.[1]?.trim() || '';

  // Extract requires
  const requiresMatch = log.match(/Requires:\s*(.+?)(?:\n|├|│)/);
  const requires = requiresMatch?.[1]
    ?.split(',')
    .map((r) => r.trim())
    .filter(Boolean);

  // Extract context (try to parse JSON)
  let context: Record<string, unknown> | undefined;
  const contextMatch = log.match(/Context:\s*(\{.+?\})(?:\n|├|│)/);
  if (contextMatch) {
    try {
      context = JSON.parse(contextMatch[1]);
    } catch {
      // Context might not be valid JSON, ignore
    }
  }

  return {
    gate,
    decision,
    reason,
    requires,
    context,
  };
}

/**
 * Normalize decision string to uppercase enum value
 */
function normalizeDecision(decision: string): 'ALLOW' | 'DENY' | 'PENDING' {
  const upper = decision.toUpperCase();
  if (upper === 'ALLOW') return 'ALLOW';
  if (upper === 'DENY') return 'DENY';
  return 'PENDING';
}

/**
 * Find portal check results for a specific gate
 *
 * @param logs - Array of console log lines
 * @param gateName - Gate name to find (e.g., '^authenticated')
 * @returns Matching portal check results
 */
export function findPortalCheck(
  logs: string[],
  gateName: string
): PortalCheckResult | undefined {
  const results = parsePortalLogs(logs);
  return results.find((r) => r.gate === gateName);
}

/**
 * Check if logs contain a specific portal decision
 *
 * @param logs - Array of console log lines
 * @param gateName - Gate name to check
 * @param expectedDecision - Expected decision
 * @returns True if portal check matches expected decision
 */
export function hasPortalDecision(
  logs: string[],
  gateName: string,
  expectedDecision: 'ALLOW' | 'DENY' | 'PENDING'
): boolean {
  const result = findPortalCheck(logs, gateName);
  return result?.decision === expectedDecision;
}

/**
 * Extract all unique gate names from logs
 *
 * @param logs - Array of console log lines
 * @returns Array of unique gate names
 */
export function extractGateNames(logs: string[]): string[] {
  const results = parsePortalLogs(logs);
  return [...new Set(results.map((r) => r.gate))];
}
