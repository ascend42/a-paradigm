/**
 * Data Policy Loader — reads and applies .paradigm/data-policy.yaml
 *
 * If no data-policy.yaml exists, returns DEFAULT_DATA_POLICY.
 * Merges user policy over defaults (user deny lists are additive, not replacing).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type {
  DataPolicy,
  TrustRing,
  ObservationRules,
  EnforcementResult,
  EnforcementBoundary,
  ContentCategory,
  RedactionPattern,
} from '../types/data-policy.js';
import { DEFAULT_DATA_POLICY, TRUST_RING_ORDER } from '../types/data-policy.js';

const POLICY_FILE = '.paradigm/data-policy.yaml';

// ── Loading ──

export function loadDataPolicy(rootDir: string): DataPolicy {
  const filePath = path.join(rootDir, POLICY_FILE);

  if (!fs.existsSync(filePath)) {
    return { ...DEFAULT_DATA_POLICY };
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const userPolicy = yaml.load(content) as Partial<DataPolicy>;
    return mergePolicy(DEFAULT_DATA_POLICY, userPolicy);
  } catch {
    return { ...DEFAULT_DATA_POLICY };
  }
}

function mergePolicy(base: DataPolicy, override: Partial<DataPolicy>): DataPolicy {
  const merged: DataPolicy = { ...base };

  if (override.version) merged.version = override.version;
  if (override.default_ring) merged.default_ring = override.default_ring;

  // Merge observation rules (deny lists are additive)
  if (override.observation) {
    merged.observation = {
      allow: override.observation.allow || base.observation?.allow,
      deny: [
        ...(base.observation?.deny || []),
        ...(override.observation.deny || []),
      ].filter((v, i, a) => a.indexOf(v) === i), // deduplicate
    };
  }

  // Merge stream rules
  if (override.streams) {
    merged.streams = { ...base.streams };
    for (const key of ['work_log', 'learning_journal', 'team_decisions'] as const) {
      if (override.streams[key]) {
        merged.streams[key] = {
          ...base.streams?.[key],
          ...override.streams[key],
          deny_content: [
            ...(base.streams?.[key]?.deny_content || []),
            ...(override.streams[key]?.deny_content || []),
          ].filter((v, i, a) => a.indexOf(v) === i),
        };
      }
    }
  }

  if (override.upstream) merged.upstream = { ...base.upstream, ...override.upstream };
  if (override.network) merged.network = { ...base.network, ...override.network };
  if (override.agent_overrides) merged.agent_overrides = { ...base.agent_overrides, ...override.agent_overrides };
  if (override.deployment) merged.deployment = { ...base.deployment, ...override.deployment };

  return merged;
}

// ── Observation Check ──

export function canObservePath(policy: DataPolicy, filePath: string, agentId?: string): boolean {
  // Check agent-specific overrides first
  if (agentId && policy.agent_overrides?.[agentId]?.observation) {
    const agentObs = policy.agent_overrides[agentId].observation!;
    if (agentObs.deny?.some(p => matchGlob(p, filePath))) return false;
    // Agent override allow doesn't override global deny
  }

  // Global deny always wins
  if (policy.observation?.deny?.some(p => matchGlob(p, filePath))) {
    return false;
  }

  // Check allow list (if specified, only allowed paths pass)
  if (policy.observation?.allow?.length) {
    return policy.observation.allow.some(p => matchGlob(p, filePath));
  }

  return true; // No allow list = everything allowed
}

// ── Content Filtering ──

export function filterContent(
  content: string,
  policy: DataPolicy,
  stream: 'work_log' | 'learning_journal' | 'team_decisions'
): { filtered: string; redacted: string[] } {
  const streamRules = policy.streams?.[stream];
  if (!streamRules) return { filtered: content, redacted: [] };

  const redacted: string[] = [];

  // Apply redaction patterns
  let result = content;
  if (streamRules.redaction) {
    for (const pattern of streamRules.redaction) {
      try {
        const regex = new RegExp(pattern.pattern, 'gi');
        const matches = result.match(regex);
        if (matches) {
          redacted.push(...matches);
          result = result.replace(regex, pattern.replacement || '[REDACTED]');
        }
      } catch {
        // Invalid regex — skip
      }
    }
  }

  return { filtered: result, redacted };
}

// ── Ring Check ──

export function isRingAllowed(required: TrustRing, actual: TrustRing): boolean {
  return TRUST_RING_ORDER[actual] <= TRUST_RING_ORDER[required];
}

// ── Enforcement ──

export function enforce(
  boundary: EnforcementBoundary,
  policy: DataPolicy,
  opts: {
    filePath?: string;
    agentId?: string;
    content?: string;
    stream?: 'work_log' | 'learning_journal' | 'team_decisions';
    destinationRing?: TrustRing;
  }
): EnforcementResult {
  const timestamp = new Date().toISOString();

  // Event emission boundary
  if (boundary === 'event-emission' && opts.filePath) {
    const allowed = canObservePath(policy, opts.filePath, opts.agentId);
    return {
      boundary,
      allowed,
      ring_checked: policy.default_ring,
      timestamp,
      filtered: allowed ? undefined : [opts.filePath],
    };
  }

  // Content recording boundaries
  if ((boundary === 'work-log-recording' || boundary === 'journal-recording') && opts.content && opts.stream) {
    const { filtered, redacted } = filterContent(opts.content, policy, opts.stream);
    return {
      boundary,
      allowed: true,
      ring_checked: policy.streams?.[opts.stream]?.ring || policy.default_ring,
      timestamp,
      redacted: redacted.length > 0 ? redacted : undefined,
    };
  }

  // Upstream boundary
  if (boundary === 'upstream-feedback') {
    const upstreamRing = policy.upstream?.ring || 'creator-upstream';
    return {
      boundary,
      allowed: policy.upstream?.allowed ? policy.upstream.allowed.length > 0 : false,
      ring_checked: upstreamRing,
      timestamp,
    };
  }

  // Network boundary
  if (boundary === 'network-aggregation') {
    return {
      boundary,
      allowed: policy.network?.opt_in || false,
      ring_checked: 'network-public',
      timestamp,
    };
  }

  // Default: allow
  return {
    boundary,
    allowed: true,
    ring_checked: policy.default_ring,
    timestamp,
  };
}

// ── Glob Matching ──

function matchGlob(pattern: string, value: string): boolean {
  if (pattern === value) return true;
  const regex = pattern
    .replace(/\*\*/g, '§§')
    .replace(/\*/g, '[^/]*')
    .replace(/§§/g, '.*');
  try {
    return new RegExp(`^${regex}$`).test(value);
  } catch {
    return false;
  }
}
