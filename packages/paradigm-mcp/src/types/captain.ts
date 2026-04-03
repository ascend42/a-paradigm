/**
 * Captain (Cid) Types
 *
 * Types for the Context Brief and Debrief Report produced by
 * paradigm_captain_brief and paradigm_captain_debrief.
 */

// ────────────────────────────────────────────────────────
// Context Brief
// ────────────────────────────────────────────────────────

export interface ContextBriefSymbol {
  id: string;
  type: 'component' | 'flow' | 'gate' | 'signal' | 'aspect';
  description: string;
  file?: string;
}

export interface ContextBriefBlastRadius {
  affectedFiles: string[];
  affectedSymbols: string[];
  affectedFlows: string[];
  affectedGates: string[];
  fragileSymbols: string[];
}

export interface ContextBriefGate {
  route: string;
  gate: string;
  declared: boolean;
}

export interface ContextBriefProtocol {
  matched: boolean;
  id?: string;
  name?: string;
  steps?: string[];
}

export interface ContextBriefCoverage {
  score: number;
  label: 'sparse' | 'partial' | 'reliable' | 'comprehensive';
  note: string;
}

export interface ContextBriefLoreRef {
  id: string;
  summary: string;
  relevance: string;
}

export interface ContextBrief {
  territory: {
    directories: string[];
    files: string[];
    estimatedScope: 'tiny' | 'small' | 'medium' | 'large';
  };
  symbols: ContextBriefSymbol[];
  blastRadius: ContextBriefBlastRadius;
  gates: ContextBriefGate[];
  protocol: ContextBriefProtocol;
  warnings: string[];
  coverage: ContextBriefCoverage;
  loreRefs: ContextBriefLoreRef[];
  /** Rendered text block for injection into agent prompts */
  renderedBrief: string;
}

// ────────────────────────────────────────────────────────
// Debrief Report
// ────────────────────────────────────────────────────────

export interface SessionInsightsAgentContribution {
  agentId: string;
  contribution: string;
  symbolsTouched: string[];
  patternsObserved: string[];
}

export interface SessionInsights {
  taskDescription: string;
  orchestrationId: string;
  agentContributions: SessionInsightsAgentContribution[];
  coverageDelta: {
    before: number;
    after: number;
  };
  newSymbols: string[];
  touchedFiles: string[];
  notes: string;
}

export interface DebriefReport {
  coverageAdded: string[];
  delegatedToDocumentor: string[];
  loreEntryId: string;
  coverageScore: {
    before: number;
    after: number;
    delta: number;
  };
  stopHookCleared: boolean;
  sessionInsights: SessionInsights;
}

// ────────────────────────────────────────────────────────
// Cid Session Marker
// ────────────────────────────────────────────────────────

export interface CidSessionMarker {
  timestamp: string;
  taskDescription: string;
  depth: string;
  coverageScore?: number;
}

export interface CidBriefedMarker {
  timestamp: string;
  sessionId: string;
  touchedFiles: string[];
  coverageScore: number;
}
