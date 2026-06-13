/**
 * Agent Relay — typed handoff contract (v7 Spine, §1).
 *
 * One typed structure each agent emits at completion. This is the response half
 * of the orchestration request/response pair (Symphony's `TaskPayload` being the
 * request half). It replaces free-text prose handoffs and the legacy
 * `parseFilePlan*` regex parsers — `filePlan` becomes a typed field that
 * `planBuilderStages` can consume directly.
 *
 * The completion→task mapping (`relay.taskId + status → updateTask`) is wired in
 * sub-phase 2 — this module only defines the contract + a parser. The existing
 * `parseFilePlan*` regex is intentionally left in place; its removal is a
 * sub-phase-2 wiring task.
 */

import * as yaml from 'js-yaml';
import { log } from './mcp-logger.js';

// ── Types ─────────────────────────────────────────────────

/** An artifact an agent produced (a file, a symbol, a decision record, etc.). */
export interface RelayArtifact {
  /** What kind of thing was produced (e.g. 'file', 'symbol', 'test', 'doc'). */
  kind: string;
  /** Stable identifier — a path, a symbol id, a task id, a URL. */
  ref: string;
  /** Optional human-readable note. */
  note?: string;
}

/** A decision the agent made during the work, surfaced for the handoff. */
export interface RelayDecision {
  /** Short statement of the decision. */
  decision: string;
  /** Optional rationale. */
  rationale?: string;
}

/** Outcome of an agent's work step. */
export type RelayStatus = 'complete' | 'blocked' | 'partial';

export interface AgentRelay {
  /** The task this relay settles, if the agent was working a DAG node. */
  taskId?: string;
  /** The agent (archetype id) that produced this relay. */
  agent: string;
  status: RelayStatus;
  artifacts: RelayArtifact[];
  decisions: RelayDecision[];
  /** Archetype id of the next agent in the handoff chain. */
  handoffTo?: string;
  /** Free-text context passed to the next agent. */
  handoffContext?: string;
  /** Planned files for a builder stage (typed replacement for the regex parser). */
  filePlan?: string[];
  /** task-id or rmd-* this work is blocked on (required when status==='blocked'). */
  blockedOn?: string;
}

// ── Parsing ───────────────────────────────────────────────

const FENCE_RE = /```(?:json|yaml)\s*\n([\s\S]*?)```/i;

/**
 * Extract an `AgentRelay` from a fenced ```json or ```yaml block in free text.
 * Returns null when no parseable relay block is present or the parsed object
 * lacks the minimal required shape (`agent` + `status`).
 */
export function parseAgentRelay(text: string): AgentRelay | null {
  if (!text) return null;

  const match = text.match(FENCE_RE);
  if (!match) return null;

  let parsed: unknown;
  try {
    // yaml.load handles both JSON and YAML payloads.
    parsed = yaml.load(match[1]);
  } catch (err) {
    log.component('#agent-relay').warn('Failed to parse relay block', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const raw = parsed as Record<string, unknown>;

  if (typeof raw.agent !== 'string') return null;
  if (raw.status !== 'complete' && raw.status !== 'blocked' && raw.status !== 'partial') return null;

  const relay: AgentRelay = {
    agent: raw.agent,
    status: raw.status,
    artifacts: normalizeArtifacts(raw.artifacts),
    decisions: normalizeDecisions(raw.decisions),
  };

  if (typeof raw.taskId === 'string') relay.taskId = raw.taskId;
  if (typeof raw.handoffTo === 'string') relay.handoffTo = raw.handoffTo;
  if (typeof raw.handoffContext === 'string') relay.handoffContext = raw.handoffContext;
  if (typeof raw.blockedOn === 'string') relay.blockedOn = raw.blockedOn;
  if (Array.isArray(raw.filePlan)) {
    relay.filePlan = raw.filePlan.filter((f): f is string => typeof f === 'string');
  }

  return relay;
}

function normalizeArtifacts(raw: unknown): RelayArtifact[] {
  if (!Array.isArray(raw)) return [];
  const out: RelayArtifact[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object') {
      const a = item as Record<string, unknown>;
      if (typeof a.kind === 'string' && typeof a.ref === 'string') {
        const artifact: RelayArtifact = { kind: a.kind, ref: a.ref };
        if (typeof a.note === 'string') artifact.note = a.note;
        out.push(artifact);
      }
    }
  }
  return out;
}

function normalizeDecisions(raw: unknown): RelayDecision[] {
  if (!Array.isArray(raw)) return [];
  const out: RelayDecision[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object') {
      const d = item as Record<string, unknown>;
      if (typeof d.decision === 'string') {
        const decision: RelayDecision = { decision: d.decision };
        if (typeof d.rationale === 'string') decision.rationale = d.rationale;
        out.push(decision);
      }
    }
  }
  return out;
}
